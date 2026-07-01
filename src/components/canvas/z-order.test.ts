import { describe, it, expect } from 'vitest'
import { orderByZ, reorderShapes, type ZShape } from './z-order'

/** Build shapes; `z` omitted means no explicit z (treated as 0). */
function shapes(spec: Array<[string, number?]>): ZShape[] {
  return spec.map(([id, z]) => ({ id, props: z === undefined ? {} : { z } }))
}

const ids = (s: ZShape[]) => s.map((x) => x.id)

describe('orderByZ', () => {
  it('keeps source order when no z is set (stable)', () => {
    expect(ids(orderByZ(shapes([['a'], ['b'], ['c']])))).toEqual(['a', 'b', 'c'])
  })

  it('sorts ascending by z, breaking ties by source order', () => {
    expect(ids(orderByZ(shapes([['a', 2], ['b', 0], ['c', 2], ['d', 1]])))).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('reorderShapes', () => {
  const base = shapes([['a'], ['b'], ['c'], ['d']]) // bottom→top: a,b,c,d

  it('brings the selection to the front', () => {
    expect(ids(reorderShapes(base, ['b'], 'front'))).toEqual(['a', 'c', 'd', 'b'])
  })

  it('sends the selection to the back', () => {
    expect(ids(reorderShapes(base, ['c'], 'back'))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('moves the selection forward one step', () => {
    expect(ids(reorderShapes(base, ['b'], 'forward'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('moves the selection backward one step', () => {
    expect(ids(reorderShapes(base, ['c'], 'backward'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('is a no-op moving the top shape forward', () => {
    expect(ids(reorderShapes(base, ['d'], 'forward'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('is a no-op moving the bottom shape backward', () => {
    expect(ids(reorderShapes(base, ['a'], 'backward'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves a multi-shape selection as a block to the front', () => {
    expect(ids(reorderShapes(base, ['a', 'b'], 'front'))).toEqual(['c', 'd', 'a', 'b'])
  })

  it('returns the plain order for an empty selection', () => {
    expect(ids(reorderShapes(base, [], 'front'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('respects existing z when computing order', () => {
    const s = shapes([['a', 3], ['b', 1], ['c', 2]]) // visual: b,c,a
    expect(ids(reorderShapes(s, ['b'], 'front'))).toEqual(['c', 'a', 'b'])
  })
})
