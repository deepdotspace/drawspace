/**
 * Pure reducer mapping a sequence of AI stream tool actions to display state.
 *
 * The live `AiAssistant` used to ignore every tool chunk except the initial
 * `upsert-tool-call`, so it always rendered a green "success" chip even when a
 * tool returned `{ ok: false }` or failed. This reducer folds the full chunk
 * vocabulary (`upsert-tool-call`, `finalize-tool-call`, `fail-tool-input`,
 * `fail-tool-output`) into a per-call status so the UI can show a real failure.
 *
 * Side-effect-free and React-free → unit-tested in isolation.
 */

export type ToolCallStatus = 'running' | 'success' | 'error'

export interface ToolCallDisplay {
  toolCallId: string
  toolName: string
  input?: unknown
  status: ToolCallStatus
  /** Populated when `status === 'error'`. */
  errorText?: string
}

/** The subset of decoded stream actions that affect tool-call display state. */
export type ToolStreamAction =
  | { type: 'upsert-tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'finalize-tool-call'; toolCallId: string; result: unknown }
  | { type: 'fail-tool-input'; toolCallId: string; toolName: string; input: unknown; errorText: string }
  | { type: 'fail-tool-output'; toolCallId: string; errorText: string }

/** A tool result counts as a failure when it explicitly reports not-ok. */
export function resultIsError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  return r.ok === false || r.success === false
}

function errorTextFromResult(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (typeof r.error === 'string') return r.error
  }
  return undefined
}

function upsert(state: ToolCallDisplay[], next: ToolCallDisplay): ToolCallDisplay[] {
  const idx = state.findIndex((t) => t.toolCallId === next.toolCallId)
  if (idx === -1) return [...state, next]
  const copy = state.slice()
  copy[idx] = next
  return copy
}

function patch(
  state: ToolCallDisplay[],
  toolCallId: string,
  fields: Partial<ToolCallDisplay>,
): ToolCallDisplay[] {
  const idx = state.findIndex((t) => t.toolCallId === toolCallId)
  if (idx === -1) return state
  const copy = state.slice()
  copy[idx] = { ...copy[idx], ...fields }
  return copy
}

/**
 * A turn's worth of tool calls, folded into ONE calm status for the UI.
 *
 * Instead of a chip per mutation ("Drew 3 shapes", "Updated a shape"), the
 * assistant shows a single live indicator that walks through, at most:
 *   planning (model thinking, no tools yet) → working (a tool is running) → done.
 * The one detail we still surface is failure: any errored tool collapses the
 * whole turn to an `error` status carrying its message.
 */
export type TurnPhase = 'planning' | 'working' | 'done' | 'error'

export interface TurnStatus {
  phase: TurnPhase
  label: string
  /** Populated when `phase === 'error'`. */
  errorText?: string
}

/**
 * Fold all of a turn's tool calls (plus whether the stream is still open) into a
 * single display status. Returns `null` when there is nothing to show — a plain
 * text reply that ran no tools and is no longer streaming.
 *
 * @param tools     the turn's per-call display state (from `reduceToolCalls`)
 * @param streaming whether this turn's stream is still in flight
 */
export function foldTurnStatus(tools: ToolCallDisplay[], streaming: boolean): TurnStatus | null {
  // Failure wins regardless of streaming state — it's the one case detail matters.
  const failed = tools.find((t) => t.status === 'error')
  if (failed) {
    return { phase: 'error', label: 'Something went wrong', errorText: failed.errorText }
  }
  const anyRunning = tools.some((t) => t.status === 'running')
  if (anyRunning) return { phase: 'working', label: 'Drawing…' }
  if (streaming) {
    // Tools have been requested but the turn is still open → keep "Drawing…";
    // nothing requested yet → the model is still deciding what to draw.
    return tools.length > 0
      ? { phase: 'working', label: 'Drawing…' }
      : { phase: 'planning', label: 'Planning…' }
  }
  // Stream closed: a turn that touched the canvas ends on a brief "Done".
  if (tools.length > 0) return { phase: 'done', label: 'Done' }
  return null
}

/** Apply one action to the tool-call display list, returning a new list. */
export function reduceToolCalls(state: ToolCallDisplay[], action: ToolStreamAction): ToolCallDisplay[] {
  switch (action.type) {
    case 'upsert-tool-call':
      return upsert(state, {
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        input: action.input,
        status: 'running',
      })
    case 'finalize-tool-call': {
      if (resultIsError(action.result)) {
        return patch(state, action.toolCallId, {
          status: 'error',
          errorText: errorTextFromResult(action.result) ?? 'Tool reported a failure',
        })
      }
      // Don't let a later "ok" from the validate-only server executor clobber a
      // failure the client already recorded (e.g. a client-side apply threw even
      // though the server validated the same op fine). A failed call stays failed.
      const existing = state.find((t) => t.toolCallId === action.toolCallId)
      if (existing?.status === 'error') return state
      return patch(state, action.toolCallId, { status: 'success' })
    }
    case 'fail-tool-input':
      // No preceding upsert was emitted — create the row already failed.
      return upsert(state, {
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        input: action.input,
        status: 'error',
        errorText: action.errorText,
      })
    case 'fail-tool-output':
      return patch(state, action.toolCallId, { status: 'error', errorText: action.errorText })
    default:
      return state
  }
}
