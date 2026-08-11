// Document detection + perspective correction for the camera scanner.
//
// Auto corner detection uses jscanify (OpenCV.js), lazily loaded so the ~8 MB
// WASM only downloads the first time a page is cropped. The perspective warp
// itself is implemented here without OpenCV, so manual cropping always works
// even if OpenCV fails to load (offline, blocked CDN, etc.).

export interface Pt {
  x: number
  y: number
}

/** A document quadrilateral in normalized [0..1] image coordinates. */
export interface Quad {
  topLeft: Pt
  topRight: Pt
  bottomRight: Pt
  bottomLeft: Pt
}

export const DEFAULT_QUAD: Quad = {
  topLeft: { x: 0.06, y: 0.05 },
  topRight: { x: 0.94, y: 0.05 },
  bottomRight: { x: 0.94, y: 0.95 },
  bottomLeft: { x: 0.06, y: 0.95 },
}

// ── OpenCV lazy loader ────────────────────────────────────────────────────────

// OpenCV.js has no first-class ESM types, so its runtime object is untyped.
type Cv = any
let cvPromise: Promise<Cv> | null = null

export function loadOpenCv(): Promise<Cv> {
  if (cvPromise) return cvPromise
  cvPromise = (async () => {
    const mod = await import("@techstark/opencv-js")
    const cvModule: any = (mod as any).default ?? mod
    let cv: Cv
    if (cvModule instanceof Promise) {
      cv = await cvModule
    } else if (cvModule.Mat) {
      cv = cvModule
    } else {
      await new Promise<void>((resolve) => {
        cvModule.onRuntimeInitialized = () => resolve()
      })
      cv = cvModule
    }
    // jscanify's client build references a global `cv`.
    ;(globalThis as unknown as { cv: Cv }).cv = cv
    return cv
  })()
  return cvPromise
}

// ── Auto document detection ───────────────────────────────────────────────────

/** Attempt to auto-detect the document quad in a full-resolution canvas.
 *  Returns normalized corners, or `null` if nothing plausible is found. */
export async function detectDocumentQuad(
  canvas: HTMLCanvasElement,
): Promise<Quad | null> {
  try {
    const cv = await loadOpenCv()
    const { default: Jscanify } = await import("jscanify/client")
    const scanner = new Jscanify()

    const mat = cv.imread(canvas)
    let contour: unknown | null = null
    try {
      contour = scanner.findPaperContour(mat)
      if (!contour) return null
      const c = scanner.getCornerPoints(contour)
      const {
        topLeftCorner,
        topRightCorner,
        bottomLeftCorner,
        bottomRightCorner,
      } = c
      if (
        !topLeftCorner ||
        !topRightCorner ||
        !bottomLeftCorner ||
        !bottomRightCorner
      ) {
        return null
      }
      const w = canvas.width
      const h = canvas.height
      const quad: Quad = {
        topLeft: { x: topLeftCorner.x / w, y: topLeftCorner.y / h },
        topRight: { x: topRightCorner.x / w, y: topRightCorner.y / h },
        bottomRight: { x: bottomRightCorner.x / w, y: bottomRightCorner.y / h },
        bottomLeft: { x: bottomLeftCorner.x / w, y: bottomLeftCorner.y / h },
      }
      // Reject detections that cover almost nothing (noise) — the caller falls
      // back to a default quad the user can adjust manually.
      if (quadAreaFraction(quad) < 0.1) return null
      return clampQuad(quad)
    } finally {
      mat.delete()
    }
  } catch {
    return null
  }
}

function quadAreaFraction(q: Quad): number {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft]
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2 // normalized coords → fraction of unit square
}

function clampQuad(q: Quad): Quad {
  const c = (p: Pt): Pt => ({
    x: Math.min(1, Math.max(0, p.x)),
    y: Math.min(1, Math.max(0, p.y)),
  })
  return {
    topLeft: c(q.topLeft),
    topRight: c(q.topRight),
    bottomRight: c(q.bottomRight),
    bottomLeft: c(q.bottomLeft),
  }
}

// ── Dependency-free perspective warp ──────────────────────────────────────────

const MAX_OUTPUT_EDGE = 2200

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Solve the 3x3 homography H mapping the four `from` points to the four `to`
 *  points (returns the 9 row-major coefficients). */
function getPerspectiveTransform(from: Pt[], to: Pt[]): number[] {
  // Build the 8x8 linear system A·h = b (h8 fixed to 1).
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]
    const { x: X, y: Y } = to[i]
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X])
    b.push(X)
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y])
    b.push(Y)
  }
  const h = solveLinear(A, b)
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

/** Gaussian elimination with partial pivoting for an 8x8 system. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const m = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    }
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    const pv = m[col][col] || 1e-12
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = m[r][col] / pv
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c]
    }
  }
  return m.map((row, i) => row[n] / (row[i] || 1e-12))
}

/** Warp the quadrilateral region of `source` into a flat, rectangular canvas.
 *  `quad` is in normalized [0..1] coordinates relative to the source. */
export function warpQuadToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  quad: Quad,
): HTMLCanvasElement {
  const sw =
    source instanceof HTMLImageElement
      ? source.naturalWidth || source.width
      : source.width
  const sh =
    source instanceof HTMLImageElement
      ? source.naturalHeight || source.height
      : source.height

  // Absolute source corners.
  const tl = { x: quad.topLeft.x * sw, y: quad.topLeft.y * sh }
  const tr = { x: quad.topRight.x * sw, y: quad.topRight.y * sh }
  const br = { x: quad.bottomRight.x * sw, y: quad.bottomRight.y * sh }
  const bl = { x: quad.bottomLeft.x * sw, y: quad.bottomLeft.y * sh }

  // Output size from the average of opposite edges, capped for performance.
  let outW = Math.round((dist(tl, tr) + dist(bl, br)) / 2)
  let outH = Math.round((dist(tl, bl) + dist(tr, br)) / 2)
  outW = Math.max(1, outW)
  outH = Math.max(1, outH)
  const longEdge = Math.max(outW, outH)
  if (longEdge > MAX_OUTPUT_EDGE) {
    const s = MAX_OUTPUT_EDGE / longEdge
    outW = Math.max(1, Math.round(outW * s))
    outH = Math.max(1, Math.round(outH * s))
  }

  // Read source pixels.
  const srcCanvas = document.createElement("canvas")
  srcCanvas.width = sw
  srcCanvas.height = sh
  const sctx = srcCanvas.getContext("2d")
  if (!sctx) throw new Error("Canvas 2D context unavailable")
  sctx.drawImage(source, 0, 0, sw, sh)
  const srcData = sctx.getImageData(0, 0, sw, sh).data

  // Homography mapping output rectangle → source quad (for inverse sampling).
  const H = getPerspectiveTransform(
    [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ],
    [tl, tr, br, bl],
  )

  const out = document.createElement("canvas")
  out.width = outW
  out.height = outH
  const octx = out.getContext("2d")
  if (!octx) throw new Error("Canvas 2D context unavailable")
  const outImg = octx.createImageData(outW, outH)
  const dst = outImg.data

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const den = H[6] * x + H[7] * y + H[8]
      const sx = (H[0] * x + H[1] * y + H[2]) / den
      const sy = (H[3] * x + H[4] * y + H[5]) / den
      const di = (y * outW + x) * 4
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        dst[di] = 255
        dst[di + 1] = 255
        dst[di + 2] = 255
        dst[di + 3] = 255
        continue
      }
      // Bilinear sample.
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      for (let ch = 0; ch < 3; ch++) {
        const top = srcData[i00 + ch] * (1 - fx) + srcData[i10 + ch] * fx
        const bot = srcData[i01 + ch] * (1 - fx) + srcData[i11 + ch] * fx
        dst[di + ch] = top * (1 - fy) + bot * fy
      }
      dst[di + 3] = 255
    }
  }
  octx.putImageData(outImg, 0, 0)
  return out
}
