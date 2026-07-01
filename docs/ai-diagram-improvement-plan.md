# Plan: Fix the Drawspace AI agent (clean diagrams, planning phase, calmer chat UX)

## Goal

When a user types "draw me a system design diagram," the agent should produce a
**clean, readable diagram** — boxes that don't overlap, arrows that don't cut
through boxes — after briefly **planning** what it's going to draw, and the chat
should show a **calm "working" indication** instead of a running list of "added
one block / edited one block."

---

## 1. Diagnosis — why diagrams come out messy today

I read the whole pipeline (`src/ai/*`, `src/components/canvas/*`). The current
system is already sophisticated: a `canvas_drawDiagram` tool feeds a hand-rolled
layered (Sugiyama-style) layout engine (`diagram-layout.ts`), with a de-overlap
safety net (`shape-layout.ts`) and a clean validate-on-server / apply-on-client
architecture. So the problem is **not** "it has no layout." The problems are:

### Root cause A — the connector primitive can only draw a straight diagonal line (the big one)
`Shape.tsx`'s `LineOrArrow` renders an arrow as **one straight segment from a
bbox corner to the opposite corner** (`headCorner`). There are **no waypoints,
no elbow/orthogonal routing**. Consequences:
- Any edge spanning more than adjacent layers, or between nodes that aren't
  vertically stacked, is drawn as a diagonal that **slices through whatever
  boxes sit between its endpoints**.
- The layout engine's `faceAnchor` helps the arrow *leave* the right side, but
  the line still goes corner-to-corner in a straight shot.

**No prompt can fix this** — the drawing primitive itself cannot bend. The
freehand `draw` shape already stores a `props.points` polyline and renders it,
so a bendable connector is clearly feasible in this codebase.

### Root cause B — the layout engine lacks long-edge handling and real edge routing
`diagram-layout.ts` ranks nodes and reduces crossings well, but:
- It does **not insert dummy nodes** for edges that skip layers (textbook
  Sugiyama does), so a rank-0→rank-3 edge is one straight diagonal across two
  layers of boxes.
- Edges are never routed through the empty channels between layers.
- Edge labels (`edgeLabel`) are dropped at the segment midpoint with a crude
  offset and routinely land on top of boxes/arrows.

### Root cause C — the model often hand-builds instead of using `drawDiagram`
When the model emits `canvas_createShapes` + its own arrows (common for "system
design," which has groupings the diagram tool can't express), the
`isHandBuiltDiagram` branch in `canvas-stream.ts` **skips de-overlap** and only
translates the batch — so the model's bad pixel coordinates survive untouched.
The prompt pushes hard toward `drawDiagram`, but models still defect because
`drawDiagram` can't express containers/groups/lanes.

### Root cause D — one diagram split across multiple tool calls gets stacked apart
`placeInFreeSpace` tucks each new batch **below** existing content. If the model
makes two calls intending one picture, they're stacked vertically and any
relationship between them breaks.

### Root cause E — the model is blind within a turn (no feedback to self-correct)
The validate-only executor returns `{ created: N }` — never the final
coordinates (which the client further shifts via `placeInFreeSpace`/`deoverlap`).
So within a single "draw X" turn the model cannot see overlaps and fix them.

### Root cause F — no planning phase
The model jumps straight to tool calls; for anything non-trivial it benefits
from first deciding the node/edge set, direction, and grouping.

---

## 2. The plan (phased, highest-leverage first)

### Phase 1 — Bendable (elbow/orthogonal) connectors  ★ biggest visual win
The single change that most reduces "messy lines."

1. **Extend the shape model.** Let `arrow`/`line` carry an optional
   `props.points: Point[]` (bbox-relative waypoints, same convention as the
   freehand `draw` shape). When absent, keep today's corner-to-corner behavior
   (fully backward compatible with hand-drawn and existing arrows).
2. **Render polylines.** In `Shape.tsx`'s `LineOrArrow`, if `points` is present,
   draw an SVG polyline through them and place the arrowhead on the **last
   segment**. Reuse the existing freehand bbox→points scaling so the connector
   moves/resizes correctly.
3. **Hit-testing.** Update `hit-test.ts` so a polyline arrow is selectable along
   each segment (it already has `distToSegment`).
4. **Layout emits routed edges.** `diagram-layout.ts` produces **orthogonal
   (Manhattan) waypoints** that travel down the channel between layers and only
   turn into a node's face — never crossing a box.

**Surfaces the original plan missed (caught in review — all confirmed):**
- **`export.ts` must also render polylines.** `export.ts`'s `lineOrArrowElement`
  is an *independent* corner-to-corner SVG serializer; without updating it,
  routed arrows export as straight lines. Add it to the file list.
- **`hit-test.ts` must iterate per-segment.** It has `distToSegment` but tests
  only one start→end segment today; a polyline needs each segment checked.
- **Waypoints are layout-engine-only, not model-authored.** `createShapeSchema`
  has no `points` field; leave it that way so the model can't hand-author broken
  polylines — only `diagram-layout.ts` emits routed connectors.
- **Optimistic overlay compares `props` by reference** (`optimistic-canvas-core`):
  fine for create-once arrows, but any future in-place waypoint *edit* must
  allocate a fresh `props` object or the overlay won't evict.
- **Keep the pure `layoutDiagram` running server-side** (the validate-only
  executor) for shape-count parity with the client.

*Files:* `canvas-shape.ts`, `Shape.tsx`, `hit-test.ts`, `export.ts`,
`diagram-layout.ts`, plus updating `diagram-layout.test.ts` / `export.test.ts`
(routed coords change asserted values — **update, never weaken**, per repo loop
rules). *Risk:* low–medium (additive; old arrows untouched).

### Phase 2 — Stronger layout engine
**Revised after review: default to upgrading the existing engine, NOT elkjs.**

Both reviewers flagged that `layoutDiagram` is **pure, synchronous, and runs
identically on the server (validate-only echo) and the client** — and that this
symmetry is load-bearing (the server validates the exact shapes the client
draws; the client applies layout *synchronously* inside the stream loop at
`AiAssistant.tsx:253-257`). **elkjs is async + web-worker + hundreds of KB**, so
adopting it would break server/client parity and force an async refactor of the
whole apply path. That's the plan's original biggest blind spot. So:

- **Default (do this): extend the hand-rolled engine.** Add the missing Sugiyama
  pieces — **dummy nodes for edges that skip layers**, **orthogonal routing
  through the empty channels between layers** (emitting Phase-1 polyline
  waypoints), and **non-overlapping edge-label placement**. Zero new dependency,
  stays pure + synchronous, keeps server/client parity.
- **Only if the Phase-0 metric proves the hand-rolled engine still fails** on
  realistic diagrams: adopt **dagre** (the synchronous engine behind Mermaid,
  ~100KB, returns node positions *and* edge bend-points). It preserves the
  sync/pure property elkjs would destroy. **elkjs is explicitly rejected** unless
  data forces dense >30-node cross-layer graphs, which LLM diagrams rarely are.
- **Rendering diagrams as a Mermaid/Graphviz image is rejected** as the primary
  path: it kills native editable shapes — selection, recolor, multiplayer, and
  incremental edits ("make the auth box red", "add a cache between X and Y"),
  which are the whole point of this canvas. Mermaid/DOT may be used only as an
  *input* graph format the model emits, never as a flattened image.

### Phase 3 — Planning phase + tools the model won't fight
**Revised after review: planning is prompt-only; the explicit plan tool is cut.**

1. **Planning step — prompt-only.** Instruct the model to decide nodes/edges/
   direction/grouping and emit it as the `drawDiagram` argument in one shot. Both
   reviewers rejected an explicit `canvas_planDiagram` round-trip: it adds
   latency at the most latency-sensitive moment for marginal benefit. (The UI can
   still *show* a "Planning…" state during the model's first tokens — see Phase 4
   — without a real extra step.)
2. **Near-free fix for Root cause C (do this — both reviewers raised it).**
   Today `canvas-stream.ts:169-173` *skips* de-overlap for hand-built batches
   because moving bodies would orphan their hand-drawn arrows. Instead, run a
   pass that **de-overlaps the bodies AND re-routes their connectors** (now
   possible with Phase-1 polylines) so a hand-built diagram is cleaned up rather
   than left as-is. This stops punishing the model for defecting and is far
   cheaper than the groups feature below.
3. **Expressive `drawDiagram` — only if measured.** Add optional **groups/
   subgraphs (clusters)** to the diagram schema so "system design" (boxes-within-
   boxes, a DB tier) is declarable, *if* the Phase-0 metric shows hand-building
   defection is still the dominant failure after step 2. Otherwise defer.
4. **Treat a whole turn as one diagram.** When a turn's connected shapes arrive
   across calls, keep them in one coordinate frame instead of tiling each call
   below the last (Root cause D).
5. **Feedback hop — cut.** Layout is deterministic, so a good layout means the
   model rarely needs coordinate feedback. Skip it unless data demands it.

### Phase 4 — Calmer chat UX (your explicit ask)
1. **Collapse the per-tool chips into ONE status.** Replace "Drew a diagram (5
   nodes)", "Updated a shape", "Drew 3 shapes" with a single live pill that
   moves through at most a few states: **Planning… → Drawing… → Done.** Keep the
   *failure* surface (red chip) — that's the one case where detail matters.
2. **Planning visibility.** Surface the Phase-3 plan as the "Planning…" state
   (optionally expandable to a one-line summary like "Auth flow: 6 steps").
3. **General polish.** Tighter empty state, a real typing indicator, calmer
   message styling, clearer error affordance. Don't echo a blow-by-blow of each
   mutation in the assistant's text either — a single "Done — added to your
   canvas" closer.

*Files:* `AiAssistant.tsx`, `tool-call-state.ts` (fold many tool calls into one
display status), small CSS.

### Phase 0 — Instrumentation (do alongside, does NOT gate Phase 1/4)
- Add a dev-only **overlap/crossing metric** (count overlapping node pairs +
  edge–box intersections) so "cleaner" is measured, not eyeballed.
- Run 3–4 representative prompts (URL-shortener system design, a decision
  flowchart, an org chart, a pipeline) through the **upgraded hand-rolled engine**
  first. Only if the metric still shows failures do we evaluate **dagre** (sync,
  preserves server/client parity). This gates *Phase 2's dependency decision
  only* — the connector and UX work (Phases 1, 4) proceed in parallel regardless.

---

## 3. Sequencing & rationale
**Revised after review — ship the cheap visible wins first; the engine spike
does NOT gate the connector or UX work.**

- **Day 1 (visible immediately, no new deps):** Phase 4 status pill **+** start
  Phase 1 polyline connectors (incl. `export.ts` + `hit-test.ts`). These are
  independent of the engine decision.
- **Next:** Phase 2 default path — dummy nodes + orthogonal routing + label
  placement in the *existing* pure engine, emitting Phase-1 waypoints. Plus the
  near-free Root-cause-C fix (Phase 3 step 2).
- **In parallel / cheap:** Phase 3 step 1 (prompt-only planning) and step 4
  (one-diagram-per-turn).
- **Only if the metric demands it:** dagre for placement (Phase 2) and groups/
  subgraphs (Phase 3 step 3). **elkjs and the explicit plan tool are dropped.**

### "If I had 2 days vs 2 weeks" (reviewer recommendation, adopted)
- **2 days:** Phase 4 pill + Phase 1 polyline connectors + orthogonal waypoints
  & dummy nodes in the current engine. No new deps. Kills ~80% of visible mess.
- **2 weeks:** the above + the Phase-0 overlap/crossing metric, then *measure*
  before adding dagre; add groups/subgraphs only if the metric shows hand-build
  defection dominates; prompt-only planning throughout.

## 4. What this explicitly is NOT
- Not a rewrite — the server/client split, streaming, and RBAC model stay.
- Not "just change the prompt" — the connector primitive (Root cause A) is a
  real code change; prompting alone can't bend a line.
- We will not weaken/skip tests to get green (per repo loop rules).
