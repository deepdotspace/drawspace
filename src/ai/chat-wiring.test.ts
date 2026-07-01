/**
 * Network-free wiring smoke test (substitutes the plan's live `deepspace dev`
 * chat-reply prereq, which needs a server + a billed LLM call + a browser).
 *
 * Asserts the code-level wiring is intact:
 *  - the app's registered `schemas` includes the `ai-chats` + `ai-messages`
 *    collections the chat backend reads/writes (without these the chat backend
 *    fails at runtime with "schema not registered").
 *  - `buildCanvasTools(makeCanvasExecutor(ctx))` registers exactly the four
 *    canvas tools, and a `canvas_createShape` call routes through the
 *    validate-only executor to a normalized shape.
 *
 * Pure/local — no fetch, no server, no LLM.
 */

import { describe, it, expect } from 'vitest'
import { schemas } from '../schemas'
import { buildCanvasTools, type CanvasContext } from './canvas-tools'
import { makeCanvasExecutor } from './canvas-executor'

describe('ai chat schema registration', () => {
  it('registers the ai-chats and ai-messages collections', () => {
    const names = schemas.map((s) => s.name)
    expect(names).toContain('ai-chats')
    expect(names).toContain('ai-messages')
  })
})

describe('canvas tools wiring', () => {
  const ctx: CanvasContext = { docId: 'doc-1', shapes: [], selectedShapeIds: [] }

  it('registers the canvas tools (incl. batch + diagram), all underscore-named', () => {
    const tools = buildCanvasTools(makeCanvasExecutor(ctx))
    const names = Object.keys(tools)
    expect(names).toEqual(
      expect.arrayContaining([
        'canvas_drawDiagram',
        'canvas_createShapes',
        'canvas_createShape',
        'canvas_updateShape',
        'canvas_deleteShape',
        'canvas_listShapes',
      ]),
    )
    expect(names).toHaveLength(6)
    expect(names.every((n) => !n.includes('.'))).toBe(true)
  })

  it('routes a canvas_createShape call through the validate-only executor to a normalized shape', async () => {
    const tools = buildCanvasTools(makeCanvasExecutor(ctx))
    const createTool = tools['canvas_createShape'] as {
      execute: (input: Record<string, unknown>, options: unknown) => Promise<unknown>
    }
    const result = (await createTool.execute(
      { type: 'rect', x: 0, y: 0, width: 40, height: 20 },
      {},
    )) as { ok: boolean; shape?: { type: string; width: number; props: Record<string, unknown> } }

    expect(result.ok).toBe(true)
    expect(result.shape?.type).toBe('rect')
    expect(result.shape?.width).toBe(40)
    expect(result.shape?.props.stroke).toBe('#6366f1')
  })
})
