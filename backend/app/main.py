import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import sentry_sdk
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session
from starlette.middleware.cors import CORSMiddleware

from app.api.main import api_router
from app.core.config import settings
from app.core.db import engine, init_db
from app.services.document_processor import document_worker


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.use_blob_storage:
        Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    # Initialize the SQLite schema and seed the superuser. Safe to run on every
    # startup: create_all is a no-op for existing tables and the superuser
    # insert is idempotent.
    with Session(engine) as session:
        init_db(session)
    stop_event = asyncio.Event()
    worker_task = asyncio.create_task(document_worker(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await worker_task


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)

if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Serve uploaded PDFs and rendered page images statically when using local
# storage. With Azure Blob Storage, files are served directly from blob SAS URLs.
if not settings.use_blob_storage:
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    app.mount(
        "/uploads",
        StaticFiles(directory=settings.UPLOAD_DIR),
        name="uploads",
    )

app.include_router(api_router, prefix=settings.API_V1_STR)
