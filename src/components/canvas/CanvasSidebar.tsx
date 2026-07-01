/**
 * CanvasSidebar — the left panel: a column of full-width actions (search / new
 * file / new folder), then the board library organized into Folders + an
 * Unfiled ("Canvases") list, then Trash. The account profile + sign-out is
 * pinned to the bottom. (The brand lives in the top nav, and sharing is the top
 * nav's Share button — not here.)
 */

import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react'
import { useUser, signOut } from 'deepspace'
import {
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
  LogOut,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { ConfirmModal } from '../ui'

export interface CanvasListItem {
  recordId: string
  data: { title: string; ownerId: string; collaborators?: string[]; folderId?: string; deletedAt?: string }
  createdAt?: string
  updatedAt?: string
}

export interface FolderListItem {
  recordId: string
  data: { name: string; ownerId: string }
  createdAt?: string
}

interface CanvasSidebarProps {
  canvases: CanvasListItem[]
  /** The current user's folders. */
  folders: FolderListItem[]
  /** Soft-deleted boards, shown in the collapsible Trash section. */
  trashedCanvases: CanvasListItem[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  /** Restore a board out of Trash. */
  onRestore: (id: string) => void
  /** Irreversibly hard-delete a board (record + canvas data). */
  onDeleteForever: (id: string) => void | Promise<void>
  onNewFolder: () => void
  onRenameFolder: (id: string, name: string) => void
  /** Delete a folder (its boards become unfiled — they are NOT deleted). */
  onDeleteFolder: (id: string) => void
  /** Move a board into a folder, or out of all folders when folderId is null. */
  onMoveCanvas: (id: string, folderId: string | null) => void
  canCreate: boolean
  isAdmin: boolean
  currentUserId: string
  creatingNew: boolean
}

function itemTime(c: CanvasListItem): number {
  const raw = c.updatedAt ?? c.createdAt
  const t = raw ? Date.parse(raw) : NaN
  return Number.isNaN(t) ? 0 : t
}

const byNewest = (a: CanvasListItem, b: CanvasListItem) => itemTime(b) - itemTime(a)

export function CanvasSidebar({
  canvases,
  folders,
  trashedCanvases,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onRestore,
  onDeleteForever,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveCanvas,
  canCreate,
  isAdmin,
  currentUserId,
  creatingNew,
}: CanvasSidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [foreverId, setForeverId] = useState<string | null>(null)
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  const canEditRow = (ownerId: string) => isAdmin || ownerId === currentUserId
  const deleteTarget = canvases.find((c) => c.recordId === deleteId) ?? null
  const foreverTarget = trashedCanvases.find((c) => c.recordId === foreverId) ?? null
  const deleteFolderTarget = folders.find((f) => f.recordId === deleteFolderId) ?? null

  // Partition the (filtered) boards into folders + an unfiled list. A board is
  // "in" a folder only if that folder exists for this user — a board shared by
  // someone else may carry their folderId, which we treat as unfiled here.
  const { folderSections, unfiled } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? canvases.filter((c) => (c.data.title || 'untitled').toLowerCase().includes(q))
      : canvases
    const folderIds = new Set(folders.map((f) => f.recordId))
    const byFolder = new Map<string, CanvasListItem[]>()
    const loose: CanvasListItem[] = []
    for (const c of matched) {
      const fid = c.data.folderId
      if (fid && folderIds.has(fid)) {
        const arr = byFolder.get(fid) ?? []
        arr.push(c)
        byFolder.set(fid, arr)
      } else {
        loose.push(c)
      }
    }
    const sections = folders.map((f) => ({
      folder: f,
      items: (byFolder.get(f.recordId) ?? []).sort(byNewest),
    }))
    return { folderSections: sections, unfiled: loose.sort(byNewest) }
  }, [canvases, folders, query])

  const searching = query.trim().length > 0
  // Folder names + ids for the per-board "move to" menu.
  const folderChoices = useMemo(() => folders.map((f) => ({ id: f.recordId, name: f.data.name })), [folders])

  const renderRow = (c: CanvasListItem) => (
    <CanvasRow
      key={c.recordId}
      title={c.data.title}
      active={c.recordId === activeId}
      editable={canEditRow(c.data.ownerId)}
      renaming={renamingId === c.recordId}
      folderId={c.data.folderId ?? null}
      folders={folderChoices}
      onSelect={() => onSelect(c.recordId)}
      onStartRename={() => setRenamingId(c.recordId)}
      onCommitRename={(title) => {
        setRenamingId(null)
        const next = title.trim()
        if (next && next !== c.data.title) onRename(c.recordId, next)
      }}
      onCancelRename={() => setRenamingId(null)}
      onMove={(folderId) => onMoveCanvas(c.recordId, folderId)}
      onRequestDelete={() => setDeleteId(c.recordId)}
    />
  )

  const nothingToShow = folderSections.every((s) => s.items.length === 0) && unfiled.length === 0

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-card">
      {/* Actions: clean full-width rows. (The brand lives in the top nav.) */}
      <div className="space-y-0.5 p-2 pt-3">
        {searchOpen ? (
          <div className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('')
                  setSearchOpen(false)
                }
              }}
              placeholder="Search boards"
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setSearchOpen(false)
              }}
              aria-label="Close search"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <SidebarAction icon={Search} label="Search…" onClick={() => setSearchOpen(true)} />
        )}
        {canCreate && <SidebarAction icon={SquarePen} label="New file" disabled={creatingNew} onClick={onNew} />}
        {canCreate && <SidebarAction icon={FolderPlus} label="New folder" onClick={onNewFolder} />}
      </div>

      <Divider />

      {/* Board library — Folders, then the Unfiled ("Canvases") list. */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-1">
        {nothingToShow && folders.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {searching ? 'No boards match your search.' : 'No boards yet.'}
          </p>
        ) : (
          <>
            {/* Folders */}
            {folders.length > 0 && (
              <div className="mb-1">
                <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Folders
                </div>
                {folderSections.map(({ folder, items }) => {
                  // While searching, force every folder open so matches show.
                  const open = searching || !collapsedFolders.has(folder.recordId)
                  // Hide empty folders while searching (no matches inside).
                  if (searching && items.length === 0) return null
                  return (
                    <FolderRow
                      key={folder.recordId}
                      name={folder.data.name}
                      count={items.length}
                      open={open}
                      editable={canEditRow(folder.data.ownerId)}
                      renaming={renamingFolderId === folder.recordId}
                      onToggle={() =>
                        setCollapsedFolders((prev) => {
                          const next = new Set(prev)
                          if (next.has(folder.recordId)) next.delete(folder.recordId)
                          else next.add(folder.recordId)
                          return next
                        })
                      }
                      onStartRename={() => setRenamingFolderId(folder.recordId)}
                      onCommitRename={(name) => {
                        setRenamingFolderId(null)
                        const next = name.trim()
                        if (next && next !== folder.data.name) onRenameFolder(folder.recordId, next)
                      }}
                      onCancelRename={() => setRenamingFolderId(null)}
                      onRequestDelete={() => setDeleteFolderId(folder.recordId)}
                    >
                      {items.length === 0 ? (
                        <p className="px-3 py-1.5 pl-9 text-xs text-muted-foreground/80">Empty</p>
                      ) : (
                        items.map(renderRow)
                      )}
                    </FolderRow>
                  )
                })}
              </div>
            )}

            {/* Unfiled boards */}
            <div className="mb-1">
              <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Canvases
              </div>
              {unfiled.length === 0 ? (
                <p className="px-3 py-1.5 text-xs text-muted-foreground/80">
                  {searching ? 'No unfiled boards match.' : 'Nothing here yet.'}
                </p>
              ) : (
                unfiled.map(renderRow)
              )}
            </div>
          </>
        )}

        {/* Trash — soft-deleted boards, restorable until the purge cron runs. */}
        {trashedCanvases.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setTrashOpen((o) => !o)}
              aria-expanded={trashOpen}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${trashOpen ? 'rotate-90' : ''}`} />
              <Trash2 className="h-4 w-4 shrink-0" />
              <span className="flex-1">Trash</span>
              <span className="text-xs tabular-nums">{trashedCanvases.length}</span>
            </button>
            {trashOpen && (
              <div className="mt-0.5 space-y-0.5">
                {trashedCanvases.map((c) => (
                  <TrashRow
                    key={c.recordId}
                    title={c.data.title}
                    canManage={canEditRow(c.data.ownerId)}
                    onRestore={() => onRestore(c.recordId)}
                    onDeleteForever={() => setForeverId(c.recordId)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Profile + sign out (bottom). */}
      <ProfileFooter />

      <ConfirmModal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) onDelete(deleteId)
          setDeleteId(null)
        }}
        title="Move board to Trash?"
        description={`"${deleteTarget?.data.title || 'This board'}" will be moved to Trash. You can restore it until it's permanently purged.`}
        confirmText="Move to Trash"
        cancelText="Cancel"
        variant="destructive"
      />

      <ConfirmModal
        open={foreverId !== null}
        onClose={() => setForeverId(null)}
        onConfirm={() => {
          if (foreverId) void onDeleteForever(foreverId)
          setForeverId(null)
        }}
        title="Delete forever?"
        description={`"${foreverTarget?.data.title || 'This board'}" and everything drawn on it will be permanently erased for everyone with access. This can't be undone.`}
        confirmText="Delete forever"
        cancelText="Cancel"
        variant="destructive"
      />

      <ConfirmModal
        open={deleteFolderId !== null}
        onClose={() => setDeleteFolderId(null)}
        onConfirm={() => {
          if (deleteFolderId) onDeleteFolder(deleteFolderId)
          setDeleteFolderId(null)
        }}
        title="Delete folder?"
        description={`"${deleteFolderTarget?.data.name || 'This folder'}" will be removed. The boards inside it aren't deleted — they just become unfiled.`}
        confirmText="Delete folder"
        cancelText="Cancel"
        variant="destructive"
      />

    </aside>
  )
}

function Divider() {
  return <div className="mx-3 border-t border-border" />
}

function SidebarAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Search
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      {label}
    </button>
  )
}

interface CanvasRowProps {
  title: string
  active: boolean
  editable: boolean
  renaming: boolean
  folderId: string | null
  folders: { id: string; name: string }[]
  onSelect: () => void
  onStartRename: () => void
  onCommitRename: (title: string) => void
  onCancelRename: () => void
  onMove: (folderId: string | null) => void
  onRequestDelete: () => void
}

function CanvasRow({
  title,
  active,
  editable,
  renaming,
  folderId,
  folders,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onMove,
  onRequestDelete,
}: CanvasRowProps) {
  if (renaming) {
    return (
      <div className="px-0.5 py-0.5">
        <RenameInput initial={title} onCommit={onCommitRename} onCancel={onCancelRename} />
      </div>
    )
  }

  return (
    <div className={`group flex items-center gap-1 rounded-lg pr-1 ${active ? 'bg-accent' : 'hover:bg-accent/50'}`}>
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={editable ? onStartRename : undefined}
        title={title || 'Untitled'}
        className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm text-foreground"
      >
        {title || 'Untitled'}
      </button>
      {editable && (
        <RowMenu
          label={title || 'Untitled'}
          folderId={folderId}
          folders={folders}
          onRename={onStartRename}
          onMove={onMove}
          onDelete={onRequestDelete}
        />
      )}
    </div>
  )
}

/** Per-board "⋯" menu: rename, move to a folder (or unfile), delete. */
function RowMenu({
  label,
  folderId,
  folders,
  onRename,
  onMove,
  onDelete,
}: {
  label: string
  folderId: string | null
  folders: { id: string; name: string }[]
  onRename: () => void
  onMove: (folderId: string | null) => void
  onDelete: () => void
}) {
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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More options"
        aria-label={`More options for ${label}`}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-48 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-[0_8px_30px_rgba(26,26,46,0.18)]"
        >
          <MenuItem
            icon={Pencil}
            label="Rename"
            onClick={() => {
              setOpen(false)
              onRename()
            }}
          />

          {folders.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Move to
              </div>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    onMove(f.id)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-accent"
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {folderId === f.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))}
              {folderId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    onMove(null)
                  }}
                  className="w-full px-3 py-1.5 pl-[34px] text-left text-[13px] text-foreground/80 transition-colors hover:bg-accent"
                >
                  Remove from folder
                </button>
              )}
            </>
          )}

          <div className="my-1 border-t border-border" />
          <MenuItem
            icon={Trash2}
            label="Delete"
            destructive
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: typeof Pencil
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-accent ${
        destructive ? 'text-destructive' : 'text-foreground/80'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  )
}

interface FolderRowProps {
  name: string
  count: number
  open: boolean
  editable: boolean
  renaming: boolean
  onToggle: () => void
  onStartRename: () => void
  onCommitRename: (name: string) => void
  onCancelRename: () => void
  onRequestDelete: () => void
  children: ReactNode
}

function FolderRow({
  name,
  count,
  open,
  editable,
  renaming,
  onToggle,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  children,
}: FolderRowProps) {
  return (
    <div>
      <div className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-accent/50">
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1.5 py-2 pl-2 text-muted-foreground"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
          <Folder className="h-4 w-4" />
        </button>
        {renaming ? (
          <div className="min-w-0 flex-1 pr-1">
            <RenameInput initial={name} onCommit={onCommitRename} onCancel={onCancelRename} />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggle}
              onDoubleClick={editable ? onStartRename : undefined}
              title={name}
              className="min-w-0 flex-1 truncate py-2 pl-1 text-left text-sm font-medium text-foreground"
            >
              {name}
            </button>
            <span className="px-1 text-xs tabular-nums text-muted-foreground">{count}</span>
            {editable && (
              <RowMenu label={name} folderId={null} folders={[]} onRename={onStartRename} onMove={() => {}} onDelete={onRequestDelete} />
            )}
          </>
        )}
      </div>
      {open && <div className="mt-0.5 space-y-0.5 pl-3">{children}</div>}
    </div>
  )
}

function TrashRow({
  title,
  canManage,
  onRestore,
  onDeleteForever,
}: {
  title: string
  canManage: boolean
  onRestore: () => void
  onDeleteForever: () => void
}) {
  return (
    <div className="group flex items-center gap-1 rounded-lg pl-8 pr-1 hover:bg-accent/50">
      <span className="min-w-0 flex-1 truncate py-2 text-sm text-muted-foreground" title={title || 'Untitled'}>
        {title || 'Untitled'}
      </span>
      {canManage && (
        <>
          <button
            type="button"
            onClick={onRestore}
            title="Restore board"
            aria-label={`Restore ${title || 'Untitled'}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDeleteForever}
            title="Delete forever"
            aria-label={`Delete ${title || 'Untitled'} forever`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

function RenameInput({
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
      className="w-full rounded-lg border border-primary bg-background px-3 py-2 text-sm text-foreground outline-none"
    />
  )
}

function ProfileFooter() {
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

  const initial = (user?.name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()

  return (
    <div ref={ref} className="relative shrink-0 border-t border-border p-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-accent"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-sm font-bold text-primary">
          {user?.imageUrl ? (
            <img src={user.imageUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{user?.name || 'Signed in'}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
        </div>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+4px)] left-2 right-2 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-[0_8px_30px_rgba(26,26,46,0.18)]"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              signOut()
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground/80 transition-colors hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
