# Loop 1 plan — Canvas AI tool logic (pure, fully unit-tested)

> **For the implementing agent:** This is a `/loop` task. Read this whole file,
> write the one-line brief, then run the Builder→Checker loop until `ALL GREEN`
> or a stop rule fires (see `CLAUDE.md` → "Loop stop rules"). A run report is
> written to `docs/loop-runs/` automatically. **Do not** weaken a check to go
> green. **Do not** start Loop 2 — this loop is pure logic + tests only.

---

## Goal (one sentence)

Add the pure, side-effect-free logic that turns an AI assistant's tool
arguments into valid canvas shape operations (create / edit / delete), plus the
context + system-prompt helpers the assistant needs — all covered by unit tests.
**No wiring into the chat stream or the canvas in this loop.**

## Why this is Loop 1

This is the richest-checked, lowest-risk slice: every function here is pure
(args in → value out, no I/O), so unit tests give a real pass/fail signal. The
network wiring and the client/server plumbing live in Loop 2, where the checks
are thinner. Get the logic provably correct first.

---

## Background the implementing agent needs

- The AI chat backend already exists: `src/ai/chat-routes.ts` (streamed turn,
  `streamText({ tools, stopWhen: stepCountIs(5) })`) and `src/ai/tools.ts`
  (record-CRUD tools via an allowlist). **Canvas drawing does not exist yet.**
- Canvas shapes are NOT records. They live in a Yjs-backed `CanvasRoom` DO,
  edited client-side via `useCanvas(docId)` →
  `{ shapes, addShape, moveShape, resizeShape, deleteShape, updateShape, ... }`.
- A shape on the client is `CanvasShapeClient`. Confirmed fields from
  `src/components/canvas/ShapeRenderer.tsx`:
  `{ id, type: 'rect' | 'ellipse' | 'line' | 'text', x, y, width, height,
  props: { fill?, stroke?, strokeWidth?, ... } }`.
  **Verify the exact type** in `node_modules/deepspace/dist/index.d.ts`
  (`CanvasShapeClient`) and the `addShape` / `updateShape` signatures before
  finalizing field names — do not guess.
- Renderer defaults (match these so AI shapes look like hand-drawn ones, see
  `ShapeRenderer.tsx:18-20`): `fill = 'transparent'`, `stroke = '#6366f1'`,
  `strokeWidth = 2`.

## Architecture this logic must serve (decided; Loop 2 implements it)

The canvas tools will have a **server-side `execute` that only validates and
normalizes** the shape and returns it as the tool result (so the model's
multi-step agentic loop keeps working). The **client** separately watches the
tool-call stream and applies each op to `useCanvas`, so shapes render live and
sync to all users. That means the pure functions below are used on BOTH sides —
which is exactly why they belong in their own tested module.

---

## Files to create

### 1. `src/ai/canvas-shape.ts` — pure shape logic (no imports from `deepspace/worker` runtime; types only)

Export:

- `type CanvasShapeType = 'rect' | 'ellipse' | 'line' | 'text'`
- `interface ShapeCreateInput { type: CanvasShapeType; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; strokeWidth?: number; text?: string }`
- `interface ShapeEditInput { x?: number; y?: number; width?: number; height?: number; fill?: string; stroke?: string; strokeWidth?: number; text?: string }`
- `interface NormalizedShape { type: CanvasShapeType; x: number; y: number; width: number; height: number; props: Record<string, unknown> }`
- `const SHAPE_DEFAULTS = { fill: 'transparent', stroke: '#6366f1', strokeWidth: 2 } as const`
- `function normalizeCreate(input: ShapeCreateInput): NormalizedShape` — apply defaults, coerce numbers, put fill/stroke/strokeWidth/text under `props`. **Throws** a descriptive `Error` on invalid input (see validation rules).
- `function normalizeEdit(input: ShapeEditInput): { x?; y?; width?; height?; props?: Record<string, unknown> }` — produce a partial patch; only includes keys actually provided; validates any provided numbers.
- `function validateShapeType(t: unknown): asserts t is CanvasShapeType` (or a boolean predicate `isCanvasShapeType`).

Validation rules (assert and unit-test all of them):
- `type` must be one of the four; otherwise throw `Invalid shape type: <t>`.
- `x`, `y` must be finite numbers.
- `width`, `height` must be finite numbers `> 0`; throw on `<= 0` or `NaN`.
- Unknown/extra fields are ignored, not echoed into `props`.
- For `type === 'text'`, `text` (string) is carried into `props.text`; for other
  types `text` is ignored.

### 2. `src/ai/canvas-tools.ts` — tool definitions + context/prompt helpers

Export:

- `function buildCanvasTools(executor): ToolSet` — mirrors `buildTools` in
  `tools.ts`. Defines these tools with `zod` `inputSchema` (use `tool()` from
  the `ai` package, same as `tools.ts`):
  - `canvas_createShape` — input matches `ShapeCreateInput`.
  - `canvas_updateShape` — input `{ shapeId: string } & ShapeEditInput`.
  - `canvas_deleteShape` — input `{ shapeId: string }`.
  - `canvas_listShapes` — no input (returns the current shapes the executor was
    given as context).
  Each tool's `execute` calls the passed-in `executor(toolName, params)` — the
  executor itself is injected (server passes a validate-only executor; the unit
  test passes a mock). Tool names use underscores (no dots), like `tools.ts`.
- `function buildCanvasSystemPrompt(ctx: CanvasContext): string` — pure. Given
  the current canvas context (doc id, list of shapes with id/type/x/y/w/h, and
  the set of selected shape ids), produce a concise instruction block telling
  the model: it can create/edit/delete shapes; the coordinate space; what is
  currently selected ("the user has highlighted shapes X, Y — prefer operating
  on these when the request is about 'this'/'the selected'"); and the available
  shape types + default style.
- `interface CanvasContext { docId: string; shapes: Array<{ id: string; type: string; x: number; y: number; width: number; height: number }>; selectedShapeIds: string[] }`
- `function summarizeCanvasForPrompt(ctx: CanvasContext): string` — the compact
  textual summary embedded by `buildCanvasSystemPrompt` (split out so it's
  independently testable).

> Keep `canvas-tools.ts` free of any worker-runtime import that touches
> Cloudflare globals. It may import `tool` from `ai` and `z` from `zod` (both
> already deps) and types from `./canvas-shape`.

### 3. `src/ai/canvas-shape.test.ts` and `src/ai/canvas-tools.test.ts` — the unit tests

Use the existing `vitest.config.ts` (plain Node). Import helpers explicitly
from `vitest` (it is NOT in tsconfig `types`). Model them on the existing
`src/ai/tools.test.ts`.

---

## Unit test cases (this list IS the definition of done)

`canvas-shape.test.ts`:

1. **normalizeCreate happy path** — a valid `rect` produces the right
   `type/x/y/width/height` and `props` containing the passed fill/stroke.
2. **normalizeCreate defaults** — omitting fill/stroke/strokeWidth yields
   `props.fill === 'transparent'`, `props.stroke === '#6366f1'`,
   `props.strokeWidth === 2`.
3. **normalizeCreate text shape** — `type: 'text'` with `text: 'hi'` puts
   `props.text === 'hi'`; a `rect` with a `text` field drops it.
4. **normalizeCreate validation** — throws on unknown `type`, on
   `width <= 0`, on `height <= 0`, on non-finite `x`/`y`.
5. **normalizeCreate ignores extra fields** — a stray `foo: 1` never appears in
   the output.
6. **normalizeEdit partial** — only provided keys are in the patch; an empty
   input yields an empty patch (`{}`), not defaults.
7. **normalizeEdit validation** — a provided `width: -5` throws; a provided
   `fill` with no numbers is accepted.

`canvas-tools.test.ts`:

8. **buildCanvasTools registers exactly the four tools** — keys are
   `canvas_createShape`, `canvas_updateShape`, `canvas_deleteShape`,
   `canvas_listShapes`; no key contains a dot.
9. **tool routes to executor** — calling `canvas_createShape.execute(input, {})`
   invokes the injected executor with `('canvas_createShape', input)` and
   returns its result (mirror the existing executor-routing test in
   `tools.test.ts`).
10. **buildCanvasSystemPrompt mentions selection** — given
    `selectedShapeIds: ['s1']`, the prompt text references `s1` and the word
    "selected"/"highlighted"; given an empty selection it does not fabricate one.
11. **summarizeCanvasForPrompt lists shapes** — output contains each shape's id
    and type; empty shapes → a clear "(empty canvas)" marker.

(Optionally add a zod-validation test: feed `canvas_createShape.inputSchema` a
bad payload and assert it rejects — confirm the parse API against the installed
`ai`/`zod` version before relying on a specific method name.)

---

## Definition of done

- `npm run test:unit` — all cases above pass.
- `npm run type-check` — clean (the test files are under `src`, so `tsc` checks
  them; keep them type-correct, no `any`-leaks that fail strict mode).
- `npm run lint` — clean.

## Explicitly OUT of scope for Loop 1

- Editing `src/ai/chat-routes.ts` or `src/ai/tools.ts`.
- Any client code, `useCanvas` calls, or React components.
- Registering AI chat schemas / installing the chat UI.
- Any actual canvas mutation or network call.

All of the above is Loop 2 (`docs/loop-2-canvas-ai-wiring-plan.md`).
