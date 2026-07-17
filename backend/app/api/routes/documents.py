import uuid
import secrets
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, get_user_from_token
from app.core.config import settings
from app.core.storage import get_storage
from app.models import (
    Document,
    DocumentDetail,
    DocumentMeta,
    DocumentStatus,
    DocumentsPublic,
    Message,
    ReviewStatus,
)

router = APIRouter(prefix="/documents", tags=["documents"])


def _to_meta(doc: Document) -> DocumentMeta:
    return DocumentMeta.model_validate(doc, from_attributes=True)


def _page_image_paths(doc: Document) -> list[str]:
    if doc.status != "processed" or doc.page_count <= 0:
        return []
    # Serve page images through the backend (see GET /{doc_id}/pages/{page_no})
    # rather than as direct blob URLs, so the storage account can stay private
    # and clients outside the VNet can still load the images.
    return [
        f"{settings.API_V1_STR}/documents/{doc.id}/pages/{i + 1}"
        for i in range(doc.page_count)
    ]


@router.get("/", response_model=DocumentsPublic)
def list_documents(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 200,
) -> Any:
    base_q = select(Document)
    count_q = select(func.count()).select_from(Document)
    if not current_user.is_superuser:
        base_q = base_q.where(Document.owner_id == current_user.id)
        count_q = count_q.where(Document.owner_id == current_user.id)
    count = session.exec(count_q).one()
    docs = session.exec(
        base_q.order_by(col(Document.created_at).desc()).offset(skip).limit(limit)
    ).all()
    return DocumentsPublic(data=[_to_meta(d) for d in docs], count=count)


@router.get("/{doc_id}", response_model=DocumentDetail)
def get_document(
    session: SessionDep, current_user: CurrentUser, doc_id: uuid.UUID
) -> Any:
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not current_user.is_superuser and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    detail = DocumentDetail.model_validate(doc, from_attributes=True)
    detail.page_images = _page_image_paths(doc)
    return detail


@router.post("/upload", response_model=DocumentMeta)
async def upload_document(
    session: SessionDep,
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> Any:
    if file.content_type not in {"application/pdf", "application/x-pdf"} and not (
        file.filename or ""
    ).lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    suffix = ".pdf"
    stored_name = f"{uuid.uuid4().hex}_{secrets.token_hex(4)}{suffix}"

    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)

    try:
        get_storage().save_bytes(
            stored_name, b"".join(chunks), content_type="application/pdf"
        )
    except Exception as e:
        # Surface storage failures (e.g. Azure Blob 403 AuthorizationFailure from
        # a storage-account firewall) as a clean HTTP error so the client gets a
        # meaningful message with CORS headers instead of a raw 500.
        raise HTTPException(
            status_code=502,
            detail=f"Failed to store the file in blob storage: {e}",
        )

    doc = Document(
        original_filename=file.filename or stored_name,
        filename=stored_name,
        file_size=size,
        owner_id=current_user.id,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)
    return _to_meta(doc)


@router.delete("/{doc_id}")
def delete_document(
    session: SessionDep, current_user: CurrentUser, doc_id: uuid.UUID
) -> Message:
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not current_user.is_superuser and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    storage = get_storage()
    storage.delete(doc.filename)
    storage.delete_prefix(f"doc_{doc.id}_pages/")

    session.delete(doc)
    session.commit()
    return Message(message="Document deleted")


class FieldsUpdate(BaseModel):
    key_value_pairs: list[dict[str, Any]] | None = None
    tables: list[dict[str, Any]] | None = None
    bol_kv_fields: list[dict[str, Any]] | None = None
    bol_line_items: list[dict[str, Any]] | None = None


@router.patch("/{doc_id}/fields", response_model=DocumentDetail)
def update_document_fields(
    session: SessionDep,
    current_user: CurrentUser,
    doc_id: uuid.UUID,
    body: FieldsUpdate,
) -> Any:
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not current_user.is_superuser and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if body.key_value_pairs is not None:
        doc.key_value_pairs = body.key_value_pairs
    if body.tables is not None:
        doc.tables = body.tables
    if body.bol_kv_fields is not None:
        doc.bol_kv_fields = body.bol_kv_fields
    if body.bol_line_items is not None:
        doc.bol_line_items = body.bol_line_items
    session.add(doc)
    session.commit()
    session.refresh(doc)
    detail = DocumentDetail.model_validate(doc, from_attributes=True)
    detail.page_images = _page_image_paths(doc)
    return detail


class ReviewUpdate(BaseModel):
    review_status: Literal["approved", "rejected"]
    review_comment: str | None = Field(default=None, max_length=4096)


@router.patch("/{doc_id}/review", response_model=DocumentDetail)
def update_document_review(
    session: SessionDep,
    current_user: CurrentUser,
    doc_id: uuid.UUID,
    body: ReviewUpdate,
) -> Any:
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not current_user.is_superuser and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if doc.status != DocumentStatus.PROCESSED:
        raise HTTPException(
            status_code=400,
            detail="Document must be processed before it can be reviewed",
        )
    if body.review_status == ReviewStatus.REJECTED:
        comment = (body.review_comment or "").strip()
        if not comment:
            raise HTTPException(
                status_code=400,
                detail="A reason is required when rejecting a document",
            )
        doc.review_comment = comment
    else:
        doc.review_comment = (body.review_comment or "").strip() or None
    doc.review_status = body.review_status
    doc.reviewed_at = datetime.now(timezone.utc)
    session.add(doc)
    session.commit()
    session.refresh(doc)
    detail = DocumentDetail.model_validate(doc, from_attributes=True)
    detail.page_images = _page_image_paths(doc)
    return detail


class BolKvField(BaseModel):
    label: str
    value: str | None
    found: bool
    kv_pair_index: int = -1
    judge_corrected: bool = False


class BolFieldsResponse(BaseModel):
    kv_fields: list[BolKvField]
    line_items: list[dict[str, str | None]]


@router.get("/{doc_id}/bol-fields", response_model=BolFieldsResponse)
async def get_bol_fields(
    doc_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> BolFieldsResponse:
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not current_user.is_superuser and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if doc.status != "processed":
        raise HTTPException(status_code=400, detail="Document not yet processed")

    # Fast path: return pre-computed fields stored during processing
    if doc.bol_kv_fields is not None:
        return BolFieldsResponse(
            kv_fields=[BolKvField(**f) for f in doc.bol_kv_fields],
            line_items=doc.bol_line_items or [],
        )

    # Fallback: extract now (old documents processed before this feature),
    # then store the result so subsequent calls are instant.
    import asyncio
    from app.services.bol_extraction import extract_bol_fields

    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None, extract_bol_fields, doc.key_value_pairs or [], doc.tables or []
        )
        doc.bol_kv_fields = result["kv_fields"]
        doc.bol_line_items = result["line_items"]
        session.add(doc)
        session.commit()
        return BolFieldsResponse(
            kv_fields=[BolKvField(**f) for f in result["kv_fields"]],
            line_items=result["line_items"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM extraction failed: {e}")


@router.get("/{doc_id}/file")
def download_pdf(
    session: SessionDep, current_user: CurrentUser, doc_id: uuid.UUID
) -> Response:
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not current_user.is_superuser and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    storage = get_storage()
    if not storage.exists(doc.filename):
        raise HTTPException(status_code=404, detail="File missing from storage")
    data = storage.read_bytes(doc.filename)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{doc.original_filename}"'
        },
    )


@router.get("/{doc_id}/pages/{page_no}")
def get_page_image(
    session: SessionDep,
    doc_id: uuid.UUID,
    page_no: int,
    token: str,
) -> Response:
    # Authenticated via a query-param token: this URL is loaded from an <img>
    # tag, which cannot send an Authorization header.
    current_user = get_user_from_token(session, token)
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not current_user.is_superuser and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if page_no < 1 or page_no > doc.page_count:
        raise HTTPException(status_code=404, detail="Page not found")

    name = f"doc_{doc.id}_pages/page_{page_no}.png"
    storage = get_storage()
    if not storage.exists(name):
        raise HTTPException(status_code=404, detail="Page image missing from storage")
    data = storage.read_bytes(name)
    return Response(
        content=data,
        media_type="image/png",
        # Rendered page images never change once produced, so let the browser
        # cache them and avoid re-fetching on every page turn.
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
