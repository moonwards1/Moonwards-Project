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
- [x] **B3. Event-scaled Departure slider.** ★★★
  **Done 2026-07-11.** `ui/phase-slider.js` gains the event-scaled layer as a
  sibling of B2's coast layer, on the same `createSegmentedSlider` primitive:
  `eventSliderState(opts)` (pure: N flight events → N−1 equal-width gaps, each
  labelled by the milestone it reaches; playhead fraction; pin outside the
  span) and its inverse `eventSliderJd(events, fraction)`, with the thin
  `createEventSlider` DOM wrapper. Both pure halves are Node-tested
  (`ui/tests/phase-slider.test.js`, +7: empty <2 events, equal-width gaps,
  the nonlinear-but-continuous jd↔fraction map, pin/edge cases, unsorted
  input, and a scrub round-trip).
  **Kim's two design calls shaped this:** (1) *no dragging bridges a phase* —
  already true since B2 (three separate sliders, one shared clock, each pins
  outside its own span), so the only "boundaries" left are the little
  event-to-event gaps *within* one slider; those cross cleanly because the
  wrapper stores no drag state — every scrub is a fresh `eventSliderJd →
  setClock → re-derive playhead`. (2) *the slider is the ship's flight only,
  release → catch* — pre-launch (on the tether) and post-catch (on the
  elevator) events are filtered out; `departureEvents()` in mission-view.js
  drops any event flagged `flight:false` (none emitted yet, the hook is there
  for F5/H2).
  **The data to scale didn't exist**, so per Kim we added it honestly rather
  than faking segments: `lunar-skyhook` now emits two flight milestones beyond
  release — **Moon-SOI exit** (~3 h) and **Earth-SOI exit → heliocentric**
  (~2.5 d) — computed as two-body coast times along the SAME patched conics
  the release physics already uses (new pure helper
  `OrbitalMath.coastTimeToRadius`, round-trip Node-tested; the lunar hyperbola's
  periapsis is the release point, the geocentric hyperbola runs from the Moon's
  distance to Earth's Laplace SOI). The ~3 h vs ~2.5 d gap is exactly the scale
  disparity that makes event-scaling worth it — linear time would crush the
  first gap to a sliver. `syncSliderVisibility()` is now three-way: Departure →
  event slider, Coast → date slider, Arrival → the raw date bar (until H2);
  each phase's slider IS its clock control. Node suites: 92 green (84 + 8, one
  prior `events.length` assertion updated 1→3). **Arrival's event-scaled
  slider is deferred with H2** (no arrival module, phase button still disabled)
  — the widget is arrival-ready, it just has nothing to feed it yet.
  *In-browser verification still pending* (the browser tool's safety
  classifier was unavailable at build time).
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

- [ ] **C1. `modules/frozen-plan/` — the frozen flight-plan module.** ★★★
  A module whose params ARE the flight plan captured at mission creation
  (departure state/epoch, arrival body/epoch, plan waypoints, v∞ at each end —
  decide the exact param schema against what E2 exports). `update()` emits the
  plan's ship-state downstream and, when its input (the departure tech's
  output) deviates from the plan, reports the deviation through **warnings**
  (never re-planning — the design doc's comply rule). Pure, Node-tested like
  the other modules; `modules/transfer-leg/transfer-leg.js` is the structural
  template (pure `computeLeg` + thin descriptor). This is core semantics —
  strongest model, Kim reviews the param schema.
- [ ] **C2. Plan-compliance card UI.** ★★
  The "PLAN REQUIRES / TECH DELIVERS" grid with ok/warn colouring and an
  assist box ("Short by 0.24 km/s — raise tip speed to ≈2.61"), rendered by
  the shell from C1's structured warnings (`values` already carries numbers —
  see `makeDiagnostic`). Extends `renderDiagBox`/`updateCard`
  (planner.js:479–523). Mockup: mock-a-phases.html:406–420 (departure),
  489–499 (arrival). Depends on C1.
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

- [ ] **D1. Ephemeris tab shell.** ★★
  A tab hosting the existing helio frame full-pane, its own date bar, its own
  sidebar. Reuses `buildHelioFrame` and the scaffold's pane/camera wiring
  almost verbatim. Depends on A1.
- [ ] **D2. Destination select + trajectory + waypoints.** ★★
  Port the SST's destination dropdown (`buildDestinationOptions`, SST:1093),
  departure setup, trajectory drawing, and the waypoint list sidebar
  (`buildWaypointList`, SST:1273–1345) with snap-to
  (SST:378–475: `snapTargetNu`, `timeToTrueAnomaly`, `snapTau`) and waypoint
  gizmos (`makeWaypointGizmo`, SST:275; rendering via the already-shared
  `Shared/sim/burn-widget.js`). The compute calls go through the same
  `computeLeg` maths the transfer-leg module uses where possible — don't fork
  the physics.
- [ ] **D3. Marker card + Free/Track/Target state machine.** ★★★
  The heart of the port. The mechanical layer is already shared
  (`Shared/sim/marker-card.js` — sprites, card skeleton, drag-slider,
  `refineApproach`, `phasingDays`, `followCrossing`); what ports is the SST's
  local orchestration: `setMarkerMode` (SST:816), `applyTargeting` — the
  Lambert re-solve (SST:761), `updateMarker` (SST:927),
  `updateDestinationMarker` (SST:848), `buildMarkerCard` (SST:888),
  `focusMarker`/`removeMarker`/`placeMarkerAtGlobalTime` (SST:1003–1035).
  Read `marker-card.js`'s header comment first — it documents exactly why
  this layer stayed local and what shape it has. Fiddly, stateful,
  behaviour-sensitive: strongest model, verify against the live SST page
  side by side.
- [ ] **D4. Approach rings (space + time).** ★★
  Port the orbit-proximity scan (`computeOrbitApproaches` + tier tables,
  SST:628–710) and the temporal-proximity ring. Ring mechanics are already in
  `Shared/sim/approach-markers.js`; the scan and tier tables move as-is.
  Needed by E1's gating.
- [ ] **D5. Click-to-place-marker picking.** ★★
  Screen-space nearest-sample picking on the trajectory (SST:1037–1078),
  adapted to the scissored-pane raycast context (`raycastPickPoint` config,
  planner.js:389–400).
- [ ] **D6. System switcher (Earth–Moon, Mars–Phobos ephemeris modes).** —
  **defer.** The design doc lists this as the one change from the current
  SST, but each system needs its own authoring loop (the Mars–Phobos marker
  slides a different chain shape — see marker-card.js's header). Recommend
  shipping the solar-system Ephemeris tab first and treating this as its own
  later package. Decision for Kim.

### WP-E — "Start Mission Plan" flow (stitches A+C+D together)

- [ ] **E1. Gated button on the marker card.** ★★
  "Start Mission Plan" at the bottom of the D3 card, enabled iff the marker
  sits inside **both** closest-approach rings (space AND time — D4's tier
  data); when disabled, it says why. Include waypoint copy-in note. Mockup:
  mock-a-phases.html:184–209.
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
