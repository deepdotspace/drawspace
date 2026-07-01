/**
 * DrawCanvas — the SVG drawing surface.
 *
 * Interaction model (the robust one): EVERY shape is `pointer-events: none`,
 * and a single full-size background rect receives all pointer events. On
 * pointer-down we hit-test the cursor against the shapes / selection handles in
 * JavaScript to decide whether to move, resize, create, or pan. The gesture
 * itself is driven by `document`-level listeners attached imperatively at
 * pointer-down, so a drag is NEVER dropped when the cursor moves fast, leaves
 * the window, or passes over other elements.
 *
 * Shape data lives in the CanvasRoom DO via the `canvas` API passed in from the
 * workspace (single source of truth, live-synced for all users).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUserColor, type CanvasShapeClient, type PresencePeerClient } from 'deepspace'
import { MousePointer2 } from 'lucide-react'
import type { OptimisticCanvasResult } from './useOptimisticCanvas'
import { Shape } from './Shape'
import { hitTestHandle, hitTestShapes, shapesInBox } from './hit-test'
import { orderByZ } from './z-order'
import { CANVAS_COLORS } from './theme'
import { bboxFromPoints, pointsToPath, relativizePoints } from './freehand'
import { layoutText, maxLineWidth, fitTextBox, MAX_AUTO_TEXT_WIDTH, TEXT_BOX_PAD } from './text-layout'
import { isPolygonShape, polygonPoints } from './geo'
import {
  boxFromDrag,
  cornerFromDrag,
  cornerPoint,
  isDrawTool,
  oppositeCorner,
  type Box,
  type CanvasBackground,
  type Corner,
  type Point,
  type ShapeStyle,
  type Tool,
} from './types'

interface DrawCanvasProps {
  canvas: OptimisticCanvasResult
  activeTool: Tool
  setActiveTool: (t: Tool) => void
  style: ShapeStyle
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  pan: Point
  setPan: React.Dispatch<React.SetStateAction<Point>>
  zoom: number
  setZoom: React.Dispatch<React.SetStateAction<number>>
  /** Canvas background style (dotted / lined grid, or plain surface). */
  background?: CanvasBackground
  /** Other users present on this board, with their live cursor in `state.cursor`. */
  peers?: PresencePeerClient[]
  /** Report the local pointer's world position (or null when it leaves). */
  reportCursor?: (world: Point | null) => void
}

type Drag =
  | { kind: 'create'; tool: Tool; world0: Point; box: Box; headCorner: Corner }
  // `move` carries every selected shape's original position so the whole
  // selection translates together by the same delta.
  | { kind: 'move'; origs: Map<string, Point>; client0: Point }
  | { kind: 'resize'; shapeId: string; client0: Point; orig: Box; corner: Corner; box: Box }
  | { kind: 'pan'; client0: Point; pan0: Point }
  // `marquee` is the select tool's rubber-band: drag a box, select what it hits.
  | { kind: 'marquee'; world0: Point; box: Box; additive: boolean; base: string[] }
  // `draw` is the freehand/pencil gesture: accumulate world-space points.
  | { kind: 'draw'; points: Point[] }

const MIN_SIZE = 4

function shapeBox(s: CanvasShapeClient): Box {
  return { x: s.x, y: s.y, width: s.width, height: s.height }
}

export function DrawCanvas({
  canvas,
  activeTool,
  setActiveTool,
  style,
  selectedIds,
  setSelectedIds,
  pan,
  setPan,
  zoom,
  setZoom,
  background = 'dots',
  peers = [],
  reportCursor,
}: DrawCanvasProps) {
  const { shapes, addShape, moveShape, resizeShape, deleteShape, updateShape, setViewport, canWrite, undo, redo, beginGesture, endGesture } = canvas

  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const pendingSelect = useRef<{ before: Set<string>; edit: boolean } | null>(null)
  // Listener cleanup for an in-flight gesture (so unmount mid-drag won't leak).
  const cleanupRef = useRef<(() => void) | null>(null)

  // Shapes in back-to-front stacking order (by props.z). Used for BOTH render
  // and hit-testing so "topmost" matches what the user sees after reordering.
  const ordered = useMemo(() => orderByZ(shapes), [shapes])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // Resize handles only make sense for a single-shape selection.
  const selectedShape = selectedIds.length === 1 ? shapes.find((s) => s.id === selectedIds[0]) ?? null : null
  // Latest selection, readable synchronously inside the imperative gesture.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  // --- coordinate helpers ---------------------------------------------------
  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom }
    },
    [pan, zoom],
  )
  const worldToScreen = useCallback(
    (p: Point): Point => ({ x: p.x * zoom + pan.x, y: p.y * zoom + pan.y }),
    [pan, zoom],
  )

  // --- report viewport to other users --------------------------------------
  useEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    setViewport({ x: -pan.x / zoom, y: -pan.y / zoom, width: rect.width / zoom, height: rect.height / zoom, zoom })
  }, [pan, zoom, setViewport])

  // --- claim the newly created shape ---------------------------------------
  useEffect(() => {
    const pend = pendingSelect.current
    if (!pend) return
    const fresh = shapes.find((s) => !pend.before.has(s.id))
    if (!fresh) return
    pendingSelect.current = null
    setSelectedIds([fresh.id])
    if (pend.edit && fresh.type === 'text') {
      setEditing({ id: fresh.id, value: (fresh.props.text as string) ?? '' })
    }
  }, [shapes, setSelectedIds])

  // --- keyboard: delete, undo/redo, space-to-pan ---------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editing) return
      const typing = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (e.key === ' ' && !typing) setSpaceDown(true)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selectedIdsRef.current.length > 0) {
        e.preventDefault()
        // Delete the whole selection as one undo step.
        beginGesture()
        for (const id of selectedIdsRef.current) deleteShape(id)
        endGesture()
        setSelectedIds([])
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [editing, deleteShape, setSelectedIds, undo, redo, beginGesture, endGesture])

  // Clean up any in-flight gesture listeners on unmount.
  useEffect(() => () => cleanupRef.current?.(), [])

  // --- broadcast the local cursor to other users --------------------------
  // Report in WORLD coordinates (so each viewer renders it under their own
  // pan/zoom), coalesced to one update per animation frame to avoid flooding
  // the presence socket on fast pointer moves.
  const reportCursorRef = useRef(reportCursor)
  reportCursorRef.current = reportCursor
  const cursorRafRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<Point | null>(null)
  useEffect(() => () => {
    if (cursorRafRef.current != null) cancelAnimationFrame(cursorRafRef.current)
  }, [])
  const onPointerMoveReport = (e: React.PointerEvent) => {
    if (!reportCursorRef.current) return
    pendingCursorRef.current = screenToWorld(e.clientX, e.clientY)
    if (cursorRafRef.current == null) {
      cursorRafRef.current = requestAnimationFrame(() => {
        cursorRafRef.current = null
        if (pendingCursorRef.current) reportCursorRef.current?.(pendingCursorRef.current)
      })
    }
  }
  const onPointerLeaveReport = () => {
    // Cancel any queued frame and drop the pending position, otherwise a move
    // that fired in the same frame just before leaving would re-broadcast the
    // last position right after we sent `null` — leaving a ghost cursor parked
    // on every remote viewer's board.
    if (cursorRafRef.current != null) {
      cancelAnimationFrame(cursorRafRef.current)
      cursorRafRef.current = null
    }
    pendingCursorRef.current = null
    reportCursorRef.current?.(null)
  }

  // --- commit a create drag into a real shape ------------------------------
  const commitCreate = useCallback(
    (d: Extract<Drag, { kind: 'create' }>) => {
      const tool = d.tool
      const b = d.box
      const tiny = b.width < MIN_SIZE && b.height < MIN_SIZE

      pendingSelect.current = { before: new Set(shapes.map((s) => s.id)), edit: tool === 'text' }

      if (tool === 'text') {
        const fontSize = style.fontSize
        addShape({
          type: 'text',
          x: d.world0.x,
          y: d.world0.y,
          width: tiny ? 160 : Math.max(b.width, 40),
          height: Math.round(fontSize * 1.4),
          props: { stroke: style.stroke, fill: 'transparent', fontSize, text: '' },
        })
        setActiveTool('select')
        return
      }

      if (tiny) {
        pendingSelect.current = null
        setActiveTool('select')
        return
      }

      const baseProps: Record<string, unknown> = {
        stroke: style.stroke,
        fill: style.fill,
        strokeWidth: style.strokeWidth,
      }
      if (tool === 'line' || tool === 'arrow') baseProps.headCorner = d.headCorner

      addShape({ type: tool, x: b.x, y: b.y, width: Math.max(b.width, 1), height: Math.max(b.height, 1), props: baseProps })
      setActiveTool('select')
    },
    [shapes, style, addShape, setActiveTool],
  )

  // --- commit a freehand draw gesture into a `draw` shape ------------------
  const commitDraw = useCallback(
    (d: Extract<Drag, { kind: 'draw' }>) => {
      const pts = d.points
      const bb = bboxFromPoints(pts)
      // The pencil is "sticky": after a stroke we stay in the draw tool (and do
      // NOT auto-select the stroke) so the user can keep drawing freely until
      // they pick another tool. An accidental dot/tap is just ignored.
      if (pts.length < 2 || (bb.width < MIN_SIZE && bb.height < MIN_SIZE)) return
      // Store points relative to the bbox origin so move/resize transform them.
      const rel = relativizePoints(pts)
      addShape({
        type: 'draw',
        x: bb.x,
        y: bb.y,
        width: Math.max(bb.width, 1),
        height: Math.max(bb.height, 1),
        props: { stroke: style.stroke, strokeWidth: style.strokeWidth, points: rel },
      })
    },
    [style, addShape],
  )

  // --- begin a drag: attach document listeners for the whole gesture -------
  const beginDrag = useCallback(
    (initial: Drag) => {
      setDrag(initial)
      let cur = initial
      // A move/resize drag is one logical edit: open a gesture so its many
      // pointer-move writes coalesce into a single undo step on release.
      if (initial.kind === 'move' || initial.kind === 'resize') beginGesture()

      const onMove = (e: PointerEvent) => {
        if (cur.kind === 'pan') {
          setPan({ x: cur.pan0.x + (e.clientX - cur.client0.x), y: cur.pan0.y + (e.clientY - cur.client0.y) })
          return
        }
        if (cur.kind === 'move') {
          const dx = (e.clientX - cur.client0.x) / zoom
          const dy = (e.clientY - cur.client0.y) / zoom
          for (const [id, orig] of cur.origs) moveShape(id, orig.x + dx, orig.y + dy)
          return
        }
        if (cur.kind === 'marquee') {
          const world = screenToWorld(e.clientX, e.clientY)
          cur = { ...cur, box: boxFromDrag(cur.world0, world) }
          setDrag(cur)
          return
        }
        if (cur.kind === 'draw') {
          const world = screenToWorld(e.clientX, e.clientY)
          cur = { ...cur, points: [...cur.points, world] }
          setDrag(cur)
          return
        }
        if (cur.kind === 'resize') {
          const dx = (e.clientX - cur.client0.x) / zoom
          const dy = (e.clientY - cur.client0.y) / zoom
          const o = cur.orig
          let left = o.x
          let top = o.y
          let right = o.x + o.width
          let bottom = o.y + o.height
          if (cur.corner.includes('w')) left = o.x + dx
          if (cur.corner.includes('e')) right = o.x + o.width + dx
          if (cur.corner.includes('n')) top = o.y + dy
          if (cur.corner.includes('s')) bottom = o.y + o.height + dy
          const nx = Math.min(left, right)
          const ny = Math.min(top, bottom)
          const nw = Math.max(Math.abs(right - left), 1)
          const nh = Math.max(Math.abs(bottom - top), 1)
          resizeShape(cur.shapeId, nw, nh, nx, ny)
          cur = { ...cur, box: { x: nx, y: ny, width: nw, height: nh } }
          setDrag(cur)
          return
        }
        // create
        const world = screenToWorld(e.clientX, e.clientY)
        cur = { ...cur, box: boxFromDrag(cur.world0, world), headCorner: cornerFromDrag(cur.world0, world) }
        setDrag(cur)
      }

      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        cleanupRef.current = null
        // Flush the coalesced drag as ONE server write (one undo step).
        if (cur.kind === 'move' || cur.kind === 'resize') endGesture()
        if (cur.kind === 'create') commitCreate(cur)
        if (cur.kind === 'draw') commitDraw(cur)
        if (cur.kind === 'marquee') {
          const hits = shapesInBox(shapes, cur.box)
          // Additive (shift) marquee unions with the prior selection; a plain
          // marquee replaces it. A zero-size box (click on empty) selects [].
          setSelectedIds(cur.additive ? [...new Set([...cur.base, ...hits])] : hits)
        }
        setDrag(null)
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      cleanupRef.current = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        // Unmounting mid-drag: flush the coalesced move/resize so it isn't lost
        // AND so the optimistic hook's gesture flag doesn't stay stuck open
        // (which would silently swallow later direct writes like arrow-nudge).
        if (cur.kind === 'move' || cur.kind === 'resize') endGesture()
      }
    },
    [zoom, moveShape, resizeShape, beginGesture, endGesture, screenToWorld, commitCreate, commitDraw, setPan, shapes, setSelectedIds],
  )

  // --- the single pointer-down handler (on the background rect) ------------
  const onPointerDown = (e: React.PointerEvent) => {
    // Middle-click, hand tool, or held space → pan.
    if (e.button === 1 || activeTool === 'hand' || spaceDown) {
      beginDrag({ kind: 'pan', client0: { x: e.clientX, y: e.clientY }, pan0: { ...pan } })
      return
    }
    if (e.button !== 0) return

    const world = screenToWorld(e.clientX, e.clientY)

    // Read-only (viewer role, or the WS connect window): pan + select still
    // work, but never start a create/draw gesture (its writes would be dropped).
    if (!canWrite && isDrawTool(activeTool)) return

    if (activeTool === 'draw') {
      beginDrag({ kind: 'draw', points: [world] })
      return
    }

    if (isDrawTool(activeTool)) {
      beginDrag({ kind: 'create', tool: activeTool, world0: world, box: { x: world.x, y: world.y, width: 0, height: 0 }, headCorner: 'se' })
      return
    }

    // select tool: try a resize handle (single selection), then a shape, else a
    // rubber-band marquee. NOTE: the select tool never pans — that's the hand
    // tool / space / middle-click — so an empty drag selects instead of moving
    // the canvas.
    const handle = hitTestHandle(selectedShape, world, zoom)
    if (handle && selectedShape) {
      const b = shapeBox(selectedShape)
      beginDrag({ kind: 'resize', shapeId: selectedShape.id, client0: { x: e.clientX, y: e.clientY }, orig: b, corner: handle, box: b })
      return
    }

    const hitId = hitTestShapes(ordered, world, zoom)
    if (hitId) {
      // Shift-click toggles a shape in/out of the selection (no drag).
      if (e.shiftKey) {
        const next = selectedSet.has(hitId)
          ? selectedIds.filter((id) => id !== hitId)
          : [...selectedIds, hitId]
        setSelectedIds(next)
        return
      }
      // Dragging a shape already in a multi-selection moves the whole group;
      // otherwise the click selects just this shape and starts moving it.
      const moveIds = selectedSet.has(hitId) ? selectedIds : [hitId]
      if (!selectedSet.has(hitId)) setSelectedIds([hitId])
      const origs = new Map<string, Point>()
      for (const id of moveIds) {
        const s = shapes.find((sh) => sh.id === id)
        if (s) origs.set(id, { x: s.x, y: s.y })
      }
      beginDrag({ kind: 'move', origs, client0: { x: e.clientX, y: e.clientY } })
      return
    }

    // Empty space → start a marquee (shift keeps the current selection as a base
    // to add to). The selection is committed on pointer-up in `onUp`.
    beginDrag({
      kind: 'marquee',
      world0: world,
      box: { x: world.x, y: world.y, width: 0, height: 0 },
      additive: e.shiftKey,
      base: e.shiftKey ? selectedIds : [],
    })
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const world = screenToWorld(e.clientX, e.clientY)
    const hitId = hitTestShapes(ordered, world, zoom)
    if (!hitId) return
    const shape = shapes.find((s) => s.id === hitId)
    if (shape?.type === 'text') {
      setSelectedIds([hitId])
      setEditing({ id: hitId, value: (shape.props.text as string) ?? '' })
    }
  }

  // --- wheel: zoom toward cursor -------------------------------------------
  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    // Pure: derive the next zoom from the current props and set zoom + pan
    // independently (no setState-inside-setState, which double-applies under
    // React StrictMode). Keeps the cursor anchored while zooming.
    const nz = Math.min(Math.max(zoom * factor, 0.1), 8)
    if (nz === zoom) return
    setZoom(nz)
    setPan({ x: mx - (mx - pan.x) * (nz / zoom), y: my - (my - pan.y) * (nz / zoom) })
  }

  // --- save inline text edit -----------------------------------------------
  const commitEdit = useCallback(() => {
    if (!editing) return
    const shape = shapes.find((s) => s.id === editing.id)
    const text = editing.value
    setEditing(null)
    if (!shape) return
    if (text.trim() === '' && (shape.props.text ?? '') === '') {
      deleteShape(shape.id)
      setSelectedIds(selectedIdsRef.current.filter((id) => id !== shape.id))
      return
    }
    // The text write + the auto-fit resize are one user action → one undo step.
    beginGesture()
    updateShape(editing.id, { text })
    // Auto-size a free-text box to HUG its content on both axes: width = widest
    // line (so there's no dead space on the right), height = line count. Wrap
    // only kicks in past MAX_AUTO_TEXT_WIDTH. Bounded labels (fit:'shrink')
    // don't resize — they scale to fit their fixed box instead.
    if (shape.props.fit !== 'shrink') {
      const baseFont = (shape.props.fontSize as number) ?? 20
      const { width: fitWidth, height: fitHeight } = fitTextBox(text, baseFont)
      if (Math.abs(fitWidth - shape.width) > 1 || Math.abs(fitHeight - shape.height) > 1) {
        resizeShape(shape.id, fitWidth, fitHeight)
      }
    }
    endGesture()
  }, [editing, shapes, updateShape, resizeShape, deleteShape, setSelectedIds, beginGesture, endGesture])

  // --- cursor ---------------------------------------------------------------
  const cursor =
    drag?.kind === 'pan'
      ? 'grabbing'
      : activeTool === 'hand' || spaceDown
        ? 'grab'
        : isDrawTool(activeTool)
          ? 'crosshair'
          : 'default'

  const handleSize = 9 / zoom
  const dimBox: Box | null = drag?.kind === 'create' ? drag.box : drag?.kind === 'resize' ? drag.box : null

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ touchAction: 'none' }}>
      <svg
        ref={svgRef}
        data-testid="canvas-svg"
        className="h-full w-full select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMoveReport}
        onPointerLeave={onPointerLeaveReport}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      >
        {/* Background. The surface rect (pointer-events:all) is the single event
            target for the whole canvas; the grid overlay + shapes are
            non-interactive. The grid style follows the user's `background` pick. */}
        <CanvasGrid background={background} pan={pan} zoom={zoom} />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`} style={{ pointerEvents: 'none' }}>
          {ordered.map((shape) => (
            <Shape
              key={shape.id}
              shape={shape}
              isSelected={selectedSet.has(shape.id)}
              isEditing={editing?.id === shape.id}
            />
          ))}

          {activeTool === 'select' && selectedShape && drag?.kind !== 'move' && (
            <ResizeHandles shape={selectedShape} size={handleSize} zoom={zoom} />
          )}

          {drag?.kind === 'create' && <CreatePreview drag={drag} style={style} />}
          {drag?.kind === 'draw' && <DrawPreview points={drag.points} style={style} />}
          {drag?.kind === 'marquee' && <MarqueePreview box={drag.box} zoom={zoom} />}
        </g>
      </svg>

      {/* Live collaborator cursors — positioned in screen space from each
          peer's world-space cursor, with a name label underneath. */}
      <PeerCursors peers={peers} worldToScreen={worldToScreen} />

      {dimBox && <DimensionBadge box={dimBox} worldToScreen={worldToScreen} zoom={zoom} />}

      {!canWrite && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow">
          Connecting… (view-only until ready)
        </div>
      )}

      {editing && (() => {
        const shape = shapes.find((s) => s.id === editing.id)
        if (!shape) return null
        const p = worldToScreen({ x: shape.x, y: shape.y })
        const baseFont = (shape.props.fontSize as number) ?? 20
        const fontSize = baseFont * zoom
        // Grow the editor with its content (wrapping only at the cap) so it
        // tracks the box the text will commit to — no early wrap, no dead space.
        const { lines } = layoutText(editing.value || ' ', MAX_AUTO_TEXT_WIDTH - TEXT_BOX_PAD, Number.POSITIVE_INFINITY, baseFont)
        const contentW = Math.min(MAX_AUTO_TEXT_WIDTH, Math.max(60, maxLineWidth(lines, baseFont) + 16))
        return (
          <textarea
            data-testid="text-editor"
            autoFocus
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              // Enter (no shift) / Escape commit by blurring, so commitEdit runs
              // exactly once via onBlur — not here AND again on the unmount blur.
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            className="font-hand absolute resize-none overflow-hidden border-none bg-transparent p-0 leading-tight outline-none"
            style={{
              left: p.x,
              top: p.y,
              width: contentW * zoom,
              color: (shape.props.stroke as string) ?? 'var(--color-foreground)',
              fontSize,
              caretColor: 'var(--color-primary)',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
            placeholder="Type…"
          />
        )
      })()}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Canvas background: the always-present surface rect (the single pointer-event
 * target) plus an optional grid overlay — dotted, lined, or nothing ("solid").
 * Patterns are offset by the pan so the grid scrolls with the content.
 */
function CanvasGrid({ background, pan, zoom }: { background: CanvasBackground; pan: Point; zoom: number }) {
  const fine = 26 * zoom
  const major = 130 * zoom
  return (
    <>
      <defs>
        {background === 'dots' && (
          <>
            <pattern id="grid-fine" width={fine} height={fine} patternUnits="userSpaceOnUse" x={pan.x % fine} y={pan.y % fine}>
              <circle cx={1} cy={1} r={1} fill={CANVAS_COLORS.gridFine} opacity={0.32} />
            </pattern>
            <pattern id="grid-major" width={major} height={major} patternUnits="userSpaceOnUse" x={pan.x % major} y={pan.y % major}>
              <circle cx={1} cy={1} r={1.6} fill={CANVAS_COLORS.gridMajor} opacity={0.4} />
            </pattern>
          </>
        )}
        {background === 'lines' && (
          <>
            <pattern id="grid-fine" width={fine} height={fine} patternUnits="userSpaceOnUse" x={pan.x % fine} y={pan.y % fine}>
              <path d={`M ${fine} 0 L 0 0 0 ${fine}`} fill="none" stroke={CANVAS_COLORS.gridFine} strokeWidth={1} opacity={0.22} />
            </pattern>
            <pattern id="grid-major" width={major} height={major} patternUnits="userSpaceOnUse" x={pan.x % major} y={pan.y % major}>
              <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke={CANVAS_COLORS.gridMajor} strokeWidth={1} opacity={0.32} />
            </pattern>
          </>
        )}
      </defs>
      <rect data-testid="canvas-bg" width="100%" height="100%" fill={CANVAS_COLORS.surface} style={{ pointerEvents: 'all' }} />
      {background !== 'solid' && (
        <>
          <rect width="100%" height="100%" fill="url(#grid-fine)" style={{ pointerEvents: 'none' }} />
          <rect width="100%" height="100%" fill="url(#grid-major)" style={{ pointerEvents: 'none' }} />
        </>
      )}
    </>
  )
}

function PeerCursors({
  peers,
  worldToScreen,
}: {
  peers: PresencePeerClient[]
  worldToScreen: (p: Point) => Point
}) {
  return (
    <>
      {peers.map((p) => {
        const cursor = p.state.cursor as { x: number; y: number } | undefined
        if (!cursor || typeof cursor.x !== 'number' || typeof cursor.y !== 'number') return null
        const s = worldToScreen(cursor)
        const color = getUserColor(p.userId)
        return (
          <div
            key={p.userId}
            className="pointer-events-none absolute z-20 will-change-transform"
            style={{ left: s.x, top: s.y, transform: 'translate(-2px, -2px)' }}
          >
            <MousePointer2
              className="h-[18px] w-[18px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
              style={{ color, fill: color }}
              strokeWidth={1.5}
            />
            <span
              className="absolute left-3.5 top-4 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {p.userName || p.userEmail || 'Guest'}
            </span>
          </div>
        )
      })}
    </>
  )
}

function ResizeHandles({ shape, size, zoom }: { shape: CanvasShapeClient; size: number; zoom: number }) {
  const b: Box = { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
  const corners: Corner[] = ['nw', 'ne', 'sw', 'se']
  return (
    <>
      {corners.map((c) => {
        const p = cornerPoint(b, c)
        return (
          <rect
            key={c}
            x={p.x - size / 2}
            y={p.y - size / 2}
            width={size}
            height={size}
            rx={size / 4}
            fill="#ffffff"
            stroke="var(--color-primary)"
            strokeWidth={1.5 / zoom}
          />
        )
      })}
    </>
  )
}

function MarqueePreview({ box, zoom }: { box: Box; zoom: number }) {
  return (
    <rect
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      fill="var(--color-primary)"
      fillOpacity={0.08}
      stroke="var(--color-primary)"
      strokeWidth={1.5 / zoom}
      strokeDasharray={`${4 / zoom} ${3 / zoom}`}
    />
  )
}

function CreatePreview({ drag, style }: { drag: Extract<Drag, { kind: 'create' }>; style: ShapeStyle }) {
  const b = drag.box
  const stroke = style.stroke
  const common = {
    fill: 'transparent',
    stroke,
    strokeWidth: 3,
    strokeDasharray: '6 4',
    vectorEffect: 'non-scaling-stroke' as const,
  }
  if (drag.tool === 'rect' || drag.tool === 'text') {
    return <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={6} {...common} />
  }
  if (drag.tool === 'ellipse') {
    return <ellipse cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} {...common} />
  }
  if (drag.tool === 'diamond') {
    return (
      <polygon
        points={`${b.x + b.width / 2},${b.y} ${b.x + b.width},${b.y + b.height / 2} ${b.x + b.width / 2},${b.y + b.height} ${b.x},${b.y + b.height / 2}`}
        {...common}
      />
    )
  }
  if (isPolygonShape(drag.tool)) {
    return <polygon points={polygonPoints(drag.tool, b).map((p) => `${p.x},${p.y}`).join(' ')} {...common} />
  }
  const end = cornerPoint(b, drag.headCorner)
  const start = cornerPoint(b, oppositeCorner(drag.headCorner))
  return <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...common} strokeLinecap="round" />
}

function DrawPreview({ points, style }: { points: Point[]; style: ShapeStyle }) {
  if (points.length === 0) return null
  return (
    <path
      d={pointsToPath(points)}
      fill="none"
      stroke={style.stroke}
      strokeWidth={style.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  )
}

function DimensionBadge({ box, worldToScreen, zoom }: { box: Box; worldToScreen: (p: Point) => Point; zoom: number }) {
  const p = worldToScreen({ x: box.x + box.width / 2, y: box.y + box.height })
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground shadow"
      style={{ left: p.x, top: p.y + 10 }}
    >
      {Math.round(box.width)} × {Math.round(box.height)}
      <span className="ml-1 opacity-60">{Math.round(zoom * 100)}%</span>
    </div>
  )
}
