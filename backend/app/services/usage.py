"""Helpers for reading LLM token usage off LangChain messages.

Used by the document-extraction and chat services to record how many input /
output tokens each Azure OpenAI call consumed, which feeds the metering page.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, col, func, select

from app.models import Document, UsageKind, UsageRecord


def usage_from_message(message: Any) -> tuple[int, int]:
    """Return (input_tokens, output_tokens) for a single LangChain message.

    Falls back to 0 when usage metadata is unavailable. Handles both the
    ``usage_metadata`` attribute (preferred) and the legacy
    ``response_metadata['token_usage']`` shape.
    """
    meta = getattr(message, "usage_metadata", None)
    if isinstance(meta, dict):
        return int(meta.get("input_tokens", 0) or 0), int(
            meta.get("output_tokens", 0) or 0
        )

    resp_meta = getattr(message, "response_metadata", None)
    if isinstance(resp_meta, dict):
        token_usage = resp_meta.get("token_usage") or resp_meta.get("usage") or {}
        if isinstance(token_usage, dict):
            return int(token_usage.get("prompt_tokens", 0) or 0), int(
                token_usage.get("completion_tokens", 0) or 0
            )
    return 0, 0


def sum_usage(messages: list[Any]) -> tuple[int, int]:
    """Sum (input_tokens, output_tokens) across a list of messages."""
    total_in = 0
    total_out = 0
    for m in messages:
        i, o = usage_from_message(m)
        total_in += i
        total_out += o
    return total_in, total_out


def record_document_usage(session: Session, doc: Document) -> None:
    """Append a persistent usage-ledger row for a processed document.

    Idempotent per document: if a ledger row already exists for this document we
    do nothing, so the main processing path and the lazy BOL-fields fallback
    can't double-count the same extraction.
    """
    exists = session.exec(
        select(func.count())
        .select_from(UsageRecord)
        .where(col(UsageRecord.document_id) == doc.id)
        .where(col(UsageRecord.kind) == UsageKind.DOCUMENT)
    ).one()
    if exists:
        return
    session.add(
        UsageRecord(
            kind=UsageKind.DOCUMENT,
            label=doc.original_filename,
            document_id=doc.id,
            user_id=doc.owner_id,
            pages=doc.page_count or 0,
            input_tokens=doc.ai_input_tokens or 0,
            output_tokens=doc.ai_output_tokens or 0,
            created_at=doc.processed_at,
        )
    )


def record_chat_usage(
    session: Session,
    *,
    label: str | None,
    document_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Append a persistent usage-ledger row for one assistant chat reply."""
    session.add(
        UsageRecord(
            kind=UsageKind.CHAT,
            label=label or "Untitled chat",
            document_id=document_id,
            user_id=user_id,
            pages=0,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    )
