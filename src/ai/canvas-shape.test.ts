import { describe, it, expect } from 'vitest'
import {
  normalizeCreate,
  normalizeEdit,
  SHAPE_DEFAULTS,
  type ShapeCreateInput,
} from './canvas-shape'

describe('normalizeCreate', () => {
  // 1. happy path
  it('produces correct geometry and props for a valid rect', () => {
    const out = normalizeCreate({
      type: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      fill: '#ff0000',
      stroke: '#000000',
    })
    expect(out.type).toBe('rect')
    expect(out.x).toBe(10)
    expect(out.y).toBe(20)
    expect(out.width).toBe(100)
    expect(out.height).toBe(50)
    expect(out.props.fill).toBe('#ff0000')
    expect(out.props.stroke).toBe('#000000')
  })

  // 1b. extended polygon vocabulary (roofs, stars, etc.)
  it('accepts the extended polygon shape types', () => {
    for (const type of ['triangle', 'right-triangle', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'trapezoid', 'parallelogram', 'star', 'star4', 'star6', 'cross', 'arrow-block', 'chevron'] as const) {
      const out = normalizeCreate({ type, x: 0, y: 0, width: 20, height: 20 })
      expect(out.type).toBe(type)
      // Style defaults still fold in for the new types.
      expect(out.props.stroke).toBe('#6366f1')
    }
  })

  // 2. defaults
  it('applies style defaults when fill/stroke/strokeWidth are omitted', () => {
    const out = normalizeCreate({ type: 'ellipse', x: 0, y: 0, width: 5, height: 5 })
    expect(out.props.fill).toBe(SHAPE_DEFAULTS.fill)
    expect(out.props.fill).toBe('transparent')
    expect(out.props.stroke).toBe('#6366f1')
    expect(out.props.strokeWidth).toBe(3)
  })

  // 3. text shape
  it('carries text into props for type "text" but drops it for a rect', () => {
    const textShape = normalizeCreate({
      type: 'text',
      x: 0,
      y: 0,
      width: 30,
      height: 10,
      text: 'hi',
    })
    expect(textShape.props.text).toBe('hi')

    const rect = normalizeCreate({
      type: 'rect',
      x: 0,
      y: 0,
      width: 30,
      height: 10,
      text: 'hi',
    })
    expect(rect.props.text).toBeUndefined()
  })

  // 4. validation
  it('throws on invalid type, non-positive size, or non-finite coordinates', () => {
    expect(() =>
      normalizeCreate({
        type: 'blob' as unknown as ShapeCreateInput['type'],
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      }),
    ).toThrow(/Invalid shape type/)

    expect(() =>
      normalizeCreate({ type: 'rect', x: 0, y: 0, width: 0, height: 10 }),
    ).toThrow(/width/)

    expect(() =>
      normalizeCreate({ type: 'rect', x: 0, y: 0, width: 10, height: -3 }),
    ).toThrow(/height/)

    expect(() =>
      normalizeCreate({ type: 'rect', x: Number.NaN, y: 0, width: 10, height: 10 }),
    ).toThrow(/x/)

    expect(() =>
      normalizeCreate({ type: 'rect', x: 0, y: Infinity, width: 10, height: 10 }),
    ).toThrow(/y/)
  })

  // 4b. polyline waypoints
  it('carries a points polyline into props for an arrow (a fresh array), drops it for a rect', () => {
    const arrow = normalizeCreate({
      type: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
    })
    const pts = arrow.props.points as Array<{ x: number; y: number }>
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ])

    // A rect never carries connector waypoints.
    const rect = normalizeCreate({
      type: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    } as unknown as ShapeCreateInput)
    expect(rect.props.points).toBeUndefined()
  })

  it('ignores a degenerate (< 2 point) or malformed points array on an arrow', () => {
    const single = normalizeCreate({
      type: 'arrow',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [{ x: 0, y: 0 }],
    })
    expect(single.props.points).toBeUndefined()

    const bad = normalizeCreate({
      type: 'arrow',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [{ x: 0, y: Number.NaN }, { x: 1, y: 1 }] as Array<{ x: number; y: number }>,
    })
    expect(bad.props.points).toBeUndefined()
  })

  // 5. ignores extra fields
  it('never echoes unknown extra fields into props', () => {
    const out = normalizeCreate({
      type: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      foo: 1,
    } as unknown as ShapeCreateInput)
    expect('foo' in out.props).toBe(false)
    expect((out.props as Record<string, unknown>).foo).toBeUndefined()
  })
})

describe('normalizeEdit', () => {
  // 6. partial
  it('includes only provided keys and yields an empty patch for empty input', () => {
    expect(normalizeEdit({})).toEqual({})

    const patch = normalizeEdit({ x: 5 })
    expect(patch).toEqual({ x: 5 })
    expect('y' in patch).toBe(false)
    expect('props' in patch).toBe(false)
  })

  // 7. validation
  it('throws on a bad numeric value but accepts a style-only patch', () => {
    expect(() => normalizeEdit({ width: -5 })).toThrow(/width/)

    const patch = normalizeEdit({ fill: '#abcdef' })
    expect(patch.props).toEqual({ fill: '#abcdef' })
    expect(patch.x).toBeUndefined()
  })
})
