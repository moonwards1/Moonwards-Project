# Website/MissionPlanner — the integrated mission simulator

This folder is where the standalone calculators compose into one mission
simulator. Three other documents carry the rest of the picture:

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — the general model shared with
  the calculators: modules, packets, the recompute chain, frames.
- `MissionPlannerDesign_v2.md` in this folder — Kim's UI design, what the app
  is meant to become.
- [`../../Notes/decisions.md`](../../Notes/decisions.md)
  — settled rules that cut across several files (phase seams, timelines,
  waypoint controls, the technology-platform shape), stated once there rather
  than restated here.

This README describes what the code does **now**.

**Current status:** a mission runs end to end — Departure, Coast and Arrival
are all real phases, each with its own timeline slider. The Departure→Coast
seam is a comply-mode boundary: it measures the technology's delivered
hand-off against the frozen plan without ever silently re-planning it. The
Coast→Arrival seam is an editing and display division only, with no boundary
stage — the coast targets the real destination and reports the actual
approach live, so there is nothing to grade it against. `core/` is pure logic
with Node tests, so the recompute/blocked/comply semantics are verified
independent of any UI; `planner.js` + `mission-view.js` + `ephemeris-view.js`
+ `scene-frames.js` are the browser shell over it; `modules/` holds the
mission-profile stages; `ui/` holds shell-local widgets; `presets/` holds the
shipped mission and the example-mission catalog.

## core/ — the headless mission core

Pure ES modules, named exports, no DOM. One responsibility per file:

| File                     | Named exports                                                    | Purpose                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `world.js`               | `createWorld`, `deserializeWorld`, `WORLD_KIND`, `WORLD_VERSION`  | World — the single source of truth: `jd` (one clock) + the mission profile (ordered stages with stable, never-reused ids). Every mutation goes through the one choke point, `world.set(change)`; listeners get `{ change, index, id, transient }` where `index` is where "dirty" starts. Versioned serialization (current version 4; a version that isn't exactly current is refused, never migrated); a save is **always storable**, feasible or not, known modules or not. |
| `diagnostics.js`         | `makeDiagnostic`, `isDiagnostic`, `DIAGNOSTIC_KIND`               | The structured-diagnostic model: `{ kind, stageId, code, message, values, fix? }` — what a stage's `update()` returns instead of a packet when the mission is infeasible. Plain and JSON-able, distinguishable from a packet by `kind`.                    |
| `registry.js`            | `createRegistry`, `validateDescriptor`                            | The module registry. Validates a descriptor's `id`/`title`/`accepts`/`emits`/`update` at registration (packet types checked against `PacketTypes`, so typos fail loud and early); view-facing fields (`rendersIn`, `init`, …) are optional and unexamined here. An *unregistered* id in a profile is user data, not an error — the engine reports it as a diagnostic. |
| `recompute.js`           | `createEngine`                                                    | The chain-recompute engine. Subscribes to the World; on any change recomputes from the dirty index **downstream, in order, synchronously**. Per-stage results keyed by stage id: `ok` (with the output packet), `diagnostic`, or `blocked` (waiting on the failed stage, `update()` not called, params intact); results also carry `warnings` and `events` arrays (see the module contract below). Locks the World during a pass, so modules cannot `set()` from `update()`. |
| `freeze.js`              | (see header — assembles a serialized World)                       | The "Start Mission Plan" contract: turns a plan authored on the Ephemeris tab into a fresh serialized World — `[ departure scaffold ] → [ frozen-plan ] → [ transfer-leg ] → [ arrival-leg ]` — with the departure carrier slot and the arrival-technology slot both left empty for the mission tab to fill in. The hand-off it commits is `spec.handoff` verbatim — the state the Ephemeris tab authored at the origin's SOI edge, where a departure leg actually delivers a ship — and `spec.jd` is that hand-off's own epoch, so waypoint days and the coast's duration need no re-basing. Nothing is re-derived across this seam, which is what makes the freeze/paste round trip exact. Pure; the caller resolves every view-side number first and hands in plain data. |
| `departure-estimate.js`  | (see header — estimates the departure leg's duration)              | How long the departure leg lasts, estimated from the frozen plan alone (before any departure tech is chosen): the required v∞, the hand-off epoch, and — for Earth — where the Moon is, via the dive-in/direct-out wedge rule. Feeds the read-only release anchor `freeze.js` bakes into the plan, the Ephemeris tab's Moon-phase widget, and the Departure slider's default span. |
| `arrival-seam.js`        | `computeArrivalSeam`                                               | The Coast→Arrival seam derivation: a window `[closest approach − Δt, closest approach + ~1 day]` around the coast's own closest-approach event, `Δt = clamp(R_SOI/v∞, 2 d, 5 d)`. Nothing is stored — recomputed live from `transfer-leg`'s emitted events every recompute, so the window moves as the coast is tuned. No encounter at all: the window collapses to a point at the plan's committed arrival epoch. |
| `proximity.js`           | `checkProximity`, `checkPassAltitude`                              | The arrival standards, in one place. `checkProximity` is the EPHEMERIS TAB's gate on "Start Mission Plan": the marker within `APPROACH_FAR` (0.004 AU) of the destination's orbit ELLIPSE, and the destination passing through that point within `TEMP_FAR` (30 d) — ring-scale tolerances, right for judging a scrubbable marker. `MAX_PASS_ALTITUDE` (30,000 km) is the stricter bound a FLOWN mission has to pass the body within, and `AIM_PASS_ALTITUDE` (15,000 km) is what a re-target aims for — deliberately inside the bound, so an iteration's residual has room to land. Both measured as altitude ABOVE THE SURFACE, at closest approach; both provisional until the arrival technology can state what it can actually catch. The ring tier TABLES stay with the views that draw them — those are colours and pixel sizes, not standards. Pure. |
| `delivered-flight.js`    | `deliveredFlight`, `signatureOf`, `waypointDv`                     | The flight the ship is ACTUALLY on: flown from what the departure technology delivers, through the waypoints as they stand. `frozen-plan` emits the PLAN's departure state downstream by design, so the drawn coast is the plan's flight, not the ship's — until a re-target has closed the gap they arrive in different places. One call yields every figure the mission bar shows (v∞ out, coast Δv, closest approach, v∞ in). The answer never depends on the clock, so `signatureOf` gives the view a key to memoize on across scrubbing; one call costs about one leg integration. Pure. |
| `retarget.js`            | `solveDepartureTarget`                                             | Re-states the departure REQUIREMENT at the point a technology actually leaves from: keep the real exit point and epoch, re-solve the velocity that reaches the plan's destination from there. A damped Newton differential correction across the coast's waypoint burns, aiming for a PASS at `AIM_PASS_ALTITUDE` above the destination's surface, on the side the flight already goes by — not the arrival POINT the plan was authored with, since a plan's own flyby offset stops being a commitment worth preserving once a real departure is flying the mission. Each solve is verified by flying it through `delivered-flight.js`, and the aim iterates on the altitude error it measures. The ASK is bounded by `WAYPOINT_AXIS_CAP_MPS` — a re-target that would demand more than normal course-correction scale is a new mission for the Ephemeris tab, not a plan to re-point. Feeds the mission bar's Check and Update. Pure. |

Engine-generated diagnostic codes: `unknown-module`, `missing-input`,
`input-type-mismatch`, `module-error` (an `update()` that threw),
`bad-output`. Module-authored diagnostics use their own codes.

### The module contract (headless part)

A stage's module is called as `update(ctx, input)` where
`ctx = { world, jd, stageId, params }` and `input` is the upstream stage's
output packet (or `null`). It returns an output packet built with
`PacketTypes.make` (of a type listed in its `emits`), or `null` (nothing to
pass downstream), or a diagnostic built with `makeDiagnostic`. The same
module can appear at more than one stage (two transfer legs), so each call
carries *that stage's* params and id.

It may instead return an **envelope**, `{ packet, warnings, events }` — comply
mode's reporting channel:

- `packet` — anything a bare return accepts (packet / `null` / diagnostic; a
  diagnostic still fails the stage hard and drops the envelope's extras).
- `warnings` — diagnostic-shaped objects that do **not** block downstream.
  The boundary stage (`frozen-plan`) uses this to report "the tech misses
  the plan by X" while still emitting its own output. `stageId` is filled
  with the authoring stage's id when absent; set it explicitly to aim a
  warning at another stage.
- `events` — `[{ jd, label, ... }]` timeline entries (finite `jd`, non-empty
  `label`, extra fields pass through) for the phase sliders and the events
  bar.

Malformed `warnings`/`events` are authoring errors and fail the stage with a
`bad-output` diagnostic. Diagnostics (module-authored or engine-generated)
block every downstream stage, params intact — with two descriptor flags that
refine that default:

- **`boundary: true`** — the stage is called with `input === null` instead of
  going `blocked` when its upstream failed, so a compliance seam always
  reports what it's missing (a warning it authors itself) rather than the
  whole downstream phase going grey with no explanation. `frozen-plan` is the
  one boundary stage, at the Departure→Coast seam; the Coast→Arrival seam has
  none — the coast's own live readouts (the ship card) already show whether
  the flight reaches the destination.
- **`inputOptional: true`** — the stage is called with `input === null`
  instead of failing with `missing-input` when nothing arrives; used where a
  stage must keep flowing with an empty upstream slot (the frozen plan with no
  departure tech yet).

Refinements the browser shell adds on top of the headless contract:

- **`update()` stays pure; drawing is a separate `draw(view, snapshot)` hook.**
  update() must run under Node, so the shell calls `draw` after every
  recompute pass, once per attached view, with `snapshot = { world, stageId,
  params, result }`. Modules cache what draw needs (samples, physics figures)
  per stageId during update() — plain data, Node-safe.
- **`ctx.onResult(cb)`** — init()'s ctx carries a subscription scoped to that
  stage's engine result, so a card can refresh its readouts without reaching
  into the engine.
- **`view.metresPerUnit`** — each view carries its frame's scene scale (AU
  for `"helio"`, 1000 km for `"body:Earth-Moon"`, and so on for other
  `"body:<name>"` frames), so modules draw in scene units without hardcoding a
  frame's convention.
- **`attachesTo` parenting** — a module's view group is parented at its
  `attachesTo` body's node when the frame has that body (a skyhook's group
  rides its body's node), falling back to the scene root (transfer/arrival
  legs).
- **`plainCard`** — a descriptor flag for a stage with no title/status header
  of its own, because its health is exactly its own flight's (the integrated
  departure and arrival legs use this).

Imports from `../../Shared/` (`exchange-types.js`, `math-utils.js`, …); this
folder breaks if moved without `Website/Shared/` coming along.

## The shell

View at `http://localhost:8000/MissionPlanner/planner.html` via `serve.bat`
(or the deployed site).

- **`planner.js`** — the multi-mission host: the shared module registry, the
  ONE renderer/canvas (browsers cap live WebGL contexts, so only the active
  mission's view renders), the initial mission load (persisted missions
  merged with a share-link fragment, or the shipped preset) with its failure
  banner, the tab bar (the Ephemeris tab + one tab per mission, active
  highlight, confirm-then-close, a "+" duplicate button, and the
  example-mission dropdown), and the render loop.
- **`mission-view.js`** exports `createMissionView({ world, registry,
  renderer, container, template, missionId, defaultMain })` — everything that
  belongs to one mission: its World + engine, frames, panes, sidebar cards,
  phase buttons and sliders, compliance bar, events readout, share button, and
  its slice of workspace persistence. Returns `{ world, engine, root, show, hide,
  render, resize, dispose }`; N instances coexist, one per mission tab. Its
  DOM is cloned from `planner.html`'s `<template id="mp-mission-template">`,
  addressed by class, never id (ids can't repeat across instances).
- **`ephemeris-view.js`** — the Ephemeris tab: a scratchpad for authoring a
  trajectory *before* any mission exists (its own plain state object, not a
  World). Hosts the Solar-System-Trajectory-Plotter's marker/target machinery,
  snap-to and Lambert targeting, and the Moon-phase-at-launch widget; "Start
  Mission Plan" hands the authored leg to `core/freeze.js` to become a new
  mission tab. **The Departure card IS the hand-off:** its prograde/radial/
  normal vector is the ship's v-infinity where it leaves the origin's SOI,
  the date bar is that hand-off's epoch, and the drawn flight starts there —
  the same state, verbatim, that the freeze commits as the mission's
  Departure→Coast boundary, so a plan frozen here and pasted back is exact.
  Where on the SOI sphere the ship exits is either derived from the heading
  (authoring) or adopted from a pasted mission's own departure chain. How
  much impulse that hand-off costs, and when the launch must happen, are read
  BACKWARDS from it by `core/departure-estimate.js` — information for the
  Moon-phase widget and the release anchor, never a change to the drawn arc.
  Physics is not forked — the actual leg goes through
  `transfer-leg.js`'s exported `computeLeg`, the same function the frozen
  Coast phase uses.
- **`scene-frames.js`** — Three.js frame factories shared by both
  `mission-view.js` and `ephemeris-view.js`: `"helio"` (the whole solar
  system), `"body:Earth-Moon"` (geocentric), and a generic `"body:<name>"` for
  any other origin/destination, so the Ephemeris tab and a mission tab render
  the identical scene rather than two forks of it. (Not to be confused with
  `Shared/frames.js`, which converts ship-state *vectors* between frames —
  this file builds the renderable *scene*.)

Frames are per-mission (each view builds its own scenes/cameras from
`scene-frames.js`; only the renderer/canvas is shared — `show()` re-parents
the canvas into the active view's scene element). Modules' draw caches are
keyed **by World first** (a `WeakMap`), because coexisting missions reuse
stage ids like "stg-2"; `legFor`/`physicsFor`-style lookups take
`(world, stageId)`.

Layout/camera state ("workspace") lives in `localStorage`
(`mw-missionplanner-workspace`, `{ missions: { id -> { main, phase, cams } } }`,
one slot per mission, read-modify-write so slots survive each other), never in
World — a **separate key** from mission-content persistence. Mission CONTENT
(title + `world.serialize()`) lives under its own key
(`mw-missionplanner-missions`), owned by `planner.js` and saved on `pagehide`
and immediately after any structural change (a mission added or closed).

### Mission tabs: phases, sliders, compliance

Each mission tab has three phases — **Departure**, **Coast**, **Arrival** —
selected by the phase buttons, which drive the main-pane frame (via
`PHASE_FRAME`), which sidebar cards show (each stage's `rendersIn` filters it
to its phase), which slider shows, and the buttons' own worst-status-wins
status dots.

Each phase has its own timeline slider (`ui/phase-slider.js`), one visible at
a time — the raw Ephemeris date bar is only a fallback for a phase with no
resolvable span:

- **Departure** — spans from release to the Departure→Coast hand-off. For an
  Earth origin (a satellite carries the departure impulse) the left edge is
  pinned at the release anchor and the right edge floats at the predicted
  SOI-exit; for any other origin the right edge is pinned at the plan's
  committed hand-off and the left edge floats back by the flight's own
  duration. The committed hand-off and the flight's actual events both mark
  the track.
- **Coast** — spans from the hand-off to the Coast→Arrival seam
  (`core/arrival-seam.js`'s window), reading `transfer-leg`'s own events.
- **Arrival** — the window around closest approach, sliding bodily as the
  coast is tuned; the playhead reads signed time relative to closest approach.

The Departure→Coast seam is a **compliance boundary**, reached via the
registry so the shell stays dynamically loaded rather than statically
importing a module: `frozen-plan`'s `complianceFor` (v∞, epoch, aim) grades
the mission bar's v∞ out.

**The mission bar** (`.mp-phasebar`) runs across the top, not phase-gated.
Left of the divider, one group per phase — the phase's selector button and the
one figure that matters in it: v∞ out with Departure, coast Δv with Coast, v∞
in with Arrival. Right of it, the mission's headline closest approach and the
controls that move it. **Every figure describes the flight the ship is
actually on** (`core/delivered-flight.js`), never the plan's commitments — the
drawn coast is the plan's flight, and until a re-target has closed the gap the
two arrive in different places. Only v∞ out and closest approach are graded,
because only they have a standard to be graded against. The dot on each phase
button is a hard-fault light (error or blocked) and nothing softer; compliance
is the colour of the figure beside it, where the number it grades can be read
at the same time.

**Check and Update** drive the re-target loop. Check re-solves the departure
requirement at the point the technology actually leaves from and reports what
that would buy, writing nothing: its answer becomes a provisional target that
the Departure card's Needed column steers at. Update re-solves from the
*current* delivery — not Check's stored answer, already stale once the
technology is re-tuned — and commits it, redrawing the trajectory. The loop
closes because each pass asks for less than the last. **Mission report** opens
a menu carrying the per-iteration table and the mission link. All three write
into the **message area** beside the flight timeline.

The Coast→Arrival seam has no such boundary; the coast's ship card reports
which way a pending waypoint edit moved the pass, while the standing figure
lives in the bar. A one-line events readout
(top-left of the main pane) shows the event at the clock's current position
and opens a dropdown, fed by the envelope's `events` channel, to jump the
clock to another one — filtered to `display !== false`, since some emitted
events exist only for another consumer to read structurally (see
transfer-leg.js's closest-approach and "Leg ends"). Sidebar cards render
status chips and diagnostics/warnings uniformly, whether engine- or
module-authored.

## modules/ — the mission-profile stages

Each module is a folder (or, for the one shared helper, a bare file) whose
script default-exports its descriptor, dynamic-`import()`ed by the shell, per
`ARCHITECTURE.md`'s "Module interface". Every carrier/leg packet names its
origin or destination `body` explicitly — the project's "body" convention
(`Shared/exchange-types.js` header) — never implying one.

**Departure** — a carrier chain (`Shared/kinematic-chain.js`, carried in
`carrier-chain` packets) composes at an origin, then a headless leg integrates
the released flight with restricted N-body gravity. The release **epoch** is
never a stage param: it is the plan's read-only release anchor
(`frozen-plan.js`'s `releaseAnchorFor`, baked at mission creation, never
re-derived).

- **`modules/moon-platform/`** — the Moon as the departure stack's read-only
  top card, for Earth-origin missions only. Emits the chain base
  (`emptyChain("Moon")`) and shows the Moon's heading/impulse contribution at
  the release anchor. No knobs — plan around the Moon in the Ephemeris tab. A
  mission with no release anchor at all is diagnosed here, at the top of the
  chain.
- **`modules/skyhook/`** — the skyhook TECHNOLOGY PLATFORM (see
  `modules/platform/` below), serving every body and both ends of a mission
  from one folder. `skyhook.js` holds the substance: a gravity-gradient
  (radial) tether whose centre of mass rides a circular orbit at its `body`'s
  rate, its parameters, its release gate and rotor element, its catch figures,
  and its drawing. `skyhook-departure.js` registers it as the carrier module
  `orbital-skyhook`; `skyhook-arrival.js` registers it as the terminal module
  `arrival-skyhook`. As a carrier it optionally rides an upstream base platform
  (`inputOptional`) — for the Moon, `moon-platform`; for any other body it
  self-originates (the body is simply at rest). Release phase is the card's own
  aiming slider.
- **`modules/departure-leg/`** — HEADLESS (`plainCard`): the integrated
  geocentric flight (Earth + Moon + Sun, real ephemerides, RK4) from carrier
  release to Earth-SOI exit, for Earth-origin missions. Applies up to 2
  waypoint impulses in each leg's own local dynamical frame — the low-perigee
  Oberth pattern a patched-conic model can't express — and emits the hand-off
  `ship-state` plus flight events (release, impulses, Moon/Earth SOI exits).
  A flight that stays bound or impacts is a hard diagnostic; every recompute
  is one forward pass, nothing solves backwards.
- **`modules/body-departure-leg/`** — the generic sibling of `departure-leg`
  for every other origin body (`Shared/body-leg.js`'s body+Sun integrator):
  same shape, same headless role, body-centric instead of geocentric. One
  module serves Mars, Ceres, Vesta, … via the incoming chain's own `base`.

**The Departure→Coast boundary:**

- **`modules/frozen-plan/`** — the frozen flight plan (comply mode): its
  params ARE the plan captured at mission creation (origin, the frozen
  heliocentric departure state/epoch, the arrival commitment, a reference copy
  of the plan's waypoint burns). `update()` **always emits the plan's own
  departure state** downstream — the coast everyone sees is the commitment,
  never a re-solve — and reports the tech's deviations (v∞ / epoch / aim)
  through the warnings channel; an empty departure-tech slot is itself a
  warning, not a block (`inputOptional`). `computeCompliance`/`complianceFor`
  expose the full required-vs-delivered rows for the compliance bar.

**Coast:**

- **`modules/transfer-leg/`** — the canonical transfer-leg module: a ballistic
  arc between two ship states with up to two waypoint burns, extended with
  real SOI encounters (where the arc dips inside a body's SOI the flight
  switches to `Shared/body-leg.js`'s body+Sun integration and resumes Kepler
  at exit). Consumes the hand-off ship-state unmodified — no burn happens at
  that seam, since only a minority of a mission's delta-v comes from engine
  burns; whatever put the ship there is upstream's business. A configured
  destination reports its arrival miss distance through the warnings channel.
  Snap-to and Lambert targeting stay on the Ephemeris tab.

**Arrival:**

- **`modules/arrival-leg/`** — the coast, continued under the destination's
  gravity. It spans the seam window (`core/arrival-seam.js`: closest approach
  −Δt to +1 day), starts from the state the coast itself is in at the
  window's left edge — read off transfer-leg's own leg, since the packet the
  chain delivers sits later, at the coast's end — and integrates forward with
  `Shared/body-leg.js`'s `integrateEncounter` (RK4, body + Sun). Nothing about
  the pass is constructed: where the ship goes past, how close and how fast are
  whatever the coast delivers. Waypoints (up to 2) put burns on it; a retro
  burn near the pass drops/captures. HEADLESS (`plainCard`).
- **`modules/skyhook/skyhook-arrival.js`** — the same skyhook platform in its
  terminal role: a CATCH at the destination, the very same tether geometry run
  in reverse. A trim burn at the catch point closes the gap between the
  approach hyperbola's periapsis speed and the tether tip's own speed. Consumes
  the coast's delivered ship-state and emits nothing. Not modelled:
  catch-window phasing, the post-catch unload down the tether.
- **`modules/arrival-approach.js`** — not a stage module, a shared helper
  (`approachFromPass`, `approachAt`, `interceptWarning`) imported by the
  platform layer so the "does the coast actually reach the destination, and how
  fast" measurement is one computation, not several.

**Technology platforms** — one platform, one folder; two thin role adapters.

- **`modules/platform/platform-spec.js`** — what a platform IS, as data: its
  parameters (declared, so its card is built from them), its per-body defaults
  and applicability, what it can be layered on (`ridesOn`), its geometry, its
  release half (gate + chain element) and its capture half (`rendezvous` or
  `pass-through`). A platform models KINEMATICS AND IMPULSE ONLY — mass, taper,
  materials and cost stay in the calculators and arrive through the exchange
  packet.
- **`modules/platform/platform-roles.js`** — `makeCarrier` and `makeTerminal`,
  which turn a spec into the two stage descriptors the registry holds. They
  carry everything a role does apart from the platform's own physics: the body
  checks and chain-mismatch guard, the chain plumbing, the release anchor, the
  arrival leg's measured pass and the intercept check, the declared-parameter
  card, and the epoch a drawn platform's phase is pinned to. The two roles
  cannot be one descriptor — the registry validates `accepts`/`emits`
  statically and `mission-view.js` identifies tech stages by those types.

## ui/ — shell-local widgets

| File               | Named exports (partial)                                                                        | Purpose                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase-slider.js`  | `createSegmentedSlider`, `coastSliderState`, `departureSliderState`, `arrivalSliderState`, …      | The segmented-timeline widget behind each phase's slider: a DOM primitive (a track of flex-sized segments plus a playhead, `.mp-` classes styled in `planner.css`) plus three pure state functions (segments + playhead fraction + pinned flag + marks from a span, a jd, a tick count and a formatter) that `mission-view.js`'s `departureSpan`/`coastSpan`/`arrivalSpan` feed. |
| `ship-card.js`     | `createShipCard`, `SHIP_COLORS`, `vInfComponents`, `speedModel`, `timingModel`, `bearingPoint`, … | The floating card that reports on the ship the chevron marks: a scissored three.js gizmo off the shared renderer, a numeric summary, a speed bar, and — only where a phase fills them — an approach readout, a timing line, a B-plane square and a commit button. Phase-agnostic: every section renders nothing until its setter is called, so Departure takes the plan-vs-delivered comparison gizmo and on-course state, Coast takes the pending-edit vector and Update. The pure model functions are Node-tested. |
| `share-link.js`    | `MISSION_LINK_KIND`, `MISSION_LINK_VERSION`, `packMissionLink`, `unpackMissionLink`, `missionFragmentFrom` | The mission-link envelope wrapping `{ title, world }` under its own kind stamp (a bare serialized World has no title). Read by `planner.js`'s initial-load path and the Ephemeris tab's "Paste mission link…"; written by the mission view's share button.                          |
| `tech-options.js`  | `DEPARTURE_TECH_OPTIONS`, `ARRIVAL_TECH_OPTIONS`                                                 | The departure/arrival "technology" dropdowns' own small catalog — what's *offerable* and to which body, distinct from `core/registry.js` (what's *loaded*). Built entries add/swap a stage; unbuilt entries show disabled with a "(future)" label.                                  |

## presets/ — the shipped mission and example catalog

`default-mission.js` is the mission a fresh visit opens with, a serialized
World checked in as plain data: a Moon → Ceres flight through a lunar skyhook
whose real integrated departure under-delivers against the plan's required
v∞ — the mission does not comply with itself, by design, so closing the gap
(a low-perigee Oberth impulse on the departure leg, say) is the exercise it
teaches, while the coast still flies the frozen plan's state regardless and
still arrives clean.

`examples-catalog.js` drives the tab bar's example-mission dropdown; each
other file in this folder (`earth-mars-reference.js`, `earth-venus-
overshoot.js`, `jupiter-mercury.js`, `mars-mercury.js`, `venus-saturn.js`) is
one catalog entry — a genuine integrated flight (real carrier geometry +
waypoint burns run through the actual departure/coast/arrival modules,
verified in Node) spanning a geometry the app has to render correctly, and,
unlike the shipped default, compliant by construction: the frozen commitment
is exactly what the configured technology delivers, so opening one shows a
clean flight with no comply-boundary warnings. A catalog entry's `mission` is
deserialized fresh on every pick, so stateless data is never shared live
across tabs.

## Save format

`core/world.js`'s `WORLD_VERSION` is 4; `deserializeWorld` refuses (politely,
`{ ok:false, reason }`) anything that isn't exactly the current version — no
migration (saved missions are disposable test data, not something a schema
change promises to carry forward; see `Notes/decisions.md`,
2026-08-11). A save is always storable regardless of feasibility or whether
its module ids are currently registered — feasibility is the recompute
engine's diagnostic, not a data-layer validity condition.

## Tests

`core/tests/*.test.js`, `modules/tests/*.test.js`, `ui/tests/*.test.js` —
`node:test` suites covering World mutations/serialization, registry validation,
the recompute/diagnostic/blocked/
boundary/comply semantics, the carrier chain and integrated legs (departure
and arrival, Earth-origin and generic-origin), the frozen-plan compliance
rows, the phase-slider state functions, and the shipped preset plus every
catalog entry end to end (deserialize, recompute, survive the share-link
round trip). Run from the repo root:

```
node --test Website/MissionPlanner/core/tests/*.test.js
node --test Website/MissionPlanner/modules/tests/*.test.js
node --test Website/MissionPlanner/ui/tests/*.test.js
```

(If copying elsewhere to test, keep the `Website/MissionPlanner/core` +
`Website/Shared` relative layout and put a `{"type":"module"}` `package.json`
at the copy's root.)

## What's next

There is no task document, and no build order. Work comes from Kim directly,
a request at a time. Broadly, the outstanding work is: the six technology
platforms still to be written
(space elevator, tug, ring mass driver, linear mass driver, tip spin
launcher, aerobrake) onto the shape in `modules/platform/`; linking cards to
their calculators through the exchange; fleshing out the Arrival phase, which
is what would let the pass standard in `core/proximity.js` come from what the
arrival technology can actually catch instead of two flat numbers; and the
message bar explaining why the mission bar's figures move.

`../../Notes/decisions.md` holds the settled rules that work
builds on; `../ARCHITECTURE.md` covers the general module/packet model this
folder implements.
