import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createComment as persistCreate,
  deleteComment as persistDelete,
  listComments,
  updateComment as persistUpdate,
  getStoredAuthor,
  setStoredAuthor,
} from './storage'

/**
 * Shape of a draft placement (pin dropped but comment not yet submitted).
 * @typedef {Object} DraftPlacement
 * @property {string} frameId
 * @property {string} route
 * @property {number} x
 * @property {number} y
 */

const CommentsContext = createContext(null)

export function useComments() {
  const ctx = useContext(CommentsContext)
  if (!ctx) throw new Error('useComments must be used inside <CommentsProvider>')
  return ctx
}

/**
 * Provider. Owns:
 *   - `comments`: the full Comment[] from localStorage
 *   - `frameRoutes`: { [frameId]: string } — each frame's currently reported route
 *   - `commentMode`: are we in placement mode? (click on iframe → drop pin)
 *   - `drawerOpen`: is the side drawer open?
 *   - `draftPlacement` / `selectedId`: the in-flight pin or selected pin
 *   - `authorName`: persisted to localStorage between sessions
 *
 * It also installs a window-level listener for `message` events of type
 * `PROTOTYPE_ROUTE`. Prototypes embed the snippet from
 * `snippet-for-prototypes.js` which posts these events on every internal
 * navigation. We match the message source to a specific iframe element via
 * `contentWindow === e.source`, then update that frame's route.
 *
 * Each prototype iframe must have `data-frame-id` on the <iframe> element
 * for the source matching to work.
 */
export function CommentsProvider({ children }) {
  const [comments, setComments] = useState(() => listComments())
  const [frameRoutes, setFrameRoutes] = useState({})
  const [commentMode, setCommentMode] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [draftPlacement, setDraftPlacement] = useState(null)
  const [authorName, setAuthorNameState] = useState(() => getStoredAuthor())
  const [showResolved, setShowResolved] = useState(true)

  const refresh = useCallback(() => {
    setComments(listComments())
  }, [])

  // Listen for route updates from cooperating prototypes.
  useEffect(() => {
    const onMessage = (e) => {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.type !== 'PROTOTYPE_ROUTE') return
      const route = typeof e.data.route === 'string' ? e.data.route : ''
      // Find which iframe sent this by matching contentWindow.
      const iframes = document.querySelectorAll('iframe[data-frame-id]')
      for (const iframe of iframes) {
        if (iframe.contentWindow === e.source) {
          const frameId = iframe.dataset.frameId
          if (!frameId) return
          setFrameRoutes((prev) => (prev[frameId] === route ? prev : { ...prev, [frameId]: route }))
          return
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Persist author across sessions.
  const setAuthorName = useCallback((name) => {
    setAuthorNameState(name)
    setStoredAuthor(name)
  }, [])

  const enterCommentMode = useCallback(() => {
    setCommentMode(true)
    setSelectedId(null)
    setDraftPlacement(null)
  }, [])
  const exitCommentMode = useCallback(() => {
    setCommentMode(false)
  }, [])
  /**
   * Functional toggle so callers don't need to read the current commentMode
   * value — useful from places that would otherwise close over a stale state.
   */
  const toggleCommentMode = useCallback(() => {
    setCommentMode((prev) => {
      if (!prev) {
        setSelectedId(null)
        setDraftPlacement(null)
      }
      return !prev
    })
  }, [])

  /**
   * Called when the user clicks while comment mode is on. Coordinates are in
   * viewport space; we figure out which frame's iframe was clicked and
   * compute normalized coords within that iframe.
   * Returns true if a draft was placed; false if the click missed.
   */
  const placeDraftAt = useCallback((clientX, clientY) => {
    const iframes = document.querySelectorAll('iframe[data-frame-id]')
    for (const iframe of iframes) {
      const rect = iframe.getBoundingClientRect()
      if (clientX < rect.left || clientX >= rect.right) continue
      if (clientY < rect.top || clientY >= rect.bottom) continue
      const frameId = iframe.dataset.frameId
      if (!frameId) continue
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      setDraftPlacement({
        frameId,
        route: frameRoutes[frameId] ?? '',
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      })
      setSelectedId('__draft__')
      setCommentMode(false)
      setDrawerOpen(true)
      return true
    }
    return false
  }, [frameRoutes])

  const cancelDraft = useCallback(() => {
    setDraftPlacement(null)
    setSelectedId(null)
  }, [])

  const submitDraft = useCallback((body) => {
    const trimmed = body.trim()
    if (!draftPlacement || !trimmed) return
    persistCreate({
      frameId: draftPlacement.frameId,
      route: draftPlacement.route,
      x: draftPlacement.x,
      y: draftPlacement.y,
      body: trimmed,
      author: authorName,
    })
    setDraftPlacement(null)
    setSelectedId(null)
    refresh()
  }, [authorName, draftPlacement, refresh])

  const toggleResolve = useCallback((id) => {
    const c = comments.find((x) => x.id === id)
    if (!c) return
    persistUpdate(id, { status: c.status === 'open' ? 'resolved' : 'open' })
    refresh()
  }, [comments, refresh])

  const removeComment = useCallback((id) => {
    if (!window.confirm('Delete this comment? This cannot be undone.')) return
    if (persistDelete(id)) {
      setSelectedId((cur) => (cur === id ? null : cur))
      refresh()
    }
  }, [refresh])

  const selectComment = useCallback((id) => {
    setSelectedId(id)
    setDrawerOpen(true)
  }, [])

  // Escape key: exit comment mode, drop draft, or close drawer (in order).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (commentMode) {
        exitCommentMode()
        return
      }
      if (draftPlacement) {
        cancelDraft()
        return
      }
      if (drawerOpen) {
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commentMode, draftPlacement, drawerOpen, exitCommentMode, cancelDraft])

  const value = useMemo(() => ({
    comments,
    frameRoutes,
    commentMode,
    drawerOpen,
    selectedId,
    draftPlacement,
    authorName,
    showResolved,
    refresh,
    enterCommentMode,
    exitCommentMode,
    toggleCommentMode,
    placeDraftAt,
    cancelDraft,
    submitDraft,
    toggleResolve,
    removeComment,
    selectComment,
    setSelectedId,
    setDrawerOpen,
    setAuthorName,
    setShowResolved,
  }), [
    comments, frameRoutes, commentMode, drawerOpen, selectedId,
    draftPlacement, authorName, showResolved, refresh,
    enterCommentMode, exitCommentMode, toggleCommentMode, placeDraftAt, cancelDraft,
    submitDraft, toggleResolve, removeComment, selectComment,
    setAuthorName,
  ])

  return (
    <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
  )
}
