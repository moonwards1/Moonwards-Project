# Website architecture — from standalone calculators to one simulator

This document describes the target structure for the Moonwards website: how the
standalone calculators and trajectory plotters evolve into **modules** that can
be activated inside a single, consistent solar-system simulation, and how data
is **traded** between the simulation and the standalone calculators. It builds
on what already exists in `Website/Calculators/` and `Website/Shared/`, and on
the `Link` idea sketched in `Calculators to make.md`.

The goal, stated as a user story: *pick a lunar skyhook and a Ceres space
elevator, plot the trip between them, then swap in a tip spin launcher at Ceres
— or move the departure from Earth to Mars — and watch the whole mission
profile recompute.*

## Where this starts from

The existing conventions already do the hardest separation:

- **Pure maths** lives in `Shared/math-utils.js` (`OrbitalMath`), Node-testable,
  no DOM.
- **Body data** lives in `Shared/orbit.js` (`systems`), ephemeris fields included.
- Each tool keeps its inputs in a **single `state` object** and recomputes from
  it (`computeTrajectory()` in the plotters).

What is *not* yet separated is everything else: each plotter owns a private
Three.js scene, camera controller, date bar, body renderer, labels, markers and
readouts — 2,000–3,000 lines each, heavily overlapping. The integrated
simulator is mostly a matter of un-fusing those parts once, into three layers.

## The three layers

### 1. World — the single source of truth

One plain, serializable object holding everything that *defines* the current
situation:

- the ephemeris date `jd`,
- the set of active modules and each module's parameters,
- the **mission profile** (the ordered chain of modules — see below),
- view preferences that matter to reproducibility (origin body, toggles).

Everything on screen and every number in every readout is **derived** from
World; nothing else is authoritative. Because World is one JSON-able object, a
mission profile can be saved, shared, diffed, and A/B-compared for free.
Modules never mutate World directly — they raise a change through the shell
(`world.set(...)`), which triggers recomputation (see *Recompute rules*).

### 2. Scene kit — reusable view components

The duplicated view code in the three plotters gets extracted into shared,
reusable pieces (a `Shared/sim/` family of ES modules, one responsibility per
file):

- **camera controller** — the custom drag/zoom/pan orbiter, with focus lock
  and double-click handling,
- **date bar** — coarse + fine slider pair with date field and JD readout,
- **body renderer** — sphere / bright-point collapse, SOI shell, floating
  label, per-frame screen-size logic,
- **orbit rings** — the two-tone north/south arcs split at the line of nodes,
- **marker card** — the slidable chevron probe with its readout card, and the 'x' marker that appears on the orbit of the destination body that's related to it.
  - (note: the related 'x' marker wouldn't apply in some cases where the marker card is still useful. Perhaps that portion can be made optional, or further split out.)
- **burn widget** — the isometric prograde/radial/normal arrow triad,
- **approach markers** — orbit-proximity and temporal-proximity rings,
- **readout panes** — the panel-edge-straddling burn readouts.

Each standalone plotter then shrinks to *its* specific physics and wiring, and
the integrated shell assembles the same components — one scene, one camera, one
date bar.

### 3. Modules — technologies and transfer legs

A module is one piece of mission hardware or one leg of travel:

- **technology modules** — lunar skyhook, Phobos skyhook, space elevator
  (Ceres, Psyche, Moon-L1), tip spin launcher, mass driver, aerobrake…
  Each attaches to a body and *produces* and/or *consumes* a ship state.
- **transfer-leg modules** — a coast + burns arc between two states. The
  compute core of the Solar System Trajectory Plotter (departure burn,
  waypoints, snap-to, Lambert) becomes the canonical transfer-leg module.

Modules are registered with the shell, given a scoped slice of the scene and
panel, and communicate **only** through packets (next section).

## Packets — the data contract

Every exchange — module to module inside the simulator, or simulator to
standalone calculator — uses one envelope:

```js
{
  kind: "moonwards-packet",       // marker so receivers can validate
  type: "ship-state",             // payload type, from the registry below
  version: 1,                     // per-type schema version
  source: {                       // provenance, shown to the user on import
    tool: "solar-system-trajectory",
    label: "WP 2, post-burn",
    iso: "2031-04-17"
  },
  data: { ... }                   // type-specific payload
}
```

### Payload type registry (initial)

| type               | payload (all SI units)                                                                                    | produced by                                               | consumed by                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `ship-state`       | `r` [m ×3], `v` [m/s ×3], `jd`, `frame`, optional `mass` [kg], `dvUsed` [m/s]                             | skyhook release, spin launcher, transfer leg, marker card | transfer leg, elevator/skyhook catch, aerobrake |
| `tether-spec`      | body, CoM orbit radius, upper/lower arm lengths, rotation period, tip speed, material (σ, ρ), taper ratio | tether tool, skyhook calculators                          | skyhook modules, spin-launcher calc             |
| `entry-state`      | body, entry speed, flight-path angle, altitude                                                            | transfer leg / flyby                                      | aerobrake calculator                            |
| `launch-spec`      | body, site (lat/lon or altitude), exit speed, exit direction                                              | mass driver / spin launcher calcs                         | their sim modules, transfer leg                 |
| `transfer-summary` | departure `jd`, arrival `jd`, per-burn Δv list, v∞ at each end                                            | transfer leg                                              | comparison tables, elevator/catch calcs         |

New types are added to the registry file (`Shared/exchange-types.js`) with a
version number; receivers ignore fields they don't know and refuse (politely,
with a banner) versions they can't read.

### Frames

`frame` is either `"helio"` (Sun-centred J2000 ecliptic — the Solar System
Trajectory Plotter's native frame) or `"body:<Name>"` (e.g. `"body:Mars"`).
Patching between them is the vector shift already used when the Mars–Phobos
plotter lifts a local trajectory into heliocentric coordinates:

$$
\vec r_\text{helio} = \vec r_\text{local} + \vec R_B(jd)
\qquad
\vec v_\text{helio} = \vec v_\text{local} + \vec V_B(jd)
$$

- $\vec r_\text{local},\ \vec v_\text{local}$ — the ship's position and velocity relative to body $B$
- $\vec R_B(jd),\ \vec V_B(jd)$ — body $B$'s heliocentric state at the packet's epoch (from `OrbitalMath.bodyStateAtJD`)
- $jd$ — the packet's Julian-date epoch of validity

This conversion gets promoted into `Shared/` (either into `math-utils.js` or a
small `frames.js`) so there is exactly one blessed implementation, with Node
tests.

## Mission profiles and recompute rules

A mission profile is an ordered chain (a small DAG, but a list covers the near
term):

```
[Moon skyhook release] → [Earth-escape leg] → [heliocentric leg + burns]
                       → [Ceres capture]    → [Ceres elevator catch]
```

Each stage's input is the upstream stage's output packet plus its own user
parameters. The recompute rule is deliberately boring:

1. Any change (date, a parameter, a module swapped in or out) marks that stage
   **dirty**.
2. The shell recomputes from the dirtiest stage **downstream, in order,
   synchronously**.

All the physics is analytic two-body work (Kepler propagation, Lambert,
impulsive burns), so a full-chain recompute costs microseconds — no reactive
framework, no async, no caching subtleties. This is the waypoint behaviour the
plotters already have ("downstream arcs recompute automatically"), generalized
to whole missions.

Comparisons ("elevator with vs. without spin launcher", "from Earth vs. from
Mars") are two serialized profiles differing in one entry, both rendered; a
comparison table reads each chain's `transfer-summary` packets.

## Module interface

Each module is a folder with the usual `name.js` / `name.css` pair whose
script default-exports its descriptor. The shell loads it with dynamic
`import()` — so a technology's code is fetched only when it is activated —
and registers it.

```js
export default {
  id: "ceres-elevator",
  title: "Ceres space elevator",
  attachesTo: "Ceres",              // body name, or null for transfer legs
  accepts: ["ship-state"],          // upstream packet types it can consume
  emits:   ["ship-state"],          // packet types it produces downstream

  init(ctx)        {},              // build UI in ctx.panelHost, meshes in ctx.group
  activate()       {},              // shown / participating in the profile
  deactivate()     {},              // hidden, state retained
  dispose()        {},              // full teardown

  update(world, input) {            // jd or upstream packet changed;
    return outputPacket;            // recompute, redraw own meshes,
  }                                 // return the downstream packet (or null)
};
```

`ctx` provides: `world` (read + `set()`), `group` (a `THREE.Group` the shell
adds/removes — a module never touches the scene outside it), `panelHost` (a
sidebar card element, built with `create` from `ui-components.js`), and
`exchange` (the calculator-trading mailbox, below). Rules: derive everything
from World and the input packet; no reach-ins to other modules; pure maths goes
in `Shared/math-utils.js` with a Node test, not inline.

The standalone calculator pages survive as thin wrappers hosting one module
each — they stay the place to *learn* a technology in depth, while the
simulator is the place to *compose* them.

## Exchange — trading data with the calculators

The simulator and the standalone calculators trade packets through a small
mailbox, `Shared/exchange.js`. The interaction is deliberately explicit and
button-driven — no magic syncing:

- **Send buttons** live in whichever card owns a coherent cluster of values.
  Examples: the skyhook module's card gets *"Send tether → Tether tool"* and
  *"Send release state → Trajectory plotter"*; the marker card gets *"Send
  state → Aerobrake calculator"* (enabled when the marked state is an entry);
  a transfer leg's readout gets *"Send summary → comparison table"*. Several
  buttons per card is expected; each declares one packet type and a suggested
  target.
- **Receive banners.** A calculator that accepts a type shows a banner when a
  matching packet is pending or arrives live: *"Ship state from Solar System
  Trajectory Plotter (WP 2, 2031-04-17) — **Apply** / Dismiss."* Applying maps
  the payload onto the calculator's input fields. **Imports never silently
  overwrite** the user's inputs.
- **Pending until opened.** If the target calculator isn't open, the packet
  waits in the mailbox and the banner appears when the page next loads. One
  pending packet per type per target (newest wins) keeps the mailbox from
  becoming a queue-management chore.
- **Both directions.** Calculators export the same way (e.g. the tether tool
  sends a `tether-spec` back to configure the simulator's skyhook module).

### API sketch

```js
Exchange.send(packet, { target: "aerobrake" });  // deliver now or leave pending
Exchange.accept(["ship-state"], onPacket);       // register interest; fires for
                                                 // pending packets on load and
                                                 // live ones while open
Exchange.pending("ship-state");                  // peek without consuming
Exchange.consume(packetId);                      // after a successful Apply
Exchange.linkFor(packet, url);                   // url + "#pkt=" + base64(JSON)
```

### Transports, in order of preference

1. **Same document** (inside the simulator): direct handler call through the
   module registry. Trivial and always works.
2. **`localStorage` + `storage` events** (separate tabs/pages): the mailbox
   persists under one key (`mw-exchange`); the `storage` event gives live
   delivery to an already-open calculator. This is also what implements
   *pending until opened*.
3. **URL fragment** — `calculator.html#pkt=<base64url JSON>`: an "Open X with
   this data" link. Works everywhere, survives any storage restriction, and
   doubles as a shareable link.
4. **Clipboard JSON** — a small copy-packet affordance next to each send
   button, and a paste box in each receiver, as the universal fallback.

**Origin note.** The site is always viewed over `http(s)` — GitHub Pages
(<https://moonwards1.github.io/Moonwards-Project/>) when deployed, a local
server (`serve.bat`) during development — so all four transports work and
`localStorage` sees one clean origin. Transports 3 and 4 still earn their
keep, as shareable links and as the universal fallback.

The mailbox's pure parts (envelope validation, base64url encode/decode, the
pending-slot logic) take plain objects and return plain objects, so they get
Node tests like the rest of `Shared/`.

## Scale and frames in one scene

Phobos' orbit is ~9,400 km across; a mission profile spans multiple AU. One
scene cannot show both usefully, so the shell generalizes the Mars–Phobos
plotter's context-view toggle:

- a **heliocentric view** (the Solar System Trajectory Plotter's scene) showing
  transfer legs and planet-scale geometry, and
- **body-local views** (Earth–Moon, Mars–Phobos, Ceres…) where technology
  modules render their hardware to scale.

A module declares its natural frame; the frame-patching maths decides what each
view draws. The camera transition between views can start as a plain toggle
(as in the Mars–Phobos plotter) and become a continuous zoom later if wanted.

## Migration path

Each step is independently useful; nothing requires a big-bang rewrite.

0. **Repo, Pages, ES modules** *(done, 2026-07)*. The project is a git
   repository (`github.com/moonwards1/Moonwards-Project`) published via
   GitHub Pages (`.github/workflows/deploy-pages.yml`) at
   <https://moonwards1.github.io/Moonwards-Project/>, and the codebase is ES
   modules throughout — every `Shared/` library and calculator uses
   `import`/`export`, with `Shared/three.min.js` the one remaining classic
   script (it provides the global `THREE`). Local viewing goes through
   `serve.bat` at the repo root, since ES modules do not load over `file://`.

1. **Keep extracting the scene kit.** As the plotters get touched, move
   camera / date bar / body renderer / rings / marker / burn-widget code into
   `Shared/sim/`. The plotters shrink; the kit accumulates.

   - **Camera controller** *(done, 2026-07)*: `Shared/sim/camera-controller.js`
     — `createCam`/`updateCamera`/`bindCameraControls`/`raycastPickPoint`,
     covering rotate/pan/cursor-centred zoom/focus-lock/deferred-click-vs-
     double-click. All three plotters (Solar-System-Trajectory-Plotter,
     Moon-Skyhook-Trajectory-Plotter, Mars-Phobos-Skyhook-Trajectory-Plotter,
     the latter two driving both their local and heliocentric "Helio" views
     through one shared binding) now import it instead of carrying their own
     copy. The Moon-Skyhook raycast-based cursor-zoom became the one
     canonical implementation (see the module's header comment for the
     behavioural differences this reconciled).
   - **Date bar** *(done, 2026-07)*: `Shared/sim/date-bar.js` —
     `createDateBar(state, opts)`, owning only the coarse (tool-wide span) +
     fine (local offset) slider pair, the typed date field, and the JD
     readout; module-specific sliders (skyhook release point, hook phase)
     stayed out, mounted in their own module's panel card as before. The
     Solar-System-Trajectory-Plotter implementation — click-to-jump,
     Shift-drag to fine-tune (4x slower), and a fine-slider "wrap" that
     advances the coarse base past its end — is the canonical one; porting
     Moon-Skyhook and Mars-Phobos to it was a real behavioural upgrade, not
     just a lift, since neither had drag/wrap before. Each tool's "lock this
     phase" toggle (Moon-Skyhook: lock Moon phase, nudges the coarse target;
     Mars-Phobos: lock Phobos phase, nudges the fine offset instead) is kept
     as an optional `resolveBaseDays`/`resolveFineReset` hook rather than
     forced into one shape, since the two tools genuinely resolve their lock
     at different points. `state.jd`/`state.baseDays` stay owned by each
     plotter's own `state` object (read from dozens of places per file) —
     the module mutates them in place rather than keeping a private copy,
     unlike `camera-controller.js`'s self-contained `cam`.
   - **Body renderer** *(done, 2026-07)*: `Shared/sim/body-renderer.js` —
     `createBody`/`createSunBody`/`updateScales` for the Kepler-scale
     multi-body pattern (a sphere that collapses to a constant-pixel point
     below a screen-size threshold, plus a same-behaviour SOI shell), which
     was byte-identical across the Solar-System-Trajectory-Plotter's main
     scene and the Moon-Skyhook/Mars-Phobos plotters' heliocentric "Helio"
     overlays — all three now share one implementation. The "hero body"
     local views (textured, tidally-locked Earth/Moon and Mars/Phobos) stay
     calculator-specific — texture loading and spin-group wiring aren't
     generic scene-kit concerns — but their small duplicated helpers
     (`makePoint`, the back-face `makeSOIShell`, the pixel-scale math) moved
     into the same module. Floating labels were unified across BOTH patterns
     (`addLabel`/`updateLabels`), tracking any `Object3D` via
     `getWorldPosition` — one implementation instead of two. See the
     module's header comment for the full reasoning.
   - **Orbit rings** *(done, 2026-07)*: `Shared/sim/orbit-rings.js` —
     `createKeplerOrbitRing` for the fixed-Kepler-orbit two-tone ring, again
     byte-identical across the Solar-System-Trajectory-Plotter's main scene
     and the other two plotters' Helio overlays (including the near-ecliptic
     single-ring fallback). The lower-level primitives it's built from
     (`sampleEllipseArc`, `makeArcLine`) are also shared directly by
     Moon-Skyhook's own geocentric Moon-orbit ring — a related but distinct
     case, since it re-derives osculating elements from the live ephemeris
     every rebuild rather than drawing a fixed `sys.orbit` — and by
     Mars-Phobos' Phobos-orbit ring, which needed only `makeArcLine` since
     Phobos is modelled as circular (no ellipse sampling at all, per that
     file's stated simplification). See the module's header comment for the
     full reasoning.
   - **Approach markers** *(done, 2026-07)*: `Shared/sim/approach-markers.js`
     — a hollow, camera-facing ring sprite that holds a constant on-screen
     size until the camera is close enough for its true physical size to
     read larger, plus `pickProximityTier` (map a distance/time value to a
     3-tier index) and `applyTierToSprite` (re-colour/resize an existing
     ring in place). The orbit-proximity rings (mark where a path passes
     near another body's orbit) currently only exist in the
     Solar-System-Trajectory-Plotter; the temporal-proximity ring (around
     the ship, coloured by how close in time the destination is at arrival)
     is byte-identical between that plotter and the Mars-Phobos plotter's
     Helio overlay, tier table included. Moon-Skyhook doesn't have this
     feature. Each tool's own tier table (colours/opacity/px/physical size)
     stays local, as plain data — only the ring-sprite mechanics moved.
   - **Burn widget** *(done, 2026-07)*: `Shared/sim/burn-widget.js` —
     `createWaypointGizmo` (the prograde/radial/normal axis triad, oriented
     via `OrbitalMath.burnFrame`, fixed green/orange/blue colours, hit-test
     arm endpoints stored for the draggable gizmos) and `makeBurnArrow` (the
     dV / prograde-speed-change arrows, physical scale and negligible-vector
     threshold passed in per tool). All four sites (the Solar-System-
     Trajectory-Plotter; Moon-Skyhook's and Mars-Phobos's local views; both
     of their Helio overlays) agreed on colours, arrow styling, and the burn
     frame; what genuinely differed (scene-unit scale per km/s, and — for
     Moon-Skyhook/Mars-Phobos's flyby handling — the drawn position and the
     burn-frame position sometimes being different points) stayed as
     parameters rather than forcing one shape. The per-frame constant-size
     pass reuses body-renderer.js's `worldSizeAtPointForPx` directly instead
     of a third copy of that formula.
   - **Readout panes** *(done, 2026-07)*: `Shared/sim/readout-panes.js` —
     `renderReadoutBoxes` (rebuilds the panel-edge-straddling burn-readout
     cards from a `{ host, data }` list) and `positionReadoutBoxes` (the
     vertically-centred, hide-when-scrolled-out positioning math), both
     byte-identical logic across all three plotters. What genuinely differed
     stayed caller-supplied: the CSS class prefix (`sst-`/`msk-`/`mps-`), the
     "plane change" row's wording (plain on the Solar-System-Trajectory-
     Plotter, "plane change (to ecliptic)" on Moon-Skyhook/Mars-Phobos, since
     their burns are body-relative), and the row colours (each tool's own
     DV_COLOR/DSPEED_COLOR-derived hex strings, identical today but declared
     per tool). `burnReadoutData` — the |Δv|/plane-change/prograde-Δv physics
     — stayed local to each calculator; it's a few lines reading tool-specific
     state (GM_SUN vs GM_S, local-vs-absolute r/vBefore), not worth a shared
     signature for three call sites.
   - **Marker card** *(done, 2026-07)*: `Shared/sim/marker-card.js` — the
     slidable ship-marker probe, its floating card, and the destination "X".
     This is the item this document's own note flagged as possibly needing
     splitting further, and that's roughly how it landed: the MECHANICAL
     layer is shared (`makeShipSprite`/`makeXMarkSprite`, `orientMarkerSprite`
     for the per-frame heading rotation, the card's DOM/CSS skeleton via
     `buildMarkerCard`, the custom relative-drag slider physics via
     `bindRelativeDragSlider`, and pure orbital-mechanics helpers —
     `markerFraction`, `sweepAngleFrom`, `phasingDays`, `refineApproach`,
     `followCrossing`), while the Free/Track/Target STATE MACHINE
     (`setMarkerMode`, `applyTargeting`'s Lambert re-solve, `updateMarker`,
     `updateDestinationMarker`) stayed local to each calculator. That
     orchestration reads and mutates each tool's own trajectory
     representation, which are structurally different shapes (the
     Solar-System-Trajectory-Plotter's `computeTrajectory()` returns
     `res.points`/`res.departure` directly; Mars-Phobos's returns
     `res.helioChain.points`, since its marker slides the post-Mars-escape
     chain, not the whole departure-to-arrival path — see the project's
     marker-port note), and Mars-Phobos's Target mode has a genuine
     behavioural difference (requires >=1 waypoint; there's no user-set
     "departure burn" to fall back on at an escape point) rather than a
     parameter that could be threaded through one shared function. Moon-
     Skyhook has none of this feature. `refineApproach` turned out to have a
     second, pre-existing local call site in the Solar-System-Trajectory-
     Plotter (the orbit-proximity-ring scan, `computeOrbitApproaches`) that
     predated this extraction and folded into the same shared function. See
     the module's header comment for the full reasoning.

   All scene-kit items are now migrated.

2. **Build `Shared/exchange.js` + `exchange-types.js` and wire the first
   buttons** between existing standalone tools (e.g. trajectory plotter →
   aerobrake calculator; tether tool → skyhook plotter). This ships real value
   immediately and validates the packet contract before the shell exists.

3. **Promote frame patching** into `Shared/` with Node tests.

4. **Build the shell** (`Website/MissionPlanner/`): world object, one scene,
   module registry, profile-chain UI. Port the lunar skyhook as the first
   technology module and the SST compute core as the transfer-leg module; then
   add endpoints (Ceres elevator, spin launcher, mass driver, aerobrake) one at
   a time. Rewrap the standalone pages as single-module hosts as each port
   lands.

## Conventions

- **ES modules throughout** — `import`/`export`, one `<script type="module">`
  per page, named exports from `Shared/`. The site is always viewed over
  `http(s)`: GitHub Pages deployed, `serve.bat` locally. (This supersedes the
  old classic-scripts-for-`file://` convention.) The one exception is
  `Shared/three.min.js`, a vendored classic script loaded with a plain
  `<script src>` tag before the page module; it provides the global `THREE`.
- **Pure logic stays pure** — physics and packet-handling take plain values and
  are Node-testable (plain `import`, no DOM); DOM and Three.js stay in the view
  layer.
- **One responsibility per file**, one folder per module/calculator, CSS class
  prefixes per tool.
- New orbital maths goes in `Shared/math-utils.js` with a test, never inline in
  a module.
