"""BOL field extraction using Azure OpenAI. Shared by the document processor
and the /bol-fields re-extraction endpoint."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

BOL_KV_FIELDS = [
    "Customer Name",
    "Process Mode",
    "Receiving From Address",
    "Freight Carrier Name",
    "Purchase Order Number",
    "Trailer Number",
    "Seal Number",
    "Shipping Document Number",
    "Customer Tracking ID",
]

BOL_TABLE_COLUMNS = [
    "Pallet Number",
    "Customer Pallet Number",
    "Item Id",
    "Dimensions",
    "Package Description",
    "Lot Number",
    "Quantity",
    "Purchase Order Number",
    "Customer Load ID",
    "Customer Item ID",
]

_PROMPT = """You are a BOL (Bill of Lading) data extraction assistant.

Below is all content extracted from a BOL document by Azure Form Recognizer.

Your task:
1. Identify the value for each of the Key Fields listed below. Use ALL three sections
   (full text, key-value pairs, tables) to determine the best match.

   WARNING — KV pair values from Azure Form Recognizer can be wrong. A label like
   "Receiving From Address" may have value "1" because the OCR picked up a nearby form
   field number or checkbox instead of the actual address. Apply this logic:
   - If a KV pair value is implausible for the field type (e.g. a bare digit for an
     address, a single character for a company name), IGNORE that KV pair value.
   - Search the FULL DOCUMENT TEXT for the real value near that label instead.
   - Always prefer a plausible full-text value over an implausible KV pair value.

   If a field is genuinely not present anywhere, return null.

2. Build a Line Item Details table using the Table Columns listed below. Each row should have one
   value per column. If a column is not present in the extracted tables, use null. Only include
   rows that have at least some data.

Return ONLY valid JSON in this exact shape:
{{
  "kv_fields": [
    {{"label": "Customer Name", "value": "...", "found": true}},
    ...
  ],
  "line_items": [
    {{"Pallet Number": "...", "Customer Pallet Number": "...", ...}},
    ...
  ]
}}

Key Fields to find:
{kv_fields}

Field-specific guidance (apply these rules strictly):

- Customer Name: The shipper/sender company name ONLY — no address. If the extracted block
  contains both a company name and an address (e.g. "Cook Vandergrift Inc. 1186 Montgomery Lane
  Vandergrift PA 15690"), extract ONLY the company name ("Cook Vandergrift Inc.") and use the
  address part for Receiving From Address. Aliases: "Shipper", "From", "Consignor", "Ship From".

- Process Mode: Sterilization/treatment method. MUST return EXACTLY one of these canonical values:
  E-Beam, Ethylene Oxide, Gamma, X-ray, VHP — nothing else. If the document says
  "CONTRACT GAMMA STERILIZATION" or "GAMMA" or "Gamma radiation" → return "Gamma".
  "EO" or "Ethylene Oxide" → return "Ethylene Oxide". "EBeam" or "E-Beam" → return "E-Beam".
  Return null if none of the five terms can be found.

- Receiving From Address: Physical street address of the shipper — must contain a street number
  AND street name (e.g. "1186 Montgomery Lane, Vandergrift, PA 15690"). IMPORTANT: the address
  is often in the same block as Customer Name — split it out. A bare number like "1" or "2" is
  NOT a valid address; if that is all that is available, return null.

- Freight Carrier Name: The trucking/transport company. Aliases: "Carrier", "Hauler",
  "Transported By", "Motor Carrier", "SCAC".

- Purchase Order Number: Buyer's PO reference. Aliases: "PO #", "P.O. Number", "Order No.".

- Trailer Number: ID of the truck trailer. Aliases: "Trailer #", "Trailer No.", "Unit #".
  A bare "1" or single digit is NOT a valid trailer number — return null.

- Seal Number: Security seal on the trailer door. Aliases: "Seal #", "Seal No.", "Security Seal".
  A bare single digit is NOT a valid seal number — return null.

- Shipping Document Number: BOL or shipment reference number. IMPORTANT: also scan page headers
  and footers — it is frequently printed there. Must be a meaningful reference (alphanumeric, not
  just "1"). Aliases: "BOL #", "Bill of Lading No.", "Shipment #", "Doc #", "Pro #".

- Customer Tracking ID: Customer's own tracking/reference number. Aliases: "Tracking #",
  "Customer Reference", "Reference No.", "Ref #", "Customer Ref".

Table Columns for line items:
{table_cols}

--- FULL DOCUMENT TEXT (raw OCR) ---
{full_text}

--- EXTRACTED KEY-VALUE PAIRS ---
{kvp}

--- EXTRACTED TABLES ---
{tables}
"""


_JUDGE_PROMPT = """You are a strict BOL data validation judge.

A first-pass AI extracted the Key Fields below. Cross-check EVERY value against the document
and correct any that are wrong, implausible, or missing.

CRITICAL — The first-pass extractor may have been anchored by a bad KV pair from Azure Form
Recognizer. For example "Receiving From Address: 1" happens when OCR grabs a nearby form field
number instead of the actual address. When you see a value that is a bare digit, single character,
or obvious OCR artifact, go directly to the FULL DOCUMENT TEXT and find the correct value there.
Do NOT verify a bad value just because it exists somewhere in the document — it must actually
make sense as the answer to that specific field.

Rules:
1. Each value must actually appear in or be clearly inferable from the document. If a value cannot
   be verified, set it to null and "found": false.

2. PLAUSIBILITY — reject values obviously wrong for the field type:
   - A single digit or single character is NEVER a valid value for any field here.
   - Shipping Document Number "1" → null. Receiving From Address "1" → null.
   - Trailer Number / Seal Number that is just "1" or "2" → null.

3. Customer Name — must be a company/organisation name ONLY, no address appended.
   If the extracted value is "Cook Vandergrift Inc. 1186 Montgomery Lane Vandergrift PA 15690",
   correct it to "Cook Vandergrift Inc." and move the address to Receiving From Address.
   If Customer Name contains a street number or city/state/zip, it is wrong — split it.

4. Receiving From Address — must be a full street address (number + street name at minimum).
   Often found in the same block as Customer Name — extract the address portion from there.
   "1" alone is not an address — go find the real address in the full text.

5. Process Mode — return EXACTLY one of: E-Beam, Ethylene Oxide, Gamma, X-ray, VHP — or null.
   "CONTRACT GAMMA STERILIZATION" → "Gamma". "GAMMA" → "Gamma". "EO" → "Ethylene Oxide".

6. Shipping Document Number — scan page headers and footers; must be alphanumeric, not just "1".

7. If a field was missed by the extractor but IS in the document: provide the correct value.

Return ONLY valid JSON — same fields in the same order:
{{
  "kv_fields": [
    {{"label": "Customer Name", "value": "...", "found": true, "judge_corrected": false}},
    ...
  ]
}}

Set "judge_corrected": true for any field whose value or found-status you changed.

--- FIRST-PASS EXTRACTION (validate this) ---
{draft}

--- FULL DOCUMENT TEXT ---
{full_text}

--- EXTRACTED KEY-VALUE PAIRS ---
{kvp}

--- EXTRACTED TABLES ---
{tables}
"""


def _build_prompt(
    kv_pairs: list[dict[str, Any]],
    tables: list[dict[str, Any]],
    full_text: str = "",
) -> str:
    kvp_text = "\n".join(
        f"  {p['key']['content']}: {p['value']['content']}  (confidence: {p.get('confidence', 0):.0%})"
        for p in kv_pairs
        if p.get("key", {}).get("content")
    ) or "  (none)"

    tables_text_parts: list[str] = []
    for t in tables:
        cells: list[dict[str, Any]] = t.get("cells", [])
        grid: dict[tuple[int, int], str] = {}
        for c in cells:
            grid[(c["row_index"], c["column_index"])] = c.get("content", "")
        rows_text = []
        for r in range(t.get("row_count", 0)):
            row = " | ".join(grid.get((r, c), "") for c in range(t.get("column_count", 0)))
            rows_text.append(f"  {row}")
        tables_text_parts.append(f"Table {t.get('index', 0) + 1}:\n" + "\n".join(rows_text))
    tables_text = "\n\n".join(tables_text_parts) or "  (none)"

    return _PROMPT.format(
        kv_fields="\n".join(f"- {f}" for f in BOL_KV_FIELDS),
        table_cols="\n".join(f"- {c}" for c in BOL_TABLE_COLUMNS),
        full_text=full_text.strip() or "  (none)",
        kvp=kvp_text,
        tables=tables_text,
    )


def _parse_json(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return json.loads(raw)


def _judge_kv_fields(
    draft_fields: list[dict[str, Any]],
    kvp_text: str,
    tables_text: str,
    full_text: str,
    llm: Any,
) -> list[dict[str, Any]]:
    """Run the judge pass on kv_fields only. Returns corrected list."""
    draft_summary = "\n".join(
        f"  {f['label']}: {f['value'] if f.get('found') else '(not found)'}"
        for f in draft_fields
    )
    prompt = _JUDGE_PROMPT.format(
        draft=draft_summary,
        full_text=full_text or "  (none)",
        kvp=kvp_text,
        tables=tables_text,
    )
    raw = llm.invoke(prompt)
    result = _parse_json(raw.content if isinstance(raw.content, str) else str(raw.content))
    corrected = [f["label"] for f in result.get("kv_fields", []) if f.get("judge_corrected")]
    if corrected:
        logger.info("BOL judge corrected fields: %s", ", ".join(corrected))
    else:
        logger.info("BOL judge: all fields verified, no corrections needed")
    return result.get("kv_fields", draft_fields)


_PROCESS_MODE_ALIASES: list[tuple[str, str]] = [
    ("gamma", "Gamma"),
    ("e-beam", "E-Beam"),
    ("ebeam", "E-Beam"),
    ("ethylene oxide", "Ethylene Oxide"),
    ("ethylene", "Ethylene Oxide"),
    ("x-ray", "X-ray"),
    ("xray", "X-ray"),
    ("vhp", "VHP"),
]

# Street-type words that reliably signal the start of a street address
_STREET_PATTERN = re.compile(
    r"(\d+\s+\w[\w\s,]*?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive"
    r"|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Highway|Industrial|Pkwy|Parkway|Park)\b.*)",
    re.IGNORECASE,
)

# Values that are clearly OCR noise — not valid for any meaningful field
_BAD_SINGLE_VALUES: set[str] = {"1", "2", "3", "0", "-", ".", ",", "x", "n/a"}


def _post_process_fields(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deterministic fixes applied after LLM passes.

    1. Split combined Customer Name + Address into separate fields.
    2. Normalise Process Mode to one of the five canonical values.
    3. Null out single-character OCR noise values.
    """
    import re as _re

    # Index by label for easy lookup / mutation
    by_label: dict[str, dict[str, Any]] = {f["label"]: dict(f) for f in fields}

    # ── 1. Split Customer Name + Address ────────────────────────────────────
    cn = by_label.get("Customer Name", {})
    rfa = by_label.get("Receiving From Address", {})
    cn_val: str = (cn.get("value") or "").strip()

    if cn_val:
        m = _STREET_PATTERN.search(cn_val)
        if m:
            address_part = m.group(1).strip()
            company_part = cn_val[: m.start()].strip().rstrip(",")
            if company_part:
                cn["value"] = company_part
                cn["kv_pair_index"] = -1  # synthesised value — no KV pair match
                cn["judge_corrected"] = True
                logger.info("Post-process: split Customer Name → '%s'", company_part)
            # Fill Receiving From Address if it is missing or bad
            rfa_val = (rfa.get("value") or "").strip()
            if not rfa_val or rfa_val in _BAD_SINGLE_VALUES:
                rfa["value"] = address_part
                rfa["found"] = True
                rfa["kv_pair_index"] = -1  # synthesised value — no KV pair match
                rfa["judge_corrected"] = True
                logger.info("Post-process: set Receiving From Address → '%s'", address_part)

    # ── 2. Normalise Process Mode ────────────────────────────────────────────
    pm = by_label.get("Process Mode", {})
    pm_val: str = (pm.get("value") or "").strip()
    if pm_val:
        lower = pm_val.lower()
        for alias, canonical in _PROCESS_MODE_ALIASES:
            if alias in lower:
                if pm_val != canonical:
                    logger.info(
                        "Post-process: Process Mode '%s' → '%s'", pm_val, canonical
                    )
                    pm["value"] = canonical
                    pm["judge_corrected"] = True
                break

    # ── 3. Null out obvious OCR noise ────────────────────────────────────────
    for f in by_label.values():
        v = (f.get("value") or "").strip()
        if v and v.lower() in _BAD_SINGLE_VALUES:
            logger.info(
                "Post-process: nulled bad value '%s' for '%s'", v, f["label"]
            )
            f["value"] = None
            f["found"] = False
            f["judge_corrected"] = True

    return list(by_label.values())


def _find_kv_pair_index(value: str | None, kv_pairs: list[dict[str, Any]]) -> int:
    """Return the index in kv_pairs whose value content best matches `value`, or -1."""
    if not value:
        return -1
    norm = value.strip().lower()
    # Exact match first
    for i, pair in enumerate(kv_pairs):
        if pair.get("value", {}).get("content", "").strip().lower() == norm:
            return i
    # Substring match — both sides must be at least 4 chars to prevent
    # short OCR values like "1" from matching "1186 Montgomery Lane..."
    for i, pair in enumerate(kv_pairs):
        pv = pair.get("value", {}).get("content", "").strip().lower()
        if len(pv) >= 4 and len(norm) >= 4 and (norm in pv or pv in norm):
            return i
    return -1


def extract_bol_fields(
    kv_pairs: list[dict[str, Any]],
    tables: list[dict[str, Any]],
    full_text: str = "",
) -> dict[str, Any]:
    """Call Azure OpenAI synchronously (safe inside a thread-pool executor).

    Returns:
        {
            "kv_fields": [{"label":..., "value":..., "found":..., "kv_pair_index":...}, ...],
            "line_items": [{col: value, ...}, ...]
        }
    """
    from langchain_openai import AzureChatOpenAI
    from app.core.config import settings

    llm = AzureChatOpenAI(
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        azure_deployment=settings.AZURE_OPENAI_DEPLOYMENT,
        api_version=settings.AZURE_OPENAI_API_VERSION,
        api_key=settings.AZURE_OPENAI_API_KEY,  # type: ignore[arg-type]
        temperature=0,
    )

    # Build shared document context strings
    kvp_text = "\n".join(
        f"  {p['key']['content']}: {p['value']['content']}  (confidence: {p.get('confidence', 0):.0%})"
        for p in kv_pairs
        if p.get("key", {}).get("content")
    ) or "  (none)"

    tables_text_parts: list[str] = []
    for t in tables:
        cells: list[dict[str, Any]] = t.get("cells", [])
        grid: dict[tuple[int, int], str] = {}
        for c in cells:
            grid[(c["row_index"], c["column_index"])] = c.get("content", "")
        rows_text = [
            "  " + " | ".join(grid.get((r, c), "") for c in range(t.get("column_count", 0)))
            for r in range(t.get("row_count", 0))
        ]
        tables_text_parts.append(f"Table {t.get('index', 0) + 1}:\n" + "\n".join(rows_text))
    tables_text = "\n\n".join(tables_text_parts) or "  (none)"
    clean_full_text = full_text.strip() or "  (none)"

    # ── Pass 1: Extract all fields + line items ──────────────────────────────
    logger.info("BOL extraction: pass 1 — extractor")
    extract_prompt = _build_prompt(kv_pairs, tables, full_text)
    raw1 = llm.invoke(extract_prompt)
    draft = _parse_json(raw1.content if isinstance(raw1.content, str) else str(raw1.content))
    logger.info(
        "BOL extractor: %d/%d key fields found, %d line items",
        sum(1 for f in draft.get("kv_fields", []) if f.get("found")),
        len(BOL_KV_FIELDS),
        len(draft.get("line_items", [])),
    )

    # ── Pass 2: Judge — fields of interest only, line items kept as-is ───────
    logger.info("BOL extraction: pass 2 — judge (fields of interest only)")
    judged_fields = _judge_kv_fields(
        draft.get("kv_fields", []),
        kvp_text,
        tables_text,
        clean_full_text,
        llm,
    )

    # ── Pass 3: Deterministic post-processing ───────────────────────────────
    judged_fields = _post_process_fields(judged_fields)

    # ── Index matched KV pairs for rubber-band highlighting ──────────────────
    kv_fields: list[dict[str, Any]] = []
    for f in judged_fields:
        idx = _find_kv_pair_index(f.get("value"), kv_pairs)
        kv_fields.append(
            {
                "label": f.get("label", ""),
                "value": f.get("value"),
                "found": bool(f.get("found", False)),
                "kv_pair_index": idx,
                "judge_corrected": bool(f.get("judge_corrected", False)),
            }
        )

    return {
        "kv_fields": kv_fields,
        "line_items": draft.get("line_items", []),
    }
