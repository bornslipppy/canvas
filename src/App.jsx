import { useState, useEffect, useRef, useCallback } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'

// Import Shadcn Components
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"

// Custom zoom pipeline
import { useFigmaZoom } from '@/hooks/useFigmaZoom'

const PrototypeFrame = ({ title, src, width = '1280px', height = '720px' }) => {
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
    <div className="flex flex-col gap-3">
      <h3 className="text-[12px] font-bold text-slate-500 ml-1 tracking-widest uppercase">
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
const CanvasContent = ({ frames, onRailHit, onGestureStateChange, registerControls, shieldActive }) => {
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
        className="w-[10000px] h-[10000px] flex items-center justify-center relative"
        style={{
          backgroundImage: `radial-gradient(#cbd5e1 1px, transparent 1px)`,
          backgroundSize: '30px 30px',
          touchAction: 'none', // We own all gestures inside the canvas
        }}
      >
        <div className="flex gap-32 p-32">
          {frames.map((frame) => (
            <PrototypeFrame key={frame.id} title={frame.title} src={frame.url} />
          ))}
        </div>

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
  const [frames, setFrames] = useState([{ id: 'f1', url: 'http://localhost:5174', title: 'Desktop View' }])
  const [newUrl, setNewUrl] = useState('')
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // Shield composition: drop the shield only when Shift is held AND no zoom gesture is in flight.
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [isGestureActive, setIsGestureActive] = useState(false)
  const shieldActive = !isShiftPressed || isGestureActive

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
      // even if the URL input was previously focused. (When typing in the input,
      // the click happens outside the input anyway, so this is harmless.)
      if (e.key === 'Shift') setIsShiftPressed(true)

      const tag = e.target.tagName
      const isInInput = tag === 'INPUT' || tag === 'TEXTAREA'
      if (isInInput) return

      if (e.code === 'Space') {
        e.preventDefault()
        setIsSpacePressed(true)
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
    }

    // Defensive: if the window loses focus mid-gesture (alt-tab, etc.), clear modifier state
    // so the shield doesn't get stuck down.
    const handleBlur = () => {
      setIsShiftPressed(false)
      setIsSpacePressed(false)
    }

    window.addEventListener('wheel', preventBrowserZoom, { passive: false })
    window.addEventListener('keydown', handleDown)
    window.addEventListener('keyup', handleUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('wheel', preventBrowserZoom)
      window.removeEventListener('keydown', handleDown)
      window.removeEventListener('keyup', handleUp)
      window.removeEventListener('blur', handleBlur)
      if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current)
    }
  }, [])

  const handleAddFrame = (e) => {
    e.preventDefault()
    if (!newUrl) return
    setFrames([...frames, { id: `f-${Date.now()}`, url: newUrl, title: `Frame ${frames.length + 1}` }])
    setNewUrl('')
  }

  // Wall-bump CSS — applied to a wrapper OUTSIDE TransformWrapper so it doesn't fight the library's transform.
  const bumpStyle = bumpAxis
    ? { transform: bumpAxis === 'max' ? 'scale(1.005)' : 'scale(0.995)', transition: 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)' }
    : { transform: 'scale(1)', transition: 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)' }

  // Cursor signals current mode at a glance.
  // Priority: pan (space) > pin-placement intent (shift) > default canvas cursor.
  const cursor = isSpacePressed
    ? (isDragging ? 'grabbing' : 'grab')
    : isShiftPressed && !isGestureActive
      ? 'crosshair'  // Shift is held and no gesture in flight → clicks will reach the iframe
      : figmaCursor

  return (
    <div
      className="relative w-full h-screen bg-slate-50 overflow-hidden"
      style={{ cursor }}
    >
      {/* FLOATING TOOLBAR */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-3xl">
        <Card className="p-2 flex items-center justify-between gap-4 shadow-xl border-slate-200/60 bg-white/95 backdrop-blur-md">
          <div className="pl-2 font-bold text-sm tracking-tighter flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 bg-slate-900 rounded-md flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-pulse" />
            </div>
            <span className="hidden sm:block">CANVAS<span className="text-sky-500">AI</span></span>
          </div>

          <form onSubmit={handleAddFrame} className="flex flex-1 min-w-[200px] gap-2">
            <Input
              type="url"
              placeholder="Paste prototype URL here..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="h-9 bg-slate-100/50 border-slate-200 focus-visible:ring-sky-500/30 text-sm flex-1"
            />
            <Button type="submit" size="sm" className="bg-slate-900 hover:bg-slate-800 h-9 px-4 shrink-0">
              Deploy View
            </Button>
          </form>

          <div className="pr-2 border-l pl-4 border-slate-100 flex items-center gap-2 shrink-0">
            <div className={`h-2 w-2 rounded-full ${
              isSpacePressed ? 'bg-green-500 animate-pulse'
              : isShiftPressed && !isGestureActive ? 'bg-sky-500 animate-pulse'
              : 'bg-slate-300'
            }`} />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden md:block w-16">
              {isSpacePressed ? 'Pan Mode' : (isShiftPressed && !isGestureActive) ? 'Pin Mode' : 'Pointer'}
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
          />
        </TransformWrapper>
      </div>
    </div>
  )
}
