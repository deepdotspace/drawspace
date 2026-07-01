import { describe, it, expect } from 'vitest'
import { layoutDiagram, MAX_DIAGRAM_NODES, type DiagramSpec } from './diagram-layout'

describe('layoutDiagram', () => {
  it('emits a container + a label per node, and an arrow per edge', () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: 'a', label: 'Start' },
        { id: 'b', label: 'End' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    }
    const shapes = layoutDiagram(spec)
    const containers = shapes.filter((s) => s.type === 'rect')
    const texts = shapes.filter((s) => s.type === 'text')
    const arrows = shapes.filter((s) => s.type === 'arrow')
    expect(containers).toHaveLength(2)
    expect(texts).toHaveLength(2) // node labels (no edge label here)
    expect(arrows).toHaveLength(1)
  })

  it('honors the requested node container shape (diamond for a decision)', () => {
    const shapes = layoutDiagram({
      nodes: [{ id: 'd', label: 'OK?', shape: 'diamond' }],
    })
    expect(shapes.some((s) => s.type === 'diamond')).toBe(true)
  })

  it('stacks layers downward for TB (child below parent)', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'Top' },
        { id: 'b', label: 'Bottom' },
      ],
      edges: [{ from: 'a', to: 'b' }],
      direction: 'TB',
    })
    const a = shapes.find((s) => s.type === 'text' && s.props.text === 'Top')!
    const b = shapes.find((s) => s.type === 'text' && s.props.text === 'Bottom')!
    expect(b.y).toBeGreaterThan(a.y)
  })

  it('advances layers rightward for LR', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'Left' },
        { id: 'b', label: 'Right' },
      ],
      edges: [{ from: 'a', to: 'b' }],
      direction: 'LR',
    })
    const a = shapes.find((s) => s.type === 'text' && s.props.text === 'Left')!
    const b = shapes.find((s) => s.type === 'text' && s.props.text === 'Right')!
    expect(b.x).toBeGreaterThan(a.x)
  })

  it('emits an arrow carrying a headCorner so direction survives move/resize', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    })
    const arrow = shapes.find((s) => s.type === 'arrow')!
    expect(arrow.props.headCorner).toBeTruthy()
    expect(['nw', 'ne', 'sw', 'se']).toContain(arrow.props.headCorner)
  })

  it('routes an arrow as an orthogonal (elbow) polyline, not a bare diagonal', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [{ from: 'a', to: 'b' }],
      direction: 'TB',
    })
    const arrow = shapes.find((s) => s.type === 'arrow')!
    const points = arrow.props.points as Array<{ x: number; y: number }>
    expect(Array.isArray(points)).toBe(true)
    expect(points.length).toBeGreaterThanOrEqual(3)
    // Waypoints are stored bbox-relative (origin at 0,0) like the freehand shape.
    const minX = Math.min(...points.map((p) => p.x))
    const minY = Math.min(...points.map((p) => p.y))
    expect(minX).toBe(0)
    expect(minY).toBe(0)
    // Every segment is axis-aligned (purely horizontal or purely vertical).
    for (let i = 0; i < points.length - 1; i++) {
      const horizontal = points[i].y === points[i + 1].y
      const vertical = points[i].x === points[i + 1].x
      expect(horizontal || vertical).toBe(true)
    }
  })

  it('adds a text label for a labeled edge', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'yes' }],
    })
    expect(shapes.some((s) => s.type === 'text' && s.props.text === 'yes')).toBe(true)
  })

  it('skips edges that reference an unknown node instead of throwing', () => {
    const shapes = layoutDiagram({
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ from: 'a', to: 'ghost' }],
    })
    expect(shapes.filter((s) => s.type === 'arrow')).toHaveLength(0)
  })

  it('is cycle-safe (does not hang on a self/loop edge)', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    })
    expect(shapes.filter((s) => s.type === 'arrow')).toHaveLength(2)
  })

  it('produces finite, positive-sized shapes', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'Client' },
        { id: 'b', label: 'API Gateway' },
        { id: 'c', label: 'Database' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    })
    for (const s of shapes) {
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Number.isFinite(s.y)).toBe(true)
      expect(s.width).toBeGreaterThan(0)
      expect(s.height).toBeGreaterThan(0)
    }
  })

  it('throws on an empty spec', () => {
    expect(() => layoutDiagram({ nodes: [] })).toThrow(/at least one node/i)
  })

  it('throws when exceeding the node cap', () => {
    const nodes = Array.from({ length: MAX_DIAGRAM_NODES + 1 }, (_, i) => ({ id: `n${i}`, label: `n${i}` }))
    expect(() => layoutDiagram({ nodes })).toThrow(/exceeds/i)
  })

  it('never overlaps two node containers', () => {
    const containerTypes = new Set(['rect', 'ellipse', 'diamond'])
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => {
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      return ox > 0 && oy > 0
    }
    // A branching/merging graph with multiple nodes per layer.
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'Start' },
        { id: 'b', label: 'Validate' },
        { id: 'c', label: 'Process' },
        { id: 'd', label: 'Notify' },
        { id: 'e', label: 'Done' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
        { from: 'd', to: 'e' },
      ],
    })
    const bodies = shapes.filter((s) => containerTypes.has(s.type))
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        expect(overlaps(bodies[i], bodies[j])).toBe(false)
      }
    }
  })

  // Absolute waypoints of a routed arrow. Points are stored bbox-relative with
  // the bbox equal to the shape box, so abs = shape origin + waypoint.
  function absPoints(arrow: { x: number; y: number; props: Record<string, unknown> }): Array<{ x: number; y: number }> {
    const pts = (arrow.props.points ?? []) as Array<{ x: number; y: number }>
    return pts.map((p) => ({ x: arrow.x + p.x, y: arrow.y + p.y }))
  }

  // True if a point sits strictly inside a box (small epsilon so a waypoint that
  // merely touches a face — e.g. an endpoint anchor — does not count).
  function strictlyInside(p: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }): boolean {
    const e = 0.5
    return p.x > box.x + e && p.x < box.x + box.width - e && p.y > box.y + e && p.y < box.y + box.height - e
  }

  it('routes a layer-skipping edge around the boxes between its endpoints (dummy nodes)', () => {
    // a→b→c→d spine PLUS a long a→d edge that skips ranks 1 and 2. The long edge
    // must thread the channels, never slicing through b or c.
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
        { id: 'd', label: 'D' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
        { from: 'a', to: 'd' },
      ],
      direction: 'TB',
    })
    const containerTypes = new Set(['rect', 'ellipse', 'diamond'])
    const containers = shapes.filter((s) => containerTypes.has(s.type))
    const arrows = shapes.filter((s) => s.type === 'arrow')

    // No arrow's polyline may pass through the interior of any node box (sampling
    // every segment finely catches a diagonal that would slice a box).
    for (const arrow of arrows) {
      const abs = absPoints(arrow)
      for (let i = 0; i < abs.length - 1; i++) {
        for (let s = 0; s <= 20; s++) {
          const t = s / 20
          const p = { x: abs[i].x + (abs[i + 1].x - abs[i].x) * t, y: abs[i].y + (abs[i + 1].y - abs[i].y) * t }
          for (const box of containers) expect(strictlyInside(p, box)).toBe(false)
        }
      }
    }

    // The long edge is genuinely routed (more than the single elbow of an
    // adjacent-layer edge), i.e. it bends through the dummy channel.
    const longest = arrows.reduce((a, b) => (a.height >= b.height ? a : b))
    expect(absPoints(longest).length).toBeGreaterThanOrEqual(4)
  })

  it('keeps a cyclic (loop) diagram compact — a cycle must not inflate ranks', () => {
    // while-loop shape: start → cond → body → incr → (back to cond); cond → end.
    // The back edge incr→cond must NOT push cond's rank up (which used to fling
    // it ~1900px down the page). The whole graph should stay within a few layers.
    const shapes = layoutDiagram({
      nodes: [
        { id: 's', label: 'Start' },
        { id: 'c', label: 'i < n?', shape: 'diamond' },
        { id: 'b', label: 'Body' },
        { id: 'i', label: 'i++' },
        { id: 'e', label: 'End' },
      ],
      edges: [
        { from: 's', to: 'c' },
        { from: 'c', to: 'b', label: 'yes' },
        { from: 'b', to: 'i' },
        { from: 'i', to: 'c' },
        { from: 'c', to: 'e', label: 'no' },
      ],
      direction: 'TB',
    })
    const containerTypes = new Set(['rect', 'ellipse', 'diamond'])
    const containers = shapes.filter((s) => containerTypes.has(s.type))
    const top = Math.min(...containers.map((c) => c.y))
    const bottom = Math.max(...containers.map((c) => c.y + c.height))
    // 5 nodes collapse to ~4 layers; height must be a few hundred px, never the
    // ~2000+ that a cycle-inflated rank produced.
    expect(bottom - top).toBeLessThan(700)
  })

  it('sizes a short edge label wide enough to stay on one line', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'd', label: 'Decide', shape: 'diamond' },
        { id: 'y', label: 'Yes path' },
      ],
      edges: [{ from: 'd', to: 'y', label: 'yes' }],
    })
    const label = shapes.find((s) => s.type === 'text' && s.props.text === 'yes')!
    // The renderer wraps at ~0.54·fontSize per char inside the box's padding
    // (width − 8); the label box must clear that so "yes" doesn't wrap to 2 lines.
    const innerW = label.width - 8
    const needed = 'yes'.length * (label.props.fontSize as number) * 0.54
    expect(innerW).toBeGreaterThanOrEqual(needed)
  })

  it('routes a back/loop edge on a side lane outside the boxes (not across the diagram)', () => {
    // A loop: condition → body → increment → back to condition. The back edge
    // skips two layers upward; it must run out past the side of the boxes, not
    // thread back up through the middle of the diagram.
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'Check condition' },
        { id: 'b', label: 'Run body' },
        { id: 'c', label: 'Increment' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
      direction: 'TB',
    })
    const containerTypes = new Set(['rect', 'ellipse', 'diamond'])
    const containers = shapes.filter((s) => containerTypes.has(s.type))
    const arrows = shapes.filter((s) => s.type === 'arrow')
    const maxRight = Math.max(...containers.map((c) => c.x + c.width))

    // Some arrow (the back edge) runs out past the right edge of every box — a
    // clean return lane rather than a long line through the middle.
    const backEdge = arrows.find((arrow) => absPoints(arrow).some((p) => p.x > maxRight))
    expect(backEdge).toBeDefined()

    // Still, no arrow passes through the interior of any node box.
    for (const arrow of arrows) {
      const abs = absPoints(arrow)
      for (let i = 0; i < abs.length - 1; i++) {
        for (let s = 0; s <= 20; s++) {
          const t = s / 20
          const p = { x: abs[i].x + (abs[i + 1].x - abs[i].x) * t, y: abs[i].y + (abs[i + 1].y - abs[i].y) * t }
          for (const box of containers) expect(strictlyInside(p, box)).toBe(false)
        }
      }
    }
  })

  it('places edge labels clear of node boxes and of each other', () => {
    const shapes = layoutDiagram({
      nodes: [
        { id: 'd', label: 'Decide', shape: 'diamond' },
        { id: 'y', label: 'Yes path' },
        { id: 'n', label: 'No path' },
      ],
      edges: [
        { from: 'd', to: 'y', label: 'yes' },
        { from: 'd', to: 'n', label: 'no' },
      ],
    })
    const containerTypes = new Set(['rect', 'ellipse', 'diamond'])
    const containers = shapes.filter((s) => containerTypes.has(s.type))
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

    const yes = shapes.find((s) => s.type === 'text' && s.props.text === 'yes')!
    const no = shapes.find((s) => s.type === 'text' && s.props.text === 'no')!
    // Neither edge label overlaps any node container.
    for (const label of [yes, no]) {
      for (const box of containers) expect(overlaps(label, box)).toBe(false)
    }
    // The two edge labels don't overlap each other.
    expect(overlaps(yes, no)).toBe(false)
  })

  it('reduces crossings by reordering a layer (barycenter)', () => {
    // a,b on rank 0; c,d on rank 1; edges a→d and b→c cross under naive order.
    // Barycenter should place d left of c (a is left of b, and a→d), uncrossing.
    const shapes = layoutDiagram({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
        { id: 'd', label: 'D' },
      ],
      edges: [
        { from: 'a', to: 'd' },
        { from: 'b', to: 'c' },
      ],
    })
    const labelX = (t: string) =>
      shapes.find((s) => s.type === 'text' && s.props.text === t)!.x
    expect(labelX('A')).toBeLessThan(labelX('B'))
    // d sits left of c after crossing reduction.
    expect(labelX('D')).toBeLessThan(labelX('C'))
  })
})
