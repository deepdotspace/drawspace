import { describe, it, expect } from 'vitest'
import type { CollectionSchema } from 'deepspace/worker'
import { buildSystemPrompt, buildTools } from './tools'

// A minimal, type-correct schema to feed buildSystemPrompt without booting the
// worker. Mirrors the real canvas metadata schema in shape.
const sampleSchema: CollectionSchema = {
  name: 'canvases',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true },
  ],
  ownerField: 'ownerId',
  permissions: {
    admin: { read: true, create: true, update: true, delete: true },
  },
}

describe('buildSystemPrompt', () => {
  it('includes the app name and every collection name', () => {
    const prompt = buildSystemPrompt('Drawspace', [sampleSchema])
    expect(prompt).toContain('Drawspace')
    expect(prompt).toContain('canvases')
    // Columns are summarized inline, so field names appear too.
    expect(prompt).toContain('title')
  })

  it('renders "(none)" when there are no collections', () => {
    const prompt = buildSystemPrompt('Drawspace', [])
    expect(prompt).toContain('(none)')
  })
})

describe('buildTools', () => {
  it('exposes only allowlisted record tools, with dots converted to underscores', () => {
    const tools = buildTools(async () => ({}))
    const names = Object.keys(tools)

    expect(names.length).toBeGreaterThan(0)
    // safeName replaces '.' with '_', so no tool key should contain a dot.
    expect(names.every((n) => !n.includes('.'))).toBe(true)
    // The CRUD tools the allowlist grants should be present...
    expect(names).toContain('records_create')
    expect(names).toContain('records_query')
    // ...and tools NOT on the allowlist must be absent.
    expect(names).not.toContain('records_purge')
  })

  it('routes a tool call to the executor using the original dotted name', async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = []
    const tools = buildTools(async (name, params) => {
      calls.push({ name, params })
      return { ok: true }
    })

    const queryTool = tools['records_query'] as {
      execute: (input: Record<string, unknown>, options: unknown) => Promise<unknown>
    }
    const result = await queryTool.execute({ collection: 'canvases' }, {})

    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('records.query')
    expect(calls[0].params).toEqual({ collection: 'canvases' })
    expect(result).toEqual({ ok: true })
  })
})
