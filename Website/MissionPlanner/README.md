# Website/MissionPlanner — the integrated simulator shell

This folder is where the standalone calculators compose into one mission
simulator — see [`../ARCHITECTURE.md`](../ARCHITECTURE.md), "Migration path"
step 4, and `MissionPlannerDesign.md` in this folder, Kim's UI design the
shell follows (phase-based mission tabs, comply mode). **Current status:
headless core (step 4.1) + phase-layout mockups (step 4.2, direction chosen:
mockup A, plain phase buttons) + the scaffold UI with the first two modules
(step 4.3) + the worked-example preset and share-link load path (step 4.4's
mechanism half; curation waits for the fuller interface) + the multi-mission
tab bar with persistence across reloads (build-out tasks A1–A3).** `core/` is pure logic with Node tests, so the recompute/blocked
semantics were verified before any UI existed; `planner.html/css/js` is the
deliberately-plain, disposable shell over it; `modules/` holds the first two
mission modules; `mockups/` holds the disposable step-4.2 layout mockups (see
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
  the stage strip.

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
  date bar, stage strip, events bar, share button, and its slice of workspace
  persistence. Returns `{ world, engine, root, show, hide, render, resize,
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
writing `world.set({jd})`, **phase buttons** per the chosen mockup A
(Departure ↔ Earth–Moon main, Coast ↔ helio main, Arrival greyed until an
arrival module exists), a **stage strip** with status dots, an **events bar**
fed by the envelope's `events` channel (click an event to set the clock), and
**sidebar cards** — one per stage; the module builds its controls in the card
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

The shipped preset is Kim's **Moon → Ceres 2031** design (release
2031-12-20 06:00, skyhook CoM 275 km / release from the 6000 km top /
phase 92°, waypoint at day 475), Lambert-tuned to a genuine rendezvous:
arrival 2034-01-08 (750 days), miss 0.0001 AU, 3.78 km/s relative to Ceres,
4.87 km/s total burns. Re-curating the example (or its pane arrangement,
via `defaultWorkspaceMain`) is editing that one file.

### modules/ — the first two mission modules

Each module is a folder whose script default-exports its descriptor
(dynamic-`import()`ed by the shell), per ARCHITECTURE.md "Module interface":

- **`modules/lunar-skyhook/`** — the first technology module. Gravity-gradient
  lunar skyhook; `update()` runs the patched-conic release chain (tether
  kinematics → lunar v∞ **along the tether-tangential direction at the
  release phase**, vector-summed with the Moon's geocentric velocity →
  Earth-escape v∞ → heliocentric ship-state at Earth) lifted from the
  Moon-Skyhook plotter's `releaseState()`/`computeReadouts()` math, with real
  module-authored diagnostics (`bound-at-moon`, `bound-at-earth`, each with a
  cheap computed fix). The release phase is the *aiming* control, as in the
  plotter; what the model still can't express is the geocentric leg itself
  (notably a perigee Oberth burn — see the module header). Emits
  `ship-state`; release epoch and phase are stage params, not the shared
  clock.
- **`modules/transfer-leg/`** — the canonical transfer-leg module: the SST
  `computeTrajectory()` segment chain (departure burn → up to two waypoint
  burns → final coast), input converted to `"helio"` via `Shared/frames.js`.
  A configured destination reports its arrival miss distance through the
  **warnings** channel (non-blocking) — the scaffold's default mission
  deliberately misses Ceres so the channel shows live. Snap-to and Lambert
  targeting stay in the plotter until the marker/targeting port (step 4.5).

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

`core/tests/*.test.js` — `node:test` suites, 63 tests covering World
mutations/serialization, registry validation, the
recompute/diagnostic/blocked semantics, and the warnings/events envelope
(`warnings-events.test.js`, including a comply-mode-shaped chain).
`modules/tests/modules.test.js` — 14 more exercising the two real modules'
pure sides, chained through the actual World + registry + engine (release
physics and phase aiming, blocked-then-fixed recovery, the non-blocking miss
warning, frame conversion, and the shipped preset itself: it deserializes,
rendezvouses warning-free, and survives the share-fragment round trip). Run
from the repo root:

```
node --test Website/MissionPlanner/core/tests/*.test.js
node --test Website/MissionPlanner/modules/tests/modules.test.js
```

(If copying elsewhere to test, keep the `Website/MissionPlanner/core` +
`Website/Shared` relative layout and put a `{"type":"module"}` `package.json`
at the copy's root.)

## Not here yet

The Ephemeris tab's real content and comply-mode plan freezing from
`MissionPlannerDesign.md`, the curation half of step 4.4 (what a newcomer
should see first, once the interface can show it off), the remaining
endpoint modules (Ceres elevator, spin launcher, mass driver, aerobrake —
step 4.5, along with the marker/targeting and snap-to ports), mission
undo, and in-scene editing (waypoint gizmo drags) — see
ARCHITECTURE.md for the ordering and reasoning, and
`MissionPlannerTasks.md` in this folder for the task-by-task build-out plan
(work packages, difficulty ratings, and the inventory of adaptable code).
