"""Usage & cost metering (superuser only).

Aggregates billable usage across the two paid services the platform relies on:

  • Document Intelligence — billed per analysed page (we store ``page_count``).
  • AI usage — billed per input / output token, captured from every document
    extraction and chatbot reply.

Costs are estimated with the rate card in ``settings`` (env-overridable). Only
records that carry tracked token usage are included, so documents processed
before metering existed are excluded.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import col, select

from app.api.deps import SessionDep, get_current_active_superuser
from app.core.config import settings
from app.models import ChatMessage, ChatSession, Document, DocumentStatus

router = APIRouter(prefix="/metering", tags=["metering"])


class MeteringRates(BaseModel):
    currency: str
    as_of: str
    doc_intelligence_per_1k_pages: float
    ai_input_per_1m_tokens: float
    ai_output_per_1m_tokens: float


class MeteringRecord(BaseModel):
    date: datetime | None
    kind: str  # "document" | "chat"
    label: str
    pages: int
    input_tokens: int
    output_tokens: int
    di_cost: float
    ai_cost: float
    cost: float


class MeteringSummary(BaseModel):
    rates: MeteringRates
    records: list[MeteringRecord]


def _di_cost(pages: int) -> float:
    return pages * settings.RATE_DOC_INTELLIGENCE_PER_1K_PAGES / 1000.0


def _ai_cost(input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens * settings.RATE_AI_INPUT_PER_1M_TOKENS / 1_000_000.0
        + output_tokens * settings.RATE_AI_OUTPUT_PER_1M_TOKENS / 1_000_000.0
    )


@router.get(
    "/summary",
    response_model=MeteringSummary,
    dependencies=[Depends(get_current_active_superuser)],
)
def metering_summary(session: SessionDep) -> Any:
    records: list[MeteringRecord] = []

    # ── Documents: Document Intelligence (pages) + AI extraction (tokens) ─────
    docs = session.exec(
        select(Document)
        .where(Document.status == DocumentStatus.PROCESSED)
        .where(col(Document.ai_input_tokens).is_not(None))
    ).all()
    for d in docs:
        pages = d.page_count or 0
        in_tok = d.ai_input_tokens or 0
        out_tok = d.ai_output_tokens or 0
        di = _di_cost(pages)
        ai = _ai_cost(in_tok, out_tok)
        records.append(
            MeteringRecord(
                date=d.processed_at or d.created_at,
                kind="document",
                label=d.original_filename,
                pages=pages,
                input_tokens=in_tok,
                output_tokens=out_tok,
                di_cost=round(di, 6),
                ai_cost=round(ai, 6),
                cost=round(di + ai, 6),
            )
        )

    # ── Chat: AI usage only (both the global and per-document chatbots) ───────
    chat_rows = session.exec(
        select(ChatMessage, ChatSession.title)
        .join(ChatSession, col(ChatMessage.session_id) == col(ChatSession.id))
        .where(col(ChatMessage.ai_input_tokens).is_not(None))
    ).all()
    for msg, title in chat_rows:
        in_tok = msg.ai_input_tokens or 0
        out_tok = msg.ai_output_tokens or 0
        ai = _ai_cost(in_tok, out_tok)
        records.append(
            MeteringRecord(
                date=msg.created_at,
                kind="chat",
                label=title or "Untitled chat",
                pages=0,
                input_tokens=in_tok,
                output_tokens=out_tok,
                di_cost=0.0,
                ai_cost=round(ai, 6),
                cost=round(ai, 6),
            )
        )

    rates = MeteringRates(
        currency=settings.METERING_CURRENCY,
        as_of=settings.METERING_RATES_AS_OF,
        doc_intelligence_per_1k_pages=settings.RATE_DOC_INTELLIGENCE_PER_1K_PAGES,
        ai_input_per_1m_tokens=settings.RATE_AI_INPUT_PER_1M_TOKENS,
        ai_output_per_1m_tokens=settings.RATE_AI_OUTPUT_PER_1M_TOKENS,
    )
    return MeteringSummary(rates=rates, records=records)
