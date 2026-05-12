import { useState, useEffect } from 'react'
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch"

// Import Shadcn Components
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"

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
        <iframe src={src} className="w-full h-full border-none z-10" />
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

export default function App() {
  const [frames, setFrames] = useState([{ id: 'f1', url: 'http://localhost:5174', title: 'Desktop View' }])
  const [newUrl, setNewUrl] = useState('')
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const figmaCursor = `url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7 4.5L7 18.5L11 14.5L17 14.5L7 4.5Z' fill='black' stroke='white' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E"), auto`

  useEffect(() => {
    const preventZoom = (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    const handleDown = (e) => { 
      if (e.code === 'Space' && e.target.tagName !== 'INPUT') { 
        e.preventDefault()
        setIsSpacePressed(true) 
      } 
    }
    const handleUp = (e) => { if (e.code === 'Space') setIsSpacePressed(false) }

    window.addEventListener('wheel', preventZoom, { passive: false })
    window.addEventListener('keydown', handleDown)
    window.addEventListener('keyup', handleUp)
    return () => {
      window.removeEventListener('wheel', preventZoom)
      window.removeEventListener('keydown', handleDown)
      window.removeEventListener('keyup', handleUp)
    }
  }, [])

  const handleAddFrame = (e) => {
    e.preventDefault()
    if (!newUrl) return
    setFrames([...frames, { id: `f-${Date.now()}`, url: newUrl, title: `Frame ${frames.length + 1}` }])
    setNewUrl('')
  }

  return (
    <div 
      className="relative w-full h-screen bg-slate-50 overflow-hidden"
      style={{ cursor: isSpacePressed ? (isDragging ? 'grabbing' : 'grab') : figmaCursor }}
    >
      {/* FLOATING TOOLBAR - Centered and Un-squishable */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-3xl">
        <Card className="p-2 flex items-center justify-between gap-4 shadow-xl border-slate-200/60 bg-white/95 backdrop-blur-md">
          
          {/* Logo Section */}
          <div className="pl-2 font-bold text-sm tracking-tighter flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 bg-slate-900 rounded-md flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-pulse" />
            </div>
            <span className="hidden sm:block">CANVAS<span className="text-sky-500">AI</span></span>
          </div>

          {/* Form Section - Flex-1 forces it to take up available space */}
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

          {/* Status Indicator */}
          <div className="pr-2 border-l pl-4 border-slate-100 flex items-center gap-2 shrink-0">
            <div className={`h-2 w-2 rounded-full ${isSpacePressed ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden md:block w-16">
              {isSpacePressed ? 'Pan Mode' : 'Pointer'}
            </span>
          </div>

        </Card>
      </div>

      {/* INFINITE CANVAS */}
      <TransformWrapper 
        initialScale={0.5} minScale={0.01} maxScale={20}
        wheel={{ step: 0.01, smoothStep: 0.0008, activationKeys: [] }} 
        touchPad={{ sensitivity: 0.02 }}
        panning={{ disabled: !isSpacePressed, velocityDisabled: true }}
        onPanningStart={() => setIsDragging(true)}
        onPanningStop={() => setIsDragging(false)}
      >
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
          <div 
            className="w-[10000px] h-[10000px] flex items-center justify-center relative"
            style={{ 
              backgroundImage: `radial-gradient(#cbd5e1 1px, transparent 1px)`,
              backgroundSize: '30px 30px'
            }}
          >
            <div className="flex gap-32 p-32">
              {frames.map((frame) => (
                <PrototypeFrame key={frame.id} title={frame.title} src={frame.url} />
              ))}
            </div>
            
            {/* THE SHIELD: Prevents iframe trapping when panning */}
            <div className={`absolute inset-0 z-[9998] ${isSpacePressed ? 'pointer-events-auto' : 'pointer-events-none'}`} />
          </div>
        </TransformComponent>
      </TransformWrapper>
      
    </div>
  )
}