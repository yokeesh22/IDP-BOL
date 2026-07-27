import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FileText,
  ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  SwitchCamera,
  Trash2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  buildScanPdf,
  cssFilterFor,
  defaultScanFilename,
  renderPagePreview,
  SCAN_FILTERS,
  type ScanFilter,
  type ScanPage,
} from "@/lib/scan"
import { cn } from "@/lib/utils"

type View = "camera" | "review"

interface ScanDialogProps {
  open: boolean
  onClose: () => void
  /** Called with the assembled PDF once the user finalizes the scan. */
  onComplete: (file: File) => void
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `p_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function ScanDialog({ open, onClose, onComplete }: ScanDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [view, setView] = useState<View>("camera")
  const [pages, setPages] = useState<ScanPage[]>([])
  const [filter, setFilter] = useState<ScanFilter>("color")
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  )
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [retakeId, setRetakeId] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const stopCamera = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const startCamera = useCallback(
    async (facing: "environment" | "user") => {
      stopCamera()
      setStarting(true)
      setCameraError(null)
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is not supported in this browser")
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        // Detect whether a front/back toggle makes sense.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const cams = devices.filter((d) => d.kind === "videoinput")
          setHasMultipleCameras(cams.length > 1)
        } catch {
          setHasMultipleCameras(false)
        }
      } catch (err) {
        const msg =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access or import an image instead."
            : err instanceof Error
              ? err.message
              : "Could not access the camera."
        setCameraError(msg)
      } finally {
        setStarting(false)
      }
    },
    [stopCamera],
  )

  // Manage the camera lifecycle: run only while the dialog is open and the
  // camera view is active.
  useEffect(() => {
    if (open && view === "camera") {
      void startCamera(facingMode)
    } else {
      stopCamera()
    }
    return stopCamera
  }, [open, view, facingMode, startCamera, stopCamera])

  // Reset everything when the dialog is closed so a fresh scan starts clean.
  useEffect(() => {
    if (!open) {
      setView("camera")
      setPages([])
      setFilter("color")
      setRetakeId(null)
      setBuilding(false)
      setPreviews({})
      setCameraError(null)
    }
  }, [open])

  // Lock background scroll while the full-screen scanner is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Regenerate previews that exactly match the exported PDF (rotation + filter).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const page of pages) {
        const key = `${page.id}:${page.rotation}:${filter}`
        if (previews[key]) continue
        try {
          const url = await renderPagePreview(page, filter)
          if (cancelled) return
          setPreviews((prev) => ({ ...prev, [key]: url }))
        } catch {
          // Ignore preview failures; the raw capture still uploads fine.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pages, filter, previews])

  const previewFor = (page: ScanPage): string =>
    previews[`${page.id}:${page.rotation}:${filter}`] ?? page.src

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const src = canvas.toDataURL("image/jpeg", 0.92)

    if (retakeId) {
      setPages((prev) =>
        prev.map((p) => (p.id === retakeId ? { ...p, src, rotation: 0 } : p)),
      )
      setRetakeId(null)
      setView("review")
    } else {
      setPages((prev) => [...prev, { id: newId(), src, rotation: 0 }])
    }
  }, [retakeId])

  const handleImport = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      const images = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      )
      if (images.length === 0) {
        toast.error("No images selected", {
          description: "Import JPG or PNG images to add them as pages.",
        })
        return
      }
      let remaining = images.length
      images.forEach((file) => {
        const reader = new FileReader()
        reader.onload = () => {
          const src = reader.result
          if (typeof src === "string") {
            if (retakeId) {
              setPages((prev) =>
                prev.map((p) =>
                  p.id === retakeId ? { ...p, src, rotation: 0 } : p,
                ),
              )
              setRetakeId(null)
            } else {
              setPages((prev) => [...prev, { id: newId(), src, rotation: 0 }])
            }
          }
          remaining -= 1
          if (remaining === 0) setView("review")
        }
        reader.readAsDataURL(file)
      })
    },
    [retakeId],
  )

  const rotatePage = (id: string) =>
    setPages((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    )

  const deletePage = (id: string) =>
    setPages((prev) => prev.filter((p) => p.id !== id))

  const movePage = (index: number, dir: -1 | 1) =>
    setPages((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const reorder = (from: number, to: number) =>
    setPages((prev) => {
      if (from === to) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })

  const startRetake = (id: string) => {
    setRetakeId(id)
    setView("camera")
  }

  const finalize = useCallback(async () => {
    if (pages.length === 0) return
    setBuilding(true)
    try {
      const file = await buildScanPdf(pages, filter, defaultScanFilename())
      onComplete(file)
      onClose()
    } catch (err) {
      toast.error("Could not build PDF", {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBuilding(false)
    }
  }, [pages, filter, onComplete, onClose])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-neutral-950 text-white">
      <input
        ref={importInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleImport(e.target.files)
          e.target.value = ""
        }}
      />

      {view === "camera" ? (
        <CameraView
          videoRef={videoRef}
          starting={starting}
          cameraError={cameraError}
          hasMultipleCameras={hasMultipleCameras}
          pageCount={pages.length}
          retaking={retakeId !== null}
          lastPreview={
            pages.length ? previewFor(pages[pages.length - 1]) : null
          }
          onClose={onClose}
          onCapture={capture}
          onSwitchCamera={() =>
            setFacingMode((m) => (m === "environment" ? "user" : "environment"))
          }
          onRetry={() => void startCamera(facingMode)}
          onImport={() => importInputRef.current?.click()}
          onReview={() => {
            setRetakeId(null)
            setView("review")
          }}
        />
      ) : (
        <ReviewView
          pages={pages}
          filter={filter}
          building={building}
          dragIndex={dragIndex}
          previewFor={previewFor}
          onFilterChange={setFilter}
          onClose={onClose}
          onAddPages={() => {
            setRetakeId(null)
            setView("camera")
          }}
          onImport={() => importInputRef.current?.click()}
          onRotate={rotatePage}
          onDelete={deletePage}
          onMove={movePage}
          onRetake={startRetake}
          onFinalize={finalize}
          onDragStart={setDragIndex}
          onDragEnd={() => setDragIndex(null)}
          onDrop={(to) => {
            if (dragIndex !== null) reorder(dragIndex, to)
            setDragIndex(null)
          }}
        />
      )}
    </div>
  )
}

// ── Camera view ───────────────────────────────────────────────────────────────

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  starting: boolean
  cameraError: string | null
  hasMultipleCameras: boolean
  pageCount: number
  retaking: boolean
  lastPreview: string | null
  onClose: () => void
  onCapture: () => void
  onSwitchCamera: () => void
  onRetry: () => void
  onImport: () => void
  onReview: () => void
}

function CameraView({
  videoRef,
  starting,
  cameraError,
  hasMultipleCameras,
  pageCount,
  retaking,
  lastPreview,
  onClose,
  onCapture,
  onSwitchCamera,
  onRetry,
  onImport,
  onReview,
}: CameraViewProps) {
  return (
    <>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Close scanner"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-sm font-medium">
          {retaking ? "Retake page" : "Scan document"}
        </div>
        {hasMultipleCameras ? (
          <button
            type="button"
            onClick={onSwitchCamera}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Switch camera"
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        ) : (
          <div className="h-9 w-9" />
        )}
      </div>

      {/* Viewfinder */}
      <div className="relative flex-1 overflow-hidden">
        {cameraError ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera className="h-10 w-10 text-white/40" />
            <p className="max-w-sm text-sm text-white/80">{cameraError}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
              <button
                type="button"
                onClick={onImport}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <ImageIcon className="h-4 w-4" />
                Import image
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: live camera preview has no captions */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />
            {/* Document alignment guide */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
              <div className="h-full w-full max-w-3xl rounded-xl border-2 border-dashed border-white/40" />
            </div>
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="h-8 w-8 animate-spin text-white/80" />
              </div>
            )}
            {retaking && (
              <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs">
                Retaking — capture a replacement page
              </div>
            )}
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-8 py-6">
        {/* Import (left) */}
        <button
          type="button"
          onClick={onImport}
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Import image"
        >
          <ImageIcon className="h-5 w-5" />
        </button>

        {/* Shutter (center) */}
        <button
          type="button"
          onClick={onCapture}
          disabled={!!cameraError || starting}
          className="group flex h-[74px] w-[74px] items-center justify-center rounded-full border-4 border-white/80 bg-transparent transition-transform active:scale-95 disabled:opacity-40"
          aria-label="Capture page"
        >
          <span className="h-[58px] w-[58px] rounded-full bg-white transition-colors group-hover:bg-white/90" />
        </button>

        {/* Review (right) */}
        <button
          type="button"
          onClick={onReview}
          disabled={pageCount === 0}
          className="relative inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-white/30 bg-white/5 transition-colors hover:bg-white/15 disabled:opacity-40"
          aria-label={`Review ${pageCount} pages`}
        >
          {lastPreview ? (
            <img
              src={lastPreview}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <Check className="h-5 w-5" />
          )}
          {pageCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
              {pageCount}
            </span>
          )}
        </button>
      </div>
    </>
  )
}

// ── Review view ───────────────────────────────────────────────────────────────

interface ReviewViewProps {
  pages: ScanPage[]
  filter: ScanFilter
  building: boolean
  dragIndex: number | null
  previewFor: (page: ScanPage) => string
  onFilterChange: (f: ScanFilter) => void
  onClose: () => void
  onAddPages: () => void
  onImport: () => void
  onRotate: (id: string) => void
  onDelete: (id: string) => void
  onMove: (index: number, dir: -1 | 1) => void
  onRetake: (id: string) => void
  onFinalize: () => void
  onDragStart: (index: number) => void
  onDragEnd: () => void
  onDrop: (index: number) => void
}

function ReviewView({
  pages,
  filter,
  building,
  dragIndex,
  previewFor,
  onFilterChange,
  onClose,
  onAddPages,
  onImport,
  onRotate,
  onDelete,
  onMove,
  onRetake,
  onFinalize,
  onDragStart,
  onDragEnd,
  onDrop,
}: ReviewViewProps) {
  return (
    <div className="flex h-full flex-col bg-neutral-100 text-neutral-900">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-white px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100"
          aria-label="Close scanner"
        >
          <X className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-base font-semibold leading-tight">Review scan</h2>
          <p className="text-xs text-neutral-500">
            {pages.length} page{pages.length === 1 ? "" : "s"} · drag to reorder
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Filter selector */}
          <div className="flex items-center gap-1 rounded-lg border bg-neutral-50 p-0.5">
            {SCAN_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onFilterChange(f.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f.value
                    ? "bg-primary text-primary-foreground"
                    : "text-neutral-600 hover:bg-neutral-200",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pages grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {pages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-neutral-500">
            <FileText className="h-10 w-10 opacity-40" />
            <p className="text-sm">No pages yet. Add a page to continue.</p>
            <button
              type="button"
              onClick={onAddPages}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Camera className="h-4 w-4" />
              Open camera
            </button>
          </div>
        ) : (
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {pages.map((page, index) => (
              <div
                key={page.id}
                draggable
                onDragStart={() => onDragStart(index)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(index)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-all",
                  dragIndex === index
                    ? "opacity-50 ring-2 ring-primary"
                    : "hover:shadow-md",
                )}
              >
                {/* Page number */}
                <span className="absolute left-2 top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-neutral-900/80 px-1.5 text-xs font-semibold text-white">
                  {index + 1}
                </span>

                {/* Preview */}
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-neutral-50">
                  <img
                    src={previewFor(page)}
                    alt={`Page ${index + 1}`}
                    className="h-full w-full object-contain"
                    style={{ filter: cssFilterFor(filter) }}
                    draggable={false}
                  />
                </div>

                {/* Controls */}
                <div className="flex items-center justify-between gap-1 border-t bg-white px-1.5 py-1.5">
                  <div className="flex items-center gap-0.5">
                    <IconBtn
                      label="Move left"
                      onClick={() => onMove(index, -1)}
                      disabled={index === 0}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label="Move right"
                      onClick={() => onMove(index, 1)}
                      disabled={index === pages.length - 1}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </IconBtn>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <IconBtn label="Rotate" onClick={() => onRotate(page.id)}>
                      <RotateCw className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn label="Retake" onClick={() => onRetake(page.id)}>
                      <RefreshCw className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label="Delete"
                      onClick={() => onDelete(page.id)}
                      danger
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconBtn>
                  </div>
                </div>
              </div>
            ))}

            {/* Add page tile */}
            <button
              type="button"
              onClick={onAddPages}
              className="flex aspect-[3/4] min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 text-neutral-500 transition-colors hover:border-primary hover:text-primary"
            >
              <Plus className="h-7 w-7" />
              <span className="text-sm font-medium">Add page</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t bg-white px-5 py-3">
        <button
          type="button"
          onClick={onImport}
          className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3.5 py-2 text-sm font-medium text-neutral-600 transition-colors hover:border-primary hover:text-primary"
        >
          <ImageIcon className="h-4 w-4" />
          Import
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onFinalize}
            disabled={pages.length === 0 || building}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
          >
            {building ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Create PDF &amp; upload
          </button>
        </div>
      </div>
    </div>
  )
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent",
        danger && "hover:bg-red-50 hover:text-red-600",
      )}
    >
      {children}
    </button>
  )
}
