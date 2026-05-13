import { useMemo } from 'react'
import { useComments } from './CommentsContext'
import { framePinColor } from './frameColor'
import { isCommentVisibleAtRoute } from './types'

/**
 * Renders the pin layer for one frame.
 *
 * Sits INSIDE the iframe wrapper, absolutely positioned, with pointer-events
 * on individual pins only (the layer itself is pointer-events: none so it
 * doesn't block iframe interaction underneath).
 *
 * Pins are positioned with `left: x*100% / top: y*100%` relative to this
 * layer, which has the same dimensions as the iframe. So a pin at (0.5, 0.5)
 * sits at the center of the iframe regardless of canvas zoom/pan — it scales
 * with the frame.
 *
 * Visibility rules:
 *   - Filtered to comments with `frameId === thisFrame.id`
 *   - Then to those whose `route` matches the frame's currently reported route
 *     (so navigating sub-pages inside the iframe hides comments from other sub-pages)
 *   - If `showResolved` is off, hides resolved comments
 *   - Also renders the draft pin if a draft exists on this exact frame+route
 */
export function FramePins({ frameId, frameTitle }) {
  const {
    comments,
    frameRoutes,
    selectedId,
    draftPlacement,
    showResolved,
    selectComment,
  } = useComments()

  const currentRoute = frameRoutes[frameId] ?? ''
  const pinColor = framePinColor(frameId)

  const visibleComments = useMemo(() => {
    return comments
      .filter((c) => c.frameId === frameId)
      .filter((c) => isCommentVisibleAtRoute(c, currentRoute))
      .filter((c) => (showResolved ? true : c.status !== 'resolved'))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [comments, frameId, currentRoute, showResolved])

  // All comments for this frame at this route, regardless of resolved filter —
  // we use this to assign stable numbering so "Comment #3" stays #3 even if
  // earlier comments get hidden by the resolved filter.
  const allOnRoute = useMemo(() => {
    return comments
      .filter((c) => c.frameId === frameId)
      .filter((c) => isCommentVisibleAtRoute(c, currentRoute))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [comments, frameId, currentRoute])

  const draftOnThisFrame =
    draftPlacement &&
    draftPlacement.frameId === frameId &&
    draftPlacement.route === currentRoute

  const draftNumber = draftOnThisFrame ? allOnRoute.length + 1 : null

  return (
    <div
      // pointer-events: none so the layer doesn't block iframe clicks;
      // individual pin buttons override with pointer-events: auto
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 30,
      }}
      aria-hidden={false}
    >
      {visibleComments.map((c) => {
        const number = allOnRoute.findIndex((x) => x.id === c.id) + 1
        const resolved = c.status === 'resolved'
        const selected = c.id === selectedId
        return (
          <button
            key={c.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              selectComment(c.id)
            }}
            title={`${frameTitle} · #${number}${resolved ? ' (resolved)' : ''}`}
            style={{
              position: 'absolute',
              left: `${c.x * 100}%`,
              top: `${c.y * 100}%`,
              transform: `translate(-50%, -50%) ${selected ? 'scale(1.15)' : ''}`,
              width: 26,
              height: 26,
              borderRadius: '50% 50% 50% 4px',
              border: '2px solid white',
              background: resolved ? '#94a3b8' : pinColor,
              color: 'white',
              fontWeight: 700,
              fontSize: 11,
              lineHeight: '22px',
              textAlign: 'center',
              cursor: 'pointer',
              pointerEvents: 'auto',
              boxShadow: selected
                ? '0 0 0 3px rgba(14,165,233,0.35), 0 4px 8px rgba(26, 25, 30, 0.2)'
                : '0 2px 6px rgba(26, 25, 30, 0.2)',
              padding: 0,
              transition: 'transform 80ms ease',
              opacity: resolved ? 0.7 : 1,
            }}
          >
            {number}
          </button>
        )
      })}
      {draftOnThisFrame && draftNumber !== null ? (
        <div
          style={{
            position: 'absolute',
            left: `${draftPlacement.x * 100}%`,
            top: `${draftPlacement.y * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 26,
            height: 26,
            borderRadius: '50% 50% 50% 4px',
            border: '2px dashed white',
            background: pinColor,
            color: 'white',
            fontWeight: 700,
            fontSize: 11,
            lineHeight: '22px',
            textAlign: 'center',
            pointerEvents: 'none',
            boxShadow: '0 0 0 3px rgba(14,165,233,0.45), 0 4px 8px rgba(26, 25, 30, 0.2)',
            opacity: 0.95,
          }}
        >
          {draftNumber}
        </div>
      ) : null}
    </div>
  )
}
