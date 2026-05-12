/**
 * zoomMath.js
 * ---------------------------------------------------------------------------
 * Pure math helpers for the Figma-style trackpad zoom pipeline.
 *
 * All functions in this file are pure: no DOM access, no React, no globals.
 * That is intentional. The hard-to-debug parts of canvas navigation are the
 * math (focal point projection, smoothing, classification), so we isolate
 * them here and unit-test them independently.
 *
 * If you change a constant or formula here, run the test suite before
 * touching the hook that consumes it.
 */

// ---------------------------------------------------------------------------
// Tunable constants (also exported so the hook can override per-call if needed)
// ---------------------------------------------------------------------------

/** Maximum allowed magnitude for a wheel deltaY contributing to zoom. */
export const DEFAULT_DELTA_CLAMP = 7;

/** Maximum allowed magnitude for a wheel delta contributing to pan. */
export const DEFAULT_PAN_DELTA_CLAMP = 50;

/** Multiplier inside the exp() that converts a clamped delta to a scale factor. */
export const DEFAULT_ZOOM_SENSITIVITY = 0.0035;

/** Time constant (seconds) for the exponential smoothing of the camera. */
export const DEFAULT_TAU = 0.07;

/** Axis dominance ratio. If |a| > RATIO * |b|, the smaller axis is zeroed. */
export const AXIS_DOMINANCE_RATIO = 2.5;

/** Sub-pixel noise floor — deltas below this magnitude are zeroed. */
export const AXIS_NOISE_DEADZONE = 0.5;


// ---------------------------------------------------------------------------
// Delta normalization
// ---------------------------------------------------------------------------

/**
 * Clamp a raw wheel deltaY to a hardware-independent range.
 *
 * macOS trackpad pinch can produce delta spikes of 50+ during the inertia
 * tail; a discrete mouse wheel click reports ~100/120. Both are wildly
 * larger than the typical 0.5–5.0 we want to act on. Clamping kills the
 * runaway-zoom failure mode while preserving normal-gesture sensitivity.
 *
 * @param {number} delta - Raw deltaY from a WheelEvent.
 * @param {number} max - Maximum allowed magnitude.
 * @returns {number} Clamped delta in [-max, max].
 */
export const clampDelta = (delta, max = DEFAULT_DELTA_CLAMP) =>
  Math.max(-max, Math.min(max, delta));

/**
 * Magic Mouse + some Windows trackpads emit "diagonal" pan events even when
 * the user feels they're swiping straight. We apply:
 *   1. A small absolute deadzone (kill sub-pixel noise)
 *   2. An axis-dominance check (if one axis dominates by RATIO×, zero the other)
 *
 * This is what AppKit's NSScrollView does internally for scroll direction lock.
 *
 * @param {number} dx - Raw deltaX.
 * @param {number} dy - Raw deltaY.
 * @returns {{dx: number, dy: number}} Filtered deltas.
 */
export const applyAxisDominance = (dx, dy) => {
  let outDx = Math.abs(dx) < AXIS_NOISE_DEADZONE ? 0 : dx;
  let outDy = Math.abs(dy) < AXIS_NOISE_DEADZONE ? 0 : dy;

  const adx = Math.abs(outDx);
  const ady = Math.abs(outDy);

  if (adx > AXIS_DOMINANCE_RATIO * ady) outDy = 0;
  else if (ady > AXIS_DOMINANCE_RATIO * adx) outDx = 0;

  return { dx: outDx, dy: outDy };
};


// ---------------------------------------------------------------------------
// Zoom math
// ---------------------------------------------------------------------------

/**
 * Convert a clamped wheel delta into a multiplicative scale factor.
 *
 * The negation aligns natural-scroll: a negative deltaY (scroll up / pinch
 * out) should zoom IN, which means scale should INCREASE, which means the
 * factor should be > 1.
 *
 * Exponential mapping guarantees reciprocal symmetry: a delta of +N and -N
 * produce factors that multiply to 1. So a zoom-in followed by an equal-
 * magnitude zoom-out returns you exactly to where you started — important
 * for not accumulating floating-point drift over a session.
 *
 * @param {number} clampedDelta - Result of clampDelta().
 * @param {number} sensitivity - Inside-exponent multiplier.
 * @returns {number} Scale factor to multiply current scale by.
 */
export const deltaToScaleFactor = (clampedDelta, sensitivity = DEFAULT_ZOOM_SENSITIVITY) =>
  Math.exp(-clampedDelta * sensitivity);

/**
 * Clamp a scale value to library min/max so smoothing never overshoots.
 *
 * @param {number} s - Scale value.
 * @param {number} min - Minimum scale.
 * @param {number} max - Maximum scale.
 * @returns {number} Clamped scale.
 */
export const clampScale = (s, min, max) => Math.max(min, Math.min(max, s));

/**
 * Cursor-anchored focal-point projection.
 *
 * Given a current camera (offset x/y, scale) and a pivot point in *container*
 * coordinates (i.e., where the cursor is, relative to the canvas wrapper),
 * compute the new offset that keeps the world point under the pivot
 * stationary while scale changes from oldScale to newScale.
 *
 * The world point under the pivot before scaling is:
 *   world = (pivot - oldOffset) / oldScale
 *
 * After scaling, we need newOffset such that:
 *   pivot = world * newScale + newOffset
 *
 * Solving for newOffset:
 *   newOffset = pivot - world * newScale
 *             = pivot - (pivot - oldOffset) * (newScale / oldScale)
 *
 * @param {number} oldX - Current camera X offset.
 * @param {number} oldY - Current camera Y offset.
 * @param {number} oldScale - Current camera scale.
 * @param {number} newScale - Target scale after this event.
 * @param {number} pivotX - Cursor X in container-relative coordinates.
 * @param {number} pivotY - Cursor Y in container-relative coordinates.
 * @returns {{x: number, y: number}} New camera offset.
 */
export const anchorOffset = (oldX, oldY, oldScale, newScale, pivotX, pivotY) => {
  const ratio = newScale / oldScale;
  return {
    x: pivotX - (pivotX - oldX) * ratio,
    y: pivotY - (pivotY - oldY) * ratio,
  };
};


// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/**
 * Frame-rate-independent exponential smoothing step.
 *
 *   current' = current + (target - current) * (1 - exp(-Δt / τ))
 *
 * The (1 - exp(-Δt / τ)) factor is the key: as Δt grows, the fraction
 * approaches 1 (snap to target); as Δt shrinks, it approaches 0 (no movement
 * this frame). This means the same τ produces the same time-to-target
 * regardless of frame rate, which is why Figma feels identical on a 60Hz
 * laptop and a 120Hz ProMotion display.
 *
 * Lower τ = snappier. Higher τ = more glide.
 * Figma trackpad zoom feels like τ ≈ 0.06–0.08s.
 *
 * @param {number} current - Current value.
 * @param {number} target - Target value.
 * @param {number} dtSeconds - Time since last frame in seconds.
 * @param {number} tau - Time constant in seconds.
 * @returns {number} New current value, one step closer to target.
 */
export const smoothStep = (current, target, dtSeconds, tau = DEFAULT_TAU) => {
  const alpha = 1 - Math.exp(-dtSeconds / tau);
  return current + (target - current) * alpha;
};

/**
 * Check whether camera and target are close enough to terminate the rAF loop.
 *
 * Uses a relative tolerance for scale (so it works at scale=0.01 and scale=20)
 * and an absolute tolerance for translation (so it works regardless of canvas
 * size).
 *
 * @param {{x: number, y: number, scale: number}} camera - Current camera state.
 * @param {{x: number, y: number, scale: number}} target - Target camera state.
 * @param {number} scaleEps - Relative scale tolerance.
 * @param {number} posEps - Absolute position tolerance in pixels.
 * @returns {boolean} True if camera is at rest at target.
 */
export const isAtRest = (camera, target, scaleEps = 0.0005, posEps = 0.1) =>
  Math.abs(camera.scale - target.scale) / target.scale < scaleEps &&
  Math.abs(camera.x - target.x) < posEps &&
  Math.abs(camera.y - target.y) < posEps;


// ---------------------------------------------------------------------------
// Rail-hit detection (for the wall-bump UX cue)
// ---------------------------------------------------------------------------

/**
 * Classify whether a target scale has hit the min or max rail.
 *
 * @param {number} targetScale - Scale the user is trying to reach.
 * @param {number} appliedScale - Scale we actually applied (post-clamp).
 * @param {number} minScale
 * @param {number} maxScale
 * @returns {'min' | 'max' | null} Which rail was hit, if any.
 */
export const detectRailHit = (targetScale, appliedScale, minScale, maxScale) => {
  // Only count it as a rail hit if the clamp actually changed the value.
  if (targetScale === appliedScale) return null;
  if (appliedScale <= minScale && targetScale < minScale) return 'min';
  if (appliedScale >= maxScale && targetScale > maxScale) return 'max';
  return null;
};
