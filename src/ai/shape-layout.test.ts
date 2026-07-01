import { describe, it, expect } from 'vitest'
import { deoverlapShapes, deoverlapAndReroute, boundsOf, placeInFreeSpace, type Bounds } from './shape-layout'
import type { CanvasShapeType, NormalizedShape } from './canvas-shape'

function shape(
  type: CanvasShapeType,
  x: number,
  y: number,
  width: number,
  height: number,
  props: Record<string, unknown> = {},
): NormalizedShape {
  return { type, x, y, width, height, props }
}

function rectsOverlap(a: NormalizedShape, b: NormalizedShape): boolean {
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return ox > 0 && oy > 0
}

const BODY = new Set(['rect', 'ellipse', 'diamond'])

function assertNoBodyOverlap(shapes: NormalizedShape[]): void {
  const bodies = shapes.filter((s) => BODY.has(s.type))
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      expect(rectsOverlap(bodies[i], bodies[j])).toBe(false)
    }
  }
}

describe('deoverlapShapes', () => {
  it('leaves a batch with fewer than two bodies unchanged', () => {
    const input = [shape('rect', 0, 0, 100, 60), shape('arrow', 0, 0, 100, 60)]
    expect(deoverlapShapes(input)).toEqual(input)
  })

  it('separates two fully-stacked identical boxes', () => {
    const out = deoverlapShapes([shape('rect', 0, 0, 100, 60), shape('rect', 0, 0, 100, 60)])
    assertNoBodyOverlap(out)
  })

  it('separates a cluster of overlapping boxes so none collide', () => {
    const out = deoverlapShapes([
      shape('rect', 0, 0, 120, 80),
      shape('ellipse', 30, 20, 120, 80),
      shape('diamond', 60, 40, 120, 80),
      shape('rect', 10, 10, 120, 80),
    ])
    expect(out).toHaveLength(4)
    assertNoBodyOverlap(out)
  })

  it('preserves a small box intentionally nested in a much larger one', () => {
    const input = [shape('rect', 0, 0, 400, 300), shape('rect', 50, 50, 40, 40)]
    const out = deoverlapShapes(input)
    expect(out).toEqual(input)
  })

  it('keeps a text label registered to its container after the box moves', () => {
    const input = [
      shape('rect', 0, 0, 100, 60), // A — label belongs here
      shape('text', 10, 20, 80, 20, { text: 'A' }),
      shape('rect', 40, 10, 100, 60), // B — overlaps A, forces a move
    ]
    const out = deoverlapShapes(input)
    assertNoBodyOverlap(out)

    const dx = out[0].x - input[0].x
    const dy = out[0].y - input[0].y
    // The label rode along by the same delta as its box.
    expect(out[1].x).toBeCloseTo(input[1].x + dx)
    expect(out[1].y).toBeCloseTo(input[1].y + dy)
  })

  it('never moves lines or arrows', () => {
    const input = [
      shape('rect', 0, 0, 100, 60),
      shape('rect', 0, 0, 100, 60),
      shape('arrow', 5, 5, 90, 50, { headCorner: 'se' }),
    ]
    const out = deoverlapShapes(input)
    const arrow = out[2]
    expect(arrow.x).toBe(5)
    expect(arrow.y).toBe(5)
    expect(arrow.type).toBe('arrow')
  })

  it('preserves shape order, count, and props', () => {
    const input = [
      shape('rect', 0, 0, 100, 60, { fill: 'red' }),
      shape('ellipse', 10, 10, 100, 60, { stroke: 'blue' }),
    ]
    const out = deoverlapShapes(input)
    expect(out).toHaveLength(2)
    expect(out.map((s) => s.type)).toEqual(['rect', 'ellipse'])
    expect(out[0].props).toEqual({ fill: 'red' })
    expect(out[1].props).toEqual({ stroke: 'blue' })
  })

  it('is deterministic', () => {
    const input = [
      shape('rect', 0, 0, 120, 80),
      shape('rect', 20, 20, 120, 80),
      shape('rect', 40, 40, 120, 80),
    ]
    expect(deoverlapShapes(input)).toEqual(deoverlapShapes(input))
  })

  describe('preserveIntentionalOverlap (pictorial mode)', () => {
    it('still separates an accidental near-complete stack', () => {
      const out = deoverlapShapes(
        [shape('rect', 0, 0, 100, 60), shape('rect', 0, 0, 100, 60)],
        { preserveIntentionalOverlap: true },
      )
      assertNoBodyOverlap(out)
    })

    it('preserves a partial overlap a picture needs (snowman circles)', () => {
      // Two same-size circles overlapping ~25% — intentional composition.
      const input = [shape('ellipse', 0, 0, 100, 100), shape('ellipse', 0, 75, 100, 100)]
      const out = deoverlapShapes(input, { preserveIntentionalOverlap: true })
      expect(out).toEqual(input)
    })

    it('preserves a part that overlaps another by about a third', () => {
      // Two bodies overlapping ~33% of the smaller — intentional, keep as-is.
      const input = [shape('rect', 0, 40, 120, 80), shape('rect', 0, 0, 120, 60)]
      const out = deoverlapShapes(input, { preserveIntentionalOverlap: true })
      expect(out).toEqual(input)
    })

    it('still defaults to full de-overlap when the flag is absent', () => {
      const input = [shape('ellipse', 0, 0, 100, 100), shape('ellipse', 0, 75, 100, 100)]
      const out = deoverlapShapes(input)
      assertNoBodyOverlap(out)
    })
  })
})

describe('deoverlapAndReroute', () => {
  it('separates overlapping bodies and re-routes the connector to stay attached', () => {
    const input = [
      shape('rect', 0, 0, 100, 60),
      shape('rect', 20, 20, 100, 60), // overlaps the first → must separate
      shape('arrow', 100, 60, 1, 1, { headCorner: 'se', stroke: '#111' }), // wired between them
    ]
    const out = deoverlapAndReroute(input)
    expect(out).toHaveLength(3)
    assertNoBodyOverlap(out)

    const arrow = out[2]
    expect(arrow.type).toBe('arrow')
    // Preserves unrelated props.
    expect(arrow.props.stroke).toBe('#111')
    // Re-routed as a bbox-relative polyline whose every segment is axis-aligned.
    const pts = arrow.props.points as Array<{ x: number; y: number }>
    expect(Array.isArray(pts)).toBe(true)
    expect(pts.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < pts.length - 1; i++) {
      expect(pts[i].x === pts[i + 1].x || pts[i].y === pts[i + 1].y).toBe(true)
    }

    // Endpoints land on the faces of the two (now separated) boxes.
    const abs = pts.map((p) => ({ x: arrow.x + p.x, y: arrow.y + p.y }))
    const start = abs[0]
    const end = abs[abs.length - 1]
    const onFace = (p: { x: number; y: number }, b: NormalizedShape) => {
      const e = 0.001
      const onX = Math.abs(p.x - b.x) < e || Math.abs(p.x - (b.x + b.width)) < e
      const onY = Math.abs(p.y - b.y) < e || Math.abs(p.y - (b.y + b.height)) < e
      const insideX = p.x >= b.x - e && p.x <= b.x + b.width + e
      const insideY = p.y >= b.y - e && p.y <= b.y + b.height + e
      return (onX && insideY) || (onY && insideX)
    }
    expect(onFace(start, out[0]) || onFace(start, out[1])).toBe(true)
    expect(onFace(end, out[0]) || onFace(end, out[1])).toBe(true)
  })

  it('leaves a connector-free batch identical to deoverlapShapes', () => {
    const input = [shape('rect', 0, 0, 120, 80), shape('rect', 20, 20, 120, 80)]
    expect(deoverlapAndReroute(input)).toEqual(deoverlapShapes(input))
  })

  it('is deterministic', () => {
    const input = [
      shape('rect', 0, 0, 100, 60),
      shape('rect', 10, 10, 100, 60),
      shape('arrow', 95, 55, 1, 1, { headCorner: 'se' }),
    ]
    expect(deoverlapAndReroute(input)).toEqual(deoverlapAndReroute(input))
  })
})

describe('boundsOf', () => {
  it('returns null for an empty set', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('computes the union bounding box', () => {
    const b = boundsOf([
      { x: 10, y: 20, width: 30, height: 40 }, // → 10..40, 20..60
      { x: 50, y: 0, width: 10, height: 10 }, // → 50..60, 0..10
    ])
    expect(b).toEqual({ x: 10, y: 0, width: 50, height: 60 })
  })
})

describe('placeInFreeSpace', () => {
  function box(x: number, y: number, w: number, h: number): Bounds {
    return { x, y, width: w, height: h }
  }

  it('leaves shapes untouched when the canvas is empty', () => {
    const shapes = [shape('rect', 5, 5, 100, 60)]
    expect(placeInFreeSpace(shapes, [])).toEqual(shapes)
  })

  it('drops the batch below existing content with no overlap', () => {
    const existing = [box(0, 0, 200, 100)] // occupies y up to 100
    const batch = [shape('rect', 0, 0, 80, 40), shape('ellipse', 100, 0, 80, 40)]
    const out = placeInFreeSpace(batch, existing)
    // Every placed shape sits strictly below the existing content's max-y.
    for (const s of out) expect(s.y).toBeGreaterThanOrEqual(100)
    // Relative geometry within the batch is preserved (rigid translation).
    expect(out[1].x - out[0].x).toBe(100)
    expect(out[1].y - out[0].y).toBe(0)
  })

  it('translates connectors by the same delta so they stay attached', () => {
    const existing = [box(0, 0, 300, 200)]
    const batch = [
      shape('rect', 0, 0, 100, 60),
      shape('arrow', 0, 60, 100, 40, { headCorner: 'se' }),
    ]
    const out = placeInFreeSpace(batch, existing)
    const dxBox = out[0].x - batch[0].x
    const dyBox = out[0].y - batch[0].y
    const dxArrow = out[1].x - batch[1].x
    const dyArrow = out[1].y - batch[1].y
    expect(dxArrow).toBe(dxBox)
    expect(dyArrow).toBe(dyBox)
  })

  it('left-aligns the batch to existing content', () => {
    const existing = [box(40, 0, 100, 100)]
    const batch = [shape('rect', 999, 999, 50, 50)]
    const out = placeInFreeSpace(batch, existing)
    expect(out[0].x).toBe(40)
  })
})
