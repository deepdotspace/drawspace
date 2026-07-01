/**
 * Single source of truth for the AI model allowlist.
 *
 * The model picker UI (`AiAssistant`, `ChatPanel`) and the worker route
 * (`chat-routes.ts`) all read from this one list so they can never drift —
 * drift used to surface as silent 400s ("Unknown modelId") when the client
 * offered a model the worker hadn't allowlisted.
 *
 * Pure data + helpers only (no worker/Cloudflare imports), so it's safe to
 * import from both the client bundle and the worker, and to unit-test.
 */

/** Backend the proxy routes a model to. */
export type ModelBackend = 'anthropic' | 'openai' | 'cerebras'

export interface AiModel {
  /** Stable alias sent to the proxy. */
  id: string
  /** Human label shown in the picker. */
  label: string
  /** Display group in the picker. */
  provider: 'Anthropic' | 'OpenAI' | 'Cerebras'
  /** Proxy backend used by the worker. */
  backend: ModelBackend
}

/**
 * The full catalog. Within each provider we list flagship → cheap so the picker
 * shows the most capable option first. IDs use stable aliases (e.g.
 * `claude-opus-4-8`) rather than dated snapshots so a provider bug-fix release
 * lands here without a code change.
 */
export const AI_MODELS: readonly AiModel[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic', backend: 'anthropic' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'Anthropic', backend: 'anthropic' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'Anthropic', backend: 'anthropic' },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'OpenAI', backend: 'openai' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'OpenAI', backend: 'openai' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', provider: 'OpenAI', backend: 'openai' },
  { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'Cerebras', backend: 'cerebras' },
] as const

/**
 * Sonnet 4.6 is the balanced default — capable enough for most tool-using
 * turns, ~3x cheaper than Opus, and the same 1M-token context.
 */
export const DEFAULT_MODEL = 'claude-sonnet-4-6'

/** Allowlist map (`id → backend`) the worker validates `modelId` against. */
export const ALLOWED_MODELS: Record<string, ModelBackend> = Object.fromEntries(
  AI_MODELS.map((m) => [m.id, m.backend] as const),
)

/** UI-shaped picker option (no backend leaked to the client). */
export type ModelOption = { id: string; label: string; provider: string }

/** Project the catalog down to picker options. */
export const MODEL_OPTIONS: ModelOption[] = AI_MODELS.map((m) => ({
  id: m.id,
  label: m.label,
  provider: m.provider,
}))
