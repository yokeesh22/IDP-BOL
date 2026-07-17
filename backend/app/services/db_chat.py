import json
import re
from typing import Annotated, Any

from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import AzureChatOpenAI
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from sqlalchemy import inspect, text
from sqlmodel import Session
from typing_extensions import TypedDict

from app.core.config import settings
from app.core.db import engine
from app.services.usage import sum_usage

SYSTEM_PROMPT = """You are BOL Agent — an assistant for the Document Intelligence platform.
Your job is to answer questions about BOL documents and data using the tools provided.

━━━ WHAT YOU CAN ANSWER ━━━

Answer any question about:
  • BOL documents — list, search, filter by status/date/owner
  • Extracted fields and tables from documents
  • Document counts, stats, processing status, review status
  • User accounts in this platform (read-only)

Always call a tool first. Never make up data.

━━━ GUARDRAIL ━━━

Only refuse questions that are entirely unrelated to documents or this platform
(e.g. general knowledge, coding help, weather, personal advice).
For those only, respond: "I can only help with BOL documents and data in this system."

Do NOT refuse BOL-related questions even if phrased informally or vaguely.
If a question is ambiguous, assume it is about BOL data and try to answer it.

━━━ DATABASE SCHEMA ━━━

TABLE: user
  id, email, full_name, is_active, is_superuser, created_at

TABLE: document
  id, filename, original_filename, file_size, status, page_count,
  key_value_pairs (JSON), tables (JSON), error_message,
  created_at, processed_at, review_status, review_comment, reviewed_at, owner_id

  status values: pending | processing | processed | error
  review_status values: approved | rejected | null

━━━ EXTRACTED DATA STRUCTURE ━━━

key_value_pairs — fields extracted from the BOL document:
  Each entry: { key: {content}, value: {content}, confidence: 0.0–1.0 }
  Example: { key: "Shipper", value: "ACME Corp", confidence: 0.98 }

tables — tables extracted from the BOL document:
  Each entry: { index, row_count, column_count, cells: [{row_index, column_index, content, kind}] }
  kind values: content | columnHeader | rowHeader

━━━ TOOL USAGE ━━━

Use these tools in order of preference:
1. get_document_fields — when asked about extracted fields, specific field values, or document content
2. get_document_tables — when asked about tabular data extracted from a document
3. run_sql_query — for counts, filters, stats, or anything needing SQL
4. list_tables / describe_table — only to explore schema

━━━ RESPONSE FORMAT ━━━

Format ALL responses in Markdown. The UI renders markdown — use it fully.

**For BOL document fields — group under headings:**
## Shipment Info
| Field | Value | Confidence |
|-------|-------|------------|
| Shipper | ACME Corp | 98% |
| Consignee | XYZ Ltd | 95% |

## Cargo Details
| Field | Value | Confidence |
|-------|-------|------------|
| Description | Steel Coils | 97% |
| Weight | 12,000 kg | 96% |

**For document lists:**
- **filename.pdf** — `processed` · 2024-01-15
- **other.pdf** — `pending` · 2024-01-14

**For counts and stats — bold the key number:**
There are **12** processed documents, **3** pending, and **1** with errors.

**For table data extracted from a document:**
Use a markdown table. If more than 15 rows, show first 10 and note the total.

**For a single field lookup:**
> **Invoice Number:** INV-2024-001 *(confidence: 98%)*

**Rules:**
- NEVER use pipe-separated plain text (col | col | col) outside a markdown table
- NEVER use raw ASCII grids or dashes as separators
- Use `inline code` for IDs, filenames, and status values
- If a field is missing or empty, write: *Not found* in italics
- Keep responses concise — no filler phrases like "Sure!" or "Of course!"
- Always be precise"""


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


class DocumentAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    system_prompt: str  # pre-built per-document prompt, injected before graph runs


def _normalize_id(document_id: str) -> str:
    """Format a UUID string for the active database dialect.

    SQLite stores UUIDs as 32 hex chars without hyphens, whereas SQL Server's
    UNIQUEIDENTIFIER expects the standard hyphenated form.
    """
    if engine.dialect.name == "sqlite":
        return document_id.replace("-", "").lower()
    return str(document_id)


@tool
def list_tables() -> list[str]:
    """List all tables in the database."""
    inspector = inspect(engine)
    return inspector.get_table_names()


@tool
def describe_table(table_name: str) -> str:
    """Get column names and types for a specific table."""
    inspector = inspect(engine)
    try:
        columns = inspector.get_columns(table_name)
        return "\n".join(f"{col['name']} ({col['type']})" for col in columns)
    except Exception as e:
        return f"Error: {e}"


@tool
def run_sql_query(query: str) -> str:
    """Execute a read-only SQL SELECT query. Good for counts, filters, and stats.
    Do NOT use this to read key_value_pairs or tables columns — use get_document_fields / get_document_tables instead."""
    stripped = query.strip()
    upper = stripped.upper()

    if not upper.lstrip().startswith("SELECT"):
        return "Error: Only SELECT queries are allowed."

    forbidden = ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE", "ATTACH", "DETACH"]
    for kw in forbidden:
        if re.search(rf"\b{kw}\b", upper):
            return f"Error: Query contains forbidden keyword: {kw}"

    try:
        with Session(engine) as session:
            result = session.execute(text(stripped))
            rows = result.fetchmany(100)
            if not rows:
                return "No results found."
            cols = list(result.keys())
            lines = ["\t".join(cols)]
            for row in rows:
                lines.append("\t".join(str(v) if v is not None else "NULL" for v in row))
            return "\n".join(lines)
    except Exception as e:
        return f"Query error: {e}"


@tool
def get_document_fields(document_id: str) -> str:
    """Get all key-value fields extracted from a specific document.
    Use this whenever asked about document content, extracted fields, or specific field values."""
    try:
        with Session(engine) as session:
            row = session.execute(
                text("SELECT original_filename, key_value_pairs FROM document WHERE id = :id"),
                {"id": _normalize_id(document_id)},
            ).fetchone()
        if not row:
            return "Document not found."

        filename, raw = row
        pairs: list[dict[str, Any]] = json.loads(raw) if isinstance(raw, str) else (raw or [])

        if not pairs:
            return f"No fields were extracted from '{filename}'."

        lines = [f"Extracted fields from: {filename}\n"]
        for p in pairs:
            key = p.get("key", {}).get("content", "").strip()
            value = p.get("value", {}).get("content", "").strip()
            confidence = p.get("confidence", 0.0)
            if key:
                conf_str = f"  ({confidence:.0%})" if confidence else ""
                lines.append(f"  {key}: {value or '—'}{conf_str}")

        return "\n".join(lines)
    except Exception as e:
        return f"Error retrieving fields: {e}"


@tool
def get_document_tables(document_id: str) -> str:
    """Get all tables extracted from a specific document.
    Use this when asked about tabular data, rows, or columns inside a document."""
    try:
        with Session(engine) as session:
            row = session.execute(
                text("SELECT original_filename, tables FROM document WHERE id = :id"),
                {"id": _normalize_id(document_id)},
            ).fetchone()
        if not row:
            return "Document not found."

        filename, raw = row
        tables: list[dict[str, Any]] = json.loads(raw) if isinstance(raw, str) else (raw or [])

        if not tables:
            return f"No tables were extracted from '{filename}'."

        output: list[str] = [f"Tables extracted from: {filename}\n"]
        for table in tables:
            n_rows = table.get("row_count", 0)
            n_cols = table.get("column_count", 0)
            cells: list[dict[str, Any]] = table.get("cells", [])
            output.append(f"Table {table.get('index', 0) + 1}  ({n_rows} rows × {n_cols} columns)")

            # Build grid
            grid: dict[tuple[int, int], str] = {}
            header_rows: set[int] = set()
            for cell in cells:
                r, c = cell.get("row_index", 0), cell.get("column_index", 0)
                grid[(r, c)] = cell.get("content", "")
                if cell.get("kind") in ("columnHeader", "rowHeader", "stubHead"):
                    header_rows.add(r)

            # Compute column widths
            col_widths = [
                max(len(grid.get((r, c), "")) for r in range(n_rows)) + 2
                for c in range(n_cols)
            ]

            for r in range(n_rows):
                row_cells = [grid.get((r, c), "").ljust(col_widths[c]) for c in range(n_cols)]
                output.append("  " + " | ".join(row_cells).rstrip())
                if r in header_rows:
                    output.append("  " + "-+-".join("-" * w for w in col_widths))

            output.append("")

        return "\n".join(output)
    except Exception as e:
        return f"Error retrieving tables: {e}"


TOOLS = [list_tables, describe_table, run_sql_query, get_document_fields, get_document_tables]

_graph: Any = None


def _build_graph() -> Any:
    llm = AzureChatOpenAI(
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        azure_deployment=settings.AZURE_OPENAI_DEPLOYMENT,
        api_version=settings.AZURE_OPENAI_API_VERSION,
        api_key=settings.AZURE_OPENAI_API_KEY,  # type: ignore[arg-type]
        temperature=0,
    ).bind_tools(TOOLS)

    tool_node = ToolNode(TOOLS)

    def agent(state: AgentState) -> AgentState:
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
        response = llm.invoke(messages)
        return {"messages": [response]}

    def should_continue(state: AgentState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent)
    graph.add_node("tools", tool_node)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")
    return graph.compile()


def _get_graph() -> Any:
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


async def invoke_chat(messages: list[BaseMessage]) -> tuple[str, tuple[int, int]]:
    """Return (reply_text, (input_tokens, output_tokens)).

    Token usage is summed across every model turn in the agent run (the initial
    call plus any tool-calling follow-ups).
    """
    graph = _get_graph()
    result = await graph.ainvoke({"messages": messages})
    all_messages = result["messages"]
    last = all_messages[-1]
    text = last.content if isinstance(last.content, str) else str(last.content)
    return text, sum_usage(all_messages)


def _fetch_document_context(document_id: str) -> dict[str, Any]:
    """Load all extracted document data from DB in one shot."""
    try:
        with Session(engine) as session:
            row = session.execute(
                text(
                    "SELECT original_filename, status, page_count, review_status, "
                    "file_size, created_at, processed_at, review_comment, "
                    "key_value_pairs, tables "
                    "FROM document WHERE id = :id"
                ),
                {"id": _normalize_id(document_id)},
            ).fetchone()
    except Exception:
        row = None

    if not row:
        return {}

    (
        filename, status, page_count, review_status, file_size,
        created_at, processed_at, review_comment, raw_kvp, raw_tables,
    ) = row

    pairs: list[dict[str, Any]] = json.loads(raw_kvp) if isinstance(raw_kvp, str) else (raw_kvp or [])
    tables: list[dict[str, Any]] = json.loads(raw_tables) if isinstance(raw_tables, str) else (raw_tables or [])

    return {
        "filename": filename,
        "status": status,
        "page_count": page_count,
        "review_status": review_status,
        "review_comment": review_comment,
        "file_size": file_size,
        "created_at": str(created_at) if created_at else None,
        "processed_at": str(processed_at) if processed_at else None,
        "pairs": pairs,
        "tables": tables,
    }


def _build_document_system_prompt(document_id: str) -> str:
    """Build a document-scoped prompt. Metadata included; tools called for fields/tables."""
    ctx = _fetch_document_context(document_id)

    if not ctx:
        meta = f"  Document ID : {document_id}\n  (document not found or not yet processed)"
    else:
        meta = (
            f"  Filename      : {ctx['filename']}\n"
            f"  Document ID   : {document_id}\n"
            f"  Status        : {ctx['status']}\n"
            f"  Pages         : {ctx['page_count']}\n"
            f"  File size     : {ctx['file_size']} bytes\n"
            f"  Processed at  : {ctx['processed_at'] or 'not yet'}\n"
            f"  Review status : {ctx['review_status'] or 'not reviewed'}\n"
            f"  Review comment: {ctx['review_comment'] or '—'}"
        )

    return f"""You are BOL Agent, an assistant for a single BOL document.

━━━ DOCUMENT ━━━

{meta}

━━━ HOW TO ANSWER ━━━

ALWAYS call a tool to get real data. Never say a field is missing without calling a tool first.

For ANY question about fields or field values (invoice number, shipper, consignee, etc.):
  → Call get_document_fields with document_id = "{document_id}"
  → Search the returned fields and respond with what you find.

For ANY question about tables or rows:
  → Call get_document_tables with document_id = "{document_id}"

For metadata questions (status, dates, page count):
  → The metadata above is sufficient, no tool needed.

If a tool returns data and the specific field is not in it, only then say it was not found.
Only refuse completely off-topic questions (coding, weather, etc.).

━━━ RESPONSE FORMAT ━━━

Format ALL responses in Markdown.

Single field lookup:
> **Field Name:** value *(confidence: 98%)*

Multiple fields:
| Field | Value | Confidence |
|-------|-------|------------|
| Shipper | ACME Corp | 98% |

Table data — render as markdown table with column headers.
Be concise. No filler phrases."""


_doc_graph: Any = None


def _get_document_graph() -> Any:
    """Cached document graph — system prompt passed through state, rebuilt fresh each call."""
    global _doc_graph
    if _doc_graph is None:
        llm = AzureChatOpenAI(
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            azure_deployment=settings.AZURE_OPENAI_DEPLOYMENT,
            api_version=settings.AZURE_OPENAI_API_VERSION,
            api_key=settings.AZURE_OPENAI_API_KEY,  # type: ignore[arg-type]
            temperature=0,
        ).bind_tools([get_document_fields, get_document_tables, run_sql_query])

        tool_node = ToolNode([get_document_fields, get_document_tables, run_sql_query])

        def agent(state: DocumentAgentState) -> dict[str, Any]:
            prompt = state["system_prompt"]
            messages = [SystemMessage(content=prompt)] + list(state["messages"])
            response = llm.invoke(messages)
            return {"messages": [response]}

        def should_continue(state: DocumentAgentState) -> str:
            last = state["messages"][-1]
            if hasattr(last, "tool_calls") and last.tool_calls:
                return "tools"
            return END

        graph = StateGraph(DocumentAgentState)
        graph.add_node("agent", agent)
        graph.add_node("tools", tool_node)
        graph.set_entry_point("agent")
        graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
        graph.add_edge("tools", "agent")
        _doc_graph = graph.compile()

    return _doc_graph


async def invoke_document_chat(
    document_id: str, messages: list[BaseMessage]
) -> tuple[str, tuple[int, int]]:
    """Return (reply_text, (input_tokens, output_tokens)) for a document chat."""
    graph = _get_document_graph()
    fresh_prompt = _build_document_system_prompt(document_id)
    result = await graph.ainvoke({"messages": messages, "system_prompt": fresh_prompt})
    all_messages = result["messages"]
    last = all_messages[-1]
    text = last.content if isinstance(last.content, str) else str(last.content)
    return text, sum_usage(all_messages)
