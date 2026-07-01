# Drawspace Feature Uplift — Plan

_Generated 2026-06-25 from 4 parallel research/audit agents (tldraw research,
Excalidraw research, drawing UI/UX audit, AI chat audit)._

## Goal

Close the highest-value gaps between drawspace and mature whiteboard apps
(tldraw / Excalidraw), plus fix the AI-chat weaknesses — limited to work that
can be **verified offline** by the checker (`test:unit`, `type-check`, `lint`).
Anything that needs a live server, deploy, or paid AI calls is explicitly **out
of scope** for this loop (the user said: stop if it would cost money to test).

## What the research found (condensed)

**tldraw / Excalidraw — common MUST-HAVE features a basic app needs:** rich tool
set (freehand draw, eraser, more shapes), full selection manipulation (z-order,
duplicate, align), preset style system (stroke/fill/dash/size/opacity),
undo/redo + keyboard shortcuts + context menu, **export to PNG/SVG**, clipboard
(copy/cut/paste/duplicate/select-all), zoom-to-fit, snapping, dark mode, touch.

**Drawing audit — drawspace MUST-HAVEs missing:** no export of any kind;
destructive "Clear canvas" with no confirm; no copy/paste/cut/duplicate/select-all
shortcuts; no undo/redo UI buttons; broken line/arrow endpoint editing;
no touch/mobile; canvas colors hardcoded (not theme-aware); no freehand tool.

**AI chat audit — MUST-HAVEs:** stale model id `claude-opus-4-7` → should be
`claude-opus-4-8`; no markdown rendering in the live `AiAssistant`; tool-failure
stream chunks ignored (AI falsely claims success); canvas context omits
fill/stroke/text so AI can't act on "the blue box"; no stop/abort (tokens burn
after panel close); model list hand-synced across 3 files (drift → silent 400s).

## Build scope (this loop)

Prioritized, all offline-verifiable. Each item notes the unit test that proves it.

### Group A — Drawing UX

1. **Freehand / pencil tool** — new `draw` shape (array of points → SVG path),
   added to `types.ts`, `Toolbar.tsx`, `DrawCanvas.tsx`, `Shape.tsx`.
   _Test:_ point-array → path-`d` builder + bbox computation.
2. **Export (SVG + PNG + copy-to-clipboard)** — new `src/components/canvas/export.ts`
   that serializes shapes to a standalone SVG string; PNG via canvas raster;
   wired into `TopMenu.tsx`. _Test:_ SVG-string generation for each shape type.
3. **Clipboard & shortcuts** — Ctrl/Cmd+C / X / V (paste at offset), Ctrl/Cmd+D
   duplicate, Ctrl/Cmd+A select-all, Escape deselect. Pure helpers extracted so
   they're testable. _Test:_ clipboard serialize/deserialize + paste-offset +
   select-all id set.
4. **Arrow-key nudging** — move selection by 1px (Shift = 10px). _Test:_ nudge
   delta helper.
5. **Undo/redo UI buttons + Clear-canvas confirm dialog** — buttons near
   `ZoomControls`; confirm modal before clear (no `window.confirm`, use a UI
   primitive). _Test:_ DOM/logic test for the confirm gate if feasible, else
   type-check coverage.
6. **Theme-aware canvas colors** — replace hardcoded `#fcfcfd` / grid / default
   stroke with CSS vars so dark themes work. _Test:_ token resolver helper.

### Group B — AI Chat

7. **Model id refresh + single source of truth** — new `src/ai/models.ts`
   exporting the allowlist + default; `claude-opus-4-7` → `claude-opus-4-8`;
   `chat-routes.ts`, `AiAssistant.tsx`, `ChatPanel.tsx` import it. _Test:_
   allowlist contains `claude-opus-4-8` and NOT `claude-opus-4-7`.
8. **Markdown rendering in `AiAssistant`** — use already-installed
   `react-markdown`/`remark-gfm`/`rehype-highlight`. _Test:_ render smoke (dom
   config) or component import wiring via type-check.
9. **Tool-failure handling** — handle `finalize-tool-call`, `fail-tool-input`,
   `fail-tool-output`, `abort` chunks; show real failure state instead of a
   green "success" chip. _Test:_ stream-chunk reducer maps `ok:false` →
   error state.
10. **Canvas context includes fill/stroke/text** — extend `buildContext`
    (`AiAssistant.tsx`), `parseCanvasContext` (`chat-routes.ts`),
    `summarizeCanvasForPrompt` (`canvas-tools.ts`). _Test:_ context serializer
    includes color/text fields; summary string includes them.
11. **Stop/abort** — `AbortController` in `AiAssistant`; cancel on panel close /
    unmount. _Test:_ abort wiring helper (signal aborts pending state).

## Out of scope (would cost money / needs live server)

Deploy, `npx deepspace test` (needs auth + live workers), real AI API calls,
real-time multi-user collab tests, vision/image-of-canvas to the model.
Arrow-to-shape binding, rotation, grouping/locking, minimap, multi-page —
deferred as ADVANCED.

## Definition of done

- All Group A + Group B items implemented.
- New pure logic (export, clipboard, nudge, stream reducer, context serializer,
  theme tokens, model list) covered by **unit tests** under `tests/` or
  `src/**/*.test.ts` picked up by `vitest.config.ts`.
- `npm run test:unit`, `npm run type-check`, and `npm run lint` all pass.
- No check weakened, skipped, or deleted to reach green.

## Loop checker

Runs only: `npm run test:unit`, `npm run type-check`, `npm run lint`.
Never `npm test` / `deepspace test` (live server + auth + cost).
