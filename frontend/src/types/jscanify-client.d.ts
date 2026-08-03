// jscanify ships no type declarations for its browser ("client") build.
declare module "jscanify/client" {
  interface Corner {
    x: number
    y: number
  }
  interface CornerPoints {
    topLeftCorner?: Corner
    topRightCorner?: Corner
    bottomLeftCorner?: Corner
    bottomRightCorner?: Corner
  }
  export default class Jscanify {
    findPaperContour(mat: unknown): unknown | null
    getCornerPoints(contour: unknown): CornerPoints
    extractPaper(
      image: unknown,
      resultWidth: number,
      resultHeight: number,
      cornerPoints?: CornerPoints,
    ): HTMLCanvasElement | null
    highlightPaper(image: unknown, options?: unknown): HTMLCanvasElement
  }
}
