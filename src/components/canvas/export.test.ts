import { describe, it, expect } from 'vitest'
import { shapesToSvgString, shapeToSvgElement, type ExportShape } from './export'

function shape(partial: Partial<ExportShape> & Pick<ExportShape, 'type'>): ExportShape {
  return {
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    props: {},
    ...partial,
  }
}

describe('shapesToSvgString', () => {
  it('produces a standalone, namespaced svg document', () => {
    const svg = shapesToSvgString([shape({ type: 'rect' })])
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox=')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('fits the viewBox to content bounds plus padding', () => {
    const svg = shapesToSvgString([shape({ type: 'rect', x: 100, y: 100, width: 50, height: 50 })], {
      padding: 10,
    })
    // bounds (100,100,50,50) padded by 10 → viewBox "90 90 70 70"
    expect(svg).toContain('viewBox="90 90 70 70"')
  })

  it('renders an empty but valid svg for no shapes', () => {
    const svg = shapesToSvgString([])
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  it('includes a background rect only when requested', () => {
    expect(shapesToSvgString([shape({ type: 'rect' })])).not.toContain('fill="#ffffff"')
    expect(shapesToSvgString([shape({ type: 'rect' })], { background: '#ffffff' })).toContain('fill="#ffffff"')
  })
})

describe('shapeToSvgElement — every shape type', () => {
  it('rect → <rect> carrying stroke/fill', () => {
    const el = shapeToSvgElement(shape({ type: 'rect', props: { stroke: '#e03131', fill: '#ffc9c9' } }))
    expect(el).toContain('<rect')
    expect(el).toContain('stroke="#e03131"')
    expect(el).toContain('fill="#ffc9c9"')
  })

  it('ellipse → <ellipse>', () => {
    expect(shapeToSvgElement(shape({ type: 'ellipse' }))).toContain('<ellipse')
  })

  it('diamond → <polygon>', () => {
    expect(shapeToSvgElement(shape({ type: 'diamond' }))).toContain('<polygon')
  })

  it('line → <line>', () => {
    expect(shapeToSvgElement(shape({ type: 'line' }))).toContain('<line')
  })

  it('arrow → <line> shaft + filled <polygon> arrowhead', () => {
    const el = shapeToSvgElement(shape({ type: 'arrow', width: 80, height: 60 }))
    // One straight shaft line.
    expect((el.match(/<line/g) ?? []).length).toBe(1)
    // Bold filled head is a single triangular polygon (not open lines).
    expect(el).toContain('<polygon')
  })

  it('bent arrow → <polyline> through its waypoints + arrowhead lines', () => {
    const el = shapeToSvgElement(
      shape({
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
      }),
    )
    expect(el).toContain('<polyline')
    // Absolute waypoints serialized into the polyline.
    expect(el).toContain('0,0 0,100 100,100')
    // Arrowhead on the last segment → a single filled triangular polygon.
    expect(el).toContain('<polygon')
  })

  it('bent line (no head) → <polyline> without arrowhead lines', () => {
    const el = shapeToSvgElement(
      shape({
        type: 'line',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        props: {
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 100 },
            { x: 100, y: 100 },
          ],
        },
      }),
    )
    expect(el).toContain('<polyline')
    expect((el.match(/<line/g) ?? []).length).toBe(0)
  })

  it('text → <text> with escaped content', () => {
    // Wide box so the short string stays on one line (one <tspan>) and the
    // escaped content is contiguous.
    const el = shapeToSvgElement(shape({ type: 'text', width: 400, height: 40, props: { text: 'a & b < c' } }))
    expect(el).toContain('<text')
    expect(el).toContain('<tspan')
    expect(el).toContain('a &amp; b &lt; c')
  })

  it('draw → <path>', () => {
    const el = shapeToSvgElement(
      shape({ type: 'draw', props: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] } }),
    )
    expect(el).toContain('<path')
    expect(el).toContain('d="M 0 0')
  })
})
