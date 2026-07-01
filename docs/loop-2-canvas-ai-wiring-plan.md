# Loop 2 plan — Wire the canvas AI tools into the chat + live canvas

> **For the implementing agent:** This is a `/loop` task that depends on Loop 1
> (`docs/loop-1-canvas-ai-tools-plan.md`) being merged. Read this whole file and
> the Prerequisites section FIRST — some prerequisite steps are NOT loop work
> (they need the CLI / a running server) and must be done by hand before you
> start the loop. Then run the Builder→Checker loop until `ALL GREEN` or a stop
> rule fires (`CLAUDE.md` → "Loop stop rules"). Do not weaken checks.

---

## Goal (one sentence)

Make the AI assistant actually draw on the canvas: register the canvas tools in
the chat stream with a validate-only server executor, plumb the user's current
selection + canvas state into the request, and have the client apply the
streamed tool calls to `useCanvas` so shapes appear live for everyone.

This delivers the two user requirements:
1. **Edit what's highlighted** — the user selects shape(s), asks the AI to
   change them, and the AI calls `canvas_updateShape` on the selected ids.
2. **Build from a prompt** — "build me the system design" → the AI emits a
   sequence of `canvas_createShape` (and edit/delete) calls that draw the
   infrastructure live in front of the user.

## Why this is Loop 2 (and what's different about its checks)

This slice is wiring and I/O. Unit tests can only cover the **pure mapping
functions** (decoded tool call → `useCanvas` call; request-body → server
context). The end-to-end "shape really appears for both users" behavior is
verified by the **manual e2e gate after the loop**, not inside it. So the loop
here is lighter-checked than Loop 1 — keep each Builder change small and expect
to do a human verification pass at the end.

---

## Prerequisites — do these BEFORE starting the loop (NOT loop work)

These need the CLI and/or a running server, so they don't belong in the
build–check loop. Do them by hand (or have the human do them):

1. **Install the AI chat frontend feature:**
   ```sh
   npx deepspace add ai-chat
   ```
   This adds `src/components/ChatPanel.tsx`, `src/pages/assistant.tsx`, and
   `src/schemas/ai-chat-schema.ts` (which re-exports `aiChatSchemas`).
2. **Register the AI chat schemas** in `src/schemas.ts` (the chat backend in
   `chat-routes.ts` reads/writes `ai-chats` / `ai-messages`, which are NOT
   registered today — confirmed). Spread `aiChatSchemas` into the `schemas`
   array. Without this the chat backend fails at runtime ("schema not
   registered").
3. **Smoke-check the chat works against records** before adding canvas: run
   `npx deepspace dev`, open the assistant, send "list my collections", confirm
   a tool call + reply. This isolates "chat works" from "canvas wiring works".

> If any prerequisite is skipped, Loop 2 will appear to pass type-check/lint but
> the feature won't work — that's exactly the "green ≠ working" gap. Do them.

---

## Architecture (decided)

```
User selects shape(s) ──▶ client sends { canvasContext } with POST /api/ai/chat
                                          │
                          chat-routes.ts folds context into the system prompt
                          (buildCanvasSystemPrompt from Loop 1) and registers
                          canvas tools whose server execute = validate only
                                          │
                              streamText emits tool-call chunks
                                          │
        ┌─────────────────────────────────┴───────────────────────────┐
        ▼ (server)                                                       ▼ (client)
 execute returns the normalized shape           the canvas chat surface decodes the
 as the tool result so the model can            stream (parseSseLine + decodeAiStreamChunk),
 chain create→create→edit within the            maps each upsert-tool-call to a useCanvas
 stepCountIs(5) loop                            call (addShape/updateShape/deleteShape) → live
```

Key point: **the server never mutates the canvas.** It only validates and echoes
the shape back so the agentic loop can continue. The client is the single writer
to `useCanvas`, which keeps RBAC (`canWrite`) and live Yjs sync intact.

---

## Files to create / edit

### Server

1. **`src/ai/chat-routes.ts` (edit):**
   - Accept an optional `canvasContext` field on the `POST /api/ai/chat` body
     (shape: `CanvasContext` from `canvas-tools.ts` — `{ docId, shapes[], selectedShapeIds[] }`).
     Validate size (reuse the existing `MAX_USER_CONTENT_LENGTH` pattern / cap
     the shapes array length).
   - When `canvasContext` is present, append `buildCanvasSystemPrompt(ctx)`
     (Loop 1) to `systemText`, and register the canvas tools alongside the
     record tools in the `tools` object passed to `streamText`.
   - The canvas tools' executor is **validate-only**: it runs `normalizeCreate` /
     `normalizeEdit` (Loop 1) and returns `{ ok: true, shape }` or
     `{ ok: false, error }`. It must NOT call any DO or network. `canvas_listShapes`
     returns `ctx.shapes`.
   - Keep `stopWhen: stepCountIs(5)` (raise only if multi-step drawing needs it —
     note the cost in the run report if you do).

2. **`src/ai/canvas-executor.ts` (new, optional split):** the validate-only
   executor factory `makeCanvasExecutor(ctx)` so it can be unit-tested in
   isolation. Pure except it closes over `ctx`. Returns the
   `(toolName, params) => Promise<result>` shape `buildCanvasTools` expects.

### Client

3. **`src/ai/canvas-stream.ts` (new) — pure mapping, the unit-tested core:**
   - `type CanvasOp = { kind: 'create'; shape: NormalizedShape } | { kind: 'update'; shapeId: string; patch: ... } | { kind: 'delete'; shapeId: string }`
   - `function toolCallToCanvasOp(toolName: string, input: unknown): CanvasOp | null`
     — map a decoded `upsert-tool-call` (`toolName` + `input`) into a `CanvasOp`,
     reusing `normalizeCreate` / `normalizeEdit` from Loop 1; return `null` for
     non-canvas tools. This is the function the client reducer calls and the
     function the unit tests target.
   - `function applyCanvasOp(op: CanvasOp, canvas: CanvasApi): void` — switch on
     `op.kind` and call the matching `useCanvas` method. `CanvasApi` is a small
     interface (`{ addShape, updateShape, deleteShape }`) so it can be tested
     with a mock and doesn't depend on React.

4. **A canvas-side chat surface** — embed chat in the canvas page. Two options
   (pick the simpler that works; document the choice in the run report):
   - **(Preferred) Custom minimal surface** co-located in
     `src/components/canvas/CanvasAssistant.tsx`: uses `parseSseLine` +
     `decodeAiStreamChunk` (from `deepspace`) to read the stream, and on each
     `upsert-tool-call` action calls `toolCallToCanvasOp` → `applyCanvasOp`
     against the `useCanvas(docId)` instance from the page. This is preferred
     because it can tap the tool-call stream directly.
   - (Alternative) Reuse `ChatPanel` if it exposes a tool-call callback; if it
     doesn't, don't fight it — use the custom surface.
   - Wire selection: the canvas page already tracks `selectedShapeId`
     (`CanvasView.tsx`). Lift or share it so the chat surface can build
     `canvasContext = { docId, shapes, selectedShapeIds }` for each send.

5. **`src/pages/(protected)/canvas/[docId].tsx` (edit):** render the chat surface
   next to `<CanvasView>` (e.g. a side panel), passing `docId` and the shared
   selection + shapes.

### Tests

6. **`src/ai/canvas-stream.test.ts` (new):**
   - `toolCallToCanvasOp` maps a `canvas_createShape` input to a `create` op with
     a normalized shape (defaults applied).
   - maps `canvas_updateShape` to an `update` op carrying `shapeId` + patch.
   - maps `canvas_deleteShape` to a `delete` op.
   - returns `null` for a non-canvas tool name (e.g. `records_query`).
   - throws/normalizes-error on an invalid create payload (negative width) —
     assert it surfaces the Loop 1 validation error rather than producing a bad op.
   - `applyCanvasOp` calls the right `CanvasApi` method with the right args (use
     a mock `CanvasApi` and assert calls), for each of create/update/delete.
7. **`src/ai/canvas-executor.test.ts` (new, if you split it out):** the
   validate-only executor returns `{ ok: true, shape }` for valid input and
   `{ ok: false, error }` for invalid, and never throws out of `execute`.

---

## Definition of done

- `npm run test:unit` — the new mapping/executor tests pass (plus Loop 1's still
  green).
- `npm run type-check` — clean.
- `npm run lint` — clean.

Then (manual, OUTSIDE the loop — the graduation gate):
- `npx deepspace dev`, open a canvas, open the assistant, and verify:
  - "draw a rectangle in the top-left" → a rect appears live.
  - select a shape, "make this blue" → the selected shape updates.
  - "build a simple 3-tier web app system design" → multiple shapes are drawn.
- Optionally add/extend `tests/` (Playwright) for the chat endpoint accepting
  `canvasContext` (api spec) — but keep multi-user canvas behavior as a manual
  check unless you invest in a 2-user canvas spec (see `references/testing.md`).

## Explicitly OUT of scope for Loop 2

- Server-side canvas mutation / writing into the `CanvasRoom` DO from the worker
  (the client is the writer by design). Only revisit if you later want fully
  autonomous server-driven drawing — that's a separate, larger effort and needs
  verifying `CanvasRoom`'s server surface in
  `node_modules/deepspace/dist/worker.d.ts`.
- Undo/redo integration for AI ops, multi-canvas, and any payments/limits.
- Reasoning-model "thinking" display (chat stream sets `sendReasoning: false`).

## Risk notes for the implementing agent

- **Verify the SDK surface before coding the client:** confirm `useCanvas`'s
  `addShape` / `updateShape` / `deleteShape` exact signatures and the
  `CanvasShapeClient` shape in `node_modules/deepspace/dist/index.d.ts`. The op
  mapper must produce exactly what those methods expect.
- **Confirm the stream decode vocabulary:** `decodeAiStreamChunk` returns
  `upsert-tool-call { toolCallId, toolName, input }` — check
  `references/ai-chat.md` and the `.d.ts` for the exact field names.
- **Client-executed vs server-executed tools:** because the canvas tools' server
  `execute` returns immediately (validate-only), the model gets a result and can
  continue. The client applies ops by watching the SAME stream. Don't also write
  the shape server-side — that would double-apply.
