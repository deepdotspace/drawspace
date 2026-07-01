/**
 * Validate-only canvas tool executor for the chat stream.
 *
 * `makeCanvasExecutor(ctx)` returns the `(toolName, params) => Promise<result>`
 * function `buildCanvasTools` expects. It is pure except that it closes over
 * `ctx` (the request's canvas context) — it NEVER calls a Durable Object or
 * the network. It only validates/normalizes the requested op via the Loop 1
 * shape logic and echoes the result back so the model's multi-step agentic
 * loop can chain create → create → edit within `stepCountIs(5)`.
 *
 * The actual canvas mutation happens CLIENT-side (`canvas-stream.ts`), which
 * watches the same tool-call stream. Keeping `execute` validate-only here is
 * what prevents a double-apply.
 *
 * No worker-runtime / Cloudflare-global import — types only.
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
import type { CanvasContext } from './canvas-tools'

export type CanvasExecutorResult =
  | { ok: true; shape: NormalizedShape }
  | { ok: true; patch: NormalizedShapePatch; shapeId: string }
  | { ok: true; shapeId: string }
  | { ok: true; shapes: CanvasContext['shapes'] }
  | { ok: true; created: number }
  | { ok: false; error: string }

export type CanvasExecutor = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<CanvasExecutorResult>

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function requireShapeId(params: Record<string, unknown>): string {
  const shapeId = params.shapeId
  if (typeof shapeId !== 'string' || shapeId === '') {
    throw new Error('Invalid shapeId: must be a non-empty string')
  }
  return shapeId
}

/**
 * Build a validate-only executor bound to a request's canvas context. Every
 * branch returns `{ ok: true, ... }` on success or `{ ok: false, error }` on
 * invalid input — it never throws out of `execute` (so the stream surfaces a
 * tool result, not a stream-level error).
 */
export function makeCanvasExecutor(ctx: CanvasContext): CanvasExecutor {
  return async (toolName, params) => {
    try {
      switch (toolName) {
        case 'canvas_createShape': {
          const shape = normalizeCreate(params as unknown as ShapeCreateInput)
          return { ok: true, shape }
        }
        case 'canvas_createShapes': {
          const raw = (params as { shapes?: unknown }).shapes
          if (!Array.isArray(raw) || raw.length === 0) {
            return { ok: false, error: 'canvas_createShapes requires a non-empty "shapes" array' }
          }
          // Validate every shape up front; a bad one fails the whole batch so
          // the model gets a clear signal rather than a half-drawn result.
          for (const s of raw) normalizeCreate(s as ShapeCreateInput)
          return { ok: true, created: raw.length }
        }
        case 'canvas_drawDiagram': {
          const shapes = layoutDiagram(params as unknown as DiagramSpec)
          return { ok: true, created: shapes.length }
        }
        case 'canvas_updateShape': {
          const shapeId = requireShapeId(params)
          // Honesty guard: if the target shape isn't on the canvas, return a
          // failure so the model's agentic loop sees it and reports truthfully
          // instead of claiming a no-op succeeded.
          if (!ctx.shapes.some((s) => s.id === shapeId)) {
            return { ok: false, error: `No shape with id "${shapeId}" exists on the canvas` }
          }
          const patch = normalizeEdit(params as unknown as ShapeEditInput)
          return { ok: true, shapeId, patch }
        }
        case 'canvas_deleteShape': {
          const shapeId = requireShapeId(params)
          if (!ctx.shapes.some((s) => s.id === shapeId)) {
            return { ok: false, error: `No shape with id "${shapeId}" exists on the canvas` }
          }
          return { ok: true, shapeId }
        }
        case 'canvas_listShapes':
          return { ok: true, shapes: ctx.shapes }
        default:
          return { ok: false, error: `Unknown canvas tool: ${toolName}` }
      }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }
}
