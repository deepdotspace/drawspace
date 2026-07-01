/**
 * ZoomControls — floating zoom cluster (bottom-left), Excalidraw-style.
 */

import { Minus, Plus } from 'lucide-react'

interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  return (
    <div className="pointer-events-auto flex items-center overflow-hidden rounded-xl border border-border bg-card/95 shadow-[0_4px_20px_rgba(26,26,46,0.10)] backdrop-blur">
      <button
        type="button"
        onClick={onZoomOut}
        title="Zoom out"
        aria-label="Zoom out"
        className="flex h-9 w-9 items-center justify-center text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onReset}
        title="Reset zoom"
        aria-label="Reset zoom to 100%"
        className="h-9 w-14 text-xs font-semibold tabular-nums text-foreground/80 transition-colors hover:bg-accent"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        title="Zoom in"
        aria-label="Zoom in"
        className="flex h-9 w-9 items-center justify-center text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}
