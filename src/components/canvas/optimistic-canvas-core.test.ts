import { describe, expect, it } from 'vitest'
import type { CanvasShapeClient } from 'deepspace'
import {
  mergeShapes,
  reconcileOverlay,
  serverAdvanced,
  type ShapeOverlay,
} from './optimistic-canvas-core'

function shape(over: Partial<CanvasShapeClient>): CanvasShapeClient {
  return {
    id: 'r1',
    type: 'rect',
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    props: { stroke: '#000' },
    createdBy: 'u',
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

function mapOf(...shapes: CanvasShapeClient[]): Map<string, CanvasShapeClient> {
  return new Map(shapes.map((s) => [s.id, s]))
}

describe('mergeShapes', () => {
  it('returns the same array reference when there is no overlay', () => {
    const server = [shape({})]
    expect(mergeShapes(server, new Map())).toBe(server)
  })

  it('paints a position overlay on top of the server shape', () => {
    const server = [shape({ x: 100, y: 100 })]
    const overlay = new Map<string, ShapeOverlay>([['r1', { x: 150, y: 120 }]])
    const [merged] = mergeShapes(server, overlay)
    expect(merged).toMatchObject({ x: 150, y: 120, width: 80, height: 60 })
  })

  it('keeps server props when the overlay only changes geometry', () => {
    const server = [shape({ props: { stroke: '#abc' } })]
    const overlay = new Map<string, ShapeOverlay>([['r1', { width: 200 }]])
    const [merged] = mergeShapes(server, overlay)
    expect(merged.width).toBe(200)
    expect(merged.props).toEqual({ stroke: '#abc' })
  })

  it('leaves shapes without an overlay untouched', () => {
    const server = [shape({ id: 'a' }), shape({ id: 'b', x: 0 })]
    const overlay = new Map<string, ShapeOverlay>([['a', { x: 999 }]])
    const merged = mergeShapes(server, overlay)
    expect(merged[0].x).toBe(999)
    expect(merged[1]).toBe(server[1])
  })
})

describe('serverAdvanced', () => {
  it('is false when geometry and props are unchanged', () => {
    const a = shape({})
    expect(serverAdvanced(a, { ...a })).toBe(false)
  })

  it('detects a geometry change', () => {
    expect(serverAdvanced(shape({ x: 5 }), shape({ x: 0 }))).toBe(true)
  })

  it('detects a props change by reference', () => {
    const before = shape({})
    const after = shape({ props: { ...before.props } })
    expect(serverAdvanced(after, before)).toBe(true)
  })
})

describe('reconcileOverlay', () => {
  it('keeps our overlay while the server copy stays put (our edit never echoes)', () => {
    const overlay = new Map<string, ShapeOverlay>([['r1', { x: 150, y: 120 }]])
    const server = mapOf(shape({ x: 100, y: 100 }))
    // prev == current: the server never moved on its own → overlay survives.
    expect(reconcileOverlay(overlay, server, server)).toBe(overlay)
  })

  it('evicts the overlay when the shape is deleted on the server', () => {
    const overlay = new Map<string, ShapeOverlay>([['r1', { x: 150 }]])
    const prev = mapOf(shape({}))
    const next = reconcileOverlay(overlay, new Map(), prev)
    expect(next.has('r1')).toBe(false)
  })

  it('evicts the overlay when a remote edit advances the server shape', () => {
    const overlay = new Map<string, ShapeOverlay>([['r1', { x: 150, y: 120 }]])
    const prev = mapOf(shape({ x: 100, y: 100 }))
    const now = mapOf(shape({ x: 300, y: 300 })) // another user moved it
    const next = reconcileOverlay(overlay, now, prev)
    expect(next.has('r1')).toBe(false)
  })

  it('returns the same Map reference when nothing needs evicting', () => {
    const overlay = new Map<string, ShapeOverlay>([['r1', { x: 150 }]])
    const server = mapOf(shape({}))
    expect(reconcileOverlay(overlay, server, server)).toBe(overlay)
  })

  it('is a no-op on an empty overlay', () => {
    const overlay = new Map<string, ShapeOverlay>()
    expect(reconcileOverlay(overlay, mapOf(shape({})), new Map())).toBe(overlay)
  })
})
