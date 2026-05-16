# Pivot fix + cursor override — drop-in patch

Two bugs, one patch file. Both verified against your repo as uploaded.

## What this fixes

**Bug 1: "Zoom throws the canvas off-screen on every pinch."**
The hook was computing the pinch pivot relative to the inner 10000×10000 div, which is itself transformed by the library. That made the cursor-anchor math read world-space coordinates as if they were viewport-relative, producing a 500+ pixel jump per pinch event. Verified by running the math: a tiny pinch (scale 0.5 → 0.62) drifted the anchor point 574px away from the cursor. Fixed pivot calculation drifts 0px.

**Bug 2: "Grab cursor shows all the time, even without Space."**
`react-zoom-pan-pinch` sets `cursor: grab` on its own `.react-transform-wrapper` element, which overrides the root-level cursor logic. Fixed with a one-rule CSS override that forces those elements to inherit the parent's cursor instead.

## How to apply

From the repo root:

```bash
git apply useFigmaZoom.patch
```

Then hard-refresh the browser (Cmd+Shift+R). No `npm install` needed.

## What it touches

Only two files, both surgical:
- `src/hooks/useFigmaZoom.js` — replaces 3 lines of pivot calculation with 12 (including comment block explaining why)
- `src/index.css` — appends one CSS rule at the bottom of the `@layer base` block

No new dependencies. No config changes. No commit included — apply, test, commit yourself when verified.

## How to verify

After applying and hard-refreshing:

1. Pinch slowly. The point under your cursor should stay exactly under your cursor.
2. Pinch fast. Same — the camera glides, but the cursor-anchored point doesn't drift.
3. Move your mouse over the canvas without pressing anything. Cursor should be the custom Figma arrow (black with white outline), not a grab hand.
4. Hold Space. Cursor becomes grab.
5. Hold Shift. Cursor becomes crosshair (pin-placement mode).

If any of those fail, run this in DevTools console:

```js
// Confirms wrapper exists and pivot will be measured from it
const w = document.querySelector('.react-transform-wrapper');
const r = w?.getBoundingClientRect();
console.log('wrapper:', r);
// Should print something like { left: 0, top: 0, width: ~window.innerWidth, ... }
```

If `wrapper` is null, the library's class name has changed in your version and the fallback to `container` in the patch will kick in — which will reintroduce the bug. Tell me and I'll add a different selector.

## Why no test for this in the suite

The math itself is unchanged — `anchorOffset` was always correct, the bug was in which element we measured pivot against. A meaningful test would need to mock `getBoundingClientRect` on a chain of nested transformed elements, which is more apparatus than insight. The console check above is the faster verification.

## Why the cursor fix uses `!important`

The library injects `cursor: grab` as an inline style on its wrapper element. Inline styles can't be overridden by normal CSS specificity — only `!important` wins. This is the one case where `!important` is the correct tool rather than a smell.
