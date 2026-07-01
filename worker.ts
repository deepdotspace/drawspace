/**
 * App Worker — Hono-based Cloudflare Worker for DeepSpace apps.
 *
 * Each app owns its RecordRoom DOs. Schemas are baked in at deploy time.
 *
 * Handles:
 *   - WebSocket → app's own RecordRoom DO (real-time data)
 *   - Auth proxy → auth-worker (same-origin cookies)
 *   - Integration proxy → api-worker (LLM, search, etc.)
 *   - AI chat (Vercel AI SDK + DeepSpace proxy)
 *   - Server actions (app-defined, bypass user RBAC)
 *   - Scoped R2 file storage
 *   - HMAC-authenticated cron
 *   - Static asset serving with SPA fallback
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { verifyJwt, apiWorkerFetch, platformWorkerFetch, authWorkerFetch } from 'deepspace/worker'
import type { JwtVerifierConfig, VerifyResult } from 'deepspace/worker'
import { RecordRoom, YjsRoom, CanvasRoom, PresenceRoom, CronRoom, JobRoom } from 'deepspace/worker'
import type { Job, JobContext, ActionTools, ActionResult, DOManifest, DOBindings } from 'deepspace/worker'
import { actions } from './src/actions/index.js'
import { tasks as cronTasks, runTask as runCronTask } from './src/cron.js'
import { runJob } from './src/jobs.js'
import { schemas } from './src/schemas.js'
import { integrations } from './src/integrations.js'
import { registerAiChatRoutes } from './src/ai/chat-routes.js'
import { hardDeleteCanvas } from './src/canvas-purge.js'

// =============================================================================
// DO Manifest — declares all Durable Objects for dynamic deploy bindings
// =============================================================================

export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'JOB_ROOMS', className: 'AppJobRoom', sqlite: true },
] as const satisfies DOManifest

// =============================================================================
// Durable Objects — extend to customize behavior
// =============================================================================

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }
}

export class AppYjsRoom extends YjsRoom<Env> {}

/**
 * AppCanvasRoom — the collaborative drawing room, plus an internal purge hook.
 *
 * Deleting a board soft-deletes its record (it goes to Trash). When a board is
 * hard-deleted ("Delete forever" or the `purge-trash` cron), the record alone
 * isn't enough — the shapes live in THIS DO's SQLite (`canvas_state`). So we
 * expose an internal `POST /__purge` that wipes all DO storage, called from
 * `hardDeleteCanvas` (src/canvas-purge.ts). The route is internal-only:
 * nothing in worker.ts forwards a public request to it; only same-isolate DO
 * stubs (the purge helpers) reach it.
 */
export class AppCanvasRoom extends CanvasRoom<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/__purge') {
      await this.state.storage.deleteAll()
      return new Response(null, { status: 204 })
    }
    return super.fetch(request)
  }
}

export class AppPresenceRoom extends PresenceRoom<Env> {}

/**
 * AppCronRoom — runs scheduled tasks defined in src/cron.ts.
 *
 * Tasks are configured at construction time. The DO alarm fires at the
 * next interval / cron-expression match, calls `onTask(name)`, and
 * records the execution in its `cron_history` table. Admin clients can
 * watch via the `useCronMonitor('app:<APP_NAME>')` hook.
 */
export class AppCronRoom extends CronRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
  }

  protected async onTask(taskName: string): Promise<void> {
    await runCronTask(taskName, this.env)
  }
}

/**
 * AppJobRoom — durable background-job queue defined in src/jobs.ts.
 *
 * Use this for any work that needs to outlive an HTTP response: AI
 * generation, exports, renders, scheduled side effects. The DO alarm
 * picks up queued jobs and calls `onJob(job, ctx)`; crashes mid-run are
 * recovered automatically. Clients enqueue and subscribe via the
 * `useJobs('app:<APP_NAME>')` hook; server-side code uses the
 * `enqueueJob` helper from 'deepspace/worker'.
 */
export class AppJobRoom extends JobRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }

  protected async onJob(job: Job, ctx: JobContext): Promise<unknown> {
    return await runJob(job, ctx, this.env)
  }
}

// =============================================================================
// Types
// =============================================================================

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  /**
   * Upstream platform-worker. In production this is a [[services]] binding;
   * in `deepspace dev` the binding is absent and the helper falls back to
   * `PLATFORM_WORKER_URL` (written into .dev.vars by the CLI).
   *
   * R2 lives on the platform side, not the app: the `/api/files/*` route
   * below proxies to platform-worker `/internal/files/*` which serves a
   * shared `APP_FILES` bucket scoped per-app via the `?scope=` query:
   *   - `?scope=app`  → apps/<APP_NAME>/…       (per-app shared)
   *   - `?scope=self` → apps/<APP_NAME>/users/<userId>/…  (per-user, default)
   *
   * Apps don't need a local R2 binding for the standard flow. If you need
   * a wholly separate bucket, add `[[r2_buckets]]` to wrangler.toml AND a
   * field here — but prefer the proxied path so the platform retains
   * unified moderation / quota / cleanup hooks.
   */
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  APP_IDENTITY_TOKEN: string
  /**
   * Upstream api-worker. Same pattern as PLATFORM_WORKER above —
   * binding in prod, URL fallback in dev.
   */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  APP_NAME: string
  OWNER_USER_ID: string
  /**
   * Long-lived JWT minted for the app owner at deploy time. Server-side
   * code (actions, cron, AI helpers) uses this to authenticate to the
   * api-worker for developer-billed calls — the owner is billed because
   * they are the JWT subject.
   */
  APP_OWNER_JWT: string
  /**
   * When set to "true", the app worker exposes /api/debug/* (set-role,
   * sql, query, records, status) by forwarding to the RecordRoom DO's
   * debug handler. Tests need this for role elevation and state cleanup.
   *
   * The CLI writes this to .dev.vars on `deepspace dev`/`deepspace test`
   * but never to production secrets, so deployed apps don't expose
   * debug routes by default.
   */
  ALLOW_DEBUG_ROUTES?: string
}

export type AppContext = { Bindings: Env }

// =============================================================================
// App
// =============================================================================

const app = new Hono<AppContext>()
app.use('/api/*', cors())

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function jwtConfig(env: Env): JwtVerifierConfig {
  return { publicKey: env.AUTH_JWT_PUBLIC_KEY, issuer: env.AUTH_JWT_ISSUER }
}

async function resolveAuth(req: Request, env: Env): Promise<VerifyResult | null> {
  const header = req.headers.get('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  return (await verifyJwt(jwtConfig(env), token)).result
}

// ---------------------------------------------------------------------------
// Social OAuth redirect + code exchange
// ---------------------------------------------------------------------------

app.get('/api/auth/social-redirect', (c) => {
  const provider = c.req.query('provider')
  if (!provider) return c.json({ error: 'Missing provider' }, 400)

  const appOrigin = new URL(c.req.url).origin
  const authOrigin = new URL(c.env.AUTH_WORKER_URL).origin

  return c.redirect(
    `${authOrigin}/login/social?provider=${encodeURIComponent(provider)}&returnTo=${encodeURIComponent(appOrigin)}`,
  )
})

app.get('/api/auth/oauth-complete', async (c) => {
  const code = c.req.query('code')
  const appOrigin = new URL(c.req.url).origin

  if (!code) return c.redirect(appOrigin)

  const res = await authWorkerFetch(c.env, '/api/auth/exchange-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })

  if (!res.ok) return c.redirect(appOrigin)
  const data = (await res.json()) as { sessionToken?: string }
  if (!data.sessionToken) return c.redirect(appOrigin)
  const sessionToken = data.sessionToken

  return new Response(null, {
    status: 302,
    headers: {
      Location: appOrigin,
      'Set-Cookie': `__Secure-better-auth.session_token=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  })
})

app.all('/api/auth/sign-out', async (c) => {
  try {
    await authWorkerFetch(c.env, '/api/auth/sign-out', {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
    })
  } catch {
    // Still expire the app-scoped cookie below. A network/auth-worker
    // failure must not leave the browser immediately signed back in.
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': '__Secure-better-auth.session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  })
})

// ---------------------------------------------------------------------------
// Auth proxy → auth-worker (same-origin cookies)
// ---------------------------------------------------------------------------

app.all('/api/auth/*', async (c) => {
  const url = new URL(c.req.url)
  const res = await authWorkerFetch(c.env, url.pathname + url.search, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
  })
  const headers = new Headers(res.headers)
  const setCookie = headers.get('set-cookie')
  if (setCookie) {
    headers.set('set-cookie', setCookie.replace(/;\s*Domain=[^;]*/gi, ''))
  }
  return new Response(res.body, { status: res.status, headers })
})

// ---------------------------------------------------------------------------
// Debug proxy → app's RecordRoom DO
//
// Forwards /api/debug/* (set-role, sql, query, records, user-role, status)
// to the DO's debug handler. The DO ships these endpoints unconditionally,
// so we gate the proxy on env.ALLOW_DEBUG_ROUTES === "true". The CLI
// writes that env var to the SDK-managed section of .dev.vars on
// `deepspace dev`/`deepspace test`, which is stripped on deploy —
// production apps return 404 here by default.
//
// To opt /api/debug/* INTO production (admin scripts, one-off cleanup,
// staging environments), set `ALLOW_DEBUG_ROUTES=true` in the USER
// section of .dev.vars (below the `# --- not managed by the SDK ---`
// divider). The CLI ships user-section values as secret_text bindings,
// so it lands in env.ALLOW_DEBUG_ROUTES on the deployed worker.
// The DO's debug handler has NO auth — anyone who can reach this route
// can read and mutate any record. Turn this on deliberately.
// ---------------------------------------------------------------------------

app.all('/api/debug/*', async (c) => {
  if (c.env.ALLOW_DEBUG_ROUTES !== 'true') {
    return c.notFound()
  }
  const stub = c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(`app:${c.env.APP_NAME}`))
  // Forward verbatim, preserving method, headers, body, and the full URL
  // (the DO's debug handler dispatches on url.pathname).
  return stub.fetch(c.req.raw)
})

// ---------------------------------------------------------------------------
// Integrations proxy → api-worker
// ---------------------------------------------------------------------------

app.get('/api/integrations', async (c) => {
  try {
    const res = await apiWorkerFetch(c.env, '/api/integrations')
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Failed to fetch integration catalog' }, 502)
  }
})

// OAuth: per-user connection status. Always user-billed — must forward caller's JWT.
app.get('/api/integrations/status', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Sign in required' }, 401)
  const token = c.req.header('Authorization')?.slice(7)
  try {
    const res = await apiWorkerFetch(c.env, '/api/integrations/status', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Status proxy failed' }, 502)
  }
})

// OAuth: disconnect a provider for the calling user. Always user-billed.
app.delete('/api/integrations/oauth/:provider/disconnect', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Sign in required' }, 401)
  const token = c.req.header('Authorization')?.slice(7)
  const provider = c.req.param('provider')
  try {
    const res = await apiWorkerFetch(
      c.env,
      `/api/integrations/oauth/${encodeURIComponent(provider)}/disconnect`,
      {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    )
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Disconnect proxy failed' }, 502)
  }
})

app.all('/api/integrations/:name/:endpoint', async (c) => {
  const integrationName = c.req.param('name')
  const billingMode = integrations[integrationName]?.billing ?? 'developer'

  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth && billingMode === 'user') {
    return c.json({ error: 'Sign in required for this integration' }, 401)
  }

  const target = `/api/integrations/${integrationName}/${c.req.param('endpoint')}`

  const headers: Record<string, string> = {
    'Content-Type': c.req.header('Content-Type') ?? 'application/json',
  }

  // Pick the JWT whose subject is the user we want billed:
  //   - developer-billed → the app owner (via APP_OWNER_JWT)
  //   - user-billed      → the caller (forward their Bearer token)
  // The api-worker bills the JWT subject; it does not accept any
  // client-supplied billing override.
  if (billingMode === 'developer') {
    headers['Authorization'] = `Bearer ${c.env.APP_OWNER_JWT}`
  } else {
    const token = c.req.header('Authorization')?.slice(7)
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
  const body = hasBody ? await c.req.text() : undefined

  try {
    const res = await apiWorkerFetch(c.env, target, {
      method: c.req.method,
      headers,
      body,
    })
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Integration proxy failed' }, 502)
  }
})

// ---------------------------------------------------------------------------
// WebSocket routes
// ---------------------------------------------------------------------------

// The DO reads identity (userId, userName, userEmail, userImageUrl, role)
// off the URL it receives and trusts it. Anything the client put on the URL
// is stripped on every code path; identity is re-applied only from a
// verified JWT. Three states: no token = anonymous (the SDK's
// allowAnonymous flow), invalid token = 401, valid token = JWT identity.
function wsRoute(
  doNamespace: (env: Env) => DurableObjectNamespace,
  extraParams?: (auth: VerifyResult) => Record<string, string>,
) {
  return async (c: any) => {
    const id = c.req.param('roomId') ?? c.req.param('docId') ?? c.req.param('scopeId')
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token')

    let auth: VerifyResult | null = null
    if (token) {
      auth = (await verifyJwt(jwtConfig(c.env), token)).result
      if (!auth) return new Response('Unauthorized', { status: 401 })
    }

    const doUrl = new URL(c.req.url)
    doUrl.searchParams.delete('token')
    for (const k of ['userId', 'userName', 'userEmail', 'userImageUrl', 'role']) {
      doUrl.searchParams.delete(k)
    }

    if (auth) {
      doUrl.searchParams.set('userId', auth.userId)
      if (auth.claims.name) doUrl.searchParams.set('userName', auth.claims.name)
      if (auth.claims.email) doUrl.searchParams.set('userEmail', auth.claims.email)
      if (auth.claims.image) doUrl.searchParams.set('userImageUrl', auth.claims.image)
      if (extraParams) {
        for (const [k, v] of Object.entries(extraParams(auth))) {
          doUrl.searchParams.set(k, v)
        }
      }
    }

    const ns = doNamespace(c.env)
    const stub = ns.get(ns.idFromName(id))
    return stub.fetch(new Request(doUrl.toString(), c.req.raw))
  }
}

app.get(
  '/ws/:roomId',
  wsRoute((env) => env.RECORD_ROOMS),
)

type DocsYjsRole = 'admin' | 'member' | 'viewer'

interface DocumentRecordForAccess {
  ownerId?: string
  // `text/plain` JSON-string in the `documents` collection, already-parsed
  // `string[]` when the column is a `{ kind: 'json' }` interpretation (canvases).
  collaborators?: string | string[]
  editors?: string | string[]
}

type DocumentAccessLookup =
  | { kind: 'found'; doc: DocumentRecordForAccess }
  | { kind: 'not-docs-room' }
  | { kind: 'error' }

function parseAccessList(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

// Tolerant of both storage shapes: a JSON-string column (`documents`) and an
// already-parsed array from a `{ kind: 'json' }` column (`canvases`).
function toIdArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string')
  return parseAccessList(value)
}

async function getDocumentForAccess(
  env: Env,
  docId: string,
  collection = 'documents',
): Promise<DocumentAccessLookup> {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.APP_NAME}`))
  try {
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': env.OWNER_USER_ID,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({
          tool: 'records.get',
          params: { collection, recordId: docId },
        }),
      }),
    )
    const json = (await res.json()) as {
      success?: boolean
      error?: string
      data?: { record?: { data?: DocumentRecordForAccess } }
    }
    if (json.success && json.data?.record?.data) {
      return { kind: 'found', doc: json.data.record.data }
    }
    if (
      json.error === 'Record not found' ||
      json.error?.startsWith(`Schema not registered for collection: ${collection}`)
    ) {
      return { kind: 'not-docs-room' }
    }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

async function resolveDocsYjsRole(
  env: Env,
  docId: string,
  userId: string,
): Promise<DocsYjsRole | null> {
  const lookup = await getDocumentForAccess(env, docId)
  if (lookup.kind === 'not-docs-room') return 'member'
  if (lookup.kind === 'error') return null
  const { doc } = lookup
  if (doc.ownerId === userId || userId === env.OWNER_USER_ID) return 'admin'

  const editors = toIdArray(doc.editors)
  if (editors.includes(userId)) return 'member'

  const collaborators = toIdArray(doc.collaborators)
  if (collaborators.includes(userId)) return 'viewer'

  return null
}

// Per-board access for the realtime canvas room: the board owner (and the app
// owner) get `admin`, anyone listed in `collaborators` gets `member` (view +
// edit), everyone else is denied. A missing record (`not-docs-room`) or a
// lookup error fails CLOSED — no role. NOTE: a global `admin`-role user who is
// neither owner nor collaborator is intentionally NOT granted realtime access
// here (fail-closed); the hard-delete route honors the admin claim separately.
async function resolveCanvasRole(
  env: Env,
  docId: string,
  userId: string,
): Promise<DocsYjsRole | null> {
  const lookup = await getDocumentForAccess(env, docId, 'canvases')
  if (lookup.kind !== 'found') return null
  const { doc } = lookup
  if (doc.ownerId === userId || userId === env.OWNER_USER_ID) return 'admin'
  if (toIdArray(doc.collaborators).includes(userId)) return 'member'
  return null
}

app.get('/ws/yjs/:docId', async (c) => {
  const docId = c.req.param('docId')
  const url = new URL(c.req.url)
  const token = url.searchParams.get('token')
  const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null
  if (!auth) return new Response('Unauthorized', { status: 401 })

  const role = await resolveDocsYjsRole(c.env, docId, auth.userId)
  if (!role) return new Response('Forbidden', { status: 403 })

  const doUrl = new URL(c.req.url)
  doUrl.searchParams.set('userId', auth.userId)
  doUrl.searchParams.set('role', role)
  doUrl.searchParams.delete('token')

  const stub = c.env.YJS_ROOMS.get(c.env.YJS_ROOMS.idFromName(docId))
  return stub.fetch(new Request(doUrl.toString(), c.req.raw))
})

// Canvas boards are private. Unlike the generic `wsRoute` (which would hand
// every signed-in user `role: 'member'`), this resolves per-board access from
// the `canvases` record: owner/app-owner → admin, invited collaborator →
// member, everyone else → 403. A missing token is 401 (no anonymous boards).
app.get('/ws/canvas/:docId', async (c) => {
  const docId = c.req.param('docId')
  const url = new URL(c.req.url)
  const token = url.searchParams.get('token')
  const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null
  if (!auth) return new Response('Unauthorized', { status: 401 })

  const role = await resolveCanvasRole(c.env, docId, auth.userId)
  if (!role) return new Response('Forbidden', { status: 403 })

  const doUrl = new URL(c.req.url)
  doUrl.searchParams.delete('token')
  for (const k of ['userId', 'userName', 'userEmail', 'userImageUrl', 'role']) {
    doUrl.searchParams.delete(k)
  }
  doUrl.searchParams.set('userId', auth.userId)
  if (auth.claims.name) doUrl.searchParams.set('userName', auth.claims.name)
  if (auth.claims.email) doUrl.searchParams.set('userEmail', auth.claims.email)
  if (auth.claims.image) doUrl.searchParams.set('userImageUrl', auth.claims.image)
  doUrl.searchParams.set('role', role)

  const stub = c.env.CANVAS_ROOMS.get(c.env.CANVAS_ROOMS.idFromName(docId))
  return stub.fetch(new Request(doUrl.toString(), c.req.raw))
})

// Hard-delete a board: remove the metadata record AND wipe the CanvasRoom DO
// storage. This is the "Delete forever" path (and the same helper the
// `purge-trash` cron uses). Soft delete / restore stay client-side `put`s on
// `deletedAt`; only the irreversible purge needs a privileged server route.
//
// Authorization mirrors the canvases schema delete rule: the board owner, the
// app owner, or an admin. A missing record is 404; anyone else is 403. We must
// authorize here because `hardDeleteCanvas` deletes via an app action that
// bypasses per-user RBAC.
app.delete('/api/canvas/:docId', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const docId = c.req.param('docId')
  const lookup = await getDocumentForAccess(c.env, docId, 'canvases')
  if (lookup.kind !== 'found') return c.json({ error: 'Not found' }, 404)

  const ownerId = lookup.doc.ownerId
  const isAdmin = auth.claims.role === 'admin'
  if (ownerId !== auth.userId && auth.userId !== c.env.OWNER_USER_ID && !isAdmin) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await hardDeleteCanvas(c.env, docId)
  return c.json({ ok: true })
})

app.get(
  '/ws/presence/:scopeId',
  wsRoute(
    (env) => env.PRESENCE_ROOMS,
    (auth) => ({
      ...(auth.claims.name ? { userName: auth.claims.name } : {}),
      ...(auth.claims.email ? { userEmail: auth.claims.email } : {}),
      ...(auth.claims.image ? { userImageUrl: auth.claims.image } : {}),
    }),
  ),
)

// The only cron is the destructive `purge-trash` sweep, so trigger/pause/resume
// are restricted to the app owner + admins; everyone else connects read-only
// (monitor). A plain `wsRoute(..., () => ({ role: 'member' }))` would let any
// signed-in user pause the purge, so this resolves role inline instead.
app.get('/ws/cron/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const url = new URL(c.req.url)
  const token = url.searchParams.get('token')
  const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null
  if (!auth) return new Response('Unauthorized', { status: 401 })

  const isAdmin = auth.claims.role === 'admin' || auth.userId === c.env.OWNER_USER_ID
  const role = isAdmin ? 'member' : 'viewer'

  const doUrl = new URL(c.req.url)
  doUrl.searchParams.delete('token')
  for (const k of ['userId', 'userName', 'userEmail', 'userImageUrl', 'role']) {
    doUrl.searchParams.delete(k)
  }
  doUrl.searchParams.set('userId', auth.userId)
  doUrl.searchParams.set('role', role)

  const stub = c.env.CRON_ROOMS.get(c.env.CRON_ROOMS.idFromName(roomId))
  return stub.fetch(new Request(doUrl.toString(), c.req.raw))
})

app.get(
  '/ws/jobs/:roomId',
  wsRoute((env) => env.JOB_ROOMS),
)

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

app.post('/api/actions/:name', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const name = c.req.param('name')
  const action = actions[name]
  if (!action) return c.json({ error: 'Action not found' }, 404)
  // A non-JSON / empty body shouldn't 500 — treat it as no params (matches the
  // chat routes, which all guard `c.req.json()` the same way).
  const params = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const callerJwt = c.req.header('Authorization')!.slice(7)
  const tools = createActionTools(c.env, auth.userId, callerJwt)
  const result = await action({ userId: auth.userId, params, tools, env: c.env, callerJwt })
  return c.json(result as unknown as Record<string, unknown>)
})

// ---------------------------------------------------------------------------
// AI chat — multi-turn tool-use via Vercel AI SDK + DeepSpace proxy
// ---------------------------------------------------------------------------

// Routes implementation lives in `src/ai/chat-routes.ts` to keep this file
// focused on app-level wiring. `resolveAuth` is passed in to avoid a runtime
// circular import (chat-routes imports `Env`/`AppContext` as types only).
registerAiChatRoutes(app, resolveAuth)

// ---------------------------------------------------------------------------
// Scoped R2 files → platform-worker
//
// The app has no local R2 binding by design; the platform-worker holds a
// shared `APP_FILES` bucket and scopes keys per-app via the `?scope=`
// query string:
//
//   POST   /api/files/upload?scope=app    → uploads under apps/<APP_NAME>/
//   POST   /api/files/upload              → uploads under apps/<APP_NAME>/users/<userId>/
//   GET    /api/files                     → list (same scoping)
//   GET    /api/files/<key>               → public read (no auth)
//   DELETE /api/files/<key>               → delete (auth required, scope-checked)
//
// Use `?scope=app` for content that belongs to the app as a whole (library
// preview images, AI-generated assets, etc.). Use the default user scope
// for per-user uploads (avatars, project assets). All write paths require
// a signed user JWT; reads are public.
// ---------------------------------------------------------------------------

app.all('/api/files/*', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  const userId = auth?.userId ?? null

  const url = new URL(c.req.url)
  const platformUrl = new URL(c.req.url)
  platformUrl.pathname = url.pathname.replace('/api/files', '/internal/files')

  const headers = new Headers(c.req.raw.headers)
  // Strip any caller-supplied identity before re-asserting from the verified
  // JWT. platform-worker trusts `x-user-id` (gated by the HMAC'd app-identity
  // token) to scope `?scope=self` keys, so leaking a spoofed header here would
  // let an unauthenticated browser read another user's files.
  headers.delete('x-user-id')
  headers.set('x-app-identity-token', c.env.APP_IDENTITY_TOKEN)
  headers.set('x-app-name', c.env.APP_NAME)
  if (userId) headers.set('x-user-id', userId)

  const resp = await platformWorkerFetch(
    c.env,
    new Request(platformUrl.toString(), {
      method: c.req.method,
      headers,
      body: c.req.raw.body,
    }),
  )

  // Rewrite URLs in JSON responses to use the app's origin
  const contentType = resp.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await resp.json()) as Record<string, unknown>
    const rewriteUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, url.origin)
    if (typeof body.url === 'string') body.url = rewriteUrl(body.url)
    if (Array.isArray(body.files)) {
      for (const f of body.files as Array<Record<string, unknown>>) {
        if (typeof f.url === 'string') f.url = rewriteUrl(f.url)
      }
    }
    return c.json(body, resp.status as any)
  }

  return new Response(resp.body, { status: resp.status, headers: resp.headers })
})

// ---------------------------------------------------------------------------
// /_deepspace/* — same-origin proxy to api-worker for authenticated SDK
// hooks. Attaches APP_IDENTITY_TOKEN + APP_NAME so the browser never sees
// the platform secret. Every request requires a signed user JWT.
//
// SECURITY: exact (method, path) allowlist — not a prefix match. A prefix
// match leaks deploy/CLI surfaces like POST /api/subscriptions/sync into the
// browser context, where an XSS or compromised user session can become a
// confused deputy. Adding a new browser hook in the SDK requires explicitly
// extending the BROWSER_PROXY_ROUTES tuple below.
// ---------------------------------------------------------------------------

interface ProxyRoute {
  method: string
  path: string
  /** Skip the user-JWT gate. Default false. Pricing tables are public. */
  publicRead?: boolean
  /** Inject `?appName=...` (from env) into the forwarded URL. Default false. */
  injectAppName?: boolean
}

const BROWSER_PROXY_ROUTES: ReadonlyArray<ProxyRoute> = [
  // useSubscription — read state, subscribe, manage billing.
  { method: 'GET',  path: '/_deepspace/subscriptions/me' },
  { method: 'POST', path: '/_deepspace/subscriptions/checkout' },
  { method: 'POST', path: '/_deepspace/subscriptions/portal' },
  // useCheckout (one-time charges)
  { method: 'POST', path: '/_deepspace/charges/create' },
  { method: 'GET',  path: '/_deepspace/charges/me' },
]

app.all('/_deepspace/*', async (c) => {
  const url = new URL(c.req.url)
  const method = c.req.method
  const route = BROWSER_PROXY_ROUTES.find(
    (r) => r.method === method && r.path === url.pathname,
  )
  if (!route) {
    return c.json({ error: 'not_found' }, 404)
  }

  // Public-read routes (pricing tables) skip the JWT gate. Everything else
  // requires a signed-in user.
  let auth: Awaited<ReturnType<typeof resolveAuth>> | null = null
  if (!route.publicRead) {
    auth = await resolveAuth(c.req.raw, c.env)
    if (!auth?.userId) return c.json({ error: 'unauthorized' }, 401)
  }

  // Inject appName into the query string when the route needs it. We can't
  // rely on the HMAC header for routes the platform serves without HMAC
  // (e.g. /plans is public). Use URLSearchParams.set so we OVERWRITE any
  // caller-supplied appName — otherwise a request to
  // `/_deepspace/subscriptions/plans?appName=other_app` would forward a
  // duplicate-key query string and the platform would pick whichever value
  // its parser sees first.
  const forwardedParams = new URLSearchParams(url.search)
  if (route.injectAppName) {
    forwardedParams.set('appName', c.env.APP_NAME)
  }
  const queryString = forwardedParams.toString()
  const apiPath =
    url.pathname.replace('/_deepspace/', '/api/') + (queryString ? `?${queryString}` : '')

  const headers = new Headers(c.req.raw.headers)
  headers.delete('x-user-id')
  headers.set('x-app-identity-token', c.env.APP_IDENTITY_TOKEN)
  headers.set('x-app-name', c.env.APP_NAME)
  if (auth?.userId) headers.set('x-user-id', auth.userId)

  return apiWorkerFetch(c.env, apiPath, {
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method) ? undefined : c.req.raw.body,
  })
})

// ---------------------------------------------------------------------------
// Static assets (SPA fallback)
// ---------------------------------------------------------------------------

app.get('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw)
  if (response.status === 404) {
    const url = new URL(c.req.url)
    url.pathname = '/index.html'
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw))
  }
  return response
})

// =============================================================================
// Action Tools — route to app's own RecordRoom DO
// =============================================================================

function createActionTools(env: Env, userId: string, callerJwt: string): ActionTools {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.APP_NAME}`))

  // Internal helper — DO returns `ActionResult<unknown>`. Callers below
  // cast to the precisely-typed result for each operation. The cast is
  // safe because the wire shape is set by the SDK's tools-api handler.
  async function execTool<TData>(
    tool: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult<TData>> {
    const res = await stub.fetch(new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        'X-App-Action': 'true',
      },
      body: JSON.stringify({ tool, params }),
    }))
    return res.json() as Promise<ActionResult<TData>>
  }

  async function callIntegration<T>(
    endpoint: string,
    data?: unknown,
  ): Promise<ActionResult<T>> {
    const integrationName = endpoint.split('/')[0]
    const billingMode = integrations[integrationName]?.billing ?? 'developer'

    // Use the owner JWT for developer-billed calls, the caller's JWT otherwise.
    // The api-worker bills the JWT subject — no client-supplied override.
    const jwt = billingMode === 'developer' ? env.APP_OWNER_JWT : callerJwt

    const res = await apiWorkerFetch(env, `/api/integrations/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(data ?? {}),
    })
    return res.json() as Promise<ActionResult<T>>
  }

  return {
    create: (collection, data, recordId) =>
      execTool('records.create', { collection, data, recordId }),
    update: (collection, recordId, data) =>
      execTool('records.update', { collection, recordId, data }),
    remove: (collection, recordId) => execTool('records.delete', { collection, recordId }),
    get: (collection, recordId) => execTool('records.get', { collection, recordId }),
    query: (collection, options) => execTool('records.query', { collection, ...options }),
    integration: callIntegration,
    registerUser: (opts) => execTool('users.register', { ...opts }),
  }
}

export default app
