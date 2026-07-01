/**
 * CanvasTopBar — the app's top navigation bar. Spans the FULL width above both
 * the sidebar and the canvas, so the brand lives here once (the sidebar no
 * longer repeats it). Holds (left→right): the sidebar toggle, the brand mark,
 * the active board's name (click to rename if you own it), a live stack of
 * collaborator avatars (from the canvas presence room), and the Share action.
 */

import { useEffect, useRef, useState } from 'react'
import { getUserColor, useUser, type PresencePeerClient } from 'deepspace'
import { Lock, PanelLeft, PanelLeftClose, Pencil, Share2, Users } from 'lucide-react'

interface CanvasTopBarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  /** Whether a board is currently open (controls the title / share affordances). */
  hasBoard: boolean
  title: string
  /** Name of the folder the active board sits in, if any (shown as a breadcrumb). */
  folderName?: string | null
  canEdit: boolean
  onRename: (title: string) => void
  /** Other users currently present on this board (from the presence room). */
  peers: PresencePeerClient[]
  /** Number of invited collaborators on the active board (0 = private). */
  collaboratorCount: number
  /** Open the share dialog for the active board. */
  onShare: () => void
}

/** Up to this many avatars are shown inline; the rest collapse into a "+N". */
const MAX_AVATARS = 3

function initialsOf(name: string, email: string): string {
  const source = (name || email || '?').trim()
  return source.slice(0, 2).toUpperCase()
}

/** One round avatar with an "online" green status dot. */
function Avatar({
  name,
  email,
  imageUrl,
  color,
  overlap,
}: {
  name: string
  email: string
  imageUrl?: string
  color: string
  overlap: boolean
}) {
  return (
    <span className="relative" style={{ marginLeft: overlap ? -8 : 0 }}>
      <span
        className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-card text-[11px] font-semibold text-white"
        style={{ backgroundColor: color }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          initialsOf(name, email)
        )}
      </span>
      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-success" />
    </span>
  )
}

/**
 * Live "who's online" cluster: a stack of avatars (each with a green online
 * dot) for the people currently on this board, opening a popover that lists
 * everyone by name — you plus every present collaborator. Driven by the canvas
 * presence room, so it reflects real-time presence, not just live cursors.
 */
function OnlinePresence({ peers }: { peers: PresencePeerClient[] }) {
  const { user } = useUser()
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

  // Only show the cluster when others are present — alone, there's nothing to show.
  if (peers.length === 0) return null

  const shown = peers.slice(0, MAX_AVATARS)
  const overflow = peers.length - shown.length
  const onlineLabel = `${peers.length + 1} online`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="online-presence"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={onlineLabel}
        aria-label={onlineLabel}
        className="flex items-center rounded-full p-0.5 transition-colors hover:bg-accent"
      >
        {shown.map((p, i) => (
          <Avatar
            key={p.userId}
            name={p.userName}
            email={p.userEmail}
            imageUrl={p.userImageUrl}
            color={getUserColor(p.userId)}
            overlap={i > 0}
          />
        ))}
        {overflow > 0 && (
          <span className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10.5px] font-semibold text-muted-foreground">
            +{overflow}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-[0_8px_30px_rgba(26,26,46,0.18)]"
        >
          <div className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Online now · {peers.length + 1}
          </div>
          <PresenceRow
            name={`${user?.name || 'You'} (you)`}
            email={user?.email ?? ''}
            imageUrl={user?.imageUrl}
            color={getUserColor(user?.id ?? 'you')}
          />
          {peers.map((p) => (
            <PresenceRow
              key={p.userId}
              name={p.userName || p.userEmail || 'Guest'}
              email={p.userEmail}
              imageUrl={p.userImageUrl}
              color={getUserColor(p.userId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PresenceRow({
  name,
  email,
  imageUrl,
  color,
}: {
  name: string
  email: string
  imageUrl?: string
  color: string
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5">
      <Avatar name={name} email={email} imageUrl={imageUrl} color={color} overlap={false} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{name}</span>
      <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
    </div>
  )
}

export function CanvasTopBar({
  sidebarOpen,
  onToggleSidebar,
  hasBoard,
  title,
  folderName,
  canEdit,
  onRename,
  peers,
  collaboratorCount,
  onShare,
}: CanvasTopBarProps) {
  const [editing, setEditing] = useState(false)
  const shared = collaboratorCount > 0

  return (
    <header
      data-testid="canvas-topbar"
      className="z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3"
    >
      <button
        type="button"
        onClick={onToggleSidebar}
        title={sidebarOpen ? 'Hide panel' : 'Show panel'}
        aria-label={sidebarOpen ? 'Hide panel' : 'Show panel'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        {sidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}
      </button>

      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Pencil className="h-4 w-4" />
        </span>
        <span className="font-hand text-lg font-bold leading-none text-primary">Drawspace</span>
      </div>

      {hasBoard && (
        <>
          <span className="h-5 w-px shrink-0 bg-border" />

          {folderName && (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="max-w-[16vw] truncate text-sm text-muted-foreground" title={folderName}>
                {folderName}
              </span>
              <span className="text-muted-foreground/50">/</span>
            </div>
          )}

          {editing && canEdit ? (
            <NameInput
              initial={title}
              onCommit={(value) => {
                setEditing(false)
                const next = value.trim()
                if (next && next !== title) onRename(next)
              }}
              onCancel={() => setEditing(false)}
            />
          ) : canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Rename board"
              className="min-w-0 max-w-[30vw] truncate rounded-lg px-2 py-1 text-left text-sm font-semibold text-foreground hover:bg-accent"
            >
              {title || 'Untitled'}
            </button>
          ) : (
            <span
              title={title}
              className="min-w-0 max-w-[30vw] truncate px-2 py-1 text-sm font-semibold text-foreground"
            >
              {title || 'Untitled'}
            </span>
          )}
        </>
      )}

      <div className="flex-1" />

      <OnlinePresence peers={peers} />

      {hasBoard && (
        <>
          {/* Visibility status — a canvas is "Private" until you invite people. */}
          <span
            data-testid="board-visibility"
            title={
              shared
                ? `Shared with ${collaboratorCount} ${collaboratorCount === 1 ? 'person' : 'people'} — only invited people can open it`
                : 'Private — only you can open this canvas'
            }
            className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${
              shared ? 'bg-ai-soft text-ai' : 'bg-muted text-muted-foreground'
            }`}
          >
            {shared ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {shared ? `Shared · ${collaboratorCount}` : 'Private'}
          </span>

          <button
            type="button"
            data-testid="share-board"
            onClick={onShare}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </button>
        </>
      )}
    </header>
  )
}

function NameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      className="w-48 rounded-lg border border-primary bg-background px-2 py-1 text-sm font-semibold text-foreground outline-none"
    />
  )
}
