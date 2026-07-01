/**
 * AiAssistant — the floating AI panel that draws and edits the canvas for you.
 *
 * Toggled by a FAB in the bottom-right. The panel makes the *model* a
 * first-class part of the UI (a labelled picker in the header), streams the
 * assistant's reply token-by-token, and applies every canvas tool call live to
 * the SAME `useCanvas` surface the editor uses — so shapes appear as the model
 * "draws" them, synced to every connected user.
 *
 * Conversation persistence mirrors `ChatPanel`: the canonical turns come from
 * `useQuery('ai-messages')` (so history survives reloads and board switches),
 * and an in-flight overlay carries only the turn currently streaming until its
 * persisted rows arrive. The active chat id is remembered per board in
 * localStorage so the same multi-turn context resumes when the board reopens.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getAuthToken, parseSseLine, decodeAiStreamChunk, useQuery } from 'deepspace'
import type { CanvasShapeClient } from 'deepspace'
import type { OptimisticCanvasResult } from './useOptimisticCanvas'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/atom-one-dark.css'
import { Sparkles, X, ArrowUp, ChevronDown, Check, Square, AlertCircle, Plus, RotateCcw } from 'lucide-react'
import { toolCallToCanvasOps, applyCanvasOp, createdOpBounds, type CanvasApi } from '../../ai/canvas-stream'
import { boundsOf, type Bounds } from '../../ai/shape-layout'
import { SHAPE_DEFAULTS } from '../../ai/canvas-shape'
import type { CanvasContext } from '../../ai/canvas-tools'
import { MODEL_OPTIONS, type ModelOption } from '../../ai/models'
import {
  reduceToolCalls,
  foldTurnStatus,
  type ToolCallDisplay,
  type ToolStreamAction,
  type TurnStatus,
} from '../../ai/tool-call-state'
import { isPolygonShape, polygonPoints } from './geo'
import type { Box } from './types'

interface AiAssistantProps {
  docId: string
  /** Current user id — scopes the persisted chat-history query. */
  userId: string
  canvas: OptimisticCanvasResult
  selectedShapeIds: string[]
  /** Panel open state — lifted so the selection toolbar's "Ask AI" can open it. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Scroll/zoom the editor so a just-drawn region is in view. New AI content is
   * placed in free space BELOW existing shapes, which can be off-screen — this
   * brings it back into view so the user sees the drawing land.
   */
  onRevealBounds?: (bounds: Bounds) => void
}

// Single source of truth shared with the worker allowlist + ChatPanel.
const MODELS: ModelOption[] = MODEL_OPTIONS
// Shared with ChatPanel so the picked model carries across both AI surfaces.
const MODEL_STORAGE_KEY = 'deepspace-ai-model'
/** Per-board active chat id, so a board reopens its own conversation. */
const chatStorageKey = (docId: string) => `drawspace-ai-chat:${docId}`

const SUGGESTIONS = [
  'Draw a house with a roof, door, and two windows',
  'Draw a smiling sun in the corner',
  'System design diagram for a URL shortener',
  'Flowchart: start, process, decision, end',
  'Make the selected shapes blue',
]

/** A turn currently streaming (or just streamed) before its rows persist. */
type InFlightLine = {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolCallDisplay[]
  /** Shapes this turn has drawn so far (for the live working indicator). */
  drawnCount: number
  /** Server-assigned recordId (from `X-Asst-Id`) for id-based dedup. */
  serverId?: string
  /** The chat this overlay belongs to — drop it when the chat switches. */
  forChatId: string
}

// The ai-messages columns, as delivered by useQuery (wrapped in a RecordData
// envelope: recordId / data / createdAt / updatedAt).
type AiMessageData = {
  chatId: string
  userId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  parts?: unknown[]
}

/** A normalized item ready to render, from either persisted rows or overlay. */
type RenderItem = {
  key: string
  role: 'user' | 'assistant'
  text: string
  status: TurnStatus | null
  drawnCount: number
  streaming: boolean
}

/** Did a persisted assistant row run any drawing/tool calls? */
function assistantDidDraw(parts: unknown): boolean {
  return (
    Array.isArray(parts) &&
    parts.some((p) => {
      const t = (p as { type?: unknown })?.type
      return typeof t === 'string' && t.includes('tool')
    })
  )
}

/** Map a raw error message to friendlier copy; the raw text stays in the title. */
function friendlyError(message: string): string {
  if (/\b429\b/.test(message) || /rate.?limit/i.test(message)) {
    return 'The assistant is busy right now — please try again in a moment.'
  }
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return 'Connection lost. Check your network and try again.'
  }
  return message
}

export function AiAssistant({
  docId,
  userId,
  canvas,
  selectedShapeIds,
  open,
  onOpenChange,
  onRevealBounds,
}: AiAssistantProps) {
  const { shapes, addShape, updateShape, moveShape, resizeShape, deleteShape, canWrite, beginGesture, endGesture } =
    canvas

  const [input, setInput] = useState('')
  const [inFlight, setInFlight] = useState<InFlightLine[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatId, setChatId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(chatStorageKey(docId))
    } catch {
      return null
    }
  })
  const [modelId, setModelId] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(MODEL_STORAGE_KEY)
      if (saved && MODELS.some((m) => m.id === saved)) return saved
    } catch {
      /* ignore */
    }
    return MODELS[0].id
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  // Controls the in-flight stream so we can stop it (button) or abort it on
  // panel close / unmount — otherwise tokens keep accruing after the user leaves.
  const abortRef = useRef<AbortController | null>(null)
  // Last sent prompt, so the error bar's Retry can resend it.
  const lastSendRef = useRef<string | null>(null)
  // Synchronous mirror of `isLoading` so `send` (stable across loading flips)
  // can guard against a double-submit in the window before React re-renders.
  const isLoadingRef = useRef(false)

  const selectedModel = MODELS.find((m) => m.id === modelId) ?? MODELS[0]

  // Canonical, persisted history for the active chat. A sentinel chat id yields
  // an empty result when no chat exists yet.
  const queryWhere = useMemo(() => ({ chatId: chatId ?? '__none__', userId }), [chatId, userId])
  const { records: persistedRecords } = useQuery<AiMessageData>('ai-messages', {
    where: queryWhere,
    orderBy: 'createdAt',
    orderDir: 'asc',
  })

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Focus the prompt as soon as the panel opens (e.g. from the selection
  // toolbar's "Ask AI"), so the user can type straight away.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Auto-grow the composer up to a cap, then scroll within it.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (!input) {
      el.style.height = ''
      return
    }
    const raf = requestAnimationFrame(() => {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`
    })
    return () => cancelAnimationFrame(raf)
  }, [input])

  const canvasApi = useMemo<CanvasApi>(
    () => ({ addShape, updateShape, moveShape, resizeShape, deleteShape }),
    [addShape, updateShape, moveShape, resizeShape, deleteShape],
  )

  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  // Kept in a ref so `send` (a stable useCallback) always calls the latest
  // reveal handler without re-registering on every parent render.
  const onRevealBoundsRef = useRef(onRevealBounds)
  onRevealBoundsRef.current = onRevealBounds
  const geometryFor = useCallback((shapeId: string) => {
    const s = shapesRef.current.find((sh) => sh.id === shapeId)
    return s ? { x: s.x, y: s.y, width: s.width, height: s.height } : undefined
  }, [])

  const buildContext = useCallback(
    (): CanvasContext => ({
      docId,
      shapes: shapes.map((s) => {
        const entry: CanvasContext['shapes'][number] = {
          id: s.id,
          type: s.type,
          x: s.x,
          y: s.y,
          width: s.width,
          height: s.height,
        }
        // Carry color/text so the model can act on "the blue box" / "the Start node".
        if (typeof s.props.fill === 'string') entry.fill = s.props.fill
        if (typeof s.props.stroke === 'string') entry.stroke = s.props.stroke
        if (typeof s.props.text === 'string') entry.text = s.props.text
        return entry
      }),
      selectedShapeIds,
    }),
    [docId, shapes, selectedShapeIds],
  )

  // Shapes backing the selection chips — derived from the live canvas so a chip
  // shows the actual shape (glyph + color + label), not just a count.
  const selectedShapes = useMemo(
    () => selectedShapeIds.map((id) => shapes.find((s) => s.id === id)).filter((s): s is CanvasShapeClient => !!s),
    [selectedShapeIds, shapes],
  )

  // Merge persisted rows with the in-flight overlay, deduped by id. Persisted
  // wins; an overlay row is dropped once its persisted twin (matched by id, or
  // by the server-assigned id for assistant rows) arrives.
  const items: RenderItem[] = useMemo(() => {
    const persisted: RenderItem[] = persistedRecords
      .filter((r) => r.data.role === 'user' || r.data.role === 'assistant')
      .map((r) => ({
        key: r.recordId,
        role: r.data.role as 'user' | 'assistant',
        text: r.data.content ?? '',
        status:
          r.data.role === 'assistant' && assistantDidDraw(r.data.parts)
            ? { phase: 'done', label: 'Drew on canvas' }
            : null,
        drawnCount: 0,
        streaming: false,
      }))
    const persistedIds = new Set(persisted.map((p) => p.key))

    const tail: RenderItem[] = inFlight
      .filter((m) => m.forChatId === chatId)
      .filter((m) => !persistedIds.has(m.id) && !(m.serverId && persistedIds.has(m.serverId)))
      .map((m) => ({
        key: m.id,
        role: m.role,
        text: m.text,
        status: m.role === 'assistant' ? foldTurnStatus(m.tools, isLoading) : null,
        drawnCount: m.drawnCount,
        streaming: m.role === 'assistant' && isLoading,
      }))

    return [...persisted, ...tail]
  }, [persistedRecords, inFlight, chatId, isLoading])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  const setModel = (id: string) => {
    setModelId(id)
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, id)
    } catch {
      /* ignore */
    }
  }

  const send = useCallback(
    async (content: string) => {
      if (isLoadingRef.current || !content.trim()) return
      setError(null)
      isLoadingRef.current = true
      setIsLoading(true)
      lastSendRef.current = content

      const controller = new AbortController()
      abortRef.current = controller

      // Ids generated upfront so the catch/abort path can target this turn's
      // assistant row even before the overlay is set.
      const userMessageId = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const assistantId = `asst-${Date.now()}`
      // Drop the assistant overlay row if it never produced text or a tool call —
      // e.g. the user hits Stop before anything streams. Avoids a misleading
      // "No response — try rephrasing." after a deliberate stop.
      const dropEmptyAssistant = () =>
        setInFlight((cur) => cur.filter((l) => l.id !== assistantId || l.text !== '' || l.tools.length > 0))

      try {
        const token = await getAuthToken()

        // Create a fresh chat row and return its id — used for the first turn and
        // to recover from a stale/foreign stored chat id (the 404 path below).
        const createChat = async (): Promise<string> => {
          const createRes = await fetch('/api/ai/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ title: 'Canvas assistant' }),
            signal: controller.signal,
          })
          if (!createRes.ok) throw new Error(`Failed to create chat: ${createRes.status}`)
          const data = (await createRes.json()) as { chat: { id: string } }
          return data.chat.id
        }
        const rememberChat = (id: string) => {
          setChatId(id)
          try {
            window.localStorage.setItem(chatStorageKey(docId), id)
          } catch {
            /* ignore */
          }
        }

        let activeChatId = chatId
        if (!activeChatId) {
          activeChatId = await createChat()
          rememberChat(activeChatId)
        }

        // Overlay carries ONLY this turn; history comes from the persisted query.
        setInFlight([
          { id: userMessageId, role: 'user', text: content, tools: [], drawnCount: 0, forChatId: activeChatId },
          { id: assistantId, role: 'assistant', text: '', tools: [], drawnCount: 0, forChatId: activeChatId },
        ])

        const appendText = (delta: string) =>
          setInFlight((cur) => cur.map((l) => (l.id === assistantId ? { ...l, text: l.text + delta } : l)))
        const applyToolAction = (action: ToolStreamAction) =>
          setInFlight((cur) =>
            cur.map((l) => (l.id === assistantId ? { ...l, tools: reduceToolCalls(l.tools, action) } : l)),
          )
        const bumpDrawn = (n: number) =>
          setInFlight((cur) => cur.map((l) => (l.id === assistantId ? { ...l, drawnCount: l.drawnCount + n } : l)))

        const postTurn = (cid: string) =>
          fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ chatId: cid, userMessageId, content, modelId, canvasContext: buildContext() }),
            signal: controller.signal,
          })

        let res = await postTurn(activeChatId)
        if (res.status === 404) {
          // The stored chat id is stale or belongs to another user — drop it,
          // start a fresh chat, re-point the overlay at it, and retry once. This
          // is what stops a bad stored id from wedging the panel permanently.
          try {
            window.localStorage.removeItem(chatStorageKey(docId))
          } catch {
            /* ignore */
          }
          const newId = await createChat()
          rememberChat(newId)
          setInFlight((cur) => cur.map((l) => ({ ...l, forChatId: newId })))
          activeChatId = newId
          res = await postTurn(newId)
        }
        if (!res.ok || !res.body) {
          const detail = res.body ? await res.text().catch(() => '') : ''
          throw new Error(detail || `Request failed: ${res.status}`)
        }

        // Tag the overlay assistant row with the server id so the dedup memo can
        // drop it once the persisted row arrives over WebSocket (clock-skew-proof).
        const serverAsstId = res.headers.get('X-Asst-Id')
        if (serverAsstId) {
          setInFlight((cur) => cur.map((l) => (l.id === assistantId ? { ...l, serverId: serverAsstId } : l)))
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        // Turn-local placement accumulator. Seeded ONCE from the pre-turn shapes
        // (NOT re-read from `useCanvas` per op — addShape doesn't update `shapes`
        // synchronously, so reading it mid-turn would see a stale snapshot and
        // every batch would stack at the same spot). Each placed shape is
        // appended here so the next batch in the same turn tiles below it.
        const placedBounds: Bounds[] = shapesRef.current.map((s) => ({
          x: s.x,
          y: s.y,
          width: s.width,
          height: s.height,
        }))
        // Bounding boxes added THIS turn — used to frame the new content at the end.
        const addedBounds: Bounds[] = []
        const handleLine = (line: string) => {
          const chunk = parseSseLine(line)
          if (!chunk) return
          const action = decodeAiStreamChunk(chunk)
          if (!action) return
          switch (action.type) {
            case 'append-text':
              appendText(action.delta)
              return
            case 'upsert-tool-call':
              applyToolAction(action)
              try {
                // One tool call can expand into many shapes (drawDiagram /
                // createShapes), so apply every op it yields. Pass the running
                // placement context so new shapes land in free space, and feed
                // each created shape back into it.
                const ops = toolCallToCanvasOps(action.toolName, action.input, { existing: placedBounds })
                if (ops.length > 0) {
                  // Group this tool call's shapes into ONE undo step. The loop
                  // is synchronous and `endGesture` runs in `finally`, so the
                  // gesture can never be left open across the async stream.
                  beginGesture()
                  try {
                    for (const op of ops) {
                      const geometry = op.kind === 'update' ? geometryFor(op.shapeId) : undefined
                      applyCanvasOp(op, canvasApi, geometry)
                    }
                  } finally {
                    endGesture()
                  }
                }
                // Feed what we just placed back into the accumulator so the next
                // tool call this turn tiles below it (and reveal covers it).
                const created = createdOpBounds(ops)
                placedBounds.push(...created)
                addedBounds.push(...created)
                if (created.length > 0) {
                  bumpDrawn(created.length)
                  // Follow along: pan to the batch we just drew so the user sees
                  // the drawing happen even though it lands below existing content.
                  const batchBounds = boundsOf(created)
                  if (batchBounds) onRevealBoundsRef.current?.(batchBounds)
                }
              } catch (opErr) {
                // Surface the failure into the turn status instead of swallowing
                // it — otherwise a bad tool call leaves a falsely-green "Done".
                console.error('[ai-assistant] bad tool call', action.toolName, opErr)
                applyToolAction({
                  type: 'fail-tool-output',
                  toolCallId: action.toolCallId,
                  errorText: opErr instanceof Error ? opErr.message : 'Could not draw that shape',
                })
              }
              return
            case 'finalize-tool-call':
            case 'fail-tool-input':
            case 'fail-tool-output':
              // Reflect success/failure of the tool result (ok:false → error).
              applyToolAction(action)
              return
            case 'stream-error':
              setError(action.errorText)
              return
            case 'abort':
              // Server-side stop with no error chunk to follow — drop the empty
              // assistant row so a halted turn doesn't read as "No response".
              dropEmptyAssistant()
              return
          }
        }

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const split = buf.split('\n')
          buf = split.pop() ?? ''
          for (const line of split) handleLine(line)
        }
        buf += decoder.decode()
        handleLine(buf)

        // Frame the whole of what the assistant just drew (placed below existing
        // content, which may be off-screen).
        const newContent = boundsOf(addedBounds)
        if (newContent) onRevealBoundsRef.current?.(newContent)
      } catch (err) {
        // A user-initiated stop (panel close / Stop button) isn't an error —
        // just clear the empty assistant row it left behind.
        if (err instanceof DOMException && err.name === 'AbortError') {
          dropEmptyAssistant()
        } else {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        abortRef.current = null
        isLoadingRef.current = false
        setIsLoading(false)
      }
    },
    [chatId, docId, modelId, buildContext, canvasApi, geometryFor, beginGesture, endGesture],
  )

  const submit = () => {
    const value = input.trim()
    // No point sending when read-only — the SDK drops every resulting write.
    if (!value || isLoading || !canWrite) return
    setInput('')
    void send(value)
  }

  const retry = () => {
    if (lastSendRef.current && !isLoading) void send(lastSendRef.current)
  }

  const newChat = () => {
    abortRef.current?.abort()
    setChatId(null)
    try {
      window.localStorage.removeItem(chatStorageKey(docId))
    } catch {
      /* ignore */
    }
    setInFlight([])
    setError(null)
    setInput('')
    inputRef.current?.focus()
  }

  const closePanel = () => {
    abortRef.current?.abort()
    onOpenChange(false)
    // Return focus to the trigger so keyboard users keep their place.
    fabRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closePanel()
    }
  }

  const pickSuggestion = (s: string) => {
    setInput(s)
    inputRef.current?.focus()
  }

  const hasMessages = items.length > 0

  return (
    <>
      {/* Panel */}
      {open && (
        <div
          data-testid="ai-assistant"
          role="dialog"
          aria-label="AI assistant"
          className="pointer-events-auto absolute bottom-20 right-4 z-40 flex h-[min(540px,calc(100dvh-7rem))] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_40px_rgba(26,26,46,0.22)]"
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ai-soft text-ai">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-bold text-foreground">Assistant</div>
                <ModelPicker model={selectedModel} onChange={setModel} />
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              {(hasMessages || chatId) && (
                <button
                  type="button"
                  data-testid="ai-new-chat"
                  onClick={newChat}
                  aria-label="New conversation"
                  title="New conversation"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                data-testid="ai-close"
                onClick={closePanel}
                aria-label="Close assistant"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-label="Assistant conversation"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-4"
          >
            {!hasMessages ? (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {canWrite
                    ? 'I can draw pictures and diagrams and edit shapes for you. Try one of these:'
                    : 'You have read-only access to this board, so the assistant can’t draw here.'}
                </p>
                {canWrite && (
                  <div className="flex flex-col gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => pickSuggestion(s)}
                        className="rounded-xl border border-border px-3 py-2 text-left text-[13px] text-foreground/80 transition-colors hover:border-ai/40 hover:bg-accent"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              items.map((it, i) => (
                <MessageBubble key={it.key} item={it} streaming={it.streaming && i === items.length - 1} />
              ))
            )}
          </div>

          {selectedShapes.length > 0 && (
            <SelectionChips shapes={selectedShapes} />
          )}
          {!canWrite && (
            <div className="shrink-0 px-3.5 pb-1 text-[11px] text-muted-foreground">
              Read-only access — drawing is disabled.
            </div>
          )}
          {error && (
            <div className="shrink-0 px-3.5 pb-1.5" role="alert">
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[12px] text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="flex-1 leading-snug" title={error}>
                  {friendlyError(error)}
                </span>
                {lastSendRef.current && (
                  <button
                    type="button"
                    data-testid="ai-retry"
                    onClick={retry}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="shrink-0 border-t border-border p-2.5">
            <div className="relative rounded-xl border border-border bg-background transition-colors focus-within:border-ai/50">
              <textarea
                ref={inputRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={isLoading || !canWrite}
                placeholder={canWrite ? 'Ask the assistant to draw…' : 'Read-only — drawing disabled'}
                className="block max-h-[140px] w-full resize-none rounded-xl bg-transparent px-3 py-2.5 pr-11 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
              />
              {isLoading ? (
                <button
                  type="button"
                  data-testid="ai-stop"
                  onClick={stop}
                  aria-label="Stop generating"
                  className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-90"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={input.trim().length === 0 || !canWrite}
                  aria-label="Send"
                  className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-ai text-ai-foreground transition-opacity hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom-right pill. Stays put while the panel is open (it's the panel's
          anchor): when closed it opens the panel, when open it just refocuses
          the prompt — closing is done from the panel's own ✕. */}
      <button
        ref={fabRef}
        type="button"
        data-testid="ai-fab"
        onClick={() => {
          if (open) inputRef.current?.focus()
          else onOpenChange(true)
        }}
        aria-label={open ? 'Focus assistant prompt' : 'Open assistant'}
        aria-expanded={open}
        className={`pointer-events-auto absolute bottom-4 right-4 z-40 flex h-12 items-center gap-2.5 rounded-full bg-card/95 pl-3.5 pr-4 text-sm font-medium text-foreground shadow-[0_10px_34px_rgba(15,23,42,0.18)] ring-4 backdrop-blur transition-colors ${
          open ? 'border border-ai ring-ai/20' : 'border border-ai/40 ring-ai/15 hover:border-ai/70'
        }`}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ai-soft text-ai">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="hidden sm:inline">Ask Drawspace AI</span>
        <span className="sm:hidden">Ask AI</span>
      </button>
    </>
  )
}

function MessageBubble({ item, streaming }: { item: RenderItem; streaming: boolean }) {
  if (item.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] text-primary-foreground">
          {item.text}
        </div>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {item.status && <TurnStatusView status={item.status} drawnCount={item.drawnCount} />}
      {item.text ? (
        <div className="max-w-[90%] min-w-0 break-words [overflow-wrap:anywhere] rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-[13px] text-foreground">
          <Markdown text={item.text} />
        </div>
      ) : streaming && !item.status ? (
        // No text yet but still streaming and no status to lean on → a quiet
        // typing indicator so the panel never looks frozen.
        <TypingIndicator />
      ) : !item.status && !streaming ? (
        // A settled assistant turn that produced nothing — say so rather than
        // leaving a blank bubble.
        <div className="text-[12px] italic text-muted-foreground">No response — try rephrasing.</div>
      ) : null}
    </div>
  )
}

/** Plural-aware "N shape(s)". */
function shapeCountLabel(n: number): string {
  return `${n} shape${n === 1 ? '' : 's'}`
}

/**
 * The single, calm per-turn status. "Planning…/Drawing…" gets a polished
 * working card (animated sparkle + live shape count); a finished turn shows a
 * green check; a failure shows a red chip with the message.
 */
function TurnStatusView({ status, drawnCount }: { status: TurnStatus; drawnCount: number }) {
  if (status.phase === 'error') {
    return (
      <span
        data-testid="ai-status"
        data-phase="error"
        className="inline-flex items-center gap-1.5 self-start rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive"
        title={status.errorText}
        role="alert"
      >
        <AlertCircle className="h-3 w-3 shrink-0" />
        {status.errorText ?? status.label}
      </span>
    )
  }
  if (status.phase === 'done') {
    const label = drawnCount > 0 ? `Drew ${shapeCountLabel(drawnCount)}` : status.label
    return (
      <span
        data-testid="ai-status"
        data-phase="done"
        className="inline-flex items-center gap-1.5 self-start rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
      >
        <Check className="h-3 w-3 shrink-0 text-green-600 dark:text-green-500" />
        {label}
      </span>
    )
  }
  // planning / working — a polished working card with a live count. No
  // `aria-live` here: the conversation log already announces this region, and a
  // nested live region would double-announce.
  const working = status.phase === 'working'
  return (
    <span
      data-testid="ai-status"
      data-phase={status.phase}
      className="inline-flex items-center gap-2 self-start rounded-full bg-ai-soft/70 px-3 py-1.5 text-[12px] font-medium text-ai"
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse" />
      <span>{working ? 'Drawing' : 'Thinking'}</span>
      {working && drawnCount > 0 && <span className="text-ai/60">· {shapeCountLabel(drawnCount)}</span>}
      <BouncingDots dotClass="h-1 w-1 bg-ai/70" />
    </span>
  )
}

/** Three staggered bouncing dots — the "still working" cue. */
function BouncingDots({ dotClass }: { dotClass: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      <span className={`animate-bounce rounded-full ${dotClass} [animation-delay:-0.2s]`} />
      <span className={`animate-bounce rounded-full ${dotClass} [animation-delay:-0.1s]`} />
      <span className={`animate-bounce rounded-full ${dotClass}`} />
    </span>
  )
}

function TypingIndicator() {
  return (
    <div
      data-testid="ai-typing"
      aria-label="Assistant is thinking"
      className="flex w-fit items-center rounded-2xl rounded-bl-md bg-muted px-3 py-2.5"
    >
      <BouncingDots dotClass="h-1.5 w-1.5 bg-muted-foreground/60" />
    </div>
  )
}

// ----- Selection chips ----------------------------------------------------

/**
 * A horizontally-scrollable strip of the currently-selected shapes — each chip
 * shows a mini glyph of the shape (in its own colors) plus a label, so the user
 * sees exactly what the assistant will act on instead of just a count.
 */
function SelectionChips({ shapes }: { shapes: CanvasShapeClient[] }) {
  return (
    <div className="shrink-0 px-3.5 pb-1.5">
      <div className="mb-1 text-[11px] font-medium text-primary">
        Editing {shapeCountLabel(shapes.length)}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {shapes.map((s) => (
          <span
            key={s.id}
            data-testid="ai-selection-chip"
            title={shapeLabel(s)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground/80"
          >
            <ShapeGlyph shape={s} />
            <span className="max-w-[88px] truncate">{shapeLabel(s)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** A label for a selection chip — the text content for text shapes, else type. */
function shapeLabel(shape: CanvasShapeClient): string {
  if (shape.type === 'text') {
    const t = (shape.props.text as string | undefined)?.trim()
    if (t) return t
  }
  // Humanize the type (e.g. "right-triangle" → "Right triangle").
  const raw = shape.type.replace(/-/g, ' ')
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/** A 16×16 mini preview of a shape, drawn in its own stroke/fill. */
function ShapeGlyph({ shape }: { shape: CanvasShapeClient }) {
  const stroke = (shape.props.stroke as string) || SHAPE_DEFAULTS.stroke
  const fillRaw = (shape.props.fill as string) || 'transparent'
  const fill = fillRaw === 'transparent' ? 'none' : fillRaw
  const b: Box = { x: 2.5, y: 2.5, width: 11, height: 11 }
  const common = {
    fill,
    stroke,
    strokeWidth: 1.4,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      {shape.type === 'rect' && <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={2} {...common} />}
      {shape.type === 'ellipse' && (
        <ellipse cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} {...common} />
      )}
      {shape.type === 'diamond' && (
        <polygon
          points={`${b.x + b.width / 2},${b.y} ${b.x + b.width},${b.y + b.height / 2} ${b.x + b.width / 2},${b.y + b.height} ${b.x},${b.y + b.height / 2}`}
          {...common}
        />
      )}
      {isPolygonShape(shape.type) && (
        <polygon points={polygonPoints(shape.type, b).map((p) => `${p.x},${p.y}`).join(' ')} {...common} />
      )}
      {(shape.type === 'line' || shape.type === 'arrow') && (
        <line x1={b.x} y1={b.y + b.height} x2={b.x + b.width} y2={b.y} stroke={stroke} strokeWidth={1.4} strokeLinecap="round" />
      )}
      {shape.type === 'arrow' && (
        // Small filled head at the top-right tip so an arrow reads differently
        // from a plain line.
        <polygon points="13.5,2.5 9.7,3.8 12.2,6.3" fill={stroke} stroke={stroke} strokeWidth={0.6} strokeLinejoin="round" />
      )}
      {shape.type === 'draw' && (
        <path d="M3 11 Q 6 4 8 8 T 13 6" fill="none" stroke={stroke} strokeWidth={1.4} strokeLinecap="round" />
      )}
      {shape.type === 'text' && (
        <g stroke={stroke} strokeWidth={1.4} strokeLinecap="round">
          <line x1={4} y1={4.5} x2={12} y2={4.5} />
          <line x1={8} y1={4.5} x2={8} y2={12} />
        </g>
      )}
    </svg>
  )
}

// Markdown rendering for assistant messages — matches ChatPanel's approach
// (react-markdown + remark-gfm + rehype-highlight), with compact spacing for
// the narrow assistant panel.
function Markdown({ text }: { text: string }) {
  return (
    <div
      className="leading-relaxed [overflow-wrap:anywhere]
                 [&_p]:my-1.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
                 [&_code]:break-words [&_a]:break-words
                 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:my-2
                 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:my-2
                 [&_h3]:font-semibold [&_h3]:my-1.5
                 [&_strong]:font-semibold [&_em]:italic
                 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
                 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5
                 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5
                 [&_li]:my-0.5
                 [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.9em]
                 [&_pre]:bg-zinc-900 [&_pre]:text-zinc-100 [&_pre]:rounded-md [&_pre]:p-2.5 [&_pre]:my-1.5 [&_pre]:overflow-x-auto
                 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

function ModelPicker({ model, onChange }: { model: ModelOption; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    // `KeyboardEvent` is imported from React in this file, so annotate
    // structurally to reference the DOM event the listener actually receives.
    const onKey = (e: { key: string }) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>()
    for (const m of MODELS) {
      const list = map.get(m.provider) ?? []
      list.push(m)
      map.set(m.provider, list)
    }
    return Array.from(map.entries())
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="ai-model-picker"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        {model.label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-[0_8px_30px_rgba(26,26,46,0.18)]"
        >
          {groups.map(([provider, items], gi) => (
            <div key={provider}>
              {gi > 0 && <div className="border-t border-border" />}
              <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {provider}
              </div>
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onChange(m.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-accent ${
                    m.id === model.id ? 'text-foreground' : 'text-foreground/70'
                  }`}
                >
                  {m.label}
                  {m.id === model.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
