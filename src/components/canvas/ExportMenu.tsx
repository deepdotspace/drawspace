/**
 * ExportMenu — floating export / copy / clear control for the active board.
 * Lives in the top-right of the canvas; opens a dropdown of document actions.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Copy, Download, FileDown, Image as ImageIcon, Trash2 } from 'lucide-react'

interface ExportMenuProps {
  shapeCount: number
  onExportSvg: () => void
  onExportPng: () => void
  onCopyImage: () => void
  onClearCanvas: () => void
  /** Whether the destructive "Clear canvas" action is offered (editors only). */
  canClear?: boolean
}

export function ExportMenu({
  shapeCount,
  onExportSvg,
  onExportPng,
  onCopyImage,
  onClearCanvas,
  canClear = true,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const empty = shapeCount === 0

  return (
    <div
      ref={ref}
      className="pointer-events-auto relative flex items-center rounded-xl border border-border bg-card/95 px-1 py-1 shadow-[0_4px_20px_rgba(26,26,46,0.10)] backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export & share"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-[0_8px_30px_rgba(26,26,46,0.18)]"
        >
          <MenuButton
            icon={FileDown}
            label="Export SVG"
            disabled={empty}
            onClick={() => {
              setOpen(false)
              onExportSvg()
            }}
          />
          <MenuButton
            icon={ImageIcon}
            label="Export PNG"
            disabled={empty}
            onClick={() => {
              setOpen(false)
              onExportPng()
            }}
          />
          <MenuButton
            icon={Copy}
            label="Copy as image"
            disabled={empty}
            onClick={() => {
              setOpen(false)
              onCopyImage()
            }}
          />
          {canClear && (
            <div className="border-t border-border">
              <MenuButton
                icon={Trash2}
                label="Clear canvas"
                disabled={empty}
                onClick={() => {
                  setOpen(false)
                  onClearCanvas()
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof FileDown
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground/80 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}
