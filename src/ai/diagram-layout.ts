/**
 * Diagram auto-layout — turns a graph the model describes (nodes + edges) into
 * positioned canvas shapes. This is the core of the "draw a full diagram in one
 * step" feature: the model never computes pixel coordinates (it's bad at it and
 * shapes overlap); it describes the *structure* and this module lays it out.
 *
 * Algorithm: a lightweight layered (Sugiyama-style) layout.
 *   1. Rank each node by longest path from a source (cycle-safe, capped).
 *   2. Group nodes into layers by rank, preserving the spec's order within a
 *      layer.
 *   3. Position layers along the "main" axis (flow direction) and center each
 *      layer along the "cross" axis.
 *   4. Emit one container shape + one centered text label per node, and one
 *      `arrow` per edge connecting the source/target anchors.
 *
 * Pure (spec in → shapes out, no I/O), so it runs identically on the server
 * (validate-only echo) and the client (applies the shapes to `useCanvas`).
 */

import { SHAPE_DEFAULTS, type NormalizedShape, type ShapeCorner } from './canvas-shape'

export type DiagramNodeShape = 'rect' | 'ellipse' | 'diamond'
export type DiagramDirection = 'TB' | 'LR'

export interface DiagramNode {
  id: string
  label: string
  /** Container shape — defaults to `rect`. Use `diamond` for decisions. */
  shape?: DiagramNodeShape
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
}

export interface DiagramSpec {
  nodes: DiagramNode[]
  edges?: DiagramEdge[]
  /** Flow direction: top→bottom (default) or left→right. */
  direction?: DiagramDirection
  /** Top-left origin in canvas coords. Defaults to (80, 80). */
  origin?: { x: number; y: number }
}

/** Guardrails — keep a single tool call from ballooning the canvas. */
export const MAX_DIAGRAM_NODES = 60
export const MAX_DIAGRAM_EDGES = 200

const NODE_HEIGHT = 56
const MIN_NODE_WIDTH = 120
const MAX_NODE_WIDTH = 300
const GAP_MAIN = 60 // between layers, along the flow axis
const GAP_CROSS = 36 // between nodes within a layer
/** Gap between the node block and the first back-edge return lane, plus the
 *  spacing between nested return lanes, so loop-back arrows nest cleanly on the
 *  side instead of cutting across the diagram. */
const SIDE_LANE_GAP = 28
const SIDE_LANE_STEP = 20
const CHAR_W = 8.5
const H_PADDING = 28
const LABEL_FONT = 16
const NODE_TEXT_COLOR = '#1b1b1f'
const NODE_FILL = '#ffffff'
const EDGE_LABEL_FONT = 14
/**
 * Cross-axis footprint of a dummy node — the virtual point a long edge passes
 * through on each layer it skips. It only needs to reserve a thin routing
 * channel (the surrounding `GAP_CROSS` does the real spacing), so it's kept
 * tiny and never rendered as a shape.
 */
const DUMMY_SIZE = 1

interface Placed {
  node: DiagramNode
  x: number
  y: number
  width: number
  height: number
}

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }

function nodeWidth(label: string): number {
  const w = Math.round(label.length * CHAR_W + H_PADDING * 2)
  return Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, w))
}

/** Per-node box dimensions. Dummy (routing) nodes shrink to a point. */
function nodeDims(node: DiagramNode, dummies: Set<string>): { w: number; h: number } {
  if (dummies.has(node.id)) return { w: DUMMY_SIZE, h: DUMMY_SIZE }
  return { w: nodeWidth(node.label), h: NODE_HEIGHT }
}

/**
 * Identify back edges (those pointing to an ancestor still on the DFS stack) —
 * i.e. the edges that close a cycle, such as a loop's "→ back to the condition".
 * Removing these before ranking turns the graph into a DAG so longest-path
 * ranking can't spin a cycle up to absurd ranks (which used to fling loop
 * diagrams thousands of pixels down the page). The back edges are still DRAWN —
 * they become side-lane return arrows in `buildRouting`. Iterative DFS so a deep
 * chain can't blow the call stack.
 */
function findBackEdges(nodes: DiagramNode[], edges: DiagramEdge[]): Set<DiagramEdge> {
  const ids = new Set(nodes.map((n) => n.id))
  const adj = new Map<string, DiagramEdge[]>()
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue
    const list = adj.get(e.from)
    if (list) list.push(e)
    else adj.set(e.from, [e])
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]))
  const back = new Set<DiagramEdge>()

  for (const start of nodes) {
    if (color.get(start.id) !== WHITE) continue
    const stack: Array<{ id: string; i: number }> = [{ id: start.id, i: 0 }]
    color.set(start.id, GRAY)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      const out = adj.get(top.id) ?? []
      if (top.i < out.length) {
        const e = out[top.i++]
        const c = color.get(e.to)
        if (c === GRAY) {
          back.add(e) // edge to an ancestor on the stack (incl. self-loop) → back edge
        } else if (c === WHITE) {
          color.set(e.to, GRAY)
          stack.push({ id: e.to, i: 0 })
        }
        // BLACK target → a forward/cross edge into an already-finished subtree; fine.
      } else {
        color.set(top.id, BLACK)
        stack.pop()
      }
    }
  }
  return back
}

/**
 * Longest-path ranking. Each node starts at rank 0; for every edge u→v we push
 * v to at least rank(u)+1. The caller passes an ACYCLIC edge set (back edges
 * removed), so this converges to true longest-path ranks; the `nodes.length`
 * cap is just a safety bound.
 */
function computeRanks(nodes: DiagramNode[], edges: DiagramEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id))
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to))
  const rank = new Map<string, number>(nodes.map((n) => [n.id, 0]))

  for (let iter = 0; iter < nodes.length; iter++) {
    let changed = false
    for (const e of valid) {
      const next = (rank.get(e.from) ?? 0) + 1
      if (next > (rank.get(e.to) ?? 0)) {
        rank.set(e.to, next)
        changed = true
      }
    }
    if (!changed) break
  }
  return rank
}

/** Group nodes by rank, preserving spec order within each layer. */
function groupLayers(nodes: DiagramNode[], rank: Map<string, number>): DiagramNode[][] {
  const byRank = new Map<number, DiagramNode[]>()
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0
    const list = byRank.get(r) ?? []
    list.push(n)
    byRank.set(r, list)
  }
  return [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r)!)
}

/**
 * Crossing reduction (barycenter heuristic). Reorder nodes WITHIN each layer so
 * neighbors sit near the average position of the nodes they connect to in the
 * adjacent layer — this is what untangles the connecting arrows. A few
 * alternating down/up sweeps converge to a low-crossing ordering; nodes with no
 * neighbors keep their current index (ties are stable). Mutates the layers in
 * place and returns them. No-op for single-node layers, so simple diagrams are
 * unchanged.
 */
function orderLayers(layers: DiagramNode[][], edges: DiagramEdge[]): DiagramNode[][] {
  const outNbrs = new Map<string, string[]>()
  const inNbrs = new Map<string, string[]>()
  const pushTo = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  for (const e of edges) {
    pushTo(outNbrs, e.from, e.to)
    pushTo(inNbrs, e.to, e.from)
  }

  const SWEEPS = 4
  for (let s = 0; s < SWEEPS; s++) {
    // Snapshot each node's index in its layer at the start of the sweep; the
    // adjacent layer is treated as fixed while we reorder the current one.
    const pos = new Map<string, number>()
    for (const layer of layers) layer.forEach((n, i) => pos.set(n.id, i))

    const downward = s % 2 === 0
    const order = downward
      ? Array.from({ length: layers.length }, (_, i) => i).slice(1)
      : Array.from({ length: layers.length }, (_, i) => layers.length - 2 - i).filter((i) => i >= 0)

    for (const li of order) {
      const nbrs = downward ? inNbrs : outNbrs
      sortLayerByBarycenter(layers[li], nbrs, pos)
    }
  }
  return layers
}

function sortLayerByBarycenter(
  layer: DiagramNode[],
  nbrs: Map<string, string[]>,
  pos: Map<string, number>,
): void {
  const bary = new Map<string, number>()
  layer.forEach((n, i) => {
    const ns = nbrs.get(n.id) ?? []
    const vals = ns.map((id) => pos.get(id)).filter((v): v is number => v !== undefined)
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : i
    bary.set(n.id, avg)
  })
  // Array.prototype.sort is stable in modern engines, so equal barycenters keep
  // their prior relative order (important for nodes with no neighbors).
  layer.sort((a, b) => (bary.get(a.id) ?? 0) - (bary.get(b.id) ?? 0))
}

/**
 * Place every node. Layers advance along the main axis; nodes within a layer
 * are distributed along the cross axis and the whole layer is centered so the
 * diagram reads as a balanced tree/flow.
 */
function placeNodes(
  layers: DiagramNode[][],
  direction: DiagramDirection,
  origin: { x: number; y: number },
  dummies: Set<string>,
): Map<string, Placed> {
  const placed = new Map<string, Placed>()
  const vertical = direction === 'TB'

  // Cross-axis span of each node (width for TB, height for LR) and the max
  // layer span so we can center shorter layers against the widest one. Dummy
  // nodes carry a tiny span but still consume a `GAP_CROSS` slot, which is what
  // opens an empty routing channel for the long edge that runs through them.
  const dim = (n: DiagramNode) => nodeDims(n, dummies)
  const crossSpan = (n: DiagramNode) => (vertical ? dim(n).w : dim(n).h)
  const layerSpan = (layer: DiagramNode[]) =>
    layer.reduce((sum, n) => sum + crossSpan(n), 0) + GAP_CROSS * Math.max(0, layer.length - 1)
  const maxSpan = Math.max(0, ...layers.map(layerSpan))

  // Main-axis step. TB advances by node height; LR advances by the widest real
  // node so variable-width columns never overlap. Dummies are excluded — their
  // 1px width must not shrink the column step.
  const realWidths = layers.flat().filter((n) => !dummies.has(n.id)).map((n) => nodeWidth(n.label))
  const maxNodeWidth = Math.max(MIN_NODE_WIDTH, ...realWidths)
  const mainStep = vertical ? NODE_HEIGHT + GAP_MAIN : maxNodeWidth + GAP_MAIN

  layers.forEach((layer, li) => {
    const main = (vertical ? origin.y : origin.x) + li * mainStep
    let cross = (vertical ? origin.x : origin.y) + (maxSpan - layerSpan(layer)) / 2

    for (const node of layer) {
      const { w, h } = dim(node)
      const span = crossSpan(node)
      const x = vertical ? cross : main
      const y = vertical ? main : cross
      placed.set(node.id, { node, x, y, width: w, height: h })
      cross += span + GAP_CROSS
    }
  })

  return placed
}

/**
 * Insert dummy nodes for every edge that spans more than one layer (textbook
 * Sugiyama). The long edge is replaced by a chain of unit-segments through one
 * dummy per skipped layer, so the edge participates in crossing reduction and
 * placement like any other and later routes through the empty channels the
 * dummies reserve — instead of slicing diagonally across the boxes between its
 * endpoints. Dummies are never emitted as shapes (server/client parity holds:
 * the shape set is still one container + label per real node, one arrow per
 * edge). Returns the augmented node list, the dummy id set, the per-segment
 * edges used for ordering, the rank lookup, and the routed chain per edge.
 */
interface Routing {
  allNodes: DiagramNode[]
  dummies: Set<string>
  segmentEdges: DiagramEdge[]
  rankOf: Map<string, number>
  chains: Map<DiagramEdge, string[]>
  /** Edges whose target is at or above the source (cycles / back edges / same
   *  rank). Routed as a side lane outside the boxes instead of through the
   *  forward channels — see `routeSideEdge`. */
  sideEdges: Set<DiagramEdge>
}

function buildRouting(nodes: DiagramNode[], edges: DiagramEdge[], rank: Map<string, number>): Routing {
  const ids = new Set(nodes.map((n) => n.id))
  const dummies = new Set<string>()
  const dummyNodes: DiagramNode[] = []
  const segmentEdges: DiagramEdge[] = []
  const chains = new Map<DiagramEdge, string[]>()
  const sideEdges = new Set<DiagramEdge>()
  const rankOf = new Map(rank)
  let counter = 0

  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue // unknown node → no arrow
    const rs = rank.get(e.from) ?? 0
    const rt = rank.get(e.to) ?? 0
    // Back edge (loop), self-loop, or same-rank: route on a side lane. It gets no
    // dummies and doesn't influence layer ordering, so a "back to condition"
    // arrow no longer threads up through the whole diagram.
    if (rt <= rs) {
      chains.set(e, [e.from, e.to])
      sideEdges.add(e)
      continue
    }
    // Forward, adjacent layers: a single elbow.
    if (rt - rs === 1) {
      segmentEdges.push(e)
      chains.set(e, [e.from, e.to])
      continue
    }
    // Forward across multiple layers: insert one dummy per skipped layer.
    const chain = [e.from]
    let prev = e.from
    for (let r = rs + 1; r !== rt; r += 1) {
      const id = `__dummy_${counter++}`
      dummies.add(id)
      rankOf.set(id, r)
      dummyNodes.push({ id, label: '' })
      chain.push(id)
      segmentEdges.push({ from: prev, to: id })
      prev = id
    }
    segmentEdges.push({ from: prev, to: e.to })
    chain.push(e.to)
    chains.set(e, chain)
  }

  return { allNodes: [...nodes, ...dummyNodes], dummies, segmentEdges, rankOf, chains, sideEdges }
}

function centeredLabel(p: Placed): NormalizedShape {
  // The label shape overlays the whole node box and is rendered centered +
  // word-wrapped + shrink-to-fit (`fit: 'shrink'`), so a long label wraps and
  // scales to stay inside the node instead of overflowing it.
  return {
    type: 'text',
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    props: {
      text: p.node.label,
      fill: 'transparent',
      stroke: NODE_TEXT_COLOR,
      fontSize: LABEL_FONT,
      align: 'center',
      valign: 'middle',
      fit: 'shrink',
    },
  }
}

function container(p: Placed): NormalizedShape {
  return {
    type: p.node.shape ?? 'rect',
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    props: { fill: NODE_FILL, stroke: SHAPE_DEFAULTS.stroke, strokeWidth: SHAPE_DEFAULTS.strokeWidth },
  }
}

/** Center of a placed node. */
function centerOf(p: Placed): { x: number; y: number } {
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 }
}

/**
 * Anchor on the face of `p` that points TOWARD `toward`. Picking the side that
 * faces the other node (instead of always bottom→top) keeps an arrow from
 * leaving a face that points away from its target — the main source of
 * "arrows going the wrong way / cutting across their own box". For a node
 * directly below its parent this still yields bottom-then-top, matching the
 * classic flow look.
 */
function faceAnchor(p: Placed, toward: { x: number; y: number }): { x: number; y: number } {
  const c = centerOf(p)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: p.x + p.width, y: c.y } : { x: p.x, y: c.y }
  }
  return dy >= 0 ? { x: c.x, y: p.y + p.height } : { x: c.x, y: p.y }
}

/** Drop consecutive duplicate points so a collapsed elbow is a clean polyline. */
function dedupePoints(pts: Point[]): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  return out.length >= 2 ? out : pts
}

/**
 * Orthogonal (Manhattan) route along a chain of placed boxes: the source, the
 * dummy nodes for each skipped layer, then the target. The line leaves the
 * source face, drops to the middle of each inter-layer channel, slides across
 * to the next chain node's cross position, and threads vertically through that
 * node's reserved slot — so it only ever runs through the empty channels and
 * the gaps the dummies opened, never across a box. For a plain adjacent-layer
 * edge the chain is just [source, target] and this collapses to the familiar
 * single elbow.
 */
function routePolyline(chain: Placed[], direction: DiagramDirection): Point[] {
  const vertical = direction === 'TB'
  const crossOf = (p: Point) => (vertical ? p.x : p.y)
  const make = (main: number, cross: number): Point => (vertical ? { x: cross, y: main } : { x: main, y: cross })
  const mainCenter = (pl: Placed) => (vertical ? pl.y + pl.height / 2 : pl.x + pl.width / 2)
  const crossCenter = (pl: Placed) => (vertical ? pl.x + pl.width / 2 : pl.y + pl.height / 2)

  const first = chain[0]
  const last = chain[chain.length - 1]
  const a = faceAnchor(first, centerOf(chain[1]))
  const b = faceAnchor(last, centerOf(chain[chain.length - 2]))

  const pts: Point[] = [a]
  let prevCross = crossOf(a)
  for (let i = 0; i < chain.length - 1; i++) {
    // Mid of the channel between two consecutive chain nodes (direction-safe:
    // the midpoint of their main-axis centers lands in the gap between layers).
    const channelMain = (mainCenter(chain[i]) + mainCenter(chain[i + 1])) / 2
    const isLast = i + 1 === chain.length - 1
    const nextCross = isLast ? crossOf(b) : crossCenter(chain[i + 1])
    pts.push(make(channelMain, prevCross))
    pts.push(make(channelMain, nextCross))
    prevCross = nextCross
  }
  pts.push(b)
  return dedupePoints(pts)
}

/**
 * Route a back/cycle/same-rank edge as a clean orthogonal lane OUTSIDE the node
 * block: it leaves the source's outer face (right for TB, bottom for LR), runs
 * out to `lane`, travels along the flow axis to the target, and comes back in.
 * This keeps loop-back arrows (e.g. "→ back to the condition") off the forward
 * channels and off the boxes, instead of drawing one long line across the page.
 */
function routeSideEdge(from: Placed, to: Placed, lane: number, direction: DiagramDirection): Point[] {
  const vertical = direction === 'TB'
  const outerFace = (p: Placed) => (vertical ? p.x + p.width : p.y + p.height)
  const mainCenter = (p: Placed) => (vertical ? p.y + p.height / 2 : p.x + p.width / 2)
  const mainSpan = (p: Placed) => (vertical ? p.height : p.width)
  // `cross` is the lane/face axis; `main` is the flow axis.
  const pt = (cross: number, main: number): Point => (vertical ? { x: cross, y: main } : { x: main, y: cross })

  if (from === to) {
    // Self-loop: a small bump out the side, anchored above/below the center.
    const c = mainCenter(from)
    const off = Math.max(10, mainSpan(from) * 0.25)
    const face = outerFace(from)
    return [pt(face, c - off), pt(lane, c - off), pt(lane, c + off), pt(face, c + off)]
  }
  const aMain = mainCenter(from)
  const bMain = mainCenter(to)
  return dedupePoints([
    pt(outerFace(from), aMain),
    pt(lane, aMain),
    pt(lane, bMain),
    pt(outerFace(to), bMain),
  ])
}

function arrowFromRoute(route: Point[]): NormalizedShape {
  const xs = route.map((p) => p.x)
  const ys = route.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const width = Math.max(Math.max(...xs) - minX, 1)
  const height = Math.max(Math.max(...ys) - minY, 1)
  // Waypoints are stored bbox-relative (origin at 0,0), same convention as the
  // freehand `draw` shape, so the connector moves/resizes with its endpoints.
  const points = route.map((p) => ({ x: p.x - minX, y: p.y - minY }))
  const a = route[0]
  const b = route[route.length - 1]
  const horiz = b.x >= a.x ? 'e' : 'w'
  const vert = b.y >= a.y ? 's' : 'n'
  const headCorner = (vert + horiz) as ShapeCorner
  return {
    type: 'arrow',
    x: minX,
    y: minY,
    width,
    height,
    props: { fill: 'transparent', stroke: SHAPE_DEFAULTS.stroke, strokeWidth: SHAPE_DEFAULTS.strokeWidth, headCorner, points },
  }
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Point at half the arc-length of the route — its visual middle, which for a
 *  routed edge sits in a channel rather than inside an endpoint box. */
function routeMidpoint(route: Point[]): Point {
  const segs: number[] = []
  let total = 0
  for (let i = 0; i < route.length - 1; i++) {
    const len = Math.hypot(route[i + 1].x - route[i].x, route[i + 1].y - route[i].y)
    segs.push(len)
    total += len
  }
  if (total === 0) return route[0]
  let target = total / 2
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const t = segs[i] === 0 ? 0 : target / segs[i]
      return { x: route[i].x + (route[i + 1].x - route[i].x) * t, y: route[i].y + (route[i + 1].y - route[i].y) * t }
    }
    target -= segs[i]
  }
  return route[route.length - 1]
}

/**
 * Place an edge label near the route's midpoint but nudged into free space:
 * it searches outward in rings until it finds a spot that overlaps neither a
 * node box nor an already-placed edge label (the raw-midpoint drop used to land
 * on top of boxes and arrows). The chosen rectangle is appended to `obstacles`
 * so the next label avoids it too. Pure and deterministic.
 */
function placeEdgeLabel(route: Point[], label: string, obstacles: Rect[]): NormalizedShape {
  // Size the box to comfortably fit the caption on ONE line: the text renderer
  // wraps at ~0.54·fontSize per char and trims box padding, so a too-tight box
  // (the old ~8px/char) made short labels like "yes"/"no" break onto two lines.
  const width = Math.max(28, Math.round(label.length * EDGE_LABEL_FONT * 0.62) + 14)
  const height = Math.round(EDGE_LABEL_FONT * 1.4)
  const mid = routeMidpoint(route)
  const baseX = mid.x + 6
  const baseY = mid.y - height
  const stepX = width * 0.7 + 8
  const stepY = height + 6
  // Ring 0 is the natural spot; later rings fan out along the cardinal then
  // diagonal directions. Deterministic order → deterministic placement.
  const dirs = [
    [0, 0],
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [1, -1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ]
  for (let ring = 0; ring < 12; ring++) {
    for (const [ox, oy] of dirs) {
      const x = baseX + ox * ring * stepX
      const y = baseY + oy * ring * stepY
      const box: Rect = { x, y, width, height }
      if (!obstacles.some((o) => rectsIntersect(box, o))) {
        obstacles.push(box)
        return edgeLabelShape(x, y, width, height, label)
      }
      if (ring === 0) break // ring 0 is a single point; don't re-test it
    }
  }
  obstacles.push({ x: baseX, y: baseY, width, height })
  return edgeLabelShape(baseX, baseY, width, height, label)
}

function edgeLabelShape(x: number, y: number, width: number, height: number, label: string): NormalizedShape {
  return {
    type: 'text',
    x,
    y,
    width,
    height,
    props: { text: label, fill: 'transparent', stroke: NODE_TEXT_COLOR, fontSize: EDGE_LABEL_FONT },
  }
}

/**
 * Lay out a diagram spec into positioned shapes. Throws on an empty spec or one
 * that exceeds the node/edge caps. Output order is back-to-front: arrows, then
 * node containers, then labels — so labels sit on top and arrows tuck behind the
 * boxes they connect.
 */
export function layoutDiagram(spec: DiagramSpec): NormalizedShape[] {
  if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    throw new Error('Diagram requires at least one node')
  }
  if (spec.nodes.length > MAX_DIAGRAM_NODES) {
    throw new Error(`Diagram exceeds ${MAX_DIAGRAM_NODES} nodes`)
  }
  const edges = spec.edges ?? []
  if (edges.length > MAX_DIAGRAM_EDGES) {
    throw new Error(`Diagram exceeds ${MAX_DIAGRAM_EDGES} edges`)
  }
  for (const n of spec.nodes) {
    if (!n || typeof n.id !== 'string' || n.id === '') throw new Error('Each diagram node needs a non-empty id')
    if (typeof n.label !== 'string') throw new Error(`Node "${n.id}" needs a string label`)
  }

  const direction: DiagramDirection = spec.direction === 'LR' ? 'LR' : 'TB'
  const origin = spec.origin ?? { x: 80, y: 80 }

  // Rank on the DAG only (back edges removed) so a cycle can't inflate ranks and
  // fling nodes down the page. Back edges are still drawn — as side-lane returns.
  const backEdges = findBackEdges(spec.nodes, edges)
  const forwardEdges = edges.filter((e) => !backEdges.has(e))
  const rank = computeRanks(spec.nodes, forwardEdges)
  // Insert dummy nodes for layer-skipping edges, then order + place the
  // augmented graph so long edges get their own routing channels.
  const routing = buildRouting(spec.nodes, edges, rank)
  const layers = orderLayers(groupLayers(routing.allNodes, routing.rankOf), routing.segmentEdges)
  const placed = placeNodes(layers, direction, origin, routing.dummies)

  // Real node boxes seed the edge-label obstacle set so labels never land on a
  // container; each placed label is then added so later labels avoid it too.
  // Also track the block's outer edge so side-lane (back) edges nest just past it.
  const vertical = direction === 'TB'
  const labelObstacles: Rect[] = []
  let outerEdge = -Infinity
  for (const n of spec.nodes) {
    const p = placed.get(n.id)
    if (p) {
      labelObstacles.push({ x: p.x, y: p.y, width: p.width, height: p.height })
      outerEdge = Math.max(outerEdge, vertical ? p.x + p.width : p.y + p.height)
    }
  }
  const laneBase = (Number.isFinite(outerEdge) ? outerEdge : (vertical ? origin.x : origin.y)) + SIDE_LANE_GAP

  const arrows: NormalizedShape[] = []
  const labels: NormalizedShape[] = []
  let sideLaneIdx = 0
  for (const e of edges) {
    const chainIds = routing.chains.get(e)
    if (!chainIds) continue // edge referencing an unknown node — skipped in routing
    const chain = chainIds.map((id) => placed.get(id)).filter((p): p is Placed => p !== undefined)
    if (chain.length < 2) continue
    let route: Point[]
    if (routing.sideEdges.has(e)) {
      // Nest successive return lanes outward so multiple loops don't overlap.
      const lane = laneBase + sideLaneIdx * SIDE_LANE_STEP
      sideLaneIdx++
      route = routeSideEdge(chain[0], chain[chain.length - 1], lane, direction)
    } else {
      route = routePolyline(chain, direction)
    }
    arrows.push(arrowFromRoute(route))
    if (e.label && e.label.trim() !== '') labels.push(placeEdgeLabel(route, e.label, labelObstacles))
  }

  const containers: NormalizedShape[] = []
  const nodeLabels: NormalizedShape[] = []
  for (const n of spec.nodes) {
    const p = placed.get(n.id)
    if (!p) continue
    containers.push(container(p))
    nodeLabels.push(centeredLabel(p))
  }

  return [...arrows, ...containers, ...nodeLabels, ...labels]
}
