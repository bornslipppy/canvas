import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { useComments } from './CommentsContext'
import { frameBadgeColor, frameBadgeTextColor, framePinColor } from './frameColor'

/** Dark palette aligned with the bottom toolbar tray (`#343434`, neutral lifts). */
const D = {
  surface: '#343434',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  text: '#e5e7eb',
  muted: '#9ca3af',
  faint: '#737373',
  inputBg: 'rgba(38, 38, 38, 0.92)',
  inputBorder: '1px solid rgba(255, 255, 255, 0.12)',
  rowSelected: 'rgba(255, 255, 255, 0.08)',
  accentBar: '#60a5fa',
  shadow: '-12px 0 44px rgba(0, 0, 0, 0.55)',
  badgeBg: 'rgba(255, 255, 255, 0.08)',
}

/**
 * The side drawer. Slides in from the right when `drawerOpen` is true.
 *
 * Two responsibilities:
 *   1. Browse existing comments, grouped by frame (then by route within frame)
 *   2. Compose a new comment when a draft pin has been placed
 *
 * It's a flat overlay positioned by viewport (top:0, right:0). It deliberately
 * does NOT live inside the world canvas — that would make it scale with zoom,
 * which would be unusable.
 */
export function CommentDrawer({ frames, onSelectFrame }) {
  const {
    comments,
    frameRoutes,
    selectedId,
    drawerOpen,
    draftPlacement,
    authorName,
    setAuthorName,
    showResolved,
    setShowResolved,
    submitDraft,
    cancelDraft,
    toggleResolve,
    removeComment,
    setDrawerOpen,
    setSelectedId,
    enterCommentMode,
  } = useComments()

  const [draftBody, setDraftBody] = useState('')
  const textareaRef = useRef(null)

  // Auto-focus the textarea when a draft appears.
  useEffect(() => {
    if (selectedId === '__draft__' && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [selectedId])

  // Reset draft text when the draft is cleared (submitted or cancelled).
  useEffect(() => {
    if (!draftPlacement) setDraftBody('')
  }, [draftPlacement])

  // Frame title lookup so we can show "Desktop View" instead of "f1".
  const frameTitleById = useMemo(() => {
    const m = {}
    for (const f of frames) m[f.id] = f.title
    return m
  }, [frames])

  // Group comments by frame, then by route within frame, sorted by createdAt.
  const grouped = useMemo(() => {
    const byFrame = new Map()
    for (const c of comments) {
      if (!showResolved && c.status === 'resolved') continue
      if (!byFrame.has(c.frameId)) byFrame.set(c.frameId, new Map())
      const byRoute = byFrame.get(c.frameId)
      if (!byRoute.has(c.route)) byRoute.set(c.route, [])
      byRoute.get(c.route).push(c)
    }
    // Sort within each route bucket.
    for (const byRoute of byFrame.values()) {
      for (const arr of byRoute.values()) {
        arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      }
    }
    return byFrame
  }, [comments, showResolved])

  const totalVisible = useMemo(() => {
    let n = 0
    for (const byRoute of grouped.values()) {
      for (const arr of byRoute.values()) n += arr.length
    }
    return n
  }, [grouped])

  /**
   * Click-outside to dismiss. Installed only while the drawer is open so we
   * don't pay the listener cost during normal canvas usage.
   *
   * Two escape hatches:
   *   - Clicks inside the drawer itself (compose, comment rows, scrollbar) are ignored
   *   - Clicks inside any element marked `data-drawer-safe` are ignored — the
   *     toolbar uses this so its Comments toggle still works (without the
   *     escape hatch, clicking the toggle would close-then-reopen and net to closed)
   *
   * Listening on `mousedown` so the close fires before any onClick handlers
   * inside the canvas (e.g., placing a comment pin) — the user expects
   * "click outside to close" to feel instant.
   */
  const drawerRef = useRef(null)
  useEffect(() => {
    if (!drawerOpen) return
    const onMouseDown = (e) => {
      if (drawerRef.current && drawerRef.current.contains(e.target)) return
      if (e.target.closest && e.target.closest('[data-drawer-safe]')) return
      setDrawerOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [drawerOpen, setDrawerOpen])

  if (!drawerOpen) return null

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-label="Comments"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        background: D.surface,
        borderLeft: D.border,
        boxShadow: D.shadow,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        fontSize: 13,
        color: D.text,
        colorScheme: 'dark',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: D.border,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          Comments
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 600,
              color: D.muted,
              padding: '2px 8px',
              background: D.badgeBg,
              borderRadius: 999,
              border: D.border,
            }}
          >
            {totalVisible}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close comments drawer"
          style={drawerIconBtnStyle}
        >
          <X className="h-4 w-4 shrink-0" aria-hidden strokeWidth={2} />
        </button>
      </div>

      {/* AUTHOR + FILTER ROW */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: D.border,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          placeholder="Your name"
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          className="placeholder:text-neutral-500"
          style={{
            flex: 1,
            height: 30,
            padding: '0 10px',
            fontSize: 12,
            background: D.inputBg,
            border: D.inputBorder,
            borderRadius: 6,
            color: D.text,
            outline: 'none',
          }}
        />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: D.muted,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            style={{ accentColor: '#60a5fa', width: 14, height: 14, cursor: 'pointer' }}
          />
          Resolved
        </label>
      </div>

      {/* BODY */}
      <div className="min-h-0 flex-1 overflow-y-auto py-2 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
        {/* Draft composer (top, when a pin is placed) */}
        {draftPlacement ? (
          <DraftComposer
            draftPlacement={draftPlacement}
            frameTitle={frameTitleById[draftPlacement.frameId] ?? draftPlacement.frameId}
            body={draftBody}
            setBody={setDraftBody}
            onSubmit={() => {
              submitDraft(draftBody)
            }}
            onCancel={cancelDraft}
            textareaRef={textareaRef}
          />
        ) : null}

        {grouped.size === 0 && !draftPlacement ? (
          <div style={emptyStateStyle}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: D.text }}>No comments yet</div>
            <div style={{ fontSize: 12, color: D.muted }}>
              Click <strong style={{ color: D.text }}>Place</strong> in the toolbar, then click on a prototype
              to drop a pin.
            </div>
            <button
              type="button"
              onClick={enterCommentMode}
              style={{ ...primaryBtnStyle, marginTop: 12 }}
            >
              Place a comment
            </button>
          </div>
        ) : null}

        {[...grouped.entries()].map(([frameId, byRoute]) => {
          const frameTitle = frameTitleById[frameId] ?? `Frame ${frameId.slice(0, 6)}`
          const frameExists = frameId in frameTitleById
          return (
            <div key={frameId} style={{ marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => onSelectFrame?.(frameId)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 16px',
                  background: 'transparent',
                  border: 'none',
                  cursor: frameExists ? 'pointer' : 'default',
                  color: frameExists ? D.text : D.muted,
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: framePinColor(frameId),
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {frameTitle}
                  {!frameExists ? (
                    <span style={{ fontWeight: 400, color: D.faint }}> · deleted</span>
                  ) : null}
                </span>
              </button>
              {[...byRoute.entries()].map(([route, list]) => (
                <div key={route} style={{ marginBottom: 6 }}>
                  <div
                    style={{
                      padding: '2px 16px 4px 30px',
                      fontSize: 10,
                      color: D.faint,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {route || '(no route reported)'}
                  </div>
                  {list.map((c, i) => (
                    <CommentRow
                      key={c.id}
                      comment={c}
                      number={i + 1}
                      isSelected={c.id === selectedId}
                      onSelect={() => setSelectedId(c.id)}
                      onResolve={() => toggleResolve(c.id)}
                      onDelete={() => removeComment(c.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DraftComposer({
  draftPlacement, frameTitle, body, setBody,
  onSubmit, onCancel, textareaRef,
}) {
  return (
    <div
      style={{
        margin: '0 16px 12px',
        padding: 12,
        background: 'rgba(234, 179, 8, 0.08)',
        border: '1px solid rgba(250, 204, 21, 0.22)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            ...frameBadgeStyle(draftPlacement.frameId),
          }}
        >
          {frameTitle}
        </span>
        {draftPlacement.route ? (
          <span
            style={{
              fontSize: 10,
              color: '#fbbf24',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {draftPlacement.route}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: '#fbbf24', opacity: 0.85 }}>
            (route not reported)
          </span>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder="Leave a comment…"
        rows={3}
        className="placeholder:text-neutral-500"
        style={{
          width: '100%',
          resize: 'vertical',
          padding: 8,
          fontSize: 13,
          border: D.inputBorder,
          borderRadius: 6,
          background: D.inputBg,
          color: D.text,
          outline: 'none',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!body.trim()}
          style={{
            ...primaryBtnStyle,
            opacity: body.trim() ? 1 : 0.5,
            cursor: body.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Comment (⌘↵)
        </button>
      </div>
    </div>
  )
}

function CommentRow({ comment, number, isSelected, onSelect, onResolve, onDelete }) {
  const resolved = comment.status === 'resolved'
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '8px 16px 8px 30px',
        cursor: 'pointer',
        background: isSelected ? D.rowSelected : 'transparent',
        borderLeft: isSelected ? `2px solid ${D.accentBar}` : '2px solid transparent',
        opacity: resolved ? 0.55 : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            ...frameBadgeStyle(comment.frameId),
            flexShrink: 0,
          }}
        >
          #{number}
        </span>
        <span style={{ fontSize: 11, color: D.muted, fontWeight: 600 }}>
          {comment.author}
        </span>
        <span style={{ fontSize: 10, color: D.faint, marginLeft: 'auto' }}>
          {timeAgo(comment.createdAt)}
        </span>
      </div>
      <div
        style={{
          fontSize: 13,
          color: D.text,
          lineHeight: 1.45,
          textDecoration: resolved ? 'line-through' : 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {comment.body}
      </div>
      {isSelected ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onResolve()
            }}
            style={secondaryBtnStyle}
          >
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            style={{ ...secondaryBtnStyle, color: '#fca5a5', borderColor: 'rgba(248, 113, 113, 0.35)' }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}

function frameBadgeStyle(frameId) {
  return {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 999,
    background: frameBadgeColor(frameId),
    color: frameBadgeTextColor(frameId),
    letterSpacing: 0.4,
    display: 'inline-block',
  }
}

const drawerIconBtnStyle = {
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  borderRadius: 4,
  color: '#a3a3a3',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const primaryBtnStyle = {
  padding: '6px 12px',
  background: '#e5e7eb',
  color: '#171717',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
}

const secondaryBtnStyle = {
  padding: '4px 10px',
  background: 'rgba(38, 38, 38, 0.6)',
  color: '#e5e7eb',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
}

const emptyStateStyle = {
  padding: '32px 16px',
  textAlign: 'center',
  color: '#9ca3af',
}

function timeAgo(iso) {
  const t = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.floor((now - t) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
