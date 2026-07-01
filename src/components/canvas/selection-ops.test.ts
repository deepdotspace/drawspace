import { describe, it, expect } from 'vitest'
import {
  cloneShapesWithOffset,
  serializeClipboard,
  deserializeClipboard,
  nudgeDelta,
  PASTE_OFFSET,
  type ShapeLike,
} from './selection-ops'

const sampleShapes: ShapeLike[] = [
  { type: 'rect', x: 10, y: 20, width: 40, height: 30, props: { stroke: '#000', fill: 'transparent' } },
  { type: 'ellipse', x: 0, y: 0, width: 50, height: 50, props: { stroke: '#f00' } },
]

describe('cloneShapesWithOffset', () => {
  it('shifts each shape by the given delta', () => {
    const cloned = cloneShapesWithOffset(sampleShapes, PASTE_OFFSET, PASTE_OFFSET)
    expect(cloned[0].x).toBe(26)
    expect(cloned[0].y).toBe(36)
    expect(cloned[1].x).toBe(16)
  })

  it('deep-copies props so edits do not bleed back', () => {
    const cloned = cloneShapesWithOffset(sampleShapes, 0, 0)
    cloned[0].props.stroke = '#fff'
    expect(sampleShapes[0].props.stroke).toBe('#000')
  })
})

describe('clipboard serialize/deserialize round-trip', () => {
  it('round-trips shapes back to create payloads', () => {
    const raw = serializeClipboard(sampleShapes)
    const parsed = deserializeClipboard(raw)
    expect(parsed).not.toBeNull()
    expect(parsed).toHaveLength(2)
    expect(parsed![0]).toMatchObject({ type: 'rect', x: 10, y: 20, width: 40, height: 30 })
    expect(parsed![0].props.stroke).toBe('#000')
  })

  it('returns null for non-JSON', () => {
    expect(deserializeClipboard('not json')).toBeNull()
  })

  it('returns null for a foreign clipboard payload', () => {
    expect(deserializeClipboard(JSON.stringify({ kind: 'other', shapes: [] }))).toBeNull()
  })

  it('returns null when an entry is malformed', () => {
    const bad = JSON.stringify({ kind: 'drawspace/shapes', version: 1, shapes: [{ type: 'rect', x: 'nope' }] })
    expect(deserializeClipboard(bad)).toBeNull()
  })
})

describe('nudgeDelta', () => {
  it('moves 1px per arrow press', () => {
    expect(nudgeDelta('ArrowLeft', false)).toEqual({ dx: -1, dy: 0 })
    expect(nudgeDelta('ArrowRight', false)).toEqual({ dx: 1, dy: 0 })
    expect(nudgeDelta('ArrowUp', false)).toEqual({ dx: 0, dy: -1 })
    expect(nudgeDelta('ArrowDown', false)).toEqual({ dx: 0, dy: 1 })
  })

  it('moves 10px with Shift held', () => {
    expect(nudgeDelta('ArrowRight', true)).toEqual({ dx: 10, dy: 0 })
    expect(nudgeDelta('ArrowUp', true)).toEqual({ dx: 0, dy: -10 })
  })

  it('returns null for non-arrow keys', () => {
    expect(nudgeDelta('a', false)).toBeNull()
    expect(nudgeDelta('Enter', true)).toBeNull()
  })
})
