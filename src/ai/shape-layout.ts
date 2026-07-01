/**
 * De-overlap pass for AI-authored shape batches.
 *
 * The model is poor at pixel coordinates: ask for anything non-trivial via
 * `canvas_createShapes` and it tends to stack boxes on top of each other. This
 * pure pass is the safety net — it nudges overlapping *container* shapes apart
 * so nothing ends up stacked, while preserving the parts of a composition that
 * SHOULD overlap:
 *
 *  - Only rect / ellipse / diamond are treated as collision bodies.
 *  - Text shapes ride along with the container they label (so a centered label
 *    stays centered after its box moves); standalone text is left untouched.
 *  - line / arrow are never moved or collided (they connect things by design).
 *  - A much-smaller box mostly inside a larger one (a window in a house, an
 *    inner region) is treated as intentional nesting and left alone.
 *
 * Pure (shapes in → shapes out, deterministic, no I/O), so it runs identically
 * wherever the client applies a batch and is unit-testable in isolation.
 */

import type { CanvasShapeType, NormalizedShape, Point, ShapeCorner } from './canvas-shape'

const BODY_TYPES = new Set<CanvasShapeType>(['rect', 'ellipse', 'diamond'])
const CONNECTOR_TYPES = new Set<CanvasShapeType>(['line', 'arrow'])

/** An axis-aligned bounding box in canvas coordinates. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Gap left between existing content and a freshly-placed batch. */
export const FREE_SPACE_GAP = 48

/**
 * Union bounding box of a set of boxes, or null when the set is empty. Used to
 * find where existing content ends so new content can be tucked clear of it.
 */
export function boundsOf(items: ReadonlyArray<Bounds>): Bounds | null {
  if (items.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of items) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Translate a freshly-built batch of shapes so its bounding box sits in free
 * space — below all `existing` content, left-aligned to it, with a gap. The
 * whole batch moves by the SAME delta (rigid), so internal relationships
 * (connecting arrows, centered labels) are preserved exactly.
 *
 * When the canvas is empty (`existing` is empty) the batch is returned
 * unchanged — the model's / layout's own coordinates stand. This is what keeps
 * the very first diagram of a session at its natural origin and keeps callers
 * that pass no placement context behaving identically to before.
 *
 * Pure: shapes in → translated copies out, deterministic, no I/O.
 */
export function placeInFreeSpace(
  shapes: NormalizedShape[],
  existing: ReadonlyArray<Bounds>,
  gap: number = FREE_SPACE_GAP,
): NormalizedShape[] {
  const existingBounds = boundsOf(existing)
  if (!existingBounds) return shapes
  const batchBounds = boundsOf(shapes)
  if (!batchBounds) return shapes

  const dx = existingBounds.x - batchBounds.x
  const dy = existingBounds.y + existingBounds.height + gap - batchBounds.y
  // Always return fresh clones (even at zero delta) so callers never get a mix
  // of cloned and aliased shapes back.
  return shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy, props: { ...s.props } }))
}

/** Gap left between two boxes when we pull them apart. */
const SEPARATION_GAP = 24
/** Bounded so a pathological batch can't spin; converges well under this. */
const MAX_ITERATIONS = 200
/** A box counts as "nested" (intentional) when this much of the smaller one is
 *  inside the larger AND the smaller is at most half the larger's area. */
const NEST_CONTAINMENT = 0.6
const NEST_SIZE_RATIO = 0.5
/**
 * In "preserve intentional overlap" mode (pictorial batches), a pair is only
 * pulled apart when it's almost completely stacked — i.e. the overlap covers at
 * least this fraction of the smaller body. That separates accidental duplicates
 * dropped at the same spot while LEAVING the partial overlaps a picture needs
 * (a roof on the walls, stacked snowman circles, the sun over the sky). Diagram
 * batches don't pass this flag, so their boxes still fully de-overlap.
 */
const STACK_OVERLAP_RATIO = 0.75

interface Box {
  /** Index back into the original shapes array. */
  index: number
  x: number
  y: number
  w: number
  h: number
}

function area(b: { w: number; h: number }): number {
  return Math.max(0, b.w) * Math.max(0, b.h)
}

/** Overlap extents on each axis; both > 0 means the rects intersect. */
function overlap(a: Box, b: Box): { ox: number; oy: number } {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return { ox, oy }
}

function overlapArea(a: Box, b: Box): number {
  const { ox, oy } = overlap(a, b)
  return ox > 0 && oy > 0 ? ox * oy : 0
}

/** A small box mostly contained in a much larger one — leave it be. */
function isNested(a: Box, b: Box): boolean {
  const inter = overlapArea(a, b)
  if (inter <= 0) return false
  const smaller = Math.min(area(a), area(b))
  const larger = Math.max(area(a), area(b))
  if (smaller === 0 || larger === 0) return false
  return inter >= NEST_CONTAINMENT * smaller && smaller <= NEST_SIZE_RATIO * larger
}

/** A near-complete stack (likely an accidental duplicate at the same spot):
 *  the overlap covers most of the smaller body. Used only in preserve mode. */
function isAccidentalStack(a: Box, b: Box): boolean {
  const inter = overlapArea(a, b)
  if (inter <= 0) return false
  const smaller = Math.min(area(a), area(b))
  return smaller > 0 && inter >= STACK_OVERLAP_RATIO * smaller
}

/**
 * Push two overlapping boxes apart along their axis of least penetration (the
 * minimum-translation direction), each moving half the distance plus half the
 * gap. Mutates the boxes in place. Deterministic even when centers coincide:
 * ties resolve by box order (`a` toward the negative side, `b` the positive).
 */
function separate(a: Box, b: Box): void {
  const { ox, oy } = overlap(a, b)
  if (ox <= 0 || oy <= 0) return
  const acx = a.x + a.w / 2
  const acy = a.y + a.h / 2
  const bcx = b.x + b.w / 2
  const bcy = b.y + b.h / 2

  if (ox <= oy) {
    // Separate horizontally.
    const shift = (ox + SEPARATION_GAP) / 2
    const dir = bcx === acx ? 1 : Math.sign(bcx - acx)
    a.x -= shift * dir
    b.x += shift * dir
  } else {
    // Separate vertically.
    const shift = (oy + SEPARATION_GAP) / 2
    const dir = bcy === acy ? 1 : Math.sign(bcy - acy)
    a.y -= shift * dir
    b.y += shift * dir
  }
}

/** Best container for a text label: the body with the largest overlap of the
 *  text's box, requiring at least half the text to sit inside it. */
function attachTextToBox(text: Box, boxes: Box[]): number {
  let best = -1
  let bestArea = 0
  const textArea = area(text)
  for (let k = 0; k < boxes.length; k++) {
    const inter = overlapArea(text, boxes[k])
    if (inter > bestArea) {
      bestArea = inter
      best = k
    }
  }
  return best >= 0 && textArea > 0 && bestArea >= 0.5 * textArea ? best : -1
}

/** Options for `deoverlapShapes`. */
export interface DeoverlapOptions {
  /**
   * Pictorial mode: only pull apart bodies that are almost entirely stacked
   * (accidental duplicates), preserving the partial overlaps a picture needs.
   * Defaults to false — diagram/loose batches still fully de-overlap.
   */
  preserveIntentionalOverlap?: boolean
}

/**
 * Return a copy of `shapes` with overlapping container shapes separated. Shape
 * order (z-order) and every non-geometry prop are preserved; only x/y change.
 * A batch with fewer than two bodies is returned effectively unchanged.
 *
 * With `preserveIntentionalOverlap`, only near-complete stacks are separated so
 * a picture's intentionally-touching parts survive (see `STACK_OVERLAP_RATIO`).
 */
export function deoverlapShapes(
  shapes: NormalizedShape[],
  options: DeoverlapOptions = {},
): NormalizedShape[] {
  const preserve = options.preserveIntentionalOverlap === true
  const result = shapes.map((s) => ({ ...s, props: { ...s.props } }))

  const boxes: Box[] = []
  for (let i = 0; i < result.length; i++) {
    const s = result[i]
    if (BODY_TYPES.has(s.type)) boxes.push({ index: i, x: s.x, y: s.y, w: s.width, h: s.height })
  }
  if (boxes.length < 2) return result

  // Remember where each body started so we can carry its labels by the same
  // delta once it has been moved.
  const origin = boxes.map((b) => ({ x: b.x, y: b.y }))

  // Glue each text label to the body it sits in (by current, pre-move position).
  const labelOf = new Map<number, number>() // shape index -> boxes[] index
  for (let i = 0; i < result.length; i++) {
    if (result[i].type !== 'text') continue
    const t = result[i]
    const k = attachTextToBox({ index: i, x: t.x, y: t.y, w: t.width, h: t.height }, boxes)
    if (k >= 0) labelOf.set(i, k)
  }

  // Iteratively separate every colliding, non-nested pair until stable.
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let moved = false
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const { ox, oy } = overlap(boxes[a], boxes[b])
        const colliding = ox > 0 && oy > 0 && !isNested(boxes[a], boxes[b])
        // In preserve mode only accidental near-complete stacks are separated;
        // intentional partial overlaps (a picture's parts) are left alone.
        const shouldSeparate =
          colliding && (!preserve || isAccidentalStack(boxes[a], boxes[b]))
        if (shouldSeparate) {
          separate(boxes[a], boxes[b])
          moved = true
        }
      }
    }
    if (!moved) break
  }

  // Write moved body positions back, and shift each attached label by its
  // body's net displacement so labels stay registered to their container.
  for (const b of boxes) {
    result[b.index].x = b.x
    result[b.index].y = b.y
  }
  for (const [shapeIndex, boxK] of labelOf) {
    const dx = boxes[boxK].x - origin[boxK].x
    const dy = boxes[boxK].y - origin[boxK].y
    result[shapeIndex].x += dx
    result[shapeIndex].y += dy
  }

  return result
}

// --- Hand-built diagram cleanup: de-overlap bodies AND re-route connectors ---

/** Corner of a box (mirrors the editor/`Shape.tsx` corner convention). */
function cornerPoint(b: Box, corner: ShapeCorner): Point {
  const right = b.x + b.w
  const bottom = b.y + b.h
  switch (corner) {
    case 'nw':
      return { x: b.x, y: b.y }
    case 'ne':
      return { x: right, y: b.y }
    case 'sw':
      return { x: b.x, y: bottom }
    case 'se':
      return { x: right, y: bottom }
  }
}

const OPPOSITE_CORNER: Record<ShapeCorner, ShapeCorner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }

/** The two endpoints (in absolute canvas coords) of a connector shape. */
function connectorEndpoints(s: NormalizedShape): { start: Point; end: Point } {
  const pts = s.props.points
  if (Array.isArray(pts) && pts.length >= 2) {
    // Stored bbox-relative with the bbox equal to the shape box, so abs = origin
    // + waypoint (same convention the renderer uses).
    const first = pts[0] as Point
    const last = pts[pts.length - 1] as Point
    return { start: { x: s.x + first.x, y: s.y + first.y }, end: { x: s.x + last.x, y: s.y + last.y } }
  }
  const corner = (typeof s.props.headCorner === 'string' ? s.props.headCorner : 'se') as ShapeCorner
  const box: Box = { index: -1, x: s.x, y: s.y, w: s.width, h: s.height }
  return { start: cornerPoint(box, OPPOSITE_CORNER[corner]), end: cornerPoint(box, corner) }
}

/** Distance from a point to a box (0 if inside). */
function pointToBox(p: Point, b: Box): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w))
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h))
  return Math.hypot(dx, dy)
}

/** Shape index of the body nearest a point, or -1 when there are none. */
function nearestBodyIndex(p: Point, boxes: Box[]): number {
  let best = -1
  let bestD = Infinity
  for (const b of boxes) {
    const d = pointToBox(p, b)
    if (d < bestD) {
      bestD = d
      best = b.index
    }
  }
  return best
}

/** Anchor on the face of `box` that points toward `toward` (side-aware). */
function faceAnchor(box: Box, toward: Point): Point {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: box.x + box.w, y: cy } : { x: box.x, y: cy }
  }
  return dy >= 0 ? { x: cx, y: box.y + box.h } : { x: cx, y: box.y }
}

/** Re-route a connector as an orthogonal elbow between two (moved) boxes. */
function rerouteConnector(s: NormalizedShape, a: Box, b: Box): NormalizedShape {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const pa = faceAnchor(a, cb)
  const pb = faceAnchor(b, ca)
  const horizontalFlow = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)
  const midX = (pa.x + pb.x) / 2
  const midY = (pa.y + pb.y) / 2
  const raw: Point[] = horizontalFlow
    ? [pa, { x: midX, y: pa.y }, { x: midX, y: pb.y }, pb]
    : [pa, { x: pa.x, y: midY }, { x: pb.x, y: midY }, pb]

  const route: Point[] = []
  for (const p of raw) {
    const last = route[route.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) route.push(p)
  }

  const xs = route.map((p) => p.x)
  const ys = route.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const width = Math.max(Math.max(...xs) - minX, 1)
  const height = Math.max(Math.max(...ys) - minY, 1)
  const points = route.map((p) => ({ x: p.x - minX, y: p.y - minY }))
  const horiz = pb.x >= pa.x ? 'e' : 'w'
  const vert = pb.y >= pa.y ? 's' : 'n'
  const headCorner = (vert + horiz) as ShapeCorner
  return { type: s.type, x: minX, y: minY, width, height, props: { ...s.props, headCorner, points } }
}

/**
 * Clean up a hand-built diagram batch: de-overlap the container bodies (and
 * carry their text labels, via `deoverlapShapes`) AND re-route every connector
 * so it stays attached to the boxes it joined. Each connector's endpoints are
 * matched to their nearest body BEFORE the move; afterward the connector is
 * re-emitted as an orthogonal polyline between those bodies' new faces (now
 * possible because connectors can bend — Phase 1). A connector whose ends don't
 * resolve to two distinct bodies is rigidly translated by its one attached
 * body's displacement instead. Pure: shapes in → new shapes out.
 */
export function deoverlapAndReroute(shapes: NormalizedShape[]): NormalizedShape[] {
  const moved = deoverlapShapes(shapes)

  const origBox = new Map<number, Box>()
  const newBox = new Map<number, Box>()
  for (let i = 0; i < shapes.length; i++) {
    if (!BODY_TYPES.has(shapes[i].type)) continue
    origBox.set(i, { index: i, x: shapes[i].x, y: shapes[i].y, w: shapes[i].width, h: shapes[i].height })
    newBox.set(i, { index: i, x: moved[i].x, y: moved[i].y, w: moved[i].width, h: moved[i].height })
  }
  if (origBox.size < 2) return moved

  const result = moved.map((s) => ({ ...s, props: { ...s.props } }))
  const origList = [...origBox.values()]

  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i]
    if (!CONNECTOR_TYPES.has(s.type)) continue
    const { start, end } = connectorEndpoints(s)
    const ka = nearestBodyIndex(start, origList)
    const kb = nearestBodyIndex(end, origList)
    if (ka >= 0 && kb >= 0 && ka !== kb) {
      result[i] = rerouteConnector(s, newBox.get(ka)!, newBox.get(kb)!)
    } else {
      const k = ka >= 0 ? ka : kb
      if (k >= 0) {
        const dx = newBox.get(k)!.x - origBox.get(k)!.x
        const dy = newBox.get(k)!.y - origBox.get(k)!.y
        result[i] = { ...result[i], x: result[i].x + dx, y: result[i].y + dy }
      }
    }
  }

  return result
}
