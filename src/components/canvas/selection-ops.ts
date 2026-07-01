/**
 * Selection operations — pure helpers for clipboard, duplicate, and nudge.
 *
 * Side-effect-free so the keyboard wiring in CanvasWorkspace stays thin and the
 * tricky parts (offset cloning, clipboard (de)serialization, arrow-key deltas)
 * are unit-tested in isolation.
 */

export interface ShapeLike {
  type: string
  x: number
  y: number
  width: number
  height: number
  props: Record<string, unknown>
}

/** A shape payload ready to hand to `useCanvas.addShape` (no id — assigned by the SDK). */
export interface ShapeCreatePayload {
  type: string
  x: number
  y: number
  width: number
  height: number
  props: Record<string, unknown>
}

/** Paste/duplicate offset, in canvas units. */
export const PASTE_OFFSET = 16

/** Clone shapes, shifting each by (dx, dy) and deep-copying props. */
export function cloneShapesWithOffset(shapes: ShapeLike[], dx: number, dy: number): ShapeCreatePayload[] {
  return shapes.map((s) => ({
    type: s.type,
    x: s.x + dx,
    y: s.y + dy,
    width: s.width,
    height: s.height,
    props: { ...s.props },
  }))
}

const CLIPBOARD_KIND = 'drawspace/shapes'

/** Serialize shapes to a clipboard string. */
export function serializeClipboard(shapes: ShapeLike[]): string {
  return JSON.stringify({
    kind: CLIPBOARD_KIND,
    version: 1,
    shapes: shapes.map((s) => ({
      type: s.type,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      props: s.props,
    })),
  })
}

/**
 * Parse a clipboard string back into shape payloads, or `null` when the string
 * isn't a valid drawspace clipboard. Strict: rejects on any malformed entry.
 */
export function deserializeClipboard(raw: string): ShapeCreatePayload[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (obj.kind !== CLIPBOARD_KIND || !Array.isArray(obj.shapes)) return null

  const out: ShapeCreatePayload[] = []
  for (const entry of obj.shapes) {
    if (!entry || typeof entry !== 'object') return null
    const s = entry as Record<string, unknown>
    if (
      typeof s.type !== 'string' ||
      typeof s.x !== 'number' ||
      typeof s.y !== 'number' ||
      typeof s.width !== 'number' ||
      typeof s.height !== 'number'
    ) {
      return null
    }
    out.push({
      type: s.type,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      props: s.props && typeof s.props === 'object' ? { ...(s.props as Record<string, unknown>) } : {},
    })
  }
  return out
}

/**
 * Arrow-key nudge delta: 1px per press, 10px with Shift. Returns `null` for any
 * non-arrow key so the caller can ignore it.
 */
export function nudgeDelta(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? 10 : 1
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 }
    case 'ArrowRight':
      return { dx: step, dy: 0 }
    case 'ArrowUp':
      return { dx: 0, dy: -step }
    case 'ArrowDown':
      return { dx: 0, dy: step }
    default:
      return null
  }
}
