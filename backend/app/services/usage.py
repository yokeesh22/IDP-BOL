"""Helpers for reading LLM token usage off LangChain messages.

Used by the document-extraction and chat services to record how many input /
output tokens each Azure OpenAI call consumed, which feeds the metering page.
"""
from __future__ import annotations

from typing import Any


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
