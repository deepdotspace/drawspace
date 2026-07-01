/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the DO itself records executions, tracks history, and
 * pushes status to admin clients via the `/ws/cron/:roomId` WebSocket.
 *
 * Each task declares EITHER `intervalMinutes` (run every N minutes) OR
 * `schedule` + `timezone` (5-field cron expression). CronRoom validates
 * the config at construction time and throws on ambiguous declarations.
 *
 * Example:
 *
 *   import type { CronTask } from 'deepspace/worker'
 *   import { buildCronContext } from 'deepspace/worker'
 *
 *   export const tasks: CronTask[] = [
 *     { name: 'heartbeat', intervalMinutes: 1 },
 *     { name: 'daily-report', schedule: '0 9 * * *', timezone: 'America/New_York' },
 *   ]
 *
 *   export async function runTask(name: string, env: Env): Promise<void> {
 *     const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.APP_NAME}`)
 *     if (name === 'heartbeat') {
 *       // …
 *     }
 *   }
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker.js'
import { runCanvasPurgeSweep } from './canvas-purge.js'

export const PURGE_TRASH_TASK = 'purge-trash'

export const tasks: CronTask[] = [
  // Hard-delete boards that have sat in Trash past the retention window. Runs
  // daily at 03:30 UTC (off-peak). See src/canvas-purge.ts.
  { name: PURGE_TRASH_TASK, schedule: '30 3 * * *', timezone: 'UTC' },
]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name === PURGE_TRASH_TASK) {
    const purged = await runCanvasPurgeSweep(env, Date.now())
    if (purged > 0) console.log(`[purge-trash] hard-deleted ${purged} expired board(s)`)
  }
}
