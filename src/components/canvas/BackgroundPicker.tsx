/**
 * BackgroundPicker — a small floating control (bottom-left, by the zoom cluster)
 * that lets each user choose the canvas background: a dotted grid, a lined grid,
 * or a plain solid surface. The choice is a per-user view preference (persisted
 * in localStorage by the editor), not board data.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, Grid2x2 } from 'lucide-react'
import { CANVAS_BACKGROUNDS, type CanvasBackground } from './types'

interface BackgroundPickerProps {
  value: CanvasBackground
  onChange: (value: CanvasBackground) => void
}

const LABELS: Record<CanvasBackground, string> = {
  dots: 'Dots',
  lines: 'Lines',
  solid: 'Solid',
}

/** A tiny swatch previewing each background style. */
const SWATCH_STYLE: Record<CanvasBackground, React.CSSProperties> = {
  dots: {
    backgroundColor: '#fff',
    backgroundImage: 'radial-gradient(#cbd2da 1px, transparent 1px)',
    backgroundSize: '6px 6px',
  },
  lines: {
    backgroundColor: '#fff',
    backgroundImage:
      'linear-gradient(#e2e6ea 1px, transparent 1px), linear-gradient(90deg, #e2e6ea 1px, transparent 1px)',
    backgroundSize: '6px 6px',
  },
  solid: { backgroundColor: '#fff' },
}

export function BackgroundPicker({ value, onChange }: BackgroundPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        data-testid="background-picker"
        onClick={() => setOpen((o) => !o)}
        title="Canvas background"
        aria-label="Canvas background"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/95 text-foreground/70 shadow-[0_4px_20px_rgba(26,26,46,0.10)] backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
      >
        <Grid2x2 className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-40 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-[0_8px_30px_rgba(26,26,46,0.18)]"
        >
          <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Background
          </div>
          {CANVAS_BACKGROUNDS.map((bg) => (
            <button
              key={bg}
              type="button"
              role="menuitemradio"
              aria-checked={value === bg}
              data-testid={`background-${bg}`}
              onClick={() => {
                onChange(bg)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-accent"
            >
              <span className="h-6 w-6 shrink-0 rounded border border-border" style={SWATCH_STYLE[bg]} />
              <span className="flex-1">{LABELS[bg]}</span>
              {value === bg && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
