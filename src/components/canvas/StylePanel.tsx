/**
 * StylePanel — the floating properties panel on the left, shown while a drawing
 * tool is active or a shape is selected. Mirrors Excalidraw's left rail: stroke
 * color, background fill, stroke width, plus quick actions on a selection.
 */

import { useRef } from 'react'
import type { CanvasShapeClient } from 'deepspace'
import { BringToFront, ChevronDown, ChevronUp, Copy, Minus, Plus, SendToBack, Trash2 } from 'lucide-react'
import type { ShapeStyle } from './types'
import type { ReorderKind } from './z-order'

// Font-size "stops" the −/+ stepper moves through (px). Spans from small labels
// to large headings so text can be made clearly bigger or smaller.
const FONT_SCALE = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 120, 144]

function stepFont(current: number, dir: 1 | -1): number {
  if (dir < 0) {
    const prev = [...FONT_SCALE].reverse().find((s) => s < current)
    return prev ?? FONT_SCALE[0]
  }
  return FONT_SCALE.find((s) => s > current) ?? FONT_SCALE[FONT_SCALE.length - 1]
}

// Curated preset swatches; any other color is reachable via the custom-color
// swatch (the rainbow chip at the end of the row, which opens the OS color
// picker). The first entry matches DEFAULT_STYLE so the default reads as a
// preset, not "custom". Keep '#1b1b1f' / 'transparent' first.
const STROKE_COLORS = ['#1b1b1f', '#868e96', '#e03131', '#f08c00', '#f2c037', '#2f9e44', '#1971c2', '#7048e8', '#e64980']
const FILL_COLORS = ['transparent', '#ffc9c9', '#ffd8a8', '#ffec99', '#b2f2bb', '#96f2d7', '#a5d8ff', '#d0bfff', '#fcc2d7']
// Includes the default (3) so the active width is always represented and
// reachable. Keep in sync with DEFAULT_STYLE.strokeWidth in types.ts.
const STROKE_WIDTHS: { value: number; label: string }[] = [
  { value: 2, label: 'Thin' },
  { value: 3, label: 'Bold' },
  { value: 5, label: 'Extra' },
  { value: 8, label: 'Huge' },
]

interface StylePanelProps {
  style: ShapeStyle
  onStyleChange: (patch: Partial<ShapeStyle>) => void
  selectedShape: CanvasShapeClient | null
  showFill: boolean
  onDuplicate: () => void
  onDelete: () => void
  /** Change the stacking order of the current selection. */
  onReorder: (kind: ReorderKind) => void
}

export function StylePanel({
  style,
  onStyleChange,
  selectedShape,
  showFill,
  onDuplicate,
  onDelete,
  onReorder,
}: StylePanelProps) {
  const isText = selectedShape?.type === 'text'
  return (
    <div
      data-testid="style-panel"
      className="pointer-events-auto w-56 rounded-2xl border border-border bg-card/95 p-3.5 shadow-[0_4px_20px_rgba(26,26,46,0.10)] backdrop-blur"
    >
      <Section label="Stroke">
        <ColorRow value={style.stroke} presets={STROKE_COLORS} onChange={(c) => onStyleChange({ stroke: c })} />
      </Section>

      {showFill && !isText && (
        <Section label="Background">
          <ColorRow value={style.fill} presets={FILL_COLORS} onChange={(c) => onStyleChange({ fill: c })} />
        </Section>
      )}

      {!isText && (
        <Section label="Stroke width">
          <div className="flex gap-1.5">
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => onStyleChange({ strokeWidth: w.value })}
                aria-pressed={style.strokeWidth === w.value}
                title={w.label}
                className={`flex h-8 flex-1 items-center justify-center rounded-lg border transition-colors ${
                  style.strokeWidth === w.value
                    ? 'border-primary bg-accent'
                    : 'border-border hover:bg-accent/60'
                }`}
              >
                <span className="rounded-full bg-foreground" style={{ width: 20, height: w.value + 1 }} />
              </button>
            ))}
          </div>
        </Section>
      )}

      {isText && (
        <Section label="Text size">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="font-smaller"
              onClick={() => onStyleChange({ fontSize: stepFont(style.fontSize, -1) })}
              disabled={style.fontSize <= FONT_SCALE[0]}
              title="Smaller text"
              aria-label="Smaller text"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground/80 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="flex-1 text-center text-sm font-semibold tabular-nums text-foreground">
              {Math.round(style.fontSize)}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">px</span>
            </div>
            <button
              type="button"
              data-testid="font-larger"
              onClick={() => onStyleChange({ fontSize: stepFont(style.fontSize, 1) })}
              disabled={style.fontSize >= FONT_SCALE[FONT_SCALE.length - 1]}
              title="Larger text"
              aria-label="Larger text"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground/80 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </Section>
      )}

      {selectedShape && (
        <Section label="Arrange">
          <div className="flex gap-1.5">
            <ArrangeButton title="Bring to front" onClick={() => onReorder('front')}>
              <BringToFront className="h-3.5 w-3.5" />
            </ArrangeButton>
            <ArrangeButton title="Bring forward" onClick={() => onReorder('forward')}>
              <ChevronUp className="h-4 w-4" />
            </ArrangeButton>
            <ArrangeButton title="Send backward" onClick={() => onReorder('backward')}>
              <ChevronDown className="h-4 w-4" />
            </ArrangeButton>
            <ArrangeButton title="Send to back" onClick={() => onReorder('back')}>
              <SendToBack className="h-3.5 w-3.5" />
            </ArrangeButton>
          </div>
        </Section>
      )}

      {selectedShape && (
        <div className="mt-3 flex gap-1.5 border-t border-border pt-3">
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicate"
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-xs font-medium text-foreground/80 transition-colors hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </button>
          <button
            type="button"
            data-testid="delete-shape"
            onClick={onDelete}
            title="Delete"
            className="flex h-8 w-9 items-center justify-center rounded-lg border border-border text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function ArrangeButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-8 flex-1 items-center justify-center rounded-lg border border-border text-foreground/80 transition-colors hover:bg-accent"
    >
      {children}
    </button>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

/** A row of preset color swatches plus a custom-color chip (opens the OS color
 *  picker) so any color is reachable without listing them all. */
function ColorRow({
  value,
  presets,
  onChange,
}: {
  value: string
  presets: string[]
  onChange: (color: string) => void
}) {
  const isCustom = !presets.includes(value)
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((c) => (
        <Swatch key={c} color={c} active={value === c} onClick={() => onChange(c)} />
      ))}
      <CustomColorSwatch
        // input[type=color] needs a #rrggbb value; fall back when the current
        // value is 'transparent' or otherwise non-hex.
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
        active={isCustom}
        onChange={onChange}
      />
    </div>
  )
}

/** The custom-color chip: a rainbow swatch that opens the native color picker;
 *  shows the chosen color (with a ring) when a non-preset color is active. */
function CustomColorSwatch({
  value,
  active,
  onChange,
}: {
  value: string
  active: boolean
  onChange: (color: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      title="Custom color"
      aria-label="Pick a custom color"
      className={`relative h-6 w-6 overflow-hidden rounded-lg border transition-transform hover:scale-110 ${
        active ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : 'border-border'
      }`}
      style={
        active
          ? { backgroundColor: value }
          : {
              backgroundImage:
                'conic-gradient(from 90deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
            }
      }
    >
      <input
        ref={ref}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
    </button>
  )
}

function Swatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  const transparent = color === 'transparent'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={transparent ? 'Transparent' : color}
      className={`relative h-6 w-6 rounded-lg border transition-transform hover:scale-110 ${
        active ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : 'border-border'
      }`}
      style={
        transparent
          ? {
              backgroundImage:
                'linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%)',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0,0 4px,4px -4px,-4px 0',
            }
          : { backgroundColor: color }
      }
    />
  )
}
