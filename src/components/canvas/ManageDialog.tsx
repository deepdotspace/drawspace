/**
 * ManageDialog — sharing surface for a single board.
 *
 * Boards are private (see canvas-schema.ts + worker.ts). This dialog is how the
 * owner grants access: invite a person by the email they signed in with, which
 * resolves to their userId and lands in the board's `collaborators` list. Once
 * listed, they can open the board (record + realtime canvas room both gate on
 * that list) and the invite link works for them.
 */

import { useRef, useState } from 'react'
import { useUsers, useUserLookup, useMutations } from 'deepspace'
import { Check, Copy, Link2, UserPlus, X } from 'lucide-react'
import { Modal, Button, Input, useToast } from '../ui'

export interface BoardRecord {
  recordId: string
  data: { title: string; ownerId: string; collaborators?: string[] }
}

interface CanvasDocument {
  title: string
  ownerId: string
  collaborators: string[]
}

interface ManageDialogProps {
  open: boolean
  onClose: () => void
  board: BoardRecord
  /** Owner or admin — only they can invite / remove people. */
  canManage: boolean
}

function shareLinkFor(boardId: string): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/?board=${encodeURIComponent(boardId)}`
}

export function ManageDialog({ open, onClose, board, canManage }: ManageDialogProps) {
  const { users } = useUsers()
  const { getUser, getName, getEmail } = useUserLookup()
  const { put } = useMutations<CanvasDocument>('canvases')
  const { success, error, info } = useToast()

  const [email, setEmail] = useState('')
  // Serialize collaborator writes: each one sends the WHOLE list, so two
  // overlapping writes (built from the same render snapshot) would clobber each
  // other. The ref blocks re-entry synchronously; `busy` drives the disabled UI.
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [copied, setCopied] = useState(false)

  const ownerId = board.data.ownerId
  const collaborators = board.data.collaborators ?? []
  const link = shareLinkFor(board.recordId)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      error('Copy failed', 'Copy the link manually.')
    }
  }

  const invite = async () => {
    if (busyRef.current) return
    const wanted = email.trim().toLowerCase()
    if (!wanted) return
    const match = users.find((u) => u.email?.toLowerCase() === wanted)
    if (!match) {
      error('No matching user', 'They need to sign in to Drawspace once before you can invite them.')
      return
    }
    if (match.id === ownerId || collaborators.includes(match.id)) {
      info('Already has access', `${match.name || match.email} is already on this board.`)
      setEmail('')
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await put(board.recordId, { collaborators: [...collaborators, match.id] })
      success('Invited', `${match.name || match.email} can now edit this board.`)
      setEmail('')
    } catch {
      error('Invite failed', 'Could not update access.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const removeCollaborator = async (userId: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await put(board.recordId, { collaborators: collaborators.filter((id) => id !== userId) })
    } catch {
      error('Remove failed', 'Could not update access.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <Modal.Header>
        <Modal.Title>Share &ldquo;{board.data.title || 'Untitled'}&rdquo;</Modal.Title>
        <Modal.Description>
          Only the owner and invited people can open this board. Everyone invited can draw on it together,
          live.
        </Modal.Description>
      </Modal.Header>

      <Modal.Body className="space-y-5">
        {/* Invite by email */}
        {canManage && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Invite by email
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void invite()
                  }
                }}
                disabled={busy}
                placeholder="person@example.com"
                className="flex-1"
              />
              <Button onClick={() => void invite()} loading={busy} disabled={busy || !email.trim()}>
                <UserPlus className="h-4 w-4" />
                Invite
              </Button>
            </div>
          </div>
        )}

        {/* People with access */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            People with access
          </label>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <AccessRow
              name={getName(ownerId) || 'Owner'}
              email={getEmail(ownerId) ?? undefined}
              imageUrl={getUser(ownerId)?.imageUrl}
              badge="Owner"
            />
            {collaborators.map((id) => (
              <AccessRow
                key={id}
                name={getName(id) || getEmail(id) || 'Invited user'}
                email={getEmail(id) ?? undefined}
                imageUrl={getUser(id)?.imageUrl}
                badge="Editor"
                onRemove={canManage ? () => void removeCollaborator(id) : undefined}
                removeDisabled={busy}
              />
            ))}
          </ul>
          {collaborators.length === 0 && (
            <p className="text-xs text-muted-foreground">No one else has access yet.</p>
          )}
        </div>

        {/* Invite link */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Invite link
          </label>
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm text-foreground/80">{link}</span>
            </div>
            <Button variant="outline" onClick={() => void copyLink()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Only people you&rsquo;ve invited can open this link.
          </p>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

function AccessRow({
  name,
  email,
  imageUrl,
  badge,
  onRemove,
  removeDisabled,
}: {
  name: string
  email?: string
  imageUrl?: string
  badge: string
  onRemove?: () => void
  removeDisabled?: boolean
}) {
  const initial = (name?.[0] ?? email?.[0] ?? '?').toUpperCase()
  return (
    <li className="flex items-center gap-2.5 px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-sm font-bold text-primary">
        {imageUrl ? (
          <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{name}</div>
        {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
      </div>
      <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {badge}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          title="Remove access"
          aria-label={`Remove ${name}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  )
}
