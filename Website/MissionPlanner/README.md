# Website/MissionPlanner — the integrated simulator shell

This folder is where the standalone calculators compose into one mission
simulator — see [`../ARCHITECTURE.md`](../ARCHITECTURE.md), "Migration path"
step 4, and `MissionPlannerDesign.md` in this folder, Kim's UI design the
shell follows (phase-based mission tabs, comply mode). **Current status:
headless core (step 4.1) + phase-layout mockups (step 4.2, direction chosen:
mockup A, plain phase buttons) + the scaffold UI with the first two modules
(step 4.3) + the worked-example preset and share-link load path (step 4.4's
mechanism half; curation waits for the fuller interface) + the multi-mission
tab bar with persistence across reloads (build-out tasks A1–A3) + real
phase-driven mission tabs with a date-scaled Coast slider (tasks B1–B2).**
`core/` is pure logic with Node tests, so the recompute/blocked
semantics were verified before any UI existed; `planner.html/css/js` is the
deliberately-plain, disposable shell over it; `modules/` holds the five
mission modules (the departure carrier chain — moon-platform, lunar-skyhook,
departure-leg, task I3 — plus frozen-plan and transfer-leg); `mockups/`
holds the disposable step-4.2 layout mockups (see
its README; `mockups/chain-strip/` is an earlier, superseded round).

## core/ — the headless mission core

Pure ES modules, named exports, no DOM. One responsibility per file:

| File             | Named exports                                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `world.js`       | `createWorld`, `deserializeWorld`, `WORLD_KIND`, `WORLD_VERSION` | World — the single source of truth: `jd` (one clock) + the mission profile (ordered stages with stable, never-reused ids). Every mutation goes through the one choke point, `world.set(change)`; listeners get `{ change, index, id, transient }` where `index` is where "dirty" starts. Versioned serialization; a save is **always storable**, feasible or not, known modules or not.                                                                                      |
| `diagnostics.js` | `makeDiagnostic`, `isDiagnostic`, `DIAGNOSTIC_KIND`              | The structured-diagnostic model: `{ kind, stageId, code, message, values, fix? }` — what a stage's `update()` returns instead of a packet when the mission is infeasible. Plain and JSON-able, distinguishable from a packet by `kind`.                                                                                                                                                                                                                                      |
| `registry.js`    | `createRegistry`, `validateDescriptor`                           | The module registry. Validates a descriptor's `id`/`title`/`accepts`/`emits`/`update` at registration (packet types checked against `PacketTypes`, so typos fail loud and early); view-facing fields (`rendersIn`, `init`, …) are optional and unexamined here. An *unregistered* id in a profile is user data, not an error — the engine reports it as a diagnostic.                                                                                                        |
| `recompute.js`   | `createEngine`                                                   | The chain-recompute engine. Subscribes to the World; on any change recomputes from the dirty index **downstream, in order, synchronously**. Per-stage results keyed by stage id: `ok` (with the output packet), `diagnostic`, or `blocked` (waiting on the failed stage, `update()` not called, params intact); results also carry `warnings` and `events` arrays (see the module contract below). Locks the World during a pass, so modules cannot `set()` from `update()`. |

Engine-generated diagnostic codes: `unknown-module`, `missing-input`,
`input-type-mismatch`, `module-error` (an `update()` that threw),
`bad-output`. Module-authored diagnostics use their own codes.

### The module contract (headless part)

A stage's module is called as `update(ctx, input)` where
`ctx = { world, jd, stageId, params }` and `input` is the upstream stage's
output packet (or `null`). It returns an output packet built with
`PacketTypes.make` (of a type listed in its `emits`), or `null` (nothing to
pass downstream), or a diagnostic built with `makeDiagnostic`. This is a
deliberate refinement of the `update(world, input)` sketch in
ARCHITECTURE.md: the same module can appear at more than one stage (two
transfer legs), so each call carries *that stage's* params and id.

It may instead return an **envelope**, `{ packet, warnings, events }`
(added 2026-07-09 for comply mode — see `MissionPlannerDesign.md`):

- `packet` — anything a bare return accepts (packet / `null` / diagnostic;
  a diagnostic still fails the stage hard and drops the envelope's extras).
- `warnings` — diagnostic-shaped objects that do **not** block downstream.
  This is comply mode's reporting channel: the frozen-plan stage keeps
  emitting its own output while carrying "the tech misses the plan by X"
  here. `stageId` is filled with the authoring stage's id when absent; set
  it explicitly to aim a warning at another stage.
- `events` — `[{ jd, label, ... }]` timeline entries (finite `jd`,
  non-empty `label`, extra fields pass through) for the phase sliders and
  the events bar.

Malformed `warnings`/`events` are authoring errors and fail the stage with
a `bad-output` diagnostic. Hard-failure blocking semantics are unchanged
throughout: diagnostics (module-authored or engine-generated) still block
every downstream stage, params intact.

Imports from `../../Shared/` (`exchange-types.js`); this folder breaks if
moved without `Website/Shared/` coming along.

## The scaffold shell (step 4.3, refactored by task A1)

`planner.html` + `planner.css` + `planner.js` + `mission-view.js` — view at
`http://localhost:8000/MissionPlanner/planner.html` via `serve.bat` (or the
deployed site). Since task A1 (the first step of the build-out plan in
`MissionPlannerTasks.md`) the shell is split in two:

- **`planner.js`** is the multi-mission host: the shared module registry, the
  ONE renderer/canvas (browsers cap live WebGL contexts), the initial mission
  load (task A3 — persisted missions merged with a share-link fragment, or
  the shipped preset) with its failure banner, the tab bar (task A2 —
  Ephemeris tab + one tab per mission, active highlight, confirm-then-close),
  and the render loop, which only drives the active mission's view.
- **`mission-view.js`** exports `createMissionView({ world, registry,
  renderer, container, template, missionId, defaultMain })` — everything that
  belongs to one mission: its World + engine, frames, panes, sidebar cards,
  date bar, plan-compliance bar, events bar, share button, and its slice of
  workspace persistence. Returns `{ world, engine, root, show, hide, render, resize,
  dispose }`; N instances coexist, one per future mission tab. Its DOM is
  cloned from `planner.html`'s `<template id="mp-mission-template">`, which
  is addressed by class, never id (ids can't repeat across instances).

Decisions recorded with A1: **frames are per-mission** (each view builds its
own helio/Earth–Moon scenes and cameras — sharing scenes would mean swapping
stage view groups and camera poses on every tab switch, and `viewAdded`/
`draw` assume a persistent group); only the renderer/canvas is shared —
`show()` re-parents the canvas into the active view's scene element, and
only the active view renders. The modules' draw caches are keyed **by World
first** (a `WeakMap`), because coexisting missions reuse stage ids like
"stg-2"; `legFor`/`physicsFor` take `(world, stageId)`.

Per mission view: **scissored panes** (a main pane plus floating,
click-to-swap panes, each rendering one frame — `"helio"` and
`"body:Earth-Moon"` so far), a **date bar** (`Shared/sim/date-bar.js`)
writing `world.set({jd})` — Departure/Arrival's clock control until B3 —
plus the **Coast slider** (task B2, `ui/phase-slider.js`) that replaces it
during the Coast phase: a date-scaled track spanning the departure/coast
phases' own events (not a frozen plan — C1 doesn't exist yet), with a
click/drag-scrubbable playhead that pins at either end when the clock falls
outside the span, real **phase buttons** (task B1 — `workspace.phase ∈
{departure, coast, arrival}`, driving the main-pane frame via `PHASE_FRAME`,
which sidebar cards show, which slider shows, and the active highlight;
Arrival stays disabled until an arrival module exists to give it a frame), a
**plan-compliance bar** (task C2 — `.mp-compliance-bar`, replacing the
scaffold's original stage strip, which was just buttons that scrolled to a
sidebar card) showing the frozen-plan stage's live PLAN REQUIRES → TECH
DELIVERS comparison (v∞, epoch, aim) as a chip plus compact per-row metrics,
not phase-gated — reached via `registry.get("frozen-plan").complianceFor`
so the module stays dynamically loaded rather than statically imported; the
phase buttons' own status dots (`renderPhaseDots`, worst-status-wins per
phase) are unrelated and unaffected. An **events bar** fed by the
envelope's `events` channel (click an event to set the clock), and
**sidebar cards** — one per stage, now filtered to the active phase via each
stage's `rendersIn` frame (`stagePhaseOf`); the module builds its controls in the card
body, the shell renders status chips and diagnostics/warnings uniformly
(engine- and module-authored ones look identical, as the core intends).

The scaffold remains **disposable** (the World boundary is what makes
rebuilding it safe): the tab bar (task A2) switches between the Ephemeris tab
(a stub — its real content is WP-D) and mission tabs, and closing a mission
tab confirms then disposes it — permanently now that missions persist (task
A3), there's still no undo. There's no way to *create* a mission tab yet
though (that's E2's "Start Mission Plan" flow); until then the mission count
only ever goes down from whatever's restored (or the shipped preset, or a
share-link import) at load. Layout/camera state ("workspace") lives in
`localStorage` (`mw-missionplanner-workspace`, version 2: `{ missions: { id
-> { main, cams } } }`, one slot per mission, read-modify-write so slots
survive each other; a version-1 save is adopted as mission `"m1"`'s slot),
never in World — a **separate key** from mission-content persistence (see
below); swapping a pane into the main window is layout-only.
`Shared/sim/camera-controller.js`'s `bindCameraControls` now returns an
**unbind** function so `dispose()` can detach its window-level listeners
(the standalone plotters ignore it).

### The worked-example preset + share links + mission persistence (step 4.4 + task A3)

`planner.js`'s `initialMissions()` decides what's open at load, in order:
persisted missions from `localStorage` (`mw-missionplanner-missions`, one
versioned key holding every mission's shell-level title + `world.serialize()`
— the World has no name field of its own), merged with a share-link fragment
if the URL carries one (`#mission=<base64url JSON>`, decoded with
`Shared/exchange.js`'s `encodeFragment`/`decodeFragment`, rebuilt with
`deserializeWorld`), else `presets/default-mission.js` (a serialized World
checked in as plain data) when there's nothing saved and no fragment. A
fragment is added as a new **"Imported mission"** tab alongside whatever's
already saved, never replacing it (a share link opens in a new tab, so it
shouldn't erase existing work); a bad or too-new fragment, or an unreadable
saved entry, drops just that one item with a dismissible banner, never a
blank page. `saveMissionsStore()` persists the whole store back on
`pagehide` and immediately after any structural change (a mission added or
closed via the tab bar, task A2), so a reload never loses more than
in-flight edits since the last save. The **"Copy mission link"** button
serializes the current World into the same fragment, so the round trip is
one code path, as the architecture doc wanted. Editing the hash of an open
page does nothing until reload (fragments are read once, at load).

The shipped preset is Kim's **Moon → Ceres 2031** design (committed
hand-off 2031-12-20 06:00, skyhook CoM 275 km / release from the 6000 km
top / phase 92°, waypoint at day 475), Lambert-tuned to a genuine
rendezvous: arrival 2034-01-08 (750 days after hand-off), miss 0.0001 AU,
3.78 km/s relative to Ceres. **Reshaped by task I3 (2026-07-16)** into the
carrier-chain profile — moon-platform → lunar-skyhook → departure-leg →
frozen-plan → transfer-leg (a serialized World **version 2**; v1 saves are
migrated on load, see `core/world.js`) — with the plan's frozen release
anchor and ±1 d hand-off window baked per WP-I's timing model. The plan's
required departure v∞ is a single true figure (6.55 km/s, folded 2026-07-14
from what used to be a separate leg-side injection burn), which the real
integrated departure honestly under-delivers (≈5.0 km/s, ≈9.6° off-aim;
the hand-off itself lands inside the window) — the shipped mission does not
comply with itself, by design: closing the gap (e.g. a low-perigee Oberth
impulse on the departure leg, task I4's UI) is the exercise the preset
teaches, and the coast still flies the frozen plan's state regardless, so
it still arrives clean. Re-curating the example (or its pane arrangement,
via `defaultWorkspaceMain`) is editing that one file.

### modules/ — the five mission modules

Each module is a folder whose script default-exports its descriptor
(dynamic-`import()`ed by the shell), per ARCHITECTURE.md "Module interface".
Since task I3 (WP-I) the departure system is a CARRIER CHAIN: carrier stages
compose a serializable kinematic chain (`Shared/kinematic-chain.js`, carried
in `carrier-chain` packets), and a headless leg stage integrates the
released flight with restricted N-body gravity (`Shared/geo-leg.js`). The
release EPOCH is not a stage param anywhere: it is the plan's read-only
release anchor (`frozen-plan.js`'s `releaseAnchorFor` — frozen at mission
creation, never re-derived).

- **`modules/moon-platform/`** — the Moon as the departure stack's read-only
  top card (task I3): emits the chain base (`{ base: "Moon", rotors: [] }`)
  and shows the Moon's heading/impulse contribution at the release anchor
  (geocentric distance/speed, component along Earth's heliocentric
  prograde). No knobs — plan around the Moon in the Ephemeris tab. A mission
  with no anchor at all is diagnosed here, at the top of the chain.
- **`modules/lunar-skyhook/`** — the first rotating CARRIER (reshaped by
  I3). Gravity-gradient lunar skyhook: validates its geometry
  (`bound-at-moon` still diagnosed early, with a computed fix), then appends
  its rotor element (ecliptic plane, radius = release-point radius, rate =
  the CoM orbit's angular velocity, phase pinned at the anchor) to the
  incoming chain. The release phase is the *aiming* control, now an in-card
  slider. The old patched-conic release chain and its `releaseJd` param are
  gone — replaced by departure-leg's real integration.
- **`modules/departure-leg/`** — HEADLESS (task I3): no card of its own
  (`plainCard`, diagnostics only). Evaluates the carrier chain at the
  anchor, integrates forward (Earth+Moon+Sun, real ephemerides, no SOI
  kink) with up to 2 waypoint impulses applied in each leg's own local
  dynamical frame — the low-perigee Oberth pattern the patched model
  couldn't express — and emits the hand-off `ship-state` at Earth-SOI exit,
  plus the flight events (release, impulses, Moon/Earth SOI exits — the
  departure slider's real marks). A flight that stays bound or impacts is a
  hard diagnostic; nothing ever solves backwards (WP-I: every recompute is
  one forward pass; the USER closes the loop).
- **`modules/frozen-plan/`** — the frozen flight plan (task C1, comply mode).
  Its params ARE the plan captured at mission creation: origin body, the
  frozen heliocentric departure state/epoch the tech must deliver (this IS
  the coast's own starting state, full stop — no burn field of its own,
  removed 2026-07-14), the arrival commitment (body, epoch, approach v∞),
  and a reference copy of the plan's waypoint burns. `update()` **always
  emits the plan's own departure state** downstream — the coast everyone
  sees is the commitment, never a re-solve —
  and reports the tech's deviations (v∞ / epoch / aim, tolerances exported)
  through the warnings channel; an empty tech slot is itself a warning, not
  a block (`inputOptional`, below). `computeCompliance`/`complianceFor`
  expose the full required-vs-delivered rows; `complianceFor` is also
  attached to the module's registry descriptor so the shell can reach it
  without a static import (task C2's plan-compliance bar).
  The mission-view's coast slider reads this stage's departure/arrival
  events as its span, so the slider stays pinned to the frozen dates while
  live edits show up as deviations.
- **`modules/transfer-leg/`** — the canonical transfer-leg module, the Coast
  phase: the SST `computeTrajectory()` segment chain, minus its own
  departure-burn step (removed 2026-07-14 — Kim: "only a minority of the
  delta-v needed to get somewhere comes from engine burns," so the
  Departure→Coast hand-off is a given heading and speed, not a burn formula;
  see the module's own header). It just coasts from whatever ship-state it's
  handed, applying up to two waypoint burns along the way, then a final
  coast, input converted to `"helio"` via `Shared/frames.js`. A configured
  destination reports its arrival miss distance through the **warnings**
  channel (non-blocking). Snap-to and Lambert targeting stay in the plotter
  until the marker/targeting port (step 4.5).

### Module-contract refinements the scaffold added

Recorded here because they extend the "headless part" contract above:

- **`update()` stays pure; drawing is a separate `draw(view, snapshot)` hook.**
  ARCHITECTURE.md's sketch had update() also redrawing meshes, but update()
  must run under Node; the shell instead calls `draw` after every recompute
  pass, once per attached view, with `snapshot = { world, stageId, params,
  result }`. Modules cache what draw needs (samples, physics figures) per
  stageId during update() — plain data, Node-safe.
- **`ctx.onResult(cb)`** — init()'s ctx gains a subscription scoped to that
  stage's engine result, so a card can refresh its readouts without reaching
  into the engine.
- **`view.metresPerUnit`** — each view carries its frame's scene scale
  (AU for `"helio"`, 1000 km for `"body:Earth-Moon"`), so modules draw in
  scene units without hardcoding a frame's convention.
- **`attachesTo` parenting** — a module's view group is parented at its
  `attachesTo` body's node when the frame has that body (the skyhook's group
  rides the Moon), falling back to the scene root (transfer legs).
- **`inputOptional: true`** (added with task C1) — a descriptor flag telling
  the engine that missing input is survivable: update() is called with
  `input === null` instead of the stage failing with `missing-input`. Added
  for the frozen-plan module, whose plan must keep flowing (and the coast
  keep drawing) in a mission whose departure-tech slot is empty; the module
  reports the empty slot as a warning. When input does arrive it is
  type-checked against `accepts` as usual.

`core/tests/*.test.js` — `node:test` suites, 84 tests covering World
mutations/serialization (including the v1→v2 profile migration's plumbing),
registry validation, the recompute/diagnostic/blocked semantics (including
`inputOptional`), the warnings/events envelope
(`warnings-events.test.js`, including a comply-mode-shaped chain), the
departure-duration estimate (D7) and the freeze contract (E2 + its timing
fields).
`modules/tests/modules.test.js` — 27 more exercising the carrier chain and
transfer-leg modules' pure sides, chained through the actual World +
registry + engine (tether kinematics and the rotor element, the integrated
departure flight with waypoint impulses and its truncation at the hand-off,
bound/no-carrier/blocked-then-fixed cases, frame conversion, the v1-save
migration end-to-end, and the shipped preset itself: it deserializes,
rendezvouses, and survives the share-fragment round trip).
`modules/tests/frozen-plan.test.js` — 19 more on the comply semantics: the
compliance rows and their tolerances (the epoch row's hand-off WINDOW since
I3), the warning texts' numbers, `releaseAnchorFor`'s resolution order, and
— through the real engine on the shipped preset — that detuning the tech
warns on the plan while the coast's output does not move, that a mission
with no departure system still shows its whole plan, and that the baked
preset plan is internally consistent (anchor = hand-off − the freeze-time
estimate, so drift says "re-bake", not just "warnings appeared").
`ui/tests/phase-slider.test.js` — 14 more covering the pure halves of the
phase-slider widgets (tasks B2/B3): tick generation, playhead
fraction, and pinning at either end of the span. Run from the repo root:

```
node --test Website/MissionPlanner/core/tests/*.test.js
node --test Website/MissionPlanner/modules/tests/*.test.js
node --test Website/MissionPlanner/ui/tests/*.test.js
```

(If copying elsewhere to test, keep the `Website/MissionPlanner/core` +
`Website/Shared` relative layout and put a `{"type":"module"}` `package.json`
at the copy's root.)

## Not here yet

The Ephemeris tab's real content and the "Start Mission Plan" freeze flow
from `MissionPlannerDesign.md` (the frozen-plan module itself landed with
task C1; what's missing is task E2's capture of a plan into it, and task
C2's compliance-grid card), the curation half of step 4.4 (what a newcomer
should see first, once the interface can show it off), the remaining
endpoint modules (Ceres elevator, spin launcher, mass driver, aerobrake —
step 4.5, along with the marker/targeting and snap-to ports), mission
undo, and in-scene editing (waypoint gizmo drags) — see
ARCHITECTURE.md for the ordering and reasoning, and
`MissionPlannerTasks.md` in this folder for the task-by-task build-out plan
(work packages, difficulty ratings, and the inventory of adaptable code).
