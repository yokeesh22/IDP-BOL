import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  HardDrive,
  Home,
  Layers,
  Loader2,
  TrendingUp,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"

import { ReportDialog } from "@/components/Common/ReportDialog"
import { type DocumentMeta, fetchDocuments } from "@/lib/api"
import {
  downloadWorkbook,
  inRange,
  type ResolvedRange,
  rangeSlug,
} from "@/lib/report"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—"
  const d = parseUtc(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = s / 60
  if (m < 60) return `${m.toFixed(1)}m`
  return `${(m / 60).toFixed(1)}h`
}

type RangeKey = "all" | "7d" | "30d" | "90d"

const RANGE_LABELS: Record<RangeKey, string> = {
  all: "All time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
}

const RANGE_DAYS: Record<RangeKey, number | null> = {
  all: null,
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

interface Metrics {
  total: number
  processed: number
  processing: number
  pending: number
  errored: number
  approved: number
  rejected: number
  awaitingReview: number
  totalPages: number
  totalSize: number
  avgProcMs: number | null
  approvalRate: number
  reviewRate: number
  uploadsCurrent: number
  uploadsPrevious: number
}

function parseUtc(iso: string): Date {
  return new Date(
    iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`,
  )
}

function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function useFilteredDocs(
  docs: DocumentMeta[],
  range: RangeKey,
): DocumentMeta[] {
  return useMemo(() => {
    const days = RANGE_DAYS[range]
    if (days === null) return docs
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return docs.filter((d) => {
      if (!d.created_at) return false
      return parseUtc(d.created_at).getTime() >= cutoff
    })
  }, [docs, range])
}

function useMetrics(
  docs: DocumentMeta[],
  allDocs: DocumentMeta[],
  range: RangeKey,
): Metrics {
  return useMemo(() => {
    let processed = 0
    let processing = 0
    let pending = 0
    let errored = 0
    let approved = 0
    let rejected = 0
    let awaitingReview = 0
    let totalPages = 0
    let totalSize = 0
    let procSum = 0
    let procCount = 0

    for (const d of docs) {
      totalSize += d.file_size || 0
      totalPages += d.page_count || 0

      if (d.status === "processed") processed += 1
      else if (d.status === "processing") processing += 1
      else if (d.status === "pending") pending += 1
      else if (d.status === "error") errored += 1

      if (d.status === "processed") {
        if (d.review_status === "approved") approved += 1
        else if (d.review_status === "rejected") rejected += 1
        else awaitingReview += 1
      }

      if (d.created_at && d.processed_at) {
        const start = parseUtc(d.created_at).getTime()
        const end = parseUtc(d.processed_at).getTime()
        if (end > start) {
          procSum += end - start
          procCount += 1
        }
      }
    }

    // Compute trend windows from the full document set so trend works even on "all time".
    const days = RANGE_DAYS[range] ?? 7
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const currentCutoff = now - days * dayMs
    const previousCutoff = now - 2 * days * dayMs
    let uploadsCurrent = 0
    let uploadsPrevious = 0
    for (const d of allDocs) {
      if (!d.created_at) continue
      const t = parseUtc(d.created_at).getTime()
      if (t >= currentCutoff) uploadsCurrent += 1
      else if (t >= previousCutoff) uploadsPrevious += 1
    }

    const reviewed = approved + rejected
    return {
      total: docs.length,
      processed,
      processing,
      pending,
      errored,
      approved,
      rejected,
      awaitingReview,
      totalPages,
      totalSize,
      avgProcMs: procCount > 0 ? procSum / procCount : null,
      approvalRate: reviewed > 0 ? (approved / reviewed) * 100 : 0,
      reviewRate: processed > 0 ? (reviewed / processed) * 100 : 0,
      uploadsCurrent,
      uploadsPrevious,
    }
  }, [docs, allDocs, range])
}

function useUploadSeries(docs: DocumentMeta[], range: RangeKey) {
  return useMemo(() => {
    // Choose window length in days. For "all", span from earliest upload to today
    // (capped to 180 days to keep the chart readable).
    let days = RANGE_DAYS[range]
    if (days === null) {
      let earliest = Date.now()
      for (const d of docs) {
        if (!d.created_at) continue
        const t = parseUtc(d.created_at).getTime()
        if (t < earliest) earliest = t
      }
      const spanDays =
        Math.ceil((Date.now() - earliest) / (24 * 60 * 60 * 1000)) + 1
      days = Math.min(Math.max(spanDays, 14), 180)
    }

    const buckets: { date: string; label: string; uploads: number }[] = []
    const map = new Map<string, number>()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = localDayKey(d)
      const label = d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
      buckets.push({ date: key, label, uploads: 0 })
      map.set(key, buckets.length - 1)
    }

    for (const doc of docs) {
      if (!doc.created_at) continue
      // Convert UTC timestamp to the user's local calendar day so today's uploads
      // always land in today's bucket, regardless of timezone offset.
      const key = localDayKey(parseUtc(doc.created_at))
      const idx = map.get(key)
      if (idx !== undefined) buckets[idx].uploads += 1
    }
    return buckets
  }, [docs, range])
}

// Each status gets a from/to pair used to build a vertical SVG gradient inside the donut.
const STATUS_GRADIENTS: Record<
  string,
  { id: string; from: string; to: string; solid: string }
> = {
  Approved: {
    id: "pieApproved",
    from: "#22c55e",
    to: "#15803d",
    solid: "#16a34a",
  },
  Rejected: {
    id: "pieRejected",
    from: "#f87171",
    to: "#b91c1c",
    solid: "#dc2626",
  },
  "Awaiting review": {
    id: "pieAwaiting",
    from: "#60a5fa",
    to: "#0158aa",
    solid: "#016ac9",
  },
  Processing: {
    id: "pieProcessing",
    from: "#fbbf24",
    to: "#c2410c",
    solid: "#f59e0b",
  },
  Pending: {
    id: "piePending",
    from: "#cbd5e1",
    to: "#64748b",
    solid: "#94a3b8",
  },
  Error: { id: "pieError", from: "#fb7185", to: "#9f1239", solid: "#ef4444" },
}

export function Dashboard() {
  const [range, setRange] = useState<RangeKey>("all")
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
      return inflight ? 3000 : 15000
    },
  })

  const filtered = useFilteredDocs(documents, range)
  const m = useMetrics(filtered, documents, range)
  const series = useUploadSeries(filtered, range)

  const pieData = useMemo(
    () =>
      [
        { name: "Approved", value: m.approved },
        { name: "Rejected", value: m.rejected },
        { name: "Awaiting review", value: m.awaitingReview },
        { name: "Processing", value: m.processing },
        { name: "Pending", value: m.pending },
        { name: "Error", value: m.errored },
      ].filter((d) => d.value > 0),
    [m],
  )

  const uploadDelta = m.uploadsCurrent - m.uploadsPrevious
  const uploadTrendPct =
    m.uploadsPrevious > 0
      ? Math.round((uploadDelta / m.uploadsPrevious) * 100)
      : m.uploadsCurrent > 0
        ? 100
        : 0
  const trendWindowDays = RANGE_DAYS[range] ?? 7
  const trendWindowLabel =
    trendWindowDays === 7
      ? "week"
      : trendWindowDays === 30
        ? "month"
        : `${trendWindowDays}d`

  // Recent activity ignores the range filter — it always shows the latest uploads.
  const recent = useMemo(
    () =>
      [...documents]
        .sort((a, b) => {
          const ta = a.created_at ? parseUtc(a.created_at).getTime() : 0
          const tb = b.created_at ? parseUtc(b.created_at).getTime() : 0
          return tb - ta
        })
        .slice(0, 5),
    [documents],
  )

  const handleDownloadReport = useCallback(
    (reportRange: ResolvedRange) => {
      const scope = documents.filter((d) => inRange(d.created_at, reportRange))

      let processed = 0
      let processing = 0
      let pending = 0
      let errored = 0
      let approved = 0
      let rejected = 0
      let awaitingReview = 0
      let totalPages = 0
      let totalSize = 0
      let procSum = 0
      let procCount = 0

      for (const d of scope) {
        totalSize += d.file_size || 0
        totalPages += d.page_count || 0
        if (d.status === "processed") processed += 1
        else if (d.status === "processing") processing += 1
        else if (d.status === "pending") pending += 1
        else if (d.status === "error") errored += 1
        if (d.status === "processed") {
          if (d.review_status === "approved") approved += 1
          else if (d.review_status === "rejected") rejected += 1
          else awaitingReview += 1
        }
        if (d.created_at && d.processed_at) {
          const start = parseUtc(d.created_at).getTime()
          const end = parseUtc(d.processed_at).getTime()
          if (end > start) {
            procSum += end - start
            procCount += 1
          }
        }
      }

      const reviewed = approved + rejected
      const avgProcMs = procCount > 0 ? procSum / procCount : null
      const approvalRate = reviewed > 0 ? (approved / reviewed) * 100 : 0
      const reviewRate = processed > 0 ? (reviewed / processed) * 100 : 0

      const rows: (string | number)[][] = [
        ["Metric", "Value"],
        ["Time range", reportRange.label],
        ["Generated", new Date().toLocaleString("en-US")],
        ["Total documents", scope.length],
        ["Processed", processed],
        ["Processing", processing],
        ["Pending", pending],
        ["Errored", errored],
        ["Approved", approved],
        ["Rejected", rejected],
        ["Awaiting review", awaitingReview],
        ["Approval rate (%)", Number(approvalRate.toFixed(1))],
        ["Reviewed (%)", Number(reviewRate.toFixed(1))],
        ["Pages processed", totalPages],
        ["Storage used", formatBytes(totalSize)],
        [
          "Avg processing time",
          avgProcMs !== null ? formatDuration(avgProcMs) : "—",
        ],
      ]

      downloadWorkbook(`dashboard-${rangeSlug(reportRange)}.xlsx`, [
        { name: "Dashboard", rows },
      ])
      toast.success("Report downloaded", {
        description: `${scope.length} document${scope.length === 1 ? "" : "s"} · ${reportRange.label}`,
      })
    },
    [documents],
  )

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-[1300px] items-center justify-center px-7 py-32">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Loading dashboard…
        </span>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1300px] px-7 pb-14 pt-7">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Home className="h-3 w-3" />
            <span>Home</span>
            <ChevronRight className="h-3 w-3 opacity-45" />
            <span>Dashboard</span>
          </div>
          <h1 className="text-[21px] font-semibold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Review key document metrics and recent processing activity across
            your organization.
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
          <RangeSelector value={range} onChange={setRange} />
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<FileText className="h-[18px] w-[18px]" />}
          iconBg="#e8f2fc"
          iconColor="#016ac9"
          label="Total documents"
          value={m.total.toLocaleString()}
          sub={
            uploadDelta !== 0 ? (
              <TrendBadge
                value={uploadTrendPct}
                positive={uploadDelta >= 0}
                windowLabel={trendWindowLabel}
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                {m.uploadsCurrent} this {trendWindowLabel}
              </span>
            )
          }
        />
        <KpiCard
          icon={<Clock className="h-[18px] w-[18px]" />}
          iconBg="#fff7ed"
          iconColor="#c2410c"
          label="Awaiting review"
          value={m.awaitingReview.toLocaleString()}
          sub={
            <span className="text-xs text-muted-foreground">
              {m.processed > 0
                ? `${Math.round(m.reviewRate)}% reviewed`
                : "No processed docs"}
            </span>
          }
        />
        <KpiCard
          icon={<CheckCircle2 className="h-[18px] w-[18px]" />}
          iconBg="#f0fdf4"
          iconColor="#15803d"
          label="Approval rate"
          value={`${Math.round(m.approvalRate)}%`}
          sub={
            <span className="text-xs text-muted-foreground">
              {m.approved} approved · {m.rejected} rejected
            </span>
          }
        />
        <KpiCard
          icon={<Layers className="h-[18px] w-[18px]" />}
          iconBg="#f5f3ff"
          iconColor="#7c3aed"
          label="Pages processed"
          value={m.totalPages.toLocaleString()}
          sub={
            <span className="text-xs text-muted-foreground">
              across {m.processed} document{m.processed === 1 ? "" : "s"}
            </span>
          }
        />
      </div>

      {/* Charts row */}
      <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        {/* Uploads area chart */}
        <Card className="lg:col-span-2">
          <div className="flex items-start justify-between px-5 pt-4">
            <div>
              <div className="text-[13.5px] font-semibold text-foreground">
                Uploads over time
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {RANGE_LABELS[range]}
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              {m.uploadsCurrent} this {trendWindowLabel}
            </div>
          </div>
          <div className="h-[240px] px-2 pb-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={series}
                margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="uploadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#016ac9" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#016ac9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e2e8f0"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={28}
                />
                <Tooltip
                  cursor={{
                    stroke: "#016ac9",
                    strokeWidth: 1,
                    strokeOpacity: 0.3,
                  }}
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    fontSize: 12,
                    boxShadow: "0 4px 16px rgba(14,21,32,0.08)",
                  }}
                  labelStyle={{ color: "#64748b", fontWeight: 500 }}
                  formatter={(v) => [v as number, "Uploads"]}
                />
                <Area
                  type="monotone"
                  dataKey="uploads"
                  stroke="#016ac9"
                  strokeWidth={2}
                  fill="url(#uploadFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Status donut */}
        <Card>
          <div className="px-5 pt-4">
            <div className="text-[13.5px] font-semibold text-foreground">
              Status distribution
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Current breakdown across all documents
            </div>
          </div>
          <div className="flex items-center gap-3 px-3 pb-4 pt-2">
            <div className="relative h-[180px] w-[180px] flex-shrink-0">
              {pieData.length === 0 ? (
                <div className="flex h-full w-full items-center justify-center rounded-full border-2 border-dashed border-border text-xs text-muted-foreground">
                  No data
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <defs>
                        {Object.values(STATUS_GRADIENTS).map((g) => (
                          <linearGradient
                            key={g.id}
                            id={g.id}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={g.from}
                              stopOpacity={1}
                            />
                            <stop
                              offset="100%"
                              stopColor={g.to}
                              stopOpacity={1}
                            />
                          </linearGradient>
                        ))}
                      </defs>
                      <Pie
                        data={pieData}
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="#ffffff"
                        strokeWidth={2}
                        isAnimationActive={false}
                      >
                        {pieData.map((entry) => {
                          const g = STATUS_GRADIENTS[entry.name]
                          return (
                            <Cell key={entry.name} fill={`url(#${g.id})`} />
                          )
                        })}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-[22px] font-semibold leading-none text-foreground">
                      {m.total}
                    </div>
                    <div className="mt-1 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                      total
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {pieData.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  Upload documents to see breakdown
                </span>
              ) : (
                pieData.map((d) => {
                  const g = STATUS_GRADIENTS[d.name]
                  return (
                    <div
                      key={d.name}
                      className="flex items-center gap-2 text-[12.5px]"
                    >
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{
                          background: `linear-gradient(180deg, ${g.from}, ${g.to})`,
                        }}
                      />
                      <span className="truncate text-muted-foreground">
                        {d.name}
                      </span>
                      <span className="ml-auto font-medium text-foreground">
                        {d.value}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom row: secondary stats + recent activity */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <Card>
          <div className="px-5 pt-4">
            <div className="text-[13.5px] font-semibold text-foreground">
              Processing health
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Pipeline performance & storage
            </div>
          </div>
          <div className="space-y-3.5 px-5 pb-5 pt-3">
            <MiniStat
              icon={<Clock className="h-4 w-4" />}
              iconColor="#016ac9"
              label="Avg processing time"
              value={m.avgProcMs !== null ? formatDuration(m.avgProcMs) : "—"}
            />
            <MiniStat
              icon={<HardDrive className="h-4 w-4" />}
              iconColor="#7c3aed"
              label="Storage used"
              value={formatBytes(m.totalSize)}
            />
            <MiniStat
              icon={<Loader2 className="h-4 w-4" />}
              iconColor="#f59e0b"
              label="In progress"
              value={(m.processing + m.pending).toString()}
              sub={`${m.processing} processing · ${m.pending} pending`}
            />
            <MiniStat
              icon={<XCircle className="h-4 w-4" />}
              iconColor="#dc2626"
              label="Failed"
              value={m.errored.toString()}
              sub={
                m.total > 0
                  ? `${((m.errored / m.total) * 100).toFixed(1)}% of total`
                  : undefined
              }
            />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <div className="text-[13.5px] font-semibold text-foreground">
                Recent activity
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Latest uploads across your library
              </div>
            </div>
            <Link
              to="/documents"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-[color:var(--brand-primary-hover)]"
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="px-2 pb-2 pt-2">
            {recent.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
                  <FileText className="h-5 w-5 text-muted-foreground/60" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  No documents yet
                </p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground/70">
                  Upload a PDF to start tracking metrics here.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col">
                {recent.map((d) => (
                  <ActivityRow key={d.id} doc={d} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Download dashboard report"
        description="Export dashboard metrics and underlying documents as an Excel file."
        initialRange={range}
        onGenerate={handleDownloadReport}
      />
    </div>
  )
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`overflow-hidden rounded-[13px] border bg-card ${className ?? ""}`}
      style={{ boxShadow: "0 1px 3px rgba(14,21,32,0.07)" }}
    >
      {children}
    </div>
  )
}

function KpiCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  value: string
  sub?: React.ReactNode
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-[10px]"
            style={{ background: iconBg, color: iconColor }}
          >
            {icon}
          </div>
        </div>
        <div>
          <div className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-foreground">
            {value}
          </div>
          {sub && <div className="mt-2">{sub}</div>}
        </div>
      </div>
    </Card>
  )
}

function TrendBadge({
  value,
  positive,
  windowLabel,
}: {
  value: number
  positive: boolean
  windowLabel: string
}) {
  const color = positive ? "#15803d" : "#b91c1c"
  const bg = positive ? "#f0fdf4" : "#fef2f2"
  const border = positive ? "#bbf7d0" : "#fecaca"
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ background: bg, color, borderColor: border }}
    >
      <ArrowUpRight
        className="h-3 w-3"
        style={{ transform: positive ? undefined : "rotate(90deg)" }}
      />
      {Math.abs(value)}% vs prior {windowLabel}
    </span>
  )
}

function RangeSelector({
  value,
  onChange,
}: {
  value: RangeKey
  onChange: (v: RangeKey) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  const options: RangeKey[] = ["all", "7d", "30d", "90d"]

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        style={{ boxShadow: "0 1px 2px rgba(14,21,32,0.04)" }}
      >
        <Calendar className="h-4 w-4 text-muted-foreground" />
        {RANGE_LABELS[value]}
        <ChevronDown
          className="h-3.5 w-3.5 text-muted-foreground transition-transform"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-[170px] overflow-hidden rounded-lg border bg-popover p-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {options.map((opt) => {
            const active = opt === value
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {RANGE_LABELS[opt]}
                {active && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--brand-primary)" }}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MiniStat({
  icon,
  iconColor,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  iconColor: string
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
        style={{ background: `${iconColor}14`, color: iconColor }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-muted-foreground">{label}</div>
        {sub && (
          <div className="mt-0.5 text-[11px] text-muted-foreground/75">
            {sub}
          </div>
        )}
      </div>
      <div
        className="text-[14px] font-normal tabular-nums text-foreground/85"
        style={{ fontFamily: '"DM Mono", monospace' }}
      >
        {value}
      </div>
    </div>
  )
}

function ActivityRow({ doc }: { doc: DocumentMeta }) {
  const canOpen = doc.status === "processed"
  const status =
    doc.status === "processed" && doc.review_status
      ? doc.review_status
      : doc.status
  const statusStyles: Record<string, { bg: string; color: string }> = {
    processed: { bg: "#f1f5f9", color: "#475569" },
    processing: { bg: "#eff6ff", color: "#1d4ed8" },
    pending: { bg: "#fff7ed", color: "#c2410c" },
    error: { bg: "#fef2f2", color: "#b91c1c" },
    approved: { bg: "#f0fdf4", color: "#15803d" },
    rejected: { bg: "#fef2f2", color: "#b91c1c" },
  }
  const s = statusStyles[status] || statusStyles.processed
  const label = status.charAt(0).toUpperCase() + status.slice(1)

  const content = (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[#f4f8fd]">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] bg-[#fef2f2]">
        <FileText className="h-[18px] w-[18px]" style={{ color: "#dc2626" }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">
          {doc.original_filename}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
          {formatRelative(doc.created_at)}
          {doc.page_count > 0 ? ` · ${doc.page_count} pages` : ""}
        </div>
      </div>
      <span
        className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ background: s.bg, color: s.color }}
      >
        {label}
      </span>
      {canOpen && (
        <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      )}
    </div>
  )

  if (canOpen) {
    return (
      <li>
        <Link
          to="/documents/$docId"
          params={{ docId: doc.id }}
          className="block no-underline"
        >
          {content}
        </Link>
      </li>
    )
  }
  return <li>{content}</li>
}

export default Dashboard
