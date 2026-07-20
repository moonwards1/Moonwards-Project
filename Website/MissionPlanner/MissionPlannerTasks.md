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
independent improvements after E. **WP-I** (added 2026-07-15) is the
departure-system package — the Moon-Skyhook plotter port — and runs
I1 → I5 in order; it absorbs F5's departure half and pulls F1's departure
slot forward (as I5). **D7 precedes WP-I** (Kim, 2026-07-15): it authors the
freeze-time release anchor that I3 reads. I1/I2 are pure Shared work,
independent of that semantic, and may run in parallel with D7 if convenient.
**WP-J** (added 2026-07-17) lets a mission's departure system originate from
any body on the HELIO_BODIES list via a skyhook orbiting that body — no
satellite modelling needed. Follows WP-I; un-defers H1.

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
  **Revised 2026-07-14 (Kim):** the "+" tab is no longer inert — clicking it
  duplicates the ACTIVE mission tab (`planner.js`'s `duplicateActiveMission`,
  a `serialize()`/`deserializeWorld()` round-trip so the copy shares no live
  object with the original) into a new tab titled with a "(copy)" suffix
  (`nextCopyTitle`, bumping to "(copy 2)", … on a collision). Disabled-looking
  with the original tooltip while the Ephemeris tab is active, since there's
  no mission to copy there (`updatePlusTab`, called from `selectTab`).
  Verified in-browser: duplicating twice produced correctly-numbered
  "(copy)"/"(copy 2)" tabs with independent, persisted World data; the "+"
  tab correctly disabled (tooltip reverted, click a no-op) on the Ephemeris
  tab. Node suites (135, unaffected) green.
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
  **Fixed (2026-07-14):** the swap this entry called out above ("when C1
  lands, the right edge becomes the frozen plan's fixed deadline") had never
  landed — `departureSpan` only looked at live departure-tech flight events,
  so a freshly-created mission with no departure tech configured (zero
  events) fell straight to `return null` and the slider sat empty instead of
  showing anything. `departureSpan` now has a third tier below the two- and
  one-event cases: when no flight events resolve at all, it reads the frozen
  plan's own required v∞ out and fixed deadline (`plannedDeparture`, C1) and
  defaults the slider from those — RIGHT edge at the deadline, LEFT edge
  floated back by `departureDefaultSpanSeconds()`. That function itself now
  sources v∞ from the frozen plan (SOI_radius / plan v∞, the real figure
  imported with the mission) rather than a fresh Hohmann-dv1 guess, falling
  back to the old Hohmann estimate only for pre-comply saves with no frozen
  plan. The one-event (release-only) case keeps its existing LEFT-anchored
  shape, just fed by the same updated default-length function.
  Mockup: mock-a-phases.html:229–240 (departure). Depends on B2.
- [x] **B4. Core-data readout in the phase bar.** ★
   (Kim - I am redesigning this to instead be a floating readout of the time just below the handle on the timeline slider.) Frozen-plan summary (dates, flight time, v∞ out/in) + the shared clock, top-right of the phase bar. Pure DOM; data comes from the frozen plan (C1). Mockup: mock-a-phases.html:221–224.
  **Redesign delivered as B7 below.**
- [x] **B5. Events bar → per-phase filtering.** ★
  The flat events bar (planner.js:550–574) filters to the active phase's span
  and stays as the "click to set clock" affordance. Small once B1 exists. (Kim: I chose to change this bar to linear time. This task is obsolete, these matters will be handled differently.)
- [x] **B6. Shift/wheel fine-scrub on the date sliders.** ★★
  **Done 2026-07-14.** Every date-scrubbing slider in the chrome now supports
  two ways to fine-tune: holding Shift while dragging fine-tunes RELATIVELY
  from wherever the handle already is (no jump on the initial press), at
  10x-slower sensitivity; rolling the mouse wheel over the slider reaches the
  same 10x-slower rate without needing to hold Shift or drag at all — each
  wheel notch is treated as if the mouse had dragged that many pixels, scaled
  by the same 0.1 factor. Plain click/drag is unchanged (jumps to the cursor,
  tracks it 1:1).
  Landed in two places: `Shared/sim/date-bar.js`'s `enableShiftDrag` (the
  coarse/fine sliders behind every plotter's clock) already had a Shift-drag,
  just at 4x-slower — tightened to 10x and given the new wheel listener.
  Because this module is shared, the Solar-System/Moon-Skyhook/Mars-Phobos
  standalone plotters pick up the same improvement automatically, not just
  the Mission Planner chrome. `ui/phase-slider.js`'s `createSegmentedSlider`
  (the Coast/Departure playhead tracks, B2/B3) had no fine-scrub at all
  before this — ported the same relative-drag-plus-wheel model onto its
  custom div-based track (no native `<input>` to lean on), tracking the
  handle's own fraction internally (`currentFraction`, kept in sync with
  externally-driven `setPlayhead` calls — e.g. events-bar clicks — so a
  later Shift-drag or wheel-scrub starts from the true position, not a stale
  one). Verified in-browser (JS-dispatched pointer/wheel events against the
  live local server, both the Ephemeris date bar's coarse slider and the
  Departure phase slider): plain click still jumps 1:1; a Shift-press does
  not jump; a 500px Shift-drag and a 100-unit wheel tick both land on the
  exact expected 0.1x-scaled delta; wheel-scrub is proven to drive the real
  mission clock, not just the visual handle, via the events bar's `past`
  styling (which only changes off `world.jd`) updating correctly as the
  wheel moves the Departure slider through its event marks. Node suites
  (125, untouched — DOM-only) still green.
- [x] **B7. Floating playhead time readout (B4's redesign).** ★★
  **Done 2026-07-14.** `coastSliderState`/`departureSliderState` gained an
  optional `stampPlayhead(jd)` formatter (defaults to the existing tick
  formatter when omitted) and now return a `playheadLabel` string computed
  from the TRUE clock jd — unclamped, so the readout stays honest even when
  the handle itself is visually pinned at an edge because the clock has
  wandered outside the slider's span. `createSegmentedSlider`'s
  `setPlayhead(fraction, pinned, label)` grew the third argument and renders
  it in a new `.mp-playhead-label` child of the playhead div (so it inherits
  the handle's x-position for free), positioned below the tick-caption row
  (`.mp-sliderzone`'s bottom padding grown 22→40px to fit) with the same
  muted/pinned coloring the handle itself already gets. `mission-view.js`
  supplies a new `fullStamp(jd)` (month, day, year, HH:MM) to both
  `createCoastSlider` and `createDepartureSlider` — deliberately finer than
  either slider's own tick captions (Coast's ticks are month/year only;
  Departure's are day+time but no year), so the readout always shows exactly
  where the handle is regardless of what the ticks themselves can resolve.
  Verified in-browser: the readout updates live under a wheel-scrub, stays
  horizontally centered on the handle, sits clear of the tick-caption row
  with no overlap; on the Coast slider specifically, confirmed the readout
  shows full day/time precision ("Dec 21, 2031 02:27") even though Coast's
  own ticks only resolve to month/year ("Dec 2031"). Node suites (125)
  green — the pure functions gained a field; no existing assertion depended
  on the old exact shape.
- [x] **B8. Ship-marker chevron on the Coast trajectory.** ★★
  **Done 2026-07-14.** Ported the Ephemeris tab's ship "marker" chevron
  (Shared/sim/marker-card.js's `makeShipSprite`/`orientMarkerSprite`) onto
  the Coast leg — but adapted, not copied: the Ephemeris marker is a
  Free/Track/Target probe with its own slider and mode state; this one has
  no state of its own at all. Its position is simply wherever the shared
  mission clock (the phase-bar timeline slider) currently sits along the
  leg, so scrubbing the Coast slider (or Shift-dragging or wheel-scrubbing
  it, B6) moves the chevron with it directly — no separate control to keep
  in sync.
  **Position source:** `transfer-leg.js`'s `computeLeg` now also returns
  `jd0` and `segs` (each burn-to-burn segment's own starting r0/v0 and
  [tStart, tStart+dur) window, mirroring the Solar-System-Trajectory-
  Plotter's `trajSegs`/`stateAtGlobalTime` pattern flagged in marker-card.js's
  doc comment). The new pure, Node-tested `stateAtElapsed(leg, t)` re-
  propagates the TRUE two-body state (position AND velocity) at any elapsed
  time via `O.propagateState` — the drawn polyline's `samples` only carry
  position, not velocity, which the chevron needs to orient along the
  direction of travel. Clamps into the nearest segment at either end, so a
  clock outside the leg's own span (rare, since the Coast slider's own
  playhead already pins there) still resolves to a sensible state rather
  than null.
  **Wiring:** `draw(view, snap)` computes `t = (snap.world.jd - leg.jd0) *
  DAY`, calls `stateAtElapsed`, and (re)creates the chevron sprite fresh
  every draw — same rebuild-everything pattern the polyline/dots already
  use, now also disposing a removed child's texture (`material.map`) since
  the sprite is the first textured object in this group. Screen-facing
  orientation needs the LIVE camera, which `draw()` is never called with
  (module contract, shell-owned) — so `draw()` stores `view.chevron =
  { sprite, velDir }` (a stable slot on the persistent view object) and
  `mission-view.js`'s render loop re-reads it every animation frame,
  calling `orientMarkerSprite(frame.camera, ...)` before each render pass,
  so the chevron stays correctly oriented even when the camera moves
  without the clock moving.
  **Scope (Kim, 2026-07-14):** Coast only for now — Departure/Arrival get
  their own chevron once a trajectory exists to place it on (their own
  systems are frames/tech-specific, not this leg). transfer-leg's
  `rendersIn: ["helio"]` means this chevron is already visible whenever the
  helio frame renders, main or float, regardless of active phase — same as
  the leg's existing polyline/dots.
  Verified: Node suites (130, 5 new `stateAtElapsed` tests — t=0 matches
  the post-burn start state, t=legDays matches leg.end exactly, a
  mid-segment state agrees with a drawn polyline sample at the same t,
  before/after the span clamp to the nearest end, a malformed leg returns
  null) green. In-browser (local server, Coast phase): a `THREE.Sprite`
  constructor patch confirmed exactly one chevron sprite is created per
  draw, visible, textured, correctly parented into the leg's view group;
  wheel-scrubbing the (correctly-identified, visible) Coast track moved the
  sprite from ~1 AU out (near Dec 2031, just past departure) to ~2 AU out
  (Jun 2032, consistent with a Ceres-bound transfer roughly mid-flight) —
  confirming it tracks the clock along the real trajectory, not a fixed or
  stale point. `orientMarkerSprite` itself was verified in isolation
  (synthetic camera + velocity vectors along world +X/+Y resolved to 0°/90°
  screen rotation as expected) rather than live, since the automated
  preview tab reports `document.hidden = true` (not the focused tab) and
  Chromium throttles `requestAnimationFrame` for hidden tabs — the app's
  own render loop (and therefore the per-frame orientation call) doesn't
  run in that state. This is an artifact of the headless preview
  environment, not the app; a normal foregrounded browser tab doesn't hit
  it. Console clean throughout.
  **Fixed (2026-07-14): invisible in practice — Kim couldn't see it.** The
  first cut ported `orientMarkerSprite` but missed the OTHER per-frame call
  the Ephemeris marker relies on: its `updateGizmos()` also rescales the
  sprite every frame via `worldSizeAtPointForPx(camera, holder, pos, 26)`
  (Shared/sim/body-renderer.js), pinning it to a constant 26px on screen
  regardless of camera distance. Without that, `makeShipSprite()`'s fixed
  0.01 WORLD-space scale — combined with the helio frame's huge zoom range
  (6 AU default distance, 1e-4..500 AU min/max) — projected to roughly a
  single pixel at the default view: technically present, practically
  invisible, easily lost in the starfield. `mission-view.js`'s
  `updateChevrons()` now also calls `worldSizeAtPointForPx` (newly imported
  from body-renderer.js) every frame, sized against the main pane
  (`paneMainEl`) at the same 26px the Ephemeris marker uses. Verified with
  the tab actually focused this time (`document.hidden` had been the
  in-session giveaway, and turned out to be intermittent in the preview
  sandbox, not a permanent property of it — this pass caught it truly
  false, with `requestAnimationFrame` measured actively ticking at ~330fps
  over 2s): a live `THREE.Sprite`-constructor patch on the real running app
  showed the chevron's `.scale` at ~0.18 (versus the old fixed 0.01 — over
  10x larger, matching a hand-computed expectation of ~0.22 at 1 AU using
  the pane's real 596px height) and `.material.rotation` at a genuine
  nonzero live value (2.92 rad), confirming both the per-frame rescale and
  the orientation call are actually running and producing sane numbers, not
  just wired up. Console clean.
- [x] **B9. Playhead readout: "T+" elapsed time, two lines, touching the
  handle.** ★
  **Done 2026-07-14.** Kim: the B7 readout's absolute calendar date ("Dec
  21, 2031 02:27") was more than needed — briefer as elapsed mission time,
  split across two lines, with the label's border touching the handle's
  bottom edge rather than sitting in a gap below it.
  **Format:** `ui/phase-slider.js`'s new pure `elapsedStamp(jd, start)`
  (Node-tested — whole-day/midpoint cases, the elapsed-not-calendar-time
  distinction, a just-before-midnight edge, the minute-rounding carry into
  the next day, and a negative day count before `start`) replaces the old
  `stampPlayhead(jd)` formatter entirely — no caller-supplied formatter
  needed anymore, since it's pure day/time arithmetic on `jd - start`, not
  a calendar lookup. Both sliders already had a `start` that IS the
  departure/release epoch (Coast's span start; Departure's own span start
  IS launch), so no new epoch plumbing was needed. `mission-view.js`'s now-
  unused `fullStamp` helper was removed. Split into `{ days: "167 d", time:
  "14:32" }` — the time line is ELAPSED time-within-the-day (the fractional
  part of `jd - start`), not calendar wall-clock, so the two lines always
  agree regardless of what time of day departure itself began at.
  **Layout:** `createSegmentedSlider`'s playhead gained two child lines
  (`.mp-playhead-days` bold, `.mp-playhead-time` dim) inside
  `.mp-playhead-label`, `setPlayhead(fraction, pinned, daysText, timeText)`.
  In `planner.css`, `.mp-playhead-label`'s `top` moved from 44px to 34px —
  which, since it's positioned relative to `.mp-playhead`'s OWN box (spanning
  -4px to 30px in track coordinates per its top/bottom offsets), lands
  exactly on the handle's bottom edge rather than the 14px gap the B7
  version left. `.mp-sliderzone`'s bottom padding correspondingly shrank
  40px → 36px. Verified in-browser (both sliders, local server): the
  label's top edge sits exactly 0px from the handle's bottom (measured via
  `getBoundingClientRect`), with the section's own bottom edge only ~2.4px
  past the label's bottom (no overlap with whatever follows, negligible
  slack); "0 d"/"00:00" at the release event on both sliders, "267 d"/
  "18:00" at a scrubbed-forward clock (Departure correctly still pinned at
  its own edge while showing the same true unclamped elapsed time Coast
  shows unpinned — the B7-era "always show the true clock" behavior
  carried over intact); all three of the handle/days-line/time-line stay
  exactly centered on the same x. Node suites (135, 5 new `elapsedStamp`
  tests) green. Console clean.

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
  **Trimmed 2026-07-14 (Kim):** removed the `burn` field from both
  frozen-plan's and transfer-leg's param schemas entirely — Kim: "only a
  minority of the delta-v needed to get somewhere comes from engine burns,"
  so the Departure→Coast hand-off is a given heading and speed, not a burn
  formula; the same reasoning applies at Coast→Arrival. It had already been
  reduced to an always-zero reference copy by E2's post-burn hand-off
  (`planSummary`'s own comment already said as much), so nothing but the
  shipped preset (which predates E2 and still carried a genuinely non-zero
  leg burn) actually needed it — and that vestigial field is exactly what
  let a pasted copy of that preset silently lose its injection burn on the
  way back into the Ephemeris tab (see E2's entry). `core/freeze.js` no
  longer writes a `burn` field into either output stage;
  `presets/default-mission.js` is migrated to fold its old separate
  leg-side burn directly into `departure.v` (header comment updated with
  the new true departure v∞, 6.55 km/s). **Consequence surfaced, not
  papered over (Kim's call):** the shipped skyhook's own unchanged release
  physics only delivers 5.50 km/s, so the preset now HONESTLY shows
  `vinf-mismatch`/`aim-mismatch` warnings on the plan stage — it no longer
  complies with itself. The coast still flies the frozen plan's state
  regardless (the comply rule, unchanged) and still rendezvouses with
  Ceres exactly as before; only the tech's own compliance is now honestly
  short, since no departure-phase tech yet models that extra burn (WP-F).
  Tests updated to match across `modules/tests/modules.test.js`,
  `modules/tests/frozen-plan.test.js`, and `core/tests/freeze.test.js`.
  Verified: numerically first (a scratch Node script comparing
  `computeLeg`'s own segment states bit-for-bit between the real preset
  and a from-scratch reconstruction — 0 m position difference), then all
  135 Node tests green, then in-browser (a genuinely fresh tab, to rule
  out a stale bfcache'd/cached module graph from earlier in the session):
  the compliance bar correctly reads `compliance unmet`, `v∞ out 6.55 km/s
  → 5.50 km/s`, with the coast still ending 0.0001 AU from Ceres; pasting
  the (now-migrated) preset's own link into the Ephemeris tab still
  reconstructs the identical burn/waypoints/750-day rendezvous via the
  now-simpler `loadFrozenPlanIntoState` (the two-burn fold-in workaround
  it needed immediately after E2 is gone — there's only one burn to
  reconstruct from now, always). Console clean throughout.
  **Corrected framing (2026-07-14, Kim):** this entry's own language above
  ("reconcile," "fold-in workaround," "two-burn trap") describes the bug
  using the wrong mental model, and Kim called it out directly rather than
  let it stand uncorrected. There was never anything to reconcile: a phase
  is an ordinary stage chain of any length (one event or a thousand) that
  composes in strict sequence to one end state; a phase boundary (this
  module) carries exactly one requirement, and compliance is a single
  comparison of that end state against it — never a peer comparison
  between the individual events that produced either side. The actual bug
  was simpler than "reconciling" implied: transfer-leg's old `burn` field
  was an event living on the WRONG SIDE of the Departure→Coast boundary,
  invisible to the one comparison frozen-plan makes — the fix was to move
  it to the correct side (fold it into what composes the departure
  requirement), not to add a second comparison. Written up properly in
  ARCHITECTURE.md's new "Phases are chains; compliance is a boundary check,
  not a reconciliation" section, and in frozen-plan.js's/transfer-leg.js's
  own headers — read those for the durable version, not this note.
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
  **Reshaped again (2026-07-13, Kim — first step of a staged redesign, more
  to come):** the bar now reads `[compliance met/unmet chip] · v∞ in ·
  epoch · flight time · v∞ out · plan Δv`, where v∞ IN/OUT are named from
  the FLIGHT PLAN's point of view (in = leaving the origin's SOI, i.e. the
  required departure v∞; out = reaching the destination's SOI, the arrival
  commitment), epoch is the flight-start date, and **plan Δv = v∞ in +
  v∞ out + waypoint burns** (planSummary reworked accordingly; the old
  planDv, departure-burn + waypoints, removed — frozen legs carry a zero
  departure burn since E2). The `aim` readout is dropped from the bar
  (maybe the marker card later; its warning still flows through the
  envelope, and computeCompliance still measures it). "No departure tech"
  now reads as plain `compliance unmet` too; the demand figures (all but
  flight time, which is a fact and stays neutral) render AMBER while unmet,
  green when met. Same commit: the **Coast sidebar** is stripped to just
  the waypoint burns — one small card per waypoint plus "+ add waypoint"
  (transfer-leg's burn/duration/destination fields and readout rows
  removed; those are the frozen plan's business now, shown in the bar) —
  via a new `plainCard` descriptor flag (no title/status header;
  diagnostics still render). Verified in-browser both ways: the preset
  shows `compliance met` green with v∞ in 5.50 / epoch 2031-12-20 / flight
  time 750 d / v∞ out 3.78 / plan Δv 12.94 (= 5.50+3.78+3.66 ✓) and its
  day-475 waypoint card + add button; a spawned tech-less mission shows
  `compliance unmet` amber with amber demands, neutral flight time, plan
  Δv 6.09 (= 2.94+2.65+0.50 ✓), waypoint remove → button-only sidebar →
  re-add all working through world.set; console clean. Node suites: 141
  green (planSummary tests replace planDv's).
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
- [ ] **C5. Hand-off Δv gap: log it; later, correct it in coast.** ★★ —
  **future refinement (Kim, 2026-07-15).** When the departure leg's delivered
  hand-off differs from the frozen plan's — in exactly WHEN and HOW the
  hand-off happened (epoch inside the window, v∞ vector inside tolerance,
  but not exact) — that difference implies a small Δv cost somewhere
  downstream. Two steps, both deferred: (1) LOG the implied Δv gap whenever
  it exceeds a 10 m/s floor (the existing v∞ tolerance doubles as the
  cutoff — below it, ignore); (2) once the app is more polished, let the gap
  be "made up somewhere": an explicit course-correction impulse in the COAST
  phase, rolled into the existing coast-waypoint mechanism (not new
  machinery), informed/sized by the logged gap. Depends on I3 (needs a real
  integrated hand-off to measure).

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
- [x] **D7. Moon indicators in the Ephemeris tab + the freeze-time release
  anchor.** ★★★ — **now load-bearing; design with Kim, then build BEFORE
  WP-I** (Kim, 2026-07-15 — upgraded same day from an advisory indicator to
  the thing that AUTHORS departure timing; see WP-I's timing-model bullet).
  **Done 2026-07-16** (same session as the design conversation). What
  landed, in dependency order: (1) `OrbitalMath.soiExitTimeDirect` /
  `soiExitTimeDive` in Shared/math-utils.js — the two course-profile
  crossing times, thin exact compositions over `coastTimeToRadius` (4 new
  Node tests pin 1.75 d / 2.58 d at v∞ 5.50 km/s and the null cases).
  (2) New pure `core/departure-estimate.js` — `estimateDeparture` (the
  quarter-switched Earth estimate + naive non-Earth fallback; the dive
  criterion is the geometric sign test, evaluated in the two bounded
  passes), `estimateArrival` (the direct-profile inbound mirror),
  `moonElongationDeg`, `moonProgradeSpeed`, with its own suite
  (`core/tests/departure-estimate.test.js`, 10 tests — the quarter-rule
  cases scan the REAL ephemeris for quarter dates and use Earth's real
  prograde, no mocked Moon; one genuine bug caught here: orbit.js resolves
  `orbit.system` to the parent System INSTANCE, so the "heliocentric
  origin" check is an identity comparison, not a string). (3) freeze.js
  bakes `handoffWindowDays` (default ±1, spec-overridable) and
  `releaseAnchorJd` (hand-off − the estimate; = hand-off itself for a
  waypoint-only plan) into the frozen-plan params — pre-D7 saves simply
  lack the fields and consumers will default them (+2 freeze tests, one
  cross-checking the anchor against the estimator module itself).
  (4) The widget in ephemeris-view.js (`buildMoonWidget` + per-refresh
  `updateMoonWidgets`) + `.mp-moonwidget*` CSS: SVG glyph (limb +
  half-ellipse terminator, rx = R|cos e|, waxing lights the right side),
  relative-speed pill (±1 km/s ticks at the 10/50/90% marks,
  center-anchored teal fill, exact value in the tooltip), days pill (1–5
  scale, estimate + assumed profile in the tooltip, >5 d clamps with a
  note); mounted under the origin's info line and mirrored under the
  destination's ("Moon phase at arrival", readouts at the CATCH date,
  "days to cross system"), each shown only while that body is Earth. With
  no impulse authored yet the glyph/speed read at the tab's clock and the
  days bar idles with an explanatory tooltip.
  **Verified:** 167 Node tests green (all suites). In-browser on the local
  server via DOM/JS introspection with hand-checked numbers (pixel
  screenshots unavailable — the sandboxed preview's `document.hidden`
  condition documented throughout WP-D/E): idle state at 2030-01-01 reads
  elongation 318°/−0.80 km/s, matching a Node ground-truth run exactly; a
  5.5 km/s prograde impulse → "1.75 days (direct-out course assumed)",
  readouts shifted to the ESTIMATED LAUNCH date, not the clock; clock
  moved so launch lands on a first-quarter Moon → "2.58 days (dive-in
  course assumed)" with the relative-speed bar reading ~0.10 km/s — the
  predicted bar≈0-at-the-dive-quarter coherence, observed live; origin
  Mars hides the widget; the arrival mirror verified through the REAL
  paste-mission-link path (a hand-frozen Mars→Earth world fed to the paste
  dialog placed the marker and lit "Moon phase at arrival" with sane
  figures); computed styles confirm the sketch's tan/teal pill rendering
  with both fills geometrically contained; console clean throughout.
  Since the Moon card is frozen inside a mission, the Ephemeris tab is where
  a user plans AROUND the Moon.
  **Widget (Kim's sketch, 2026-07-16):** a "Moon Phase at launch" block that
  appears under the body's heliocentric-speed text whenever EARTH is the
  chosen origin (or destination — the arrival mirror). Three elements:
  (1) an animated Moon-phase GLYPH showing the net phase at the estimated
  launch (= hand-off clock − the SOI-exit estimate below), cycling as the
  date/plan changes — no three.js needed: an SVG disc whose terminator is a
  half-ellipse with rx = R·|cos(elongation)| renders the FULL cycle
  including gibbous and crescent (confirmed 2026-07-16), driven by the
  Moon–Sun elongation (`eclipticLon(moonVector) − eclipticLon(sunVector)`,
  both already in `Shared/lunar-ephemeris.js`) — crisp, cheap, and avoids
  spending a second WebGL context; (2) a **"Relative speed, km/s"** bar
  (−1 … +1): the component of the Moon's geocentric velocity along EARTH'S
  OWN HELIOCENTRIC PROGRADE at the estimated launch (Kim, 2026-07-16 —
  educational framing, NOT the plan-heading projection: it shares the
  waypoint gizmo's prograde axis, which this setting also uses for the
  departure impulse, so a prograde launch with the Moon reading negative
  visibly subtracts from the total, and a retrograde launch sees the same
  sign convention along its negative axis); (3) a **"Days to leave
  system"** bar showing the SOI-exit estimate (sketch scale 1–5 d; note
  low-energy plans exceed it — dive-in at v∞ 1 km/s is ~7.9 d — so the
  scale should clamp or adapt; implementer's discretion).
  **The SOI-exit estimate (settled by Node experiment, 2026-07-16):** a
  two-body hyperbolic coast needing only the plan's v∞ + constants,
  replacing the naive `departureDefaultSpanSeconds()` (RSOI/v∞). Two
  course-profile variants, both built from `O.coastTimeToRadius` on a
  perigee state (two-body time symmetry): DIRECT-OUT (tangential from mean
  lunar distance) and DIVE-IN (drop to a ~200 km perigee Oberth pass, then
  out = t(perigee→dMoon) + t(perigee→RSOI)). Measured at the preset's v∞
  5.50 km/s: naive 1.95 d, direct 1.75 d, dive-in 2.58 d vs the chain's
  real 2.56 d — and the default skyhook release genuinely dives (geocentric
  perigee 24,200 km vs the Moon's 372,800 km).
  **Profile selection (Kim, 2026-07-16): switch by Moon quarter** — dive-in
  is NOT the usual best move; it depends on whether the user wants the
  Moon's speed boost, an Oberth plane change, or neither (a fixed launcher
  supplying all the needed v∞ favours a lighter ship over a Moon boost).
  The rule: DIVE-IN when the Moon is near FIRST quarter for a prograde
  launch, or near LAST quarter for a retrograde launch; DIRECT-OUT near
  full/new and at the opposite quarter (a launch there immediately moves
  away from Earth; a user who dives anyway is left to the ±1 d window —
  "hope for the best"). Geometric verification + implementation note:
  first quarter puts the Moon at Earth's anti-apex (trailing its orbital
  motion), so a prograde exit from there must cross Earth's vicinity — a
  flyby — which is why it's the dive-in quarter; the general criterion is
  the SIGN of dot(Moon position, exit heading) — Moon on the far side of
  Earth from the exit ⇒ dive-in. That reproduces Kim's quarter rule
  exactly for pro/retrograde launches and generalizes to arbitrary
  headings; the widget still SPEAKS in quarters (educational), the
  criterion just decides. Pleasing coherence: the relative-speed bar reads
  ~0 at precisely the dive-in quarters and ±max at full/new — the two
  indicators tell one story. Evaluation is TWO bounded passes, not
  iteration: tentative direct-out date → quarter/geometry check → profile
  → final estimate (the ~0.8 d profile spread moves the Moon ~10°, which
  rarely flips the classification). Scratch script:
  scratchpad/soi-time-estimators.mjs (session 2026-07-16), to be reborn as
  the Node tests when this builds.
  **Freeze-contract additions** (decision 5's review applies): the hand-off
  WINDOW (default ±1 d, agreed 2026-07-15) and the read-only RELEASE ANCHOR
  (hand-off − the same estimate the widget presented).
  Re-planning around a different Moon stays the copy-link → paste-into-
  Ephemeris → tweak → new-plan flow — never a release-date knob inside a
  mission. Possible design ingredient: the Moon-Skyhook plotter's "lock
  Moon phase" scrub behaviour (MSK:1590–1656 — the year slider snaps to
  equal-elongation dates).

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
- [x] **E2. Freeze + spawn.** ★★★
  **Done 2026-07-13**, with two scope additions from Kim at kickoff: the
  marker card should ALWAYS exist in the 3D pane (not only once a marker is
  placed), and there was no way to *paste* a copied mission link — so E2
  built one shared "spawn a mission tab" back half with two front doors,
  both on that card. **Freeze contract** (`core/freeze.js`, pure +
  Node-tested — the C1↔D contract the task called for): profile
  `[frozen-plan, transfer-leg]`, NO tech stage (C1's `inputOptional` makes
  the empty slot a `no-departure-tech` warning); frozen-plan gets `origin`,
  `departure { r, v, jd }` = the origin BODY's own helio state at the tab's
  clock (pre-burn), `arrival { body, jd, vInf }` from the marker's
  rendezvous (its path time → epoch; its velocity against the destination
  body's → v∞ in), plus reference copies of the departure burn and the
  RESOLVED waypoint days (snaps made concrete); transfer-leg gets working
  copies and `legDays` = the rendezvous time. Waypoints at/after the
  rendezvous are dropped (they never shaped the flight to arrival), the
  rest sorted chronologically.
  **Redirected same day (2026-07-13, Kim) — the hand-off is POST-burn:**
  the first cut froze the PRE-burn body state (departure burn kept as the
  leg's burn), which made the requirement a degenerate "arrive co-moving
  with Earth, v∞ 0" — no direction for the aim comparison, and nothing a
  real tech could meaningfully be measured against. Kim: the tech should
  hand the ship off ONTO the mission's coast trajectory — required v∞ is
  "the speed demanded by the departure burn." So `freezeMissionWorld` now
  applies the authored burn to the origin state itself (same `O.applyBurn`
  call/argument order as computeLeg's injection): frozen `departure.v` is
  the post-burn hand-off, required v∞ = the injection's magnitude with a
  real asymptote direction, and BOTH burn copies (plan reference + leg
  working) are zeroed — the injection is the tech's job in the frozen
  mission; the ship's own commitments are the waypoint burns (so the phase
  bar's "plan Δv" now reads onboard Δv only). This also matches how the
  shipped preset was baked (its frozen departure is the skyhook hand-off).
  A waypoint-only plan (no departure burn) still legitimately freezes to
  required v∞ 0, which exposed a latent NaN in frozen-plan's aim row
  (`vUnit` of a ~zero vector): computeCompliance now skips the angle when
  either v∞ vector is ~0 (the magnitude row still reports the mismatch),
  with a Node test pinning it. Node suites: **140 green** (3 more beyond
  the first cut's 137). Re-verified in-browser (same hook-driven Earth→Mars
  scenario): the frozen world now carries zeroed burns on both stages and
  the post-burn departure velocity; the spawned tab's events read "Plan
  departure — v∞ 38.87 km/s" (was 0.00) with NO departure-burn event, the
  compliance bar's plan Δv reads 0.00 (onboard only), and the leg still
  ends 0.000 AU from Mars — identical trajectory, re-attributed. Console
  clean, hook removed, final reload clean.
  **Flow:** Start Mission Plan (E1's gate, unchanged) → name dialog
  (mockup:513–523; `.mp-dialog*` CSS lifted from it; suggested name via
  `defaultMissionTitle`, "Earth → Mars 2030" style) → `freezeMissionWorld`
  → planner.js's new `spawnMissionTab` (`nextMissionId` + the same
  `makeMissionView` the initial load now uses) → tab selected, store saved.
  Spawned missions open on `defaultMain: "helio"` (no departure tech to
  look at yet, so Coast is the phase with content). **Paste mission
  link…** (same card, same dialog): new `ui/share-link.js` (pure,
  Node-tested) parses a full URL / `#mission=` tail / bare fragment and
  unpacks a title-carrying envelope (`packMissionLink`) that "Copy mission
  link" now encodes — imports arrive with their real name instead of
  "Imported mission" (titles live at shell level, so `createMissionView`
  gained an optional `getTitle` and planner passes a live lookup);
  pre-E2 bare-world links still load, and decode/deserialize failures show
  their reason in the dialog instead of closing it. In-page paste also
  fixes a real gap: pasting a share link into the address bar of an
  already-open planner fires only a hashchange — `initialMissions()` runs
  at load — so nothing happened before. **Card restructure:** `buildCard()`
  runs at init; with no marker the card carries `.mp-empty` (planner.css
  hides slider/modes/rows/budget/✕ and shows the old hint-card text, which
  now lives inside the card) plus the always-explained Start button and
  Paste — `updateStartMissionButton` gained the no-marker reason.
  planner.html's stale D3/E1/E2 comments and the sidebar note updated.
  **Verified:** 137 Node tests green (12 new — `core/tests/freeze.test.js`:
  deserializes, copies-not-refs, waypoint sort/filter, self-compliance
  with required v∞ ≈ 0; `ui/tests/share-link.test.js`: envelope
  round-trip, bare-world/garbage/newer-version handling, fragment
  extraction). In-browser on the local server — the Browser pane was again
  backgrounded (`document.hidden`, no rAF; same environment condition as
  D5/E1), so verification drove REAL code paths via dispatched events/JS
  introspection plus the same temporary `__mpEphDebug` hook (removed
  after): the empty-state card renders correctly (computed styles
  checked); paste round-trip spawns/persists/selects a tab, both error
  paths show friendly reasons; a genuine Earth→Mars Target-mode rendezvous
  (Δv 38.87 km/s under a 40 budget, phasing −0.0 d) enabled the gate and
  froze into a mission whose stored world carried exactly the expected
  stages/params, with the spawned tab rendering live (Coast active,
  compliance bar "no departure tech" + flight time 250 d / v∞ in
  24.73 km/s / plan Δv 38.87 km/s, events plan-departure→plan-arrival, leg
  ending 0.000 AU from Mars); Copy-mission-link on the spawned tab →
  paste-back arrived with its real title; test tabs closed clean; console
  clean throughout, including a final reload after removing the hook.
  Depends on C1, D3/D4, E1.
  **Revised 2026-07-14 (Kim):** "Paste mission link…" no longer spawns a tab
  directly — it decodes the link locally (`ephemeris-view.js` now imports
  `deserializeWorld`/`decodeFragment`/`unpackMissionLink`/`missionFragmentFrom`
  itself; `planner.js`'s `onImportMission` callback is gone) and hands the
  World to new `loadFrozenPlanIntoState(world)`, which reads the
  frozen-plan/transfer-leg stages' own params back into this tab's
  scratchpad (origin, destination, burn, waypoints) and places the marker at
  the frozen rendezvous — so a shared mission can be revised here before
  Start Mission Plan freezes it into a new tab, same as anything authored
  from scratch. The departure burn isn't stored directly (freeze.js bakes it
  into the post-burn hand-off state) so it's recovered by decomposing
  `departure.v` minus the origin's natural velocity with `O.burnComponents`
  — the exact inverse of the `applyBurn` call freeze.js made. Waypoint
  snap-to intent doesn't survive the round trip (already resolved to a
  concrete day before freezing) — restored waypoints land unsnapped at
  their frozen day. The paste dialog's field also now autofills from the OS
  clipboard as soon as it opens (`navigator.clipboard.readText`,
  best-effort — a new `dlg.setValue` lets the async read reach the
  still-open dialog; silently stays blank without clipboard permission).
  Verified in-browser: a synthetic frozen link (Earth→Mars, hand-built via
  `core/freeze.js` + `ui/share-link.js` + `Shared/exchange.js` in the page
  console) loaded with origin/destination/burn/waypoint values matching the
  source spec exactly (burn km/s components round-tripped to the original
  authored values) and the marker landed at the correct 250-day rendezvous
  (TOF readout "250 d"); the Ephemeris tab stayed active with no new mission
  tab created; a garbage paste and a valid-but-planless world both kept the
  dialog open with a friendly reason. Node suites (135, unaffected —
  browser-only change) green. Clipboard read/write both throw
  permission-denied in the sandboxed preview browser used for this
  verification (an environment limitation, same class as the
  `document.hidden` rendering gap noted throughout WP-D/E) — the
  autofill's own try/catch handles that silently, by design.
  **Fixed (2026-07-14, Kim): the loaded trajectory was wrong for the
  shipped preset specifically** — pasting its own "Copy mission link" back
  into the Ephemeris tab drew a coast that quietly missed Ceres by ~2.7 AU
  by day 750, despite the departure state loading correctly. Root cause: a
  frozen-plan's `departure.{r,v}` and its sibling transfer-leg's `burn` are
  not independent — `computeLeg` applies the leg's burn ON TOP of
  `departure.v` to get the real coast-starting velocity. For anything
  core/freeze.js produces that leg burn is always zero (the post-burn
  hand-off IS the whole point), so the first cut of `loadFrozenPlanIntoState`
  read only `departure.v` and never even looked at the leg's own burn field.
  The shipped preset, though, predates that convention: it bakes
  `departure.v` as the raw skyhook-release state and carries a genuinely
  non-zero transfer-leg burn (P1.07/R0.49/N0.28 km/s) on top of it — exactly
  the "two frozen-plan eras coexist" gap the codebase never fully migrated
  (see this file's own header note on line-number drift for how the preset
  predates several later conventions). The fix applies transfer-leg's burn
  to `departure.{r,v}` FIRST — replicating computeLeg's own first step
  exactly — before decomposing the total velocity change relative to the
  origin body's natural state (this tab's only editable-burn reference);
  for an E2-frozen mission (leg burn zero) this reduces to exactly the
  prior behavior, so the common case is unaffected. Verified numerically in
  Node first (a scratch script comparing `computeLeg`'s own segment states
  bit-for-bit between the real preset and the reconstruction — 0 m
  position difference after the fix, versus 2.7 AU before) and then
  in-browser: pasting the real preset's own link now reproduces its
  documented figures exactly (time of flight "750 d", arrival date
  "2034-01-08", phasing "+0.0 d", Start Mission Plan gate enabled), and the
  Earth→Mars zero-leg-burn regression case still reconstructs its burn
  identically to before. Node suites (135) green throughout.
- [x] **E3. Ephemeris tab reset.** ★
  "Delete marker and start fresh" on the Ephemeris tab after a mission is
  spawned (the design doc's flow). Mostly calls D3's `removeMarker`.
  **Interface (2026-07-15):** the marker card's corner "✕" is now a "Reset"
  text button beside the "Marker" title — `Shared/sim/marker-card.js`'s
  `buildMarkerCard` gained optional `removeLabel`/`removeTitle` opts
  (default unchanged: "✕" / "remove marker"), so the Solar-System and
  Mars-Phobos plotters' own corner "✕" is untouched; only
  `ephemeris-view.js`'s `buildCard()` passes `removeLabel: "Reset"`,
  `removeTitle: "Delete marker and start fresh"`. `planner.css`'s
  `.mp-marker-x` was restyled from a small square icon button into a
  bordered text button (still hidden by the existing `.mp-empty` rule until
  a marker is placed). Verified in-browser: pasted a mission link into the
  Ephemeris tab to place a marker (clipboard read/write blocked in the
  sandboxed preview, same limitation noted elsewhere in WP-D/E — worked
  around by intercepting `navigator.clipboard.writeText` to capture the
  "Copy mission link" output, then feeding it to the paste dialog), the
  card showed the "Reset" button with the new tooltip, and clicking it
  cleared `state.marker`, restored the `.mp-empty` state, and showed the
  "Marker removed — click the drawn trajectory to place a new one." hint.

### WP-F — Tech cards: load, configure, exchange

- [x] **F1. Tech dropdown per endpoint slot.** ★★
  A "Departure technology" / "Arrival technology" card with a dropdown
  (mockup:383–392, 467–476); choosing one dynamic-imports the module and
  `world.set({swapStage, moduleId, params})`. The registry and dynamic-import
  pattern already exist (planner.js:62–68). Greyed "(future)" options for
  unbuilt tech.
  **Done 2026-07-17, departure only** — Arrival has no frame/phase yet
  (`PHASE_FRAME` in mission-view.js omits "arrival" until H1+H2), so an
  "Arrival technology" dropdown has nothing real to select; only the
  Departure slot was built. New `MissionPlanner/ui/tech-options.js`:
  `DEPARTURE_TECH_OPTIONS` (id, label, `bodies`, `moduleId`+`moduleUrl` if
  built else `future: true`) and `techOptionsFor(body)` — follows the "body"
  convention decided the same day ([[project_body_convention]]): entries are
  body-tagged, not hardcoded to the Moon, though today only Lunar skyhook is
  built and everything else (Moon-L1 elevator, lunar mass driver, chemical
  direct) is a disabled "(future)" option. mission-view.js: the "tech" stage
  is identified structurally (accepts AND emits `carrier-chain` — today just
  lunar-skyhook) rather than by name, and the dropdown's body filter reads
  the base-platform stage's already-computed `carrier-chain.base` (accepts
  nothing, emits `carrier-chain` — moon-platform) rather than assuming
  "Moon". The mount-time stageViews/card-building loops were factored into
  `buildStageViews`/`disposeStageViews`/`buildCard`/`disposeCard` so the
  dropdown's `swapDepartureTech` can tear down and rebuild ONE stage's view +
  card in place (disposing the outgoing module's views before `world.set`,
  so its `viewRemoved` still runs against what it built; building the
  incoming module's views/card against the freshly-committed params after,
  then replaying the engine's already-computed result onto them by hand —
  see the function's own header comment for the full ordering rationale).
  `lunar-skyhook.js`'s incoming-base check (added the same day) means a
  future non-Moon carrier swapped in here would fail with a diagnostic
  rather than silently misapplying Moon's GM/radius. Verified live via the
  preview pane: the card renders between "Moon (platform)" and "Lunar
  skyhook" exactly as the mockup lays it out, shows the one built option
  selected plus three correctly-disabled "(future)" options, re-selecting
  the active option is a no-op, and the rest of the departure card/trajectory
  is unaffected — no console errors. Node suite still 154 green (this touches
  no pure-logic files besides the new tech-options.js). **Not yet verified
  live: swapping to an actually different built module** — there is only one
  real departure tech today, so the dispose/rebuild path's cross-module
  behavior will get its first live exercise whenever a second one (e.g. a
  Moon-L1 elevator or a placeholder chemical-direct module) is built.
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
  **Departure half absorbed into WP-I (2026-07-15)** — I1 ports the physics,
  I3 gives the departure phase its integrated leg, I4 builds the waypoint
  UI. What remains of F5 is the ARRIVAL-system half, which waits on H2.

### WP-G — In-scene interaction in mission tabs

- [ ] **G1. Drag waypoints along the trajectory (Coast).** ★★★
  Design: adjust a waypoint by dragging it along the leg. Needs pane raycast →
  nearest-path-point (D5's picker) → transient `world.set` during the gesture
  (the World API already supports transient sets for undo-coalescing) →
  commit on release. First real gizmo-drag in the shell; do after D5. (Comment from Kim: Dragging waypoints must keep arrival point intact, so app must autocompute burn, or restrict manipulation so it doesn't move arrival - restricting it to one axis at a time, perhaps, and it autocomputes the other two? And dragging along the trajectory causes recompute of all three axes?)
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

- [x] **H0. Coast feels every body's gravity; panes carry orientation
  context.** ★★★ **Done 2026-07-18** (Kim: "the gravity of the body is
  absolutely critical, it isn't possible to set up rendezvous without it.
  Revise the code to include it for all bodies, and to show the orbits of
  the bodies").
  **Physics:** `transfer-leg`'s `computeLeg` is Kepler EXCEPT inside a
  body's SOI: a coarse-grid + refined closest-approach scan over every
  `systems` body with a heliocentric orbit finds SOI entries; the flight
  switches to `Shared/body-leg.js`'s new `integrateEncounter` (the
  arrival-side mirror of `integrateTrajectory` — body+Sun RK4 with the
  indirect term, helio in/out via `frames.js`) and resumes Kepler at exit.
  Branches: exit (flyby, deflection events), surface entry (the coast
  truncates with an `impacts-body` warning), time (a leg may END
  mid-encounter; the honest inside-SOI state is emitted). PATCHED-CONIC
  ORIGIN RULE: a body the arc STARTS inside of is ignored until first SOI
  exit — the plan's frozen departure states live at the origin body's own
  position with v∞ folded in (frozen-plan), so the origin's gravity is the
  departure stage's business, never re-applied by the coast; a stretch that
  starts inside an SOI because the PREVIOUS stretch ended mid-encounter
  (waypoint burn inside, or the overrun) resumes that encounter
  (`insideBody` threading). Timeline gains "X SOI entry — v∞", "X closest
  approach — <alt> km", "X SOI exit" / "Impacts X" events; the shipped
  Ceres mission now shows its real encounter (entry at v∞ 3.78 km/s,
  closest approach 17,198 km). `stateAtElapsed` handles the typed segs
  (Kepler re-propagation | integrated-trail interpolation).
  **Overrun:** the drawn polyline continues DIMMER past the leg end
  (min(60, 10% of legDays, ≥15) days, through any in-progress encounter) so
  the path past the destination reads as a pass — display only; the emitted
  hand-off state stays at legDays (phases stay chains). The Ephemeris tab
  already extends its arc via `finalCoastDays` and inherits the encounter
  physics through `computeLeg` unchanged.
  **Scene:** `buildBodyFrame` gains a labelled Sun marker along the true
  Sun direction and the local stretch of the body's own heliocentric orbit
  drawn through the origin (rebuilt as the clock moves — the Earth-Moon
  frame's Moon-ring pattern); `buildEarthMoonFrame` gains the same Sun
  marker. (The helio pane has drawn every body's orbit ring since D1.)
  Verified: suite 224 green (+12: integrateEncounter flyby-deflection /
  impact / time-limit / at-surface, computeLeg bent-vs-Kepler, wide-miss
  Kepler-to-the-metre, impact truncation, overrun span); in-browser the
  preset boots clean, waypoint drags recompute in ~17 ms/tick, and
  off-target drags drop the encounter events honestly.
- [ ] **H1. Generic body-local frame factory.** ★★
  `buildEarthMoonFrame` (planner.js:193–273) generalized to
  `buildBodyFrame("Ceres")` etc. (hero sphere, label, lighting, ring as
  applicable), so Arrival can show the destination system. Prerequisite for
  H2 and for the design's "destination body in the main pane".
  **Deferred (Kim, 2026-07-15)** — not needed for WP-I (the Earth–Moon frame
  already exists); revisit when H2 gets picked up. Scene-fidelity upgrades to
  the Earth–Moon frame (textures, SOI shells, node-split orbit arcs,
  double-click focus — all present in the Moon-Skyhook plotter) are likewise
  deferred and are NOT part of WP-I.
  **Un-deferred 2026-07-17 (Kim)** — needed for WP-J (generic departure
  origin) as well as Arrival: a departure from any HELIO_BODIES body needs
  its own hero-body frame, with the skyhook's own drawn orbit ring standing
  in for the "moon" ring (no real satellite ephemeris involved). WP-J's J1
  IS this task, cross-referenced there, not duplicated. Still unbuilt as of
  this note; the scene-fidelity deferral above still holds.
- [ ] **H2. A first arrival module.** ★★★ — **decision for Kim.**
  The Arrival button stays disabled until an arrival-capable module exists.
  Options: (a) a minimal "chemical capture burn / intercept check" module now
  (small, unblocks all Arrival UI work: C2's arrival card, B3's arrival
  slider, F1's dropdown), then (b) the real Ceres-elevator catch port as
  planned in migration step 4.5. Recommend (a) then (b). 
  - Comment from Kim: How about using the Mars-Phobos skyhook as the first model where catch planning can be structured?

### WP-I — Departure system: carrier chain + integrated geocentric leg (the Moon-Skyhook port)

Added 2026-07-15 from a design conversation with Kim. This package delivers
"work with the full Earth–Moon system as modelled in the Moon-Skyhook plotter
inside the Mission tabs," and absorbs F5's departure half. The agreed shape:

- **Carriers vs trajectory.** The departure tech stack is a chain of CARRIER
  stages — moving platforms that each contribute heading and impulse without
  yet producing a trajectory. The Moon itself is the top card (~1.02 km/s of
  geocentric velocity plus position — today invisible, buried inside the
  skyhook's math), then up to 2 further carriers: the skyhook, and later a
  tip spin-launcher riding the tether tip (Tip-Spin-Launcher-Calculator's
  model). A trajectory exists only once something is released.
- **Kinematic chain.** One serializable data shape — a base body plus a list
  of rotating elements (pivot on the parent, plane/axis, radius, rotation
  rate, phase at an epoch) — with one pure Shared evaluator returning
  position + velocity at any jd by composition. `update()` evaluates it at
  the release epoch; `draw()` at the live clock, so the physics and the
  rendered hardware can never disagree. The second-rotor (tip launcher) case
  is designed in from day one even though its card comes later (I6).
- **The Moon card is frozen.** Kim considered and discarded a
  release-date-tweaking knob for putting the Moon somewhere convenient — it
  would force recomputing the entire downstream trajectory ("messy and slow
  fast"). Moon-position planning happens in the Ephemeris tab instead (D7's
  indicators); to re-plan around the Moon, copy the mission link, paste it
  into the Ephemeris tab, tweak there, and start a new mission plan. The
  Moon card exists in the stack for clarity and workflow, read-only.
- **Release is not a card.** It comes into being as soon as the carrier
  chain can release: adding a skyhook card immediately drafts a trajectory
  polyline from the default values, live-updating as parameters change; a
  small tooltip readout at the release point (impulse, plane change,
  prograde — the waypoint-readout style) appears with it.
- **Timing model: a hand-off WINDOW plus a fixed release anchor.**
  (Settled 2026-07-15 — see decision 6; only D7's indicator design remains
  open, tracked as decision 7. Revised that day in a second pass — replaces a back-solve idea Kim caught
  as unsound: when the Moon's position significantly shapes the trajectory,
  a continuously-derived release date is a feedback loop — tuning changes
  flight time, which slides the release date, which moves the Moon, which
  changes the trajectory just tuned. Better duration estimates don't fix
  that, and Oberth-loop / flyby departures blow past any estimate anyway.)
  The model: (1) the frozen plan carries a hand-off WINDOW — a span around
  the nominal coast-start epoch, sized at freeze (default to calibrate with
  a worked example; ±1 d suggested) — and the course check's epoch row
  becomes "inside the window" (this promotes the existing ±0.25 d point
  tolerance to a visible plan field; a new frozen-plan field → decision 5's
  freeze-contract review applies). (2) The release epoch is a READ-ONLY
  ANCHOR FROZEN INTO THE PLAN at mission creation (third pass, 2026-07-15,
  Kim — replaces "initialized at tech-add from the tech's default draft,"
  which would have made the Moon's position at release depend on which card
  the user happens to add, undermining Ephemeris-tab planning): D7's
  indicators present the time-offset for the departure leg's estimated
  duration at planning time (the two-body SOI-exit estimate settled in D7 —
  dive-in profile via `O.coastTimeToRadius`, superseding the naive
  `departureDefaultSpanSeconds()` guess), and freeze bakes
  release anchor = hand-off − that same estimate, alongside the
  window (±1 d default, agreed 2026-07-15). Tech-add neither sets nor moves
  the anchor; nothing ever re-derives it — the Moon card shows one
  unchanging state: exactly the Moon the user planned around in the
  Ephemeris tab. (3) Every recompute is a single FORWARD
  pass (release → integrate → compare at the boundary; no fixed-point
  iteration, no hidden solving). (4) The USER closes the timing loop, same
  as the spatial loop in coast: the course check reports "hand-off early/
  late by X," and the user adjusts the setup or goes back to the Ephemeris
  tab for a different plan. The departure slider's right edge becomes the
  window (a shaded band) rather than a point. Known accepted limit: an
  anchor sized by the freeze-time estimate (~days) cannot host a multi-week
  flyby departure built afterwards in the mission tab — that setup needs a
  plan made for it (Ephemeris tab), which is correct behaviour. The arrival side
  gets the mirror shape later (a catch window — relevant to H2's
  Mars-Phobos-style catch planning).
- **departure-leg is headless** — no card of its own ("the departure leg
  includes everything that leads up to the hand-off, so there is no point in
  having that be a card" — Kim). Its visible output is the drawn polyline,
  the release tooltip, its events (release, waypoint impulses, SOI exit —
  the departure slider's real marks at last), and up to 2 waypoint-impulse
  cards mirroring the coast sidebar's per-waypoint cards.
- **Aiming lives in the cards.** Each rotating carrier's card carries its
  own phase slider (the plotter's third slider, relocated in-card); a future
  tip launcher gets its own, giving two stacked aiming controls. **No assist
  buttons** — Kim is dubious of assists generally: a good UX should let the
  user handle trajectories themselves to the point where assists are
  superfluous. (The plotter's two "lock" toggles are date-scrub conveniences
  and have no job here with the release date frozen; the equal-phase snap is
  noted on D7 as a possible indicator ingredient.)
- **Not in this package:** H1 and any Earth–Moon scene-fidelity work
  (deferred — see H1's note); the isometric burn-vector editor (still the
  optional upgrade the inventory lists); a marker on the departure
  trajectory (still G2).

Tasks (build order I1 → I2 → I3 → I4 → I5; I6 later):

- [x] **I1. Pure physics port → Shared.** ★★★
  The plotter's restricted N-body machinery into a new pure ES module
  (suggest `Shared/geo-leg.js`; final name at implementer's discretion):
  `shipAccel`/`addThirdBody`/`integrateTrajectory` (RK4 with the adaptive
  turn-angle/cislunar step caps — MSK:533–704), `localFrameAt`/
  `bodyLabelForGM`/`burnEffect` (MSK:743–787), `stateAtLegTime`/
  `buildMoonEllipseLeg`/`buildIntegratedLeg` + leg helpers (MSK:788–1012).
  THREE-free: samples stay plain `{r, v, t}` arrays (the plotter's parallel
  `THREE.Vector3` trail becomes caller-side). The standalone plotter is NOT
  modified. Node tests pin the port against numbers the plotter's own code
  produces today (same release state in → same branch/v∞/duration/samples
  out, for the default scenario and a waypoint-burn scenario).
  **Done 2026-07-16.** `Shared/geo-leg.js` (~430 lines), ported as close to
  verbatim as purity allows. Deliberate differences, each documented in its
  header: THREE-free (no `pts` polyline / `moonRelPoints` — callers rebuild
  render points from samples + the exported `moonGeoPos`;
  `legRenderPointAtDistance`, pure render interpolation for the drag gizmo,
  stayed behind with its THREE points, while its pure siblings
  `distanceAlongLegToTime`/`timeToDistanceAlongLeg` came across), and
  `lunarInclination`'s reference plane became a PARAMETER
  (`opts.moonPlaneNormal`, default the ecliptic pole) since the plotter
  measures against its own skyhook's plane — tool state a shared module
  can't know; I2's kinematic chain will supply the tech's real normal.
  Also exports the constants (`SOI_MOON`/`SOI_EARTH`, computed from masses
  with the plotter's exact expressions), the ephemeris plumbing
  (`earthHelio`, `moonGeoPos/Vel`, `sunGeoPos`), `conicPeriod`,
  `firstApsisTime`/`defaultWaypointTime`/`WP_DEFAULT_DIST_M`.
  **Port proven BIT-EXACT against the plotter's own code**: the relevant
  functions were sliced verbatim from a verified-complete snapshot of
  moonSkyhookTrajectory.js into a scratch harness (THREE.Vector3 stubbed
  data-only; `hookPlaneNormal` stubbed to the ecliptic pole to match the
  port's default) and both implementations run side by side on four
  trajectory scenarios — the preset-like escape release (orange, dives past
  Earth, v∞ 5.483 km/s, 296 samples, 31.855 d to the 0.1 AU cutoff), a
  bound-to-Earth start (green, closes to 165 km after one 100,000 km
  orbit), a Moon impact, and a Moon-bound lunar orbit (moon branch,
  1.02 periods, apsides 3261.4/3266.8 km) — plus `buildIntegratedLeg`/
  `buildMoonEllipseLeg` wrappers, `stateAtLegTime` at edges/samples/
  mid-times, `burnEffect` in all three local frames, `localFrameAt`
  gating, the distance/time helpers, apsis/waypoint defaults, and the SOI
  constants: identical to the last bit everywhere (branch, impact,
  duration, v∞, inclinations, every sample's r AND v; max drift 0.0).
  The committed suite (`Shared/tests/geo-leg.test.js`, 13 tests) pins that
  comparison run's figures — its header explains the provenance and what a
  future drift means — plus invariants: the ≤~2°-turn-per-step sampling
  rule across the whole escape, the deliberate 1.02-period green overshoot
  (first cut of the closure test measured leg-END closure and failed
  honestly against that overshoot; fixed to measure closure AT one period,
  165 km on a 100,000 km orbit), impact naming both ways, plane-change/
  prograde burn readouts, and distance↔time round-trips. All 180 Node
  tests green (every suite in the repo). No browser surface until I3
  wires a module to it — nothing to verify in-page yet.
- [x] **I2. Kinematic-chain evaluator → Shared.** ★★
  **Done 2026-07-16.** `Shared/kinematic-chain.js`: a chain is plain,
  serializable data — `{ base: "Moon"|"Earth", rotors: [{ normal, ref,
  radius, rate, phase0, epoch }, ...] }` — and `evaluateChain(chain, jd)` is
  the one pure evaluator, composing the base body's own geocentric ephemeris
  state with each rotor's uniform circular motion in turn (each pivoting on
  whatever the chain has accumulated so far). Composition is a plain vector
  sum, not a rotating-frame transform: every rotor's plane is fixed in the
  same non-rotating, ecliptic-aligned axes the rest of `Shared/` already uses
  (geo-leg.js's frames), so nothing here needs Coriolis/centrifugal terms —
  exactly the assumption lunar-skyhook.js's inline tether kinematics and the
  plotter's `hookBasis` already made. `planeBasis(normal, ref)` builds each
  rotor's orthonormal in-plane basis (e1 = `ref` projected orthogonal to
  `normal`, normalized; e2 = `normal x e1`), so phase 0 points along `ref`'s
  in-plane component and phase advances toward e2. `baseState(name, jd)` is
  the small base-body resolver (Moon via `LunarEphemeris`, Earth as the
  geocentric origin — the only two the departure system needs today; add
  more as chains need them). Evaluating at `jd === rotor.epoch` reduces
  exactly to `phase0` with no drift term, so a rotor whose phase is pinned
  at a specific date never needs the caller to fold one in.
  **Node-tested** (`Shared/tests/kinematic-chain.test.js`, 6 tests): a
  Moon+skyhook chain — built from `lunar-skyhook.js`'s own `computeRelease`
  output (`rRel`, `omega`, `releasePhaseDeg`, `releaseJd`), same ecliptic-
  plane convention (`normal:[0,0,1]`, `ref:[1,0,0]`) — reproduces the release
  kinematics `computeRelease` computes inline (Moon's geocentric state plus
  the tether-tangential `rRel`/`vRel` kick) to within floating-point
  tolerance; a synthetic two-rotor chain (an ecliptic-plane rotor plus a
  TILTED-plane "tip launcher" rotor riding its tip) confirms the composition
  is the vector sum of both rotors' independently-hand-computed
  contributions (caught one test-authoring bug along the way: asserting
  position/velocity to 1e-9 m tolerance after a `jd = JD + dt/86400` round
  trip is tighter than a Julian date near 2.46e6 can represent — double
  precision loses ~1e-6 s of a 37 s offset, a sub-micrometre wobble at this
  problem's scales; loosened to 1e-3 m / 1e-6 m/s, still far tighter than
  anything a real bug would hide within); plus `planeBasis`/`baseState`
  sanity checks (an unknown base body throws) and the zero-rotor identity
  case. All 185 Node tests green (5 new here, one incidental `README.md`
  fix: added the missing `geo-leg.js` entry alongside this one). No browser
  surface yet — nothing wires this into a module until I3.
- [x] **I3. Module reshape: moon-platform, carrier skyhook, departure-leg.** ★★★
  The heart of the package. New `modules/moon-platform/` (read-only card:
  the Moon's heading/impulse readouts at the release epoch; emits the chain
  base). `lunar-skyhook` becomes a carrier: appends its rotor element; keeps
  comAlt/topAlt/relAlt; gains the in-card phase slider; DROPS `releaseJd`
  (the plan's frozen anchor replaces it — see preamble) and its whole
  patched-conic release chain
  (replaced by the real integration). New headless `modules/departure-leg/`:
  accepts the chain packet, reads the release-epoch ANCHOR from the frozen
  plan (D7's baked field — see the timing-model bullet; read-only, never
  re-derived), integrates FORWARD with waypoint impulses
  (cache per (World, stageId) WeakMap as usual; verify interactive
  responsiveness), emits the hand-off ship-state + events. The course check
  (frozen-plan) now measures the INTEGRATED hand-off against the plan's
  window — the shipped preset can finally close its honest v∞ gap with a
  perigee (Oberth) impulse, or keep showing the true shortfall. Old saves
  (a lunar-skyhook with releaseJd and no leg stage) must still load. New
  chain: moon-platform → lunar-skyhook → departure-leg → frozen-plan →
  transfer-leg. Depends on I1 + I2 + D7 (the anchor it reads is D7's frozen
  field). Worth Kim's review before merging (this
  reshapes the mission save format).
  **Done 2026-07-16.** All three modules landed, plus the plumbing the
  preamble prescribes — **awaiting Kim's review of the save-format reshape**:
  - **Packet + anchor + window.** New `carrier-chain` packet type
    (`{ base, rotors }`, exchange-types.js) carries I2's chain between
    stages. The read-only anchor lives behind ONE lookup,
    frozen-plan.js's exported `releaseAnchorFor(world)` (plan's
    `releaseAnchorJd` → plan's `departure.jd` (pre-D7 saves) → any stage's
    legacy `releaseJd` (pre-I3 saves) → null, diagnosed at the top of the
    stack); nothing ever writes it outside freeze. The course check's epoch
    row now tests against the plan's `handoffWindowDays` (±1 d default —
    the old fixed EPOCH_TOL_DAYS 0.25 is gone; the row carries `window` for
    C2's future band rendering) and the epoch warning names the window.
  - **moon-platform**: read-only top card (anchor date, geocentric
    distance/speed, speed along Earth's heliocentric prograde — D7's
    framing); emits the chain base. **lunar-skyhook**: pure carrier —
    validates geometry (`tetherKinematics`; bound-at-moon still diagnosed
    early with its computed fix), appends its rotor (`rotorFor`: ecliptic
    plane, phase pinned at the anchor), in-card phase slider (transient
    sets while dragging), releaseJd param + the whole patched-conic chain
    deleted. **departure-leg**: headless (`plainCard`, diagnostics only) —
    evaluates the chain at the anchor, integrates forward (geo-leg RK4,
    5.6 ms/leg so slider-drag recompute is effortless), waypoint impulses
    in each leg's own local frame (the Oberth pattern now expressible),
    flight TRUNCATED at Earth-SOI exit = the hand-off (samples beyond
    belong to the coast), emits the helio hand-off ship-state
    (Frames.bodyHelioState lift — the same Earth model the compliance
    comparison uses) + events (release, impulses, Moon SOI exit, hand-off —
    the departure slider's real marks); diagnostics: impact,
    bound-no-handoff, no-carrier (rotor-less chain, I5's
    removed-last-carrier state), waypoint-outside-leg, no-release-anchor.
  - **Save format v2 + migration.** WORLD_VERSION bumped to 2;
    deserializeWorld migrates v1 in place (inserts moon-platform before /
    departure-leg after each lunar-skyhook, fresh ids, params — including
    the legacy releaseJd — untouched), so every load path (localStorage,
    share links, preset) migrates through the one choke point. Verified
    end-to-end in Node AND live in the browser: a v1 save loads, anchors at
    its plan's departure.jd, integrates, and honestly reports its hand-off
    2.6 d late (outside the window) while the frozen coast still arrives.
  - **Preset rebaked** (5 stages, v2): anchor 2463218.5467 = hand-off −
    the D7 estimate for the committed 6.55 km/s (dive-in, 2.2033 d), window
    ±1 d, clock opens at the anchor. Phase 92 kept: the real integration
    delivers v∞ 5.02 km/s, 9.6° off-aim, hand-off +0.51 d — INSIDE the
    window — so the shipped warnings are vinf-mismatch + aim-mismatch only,
    and closing the gap (a perigee Oberth impulse, I4's UI) is the teaching
    exercise. Old reference release (at the old epoch, phase 92) reproduces
    I1's pinned scenario exactly (v∞ 5.483, SOI exit +2.59 d).
  - Tests 185 → **192 green** (modules.test.js rewritten around the chain +
    migration; frozen-plan.test.js gains window + releaseAnchorFor
    coverage; kinematic-chain.test.js's reference construction inlined,
    dropping its backwards import of the module). Browser-verified via the
    preview pane: cards render, the phase slider live-recomputes the whole
    chain (6.55 → 4.72 km/s at phase 120, matching the Node scan), the
    flight polyline draws truncated at the hand-off, events/slider marks
    populate, console clean. (Pane screenshots timed out — a capture-tool
    quirk; geometry verified structurally by instrumenting THREE.Line.)
  - **Follow-up (Kim's catch, 2026-07-17):** on load the trajectory didn't
    start at the tether tip — mission-view's init snapped the opening clock
    to the date bar's whole-day grid, ~67 min before the anchor ≈ HALF a
    tether rotation, so the drawn tip sat opposite the release point and
    the phase slider could never close the gap (both ends rotate together;
    only a timeline scrub — the exact-jd path — healed it). Fixed: the init
    now opens at the world's exact jd via dateBar.setJd (the same precise
    path event clicks use). Verified in-browser: at load the tether-tip dot
    and the polyline's start coincide to ~8 m (float32 geometry precision).
- [x] **I4. Departure waypoint-impulse UI.** ★★
  Up to 2 waypoint cards in the departure sidebar (the coast sidebar's
  stripped per-waypoint pattern), gizmos/arrows/readout boxes in the
  Earth–Moon frame (the Ephemeris tab's Shared/sim wiring: burn-widget,
  readout-panes), plus the release-point tooltip readout. Burn axes come
  from I1's local dynamical frames (prograde means prograde around the
  leg's own primary — Moon, Earth, or Sun, gated on the leg, not
  proximity). Depends on I3.
  **Done 2026-07-17.** `departure-leg.js` gained the `init` its own header
  had anticipated: up to 2 waypoint cards (transfer-leg's own stripped
  pattern — a `mp-card` per waypoint with a remove button, `+ add waypoint`
  capped at 2 — but the time field reads/writes **hours** after release,
  not days, matching the flight's own hours-to-days scale; `t` stays SECONDS
  internally, the module's existing convention). `computeDepartureLeg` now
  also returns `wpVisuals` (indexed by each waypoint's position in
  `params.waypoints`, not the chronological order the impulse-chain walk
  uses internally — an `originalIndex` tag carried through the sort, same
  trick `ephemeris-view.js`'s `resolveWaypoints` already uses): for each
  waypoint, the render position plus `rLocal`/`vLocal` and the full
  `burnEffect` output, ALL already evaluated in that waypoint's own local
  dynamical frame (geo-leg's `localFrameAt`/`burnEffect`, gated on
  `leg.primary` — the integrated segment's actual primary — never on mere
  proximity, per I3's own framing). Since `burnEffect` already returns
  exactly the `{burnDv, planeChange, progradeDv}` shape
  `Shared/sim/readout-panes.js`'s `renderReadoutBoxes` expects, the
  per-waypoint readout boxes need no separate readout-data function the way
  the Ephemeris tab's own `burnReadoutData` does — `wpVisuals[i].eff` feeds
  the shared renderer directly. `draw()` now also builds each waypoint's
  prograde/radial/normal gizmo (`Shared/sim/burn-widget.js`'s
  `createWaypointGizmo`, given `rLocal`/`vLocal` for orientation and the
  drawn position separately — the exact render-position-vs-burn-frame split
  its own header documents) plus its dV/prograde-speed-change arrows
  (`makeBurnArrow`, same 8-scene-units-per-km/s scale and colours as the
  Moon-Skyhook/Mars-Phobos local views, which share this file's 1000-km
  scene unit).
  **Shell additions (mission-view.js), both generalized for any future
  module, not special-cased to this one:** (1) `view.pxScaled` — a plain
  `[{obj, px}]` list a module's `draw()` can populate, rescaled every
  render frame by the existing `updateChevrons` hook (renamed in spirit,
  not in name) via `worldSizeAtPointForPx`, the same constant-on-screen-size
  treatment the ship-marker chevron already got, generalized past that one
  sprite. (2) a `readoutLayer` overlay (`Shared/sim/readout-panes.js`'s
  straddling-box mechanism, previously only wired into the Ephemeris tab)
  now lives at the mission-view level too, with `mainEl`/`panelEl`/
  `readoutLayer` all passed through `ctx` to every card's `init` — so
  departure-leg's own `init` builds and positions its boxes with the exact
  same imported functions the Ephemeris tab uses, no shell-specific
  wrapper needed.
  **Release-point readout:** a small straddling box (same mechanism as the
  per-waypoint burn readouts, just hand-built rather than going through
  `renderReadoutBoxes` since its fields don't fit that shape) anchored to a
  "release" row at the top of the card, showing the flight's headline
  figures — release date, hand-off v∞, flight time to hand-off — near
  where the release dot actually sits in the pane, without requiring a
  scroll up to moon-platform's card for the same numbers.
  **Bug caught and fixed during in-browser verification:** the add/remove
  handlers called `setParam` (which recomputes SYNCHRONOUSLY, firing
  `ctx.onResult`) and only rebuilt the waypoint-card DOM rows *afterward* —
  so a just-added waypoint's recompute landed against the stale (still
  empty, or still N-1) `wpRows` array and its readout box silently never
  appeared until some unrelated later recompute. Fixed by rebuilding the
  rows against the new list FIRST (`rebuildWaypointRowsFor`, a
  temporary-`stageParams`-override variant of the normal rebuild) and only
  then calling `setParam`, with an explicit `updateReadouts()` call right
  after (factored out of the `ctx.onResult` callback, which now just calls
  it) so the fresh rows aren't left showing stale data for even one tick.
  Verified in-browser (local server, a genuinely fresh load of the shipped
  preset): the card renders "release" + "+ add waypoint" with no waypoints;
  adding one shows its card AND its readout box together, immediately (no
  stale-tick gap); setting a 1.5 km/s prograde impulse raised the hand-off
  v∞ from 4.93 → 6.47 km/s live (compliance bar's own `v∞ out` gap visibly
  closing, 6.55→6.54 vs. the unboosted 6.55→5.02 — I3's own "teaching
  exercise" framing playing out), with the readout box showing the matching
  `impulse Δv 1.50 km/s` / `prograde Δv +1.50 km/s`; adding a second
  waypoint produced its own card + readout box (3 total: release + 2
  waypoints) and correctly hid the add button at the 2-cap; instrumenting
  `THREE.Group.prototype.add` confirmed 2 gizmo groups (tagged via
  `userData.axes`) and 2 `ArrowHelper`s were actually added to the scene
  graph on a burn-field edit. Console clean throughout. Node suites
  unaffected structurally (still 154 green) — the `computeDepartureLeg`
  tests only check `ok`/`handoff`/`vinfEarth`, not the new `wpVisuals`
  field, so no test changes were needed; the field is exercised by the
  in-browser check above instead.
- [ ] **I5. Carrier add/remove dropdown.** ★★
  F1's departure slot, pulled forward: an "add technology" affordance in
  the departure sidebar (the Moon card is fixed; up to 2 carrier cards;
  removing one re-drafts the trajectory from what remains). Greyed
  "(future)" options for unbuilt carriers. Depends on I3.
  **Body scope (Kim, 2026-07-17):** the dropdown is NOT Earth-Moon-only —
  any body on the departure list can offer tech (skyhook, space elevator,
  mass driver, ...), restricted case-by-case by plausibility (a Venus
  skyhook is a legitimate stretch goal; a Jupiter space elevator is not),
  not by a hardcoded body allowlist. Registry entries are `{ id, label,
  bodies: [...] }` drawn from `Shared/orbit.js`'s `systems` map (already the
  project's one master body list — no new one needed). Follow the `body`
  convention (`Shared/exchange-types.js` header, `ARCHITECTURE.md`'s
  "Packets — the data contract") for any packet/config a dropdown-selected
  or calculator-loaded card produces or accepts, and extend
  `lunar-skyhook.js`'s incoming-base check (added 2026-07-17) to any new
  body-scoped carrier module.
- [ ] **I6. Tip spin-launcher carrier card.** ★★★ — **later; design first.**
  The second rotor: arm length, spin rate, plane tilt, its own in-card
  phase slider; drawn riding the tether tip; exchange receive from
  Tip-Spin-Launcher-Calculator (F2's pattern). I2's chain shape already
  carries the rotor — this is the card + draw + exchange work. Depends on
  I3–I5. Same body convention as I5 applies to its exchange packet.

### WP-J — Departure origin: skyhook at any body

Lets a mission's departure system originate from any body on the
HELIO_BODIES list, not just Earth/Moon. The only departure tech this needs
is a skyhook orbiting the origin body directly — no satellite ephemeris, no
other per-body modelling. Phobos (Mars's anchor moon) is the one special
case, and it's already covered: `Mars-Phobos-Skyhook-Trajectory-Plotter/
marsPhobosSkyhookTrajectory.js` already models a skyhook orbiting Mars this
way (Phobos supplies only a radius, never a real position) and is the direct
port source for this package.

- [x] **J1 (= H1). Generic body-local frame factory.** ★★
  Un-defer H1 (see its own entry under WP-H): add `buildBodyFrame(name)` to
  `scene-frames.js`, generalizing `buildEarthMoonFrame` — hero sphere, label,
  lighting, and the skyhook's own orbit ring standing in for the "moon"
  ring. Serves both H2 (Arrival) and this package (Departure).
  **Done 2026-07-17.** `scene-frames.js` gains `buildBodyFrame(name)`,
  thinner than `buildEarthMoonFrame`: one hero sphere for `name` (any
  `HELIO_BODIES` entry) at the scene origin — no satellite is placed or
  orbit ring built here, since a departure origin's "moon" (Phobos, etc.) is
  never a real ephemeris body, only an orbit-radius source (WP-J's own
  framing); a carrier module (J2) draws its own skyhook ring in its place.
  Hero sphere styling (color/emissive/point) follows `createBody`'s Kepler
  pattern rather than `buildEarthMoonFrame`'s hand-picked Earth/Moon colors,
  since a generic body has no hand-tuned look to match. Camera distance and
  zoom bounds scale off the body's own radius (`radiusU`) rather than
  hardcoded constants, generalizing the ratios `buildEarthMoonFrame`
  (radiusU 6.4, cam 60, zoomMin 2, zoomMax 30000) and the Mars-Phobos
  plotter (radiusU 3.4, cam 35) already use, so Ceres (radiusU ~0.5) and
  Jupiter (radiusU ~70) both get sane default framing. `place(jd)` points
  the directional light at the true Sun direction for that body via
  `O.bodyStateAtJD`, no ring rebuild needed since none is built. Not yet
  wired into any view (`PHASE_FRAME`/mission-view.js) — that's J3.
  Verified: `node --check` clean; in-browser regression on the existing
  planner (helio + Earth-Moon frames, `buildBodyFrame` unused by any current
  caller) — no console errors, unaffected. No Node suite: this file is
  THREE.js/browser-only, same as its siblings.
- [x] **J2. Generic orbital-skyhook carrier + release module.** ★★★
  Port `marsPhobosSkyhookTrajectory.js`'s escape integrator and release/
  waypoint kinematics into a module usable for any origin body, parametrized
  by that body's own GM/radius instead of Mars's hardcoded constants. Orbit
  radius defaults to a candidate satellite's `orbit.semiMajor` when the
  origin has one (e.g. Mars → Phobos), else a manual default. Depends on J1.
  **Done 2026-07-17 — awaiting Kim's review (parallels the lunar departure
  trio; no save-format change beyond two new module ids).** Three pieces,
  each the generic sibling of an Earth–Moon one:
  - **`Shared/body-leg.js`** — the Mars-Phobos plotter's body+Sun escape
    integrator (`bodyAccel`/`integrateTrajectory`/`buildIntegratedLeg`/
    `localFrameAt`, branches entry/body/sun), generalized off Mars onto any
    HELIO_BODIES body via `bodyConstants(name)` (GM/radius/mass/SOI/cutoff
    from `systems`; airless bodies get `entryR` = bare surface). The
    body-agnostic helpers geo-leg already had (`stateAtLegTime`,
    `burnEffect`, the distance/time helpers) are imported and re-exported,
    not re-typed. **Proven BIT-EXACT** against the plotter's own sliced code
    (0.0 m/(m/s) sample drift, identical branch/duration/SOI) on escape,
    bound, and impact scenarios — `Shared/tests/body-leg.test.js` (11 tests)
    pins that run.
  - **`modules/orbital-skyhook/`** — the carrier. SELF-CONTAINED (accepts
    `[]`, emits the whole `{ base: <body>, rotors: [its rotor] }` — no
    separate platform, since a generic skyhook orbits its body directly, in
    that body's own centred frame where the body is the origin at rest;
    `kinematic-chain.js`'s `baseState` now returns `[0,0,0]` for any such
    origin body). Body-parametrized (`body` a required param, the "body"
    convention); GM/radius from `systems`; `defaultGeometryFor` puts the CoM
    at a candidate satellite's orbit (Mars → Phobos) or a low fallback, and
    the release above the escape radius so the default drafts an escaping
    trajectory. In-card phase slider; diagnoses a missing release anchor (the
    role moon-platform plays for the lunar chain).
  - **`modules/body-departure-leg/`** — the release/integration leg
    (headless, `plainCard`). Generic sibling of departure-leg: reads the
    anchor, evaluates the chain there (body-centric release), integrates
    body+Sun forward with up to 2 waypoint impulses (each in its leg's own
    Body/Sun local frame), truncates at ORIGIN-BODY-SOI exit = the hand-off,
    lifts to helio via `Frames.localToHelio(body, …)`. Its I4-style waypoint
    UI (cards + vector editor + readout boxes) and draw are a close copy of
    departure-leg's, kept separate to leave the working lunar leg untouched
    (a future refactor could share them). **Partly done 2026-07-18:** the
    SVG burn-vector editor (the widest of those copies, 144 lines ×4) is now
    `Shared/sim/vector-editor.js` (`buildVectorEditor`), imported by
    ephemeris-view.js and the transfer-leg / departure-leg /
    body-departure-leg modules; the rest of the waypoint-card UI is still
    per-module.
  Both modules read the release frame via the symbolic `rendersIn:
  ["body:origin"]` token — **J3** aliases it to the mission's own origin
  frame (buildBodyFrame, J1) and sets `PHASE_FRAME`; until then a generic
  mission has no origin frame and they draw nothing (harmless). Registered in
  planner.js's `MODULE_URLS`. Verified: full Node suite **216 green** (+24:
  11 body-leg, 13 orbital-skyhook/body-departure-leg — carrier geometry,
  release kinematics, escape-to-hand-off, waypoint impulse, and the
  no-carrier/bad-origin/bound/impact diagnostics, plus an engine-integration
  pass skyhook→leg→frozen-plan); `node --check` + eslint (`no-undef`) clean on
  the two browser modules; in-browser (local server) the planner still boots
  with the two new modules registered and the shipped lunar mission intact
  (clean console), and a direct harness against a real `buildBodyFrame("Mars")`
  drove both `draw` hooks (skyhook → 2 orbit rings + tether + release dot; leg
  → a 144-point body-centric polyline + release/hand-off dots) and both
  `update` paths (chain base=Mars, ship-state helio hand-off + 2 events) with
  no THREE errors. **No in-planner end-to-end yet** — a generic-origin
  mission can't be displayed until J3 wires the origin frame (mirrors I1
  awaiting I3).
- [x] **J3. Departure phase frame follows the mission's origin.** ★★
  `mission-view.js`'s `PHASE_FRAME.departure` stops being a fixed
  Earth-Moon constant; each mission view builds/looks up the frame for its
  own frozen plan's `origin` body. Depends on J1 + J2.
  **Done 2026-07-17.** `mission-view.js` gains `missionOriginBody(world)`
  (reads the mission's frozen-plan stage's `origin` param, "Earth" default
  for pre-comply saves or missions without one — frozen-plan.js's own
  default) and `departureFrameFor(origin)` ("body:Earth-Moon" for Earth,
  else "body:" + origin). `PHASE_FRAME`/`FRAME_PHASE` are no longer
  module-scope constants — each `createMissionView` call builds its own from
  `departureFrameId = departureFrameFor(missionOriginBody(world))`, computed
  once up front. The `frames` dict now only builds what a given mission
  needs: `helio` always, plus either `buildEarthMoonFrame()` (Earth origin,
  unchanged) or `buildBodyFrame(origin)` (any other WP-J origin, task J1) —
  no wasted Earth-Moon frame for a Mars/Ceres/etc. mission. A new
  `resolveFrameId(id)` aliases the symbolic `"body:origin"` token
  `orbital-skyhook.js`/`body-departure-leg.js` declare in `rendersIn` to the
  mission's real `departureFrameId`, called at both consultation points
  (`buildStageViews`'s frame lookup, `stagePhaseOf`'s phase lookup) — the two
  modules stay written against the symbolic token with no knowledge of any
  particular mission's origin. Defensive fallback: `initialMain` falls back
  to `"helio"` when `opts.defaultMain`/a saved workspace slot's `main` names
  a frame this mission never built (e.g. a non-Earth mission duplicated
  before J3, or the shell's hardcoded `defaultWorkspaceMain =
  "body:Earth-Moon"` landing on a Mars mission) — same defensive pattern the
  saved-workspace path already used, extended to the constructor default.
  **Known limitation, out of scope here:** the departure slider's own default
  span/Hohmann fallback (`departureDefaultSpanSeconds`/`departureSpan`) still
  hardcodes Earth's SOI/orbit for its estimate — cosmetic only (the slider
  still shows real flight events once a generic departure tech resolves any),
  not part of "the frame follows the origin."
  Verified: full Node suite unaffected (216 green — this is browser-only
  rendering/wiring, no pure-logic change) plus `node --check` clean. In
  browser (local server): the shipped Earth-Moon preset renders identically
  after the refactor (Departure caption "EARTH–MOON SYSTEM · geocentric
  ecliptic", all cards/compliance bar/events intact, console clean,
  survives reload). A synthetic Mars-origin mission (orbital-skyhook →
  body-departure-leg → frozen-plan with `origin: "Mars"`, built the same way
  `modules/tests/body-departure.test.js`'s engine-integration test does, but
  driven through the real `createMissionView` in-page) switched to Departure
  and showed the main pane caption "MARS SYSTEM · Mars-centric ecliptic"
  with the Orbital skyhook card reading "ok", no diagnostics, only the two
  frames actually built (Mars + helio, no stray Earth-Moon frame), and a
  clean `render()`/`resize()` pass — confirming both the frame construction
  and the `"body:origin"` token aliasing work for a real non-Earth origin,
  not just Earth. Console clean throughout; harness view disposed and its
  workspace-store slot removed after verification.

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

| Section                     | Lines                  | What it is                                                                                        | Task                                    |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Sidebar card structure      | throughout its HTML/JS | the design doc's cited "good example" of a tech card (skyhook geometry + release params)          | F1/F4 reference, I3                     |
| Release-state kinematics    | ~398–432, 548–556      | `hookBasis`/`hookDir`/`releaseState` — the tether rotor's geometry (basis, phase, tip velocity)   | I2                                      |
| Released-ship trajectory    | ~533–704               | restricted N-body geocentric propagation of the released ship                                     | **I1** (was F5's physics half)          |
| Waypoint burns (geocentric) | ~705–1201              | in-system waypoint-burn chain — exactly the design's "up to 2 waypoint burns within this system"  | **I1** (frames/burnEffect), **I4** (UI) |
| Gizmos + arrows + readouts  | ~1202–1277             | waypoint gizmo/arrow wiring in the local frame                                                    | I4                                      |
| Moon-phase / skyhook locks  | ~1590–1656             | date-scrub conveniences: equal-elongation snap; tether phase slaved to the Moon's velocity        | D7 background only                      |
| Burn-vector editor          | ~1754–1922             | the isometric 3-axis draggable-arrow burn editor — now `Shared/sim/vector-editor.js`, used by the planner's ephemeris view and all three leg modules | done (shared)                           |
| Waypoint list cards         | ~1923–1961             | its `buildWaypointList` variant                                                                   | I4                                      |

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
| `Calculators/Tip-Spin-Launcher-Calculator/`                | README + spinLauncherCalc.js                                                                                                                                                                                      | the tip-rotor model (arm sizing, spin rate, plane tilt) for the second carrier       | I6           |
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
6. **I3 timing model — settled 2026-07-15** (three passes, see WP-I's
   timing-model bullet): hand-off WINDOW (default ±1 d, agreed) + READ-ONLY
   release anchor (agreed) FROZEN INTO THE PLAN at creation, authored via
   D7's Ephemeris-tab indicators (Kim's call — an anchor set at tech-add
   would make the Moon's release position depend on which card gets added).
   Kim also set the 10 m/s floor as C5's Δv-gap logging cutoff.
7. **D7 indicator design — settled 2026-07-16, and built the same session**
   (see D7's done-entry). Kim supplied the widget sketch (phase glyph +
   relative-speed bar + days-to-leave bar, under Earth's heliocentric-speed
   text, origin OR destination); the SOI-exit estimator was settled by Node
   experiment and Kim's quarter-switching rule chose between its two
   profiles; the relative-speed bar is the Moon's velocity component along
   EARTH'S heliocentric prograde (the waypoint gizmo's own prograde axis —
   educational consistency); the glyph is SVG with a half-ellipse
   terminator (gibbous/crescent capable). WP-I (I1 onward) is now
   unblocked.
