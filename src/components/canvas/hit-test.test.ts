import { describe, it, expect } from 'vitest'
import { hitTestShapes, hitTestHandle, resizeBox, shapesInBox, type HitShape } from './hit-test'

const rect: HitShape = { id: 'r1', type: 'rect', x: 100, y: 100, width: 80, height: 60, props: {} }
const ell: HitShape = { id: 'e1', type: 'ellipse', x: 300, y: 100, width: 100, height: 100, props: {} }

describe('hitTestShapes', () => {
  it('hits a rect when the point is inside', () => {
    expect(hitTestShapes([rect], { x: 120, y: 120 }, 1)).toBe('r1')
  })

  it('misses when the point is well outside', () => {
    expect(hitTestShapes([rect], { x: 500, y: 500 }, 1)).toBeNull()
  })

  it('returns the topmost (last) shape when shapes overlap', () => {
    const a: HitShape = { id: 'a', type: 'rect', x: 0, y: 0, width: 100, height: 100, props: {} }
    const b: HitShape = { id: 'b', type: 'rect', x: 0, y: 0, width: 100, height: 100, props: {} }
    expect(hitTestShapes([a, b], { x: 50, y: 50 }, 1)).toBe('b')
  })

  it('hits a line near its segment via headCorner', () => {
    // Line from nw (0,0) to se (100,100); a point near the diagonal hits.
    const line: HitShape = { id: 'l1', type: 'line', x: 0, y: 0, width: 100, height: 100, props: { headCorner: 'se' } }
    expect(hitTestShapes([line], { x: 50, y: 52 }, 1)).toBe('l1')
    // A point far from the diagonal (but inside the bbox) misses a line.
    expect(hitTestShapes([line], { x: 90, y: 10 }, 1)).toBeNull()
  })

  it('hits a bent (polyline) arrow along each of its segments', () => {
    // An elbow from (0,0) down to (0,100) then across to (100,100). Stored as
    // bbox-relative waypoints; bbox is (0,0,100,100).
    const arrow: HitShape = {
      id: 'arr',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      props: {
        headCorner: 'se',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 100 },
          { x: 100, y: 100 },
        ],
      },
    }
    // Near the vertical segment.
    expect(hitTestShapes([arrow], { x: 2, y: 50 }, 1)).toBe('arr')
    // Near the horizontal segment.
    expect(hitTestShapes([arrow], { x: 50, y: 98 }, 1)).toBe('arr')
    // The bbox interior away from BOTH segments (a straight-diagonal arrow would
    // be hit here, but a polyline must miss).
    expect(hitTestShapes([arrow], { x: 60, y: 40 }, 1)).toBeNull()
  })

  it('keeps a ~constant grab pad when zoomed out', () => {
    // 6/zoom padding: at zoom 0.5 the pad is 12 world units.
    expect(hitTestShapes([ell], { x: 300 - 10, y: 150 }, 0.5)).toBe('e1')
  })
})

describe('hitTestHandle', () => {
  it('detects the SE corner handle', () => {
    expect(hitTestHandle(rect, { x: 180, y: 160 }, 1)).toBe('se')
  })
  it('detects the NW corner handle', () => {
    expect(hitTestHandle(rect, { x: 100, y: 100 }, 1)).toBe('nw')
  })
  it('returns null away from any corner', () => {
    expect(hitTestHandle(rect, { x: 140, y: 130 }, 1)).toBeNull()
  })
  it('returns null with no selection', () => {
    expect(hitTestHandle(null, { x: 100, y: 100 }, 1)).toBeNull()
  })
})

describe('shapesInBox', () => {
  it('selects shapes whose bbox intersects the marquee', () => {
    // A big box covering both rect (100..180) and ellipse (300..400).
    expect(shapesInBox([rect, ell], { x: 0, y: 0, width: 500, height: 500 }).sort()).toEqual(['e1', 'r1'])
  })

  it('selects a partially-overlapping shape (not just fully-contained)', () => {
    // Box clips the rect's top-left corner only.
    expect(shapesInBox([rect], { x: 90, y: 90, width: 30, height: 30 })).toEqual(['r1'])
  })

  it('excludes shapes outside the box', () => {
    expect(shapesInBox([rect, ell], { x: 0, y: 0, width: 50, height: 50 })).toEqual([])
  })

  it('a zero-size box on empty space selects nothing (a click that deselects)', () => {
    expect(shapesInBox([rect, ell], { x: 0, y: 0, width: 0, height: 0 })).toEqual([])
  })
})

describe('resizeBox', () => {
  it('grows from the SE corner', () => {
    expect(resizeBox({ x: 0, y: 0, width: 100, height: 100 }, 'se', 50, 20)).toEqual({ x: 0, y: 0, width: 150, height: 120 })
  })
  it('moves the origin when dragging the NW corner', () => {
    expect(resizeBox({ x: 100, y: 100, width: 100, height: 100 }, 'nw', 20, 30)).toEqual({ x: 120, y: 130, width: 80, height: 70 })
  })
  it('never produces a non-positive size', () => {
    const b = resizeBox({ x: 0, y: 0, width: 10, height: 10 }, 'se', -100, -100)
    expect(b.width).toBeGreaterThanOrEqual(1)
    expect(b.height).toBeGreaterThanOrEqual(1)
  })
})
