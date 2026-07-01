/**
 * Undo batching for the canvas.
 *
 * The DeepSpace CanvasRoom records ONE server undo entry per write message and
 * `undo` reverses exactly one — so a multi-shape action (delete N, paste N,
 * restyle N, move a group…) would otherwise take N undos to reverse, one shape
 * at a time. This batcher tracks how many server writes each user action
 * produced; the canvas hook then replays the underlying undo/redo that many
 * times so a whole action is a single, clean undo step.
 *
 * Pure and side-effect-free (just two number stacks) so it's unit-testable.
 */

export interface UndoBatcher {
  /** Record one server write — counts toward the open batch, or stands alone. */
  recordWrite(): void
  /** Open a batch; subsequent writes coalesce into one undo step. */
  beginBatch(): void
  /**
   * Close the batch. `extraOps` adds writes that happened at close time and
   * weren't individually recorded (e.g. drag move/resize frames flushed on
   * release). An empty batch (no ops) records nothing.
   */
  endBatch(extraOps?: number): void
  /** How many times to call the underlying `undo` for the most recent action. */
  popUndo(): number
  /** How many times to call the underlying `redo` for the most recent undo. */
  popRedo(): number
}

export function createUndoBatcher(): UndoBatcher {
  const undoStack: number[] = []
  const redoStack: number[] = []
  let open = false
  let current = 0

  return {
    recordWrite() {
      // Redo is invalidated by an actual write — mirroring the server, which
      // clears its redo stack per write message, NOT when a batch merely opens.
      redoStack.length = 0
      if (open) {
        current += 1
        return
      }
      // A standalone write is its own undo step.
      undoStack.push(1)
    },
    beginBatch() {
      open = true
      current = 0
      // Deliberately does NOT clear redo: an empty (no-write) gesture — e.g.
      // click-selecting a shape, or touching a handle without dragging — must
      // leave redo intact (the server only clears redo on a real write).
    },
    endBatch(extraOps = 0) {
      if (!open) return
      open = false
      const ops = current + extraOps
      current = 0
      if (ops > 0) {
        undoStack.push(ops)
        // Covers move/resize-only gestures, whose writes are flushed here and
        // never went through recordWrite — they still invalidate redo.
        redoStack.length = 0
      }
    },
    popUndo() {
      const n = undoStack.pop()
      if (n === undefined) return 0
      redoStack.push(n)
      return n
    },
    popRedo() {
      const n = redoStack.pop()
      if (n === undefined) return 0
      undoStack.push(n)
      return n
    },
  }
}
