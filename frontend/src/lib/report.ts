import * as XLSX from "xlsx"

// Shared helpers for the client-side "Download report" feature. Reports are
// built entirely in the browser from data already loaded by the page (no extra
// backend endpoints), then written out as a single .xlsx workbook.

export type Cell = string | number | null | undefined

export interface SheetSpec {
  /** Sheet/tab name. Excel caps this at 31 chars — longer names are trimmed. */
  name: string
  /** Rows as an array-of-arrays; the first row is treated as the header. */
  rows: Cell[][]
}

/** Parse an API timestamp as UTC even when it lacks an explicit offset. */
export function parseUtc(iso: string): Date {
  return new Date(
    iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`,
  )
}

export interface ResolvedRange {
  /** Inclusive lower bound, or null for "no lower bound". */
  from: Date | null
  /** Inclusive upper bound, or null for "no upper bound". */
  to: Date | null
  /** Human-readable label used in filenames and the summary sheet. */
  label: string
}

/** True when `iso` falls within [from, to] (nulls mean unbounded). */
export function inRange(
  iso: string | null | undefined,
  range: ResolvedRange,
): boolean {
  if (range.from === null && range.to === null) return true
  if (!iso) return false
  const t = parseUtc(iso).getTime()
  if (range.from && t < range.from.getTime()) return false
  if (range.to && t > range.to.getTime()) return false
  return true
}

/** Slug used inside downloaded filenames, e.g. "last-30-days". */
export function rangeSlug(range: ResolvedRange): string {
  return range.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Auto-size worksheet columns from their content for a readable file. */
function autoWidth(rows: Cell[][]): { wch: number }[] {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = cell === null || cell === undefined ? 0 : String(cell).length
      widths[i] = Math.max(widths[i] ?? 10, Math.min(len + 2, 60))
    })
  }
  return widths.map((wch) => ({ wch }))
}

/** Build and trigger download of a multi-sheet .xlsx workbook. */
export function downloadWorkbook(filename: string, sheets: SheetSpec[]): void {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows)
    ws["!cols"] = autoWidth(sheet.rows)
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}
