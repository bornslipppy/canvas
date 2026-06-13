/**
 * useFigmaZoom.js
 * ---------------------------------------------------------------------------
 * Custom wheel-event pipeline for a `react-zoom-pan-pinch` canvas.
 *
 * Responsibilities:
 *   1. Intercept wheel events on the canvas wrapper and prevent default.
 *   2. Classify each event as zoom or pan (with gesture-state locking).
 *   3. Normalize the delta (clamp + axis dominance + line-unit scaling).
 *   4. Compute a new TARGET camera (cursor-anchored for zoom).
 *   5. Run an rAF loop that exponentially smooths CURRENT toward TARGET
 *      and calls the library's setTransform every frame.
 *
 * The library still handles transform composition, drag-pan (gated by
 * spacebar in App.jsx), and the actual DOM rendering. We only own wheel.
 *
 * Usage:
 *
 *   function CanvasContent() {
 *     const ref = useRef(null);
 *     useFigmaZoom(ref, {
 *       minScale: 0.01,
 *       maxScale: 20,
 *       onRailHit: (rail) => bumpWall(rail),  // optional
 *     });
 *     return (
 *       <TransformComponent>
 *         <div ref={ref}>...</div>
 *       </TransformComponent>
 *     );
 *   }
 *
 * The hook must be rendered INSIDE <TransformWrapper> because it uses
 * useControls() and useTransformContext().
 */

import { useEffect, useRef } from 'react';
import { useControls, useTransformContext } from 'react-zoom-pan-pinch';
import {
  clampDelta,
  applyAxisDominance,
  deltaToScaleFactor,
  anchorOffset,
  smoothStep,
  isAtRest,
  clampScale,
  detectRailHit,
  DEFAULT_DELTA_CLAMP,
  DEFAULT_PAN_DELTA_CLAMP,
  DEFAULT_ZOOM_SENSITIVITY,
  DEFAULT_TAU,
} from '@/lib/zoomMath';

/** Time after the last wheel event before the gesture lock releases. */
const GESTURE_LOCK_MS = 140;

/** How many consecutive rail-clamped events count as a "wall hit". */
const RAIL_HIT_THRESHOLD = 2;

/** Approximate pixels per "line" unit when deltaMode === 1 (mouse wheel). */
const LINE_HEIGHT_PX = 16;

export function useFigmaZoom(containerRef, options = {}) {
  const {
    minScale = 0.01,
    maxScale = 20,
    zoomSensitivity = DEFAULT_ZOOM_SENSITIVITY,
    panSensitivity = 1.0,
    tau = DEFAULT_TAU,
    deltaClamp = DEFAULT_DELTA_CLAMP,
    panDeltaClamp = DEFAULT_PAN_DELTA_CLAMP,
    onRailHit, // optional callback: (rail: 'min' | 'max') => void
    onGestureStateChange, // optional: (active: boolean) => void — fires on transitions only
  } = options;

  // Library handles.
  const { setTransform } = useControls();
  const transformContext = useTransformContext();

  // --- Mutable state lives in refs to avoid triggering React re-renders ---

  /** The camera position/scale we are easing toward. Updated synchronously on wheel events. */
  const targetRef = useRef(null);

  /** The active rAF handle, or null when the loop is idle. */
  const rafRef = useRef(null);

  /** Last frame timestamp from requestAnimationFrame, for Δt calculation. */
  const lastFrameTimeRef = useRef(0);

  /** Gesture state machine. `kind` is null when idle, otherwise locked until `expiresAt`. */
  const gestureRef = useRef({
    kind: null,             // 'zoom' | 'pan' | null
    expiresAt: 0,           // performance.now() value
    pivotX: null,           // container-relative; null until first zoom event of a gesture
    pivotY: null,
    consecutiveRailHits: 0, // for wall-bump detection
    lastRailHitFiredAt: 0,  // debounce
  });

  /** Tracks the last-fired gesture-active state, so onGestureStateChange fires only on transitions. */
  const wasActiveRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ----- Helpers (closed over the refs above) -----

    /**
     * Read the library's current authoritative transform.
     * The library exposes this via transformContext.transformState.
     */
    const readCurrent = () => {
      // Primary: try known v4 context shapes.
      const s = transformContext?.transformState ?? transformContext?.state;
      if (s && s.positionX !== undefined) {
        return { x: s.positionX, y: s.positionY, scale: s.scale };
      }
      // Fallback: parse the CSS transform string directly from the DOM.
      // react-zoom-pan-pinch sets: translate(Xpx, Ypx) scale(S)
      const wrapper = containerRef.current
        ?.closest('.react-transform-component');
      const t = wrapper?.style?.transform ?? '';
      const m = t.match(
        /translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/
      );
      if (m) {
        return {
          x: parseFloat(m[1]),
          y: parseFloat(m[2]),
          scale: parseFloat(m[3]),
        };
      }
      // Last resort: neutral state.
      return { x: 0, y: 0, scale: 1 };
    };

    /** Seed targetRef from the library state if not yet set. */
    const ensureTarget = () => {
      if (!targetRef.current) targetRef.current = readCurrent();
      return targetRef.current;
    };

    /** Start the rAF loop if it isn't running. */
    const ensureRafRunning = () => {
      if (rafRef.current != null) return;
      lastFrameTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    };

    const tick = (t) => {
      // Δt in seconds, with a 1ms floor to prevent divide-by-zero on the very first frame.
      const dt = Math.max(0.001, (t - lastFrameTimeRef.current) / 1000);
      lastFrameTimeRef.current = t;

      const tgt = targetRef.current;
      if (!tgt) {
        rafRef.current = null;
        return;
      }
      const cur = readCurrent();

      // Exponential smoothing on all three axes with the same τ.
      const nx = smoothStep(cur.x, tgt.x, dt, tau);
      const ny = smoothStep(cur.y, tgt.y, dt, tau);
      const ns = smoothStep(cur.scale, tgt.scale, dt, tau);

      // animationTime=0 → the library applies the transform synchronously, no CSS easing.
      // We are the easing.
      setTransform(nx, ny, ns, 0);

      if (isAtRest({ x: nx, y: ny, scale: ns }, tgt)) {
        // Snap exactly to target on the final frame so we don't sit at an
        // asymptote forever (the exponential never quite reaches zero).
        setTransform(tgt.x, tgt.y, tgt.scale, 0);
        rafRef.current = null;
        // Release the locked pivot when the gesture truly ends.
        gestureRef.current.pivotX = null;
        gestureRef.current.pivotY = null;
        gestureRef.current.consecutiveRailHits = 0;
        // Notify consumer that the gesture has fully ended (rAF is now idle).
        if (wasActiveRef.current && typeof onGestureStateChange === 'function') {
          onGestureStateChange(false);
        }
        wasActiveRef.current = false;
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    // ----- The main wheel handler -----

    const onWheel = (e) => {
      // Always preventDefault so the browser doesn't:
      //   - Zoom the page on Ctrl/Cmd + wheel
      //   - Trigger back/forward navigation on horizontal scroll
      //   - Trigger native trackpad pinch-zoom of the viewport
      e.preventDefault();

      const now = performance.now();
      // CRITICAL: pivot must be in the WRAPPER's coordinate space, NOT the
      // transformed inner div's space. The inner 10000x10000 div is INSIDE the
      // transformed .react-transform-component, so its getBoundingClientRect()
      // returns transformed coordinates — using that for pivot makes the
      // cursor-anchor math read world-space coords as if they were
      // viewport-relative, throwing the camera by hundreds of pixels per event.
      // The .react-transform-wrapper is the static, untransformed parent and is
      // the correct reference for setTransform's coordinate space.
      const wrapper = container.closest('.react-transform-wrapper') ?? container;
      const wRect = wrapper.getBoundingClientRect();
      const pivotX = e.clientX - wRect.left;
      const pivotY = e.clientY - wRect.top;

      // === CLASSIFY ===
      // Synthetic ctrlKey from trackpad pinch, or real Ctrl/Meta from mouse wheel = ZOOM.
      // Otherwise = PAN (trackpad two-finger scroll, mouse wheel without modifier).
      const isZoomIntent = e.ctrlKey || e.metaKey;

      // === GESTURE LOCK ===
      // If a gesture is active and hasn't expired, force-classify all events as
      // that gesture's kind. This kills the macOS inertia-leak bug where the
      // synthetic ctrlKey can drop mid-tail.
      let kind;
      if (gestureRef.current.kind && now < gestureRef.current.expiresAt) {
        kind = gestureRef.current.kind;
      } else {
        kind = isZoomIntent ? 'zoom' : 'pan';
        // New gesture: reset pivot lock and rail counter.
        gestureRef.current.pivotX = null;
        gestureRef.current.pivotY = null;
        gestureRef.current.consecutiveRailHits = 0;
        // Re-sync the eased target to the ACTUAL current transform at the start
        // of every fresh gesture. Otherwise a spacebar-drag (which the library
        // pans directly, bypassing this hook's targetRef) leaves targetRef stale,
        // and the next pinch zooms from the pre-drag position. Reading current
        // here picks up any external pan/zoom since the last wheel gesture.
        targetRef.current = readCurrent();
      }
      gestureRef.current.kind = kind;
      gestureRef.current.expiresAt = now + GESTURE_LOCK_MS;

      const target = ensureTarget();

      if (kind === 'zoom') {
        // Lock the pivot for the duration of this gesture so quick pinch motions
        // don't drift if the cursor wiggles during the OS inertia tail.
        if (gestureRef.current.pivotX === null) {
          gestureRef.current.pivotX = pivotX;
          gestureRef.current.pivotY = pivotY;
        }
        const px = gestureRef.current.pivotX;
        const py = gestureRef.current.pivotY;

        // Mouse wheel reports in "line" units when deltaMode === 1.
        // Scale it up so a single wheel click feels like a meaningful zoom step.
        const lineMul = e.deltaMode === 1 ? LINE_HEIGHT_PX : 1;
        const rawDelta = e.deltaY * lineMul;

        const clamped = clampDelta(rawDelta, deltaClamp);
        const factor = deltaToScaleFactor(clamped, zoomSensitivity);

        const unclampedScale = target.scale * factor;
        const newScale = clampScale(unclampedScale, minScale, maxScale);

        // === RAIL HIT DETECTION ===
        // If we just clamped, that means the user pushed past a rail.
        // Count consecutive hits — fire the callback on the threshold, then debounce.
        const rail = detectRailHit(unclampedScale, newScale, minScale, maxScale);
        if (rail) {
          gestureRef.current.consecutiveRailHits += 1;
          const debounceElapsed = now - gestureRef.current.lastRailHitFiredAt > 500;
          if (
            gestureRef.current.consecutiveRailHits >= RAIL_HIT_THRESHOLD &&
            debounceElapsed &&
            typeof onRailHit === 'function'
          ) {
            onRailHit(rail);
            gestureRef.current.lastRailHitFiredAt = now;
          }
        } else {
          gestureRef.current.consecutiveRailHits = 0;
        }

        const { x: newX, y: newY } = anchorOffset(
          target.x, target.y, target.scale, newScale, px, py
        );
        targetRef.current = { x: newX, y: newY, scale: newScale };
      } else {
        // === PAN ===
        // Trackpad two-finger scroll: both deltaX and deltaY meaningful.
        // Apply axis dominance to kill diagonal drift on Magic Mouse / etc.
        const lineMul = e.deltaMode === 1 ? LINE_HEIGHT_PX : 1;
        const rawDx = e.deltaX * lineMul;
        const rawDy = e.deltaY * lineMul;

        const { dx: filteredDx, dy: filteredDy } = applyAxisDominance(rawDx, rawDy);
        const dx = clampDelta(filteredDx, panDeltaClamp);
        const dy = clampDelta(filteredDy, panDeltaClamp);

        targetRef.current = {
          x: target.x - dx * panSensitivity,
          y: target.y - dy * panSensitivity,
          scale: target.scale,
        };
      }

      ensureRafRunning();

      // Notify consumer that a gesture is now active (fires only on transition from idle).
      if (!wasActiveRef.current && typeof onGestureStateChange === 'function') {
        onGestureStateChange(true);
      }
      wasActiveRef.current = true;
    };

    // Non-passive so we can preventDefault. This is scoped to the canvas container
    // only — the rest of the page can keep passive listeners (good for Lighthouse).
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    containerRef,
    setTransform,
    minScale,
    maxScale,
    zoomSensitivity,
    panSensitivity,
    tau,
    deltaClamp,
    panDeltaClamp,
    onRailHit,
    onGestureStateChange,
  ]);
}
