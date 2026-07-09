import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Loader2, Pencil, RefreshCw, Star, Table2 } from "lucide-react"
import { useMemo } from "react"
import {
  type BolKvField,
  type ExtractedTable,
  type KVPair,
  type TableCell,
  fetchBolFields,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type HighlightCheck =
  | { type: "kv"; pairIndex: number; field: "key" | "value" }
  | { type: "cell"; tableIndex: number; row: number; col: number }
  | null

type BolEditTarget =
  | { kind: "kv-value"; pairIndex: number; current: string }
  | { kind: "cell"; tableIndex: number; row: number; col: number; current: string }
  | { kind: "bol-not-found"; bolFieldIndex: number; label: string; current: string }

const BOL_COLS = "38% 38% 9% 9% 6%"

function confColor(c: number) {
  if (c >= 0.7) return "#16a34a"
  if (c >= 0.5) return "#d97706"
  return "#dc2626"
}

function matchTableCell(
  value: string | null,
  tables: ExtractedTable[],
): { tableIndex: number; cell: TableCell } | null {
  if (!value) return null
  const norm = value.trim().toLowerCase()
  for (const table of tables) {
    for (const cell of table.cells) {
      if (cell.kind !== "columnHeader" && cell.content.trim().toLowerCase() === norm) {
        return { tableIndex: table.index, cell }
      }
    }
  }
  return null
}

export function BolFieldsPanel({
  docId,
  bolKvFields,
  bolLineItems,
  kvPairs,
  tables,
  highlight,
  onClickField,
  onClickCell,
  onEdit,
}: {
  docId: string
  bolKvFields: BolKvField[] | null
  bolLineItems: Record<string, string | null>[] | null
  kvPairs: KVPair[]
  tables: ExtractedTable[]
  highlight: HighlightCheck
  onClickField: (pair: KVPair, pairIndex: number, field: "key" | "value") => void
  onClickCell: (tableIndex: number, cell: TableCell) => void
  onEdit: (t: BolEditTarget) => void
}) {
  const queryClient = useQueryClient()

  // Only used as fallback for old documents (bolKvFields === null)
  const fallbackQuery = useQuery({
    queryKey: ["bol-fields", docId],
    queryFn: () => fetchBolFields(docId),
    enabled: bolKvFields === null,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const kvFields: BolKvField[] | null =
    bolKvFields ??
    (fallbackQuery.data
      ? fallbackQuery.data.kv_fields
      : null)

  const lineItems: Record<string, string | null>[] =
    bolLineItems ??
    fallbackQuery.data?.line_items ??
    []

  const lineItemMatches = useMemo(
    () => lineItems.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([col, val]) => [col, matchTableCell(val, tables)]),
      ),
    ),
    [lineItems, tables],
  )

  const isLoading = bolKvFields === null && fallbackQuery.isLoading
  const hasError = bolKvFields === null && !!fallbackQuery.error && !kvFields

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-2.5 h-7 w-7 animate-spin text-primary" />
          <p className="text-sm font-medium">Extracting fields with AI…</p>
          <p className="mt-1 text-xs text-muted-foreground">This may take a few seconds</p>
        </div>
      </div>
    )
  }

  // ── Error ──
  if (hasError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-2.5 h-8 w-8 text-destructive/70" />
          <p className="mb-1 text-sm font-medium">Extraction failed</p>
          <p className="mb-4 text-xs text-muted-foreground">
            {fallbackQuery.error instanceof Error
              ? fallbackQuery.error.message
              : "Unknown error"}
          </p>
          <button
            type="button"
            onClick={() => fallbackQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary"
          >
            <RefreshCw className="h-3 w-3" />
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!kvFields) return null

  const foundCount = kvFields.filter((f) => f.found && f.value).length
  const columns = lineItems.length > 0 ? Object.keys(lineItems[0]) : []

  const handleReextract = async () => {
    await queryClient.invalidateQueries({ queryKey: ["bol-fields", docId] })
    fallbackQuery.refetch()
  }

  return (
    <div className="kv-scroll min-h-0 flex-1 overflow-y-auto">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2.5">
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Fields of interest
        </span>
        <span
          className="rounded-full border bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
          style={{ fontFamily: '"DM Mono", monospace' }}
        >
          {foundCount} / {kvFields.length} found
        </span>
        {bolKvFields === null && (
          <button
            type="button"
            onClick={handleReextract}
            disabled={fallbackQuery.isFetching}
            title="Re-extract"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${fallbackQuery.isFetching ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        {/* ── Key Fields ── */}
        <div className="overflow-hidden rounded-[13px] border bg-card shadow-sm">
          <div className="flex items-center gap-2.5 border-b bg-secondary px-4 py-2.5">
            <Star className="h-3.5 w-3.5 text-primary" />
            <span className="flex-1 text-[13px] font-semibold">Key Fields</span>
          </div>

          {/* Column headers */}
          <div
            className="sticky top-0 z-10 grid border-b bg-secondary px-4 py-1.5"
            style={{ gridTemplateColumns: BOL_COLS }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Field</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Value</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Conf.</span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Page</span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Edit</span>
          </div>

          <div className="divide-y">
            {kvFields.map((field, fi) => {
              const idx = field.kv_pair_index
              // Use live kvPair value so edits made in Key-Value tab are reflected here
              const matchedPair = idx >= 0 ? kvPairs[idx] : null
              const displayValue = matchedPair
                ? matchedPair.value.content
                : field.value
              const conf = matchedPair?.confidence ?? 0
              const pageNum = matchedPair?.value.bounding_regions?.[0]?.page_number
              const canHighlight =
                matchedPair !== null &&
                (matchedPair.value.bounding_regions?.length ?? 0) > 0
              const isActive =
                highlight?.type === "kv" &&
                matchedPair !== null &&
                highlight.pairIndex === idx &&
                highlight.field === "value"

              return (
                <div
                  key={field.label}
                  data-kv-active={isActive ? "true" : undefined}
                  className={cn(
                    "group grid items-center border-b px-4 transition-colors last:border-b-0",
                    !isActive && canHighlight && "hover:bg-[#f4f8fd]",
                    isActive && conf >= 0.7 && "bg-green-50",
                    isActive && conf >= 0.5 && conf < 0.7 && "bg-amber-50",
                    isActive && conf < 0.5 && conf > 0 && "bg-red-50",
                    isActive && !matchedPair && "bg-blue-50",
                  )}
                  style={{ gridTemplateColumns: BOL_COLS, minHeight: 44 }}
                >
                  {/* Label — with judge-corrected badge */}
                  <span className="flex items-center gap-1.5 truncate py-2 pr-3">
                    <span className="truncate text-[12.5px] font-medium text-foreground">
                      {field.label}
                    </span>
                    {field.judge_corrected && (
                      <span
                        title="Value was auto-corrected by the validation pass"
                        className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                        style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}
                      >
                        fixed
                      </span>
                    )}
                  </span>

                  {/* Value — clickable if bounding region exists */}
                  {displayValue ? (
                    <button
                      type="button"
                      disabled={!canHighlight}
                      onClick={() =>
                        matchedPair && onClickField(matchedPair, idx, "value")
                      }
                      className={cn(
                        "truncate py-2 pr-3 text-left text-[12.5px] transition-colors",
                        canHighlight
                          ? isActive
                            ? "text-primary"
                            : "cursor-pointer text-muted-foreground hover:text-primary"
                          : "cursor-default text-muted-foreground",
                      )}
                      style={{ fontFamily: '"DM Mono", monospace' }}
                    >
                      {displayValue}
                    </button>
                  ) : (
                    <span className="py-2 text-[12.5px] italic text-muted-foreground/50">
                      Not found
                    </span>
                  )}

                  {/* Confidence dot */}
                  <span className="flex items-center pl-1">
                    {matchedPair ? (
                      <span
                        className="h-[10px] w-[10px] shrink-0 rounded-full"
                        style={{ background: confColor(conf) }}
                        title={`${(conf * 100).toFixed(0)}%`}
                      />
                    ) : (
                      <span className="h-[10px] w-[10px] shrink-0 rounded-full bg-border" />
                    )}
                  </span>

                  {/* Page badge */}
                  <span className="text-center">
                    {pageNum !== undefined ? (
                      <span
                        className="inline-block rounded border bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground"
                        style={{ fontFamily: '"DM Mono", monospace' }}
                      >
                        p.{pageNum}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/30">—</span>
                    )}
                  </span>

                  {/* Edit pencil — always shown; matched fields edit the KV pair, unmatched create a new one */}
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() =>
                        matchedPair
                          ? onEdit({ kind: "kv-value", pairIndex: idx, current: matchedPair.value.content })
                          : onEdit({ kind: "bol-not-found", bolFieldIndex: fi, label: field.label, current: field.value ?? "" })
                      }
                      title={matchedPair ? "Edit value" : "Fill in missing value"}
                      className="rounded border bg-card p-1 text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-primary"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Line Item Details ── */}
        <div className="overflow-hidden rounded-[13px] border bg-card shadow-sm">
          <div className="flex items-center gap-2.5 border-b bg-secondary px-4 py-2.5">
            <Table2 className="h-3.5 w-3.5 text-primary" />
            <span className="flex-1 text-[13px] font-semibold">Line Item Details</span>
            {lineItems.length > 0 && (
              <span
                className="rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                style={{ fontFamily: '"DM Mono", monospace' }}
              >
                {lineItems.length} rows
              </span>
            )}
          </div>

          {lineItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm italic text-muted-foreground">
              No line items found
            </div>
          ) : (
            <div className="kv-scroll overflow-x-auto">
              <table className="min-w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b bg-secondary">
                    {columns.map((col) => (
                      <th
                        key={col}
                        className="whitespace-nowrap border-r px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground last:border-r-0"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((row, ri) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable row list
                    <tr key={ri} className="group border-b last:border-b-0">
                      {columns.map((col) => {
                        const val = row[col]
                        const cellMatch = lineItemMatches[ri]?.[col] ?? null
                        const canClick =
                          !!cellMatch && (cellMatch.cell.bounding_regions?.length ?? 0) > 0
                        const isActive =
                          cellMatch !== null &&
                          highlight?.type === "cell" &&
                          highlight.tableIndex === cellMatch.tableIndex &&
                          highlight.row === cellMatch.cell.row_index &&
                          highlight.col === cellMatch.cell.column_index

                        return (
                          <td
                            key={col}
                            data-cell-active={isActive ? "true" : undefined}
                            onClick={() =>
                              canClick && onClickCell(cellMatch.tableIndex, cellMatch.cell)
                            }
                            onDoubleClick={() =>
                              cellMatch &&
                              onEdit({
                                kind: "cell",
                                tableIndex: cellMatch.tableIndex,
                                row: cellMatch.cell.row_index,
                                col: cellMatch.cell.column_index,
                                current: cellMatch.cell.content,
                              })
                            }
                            className={cn(
                              "whitespace-nowrap border-r px-3 py-2 align-middle last:border-r-0 transition-colors",
                              canClick && "cursor-pointer",
                              isActive && "bg-amber-50 ring-1 ring-inset ring-amber-400",
                              !isActive && canClick && "hover:bg-accent",
                            )}
                            style={{ fontFamily: '"DM Mono", monospace' }}
                            title={cellMatch ? `${val ?? "—"} (double-click to edit)` : undefined}
                          >
                            <span className="flex items-center gap-1">
                              <span className={cn("flex-1 truncate", isActive && "text-primary")}>
                                {val != null
                                  ? val
                                  : <span className="italic text-muted-foreground/40">—</span>}
                              </span>
                              {cellMatch && (
                                <Pencil
                                  className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onEdit({
                                      kind: "cell",
                                      tableIndex: cellMatch.tableIndex,
                                      row: cellMatch.cell.row_index,
                                      col: cellMatch.cell.column_index,
                                      current: cellMatch.cell.content,
                                    })
                                  }}
                                />
                              )}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
