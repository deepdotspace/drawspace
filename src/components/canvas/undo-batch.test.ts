import { describe, it, expect } from 'vitest'
import { createUndoBatcher } from './undo-batch'

describe('createUndoBatcher', () => {
  it('treats standalone writes as single undo steps', () => {
    const b = createUndoBatcher()
    b.recordWrite()
    b.recordWrite()
    b.recordWrite()
    expect(b.popUndo()).toBe(1)
    expect(b.popUndo()).toBe(1)
    expect(b.popUndo()).toBe(1)
    expect(b.popUndo()).toBe(0) // nothing left
  })

  it('groups a batch of writes into one undo step', () => {
    const b = createUndoBatcher()
    b.beginBatch()
    b.recordWrite()
    b.recordWrite()
    b.recordWrite()
    b.endBatch()
    expect(b.popUndo()).toBe(3)
    expect(b.popUndo()).toBe(0)
  })

  it('adds flushed ops passed to endBatch (e.g. coalesced drag frames)', () => {
    const b = createUndoBatcher()
    b.beginBatch()
    b.recordWrite() // 1 immediate (e.g. a z-index update)
    b.endBatch(4) // + 4 flushed moves
    expect(b.popUndo()).toBe(5)
  })

  it('records nothing for an empty batch', () => {
    const b = createUndoBatcher()
    b.beginBatch()
    b.endBatch()
    expect(b.popUndo()).toBe(0)
  })

  it('redo replays the same count and round-trips back onto undo', () => {
    const b = createUndoBatcher()
    b.beginBatch()
    b.recordWrite()
    b.recordWrite()
    b.endBatch() // undo:[2]
    expect(b.popUndo()).toBe(2) // redo:[2]
    expect(b.popRedo()).toBe(2) // undo:[2]
    expect(b.popUndo()).toBe(2)
    expect(b.popRedo()).toBe(2)
  })

  it('a new standalone write after an undo clears the redo stack', () => {
    const b = createUndoBatcher()
    b.recordWrite()
    expect(b.popUndo()).toBe(1) // redo:[1]
    b.recordWrite() // new action → clears redo
    expect(b.popRedo()).toBe(0)
  })

  it('a batch that writes clears the redo stack', () => {
    const b = createUndoBatcher()
    b.recordWrite()
    b.popUndo() // redo:[1]
    b.beginBatch()
    b.recordWrite()
    b.endBatch()
    expect(b.popRedo()).toBe(0)
  })

  it('an EMPTY batch (no writes) leaves the redo stack intact', () => {
    // Regression guard: a no-op gesture (e.g. click-selecting a shape without
    // dragging) must not destroy an available redo.
    const b = createUndoBatcher()
    b.recordWrite()
    expect(b.popUndo()).toBe(1) // redo:[1]
    b.beginBatch()
    b.endBatch() // empty gesture
    expect(b.popRedo()).toBe(1) // redo still there
  })

  it('a move/resize-only batch (ops via endBatch) clears redo', () => {
    const b = createUndoBatcher()
    b.recordWrite()
    b.popUndo() // redo:[1]
    b.beginBatch()
    b.endBatch(3) // 3 flushed drag frames, no recordWrite calls
    expect(b.popRedo()).toBe(0)
  })

  it('interleaves standalone writes and batches in LIFO order', () => {
    const b = createUndoBatcher()
    b.recordWrite() // [1]
    b.beginBatch()
    b.recordWrite()
    b.recordWrite()
    b.endBatch() // [1,2]
    b.recordWrite() // [1,2,1]
    expect(b.popUndo()).toBe(1)
    expect(b.popUndo()).toBe(2)
    expect(b.popUndo()).toBe(1)
    expect(b.popUndo()).toBe(0)
  })
})
