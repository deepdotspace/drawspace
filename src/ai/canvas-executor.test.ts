import { describe, it, expect } from 'vitest'
import { makeCanvasExecutor, type CanvasExecutorResult } from './canvas-executor'
import type { CanvasContext } from './canvas-tools'

const ctx: CanvasContext = {
  docId: 'doc-1',
  shapes: [{ id: 's1', type: 'rect', x: 0, y: 0, width: 10, height: 10 }],
  selectedShapeIds: ['s1'],
}

describe('makeCanvasExecutor', () => {
  it('returns { ok: true, shape } for a valid create', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_createShape', {
      type: 'rect',
      x: 5,
      y: 5,
      width: 20,
      height: 30,
    })
    expect(res.ok).toBe(true)
    if (!res.ok || !('shape' in res)) throw new Error('expected shape result')
    expect(res.shape.type).toBe('rect')
    expect(res.shape.width).toBe(20)
    expect(res.shape.props.stroke).toBe('#6366f1')
  })

  it('returns { ok: false, error } for an invalid create (negative width), never throwing', async () => {
    const exec = makeCanvasExecutor(ctx)
    // The executor must resolve (never reject) even on invalid input — the
    // try/catch inside `makeCanvasExecutor` is what guarantees this.
    const res: CanvasExecutorResult = await exec('canvas_createShape', {
      type: 'rect',
      x: 0,
      y: 0,
      width: -1,
      height: 10,
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toMatch(/width/i)
  })

  it('returns { ok: true, patch, shapeId } for a valid update', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_updateShape', { shapeId: 's1', fill: '#abc' })
    expect(res.ok).toBe(true)
    if (!res.ok || !('patch' in res)) throw new Error('expected patch result')
    expect(res.shapeId).toBe('s1')
    expect(res.patch.props).toEqual({ fill: '#abc' })
  })

  it('returns { ok: false, error } when shapeId is missing on update', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_updateShape', { fill: '#abc' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toMatch(/shapeId/i)
  })

  it('returns { ok: false, error mentioning the id } when updating a shape not on the canvas', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_updateShape', { shapeId: 'ghost', fill: '#abc' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toContain('ghost')
  })

  it('returns { ok: true } when updating a shape that IS on the canvas', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_updateShape', { shapeId: 's1', fill: '#abc' })
    expect(res.ok).toBe(true)
  })

  it('returns { ok: false, error mentioning the id } when deleting a shape not on the canvas', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_deleteShape', { shapeId: 'ghost' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toContain('ghost')
  })

  it('returns { ok: true } when deleting a shape that IS on the canvas', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_deleteShape', { shapeId: 's1' })
    expect(res.ok).toBe(true)
  })

  it('never throws even when the shape is missing (resolves to an error result)', async () => {
    const exec = makeCanvasExecutor(ctx)
    await expect(exec('canvas_deleteShape', { shapeId: 'ghost' })).resolves.toBeTruthy()
  })

  it('returns the context shapes for canvas_listShapes', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_listShapes', {})
    expect(res.ok).toBe(true)
    if (!res.ok || !('shapes' in res)) throw new Error('expected shapes result')
    expect(res.shapes).toEqual(ctx.shapes)
  })

  it('validates a batch and reports the count for canvas_createShapes', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_createShapes', {
      shapes: [
        { type: 'rect', x: 0, y: 0, width: 10, height: 10 },
        { type: 'ellipse', x: 20, y: 0, width: 10, height: 10 },
      ],
    })
    expect(res.ok).toBe(true)
    if (!res.ok || !('created' in res)) throw new Error('expected created result')
    expect(res.created).toBe(2)
  })

  it('fails the whole batch when any shape is invalid', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_createShapes', {
      shapes: [
        { type: 'rect', x: 0, y: 0, width: 10, height: 10 },
        { type: 'rect', x: 0, y: 0, width: -1, height: 10 },
      ],
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toMatch(/width/i)
  })

  it('lays out a diagram and reports the produced shape count for canvas_drawDiagram', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_drawDiagram', {
      nodes: [
        { id: 'a', label: 'Start' },
        { id: 'b', label: 'End' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    })
    expect(res.ok).toBe(true)
    if (!res.ok || !('created' in res)) throw new Error('expected created result')
    // 2 containers + 2 labels + 1 arrow.
    expect(res.created).toBe(5)
  })

  it('returns an error (never throws) for an empty diagram', async () => {
    const exec = makeCanvasExecutor(ctx)
    const res = await exec('canvas_drawDiagram', { nodes: [] })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toMatch(/node/i)
  })
})
