import { useEffect, useMemo, useRef, useState } from 'react'
import { useComments } from './CommentsContext'
import { frameBadgeColor, frameBadgeTextColor, framePinColor } from './frameColor'

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

  if (!drawerOpen) return null

  return (
    <div
      role="dialog"
      aria-label="Comments"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        background: 'white',
        borderLeft: '1px solid #e2e8f0',
        boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.08)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        fontSize: 13,
        color: '#0f172a',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #e2e8f0',
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
              color: '#64748b',
              padding: '2px 8px',
              background: '#f1f5f9',
              borderRadius: 999,
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
          ✕
        </button>
      </div>

      {/* AUTHOR + FILTER ROW */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #e2e8f0',
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
          style={{
            flex: 1,
            height: 30,
            padding: '0 10px',
            fontSize: 12,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            color: '#0f172a',
            outline: 'none',
          }}
        />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: '#64748b',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Resolved
        </label>
      </div>

      {/* BODY */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
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
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No comments yet</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Click <strong>Place</strong> in the toolbar, then click on a prototype
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
                  color: frameExists ? '#0f172a' : '#94a3b8',
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
                    <span style={{ fontWeight: 400, color: '#94a3b8' }}> · deleted</span>
                  ) : null}
                </span>
              </button>
              {[...byRoute.entries()].map(([route, list]) => (
                <div key={route} style={{ marginBottom: 6 }}>
                  <div
                    style={{
                      padding: '2px 16px 4px 30px',
                      fontSize: 10,
                      color: '#64748b',
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
        background: '#fef3c7',
        border: '1px solid #fde68a',
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
              color: '#92400e',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {draftPlacement.route}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: '#92400e' }}>
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
        style={{
          width: '100%',
          resize: 'vertical',
          padding: 8,
          fontSize: 13,
          border: '1px solid #fde68a',
          borderRadius: 6,
          background: 'white',
          color: '#0f172a',
          outline: 'none',
          fontFamily: 'inherit',
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
        background: isSelected ? '#eff6ff' : 'transparent',
        borderLeft: isSelected ? '2px solid #0ea5e9' : '2px solid transparent',
        opacity: resolved ? 0.6 : 1,
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
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
          {comment.author}
        </span>
        <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>
          {timeAgo(comment.createdAt)}
        </span>
      </div>
      <div
        style={{
          fontSize: 13,
          color: '#0f172a',
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
            style={{ ...secondaryBtnStyle, color: '#b91c1c' }}
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
  color: '#475569',
  fontSize: 14,
}

const primaryBtnStyle = {
  padding: '6px 12px',
  background: '#0f172a',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
}

const secondaryBtnStyle = {
  padding: '4px 10px',
  background: 'white',
  color: '#0f172a',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
}

const emptyStateStyle = {
  padding: '32px 16px',
  textAlign: 'center',
  color: '#475569',
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
