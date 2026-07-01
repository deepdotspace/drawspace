/**
 * Pure polygon geometry for the extra geo shapes (triangle, pentagon, hexagon,
 * star) reachable from the toolbar's shape dropdown. Each shape is generated
 * from its bounding box so it moves/resizes like every other shape, and the
 * same point list feeds BOTH the on-screen renderer (`Shape.tsx`) and the SVG
 * exporter (`export.ts`) so they can't drift. No DOM — unit-tested in isolation.
 */

import type { Box, Point } from './types'

/**
 * The geo shapes drawn as a polygon from their bbox — regular n-gons, stars,
 * and a handful of common diagram shapes (right triangle, trapezoid,
 * parallelogram, plus/cross, block arrow, chevron). All render through the same
 * `<polygon>` path, so adding one here lights it up in the renderer, the create
 * preview, and the SVG exporter automatically.
 */
export const POLYGON_SHAPES = [
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
] as const
export type PolygonShape = (typeof POLYGON_SHAPES)[number]

/** Regular n-gons + stars whose first vertex sits at top-center of the box. */
export const RADIAL_POLYGON_SHAPES: readonly PolygonShape[] = [
  'triangle',
  'pentagon',
  'hexagon',
  'heptagon',
  'octagon',
  'star',
  'star4',
  'star6',
]

export function isPolygonShape(t: string): t is PolygonShape {
  return (POLYGON_SHAPES as readonly string[]).includes(t)
}

/** Regular n-gon inscribed in the box, first vertex at top-center. */
function regularPolygon(sides: number, b: Box): Point[] {
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const rx = b.width / 2
  const ry = b.height / 2
  const pts: Point[] = []
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
  }
  return pts
}

/** N-pointed star inscribed in the box (outer radius = box, inner = ratio). */
function starPolygon(b: Box, spikes = 5, innerRatio = 0.5): Point[] {
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const rx = b.width / 2
  const ry = b.height / 2
  const pts: Point[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / spikes
    const r = i % 2 === 0 ? 1 : innerRatio
    pts.push({ x: cx + rx * r * Math.cos(a), y: cy + ry * r * Math.sin(a) })
  }
  return pts
}

/** Vertices of a polygon geo shape inscribed in `b`. */
export function polygonPoints(type: PolygonShape, b: Box): Point[] {
  const { x, y, width: w, height: h } = b
  switch (type) {
    case 'triangle':
      return regularPolygon(3, b)
    case 'pentagon':
      return regularPolygon(5, b)
    case 'hexagon':
      return regularPolygon(6, b)
    case 'heptagon':
      return regularPolygon(7, b)
    case 'octagon':
      return regularPolygon(8, b)
    case 'star':
      return starPolygon(b)
    case 'star4':
      return starPolygon(b, 4, 0.42)
    case 'star6':
      return starPolygon(b, 6, 0.55)
    case 'right-triangle':
      // Right angle at the bottom-left corner.
      return [
        { x, y },
        { x, y: y + h },
        { x: x + w, y: y + h },
      ]
    case 'trapezoid':
      // Narrower top edge, centered.
      return [
        { x: x + w * 0.25, y },
        { x: x + w * 0.75, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]
    case 'parallelogram':
      return [
        { x: x + w * 0.25, y },
        { x: x + w, y },
        { x: x + w * 0.75, y: y + h },
        { x, y: y + h },
      ]
    case 'cross': {
      // Plus sign: arms a third of the box thick.
      const a = w / 3
      const c = h / 3
      return [
        { x: x + a, y },
        { x: x + 2 * a, y },
        { x: x + 2 * a, y: y + c },
        { x: x + w, y: y + c },
        { x: x + w, y: y + 2 * c },
        { x: x + 2 * a, y: y + 2 * c },
        { x: x + 2 * a, y: y + h },
        { x: x + a, y: y + h },
        { x: x + a, y: y + 2 * c },
        { x, y: y + 2 * c },
        { x, y: y + c },
        { x: x + a, y: y + c },
      ]
    }
    case 'arrow-block': {
      // Right-pointing block arrow: a shaft plus a triangular head.
      const shaftTop = y + h * 0.25
      const shaftBot = y + h * 0.75
      const neck = x + w * 0.6
      return [
        { x, y: shaftTop },
        { x: neck, y: shaftTop },
        { x: neck, y },
        { x: x + w, y: y + h / 2 },
        { x: neck, y: y + h },
        { x: neck, y: shaftBot },
        { x, y: shaftBot },
      ]
    }
    case 'chevron': {
      // Right-pointing chevron (»-style outline).
      const mid = y + h / 2
      return [
        { x, y },
        { x: x + w * 0.5, y },
        { x: x + w, y: mid },
        { x: x + w * 0.5, y: y + h },
        { x, y: y + h },
        { x: x + w * 0.5, y: mid },
      ]
    }
  }
}

/** Serialize points to an SVG `points="x,y x,y …"` attribute value. The
 *  optional `format` lets callers round (e.g. the exporter's `num`). */
export function polygonPointsAttr(pts: Point[], format: (n: number) => string | number = (n) => n): string {
  return pts.map((p) => `${format(p.x)},${format(p.y)}`).join(' ')
}
