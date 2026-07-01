/**
 * Pure hit-testing for the canvas. Given the cursor in world coordinates, find
 * which shape (or which resize handle of the selected shape) is under it.
 *
 * Kept dependency-free and side-effect-free so it can be unit-tested without a
 * DOM — this is the logic that decides whether a pointer-down starts a move, a
 * resize, a create, or a pan.
 */

import {
  cornerPoint,
  distToSegment,
  oppositeCorner,
  pointInBox,
  type Box,
  type Corner,
  type Point,
} from './types'
import { bboxFromPoints } from './freehand'

export interface HitShape {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  props: Record<string, unknown>
}

function boxOf(s: HitShape): Box {
  return { x: s.x, y: s.y, width: s.width, height: s.height }
}

/**
 * Topmost shape under `world`, or null. Shapes are checked in reverse order
 * (last drawn = visually on top). `pad`/threshold scale inversely with zoom so
 * the grab area stays a constant ~6–10px on screen.
 */
export function hitTestShapes(shapes: HitShape[], world: Point, zoom: number): string | null {
  const pad = 6 / zoom
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    const b = boxOf(s)
    if (s.type === 'line' || s.type === 'arrow') {
      const threshold = 10 / zoom
      const pts = Array.isArray(s.props.points) ? (s.props.points as Point[]) : []
      if (pts.length >= 2) {
        // Bent connector: scale the bbox-relative waypoints to the shape's
        // current box (same transform as the renderer) and test each segment.
        const nb = bboxFromPoints(pts)
        const sx = nb.width ? s.width / nb.width : 1
        const sy = nb.height ? s.height / nb.height : 1
        const tx = s.x - nb.x * sx
        const ty = s.y - nb.y * sy
        const abs = pts.map((p) => ({ x: tx + p.x * sx, y: ty + p.y * sy }))
        for (let k = 0; k < abs.length - 1; k++) {
          if (distToSegment(world, abs[k], abs[k + 1]) <= threshold) return s.id
        }
      } else {
        const headCorner = (s.props.headCorner as Corner) ?? 'se'
        const end = cornerPoint(b, headCorner)
        const start = cornerPoint(b, oppositeCorner(headCorner))
        if (distToSegment(world, start, end) <= threshold) return s.id
      }
    } else if (pointInBox(world, b, pad)) {
      return s.id
    }
  }
  return null
}

/** Do two axis-aligned boxes overlap at all? */
function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Ids of every shape whose bounding box intersects the marquee `box`. Used by
 * the select tool's rubber-band drag to pick up multiple shapes at once. A
 * zero-size box (a plain click on empty canvas) intersects nothing, which is
 * exactly the "click empty space to deselect" behavior.
 */
export function shapesInBox(shapes: HitShape[], box: Box): string[] {
  const ids: string[] = []
  for (const s of shapes) {
    if (boxesIntersect(boxOf(s), box)) ids.push(s.id)
  }
  return ids
}

/** Which corner handle of `shape` is under `world`, or null. */
export function hitTestHandle(shape: HitShape | null, world: Point, zoom: number): Corner | null {
  if (!shape) return null
  const b = boxOf(shape)
  const r = 11 / zoom
  const corners: Corner[] = ['nw', 'ne', 'sw', 'se']
  for (const c of corners) {
    const p = cornerPoint(b, c)
    if (Math.abs(world.x - p.x) <= r && Math.abs(world.y - p.y) <= r) return c
  }
  return null
}

/** Resolve a resize drag (corner + cursor delta) into a new normalized box. */
export function resizeBox(orig: Box, corner: Corner, dx: number, dy: number): Box {
  let left = orig.x
  let top = orig.y
  let right = orig.x + orig.width
  let bottom = orig.y + orig.height
  if (corner.includes('w')) left = orig.x + dx
  if (corner.includes('e')) right = orig.x + orig.width + dx
  if (corner.includes('n')) top = orig.y + dy
  if (corner.includes('s')) bottom = orig.y + orig.height + dy
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.max(Math.abs(right - left), 1),
    height: Math.max(Math.abs(bottom - top), 1),
  }
}
