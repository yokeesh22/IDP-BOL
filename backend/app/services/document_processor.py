from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.core.storage import get_storage
from app.models import Document, DocumentStatus

logger = logging.getLogger(__name__)


def convert_pdf_to_images(pdf_bytes: bytes, doc_id: uuid.UUID) -> int:
    import fitz  # PyMuPDF

    storage = get_storage()
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        zoom = settings.PDF_RENDER_DPI / 72.0
        mat = fitz.Matrix(zoom, zoom)
        for page_num in range(len(pdf_doc)):
            page = pdf_doc[page_num]
            pix = page.get_pixmap(matrix=mat, alpha=False)
            storage.save_bytes(
                f"doc_{doc_id}_pages/page_{page_num + 1}.png",
                pix.tobytes("png"),
                content_type="image/png",
            )
        return len(pdf_doc)
    finally:
        pdf_doc.close()


def _extract_regions(field: Any) -> list[dict[str, Any]]:
    regions: list[dict[str, Any]] = []
    bounding = getattr(field, "bounding_regions", None)
    if not bounding:
        return regions
    for r in bounding:
        polygon = []
        if getattr(r, "polygon", None):
            polygon = [[p.x, p.y] for p in r.polygon]
        regions.append({"page_number": r.page_number, "polygon": polygon})
    return regions


def analyze_with_form_recognizer(pdf_bytes: bytes) -> dict[str, Any]:
    from azure.ai.formrecognizer import DocumentAnalysisClient
    from azure.core.credentials import AzureKeyCredential

    if not settings.FR_ENDPOINT or not settings.FR_KEY:
        raise RuntimeError(
            "Azure Form Recognizer credentials are not configured "
            "(FR_ENDPOINT / FR_KEY)"
        )

    client = DocumentAnalysisClient(
        endpoint=settings.FR_ENDPOINT,
        credential=AzureKeyCredential(settings.FR_KEY),
    )

    poller = client.begin_analyze_document(settings.FR_MODEL_ID, document=pdf_bytes)
    result = poller.result()

    kv_pairs: list[dict[str, Any]] = []
    for kv in result.key_value_pairs or []:
        if not kv.key:
            continue
        kv_pairs.append(
            {
                "key": {
                    "content": kv.key.content or "",
                    "bounding_regions": _extract_regions(kv.key),
                },
                "value": {
                    "content": (kv.value.content if kv.value else "") or "",
                    "bounding_regions": _extract_regions(kv.value) if kv.value else [],
                },
                "confidence": kv.confidence or 0.0,
            }
        )

    tables: list[dict[str, Any]] = []
    for idx, table in enumerate(result.tables or []):
        cells = []
        for cell in table.cells or []:
            cells.append(
                {
                    "row_index": cell.row_index,
                    "column_index": cell.column_index,
                    "row_span": cell.row_span or 1,
                    "column_span": cell.column_span or 1,
                    "content": cell.content or "",
                    "kind": cell.kind or "content",
                    "bounding_regions": _extract_regions(cell),
                }
            )
        tables.append(
            {
                "index": idx,
                "row_count": table.row_count,
                "column_count": table.column_count,
                "bounding_regions": _extract_regions(table),
                "cells": cells,
            }
        )

    return {
        "key_value_pairs": kv_pairs,
        "tables": tables,
        "page_count": len(result.pages) if result.pages else 0,
        "full_text": result.content or "",
    }


def _process_document_blocking(doc_id: uuid.UUID) -> None:
    filename = ""
    with Session(engine) as session:
        doc = session.get(Document, doc_id)
        if not doc:
            return
        filename = doc.filename
        doc.status = DocumentStatus.PROCESSING
        doc.error_message = None
        session.add(doc)
        session.commit()

    try:
        storage = get_storage()
        if not storage.exists(filename):
            raise FileNotFoundError(f"PDF missing from storage: {filename}")

        pdf_bytes = storage.read_bytes(filename)
        page_count = convert_pdf_to_images(pdf_bytes, doc_id)
        result = analyze_with_form_recognizer(pdf_bytes)
        page_count = max(page_count, result.get("page_count", 0))

        # Extract BOL fields of interest via LLM before marking as processed
        bol_result: dict | None = None
        try:
            from app.services.bol_extraction import extract_bol_fields
            bol_result = extract_bol_fields(
                result["key_value_pairs"],
                result["tables"],
                result.get("full_text", ""),
            )
            logger.info(
                "Document %s BOL extraction: %d fields, %d line items",
                doc_id,
                len(bol_result["kv_fields"]),
                len(bol_result["line_items"]),
            )
        except Exception:
            logger.exception("BOL extraction failed for document %s — continuing", doc_id)

        with Session(engine) as session:
            doc = session.get(Document, doc_id)
            if not doc:
                return
            doc.status = DocumentStatus.PROCESSED
            doc.page_count = page_count
            doc.key_value_pairs = result["key_value_pairs"]
            doc.tables = result["tables"]
            doc.bol_kv_fields = bol_result["kv_fields"] if bol_result else None
            doc.bol_line_items = bol_result["line_items"] if bol_result else None
            doc.processed_at = datetime.now(timezone.utc)
            doc.error_message = None
            session.add(doc)
            session.commit()
        logger.info(
            "Document %s processed: %d pairs, %d tables",
            doc_id,
            len(result["key_value_pairs"]),
            len(result["tables"]),
        )
    except Exception as e:
        logger.exception("Failed to process document %s", doc_id)
        with Session(engine) as session:
            doc = session.get(Document, doc_id)
            if doc:
                doc.status = DocumentStatus.ERROR
                doc.error_message = str(e)[:2000]
                doc.processed_at = datetime.now(timezone.utc)
                session.add(doc)
                session.commit()


def _claim_pending(limit: int) -> list[uuid.UUID]:
    with Session(engine) as session:
        rows = session.exec(
            select(Document.id)
            .where(Document.status == DocumentStatus.PENDING)
            .order_by(Document.created_at)  # type: ignore[arg-type]
            .limit(limit)
        ).all()
        return list(rows)


async def document_worker(stop_event: asyncio.Event) -> None:
    sem = asyncio.Semaphore(settings.PROCESSOR_CONCURRENCY)
    in_flight: set[asyncio.Task[Any]] = set()
    loop = asyncio.get_running_loop()

    async def _run_one(doc_id: uuid.UUID) -> None:
        async with sem:
            try:
                await loop.run_in_executor(None, _process_document_blocking, doc_id)
            except Exception:
                logger.exception("Worker task crashed for %s", doc_id)

    logger.info("Document worker started (concurrency=%d)", settings.PROCESSOR_CONCURRENCY)
    while not stop_event.is_set():
        try:
            free_slots = settings.PROCESSOR_CONCURRENCY - sum(
                1 for t in in_flight if not t.done()
            )
            if free_slots > 0:
                pending = _claim_pending(free_slots)
                for doc_id in pending:
                    task = asyncio.create_task(_run_one(doc_id))
                    in_flight.add(task)
                    task.add_done_callback(in_flight.discard)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                pass
        except Exception:
            logger.exception("Document worker loop error")
            await asyncio.sleep(5)

    if in_flight:
        await asyncio.gather(*in_flight, return_exceptions=True)
    logger.info("Document worker stopped")
