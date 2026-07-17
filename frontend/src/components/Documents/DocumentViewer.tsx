import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Maximize2,
  Pencil,
  RotateCw,
  Search,
  Table2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import { TopAppBar } from "@/components/Common/TopAppBar"
import { ReviewDialog } from "@/components/Documents/ReviewDialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  API_BASE,
  type ExtractedTable,
  type KVPair,
  type ReviewStatus,
  type TableCell,
  fetchDocument,
  getStaticUrl,
  reviewDocument,
  updateDocumentFields,
} from "@/lib/api"
import { BolFieldsPanel } from "@/components/Documents/BolFieldsPanel"
import { DocumentChatWidget } from "@/components/Chat/DocumentChatWidget"
import { cn } from "@/lib/utils"

type ActiveTab = "kv" | "tables" | "bol"

type HighlightState =
  | { type: "kv"; pairIndex: number; field: "key" | "value"; pageNumber: number; polygon: number[][]; confidence: number }
  | { type: "cell"; tableIndex: number; row: number; col: number; pageNumber: number; polygon: number[][]; confidence?: number }

type EditTarget =
  | { kind: "kv-key"; pairIndex: number; current: string }
  | { kind: "kv-value"; pairIndex: number; current: string }
  | { kind: "cell"; tableIndex: number; row: number; col: number; current: string }
  | { kind: "bol-not-found"; bolFieldIndex: number; label: string; current: string }

const ZOOM_LEVELS = [40, 45, 50, 60, 65, 70, 75, 90, 100, 125, 150, 175, 200] as const

function pickDefaultZoomIdx(): number {
  if (typeof window === "undefined") return ZOOM_LEVELS.indexOf(100)
  const w = window.innerWidth
  if (w < 1280) return ZOOM_LEVELS.indexOf(90)   // ≈65×1.10→71 → 90
  if (w < 1440) return ZOOM_LEVELS.indexOf(100)  // ≈90×1.15→103 → 100
  if (w < 1600) return ZOOM_LEVELS.indexOf(125)  // ≈100×1.20→120 → 125
  return ZOOM_LEVELS.indexOf(125)                 // ≈100×1.20→120 → 125
}

function confidenceColor(c: number) {
  if (c >= 0.7) return "#16a34a"
  if (c >= 0.5) return "#d97706"
  return "#dc2626"
}

function confidenceTheme(c?: number) {
  if (c !== undefined && c >= 0.7)
    return { stroke: "#22c55e", fill: "rgba(34,197,94,0.13)", glow: "rgba(34,197,94,0.18)", rowBg: "green" }
  if (c !== undefined && c >= 0.5)
    return { stroke: "#f59e0b", fill: "rgba(245,158,11,0.12)", glow: "rgba(245,158,11,0.18)", rowBg: "amber" }
  return { stroke: "#ef4444", fill: "rgba(239,68,68,0.12)", glow: "rgba(239,68,68,0.18)", rowBg: "red" }
}

export function DocumentViewer({ docId }: { docId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [currentPage, setCurrentPage] = useState(1)
  const [zoomIdx, setZoomIdx] = useState<number>(() => pickDefaultZoomIdx())
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0)
  const [highlight, setHighlight] = useState<HighlightState | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>("kv")
  const [filter, setFilter] = useState("")
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [reviewDecision, setReviewDecision] = useState<ReviewStatus | null>(null)

  const layoutRef = useRef<HTMLDivElement>(null)
  const pdfScrollRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [naturalImgW, setNaturalImgW] = useState(0)

  // Pages are rendered at 144 DPI (2× CSS baseline). At 100% zoom the displayed
  // width is naturalWidth / 2, keeping pixel density correct on standard screens.
  const renderedWidth = naturalImgW > 0 ? (naturalImgW / 2) * (ZOOM_LEVELS[zoomIdx] / 100) : 0

  const { data: doc, isLoading, error } = useQuery({
    queryKey: ["document", docId],
    queryFn: () => fetchDocument(docId),
    refetchInterval: (q) => {
      const d = q.state.data
      if (d && (d.status === "pending" || d.status === "processing")) return 2500
      return false
    },
  })


  const pageCount = doc?.page_count || 0
  const pageImages = useMemo(() => doc?.page_images || [], [doc])
  const kvPairs = useMemo(() => doc?.key_value_pairs || [], [doc])
  const tables = useMemo(() => doc?.tables || [], [doc])

  const saveMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateDocumentFields>[1]) =>
      updateDocumentFields(docId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", docId] })
      toast.success("Saved", { description: "Your edit was persisted." })
    },
    onError: (e: Error) => toast.error("Save failed", { description: e.message }),
  })

  const reviewMutation = useMutation({
    mutationFn: (vars: { review_status: ReviewStatus; review_comment: string | null }) =>
      reviewDocument(docId, vars),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["document", docId] })
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      toast.success(
        data.review_status === "approved" ? "Document approved" : "Document rejected",
      )
      setReviewDecision(null)
    },
    onError: (e: Error) => toast.error("Review failed", { description: e.message }),
  })

  const filteredPairs = useMemo(
    () =>
      kvPairs
        .map((pair, idx) => ({ pair, originalIndex: idx }))
        .filter(({ pair }) => {
          if (!filter) return true
          const q = filter.toLowerCase()
          return (
            pair.key.content.toLowerCase().includes(q) ||
            pair.value.content.toLowerCase().includes(q)
          )
        }),
    [kvPairs, filter],
  )

  const handleKVClick = useCallback(
    (pair: KVPair, pairIndex: number, field: "key" | "value") => {
      const region = (field === "key" ? pair.key : pair.value).bounding_regions?.[0]
      if (!region?.polygon?.length) { setHighlight(null); return }
      if (highlight?.type === "kv" && highlight.pairIndex === pairIndex && highlight.field === field) {
        setHighlight(null); return
      }
      setCurrentPage(region.page_number)
      setHighlight({ type: "kv", pairIndex, field, pageNumber: region.page_number, polygon: region.polygon, confidence: pair.confidence })
    },
    [highlight],
  )

  const handleCellClick = useCallback(
    (tableIndex: number, cell: TableCell) => {
      const region = cell.bounding_regions?.[0]
      if (!region?.polygon?.length) return
      if (highlight?.type === "cell" && highlight.tableIndex === tableIndex && highlight.row === cell.row_index && highlight.col === cell.column_index) {
        setHighlight(null); return
      }
      setCurrentPage(region.page_number)
      setHighlight({ type: "cell", tableIndex, row: cell.row_index, col: cell.column_index, pageNumber: region.page_number, polygon: region.polygon })
    },
    [highlight],
  )

  useEffect(() => {
    setNaturalImgW(0)
    setRotation(0)
  }, [currentPage])

  const rotatePage = useCallback(() => {
    setHighlight(null)
    setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270)
  }, [])

  useEffect(() => {
    if (highlight && pdfScrollRef.current) {
      const t = setTimeout(() => {
        pdfScrollRef.current
          ?.querySelector(".rubber-band-highlight")
          ?.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 100)
      return () => clearTimeout(t)
    }
  }, [highlight, currentPage])

  const handleSaveEdit = (newValue: string) => {
    if (!editing || !doc) return
    if (editing.kind === "kv-key" || editing.kind === "kv-value") {
      const updated = kvPairs.map((p, i) => {
        if (i !== editing.pairIndex) return p
        if (editing.kind === "kv-key") return { ...p, key: { ...p.key, content: newValue } }
        return { ...p, value: { ...p.value, content: newValue } }
      })
      saveMutation.mutate({ key_value_pairs: updated })
    } else if (editing.kind === "cell") {
      const updated = tables.map((t, ti) => {
        if (ti !== editing.tableIndex) return t
        return {
          ...t,
          cells: t.cells.map((c) => {
            if (c.row_index === editing.row && c.column_index === editing.col) return { ...c, content: newValue }
            return c
          }),
        }
      })
      saveMutation.mutate({ tables: updated })
    } else if (editing.kind === "bol-not-found") {
      // Create a new KV pair for the manually filled field
      const newPairIndex = kvPairs.length
      const newPair = {
        key: { content: editing.label, bounding_regions: [] },
        value: { content: newValue, bounding_regions: [] },
        confidence: 1.0,
      }
      const updatedKvPairs = [...kvPairs, newPair]
      const updatedBolFields = (doc.bol_kv_fields || []).map((f, i) =>
        i === editing.bolFieldIndex
          ? { ...f, value: newValue, found: true, kv_pair_index: newPairIndex }
          : f,
      )
      saveMutation.mutate({ key_value_pairs: updatedKvPairs, bol_kv_fields: updatedBolFields })
    }
    setEditing(null)
  }

  const downloadFile = async () => {
    if (!doc) return
    try {
      const token = localStorage.getItem("access_token")
      const res = await fetch(
        `${API_BASE}/api/v1/documents/${doc.id}/file`,
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      Object.assign(document.createElement("a"), { href: url, download: doc.original_filename }).click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error("Download failed", { description: err instanceof Error ? err.message : "Unknown error" })
    }
  }

  const zoomIn = () => setZoomIdx((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))
  const zoomOut = () => setZoomIdx((i) => Math.max(0, i - 1))
  const fitWidth = () => setZoomIdx(pickDefaultZoomIdx())

  if (isLoading) {
    return (
      <Shell>
        <Centered>
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading document…</p>
        </Centered>
      </Shell>
    )
  }
  if (error || !doc) {
    return (
      <Shell>
        <Centered>
          <p className="mb-3 font-medium text-destructive">Failed to load document</p>
          <BackBtn onClick={() => navigate({ to: "/documents" })}>Back to documents</BackBtn>
        </Centered>
      </Shell>
    )
  }
  if (doc.status !== "processed") {
    return (
      <Shell>
        <Centered>
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
          <p className="mb-1 text-lg font-medium">Processing document…</p>
          <p className="text-sm text-muted-foreground">{doc.original_filename} is being analyzed.</p>
          <BackBtn onClick={() => navigate({ to: "/documents" })}>Back to documents</BackBtn>
        </Centered>
      </Shell>
    )
  }

  const currentImage = pageImages[currentPage - 1]
  // Page images are served by the backend and require auth. Since an <img> tag
  // can't send an Authorization header, pass the token as a query param.
  const currentImageSrc = currentImage
    ? `${getStaticUrl(currentImage)}?token=${localStorage.getItem("access_token") ?? ""}`
    : ""

  return (
    <Shell>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/documents" })}
          title="Back to documents"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="h-5 w-px bg-border" />

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          <span className="truncate text-[13px] font-semibold">{doc.original_filename}</span>
          <ReviewBadge reviewStatus={doc.review_status} />
        </div>

        <div className="h-5 w-px bg-border" />

        <TbBtn disabled={currentPage <= 1} onClick={() => { setCurrentPage((p) => Math.max(1, p - 1)); setHighlight(null) }} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </TbBtn>
        <input
          type="text"
          inputMode="numeric"
          value={currentPage}
          onChange={(e) => { const n = Number.parseInt(e.target.value, 10); if (n >= 1 && n <= pageCount) setCurrentPage(n) }}
          className="h-7 w-10 rounded border bg-secondary text-center text-xs outline-none focus:border-primary"
          style={{ fontFamily: '"DM Mono", monospace' }}
        />
        <span className="text-xs text-muted-foreground" style={{ fontFamily: '"DM Mono", monospace' }}>/ {pageCount}</span>
        <TbBtn disabled={currentPage >= pageCount} onClick={() => { setCurrentPage((p) => Math.min(pageCount, p + 1)); setHighlight(null) }} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </TbBtn>

        <div className="h-5 w-px bg-border" />

        <TbBtn onClick={zoomOut} disabled={zoomIdx === 0} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></TbBtn>
        <select
          value={ZOOM_LEVELS[zoomIdx]}
          onChange={(e) => setZoomIdx(ZOOM_LEVELS.indexOf(Number(e.target.value) as (typeof ZOOM_LEVELS)[number]))}
          className="h-7 cursor-pointer rounded border bg-secondary px-1.5 text-xs text-muted-foreground outline-none focus:border-primary"
        >
          {ZOOM_LEVELS.map((z) => <option key={z} value={z}>{z}%</option>)}
        </select>
        <TbBtn onClick={zoomIn} disabled={zoomIdx === ZOOM_LEVELS.length - 1} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></TbBtn>
        <TbBtn onClick={fitWidth} aria-label="Fit to width"><Maximize2 className="h-4 w-4" /></TbBtn>
        <TbBtn onClick={rotatePage} aria-label="Rotate page 90° clockwise" title="Rotate 90° clockwise"><RotateCw className="h-4 w-4" /></TbBtn>

        <div className="h-5 w-px bg-border" />

        <button
          type="button"
          onClick={downloadFile}
          className="flex h-7 items-center gap-1.5 rounded border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-primary"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>

        <div className="h-5 w-px bg-border" />

        {(() => {
          const reviewed = doc.review_status !== null
          const isApproved = doc.review_status === "approved"
          const isRejected = doc.review_status === "rejected"
          return (
            <>
              <button
                type="button"
                disabled={reviewed}
                onClick={() => !reviewed && setReviewDecision("approved")}
                title={
                  isApproved
                    ? "Approved"
                    : isRejected
                      ? "Decision already submitted"
                      : "Approve document"
                }
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded border px-2.5 text-xs font-semibold transition-colors",
                  isApproved
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 cursor-default"
                    : reviewed
                      ? "border bg-card text-muted-foreground/50 cursor-not-allowed"
                      : "border bg-card text-muted-foreground hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600",
                )}
              >
                <Check className="h-3.5 w-3.5" />
                {isApproved ? "Approved" : "Approve"}
              </button>
              <button
                type="button"
                disabled={reviewed}
                onClick={() => !reviewed && setReviewDecision("rejected")}
                title={
                  isRejected
                    ? "Rejected"
                    : isApproved
                      ? "Decision already submitted"
                      : "Reject document"
                }
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded border px-2.5 text-xs font-semibold transition-colors",
                  isRejected
                    ? "border-red-500 bg-red-50 text-red-700 cursor-default"
                    : reviewed
                      ? "border bg-card text-muted-foreground/50 cursor-not-allowed"
                      : "border bg-card text-muted-foreground hover:border-red-500 hover:bg-red-50 hover:text-red-600",
                )}
              >
                <X className="h-3.5 w-3.5" />
                {isRejected ? "Rejected" : "Reject"}
              </button>
            </>
          )
        })()}
      </div>

      <div ref={layoutRef} className="relative flex flex-1 overflow-hidden">
        <div className="flex w-1/2 flex-col border-r" style={{ background: "#f7f4f4" }}>
          <div ref={pdfScrollRef} className="pdf-scroll flex-1 overflow-auto px-5 py-6">
            {currentImage ? (
              (() => {
                const naturalH = imageRef.current?.naturalHeight ?? 0
                const renderedHeight =
                  naturalImgW > 0 && naturalH > 0 ? renderedWidth * (naturalH / naturalImgW) : 0
                const isSideways = rotation === 90 || rotation === 270
                const outerW = isSideways ? renderedHeight : renderedWidth
                const outerH = isSideways ? renderedWidth : renderedHeight
                const hasDims = outerW > 0 && outerH > 0
                return (
                  <div
                    className="relative mx-auto block rounded-sm shadow-2xl"
                    style={
                      hasDims
                        ? { width: `${outerW}px`, height: `${outerH}px`, overflow: "hidden" }
                        : { width: "fit-content" }
                    }
                  >
                    <div
                      className="relative"
                      style={
                        hasDims
                          ? {
                              width: `${renderedWidth}px`,
                              height: `${renderedHeight}px`,
                              position: "absolute",
                              top: "50%",
                              left: "50%",
                              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                              transformOrigin: "center center",
                            }
                          : undefined
                      }
                    >
                      <img
                        ref={imageRef}
                        src={currentImageSrc}
                        alt={`Page ${currentPage}`}
                        className="block h-auto select-none bg-white"
                        style={renderedWidth ? { width: `${renderedWidth}px`, maxWidth: "none" } : undefined}
                        onLoad={(e) => setNaturalImgW((e.target as HTMLImageElement).naturalWidth)}
                        draggable={false}
                      />
                      {highlight && highlight.pageNumber === currentPage && imageRef.current && (
                        <RubberBandOverlay
                          polygon={highlight.polygon}
                          imageEl={imageRef.current}
                          confidence={highlight.confidence}
                          rotation={rotation}
                        />
                      )}
                    </div>
                  </div>
                )
              })()
            ) : (
              <p className="text-muted-foreground">No page image available</p>
            )}
          </div>
        </div>

        <div className="flex w-1/2 flex-col overflow-hidden bg-card">
          <div className="flex shrink-0 border-b bg-secondary">
            <TabBtn active={activeTab === "kv"} onClick={() => { setActiveTab("kv"); setFilter(""); setHighlight(null) }} count={kvPairs.length}>
              <KvIcon /> Key–Value Pairs
            </TabBtn>
            <TabBtn active={activeTab === "tables"} onClick={() => { setActiveTab("tables"); setFilter(""); setHighlight(null) }} count={tables.length}>
              <Table2 className="h-[15px] w-[15px]" /> Tables
            </TabBtn>
            <TabBtn active={activeTab === "bol"} onClick={() => { setActiveTab("bol"); setFilter(""); setHighlight(null) }}>
              <StarIcon /> Fields of Interest
            </TabBtn>
          </div>

          {activeTab === "kv" ? (
            <KvPanel
              pairs={filteredPairs}
              totalCount={kvPairs.length}
              filter={filter}
              setFilter={setFilter}
              highlight={highlight}
              onClickField={handleKVClick}
              onEdit={setEditing}
            />
          ) : activeTab === "tables" ? (
            <TablesPanel
              tables={tables}
              filter={filter}
              setFilter={setFilter}
              highlight={highlight}
              onClickCell={handleCellClick}
              onEditCell={(tIdx, cell) =>
                setEditing({ kind: "cell", tableIndex: tIdx, row: cell.row_index, col: cell.column_index, current: cell.content })
              }
            />
          ) : (
            <BolFieldsPanel
              docId={docId}
              bolKvFields={doc.bol_kv_fields}
              bolLineItems={doc.bol_line_items}
              kvPairs={kvPairs}
              tables={tables}
              highlight={highlight}
              onClickField={handleKVClick}
              onClickCell={handleCellClick}
              onEdit={(t) => setEditing(t)}
            />
          )}
        </div>

        {highlight && layoutRef.current && imageRef.current && (
          <ConnectorLine
            layoutEl={layoutRef.current}
            imageEl={imageRef.current}
            highlight={highlight}
            visible={highlight.pageNumber === currentPage}
            naturalImgW={naturalImgW}
            rotation={rotation}
          />
        )}
      </div>

      <EditModal
        target={editing}
        isSaving={saveMutation.isPending}
        onClose={() => setEditing(null)}
        onSave={handleSaveEdit}
      />

      <ReviewDialog
        open={reviewDecision !== null}
        decision={reviewDecision ?? "approved"}
        filename={doc.original_filename}
        currentStatus={doc.review_status}
        currentComment={doc.review_comment}
        isSaving={reviewMutation.isPending}
        onClose={() => !reviewMutation.isPending && setReviewDecision(null)}
        onConfirm={(comment) => {
          if (!reviewDecision) return
          reviewMutation.mutate({ review_status: reviewDecision, review_comment: comment })
        }}
      />
      <DocumentChatWidget documentId={docId} documentName={doc.original_filename} />
    </Shell>
  )
}

function ReviewBadge({ reviewStatus }: { reviewStatus: ReviewStatus | null }) {
  if (reviewStatus === "approved") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{ background: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" }}
      >
        <Check className="h-3 w-3" />
        Approved
      </span>
    )
  }
  if (reviewStatus === "rejected") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{ background: "#fef2f2", color: "#b91c1c", borderColor: "#fecaca" }}
      >
        <X className="h-3 w-3" />
        Rejected
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "#f1f5f9", color: "#475569", borderColor: "#cbd5e1" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#64748b" }} />
      Processed
    </span>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <style>{`
        .pdf-scroll::-webkit-scrollbar,
        .kv-scroll::-webkit-scrollbar  { width: 6px; height: 6px; }
        .pdf-scroll::-webkit-scrollbar-track,
        .kv-scroll::-webkit-scrollbar-track  { background: #f4f5f7; border-radius: 4px; }
        .pdf-scroll::-webkit-scrollbar-thumb,
        .kv-scroll::-webkit-scrollbar-thumb  { background: #dde3e9; border-radius: 4px; }
        .pdf-scroll::-webkit-scrollbar-thumb:hover,
        .kv-scroll::-webkit-scrollbar-thumb:hover  { background: #cdd5de; }
        .pdf-scroll { scrollbar-color: #dde3e9 #f4f5f7; scrollbar-width: thin; }
        .kv-scroll  { scrollbar-color: #dde3e9 #f4f5f7; scrollbar-width: thin; }
      `}</style>
      <TopAppBar />
      {children}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      <div className="text-center">{children}</div>
    </div>
  )
}

function BackBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-4 rounded-md border bg-card px-4 py-2 text-sm hover:bg-secondary">
      {children}
    </button>
  )
}

function TbBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  )
}

function TabBtn({ children, active, count, onClick }: { children: ReactNode; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px flex select-none items-center gap-1.5 whitespace-nowrap border-b-2 px-4 pb-3 pt-3 text-[13px] font-medium transition-colors",
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold", active ? "bg-accent text-primary" : "bg-card text-muted-foreground")}
          style={{ fontFamily: '"DM Mono", monospace' }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function KvIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

const KV_COLS = "38% 38% 9% 9% 6%"

function KvPanel({
  pairs, totalCount, filter, setFilter, highlight, onClickField, onEdit,
}: {
  pairs: { pair: KVPair; originalIndex: number }[]
  totalCount: number
  filter: string
  setFilter: (s: string) => void
  highlight: HighlightState | null
  onClickField: (pair: KVPair, idx: number, field: "key" | "value") => void
  onEdit: (t: EditTarget) => void
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2.5">
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Extracted fields ({pairs.length} of {totalCount})
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text" placeholder="Filter fields…" value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 w-44 rounded border bg-secondary pl-7 pr-2 text-xs outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="kv-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 grid border-b bg-secondary px-4 py-1.5" style={{ gridTemplateColumns: KV_COLS }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Key</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Value</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Conf.</span>
          <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Page</span>
          <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Edit</span>
        </div>
        {pairs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
            <FileText className="h-10 w-10 text-border" />
            <p className="text-sm font-medium">{filter ? "No matching fields" : "No fields extracted"}</p>
          </div>
        ) : (
          pairs.map(({ pair, originalIndex }) => {
            const keyActive = highlight?.type === "kv" && highlight.pairIndex === originalIndex && highlight.field === "key"
            const valActive = highlight?.type === "kv" && highlight.pairIndex === originalIndex && highlight.field === "value"
            const isActive = keyActive || valActive
            const conf = pair.confidence
            return (
              <div
                key={originalIndex}
                data-kv-row={originalIndex}
                data-kv-active={isActive ? "true" : undefined}
                className={cn(
                  "group grid items-center border-b px-4 transition-colors",
                  !isActive && "hover:bg-[#f4f8fd]",
                  isActive && conf >= 0.7 && "bg-green-50 hover:bg-green-50",
                  isActive && conf >= 0.5 && conf < 0.7 && "bg-amber-50 hover:bg-amber-50",
                  isActive && conf < 0.5 && "bg-red-50 hover:bg-red-50",
                )}
                style={{ gridTemplateColumns: KV_COLS, minHeight: 44 }}
              >
                <button
                  type="button"
                  onClick={() => onClickField(pair, originalIndex, "key")}
                  className={cn(
                    "truncate py-2 pr-3 text-left text-[12.5px] font-medium text-foreground transition-colors hover:text-primary",
                    keyActive && "text-primary",
                  )}
                  title={pair.key.content}
                >
                  {pair.key.content || "—"}
                </button>
                <button
                  type="button"
                  onClick={() => onClickField(pair, originalIndex, "value")}
                  className={cn(
                    "truncate py-2 pr-3 text-left text-[12.5px] text-muted-foreground transition-colors hover:text-primary",
                    valActive && "text-primary",
                  )}
                  style={{ fontFamily: '"DM Mono", monospace' }}
                  title={pair.value.content}
                >
                  {pair.value.content || "—"}
                </button>
                <span className="flex items-center pl-1">
                  <span
                    className="h-[10px] w-[10px] rounded-full flex-shrink-0"
                    style={{ background: confidenceColor(conf) }}
                  />
                </span>
                <span className="text-center">
                  <span
                    className="inline-block rounded border bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground"
                    style={{ fontFamily: '"DM Mono", monospace' }}
                  >
                    p.{pair.key.bounding_regions?.[0]?.page_number ?? "?"}
                  </span>
                </span>
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => onEdit({ kind: "kv-value", pairIndex: originalIndex, current: pair.value.content })}
                    title="Edit value"
                    className="rounded border bg-card p-1 text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-primary"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

function TablesPanel({
  tables, filter, setFilter, highlight, onClickCell, onEditCell,
}: {
  tables: ExtractedTable[]
  filter: string
  setFilter: (s: string) => void
  highlight: HighlightState | null
  onClickCell: (tIdx: number, cell: TableCell) => void
  onEditCell: (tIdx: number, cell: TableCell) => void
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2.5">
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Extracted tables</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Filter content…" value={filter} onChange={(e) => setFilter(e.target.value)}
            className="h-7 w-44 rounded border bg-secondary pl-7 pr-2 text-xs outline-none focus:border-primary" />
        </div>
      </div>
      <div className="kv-scroll min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        {tables.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">No tables found</p>
          </div>
        ) : (
          tables.map((t) => (
            <TableCard key={t.index} table={t} filter={filter} highlight={highlight} onClickCell={onClickCell} onEditCell={onEditCell} />
          ))
        )}
      </div>
    </>
  )
}

function TableCard({ table, filter, highlight, onClickCell, onEditCell }: {
  table: ExtractedTable; filter: string; highlight: HighlightState | null
  onClickCell: (tIdx: number, cell: TableCell) => void
  onEditCell: (tIdx: number, cell: TableCell) => void
}) {
  const grid = useMemo(() => {
    const rows: (TableCell | null)[][] = Array.from({ length: table.row_count }, () =>
      Array.from({ length: table.column_count }, () => null))
    for (const cell of table.cells) {
      if (cell.row_index < table.row_count && cell.column_index < table.column_count)
        rows[cell.row_index][cell.column_index] = cell
    }
    return rows
  }, [table])

  const q = filter.toLowerCase()
  if (filter && !table.cells.some((c) => c.content.toLowerCase().includes(q))) return null

  return (
    <div className="overflow-hidden rounded-[13px] border bg-card shadow-sm">
      <div className="flex items-center gap-2.5 border-b bg-secondary px-4 py-2.5">
        <div className="flex-1 text-[13px] font-semibold">Table {table.index + 1}</div>
        <span className="rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground" style={{ fontFamily: '"DM Mono", monospace' }}>
          p.{table.bounding_regions?.[0]?.page_number ?? "?"}
        </span>
        <span className="rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground" style={{ fontFamily: '"DM Mono", monospace' }}>
          {table.row_count} × {table.column_count}
        </span>
      </div>
      <div className="kv-scroll overflow-x-auto">
        <table className="min-w-full border-collapse text-[12.5px]">
          <tbody>
            {grid.map((row, rIdx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable grid
              <tr key={rIdx} className="group border-b last:border-b-0">
                {row.map((cell, cIdx) => {
                  if (!cell) return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable grid
                    <td key={cIdx} className="border-r px-3 py-2 text-left text-muted-foreground/40 last:border-r-0">—</td>
                  )
                  const isHeader = cell.kind === "columnHeader" || cell.kind === "rowHeader"
                  const isActive = highlight?.type === "cell" && highlight.tableIndex === table.index && highlight.row === cell.row_index && highlight.col === cell.column_index
                  const hasRegion = (cell.bounding_regions?.length ?? 0) > 0
                  const matchesSearch = filter && cell.content.toLowerCase().includes(q)
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable grid
                    <td
                      key={cIdx}
                      data-cell-active={isActive ? "true" : undefined}
                      colSpan={cell.column_span > 1 ? cell.column_span : undefined}
                      rowSpan={cell.row_span > 1 ? cell.row_span : undefined}
                      onClick={() => hasRegion && onClickCell(table.index, cell)}
                      onDoubleClick={() => onEditCell(table.index, cell)}
                      className={cn(
                        "border-r px-3 py-2 text-left align-middle transition-colors last:border-r-0",
                        isHeader && "bg-secondary font-semibold",
                        hasRegion && "cursor-pointer hover:bg-accent",
                        isActive && "bg-amber-50 ring-1 ring-inset ring-amber-400",
                        matchesSearch && !isActive && "bg-amber-50/60",
                      )}
                      style={{ fontFamily: isHeader ? undefined : '"DM Mono", monospace' }}
                      title={`${cell.content} (double-click to edit)`}
                    >
                      <span className="flex items-center gap-1">
                        <span className="flex-1 truncate">{cell.content || "—"}</span>
                        <Pencil
                          className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); onEditCell(table.index, cell) }}
                        />
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EditModal({ target, isSaving, onClose, onSave }: {
  target: EditTarget | null; isSaving: boolean
  onClose: () => void; onSave: (v: string) => void
}) {
  const [value, setValue] = useState("")
  useEffect(() => { if (target) setValue(target.current) }, [target])

  const heading = !target ? "" :
    target.kind === "kv-key" ? "Edit key" :
    target.kind === "kv-value" ? "Edit value" :
    target.kind === "bol-not-found" ? `Fill in: ${target.label}` :
    `Edit cell (row ${target.row + 1}, col ${target.col + 1})`

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>Edit the extracted value. The change will be saved to the server.</DialogDescription>
        </DialogHeader>
        <textarea
          autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          className="min-h-[100px] w-full resize-y rounded-md border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-md border bg-card px-4 py-2 text-sm hover:bg-secondary">Cancel</button>
          <button
            type="button" onClick={() => onSave(value)} disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-60"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RubberBandOverlay({ polygon, imageEl, confidence }: { polygon: number[][]; imageEl: HTMLImageElement; confidence?: number; rotation?: 0 | 90 | 180 | 270 }) {
  const [dims, setDims] = useState({ natW: 0, natH: 0, dispW: 0, dispH: 0 })

  useEffect(() => {
    const update = () => setDims({ natW: imageEl.naturalWidth, natH: imageEl.naturalHeight, dispW: imageEl.clientWidth, dispH: imageEl.clientHeight })
    if (imageEl.complete) update()
    else imageEl.addEventListener("load", update)
    const ro = new ResizeObserver(update)
    ro.observe(imageEl)
    return () => { imageEl.removeEventListener("load", update); ro.disconnect() }
  }, [imageEl])

  if (!dims.natW || !dims.dispW || polygon.length < 3) return null

  const theme = confidenceTheme(confidence)

  // Polygon coordinates are in inches; multiply by DPI to get pixel offsets,
  // then scale to the element's rendered dimensions.
  const DPI = 144
  const scaleX = dims.dispW / dims.natW
  const scaleY = dims.dispH / dims.natH
  const points = polygon.map(([x, y]) => [x * DPI * scaleX, y * DPI * scaleY] as [number, number])
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y)
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys)
  const pad = 6

  return (
    <div
      className="rubber-band-highlight pointer-events-none absolute"
      data-bbox-active="true"
      style={{ left: minX - pad, top: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }}
    >
      <svg width="100%" height="100%" className="absolute inset-0" aria-hidden="true">
        <polygon
          points={points.map(([x, y]) => `${x - minX + pad},${y - minY + pad}`).join(" ")}
          fill={theme.fill} stroke={theme.stroke} strokeWidth="2.5" strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

function ConnectorLine({
  layoutEl, imageEl, highlight, visible, naturalImgW, rotation,
}: {
  layoutEl: HTMLDivElement
  imageEl: HTMLImageElement
  highlight: HighlightState
  visible: boolean
  naturalImgW: number
  rotation: 0 | 90 | 180 | 270
}) {
  const [coords, setCoords] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute on highlight + image dims
  useLayoutEffect(() => {
    if (!visible || !naturalImgW) { setCoords(null); return }

    const compute = () => {
      const rowEl = layoutEl.querySelector<HTMLElement>(
        "[data-kv-active='true'], [data-cell-active='true']",
      )
      if (!rowEl) { setCoords(null); return }

      const layoutRect = layoutEl.getBoundingClientRect()
      const rowRect = rowEl.getBoundingClientRect()
      const imgRect = imageEl.getBoundingClientRect()
      if (!imgRect.width || !imgRect.height) return

      // Compute the band's right-edge midpoint in the image's own (un-rotated)
      // coordinate space using the polygon, then transform that point through
      // the rotation around the image center to get its screen-space position.
      // imgRect already reflects the rotated bounding box on screen, so we
      // can't read x/y directly off the rotated DOM element — we have to do
      // the math ourselves to land on the actual rotated edge.
      const DPI = 144
      const natW = imageEl.naturalWidth
      const natH = imageEl.naturalHeight
      const renderedW = imgRect.width
      const renderedH = imgRect.height
      // After rotation, imgRect's width/height may correspond to the swapped
      // dimensions of the natural image. Recover the un-rotated rendered size:
      const isSideways = rotation === 90 || rotation === 270
      const unrotW = isSideways ? renderedH : renderedW
      const unrotH = isSideways ? renderedW : renderedH
      const scaleX = unrotW / natW
      const scaleY = unrotH / natH

      const xs = highlight.polygon.map(([x]) => x * DPI * scaleX)
      const ys = highlight.polygon.map(([, y]) => y * DPI * scaleY)
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)

      // The four edge midpoints of the band in the image's local space
      // (origin = image top-left, axes = image natural orientation).
      const edges = {
        right:  { x: maxX,            y: (minY + maxY) / 2 },
        top:    { x: (minX + maxX)/2, y: minY            },
        left:   { x: minX,            y: (minY + maxY) / 2 },
        bottom: { x: (minX + maxX)/2, y: maxY            },
      }
      // After rotating the page clockwise, the edge that ends up facing the
      // right side of the screen (toward the panel) shifts accordingly.
      const rightFacingEdge =
        rotation === 0   ? edges.right :
        rotation === 90  ? edges.top :
        rotation === 180 ? edges.left :
                           edges.bottom

      // Transform a point from image-local space to screen space, accounting
      // for the rotation around the image center.
      const cx = unrotW / 2
      const cy = unrotH / 2
      const rad = (rotation * Math.PI) / 180
      const cos = Math.cos(rad), sin = Math.sin(rad)
      const dx = rightFacingEdge.x - cx
      const dy = rightFacingEdge.y - cy
      // After rotation, the image still occupies imgRect (axis-aligned bbox of
      // the rotated content), centered at (imgRect.left + imgRect.width/2,
      // imgRect.top + imgRect.height/2).
      const screenCx = imgRect.left + imgRect.width / 2
      const screenCy = imgRect.top + imgRect.height / 2
      const screenX = screenCx + (dx * cos - dy * sin)
      const screenY = screenCy + (dx * sin + dy * cos)

      const x1 = rowRect.left - layoutRect.left
      const y1 = rowRect.top + rowRect.height / 2 - layoutRect.top
      const x2 = screenX - layoutRect.left
      const imgTop = imgRect.top - layoutRect.top
      const imgBot = imgRect.bottom - layoutRect.top
      const y2 = Math.min(Math.max(screenY - layoutRect.top, imgTop), imgBot)

      if (imgRect.bottom < layoutRect.top || imgRect.top > layoutRect.bottom) {
        setCoords(null); return
      }

      setCoords({ x1, y1, x2, y2 })
    }

    const raf = requestAnimationFrame(compute)
    const ro = new ResizeObserver(compute)
    ro.observe(layoutEl)
    ro.observe(imageEl)
    const onScroll = () => compute()
    const scrollers = Array.from(layoutEl.querySelectorAll("*"))
    scrollers.forEach((el) => el.addEventListener("scroll", onScroll, true))
    window.addEventListener("resize", onScroll)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      scrollers.forEach((el) => el.removeEventListener("scroll", onScroll, true))
      window.removeEventListener("resize", onScroll)
    }
  }, [visible, highlight, layoutEl, imageEl, naturalImgW, rotation])

  if (!coords) return null

  const theme = confidenceTheme(highlight.confidence)
  const midX = (coords.x1 + coords.x2) / 2
  const d = `M ${coords.x1} ${coords.y1} C ${midX} ${coords.y1}, ${midX} ${coords.y2}, ${coords.x2} ${coords.y2}`

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-30"
      width="100%" height="100%"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="connector-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={theme.stroke} stopOpacity="0.95" />
          <stop offset="100%" stopColor={theme.stroke} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={theme.glow} strokeWidth="6" strokeLinecap="round" />
      <path
        d={d}
        fill="none"
        stroke="url(#connector-grad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="5 4"
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="0.9s" repeatCount="indefinite" />
      </path>
      <circle cx={coords.x1} cy={coords.y1} r="3.5" fill={theme.stroke} stroke="#fff" strokeWidth="1.5" />
    </svg>
  )
}
