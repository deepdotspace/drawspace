/**
 * Pure client-side mapping from decoded AI tool calls to canvas operations.
 *
 * This is the unit-tested core of the canvas wiring. It has NO React or
 * Cloudflare-global dependency — only the pure shape logic from Loop 1 and a
 * small `CanvasApi` interface that mirrors the real `useCanvas` write methods.
 *
 * Flow: the client reads the `POST /api/ai/chat` SSE stream, decodes each
 * chunk to an `AiStreamAction`, and for every `upsert-tool-call` calls
 * `toolCallToCanvasOp(toolName, input)` → `applyCanvasOp(op, canvas)`. The
 * server's tool `execute` is validate-only, so the CLIENT is the single writer
 * to `useCanvas` (keeps RBAC + live Yjs sync intact, no double-apply).
 */

import {
  normalizeCreate,
  normalizeEdit,
  type ShapeCreateInput,
  type ShapeEditInput,
  type NormalizedShape,
  type NormalizedShapePatch,
} from './canvas-shape'
import { layoutDiagram, type DiagramSpec } from './diagram-layout'
import { deoverlapShapes, deoverlapAndReroute, placeInFreeSpace, type Bounds } from './shape-layout'

/**
 * Where to drop a freshly-built batch so it doesn't land on top of what's
 * already on the canvas. `existing` is the set of bounding boxes the caller has
 * accumulated for THIS turn — the pre-turn shapes plus everything the same turn
 * has already placed. Passing it makes multi-call turns tile downward instead
 * of self-stacking at a fixed origin. Omit it entirely and placement is a no-op
 * (positions are left exactly as the model / layout produced them).
 */
export interface PlacementContext {
  existing: ReadonlyArray<Bounds>
}

/**
 * A normalized canvas operation, ready to apply to `useCanvas`. The `update`
 * patch carries the normalized geometry/props from `normalizeEdit`.
 */
export type CanvasOp =
  | { kind: 'create'; shape: NormalizedShape }
  | { kind: 'update'; shapeId: string; patch: NormalizedShapePatch }
  | { kind: 'delete'; shapeId: string }

/**
 * Minimal canvas write surface — matches the real `useCanvas` method
 * signatures verified in `node_modules/deepspace/dist/index.d.ts`:
 *   addShape(shape: Partial<CanvasShapeClient>): void
 *   updateShape(shapeId: string, props: Record<string, unknown>): void
 *   moveShape(shapeId: string, x: number, y: number): void
 *   resizeShape(shapeId: string, width: number, height: number, x?, y?): void
 *   deleteShape(shapeId: string): void
 *
 * CRITICAL: the room's CANVAS_UPDATE handler spreads `updateShape`'s second
 * argument DIRECTLY into `shape.props` (`{ ...existing.props, ...props }`) and
 * touches nothing else. So `updateShape` carries STYLE props ONLY (fill,
 * stroke, strokeWidth, text) — passed FLAT, never wrapped in another `{ props }`
 * (a wrapper would land as `shape.props.props.*` and never recolor anything).
 * Geometry (x/y/width/height) is NOT carried by `updateShape`; it must go
 * through `moveShape` / `resizeShape`, which take ABSOLUTE values per axis.
 *
 * No React dependency so it can be exercised with a mock in unit tests.
 */
export interface CanvasApi {
  addShape: (shape: {
    type: string
    x: number
    y: number
    width: number
    height: number
    props: Record<string, unknown>
  }) => void
  updateShape: (shapeId: string, props: Record<string, unknown>) => void
  moveShape: (shapeId: string, x: number, y: number) => void
  resizeShape: (shapeId: string, width: number, height: number, x?: number, y?: number) => void
  deleteShape: (shapeId: string) => void
}

/**
 * The current geometry of the shape an `update` op targets. Supplied by the
 * caller (read from the live `useCanvas` shapes) so `applyCanvasOp` can fill in
 * the axis the patch omits — `moveShape`/`resizeShape` need BOTH axes, but an
 * AI patch may only set one (e.g. `{ x: 10 }` or `{ width: 80 }`).
 */
export interface CurrentGeometry {
  x: number
  y: number
  width: number
  height: number
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object') {
    throw new Error('Tool input must be an object')
  }
  return input as Record<string, unknown>
}

function requireShapeId(input: Record<string, unknown>): string {
  const shapeId = input.shapeId
  if (typeof shapeId !== 'string' || shapeId === '') {
    throw new Error('Invalid shapeId: must be a non-empty string')
  }
  return shapeId
}

/**
 * Map a decoded `upsert-tool-call` (`toolName` + raw `input`) into a
 * `CanvasOp`. Returns `null` for any non-canvas tool (e.g. `records_query`)
 * so the caller can ignore record tools. Surfaces Loop 1 validation errors
 * (throws) on a bad canvas payload rather than producing an invalid op.
 */
export function toolCallToCanvasOp(toolName: string, input: unknown): CanvasOp | null {
  switch (toolName) {
    case 'canvas_createShape': {
      const shape = normalizeCreate(asRecord(input) as unknown as ShapeCreateInput)
      return { kind: 'create', shape }
    }
    case 'canvas_updateShape': {
      const record = asRecord(input)
      const shapeId = requireShapeId(record)
      const patch = normalizeEdit(record as unknown as ShapeEditInput)
      return { kind: 'update', shapeId, patch }
    }
    case 'canvas_deleteShape': {
      const shapeId = requireShapeId(asRecord(input))
      return { kind: 'delete', shapeId }
    }
    // canvas_listShapes is a read; it produces no canvas mutation. All
    // non-canvas tools (records_*, schema_*, user_*) also fall through.
    default:
      return null
  }
}

/**
 * Map a decoded tool call into ZERO OR MORE `CanvasOp`s. This is the superset of
 * `toolCallToCanvasOp` that also handles the batch/diagram tools, where one tool
 * call expands into many shapes:
 *  - `canvas_createShapes` → one create op per shape in the batch.
 *  - `canvas_drawDiagram`  → runs the auto-layout and emits a create op per
 *    produced shape (node containers, labels, and connecting arrows).
 * Single-shape and edit tools delegate to `toolCallToCanvasOp`. Returns `[]` for
 * any non-canvas / read-only tool. Throws on an invalid canvas payload, same as
 * the singular mapper (the caller wraps this in try/catch).
 */
export function toolCallToCanvasOps(
  toolName: string,
  input: unknown,
  placement?: PlacementContext,
): CanvasOp[] {
  const place = (shapes: NormalizedShape[]): NormalizedShape[] =>
    placement ? placeInFreeSpace(shapes, placement.existing) : shapes

  switch (toolName) {
    case 'canvas_createShapes': {
      const raw = (asRecord(input) as { shapes?: unknown }).shapes
      if (!Array.isArray(raw)) throw new Error('canvas_createShapes requires a "shapes" array')
      const normalized = raw.map((s) => normalizeCreate(s as ShapeCreateInput))
      // A batch that wires boxes together with its own arrows/lines is a
      // hand-built diagram. Now that connectors can bend (Phase 1), we no longer
      // have to leave such a batch untouched: de-overlap the bodies AND re-route
      // their connectors onto the bodies' new faces, so the diagram is actually
      // cleaned up rather than shipped with the model's bad coordinates. Loose
      // batches (no connectors) still get the plain body de-overlap so stacked
      // boxes are pulled apart.
      const bodies = normalized.filter((s) => s.type === 'rect' || s.type === 'ellipse' || s.type === 'diamond')
      const connectors = normalized.filter((s) => s.type === 'line' || s.type === 'arrow')
      const isHandBuiltDiagram = connectors.length > 0 && bodies.length >= 2
      // A connector-wired batch is a hand-built diagram → fully de-overlap and
      // re-route. A loose, connector-free batch is treated as a PICTURE: only
      // accidental near-complete stacks are pulled apart, so intentionally
      // touching parts (roof on walls, stacked circles) survive.
      const arranged = isHandBuiltDiagram
        ? deoverlapAndReroute(normalized)
        : deoverlapShapes(normalized, { preserveIntentionalOverlap: true })
      return place(arranged).map((shape) => ({ kind: 'create', shape }))
    }
    case 'canvas_drawDiagram': {
      const shapes = layoutDiagram(input as DiagramSpec)
      return place(shapes).map((shape: NormalizedShape) => ({ kind: 'create', shape }))
    }
    default: {
      const op = toolCallToCanvasOp(toolName, input)
      if (!op) return []
      // A lone create (the model ignoring the batch tools) still needs placing,
      // or N singular creates in a turn stack on each other and on existing
      // content. Edits/deletes target existing ids and are never repositioned.
      if (op.kind === 'create' && placement) {
        const [placed] = place([op.shape])
        return [{ kind: 'create', shape: placed }]
      }
      return [op]
    }
  }
}

/**
 * Bounding boxes of the `create` ops in a list. Callers thread these back into
 * the placement accumulator so the NEXT tool call of the same turn tiles below
 * what this one just drew (see AiAssistant's turn loop). Non-create ops (edits,
 * deletes) contribute nothing.
 */
export function createdOpBounds(ops: CanvasOp[]): Bounds[] {
  const out: Bounds[] = []
  for (const op of ops) {
    if (op.kind === 'create') {
      out.push({ x: op.shape.x, y: op.shape.y, width: op.shape.width, height: op.shape.height })
    }
  }
  return out
}

/**
 * Apply a `CanvasOp` to a `useCanvas`-shaped surface.
 *
 * For an `update` op the patch is split by destination:
 *  - STYLE props (`patch.props`: fill/stroke/strokeWidth/text) go to
 *    `updateShape(shapeId, props)` FLAT — never re-wrapped in `{ props }`, or
 *    they'd land at `shape.props.props.*` and the renderer would never see them.
 *  - GEOMETRY (`patch.x/y`) routes through `moveShape(shapeId, x, y)` and
 *    (`patch.width/height`) through `resizeShape(shapeId, w, h, x?, y?)`, both of
 *    which need ABSOLUTE values for the pair. The patch may set only one axis,
 *    so the missing axis is filled from `currentGeometry`. If a geometry field
 *    is present but no current geometry is available to complete the pair, that
 *    move/resize is safely skipped (never throws).
 */
export function applyCanvasOp(
  op: CanvasOp,
  canvas: CanvasApi,
  currentGeometry?: CurrentGeometry,
): void {
  switch (op.kind) {
    case 'create':
      canvas.addShape({
        type: op.shape.type,
        x: op.shape.x,
        y: op.shape.y,
        width: op.shape.width,
        height: op.shape.height,
        props: op.shape.props,
      })
      return
    case 'update': {
      // 1. Style props — flat, only when there's actually something to apply.
      if (op.patch.props && Object.keys(op.patch.props).length > 0) {
        canvas.updateShape(op.shapeId, op.patch.props)
      }

      // 2. Position — moveShape needs an absolute (x, y) pair.
      if (op.patch.x !== undefined || op.patch.y !== undefined) {
        const x = op.patch.x ?? currentGeometry?.x
        const y = op.patch.y ?? currentGeometry?.y
        if (x !== undefined && y !== undefined) {
          canvas.moveShape(op.shapeId, x, y)
        }
      }

      // 3. Size — resizeShape needs an absolute (width, height) pair; x/y are
      // optional re-anchors, forwarded only when the patch carries them.
      if (op.patch.width !== undefined || op.patch.height !== undefined) {
        const width = op.patch.width ?? currentGeometry?.width
        const height = op.patch.height ?? currentGeometry?.height
        if (width !== undefined && height !== undefined) {
          canvas.resizeShape(op.shapeId, width, height, op.patch.x, op.patch.y)
        }
      }
      return
    }
    case 'delete':
      canvas.deleteShape(op.shapeId)
      return
    default: {
      // Exhaustiveness check — a new CanvasOp kind without a case here fails
      // this assignment at compile time.
      const _exhaustive: never = op
      void _exhaustive
      return
    }
  }
}
