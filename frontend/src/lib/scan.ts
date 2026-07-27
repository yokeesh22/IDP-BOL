// Client-side document scanning helpers.
//
// The backend upload pipeline (Azure Document Intelligence + BOL extraction)
// only accepts PDFs, so camera captures are assembled into a single PDF in the
// browser and handed to the existing `uploadDocument()` flow unchanged.

export type ScanFilter = "color" | "grayscale" | "bw"

export interface ScanPage {
  id: string
  /** Original full-resolution capture as a JPEG data URL (kept unmodified so
   *  rotation/filter changes stay non-destructive and reversible). */
  src: string
  /** Clockwise rotation applied on top of the original, in degrees. */
  rotation: number
}

export const SCAN_FILTERS: { value: ScanFilter; label: string }[] = [
  { value: "color", label: "Color" },
  { value: "grayscale", label: "Grayscale" },
  { value: "bw", label: "B&W scan" },
]

// Longest edge (px) used for the exported PDF pages. High enough for reliable
// OCR while keeping the uploaded file size reasonable.
const MAX_EDGE = 2200
const JPEG_QUALITY = 0.9

/** CSS filter string used to preview a scan filter in the browser (cheap, GPU
 *  accelerated). The exported PDF re-applies the equivalent transform per-pixel
 *  so the result matches the preview even on browsers without canvas filters. */
export function cssFilterFor(filter: ScanFilter): string {
  if (filter === "grayscale") return "grayscale(1) contrast(1.15)"
  if (filter === "bw") return "grayscale(1) contrast(1.9) brightness(1.05)"
  return "none"
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Failed to decode captured image"))
    img.src = src
  })
}

// Manual per-pixel filtering (instead of ctx.filter) so grayscale / B&W scans
// render identically on iOS Safari, which only gained canvas filter support
// recently.
function applyFilter(px: Uint8ClampedArray, filter: ScanFilter): void {
  if (filter === "color") return
  const contrast = filter === "bw" ? 1.9 : 1.15
  const brightness = filter === "bw" ? 12 : 0
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    let v = (lum - 128) * contrast + 128 + brightness
    v = v < 0 ? 0 : v > 255 ? 255 : v
    px[i] = v
    px[i + 1] = v
    px[i + 2] = v
  }
}

function normalizeRotation(rotation: number): number {
  return (((Math.round(rotation / 90) * 90) % 360) + 360) % 360
}

/** Render a single scanned page (rotation + filter applied, downscaled to
 *  MAX_EDGE) onto an offscreen canvas. */
export async function renderPageToCanvas(
  page: ScanPage,
  filter: ScanFilter,
  maxEdge: number = MAX_EDGE,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(page.src)
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height

  const longEdge = Math.max(iw, ih)
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1
  const dw = Math.max(1, Math.round(iw * scale))
  const dh = Math.max(1, Math.round(ih * scale))

  const rot = normalizeRotation(page.rotation)
  const swap = rot === 90 || rot === 270

  const canvas = document.createElement("canvas")
  canvas.width = swap ? dh : dw
  canvas.height = swap ? dw : dh

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context unavailable")

  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()

  if (filter !== "color") {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    applyFilter(imageData.data, filter)
    ctx.putImageData(imageData, 0, 0)
  }

  return canvas
}

/** Render a small preview data URL (rotation + filter applied) that exactly
 *  matches what the exported PDF page will look like. */
export async function renderPagePreview(
  page: ScanPage,
  filter: ScanFilter,
  maxEdge = 520,
): Promise<string> {
  const canvas = await renderPageToCanvas(page, filter, maxEdge)
  return canvas.toDataURL("image/jpeg", 0.85)
}

/** Assemble the ordered scan pages into a single PDF File ready for upload.
 *  Each page of the PDF is sized to its image so nothing is cropped or
 *  letter-boxed. */
export async function buildScanPdf(
  pages: ScanPage[],
  filter: ScanFilter,
  filename: string,
): Promise<File> {
  if (pages.length === 0) throw new Error("No pages to export")

  const { jsPDF } = await import("jspdf")
  let pdf: import("jspdf").jsPDF | null = null

  for (const page of pages) {
    const canvas = await renderPageToCanvas(page, filter)
    const w = canvas.width
    const h = canvas.height
    const orientation: "l" | "p" = w > h ? "l" : "p"
    const jpeg = canvas.toDataURL("image/jpeg", JPEG_QUALITY)

    if (!pdf) {
      pdf = new jsPDF({
        unit: "px",
        format: [w, h],
        orientation,
        compress: true,
      })
    } else {
      pdf.addPage([w, h], orientation)
    }
    pdf.addImage(jpeg, "JPEG", 0, 0, w, h)
  }

  if (!pdf) throw new Error("Failed to build PDF")
  const blob = pdf.output("blob")
  return new File([blob], filename, { type: "application/pdf" })
}

/** Filename for a freshly scanned document, e.g. `scan-20260727-134501.pdf`. */
export function defaultScanFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `scan-${stamp}.pdf`
}
