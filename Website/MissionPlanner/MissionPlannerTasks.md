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

| Rating | Meaning | Suggested tier |
| ------ | ------- | -------------- |
| ★ | Mechanical DOM/CSS work; a pattern already exists to copy; low risk | Small / cheap model (Haiku-class), with the referenced files in context |
| ★★ | Real wiring across 2–3 files, but the shape is established by existing code | Mid model (Sonnet-class) |
| ★★★ | Architecture-shaping, cross-cutting, or a fiddly orchestration port; mistakes are expensive | Strongest model (Opus/Fable-class), and worth Kim's review before merging |

Regardless of model: every task follows CLAUDE.md conventions (ES modules,
pure logic stays Node-testable, one responsibility per file), keeps the
existing Node suites green (`node --test Website/MissionPlanner/core/tests/*.test.js`
and `modules/tests/modules.test.js`), and browser-verifies via `serve.bat` at
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

- [ ] **A1. Refactor `planner.js` into a per-mission factory.** ★★★
  Extract the current module-scope pipeline into something like
  `createMissionView(world, registry, containerEl)` returning
  `{ engine, dispose, show, hide }`, so N instances can exist. Keep **one**
  renderer and one canvas (browser WebGL-context limits are why the scaffold
  scissors panes); only the active tab renders. Frame factories
  (`buildHelioFrame`, `buildEarthMoonFrame`, planner.js:138–273) become
  per-mission (each mission has its own cameras/scenes) or shared-with-
  per-mission-state — decide and record which. Workspace persistence
  (planner.js:279–308) gains a per-mission keying. This is the
  riskiest, most architecture-shaping task in the whole list; do it first and
  alone, before other threads touch planner.js.
- [ ] **A2. Tab bar.** ★★ (★ for the DOM, ★★ for the switching)
  Ephemeris tab + one tab per mission + active highlight + close "x", per
  mockup A (mock-a-phases.html:134–140 for markup/CSS, 538–543 for the
  switching pattern). Closing a mission tab asks for confirmation (missions
  are user data). Depends on A1.
- [ ] **A3. Mission persistence across reloads.** ★★
  Serialize each mission (name + `world.serialize()`) into one versioned
  localStorage key (`mw-missionplanner-missions`), restore on load. The
  mechanism is already proven by the share-link path
  (planner.js:74–92, `presets/default-mission.js` as the data shape).
  *Decision for Kim first:* the README defers persistence "to later steps" —
  but tabs without it lose missions on every reload, so recommend doing it
  here. Depends on A1.

### WP-B — Mission-tab chrome: phases, sliders, core data

All within one mission view; the mockup is the spec throughout.

- [ ] **B1. Real phase state.** ★★
  A mission view gets `phase ∈ {departure, coast, arrival}` (workspace state,
  not World). Phase buttons (planner.html:16–27, planner.js:338–362) go from
  view-swap shortcuts to phase selectors that drive: main-pane frame, float
  contents, which slider shows, and which sidebar cards show. Status dots on
  the buttons aggregate their phase's stage results (the per-stage dot logic
  exists in `renderStageStrip`, planner.js:528–548). Mockup:
  mock-a-phases.html:217–225, 526–537.
- [ ] **B2. Coast slider (date-scaled).** ★★
  A fixed-span slider from frozen departure→arrival dates with segment ticks
  and a playhead = the shared clock; clicking/dragging sets `world.set({jd})`;
  playhead pins at the ends when the clock is outside the span. This is a new
  widget, but `Shared/sim/date-bar.js` (the coarse-slider half) and the events
  bar's clock-setting (`setClock`, planner.js:593–596) supply all the parts.
  Mockup: mock-a-phases.html:242–253. Put it in its own file (e.g.
  `MissionPlanner/ui/phase-slider.js`) so B3 can extend it.
- [ ] **B3. Event-scaled Departure/Arrival sliders.** ★★★
  Same widget family, but segments are sized by the module-emitted `events`
  (the envelope channel, already flowing — see `renderEventsBar`,
  planner.js:550–574), not by linear time; greyed out until events exist;
  playhead pinned when the clock is outside the phase span. The subtle part is
  the nonlinear jd↔position mapping and keeping drag behaviour sane across
  segment boundaries. Mockup: mock-a-phases.html:229–240 (departure),
  255–265 (arrival). Depends on B2.
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

---

## Inventory: existing code to adapt

### Already shared — use as-is (import from `Shared/`)

These were extracted in migration step 1 and are already imported by the
scaffold; new UI should reach for them before writing anything fresh.

| Module | Exports worth knowing | Used by tasks |
| ------ | --------------------- | ------------- |
| `Shared/sim/marker-card.js` (361 lines) | `makeShipSprite`, `makeXMarkSprite`, `orientMarkerSprite`, `buildMarkerCard` (DOM skeleton), `bindRelativeDragSlider`, `markerFraction`, `sweepAngleFrom`, `phasingDays`, `refineApproach`, `followCrossing`. Header comment documents the shared-vs-local split — read it before D3. | D3, D4, E1, G2 |
| `Shared/sim/burn-widget.js` | `createWaypointGizmo` (prograde/radial/normal triad), `makeBurnArrow` | D2, F5, G1 |
| `Shared/sim/approach-markers.js` | ring sprite + `pickProximityTier`, `applyTierToSprite` (tier tables stay caller-side) | D4, E1 |
| `Shared/sim/readout-panes.js` | `renderReadoutBoxes`, `positionReadoutBoxes` (panel-edge burn readouts) | D2, F5 |
| `Shared/sim/date-bar.js` | `createDateBar` — coarse+fine sliders, date field, JD readout | B2 (as parts donor), already in the shell |
| `Shared/sim/camera-controller.js`, `body-renderer.js`, `orbit-rings.js` | already wired in planner.js | A1, D1, H1 |
| `Shared/exchange.js` + `exchange-types.js` | `Exchange.send/accept/pending/consume/linkFor`, `PacketTypes.make/validate`, `encodeFragment`/`decodeFragment` | A3, F2, F3 |
| `Shared/frames.js` | `localToHelio`/`helioToLocal`/`convert` — frame patching | C1, F5 |

### Port needed — tool-local code that moves into the planner

**From `Calculators/Solar-System-Trajectory-Plotter/solarSystemTrajectory.js` (1549 lines):**

| Section | Lines (2026-07-10) | What it is | Task |
| ------- | ------------------ | ---------- | ---- |
| Waypoint gizmo wiring | ~275–363 | `makeWaypointGizmo` + drag handling around the shared triad | D2, G1 |
| Snap-to helpers | ~378–475 | `snapTargetNu`, `timeToTrueAnomaly`, `snapTau` — apsis/node snapping (pure-ish; candidates for `math-utils.js` promotion with tests) | D2 |
| Burn readout boxes | ~564–607 | `burnReadoutData` + shared readout-panes calls | D2 |
| Orbit-approach markers | ~628–710 | `computeOrbitApproaches` scan + tier tables + temporal ring | D4 |
| **Marker state machine** | ~711–1036 | `applyTargeting` (Lambert re-solve, 761), `setMarkerMode` (816), `updateDestinationMarker` (848), `buildMarkerCard` (888), `updateMarker` (927), `focusMarker`/`removeMarker`/`placeMarkerAtGlobalTime` (1003–1035) | **D3** (the big one) |
| Trajectory picking | ~1037–1078 | click → nearest trajectory sample → place/move marker | D5, G1 |
| UI building | ~1079–1345 | `buildDestinationOptions` (1093), `buildWaypointList` (1273) — the **waypoint cards** | D2 |
| Refresh orchestration | ~1346–1451 | what recomputes on what change — read for understanding, don't port literally (the engine owns this in the planner) | D2/D3 background |

**From `Calculators/Moon-Skyhook-Trajectory-Plotter/moonSkyhookTrajectory.js` (2318 lines):**

| Section | Lines | What it is | Task |
| ------- | ----- | ---------- | ---- |
| Sidebar card structure | throughout its HTML/JS | the design doc's cited "good example" of a tech card (skyhook geometry + release params) | F1/F4 reference |
| Released-ship trajectory | ~533–704 | restricted N-body geocentric propagation of the released ship | F5 (the physics the lunar-skyhook module lacks) |
| Waypoint burns (geocentric) | ~705–1201 | in-system waypoint-burn chain — exactly the design's "up to 2 waypoint burns within this system" | **F5** |
| Gizmos + arrows + readouts | ~1202–1277 | waypoint gizmo/arrow wiring in the local frame | F5 |
| Burn-vector editor | ~1754–1922 | the isometric 3-axis draggable-arrow burn editor — a strong in-card alternative to numeric fields | F5, G1 (optional upgrade) |
| Waypoint list cards | ~1923–1961 | its `buildWaypointList` variant | F5 |

**From the scaffold and mockup (patterns to extend or copy):**

| Source | Lines | What it gives | Task |
| ------ | ----- | ------------- | ---- |
| `planner.js` frame factories | 138–273 | `buildHelioFrame` / `buildEarthMoonFrame` → generalize | A1, H1 |
| `planner.js` workspace persistence | 279–308 | versioned localStorage save/restore pattern | A3 |
| `planner.js` card + diagnostics scaffolding | 434–523 | per-stage cards, uniform `renderDiagBox`, `onResult` | C2, C3, F4 |
| `planner.js` stage strip / events bar | 525–574 | status dots, event → clock | B1, B5 |
| `planner.js` share-link load path | 74–92, 364–384 | fragment encode/decode + polite fallback banner | A3 |
| `mockups/mock-a-phases.html` | tab bar 134–140 · Ephemeris marker card 184–209 · phase bar 217–225 · three sliders 227–266 · departure sidebar 382–427 · coast sidebar 430–463 · arrival sidebar 466–506 · dialog 513–523 · switching JS 525–548 | the agreed look and interaction for every WP; lift its CSS wholesale where it fits | all UI tasks |
| `Calculators/Skyhook-Spin-Launcher/skyhookSpinLauncher.js` | receive-banner + Apply mapping | the proven exchange-receive pattern (incl. the `checked`-from-script display gotcha) | F2 |
| `Calculators/Gravity-gradient-skyhooks/` | send-button side | producer pattern: `calc()` first, then read authoritative fields | F3 |
| `modules/transfer-leg/transfer-leg.js` | whole file (332 lines) | the module template: pure compute + descriptor + card-building `init` + `draw` | C1, F5, H2 |

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
