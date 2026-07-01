# Plan — Real delete + clean (non-overlapping) AI diagrams

Date: 2026-06-26
Scope: two independent fixes
1. **Delete actually erases canvas data** (today it orphans it).
2. **AI chat draws clean diagrams** — no overlapping shapes, no messy arrows.

The bulk of this plan (Part 2) is the AI-chat rework, which is the larger change.

---

## Part 1 — Delete: purge the canvas data, not just the record

### What happens today (verified in code)
- `CanvasWorkspace.handleDeleteCanvas` (`src/components/canvas/CanvasWorkspace.tsx:119`)
  calls `remove(id)` from `useMutations('canvases')`. That deletes **only the
  `canvases` metadata record** in the RecordRoom.
- The actual drawing (shapes/strokes/Yjs doc) lives in the **`CanvasRoom`
  Durable Object** keyed by `docId` (= the record id). See `worker.ts:562`
  (`/ws/canvas/:docId`) and the `AppCanvasRoom` class (`worker.ts:54`).
- **Nothing deletes the CanvasRoom DO storage.** The SDK `CanvasRoom` class
  exposes no clear/purge route (`node_modules/deepspace/dist/worker.d.ts:1611`).

### So: is it a real delete or just a UI delete?
Both, partially:
- **From the user's view it is gone and unreachable.** No record → no sidebar
  entry → no way to open it. The realtime route fails *closed*: once the record
  is missing, `resolveCanvasRole` returns `null` and `/ws/canvas/:docId` 403s
  (`worker.ts:526-585`). So another user can't reach it either.
- **But the data is never erased.** All shapes remain in the CanvasRoom DO
  storage forever — orphaned. It's a storage leak and a "deleted data still
  physically exists" privacy gap. The user's instinct ("lost memory users can
  no longer retrieve") is correct: unrecoverable through the UI, yet not deleted.

### Fix — soft delete + Trash + scheduled hard purge (chosen model)
A drawing is painful to lose by accident, so deletion is a **soft delete** with a
recoverable Trash, and a cron job hard-purges (record **+ CanvasRoom DO storage**)
after a retention window. This gives both an undo safety net and real cleanup.

Verified SDK facts that shape the implementation:
- The CanvasRoom stores shapes in a SQLite table `canvas_state` via `this.sql`
  (`worker.js:3600-3631`); `BaseRoom` exposes `protected state`/`sql`/`env`
  (`worker.d.ts:911-914`). A subclass can wipe it with
  `this.state.storage.deleteAll()`.
- Undo/redo is ephemeral per-session memory (`worker.js:3589`, cleared on
  disconnect) — NOT recovery history, so it has no bearing here.

1. **Schema** (`canvas-schema.ts`): add a `deletedAt` text column (empty/unset =
   live). Boards with a non-empty `deletedAt` are "in Trash".
2. **Soft delete / restore are client-only `put`s** (no worker route needed):
   - Delete → `put(id, { deletedAt: <ISO now> })`.
   - Restore → `put(id, { deletedAt: '' })`.
3. **Hard purge route** `DELETE /api/canvas/:docId` in `worker.ts`:
   - resolve auth → load the `canvases` record → authorize (owner, app-owner, or
     admin — mirrors the schema delete rule),
   - delete the record (app-action tools) **and** `POST /__purge` the CanvasRoom
     DO stub for that `docId`.
4. **`AppCanvasRoom` purge handler** (`worker.ts`): override `fetch` to handle
   `POST /__purge` → `await this.state.storage.deleteAll()` → `204`; delegate
   everything else to `super.fetch`.
5. **Shared purge module** `src/canvas-purge.ts` (type-only import of `Env`, so
   no runtime cycle with worker.ts): `isCanvasExpired(deletedAt, nowMs)` (pure,
   unit-tested), `hardDeleteCanvas(env, docId)`, `runCanvasPurgeSweep(env,
   nowMs)`. Used by BOTH the route and the cron task.
6. **Cron** (`cron.ts`): a daily `purge-trash` task → `runCanvasPurgeSweep`
   hard-deletes every board whose `deletedAt` is older than the retention
   window (30 days).
7. **Client UI**:
   - `CanvasWorkspace`: filter the active board list to **live** boards
     (`!deletedAt`); `handleDeleteCanvas` soft-deletes; add `handleRestore` and
     `handleDeleteForever` (calls the route).
   - `CanvasSidebar`: a collapsible **Trash** section listing soft-deleted
     boards with **Restore** and **Delete forever** actions; hidden when empty.
8. Presence room `canvas:${id}` is in-memory only — no cleanup needed.

### Tests
- Pure unit test (`canvas-purge.test.ts`): `isCanvasExpired` — unset/empty →
  false; recent → false; older than retention → true; malformed → false.
- Pure unit test: the live/trash partition helper splits a list correctly.
- (Worker-level delete/authz + DO-wipe assertions belong in the e2e suite
  `tests/api.spec.ts`, which needs a live server — out of scope for the fast
  checker loop, noted for manual `deepspace test`.)

---

## Part 2 — AI chat: clean, non-overlapping diagrams

### Symptom (user report)
"The AI chat constantly creates blocks that overlap each other and a messy blob;
arrows are messy." Need: generated shapes never overlap, arrows aren't tangled.

> **Reviewed by two independent Opus agents (2026-06-26). Verdict: the original
> draft was only a *partial* fix and sequenced the least-impactful change first.
> This section has been rewritten with their findings. Key corrections are
> marked `[REVIEW]`.**

### Where the mess actually comes from (corrected)
`[REVIEW]` **`canvas_drawDiagram` already cannot overlap node boxes** — `placeNodes`
lays nodes on a grid (`diagram-layout.ts:116-147`: layers step by
`NODE_HEIGHT + GAP_MAIN`, within-layer nodes by `GAP_CROSS`). So the reported
"overlapping blobs" are **not** coming from the diagram path. They come from,
in order of real-world impact:

1. **Hand-placed `canvas_createShapes` / `canvas_createShape` (dominant).** The
   model builds a "diagram" out of boxes + connector arrows instead of calling
   `canvas_drawDiagram`. `deoverlapShapes` separates the boxes but **never moves
   `line`/`arrow`** (`shape-layout.ts:23`), so arrows are orphaned → this one
   path explains BOTH halves of the complaint (boxes that were stacked + messy
   arrows).
2. **Cross-turn AND within-turn stacking.** Fixed origin `(80,80)`
   (`diagram-layout.ts:242`) + no awareness of existing shapes → every diagram
   and batch lands in the same place.
3. **Diagram crossings (least impactful).** Within the diagram path, arrows can
   cross because there's no within-layer ordering. Real, but secondary.

### Root causes (verified in code)

**RC1 — New content ignores what's already on the canvas.**
- `layoutDiagram` hardcodes `origin = { x: 80, y: 80 }`
  (`src/ai/diagram-layout.ts:242`). **Every** diagram is drawn at the same
  top-left, so a second `canvas_drawDiagram` lands directly on top of the first.
- `deoverlapShapes` only de-collides **within a single batch**
  (`src/ai/shape-layout.ts`); it never reads `ctx.shapes` (existing canvas), so
  a new `canvas_createShapes` batch overlaps existing shapes.
- Net effect: the first reply may look OK; "now add …" piles a new blob on top.

**RC2 — Diagram layout has no edge routing or crossing reduction.**
- No virtual/dummy nodes: an edge spanning more than one rank is a straight
  diagonal that cuts **through** the boxes in the intervening layers
  (`layoutDiagram` connects `exitAnchor`→`entryAnchor` directly,
  `diagram-layout.ts:251-258`).
- No within-layer ordering (barycenter) — nodes keep spec order, so arrows
  between layers cross each other heavily.
- Same-rank edges and back-edges (cycles) produce near-zero-height/diagonal
  arrows that read as noise (`computeRanks` is cycle-capped but edges aren't
  re-routed).

**RC3 — Hand-placed batches: de-overlap moves boxes but NOT their arrows.**
- `deoverlapShapes` never moves `line`/`arrow` (by design, `shape-layout.ts:23`).
  So when the model hand-builds a diagram via `canvas_createShapes` (boxes +
  connector arrows in one batch), separating the boxes leaves the arrows
  pointing into empty space → "messy arrows."

**RC4 — The tool surface lets the model hand-build diagrams.**
- `canvas_createShape(s)` accept `arrow`/`line` types, and the prompt only
  *encourages* `canvas_drawDiagram`. The model often hand-places connected
  structures and hits RC3.

**RC5 `[REVIEW]` — Singular `canvas_createShape` has NO protection at all.**
- `toolCallToCanvasOps` only special-cases `canvas_createShapes` and
  `canvas_drawDiagram`; singular `canvas_createShape` falls through to
  `toolCallToCanvasOp` (`canvas-stream.ts:151-154`) with **no `deoverlapShapes`
  and no placement.** Models frequently emit N separate `createShape` calls
  (ignoring the "batch" guidance), each with zero collision protection. The
  original draft missed this path entirely.

### Design principle
**Never trust the model for pixel coordinates.** Positioning and routing must be
done by deterministic, unit-tested code. The model only describes *structure*
(nodes + edges) or *intent*; placement is ours.

### Proposed changes

> **`[REVIEW]` Reframed guarantee.** Only the `canvas_drawDiagram` path can
> *guarantee* non-overlap (it's grid-placed by construction). For
> `createShapes`/`createShape`, arrows are **best-effort** — we do NOT promise
> "arrows never tangled" while the renderer only draws straight arrows (see
> Fix B). The plan's job is to remove the *common* mess, not prove a theorem.

#### Fix C (do FIRST) — Keep hand-placed connectors attached (kills RC3, the dominant cause)
`[REVIEW]` This is the change most directly tied to the symptom, so it leads.
The original draft's "translate one endpoint by the body's net displacement" is
**unsafe**: an `arrow` is a bbox + `headCorner` (not two free endpoints), and
`deoverlapShapes` moves the two boxes a connector joins by **different**
amounts/directions (`shape-layout.ts:75-96`), so moving one end would need a
full bbox + `headCorner` recompute (incl. corner-flip when tail passes head).

Two acceptable implementations — pick in code review:
- **(Preferred, simplest, safe) Translate connector batches as a unit.** If a
  `canvas_createShapes` batch contains any `line`/`arrow` connecting bodies,
  detect it as "diagram-shaped" and **do not differentially de-overlap** it —
  translate the whole batch as one rigid group into free space (Fix A). Arrows
  stay attached because nothing moves *relative* to anything. Hand the genuine
  layout job to `drawDiagram` via Fix D.
- **(If we keep differential de-overlap)** Fully specify per-endpoint
  nearest-body assignment AND bbox+`headCorner` recompute, with a unit test for
  the corner-flip case. Higher risk; only if the unit-translate option proves
  insufficient.

#### Fix D (do FIRST, alongside C) — Steer the model to structure-first (reduces RC4/RC5)
In `src/ai/canvas-tools.ts` (`buildCanvasSystemPrompt`):
- Make it a **hard rule**: *anything with connecting arrows MUST use
  `canvas_drawDiagram`; never hand-place arrows/lines between boxes with
  `canvas_createShapes`/`canvas_createShape`. Never emit multiple separate
  `canvas_createShape` calls — batch with `canvas_createShapes`.*
- Keep `createShapes` for genuinely loose/unconnected shapes only.
- Do NOT remove `arrow`/`line` from the schema (freehand connectors are a
  legitimate manual feature; Fix C is the guard for AI misuse).

#### Fix A (do SECOND) — Place new content in free space, via a turn-local accumulator (kills RC1)
`[REVIEW] The original "read existing from `useCanvas` at apply time" does NOT
work.` Ops are applied synchronously inside the SSE read loop
(`AiAssistant.tsx:221-230`), but `addShape` flows through `useOptimisticCanvas`
straight to Yjs and only updates React `shapes`/`shapesRef` **asynchronously**
on a later render. A single turn can fire up to **12** tool calls
(`chat-routes.ts:330`, `stepCountIs(12)`), so every batch in the turn would read
the **same stale snapshot** and self-stack — reintroducing the blob *within one
reply*. Correct design:

- Maintain a **turn-local placed-bounding-box accumulator**. Seed it from the
  live `shapes` once at `send()` start. After each tool call, append the boxes
  it just placed.
- Change `toolCallToCanvasOps(toolName, input)` →
  `toolCallToCanvasOps(toolName, input, placedBoxes?)` (optional, default empty
  → **keep `(80,80)` origin** so existing `canvas-stream.test.ts` /
  `diagram-layout.test.ts` stay green).
- Compute **one** origin per tool call from `union(seeded existing, shapes
  placed earlier this turn)` — never per-shape, never re-read from `useCanvas`
  mid-turn.
- `canvas_drawDiagram`: lay out locally, then translate the whole diagram below
  that union bbox (`maxY + GAP`, left-aligned). Empty → `(80,80)`.
- `canvas_createShapes`: after intra-batch `deoverlapShapes` (or the unit
  translate from Fix C), offset the whole batch past the union bbox.
- `canvas_createShape` (RC5): route singular creates through the **same**
  accumulator/placement so N singular creates don't stack.

#### Fix A-viewport (do SECOND, REQUIRED — not optional) — scroll to the new content
`[REVIEW]` There is no programmatic pan/zoom-to-bounds in the canvas today
(`DrawCanvas.tsx` exposes none). If we place new content below everything, the
user asks the AI to draw, it "succeeds," and they see a **blank viewport** →
concludes it's broken. After a turn finishes placing shapes, **scroll/zoom the
canvas to the new content's bounding box** (via `setViewport` from `useCanvas`).
Without this, Fix A makes the feature *feel* worse, not better.

#### Fix B (do LAST) — Cheap diagram routing polish only (RC2, secondary)
`[REVIEW]` Scope cut to the cheap, pure half. The dummy-node / elbow-polyline
ambition is **dropped this pass** (see arrow-primitive answer below).
In `src/ai/diagram-layout.ts`:
- **Barycenter crossing reduction**: order nodes within each layer by the median
  position of their neighbors in the adjacent layer; a few down/up sweeps. Pure,
  cheap, biggest crossing win for the diagram path.
- **Side-aware anchors**: pick exit/entry anchors on the faces pointing toward
  each other so arrows don't emit from a face pointing away.
- Do **not** add virtual nodes or elbow routing now (renderer can't draw them).

### `[REVIEW]` Arrow primitive — open question now ANSWERED
The canvas `arrow` is **straight-only**: `Shape.tsx` (`LineOrArrow`) renders a
single `<line>` between two bbox corners; the shape is `bbox + headCorner`
(4-value enum, `types.ts`/`canvas-shape.ts`). There is **no points array / no
polyline support** in the renderer. Therefore:
- Clean orthogonal/elbow routing is **out of scope this pass** — it requires
  changing `Shape.tsx` (render), plus hit-testing and resize.
- Skip-rank and back edges will remain straight diagonals even after Fix B. We
  accept this for now; Fix D (push connected work to `drawDiagram`) + barycenter
  keeps the *common* cases clean.
- **Follow-up (separate plan):** add `props.points` polyline rendering to
  `LineOrArrow` + emit dummy-node-routed elbow arrows from `layoutDiagram`. This
  is the real fix for multi-rank arrow clutter; do it only if users still
  complain after this pass.

### Tests (Part 2)
- `diagram-layout`: representative graphs (chain, tree, diamond, multi-rank
  edge, cycle) → **no two node bboxes overlap**; arrow endpoints touch the
  correct node anchors. (Assert relative order / crossing-count, NOT exact
  coordinates — current tests check order, keep that style.)
- Barycenter: a known crossing case has fewer crossings (by a crossing-count
  metric) after ordering than naive spec order.
- Free-space placement: with seeded existing boxes AND a within-turn
  accumulator, **two consecutive tool calls in one turn** do not overlap each
  other or the seed. `[REVIEW]` This must exercise the apply-loop accumulator,
  not just pass a fixed `existing` into the pure function — a pure-only test
  would go green while the live app still stacks (false "all green").
- `deoverlapShapes` / Fix C: a batch of boxes + connector arrows keeps arrows
  attached to their boxes after layout.
- All existing `src/ai/*.test.ts` stay green (the new `placedBoxes` arg must be
  optional with empty default).

### `[REVIEW]` Rollout / sequencing (REORDERED — symptom-first)
1. **Fix C** (reattach/unit-translate connectors) + **Fix D** (prompt hardening)
   — kills the dominant hand-placed-mess cause; cheap and pure.
2. **Fix A** (turn-local accumulator placement, incl. singular RC5) +
   **Fix A-viewport** (scroll-to-new-content) — kills cross-turn AND within-turn
   stacking. Viewport is required, not optional.
3. **Fix B** (barycenter + side-aware anchors only) — diagram-path polish.

**Cut / deferred:** dummy-node + elbow-polyline routing (needs a renderer
change); pinned-obstacle de-overlap for batches referencing existing ids
(whole-batch translate is enough for the reported bug).

### Stop conditions / risks
- Straight-only arrows mean skip-rank arrows stay imperfect; accepted, flagged
  as a renderer follow-up.
- "Place below everything" grows the canvas tall; mitigated by Fix A-viewport
  (scroll-to-content) and acceptable otherwise.
- Fix C differential-endpoint variant is a correctness trap — prefer the
  unit-translate variant.
