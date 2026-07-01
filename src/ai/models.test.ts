import { describe, it, expect } from 'vitest'
import { AI_MODELS, ALLOWED_MODELS, DEFAULT_MODEL, MODEL_OPTIONS } from './models'

describe('AI model allowlist', () => {
  it('includes the refreshed claude-opus-4-8', () => {
    expect(ALLOWED_MODELS['claude-opus-4-8']).toBe('anthropic')
    expect(MODEL_OPTIONS.some((m) => m.id === 'claude-opus-4-8')).toBe(true)
  })

  it('no longer offers the stale claude-opus-4-7', () => {
    expect(ALLOWED_MODELS['claude-opus-4-7']).toBeUndefined()
    expect(AI_MODELS.some((m) => m.id === 'claude-opus-4-7')).toBe(false)
  })

  it('labels Opus as 4.8, not 4.7', () => {
    const opus = AI_MODELS.find((m) => m.id === 'claude-opus-4-8')
    expect(opus?.label).toBe('Claude Opus 4.8')
    expect(AI_MODELS.some((m) => m.label.includes('4.7'))).toBe(false)
  })

  it('keeps the default model inside the allowlist', () => {
    expect(ALLOWED_MODELS[DEFAULT_MODEL]).toBeDefined()
  })

  it('derives the allowlist from the catalog (no drift)', () => {
    for (const m of AI_MODELS) {
      expect(ALLOWED_MODELS[m.id]).toBe(m.backend)
    }
    expect(Object.keys(ALLOWED_MODELS)).toHaveLength(AI_MODELS.length)
  })
})
