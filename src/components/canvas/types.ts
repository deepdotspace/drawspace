/**
 * Shared canvas types + small geometry helpers used across the editor surface
 * (DrawCanvas, Shape, Toolbar, StylePanel).
 */

/** Drawing tools available in the floating toolbar. */
export type Tool =
  | 'select'
  | 'hand'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'right-triangle'
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon'
  | 'trapezoid'
  | 'parallelogram'
  | 'star'
  | 'star4'
  | 'star6'
  | 'cross'
  | 'arrow-block'
  | 'chevron'
  | 'arrow'
  | 'line'
  | 'text'
  | 'draw'

/** Tools that create a shape by dragging (everything except select/hand). */
export const DRAW_TOOLS: Tool[] = [
  'rect',
  'ellipse',
  'diamond',
  'triangle',
  'right-triangle',
  'pentagon',
  'hexagon',
  'heptagon',
  'octagon',
  'trapezoid',
  'parallelogram',
  'star',
  'star4',
  'star6',
  'cross',
  'arrow-block',
  'chevron',
  'arrow',
  'line',
  'text',
  'draw',
]

export function isDrawTool(t: Tool): boolean {
  return DRAW_TOOLS.includes(t)
}

/** The canvas background style: dotted grid, lined grid, or plain surface. */
export type CanvasBackground = 'dots' | 'lines' | 'solid'

export const CANVAS_BACKGROUNDS: CanvasBackground[] = ['dots', 'lines', 'solid']

/** The active drawing style — applied to new shapes and editable on selection. */
export interface ShapeStyle {
  /** Outline color. */
  stroke: string
  /** Fill color, or 'transparent'. */
  fill: string
  /** Outline thickness in canvas units. */
  strokeWidth: number
  /** Font size for text shapes (canvas units). */
  fontSize: number
}

export const DEFAULT_STYLE: ShapeStyle = {
  stroke: '#1b1b1f',
  fill: 'transparent',
  strokeWidth: 3,
  fontSize: 20,
}

/** A point in canvas (world) coordinates. */
export interface Point {
  x: number
  y: number
}

/** An axis-aligned bounding box in canvas coordinates. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** Which bbox corner the arrow/line endpoint sits on. */
export function cornerFromDrag(start: Point, end: Point): Corner {
  const horiz = end.x >= start.x ? 'e' : 'w'
  const vert = end.y >= start.y ? 's' : 'n'
  return (vert + horiz) as Corner
}

export function oppositeCorner(c: Corner): Corner {
  const map: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }
  return map[c]
}

/** Absolute coordinate of a bbox corner. */
export function cornerPoint(box: Box, c: Corner): Point {
  return {
    x: c.includes('e') ? box.x + box.width : box.x,
    y: c.includes('s') ? box.y + box.height : box.y,
  }
}

/** Normalize a mousedown→cursor drag into a positive-size box. */
export function boxFromDrag(start: Point, end: Point): Box {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/** Is a point inside a box (optionally padded)? */
export function pointInBox(p: Point, b: Box, pad = 0): boolean {
  return (
    p.x >= b.x - pad &&
    p.x <= b.x + b.width + pad &&
    p.y >= b.y - pad &&
    p.y <= b.y + b.height + pad
  )
}

/** Shortest distance from a point to a line segment. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * The three points of a FILLED triangular arrowhead whose tip is at `tip`,
 * arriving from the direction of `prev`. Returns null for a degenerate (≤1px)
 * final segment. The head grows with both the segment length AND the stroke
 * width (clamped), giving a bold tldraw-style filled head instead of a thin
 * open "V". Shared by the on-screen renderer (Shape.tsx) and the SVG exporter
 * (export.ts) so the two can never drift in size or shape.
 */
export function arrowHeadPoints(
  tip: Point,
  prev: Point,
  strokeWidth: number,
): { tip: Point; left: Point; right: Point } | null {
  const dx = tip.x - prev.x
  const dy = tip.y - prev.y
  const len = Math.hypot(dx, dy)
  if (len <= 1) return null
  const angle = Math.atan2(dy, dx)
  const sw = Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 2
  // Bold but bounded: thicker strokes and longer segments get larger heads.
  const headLen = Math.min(30, Math.max(13, Math.max(len * 0.3, sw * 4.5)))
  const spread = Math.PI / 7
  return {
    tip,
    left: { x: tip.x - headLen * Math.cos(angle - spread), y: tip.y - headLen * Math.sin(angle - spread) },
    right: { x: tip.x - headLen * Math.cos(angle + spread), y: tip.y - headLen * Math.sin(angle + spread) },
  }
}
