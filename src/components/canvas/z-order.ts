/**
 * Pure z-order (stacking) logic for the canvas.
 *
 * The SDK has no native shape ordering, so each shape carries an optional
 * numeric `props.z`. Visual order = ascending `z`, with the shape's position in
 * the source array as a stable tiebreak. Shapes with no `z` sort to the TOP
 * (newest-drawn on top) — so before anything is reordered the order matches
 * creation order, and a shape drawn AFTER a reorder still lands on top.
 *
 * `reorderShapes` returns the DESIRED stacking as an array; the caller persists
 * it by writing each shape's new index back to `props.z` (see CanvasEditor).
 * Kept DOM-free and side-effect-free so it's unit-testable in isolation.
 */

export type ReorderKind = 'front' | 'back' | 'forward' | 'backward'

export interface ZShape {
  id: string
  props: Record<string, unknown>
}

function zOf(s: ZShape): number {
  // No explicit z → float to the top (newest on top). Once reordered, every
  // shape is written a finite z index, so this only affects freshly-drawn ones.
  return typeof s.props.z === 'number' ? s.props.z : Number.POSITIVE_INFINITY
}

/** Shapes sorted back-to-front (first = bottom). Stable on equal z. */
export function orderByZ<T extends ZShape>(shapes: T[]): T[] {
  return shapes
    .map((s, i) => ({ s, i }))
    .sort((a, b) => zOf(a.s) - zOf(b.s) || a.i - b.i)
    .map((x) => x.s)
}

/**
 * The new back-to-front ordering after applying `kind` to `selectedIds`:
 * - front:    selection above everything
 * - back:     selection below everything
 * - forward:  selection up one step (hops the nearest shape above it down)
 * - backward: selection down one step (hops the nearest shape below it up)
 *
 * Selections move as a block. A no-op (already at the edge) returns the current
 * order unchanged.
 */
export function reorderShapes<T extends ZShape>(shapes: T[], selectedIds: string[], kind: ReorderKind): T[] {
  const ordered = orderByZ(shapes)
  const sel = new Set(selectedIds)
  if (sel.size === 0) return ordered

  const selected = ordered.filter((s) => sel.has(s.id))
  const rest = ordered.filter((s) => !sel.has(s.id))
  if (selected.length === 0) return ordered

  if (kind === 'front') return [...rest, ...selected]
  if (kind === 'back') return [...selected, ...rest]

  const indexById = new Map(ordered.map((s, i) => [s.id, i]))
  const selIdx = selected.map((s) => indexById.get(s.id) as number)

  if (kind === 'forward') {
    const top = Math.max(...selIdx)
    if (top >= ordered.length - 1) return ordered // already on top
    const neighbor = ordered[top + 1]
    const bottom = Math.min(...selIdx)
    const arr = ordered.filter((s) => s.id !== neighbor.id)
    const insertAt = arr.findIndex((s) => s.id === ordered[bottom].id)
    arr.splice(insertAt, 0, neighbor)
    return arr
  }

  // backward
  const bottom = Math.min(...selIdx)
  if (bottom <= 0) return ordered // already on the bottom
  const neighbor = ordered[bottom - 1]
  const top = Math.max(...selIdx)
  const arr = ordered.filter((s) => s.id !== neighbor.id)
  const insertAfter = arr.findIndex((s) => s.id === ordered[top].id)
  arr.splice(insertAfter + 1, 0, neighbor)
  return arr
}
