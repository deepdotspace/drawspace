/**
 * Toolbar — the floating tool picker. A vertical rounded pill docked to the
 * left edge of the canvas (centered), tldraw/Figma-style: a navigation group
 * (select / hand / draw), a divider, then the shape tools, with the extra geo
 * shapes tucked behind a "more shapes" flyout that opens to the right.
 */

import { useEffect, useRef, useState } from 'react'
import {
  MousePointer2,
  Hand,
  Square,
  Circle,
  Diamond,
  Shapes,
  ChevronRight,
  MoveUpRight,
  Minus,
  Type,
  Pencil,
  type LucideIcon,
} from 'lucide-react'
import type { Tool } from './types'
import { polygonPoints, type PolygonShape } from './geo'

interface ToolDef {
  id: Tool
  label: string
  key: string
  icon: LucideIcon
}

/** The navigation group (no shape is created by these). */
const NAV_TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'hand', label: 'Hand', key: 'H', icon: Hand },
  { id: 'draw', label: 'Draw', key: 'P', icon: Pencil },
]

/** The shape group (each creates a shape by dragging). */
const SHAPE_TOOLS: ToolDef[] = [
  { id: 'rect', label: 'Rectangle', key: 'R', icon: Square },
  { id: 'diamond', label: 'Diamond', key: 'D', icon: Diamond },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: MoveUpRight },
  { id: 'line', label: 'Line', key: 'L', icon: Minus },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
]

/** Extra geo shapes behind the "more shapes" flyout. Each renders a live
 *  mini-preview of the actual shape (so trapezoid/chevron/etc. look right
 *  without needing a matching icon font). */
const MORE_SHAPES: { id: PolygonShape; label: string }[] = [
  { id: 'triangle', label: 'Triangle' },
  { id: 'right-triangle', label: 'Right triangle' },
  { id: 'pentagon', label: 'Pentagon' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'heptagon', label: 'Heptagon' },
  { id: 'octagon', label: 'Octagon' },
  { id: 'trapezoid', label: 'Trapezoid' },
  { id: 'parallelogram', label: 'Parallelogram' },
  { id: 'star', label: 'Star' },
  { id: 'star4', label: '4-point star' },
  { id: 'star6', label: '6-point star' },
  { id: 'cross', label: 'Cross' },
  { id: 'arrow-block', label: 'Block arrow' },
  { id: 'chevron', label: 'Chevron' },
]

/** A small filled-outline preview of a polygon shape, for the flyout buttons. */
function ShapePreview({ type }: { type: PolygonShape }) {
  const pts = polygonPoints(type, { x: 3.5, y: 3.5, width: 17, height: 17 })
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <polygon
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface ToolbarProps {
  activeTool: Tool
  onToolChange: (t: Tool) => void
}

function ToolButton({
  tool,
  active,
  onToolChange,
}: {
  tool: ToolDef
  active: boolean
  onToolChange: (t: Tool) => void
}) {
  const Icon = tool.icon
  return (
    <button
      type="button"
      data-testid={`tool-${tool.id}`}
      onClick={() => onToolChange(tool.id)}
      title={`${tool.label} — ${tool.key}`}
      aria-label={tool.label}
      aria-pressed={active}
      className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-foreground/70 hover:bg-accent hover:text-foreground'
      }`}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </button>
  )
}

export function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  return (
    <div
      data-testid="canvas-toolbar"
      className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/95 p-1.5 shadow-[0_8px_28px_rgba(26,26,46,0.12)] backdrop-blur"
    >
      {NAV_TOOLS.map((tool) => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onToolChange={onToolChange} />
      ))}

      <span className="my-0.5 h-px w-6 bg-border" />

      {SHAPE_TOOLS.map((tool) => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onToolChange={onToolChange} />
      ))}

      <MoreShapes activeTool={activeTool} onToolChange={onToolChange} />
    </div>
  )
}

/**
 * "More shapes" flyout — a chevron button that opens a small grid of extra geo
 * shapes (triangle, pentagon, hexagon, star) to the right of the rail. Picking
 * one selects that draw tool and closes the menu. The button highlights while
 * one of its shapes is the active tool.
 */
function MoreShapes({ activeTool, onToolChange }: ToolbarProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = MORE_SHAPES.some((s) => s.id === activeTool)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        type="button"
        data-testid="tool-more-shapes"
        onClick={() => setOpen((o) => !o)}
        title="More shapes"
        aria-label="More shapes"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`group relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
          active || open
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground/70 hover:bg-accent hover:text-foreground'
        }`}
      >
        <Shapes className="h-[18px] w-[18px]" strokeWidth={1.75} />
        <ChevronRight className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5" strokeWidth={2.5} />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="more-shapes-menu"
          // Opens to the right of the rail, bottom-aligned with the lowest
          // button so it grows upward (clear of the canvas's bottom edge).
          //
          // `w-max` is load-bearing: `left: calc(100% + 8px)` pushes this popup
          // past its 36px containing block, so its auto width would resolve to
          // ~0 and the grid's minmax(0,1fr) columns would collapse — stacking
          // the fixed-width shape buttons on top of each other. Sizing to
          // content keeps the grid laid out. max-h guards a very short viewport.
          className="absolute bottom-0 left-[calc(100%+8px)] z-40 grid max-h-[70vh] w-max grid-cols-3 gap-1 overflow-y-auto rounded-2xl border border-border bg-card/95 p-1.5 shadow-[0_8px_30px_rgba(26,26,46,0.18)] backdrop-blur"
        >
          {MORE_SHAPES.map((s) => {
            const isActive = activeTool === s.id
            return (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                data-testid={`tool-${s.id}`}
                onClick={() => {
                  onToolChange(s.id)
                  setOpen(false)
                }}
                title={s.label}
                aria-label={s.label}
                aria-pressed={isActive}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/70 hover:bg-accent hover:text-foreground'
                }`}
              >
                <ShapePreview type={s.id} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
