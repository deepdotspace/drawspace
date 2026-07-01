# AI → Canvas integration: test plan & loop split

This is the plan for building "the AI chat can create/edit shapes on the
canvas" using the build–check loop (`/loop`). Two parts:

1. How to structure unit tests for the **new** canvas tools (so the loop's
   `ALL GREEN` actually means "the logic is correct", not just "it compiles").
2. How to split the work into 2–3 bounded loops.

---

## Background: what exists today vs. what's new

- **Today**, `src/ai/tools.ts` exposes only *record* CRUD tools
  (`records.create`, `records.query`, …) via an allowlist. The AI can read and
  write rows in collections. It **cannot** touch the canvas.
- **Canvas shapes** are a different data path entirely: they live in a
  **Yjs-backed Canvas Durable Object**, edited on the client through the
  `useCanvas(docId)` hook (`addShape`, `moveShape`, `deleteShape`). They are
  NOT records. See `src/components/canvas/CanvasView.tsx`.
- A shape (`CanvasShapeClient`) looks like:
  `{ id, type: 'rect' | 'ellipse' | 'line' | 'text', x, y, width, height, props: { fill, stroke, strokeWidth } }`.

So "AI draws on the canvas" = **new tools** (e.g. `canvas_createShape`,
`canvas_updateShape`, `canvas_deleteShape`) whose executor writes into the
Canvas DO. None of that wiring exists yet.

---

## Part A — how to unit-test the new canvas tools

The golden rule: **separate the pure logic from the I/O.** The persistence
(writing to the Yjs DO) needs a live runtime and belongs in the Playwright e2e
suite. But the part that turns the model's arguments into a valid shape is a
**pure function** — fast, deterministic, and exactly what unit tests are for.

### 1. Extract a pure builder/validator

Put a function like this next to the tools (it must NOT import worker runtime):

```ts
// src/ai/canvas-shape.ts  (illustrative)
export type ShapeType = 'rect' | 'ellipse' | 'line' | 'text'

export interface ShapeInput {
  type: ShapeType
  x: number; y: number; width: number; height: number
  fill?: string; stroke?: string; strokeWidth?: number
}

// Pure: args in -> normalized shape (or throws a clear error). No I/O.
export function buildShape(args: ShapeInput): NormalizedShape { /* ... */ }
```

### 2. Test the behavior, not the implementation

Mirror `src/ai/tools.test.ts`. Cases worth covering:

- **Happy path** — valid `rect` args produce a shape with the right
  `type/x/y/width/height` and `props`.
- **Defaults** — omitted `fill`/`stroke`/`strokeWidth` fall back to the same
  defaults `ShapeRenderer` uses (`stroke '#6366f1'`, `strokeWidth 2`, etc.),
  so AI-made shapes look like hand-drawn ones.
- **Validation** — an unknown `type`, negative/zero `width`, or non-numeric
  coords are rejected with a clear error (the AI should get a useful message,
  not a silent bad shape).
- **Allowlist** — once the canvas tools are registered, extend the existing
  `buildTools` test: `canvas_createShape` is present, dots are underscored, and
  a tool call routes to the executor with the original dotted name.

### 3. What stays in e2e (NOT in the loop)

"Does the shape actually appear for both users in real time" needs the live
Canvas DO + a browser. Keep that in `tests/` (`deepspace test`) and run it as a
final manual gate after the loop is green — never inside the 5-cycle loop
(too slow, needs auth, flaky → would burn cycles).

---

## Part B — recommended loop split (max 3)

Principle for splitting ANY feature into loops: **each loop must be (1) bounded
enough to converge in ~5 build-fix cycles, and (2) backed by checks that can
actually verify it** (here: unit tests + types + lint). If a slice has no
meaningful check, it's an e2e/manual step, not a loop.

### Loop 1 — Canvas tool logic (pure, fully unit-tested)

- **Scope:** `src/ai/canvas-shape.ts` (the pure `buildShape`/validator) + its
  tests; register the new canvas tools in `src/ai/tools.ts`'s allowlist + tool
  builder.
- **Definition of done:** `test:unit` covers happy/defaults/validation/allowlist
  cases; types + lint clean.
- **Why first:** richest checks, so the loop is at its most reliable here. This
  is where you let it run unattended.

### Loop 2 — Wire tools to the Canvas DO + chat route

- **Scope:** the executor that takes a validated shape and writes it into the
  Yjs Canvas room; register the canvas tools in `src/ai/chat-routes.ts` so the
  assistant can call them.
- **Definition of done:** types + lint clean; unit tests for any pure
  serialization/mapping added here. (Cross-DO behavior is verified by e2e
  afterward, not in-loop.)
- **Note:** this slice is thinner on unit coverage by nature — keep it small so
  type-check + lint still give real signal, and lean on the e2e gate after.

### Loop 3 (optional) — Chat UI affordance / polish

- **Scope:** surface canvas actions in the chat panel, any model-picker or
  prompt tweaks.
- **Definition of done:** types + lint; component-level unit tests if logic
  warrants. Mostly visual → likely a manual check rather than a loop.

### After the loops: the manual graduation gate

Once Loops 1–2 are green, run the e2e suite once yourself:

```sh
npm run dev          # in one terminal
npm test             # smoke + api + e2e (needs the running server / auth)
```

This is the only step that proves the shape really lands on the canvas for a
real user. Keep it out of the automated loop on purpose.
