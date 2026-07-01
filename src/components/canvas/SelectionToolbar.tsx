/**
 * SelectionToolbar — the contextual mini-toolbar that floats just above the
 * current selection (Figma/the new Drawspace design). Quick actions on the
 * selected shape(s): duplicate, copy, delete, and "Ask AI" to hand the
 * selection to the assistant. Positioning is done by the editor, which knows
 * the selection's on-screen bounds.
 */

import { Copy, CopyPlus, Sparkles, Trash2 } from 'lucide-react'

interface SelectionToolbarProps {
  /** Number of selected shapes (for labelling / pluralisation). */
  count: number
  onDuplicate: () => void
  onCopy: () => void
  onDelete: () => void
  onAskAi: () => void
}

export function SelectionToolbar({ count, onDuplicate, onCopy, onDelete, onAskAi }: SelectionToolbarProps) {
  return (
    <div
      data-testid="selection-toolbar"
      role="toolbar"
      aria-label={`Actions for ${count} selected ${count === 1 ? 'shape' : 'shapes'}`}
      className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-[0_8px_28px_rgba(26,26,46,0.18)] backdrop-blur"
    >
      <IconButton title="Duplicate" onClick={onDuplicate}>
        <CopyPlus className="h-4 w-4" />
      </IconButton>
      <IconButton title="Copy" onClick={onCopy}>
        <Copy className="h-4 w-4" />
      </IconButton>
      <IconButton title="Delete" onClick={onDelete} danger>
        <Trash2 className="h-4 w-4" />
      </IconButton>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <button
        type="button"
        data-testid="selection-ask-ai"
        onClick={onAskAi}
        title="Ask AI to edit the selection"
        className="flex h-8 items-center gap-1.5 rounded-lg bg-ai px-2.5 text-xs font-semibold text-ai-foreground transition-opacity hover:opacity-90"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Ask AI
      </button>
    </div>
  )
}

function IconButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        danger
          ? 'text-foreground/70 hover:bg-destructive/10 hover:text-destructive'
          : 'text-foreground/70 hover:bg-accent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
