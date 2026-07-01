// @vitest-environment jsdom
/**
 * Renders the SVG `Shape` directly to lock in two behaviors that were buggy:
 *  - a text shape being edited inline must NOT also render its SVG text (that
 *    caused the "same text twice over each other" double-vision), and
 *  - the extra geo shapes (triangle/pentagon/hexagon/star) render as polygons.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { CanvasShapeClient } from 'deepspace'
import { Shape } from './Shape'

afterEach(cleanup)

function make(over: Partial<CanvasShapeClient>): CanvasShapeClient {
  return {
    id: 's1',
    type: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    props: {},
    createdBy: 'u',
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

function renderShape(shape: CanvasShapeClient, isEditing = false) {
  return render(
    <svg>
      <Shape shape={shape} isSelected={false} isEditing={isEditing} />
    </svg>,
  )
}

describe('Shape — inline text editing', () => {
  it('renders the SVG text when not editing', () => {
    const { container } = renderShape(make({ type: 'text', props: { text: 'Hello', fontSize: 20 } }))
    expect(container.querySelector('text')).toBeTruthy()
    expect(container.textContent).toContain('Hello')
  })

  it('suppresses the SVG text while editing (no double render under the textarea)', () => {
    const { container } = renderShape(make({ type: 'text', props: { text: 'Hello', fontSize: 20 } }), true)
    expect(container.querySelector('text')).toBeNull()
    expect(container.textContent).not.toContain('Hello')
  })
})

describe('Shape — extra geo shapes', () => {
  for (const t of ['triangle', 'pentagon', 'hexagon', 'star'] as const) {
    it(`renders ${t} as a <polygon> inscribed in its box`, () => {
      const { container } = renderShape(make({ type: t }))
      const poly = container.querySelector('polygon')
      expect(poly).toBeTruthy()
      const pts = (poly?.getAttribute('points') ?? '').trim().split(/\s+/)
      expect(pts.length).toBeGreaterThanOrEqual(3)
    })
  }
})
