/**
 * Canvas AI tool definitions + context / system-prompt helpers.
 *
 * Mirrors `tools.ts`: each tool is built with `tool()` from the `ai` package
 * and a `zod` `inputSchema`. The `execute` for every tool simply forwards to
 * the injected `executor(toolName, params)` — the server passes a
 * validate-only executor, the unit test passes a mock.
 *
 * Free of any worker-runtime import that touches Cloudflare globals: only
 * `ai`, `zod`, and local `./canvas-shape` types are imported.
 */

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import { SHAPE_DEFAULTS, CANVAS_SHAPE_TYPES } from './canvas-shape'
import { MAX_DIAGRAM_EDGES, MAX_DIAGRAM_NODES } from './diagram-layout'

type ToolExecutor = (toolName: string, params: Record<string, unknown>) => Promise<unknown>

// Derived from the single source of truth in `canvas-shape.ts` so the enum the
// model sees can never drift from the runtime validator / type.
const shapeTypeSchema = z.enum(CANVAS_SHAPE_TYPES)
const cornerSchema = z.enum(['nw', 'ne', 'sw', 'se'])

const createShapeSchema = z.object({
  type: shapeTypeSchema.describe(
    'Shape kind. Geometric: rect, ellipse, diamond, triangle, right-triangle, ' +
      'pentagon, hexagon, heptagon, octagon, trapezoid, parallelogram. Stars: ' +
      'star (5pt), star4, star6. Symbols: cross (plus), arrow-block, chevron. ' +
      'Connectors: line, arrow. Plus text. Pick the shape that best matches the ' +
      'real thing — e.g. triangle for a roof/mountain, star for a rating, ' +
      'trapezoid for a lampshade.',
  ),
  x: z.number().describe('Top-left X in canvas coordinates'),
  y: z.number().describe('Top-left Y in canvas coordinates'),
  width: z.number().describe('Width in canvas units (> 0)'),
  height: z.number().describe('Height in canvas units (> 0)'),
  fill: z.string().optional().describe('Fill color (default transparent)'),
  stroke: z.string().optional().describe('Stroke color (default #6366f1)'),
  strokeWidth: z.number().optional().describe('Stroke width (default 3)'),
  text: z.string().optional().describe('Text content (only for type "text")'),
  headCorner: cornerSchema.optional().describe('For line/arrow: which bbox corner the head points to'),
})

const createShapesSchema = z.object({
  shapes: z
    .array(createShapeSchema)
    .min(1)
    .max(100)
    .describe('Shapes to create in a single batch — far cheaper than one call per shape'),
})

const diagramNodeSchema = z.object({
  id: z.string().describe('Unique node id, referenced by edges'),
  label: z.string().describe('Text shown inside the node'),
  shape: z
    .enum(['rect', 'ellipse', 'diamond'])
    .optional()
    .describe('Node container: rect (process/component), diamond (decision), ellipse (start/end or datastore). Default rect.'),
})

const diagramEdgeSchema = z.object({
  from: z.string().describe('Source node id'),
  to: z.string().describe('Target node id'),
  label: z.string().optional().describe('Optional edge caption'),
})

const drawDiagramSchema = z.object({
  nodes: z.array(diagramNodeSchema).min(1).max(MAX_DIAGRAM_NODES).describe('All nodes in the diagram'),
  edges: z.array(diagramEdgeSchema).max(MAX_DIAGRAM_EDGES).optional().describe('Directed connections between nodes'),
  direction: z.enum(['TB', 'LR']).optional().describe('Flow direction: TB (top→bottom, default) or LR (left→right)'),
})

const updateShapeSchema = z.object({
  shapeId: z.string().describe('Id of the shape to update'),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  text: z.string().optional(),
})

const deleteShapeSchema = z.object({
  shapeId: z.string().describe('Id of the shape to delete'),
})

const listShapesSchema = z.object({})

/**
 * Build the canvas tool set. Registers six tools, all with underscore names (no
 * dots): canvas_drawDiagram, canvas_createShapes, canvas_createShape,
 * canvas_updateShape, canvas_deleteShape, canvas_listShapes. Each forwards to
 * `executor` with its own underscore tool name.
 */
export function buildCanvasTools(executor: ToolExecutor): ToolSet {
  return {
    canvas_drawDiagram: tool({
      description:
        'Draw an entire diagram (flowchart, system design, org chart, etc.) in ONE call. ' +
        'Describe the nodes and the edges between them; the canvas auto-lays-out positions and ' +
        'connecting arrows for you. Prefer this for anything with more than ~2 connected shapes.',
      inputSchema: drawDiagramSchema,
      execute: async (params: Record<string, unknown>) => executor('canvas_drawDiagram', params),
    }),
    canvas_createShapes: tool({
      description: 'Create many shapes at once (a batch). Use instead of calling canvas_createShape repeatedly.',
      inputSchema: createShapesSchema,
      execute: async (params: Record<string, unknown>) => executor('canvas_createShapes', params),
    }),
    canvas_createShape: tool({
      description: 'Create a single new shape on the canvas.',
      inputSchema: createShapeSchema,
      execute: async (params: Record<string, unknown>) => executor('canvas_createShape', params),
    }),
    canvas_updateShape: tool({
      description: 'Update an existing shape on the canvas by id.',
      inputSchema: updateShapeSchema,
      execute: async (params: Record<string, unknown>) => executor('canvas_updateShape', params),
    }),
    canvas_deleteShape: tool({
      description: 'Delete a shape from the canvas by id.',
      inputSchema: deleteShapeSchema,
      execute: async (params: Record<string, unknown>) => executor('canvas_deleteShape', params),
    }),
    canvas_listShapes: tool({
      description: 'List the shapes currently on the canvas.',
      inputSchema: listShapesSchema,
      execute: async (params: Record<string, unknown>) => executor('canvas_listShapes', params),
    }),
  }
}

// ============================================================================
// Context + system-prompt helpers
// ============================================================================

export interface CanvasContext {
  docId: string
  shapes: Array<{
    id: string
    type: string
    x: number
    y: number
    width: number
    height: number
    /** Fill color, when set. Lets the model act on "the blue box". */
    fill?: string
    /** Stroke color, when set. */
    stroke?: string
    /** Text content, for text shapes. */
    text?: string
  }>
  selectedShapeIds: string[]
}

/**
 * Compact textual summary of the canvas's current shapes, embedded by
 * `buildCanvasSystemPrompt`. Split out so it's independently testable.
 * Includes fill / stroke / text when present so the model can resolve
 * references like "the red circle" or "the node labelled Start".
 */
export function summarizeCanvasForPrompt(ctx: CanvasContext): string {
  if (ctx.shapes.length === 0) return '(empty canvas)'
  return ctx.shapes
    .map((s) => {
      const attrs: string[] = []
      if (s.stroke) attrs.push(`stroke=${s.stroke}`)
      if (s.fill && s.fill !== 'transparent') attrs.push(`fill=${s.fill}`)
      if (typeof s.text === 'string' && s.text.trim() !== '') attrs.push(`text="${s.text}"`)
      const suffix = attrs.length > 0 ? `, ${attrs.join(', ')}` : ''
      return `- ${s.id} (${s.type}) at x=${s.x}, y=${s.y}, ${s.width}x${s.height}${suffix}`
    })
    .join('\n')
}

/**
 * Build the canvas system-prompt block. Pure. Tells the model it can
 * create/edit/delete shapes, the coordinate space, what is currently
 * selected, and the available shape types + default style.
 */
export function buildCanvasSystemPrompt(ctx: CanvasContext): string {
  const lines: string[] = [
    'You can draw on a shared canvas using the canvas tools:',
    '- canvas_drawDiagram — build a WHOLE diagram (nodes + edges) in one call.',
    '- canvas_createShapes — create many shapes at once (a batch).',
    '- canvas_createShape, canvas_updateShape, canvas_deleteShape, canvas_listShapes.',
    '',
    'WHEN TO DRAW — match the output to the request:',
    '- Only draw when the user actually wants something visual (a diagram, a chart,',
    '  a picture, shapes, "draw/visualize/sketch this"). If they ask for CODE, an',
    '  explanation, or a plain text answer, just answer in chat and DRAW NOTHING.',
    '- When the request IS visual, ALWAYS produce a drawing — never reply with only',
    '  text describing what you would have drawn.',
    '',
    'HOW MUCH DETAIL — aim for "simple but detailed":',
    '- DIAGRAMS (flowcharts, system design, org charts): keep the node count',
    '  minimal — the fewest nodes that capture the idea (often 3–7). Do not invent',
    '  extra steps or branches the user did not ask for.',
    '- PICTURES (a house, a cat, a sun, a car): include the details that make the',
    '  subject recognizable — a house has a roof, a door, and windows; a face has',
    '  eyes, a nose, and a mouth; a sun has rays. Keep each part simple, but',
    '  include the parts. A single bare outline is NOT enough.',
    '',
    'IMPORTANT — choosing the right tool is the #1 thing that keeps drawings',
    'clean. Follow these as HARD RULES, not suggestions:',
    '- If ANY shapes are connected by arrows/lines — flowcharts, system design,',
    '  org charts, pipelines, state machines, ANYTHING with relationships — you',
    '  MUST call canvas_drawDiagram ONCE. Describe the nodes and the edges',
    '  between them; positions and connecting arrows are computed for you. NEVER',
    '  hand-place boxes and then draw arrows between them yourself — hand-placed',
    '  connectors come out tangled and pointing at nothing. Use shape "rect" for',
    '  a process/service/component, "diamond" for a decision, "ellipse" for a',
    '  start/end or datastore. direction "TB" (top→bottom) is the default; use',
    '  "LR" for left→right pipelines.',
    '- For several UNCONNECTED shapes, use canvas_createShapes ONCE (a single',
    '  batch). Do NOT emit many separate canvas_createShape calls — that stacks',
    '  them; batch instead.',
    '- Use canvas_createShape only for ONE single ad-hoc shape.',
    'Build the full picture in as few calls as possible rather than one shape',
    'per step.',
    '',
    'LAYOUT:',
    '- Connected or structured content is ALWAYS a canvas_drawDiagram, never a',
    '  hand-built canvas_createShapes. Do not fake a diagram by hand.',
    '- New shapes are automatically tucked into empty space below whatever is',
    '  already on the canvas, so you never need to dodge existing shapes.',
    '- For DIAGRAMS or a set of UNRELATED shapes in one canvas_createShapes batch,',
    '  give every element its own region on a tidy grid/row/column with generous',
    '  gaps (~40+ canvas units). Do not stack unrelated shapes at the same x/y.',
    '- For PICTURES, the parts are MEANT to touch and overlap — a roof sits on the',
    '  walls, windows sit inside the wall, rays touch the sun. Place each part',
    '  where it really belongs and let them overlap; that is correct composition,',
    '  not a mistake. Only avoid dropping two parts at the EXACT same spot by',
    '  accident.',
    '',
    'VISUAL STYLE — make drawings look finished, not like bare wireframes:',
    '- Give shapes in a PICTURE an explicit `fill` color so it reads as a finished',
    '  drawing (sky/water blue, grass green, sun yellow, warm neutral walls). The',
    '  default fill is transparent, which looks unfinished for a picture — so pass',
    '  a fill. Diagrams may stay unfilled (transparent/white) for clarity.',
    '- Use a small, harmonious palette and colors that match the real subject.',
    '- `stroke` is the outline color, `fill` is the interior; both take a hex code',
    '  ("#ffcc00") or a CSS color name ("gold").',
    '- Examples: a sun = a yellow-filled ellipse with orange lines radiating out; a',
    '  tree = a brown rect trunk under a green ellipse or triangle canopy; a house',
    '  = a filled rect for walls, a triangle roof, and contrasting door + windows.',
    '',
    'Coordinates are in canvas units: x/y is the shape\'s top-left corner, and',
    'width/height are positive sizes. Y increases downward.',
    `Available shape types: ${CANVAS_SHAPE_TYPES.join(', ')}.`,
    `Default style is fill="${SHAPE_DEFAULTS.fill}", stroke="${SHAPE_DEFAULTS.stroke}", strokeWidth=${SHAPE_DEFAULTS.strokeWidth}.`,
    'To recolor a shape, call canvas_updateShape with `fill` and/or `stroke`',
    '(a hex code like "#ff0000" or a CSS color name like "red"). Use the same',
    'tool to move (x/y), resize (width/height), or retitle (text) a shape.',
    'Always pass the EXACT shapeId from the "Current shapes" list below — never',
    'invent an id. If no listed shape matches the request, say so plainly rather',
    'than pretending you changed something; a tool call that targets a missing',
    'id returns an error, so do not claim success unless the tool result is ok.',
    `Canvas document: ${ctx.docId}.`,
  ]

  if (ctx.selectedShapeIds.length > 0) {
    lines.push(
      `The user has highlighted (selected) shapes: ${ctx.selectedShapeIds.join(', ')}.`,
      'When the request is about "this", "these", or "the selected" shape(s),',
      'operate on those selected shape id(s) above.',
    )
  } else {
    lines.push('No shapes are currently selected.')
  }

  lines.push('', 'Current shapes on the canvas:', summarizeCanvasForPrompt(ctx))

  return lines.join('\n')
}
