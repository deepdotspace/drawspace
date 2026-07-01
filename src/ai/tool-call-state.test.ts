import { describe, it, expect } from 'vitest'
import {
  reduceToolCalls,
  resultIsError,
  foldTurnStatus,
  type ToolCallDisplay,
  type ToolStreamAction,
} from './tool-call-state'

function run(actions: ToolStreamAction[]): ToolCallDisplay[] {
  return actions.reduce(reduceToolCalls, [] as ToolCallDisplay[])
}

describe('resultIsError', () => {
  it('flags ok:false and success:false', () => {
    expect(resultIsError({ ok: false })).toBe(true)
    expect(resultIsError({ success: false })).toBe(true)
  })
  it('treats ok:true and non-objects as not-error', () => {
    expect(resultIsError({ ok: true })).toBe(false)
    expect(resultIsError(undefined)).toBe(false)
    expect(resultIsError('done')).toBe(false)
  })
})

describe('reduceToolCalls', () => {
  it('upsert then successful finalize → success', () => {
    const state = run([
      { type: 'upsert-tool-call', toolCallId: 'c1', toolName: 'canvas_createShape', input: { type: 'rect' } },
      { type: 'finalize-tool-call', toolCallId: 'c1', result: { ok: true, shape: {} } },
    ])
    expect(state).toHaveLength(1)
    expect(state[0].status).toBe('success')
    expect(state[0].toolName).toBe('canvas_createShape')
  })

  it('finalize with ok:false → error with the result message', () => {
    const state = run([
      { type: 'upsert-tool-call', toolCallId: 'c1', toolName: 'canvas_updateShape', input: {} },
      { type: 'finalize-tool-call', toolCallId: 'c1', result: { ok: false, error: 'No shape with id "x"' } },
    ])
    expect(state[0].status).toBe('error')
    expect(state[0].errorText).toBe('No shape with id "x"')
  })

  it('a running upsert stays running until finalized', () => {
    const state = run([
      { type: 'upsert-tool-call', toolCallId: 'c1', toolName: 'canvas_listShapes', input: {} },
    ])
    expect(state[0].status).toBe('running')
  })

  it('fail-tool-input creates an already-failed row (no preceding upsert)', () => {
    const state = run([
      { type: 'fail-tool-input', toolCallId: 'c9', toolName: 'canvas_createShape', input: { bad: 1 }, errorText: 'schema error' },
    ])
    expect(state).toHaveLength(1)
    expect(state[0].status).toBe('error')
    expect(state[0].errorText).toBe('schema error')
  })

  it('fail-tool-output marks an existing call as failed', () => {
    const state = run([
      { type: 'upsert-tool-call', toolCallId: 'c1', toolName: 'canvas_createShape', input: {} },
      { type: 'fail-tool-output', toolCallId: 'c1', errorText: 'execution blew up' },
    ])
    expect(state[0].status).toBe('error')
    expect(state[0].errorText).toBe('execution blew up')
  })

  it('a later success finalize does NOT downgrade an already-failed call', () => {
    // Client-side apply threw (synthetic fail-tool-output) but the validate-only
    // server later finalizes the same id ok:true — the failure must stick.
    const state = run([
      { type: 'upsert-tool-call', toolCallId: 'c1', toolName: 'canvas_createShape', input: {} },
      { type: 'fail-tool-output', toolCallId: 'c1', errorText: 'could not draw that shape' },
      { type: 'finalize-tool-call', toolCallId: 'c1', result: { ok: true, shape: {} } },
    ])
    expect(state[0].status).toBe('error')
    expect(state[0].errorText).toBe('could not draw that shape')
  })
})

describe('foldTurnStatus', () => {
  const running: ToolCallDisplay = { toolCallId: 'a', toolName: 'canvas_createShape', status: 'running' }
  const ok: ToolCallDisplay = { toolCallId: 'a', toolName: 'canvas_createShape', status: 'success' }
  const ok2: ToolCallDisplay = { toolCallId: 'b', toolName: 'canvas_createShape', status: 'success' }
  const failed: ToolCallDisplay = {
    toolCallId: 'a',
    toolName: 'canvas_updateShape',
    status: 'error',
    errorText: 'No shape with id "x"',
  }

  it('streaming with no tools yet → Planning…', () => {
    expect(foldTurnStatus([], true)).toEqual({ phase: 'planning', label: 'Planning…' })
  })

  it('any running tool → Drawing…', () => {
    expect(foldTurnStatus([running], true)).toEqual({ phase: 'working', label: 'Drawing…' })
    // Even mid-stream after some succeeded, an open turn stays "working".
    expect(foldTurnStatus([ok, ok2], true)).toEqual({ phase: 'working', label: 'Drawing…' })
  })

  it('stream closed with successful tools → Done', () => {
    expect(foldTurnStatus([ok, ok2], false)).toEqual({ phase: 'done', label: 'Done' })
  })

  it('folds MANY tool calls into ONE status', () => {
    const many: ToolCallDisplay[] = [ok, ok2, { ...ok, toolCallId: 'c' }]
    const status = foldTurnStatus(many, false)
    expect(status).toEqual({ phase: 'done', label: 'Done' })
  })

  it('any failed tool collapses the whole turn to a single error with its message', () => {
    const status = foldTurnStatus([ok, failed, ok2], false)
    expect(status?.phase).toBe('error')
    expect(status?.errorText).toBe('No shape with id "x"')
  })

  it('error wins even while still streaming', () => {
    expect(foldTurnStatus([failed], true)?.phase).toBe('error')
  })

  it('plain text reply that ran no tools and is settled → no status', () => {
    expect(foldTurnStatus([], false)).toBeNull()
  })
})
