/**
 * Canvas export — pure SVG serialization plus thin DOM/Blob raster helpers.
 *
 * `shapesToSvgString` is the tested core: given the current shapes it produces a
 * standalone, namespaced `<svg>` document string covering every shape type
 * (rect, ellipse, diamond, line, arrow, text, freehand draw). The PNG / clipboard
 * helpers below wrap that string with `<img>` + `<canvas>` rasterization and stay
 * intentionally thin (DOM-only, not unit-tested).
 */

import { arrowHeadPoints, cornerPoint, oppositeCorner, type Box, type Corner } from './types'
import { pointsToPath, bboxFromPoints } from './freehand'
import { layoutText } from './text-layout'
import { isPolygonShape, polygonPoints, polygonPointsAttr } from './geo'

export interface ExportShape {
  type: string
  x: number
  y: number
  width: number
  height: number
  props: Record<string, unknown>
}

export interface SvgExportOptions {
  /** Padding (canvas units) added around the content bounds. Default 16. */
  padding?: number
  /** Optional solid background fill. Omit for a transparent document. */
  background?: string
}

const DEFAULT_STROKE = '#1b1b1f'

function num(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 100) / 100)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function strokeOf(s: ExportShape): string {
  return typeof s.props.stroke === 'string' ? s.props.stroke : DEFAULT_STROKE
}
function fillOf(s: ExportShape): string {
  return typeof s.props.fill === 'string' ? s.props.fill : 'transparent'
}
function strokeWidthOf(s: ExportShape): number {
  return typeof s.props.strokeWidth === 'number' ? s.props.strokeWidth : 2
}

function box(s: ExportShape): Box {
  return { x: s.x, y: s.y, width: s.width, height: s.height }
}

/** Union bounding box of every shape, or null when there are no shapes. */
function contentBounds(shapes: ExportShape[]): Box | null {
  if (shapes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of shapes) {
    minX = Math.min(minX, s.x)
    minY = Math.min(minY, s.y)
    maxX = Math.max(maxX, s.x + s.width)
    maxY = Math.max(maxY, s.y + s.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Bold, FILLED triangular arrowhead (tldraw-style) as a single `<polygon>`.
 * Geometry comes from the shared `arrowHeadPoints` helper so the exported head
 * is identical in size/shape to the on-screen renderer (Shape.tsx) — they can't
 * drift. Returns [] for a degenerate final segment.
 */
function arrowHeadPolygon(
  end: { x: number; y: number },
  prev: { x: number; y: number },
  stroke: string,
  sw: number,
): string[] {
  const head = arrowHeadPoints(end, prev, sw)
  if (!head) return []
  const pts = `${num(head.tip.x)},${num(head.tip.y)} ${num(head.left.x)},${num(head.left.y)} ${num(head.right.x)},${num(head.right.y)}`
  return [
    `<polygon points="${pts}" fill="${stroke}" stroke="${stroke}" stroke-width="${num(Math.min(sw, 2))}" stroke-linejoin="round" />`,
  ]
}

function lineOrArrowElement(s: ExportShape, withHead: boolean): string {
  const stroke = strokeOf(s)
  const sw = strokeWidthOf(s)

  // Bent connector: scale the bbox-relative waypoints to the shape's box (same
  // transform as the renderer), emit a polyline, and head the LAST segment.
  const pts = Array.isArray(s.props.points) ? (s.props.points as Array<{ x: number; y: number }>) : []
  if (pts.length >= 2) {
    const nb = bboxFromPoints(pts)
    const sx = nb.width ? s.width / nb.width : 1
    const sy = nb.height ? s.height / nb.height : 1
    const tx = s.x - nb.x * sx
    const ty = s.y - nb.y * sy
    const abs = pts.map((p) => ({ x: tx + p.x * sx, y: ty + p.y * sy }))
    const parts: string[] = [
      `<polyline points="${abs.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" fill="none" />`,
    ]
    if (withHead) parts.push(...arrowHeadPolygon(abs[abs.length - 1], abs[abs.length - 2], stroke, sw))
    return `<g>${parts.join('')}</g>`
  }

  const b = box(s)
  const headCorner = (s.props.headCorner as Corner) ?? 'se'
  const end = cornerPoint(b, headCorner)
  const start = cornerPoint(b, oppositeCorner(headCorner))
  const parts: string[] = [
    `<line x1="${num(start.x)}" y1="${num(start.y)}" x2="${num(end.x)}" y2="${num(end.y)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" fill="none" />`,
  ]
  if (withHead) parts.push(...arrowHeadPolygon(end, start, stroke, sw))
  return `<g>${parts.join('')}</g>`
}

function drawElement(s: ExportShape): string {
  const raw = Array.isArray(s.props.points) ? (s.props.points as Array<{ x: number; y: number }>) : []
  const d = pointsToPath(raw)
  if (!d) return ''
  const nb = bboxFromPoints(raw)
  const sx = nb.width ? s.width / nb.width : 1
  const sy = nb.height ? s.height / nb.height : 1
  const tx = s.x - nb.x * sx
  const ty = s.y - nb.y * sy
  return `<path d="${d}" transform="translate(${num(tx)} ${num(ty)}) scale(${num(sx)} ${num(sy)})" fill="none" stroke="${strokeOf(s)}" stroke-width="${strokeWidthOf(s)}" stroke-linecap="round" stroke-linejoin="round" />`
}

/** Serialize one shape to an SVG element string (in absolute canvas coords). */
export function shapeToSvgElement(s: ExportShape): string {
  const b = box(s)
  const stroke = strokeOf(s)
  const fill = fillOf(s)
  const sw = strokeWidthOf(s)
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`

  // Every polygon geo shape exports through the shared point generator.
  if (isPolygonShape(s.type)) {
    return `<polygon points="${polygonPointsAttr(polygonPoints(s.type, b), num)}" ${common} />`
  }

  switch (s.type) {
    case 'rect': {
      const rx = Math.min(12, b.width / 6, b.height / 6)
      return `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.width)}" height="${num(b.height)}" rx="${num(rx)}" ${common} />`
    }
    case 'ellipse':
      return `<ellipse cx="${num(b.x + b.width / 2)}" cy="${num(b.y + b.height / 2)}" rx="${num(b.width / 2)}" ry="${num(b.height / 2)}" ${common} />`
    case 'diamond':
      return `<polygon points="${num(b.x + b.width / 2)},${num(b.y)} ${num(b.x + b.width)},${num(b.y + b.height / 2)} ${num(b.x + b.width / 2)},${num(b.y + b.height)} ${num(b.x)},${num(b.y + b.height / 2)}" ${common} />`
    case 'line':
      return lineOrArrowElement(s, false)
    case 'arrow':
      return lineOrArrowElement(s, true)
    case 'draw':
      return drawElement(s)
    case 'text': {
      const baseFont = typeof s.props.fontSize === 'number' ? s.props.fontSize : 20
      const raw = typeof s.props.text === 'string' && s.props.text ? s.props.text : 'Text'
      const align = s.props.align === 'center' ? 'center' : 'left'
      const valign = s.props.valign === 'middle' ? 'middle' : 'top'
      const shrink = s.props.fit === 'shrink'

      const padX = 4
      const innerW = Math.max(8, b.width - padX * 2)
      const heightBudget = shrink ? Math.max(b.height, baseFont) : Number.POSITIVE_INFINITY
      const { lines, fontSize, lineHeight } = layoutText(raw, innerW, heightBudget, baseFont)

      const totalH = lines.length * lineHeight
      const anchorX = align === 'center' ? b.x + b.width / 2 : b.x + padX
      const top = valign === 'middle' ? b.y + Math.max(0, (b.height - totalH) / 2) : b.y
      const firstBaseline = top + fontSize * 0.82
      const anchorAttr = align === 'center' ? ' text-anchor="middle"' : ''
      const tspans = lines
        .map(
          (ln, i) =>
            `<tspan x="${num(anchorX)}" y="${num(firstBaseline + i * lineHeight)}">${escapeXml(ln === '' ? ' ' : ln)}</tspan>`,
        )
        .join('')
      return `<text fill="${stroke}" font-size="${num(fontSize)}" font-family="'Architects Daughter', cursive"${anchorAttr}>${tspans}</text>`
    }
    default:
      return ''
  }
}

/**
 * Produce a standalone, namespaced `<svg>` document string for the given shapes.
 * The viewBox is fit to the content bounds plus padding. Pure — no DOM access.
 */
export function shapesToSvgString(shapes: ExportShape[], opts: SvgExportOptions = {}): string {
  const padding = opts.padding ?? 16
  const bounds = contentBounds(shapes)
  const vx = bounds ? bounds.x - padding : 0
  const vy = bounds ? bounds.y - padding : 0
  const vw = bounds ? Math.max(bounds.width + padding * 2, 1) : 1
  const vh = bounds ? Math.max(bounds.height + padding * 2, 1) : 1

  const bg = opts.background
    ? `<rect x="${num(vx)}" y="${num(vy)}" width="${num(vw)}" height="${num(vh)}" fill="${opts.background}" />`
    : ''
  const body = shapes.map(shapeToSvgElement).filter(Boolean).join('\n  ')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(vw)}" height="${num(vh)}" ` +
    `viewBox="${num(vx)} ${num(vy)} ${num(vw)} ${num(vh)}">\n  ${bg}${bg ? '\n  ' : ''}${body}\n</svg>`
  )
}

// ===========================================================================
// Thin DOM / Blob helpers (not unit-tested)
// ===========================================================================

/** Trigger a browser download of a blob under the given filename. */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Download an SVG string as a `.svg` file. */
export function downloadSvgString(svg: string, filename: string): void {
  triggerDownload(new Blob([svg], { type: 'image/svg+xml' }), filename)
}

/** Rasterize an SVG string to a PNG blob via an offscreen canvas. */
export async function svgToPngBlob(
  svg: string,
  opts: { scale?: number; background?: string } = {},
): Promise<Blob> {
  const scale = opts.scale ?? 2
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load SVG for rasterization'))
      img.src = url
    })
    const w = img.width || 300
    const h = img.height || 150
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    if (opts.background) {
      ctx.fillStyle = opts.background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Download an SVG string as a rasterized PNG file. */
export async function downloadPng(svg: string, filename: string, background?: string): Promise<void> {
  const blob = await svgToPngBlob(svg, { background })
  triggerDownload(blob, filename)
}

/** Copy a rasterized PNG of the SVG to the system clipboard. */
export async function copyImageToClipboard(svg: string, background?: string): Promise<void> {
  const blob = await svgToPngBlob(svg, { background })
  const item = new ClipboardItem({ 'image/png': blob })
  await navigator.clipboard.write([item])
}
