/**
 * Theme-aware canvas color tokens.
 *
 * The drawing surface used to hardcode `#fcfcfd` (paper), grey grid dots, and a
 * near-black default stroke — all of which look wrong under the dark themes in
 * `themes.css`. These tokens reference the shared CSS variables (with the old
 * literals kept as fallbacks) so the canvas tracks the active `data-theme`.
 */

/** Build a CSS `var()` reference, optionally with a literal fallback. */
export function cssVar(name: string, fallback?: string): string {
  return fallback !== undefined ? `var(${name}, ${fallback})` : `var(${name})`
}

/** Theme-tracking colors for the canvas surface, grid, and default stroke. */
export const CANVAS_COLORS = {
  /** Paper / drawing surface. */
  surface: cssVar('--color-background', '#fcfcfd'),
  /** Fine grid dots. */
  gridFine: cssVar('--color-muted-foreground', '#8a8f9c'),
  /** Major grid dots. */
  gridMajor: cssVar('--color-muted-foreground', '#6b7280'),
  /** Fallback stroke for a shape that carries no explicit stroke. */
  defaultStroke: cssVar('--color-foreground', '#1b1b1f'),
} as const
