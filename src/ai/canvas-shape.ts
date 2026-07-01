/**
 * Pure canvas-shape logic — turns an AI assistant's raw tool arguments into
 * validated, normalized shape operations.
 *
 * Side-effect free (args in → value out, no I/O). Used on BOTH the server
 * (validate-only tool `execute`) and the client (applies ops to `useCanvas`),
 * which is why it lives in its own tested module.
 *
 * No imports from `deepspace/worker` runtime — these types are defined here
 * intentionally (the plan does not reuse the SDK's `CanvasShapeClient`).
 */

/**
 * Single source of truth for the shape vocabulary the AI can author. The
 * model-facing zod enum (`canvas-tools.ts`) and the runtime validator below are
 * both derived from this one tuple, so they can never drift. `draw` (freehand)
 * is intentionally excluded — the AI never authors raw stroke paths.
 */
export const CANVAS_SHAPE_TYPES = [
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
  'line',
  'arrow',
  'text',
] as const

export type CanvasShapeType = (typeof CANVAS_SHAPE_TYPES)[number]

const SHAPE_TYPES: readonly CanvasShapeType[] = CANVAS_SHAPE_TYPES

/** Which bbox corner a line/arrow's head sits on (mirrors the editor's model). */
export type ShapeCorner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: readonly ShapeCorner[] = ['nw', 'ne', 'sw', 'se']

function isCorner(v: unknown): v is ShapeCorner {
  return typeof v === 'string' && (CORNERS as readonly string[]).includes(v)
}

/** A 2D point. Mirrors the canvas `Point` but kept local so this module has no
 * dependency on the editor surface (`src/components/canvas`). */
export interface Point {
  x: number
  y: number
}

/**
 * Is `v` a polyline: an array of >= 2 finite {x, y} points? Used to validate
 * the optional `points` waypoints a `line`/`arrow` may carry.
 */
function isPointArray(v: unknown): v is Point[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every(
      (p) =>
        p != null &&
        typeof p === 'object' &&
        Number.isFinite((p as Point).x) &&
        Number.isFinite((p as Point).y),
    )
  )
}

export interface ShapeCreateInput {
  type: CanvasShapeType
  x: number
  y: number
  width: number
  height: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  text?: string
  /** Only meaningful for `line`/`arrow`: which bbox corner the head sits on. */
  headCorner?: ShapeCorner
  /**
   * Only meaningful for `line`/`arrow`: an optional polyline of bbox-relative
   * waypoints (same convention as the freehand `draw` shape). When present the
   * connector bends through these points; when absent it stays a straight
   * corner-to-corner segment driven by `headCorner`. Layout-engine-only — the
   * model-facing tool schema does not expose this field.
   */
  points?: Point[]
}

export interface ShapeEditInput {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  text?: string
}

export interface NormalizedShape {
  type: CanvasShapeType
  x: number
  y: number
  width: number
  height: number
  props: Record<string, unknown>
}

export interface NormalizedShapePatch {
  x?: number
  y?: number
  width?: number
  height?: number
  props?: Record<string, unknown>
}

/**
 * Renderer defaults — match the editor's default style so AI shapes look like
 * hand-drawn ones (fill='transparent', stroke='#6366f1', strokeWidth=3 for a
 * bold, tldraw-style line).
 */
export const SHAPE_DEFAULTS = {
  fill: 'transparent',
  stroke: '#6366f1',
  strokeWidth: 3,
} as const

export function isCanvasShapeType(t: unknown): t is CanvasShapeType {
  return typeof t === 'string' && (SHAPE_TYPES as readonly string[]).includes(t)
}

export function validateShapeType(t: unknown): asserts t is CanvasShapeType {
  if (!isCanvasShapeType(t)) {
    throw new Error(`Invalid shape type: ${String(t)}`)
  }
}

function assertFinite(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${field}: must be a finite number`)
  }
}

function assertPositive(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${field}: must be a finite number > 0`)
  }
}

/**
 * Normalize a create request: validate, coerce numbers, apply style defaults,
 * and collect fill/stroke/strokeWidth/text under `props`. Throws on invalid
 * input. Unknown/extra fields are ignored, never echoed into `props`.
 */
export function normalizeCreate(input: ShapeCreateInput): NormalizedShape {
  validateShapeType(input.type)
  assertFinite(input.x, 'x')
  assertFinite(input.y, 'y')
  assertPositive(input.width, 'width')
  assertPositive(input.height, 'height')

  const props: Record<string, unknown> = {
    fill: input.fill ?? SHAPE_DEFAULTS.fill,
    stroke: input.stroke ?? SHAPE_DEFAULTS.stroke,
    strokeWidth: input.strokeWidth ?? SHAPE_DEFAULTS.strokeWidth,
  }

  if (input.type === 'text' && typeof input.text === 'string') {
    props.text = input.text
  }

  // Direction of a line/arrow is carried as the corner its head points to, so
  // it survives move/resize the same way hand-drawn connectors do.
  if (input.type === 'line' || input.type === 'arrow') {
    if (isCorner(input.headCorner)) {
      props.headCorner = input.headCorner
    }
    // Optional bent route. Stored as a fresh array of plain points so the
    // value is owned by `props` (never an alias of the caller's array) — this
    // matters for the optimistic overlay, which compares `props` by reference.
    if (isPointArray(input.points)) {
      props.points = input.points.map((p) => ({ x: p.x, y: p.y }))
    }
  }

  return {
    type: input.type,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    props,
  }
}

/**
 * Normalize an edit request into a partial patch: only keys actually provided
 * are included. An empty input yields an empty patch (no defaults). Any
 * provided numbers are validated. fill/stroke/strokeWidth/text fold into
 * `props` (only present when at least one style key was provided).
 */
export function normalizeEdit(input: ShapeEditInput): NormalizedShapePatch {
  const patch: NormalizedShapePatch = {}

  if (input.x !== undefined) {
    assertFinite(input.x, 'x')
    patch.x = input.x
  }
  if (input.y !== undefined) {
    assertFinite(input.y, 'y')
    patch.y = input.y
  }
  if (input.width !== undefined) {
    assertPositive(input.width, 'width')
    patch.width = input.width
  }
  if (input.height !== undefined) {
    assertPositive(input.height, 'height')
    patch.height = input.height
  }

  const props: Record<string, unknown> = {}
  if (input.fill !== undefined) props.fill = input.fill
  if (input.stroke !== undefined) props.stroke = input.stroke
  if (input.strokeWidth !== undefined) {
    assertFinite(input.strokeWidth, 'strokeWidth')
    props.strokeWidth = input.strokeWidth
  }
  if (input.text !== undefined) props.text = input.text

  if (Object.keys(props).length > 0) patch.props = props

  return patch
}
