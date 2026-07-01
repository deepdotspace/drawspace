import { describe, it, expect, vi } from 'vitest'
import {
  toolCallToCanvasOp,
  toolCallToCanvasOps,
  applyCanvasOp,
  createdOpBounds,
  type CanvasApi,
  type CanvasOp,
} from './canvas-stream'
import type { Bounds } from './shape-layout'

describe('toolCallToCanvasOp', () => {
  it('maps canvas_createShape to a create op with a normalized shape (defaults applied)', () => {
    const op = toolCallToCanvasOp('canvas_createShape', {
      type: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
    expect(op).not.toBeNull()
    expect(op?.kind).toBe('create')
    if (op?.kind !== 'create') throw new Error('expected create op')
    expect(op.shape.type).toBe('rect')
    expect(op.shape.x).toBe(10)
    expect(op.shape.y).toBe(20)
    expect(op.shape.width).toBe(100)
    expect(op.shape.height).toBe(50)
    // Loop 1 defaults folded into props.
    expect(op.shape.props.fill).toBe('transparent')
    expect(op.shape.props.stroke).toBe('#6366f1')
    expect(op.shape.props.strokeWidth).toBe(3)
  })

  it('maps canvas_updateShape to an update op carrying shapeId + patch', () => {
    const op = toolCallToCanvasOp('canvas_updateShape', {
      shapeId: 's1',
      fill: '#0000ff',
      x: 5,
    })
    expect(op?.kind).toBe('update')
    if (op?.kind !== 'update') throw new Error('expected update op')
    expect(op.shapeId).toBe('s1')
    expect(op.patch.x).toBe(5)
    expect(op.patch.props).toEqual({ fill: '#0000ff' })
  })

  it('maps canvas_deleteShape to a delete op', () => {
    const op = toolCallToCanvasOp('canvas_deleteShape', { shapeId: 's2' })
    expect(op).toEqual<CanvasOp>({ kind: 'delete', shapeId: 's2' })
  })

  it('returns null for a non-canvas tool (records_query)', () => {
    expect(toolCallToCanvasOp('records_query', { collection: 'canvases' })).toBeNull()
    // canvas_listShapes is a read — it produces no canvas mutation either.
    expect(toolCallToCanvasOp('canvas_listShapes', {})).toBeNull()
  })

  it('surfaces the Loop 1 validation error on a bad create payload (negative width)', () => {
    expect(() =>
      toolCallToCanvasOp('canvas_createShape', {
        type: 'rect',
        x: 0,
        y: 0,
        width: -5,
        height: 10,
      }),
    ).toThrow(/width/i)
  })
})

describe('toolCallToCanvasOps', () => {
  it('wraps a single-shape create as a one-element array', () => {
    const ops = toolCallToCanvasOps('canvas_createShape', { type: 'rect', x: 0, y: 0, width: 10, height: 10 })
    expect(ops).toHaveLength(1)
    expect(ops[0].kind).toBe('create')
  })

  it('expands canvas_createShapes into one create op per shape', () => {
    const ops = toolCallToCanvasOps('canvas_createShapes', {
      shapes: [
        { type: 'rect', x: 0, y: 0, width: 10, height: 10 },
        { type: 'ellipse', x: 20, y: 0, width: 10, height: 10 },
      ],
    })
    expect(ops).toHaveLength(2)
    expect(ops.every((o) => o.kind === 'create')).toBe(true)
  })

  it('expands canvas_drawDiagram into many create ops (containers + labels + arrows)', () => {
    const ops = toolCallToCanvasOps('canvas_drawDiagram', {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    })
    // 2 containers + 2 labels + 1 arrow = 5 create ops.
    expect(ops).toHaveLength(5)
    expect(ops.every((o) => o.kind === 'create')).toBe(true)
  })

  it('returns [] for a read/non-canvas tool', () => {
    expect(toolCallToCanvasOps('canvas_listShapes', {})).toEqual([])
    expect(toolCallToCanvasOps('records_query', { collection: 'x' })).toEqual([])
  })

  it('throws on a bad batch payload (missing shapes array)', () => {
    expect(() => toolCallToCanvasOps('canvas_createShapes', {})).toThrow(/shapes/i)
  })
})

describe('toolCallToCanvasOps — free-space placement', () => {
  function createdBox(op: CanvasOp): { x: number; y: number; width: number; height: number } {
    if (op.kind !== 'create') throw new Error('expected create op')
    return { x: op.shape.x, y: op.shape.y, width: op.shape.width, height: op.shape.height }
  }
  function overlaps(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): boolean {
    const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    return ox > 0 && oy > 0
  }

  it('places a diagram clear of existing content (no overlap)', () => {
    const existing = [{ x: 0, y: 0, width: 400, height: 300 }]
    const ops = toolCallToCanvasOps(
      'canvas_drawDiagram',
      { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] },
      { existing },
    )
    for (const op of ops) {
      if (op.kind === 'create') expect(overlaps(createdBox(op), existing[0])).toBe(false)
    }
  })

  it('keeps a hand-built connector batch rigid (arrow stays attached) and clear of existing', () => {
    const existing = [{ x: 0, y: 0, width: 300, height: 200 }]
    // Two boxes wired by an arrow — a hand-built diagram. The arrow must move by
    // the SAME delta as the boxes, and nothing may overlap existing content.
    const ops = toolCallToCanvasOps(
      'canvas_createShapes',
      {
        shapes: [
          { type: 'rect', x: 0, y: 0, width: 100, height: 60 },
          { type: 'rect', x: 0, y: 120, width: 100, height: 60 },
          { type: 'arrow', x: 50, y: 60, width: 1, height: 60, headCorner: 'se' },
        ],
      },
      { existing },
    )
    expect(ops).toHaveLength(3)
    const [box1, box2, arrow] = ops.map(createdBox)
    // Rigid: original gap between the two boxes (120 on y) is preserved.
    expect(box2.y - box1.y).toBe(120)
    // Arrow still spans the gap between the boxes (x within them, attached).
    expect(arrow.x).toBeGreaterThanOrEqual(box1.x)
    // Everything sits below the existing content.
    for (const b of [box1, box2, arrow]) expect(b.y).toBeGreaterThanOrEqual(200)
  })

  it('de-overlaps a loose (connector-free) batch AND places it clear of existing', () => {
    const existing = [{ x: 0, y: 0, width: 200, height: 200 }]
    const ops = toolCallToCanvasOps(
      'canvas_createShapes',
      {
        shapes: [
          { type: 'rect', x: 0, y: 0, width: 100, height: 60 },
          { type: 'rect', x: 0, y: 0, width: 100, height: 60 }, // stacked → must separate
        ],
      },
      { existing },
    )
    const [a, b] = ops.map(createdBox)
    expect(overlaps(a, b)).toBe(false)
    for (const box of [a, b]) expect(box.y).toBeGreaterThanOrEqual(200)
  })

  it('places a singular create clear of existing content (RC5)', () => {
    const existing = [{ x: 0, y: 0, width: 200, height: 150 }]
    const ops = toolCallToCanvasOps(
      'canvas_createShape',
      { type: 'rect', x: 0, y: 0, width: 50, height: 50 },
      { existing },
    )
    expect(ops).toHaveLength(1)
    expect(createdBox(ops[0]).y).toBeGreaterThanOrEqual(150)
  })

  it('is a no-op when no placement context is supplied (back-compat)', () => {
    const ops = toolCallToCanvasOps('canvas_createShape', { type: 'rect', x: 7, y: 9, width: 10, height: 10 })
    expect(createdBox(ops[0])).toMatchObject({ x: 7, y: 9 })
  })

  // Exercises the SAME accumulation helper (createdOpBounds) AiAssistant threads
  // through its turn loop — so a within-turn self-stacking regression (two tool
  // calls in one reply landing on top of each other) is actually caught here,
  // not just at the single-call level.
  it('threads the accumulator so a second tool call in the same turn clears the first', () => {
    const existing: Bounds[] = [] // empty canvas, start of turn
    const ops1 = toolCallToCanvasOps(
      'canvas_drawDiagram',
      { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] },
      { existing },
    )
    // Feed the first call's output back in, exactly as the component does.
    existing.push(...createdOpBounds(ops1))
    const ops2 = toolCallToCanvasOps(
      'canvas_createShapes',
      { shapes: [{ type: 'rect', x: 0, y: 0, width: 120, height: 60 }] },
      { existing },
    )

    const first = createdOpBounds(ops1)
    const second = createdOpBounds(ops2)
    expect(second.length).toBeGreaterThan(0)
    for (const a of first) {
      for (const b of second) {
        expect(overlaps(a, b)).toBe(false)
      }
    }
  })
})

describe('applyCanvasOp', () => {
  function mockApi(): CanvasApi & {
    addShape: ReturnType<typeof vi.fn>
    updateShape: ReturnType<typeof vi.fn>
    moveShape: ReturnType<typeof vi.fn>
    resizeShape: ReturnType<typeof vi.fn>
    deleteShape: ReturnType<typeof vi.fn>
  } {
    return {
      addShape: vi.fn(),
      updateShape: vi.fn(),
      moveShape: vi.fn(),
      resizeShape: vi.fn(),
      deleteShape: vi.fn(),
    }
  }

  it('routes a create op to addShape with the normalized shape', () => {
    const api = mockApi()
    applyCanvasOp(
      {
        kind: 'create',
        shape: { type: 'ellipse', x: 1, y: 2, width: 3, height: 4, props: { fill: 'red' } },
      },
      api,
    )
    expect(api.addShape).toHaveBeenCalledTimes(1)
    expect(api.addShape).toHaveBeenCalledWith({
      type: 'ellipse',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      props: { fill: 'red' },
    })
    expect(api.updateShape).not.toHaveBeenCalled()
    expect(api.deleteShape).not.toHaveBeenCalled()
  })

  it('passes a fill-only update FLAT to updateShape (top-level fill, NO nested props)', () => {
    const api = mockApi()
    // Mirrors what normalizeEdit produces for `{ shapeId, fill: 'red' }`.
    applyCanvasOp({ kind: 'update', shapeId: 's1', patch: { props: { fill: 'red' } } }, api)

    expect(api.updateShape).toHaveBeenCalledTimes(1)
    // EXACT shape: the second arg is the flat style object, never re-wrapped.
    expect(api.updateShape).toHaveBeenCalledWith('s1', { fill: 'red' })
    const [, secondArg] = api.updateShape.mock.calls[0]
    expect(secondArg).toEqual({ fill: 'red' })
    expect('props' in (secondArg as Record<string, unknown>)).toBe(false)
    expect((secondArg as { fill?: unknown }).fill).toBe('red')
  })

  it('does NOT call moveShape/resizeShape for a recolor (style-only update)', () => {
    const api = mockApi()
    applyCanvasOp({ kind: 'update', shapeId: 's1', patch: { props: { fill: 'red' } } }, api)
    expect(api.moveShape).not.toHaveBeenCalled()
    expect(api.resizeShape).not.toHaveBeenCalled()
    expect(api.addShape).not.toHaveBeenCalled()
  })

  it('routes a position update through moveShape with absolute x/y (filling the missing axis from current geometry)', () => {
    const api = mockApi()
    applyCanvasOp(
      { kind: 'update', shapeId: 's1', patch: { x: 10, y: 20 } },
      api,
      { x: 0, y: 0, width: 100, height: 50 },
    )
    expect(api.moveShape).toHaveBeenCalledTimes(1)
    expect(api.moveShape).toHaveBeenCalledWith('s1', 10, 20)
    expect(api.updateShape).not.toHaveBeenCalled()
    expect(api.resizeShape).not.toHaveBeenCalled()
  })

  it('fills the missing position axis from current geometry', () => {
    const api = mockApi()
    applyCanvasOp(
      { kind: 'update', shapeId: 's1', patch: { x: 10 } },
      api,
      { x: 0, y: 7, width: 100, height: 50 },
    )
    expect(api.moveShape).toHaveBeenCalledWith('s1', 10, 7)
  })

  it('routes a size update through resizeShape using current geometry for the missing dimension', () => {
    const api = mockApi()
    applyCanvasOp(
      { kind: 'update', shapeId: 's1', patch: { width: 80 } },
      api,
      { x: 0, y: 0, width: 100, height: 50 },
    )
    expect(api.resizeShape).toHaveBeenCalledTimes(1)
    // width=80, height filled from current geometry (50); x/y undefined (not in patch).
    expect(api.resizeShape).toHaveBeenCalledWith('s1', 80, 50, undefined, undefined)
    expect(api.updateShape).not.toHaveBeenCalled()
    expect(api.moveShape).not.toHaveBeenCalled()
  })

  it('applies both style and geometry from a combined update', () => {
    const api = mockApi()
    applyCanvasOp(
      { kind: 'update', shapeId: 's1', patch: { props: { stroke: '#000' }, x: 5, y: 6 } },
      api,
      { x: 0, y: 0, width: 10, height: 10 },
    )
    expect(api.updateShape).toHaveBeenCalledWith('s1', { stroke: '#000' })
    expect(api.moveShape).toHaveBeenCalledWith('s1', 5, 6)
  })

  it('skips a geometry change it cannot complete (no current geometry, single axis)', () => {
    const api = mockApi()
    // x with no y and no current geometry → cannot form an absolute pair → skip.
    applyCanvasOp({ kind: 'update', shapeId: 's1', patch: { x: 10 } }, api)
    expect(api.moveShape).not.toHaveBeenCalled()
    expect(api.resizeShape).not.toHaveBeenCalled()
    expect(api.updateShape).not.toHaveBeenCalled()
  })

  it('routes a delete op to deleteShape with the shapeId', () => {
    const api = mockApi()
    applyCanvasOp({ kind: 'delete', shapeId: 's7' }, api)
    expect(api.deleteShape).toHaveBeenCalledTimes(1)
    expect(api.deleteShape).toHaveBeenCalledWith('s7')
    expect(api.addShape).not.toHaveBeenCalled()
    expect(api.updateShape).not.toHaveBeenCalled()
  })
})
