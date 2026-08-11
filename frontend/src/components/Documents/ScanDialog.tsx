import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  ImageIcon,
  Loader2,
  Maximize2,
  Plus,
  Ratio,
  RefreshCw,
  RotateCw,
  SwitchCamera,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { CropEditor } from "@/components/Documents/CropEditor"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

type View = "camera" | "crop" | "review"
type CameraAspectRatio = "auto" | "4:3" | "16:9"

interface ZoomRange {
  min: number
  max: number
  step: number
  value: number
  mode: "hardware" | "digital"
}

type ZoomCapabilities = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step: number }
}

type ZoomSettings = MediaTrackSettings & { zoom?: number }
type ZoomConstraint = MediaTrackConstraintSet & { zoom: number }

function cameraVideoSize(
  aspectRatio: CameraAspectRatio,
  exact = false,
): MediaTrackConstraints {
  if (aspectRatio === "auto") return { width: { ideal: 1920 } }
  const ratio = aspectRatio === "4:3" ? 4 / 3 : 16 / 9
  return {
    width: { ideal: 1920 },
    height: { ideal: aspectRatio === "4:3" ? 1440 : 1080 },
    aspectRatio: exact ? { exact: ratio } : { ideal: ratio },
  }
}

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
  const aspectRatioRef = useRef<CameraAspectRatio>("auto")
  // Monotonic counter used to version a page's image so preview caches refresh
  // whenever the underlying capture changes (e.g. retake).
  const revRef = useRef(0)
  const nextRev = useCallback(() => ++revRef.current, [])

  const [view, setView] = useState<View>("camera")
  const [pages, setPages] = useState<ScanPage[]>([])
  const [filter, setFilter] = useState<ScanFilter>("color")
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  )
  const [aspectRatio, setAspectRatio] =
    useState<CameraAspectRatio>("auto")
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [retakeId, setRetakeId] = useState<string | null>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const stopCamera = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      for (const t of stream.getTracks()) t.stop()
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const startCamera = useCallback(
    async (facing: "environment" | "user") => {
      stopCamera()
      setStarting(true)
      setCameraError(null)
      setZoomRange(null)
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is not supported in this browser")
        }
        const videoSize = cameraVideoSize(aspectRatioRef.current)
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              ...videoSize,
              facingMode: { exact: facing },
            },
            audio: false,
          })
        } catch (err) {
          if (!(err instanceof DOMException) || err.name !== "OverconstrainedError") {
            throw err
          }
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              ...videoSize,
              facingMode: { ideal: facing },
            },
            audio: false,
          })
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        const videoTrack = stream.getVideoTracks()[0]
        const capabilities =
          videoTrack && typeof videoTrack.getCapabilities === "function"
            ? (videoTrack.getCapabilities() as ZoomCapabilities)
            : undefined
        const zoom = capabilities?.zoom
        if (
          zoom &&
          Number.isFinite(zoom.min) &&
          Number.isFinite(zoom.max) &&
          zoom.max > zoom.min
        ) {
          const settings = videoTrack.getSettings() as ZoomSettings
          setZoomRange({
            min: zoom.min,
            max: zoom.max,
            step: zoom.step || 0.1,
            value: settings.zoom ?? zoom.min,
            mode: "hardware",
          })
        } else {
          setZoomRange({
            min: 1,
            max: 3,
            step: 0.1,
            value: 1,
            mode: "digital",
          })
        }
        // Detect whether a front/back toggle makes sense.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const cams = devices.filter((d) => d.kind === "videoinput")
          setHasMultipleCameras(
            cams.length > 1 || window.matchMedia("(pointer: coarse)").matches,
          )
        } catch {
          setHasMultipleCameras(
            window.matchMedia("(pointer: coarse)").matches,
          )
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

  const applyAspectRatio = useCallback(
    async (nextAspectRatio: CameraAspectRatio) => {
      const videoTrack = streamRef.current?.getVideoTracks()[0]
      if (!videoTrack) return
      try {
        await videoTrack.applyConstraints(
          cameraVideoSize(nextAspectRatio, nextAspectRatio !== "auto"),
        )
        aspectRatioRef.current = nextAspectRatio
        setAspectRatio(nextAspectRatio)
        toast.success(
          `Aspect ratio set to ${nextAspectRatio === "auto" ? "Auto" : nextAspectRatio}`,
        )
      } catch {
        toast.error(`${nextAspectRatio} is not available on this camera`)
      }
    },
    [],
  )

  const applyZoom = useCallback(
    async (value: number) => {
      if (zoomRange?.mode === "digital") {
        setZoomRange((current) =>
          current ? { ...current, value } : current,
        )
        return
      }
      const videoTrack = streamRef.current?.getVideoTracks()[0]
      if (!videoTrack) return
      try {
        await videoTrack.applyConstraints({
          advanced: [{ zoom: value } as ZoomConstraint],
        })
        const settings = videoTrack.getSettings() as ZoomSettings
        setZoomRange((current) =>
          current
            ? { ...current, value: settings.zoom ?? value }
            : current,
        )
      } catch {
        toast.error("This camera could not apply that zoom level")
      }
    },
    [zoomRange?.mode],
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
      aspectRatioRef.current = "auto"
      setAspectRatio("auto")
      setZoomRange(null)
      setRetakeId(null)
      setCropSrc(null)
      setBuilding(false)
      setPreviews({})
      setCameraError(null)
      setLightboxIndex(null)
      setLightboxUrl(null)
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
        const key = `${page.id}:${page.rev}:${page.rotation}:${filter}`
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
    previews[`${page.id}:${page.rev}:${page.rotation}:${filter}`] ?? page.src

  // Keep the lightbox index valid as pages are deleted/reordered.
  useEffect(() => {
    if (lightboxIndex === null) return
    if (pages.length === 0) {
      setLightboxIndex(null)
    } else if (lightboxIndex > pages.length - 1) {
      setLightboxIndex(pages.length - 1)
    }
  }, [pages.length, lightboxIndex])

  // Render a high-resolution version for the open lightbox so the user can
  // actually inspect the scan (rotation + filter baked in, matching the PDF).
  useEffect(() => {
    if (lightboxIndex === null) {
      setLightboxUrl(null)
      return
    }
    const page = pages[lightboxIndex]
    if (!page) return
    let cancelled = false
    setLightboxUrl(null)
    ;(async () => {
      try {
        const url = await renderPagePreview(page, filter, 1600)
        if (!cancelled) setLightboxUrl(url)
      } catch {
        if (!cancelled) setLightboxUrl(page.src)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lightboxIndex, pages, filter])

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const digitalZoom =
      zoomRange?.mode === "digital" ? zoomRange.value : 1
    const sourceWidth = video.videoWidth / digitalZoom
    const sourceHeight = video.videoHeight / digitalZoom
    ctx.drawImage(
      video,
      (video.videoWidth - sourceWidth) / 2,
      (video.videoHeight - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const src = canvas.toDataURL("image/jpeg", 0.92)
    // Move to the crop/border-adjust step before the page is committed.
    setCropSrc(src)
    setView("crop")
  }, [zoomRange])

  // Commit a finished page (cropped or skipped) into the page list, then either
  // return to the camera to scan the next page or back to review after a retake.
  const commitPage = useCallback(
    (src: string) => {
      if (retakeId) {
        setPages((prev) =>
          prev.map((p) =>
            p.id === retakeId ? { ...p, src, rotation: 0, rev: nextRev() } : p,
          ),
        )
        setRetakeId(null)
        setCropSrc(null)
        setView("review")
      } else {
        setPages((prev) => [
          ...prev,
          { id: newId(), src, rotation: 0, rev: nextRev() },
        ])
        setCropSrc(null)
        setView("camera")
      }
    },
    [retakeId, nextRev],
  )

  const cancelCrop = useCallback(() => {
    setCropSrc(null)
    setView("camera")
  }, [])

  // Closing the camera view (reached via "Add page" or "Retake") should go back
  // to review when pages already exist, instead of discarding the whole scan.
  const handleCameraClose = useCallback(() => {
    if (pages.length > 0) {
      setRetakeId(null)
      setView("review")
    } else {
      onClose()
    }
  }, [pages.length, onClose])

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
                  p.id === retakeId
                    ? { ...p, src, rotation: 0, rev: nextRev() }
                    : p,
                ),
              )
              setRetakeId(null)
            } else {
              setPages((prev) => [
                ...prev,
                { id: newId(), src, rotation: 0, rev: nextRev() },
              ])
            }
          }
          remaining -= 1
          if (remaining === 0) setView("review")
        }
        reader.readAsDataURL(file)
      })
    },
    [retakeId, nextRev],
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

  // Keyboard: Escape closes the lightbox (or the dialog); arrows page through
  // the enlarged preview.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightboxIndex !== null) setLightboxIndex(null)
        else if (view === "crop") cancelCrop()
        else if (view === "camera") handleCameraClose()
        else onClose()
      } else if (lightboxIndex !== null && e.key === "ArrowRight") {
        setLightboxIndex((i) =>
          i === null ? i : Math.min(pages.length - 1, i + 1),
        )
      } else if (lightboxIndex !== null && e.key === "ArrowLeft") {
        setLightboxIndex((i) => (i === null ? i : Math.max(0, i - 1)))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    open,
    onClose,
    lightboxIndex,
    pages.length,
    view,
    cancelCrop,
    handleCameraClose,
  ])

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

      {view === "crop" && cropSrc ? (
        <CropEditor
          src={cropSrc}
          onConfirm={commitPage}
          onSkip={commitPage}
          onCancel={cancelCrop}
        />
      ) : view === "camera" ? (
        <CameraView
          videoRef={videoRef}
          starting={starting}
          cameraError={cameraError}
          hasMultipleCameras={hasMultipleCameras}
          aspectRatio={aspectRatio}
          zoomRange={zoomRange}
          digitalZoom={
            zoomRange?.mode === "digital" ? zoomRange.value : 1
          }
          pageCount={pages.length}
          retaking={retakeId !== null}
          lastPreview={
            pages.length ? previewFor(pages[pages.length - 1]) : null
          }
          onClose={handleCameraClose}
          onCapture={capture}
          onSwitchCamera={() =>
            setFacingMode((m) => (m === "environment" ? "user" : "environment"))
          }
          onAspectRatioChange={(value) => void applyAspectRatio(value)}
          onZoomChange={(value) => void applyZoom(value)}
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
          onOpenPage={setLightboxIndex}
          onFinalize={finalize}
          onDragStart={setDragIndex}
          onDragEnd={() => setDragIndex(null)}
          onDrop={(to) => {
            if (dragIndex !== null) reorder(dragIndex, to)
            setDragIndex(null)
          }}
        />
      )}

      {lightboxIndex !== null && pages[lightboxIndex] && (
        <Lightbox
          url={lightboxUrl}
          index={lightboxIndex}
          total={pages.length}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => Math.max(0, (i ?? 0) - 1))}
          onNext={() =>
            setLightboxIndex((i) => Math.min(pages.length - 1, (i ?? 0) + 1))
          }
          onRotate={() => rotatePage(pages[lightboxIndex].id)}
          onRetake={() => {
            const id = pages[lightboxIndex].id
            setLightboxIndex(null)
            startRetake(id)
          }}
          onDelete={() => deletePage(pages[lightboxIndex].id)}
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
  aspectRatio: CameraAspectRatio
  zoomRange: ZoomRange | null
  digitalZoom: number
  pageCount: number
  retaking: boolean
  lastPreview: string | null
  onClose: () => void
  onCapture: () => void
  onSwitchCamera: () => void
  onAspectRatioChange: (aspectRatio: CameraAspectRatio) => void
  onZoomChange: (value: number) => void
  onRetry: () => void
  onImport: () => void
  onReview: () => void
}

function CameraView({
  videoRef,
  starting,
  cameraError,
  hasMultipleCameras,
  aspectRatio,
  zoomRange,
  digitalZoom,
  pageCount,
  retaking,
  lastPreview,
  onClose,
  onCapture,
  onSwitchCamera,
  onAspectRatioChange,
  onZoomChange,
  onRetry,
  onImport,
  onReview,
}: CameraViewProps) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center px-8 pb-3 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-sm transition-colors hover:bg-black/60"
          aria-label="Close scanner"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="rounded-full bg-black/40 px-3 py-1.5 text-sm font-medium shadow-sm">
          {retaking ? "Retake page" : "Scan document"}
        </div>
        <div className="flex justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-sm transition-colors hover:bg-black/60"
                aria-label="Select camera aspect ratio"
                title="Aspect ratio"
              >
                <Ratio className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-[70] border-white/15 bg-black/80 text-white backdrop-blur-sm"
            >
              <DropdownMenuRadioGroup
                value={aspectRatio}
                onValueChange={(value) =>
                  onAspectRatioChange(value as CameraAspectRatio)
                }
              >
                <DropdownMenuRadioItem value="4:3" className="focus:bg-white/15 focus:text-white">
                  4:3 document
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="16:9" className="focus:bg-white/15 focus:text-white">
                  16:9 wide
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="auto" className="focus:bg-white/15 focus:text-white">
                  Auto
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {hasMultipleCameras && (
            <button
              type="button"
              onClick={onSwitchCamera}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-sm transition-colors hover:bg-black/60"
              aria-label="Switch camera"
            >
              <SwitchCamera className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Viewfinder */}
      <div className="absolute inset-0 overflow-hidden">
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
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-contain transition-transform duration-150"
              style={{ transform: `scale(${digitalZoom})` }}
            />
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

      {zoomRange && !cameraError && (
        <div className="absolute bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+6.5rem)] left-1/2 z-20 flex w-[min(17rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-full bg-black/40 px-4 py-2 text-white shadow-sm backdrop-blur-sm">
          <ZoomOut className="h-4 w-4 shrink-0" />
          <input
            type="range"
            min={zoomRange.min}
            max={zoomRange.max}
            step={zoomRange.step}
            value={zoomRange.value}
            onChange={(event) => onZoomChange(Number(event.target.value))}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-white"
            aria-label="Camera zoom"
          />
          <ZoomIn className="h-4 w-4 shrink-0" />
          <span className="w-9 text-right text-xs font-medium tabular-nums">
            {zoomRange.value.toFixed(1)}x
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between px-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6">
        {/* Import (left) */}
        <button
          type="button"
          onClick={onImport}
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-sm transition-colors hover:bg-black/60"
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
          className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/40 shadow-sm transition-colors hover:bg-black/60 disabled:opacity-40"
          aria-label={`Review ${pageCount} pages`}
        >
          {lastPreview ? (
            <img
              src={lastPreview}
              alt=""
              className="h-full w-full rounded-full object-cover"
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
    </div>
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
  onOpenPage: (index: number) => void
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
  onOpenPage,
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
              // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop reordering surface; page actions have dedicated buttons
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

                {/* Preview (click to enlarge) */}
                <button
                  type="button"
                  onClick={() => onOpenPage(index)}
                  title="Click to enlarge"
                  className="group/preview relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-neutral-50"
                >
                  <img
                    src={previewFor(page)}
                    alt={`Page ${index + 1}`}
                    className="h-full w-full object-contain"
                    style={{ filter: cssFilterFor(filter) }}
                    draggable={false}
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-900/0 opacity-0 transition-all group-hover/preview:bg-neutral-900/30 group-hover/preview:opacity-100">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-neutral-800 shadow">
                      <Maximize2 className="h-3.5 w-3.5" />
                      Enlarge
                    </span>
                  </span>
                </button>

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

            {/* Add page tile — mirrors a page card's height (aspect image area
                + a spacer matching the controls bar) so the grid stays even. */}
            <button
              type="button"
              onClick={onAddPages}
              className="flex flex-col overflow-hidden rounded-xl border-2 border-dashed border-neutral-300 text-neutral-500 transition-colors hover:border-primary hover:text-primary"
            >
              <span className="flex aspect-[3/4] flex-col items-center justify-center gap-2">
                <Plus className="h-7 w-7" />
                <span className="text-sm font-medium">Add page</span>
              </span>
              <span className="h-[41px] shrink-0" />
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

// ── Lightbox (enlarged page preview) ──────────────────────────────────────────

interface LightboxProps {
  url: string | null
  index: number
  total: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onRotate: () => void
  onRetake: () => void
  onDelete: () => void
}

function Lightbox({
  url,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onRotate,
  onRetake,
  onDelete,
}: LightboxProps) {
  return (
    <div className="absolute inset-0 z-[70] flex flex-col bg-neutral-950/95 backdrop-blur-sm">
      {/* Click-away backdrop (behind the content). */}
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute inset-0 z-0 cursor-default"
      />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-medium">
          Page {index + 1} of {total}
        </span>
        <div className="flex items-center gap-1">
          <LightboxBtn label="Rotate" onClick={onRotate}>
            <RotateCw className="h-5 w-5" />
          </LightboxBtn>
          <LightboxBtn label="Retake" onClick={onRetake}>
            <RefreshCw className="h-5 w-5" />
          </LightboxBtn>
          <LightboxBtn label="Delete" onClick={onDelete} danger>
            <Trash2 className="h-5 w-5" />
          </LightboxBtn>
          <LightboxBtn label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </LightboxBtn>
        </div>
      </div>

      {/* Stage */}
      <div className="pointer-events-none relative z-10 flex flex-1 items-center justify-center overflow-hidden px-4 pb-6">
        {index > 0 && (
          <button
            type="button"
            onClick={onPrev}
            className="pointer-events-auto absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {url ? (
          <img
            src={url}
            alt={`Page ${index + 1}`}
            className="max-h-full max-w-full object-contain shadow-2xl"
          />
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-white/70" />
        )}

        {index < total - 1 && (
          <button
            type="button"
            onClick={onNext}
            className="pointer-events-auto absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Next page"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  )
}

function LightboxBtn({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15",
        danger && "hover:bg-red-500/30 hover:text-red-300",
      )}
    >
      {children}
    </button>
  )
}
