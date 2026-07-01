import { describe, it, expect } from 'vitest'
import {
  buildCanvasTools,
  buildCanvasSystemPrompt,
  summarizeCanvasForPrompt,
  type CanvasContext,
} from './canvas-tools'

const emptyCtx: CanvasContext = { docId: 'doc-1', shapes: [], selectedShapeIds: [] }

describe('buildCanvasTools', () => {
  // 8. registers exactly the six tools, no dots
  it('registers exactly the six canvas tools with underscore names', () => {
    const tools = buildCanvasTools(async () => ({}))
    const names = Object.keys(tools).sort()

    expect(names).toEqual([
      'canvas_createShape',
      'canvas_createShapes',
      'canvas_deleteShape',
      'canvas_drawDiagram',
      'canvas_listShapes',
      'canvas_updateShape',
    ])
    expect(names.every((n) => !n.includes('.'))).toBe(true)
  })

  // 9. routes to executor with the underscore tool name
  it('routes a tool call to the executor with the underscore name and returns its result', async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = []
    const tools = buildCanvasTools(async (name, params) => {
      calls.push({ name, params })
      return { ok: true }
    })

    const createTool = tools['canvas_createShape'] as {
      execute: (input: Record<string, unknown>, options: unknown) => Promise<unknown>
    }
    const input = { type: 'rect', x: 0, y: 0, width: 10, height: 10 }
    const result = await createTool.execute(input, {})

    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('canvas_createShape')
    expect(calls[0].params).toEqual(input)
    expect(result).toEqual({ ok: true })
  })

  // optional: zod validation via the tool's inputSchema
  it('rejects a malformed payload via the tool inputSchema', () => {
    const tools = buildCanvasTools(async () => ({}))
    const createTool = tools['canvas_createShape'] as {
      inputSchema: { safeParse: (v: unknown) => { success: boolean } }
    }

    expect(createTool.inputSchema.safeParse({ type: 'rect', x: 0, y: 0, width: 1, height: 1 }).success).toBe(true)
    // bad shape type + missing required fields
    expect(createTool.inputSchema.safeParse({ type: 'triangle' }).success).toBe(false)
  })
})

describe('buildCanvasSystemPrompt', () => {
  // 10. mentions selection
  it('references selected shape ids and the selection concept', () => {
    const prompt = buildCanvasSystemPrompt({
      docId: 'doc-1',
      shapes: [],
      selectedShapeIds: ['s1'],
    })
    expect(prompt).toContain('s1')
    expect(prompt).toMatch(/selected|highlighted/i)
  })

  it('does not fabricate a selection when none is provided', () => {
    const prompt = buildCanvasSystemPrompt(emptyCtx)
    expect(prompt).toMatch(/no shapes are currently selected/i)
  })
})

describe('summarizeCanvasForPrompt', () => {
  // 11. lists shapes / empty marker
  it('lists each shape id and type', () => {
    const summary = summarizeCanvasForPrompt({
      docId: 'doc-1',
      shapes: [
        { id: 'a1', type: 'rect', x: 0, y: 0, width: 10, height: 10 },
        { id: 'b2', type: 'ellipse', x: 5, y: 5, width: 20, height: 20 },
      ],
      selectedShapeIds: [],
    })
    expect(summary).toContain('a1')
    expect(summary).toContain('rect')
    expect(summary).toContain('b2')
    expect(summary).toContain('ellipse')
  })

  it('renders a clear marker for an empty canvas', () => {
    expect(summarizeCanvasForPrompt(emptyCtx)).toContain('(empty canvas)')
  })

  it('includes fill, stroke, and text so the model can act on "the blue box"', () => {
    const summary = summarizeCanvasForPrompt({
      docId: 'doc-1',
      shapes: [
        { id: 'a1', type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#a5d8ff', stroke: '#1971c2' },
        { id: 't1', type: 'text', x: 0, y: 0, width: 80, height: 24, text: 'Start' },
      ],
      selectedShapeIds: [],
    })
    expect(summary).toContain('fill=#a5d8ff')
    expect(summary).toContain('stroke=#1971c2')
    expect(summary).toContain('text="Start"')
  })

  it('omits a transparent fill from the summary', () => {
    const summary = summarizeCanvasForPrompt({
      docId: 'doc-1',
      shapes: [{ id: 'a1', type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: 'transparent', stroke: '#000' }],
      selectedShapeIds: [],
    })
    expect(summary).not.toContain('fill=transparent')
    expect(summary).toContain('stroke=#000')
  })
})
