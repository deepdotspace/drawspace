/**
 * Pure merge/reconcile logic for the canvas optimistic overlay.
 *
 * Why this exists: the CanvasRoom DO broadcasts move/resize/update events to
 * every *other* client but NOT back to the sender, and the SDK's `useCanvas`
 * hook applies no optimistic local update. So the user performing a drag never
 * sees their own move/resize/style edit — the shape looks frozen where it was
 * drawn (adds/deletes echo to the sender, so those work). We fix that in the
 * app by keeping a per-shape overlay of the local user's in-flight edits and
 * painting it on top of the server shapes.
 *
 * Kept dependency-free and side-effect-free so the fast Node checker can unit
 * test the merge + reconciliation rules without a DOM or React.
 */

import type { CanvasShapeClient } from 'deepspace'

/** The fields a local edit can optimistically override on a shape. */
export type ShapeOverlay = Partial<
  Pick<CanvasShapeClient, 'x' | 'y' | 'width' | 'height' | 'props'>
>

/** Paint local overlays on top of the server shapes (overlay wins). */
export function mergeShapes(
  server: CanvasShapeClient[],
  overlay: Map<string, ShapeOverlay>,
): CanvasShapeClient[] {
  if (overlay.size === 0) return server
  return server.map((s) => {
    const ov = overlay.get(s.id)
    return ov ? { ...s, ...ov } : s
  })
}

/**
 * Did the server's copy of a shape move on from the snapshot we last saw? Used
 * to decide whether a remote change (another user, or an undo/redo snapshot)
 * should evict our optimistic overlay. `props` is compared by reference: the
 * granular move/resize/update broadcasts replace only the changed shape's
 * object, while an undo/redo of an update broadcasts a FULL snapshot that
 * reallocates every shape's props — which simply evicts all overlays at once
 * (benign: the server snapshot is authoritative and carries the correct data).
 */
export function serverAdvanced(s: CanvasShapeClient, b: CanvasShapeClient): boolean {
  return (
    s.x !== b.x ||
    s.y !== b.y ||
    s.width !== b.width ||
    s.height !== b.height ||
    s.props !== b.props
  )
}

/**
 * Drop overlay entries that the server has caught up on or removed.
 *
 * Our own move/resize/update never echo back, so the server's copy of a shape
 * we're editing stays put and the overlay rightly persists. But when the shape
 * vanishes (deleted) or its server geometry/props change vs the previous
 * snapshot (a remote edit or an undo/redo full-sync), the server is now the
 * source of truth and we evict the stale overlay. Returns the same Map
 * reference when nothing changed so callers can bail on re-renders.
 */
export function reconcileOverlay(
  overlay: Map<string, ShapeOverlay>,
  serverMap: Map<string, CanvasShapeClient>,
  prevServerMap: Map<string, CanvasShapeClient>,
): Map<string, ShapeOverlay> {
  if (overlay.size === 0) return overlay
  let changed = false
  const next = new Map(overlay)
  for (const id of overlay.keys()) {
    const s = serverMap.get(id)
    const before = prevServerMap.get(id)
    if (!s || (before && serverAdvanced(s, before))) {
      next.delete(id)
      changed = true
    }
  }
  return changed ? next : overlay
}
