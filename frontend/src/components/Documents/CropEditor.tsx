import { Check, Loader2, Scan, SquareDashed, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  DEFAULT_QUAD,
  detectDocumentQuad,
  type Pt,
  type Quad,
  warpQuadToCanvas,
} from "@/lib/docScan"

type CornerKey = "topLeft" | "topRight" | "bottomRight" | "bottomLeft"

const CORNER_ORDER: CornerKey[] = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
]

interface CropEditorProps {
  src: string
  /** Called with the perspective-corrected page as a JPEG data URL. */
  onConfirm: (dataUrl: string) => void
  /** Called with the original (uncropped) image when the user skips cropping. */
  onSkip: (dataUrl: string) => void
  /** Called when the user wants to discard and re-capture. */
  onCancel: () => void
}

export function CropEditor({
  src,
  onConfirm,
  onSkip,
  onCancel,
}: CropEditorProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const draggingRef = useRef<CornerKey | null>(null)
  // Set once the user manually moves a corner, so a slow async auto-detect
  // result doesn't clobber their adjustment.
  const touchedRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [detecting, setDetecting] = useState(true)
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD)

  // Load the capture into a natural-size canvas (used for detection + warp).
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setDetecting(true)
    const img = new Image()
    img.onload = async () => {
      if (cancelled) return
      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.drawImage(img, 0, 0)
      canvasRef.current = canvas
      setReady(true)
      const detected = await detectDocumentQuad(canvas)
      if (cancelled) return
      // Respect any manual adjustment made while detection was in flight.
      if (!touchedRef.current) setQuad(detected ?? DEFAULT_QUAD)
      setDetecting(false)
    }
    img.onerror = () => {
      if (!cancelled) {
        setReady(true)
        setDetecting(false)
      }
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])

  const pointToNorm = useCallback((clientX: number, clientY: number): Pt => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    }
  }, [])

  // Global pointer handlers so dragging keeps working outside the handle.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const key = draggingRef.current
      if (!key) return
      e.preventDefault()
      const p = pointToNorm(e.clientX, e.clientY)
      setQuad((prev) => ({ ...prev, [key]: p }))
    }
    const onUp = () => {
      draggingRef.current = null
    }
    window.addEventListener("pointermove", onMove, { passive: false })
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [pointToNorm])

  const runAutoDetect = useCallback(async () => {
    if (!canvasRef.current) return
    touchedRef.current = false
    setDetecting(true)
    const detected = await detectDocumentQuad(canvasRef.current)
    setQuad(detected ?? DEFAULT_QUAD)
    setDetecting(false)
    if (!detected) {
      toast.info("No document detected", {
        description: "Drag the corners to frame the page manually.",
      })
    }
  }, [])

  const handleConfirm = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const result = warpQuadToCanvas(canvas, quad)
      onConfirm(result.toDataURL("image/jpeg", 0.92))
    } catch (err) {
      toast.error("Could not crop page", {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [quad, onConfirm])

  const poly = CORNER_ORDER.map((k) => `${quad[k].x},${quad[k].y}`).join(" ")
  const maskPath =
    `M0,0 H1 V1 H0 Z ` +
    `M${quad.topLeft.x},${quad.topLeft.y} ` +
    `L${quad.bottomLeft.x},${quad.bottomLeft.y} ` +
    `L${quad.bottomRight.x},${quad.bottomRight.y} ` +
    `L${quad.topRight.x},${quad.topRight.y} Z`

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
          aria-label="Discard and retake"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-sm font-medium">Adjust borders</div>
        <button
          type="button"
          onClick={runAutoDetect}
          disabled={detecting || !ready}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-medium transition-colors hover:bg-white/20 disabled:opacity-50"
          aria-label="Auto-detect document"
        >
          {detecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Scan className="h-4 w-4" />
          )}
          Auto
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        <div ref={boxRef} className="relative touch-none">
          <img
            src={src}
            alt="Captured page"
            draggable={false}
            className="block max-h-[68vh] max-w-full select-none"
          />

          {/* Overlay: dim outside the quad + outline */}
          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <title>Document border overlay</title>
            <path
              d={maskPath}
              fill="black"
              fillOpacity="0.5"
              fillRule="evenodd"
            />
            <polygon
              points={poly}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Corner handles */}
          {CORNER_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={`Adjust ${key} corner`}
              onPointerDown={(e) => {
                e.preventDefault()
                draggingRef.current = key
                touchedRef.current = true
              }}
              style={{
                left: `${quad[key].x * 100}%`,
                top: `${quad[key].y * 100}%`,
              }}
              className="absolute z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-primary/80 shadow-md ring-2 ring-primary/30 transition-transform active:scale-110"
            />
          ))}

          {detecting && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Detecting document…
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between gap-2 px-5 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          Retake
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSkip(src)}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/5 px-3.5 py-2 text-sm font-medium transition-colors hover:bg-white/15"
          >
            <SquareDashed className="h-4 w-4" />
            Skip crop
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!ready}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            Use scan
          </button>
        </div>
      </div>
    </div>
  )
}
