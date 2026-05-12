import { useState, useEffect, useRef, useCallback } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'

// Import Shadcn Components
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"

// Custom zoom pipeline
import { useFigmaZoom } from '@/hooks/useFigmaZoom'

const PrototypeFrame = ({ id, title, src, x, y, isDragging, onDragStart, width = '1280px', height = '720px' }) => {
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
      className="absolute flex flex-col gap-3"
      style={{ left: x, top: y }}
    >
      <h3
        onMouseDown={(e) => onDragStart(e, id)}
        className={`text-[12px] font-bold text-slate-500 ml-1 tracking-widest uppercase select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="Drag to move this frame"
      >
        {title}
      </h3>
      <div
        className="relative shadow-2xl rounded-xl overflow-hidden border border-slate-200 bg-white"
        style={{ width, height }}
      >
        <iframe src={src} className="w-full h-full border-none z-10" title={title} />
        {pins.map((pin) => (
          <div
            key={pin.id}
            className="absolute w-6 h-6 bg-sky-500 rounded-full shadow-[0_0_0_4px_rgba(14,165,233,0.2)] z-20 flex items-center justify-center border-2 border-white animate-in zoom-in duration-300"
            style={{ left: pin.x, top: pin.y, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}
          >
            <div className="w-1 h-1 bg-white rounded-full" />
          </div>
        ))}
      </div>
    </div>
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
const CanvasContent = ({ frames, onRailHit, onGestureStateChange, registerControls, shieldActive, onFrameDragStart, draggingFrameId }) => {
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
          backgroundImage: `radial-gradient(#e2e8f0 2px, transparent 2px)`,
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
        />
      </div>
    </TransformComponent>
  )
}

export default function App() {
  // Frame world-space coords: top-left of the title+frame wrapper. Canvas is
  // 10000x10000 with origin (0,0) at top-left, so center is (5000, 5000).
  // FRAME_W = 1280, FRAME_H ≈ 750 (frame body + title + gap).
  const [frames, setFrames] = useState([{
    id: 'f1',
    url: 'http://localhost:5174',
    title: 'Desktop View',
    x: 5000 - 1280 / 2,
    y: 5000 - 750 / 2,
  }])
  const [newUrl, setNewUrl] = useState('')
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // Shield composition. Two competing forces:
  //   clickthroughIntent (user wants iframe events): Shift held OR Interact mode on
  //   canvasOverride     (canvas wins regardless):   gesture active OR Cmd/Ctrl held
  // Shield is up unless clickthrough wins. canvasOverride trumps clickthrough.
  // The Cmd/Ctrl override is what makes "pinch zoom over iframe in Interact mode" work:
  // hold Cmd, shield raises, wheel reaches our hook, pinch zooms.
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [isGestureActive, setIsGestureActive] = useState(false)
  const [isInteractMode, setIsInteractMode] = useState(false)
  const [isZoomModifierPressed, setIsZoomModifierPressed] = useState(false)
  const clickthroughIntent = isShiftPressed || isInteractMode
  const canvasOverride = isGestureActive || isZoomModifierPressed
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

  const handleRailHit = useCallback((rail) => {
    setBumpAxis(rail)
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current)
    bumpTimerRef.current = setTimeout(() => setBumpAxis(null), 200)
  }, [])

  const handleGestureStateChange = useCallback((active) => {
    setIsGestureActive(active)
  }, [])

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
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('wheel', preventBrowserZoom)
      window.removeEventListener('keydown', handleDown)
      window.removeEventListener('keyup', handleUp)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('blur', handleBlur)
      if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current)
    }
  }, [])

  // ---------------- Frame dragging ----------------
  // Drag a frame by its title. The math is OFFSET-BASED in world space:
  // at drag start, capture the world-space offset from cursor to frame.
  // On every rAF tick, place the frame at (worldCursor + offset). This means
  // the frame stays exactly under the cursor regardless of camera pan or
  // zoom changes that happen during the drag — including the edge-pan that
  // we run automatically when the cursor reaches the viewport edge.

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
      dxOffset: frame.x - cursorWX,
      dyOffset: frame.y - cursorWY,
      initialClientX: e.clientX,
      initialClientY: e.clientY,
    })
  }

  // Drag rAF loop. Three responsibilities, all on the same tick to stay in sync:
  //   1. Read cursor + current camera
  //   2. If cursor is near a viewport edge, pan the camera in that direction
  //   3. Place the dragged frame at (worldCursor + offset)
  useEffect(() => {
    if (!dragState) return

    const EDGE_THRESHOLD = 60       // px from viewport edge where pan kicks in
    const MAX_EDGE_PAN_SPEED = 1200 // viewport px/sec at the edge itself
    const cursorRef = { current: { x: dragState.initialClientX, y: dragState.initialClientY } }
    const wrapperEl = document.querySelector('.react-transform-wrapper')
    const componentEl = document.querySelector('.react-transform-component')
    const wRect = wrapperEl?.getBoundingClientRect() ?? { left: 0, top: 0 }
    let rafId = null
    let lastT = performance.now()

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

      // Linear edge-pan velocity: 0 at threshold, MAX at viewport edge.
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
      const camNow = vxView || vyView ? readCamera() : cam
      const wx = (cx - wRect.left - camNow.x) / camNow.scale
      const wy = (cy - wRect.top - camNow.y) / camNow.scale
      setFrames((prev) =>
        prev.map((f) =>
          f.id === dragState.frameId
            ? { ...f, x: wx + dragState.dxOffset, y: wy + dragState.dyOffset }
            : f
        )
      )

      rafId = requestAnimationFrame(tick)
    }

    const handleMove = (e) => {
      cursorRef.current = { x: e.clientX, y: e.clientY }
    }
    const handleUp = () => setDragState(null)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    rafId = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [dragState])

  const handleAddFrame = (e) => {
    e.preventDefault()
    const trimmed = newUrl.trim()
    if (!trimmed) return

    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    const url = hasScheme ? trimmed : `http://${trimmed}`

    setFrames((prev) => {
      // Place the new frame to the right of the rightmost existing one.
      const FRAME_W = 1280
      const FRAME_H = 750
      const GAP = 128
      const rightmostRight =
        prev.length > 0 ? Math.max(...prev.map((f) => f.x + FRAME_W)) : 5000 - FRAME_W / 2
      const newX = prev.length > 0 ? rightmostRight + GAP : 5000 - FRAME_W / 2
      const newY = prev.length > 0 ? prev[0].y : 5000 - FRAME_H / 2

      const next = [
        ...prev,
        { id: `f-${Date.now()}`, url, title: `Frame ${prev.length + 1}`, x: newX, y: newY },
      ]

      setTimeout(() => {
        const c = controlsRef.current
        if (!c) return
        const frameCenterX = newX + FRAME_W / 2
        const frameCenterY = newY + FRAME_H / 2
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
    setNewUrl('')
  }

  // Wall-bump CSS — applied to a wrapper OUTSIDE TransformWrapper so it doesn't fight the library's transform.
  const bumpStyle = bumpAxis
    ? { transform: bumpAxis === 'max' ? 'scale(1.005)' : 'scale(0.995)', transition: 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)' }
    : { transform: 'scale(1)', transition: 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)' }

  // Cursor signals current mode at a glance.
  // Priority: frame-drag > pan (space) > pin-placement (shift) > interact-passthrough > default.
  const cursor = dragState
    ? 'grabbing'  // dragging a frame — global grabbing cursor for clean feel
    : isSpacePressed
      ? (isDragging ? 'grabbing' : 'grab')
      : isShiftPressed && !isGestureActive
        ? 'crosshair'  // Shift is held and no gesture in flight → clicks will reach the iframe
        : isInteractMode && !isZoomModifierPressed
          ? 'default'  // Interact mode → iframe shows its own cursor; pressing Cmd flips back to canvas control
          : figmaCursor

  return (
    <div
      className="relative w-full h-screen bg-slate-50 overflow-hidden"
      style={{ cursor }}
    >
      {/* FLOATING TOOLBAR — single horizontal strip (Card defaults are flex-col + py-4; override here) */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-6xl">
        <Card className="flex flex-row flex-nowrap items-center gap-3 px-3 py-2 shadow-xl border-slate-200/60 bg-white/95 backdrop-blur-md">
          <div className="font-bold text-xs tracking-tighter flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <div className="w-5 h-5 bg-slate-900 rounded-md flex items-center justify-center shrink-0">
              <div className="w-1 h-1 bg-sky-400 rounded-full animate-pulse" />
            </div>
            <span>
              CANVAS<span className="text-sky-500">AI</span>
            </span>
          </div>

          <form onSubmit={handleAddFrame} className="flex flex-1 min-w-0 items-center gap-2">
            <Input
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste prototype URL..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="h-8 min-w-0 bg-slate-100/50 border-slate-200 focus-visible:ring-sky-500/30 text-sm flex-1"
            />
            <Button type="submit" size="sm" className="bg-slate-900 hover:bg-slate-800 h-8 px-3 text-xs shrink-0">
              Deploy View
            </Button>
          </form>

          <div className="border-l border-slate-100 pl-3 flex items-center gap-2 shrink-0 whitespace-nowrap">
            {/*
              Interact toggle. Discoverable equivalent of the 'I' hotkey.
              When active: amber fill, the shield is down, iframes are click-through.
              When inactive: slim outline button, default canvas-navigation behavior.
            */}
            <button
              type="button"
              onClick={() => setIsInteractMode((v) => !v)}
              title="Toggle Interact Mode (I) — let clicks reach prototypes"
              className={
                'h-7 px-2 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors shrink-0 ' +
                (isInteractMode
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
              }
            >
              Interact
            </button>
            <div className={`h-2 w-2 rounded-full ${
              isSpacePressed ? 'bg-green-500 animate-pulse'
              : isShiftPressed && !isGestureActive ? 'bg-sky-500 animate-pulse'
              : isInteractMode ? 'bg-amber-500 animate-pulse'
              : 'bg-slate-300'
            }`} />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide hidden sm:inline tabular-nums">
              {isSpacePressed
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
          />
        </TransformWrapper>
      </div>
    </div>
  )
}
