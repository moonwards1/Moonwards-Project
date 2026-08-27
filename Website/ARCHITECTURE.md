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

One plain, serializable object holding everything that *defines* the mission:

- the ephemeris date `jd` — **one clock, shared by every view**; a pane with
  its own time would silently be a different mission,
- the set of active modules and each module's parameters,
- the **mission profile** (the ordered chain of modules — see below).

Everything on screen and every number in every readout is **derived** from
World; nothing else is authoritative. Because World is one JSON-able object, a
mission profile can be saved, shared, diffed, and A/B-compared for free.
Modules never mutate World directly — they raise a change through the shell
(`world.set(...)`), which triggers recomputation (see *Recompute rules*).

Decisions baked in from the start, because retrofitting them is expensive:

- **Stable stage ids.** The profile is a linear list (not a DAG — a list
  covers the near term and gives the novice-friendly mission-timeline UI),
  but stages are referenced by a stable per-stage id, never by array index.
  Save files, undo entries, UI bindings, and diagnostics all key off ids, and
  ids keep the door open to branching/comparison later without a schema break.
- **One choke point.** Every mutation goes through `world.set()`. Undo/redo,
  share links, and saved missions may ship much later, but routing all changes
  through one door makes them cheap instead of a rework. Continuous gestures
  (date-bar drags, gizmo drags) produce transient sets coalesced into one undo
  entry when the gesture ends.
- **Versioned serialization.** World carries a schema version; `deserializeWorld`
  refuses (politely) anything that isn't exactly the current version. No
  migration — saved missions are disposable test data, not something a schema
  change promises to carry forward.
- **Always storable.** World may describe a physically infeasible mission — it
  is never rejected at the data layer. Feasibility is a *diagnostic*, not a
  validity condition (see *Recompute rules*).

#### World, workspace, ephemeral — the three state tiers

The shell presents multiple simultaneous 3D views — a main window plus
floating, swappable panes (see *Scale and frames: multiple views*) — which
splits "state" three ways:

1. **World (the mission)** — as above. The only tier that triggers
   recomputation, participates in undo, and defines what a shared mission
   *is*.
2. **Workspace (the arrangement)** — which views are open, which is main,
   pane positions/sizes, and *per-view* settings: frame (`"helio"`,
   `"body:Earth-Moon"`, …), origin/focus body, camera pose, display toggles
   (SOI shells, labels). Serialized separately from World with its own
   version number; persisted in `localStorage` so the layout survives reload;
   optionally attached to a share link ("see what I saw"); never a recompute
   trigger and never in mission undo.
3. **Ephemeral** — hover, drag-in-progress, tweens. Never saved.

The membership rule: a value goes in World if it changes the numbers or is
needed to reproduce the *meaning* of a shared mission. (An earlier draft of
this section put "origin body, toggles" in World; with several views each
having its own origin and toggles, those are workspace state. World got
slimmer — the mission is the same mission whether one pane is open or five.)

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
the integrated shell assembles the same components — one date bar, one render
loop, N views.

**Multi-view caveat.** The kit was extracted from single-canvas tools, so the
per-frame screen-size logic in `body-renderer.js`, label projection
(`addLabel`/`updateLabels`), and readout positioning assume one canvas and one
camera. The shell's multiple views mean each needs a per-view (camera,
viewport rect) parameter, and labels need clipping to pane bounds. Check each
kit module's signature for this before the shell hardens around it.

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

| type               | payload (all SI units)                                                                                       | produced by                                               | consumed by                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------- |
| `ship-state`       | `r` [m ×3], `v` [m/s ×3], `jd`, `frame`, optional `mass` [kg], `dvUsed` [m/s]                                | skyhook release, spin launcher, transfer leg, marker card | transfer leg, elevator/skyhook catch, aerobrake |
| `tether-spec`      | body, foot/centre/top altitudes above the surface, material (σ, ρ); optional: period, tip speed, taper ratio | tether tool, skyhook calculators                          | skyhook modules, spin-launcher calc             |
| `entry-state`      | body, entry speed, flight-path angle, altitude                                                               | transfer leg / flyby                                      | aerobrake calculator                            |
| `launch-spec`      | body, site (lat/lon or altitude), exit speed, exit direction                                                 | mass driver / spin launcher calcs                         | their sim modules, transfer leg                 |
| `transfer-summary` | departure `jd`, arrival `jd`, per-burn Δv list, v∞ at each end                                               | transfer leg                                              | comparison tables, elevator/catch calcs         |

New types are added to the registry file (`Shared/exchange-types.js`) with a
version number; receivers ignore fields they don't know and refuse (politely,
with a banner) versions they can't read.

**The `body` convention.** Note that `tether-spec`, `entry-state` and
`launch-spec` all carry `body` explicitly, and `carrier-chain`'s `base` is the
same idea under a different name — no type here lets a receiver infer which
body it's about from which tool sent it. As calculators generalize to cover
more than one body from a single page (`Gravity-gradient-skyhooks` already
does, via a body selector) and the Mission Planner's departure/arrival tech
dropdowns grow past the Moon, this stays a hard rule for any new
body-specific type, and consuming modules must check the field against their
own assumption (diagnostic on mismatch) rather than trust it. See
`Shared/exchange-types.js`'s header and `MissionPlanner/modules/lunar-skyhook/
lunar-skyhook.js`'s `update()` for the convention and its enforcement pattern.

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

1. Any change to a stage (a parameter, a module swapped in or out) marks that
   stage **dirty**.
2. The shell recomputes from the dirtiest stage **downstream, in order,
   synchronously**.
3. **Moving the clock recomputes nothing.** Views still get a pass, carrying
   the results as they stand, so everything redraws at the new date — but no
   `update()` runs.

Rule 3 holds because no module's `update()` reads the clock. The clock decides
what a stage **draws** (where a chevron sits along its leg, the speed under it,
where the bodies are), never what it **computes**; every `world.jd` in a module
is inside `draw()` or a card renderer. A stage that needed the clock in
`update()` would break this, and would be depending on something the chain has
no reason to depend on.

The rule matters because a recompute is not free. Most of the physics is
analytic two-body work (Kepler propagation, Lambert, impulsive burns), but a
leg that passes through a body's sphere of influence is RK4-integrated, and
that dominates: the shipped Moon→Ceres coast costs 4.4 ms per pass, doubling
whenever a waypoint edit is pending and both the live and hand-off arcs fly.
Multiplied by a slider drag's tick rate, recomputing for the clock was the
single largest cost in the app.

Beyond that there is still no reactive framework, no async, and no caching
subtleties — a dirty stage and everything downstream of it simply reruns. This
is the waypoint behaviour the plotters already have ("downstream arcs recompute
automatically"), generalized to whole missions.

### Infeasibility is a diagnostic, not an error

Novices will constantly build impossible missions (a skyhook that can't catch
at that v∞, an arrival before a departure). The difference between "the tool
explains what's wrong and how far you got" and "everything goes blank" is the
whole accessibility story, so:

- A stage's `update()` returns either its output packet **or a structured
  diagnostic** (stage id, what failed, the offending numbers, and — where
  cheap to compute — what would fix it).
- Downstream stages render as *blocked, waiting on stage N*, keeping their
  parameters and UI intact rather than disappearing.
- World stores the infeasible profile as readily as a feasible one; saving,
  sharing, and undoing broken missions all work.

Comparisons ("elevator with vs. without spin launcher", "from Earth vs. from
Mars") are two serialized profiles differing in one entry, both rendered; a
comparison table reads each chain's `transfer-summary` packets.

### Phases are chains; compliance is a boundary check, not a reconciliation

The Mission Planner's Departure / Coast / Arrival phases
(`MissionPlanner/MissionPlannerDesign_v2.md`) are not a second mechanism sitting
above the chain — a phase is just a labeled sub-range of the one ordered
stage list above. Within a phase, however many stages exist — one burn, two,
five, a thousand — they compose in strict sequence exactly as described
above: each stage's `update()` takes the previous stage's output as its own
input and hands the next stage the result. **There is nothing to reconcile
inside that composition, ever, regardless of length.** A departure phase with
five real burns (release, a plane change, an Oberth pass, whatever) is just
five ordinary stages in a row, each transforming the ship-state the last one
produced; the recompute engine never sees "a phase," only stages, and never
needs to — composition, not comparison, is what a chain does internally.

What a phase *boundary* carries is a different thing: exactly one
requirement — a target ship-state the next phase is committed to starting
from. `MissionPlanner/modules/frozen-plan/` is this requirement for the
Departure→Coast boundary: its `departure` field is not a stage in anyone's
chain, it's the spec the chain upstream of it is measured against.
**Compliance is a single comparison at that one seam.** Whatever the upstream
chain actually composed to is an opaque end result — `computeCompliance`
never looks inside it, and doesn't care whether one stage produced it or a
thousand — compared once to the one frozen target. Match, and downstream
flies the target unmodified (the comply rule); miss, and that is one warning
naming the gap, not a reconciliation of individual upstream events against
each other or against anything else.

This mechanism exists because departure hardware is otherwise blind to the
destination: a skyhook doesn't know where Ceres is, it just delivers a
velocity, so it needs a fixed target to be judged against, and the frozen
plan is what lets the coast keep flying even while that target isn't being
met yet. The Coast→Arrival seam has no equivalent boundary, because neither
justification holds there: `transfer-leg` already targets the real
destination directly and reports its actual approach live as waypoints are
tuned (the ship card), so there is no blind design problem needing a
synthetic target, and nothing downstream needs a substitute to keep flowing.
A "commitment vs. delivered" comparison at that seam would just be a second,
read-only rendering of numbers the coast already shows.

**The tell that this model has been lost:** if two numbers describing the
same seam start needing "reconciling" against each other, that is never a
peer-comparison problem to solve — it means an event has been attached to
the wrong side of a boundary, and the fix is to move it, not to compare it.
(2026-07-14: `transfer-leg.js` used to carry its own `burn` field, applied on
top of `frozen-plan`'s already-frozen departure state — a second, uncounted
injection sitting on the Coast side of a boundary defined as "no burn
happens here." The fix was never to compare the two burns; it was to notice
the leg's burn belonged to whatever composed the departure requirement, and
fold it there instead. See `frozen-plan.js`'s and `transfer-leg.js`'s
headers.)

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
  rendersIn: ["body:Ceres", "helio"], // frames this module draws in

  init(ctx)        {},              // build UI in ctx.panelHost
  viewAdded(view)  {},              // a view in one of rendersIn's frames
                                    // opened: build meshes in view.group
  viewRemoved(view){},              // that view closed: drop references
  activate()       {},              // shown / participating in the profile
  deactivate()     {},              // hidden, state retained
  dispose()        {},              // full teardown

  update(world, input) {            // jd or upstream packet changed;
    return outputPacket;            // recompute, redraw own meshes, return
  }                                 // the downstream packet (or null) — or a
                                    // structured diagnostic if infeasible
                                    // (see Recompute rules)
};
```

`ctx` provides: `world` (read + `set()`), `panelHost` (a sidebar card element,
built with `create` from `ui-components.js`), and `exchange` (the
calculator-trading mailbox, below). Rendering is **per view**: because panes
open and close dynamically, a module declares the frames it draws in
(`rendersIn`) and gets a `viewAdded`/`viewRemoved` call per matching view,
each carrying that view's own `THREE.Group` — a module never touches a scene
outside its groups. A technology module typically renders full hardware in
its body-local frame and only a marker (or nothing) in `"helio"`.

The module UI surface is deliberately minimal — a host element and packets,
nothing else; the shell owns all layout, so UI redesigns don't ripple into
modules. Rules: derive everything from World and the input packet; no
reach-ins to other modules; pure maths goes in `Shared/math-utils.js` with a
Node test, not inline.

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

## Scale and frames: multiple views

Phobos' orbit is ~9,400 km across; a mission profile spans multiple AU. One
scene cannot show both usefully, so the shell shows **several views at once**
— a main window plus floating, swappable panes, each rendering one frame:

- a **heliocentric view** (the Solar System Trajectory Plotter's scene) showing
  transfer legs and planet-scale geometry, and
- **body-local views** (Earth–Moon, Mars–Phobos, Ceres…) where technology
  modules render their hardware to scale.

A view is a **lens**: a pure function of (World, its workspace entry — frame,
origin, camera pose, toggles). Nothing authoritative lives in a view. Two
consequences:

- **Swapping is layout-only.** Promoting a pane to the main window reassigns
  which view descriptor renders into which screen region — no World change, no
  recompute, no module involvement. The swap feature lives entirely in the
  shell's layout code.
- **Every pane is a peer editor.** A gizmo drag in any pane goes: pane-local
  raycast → `world.set()` → recompute → *all* views redraw. Cross-view
  consistency is free. (Small panes can start camera-only if hit-testing in
  tiny rects proves fiddly — a polish choice, not an architecture one.)

**Rendering: one renderer, one full-window canvas, scissored viewports** (the
standard Three.js multiple-views technique). Browsers cap WebGL contexts at
roughly 8–16, so canvas-per-pane is a trap; the shell owns the single render
loop and walks the view list each frame.

Views are described in workspace state, not World (see the three state tiers
above). The camera transition when swapping views can start as a plain cut
and become a continuous zoom later if wanted.

## Migration path

Each step was independently useful; nothing required a big-bang rewrite, and
the steps are now all built: the repo / Pages / ES-module conversion; the
`Shared/sim/` scene kit (camera controller, date bar, body renderer, orbit
rings, approach markers, burn widget, readout panes, marker card); the
`Shared/exchange.js` + `exchange-types.js` mailbox with real
calculator-to-calculator pairings; `Shared/frames.js`; the headless mission
core; the planner shell; and the worked-example default mission. Each
module's own header explains what it covers and why it has the shape it has;
`git log` holds the narrative of how it got there.

What remains on this path is **endpoints** — the technology platforms the
Mission Planner has still to gain (space elevator, tug, ring mass driver,
linear mass driver, tip spin launcher, aerobrake). Each is added onto the
platform shape in `MissionPlanner/modules/platform/`, one at a time, with the
matching standalone calculator page rewrapped as a single-module host as the
port lands.

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
