import { describe, it, expect } from 'vitest'
import { layoutText, LINE_HEIGHT_RATIO } from './text-layout'

describe('layoutText', () => {
  it('keeps short text on one line at its base font', () => {
    const out = layoutText('Hello', 400, Number.POSITIVE_INFINITY, 20)
    expect(out.lines).toEqual(['Hello'])
    expect(out.fontSize).toBe(20)
    expect(out.lineHeight).toBeCloseTo(20 * LINE_HEIGHT_RATIO)
  })

  it('wraps long text to multiple lines within the width', () => {
    const out = layoutText('the quick brown fox jumps over the lazy dog', 120, Number.POSITIVE_INFINITY, 20)
    expect(out.lines.length).toBeGreaterThan(1)
    // No single wrapped line should blow well past the box width (approx check).
    for (const line of out.lines) {
      expect(line.length * out.fontSize * 0.58).toBeLessThanOrEqual(120 + out.fontSize * 0.58 * 1)
    }
  })

  it('honors explicit newlines as hard breaks', () => {
    const out = layoutText('line one\nline two', 400, Number.POSITIVE_INFINITY, 16)
    expect(out.lines).toEqual(['line one', 'line two'])
  })

  it('hard-breaks a single word longer than the line', () => {
    const out = layoutText('supercalifragilisticexpialidocious', 60, Number.POSITIVE_INFINITY, 20)
    expect(out.lines.length).toBeGreaterThan(1)
    // Every fragment fits the width.
    for (const line of out.lines) {
      expect(line.length * 20 * 0.58).toBeLessThanOrEqual(60 + 1)
    }
  })

  it('shrinks the font so a bounded box fits the wrapped text', () => {
    const tall = layoutText('the quick brown fox jumps over the lazy dog', 120, 1000, 20)
    const short = layoutText('the quick brown fox jumps over the lazy dog', 120, 40, 20)
    // A 40px-tall box must shrink below the 20px base to fit.
    expect(short.fontSize).toBeLessThan(tall.fontSize)
    expect(short.lines.length * short.lineHeight).toBeLessThanOrEqual(40 + short.lineHeight)
  })

  it('never shrinks below the 8px legibility floor', () => {
    const out = layoutText('a very long label that cannot possibly fit', 30, 12, 20)
    expect(out.fontSize).toBeGreaterThanOrEqual(8)
  })

  it('always returns at least one line, even for empty text', () => {
    const out = layoutText('', 100, Number.POSITIVE_INFINITY, 20)
    expect(out.lines.length).toBeGreaterThanOrEqual(1)
  })
})
