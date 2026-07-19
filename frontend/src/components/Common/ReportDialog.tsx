import { Download } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { ResolvedRange } from "@/lib/report"
import { cn } from "@/lib/utils"

export type RangeKey = "all" | "7d" | "30d" | "90d"

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
]

const PRESET_DAYS: Record<RangeKey, number | null> = {
  all: null,
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

interface ReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  /** Preset preselected when the dialog opens (usually the page's current range). */
  initialRange?: RangeKey
  /** Called with the resolved time range when the user clicks download. */
  onGenerate: (range: ResolvedRange) => void
}

export function ReportDialog({
  open,
  onOpenChange,
  title = "Download report",
  description = "Choose a time range, then export the data as an Excel workbook.",
  initialRange = "all",
  onGenerate,
}: ReportDialogProps) {
  const [preset, setPreset] = useState<RangeKey>(initialRange)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const usingCustom = from !== "" || to !== ""

  const resolved = useMemo<ResolvedRange>(() => {
    if (usingCustom) {
      const fromDate = from ? startOfDay(new Date(from)) : null
      const toDate = to ? endOfDay(new Date(to)) : null
      const label =
        from && to ? `${from} to ${to}` : from ? `From ${from}` : `Until ${to}`
      return { from: fromDate, to: toDate, label }
    }
    const days = PRESET_DAYS[preset]
    if (days === null) return { from: null, to: null, label: "All time" }
    const now = new Date()
    return {
      from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
      to: now,
      label: PRESETS.find((p) => p.key === preset)?.label ?? "Custom range",
    }
  }, [usingCustom, from, to, preset])

  const invalidCustom =
    usingCustom && from && to && new Date(from) > new Date(to)

  const handleDownload = () => {
    if (invalidCustom) return
    onGenerate(resolved)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Quick range
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => {
                const active = !usingCustom && preset === p.key
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      setPreset(p.key)
                      setFrom("")
                      setTo("")
                    }}
                    className={cn(
                      "h-9 rounded-md border px-3 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Or custom range
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 flex-1 rounded-md border bg-card px-2.5 text-sm outline-none focus:border-primary"
                aria-label="From date"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 flex-1 rounded-md border bg-card px-2.5 text-sm outline-none focus:border-primary"
                aria-label="To date"
              />
            </div>
            {invalidCustom ? (
              <p className="text-xs text-destructive">
                The start date must be on or before the end date.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Exporting: <span className="font-medium">{resolved.label}</span>
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={!!invalidCustom}>
            <Download className="h-4 w-4" />
            Download Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ReportDialog
