/**
 * Pure text layout for canvas `text` shapes — word-wraps a string to a box
 * width and (when the box is height-bounded) shrinks the font until the wrapped
 * lines fit. Used by BOTH the on-screen renderer (`Shape.tsx`) and the SVG
 * exporter (`export.ts`) so the two never disagree, and it's unit-tested in
 * isolation (no DOM, no measurement APIs — width is approximated from the font
 * size, which is plenty for wrapping the hand-drawn label font).
 *
 * Two modes, chosen by the caller's height budget:
 *  - Free text shapes pass an unbounded height → text wraps to width at its
 *    natural size and the box grows downward (the editor syncs the box height).
 *  - Diagram node labels pass the node's height → text wraps AND the font
 *    shrinks so the label always fits inside its box.
 */

/** Approx glyph-width / font-size ratio for the canvas hand font. Kept a hair
 *  above the font's true average so a box sized from it never ends up narrower
 *  than the real text (which would clip on the right). */
const AVG_CHAR_RATIO = 0.54
/** Line box height as a multiple of the font size. */
export const LINE_HEIGHT_RATIO = 1.25
/** Never shrink a label below this (keeps it legible). */
const MIN_FONT = 8
/** Free text grows its box up to this width; only longer text wraps. */
export const MAX_AUTO_TEXT_WIDTH = 600
/** Horizontal padding inside a text box (matches Shape.tsx TEXT_PAD_X * 2). */
export const TEXT_BOX_PAD = 8

export interface TextLayout {
  /** Wrapped lines, top to bottom. Always at least one entry. */
  lines: string[]
  /** Font size actually used (≤ the requested base when shrunk to fit). */
  fontSize: number
  /** Per-line vertical advance in canvas units. */
  lineHeight: number
}

/** Approximate rendered width of `s` at `fontSize`. */
function approxWidth(s: string, fontSize: number): number {
  return s.length * fontSize * AVG_CHAR_RATIO
}

/**
 * The box a FREE (auto-sizing) text shape should occupy at `fontSize`: width
 * hugs the widest wrapped line (capped at MAX_AUTO_TEXT_WIDTH), height fits the
 * line count. Shared by the inline editor's commit and the style panel's
 * font-size control so a size change re-fits the box consistently.
 */
export function fitTextBox(text: string, fontSize: number): { width: number; height: number } {
  const { lines } = layoutText(text || 'Text', MAX_AUTO_TEXT_WIDTH - TEXT_BOX_PAD, Number.POSITIVE_INFINITY, fontSize)
  const width = Math.min(MAX_AUTO_TEXT_WIDTH, Math.max(40, Math.round(maxLineWidth(lines, fontSize) + TEXT_BOX_PAD)))
  const height = Math.max(Math.round(lines.length * fontSize * LINE_HEIGHT_RATIO), Math.round(fontSize * 1.4))
  return { width, height }
}

/** Approx width of the widest line in a wrapped block — lets a free-text box
 *  hug its content horizontally (no dead space on the right). */
export function maxLineWidth(lines: string[], fontSize: number): number {
  let w = 0
  for (const l of lines) w = Math.max(w, approxWidth(l, fontSize))
  return w
}

/** Hard-break a single word that is wider than a full line, by characters. */
function breakLongWord(word: string, maxWidth: number, fontSize: number, out: string[]): string {
  let chunk = ''
  for (const ch of word) {
    if (chunk !== '' && approxWidth(chunk + ch, fontSize) > maxWidth) {
      out.push(chunk)
      chunk = ch
    } else {
      chunk += ch
    }
  }
  return chunk
}

/** Greedy word-wrap of `text` (honoring explicit newlines) at a fixed font. */
function wrapAtFont(text: string, boxWidth: number, fontSize: number): string[] {
  const maxWidth = Math.max(1, boxWidth)
  const lines: string[] = []

  for (const para of text.split('\n')) {
    if (para.trim() === '') {
      lines.push('')
      continue
    }
    const words = para.split(/\s+/).filter((w) => w.length > 0)
    let line = ''
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (approxWidth(candidate, fontSize) <= maxWidth) {
        line = candidate
        continue
      }
      // `word` doesn't fit on the current line.
      if (line !== '') lines.push(line)
      if (approxWidth(word, fontSize) > maxWidth) {
        line = breakLongWord(word, maxWidth, fontSize, lines)
      } else {
        line = word
      }
    }
    if (line !== '') lines.push(line)
  }

  return lines.length > 0 ? lines : ['']
}

/**
 * Wrap `text` to `boxWidth`, shrinking the font (down to a floor) until the
 * wrapped block fits `boxHeight`. Pass `Infinity` for `boxHeight` to wrap at the
 * base size without ever shrinking (free-text "grow downward" mode).
 */
export function layoutText(
  text: string,
  boxWidth: number,
  boxHeight: number,
  baseFontSize: number,
): TextLayout {
  const base = Number.isFinite(baseFontSize) && baseFontSize > 0 ? Math.round(baseFontSize) : 20
  for (let fs = base; fs >= MIN_FONT; fs--) {
    const lines = wrapAtFont(text, boxWidth, fs)
    const totalHeight = lines.length * fs * LINE_HEIGHT_RATIO
    if (totalHeight <= boxHeight || fs === MIN_FONT) {
      return { lines, fontSize: fs, lineHeight: fs * LINE_HEIGHT_RATIO }
    }
  }
  // Unreachable (the loop returns at fs === MIN_FONT), but keeps types total.
  const lines = wrapAtFont(text, boxWidth, MIN_FONT)
  return { lines, fontSize: MIN_FONT, lineHeight: MIN_FONT * LINE_HEIGHT_RATIO }
}
