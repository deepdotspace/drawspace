/**
 * Shape — renders one canvas shape as SVG. Supports rect, ellipse, diamond,
 * arrow, line, and text. Arrows/lines store which bbox corner the endpoint
 * sits on (`props.headCorner`) so direction survives move/resize.
 *
 * Purely presentational: the whole group is `pointer-events: none`. All
 * interaction (selection, move, resize) is hit-tested in JS by DrawCanvas
 * against a single full-size background rect, so pointer events never get
 * intercepted by individual shape elements.
 */

import type { CanvasShapeClient } from 'deepspace'
import { arrowHeadPoints, cornerPoint, oppositeCorner, type Box, type Corner, type Point } from './types'
import { CANVAS_COLORS } from './theme'
import { pointsToPath, bboxFromPoints } from './freehand'
import { layoutText } from './text-layout'
import { isPolygonShape, polygonPoints } from './geo'

interface ShapeProps {
  shape: CanvasShapeClient
  isSelected: boolean
  /** True while this shape's text is being edited inline — suppress the SVG
   *  text so it doesn't render *under* the editing textarea (double vision). */
  isEditing?: boolean
}

function box(shape: CanvasShapeClient): Box {
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
}

export function Shape({ shape, isSelected, isEditing }: ShapeProps) {
  const fill = (shape.props.fill as string) ?? 'transparent'
  const stroke = (shape.props.stroke as string) ?? CANVAS_COLORS.defaultStroke
  const strokeWidth = (shape.props.strokeWidth as number) ?? 2
  const b = box(shape)

  const common = {
    fill,
    stroke,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  }

  return (
    <g data-testid={`shape-${shape.id}`} style={{ pointerEvents: 'none' }}>
      {shape.type === 'rect' && (
        <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={Math.min(12, b.width / 6, b.height / 6)} {...common} />
      )}

      {shape.type === 'ellipse' && (
        <ellipse cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} {...common} />
      )}

      {shape.type === 'diamond' && (
        <polygon
          points={`${b.x + b.width / 2},${b.y} ${b.x + b.width},${b.y + b.height / 2} ${b.x + b.width / 2},${b.y + b.height} ${b.x},${b.y + b.height / 2}`}
          {...common}
        />
      )}

      {isPolygonShape(shape.type) && (
        <polygon points={polygonPoints(shape.type, b).map((p) => `${p.x},${p.y}`).join(' ')} {...common} />
      )}

      {(shape.type === 'line' || shape.type === 'arrow') && (
        <LineOrArrow shape={shape} stroke={stroke} strokeWidth={strokeWidth} withHead={shape.type === 'arrow'} />
      )}

      {shape.type === 'draw' && <Freehand shape={shape} stroke={stroke} strokeWidth={strokeWidth} />}

      {shape.type === 'text' && !isEditing && <TextBlock shape={shape} color={stroke} />}

      {isSelected && !isEditing && <SelectionOutline shape={shape} />}
    </g>
  )
}

function LineOrArrow({
  shape,
  stroke,
  strokeWidth,
  withHead,
}: {
  shape: CanvasShapeClient
  stroke: string
  strokeWidth: number
  withHead: boolean
}) {
  const b = box(shape)

  // Bent connector: when waypoints are present, draw a polyline through them
  // (reusing the freehand bbox→points scaling so it moves/resizes correctly)
  // and put the arrowhead on the LAST segment.
  const pts = (Array.isArray(shape.props.points) ? shape.props.points : []) as Point[]
  if (pts.length >= 2) {
    const nb = bboxFromPoints(pts)
    const sx = nb.width ? shape.width / nb.width : 1
    const sy = nb.height ? shape.height / nb.height : 1
    const tx = shape.x - nb.x * sx
    const ty = shape.y - nb.y * sy
    const abs = pts.map((p) => ({ x: tx + p.x * sx, y: ty + p.y * sy }))
    const end = abs[abs.length - 1]
    const prev = abs[abs.length - 2]
    return (
      <g>
        <polyline
          points={abs.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {withHead && <ArrowHead tip={end} prev={prev} color={stroke} strokeWidth={strokeWidth} />}
      </g>
    )
  }

  const headCorner = (shape.props.headCorner as Corner) ?? 'se'
  const end = cornerPoint(b, headCorner)
  const start = cornerPoint(b, oppositeCorner(headCorner))

  return (
    <g>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {withHead && <ArrowHead tip={end} prev={start} color={stroke} strokeWidth={strokeWidth} />}
    </g>
  )
}

/**
 * A bold, filled triangular arrowhead (tldraw-style) at `tip`, pointing away
 * from `prev`. Geometry comes from the shared `arrowHeadPoints` helper so the
 * on-screen head and the SVG-exported head are always identical. Renders
 * nothing for a degenerate final segment.
 */
function ArrowHead({ tip, prev, color, strokeWidth }: { tip: Point; prev: Point; color: string; strokeWidth: number }) {
  const head = arrowHeadPoints(tip, prev, strokeWidth)
  if (!head) return null
  return (
    <polygon
      points={`${head.tip.x},${head.tip.y} ${head.left.x},${head.left.y} ${head.right.x},${head.right.y}`}
      fill={color}
      stroke={color}
      strokeWidth={Math.min(strokeWidth, 2)}
      strokeLinejoin="round"
    />
  )
}

/** Horizontal inset so glyphs don't kiss the box edge. */
const TEXT_PAD_X = 4

/**
 * Render a `text` shape's content word-wrapped to its box width. Free text
 * (default) wraps at its font size and grows downward (the editor syncs the box
 * height); a bounded label (`props.fit === 'shrink'`, used by diagram nodes)
 * shrinks the font so it always fits. `props.align`/`props.valign` center the
 * block for labels; plain text stays top-left.
 */
function TextBlock({ shape, color }: { shape: CanvasShapeClient; color: string }) {
  const raw = (shape.props.text as string) || 'Text'
  const baseFont = (shape.props.fontSize as number) ?? 20
  const align = shape.props.align === 'center' ? 'center' : 'left'
  const valign = shape.props.valign === 'middle' ? 'middle' : 'top'
  const shrink = shape.props.fit === 'shrink'

  const innerW = Math.max(8, shape.width - TEXT_PAD_X * 2)
  const heightBudget = shrink ? Math.max(shape.height, baseFont) : Number.POSITIVE_INFINITY
  const { lines, fontSize, lineHeight } = layoutText(raw, innerW, heightBudget, baseFont)

  const totalH = lines.length * lineHeight
  const anchorX = align === 'center' ? shape.x + shape.width / 2 : shape.x + TEXT_PAD_X
  const top = valign === 'middle' ? shape.y + Math.max(0, (shape.height - totalH) / 2) : shape.y
  // ~0.82·fontSize drops the first baseline so the cap height sits in the line box.
  const firstBaseline = top + fontSize * 0.82

  return (
    <text
      fill={color}
      fontSize={fontSize}
      fontFamily="'Architects Daughter', cursive"
      textAnchor={align === 'center' ? 'middle' : 'start'}
      style={{ userSelect: 'none' }}
    >
      {lines.map((ln, i) => (
        <tspan key={i} x={anchorX} y={firstBaseline + i * lineHeight}>
          {ln === '' ? ' ' : ln}
        </tspan>
      ))}
    </text>
  )
}

function Freehand({
  shape,
  stroke,
  strokeWidth,
}: {
  shape: CanvasShapeClient
  stroke: string
  strokeWidth: number
}) {
  const pts = (Array.isArray(shape.props.points) ? shape.props.points : []) as Point[]
  if (pts.length === 0) return null
  // Points are stored relative to the bbox origin; scale them to the shape's
  // current width/height so freehand strokes move and resize like other shapes.
  const nb = bboxFromPoints(pts)
  const sx = nb.width ? shape.width / nb.width : 1
  const sy = nb.height ? shape.height / nb.height : 1
  const tx = shape.x - nb.x * sx
  const ty = shape.y - nb.y * sy
  return (
    <path
      d={pointsToPath(pts)}
      transform={`translate(${tx} ${ty}) scale(${sx} ${sy})`}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  )
}

function SelectionOutline({ shape }: { shape: CanvasShapeClient }) {
  const pad = 6
  const b = box(shape)
  return (
    <rect
      x={b.x - pad}
      y={b.y - pad}
      width={b.width + pad * 2}
      height={b.height + pad * 2}
      fill="none"
      stroke="var(--color-primary)"
      strokeWidth={1.5}
      strokeDasharray="6 4"
      rx={4}
      vectorEffect="non-scaling-stroke"
    />
  )
}
