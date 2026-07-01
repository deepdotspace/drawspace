import { describe, it, expect } from 'vitest'
import { cssVar, CANVAS_COLORS } from './theme'

describe('cssVar', () => {
  it('builds a bare var() reference without a fallback', () => {
    expect(cssVar('--color-background')).toBe('var(--color-background)')
  })

  it('includes the literal fallback when provided', () => {
    expect(cssVar('--color-background', '#fcfcfd')).toBe('var(--color-background, #fcfcfd)')
  })
})

describe('CANVAS_COLORS', () => {
  it('references theme CSS variables for surface, grid, and default stroke', () => {
    expect(CANVAS_COLORS.surface).toContain('--color-background')
    expect(CANVAS_COLORS.gridFine).toContain('--color-muted-foreground')
    expect(CANVAS_COLORS.gridMajor).toContain('--color-muted-foreground')
    expect(CANVAS_COLORS.defaultStroke).toContain('--color-foreground')
  })

  it('keeps the original literals as fallbacks', () => {
    expect(CANVAS_COLORS.surface).toContain('#fcfcfd')
    expect(CANVAS_COLORS.defaultStroke).toContain('#1b1b1f')
  })
})
