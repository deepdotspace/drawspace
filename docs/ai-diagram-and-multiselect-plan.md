# AI diagrams (C + D) + multi-select — implementation plan

## Goal

Turn the AI assistant from a "draw one shape per step" tool into something that
can build a **full diagram** (e.g. a system-design diagram) in a single agent
step, and let the user **drag-select multiple shapes** with the select (V) tool
instead of one at a time — without the select tool panning the canvas.

## Part C+D — structured diagram tool with auto-layout

The old bottleneck was `stopWhen: stepCountIs(5)` combined with the model
emitting one `canvas_createShape` per round-trip. A 3-node + 2-arrow flowchart
burned the whole budget. Two structural fixes:

1. **Batch / structured tools** so one tool call produces many shapes:
   - `canvas_createShapes({ shapes: [...] })` — N shapes in one call.
   - `canvas_drawDiagram({ nodes, edges, direction })` — an entire diagram in
     one call, positioned by an auto-layout engine.
2. **Auto-layout** (`src/ai/diagram-layout.ts`): the model describes the *graph*
   (nodes + edges), not pixel coordinates. A layered (rank-based) layout assigns
   each node to a layer via longest-path, orders/positions within the layer, and
   draws arrows between node anchors. The model never does coordinate math
   (which it is bad at and which causes overlaps).

Supporting changes:
- Expand the AI shape vocabulary (`canvas-shape.ts`) with `diamond` (decision)
  and `arrow` (connector) — the renderer (`Shape.tsx`) already draws both.
- `canvas-stream.ts` gains `toolCallToCanvasOps` returning an **array** of ops
  so one diagram tool call applies many shapes client-side (the client stays the
  single writer to `useCanvas`; the server executor remains validate-only).
- Raise `stepCountIs(5)` → `stepCountIs(12)` as headroom for multi-call turns.

### Layout summary

- Node size derived from label length (clamped). Nodes rendered as a container
  shape (rect/ellipse/diamond) plus a centered `text` label.
- `direction: 'TB'` (default) stacks layers top→bottom; `'LR'` left→right.
- Edges connect the source's leading-edge anchor to the target's trailing-edge
  anchor, encoded as an `arrow` (bbox + `headCorner`, matching the manual
  arrow/line model so move/resize keep working).
- Cycle-safe: ranking iterates at most `nodes.length` times.

## Part — multi-select with marquee

- Selection state becomes `selectedIds: string[]` end-to-end
  (`CanvasWorkspace` → `DrawCanvas`, `StylePanel`, `AiAssistant`).
- The select (V) tool's empty-canvas drag is now a **rubber-band marquee** that
  selects every shape intersecting the box — it no longer pans the canvas
  (panning stays on the hand tool / space / middle-click).
- Dragging an already-selected shape moves the **entire selection** together.
- Shift-click toggles a shape in/out of the selection; shift-marquee adds.
- Resize handles show only for a single-shape selection; all selected shapes get
  a selection outline. Style edits, delete, and duplicate act on all selected.
- `shapesInBox` (pure, in `hit-test.ts`) does the box-intersection test and is
  unit-tested.

## Files touched

| File | Change |
|---|---|
| `src/ai/canvas-shape.ts` | add `diamond`/`arrow` + `headCorner` |
| `src/ai/diagram-layout.ts` (+test) | new layered auto-layout |
| `src/ai/canvas-tools.ts` (+test) | `createShapes` + `drawDiagram` tools, prompt |
| `src/ai/canvas-executor.ts` (+test) | validate-only handlers for new tools |
| `src/ai/canvas-stream.ts` (+test) | `toolCallToCanvasOps` (array) |
| `src/ai/chat-routes.ts` | step cap 5→12 |
| `src/components/canvas/AiAssistant.tsx` | apply op arrays, `selectedShapeIds` |
| `src/components/canvas/hit-test.ts` (+test) | `shapesInBox` |
| `src/components/canvas/DrawCanvas.tsx` (+test) | marquee + multi-move |
| `src/components/canvas/CanvasWorkspace.tsx` | `selectedIds` plumbing |
