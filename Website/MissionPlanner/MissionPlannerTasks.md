# Mission Planner UI build-out — task list and code inventory

This document organizes the work of growing the step-4.3 scaffold
(`planner.html/css/js`) into the full interface described in
`MissionPlannerDesign.md`. It is the curation doc for that process: tasks are
grouped into work packages (WP-A … WP-H) in a sensible build order, each task
carries a difficulty rating so work can be assigned to the right model, and
the second half is an inventory of existing code suitable for adaptation
(marker card, waypoint cards, burn editor, and so on), with file paths and
line ranges.

Line numbers are as of 2026-07-10 and will drift as files change — treat them
as "look here", not exact anchors.

## Difficulty legend (for assigning models)

| Rating | Meaning                                                                                     | Suggested tier                                                            |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| ★      | Mechanical DOM/CSS work; a pattern already exists to copy; low risk                         | Small / cheap model (Haiku-class), with the referenced files in context   |
| ★★     | Real wiring across 2–3 files, but the shape is established by existing code                 | Mid model (Sonnet-class)                                                  |
| ★★★    | Architecture-shaping, cross-cutting, or a fiddly orchestration port; mistakes are expensive | Strongest model (Opus/Fable-class), and worth Kim's review before merging |

Regardless of model: every task follows CLAUDE.md conventions (ES modules,
pure logic stays Node-testable, one responsibility per file), keeps the
existing Node suites green (`node --test Website/MissionPlanner/core/tests/*.test.js`,
`modules/tests/modules.test.js`, and `ui/tests/*.test.js`), and
browser-verifies via `serve.bat` at
`http://localhost:8000/MissionPlanner/planner.html`.

## Where things stand (the gap, in one paragraph)

The scaffold has: one World, one mission, one shared date bar, phase buttons
that are only view-swaps (Departure ↔ Earth–Moon main, Coast ↔ helio, Arrival
disabled), a stage strip, a flat events bar, module-built sidebar cards with
uniform diagnostics/warnings, share links, and the Moon→Ceres preset. The
design doc additionally requires: an **Ephemeris tab** (the Solar-System
Trajectory Plotter experience — marker, targeting, waypoints, approach rings —
inside the planner), a gated **"Start Mission Plan"** button that freezes the
flight plan into a **new mission tab**, multiple coexisting **mission tabs**,
real **phases** (per-phase sliders — date-scaled Coast, event-scaled
Departure/Arrival — per-phase pane arrangements and sidebar contents),
**comply mode** surfaced in the UI (plan-requires vs tech-delivers grids with
assists), **tech cards** loadable by dropdown or from a calculator via the
exchange, **up to 2 waypoint burns** inside the departure/arrival systems, and
**in-scene waypoint dragging**. The comply-mode plumbing (warnings/events
envelope) already exists in the core; almost everything else in this list is
UI and orchestration. `mockups/mock-a-phases.html` is the agreed visual
reference for all of it.

---

## Work packages and tasks

Build order: **A → B → C → D → E**, then F/G/H iteratively. A is the
foundation everything hangs on. B and C only touch a mission tab's innards and
can run in parallel with D (different files — keep one thread per file, per
CLAUDE.md's concurrency note). E stitches A+C+D together. F, G, H are
independent improvements after E.

### WP-A — Multi-mission shell (tabs over multiple Worlds)

The scaffold builds one `world + engine + frames + cards` at module scope
(`planner.js`, whole file). The design needs N missions coexisting, each a
World, plus a distinct Ephemeris tab.

- [x] **A1. Refactor `planner.js` into a per-mission factory.** ★★★
  **Done 2026-07-11.** `mission-view.js` exports `createMissionView({ world,
  registry, renderer, container, template, missionId, defaultMain })`
  returning `{ world, engine, root, show, hide, render, resize, dispose }`;
  `planner.js` is now the host (registry, the one renderer, initial World
  load, `setActiveView` + render loop). Decisions recorded (details in
  README.md): **frames are per-mission** (own scenes/cameras; only the
  renderer/canvas is shared — `show()` re-parents it); per-mission DOM is
  cloned from `planner.html`'s `<template id="mp-mission-template">` and
  addressed by class, not id; workspace persistence is **version 2**, one
  slot per mission id (v1 saves adopt as `"m1"`), `deleteWorkspaceSlot` is
  exported for A2's tab-close; `bindCameraControls` now returns an unbind for
  `dispose()`. Also fixed for coexistence: the two modules' draw caches are
  keyed by `(world, stageId)` via `WeakMap` — coexisting Worlds reuse stage
  ids, so a stageId-only cache cross-contaminated missions. Verified: 77 Node
  tests green; in-browser two-view test (independent recompute/diagnostics,
  dispose cleanup) with a clean console; SST plotter unaffected by the
  camera-controller change.
- [x] **A2. Tab bar.** ★★ (★ for the DOM, ★★ for the switching)
  **Done 2026-07-11.** Ephemeris tab + one tab per mission + active
  highlight + close "x", per mockup A (mp-tabbar/.mp-tab styling lifted from
  mock-a-phases.html:134–140; the switching logic in planner.js's
  `selectTab`/`addMissionTab`/`closeMissionTab` follows its `setTab` pattern
  at 538–543, generalized from two hardcoded views to an N-mission array).
  The Ephemeris tab is a **stub** (`#mp-eph-view` in planner.html) — its
  real content (marker/targeting/waypoints) is WP-D; for now it's a plain
  message and the "+" affordance is inert (per the mockup's own tooltip,
  "New missions are started from the Ephemeris tab" — that flow is E2).
  Closing a mission tab confirms via `window.confirm` ("hasn't been saved
  anywhere and can't be recovered" — true until A3), then `dispose()`s the
  view and `deleteWorkspaceSlot()`s it (the export A1 added for this).
  `planner.js` no longer holds a single `activeView`; `missions[]` tracks
  `{ id, title, view, tabEl }` and the render loop/resize only drive the
  active mission's view (the Ephemeris stub needs neither). Mission titles
  aren't part of `World.serialize()` (A3/E2 will need to decide where a
  name lives); the one mission today is titled "Moon → Ceres 2031" in
  `planner.js`, matching the preset's own description. Verified in-browser:
  tab switching, active highlight, close-with-confirm (and cancel), console
  clean; Node suites untouched by this UI-only change.
- [x] **A3. Mission persistence across reloads.** ★★
  **Done 2026-07-11** (Kim confirmed: do it now rather than deferring).
  Each mission (shell-level title + `world.serialize()`) lives in one
  versioned localStorage key (`mw-missionplanner-missions` — a distinct key
  from `mission-view.js`'s `mw-missionplanner-workspace`, which stays
  layout/camera-only). `planner.js`'s `initialMissions()` restores it on
  load, merging in a share-link fragment if the URL carries one (added
  alongside saved missions as an **"Imported mission"** tab, never
  replacing them — matches the README's "a share link opens in a new tab")
  and falling back to the shipped preset only when there's nothing saved
  and no fragment. A bad fragment or an unreadable saved entry drops that
  one entry (never the whole load) and shows the existing failure banner.
  `saveMissionsStore()` writes on `pagehide` (mirrors the workspace-slot
  pattern in mission-view.js) and immediately after any structural change
  (`addMissionTab`/`closeMissionTab`), so a reload never loses more than
  in-flight edits since the last save, and a closed mission can't reappear.
  Verified in-browser: an edited param survives reload; a share-link import
  persists alongside the existing mission and both restore with the right
  one active; closing a mission removes it from storage immediately and it
  stays gone after reload; Node suites (77 tests, untouched by this
  UI/persistence-only change) still green. A2's close-confirmation copy
  ("hasn't been saved anywhere") was updated to reflect that missions now
  persist — closing is still permanent (no undo), just no longer "unsaved."
  Depends on A1.

### WP-B — Mission-tab chrome: phases, sliders, core data

All within one mission view; the mockup is the spec throughout.

- [x] **B1. Real phase state.** ★★
  **Done 2026-07-11.** `mission-view.js` gets a `workspace.phase ∈
  {departure, coast, arrival}` (workspace state, not World; persisted in the
  same slot as `main`/`cams`, task A3's mechanism — additive field, no
  version bump needed). Two new module-scope maps, `PHASE_FRAME` (phase →
  its frame id) and its reverse `FRAME_PHASE`, replace the old frame-keyed
  `phaseBtns`/`swapMain`: phase buttons now call `setPhase(phase)`, which
  drives the main-pane frame (via `PHASE_FRAME` — floats follow for free,
  since they're just "every non-main frame", already true pre-B1), which
  sidebar cards show (`applyPhaseToCards`, filtering by each stage's
  `stagePhaseOf()` — derived from the stage's module descriptor `rendersIn`
  matched against `FRAME_PHASE`, so `lunar-skyhook` → departure and
  `transfer-leg` → coast fall out automatically, no hardcoded stage list),
  and the phase buttons' active highlight. Clicking a floating pane (layout
  promotion) now ALSO switches phase when the frame maps to one, per the
  mockup's own framing that a float click is an alternate way to change
  phase, not just layout — `swapMain` delegates to `setPhase` in that case,
  falling back to a phase-less `promoteFrame` otherwise. Status dots
  (`<span class="mp-dot">`, added to each phase button in planner.html)
  aggregate their phase's stage results with `renderPhaseDots`, worst wins
  (err > blocked > warn > ok — `PHASE_DOT_RANK`); a phase with no mapped
  stage (arrival, until H2) keeps the neutral default dot. Factored
  `dotClassFor(res)` out of `renderStageStrip` so the stage strip and the
  phase dots share one status→class mapping. **"Which slider shows" is
  explicitly NOT built here** — there's still one shared date bar; that's
  B2 (Coast, date-scaled) and B3 (Departure/Arrival, event-scaled). Arrival
  stays unreachable (its phase button is still `disabled`, no frame exists
  for it in `PHASE_FRAME` yet — H1/H2), but the phase machinery already
  treats it correctly (present in `PHASES`, dot logic, workspace
  save/load) so enabling it later shouldn't need rework here. Verified
  in-browser: Departure ↔ Coast via both phase buttons and float-pane
  clicks (main pane, floats, sidebar cards, active highlight all follow);
  dots aggregate correctly (introducing a miss-distance warning turned only
  the Coast dot `warn`, Departure's stayed `ok`); phase persists across
  reload (task A3's mechanism, now carrying `phase` too); Node suites (77
  tests, untouched — this is UI-only) still green.
- [x] **B2. Coast slider (date-scaled).** ★★
  **Done 2026-07-11.** New file `MissionPlanner/ui/phase-slider.js`, split
  in two layers for B3 to build on: `createSegmentedSlider(container, opts)`
  is the DOM primitive (captioned track of flex-sized segments + a
  click/drag-scrubbable playhead, mirroring mock-a-phases.html's
  `.timeline`/`.track`/`.seg`/`.playhead`, `mp-` prefixed to match the
  shell's convention) — it knows nothing about dates, just 0..1 fractions,
  so B3's nonlinear event-scaled sliders can reuse it directly.
  `coastSliderState(opts)` is B2's actual math, kept pure and DOM-free
  (segments + playhead fraction + pinned flag from a span/jd/tick-count/
  formatter) with its own Node suite (`ui/tests/phase-slider.test.js`, 7
  tests — empty/inverted spans, mid-span fraction, pin-at-either-end,
  inclusive edges, default and custom tick counts); `createCoastSlider`
  is the thin DOM wrapper.
  **The "frozen departure→arrival dates" the task text names don't exist
  yet** (C1, the frozen-plan module, is unbuilt) — so the span is instead
  the live min/max jd among events emitted THIS recompute pass by
  departure- and coast-phase stages (`coastSpan()` in mission-view.js,
  using B1's `stagePhaseOf`), same as everything else pre-comply-mode: it
  tracks current params, not a frozen commitment. Once C1 lands this is a
  one-line swap to read the frozen plan's dates instead — the widget itself
  doesn't care where the span comes from. Clicking/dragging the track calls
  `setClock` (already existed, ex-`planner.js` now in `mission-view.js`),
  so the slider is just another way to move the one shared clock — the
  events bar, date field, and JD readout all stay in sync automatically.
  Wired into the existing `unRecompute` pass (which already fires on every
  jd change, not just param changes — confirmed by the events bar's
  existing "past" styling needing the same) rather than a separate
  subscription. **Which slider shows** (B1's deferred item) is now real for
  Coast: `syncSliderVisibility()` hides the full-span date bar and shows
  the coast slider when `workspace.phase === "coast"`, and reverses it
  otherwise — Departure/Arrival still share the date bar until B3.
  A stage in a broken/blocked state (no events) shows a "No computed span
  yet" placeholder rather than a stale or crashing slider. Verified
  in-browser: correct tick labels and pinned-at-start playhead on load
  (matches the release epoch vs. the coarse slider's day-rounding);
  clicking mid-track moves the shared clock and the date bar reflects it
  after switching back to Departure; breaking the skyhook stage falls back
  to the empty-state placeholder and recovers cleanly once fixed; no
  console errors. Node suites (84 tests, 7 new) green.
- [x] **B3. Departure slider — LINEAR time over launch → on-course.** ★★★
  **Done 2026-07-11.** First built event-scaled (equal-width event gaps), then
  **Kim redirected to linear time** (2026-07-11): the departure slider should
  represent time *consistently* across the ship's departure flight, from
  **launch on the left to the compliance deadline (origin-SOI exit) on the
  right**, because a single well-timed skyhook release, a release-plus-flyby-
  burns sequence, and an L1 elevator produce wildly different departure
  durations. So `ui/phase-slider.js` now carries `departureSliderState(opts)`
  (pure: even time ticks for the linear scale + interior event marks at their
  true time fractions + playhead/pin) and `createDepartureSlider`, siblings of
  the coast layer; the segment primitive gained `setMarks()` for overlaying
  event ticks on a linear axis (CSS `.mp-mark`). Node-tested
  (`ui/tests/phase-slider.test.js`, +5: empty/zero/inverted span, the LINEAR
  playhead fraction, even ticks, interior-only marks at true fractions, and
  pin/edge cases).
  **Span logic (mission-view.js `departureSpan`):** the RIGHT edge is the
  on-course/SOI-exit time (the anchor); the LEFT edge (launch) floats to fit
  the duration. Today the departure flight events give both edges directly
  (release .. Earth-SOI exit ≈ 2.56 d), with the Moon-SOI-exit event as an
  interior mark at ~5 % (a thin tick — exactly the "short milestones stay
  short" behaviour linear time gives, vs event-scaling's half-track). **Kim's
  Hohmann default** is the fallback length when only a single point resolves:
  `SOI_radius / injection-Δv` (Earth→dest `hohmann().dv1`, Earth's Laplace SOI)
  ≈ 1.70 d for Ceres — computed in `departureDefaultSpanSeconds()`. Any
  param/waypoint change already recomputes it (engine recompute → the slider's
  `update`).
  **Two pieces reach past what exists**, structured for a one-line swap: the
  *fixed-right-edge causality* (deadline is the input, release is derived) is
  the comply-mode inversion — **C1**; pre-C1 the right edge is derived from the
  release date + coast time rather than independently pinned. And departures
  that genuinely *take far longer* (Earth/Moon flyby burns) are **F5** — today
  the only real duration is the two-body coast to SOI. The widget is agnostic
  to how the duration is computed (two-body now, CR3BP later — it only wants
  the two edge jds).
  **Supporting physics kept from the first cut:** `lunar-skyhook` emits the two
  flight milestones (Moon-SOI exit, Earth-SOI exit → heliocentric) via the new
  pure `OrbitalMath.coastTimeToRadius` (two-body coast time to a target radius,
  round-trip Node-tested); Earth-SOI exit is the slider's right edge today,
  Moon-SOI exit its interior mark. `syncSliderVisibility()` is three-way:
  Departure → linear slider, Coast → date slider, Arrival → the raw date bar
  (until H2); each phase's slider IS its clock control. **Clock precision fix
  (shared):** the shared clock's `setClock` snapped to whole days
  (`date-bar.js` `setBaseDays` rounds) — invisible on Coast's multi-year span
  but crippling on a ~2.5-day departure scrub (and it quietly rounded off
  events-bar clicks). Added `date-bar.js` `setJd(jd)` (sets `state.jd` exactly,
  using the stepped fine slider only for the thumb's visual position) and
  routed `setClock` through it; `applyDate`'s own behaviour is unchanged.
  **In-browser verified** (local server): the departure scrub maps click
  fraction → playhead 1:1 (0/0.25/0.5/0.75/1.0 exact, no day/step snapping),
  event clicks land exactly on their marks (release→0 %, Earth-SOI→100 %,
  Moon-SOI mark at ~4.9 %), a coast-time clock pins the departure playhead at
  the end, five even ~12 h time ticks render, console clean. Node suites: **91
  green** (one prior `events.length` assertion updated 1→3). **Arrival's slider
  is deferred with H2** — the widget is arrival-ready, it just has nothing to
  feed it yet.
  Mockup: mock-a-phases.html:229–240 (departure). Depends on B2.
- [ ] **B4. Core-data readout in the phase bar.** ★
  Frozen-plan summary (dates, flight time, v∞ out/in) + the shared clock,
  top-right of the phase bar. Pure DOM; data comes from the frozen plan (C1).
  Mockup: mock-a-phases.html:221–224.
- [ ] **B5. Events bar → per-phase filtering.** ★
  The flat events bar (planner.js:550–574) filters to the active phase's span
  and stays as the "click to set clock" affordance. Small once B1 exists.

### WP-C — Comply mode: the frozen plan in core and UI

The core's warnings channel was built for this
(`core/tests/warnings-events.test.js` has a comply-mode-shaped chain);
what's missing is the frozen-plan stage itself and its card.

- [x] **C1. `modules/frozen-plan/` — the frozen flight-plan module.** ★★★
  **Done 2026-07-11.** `modules/frozen-plan/frozen-plan.js`, structurally the
  transfer-leg template (pure `computeCompliance` + `complianceWarnings` +
  thin descriptor; `complianceFor(world, stageId)` WeakMap cache for the
  cards). **Param schema (for Kim's review — it becomes E2's freeze
  contract):** `origin` (departure system's primary, "Earth"), `departure:
  { r, v, jd }` (the frozen helio hand-off state the tech must deliver,
  PRE-leg-burn), `arrival: { body, jd, vInf }` (the commitment the arrival
  tech must catch), `burn` + `waypoints` (frozen REFERENCE copies of the
  plan's burns — the working copies live on the transfer-leg stage; the plan
  never recomputes the coast from them). v∞ out is DERIVED from
  departure.v − origin's helio velocity, never stored, so state and
  requirement can't disagree; v∞ in is stored (computing it would mean
  re-flying the plan). **Comply semantics:** update() always emits the
  plan's own departure state — detuning the tech warns (v∞ / epoch / aim
  rows, tolerances exported: 10 m/s / 0.25 d / 1°) while the coast's output
  does not move; each warning carries required/delivered in `values` (C2's
  grid) and a directional fix. **Core addition `inputOptional: true`**
  (recompute.js, +2 core tests): a mission with an empty tech slot (E2
  spawns these) runs the plan with input null — the empty slot is a
  `no-departure-tech` warning, not a chain-wide block. **Chain position:**
  tech → frozen-plan → transfer-leg; the shipped preset now carries all
  three ("stg-3" between the two, departure state baked at full precision
  from `computeRelease(defaults)`, arrival v∞ 3776.34 m/s — a Node test
  pins baked-vs-model so release-physics drift says "re-bake"). B2's noted
  one-line swap landed too: mission-view's `coastSpan` reads the plan's
  departure/arrival events when a frozen-plan stage emits (slider pinned to
  the frozen dates; live edits deviate visibly), falling back to the event
  envelope without one. The module's `init` is the read-only coast-sidebar
  "Flight plan" card (mockup:432–440: dates, flight time, v∞ out/in, plan
  Δv, comply note — `.mp-plannote` CSS lifted from the mockup); the
  PLAN-REQUIRES/TECH-DELIVERS grid card stays C2. **B3's right-edge
  inversion is NOT here:** the idealized chain hands off at the release
  epoch itself, so there's no independent SOI-exit deadline to pin until
  the geocentric leg exists (F5). Old saved missions simply lack the stage
  and run as before. Verified: 109 Node tests green (16 new in
  `modules/tests/frozen-plan.test.js`); in-browser on the preset — three
  "ok" cards, detuned skyhook (relAlt 5000) shows "short by 0.83 km/s" +
  1.7° aim warnings with the coast still ending 0.000 AU from Ceres,
  legDays 900 leaves the coast slider pinned Dec 2031 → Jan 2034 while the
  leg warns 0.352 AU, all clears on restore, console clean.
- [x] **C2. Plan-compliance readout.** ★★
  **Done 2026-07-12**, redirected mid-task by Kim away from the mockup's
  sidebar-card placement. First cut put a "PLAN REQUIRES / TECH DELIVERS"
  grid inside frozen-plan.js's "Flight plan" sidebar card (matching
  mock-a-phases.html:406–420/489–499); Kim redirected it to the phase bar,
  above the timeline, replacing the old stage strip there (a row of buttons
  that just scrolled to a sidebar card — "I don't think those are really
  useful"). Final shape: `.mp-compliance-bar` (planner.html/css, where
  `.mp-stage-strip` was) shows a chip (`compliance: met` / `not met` / `no
  departure tech`) plus one compact metric per row — `v∞ 5.50 km/s`, or
  `v∞ 5.50 km/s → 4.67 km/s` when delivered misses the requirement, colored
  ok/warn — with the warning's `fix` text as a hover title on the mismatched
  metric. Always visible (not phase-gated, like the shared clock below it),
  built in `mission-view.js`'s new `renderComplianceBar` (called from
  `engine.onRecompute` beside the other per-result renders). Reads the full
  row set from `complianceFor(world, stageId)` — exposed on frozen-plan's
  registry **descriptor** (`default.complianceFor = complianceFor`, next to
  `init`/`update`) rather than a static import of the module file, so
  frozen-plan stays dynamically loaded like every other module
  (`planner.js`'s `MODULE_URLS`) and the shell only ever touches it through
  `registry.get("frozen-plan")` — same pattern already used for
  `desc.title`/`desc.rendersIn`/`desc.draw` elsewhere in the file. The
  sidebar's "Flight plan" card is back to its original, simpler form (frozen
  dates, flight time, v∞ out/in, plan Δv, plannote — no grid), and its
  generic `res.warnings` diagnostic boxes (full message + fix) are
  unsuppressed again, so a mismatch still gets full-text detail there while
  the phase bar gives the at-a-glance version. Verified in-browser: baseline
  preset shows `compliance: met` with all three metrics single-valued and
  green in both Departure and Coast phases (bar isn't phase-gated); detuning
  the skyhook's release altitude (6000→5000 km, same change used to verify
  C1) flips it to `not met` with `v∞ 5.50 km/s → 4.67 km/s` and
  `aim 0.0° → 1.7°` in warn color (epoch stays a single ok value), while the
  Coast sidebar's "Flight plan" card shows the matching two diagnostic boxes
  with their fix text and no duplication; restoring the value returns both
  to clean/ok; console clean throughout. Node suites unaffected (the grid
  and the bar are both browser-only rendering): 109 green. Assist buttons
  ("Set tip speed 2.61") are still explicitly **not** built here — that's
  C3, and it now targets the sidebar's diagnostic boxes (which carry the
  fix text) rather than the compact bar. Depends on C1.
- [ ] **C3. Assist actions ("Set tip speed 2.61" buttons).** ★★
  Diagnostics already carry an optional `fix`; extend the convention so a fix
  can be machine-applicable (`{ label, params-patch }`) and render it as a
  button that calls `world.set({stage, params})`. Small core addition +
  card wiring. Depends on C1/C2.
- [ ] **C4. In-pane comply indicators.** ★★★ — **needs design first.**
  The design doc says "indicators and interactive controls will be added to
  the three.js pane" to help meet requirements, but doesn't say what they look
  like. Sketch options with Kim (e.g. a required-v∞ ghost arrow vs the actual
  release arrow) before building. Park until then.

### WP-D — The Ephemeris tab (the SST port)

The biggest package: the Solar-System-Trajectory-Plotter's authoring
experience inside the planner. The compute core is already ported
(transfer-leg module); what moves here is the *interactive* layer —
ARCHITECTURE.md's "marker/targeting and snap-to ports (step 4.5)". The
Ephemeris tab keeps its own plain state object (like the SST's `state`), NOT
a mission World — it's a scratchpad; only "Start Mission Plan" produces a
World. Source file throughout:
`Calculators/Solar-System-Trajectory-Plotter/solarSystemTrajectory.js` (SST).

- [x] **D1. Ephemeris tab shell.** ★★
  **Done 2026-07-12.** `buildHelioFrame`/`buildEarthMoonFrame` (plus their
  `makeStars`/`makeLabelLayer`/`disposeScene` helpers) moved out of
  mission-view.js into a new `scene-frames.js` — the task's own "reuses
  `buildHelioFrame`... almost verbatim" wording meant the builder had to
  become shared, not re-typed, so mission views and the Ephemeris tab now
  build their helio scene from the exact same code (named `scene-frames.js`,
  not `frames.js`, to avoid colliding with `Shared/frames.js`'s unrelated
  coordinate-patching job). New `ephemeris-view.js` exports
  `createEphemerisView({ renderer, root })` → `{ show, hide, render, resize
  }` — one helio frame, full-pane (no floats: unlike a mission view the
  Ephemeris tab never shows more than one system), its own date bar
  (`Shared/sim/date-bar.js`, same 2030–2130/±6-month span every plotter
  uses, its own plain `{ jd, baseDays }` — no World to write into), and its
  own camera controls (`bindCameraControls`, bound once and never unbound,
  matching how the standalone plotters treat a page-lifetime view). Since
  there's exactly one instance for the page's life (unlike mission views,
  which clone a `<template>` per tab), its DOM lives directly in
  planner.html's `#mp-eph-view` addressed by class query (`.mp-scene`,
  `.mp-pane-main`, `.mp-datebar`, …) reusing the shell's existing CSS
  wholesale, not by new ids. `planner.css`'s `.mp-eph-view` changed from a
  centered stub paragraph to a flex-column full pane (same shape as
  `.mp-mission`). `planner.js` creates the one `ephView` alongside the
  renderer and routes `selectTab`/the render loop/the resize handler to it
  whenever `activeTabId === "eph"`, replacing the old manual
  `ephViewEl.classList` toggling. The sidebar carries only a placeholder
  note for now — destination/trajectory/waypoints (D2) and the marker card
  (D3) are what actually mount there. **Deliberately deferred:** camera
  angle and clock position are NOT persisted across reloads (no localStorage
  slot yet) — the Ephemeris tab is explicitly a scratchpad, and D2/D3 are
  where the real state-object shape (destination, waypoints, marker) gets
  decided, which is a more natural point to also decide what's worth saving.
  Verified: 109 Node tests green (unaffected — UI-only, and the extraction
  changed no behavior, only where the code lives); in-browser — the
  existing mission tab renders identically after the extraction (Coast
  phase, transfer-leg card, compliance bar all intact), the Ephemeris tab
  shows all 8 helio bodies with orbit rings, drag-rotate/wheel-zoom/date-bar
  scrubbing (body positions updating, e.g. Earth/Venus/Mercury advancing
  along their orbits) all work, tab switching back and forth is clean,
  window resize (tablet preset) reflows correctly, console and network
  (both new modules load 200) clean throughout. Depends on A1.
- [x] **D2. Destination select + trajectory + waypoints.** ★★
  **Done 2026-07-12.** `state.leg` in ephemeris-view.js is shaped exactly
  like transfer-leg's own `params` (`burn`, `waypoints`, `legDays`,
  `destination`) — deliberately, so E2's eventual freeze is "hand these
  fields to a transfer-leg stage," not a translation step. The leg itself —
  burn application, sample polyline, events, miss distance — goes through
  transfer-leg.js's exported `computeLeg` directly (imported alongside
  `defaultParams`/`MISS_WARN_AU`), satisfying the task's "don't fork the
  physics" literally: this is the SAME function the frozen chain calls once
  a plan exists, not a re-implementation. What computeLeg doesn't own stayed
  local: resolving a waypoint's "snap to an orbital feature" request into a
  concrete day offset, and the view-only glue (polyline, gizmos, burn
  arrows, readout boxes) — computeLeg's own cache is keyed by
  `(World, stageId)`, which a viewless scratchpad doesn't have.
  **Snap-to promoted to `Shared/math-utils.js`** (`apsisFromBurn`,
  `nodeInfo`, `snapTargetNu`, `timeToTrueAnomaly`, `snapTau`), per the
  inventory's own "candidates for promotion" note — GM made an explicit
  parameter (was closed over `GM_SUN` in the SST), with the first
  `Shared/tests/math-utils.test.js` (12 tests: apsis sense from burn sign,
  earthlike-vs-inclined node substitution, half-period-to-opposite-point,
  the zero-at-exact-match case, offset ordering, the "push a coincident
  feature to its next pass" DAY floor). `resolveWaypoints()` in
  ephemeris-view.js walks the waypoints in chronological order re-using
  `propagateState`/`applyBurn` (the same primitives computeLeg itself calls)
  to resolve each snap against the state at ITS segment's start, then hands
  the resolved `{days, burn}` list to computeLeg for the authoritative pass.
  **Bug caught by hand-checking the numbers in-browser, not just
  screenshotting:** the first cut started the resolve walk from the ORIGIN
  BODY'S pre-burn state instead of the state just after the departure burn
  (SST's own `segStartV = v` post-burn) — apoapsis resolved to "half of
  Earth's own year" (185 d) instead of half the actual transfer orbit's
  period (259 d for the a=1.26 AU test case, matching a hand calculation).
  Fixed by applying the departure burn before the walk starts. A second,
  smaller gap: the resolved day wasn't persisted back to `state`, so
  unchecking a snap reverted the day field to a stale pre-snap value instead
  of holding where it last resolved (SST mutates the waypoint object in
  place every pass; fixed by writing the resolved day back to state while
  snapped).
  **Departure card**: origin + destination selects (both built from
  scene-frames.js's `HELIO_BODIES`, now exported, so a select never offers a
  body the frame can't place), burn pro/rad/nrm as plain numeric fields
  (transfer-leg's own `numRow` pattern) rather than porting the SST's
  165-line isometric SVG vector-editor widget — deliberately deferred,
  matching how the tasks doc already frames that widget as an "optional
  upgrade" for F5/G1, not a D2 requirement — plus a leg-duration field (no
  `finalCoast()` port; a manual days field matching transfer-leg's own card
  exactly) and a status chip (ok / "misses X by Y AU" / the diagnostic
  message). **Waypoints card**: up to 2 (matches both the SST's two
  checkboxes and transfer-leg's own cap), each with the day field (disabled
  while snapped, showing the resolved value), three mutually-exclusive
  snap-to checkboxes with live apsis-availability/node-vs-90°substitute
  labels, a ±90° fine-tune slider, burn fields, and a resolved-state info
  line. Waypoint gizmos (`Shared/sim/burn-widget.js`'s `createWaypointGizmo`,
  held at 42px via `worldSizeAtPointForPx` each frame) and burn arrows
  (dV pink / prograde-Δv amber, `makeBurnArrow`, same 0.03 AU-per-km/s scale
  as the SST) draw at each waypoint's pre-burn state; the departure burn
  gets arrows only (no gizmo), matching the SST exactly. Burn readout boxes
  (`Shared/sim/readout-panes.js`, `classPrefix: "mp"` — new `.mp-readout*`
  CSS) anchor to each burn's host div and reposition on panel scroll;
  `burnReadoutData` stayed local per readout-panes.js's own header comment
  ("stays local to each calculator... isn't worth threading through a
  shared signature"). `.mp-main` gained `position: relative` for the
  readout layer's absolute positioning (harmless for mission views — pure
  flex children, unaffected). Verified: 121 Node tests green (12 new); in
  browser — burn/destination/leg-duration edits redraw the trajectory and
  update the status chip live, readout box tracks the departure burn field,
  waypoint add/remove correctly caps at 2 and cleans up gizmos/arrows on
  removal, snap-to resolves and re-verified against a hand calculation,
  unchecking a snap holds the last-resolved day, the mission tab is
  unaffected by transfer-leg.js now being imported both statically (here)
  and dynamically (the registry) — console and network clean throughout.
  **Deliberately not built** (later WP-D/E tasks): the marker card and
  Free/Track/Target modes (D3), closest-approach rings (D4), click-to-place
  picking (D5), in-scene dragging (G1). Depends on D1.
  **Redirected same day (2026-07-12, Kim):** "None of the conditions that
  come with a mission should exist there" — the "leg duration" field was a
  mission condition wearing a UI control's clothes (a manually-typed
  cutoff), which doesn't belong in a tab whose whole point is playing with
  trajectories before any mission exists. Removed the field entirely;
  `legDays` is now derived fresh every `refresh()` by a ported `finalCoast`
  heuristic (one full orbital period if the resulting arc is bound, capped
  at 60 years; a fixed 12-year escape coast if not) — the SST's own
  "simplified conic section" approach, applied to whatever's downstream of
  the last waypoint (or the departure burn if there are none). A bound leg
  now draws a genuinely closed loop; an unbound one trails off. This also
  retired the arrival-miss check and the amber "destination at arrival" dot
  — both rode on a duration that no longer exists, and "did you arrive on
  time" isn't a coherent question without one (that's the marker's job once
  D3 lands, sliding along the whole drawn loop against the destination's
  live position). The status chip is now just ok/error (a genuine physics
  failure, e.g. a manually-typed waypoint day past the drawn loop's end).
  **A real bug surfaced by hand-verifying the new numbers, not just
  eyeballing the render:** `finalCoastDays` needs the state AFTER the last
  waypoint's burn (or the departure burn) to size the final segment
  correctly — `resolveWaypoints` already tracked this internally but hadn't
  exposed it, so the first cut fed it the wrong state for a no-waypoint leg;
  fixed by returning `{entries, finalR, finalV, tPrev}` instead of a bare
  array. Also fixed in passing: `setStatus()` was clobbering the chip
  element's `mp-eph-status` hook class on every call (harmless to the
  running app — the code holds a direct reference — but broke re-querying
  it), caught the same way. Verified: 121 Node tests still green (no core
  logic changed, only ephemeris-view.js); in-browser — a zero-burn leg now
  draws Earth's own orbit as a full closed circle (previously truncated at
  480 days), a burn toward Mars closes into a full ellipse instead of
  stopping mid-arc, a large burn produces a genuine hyperbolic trail-off,
  status chip and readout boxes still track burns correctly, console clean
  throughout.
- [x] **D3. Marker card + Free/Track/Target state machine.** ★★★
  **Done 2026-07-12.** The SST's marker orchestration
  (`applyTargeting`/`setMarkerMode`/`updateMarker`/`updateDestinationMarker`/
  `focusMarker`/`removeMarker`/`placeMarkerAtGlobalTime` + the card build),
  ported into ephemeris-view.js onto this view's own trajectory
  representation — a `trajSegs` list of per-segment start states rebuilt
  each `refresh()` from `resolveWaypoints`' entries + the departure state,
  same shape the SST kept. The mechanical layer stayed shared exactly as
  marker-card.js's header prescribes (sprites, card skeleton, drag-slider,
  `refineApproach`, `followCrossing`; approach-markers.js's ring sprite +
  `pickProximityTier` for the temporal ring). **Placement decisions:** the
  card is a normal SIDEBAR card at the top of the panel (the shared skeleton
  with `classPrefix "mp"`, handed `.mp-card` styling — new `.mp-marker-*` /
  `.mp-mode-btn` CSS in planner.css), per the mockup's Ephemeris sidebar
  (mock-a-phases.html:184–209) rather than the SST's floating overlay — E1's
  gated button lands at its bottom. A **"Place marker" sidebar button**
  (drops it mid-path; swaps visibility with the card) stands in until D5's
  click-to-place. The **temporal-proximity ring came along with
  `updateDestinationMarker`** (it lives inside it), so D4's remaining piece
  is the orbit-approach scan + its space-ring tables. Target's terminal burn
  is the CHRONOLOGICALLY last waypoint's (this view's waypoints carry
  absolute days and may sit out of array order; the SST's per-segment taus
  were inherently ordered), and solved burns re-sync the numeric fields via
  `syncBurnInputs` (the SST's `_sstRedraw` equivalent). Camera: marker focus
  via `lockedZoomTarget`/`onPan` on the existing binding, like the SST.
  **Two real bugs found by hand-checking numbers in-browser, both fixed in
  Shared:** (1) the SST decomposes Target's Lambert Δv in the osculating
  r×v frame, but `O.applyBurn` re-applies components in the
  ecliptic-anchored `burnFrame` — a slightly wrong Δv on inclined arcs; the
  port uses new **`O.burnComponents`** (math-utils — the exact inverse of
  applyBurn, round-trip Node-tested; the SST's own copy still decomposes the
  old way, flagged as follow-up). (2) **`O.lambert` could return a
  non-converged solution**: its ψ bisection exhausts the bracket (floor −4π)
  on strongly hyperbolic transfers and returned the collapsed result anyway —
  a Target solve asked for a 58-day leg, got a 95-day arc, and put the
  "encounter" 1.4 AU off Mars. Fixed to honour its own documented contract
  (null when the achieved dt misses the request by > max(1 s, 1e-6·dt));
  the SST and Mars-Phobos targeting share the function and inherit the fix.
  **Verified in-browser, numbers hand-checked:** 2.94 km/s prograde at Earth
  → marker mid-path reads 1.550 AU / 21.08 km/s / 260 d, matching vis-viva
  (a = 1.266 AU) exactly; slider −90° → quarter-path (130 d); Target over
  budget releases (37.9 > 10 km/s, burn untouched), within budget writes the
  solved burn (component magnitudes ≡ the Δv readout), pins the marker ON
  Mars (phasing +0.0 d), holds the arrival date while the departure date
  scrubs (TOF 260→215 d for a +45 d scrub, Δv re-solving), and leaving
  Target restores both the manual burn and the saved marker position; Track
  glues to the Mars-orbit crossing while inside the 0.004 AU ring and
  freezes without jumping when the reshaped arc leaves it (engagement
  checked against a ground-truth `distanceToOrbit` scan — an ecliptic-plane
  arc genuinely only enters the ring near the destination's nodes);
  remove/re-place cycles clean; the mission tab unaffected; console clean
  throughout. Node suites: **125 green** (4 new — burnComponents round-trips
  ×2, lambert feasible-case self-consistency, lambert unreachable-case
  null). Depends on D1/D2.
  **Placement reversed (2026-07-13, Kim):** moved off the sidebar to a
  floating overlay atop the 3D pane (`.mp-eph-marker`, top-right of
  `.mp-scene`), matching the SST's own layout after all. CSS reuses the
  same rgba/box-shadow treatment as the straddling `.mp-readout` boxes;
  no JS logic changed, only planner.html's host location and planner.css.
- [x] **D4. Approach rings (space + time).** ★★
  **Done 2026-07-12.** The temporal-proximity ring already came across with
  D3 (it lives inside `updateDestinationMarker`), so this task's remaining
  piece was the orbit-proximity SCAN: `computeOrbitApproaches`
  (SST:628–710, its per-body gate + point-to-ellipse refine) ported into
  ephemeris-view.js almost verbatim, reusing the ring-sprite mechanics
  already imported from `Shared/sim/approach-markers.js` (`makeRingSprite`/
  `applyTierToSprite`/`scaleApproachMark`/`pickProximityTier` — all four were
  already there for the temporal ring). New `SPACE_TIERS` table (colors/px/
  lineWidth/worldR — identical values to the SST's `APPROACH_TIERS`) plus
  `APPROACH_NEAR`/`APPROACH_CLOSE` alongside the existing `APPROACH_FAR`
  (D3's Track-engagement threshold doubles as the space ring's own farthest
  tier, same as the SST). **One genuine simplification, not just a port:**
  the SST's `trajSamples` are pre-scaled `THREE.Vector3`s in AU, so its scan
  does a `p.x*AU` round-trip back to metres for the ellipse-frame math; this
  view's `leg.samples` (from `computeLeg`) are already `{r (m), t (s)}`
  arrays, so the ported scan works directly in metres throughout and skips
  that conversion. New module state: `trajSamples` (leg.samples verbatim,
  alongside the existing `trajSegs`/`trajTotalT`) and `orbitApproachMarks`
  (the live ring sprites). Wired into `refresh()`: the ok-branch stores
  `trajSamples` and calls the new `rebuildApproachMarks()` after the
  trajectory/waypoint gizmos are drawn (mirroring the SST's own call at the
  end of `drawTrajectory`); the failure branch clears `trajSamples` and the
  rings together with the rest of the marker-hiding cleanup. `render()`
  scales each ring per frame via `scaleApproachMark`, alongside the temporal
  ring's own call.
  **Verified two ways** (the Browser pane's screenshot capture was
  unreliable this session — timed out repeatedly even though the page
  itself was healthy: console clean, all modules 200, canvas rendering
  confirmed via `toDataURL`, `document.readyState` "complete" — so
  verification leaned on DOM/JS introspection instead of pixel screenshots):
  (1) the ported ellipse-frame distance formula was checked in Node against
  the already-trusted `OrbitalMath.distanceToOrbit` for the same orbit/point
  — bit-identical (to floating-point noise), confirming the inlined
  pre-filter math is a correct, unit-consistent (all-metres) transcription;
  (2) in-browser, patching `THREE.Object3D.prototype.add` to log sprite
  creations, then driving a real scenario (origin Earth, destination Mars,
  Target mode Lambert-solved with a raised Δv budget so it wasn't released)
  produced exactly ONE space ring — tier 2 (closest), the correct color/px/
  worldR from `SPACE_TIERS` — positioned at [0.171, 1.545, 0.028] AU; a
  direct Node computation of Mars's actual position at the solved arrival
  date (2030-07-02) gave [0.179, 1.543, 0.028] AU, matching to within a
  fractional day of orbital motion (the date field only displays whole
  days). The other 7 candidate bodies correctly produced no rings, and the
  origin (Earth) was correctly excluded. Node suites unaffected (browser-only
  change): 125 green. Depends on D1/D2/D3.
- [x] **D5. Click-to-place-marker picking.** ★★
  **Done 2026-07-13.** `handlePick(e)` in ephemeris-view.js, the SST's own
  `handlePick` (SST:1037–1078) ported almost verbatim: a plain click either
  places/moves the marker at the nearest trajectory sample in screen space,
  refocuses the camera if the click landed on the marker's own sprite
  instead, or (clicking empty space) just releases the focus lock. Wired via
  the shared camera-controller's `onPick` hook (Shared/sim/camera-
  controller.js — a deferred single-click handler that fires after mouseup
  only if the press didn't move and wasn't the first half of a double-click,
  so it never fights rotate-drag), alongside the pane's existing `pickPoint`
  wheel-zoom config. **One real adaptation, not just a coordinate-frame
  swap:** the task text's "scissored-pane raycast context" pointed at how
  `pickPoint` already reads `paneMainEl`'s own rect rather than the renderer
  canvas's rect (relevant when a mission view's floating panes share one
  canvas); `handlePick` reads the same `paneMainEl` rect for consistency,
  though the Ephemeris tab is single-pane today so the two coincide. Also,
  same as D4's `computeOrbitApproaches`: `trajSamples` here is `leg.samples`
  in metres (not the SST's pre-scaled AU `THREE.Vector3`s), so each candidate
  is converted before `.project()`. The old "Place marker" sidebar button
  (D3's stand-in) is removed — the sidebar hint card now just says "Click
  the drawn trajectory to place a marker," matching the SST's own click-only
  UX (it never had a button either).
  **Verified two ways, since the Browser pane was backgrounded this session**
  (`document.hidden`/no `requestAnimationFrame` calls confirmed via
  instrumentation, so `computer{screenshot}` and any real render both hung —
  an environment condition, not a code issue): (1) DOM inspection confirmed
  the hint card lost its button and shows the new click-to-place text; (2)
  `handlePick`'s actual logic was exercised with real dispatched
  `mousedown`/`mouseup` `MouseEvent`s on the pane, with `THREE.Vector3.
  prototype.project` overridden to a fixed, known world→NDC mapping (test-
  only, decoupling the check from the unconfigured camera — `.project()`
  itself is trusted library code, not something this task wrote) so the
  expected click pixel for a given trajectory sample could be computed
  independently and compared. Three real click sequences on a genuine drawn
  leg (burn pro 3 km/s from Earth) all landed correctly: clicking sample
  index 100 placed a new marker there (readout: radius 1.564 AU, exactly
  matching that sample's own magnitude; one new sprite); clicking sample
  index 50 moved the SAME marker (radius updated to 1.264 AU, no new
  sprite — confirms move-not-duplicate); clicking the marker's own sprite
  position refocused only (radius unchanged, no new sprite); clicking a far
  corner of the pane left the marker untouched. Console clean throughout.
  Node suites unaffected (browser-only change): 125 green. Depends on
  D1/D2/D3/D4.
- [ ] **D6. System switcher (Earth–Moon, Mars–Phobos ephemeris modes).** —
  **defer.** The design doc lists this as the one change from the current
  SST, but each system needs its own authoring loop (the Mars–Phobos marker
  slides a different chain shape — see marker-card.js's header). Recommend
  shipping the solar-system Ephemeris tab first and treating this as its own
  later package. Decision for Kim.

### WP-E — "Start Mission Plan" flow (stitches A+C+D together)

- [x] **E1. Gated button on the marker card.** ★★
  **Done 2026-07-13.** `buildCard()` (ephemeris-view.js) appends a
  full-width `.mp-btn.mp-big` "Start Mission Plan" button + a note
  (`mk.startNote`) straight onto `mk.el`, after `Shared/sim/marker-card.js`'s
  own rows — that shared skeleton stays generic (the SST has no such
  button), so this piece is local like the rest of the state machine around
  it. Gating lives in `updateStartMissionButton(info)`, called from
  `updateDestinationMarker` (the same place nearOrbit/phasing/the temporal
  ring already computed their numbers) right after the space/time checks —
  **no new thresholds**: "space" reuses `nearOrbit`'s existing `APPROACH_FAR`
  radius (same one the D4 space-ring tiers key off), "time" reuses the
  temporal ring's own `tier >= 0` (`TEMP_FAR`) — so "inside the ring" here is
  literally "the ring the marker already draws is currently showing," not a
  parallel concept. The note **always says why**, matching the mockup's own
  framing: no destination selected, or the live distance-to-orbit /
  timing-offset figure and its threshold, or (both satisfied) the plain
  success line. The click handler is deliberately **inert** — no `onclick`,
  just a title tooltip — same precedent as A2's tab "+" affordance, both
  pointing at a later E-numbered task (E2: freeze + spawn) that doesn't
  exist yet. CSS: `.mp-btn:disabled` (generic dim/not-allowed), `.mp-btn.mp-
  big` (full-width CTA, values lifted from the mockup's own `.btn.big`), and
  a small `.mp-eph-marker .mp-card .mp-muted` spacing rule for the note.
  **Also touched:** the third Ephemeris sidebar card's static placeholder
  note (planner.html, pre-existing from D1/D2, "'Start Mission Plan' (not
  built yet)") was reworded now that the gate itself is live — it still
  correctly flags E2 (the actual freeze) as the unbuilt part. An initial cut
  also added a "waypoints are copied in" note inside the marker card itself,
  matching the mockup's card 2; removed it as redundant once the static
  note already covers that (and the mockup actually puts that line on the
  *waypoint* card, not the marker card).
  **Verified in-browser via DOM/JS introspection**, not a screenshot: this
  session's Browser pane reported `document.hidden === true` throughout
  (the same environment condition D5's own verification hit), so the render
  loop never ran, `frame.camera`'s matrices stayed uninitialized, and
  `handlePick`'s screen-space projection couldn't be exercised for real. A
  temporary debug hook (`window.__mpEphDebug`, removed before finishing)
  called the module's own `placeMarkerAtGlobalTime`/`refresh` directly to
  drive the three cases by hand: no destination → disabled, "Select a
  destination to enable…"; Mars selected, marker placed 150 d out (0.1638 AU
  from Mars's orbit) → disabled, "Marker is 0.1638 AU from Mars's orbit —
  needs to be within 0.004 AU."; Target mode Lambert-solved to Mars (Δv
  budget raised to 40 km/s to admit the 28.16 km/s solution) → a genuine
  rendezvous, phase readout "+0.0 d" → **enabled**, "Marker sits inside both
  closest-approach rings (space and time)." Console clean throughout; Node
  suites unaffected (browser-only change): 125 green. Depends on D3/D4.
- [ ] **E2. Freeze + spawn.** ★★★
  On click: name dialog (mockup:513–523) → build a new World whose profile is
  `[frozen-plan (C1)] + copied waypoints + empty tech slots` → register it as
  a new mission tab (A1/A2) → switch to it. Defining exactly what gets frozen
  (states, epochs, v∞s, waypoints) is the contract between D and C — do this
  with C1's author or the same thread.
- [ ] **E3. Ephemeris tab reset.** ★
  "Delete marker and start fresh" on the Ephemeris tab after a mission is
  spawned (the design doc's flow). Mostly calls D3's `removeMarker`.

### WP-F — Tech cards: load, configure, exchange

- [ ] **F1. Tech dropdown per endpoint slot.** ★★
  A "Departure technology" / "Arrival technology" card with a dropdown
  (mockup:383–392, 467–476); choosing one dynamic-imports the module and
  `world.set({swapStage, moduleId, params})`. The registry and dynamic-import
  pattern already exist (planner.js:62–68). Greyed "(future)" options for
  unbuilt tech.
- [ ] **F2. Exchange receive banner.** ★★
  "Load configuration from a calculator…": accept matching packet types via
  `Exchange.accept`, show the banner (source, label, date), Apply maps payload
  → stage params. The whole pattern — including the checkbox-display gotcha —
  is already implemented in
  `Calculators/Skyhook-Spin-Launcher/skyhookSpinLauncher.js` (the
  tether-spec receive side); copy its shape.
- [ ] **F3. Send buttons on tech cards.** ★
  "Send tether-spec → Tether tool", "Send ship-state → calculator" etc.;
  `Exchange.send` + the producer-side pattern from
  `Calculators/Gravity-gradient-skyhooks/`. Per-card, incremental.
- [ ] **F4. Card expandable sections.** ★
  The design doc suggests tabs/expandable sections for secondary params and
  readouts. Plain `<details>`-style DOM + CSS in the card scaffolding
  (planner.js:445–477); no logic.
- [ ] **F5. Waypoint burns inside the departure/arrival system (up to 2).** ★★★
  The design's in-system burns (mockup:422–426, 501–505). The physics and UI
  both exist in the Moon-Skyhook plotter's geocentric waypoint-burn chain
  (MSK:705–1201, see inventory below) — but adapting it into the module
  contract (params on the skyhook/arrival stage, pure update, draw hook) is
  real work. Needs the lunar-skyhook module to grow a geocentric leg — the
  module's header already flags this gap (the perigee-Oberth limitation).

### WP-G — In-scene interaction in mission tabs

- [ ] **G1. Drag waypoints along the trajectory (Coast).** ★★★
  Design: adjust a waypoint by dragging it along the leg. Needs pane raycast →
  nearest-path-point (D5's picker) → transient `world.set` during the gesture
  (the World API already supports transient sets for undo-coalescing) →
  commit on release. First real gizmo-drag in the shell; do after D5.
- [ ] **G2. Marker on the departure trajectory.** ★★
  Design: once a departure trajectory exists, click it to place a marker with
  a card "designed to help with meeting speed and trajectory requirements".
  Reuses D3's ported machine in the Earth–Moon frame with comply data (C1)
  in the card. After D3 + C1.
- [ ] **G3. Camera controls in floating panes.** ★
  Currently click-to-swap only (a recorded polish deferral,
  planner.js:386–400). Bind per-pane controls with each float's own config.
  Optional polish; cheap.

### WP-H — Arrival phase enablement

- [ ] **H1. Generic body-local frame factory.** ★★
  `buildEarthMoonFrame` (planner.js:193–273) generalized to
  `buildBodyFrame("Ceres")` etc. (hero sphere, label, lighting, ring as
  applicable), so Arrival can show the destination system. Prerequisite for
  H2 and for the design's "destination body in the main pane".
- [ ] **H2. A first arrival module.** ★★★ — **decision for Kim.**
  The Arrival button stays disabled until an arrival-capable module exists.
  Options: (a) a minimal "chemical capture burn / intercept check" module now
  (small, unblocks all Arrival UI work: C2's arrival card, B3's arrival
  slider, F1's dropdown), then (b) the real Ceres-elevator catch port as
  planned in migration step 4.5. Recommend (a) then (b). 
  - Comment from Kim: How about using the Mars-Phobos skyhook as the first model where catch planning can be structured?

---

## Inventory: existing code to adapt

### Already shared — use as-is (import from `Shared/`)

These were extracted in migration step 1 and are already imported by the
scaffold; new UI should reach for them before writing anything fresh.

| Module                                                                  | Exports worth knowing                                                                                                                                                                                                                                                                 | Used by tasks                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `Shared/sim/marker-card.js` (361 lines)                                 | `makeShipSprite`, `makeXMarkSprite`, `orientMarkerSprite`, `buildMarkerCard` (DOM skeleton), `bindRelativeDragSlider`, `markerFraction`, `sweepAngleFrom`, `phasingDays`, `refineApproach`, `followCrossing`. Header comment documents the shared-vs-local split — read it before D3. | D3, D4, E1, G2                            |
| `Shared/sim/burn-widget.js`                                             | `createWaypointGizmo` (prograde/radial/normal triad), `makeBurnArrow`                                                                                                                                                                                                                 | D2, F5, G1                                |
| `Shared/sim/approach-markers.js`                                        | ring sprite + `pickProximityTier`, `applyTierToSprite` (tier tables stay caller-side)                                                                                                                                                                                                 | D4, E1                                    |
| `Shared/sim/readout-panes.js`                                           | `renderReadoutBoxes`, `positionReadoutBoxes` (panel-edge burn readouts)                                                                                                                                                                                                               | D2, F5                                    |
| `Shared/sim/date-bar.js`                                                | `createDateBar` — coarse+fine sliders, date field, JD readout                                                                                                                                                                                                                         | B2 (as parts donor), already in the shell |
| `Shared/sim/camera-controller.js`, `body-renderer.js`, `orbit-rings.js` | already wired in planner.js                                                                                                                                                                                                                                                           | A1, D1, H1                                |
| `Shared/exchange.js` + `exchange-types.js`                              | `Exchange.send/accept/pending/consume/linkFor`, `PacketTypes.make/validate`, `encodeFragment`/`decodeFragment`                                                                                                                                                                        | A3, F2, F3                                |
| `Shared/frames.js`                                                      | `localToHelio`/`helioToLocal`/`convert` — frame patching                                                                                                                                                                                                                              | C1, F5                                    |

### Port needed — tool-local code that moves into the planner

**From `Calculators/Solar-System-Trajectory-Plotter/solarSystemTrajectory.js` (1549 lines):**

| Section                  | Lines (2026-07-10) | What it is                                                                                                                                                                                                          | Task                 |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Waypoint gizmo wiring    | ~275–363           | `makeWaypointGizmo` + drag handling around the shared triad                                                                                                                                                         | D2, G1               |
| Snap-to helpers          | ~378–475           | `snapTargetNu`, `timeToTrueAnomaly`, `snapTau` — apsis/node snapping (pure-ish; candidates for `math-utils.js` promotion with tests)                                                                                | D2                   |
| Burn readout boxes       | ~564–607           | `burnReadoutData` + shared readout-panes calls                                                                                                                                                                      | D2                   |
| Orbit-approach markers   | ~628–710           | `computeOrbitApproaches` scan + tier tables + temporal ring                                                                                                                                                         | D4                   |
| **Marker state machine** | ~711–1036          | `applyTargeting` (Lambert re-solve, 761), `setMarkerMode` (816), `updateDestinationMarker` (848), `buildMarkerCard` (888), `updateMarker` (927), `focusMarker`/`removeMarker`/`placeMarkerAtGlobalTime` (1003–1035) | **D3** (the big one) |
| Trajectory picking       | ~1037–1078         | click → nearest trajectory sample → place/move marker                                                                                                                                                               | D5, G1               |
| UI building              | ~1079–1345         | `buildDestinationOptions` (1093), `buildWaypointList` (1273) — the **waypoint cards**                                                                                                                               | D2                   |
| Refresh orchestration    | ~1346–1451         | what recomputes on what change — read for understanding, don't port literally (the engine owns this in the planner)                                                                                                 | D2/D3 background     |

**From `Calculators/Moon-Skyhook-Trajectory-Plotter/moonSkyhookTrajectory.js` (2318 lines):**

| Section                     | Lines                  | What it is                                                                                        | Task                                            |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Sidebar card structure      | throughout its HTML/JS | the design doc's cited "good example" of a tech card (skyhook geometry + release params)          | F1/F4 reference                                 |
| Released-ship trajectory    | ~533–704               | restricted N-body geocentric propagation of the released ship                                     | F5 (the physics the lunar-skyhook module lacks) |
| Waypoint burns (geocentric) | ~705–1201              | in-system waypoint-burn chain — exactly the design's "up to 2 waypoint burns within this system"  | **F5**                                          |
| Gizmos + arrows + readouts  | ~1202–1277             | waypoint gizmo/arrow wiring in the local frame                                                    | F5                                              |
| Burn-vector editor          | ~1754–1922             | the isometric 3-axis draggable-arrow burn editor — a strong in-card alternative to numeric fields | F5, G1 (optional upgrade)                       |
| Waypoint list cards         | ~1923–1961             | its `buildWaypointList` variant                                                                   | F5                                              |

**From the scaffold and mockup (patterns to extend or copy):**

| Source                                                     | Lines                                                                                                                                                                                                             | What it gives                                                                        | Task         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------ |
| `planner.js` frame factories                               | 138–273                                                                                                                                                                                                           | `buildHelioFrame` / `buildEarthMoonFrame` → generalize                               | A1, H1       |
| `planner.js` workspace persistence                         | 279–308                                                                                                                                                                                                           | versioned localStorage save/restore pattern                                          | A3           |
| `planner.js` card + diagnostics scaffolding                | 434–523                                                                                                                                                                                                           | per-stage cards, uniform `renderDiagBox`, `onResult`                                 | C2, C3, F4   |
| `planner.js` stage strip / events bar                      | 525–574                                                                                                                                                                                                           | status dots, event → clock                                                           | B1, B5       |
| `planner.js` share-link load path                          | 74–92, 364–384                                                                                                                                                                                                    | fragment encode/decode + polite fallback banner                                      | A3           |
| `mockups/mock-a-phases.html`                               | tab bar 134–140 · Ephemeris marker card 184–209 · phase bar 217–225 · three sliders 227–266 · departure sidebar 382–427 · coast sidebar 430–463 · arrival sidebar 466–506 · dialog 513–523 · switching JS 525–548 | the agreed look and interaction for every WP; lift its CSS wholesale where it fits   | all UI tasks |
| `Calculators/Skyhook-Spin-Launcher/skyhookSpinLauncher.js` | receive-banner + Apply mapping                                                                                                                                                                                    | the proven exchange-receive pattern (incl. the `checked`-from-script display gotcha) | F2           |
| `Calculators/Gravity-gradient-skyhooks/`                   | send-button side                                                                                                                                                                                                  | producer pattern: `calc()` first, then read authoritative fields                     | F3           |
| `modules/transfer-leg/transfer-leg.js`                     | whole file (332 lines)                                                                                                                                                                                            | the module template: pure compute + descriptor + card-building `init` + `draw`       | C1, F5, H2   |

---

## Decisions needed from Kim (blockers marked ●)

1. ● **A3 persistence scope** — persist missions across reloads now
   (recommended), or in-session only as the README's "later steps" implies?
2. ● **H2 arrival module** — build a minimal capture-burn module now to
   unblock the Arrival phase UI, or hold everything Arrival until the real
   Ceres-elevator port (step 4.5)?
3. **C4 comply indicators in the 3D pane** — needs a design conversation
   before any code.
4. **D6 system switcher** — confirm deferral of Earth–Moon / Mars–Phobos
   ephemeris modes to a later package.
5. **E2 freeze contract** — review the frozen-plan param schema when C1/E2
   propose it (it becomes a versioned save format, so it's worth a careful
   look).
