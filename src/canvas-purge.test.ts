import { describe, it, expect } from 'vitest'
import { isCanvasExpired, PURGE_RETENTION_MS, PURGE_RETENTION_DAYS } from './canvas-purge'

describe('isCanvasExpired', () => {
  const now = Date.parse('2026-06-26T00:00:00.000Z')

  it('treats a live board (no deletedAt) as not expired', () => {
    expect(isCanvasExpired(undefined, now)).toBe(false)
    expect(isCanvasExpired(null, now)).toBe(false)
    expect(isCanvasExpired('', now)).toBe(false)
  })

  it('treats a recently trashed board as not expired', () => {
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString()
    expect(isCanvasExpired(yesterday, now)).toBe(false)
  })

  it('treats a board trashed past the retention window as expired', () => {
    const old = new Date(now - PURGE_RETENTION_MS - 1000).toISOString()
    expect(isCanvasExpired(old, now)).toBe(true)
  })

  it('is exactly at the boundary inclusive', () => {
    const exactly = new Date(now - PURGE_RETENTION_MS).toISOString()
    expect(isCanvasExpired(exactly, now)).toBe(true)
  })

  it('does not treat a malformed timestamp as expired', () => {
    expect(isCanvasExpired('not-a-date', now)).toBe(false)
  })

  it('honors a custom retention window', () => {
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
    const oneDay = 24 * 60 * 60 * 1000
    expect(isCanvasExpired(twoDaysAgo, now, oneDay)).toBe(true)
    expect(isCanvasExpired(twoDaysAgo, now, 3 * oneDay)).toBe(false)
  })

  it('retention constant matches the day count', () => {
    expect(PURGE_RETENTION_MS).toBe(PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  })
})
