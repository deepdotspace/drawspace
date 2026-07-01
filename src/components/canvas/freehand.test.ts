import { describe, it, expect } from 'vitest'
import { pointsToPath, bboxFromPoints, relativizePoints } from './freehand'

describe('pointsToPath', () => {
  it('returns an empty string for no points', () => {
    expect(pointsToPath([])).toBe('')
  })

  it('renders a single point as a zero-length segment so a dot shows', () => {
    const d = pointsToPath([{ x: 3, y: 4 }])
    expect(d).toBe('M 3 4 L 3 4')
  })

  it('builds an M then L commands for a multi-point stroke', () => {
    const d = pointsToPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ])
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d).toContain('L 10 5')
    expect(d).toContain('L 20 0')
  })

  it('rounds long fractional coordinates', () => {
    const d = pointsToPath([{ x: 1.23456, y: 2 }, { x: 3, y: 4 }])
    expect(d).toContain('M 1.23 2')
  })
})

describe('bboxFromPoints', () => {
  it('returns a zero box for no points', () => {
    expect(bboxFromPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('computes the tight bounding box', () => {
    const b = bboxFromPoints([
      { x: 5, y: 10 },
      { x: 25, y: 4 },
      { x: 15, y: 40 },
    ])
    expect(b).toEqual({ x: 5, y: 4, width: 20, height: 36 })
  })
})

describe('relativizePoints', () => {
  it('shifts the bounding box origin to (0, 0)', () => {
    const rel = relativizePoints([
      { x: 5, y: 10 },
      { x: 25, y: 4 },
    ])
    const b = bboxFromPoints(rel)
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
    expect(rel[0]).toEqual({ x: 0, y: 6 })
    expect(rel[1]).toEqual({ x: 20, y: 0 })
  })
})
