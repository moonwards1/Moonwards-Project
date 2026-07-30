# Mission Planner — task list (v2)

The work remaining to bring the app to `MissionPlannerDesign_v2.md`. **That
design doc takes precedence over this one**: where the two disagree, the
design doc is right and this doc is stale.

Scope here is **forward-looking only**. Completed work is not recorded — the
code is the record, `README.md` describes the current state, and git history
holds the narrative. The old `MissionPlannerTasks.md` (work packages A–J) is
the record of what was built through 2026-07-25 and is to be deleted once
this doc is in place. **Anything in it not restated here is deliberately
dropped** — dropped items were usually waiting on live design questions, and
some are expected to reappear in a different form once the app is developed
enough to work with.

## Difficulty legend (for assigning models)

| Rating | Meaning                                                                                     | Suggested tier                                                            |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| ★      | Mechanical DOM/CSS work; a pattern already exists to copy; low risk                         | Small / cheap model (Haiku-class), with the referenced files in context   |
| ★★     | Real wiring across 2–3 files, but the shape is established by existing code                 | Mid model (Sonnet-class)                                                  |
| ★★★    | Architecture-shaping, cross-cutting, or a fiddly orchestration port; mistakes are expensive | Strongest model (Opus/Fable-class), and worth Kim's review before merging |

Every task follows CLAUDE.md conventions (ES modules, pure logic stays
Node-testable, one responsibility per file), keeps the Node suites green
(`node --test Website/MissionPlanner/core/tests/*.test.js`,
`modules/tests/*.test.js`, `ui/tests/*.test.js`,
`Website/Shared/tests/*.test.js`), and browser-verifies via `serve.bat` at
`http://localhost:8000/MissionPlanner/planner.html`.

---

## Settled rules

Phase seams, timelines, waypoint impulse controls, coast edit-commit
semantics, and the technology-platform structure are decided and documented
in [`Notes-and-Obsolete/decisions.md`](../../Notes-and-Obsolete/decisions.md)
under "Mission Planner." Several packages below depend on those rules; they
are not restated here.

---

## Work packages

Build order: **WP-1 → (WP-2 ∥ WP-3) → WP-7 → WP-6 → WP-5 / WP-8 → WP-4 /
WP-9**, then WP-10. WP-1 is the spine most other packages read from. WP-8.1
gates WP-8.4 — the platform shape must exist before new platforms are written,
or the savings evaporate. 

### WP-1 — Phase timing spine

- [x] **1.1 Seam derivation.** ★★
  A pure, Node-tested helper computing `Δt` and the seam from the live
  closest-approach event `transfer-leg` emits, with the no-encounter fallback
  to the plan's arrival epoch. **No stored field and no save-format change** —
  it is recomputed with everything else. Gates 1.2, 1.3, 1.5 and WP-7.
  `core/arrival-seam.js`: `computeArrivalSeam({ destination, events,
  fallbackArrivalJd })` reads the destination's `closest-approach` event
  (`kind`/`body`/`vInf`/`rmin`, now attached in `transfer-leg.js`'s
  `coastStretch`) and returns `{ hasEncounter, jd, deltaDays, start, end,
  vInf, rmin }` — `start` is 1.2's Coast-slider end, `[start, end]` is 1.3's
  Arrival window. No encounter: the window collapses to a point at
  `fallbackArrivalJd`, no `Δt`.
- [x] **1.2 Coast slider ends at the seam; chevron clamped.** ★★
  `coastSpan` in `mission-view.js` currently runs to the frozen arrival event.
  Its right edge becomes the seam, and the chevron cannot be scrubbed past it
  while the Coast phase is active — the drawn line continues regardless. The
  edge moves as the encounter shifts.
  `mission-view.js`'s `coastSeam()` calls `computeArrivalSeam` (1.1) against
  the transfer-leg stage's own events + the frozen plan's arrival commitment
  as fallback; `coastSpan`'s right edge is `seam.start`. `transfer-leg.js`'s
  `draw()` re-derives the same seam from its own `leg.events` +
  `params.destination` to clamp the chevron, gated on a new `snap.phase`
  field so the clamp only holds while Coast is the active phase.
- [x] **1.3 Arrival timeline.** ★★★
  The Arrival phase's own clock control, and the third slider: a window
  `[closest approach − Δt, closest approach + ~1 day]` that slides bodily as
  the coast is tuned. `ui/phase-slider.js` already has the primitives; what is
  new is a span where *both* edges recompute.
  `ui/phase-slider.js` gains `arrivalSliderState`/`createArrivalSlider`, the
  third sibling of the coast and departure pair, plus `approachStamp` — the
  playhead reads **signed time relative to closest approach** (`-2 d 06:00`),
  not "T+" since the phase began, since neither edge is a fixed anchor.
  Closest approach is marked on the track (`.mp-mark-ca`). `mission-view.js`'s
  `arrivalSpan()` feeds it `coastSeam()`'s `[start, end]` and `jd` every
  recompute; arrival-phase flight events become marks, and those outside the
  window are dropped (most of them, until 7.1 makes the arrival leg the
  coast's true continuation). **The date bar is now a fallback, not the
  Arrival phase's clock**: it appears only while the seam has no encounter to
  bracket and the window collapses to a point (1.1's fallback), so the phase
  is never left without a clock.
- [x] **1.4 Departure timeline: the Earth/Moon procedure, and two marks.** ★★
  Add the pinned-start / floating-end procedure alongside the existing
  anchored-end one, selected by whether the origin's departure depends on a
  satellite. Both the committed hand-off and the predicted SOI exit render as
  marks on the track, whichever procedure frames the span.
  `mission-view.js`'s `departureSpan()` picks by `missionOriginBody() ===
  "Earth"` (the same test `departureFrameFor()` uses): Earth/Moon pins the
  left edge at `releaseAnchorFor()` and floats the right edge at the live
  flight's predicted SOI exit (or the default estimate before one resolves);
  other origins anchor the right edge at the plan's committed hand-off and
  float the left edge back by the known or estimated flight duration. The
  committed hand-off is added as its own mark (`mp-mark-committed` in
  `planner.css`) alongside the flight's own events; a mark landing exactly on
  an edge drops out via `departureSliderState`'s existing interior-only
  filter, so it isn't drawn twice.
- [x] **1.5 Arrival boundary stage.** ★★★
  The mirror of `frozen-plan` at the Coast→Arrival seam: one comparison of the
  delivered approach against the commitment, non-blocking, reported through
  the warnings channel. Reuses the boundary flag in `core/recompute.js`.
  `modules/arrival-boundary/`, a paramless stage between `transfer-leg` and the
  arrival phase, `boundary: true`, reading the commitment through
  `frozen-plan`'s `arrivalCommitmentFor`. Three rows — **encounter** (did the
  coast get there, at `transfer-leg`'s own `MISS_WARN_AU`), **v∞** (against the
  committed approach speed, `ARRIVAL_VINF_TOL` 10 m/s) and **epoch** (against
  the plan's `handoffWindowDays`, reached via the new `handoffWindowFor`) —
  each deviation one warning, on the stage's own sidebar card in the Arrival
  phase. **It measures but never substitutes**: the delivered ship-state passes
  through untouched, unlike `frozen-plan`, because the arrival phase refines
  the approach the coast actually flew, and the commitment fixes no approach
  direction to synthesize a stand-in from. Chain change → save format **v4**;
  `core/world.js`'s `migrateV3toV4` inserts the stage after each `transfer-leg`.
- [x] **1.6 Design-doc edit: the seam's definition.** ★
  Restate the Coast section's formula as a window around closest approach:
  the destination's own SOI **radius** (Earth's own for an Earth arrival),
  divided by approach speed, clamped to 2–5 days, measured back from closest
  approach rather than from the plotted arrival date.

### WP-2 — The ship card

The design's central new interaction, and where "on course" is signalled.
**2.1 waits on Kim's gizmo sketch.** Build the Departure context first — it
defines the success condition the other two borrow.

- [ ] **2.1 Shared ship card + three.js gizmo widget.** ★★★ — *needs Kim's
  sketch.* A floating card in the pane with its own small three.js gizmo:
  labelled axes, arrows drawn along them, a checkbox snapping the gizmo's
  orientation to the main pane's camera, and free rotation by dragging inside
  it when unchecked. One widget, per-phase adapters supply content.
- [ ] **2.2 Departure context.** ★★★
  Plan impulse per axis (axis length) vs what the current tech stack and
  waypoints deliver at hand-off (arrows along each axis); the required heading
  arrow (length = required speed) and the current heading arrow; prograde
  speed at the chevron. On-course state shown in the card's top-right corner
  and by the gizmo's background colour. Pairs with the yellow required-heading
  arrow at the trajectory's hand-off end.
- [ ] **2.3 Coast context.** ★★
  Prograde speed; distance at closest approach; the angle separating the ship's
  and the destination's vectors; the delivered arrival-heading arrow against an
  ideal-heading arrow aimed at a low orbit altitude at closest approach.
  Clicking a waypoint in the pane focuses the gizmo on that point's axes.
  A third arrow (relative angle to the destination's orbital prograde) is an
  open question — build it behind a toggle and judge after use.
- [ ] **2.4 Arrival context.** ★★
  Ship speed at the chevron. Reserve the layout for approach data against a
  capture platform (open question — see below).
- [ ] **2.5 Chevron on the departure and arrival trajectories.** ★★
  Driven by the phase clock, as the coast chevron already is. Includes the
  yellow required-heading arrow at the departure trajectory's hand-off end.

### WP-3 — Panes, floats and camera

- [x] **3.1 Draggable floating panes.** ★★
  `mission-view.js`'s `bindFloatDrag` (pointerdown/move/up, a >3px move
  threshold to tell a drag from the existing click-to-swap-main) drags a float
  anywhere within `.mp-scene`, clamped to stay fully inside it. Floats start
  stacked top-right (`positionFloatDefault`, expressed as CSS `right`/`top` so
  it resolves correctly even while the mission tab is still hidden); a drag
  converts that pane to explicit `left`/`top`. No position persistence —
  floats reset to the default stack on reload, same as before.
- [x] **3.2 Per-phase pane arrangement.** ★★
  Departure: origin system main, solar-system float, destination float.
  Coast: heliocentric main, origin float, destination float. Arrival:
  destination system main, with the other two frames as floats too. The
  destination float must be legible enough to judge the pass while staying in
  the Coast phase.
- [x] **3.3 Float scene rendering + resizing.** ★
  Floats were rendering their scene correctly all along (scissored off the
  shared canvas, same as the main pane) but `.mp-float`'s own opaque DOM
  background sat in front of that canvas region and hid it, leaving only the
  DOM label layer and caption visible. Fixed by dropping the DOM background;
  floats also now render their frame's cam cropped to `FLOAT_ZOOM` (0.5×
  radius, same orientation/target) so the area of interest stays legible at
  pane size instead of showing the same wide framing as the main pane, shrunk.
  Added a bottom-right corner grip (`bindFloatResize`) for free resizing,
  clamped to a minimum and to the scene's own edges; not persisted, same as
  float position.
  Dropping that background exposed a second, latent bug the opaque box had
  been masking: the main pane's caption/HUD/events-dropdown (and its current
  frame's label layer) carry an explicit z-index with no ancestor stacking
  context to confine them, so they paint as a global layer — correctly below
  `.mp-floats`, but a transparent float no longer occludes what's beneath it,
  so that text bled through wherever a float's rect overlapped it (easier to
  trigger now that resizing can push a float's edge under it). Fixed by
  recomputing a `clip-path` on the main pane every render tick, punching a
  hole for each float's current rect (`updateMainOcclusion`) — hides the
  bleed-through without touching the shared canvas, which floats still read
  from directly.
- [ ] **3.4 Camera controls inside floating panes.** ★
  Currently click-to-swap only; each float needs its own bound controls, so a
  mini-view can be rotated in place.
- [ ] **3.5 Click-to-focus and follow.** ★★
  Clicking a body, the chevron, or an × mark focuses the camera there and
  orbits/zooms around it until a click elsewhere in the pane restores default
  movement; clicking the chevron also makes the camera follow it as its
  timeline is scrubbed. In Arrival, double-clicking the destination zooms in
  and rotates around it. Clicking a tech platform zooms close enough to watch
  it respond to parameter changes.
- [ ] **3.6 Dimmer trajectory extension, drawn consistently.** ★
  The ~10°-past-the-destination continuation is currently drawn sometimes and
  not others. Make it unconditional wherever a leg has a destination.

### WP-4 — Ephemeris tab

- [ ] **4.1 Remove the Track mode.** ★
  Kim: unused in practice. Removes a mode from the marker card's state
  machine and its help text.
- [ ] **4.2 Shift-click Free keeps the target impulse values.** ★
  Plain Free restores the user's pre-target values, as now.
- [ ] **4.3 Rename 'dive in' to 'with flyby'.** ★
  In the departure-course field and anywhere the phrase surfaces.
- [ ] **4.4 Add-waypoint places the waypoint at the chevron.** ★
  In the departure phase's sidebar, "add waypoint" creates it at the chevron's
  current location rather than a fixed default.
- [ ] **4.5 Mission-link data survives across sessions.** ★★
  Copied link data pasted back after a restart must reload the mission
  parameters. Verify the round trip and harden whatever doesn't survive.
- [ ] **4.6 Bodies must move as the marker slider is scrubbed.** ★★
  Bug, not a design question. `updateMarker()` moves the chevron and the
  destination × mark along the trajectory by `tof` (time past
  `dateState.jd`), and even labels the × with the resulting arrival date —
  but never calls `frame.place()`, so the planets stay frozen at
  `dateState.jd`. The destination body is not actually where the × mark
  claims it will be. `onSliderChange` (and `followCrossing`/Target-mode's
  own moves) need to advance body positions to `dateState.jd + tof/DAY` in
  step with the marker, in `ephemeris-view.js`.

### WP-5 — Departure sidebar and technology

- [ ] **5.1 Parameter interfaces on tech cards.** ★★ (per platform)
  Each loaded technology card gets the controls that set the impulse it
  imparts. Depends on WP-8.1's platform shape.
- [ ] **5.2 Context-sensitive add-on options.** ★★
  A small ring mass driver or spin launcher can be added as a second layer on
  an appropriate base platform (space elevator, skyhook). The dropdown filters
  its options by a rule set describing which combinations are realistic.
- [ ] **5.3 Departure waypoint placement rules.** ★★
  Up to two, no snap points: the first appears at the midpoint of the
  trajectory established by the cards above it and slides end to end; the
  second appears at the midpoint of what remains and slides from the first to
  the end of the leg.
- [ ] **5.4 Simple platform renderings.** ★★ (per platform)
  Enough geometry to show how a platform works and where the ship starts from.

### WP-6 — Coast refinement

- [ ] **6.1 Constrained fine-tune waypoint card.** ★★★
  Per the settled rules: ±100 m/s axes at 0.1 m/s steps with shift-drag,
  numeric entry and arrow-key nudges; a ±5° position slider above the axes; a
  timing bar below, zero-centred, showing the arrival-time shift the current
  working edit implies.
- [ ] **6.2 Session-level commit: snapshot, live preview, Update, Revert.** ★★★
  Update enables only when the working state's outcome beats the snapshot's —
  closer at the recalculated closest approach, or better vector alignment
  without leaving the 0.0002 AU innermost ring. Depends on 6.1.
- [ ] **6.3 Add coast waypoints when none exist.** ★
  First at the trajectory midpoint, second halfway along the remainder; then
  they behave as above.

### WP-7 — Arrival phase

- [ ] **7.1 Rebuild the arrival leg as the true continuation of the coast.** ★★★
  `modules/arrival-leg/` currently constructs a *reference* flyby — one day
  out, periapsis pinned at SOI/2, deliberately discontinuous with the coast.
  The design needs the real thing: the leg starts at the seam from the coast's
  delivered state, integrates under the destination's gravity (RK4), and the
  pass position is whatever the coast delivers. `Shared/body-leg.js`'s
  `integrateEncounter` already does this physics for the coast; this is
  re-pointing the arrival leg at it. Depends on 1.1.
- [ ] **7.2 Reference-frame toggle.** ★★
  Destination-centred ↔ heliocentric, for orientation during approach work.
- [ ] **7.3 Capture-technology dropdown.** ★★
  Skyhook, space elevator, tug; a ring mass driver or spin launcher addable as
  a second layer on the first two, by the same rule set as 5.2. Options appear
  as the platforms are built. Depends on WP-8.1.
- [ ] **7.4 Catch phasing set at the capture point.** ★★
  The platform's sweep through its orbit or rotation is established by the
  phase the user chooses at the capture point; scrubbing the timeline moves it
  from there. Deliberately avoids forcing the user to time the flyby to the
  platform's position.
- [ ] **7.5 Earth arrival specifics.** ★★★
  The Moon shown with any chosen platform, the same gravity treatment the
  departure phase uses, and aerobraking displayed as a colour change on the
  trajectory segment inside the atmosphere, with waypoint burns tunable there.
  Source: `Calculators/Earth-Aerobrake-Calculator/`.

### WP-8 — Platform library and calculator links

- [ ] **8.1 Platform module shape: shared spec + role adapters.** ★★★
  Per the settled rule. Migrate the skyhook onto it first — `arrival-skyhook.js`
  already imports `tetherGeometry` from `orbital-skyhook.js`, so most of the
  move is pushing the rest of the shared substance down and leaving two thin
  shells. **Gates 8.4, 5.1, 5.4 and 7.3.**
- [ ] **8.2 Link-to-calculator toggle with two-way sync.** ★★★
  A toggle on each tech card: when on, and the matching calculator is open with
  impulse-related parameters set for the correct body, import them; thereafter
  changes on either side stay synchronized until the toggle is turned off or
  the card removed. Receive-side pattern:
  `Calculators/Skyhook-Spin-Launcher/skyhookSpinLauncher.js`. Note that
  continuous sync is a step beyond the one-shot receive that pattern
  implements.
- [ ] **8.3 Send to calculator.** ★
  The reverse direction — push the parameters found by playing in the app out
  to the relevant calculator. Producer pattern:
  `Calculators/Gravity-gradient-skyhooks/`.
- [ ] **8.4 New platforms.** ★★★ each — depends on 8.1.
  Space elevator, tug, ring mass driver, mass driver, tip spin launcher,
  aerobrake. Each arrives with whichever roles apply. Calculator sources are
  listed in the inventory below.

### WP-9 — Shell and missions

- [ ] **9.1 Example-mission dropdown.** ★★
  The top pane's button for opening a mission from a small set of curated
  examples. (The design reads as though this exists; it does not — only the
  duplicate-current-mission "+" does.) Includes curating the examples
  themselves.
- [ ] **9.2 Mission-creation dialog review.** ★
  Naming, standard name, "Create mission tab" — verify against the design's
  description and close any gaps.

### WP-10 — Documentation

- [ ] **10.1 README and ARCHITECTURE re-sync.** ★★
  `README.md` is substantially stale — it still describes `lunar-skyhook`, an
  Ephemeris tab that is "a stub", five modules, and no arrival phase. It
  becomes the only current-state document once the old task doc is deleted, so
  it must describe what actually exists, in this doc's vocabulary.
- [ ] **10.2 Delete `MissionPlannerTasks.md`.** ★ — Kim's action.
  Once this doc is in place and 10.1 has landed.
- [ ] **10.3 In-context tips groundwork.** ★★
  The design mentions future advisory texts in several places. First
  candidates: the departure trajectory-period cap; "final targeting precision
  is the arrival phase's job, not the coast's"; the realism note about timing a
  flyby to a platform's position (7.4).

---

## Open design questions

Carried from the design doc's underlined passages and this conversation. None
of these block the packages above; each wants a decision before its own task
is written.

1. **Third arrow in the coast gizmo** — the relative angle between the ship's
   path and the destination's orbital prograde. Kim wants to use it before
   judging its worth; ship it behind a toggle (2.3). Related: whether the
   first waypoint should carry an approach-angle control, or only the second.
2. **Arrival approach data on the ship card** — likely the best home for the
   figures a skyhook, elevator, tug, spin launcher or ring mass driver
   rendezvous needs. Waits on the capture-interface engineering, which Kim
   plans to work through once the app is usable enough to explore it.
3. **Moon plane-change term** — whether the Ephemeris tab's moon widget should
   also show the small plane change the Moon's inclined orbit imparts.
4. **Coast approach strategy** — what approach geometries actually work best,
   to inform both the card's readouts and future advisory text.
5. **Extra Δv for epoch drift** — whether a departure route that costs ≥10 m/s
   because of hand-off epoch drift should add an explicit requirement to the
   coast, and where that is flagged.
6. **The Δt clamp** — 2 days at the bottom is Kim's own figure; the 5-day cap
   is a judgement call made to keep gas-giant arrivals from running months.
   Worth revisiting once a tug or other assisted approach is modelled, since
   how far out the arrival phase needs to begin is ultimately an operational
   question about the capture hardware (see question 2).
7. **"Hold approach while moving"** — an opt-in toggle that re-solves a coast
   waypoint's burn as its position slider moves, keeping the encounter fixed.
   Design-first, explicitly **not** default behaviour. The Ephemeris tab's
   Target-mode waypoint compensation is the precedent, and its Lambert solve
   is the machinery.

---

## Inventory: code to adapt

### Shared libraries — import, don't rewrite

| Module                                    | Exports worth knowing                                                                                                                                        | Tasks              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `Shared/sim/marker-card.js`               | `makeShipSprite`, `makeXMarkSprite`, `orientMarkerSprite`, `buildMarkerCard`, `bindRelativeDragSlider`, `markerFraction`, `refineApproach`, `followCrossing` | 2.1, 2.5, 4.1, 4.2 |
| `Shared/sim/burn-widget.js`               | `createWaypointGizmo` (prograde/radial/normal triad), `makeBurnArrow`                                                                                        | 2.1, 5.3, 6.1      |
| `Shared/sim/vector-editor.js`             | `buildVectorEditor` — the isometric 3-axis draggable burn editor                                                                                             | 5.3, 6.1           |
| `Shared/sim/approach-markers.js`          | ring sprite, `pickProximityTier`, `applyTierToSprite`                                                                                                        | 2.3, 6.2           |
| `Shared/sim/readout-panes.js`             | `renderReadoutBoxes`, `positionReadoutBoxes`                                                                                                                 | 5.3, 6.1           |
| `Shared/sim/date-bar.js`                  | `createDateBar`, `setJd`, `enableShiftDrag` — the 10×-slower fine-drag and wheel-scrub model                                                                 | 1.3, 1.4, 6.1      |
| `Shared/sim/camera-controller.js`         | `bindCameraControls` (returns an unbind)                                                                                                                     | 3.4, 3.5           |
| `Shared/sim/body-renderer.js`             | `worldSizeAtPointForPx` — constant-pixel sprite sizing; label/scale updates                                                                                  | 2.5, 3.2           |
| `Shared/body-leg.js`                      | `integrateEncounter`, `integrateTrajectory`, `buildIntegratedLeg`, `localFrameAt`, `bodyConstants`                                                           | 7.1                |
| `Shared/geo-leg.js`                       | `stateAtLegTime`, `burnEffect` — the ecliptic-anchored burn convention every waypoint editor means by its axes                                               | 6.1, 7.1           |
| `Shared/kinematic-chain.js`               | the carrier-chain shape and its evaluator                                                                                                                    | 8.1                |
| `Shared/frames.js`                        | `localToHelio` / `helioToLocal` / `convert`, `bodyHelioState`                                                                                                | 1.5, 7.1, 7.2      |
| `Shared/exchange.js`, `exchange-types.js` | `Exchange.send/accept/pending/consume/linkFor`, `PacketTypes.make/validate`                                                                                  | 8.2, 8.3           |
| `Shared/math-utils.js`                    | `sphereOfInfluence`, `hohmann`, `coastTimeToRadius`, snap-to helpers (`apsisFromBurn`, `nodeInfo`, `snapTargetNu`, `timeToTrueAnomaly`, `snapTau`)           | 1.1, 6.2           |

### Planner-local patterns to extend

| Source                                            | What it gives                                                                                                                             | Tasks                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `ui/phase-slider.js`                              | `createSegmentedSlider` (+ `setMarks`), `coastSliderState`, `departureSliderState`, `elapsedStamp` — pure halves are Node-tested          | 1.2, 1.3, 1.4        |
| `mission-view.js`                                 | `coastSpan` / `departureSpan` / `departureEvents`, `PHASE_FRAME` + `resolveFrameId`'s symbolic tokens, `swapTechStage`, `buildStageViews` | WP-1, 3.2, 5.2, 7.3  |
| `scene-frames.js`                                 | `buildHelioFrame`, `buildEarthMoonFrame`, `buildBodyFrame`                                                                                | 3.2, 7.5             |
| `core/freeze.js`                                  | the freeze contract and its timing fields                                                                                                 | 1.1                  |
| `core/recompute.js`                               | the boundary flag and the warnings/events envelope                                                                                        | 1.5                  |
| `modules/transfer-leg/transfer-leg.js`            | the module template: pure compute + descriptor + card-building `init` + `draw`; `computeLeg`'s encounter scan and `stateAtElapsed`        | 1.5, 7.1, 8.1        |
| `modules/orbital-skyhook/` + `arrival-skyhook.js` | the two halves 8.1 unifies; `tetherGeometry` is already shared                                                                            | 8.1                  |
| `ui/tech-options.js`                              | the body-tagged option table the dropdowns filter                                                                                         | 5.2, 7.3             |
| `ephemeris-view.js`                               | the marker/target state machine, Lambert `applyTargeting`, the moon widget                                                                | 4.1, 4.2, question 7 |

### Calculator sources for platforms (WP-8.4)

`Space-Elevator-Calculator`, `Mass-Driver-Launch-Calculator`,
`Tip-Spin-Launcher-Calculator`, `Skyhook-Spin-Launcher`,
`Moon-L1-Elevator`, `Earth-Aerobrake-Calculator`,
`Gravity-gradient-skyhooks`, `Tether-geometry`.
Trajectory-side ports: `Moon-Skyhook-Trajectory-Plotter`,
`Mars-Phobos-Skyhook-Trajectory-Plotter`,
`Solar-System-Trajectory-Plotter`.
