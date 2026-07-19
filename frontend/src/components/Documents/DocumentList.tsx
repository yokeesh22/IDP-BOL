import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Home,
  Loader2,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ReportDialog } from "@/components/Common/ReportDialog"
import useAuth from "@/hooks/useAuth"
import {
  type DocumentMeta,
  type DocumentStatus,
  deleteDocument,
  fetchDocuments,
  type ReviewStatus,
  uploadDocument,
} from "@/lib/api"
import {
  downloadWorkbook,
  inRange,
  type ResolvedRange,
  rangeSlug,
} from "@/lib/report"
import { cn } from "@/lib/utils"

type CombinedStatus = DocumentStatus | ReviewStatus

function effectiveStatus(d: DocumentMeta): CombinedStatus {
  if (d.status === "processed" && d.review_status) return d.review_status
  return d.status
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function fileExt(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : "file"
}

function formatDateTimeCell(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(
    iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`,
  )
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const extStyles: Record<string, { bg: string; stroke: string }> = {
  pdf: { bg: "#fef2f2", stroke: "#dc2626" },
  doc: { bg: "#eff6ff", stroke: "#2563eb" },
  docx: { bg: "#eff6ff", stroke: "#2563eb" },
  xls: { bg: "#f0fdf4", stroke: "#16a34a" },
  xlsx: { bg: "#f0fdf4", stroke: "#16a34a" },
  ppt: { bg: "#fff7ed", stroke: "#ea580c" },
  pptx: { bg: "#fff7ed", stroke: "#ea580c" },
}

function FileIcon({ ext }: { ext: string }) {
  const s = extStyles[ext] ?? { bg: "#f7f8fa", stroke: "#8896aa" }
  return (
    <div
      className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[9px]"
      style={{ background: s.bg }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke={s.stroke}
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    </div>
  )
}

const statusMap: Record<
  CombinedStatus,
  {
    label: string
    bg: string
    color: string
    border: string
    dot: string
    blink?: boolean
  }
> = {
  processed: {
    label: "Processed",
    bg: "#f1f5f9",
    color: "#475569",
    border: "#cbd5e1",
    dot: "#64748b",
  },
  processing: {
    label: "Processing",
    bg: "#eff6ff",
    color: "#1d4ed8",
    border: "#bfdbfe",
    dot: "#3b82f6",
    blink: true,
  },
  pending: {
    label: "Pending",
    bg: "#fff7ed",
    color: "#c2410c",
    border: "#fed7aa",
    dot: "#f97316",
  },
  error: {
    label: "Error",
    bg: "#fff1f2",
    color: "#be123c",
    border: "#fecdd3",
    dot: "#f43f5e",
  },
  approved: {
    label: "Approved",
    bg: "#f0fdf4",
    color: "#15803d",
    border: "#bbf7d0",
    dot: "#22c55e",
  },
  rejected: {
    label: "Rejected",
    bg: "#fef2f2",
    color: "#b91c1c",
    border: "#fecaca",
    dot: "#ef4444",
  },
}

function StatusBadge({ status }: { status: CombinedStatus }) {
  const s = statusMap[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{ background: s.bg, color: s.color, borderColor: s.border }}
    >
      <span
        className={cn(
          "h-[6px] w-[6px] flex-shrink-0 rounded-full",
          s.blink && "animate-pulse",
        )}
        style={{ background: s.dot }}
      />
      {s.label}
    </span>
  )
}

const ownerColor = "#016ac9"

const PAGE_SIZE = 10

export function DocumentList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"" | CombinedStatus>("")
  const [page, setPage] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reportOpen, setReportOpen] = useState(false)

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
    refetchInterval: (q) => {
      const data = q.state.data as DocumentMeta[] | undefined
      if (!data) return 5000
      const inflight = data.some(
        (d) => d.status === "pending" || d.status === "processing",
      )
      return inflight ? 2500 : 8000
    },
  })

  const uploadMutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
    onError: (err: Error) =>
      toast.error("Upload failed", { description: err.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      toast.success("Document deleted")
    },
    onError: (err: Error) =>
      toast.error("Delete failed", { description: err.message }),
  })

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      let queued = 0
      Array.from(files).forEach((file) => {
        const isPdf =
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")
        if (isPdf) {
          uploadMutation.mutate(file)
          queued += 1
        } else {
          toast.error("Invalid file", {
            description: `${file.name} is not a PDF`,
          })
        }
      })
      if (queued > 0) {
        toast.success(`Queued ${queued} file${queued === 1 ? "" : "s"}`, {
          description: "Processing will begin in the background.",
        })
      }
    },
    [uploadMutation],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return documents.filter((d) => {
      const matchesQ = !q || d.original_filename.toLowerCase().includes(q)
      const matchesS = !statusFilter || effectiveStatus(d) === statusFilter
      return matchesQ && matchesS
    })
  }, [documents, search, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const showStart = filtered.length === 0 ? 0 : pageStart + 1
  const showEnd = pageStart + pageItems.length

  const allChecked =
    pageItems.length > 0 && pageItems.every((d) => selected.has(d.id))

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allChecked) {
        pageItems.forEach((d) => next.delete(d.id))
      } else {
        pageItems.forEach((d) => next.add(d.id))
      }
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDownloadReport = useCallback(
    (range: ResolvedRange) => {
      const inScope = documents.filter((d) => inRange(d.created_at, range))
      const rows: (string | number)[][] = [
        [
          "Name",
          "Type",
          "Size (bytes)",
          "Owner",
          "Status",
          "Review status",
          "Pages",
          "Uploaded",
          "Processed",
        ],
      ]
      for (const d of inScope) {
        rows.push([
          d.original_filename,
          fileExt(d.original_filename).toUpperCase(),
          d.file_size ?? 0,
          d.owner_name || d.owner_email || "",
          d.status,
          d.review_status ?? "",
          d.page_count ?? 0,
          formatDateTimeCell(d.created_at),
          formatDateTimeCell(d.processed_at),
        ])
      }
      downloadWorkbook(`documents-${rangeSlug(range)}.xlsx`, [
        { name: "Documents", rows },
      ])
      toast.success("Report downloaded", {
        description: `${inScope.length} document${inScope.length === 1 ? "" : "s"} · ${range.label}`,
      })
    },
    [documents],
  )

  return (
    <div
      className="mx-auto max-w-[1300px] px-7 pb-14 pt-7"
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Home className="h-3 w-3" />
            <span>Home</span>
            <ChevronRight className="h-3 w-3 opacity-45" />
            <span>Documents</span>
          </div>
          <h1 className="text-[21px] font-semibold tracking-tight text-foreground">
            Document Library
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Manage, extract, and review your organization's documents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Download className="h-4 w-4" />
            Download report
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload document
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {/* Toolbar */}
      <div
        className="mb-3.5 flex items-center gap-2.5 rounded-[13px] border bg-card px-3.5 py-2.5"
        style={{ boxShadow: "0 1px 3px rgba(14,21,32,0.07)" }}
      >
        <div className="relative w-[280px] flex-shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="h-9 w-full rounded-md border bg-secondary px-3 pl-[33px] text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:bg-card"
          />
        </div>
        <div className="h-[22px] w-px flex-shrink-0 bg-border" />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as CombinedStatus | "")
            setPage(1)
          }}
          className="h-9 cursor-pointer rounded-md border bg-secondary px-2.5 text-[13px] text-muted-foreground outline-none transition-colors focus:border-primary"
        >
          <option value="">All status</option>
          <option value="processed">Processed</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="processing">Processing</option>
          <option value="pending">Pending</option>
          <option value="error">Error</option>
        </select>
        <span className="ml-auto whitespace-nowrap rounded-full border bg-secondary px-3 py-0.5 text-xs font-medium text-muted-foreground">
          {filtered.length} document{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Table card */}
      <div
        className={cn(
          "overflow-hidden rounded-[13px] border bg-card transition-colors",
          isDragging && "border-primary",
        )}
        style={{ boxShadow: "0 1px 3px rgba(14,21,32,0.07)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-secondary">
                <th className="w-11 px-4 py-2.5 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                </th>
                <Th>Name</Th>
                <Th>Size</Th>
                <Th>Last modified</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <th className="w-[100px]" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-16 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
                    Loading documents…
                  </td>
                </tr>
              ) : pageItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
                      <FileText className="h-6 w-6 text-muted-foreground/60" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {documents.length === 0
                        ? "No documents yet"
                        : "No matches found"}
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground/70">
                      {documents.length === 0
                        ? "Upload a PDF to get started. Drag and drop or use the upload button."
                        : "Try a different search term or status filter."}
                    </p>
                  </td>
                </tr>
              ) : (
                pageItems.map((d) => {
                  const ext = fileExt(d.original_filename)
                  const ownerName =
                    d.owner_name ||
                    d.owner_email ||
                    (d.owner_id ? "—" : user?.full_name || user?.email || "—")
                  const ownerInit =
                    ownerName
                      .split(/\s+/)
                      .map((s) => s[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() || "·"
                  const canOpen = d.status === "processed"
                  return (
                    <tr
                      key={d.id}
                      className="group border-b transition-colors last:border-b-0 hover:bg-[#f4f8fd]"
                    >
                      <td className="px-4">
                        <input
                          type="checkbox"
                          aria-label={`Select ${d.original_filename}`}
                          checked={selected.has(d.id)}
                          onChange={() => toggleOne(d.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <FileIcon ext={ext} />
                          <div className="min-w-0">
                            <div className="max-w-[240px] truncate text-[13.5px] font-medium text-foreground">
                              {d.original_filename}
                            </div>
                            <div
                              className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground"
                              style={{ fontFamily: '"DM Mono", monospace' }}
                            >
                              {ext}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td
                        className="px-4 text-[13px] text-muted-foreground"
                        style={{ fontFamily: '"DM Mono", monospace' }}
                      >
                        {formatBytes(d.file_size)}
                      </td>
                      <td className="px-4 text-[13px] text-muted-foreground">
                        {formatDate(d.created_at)}
                      </td>
                      <td className="px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold"
                            style={{
                              background: `${ownerColor}1a`,
                              color: ownerColor,
                            }}
                          >
                            {ownerInit}
                          </div>
                          <span className="whitespace-nowrap text-[13px] text-muted-foreground">
                            {ownerName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4">
                        <StatusBadge status={effectiveStatus(d)} />
                      </td>
                      <td className="px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!canOpen}
                            onClick={() =>
                              canOpen &&
                              navigate({
                                to: "/documents/$docId",
                                params: { docId: d.id },
                              })
                            }
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-primary disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-muted-foreground"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm(`Delete "${d.original_filename}"?`)) {
                                deleteMutation.mutate(d.id)
                              }
                            }}
                            className="inline-flex items-center justify-center rounded-md border bg-card p-1.5 text-muted-foreground transition-colors hover:border-red-500 hover:text-red-600"
                            aria-label="Delete document"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pager */}
        <div className="flex items-center justify-between border-t bg-secondary px-4 py-3">
          <span className="text-xs text-muted-foreground">
            Showing {showStart}–{showEnd} of {filtered.length} document
            {filtered.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-1">
            <PgBtn
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </PgBtn>
            {pageNumbers(safePage, totalPages).map((n, i) =>
              n === "..." ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: ellipsis indices are stable
                <span
                  key={`e${i}`}
                  className="px-1 text-[13px] text-muted-foreground"
                >
                  …
                </span>
              ) : (
                <PgBtn
                  key={n}
                  active={n === safePage}
                  onClick={() => setPage(n)}
                >
                  {n}
                </PgBtn>
              ),
            )}
            <PgBtn
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </PgBtn>
          </div>
        </div>
      </div>

      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <Upload className="mx-auto mb-3 h-12 w-12 animate-bounce text-primary" />
            <p className="text-lg font-semibold">Drop PDF files here</p>
          </div>
        </div>
      )}

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Download document report"
        description="Export the document library (filtered by upload date) as an Excel file."
        onGenerate={handleDownloadReport}
      />
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  )
}

function PgBtn({
  children,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "flex h-[30px] min-w-[30px] items-center justify-center rounded-md border px-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-40 disabled:hover:bg-card",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  )
}

function pageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  const arr: (number | "...")[] = []
  arr.push(1)
  if (current > 3) arr.push("...")
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) arr.push(i)
  if (current < total - 2) arr.push("...")
  arr.push(total)
  return arr
}
