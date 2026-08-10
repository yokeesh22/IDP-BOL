import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpRight,
  Calendar,
  ChevronDown,
  ChevronRight,
  Coins,
  DollarSign,
  Download,
  Home,
  Loader2,
  ScanText,
  Sparkles,
  TrendingUp,
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
import { fetchMeteringSummary, type MeteringRecord } from "@/lib/api"
import {
  downloadWorkbook,
  inRange,
  type ResolvedRange,
  rangeSlug,
} from "@/lib/report"

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

const DI_COLOR = "#016ac9"
const AI_COLOR = "#7c3aed"

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

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function useFilteredRecords(
  records: MeteringRecord[],
  range: RangeKey,
): MeteringRecord[] {
  return useMemo(() => {
    const days = RANGE_DAYS[range]
    if (days === null) return records
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return records.filter((r) => {
      if (!r.date) return false
      return parseUtc(r.date).getTime() >= cutoff
    })
  }, [records, range])
}

interface Metrics {
  totalCost: number
  diCost: number
  aiCost: number
  pages: number
  inputTokens: number
  outputTokens: number
  docCount: number
  chatCount: number
  docCost: number
  costCurrent: number
  costPrevious: number
}

function useMetrics(
  records: MeteringRecord[],
  allRecords: MeteringRecord[],
  range: RangeKey,
): Metrics {
  return useMemo(() => {
    let diCost = 0
    let aiCost = 0
    let pages = 0
    let inputTokens = 0
    let outputTokens = 0
    let docCount = 0
    let chatCount = 0
    let docCost = 0

    for (const r of records) {
      diCost += r.di_cost
      aiCost += r.ai_cost
      pages += r.pages
      inputTokens += r.input_tokens
      outputTokens += r.output_tokens
      if (r.kind === "document") {
        docCount += 1
        docCost += r.cost
      } else {
        chatCount += 1
      }
    }

    // Trend windows from the full record set (works even on "all time").
    const days = RANGE_DAYS[range] ?? 7
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const currentCutoff = now - days * dayMs
    const previousCutoff = now - 2 * days * dayMs
    let costCurrent = 0
    let costPrevious = 0
    for (const r of allRecords) {
      if (!r.date) continue
      const t = parseUtc(r.date).getTime()
      if (t >= currentCutoff) costCurrent += r.cost
      else if (t >= previousCutoff) costPrevious += r.cost
    }

    return {
      totalCost: diCost + aiCost,
      diCost,
      aiCost,
      pages,
      inputTokens,
      outputTokens,
      docCount,
      chatCount,
      docCost,
      costCurrent,
      costPrevious,
    }
  }, [records, allRecords, range])
}

function useCostSeries(records: MeteringRecord[], range: RangeKey) {
  return useMemo(() => {
    let days = RANGE_DAYS[range]
    if (days === null) {
      let earliest = Date.now()
      for (const r of records) {
        if (!r.date) continue
        const t = parseUtc(r.date).getTime()
        if (t < earliest) earliest = t
      }
      const spanDays =
        Math.ceil((Date.now() - earliest) / (24 * 60 * 60 * 1000)) + 1
      days = Math.min(Math.max(spanDays, 14), 180)
    }

    const buckets: { date: string; label: string; di: number; ai: number }[] =
      []
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
      buckets.push({ date: key, label, di: 0, ai: 0 })
      map.set(key, buckets.length - 1)
    }

    for (const r of records) {
      if (!r.date) continue
      const key = localDayKey(parseUtc(r.date))
      const idx = map.get(key)
      if (idx !== undefined) {
        buckets[idx].di += r.di_cost
        buckets[idx].ai += r.ai_cost
      }
    }
    return buckets
  }, [records, range])
}

export function Metering() {
  const [range, setRange] = useState<RangeKey>("all")
  const [reportOpen, setReportOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["metering"],
    queryFn: fetchMeteringSummary,
    refetchInterval: 30000,
  })

  const records = useMemo(() => data?.records ?? [], [data])
  const currency = data?.rates.currency ?? "USD"

  const handleDownloadReport = useCallback(
    (reportRange: ResolvedRange) => {
      const scoped = records.filter((r) => inRange(r.date, reportRange))
      let diCost = 0
      let aiCost = 0
      let pages = 0
      let inTok = 0
      let outTok = 0
      let docCount = 0
      let chatCount = 0
      for (const r of scoped) {
        diCost += r.di_cost
        aiCost += r.ai_cost
        pages += r.pages
        inTok += r.input_tokens
        outTok += r.output_tokens
        if (r.kind === "document") docCount += 1
        else chatCount += 1
      }
      const rows: (string | number)[][] = [
        [
          "Date",
          "Kind",
          "Label",
          "Pages",
          "Input tokens",
          "Output tokens",
          `DI cost (${currency})`,
          `AI cost (${currency})`,
          `Total cost (${currency})`,
        ],
      ]
      for (const r of scoped) {
        rows.push([
          r.date ? parseUtc(r.date).toLocaleString("en-US") : "",
          r.kind,
          r.label,
          r.pages,
          r.input_tokens,
          r.output_tokens,
          Number(r.di_cost.toFixed(6)),
          Number(r.ai_cost.toFixed(6)),
          Number(r.cost.toFixed(6)),
        ])
      }
      rows.push([
        "TOTAL",
        `${docCount} doc / ${chatCount} chat`,
        "",
        pages,
        inTok,
        outTok,
        Number(diCost.toFixed(6)),
        Number(aiCost.toFixed(6)),
        Number((diCost + aiCost).toFixed(6)),
      ])

      downloadWorkbook(`metering-${rangeSlug(reportRange)}.xlsx`, [
        { name: "Metering", rows },
      ])
      toast.success("Report downloaded", {
        description: `${scoped.length} record${scoped.length === 1 ? "" : "s"} · ${reportRange.label}`,
      })
    },
    [records, currency],
  )

  const filtered = useFilteredRecords(records, range)
  const m = useMetrics(filtered, records, range)
  const series = useCostSeries(filtered, range)

  const pieData = useMemo(
    () =>
      [
        { name: "Document Intelligence", value: m.diCost, color: DI_COLOR },
        { name: "AI usage", value: m.aiCost, color: AI_COLOR },
      ].filter((d) => d.value > 0),
    [m],
  )

  const costDelta = m.costCurrent - m.costPrevious
  const costTrendPct =
    m.costPrevious > 0
      ? Math.round((costDelta / m.costPrevious) * 100)
      : m.costCurrent > 0
        ? 100
        : 0
  const trendWindowDays = RANGE_DAYS[range] ?? 7
  const trendWindowLabel =
    trendWindowDays === 7
      ? "week"
      : trendWindowDays === 30
        ? "month"
        : `${trendWindowDays}d`

  const avgCostPerDoc = m.docCount > 0 ? m.docCost / m.docCount : 0

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-[1300px] items-center justify-center px-4 py-32 sm:px-6 lg:px-7">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading metering…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1300px] px-4 pb-14 pt-7 sm:px-6 lg:px-7">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Home className="h-3 w-3" />
            <span>Home</span>
            <ChevronRight className="h-3 w-3 opacity-45" />
            <span>Metering</span>
          </div>
          <h1 className="text-[21px] font-semibold tracking-tight text-foreground">
            Metering
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Estimated usage cost for Document Intelligence and AI across
            processed documents and assistant activity.
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
          icon={<DollarSign className="h-[18px] w-[18px]" />}
          iconBg="#ecfdf5"
          iconColor="#059669"
          label="Total estimated cost"
          value={formatMoney(m.totalCost, currency)}
          sub={
            costDelta !== 0 ? (
              <TrendBadge
                value={costTrendPct}
                positive={costDelta < 0}
                windowLabel={trendWindowLabel}
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                {formatMoney(m.costCurrent, currency)} this {trendWindowLabel}
              </span>
            )
          }
        />
        <KpiCard
          icon={<ScanText className="h-[18px] w-[18px]" />}
          iconBg="#e8f2fc"
          iconColor="#016ac9"
          label="Document Intelligence"
          value={formatMoney(m.diCost, currency)}
          sub={
            <span className="text-xs text-muted-foreground">
              {m.pages.toLocaleString()} page{m.pages === 1 ? "" : "s"}{" "}
              processed
            </span>
          }
        />
        <KpiCard
          icon={<Sparkles className="h-[18px] w-[18px]" />}
          iconBg="#f5f3ff"
          iconColor="#7c3aed"
          label="AI usage"
          value={formatMoney(m.aiCost, currency)}
          sub={
            <span className="text-xs text-muted-foreground">
              {formatTokens(m.inputTokens + m.outputTokens)} tokens
            </span>
          }
        />
        <KpiCard
          icon={<Coins className="h-[18px] w-[18px]" />}
          iconBg="#fff7ed"
          iconColor="#c2410c"
          label="Avg cost / document"
          value={formatMoney(avgCostPerDoc, currency)}
          sub={
            <span className="text-xs text-muted-foreground">
              {formatMoney(m.docCost, currency)} across documents
            </span>
          }
        />
      </div>

      {/* Charts row */}
      <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        {/* Cost over time */}
        <Card className="lg:col-span-2">
          <div className="flex items-start justify-between px-5 pt-4">
            <div>
              <div className="text-[13.5px] font-semibold text-foreground">
                Cost over time
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {RANGE_LABELS[range]}
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              {formatMoney(m.costCurrent, currency)} this {trendWindowLabel}
            </div>
          </div>
          <div className="h-[240px] px-2 pb-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={series}
                margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="diFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={DI_COLOR} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={DI_COLOR} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="aiFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={AI_COLOR} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={AI_COLOR} stopOpacity={0} />
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
                  width={48}
                  tickFormatter={(v) => formatMoney(v as number, currency)}
                />
                <Tooltip
                  cursor={{
                    stroke: DI_COLOR,
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
                  formatter={(v, name) => [
                    formatMoney(v as number, currency),
                    name === "di" ? "Document Intelligence" : "AI usage",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="di"
                  stackId="cost"
                  stroke={DI_COLOR}
                  strokeWidth={2}
                  fill="url(#diFill)"
                />
                <Area
                  type="monotone"
                  dataKey="ai"
                  stackId="cost"
                  stroke={AI_COLOR}
                  strokeWidth={2}
                  fill="url(#aiFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Cost breakdown donut */}
        <Card>
          <div className="px-5 pt-4">
            <div className="text-[13.5px] font-semibold text-foreground">
              Cost breakdown
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              By service
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
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-[16px] font-semibold leading-none text-foreground">
                      {formatMoney(m.totalCost, currency)}
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
                  Process documents to see a breakdown
                </span>
              ) : (
                pieData.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center gap-2 text-[12.5px]"
                  >
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ background: d.color }}
                    />
                    <span className="truncate text-muted-foreground">
                      {d.name}
                    </span>
                    <span className="ml-auto font-medium text-foreground">
                      {formatMoney(d.value, currency)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom row: usage details + rate card */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <Card>
          <div className="px-5 pt-4">
            <div className="text-[13.5px] font-semibold text-foreground">
              Usage details
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Metered units this period
            </div>
          </div>
          <div className="space-y-3.5 px-5 pb-5 pt-3">
            <MiniStat
              icon={<ScanText className="h-4 w-4" />}
              iconColor={DI_COLOR}
              label="Pages processed"
              value={m.pages.toLocaleString()}
            />
            <MiniStat
              icon={<Sparkles className="h-4 w-4" />}
              iconColor={AI_COLOR}
              label="Input tokens"
              value={formatTokens(m.inputTokens)}
            />
            <MiniStat
              icon={<Sparkles className="h-4 w-4" />}
              iconColor="#a855f7"
              label="Output tokens"
              value={formatTokens(m.outputTokens)}
            />
            <MiniStat
              icon={<Coins className="h-4 w-4" />}
              iconColor="#059669"
              label="Avg cost / document"
              value={formatMoney(avgCostPerDoc, currency)}
              sub={`${m.chatCount} chat repl${m.chatCount === 1 ? "y" : "ies"} metered`}
            />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <div className="text-[13.5px] font-semibold text-foreground">
                Rate card
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                List prices in {currency} · as of {data?.rates.as_of ?? "—"}
              </div>
            </div>
          </div>
          <div className="px-2 pb-4 pt-2">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Service</th>
                  <th className="px-3 py-2 font-semibold">Unit</th>
                  <th className="px-3 py-2 text-right font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody>
                <RateRow
                  color={DI_COLOR}
                  service="Document Intelligence"
                  unit="per 1,000 pages"
                  rate={formatMoney(
                    data?.rates.doc_intelligence_per_1k_pages ?? 0,
                    currency,
                  )}
                />
                <RateRow
                  color={AI_COLOR}
                  service="AI usage — input"
                  unit="per 1,000,000 tokens"
                  rate={formatMoney(
                    data?.rates.ai_input_per_1m_tokens ?? 0,
                    currency,
                  )}
                />
                <RateRow
                  color="#a855f7"
                  service="AI usage — output"
                  unit="per 1,000,000 tokens"
                  rate={formatMoney(
                    data?.rates.ai_output_per_1m_tokens ?? 0,
                    currency,
                  )}
                />
              </tbody>
            </table>
            <p className="px-3 pt-3 text-[11px] text-muted-foreground/75">
              Costs are estimates based on the rates above and measured usage
              (pages analysed and AI tokens consumed). Actual invoiced amounts
              may differ with committed-tier discounts or region.
            </p>
          </div>
        </Card>
      </div>

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Download metering report"
        description="Export usage cost (summary + line items) as an Excel file."
        initialRange={range}
        onGenerate={handleDownloadReport}
      />
    </div>
  )
}

function RateRow({
  color,
  service,
  unit,
  rate,
}: {
  color: string
  service: string
  unit: string
  rate: string
}) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span className="font-medium text-foreground">{service}</span>
        </span>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{unit}</td>
      <td
        className="px-3 py-2.5 text-right font-medium tabular-nums text-foreground/85"
        style={{ fontFamily: '"DM Mono", monospace' }}
      >
        {rate}
      </td>
    </tr>
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
  // `positive` here means "good" (cost went down) → green.
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
        style={{ transform: positive ? "rotate(90deg)" : undefined }}
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

export default Metering
