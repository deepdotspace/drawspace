import { describe, it, expect } from 'vitest'
import { polygonPoints, isPolygonShape, POLYGON_SHAPES, RADIAL_POLYGON_SHAPES, polygonPointsAttr } from './geo'
import type { Box } from './types'

const BOX: Box = { x: 0, y: 0, width: 100, height: 100 }

describe('isPolygonShape', () => {
  it('recognizes exactly the dropdown geo shapes', () => {
    for (const t of POLYGON_SHAPES) expect(isPolygonShape(t)).toBe(true)
    for (const t of ['rect', 'ellipse', 'diamond', 'line', 'arrow', 'text']) {
      expect(isPolygonShape(t)).toBe(false)
    }
  })
})

describe('polygonPoints', () => {
  it('produces the right vertex count per shape', () => {
    expect(polygonPoints('triangle', BOX)).toHaveLength(3)
    expect(polygonPoints('right-triangle', BOX)).toHaveLength(3)
    expect(polygonPoints('pentagon', BOX)).toHaveLength(5)
    expect(polygonPoints('hexagon', BOX)).toHaveLength(6)
    expect(polygonPoints('heptagon', BOX)).toHaveLength(7)
    expect(polygonPoints('octagon', BOX)).toHaveLength(8)
    expect(polygonPoints('trapezoid', BOX)).toHaveLength(4)
    expect(polygonPoints('parallelogram', BOX)).toHaveLength(4)
    expect(polygonPoints('star', BOX)).toHaveLength(10) // 5 outer + 5 inner
    expect(polygonPoints('star4', BOX)).toHaveLength(8)
    expect(polygonPoints('star6', BOX)).toHaveLength(12)
    expect(polygonPoints('cross', BOX)).toHaveLength(12)
    expect(polygonPoints('arrow-block', BOX)).toHaveLength(7)
    expect(polygonPoints('chevron', BOX)).toHaveLength(6)
  })

  it('keeps every shape inside its bounding box', () => {
    for (const t of POLYGON_SHAPES) {
      const pts = polygonPoints(t, BOX)
      // Every vertex stays inside the box (with a hair of FP tolerance).
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(-0.001)
        expect(p.x).toBeLessThanOrEqual(100.001)
        expect(p.y).toBeGreaterThanOrEqual(-0.001)
        expect(p.y).toBeLessThanOrEqual(100.001)
      }
    }
  })

  it('starts radial polygons & stars at top-center', () => {
    for (const t of RADIAL_POLYGON_SHAPES) {
      const pts = polygonPoints(t, BOX)
      // First vertex of an n-gon/star is the top point, centered horizontally.
      expect(pts[0].x).toBeCloseTo(50)
      expect(pts[0].y).toBeCloseTo(0)
    }
  })

  it('translates and scales with the box', () => {
    const moved = polygonPoints('triangle', { x: 10, y: 20, width: 40, height: 60 })
    expect(moved[0].x).toBeCloseTo(30) // 10 + 40/2
    expect(moved[0].y).toBeCloseTo(20)
  })

  it('serializes points with an optional rounder', () => {
    const attr = polygonPointsAttr(polygonPoints('triangle', BOX), (n) => Math.round(n))
    expect(attr).toContain('50,0')
    expect(attr.split(' ')).toHaveLength(3)
  })
})
