# Drawspace

A collaborative whiteboard with an AI assistant that draws — sketch together
in real time, or describe a diagram and watch it appear on the canvas. Built
on the [DeepSpace SDK](https://deep.space).

**Live app:** https://drawspace.app.space

## What it does

- A shared canvas for shapes, drawings, and diagrams, with multi-user editing,
  selection, and undo/redo
- Live presence — see who else is on the canvas with you
- An AI assistant that turns a prompt into shapes and laid-out diagrams,
  drawn directly onto the shared canvas
- Folders for organizing canvases

## How it's built

Each canvas is a DeepSpace `CanvasRoom` Durable Object driven through the
SDK's `useCanvas` hook, wrapped in a local optimistic layer so your own
strokes feel instant while everyone else's arrive live. Per-canvas presence
comes from `usePresenceRoom`. The AI assistant streams tool calls through the
DeepSpace AI proxy: the model emits shape and diagram-layout operations that
a canvas executor applies to the same shared room, so AI-drawn output shows
up for every collaborator just like a human stroke. Canvas metadata and
folders are record collections with role-based permissions, and a scheduled
cron task cleans up orphaned canvases.

## Run your own

Apps like this are built by handing a prompt to a coding agent — start at
[deep.space/get-started](https://deep.space/get-started), or scaffold directly:
`npm create deepspace@latest my-app`.

---
*Drawspace was built end-to-end by an AI agent on the DeepSpace SDK.
DeepSpace is laying the foundation for rebuilding the Internet in an AI-native
way — [deep.space](https://deep.space) · [docs](https://docs.deep.space).*
