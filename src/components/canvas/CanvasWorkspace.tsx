/**
 * CanvasWorkspace — the full-screen editor. Resolves (or creates) a board,
 * then mounts the collapsible left sidebar (board switcher, sharing, account)
 * alongside the canvas and its floating controls: name bar, tool picker, style
 * panel, export menu, zoom cluster, and the AI assistant.
 *
 * Boards are private and per-user; a signed-in editor keeps multiple boards and
 * switches between them from the sidebar (or via a ?board=<id> share link). The
 * newest board is shown on first run, with a default one created if the account
 * has none yet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useUser,
  useQuery,
  useMutations,
  useCanvas,
  usePresenceRoom,
  getAuthToken,
  type CanvasShapeClient,
  type PresencePeerClient,
} from 'deepspace'
import { Undo2, Redo2 } from 'lucide-react'
import { ROLES, type Role } from '../../constants'
import { ConfirmModal, useToast } from '../ui'
import { useOptimisticCanvas } from './useOptimisticCanvas'
import { DrawCanvas } from './DrawCanvas'
import { Toolbar } from './Toolbar'
import { StylePanel } from './StylePanel'
import { ZoomControls } from './ZoomControls'
import { BackgroundPicker } from './BackgroundPicker'
import { CanvasSidebar } from './CanvasSidebar'
import { CanvasTopBar } from './CanvasTopBar'
import { SelectionToolbar } from './SelectionToolbar'
import { ExportMenu } from './ExportMenu'
import { ManageDialog } from './ManageDialog'
import { AiAssistant } from './AiAssistant'
import {
  cloneShapesWithOffset,
  deserializeClipboard,
  nudgeDelta,
  serializeClipboard,
  PASTE_OFFSET,
  type ShapeCreatePayload,
} from './selection-ops'
import {
  shapesToSvgString,
  downloadSvgString,
  downloadPng,
  copyImageToClipboard,
  type ExportShape,
} from './export'
import {
  CANVAS_BACKGROUNDS,
  DEFAULT_STYLE,
  isDrawTool,
  type CanvasBackground,
  type Point,
  type ShapeStyle,
  type Tool,
} from './types'
import { POLYGON_SHAPES } from './geo'
import { orderByZ, reorderShapes, type ReorderKind } from './z-order'
import { fitTextBox } from './text-layout'
import type { Bounds } from '../../ai/shape-layout'

interface CanvasDocument {
  title: string
  ownerId: string
  collaborators?: string[]
  /** Organizational folder (a `folders` recordId), or empty/unset = unfiled. */
  folderId?: string
  /** ISO timestamp when soft-deleted (in Trash); empty/unset = live. */
  deletedAt?: string
}

interface FolderDocument {
  name: string
  ownerId: string
}

/** A board is "live" until it's been soft-deleted into Trash. (`!!deletedAt`
 *  already excludes '', null, and undefined.) */
function isTrashed(c: { data: CanvasDocument }): boolean {
  return !!c.data.deletedAt
}

// Closed shapes that can take a fill: the box primitives plus every polygon
// geo shape (derived so new shapes are fillable automatically).
const FILLABLE = new Set<string>(['rect', 'ellipse', 'diamond', ...POLYGON_SHAPES])

/** localStorage key for the per-user canvas background preference. */
const BG_STORAGE_KEY = 'drawspace-canvas-bg'

/** Read a board id from the ?board= share-link param (once, on first render). */
function boardParamFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('board')
}

export function CanvasWorkspace() {
  const { user } = useUser()
  const userRole = (user?.role ?? ROLES.VIEWER) as Role
  const canCreate = userRole === ROLES.MEMBER || userRole === ROLES.ADMIN
  const isAdmin = userRole === ROLES.ADMIN

  const { records: allCanvases, status } = useQuery<CanvasDocument>('canvases', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  // Split into the live board list and the Trash. Soft-deleted boards stay in
  // the record set (so they can be restored) but never appear in the main list.
  const canvases = useMemo(() => allCanvases.filter((c) => !isTrashed(c)), [allCanvases])
  const trashedCanvases = useMemo(() => allCanvases.filter(isTrashed), [allCanvases])
  // `createConfirmed` so the board's record exists server-side BEFORE the
  // access-gated canvas room connects — otherwise the creator 403s on their
  // own brand-new board (resolveCanvasRole can't find the record yet).
  const { createConfirmed, put } = useMutations<CanvasDocument>('canvases')
  const { records: folders } = useQuery<FolderDocument>('folders', { orderBy: 'createdAt' })
  const {
    create: createFolder,
    put: putFolder,
    remove: removeFolder,
  } = useMutations<FolderDocument>('folders')
  const { error: toastError } = useToast()
  const creatingRef = useRef(false)
  // Seed the selection from a ?board= share link, if present.
  const [selectedId, setSelectedId] = useState<string | null>(() => boardParamFromUrl())
  const [creatingNew, setCreatingNew] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [shareOpen, setShareOpen] = useState(false)

  // First-run: bootstrap a default board for a brand-new (empty) account so the
  // user lands on a canvas, not a list. Keyed on the FULL record set, not the
  // live one: a user who has soft-deleted every board should NOT get a board
  // auto-respawned underneath them — they land on the empty state with Trash
  // available to restore from. Confirmed so the record is server-acked before
  // the access-gated canvas room connects (a plain create can race the role
  // lookup → 403 on your own board).
  useEffect(() => {
    if (status === 'loading' || creatingRef.current) return
    if (allCanvases.length === 0 && canCreate && user) {
      creatingRef.current = true
      void createConfirmed({ title: 'My Drawing', ownerId: user.id }).catch(() => {
        creatingRef.current = false
      })
    }
  }, [status, allCanvases.length, canCreate, user, createConfirmed])

  // The active board is the user's pick if it still exists, else the newest.
  // Deriving this in render (instead of an effect) means a deleted or not-yet-
  // synced board self-heals to the newest one without a flicker loop.
  const activeId =
    selectedId && canvases.some((c) => c.recordId === selectedId)
      ? selectedId
      : canvases[0]?.recordId ?? null

  // Live presence for the active board, lifted to the workspace so the top bar
  // (collaborator avatars) and the editor (cursors) share ONE room connection.
  // `peers` excludes self; each carries its world-space `cursor` in `state`.
  const { peers, updateState } = usePresenceRoom(activeId ? `canvas:${activeId}` : 'canvas:none')
  const reportCursor = useCallback(
    (world: Point | null) => updateState({ cursor: world }),
    [updateState],
  )

  const handleNewCanvas = useCallback(async () => {
    if (!user || creatingNew) return
    setCreatingNew(true)
    try {
      const id = await createConfirmed({ title: 'Untitled', ownerId: user.id })
      if (id) setSelectedId(id)
    } catch {
      // The SDK surfaces write failures via toast; nothing to add here.
    } finally {
      setCreatingNew(false)
    }
  }, [user, creatingNew, createConfirmed])

  const handleRenameCanvas = useCallback(
    (id: string, title: string) => {
      void put(id, { title })
    },
    [put],
  )

  // --- folders --------------------------------------------------------------
  const handleNewFolder = useCallback(async () => {
    if (!user) return
    try {
      await createFolder({ name: 'New folder', ownerId: user.id })
    } catch {
      // Write failures surface via toast from the SDK.
    }
  }, [user, createFolder])

  const handleRenameFolder = useCallback(
    (id: string, name: string) => {
      void putFolder(id, { name })
    },
    [putFolder],
  )

  // Deleting a folder unfiles its boards (clears their folderId) — it never
  // deletes the boards themselves — then removes the folder record.
  const handleDeleteFolder = useCallback(
    (id: string) => {
      for (const c of canvases) {
        if (c.data.folderId === id) void put(c.recordId, { folderId: '' })
      }
      void removeFolder(id)
    },
    [canvases, put, removeFolder],
  )

  // Move a board into a folder (or out of all folders when folderId is null).
  const handleMoveCanvas = useCallback(
    (id: string, folderId: string | null) => {
      void put(id, { folderId: folderId ?? '' })
    },
    [put],
  )

  // Soft delete: move the board to Trash (recoverable). The render-derived
  // activeId falls back to the newest remaining LIVE board automatically.
  const handleDeleteCanvas = useCallback(
    (id: string) => {
      void put(id, { deletedAt: new Date().toISOString() })
    },
    [put],
  )

  // Restore a board out of Trash.
  const handleRestoreCanvas = useCallback(
    (id: string) => {
      void put(id, { deletedAt: '' })
    },
    [put],
  )

  // Irreversible: hard-delete the record AND wipe the CanvasRoom DO storage via
  // the privileged server route. The record then disappears from the query.
  const handleDeleteForever = useCallback(
    async (id: string) => {
      try {
        const token = await getAuthToken()
        const res = await fetch(`/api/canvas/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } catch {
        toastError('Delete failed', 'Could not permanently delete the board. Please try again.')
      }
    },
    [toastError],
  )

  // Spinner only while bootstrapping a truly-empty account (or still loading).
  // If the user has boards but none are live (everything's in Trash), fall
  // through to the full workspace so the sidebar's Trash stays reachable.
  if (status === 'loading' || (allCanvases.length === 0 && canCreate)) {
    return <CenterSpinner />
  }

  const activeBoard = canvases.find((c) => c.recordId === activeId) ?? null
  const canEditBoard = isAdmin || activeBoard?.data.ownerId === user?.id
  // Breadcrumb folder name + visibility for the top bar (active board only).
  const activeFolderName = activeBoard?.data.folderId
    ? folders.find((f) => f.recordId === activeBoard.data.folderId)?.data.name ?? null
    : null
  const activeCollaboratorCount = activeBoard?.data.collaborators?.length ?? 0

  return (
    <div data-testid="canvas-page" className="flex h-full w-full flex-col overflow-hidden">
      {/* Full-width top nav — spans above the sidebar and canvas, so the brand
          appears here once (the sidebar no longer repeats it). */}
      <CanvasTopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        hasBoard={!!activeBoard}
        title={activeBoard?.data.title ?? ''}
        folderName={activeFolderName}
        canEdit={!!canEditBoard}
        onRename={(title) => activeId && handleRenameCanvas(activeId, title)}
        peers={peers}
        collaboratorCount={activeCollaboratorCount}
        onShare={() => setShareOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        {/* Persistent, collapsible left panel — lives outside the keyed editor
            so it doesn't remount (or lose its collapse state) on board switch. */}
        <div
          className={`h-full shrink-0 overflow-hidden border-r border-border transition-[width] duration-200 ease-out ${
            sidebarOpen ? 'w-64' : 'w-0'
          }`}
        >
          <CanvasSidebar
            canvases={canvases}
            folders={folders}
            trashedCanvases={trashedCanvases}
            activeId={activeId ?? ''}
            onSelect={setSelectedId}
            onNew={handleNewCanvas}
            onRename={handleRenameCanvas}
            onDelete={handleDeleteCanvas}
            onRestore={handleRestoreCanvas}
            onDeleteForever={handleDeleteForever}
            onNewFolder={handleNewFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onMoveCanvas={handleMoveCanvas}
            canCreate={canCreate}
            isAdmin={isAdmin}
            currentUserId={user?.id ?? ''}
            creatingNew={creatingNew}
          />
        </div>

        {/* With no live board (e.g. everything's in Trash) the sidebar still
            renders so the user can restore or create — only the editor area
            shows an empty state. */}
        {activeId && activeBoard ? (
          <CanvasEditor
            key={activeId}
            docId={activeId}
            canEditBoard={!!canEditBoard}
            peers={peers}
            reportCursor={reportCursor}
          />
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">
              No board open. Create a new one{trashedCanvases.length > 0 ? ', restore one from Trash,' : ''} or
              ask the owner of a board to invite you — shared boards open from their invite link.
            </p>
            {canCreate && (
              <button
                type="button"
                onClick={() => void handleNewCanvas()}
                disabled={creatingNew}
                className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                New board
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sharing is per-board: this invites people to the ACTIVE board only. */}
      {activeBoard && (
        <ManageDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          board={activeBoard}
          canManage={!!canEditBoard}
        />
      )}
    </div>
  )
}

function CenterSpinner() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}

// ---------------------------------------------------------------------------

interface CanvasEditorProps {
  docId: string
  canEditBoard: boolean
  /** Other users on this board (lifted to the workspace so the top bar shares it). */
  peers: PresencePeerClient[]
  /** Report the local pointer's world position to the presence room. */
  reportCursor: (world: Point | null) => void
}

function CanvasEditor({ docId, canEditBoard, peers, reportCursor }: CanvasEditorProps) {
  // Current user id — scopes the assistant's persisted chat history query.
  const { user } = useUser()
  // The SDK's move/resize/update events never echo back to the sender, so wrap
  // the raw canvas in an optimistic overlay — without it the local user can't
  // see their own shapes move or resize. See useOptimisticCanvas.
  const canvas = useOptimisticCanvas(useCanvas(docId))
  const { shapes, updateShape, deleteShape, addShape, moveShape, resizeShape, beginGesture, endGesture } = canvas
  const { error: toastError, success: toastSuccess } = useToast()

  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [style, setStyle] = useState<ShapeStyle>(DEFAULT_STYLE)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [clearOpen, setClearOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [background, setBackground] = useState<CanvasBackground>(() => {
    try {
      const saved = window.localStorage.getItem(BG_STORAGE_KEY)
      if (saved && (CANVAS_BACKGROUNDS as string[]).includes(saved)) return saved as CanvasBackground
    } catch {
      /* ignore */
    }
    return 'dots'
  })
  const changeBackground = useCallback((bg: CanvasBackground) => {
    setBackground(bg)
    try {
      window.localStorage.setItem(BG_STORAGE_KEY, bg)
    } catch {
      /* ignore */
    }
  }, [])

  const selectedShapes = useMemo(
    () => shapes.filter((s: CanvasShapeClient) => selectedIds.includes(s.id)),
    [shapes, selectedIds],
  )
  // The "primary" shape drives the style panel's display (type, current colors).
  // Style edits and actions still apply to the whole selection.
  const selectedShape = selectedShapes[0] ?? null
  const hasSelection = selectedShapes.length > 0

  // Refs so the clipboard/keyboard handlers can read the latest state without
  // re-registering their listeners on every selection change.
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const selectedShapesRef = useRef(selectedShapes)
  selectedShapesRef.current = selectedShapes
  // In-app clipboard (serialized via the tested helpers, not the system one).
  const clipboardRef = useRef<string | null>(null)

  // Selecting freshly-added shapes: addShape assigns ids server-side and the
  // new rows arrive asynchronously, so we record the pre-add id set + count and
  // select the new ids once they land (mirrors DrawCanvas's single-shape claim).
  const pendingSelectRef = useRef<{ before: Set<string>; count: number } | null>(null)
  useEffect(() => {
    const pend = pendingSelectRef.current
    if (!pend) return
    const fresh = shapes.filter((s: CanvasShapeClient) => !pend.before.has(s.id)).map((s) => s.id)
    if (fresh.length >= pend.count) {
      pendingSelectRef.current = null
      setSelectedIds(fresh.slice(-pend.count))
    }
  }, [shapes])

  const addShapesAndSelect = useCallback(
    (payloads: ShapeCreatePayload[]) => {
      if (payloads.length === 0) return
      pendingSelectRef.current = { before: new Set(shapesRef.current.map((s) => s.id)), count: payloads.length }
      // One undo step for the whole batch (duplicate / paste of many shapes).
      beginGesture()
      for (const p of payloads) addShape(p)
      endGesture()
    },
    [addShape, beginGesture, endGesture],
  )

  // Keyboard tool shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const map: Record<string, Tool> = {
        v: 'select',
        h: 'hand',
        r: 'rect',
        d: 'diamond',
        o: 'ellipse',
        a: 'arrow',
        l: 'line',
        p: 'draw',
        t: 'text',
      }
      const tool = map[e.key.toLowerCase()]
      if (tool) {
        setActiveTool(tool)
        if (tool !== 'select') setSelectedIds([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Style edits apply to every selected shape and become the new default.
  const onStyleChange = useCallback(
    (patch: Partial<ShapeStyle>) => {
      setStyle((s) => ({ ...s, ...patch }))
      const props: Record<string, unknown> = {}
      if (patch.stroke !== undefined) props.stroke = patch.stroke
      if (patch.fill !== undefined) props.fill = patch.fill
      if (patch.strokeWidth !== undefined) props.strokeWidth = patch.strokeWidth
      if (patch.fontSize !== undefined) props.fontSize = patch.fontSize
      if (Object.keys(props).length > 0) {
        // One undo step for restyling the whole selection (incl. text re-fit).
        beginGesture()
        for (const s of selectedShapes) {
          updateShape(s.id, props)
          // Re-fit a free text box to its new font size so the words actually
          // grow/shrink (not just the box) and the box keeps hugging them.
          if (patch.fontSize !== undefined && s.type === 'text' && s.props.fit !== 'shrink') {
            const { width, height } = fitTextBox((s.props.text as string) ?? '', patch.fontSize)
            resizeShape(s.id, width, height)
          }
        }
        endGesture()
      }
    },
    [selectedShapes, updateShape, resizeShape, beginGesture, endGesture],
  )

  const handleDelete = useCallback(() => {
    // Deleting a multi-selection is one undo step (restores them all at once).
    beginGesture()
    for (const s of selectedShapes) deleteShape(s.id)
    endGesture()
    setSelectedIds([])
  }, [selectedShapes, deleteShape, beginGesture, endGesture])

  // Duplicate the selection (offset) AND select the copies — the old version
  // added them but left the originals selected.
  const handleDuplicate = useCallback(() => {
    addShapesAndSelect(cloneShapesWithOffset(selectedShapes, PASTE_OFFSET, PASTE_OFFSET))
  }, [selectedShapes, addShapesAndSelect])

  const handleClear = useCallback(() => {
    // Clearing the board is a single undo step.
    beginGesture()
    shapes.forEach((s: CanvasShapeClient) => deleteShape(s.id))
    endGesture()
    setSelectedIds([])
  }, [shapes, deleteShape, beginGesture, endGesture])

  // Change the stacking order of the selection. We persist the new order by
  // writing each shape's index back to props.z, coalesced into one undo step.
  const handleReorder = useCallback(
    (kind: ReorderKind) => {
      if (selectedIds.length === 0) return
      const next = reorderShapes(shapes, selectedIds, kind)
      canvas.beginGesture()
      next.forEach((s, i) => {
        if (s.props.z !== i) updateShape(s.id, { z: i })
      })
      canvas.endGesture()
    },
    [selectedIds, shapes, updateShape, canvas],
  )

  // --- clipboard / select-all / nudge --------------------------------------
  const copySelection = useCallback(() => {
    const sel = selectedShapesRef.current
    if (sel.length === 0) return false
    clipboardRef.current = serializeClipboard(sel)
    return true
  }, [])

  const pasteClipboard = useCallback(() => {
    if (!clipboardRef.current) return
    const parsed = deserializeClipboard(clipboardRef.current)
    if (!parsed) return
    addShapesAndSelect(cloneShapesWithOffset(parsed, PASTE_OFFSET, PASTE_OFFSET))
  }, [addShapesAndSelect])

  // Copy from the selection toolbar — same in-app clipboard as ⌘C, with a
  // toast so the action has visible feedback away from the keyboard.
  const handleCopy = useCallback(() => {
    const n = selectedShapesRef.current.length
    if (copySelection()) {
      toastSuccess('Copied', `${n} ${n === 1 ? 'shape' : 'shapes'} copied. Paste with ⌘/Ctrl+V.`)
    }
  }, [copySelection, toastSuccess])

  // Clipboard, select-all, duplicate, escape, and arrow-key nudging. Live
  // selection/shape state is read via refs so the handler body always sees the
  // latest; the listener itself re-registers when its callback deps change
  // (e.g. handleDuplicate), which is harmless.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase()
        switch (key) {
          case 'c':
            if (copySelection()) e.preventDefault()
            return
          case 'x':
            if (copySelection()) {
              e.preventDefault()
              beginGesture()
              for (const s of selectedShapesRef.current) deleteShape(s.id)
              endGesture()
              setSelectedIds([])
            }
            return
          case 'v':
            e.preventDefault()
            pasteClipboard()
            return
          case 'd':
            e.preventDefault()
            handleDuplicate()
            return
          case 'a':
            e.preventDefault()
            setActiveTool('select')
            setSelectedIds(shapesRef.current.map((s) => s.id))
            return
          default:
            return
        }
      }

      if (e.key === 'Escape') {
        setSelectedIds([])
        return
      }

      const delta = nudgeDelta(e.key, e.shiftKey)
      if (delta && selectedShapesRef.current.length > 0) {
        e.preventDefault()
        // One arrow press = one undo step, even nudging several shapes.
        beginGesture()
        for (const s of selectedShapesRef.current) moveShape(s.id, s.x + delta.dx, s.y + delta.dy)
        endGesture()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [copySelection, pasteClipboard, handleDuplicate, deleteShape, moveShape, beginGesture, endGesture])

  // --- export --------------------------------------------------------------
  const buildSvg = useCallback(
    // Export in z-order so the rendered stacking matches the SVG/PNG.
    () => shapesToSvgString(orderByZ(shapes) as ExportShape[], { background: '#ffffff' }),
    [shapes],
  )
  const handleExportSvg = useCallback(() => {
    downloadSvgString(buildSvg(), 'drawing.svg')
  }, [buildSvg])
  const handleExportPng = useCallback(() => {
    void downloadPng(buildSvg(), 'drawing.png', '#ffffff').catch(() =>
      toastError('Export failed', 'Could not export the board as a PNG. Please try again.'),
    )
  }, [buildSvg, toastError])
  const handleCopyImage = useCallback(() => {
    void copyImageToClipboard(buildSvg(), '#ffffff').catch(() =>
      toastError('Copy failed', 'Could not copy the board image to the clipboard.'),
    )
  }, [buildSvg, toastError])

  const zoomTo = useCallback((factor: number) => {
    setZoom((z) => Math.min(Math.max(z * factor, 0.1), 8))
  }, [])
  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Pan/zoom the view so a world-space bbox is centered and fully visible. Used
  // by the AI assistant to scroll freshly-drawn content (placed below existing
  // shapes, possibly off-screen) back into view. Transform is
  // `screen = world*zoom + pan` (see DrawCanvas), so centering inverts that.
  const editorRef = useRef<HTMLDivElement>(null)
  // Track the canvas area's size so floating overlays (the selection toolbar)
  // can clamp/flip to stay on-screen.
  const [editorSize, setEditorSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const measure = () => setEditorSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const revealBounds = useCallback((b: Bounds) => {
    const el = editorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const pad = 80
    // Fit to the bbox but never zoom IN past 100% (keep small diagrams legible).
    const targetZoom = Math.min(
      1,
      Math.max(0.1, Math.min(rect.width / (b.width + pad * 2), rect.height / (b.height + pad * 2))),
    )
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    setZoom(targetZoom)
    setPan({ x: rect.width / 2 - cx * targetZoom, y: rect.height / 2 - cy * targetZoom })
  }, [])

  const showStylePanel = isDrawTool(activeTool) || hasSelection
  const showFill = useMemo(() => {
    if (selectedShape) return FILLABLE.has(selectedShape.type)
    return FILLABLE.has(activeTool)
  }, [selectedShape, activeTool])

  // Reflect the selected shape's actual style in the panel.
  const panelStyle: ShapeStyle = selectedShape
    ? {
        stroke: (selectedShape.props.stroke as string) ?? style.stroke,
        fill: (selectedShape.props.fill as string) ?? style.fill,
        strokeWidth: (selectedShape.props.strokeWidth as number) ?? style.strokeWidth,
        fontSize: (selectedShape.props.fontSize as number) ?? style.fontSize,
      }
    : style

  // Screen position for the contextual selection toolbar: centered over the
  // selection, anchored above its top edge — but flipped below (and clamped
  // horizontally) when there's no room, so it never clips off-screen. Tracks
  // pan/zoom (and the live optimistic positions during a drag) so it stays
  // glued to the shapes. `screen = world*zoom + pan`.
  const selectionAnchor = useMemo(() => {
    if (selectedShapes.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const s of selectedShapes) {
      minX = Math.min(minX, s.x)
      minY = Math.min(minY, s.y)
      maxX = Math.max(maxX, s.x + s.width)
      maxY = Math.max(maxY, s.y + s.height)
    }
    const centerX = ((minX + maxX) / 2) * zoom + pan.x
    const topY = minY * zoom + pan.y
    const bottomY = maxY * zoom + pan.y
    // Keep the (centered) toolbar fully inside the canvas area horizontally.
    const margin = 100
    const left = editorSize.w > 0 ? Math.min(Math.max(centerX, margin), editorSize.w - margin) : centerX
    // Not enough room above the selection → drop the toolbar below it instead.
    const below = topY < 56
    return { left, top: below ? bottomY : topY, below }
  }, [selectedShapes, zoom, pan, editorSize.w])

  return (
    // The canvas area. `relative` so the floating controls and live cursors
    // position against it (all in this element's screen space). The full-width
    // top nav lives one level up, in CanvasWorkspace.
    <div ref={editorRef} className="relative flex-1 overflow-hidden">
      <DrawCanvas
        canvas={canvas}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        style={style}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        pan={pan}
        setPan={setPan}
        zoom={zoom}
        setZoom={setZoom}
        background={background}
        peers={peers}
        reportCursor={reportCursor}
      />

      {/* Top-right: export menu (floating — it reads the live shape data). */}
      <div className="absolute right-3 top-3 z-30">
        <ExportMenu
          shapeCount={shapes.length}
          onExportSvg={handleExportSvg}
          onExportPng={handleExportPng}
          onCopyImage={handleCopyImage}
          onClearCanvas={() => setClearOpen(true)}
          canClear={canEditBoard}
        />
      </div>

        {/* Left edge (centered): the vertical tool pill. */}
        <div className="absolute left-3 top-1/2 z-30 -translate-y-1/2">
          <Toolbar activeTool={activeTool} onToolChange={setActiveTool} />
        </div>

        {/* Contextual selection toolbar — above the selection, or below it
            when there isn't room above. */}
        {selectionAnchor && (
          <div
            className={`absolute z-30 -translate-x-1/2 ${
              selectionAnchor.below ? 'translate-y-0 pt-2' : '-translate-y-full pb-2'
            }`}
            style={{ left: selectionAnchor.left, top: selectionAnchor.top }}
          >
            <SelectionToolbar
              count={selectedShapes.length}
              onDuplicate={handleDuplicate}
              onCopy={handleCopy}
              onDelete={handleDelete}
              onAskAi={() => setAiOpen(true)}
            />
          </div>
        )}

        {/* Right edge: style panel (stroke / fill / width / font), tucked below
            the export menu. Hidden while the AI panel is open — both dock to the
            right and would overlap. */}
        {showStylePanel && !aiOpen && (
          <div className="absolute right-3 top-16 z-20">
            <StylePanel
              style={panelStyle}
              onStyleChange={onStyleChange}
              selectedShape={selectedShape}
              showFill={showFill}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onReorder={handleReorder}
            />
          </div>
        )}

        {/* Bottom-left: zoom + undo/redo. */}
        <div className="absolute bottom-4 left-4 z-30 flex items-center gap-2">
          <ZoomControls
            zoom={zoom}
            onZoomIn={() => zoomTo(1.2)}
            onZoomOut={() => zoomTo(1 / 1.2)}
            onReset={resetView}
          />
          <div className="pointer-events-auto flex items-center overflow-hidden rounded-xl border border-border bg-card/95 shadow-[0_4px_20px_rgba(26,26,46,0.10)] backdrop-blur">
            <button
              type="button"
              onClick={() => canvas.undo()}
              title="Undo"
              aria-label="Undo"
              className="flex h-9 w-9 items-center justify-center text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => canvas.redo()}
              title="Redo"
              aria-label="Redo"
              className="flex h-9 w-9 items-center justify-center text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>
          <BackgroundPicker value={background} onChange={changeBackground} />
        </div>

        {/* Bottom-right: AI assistant (collapsed pill / expanded panel). */}
        <AiAssistant
          docId={docId}
          userId={user?.id ?? ''}
          canvas={canvas}
          selectedShapeIds={selectedIds}
          open={aiOpen}
          onOpenChange={setAiOpen}
          onRevealBounds={revealBounds}
        />

        {/* Empty hint. */}
        {shapes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="font-hand text-3xl text-muted-foreground">Start drawing</p>
              <p className="max-w-xs text-sm text-muted-foreground/80">
                Pick a tool on the left and drag on the canvas, or ask the assistant to draw for you.
              </p>
            </div>
          </div>
        )}

      {/* Confirm before the destructive "Clear canvas" action. */}
      <ConfirmModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => {
          handleClear()
          setClearOpen(false)
        }}
        title="Clear canvas?"
        description="This permanently removes every shape on the board for all collaborators. This can't be undone from here."
        confirmText="Clear canvas"
        cancelText="Cancel"
        variant="destructive"
      />
    </div>
  )
}
