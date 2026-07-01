/**
 * Freehand (pencil) geometry helpers — pure, dependency-free, unit-tested.
 *
 * A freehand shape stores an array of points (in coordinates relative to the
 * shape's bounding-box origin). `pointsToPath` turns those points into an SVG
 * path `d` string; `bboxFromPoints` computes the tight bounding box used to
 * derive the shape's x/y/width/height.
 */

import type { Box, Point } from './types'

function num(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 100) / 100)
}

/**
 * Build an SVG path `d` string from a list of points. The first point is a
 * `moveto` (M); the rest are `lineto` (L). An empty list yields an empty
 * string; a single point yields a zero-length segment so a dot still renders.
 */
export function pointsToPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const p = points[0]
    return `M ${num(p.x)} ${num(p.y)} L ${num(p.x)} ${num(p.y)}`
  }
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${num(p.x)} ${num(p.y)}`)
    .join(' ')
}

/** Tight axis-aligned bounding box of a list of points. */
export function bboxFromPoints(points: Point[]): Box {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Translate points so the bounding box origin sits at (0, 0). */
export function relativizePoints(points: Point[]): Point[] {
  const b = bboxFromPoints(points)
  return points.map((p) => ({ x: p.x - b.x, y: p.y - b.y }))
}
