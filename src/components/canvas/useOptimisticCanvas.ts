/**
 * useOptimisticCanvas — wraps the SDK's `useCanvas` result so the local user
 * sees their own move / resize / style edits *immediately*, the way tldraw and
 * Excalidraw feel (local-first), instead of waiting for a server echo that
 * never comes.
 *
 * Background: the CanvasRoom DO broadcasts CANVAS_MOVE / CANVAS_RESIZE /
 * CANVAS_UPDATE to every OTHER client but excludes the sender, and the SDK
 * hook does no optimistic apply — so the dragging user's local `shapes` array
 * never updates and the shape appears stuck. (Adds/deletes echo to the sender,
 * so those already work.) We keep an overlay of the local user's in-flight
 * edits, paint it on top of the server shapes, and evict an entry once the
 * server's copy advances (a remote edit or an undo/redo snapshot) — see
 * `optimistic-canvas-core.ts` for the pure rules.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasShapeClient, UseCanvasResult } from 'deepspace'
import {
  mergeShapes,
  reconcileOverlay,
  type ShapeOverlay,
} from './optimistic-canvas-core'
import { createUndoBatcher } from './undo-batch'

/**
 * The optimistic canvas plus drag-gesture controls. A pointer drag calls
 * move/resize on every pointer-move; the SDK records each as its OWN undo step,
 * so one drag would take dozens of undos to reverse. `beginGesture` /
 * `endGesture` wrap a drag so the intermediate frames update only the local
 * overlay (smooth locally) and the single net change per shape is written to the
 * server ONCE on release — i.e. one clean undo step per drag.
 *
 * The same begin/endGesture span ALSO groups undo: any number of writes inside
 * it (delete N, paste N, restyle N, nudge a group…) collapse into ONE undo step.
 * `undo` / `redo` here replay the underlying SDK undo/redo once per write the
 * action produced, so a multi-shape action reverses in a single press instead
 * of one shape at a time. See undo-batch.ts.
 *
 * Trade-off: other collaborators see the shape land at its final position on
 * release rather than animating through every intermediate frame. Clean,
 * reversible history is worth more than mid-drag broadcast here.
 */
export interface OptimisticCanvasResult extends UseCanvasResult {
  beginGesture: () => void
  endGesture: () => void
}

export function useOptimisticCanvas(canvas: UseCanvasResult): OptimisticCanvasResult {
  const [overlay, setOverlay] = useState<Map<string, ShapeOverlay>>(() => new Map())

  // Drag-gesture coalescing. While a gesture is open, move/resize update only
  // the overlay and stash the latest value per shape; endGesture flushes one
  // server write per touched shape. Depth-counted so a gesture started while
  // another is open (e.g. a keypress mid-drag) doesn't clobber the outer one —
  // the inner begin/end are absorbed and the outer flush still fires once.
  const gestureDepthRef = useRef(0)
  const pendingMoveRef = useRef(new Map<string, { x: number; y: number }>())
  const pendingResizeRef = useRef(new Map<string, { width: number; height: number; x?: number; y?: number }>())

  // Latest write-access flag, read synchronously in the write callbacks. When
  // false (viewer role, or the WS connect window), edits must NOT touch the
  // overlay or the undo batcher — the SDK drops the server write anyway, so an
  // optimistic apply would strand a phantom local edit and desync undo.
  const canWriteRef = useRef(canvas.canWrite)
  canWriteRef.current = canvas.canWrite

  // Undo batching: the same begin/endGesture span also defines one undo step,
  // so a multi-shape action reverses in a single undo. Writes outside a gesture
  // are their own step. See undo-batch.ts.
  const batcherRef = useRef(createUndoBatcher())
  const recordWrite = useCallback(() => batcherRef.current.recordWrite(), [])

  // Index the server shapes by id for O(1) reconciliation lookups.
  const serverMap = useMemo(() => {
    const m = new Map<string, CanvasShapeClient>()
    for (const s of canvas.shapes) m.set(s.id, s)
    return m
  }, [canvas.shapes])

  // Latest server state, readable synchronously inside the write callbacks
  // (updateShape needs a base props object to merge into).
  const serverMapRef = useRef(serverMap)
  serverMapRef.current = serverMap

  // When the server shapes change, evict overlays the server has caught up on
  // or removed. Tracks the previous snapshot to tell a remote change apart from
  // our own (which never round-trips back to us).
  const prevServerRef = useRef(serverMap)
  useEffect(() => {
    const prev = prevServerRef.current
    prevServerRef.current = serverMap
    setOverlay((ov) => reconcileOverlay(ov, serverMap, prev))
  }, [serverMap])

  const beginGesture = useCallback(() => {
    gestureDepthRef.current += 1
    if (gestureDepthRef.current !== 1) return // already inside a gesture
    pendingMoveRef.current.clear()
    pendingResizeRef.current.clear()
    batcherRef.current.beginBatch()
  }, [])

  const endGesture = useCallback(() => {
    if (gestureDepthRef.current === 0) return
    gestureDepthRef.current -= 1
    if (gestureDepthRef.current !== 0) return // an outer gesture is still open
    // Swap out the pending maps before flushing so any write side effects can't
    // re-enter into a half-cleared map.
    const moves = pendingMoveRef.current
    const resizes = pendingResizeRef.current
    pendingMoveRef.current = new Map()
    pendingResizeRef.current = new Map()
    for (const [id, m] of moves) canvas.moveShape(id, m.x, m.y)
    for (const [id, r] of resizes) canvas.resizeShape(id, r.width, r.height, r.x, r.y)
    // The flushed move/resize writes count toward this batch's single undo step.
    batcherRef.current.endBatch(moves.size + resizes.size)
  }, [canvas.moveShape, canvas.resizeShape])

  const moveShape = useCallback(
    (shapeId: string, x: number, y: number) => {
      if (!canWriteRef.current) return
      setOverlay((prev) => new Map(prev).set(shapeId, { ...prev.get(shapeId), x, y }))
      // During a drag, buffer the latest value and write once on endGesture so
      // the whole drag is a single undo step; otherwise write straight through.
      if (gestureDepthRef.current > 0) pendingMoveRef.current.set(shapeId, { x, y })
      else {
        canvas.moveShape(shapeId, x, y)
        recordWrite()
      }
    },
    [canvas.moveShape, recordWrite],
  )

  const resizeShape = useCallback(
    (shapeId: string, width: number, height: number, x?: number, y?: number) => {
      if (!canWriteRef.current) return
      setOverlay((prev) => {
        const patch: ShapeOverlay = { ...prev.get(shapeId), width, height }
        if (x !== undefined) patch.x = x
        if (y !== undefined) patch.y = y
        return new Map(prev).set(shapeId, patch)
      })
      if (gestureDepthRef.current > 0) pendingResizeRef.current.set(shapeId, { width, height, x, y })
      else {
        canvas.resizeShape(shapeId, width, height, x, y)
        recordWrite()
      }
    },
    [canvas.resizeShape, recordWrite],
  )

  const updateShape = useCallback(
    (shapeId: string, props: Record<string, unknown>) => {
      if (!canWriteRef.current) return
      setOverlay((prev) => {
        const cur = prev.get(shapeId) ?? {}
        const baseProps = cur.props ?? serverMapRef.current.get(shapeId)?.props ?? {}
        return new Map(prev).set(shapeId, { ...cur, props: { ...baseProps, ...props } })
      })
      canvas.updateShape(shapeId, props)
      recordWrite()
    },
    [canvas.updateShape, recordWrite],
  )

  // Adds/deletes echo back to the sender, so they need no optimistic overlay —
  // but they DO need to be counted for undo batching.
  const addShape = useCallback(
    (shape: Partial<CanvasShapeClient>) => {
      if (!canWriteRef.current) return
      canvas.addShape(shape)
      recordWrite()
    },
    [canvas.addShape, recordWrite],
  )

  const deleteShape = useCallback(
    (shapeId: string) => {
      if (!canWriteRef.current) return
      canvas.deleteShape(shapeId)
      recordWrite()
    },
    [canvas.deleteShape, recordWrite],
  )

  // Undo/redo reverse a whole user action: replay the underlying SDK undo/redo
  // once per write the action produced (1 for a standalone write).
  const undo = useCallback(() => {
    const n = batcherRef.current.popUndo()
    for (let i = 0; i < n; i++) canvas.undo()
  }, [canvas.undo])

  const redo = useCallback(() => {
    const n = batcherRef.current.popRedo()
    for (let i = 0; i < n; i++) canvas.redo()
  }, [canvas.redo])

  const shapes = useMemo(() => mergeShapes(canvas.shapes, overlay), [canvas.shapes, overlay])

  return {
    ...canvas,
    shapes,
    addShape,
    deleteShape,
    moveShape,
    resizeShape,
    updateShape,
    undo,
    redo,
    beginGesture,
    endGesture,
  }
}
