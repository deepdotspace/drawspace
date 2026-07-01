/**
 * Canvas hard-purge — the cleanup half of the soft-delete model.
 *
 * Deleting a board is a SOFT delete (it just sets `deletedAt` on the record, so
 * it can be restored from Trash). This module does the eventual HARD delete:
 * it removes the metadata record AND wipes the board's CanvasRoom Durable Object
 * storage (the actual shapes), so deleted data is genuinely erased rather than
 * orphaned forever. Used by:
 *   - the `DELETE /api/canvas/:docId` route in worker.ts ("Delete forever"), and
 *   - the daily `purge-trash` cron task (src/cron.ts), which sweeps boards whose
 *     `deletedAt` is older than the retention window.
 *
 * `isCanvasExpired` is pure (and unit-tested); the rest touch DO bindings.
 *
 * Type-only import of `Env` from worker.ts — erased at runtime, so there is no
 * import cycle (worker.ts imports THIS module at runtime).
 */

import type { Env } from '../worker.js'

/** How long a soft-deleted board lingers in Trash before it's hard-purged. */
export const PURGE_RETENTION_DAYS = 30
export const PURGE_RETENTION_MS = PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000

/**
 * Is a soft-deleted board past its retention window (and so eligible for hard
 * purge)? Pure. Unset/empty `deletedAt` (a live board) or an unparseable value
 * → false, so a malformed marker is never treated as expired.
 */
export function isCanvasExpired(
  deletedAt: string | undefined | null,
  nowMs: number,
  retentionMs: number = PURGE_RETENTION_MS,
): boolean {
  if (!deletedAt) return false
  const t = Date.parse(deletedAt)
  if (Number.isNaN(t)) return false
  return nowMs - t >= retentionMs
}

interface ToolResult<T> {
  success?: boolean
  error?: string
  data?: T
}

interface CanvasQueryRecord {
  recordId: string
  data?: { deletedAt?: string }
}

function recordRoomStub(env: Env): DurableObjectStub {
  return env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.APP_NAME}`))
}

/**
 * Run a records tool as an APP ACTION (bypasses per-user RBAC) against the app's
 * RecordRoom — same mechanism worker.ts uses for `getDocumentForAccess`.
 */
async function execAppTool<T>(env: Env, tool: string, params: Record<string, unknown>): Promise<ToolResult<T>> {
  try {
    const res = await recordRoomStub(env).fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': env.OWNER_USER_ID,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({ tool, params }),
      }),
    )
    if (!res.ok) return { success: false, error: `tool ${tool} returned HTTP ${res.status}` }
    return (await res.json()) as ToolResult<T>
  } catch (err) {
    // Never throw out of a tool call: a malformed/non-JSON response or a DO
    // hiccup must not abort the whole cron sweep mid-run.
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Wipe a board's CanvasRoom DO storage (all shapes). The AppCanvasRoom in
 *  worker.ts handles `POST /__purge` → storage.deleteAll(). */
export async function purgeCanvasRoom(env: Env, docId: string): Promise<void> {
  const stub = env.CANVAS_ROOMS.get(env.CANVAS_ROOMS.idFromName(docId))
  await stub.fetch(new Request('https://internal/__purge', { method: 'POST' }))
}

/**
 * Hard-delete one board: wipe its realtime shape storage, then remove the
 * metadata record. Order matters — purge the DO first so that even if the
 * record delete fails, we don't leave shape data behind a still-present record.
 */
export async function hardDeleteCanvas(env: Env, docId: string): Promise<void> {
  await purgeCanvasRoom(env, docId)
  await execAppTool(env, 'records.delete', { collection: 'canvases', recordId: docId })
}

/** Record ids of every board whose soft-delete is past the retention window. */
export async function findExpiredCanvases(env: Env, nowMs: number): Promise<string[]> {
  const result = await execAppTool<{ records?: CanvasQueryRecord[] }>(env, 'records.query', {
    collection: 'canvases',
  })
  const records = result.data?.records ?? []
  return records.filter((r) => isCanvasExpired(r.data?.deletedAt, nowMs)).map((r) => r.recordId)
}

/**
 * Sweep + hard-delete every expired board. Returns how many were purged. A
 * failure on one board is logged and skipped so the rest of the sweep proceeds.
 */
export async function runCanvasPurgeSweep(env: Env, nowMs: number): Promise<number> {
  const ids = await findExpiredCanvases(env, nowMs)
  for (const id of ids) {
    try {
      await hardDeleteCanvas(env, id)
    } catch (err) {
      console.error('[purge-trash] failed to purge canvas', id, err)
    }
  }
  return ids.length
}
