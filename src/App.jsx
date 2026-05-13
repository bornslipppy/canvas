import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'

import { Plus, Upload } from 'lucide-react'

// Import Shadcn Components
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { BlackbirdMark } from "@/components/BlackbirdMark"

// Custom zoom pipeline
import { useFigmaZoom } from '@/hooks/useFigmaZoom'

// Comments layer
import { CommentsProvider, useComments } from './comments/CommentsContext'
import { FramePins } from './comments/FramePins'
import { CommentDrawer } from './comments/CommentDrawer'
import { framePinColor } from './comments/frameColor'

const FRAME_W = 1280
const FRAME_H = 720
const FRAME_TOTAL_H = 750  // body + title gap

/**
 * Each prototype frame is absolutely positioned in canvas world space.
 *
 * Z-ordering (matters for drag-from-title to work in REGULAR mode where the
 * shield is up at z-9998):
 *   - Title (h3): absolute, z-9999 → ALWAYS above the shield.
 *   - Iframe body: relative, z-auto normally, z-1 while dragging → above other
 *     frames while you're moving it, but still below the shield so clicks
 *     are blocked in regular mode the same as any other frame.
 *
 * The outer wrapper does NOT have a z-index, so it doesn't create its own
 * stacking context and the title's z-9999 lives in the global stacking
 * context (where the shield's z-9998 also lives).
 *
 * Memoized so an unrelated parent re-render doesn't re-render every frame —
 * critical for smooth drags, since the drag itself bypasses React state.
 */
const PrototypeFrame = memo(({ id, title, src, srcDoc, x, y, isDragging, onDragStart, width = '1280px', height = '720px' }) => {
  const [pins, setPins] = useState([])

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type === 'NEW_PIN') {
        setPins((prev) => [...prev, {
          id: Date.now() + Math.random(),
          x: event.data.x,
          y: event.data.y
        }])
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return (
    <div
      className="absolute"
      style={{ left: x, top: y }}
      data-frame-id={id}
    >
      {/*
        Title sits above the iframe (top: -28) and above the shield (z-9999).
        Drag handle. The select-none + cursor changes make it feel like Figma.
      */}
      <h3
        onMouseDown={(e) => onDragStart(e, id)}
        className={`text-[12px] font-bold text-neutral-500 tracking-widest uppercase select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ position: 'absolute', top: -28, left: 4, zIndex: 9999 }}
        title="Drag to move this frame"
      >
        {title}
      </h3>
      <div
        className="relative shadow-2xl rounded-xl overflow-hidden border border-neutral-200 bg-white"
        style={{ width, height, zIndex: isDragging ? 1 : 'auto' }}
      >
        {/*
          Two iframe modes:
            - src: a remote URL (the original case — hosted prototypes)
            - srcDoc: an inline HTML document (uploaded local .html files)
          The comments layer doesn't care which one is in play: `data-frame-id`
          is set either way, and the postMessage source-matching uses the
          iframe's contentWindow regardless of origin. A srcDoc iframe whose
          HTML includes the canvas-comments snippet still posts route events
          correctly. Without the snippet, comments scope to frame-only — the
          documented fallback for non-cooperating prototypes.
        */}
        {srcDoc ? (
          <iframe
            srcDoc={srcDoc}
            className="w-full h-full border-none z-10"
            title={title}
            data-frame-id={id}
          />
        ) : (
          <iframe
            src={src}
            className="w-full h-full border-none z-10"
            title={title}
            data-frame-id={id}
          />
        )}
        {/* Comment pins for THIS frame, scoped to its currently reported route. */}
        <FramePins frameId={id} frameTitle={title} />
        {pins.map((pin) => (
          <div
            key={pin.id}
            className="absolute w-6 h-6 bg-neutral-900 rounded-full shadow-[0_0_0_4px_rgba(0,0,0,0.2)] z-20 flex items-center justify-center border-2 border-white animate-in zoom-in duration-300"
            style={{ left: pin.x, top: pin.y, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}
          >
            <div className="w-1 h-1 bg-white rounded-full" />
          </div>
        ))}
      </div>
      {/* Frame color dot — tiny indicator above the title showing the comment
          color for this frame, so it's obvious which pins belong to it. */}
      <FrameBadge frameId={id} />
    </div>
  )
})
PrototypeFrame.displayName = 'PrototypeFrame'

/** Tiny color dot anchored near the frame title. Color is a stable hash of frameId. */
function FrameBadge({ frameId }) {
  return (
    <span
      style={{
        position: 'absolute',
        top: -28,
        right: 4,
        width: 8,
        height: 8,
        borderRadius: 2,
        background: framePinColor(frameId),
        zIndex: 9999,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  )
}

/**
 * CanvasContent is rendered INSIDE <TransformWrapper> so it can access
 * useControls() and useTransformContext() via useFigmaZoom().
 *
 * The `shieldActive` prop comes from App.jsx, which composes it from:
 *   - isShiftPressed: false → shield down (let Shift+Click reach the iframe to drop a pin)
 *   - isGestureActive: true → shield up (a wheel/pinch gesture is in flight; don't let click-through happen)
 * Together: shieldActive = !isShiftPressed || isGestureActive
 */
const CanvasContent = ({ frames, onRailHit, onGestureStateChange, registerControls, shieldActive, onFrameDragStart, draggingFrameId, onShieldClick }) => {
  const innerRef = useRef(null)
  const controls = useControls()

  // Expose the library's imperative controls to the parent (for keyboard shortcuts).
  useEffect(() => { registerControls(controls) }, [controls, registerControls])

  useFigmaZoom(innerRef, {
    minScale: 0.01,
    maxScale: 20,
    onRailHit,
    onGestureStateChange,
  })

  return (
    <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
      <div
        ref={innerRef}
        className="w-[10000px] h-[10000px] relative"
        style={{
          backgroundImage: `radial-gradient(#d4d4d4 2px, transparent 2px)`,
          backgroundSize: '30px 30px',
          touchAction: 'none', // We own all gestures inside the canvas
        }}
      >
        {/*
          Frames are absolutely positioned in canvas world space. Each carries
          its own (x, y). Drag a frame's title to move it; the math accounts
          for the current canvas scale so 1px of cursor motion equals (1/scale)px
          of world motion.
        */}
        {frames.map((frame) => (
          <PrototypeFrame
            key={frame.id}
            id={frame.id}
            title={frame.title}
            src={frame.url}
            srcDoc={frame.srcDoc}
            x={frame.x}
            y={frame.y}
            isDragging={draggingFrameId === frame.id}
            onDragStart={onFrameDragStart}
          />
        ))}

        {/*
          Shift-drop shield.
            shieldActive = true  → iframe receives nothing; wheel zoom works over iframes.
            shieldActive = false → Shift+Click reaches the iframe (so the prototype
                                   can capture it and postMessage a NEW_PIN back to us).
          The shield is force-up during any active wheel gesture, even if Shift is
          held, so a stray Shift tap mid-pinch can't redirect the wheel event into
          the iframe.
        */}
        <div
          className={`absolute inset-0 z-[9998] ${shieldActive ? 'pointer-events-auto' : 'pointer-events-none'}`}
          onClick={onShieldClick}
        />
      </div>
    </TransformComponent>
  )
}

export default function App() {
  return (
    <CommentsProvider>
      <AppInner />
    </CommentsProvider>
  )
}

function AppInner() {
  // Comments layer state (lives in context). We pull what we need for shield
  // composition, cursor logic, click-to-place, and pan-to-frame here.
  const {
    commentMode,
    toggleCommentMode,
    placeDraftAt,
    drawerOpen,
    setDrawerOpen,
    comments,
  } = useComments()

  // Frame world-space coords: top-left of the iframe body in canvas world space.
  // Canvas is 10000x10000 with origin (0,0) at top-left, so center is (5000, 5000).
  const [frames, setFrames] = useState([{
    id: 'f1',
    url: 'http://localhost:5174',
    title: 'Desktop View',
    x: 5000 - FRAME_W / 2,
    y: 5000 - FRAME_TOTAL_H / 2,
  }])
  const [newUrl, setNewUrl] = useState('')
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // Shield composition. Two competing forces:
  //   clickthroughIntent (user wants iframe events): Shift held OR Interact mode on
  //   canvasOverride     (canvas wins regardless):   gesture active, OR Cmd/Ctrl held
  //                                                  (zoom intent), OR Space held
  //                                                  (pan intent — must raise the
  //                                                  shield so library mousedown fires),
  //                                                  OR comment mode on (clicks become
  //                                                  pin placements)
  // Shield is up unless clickthrough wins. canvasOverride trumps clickthrough.
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [isGestureActive, setIsGestureActive] = useState(false)
  const [isInteractMode, setIsInteractMode] = useState(false)
  const [isZoomModifierPressed, setIsZoomModifierPressed] = useState(false)
  const clickthroughIntent = isShiftPressed || isInteractMode
  const canvasOverride = isGestureActive || isZoomModifierPressed || isSpacePressed || commentMode
  const shieldActive = !clickthroughIntent || canvasOverride

  // Frame drag state: null when no drag in progress, otherwise carries the frame
  // being dragged + the cursor/frame positions at drag-start + the canvas scale
  // captured at drag-start (so a concurrent zoom mid-drag doesn't break math).
  const [dragState, setDragState] = useState(null)

  // Wall-bump animation: 'min' or 'max' briefly when the user pushes past a zoom rail.
  const [bumpAxis, setBumpAxis] = useState(null)
  const bumpTimerRef = useRef(null)

  // Library's imperative controls for keyboard shortcuts.
  const controlsRef = useRef(null)
  const registerControls = useCallback((c) => { controlsRef.current = c }, [])

  // Ref to the root div — used to programmatically refocus the parent doc
  // after the user has interacted with an iframe (see handleMouseDown below).
  const rootRef = useRef(null)

  const handleRailHit = useCallback((rail) => {
    setBumpAxis(rail)
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current)
    bumpTimerRef.current = setTimeout(() => setBumpAxis(null), 200)
  }, [])

  const handleGestureStateChange = useCallback((active) => {
    setIsGestureActive(active)
  }, [])

  // Zoom buttons — anchored at viewport center, so they work even when the
  // cursor is over an iframe (where pinch is blocked by the browser). This is
  // the keyboard-free alternative to "hold Cmd and pinch" for Interact mode.
  const zoomBy = useCallback((factor) => {
    const c = controlsRef.current
    if (!c) return
    const componentEl = document.querySelector('.react-transform-component')
    const t = componentEl?.style?.transform ?? ''
    const m = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/)
    if (!m) return
    const camX = parseFloat(m[1])
    const camY = parseFloat(m[2])
    const oldScale = parseFloat(m[3])
    const newScale = Math.min(20, Math.max(0.01, oldScale * factor))
    // Anchor zoom on viewport center so the visual center stays put.
    const vw = window.innerWidth
    const vh = window.innerHeight
    const px = vw / 2
    const py = vh / 2
    const ratio = newScale / oldScale
    const newX = px - (px - camX) * ratio
    const newY = py - (py - camY) * ratio
    c.setTransform(newX, newY, newScale, 200)
  }, [])

  /**
   * Pan/zoom the canvas to center on a specific frame. Used when the user
   * clicks a frame header in the comment drawer — jump to the frame so they
   * can see its pins. Scale is preserved unless we're really zoomed out, in
   * which case we zoom in to a sensible level first.
   */
  const panToFrame = useCallback((frameId) => {
    const frame = frames.find((f) => f.id === frameId)
    if (!frame) return
    const c = controlsRef.current
    if (!c) return
    const componentEl = document.querySelector('.react-transform-component')
    const t = componentEl?.style?.transform ?? ''
    const m = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/)
    const currentScale = m ? parseFloat(m[3]) : 0.5
    const scale = Math.max(0.4, currentScale)
    const frameCenterX = frame.x + FRAME_W / 2
    const frameCenterY = frame.y + FRAME_TOTAL_H / 2
    const vw = window.innerWidth
    const vh = window.innerHeight
    c.setTransform(
      vw / 2 - frameCenterX * scale,
      vh / 2 - frameCenterY * scale,
      scale,
      400
    )
  }, [frames])

  const figmaCursor = `url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7 4.5L7 18.5L11 14.5L17 14.5L7 4.5Z' fill='black' stroke='white' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E"), auto`

  // Single keyboard effect: spacebar pan + Shift tracking + recovery shortcuts + browser-zoom block.
  useEffect(() => {
    const preventBrowserZoom = (e) => {
      // Block native browser pinch-zoom of the page itself.
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }

    const handleDown = (e) => {
      // Track Shift regardless of focus — Shift+Click pin placement should work
      // even if the URL input was previously focused.
      if (e.key === 'Shift') setIsShiftPressed(true)
      // Sync the zoom-modifier from e.metaKey/e.ctrlKey on every keyboard event
      // instead of just on the dedicated key. This makes the state self-healing:
      // if a keyup is lost (a known macOS quirk during pinch gestures), the very
      // next keystroke or mouse movement re-syncs us to ground truth.
      setIsZoomModifierPressed(e.metaKey || e.ctrlKey)

      const tag = e.target.tagName
      const isInInput = tag === 'INPUT' || tag === 'TEXTAREA'
      if (isInInput) return

      if (e.code === 'Space') {
        e.preventDefault()
        setIsSpacePressed(true)
        return
      }

      // 'I' → toggle Interact mode. Ignored inside inputs (early-returned above)
      // so typing URLs containing 'i' doesn't flip the mode.
      if (e.key === 'i' || e.key === 'I') {
        // Don't toggle while a recovery-modifier is held (Shift+I, Cmd+I, etc.)
        // so we don't fight with other shortcuts or accidental keystrokes.
        if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
        e.preventDefault()
        setIsInteractMode((v) => !v)
        return
      }

      // 'C' → toggle Comment mode (place a comment pin). Ignored inside inputs
      // (early-returned above) so typing URLs containing 'c' doesn't flip the mode.
      if (e.key === 'c' || e.key === 'C') {
        if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
        e.preventDefault()
        toggleCommentMode()
        return
      }

      // Escape → exit Interact mode if active. Otherwise no-op (don't preventDefault,
      // so Esc can still do native browser things like exiting fullscreen).
      if (e.code === 'Escape') {
        setIsInteractMode(false)
        return
      }

      // Recovery shortcuts.
      const c = controlsRef.current
      if (!c) return

      // Shift+1 → fit-all (initial scale, centered)
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault()
        c.setTransform(0, 0, 0.5, 200)
        return
      }
      // Shift+0 → reset to 100%
      if (e.shiftKey && e.code === 'Digit0') {
        e.preventDefault()
        c.setTransform(0, 0, 1, 200)
        return
      }
      // Cmd/Ctrl+0 → return to initial state
      if ((e.metaKey || e.ctrlKey) && e.code === 'Digit0') {
        e.preventDefault()
        c.setTransform(0, 0, 0.5, 200)
        return
      }
    }

    const handleUp = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(false)
      if (e.code === 'Space') setIsSpacePressed(false)
      // Re-sync from the event's modifier state. On macOS, e.metaKey on the
      // Meta keyup event is false (the key has been released), so this clears
      // correctly. Same for ctrlKey on Ctrl keyup.
      setIsZoomModifierPressed(e.metaKey || e.ctrlKey)
    }

    // ALSO sync on mousemove. The keyup for Cmd is sometimes dropped on macOS
    // during/after a trackpad pinch gesture. Any subsequent mouse movement
    // delivers an event whose metaKey/ctrlKey reflects the OS truth — so this
    // is the safety net that prevents the shield from getting stuck up.
    const handleMouseMove = (e) => {
      const modActive = e.metaKey || e.ctrlKey
      setIsZoomModifierPressed((prev) => (prev === modActive ? prev : modActive))
    }

    // FIX FOR INTERACT MODE KEYBOARD LOCKOUT:
    // When the user clicks inside a cross-origin iframe, focus moves into that
    // iframe's document. From then on, keydown events (including Space) fire
    // inside the iframe — our parent window listener never sees them. So Space
    // pan stops working after the user has interacted with a prototype.
    //
    // This handler runs on every mousedown over the parent doc. If the click
    // target is NOT an iframe (so the user just clicked the canvas, a title,
    // or the toolbar), we blur whatever iframe currently holds focus and
    // refocus our root element. Subsequent key events flow back to the parent.
    //
    // We deliberately do NOT run this when the click target IS an iframe —
    // that click is the user intentionally interacting with the prototype.
    const handleMouseDown = (e) => {
      if (e.target.tagName === 'IFRAME') return
      const active = document.activeElement
      if (active && active.tagName === 'IFRAME') {
        active.blur()
        rootRef.current?.focus()
      }
    }

    // Defensive: if the window loses focus mid-gesture (alt-tab, etc.), clear
    // transient modifier state so the shield/cursor don't get stuck. Interact
    // mode is sticky and intentionally preserved across blur.
    const handleBlur = () => {
      setIsShiftPressed(false)
      setIsSpacePressed(false)
      setIsZoomModifierPressed(false)
    }

    window.addEventListener('wheel', preventBrowserZoom, { passive: false })
    window.addEventListener('keydown', handleDown)
    window.addEventListener('keyup', handleUp)
    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    window.addEventListener('mousedown', handleMouseDown, { capture: true })
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('wheel', preventBrowserZoom)
      window.removeEventListener('keydown', handleDown)
      window.removeEventListener('keyup', handleUp)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mousedown', handleMouseDown, { capture: true })
      window.removeEventListener('blur', handleBlur)
      if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current)
    }
  }, [])

  // ---------------- Frame dragging ----------------
  // The drag math is OFFSET-BASED in world space: at drag start we capture
  // the world-space offset from cursor to frame. On every rAF tick we place
  // the frame at (worldCursor + offset).
  //
  // CRITICAL: during the drag we update the frame's DOM position imperatively
  // (style.left / style.top) instead of going through React state. Reasons:
  //   - setFrames every tick was triggering a re-render of every PrototypeFrame
  //     (~16ms of React work per frame on top of the actual drag), which
  //     looked like glitchy stuttering — the symptom the user reported.
  //   - The dragged frame's React state is intentionally stale during the
  //     drag. We commit the final position to state once, on mouseup.

  const handleFrameDragStart = (e, frameId) => {
    e.preventDefault()
    e.stopPropagation()
    const frame = frames.find((f) => f.id === frameId)
    if (!frame) return

    // Read current camera state from the DOM (always fresh — library writes
    // synchronously via setTransform).
    const wrapperEl = document.querySelector('.react-transform-wrapper')
    const componentEl = document.querySelector('.react-transform-component')
    const wRect = wrapperEl?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const transformStr = componentEl?.style?.transform ?? ''
    const m = transformStr.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/)
    if (!m) return
    const camX = parseFloat(m[1])
    const camY = parseFloat(m[2])
    const scale = parseFloat(m[3])

    // Convert cursor to world-space coords, then compute the world-space
    // offset from cursor to frame top-left.
    const cursorWX = (e.clientX - wRect.left - camX) / scale
    const cursorWY = (e.clientY - wRect.top - camY) / scale
    setDragState({
      frameId,
      frameStartX: frame.x,
      frameStartY: frame.y,
      dxOffset: frame.x - cursorWX,
      dyOffset: frame.y - cursorWY,
      initialClientX: e.clientX,
      initialClientY: e.clientY,
    })
  }

  // Drag rAF loop. Three responsibilities, all on the same tick to stay in sync:
  //   1. Read cursor + current camera
  //   2. If cursor is near a viewport edge, pan the camera in that direction
  //   3. Place the dragged frame at (worldCursor + offset) — IMPERATIVELY
  useEffect(() => {
    if (!dragState) return

    const EDGE_THRESHOLD = 60       // px from viewport edge where pan kicks in
    const MAX_EDGE_PAN_SPEED = 1200 // viewport px/sec at the edge itself

    // Find the dragged frame's DOM element ONCE. We'll mutate its style
    // directly each tick without going through React.
    const frameEl = document.querySelector(`[data-frame-id="${CSS.escape(dragState.frameId)}"]`)
    if (!frameEl) return

    const cursorRef = { current: { x: dragState.initialClientX, y: dragState.initialClientY } }
    const wrapperEl = document.querySelector('.react-transform-wrapper')
    const componentEl = document.querySelector('.react-transform-component')
    const wRect = wrapperEl?.getBoundingClientRect() ?? { left: 0, top: 0 }
    let rafId = null
    let lastT = performance.now()
    // Tracks the most recent imperative position so we can commit it on drop.
    let finalX = dragState.frameStartX
    let finalY = dragState.frameStartY

    const readCamera = () => {
      const t = componentEl?.style?.transform ?? ''
      const m = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/)
      return m
        ? { x: parseFloat(m[1]), y: parseFloat(m[2]), scale: parseFloat(m[3]) }
        : { x: 0, y: 0, scale: 1 }
    }

    const tick = (t) => {
      // Cap dt so a paused tab doesn't fling the camera on resume.
      const dt = Math.min(0.05, (t - lastT) / 1000)
      lastT = t

      const cx = cursorRef.current.x
      const cy = cursorRef.current.y
      const vw = window.innerWidth
      const vh = window.innerHeight

      // Linear edge-pan velocity: 0 at threshold, MAX at the viewport edge.
      // setTransform's x/y mean "translate the canvas by this much in viewport
      // space" — to pan VIEW right (reveal more of the right side of the
      // world), we move the canvas LEFT, which is a negative x delta.
      let vxView = 0
      let vyView = 0
      if (cx < EDGE_THRESHOLD) {
        vxView = MAX_EDGE_PAN_SPEED * (1 - cx / EDGE_THRESHOLD)
      } else if (cx > vw - EDGE_THRESHOLD) {
        vxView = -MAX_EDGE_PAN_SPEED * (1 - (vw - cx) / EDGE_THRESHOLD)
      }
      if (cy < EDGE_THRESHOLD) {
        vyView = MAX_EDGE_PAN_SPEED * (1 - cy / EDGE_THRESHOLD)
      } else if (cy > vh - EDGE_THRESHOLD) {
        vyView = -MAX_EDGE_PAN_SPEED * (1 - (vh - cy) / EDGE_THRESHOLD)
      }

      const cam = readCamera()
      if (vxView !== 0 || vyView !== 0) {
        const c = controlsRef.current
        if (c) {
          c.setTransform(cam.x + vxView * dt, cam.y + vyView * dt, cam.scale, 0)
        }
      }

      // Place the frame at (worldCursor + offset). Re-read camera AFTER the
      // possible pan above so the frame and camera stay perfectly in sync.
      const camNow = (vxView || vyView) ? readCamera() : cam
      const wx = (cx - wRect.left - camNow.x) / camNow.scale + dragState.dxOffset
      const wy = (cy - wRect.top - camNow.y) / camNow.scale + dragState.dyOffset
      // IMPERATIVE update — bypasses React entirely.
      frameEl.style.left = `${wx}px`
      frameEl.style.top = `${wy}px`
      finalX = wx
      finalY = wy

      rafId = requestAnimationFrame(tick)
    }

    const handleMove = (e) => {
      cursorRef.current = { x: e.clientX, y: e.clientY }
    }
    const handleUp = () => {
      // Commit the final position to React state. This causes ONE re-render of
      // PrototypeFrame which catches up with the imperative DOM state.
      setFrames((prev) =>
        prev.map((f) => (f.id === dragState.frameId ? { ...f, x: finalX, y: finalY } : f))
      )
      setDragState(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    rafId = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [dragState])

  /**
   * Place a new frame to the right of the rightmost existing one and pan the
   * camera to it. Accepts either a URL (hosted prototype) or srcDoc (inline
   * HTML for uploaded local files). Exactly one of `url` or `srcDoc` should
   * be provided; the iframe rendering picks the right mode based on which
   * field is set.
   */
  const placeNewFrame = useCallback(({ title, url, srcDoc }) => {
    setFrames((prev) => {
      const GAP = 128
      const rightmostRight =
        prev.length > 0 ? Math.max(...prev.map((f) => f.x + FRAME_W)) : 5000 - FRAME_W / 2
      const newX = prev.length > 0 ? rightmostRight + GAP : 5000 - FRAME_W / 2
      const newY = prev.length > 0 ? prev[0].y : 5000 - FRAME_TOTAL_H / 2

      const frame = {
        id: `f-${Date.now()}`,
        title: title || `Frame ${prev.length + 1}`,
        url: url ?? '',
        srcDoc: srcDoc ?? undefined,
        x: newX,
        y: newY,
      }
      const next = [...prev, frame]

      // Pan camera to the new frame so the user sees what they just added.
      setTimeout(() => {
        const c = controlsRef.current
        if (!c) return
        const frameCenterX = newX + FRAME_W / 2
        const frameCenterY = newY + FRAME_TOTAL_H / 2
        const scale = 0.5
        const vw = window.innerWidth
        const vh = window.innerHeight
        c.setTransform(
          vw / 2 - frameCenterX * scale,
          vh / 2 - frameCenterY * scale,
          scale,
          400
        )
      }, 50)

      return next
    })
  }, [])

  const handleAddFrame = (e) => {
    e.preventDefault()
    const trimmed = newUrl.trim()
    if (!trimmed) return

    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    const url = hasScheme ? trimmed : `http://${trimmed}`
    placeNewFrame({ title: `Frame ${frames.length + 1}`, url })
    setNewUrl('')
  }

  /**
   * File upload (Tier 1: single self-contained .html file).
   *
   * Reads the file as text and stuffs the entire HTML into an `srcdoc` iframe.
   * Works for HTML with inline CSS/JS or CDN references. Files that depend on
   * sibling assets (local <script src="./app.js">, <link href="./styles.css">,
   * <img src="./hero.png">) won't resolve — there's no base URL. That's a
   * Tier 2 problem (Service Worker virtual filesystem) for later.
   *
   * Title defaults to filename without extension; user can rename later.
   */
  const fileInputRef = useRef(null)
  const handleUploadHtml = useCallback(async (e) => {
    const file = e.target.files?.[0]
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = ''
    if (!file) return

    // Sanity check on type/extension — `accept=".html"` is just a hint to the
    // OS picker, not enforced. Be permissive: anything that parses as text and
    // looks like HTML.
    const isHtmlExt = /\.html?$/i.test(file.name)
    const isHtmlMime = file.type === 'text/html' || file.type === ''
    if (!isHtmlExt && !isHtmlMime) {
      alert('Please choose an .html file.')
      return
    }

    // Hard cap on size: srcDoc has to live in the React tree and serialize
    // through any future persistence layer. 5MB is generous for hand-written
    // HTML; bigger than that is probably an unrelated file.
    const MAX_BYTES = 5 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      alert(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB — limit is 5MB for inline HTML.`)
      return
    }

    let html
    try {
      html = await file.text()
    } catch (err) {
      alert('Could not read file: ' + (err?.message || err))
      return
    }

    const title = file.name.replace(/\.html?$/i, '')
    placeNewFrame({ title, srcDoc: html })
  }, [placeNewFrame])

  // Wall-bump CSS — applied to a wrapper OUTSIDE TransformWrapper so it doesn't fight the library's transform.
  const bumpStyle = bumpAxis
    ? { transform: bumpAxis === 'max' ? 'scale(1.005)' : 'scale(0.995)', transition: 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)' }
    : { transform: 'scale(1)', transition: 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)' }

  // Cursor signals current mode at a glance.
  // Priority: frame-drag > comment-mode > pan (space) > pin-placement (shift)
  //           > interact-passthrough > default.
  const cursor = dragState
    ? 'grabbing'  // dragging a frame — global grabbing cursor for clean feel
    : commentMode
      ? 'crosshair'  // about to drop a comment pin
      : isSpacePressed
        ? (isDragging ? 'grabbing' : 'grab')
        : isShiftPressed && !isGestureActive
          ? 'crosshair'  // Shift is held and no gesture in flight → clicks will reach the iframe
          : isInteractMode && !isZoomModifierPressed
            ? 'default'  // Interact mode → iframe shows its own cursor; pressing Cmd flips back to canvas control
            : figmaCursor

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="relative w-full h-screen bg-neutral-50 overflow-hidden outline-none"
      style={{ cursor }}
    >
      {/* FLOATING TOOLBAR — single horizontal strip (Card defaults are flex-col + py-4; override here) */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-6xl">
        <Card className="flex flex-row flex-nowrap items-center gap-3 px-3 py-2 shadow-xl border-neutral-200/60 bg-white/95 backdrop-blur-md">
          <div className="font-bold text-xs tracking-tighter flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <BlackbirdMark />
            <span>Blackbird</span>
          </div>

          <form onSubmit={handleAddFrame} className="flex flex-1 min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center justify-end">
              <Input
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste prototype URL..."
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="h-8 w-[85%] min-w-0 bg-neutral-100/50 border-neutral-200 focus-visible:ring-black/25 text-sm"
              />
            </div>
            <Button type="submit" size="sm" className="hover:bg-neutral-900 h-8 px-3 text-xs shrink-0">
              <Plus className="size-3.5 shrink-0" aria-hidden strokeWidth={2.5} />
              Add
            </Button>
            {/*
              Upload HTML button — opens a native file picker, accepts a single
              self-contained .html file, and adds it as a frame via `srcdoc`.
              The hidden <input> is the real picker; the button just clicks it.
            */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm,text/html"
              onChange={handleUploadHtml}
              style={{ display: 'none' }}
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload a self-contained .html file as a new frame"
              className="h-8 w-8 rounded-md bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors shrink-0 flex items-center justify-center"
            >
              <Upload className="size-3.5" aria-hidden strokeWidth={2.5} />
              <span className="sr-only">Upload HTML</span>
            </button>
          </form>

          <div className="border-l border-neutral-100 pl-3 flex items-center gap-2 shrink-0 whitespace-nowrap">
            {/*
              Zoom buttons. Useful in Interact mode where pinching over an
              iframe is captured by the iframe — these always work because
              they're toolbar clicks, never wheel events.
            */}
            <button
              type="button"
              onClick={() => zoomBy(1 / 1.2)}
              title="Zoom out"
              className="h-7 w-7 rounded-md text-sm font-bold bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors shrink-0"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1.2)}
              title="Zoom in"
              className="h-7 w-7 rounded-md text-sm font-bold bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors shrink-0"
            >
              +
            </button>
            {/*
              Comments. Two buttons:
              - Comments [N] — opens the side drawer
              - Place — enters placement mode (or press C); click a prototype to drop a pin
            */}
            <button
              type="button"
              onClick={() => setDrawerOpen(!drawerOpen)}
              title="Open comments drawer"
              className={
                'h-7 px-2 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors shrink-0 ' +
                (drawerOpen
                  ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                  : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200')
              }
            >
              Comments
              {comments.length > 0 ? (
                <span className="ml-1 opacity-75">{comments.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={toggleCommentMode}
              title="Place a new comment (C) — click on a prototype to drop a pin"
              className={
                'h-7 px-2 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors shrink-0 ' +
                (commentMode
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200')
              }
            >
              Place
            </button>
            {/*
              Interact toggle. Discoverable equivalent of the 'I' hotkey.
              When active: amber fill, the shield is down, iframes are click-through.
              When inactive: slim outline button, default canvas-navigation behavior.
            */}
            <button
              type="button"
              onClick={() => setIsInteractMode((v) => !v)}
              title="Toggle Interact Mode (I) — let clicks reach prototypes. Hold ⌘/Ctrl while pinching to zoom over a prototype."
              className={
                'h-7 px-2 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors shrink-0 ' +
                (isInteractMode
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200')
              }
            >
              Interact
            </button>
            <div className={`h-2 w-2 rounded-full ${
              commentMode ? 'bg-orange-500 animate-pulse'
              : isSpacePressed ? 'bg-green-500 animate-pulse'
              : isShiftPressed && !isGestureActive ? 'bg-neutral-900 animate-pulse'
              : isInteractMode ? 'bg-amber-500 animate-pulse'
              : 'bg-neutral-300'
            }`} />
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide hidden sm:inline tabular-nums">
              {commentMode
                ? 'Place'
                : isSpacePressed
                  ? 'Pan Mode'
                  : (isShiftPressed && !isGestureActive)
                    ? 'Pin Mode'
                    : isInteractMode
                      ? 'Interact'
                      : 'Pointer'}
            </span>
          </div>
        </Card>
      </div>

      {/* INFINITE CANVAS — wrapped in bump-animation container */}
      <div className="w-full h-full" style={bumpStyle}>
        <TransformWrapper
          initialScale={0.5}
          minScale={0.01}
          maxScale={20}
          centerOnInit
          // Library's wheel handler is fully disabled — we own wheel via useFigmaZoom.
          wheel={{ disabled: true }}
          // Drag-pan is still owned by the library, gated by spacebar.
          panning={{ disabled: !isSpacePressed, velocityDisabled: true }}
          // No double-click zoom (would conflict with intended UX).
          doubleClick={{ disabled: true }}
          onPanningStart={() => setIsDragging(true)}
          onPanningStop={() => setIsDragging(false)}
        >
          <CanvasContent
            frames={frames}
            onRailHit={handleRailHit}
            onGestureStateChange={handleGestureStateChange}
            registerControls={registerControls}
            shieldActive={shieldActive}
            onFrameDragStart={handleFrameDragStart}
            draggingFrameId={dragState?.frameId ?? null}
            onShieldClick={(e) => {
              if (commentMode) placeDraftAt(e.clientX, e.clientY)
            }}
          />
        </TransformWrapper>
      </div>

      {/* Comments drawer (slides in from right). Lives outside the world canvas
          so it doesn't scale with zoom. */}
      <CommentDrawer frames={frames} onSelectFrame={panToFrame} />

      {/* Placement-mode banner: helps the user know what to do next. */}
      {commentMode ? (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(23, 23, 23, 0.92)',
            color: 'white',
            padding: '8px 14px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.3,
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#fb923c',
            }}
          />
          Click on a prototype to drop a comment — Esc to cancel
        </div>
      ) : null}
    </div>
  )
}
