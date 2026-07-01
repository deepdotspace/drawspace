// @vitest-environment jsdom
/**
 * Integration test for the canvas interaction WIRING (not just geometry):
 * a pointer-down on the background rect must hit-test, start a gesture, and a
 * subsequent document pointermove must call the right useCanvas write method.
 *
 * DrawCanvas only imports *types* from `deepspace`, so it renders with a plain
 * mock canvas — no provider / WebSocket needed.
 *
 * Runs in jsdom; the default `vitest.config.ts` only includes `*.test.ts`, so
 * the fast node checker skips this. Run it with:
 *   npx vitest run src/components/canvas/DrawCanvas.test.tsx \
 *     --environment jsdom --include 'src/**\/*.test.tsx'
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { CanvasShapeClient } from 'deepspace'
import { DrawCanvas } from './DrawCanvas'
import type { OptimisticCanvasResult } from './useOptimisticCanvas'
import { DEFAULT_STYLE } from './types'

afterEach(cleanup)

function makeCanvas(shapes: CanvasShapeClient[]): OptimisticCanvasResult {
  return {
    shapes,
    viewports: [],
    connected: true,
    canWrite: true,
    addShape: vi.fn(),
    moveShape: vi.fn(),
    resizeShape: vi.fn(),
    deleteShape: vi.fn(),
    updateShape: vi.fn(),
    setViewport: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    beginGesture: vi.fn(),
    endGesture: vi.fn(),
  }
}

function makeShape(over: Partial<CanvasShapeClient>): CanvasShapeClient {
  return {
    id: 'r1',
    type: 'rect',
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    props: { stroke: '#000', fill: 'transparent', strokeWidth: 2 },
    createdBy: 'u',
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

function renderCanvas(canvas: OptimisticCanvasResult, props: Partial<Parameters<typeof DrawCanvas>[0]> = {}) {
  return render(
    <DrawCanvas
      canvas={canvas}
      activeTool="select"
      setActiveTool={() => {}}
      style={DEFAULT_STYLE}
      selectedIds={[]}
      setSelectedIds={() => {}}
      pan={{ x: 0, y: 0 }}
      setPan={() => {}}
      zoom={1}
      setZoom={() => {}}
      {...props}
    />,
  )
}

describe('DrawCanvas interaction wiring', () => {
  it('drags a shape → calls moveShape with the new absolute position', () => {
    const canvas = makeCanvas([makeShape({})])
    const { getByTestId } = renderCanvas(canvas)
    const bg = getByTestId('canvas-bg')

    // Press inside the rect (100..180, 100..160), then drag +50/+20.
    fireEvent.pointerDown(bg, { clientX: 120, clientY: 120, button: 0 })
    fireEvent.pointerMove(document, { clientX: 170, clientY: 140 })
    fireEvent.pointerUp(document, {})

    expect(canvas.moveShape).toHaveBeenCalledWith('r1', 150, 120)
  })

  it('selects the shape under the cursor on pointer-down', () => {
    const canvas = makeCanvas([makeShape({})])
    const setSelectedIds = vi.fn()
    const { getByTestId } = renderCanvas(canvas, { setSelectedIds })

    fireEvent.pointerDown(getByTestId('canvas-bg'), { clientX: 120, clientY: 120, button: 0 })
    expect(setSelectedIds).toHaveBeenCalledWith(['r1'])
  })

  it('drags the SE resize handle → calls resizeShape', () => {
    const canvas = makeCanvas([makeShape({})])
    // Pre-select so the handles are active.
    const { getByTestId } = renderCanvas(canvas, { selectedIds: ['r1'] })
    const bg = getByTestId('canvas-bg')

    // SE corner is at (180, 160). Grab it and drag +20/+20.
    fireEvent.pointerDown(bg, { clientX: 180, clientY: 160, button: 0 })
    fireEvent.pointerMove(document, { clientX: 200, clientY: 180 })
    fireEvent.pointerUp(document, {})

    expect(canvas.resizeShape).toHaveBeenCalledWith('r1', 100, 80, 100, 100)
  })

  it('drag-draws a new rectangle → calls addShape', () => {
    const canvas = makeCanvas([])
    const { getByTestId } = renderCanvas(canvas, { activeTool: 'rect' })
    const bg = getByTestId('canvas-bg')

    fireEvent.pointerDown(bg, { clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerMove(document, { clientX: 60, clientY: 50 })
    fireEvent.pointerUp(document, {})

    expect(canvas.addShape).toHaveBeenCalledTimes(1)
    const arg = (canvas.addShape as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ type: 'rect', x: 10, y: 10, width: 50, height: 40 })
  })

  it('clicking empty space deselects (marquee with an empty box selects nothing)', () => {
    const canvas = makeCanvas([makeShape({})])
    const setSelectedIds = vi.fn()
    const { getByTestId } = renderCanvas(canvas, { setSelectedIds })

    // A plain click (no drag) on empty canvas starts a zero-size marquee; on
    // pointer-up it resolves to an empty selection rather than panning.
    fireEvent.pointerDown(getByTestId('canvas-bg'), { clientX: 400, clientY: 400, button: 0 })
    fireEvent.pointerUp(document, {})
    expect(setSelectedIds).toHaveBeenCalledWith([])
  })

  it('drag-marquee over a shape selects it', () => {
    const canvas = makeCanvas([makeShape({})]) // rect at 100..180, 100..160
    const setSelectedIds = vi.fn()
    const { getByTestId } = renderCanvas(canvas, { setSelectedIds })
    const bg = getByTestId('canvas-bg')

    // Start on empty space, drag a box that covers the rect, release.
    fireEvent.pointerDown(bg, { clientX: 40, clientY: 40, button: 0 })
    fireEvent.pointerMove(document, { clientX: 220, clientY: 220 })
    fireEvent.pointerUp(document, {})
    expect(setSelectedIds).toHaveBeenLastCalledWith(['r1'])
  })

  it('selects a bent (polyline) arrow when clicking near one of its bends', () => {
    // Elbow arrow: bbox (100,100)-(200,200), waypoints stored bbox-relative.
    const arrow = makeShape({
      id: 'arr',
      type: 'arrow',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      props: {
        stroke: '#000',
        strokeWidth: 2,
        headCorner: 'se',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 100 },
          { x: 100, y: 100 },
        ],
      },
    })
    const canvas = makeCanvas([arrow])
    const setSelectedIds = vi.fn()
    const { getByTestId } = renderCanvas(canvas, { setSelectedIds })

    // Near the horizontal segment at the bottom (world y ~ 200), x in the middle
    // — a point a straight diagonal arrow would NOT pass through.
    fireEvent.pointerDown(getByTestId('canvas-bg'), { clientX: 150, clientY: 199, button: 0 })
    expect(setSelectedIds).toHaveBeenCalledWith(['arr'])
  })

  it('dragging a multi-selection moves every selected shape', () => {
    const canvas = makeCanvas([
      makeShape({ id: 'r1', x: 100, y: 100 }),
      makeShape({ id: 'r2', x: 300, y: 100 }),
    ])
    const { getByTestId } = renderCanvas(canvas, { selectedIds: ['r1', 'r2'] })
    const bg = getByTestId('canvas-bg')

    // Grab r1 (already in the selection) and drag +50/+20 → both shapes move.
    fireEvent.pointerDown(bg, { clientX: 120, clientY: 120, button: 0 })
    fireEvent.pointerMove(document, { clientX: 170, clientY: 140 })
    fireEvent.pointerUp(document, {})

    expect(canvas.moveShape).toHaveBeenCalledWith('r1', 150, 120)
    expect(canvas.moveShape).toHaveBeenCalledWith('r2', 350, 120)
  })
})
