# Build-session brief — Blackbird handoff Phase 0

Pick this up cold. Goal of the session: get the Phase-0 canvas running on ONE real prototype and run the A/B that decides whether the canvas is worth building past v1. Not a full product build — a decision experiment.

Context lives in memory (`blackbird-handoff-product-direction`) and in two docs beside this file: `../canvas-handoff-v1-design.md` (the contract + paradigm reasoning) and `README.md` (the integration diff). Everything referenced below is in `blackbird-handoff-phase0/`.

## The decision this session serves

Does a developer reach for the live-prototype-bound canvas over the same `inspect.html` / `flow.html` opened as plain browser tabs? If yes → build Phase 1. If no → the product is the package, stop building canvas. Don't expand scope before this is answered.

## Order of operations

1. **Drop in the modules.** Copy `src/handoff/` (loadHandoffPackage, useScreenBinding, HandoffPanel, renderMarkdown) into Blackbird's `src/`. No new npm deps.

2. **Apply the four `App.jsx` edits** from `README.md`: (a) make `placeNewFrame` return the frame id, (b) imports, (c) the `handleOpenPackage` state + handler, (d) the "Open handoff package" button + `<HandoffPanel>`. Verify the app still builds and existing canvas/comments behavior is unchanged.

3. **Pick one real prototype** that you can run as a static build and that you're willing to instrument. The pilot "agent hub" is the obvious choice — it's already analyzed.

4. **Generate the manifest.** Run `node skill/build-canvas-manifest.mjs <package-dir>`. Read the printed TODO list. For the A/B you do NOT need to fill every TODO — you need: `screens` (auto), `artifacts` (auto), and the binding signal (step 5). `renders`/`usage`/`brIds` being empty just means the panel won't list per-screen components yet; that's an acceptable v1 boundary for the test.

5. **Wire the binding signal** (this is the only hand-work):
   - If the prototype is routed → ensure it carries `snippet-for-prototypes.js`; fill each `screen.routeMatch`.
   - If it's a state machine (pilot, and most cases) → add `snippet-state-for-prototypes.js` to the prototype snapshot, write the ~15-line `deriveSid(state)` from `state-reporter-examples.md`, and fire it (React effect or `data-canvas-screen` attribute). The manifest's `binding` is already `"state"` and screens already carry `stateMatch`.

6. **Assemble the package folder** in the layout from `README.md` (manifest at root, `prototype/` built bundle with the snippet, `flow.html` / `inspect.html` / spec `.md` beside it).

7. **Load it.** "Open handoff package" → pick the folder. Confirm: prototype renders, artifact frames appear, and navigating the live prototype moves the spec panel.

8. **Run the A/B.** Same package, two surfaces: (A) `inspect.html` + `flow.html` as plain tabs, (B) the canvas. Two or three developers, one real screen each. Record which they reach for and why.

## Acceptance criteria for "Phase 0 works"

- Package loads from one folder pick.
- Live prototype drives the panel (screen changes → spec changes) for the chosen prototype.
- The verdict from the A/B is captured in memory.

## Known gaps / conscious boundaries (don't rebuild these unprompted)

- `renders` / `usage` / per-screen `brIds` / DOM `anchor`s are empty until the skill's S-ID register cross-index is filled — that's the Phase-1 skill task, not this session.
- Markdown artifacts render as styled monospace (swap in `marked` later).
- The panel surfaces spec inline; deep-linking into `inspect.html` is Phase 1 (`snippet-element-patch.js`).
- Local-first only. No cloud, no multiplayer, no design tooling.

## Where BMAD fits

Only if the A/B says build. Then bring BMAD in to structure the real multi-story implementation — Phase 1 (fill the cross-index in the skill; element-level binding via `snippet-element-patch.js`; inspect.html deep-linking) and Phase 2 (selector-map binding for arbitrary prototypes). Using BMAD before the A/B is process ahead of validation.

## If the A/B says "tabs are enough"

That's a real result, not a failure. The product is the package and its viewers; the canvas is a nice-to-have. Redirect effort to the skill's cross-index and viewer quality, and record the decision.
