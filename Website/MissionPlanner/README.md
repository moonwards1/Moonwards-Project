# Website/MissionPlanner — the integrated simulator shell

This folder is where the standalone calculators compose into one mission
simulator — see [`../ARCHITECTURE.md`](../ARCHITECTURE.md), "Migration path"
step 4, and `MissionPlannerDesign.md` in this folder, Kim's UI design the
shell follows (phase-based mission tabs, comply mode). **Current status:
headless core (step 4.1) + phase-layout mockups (step 4.2, direction chosen:
mockup A, plain phase buttons) + the scaffold UI with the first two modules
(step 4.3) + the worked-example preset and share-link load path (step 4.4's
mechanism half; curation waits for the fuller interface).** `core/` is pure logic with Node tests, so the recompute/blocked
semantics were verified before any UI existed; `planner.html/css/js` is the
deliberately-plain, disposable shell over it; `modules/` holds the first two
mission modules; `mockups/` holds the disposable step-4.2 layout mockups (see
its README; `mockups/chain-strip/` is an earlier, superseded round).

## core/ — the headless mission core

Pure ES modules, named exports, no DOM. One responsibility per file:

| File             | Named exports                                            | Purpose                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `world.js`       | `createWorld`, `deserializeWorld`, `WORLD_KIND`, `WORLD_VERSION` | World — the single source of truth: `jd` (one clock) + the mission profile (ordered stages with stable, never-reused ids). Every mutation goes through the one choke point, `world.set(change)`; listeners get `{ change, index, id, transient }` where `index` is where "dirty" starts. Versioned serialization; a save is **always storable**, feasible or not, known modules or not. |
| `diagnostics.js` | `makeDiagnostic`, `isDiagnostic`, `DIAGNOSTIC_KIND`      | The structured-diagnostic model: `{ kind, stageId, code, message, values, fix? }` — what a stage's `update()` returns instead of a packet when the mission is infeasible. Plain and JSON-able, distinguishable from a packet by `kind`.                                                                                                                                              |
| `registry.js`    | `createRegistry`, `validateDescriptor`                   | The module registry. Validates a descriptor's `id`/`title`/`accepts`/`emits`/`update` at registration (packet types checked against `PacketTypes`, so typos fail loud and early); view-facing fields (`rendersIn`, `init`, …) are optional and unexamined here. An *unregistered* id in a profile is user data, not an error — the engine reports it as a diagnostic.                 |
| `recompute.js`   | `createEngine`                                           | The chain-recompute engine. Subscribes to the World; on any change recomputes from the dirty index **downstream, in order, synchronously**. Per-stage results keyed by stage id: `ok` (with the output packet), `diagnostic`, or `blocked` (waiting on the failed stage, `update()` not called, params intact); results also carry `warnings` and `events` arrays (see the module contract below). Locks the World during a pass, so modules cannot `set()` from `update()`. |

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

## The scaffold shell (step 4.3)

`planner.html` + `planner.css` + `planner.js` — view at
`http://localhost:8000/MissionPlanner/planner.html` via `serve.bat` (or the
deployed site). One renderer with **scissored views** (a main pane plus
floating, click-to-swap panes, each rendering one frame — `"helio"` and
`"body:Earth-Moon"` so far), one **shared date bar** (`Shared/sim/date-bar.js`)
writing `world.set({jd})`, **phase buttons** per the chosen mockup A
(Departure ↔ Earth–Moon main, Coast ↔ helio main, Arrival greyed until an
arrival module exists), a **stage strip** with status dots, an **events bar**
fed by the envelope's `events` channel (click an event to set the clock), and
**sidebar cards** — one per stage; the module builds its controls in the card
body, the shell renders status chips and diagnostics/warnings uniformly
(engine- and module-authored ones look identical, as the core intends).

The scaffold is **disposable** (the World boundary is what makes rebuilding
it safe) and deliberately plain: no mission tabs, no Ephemeris-tab flow, no
mission persistence, no undo — those are later steps. Layout/camera state
("workspace") lives in `localStorage` (`mw-missionplanner-workspace`), never
in World; swapping a pane into the main window is layout-only.

### The worked-example preset + share links (step 4.4, mechanism half)

On load, `planner.js` builds its World from `#mission=<base64url JSON>` in
the URL — decoded with `Shared/exchange.js`'s `encodeFragment`/
`decodeFragment`, rebuilt with `deserializeWorld` — and falls back to
`presets/default-mission.js` (a serialized World checked in as plain data)
when there is no fragment; a bad or too-new fragment gets a dismissible
banner and the default, never a blank page. The **"Copy mission link"**
button serializes the current World into the same fragment, so the round
trip is one code path, as the architecture doc wanted. Fragments are read at
page load (a share link opens in a new tab); editing the hash of an open
page does nothing until reload.

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

The mission-tab / Ephemeris-tab flow and comply-mode plan freezing from
`MissionPlannerDesign.md`, the curation half of step 4.4 (what a newcomer
should see first, once the interface can show it off), the remaining
endpoint modules (Ceres elevator, spin launcher, mass driver, aerobrake —
step 4.5, along with the marker/targeting and snap-to ports), mission
persistence/undo, and in-scene editing (waypoint gizmo drags) — see
ARCHITECTURE.md for the ordering and reasoning.
