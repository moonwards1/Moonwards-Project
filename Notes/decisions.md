# Design decisions log

Settled rules that are load-bearing for more than one file. Each entry states
the rule and, briefly, why — and where it matters, what it forbids. It is not
a narrative of how the decision was reached; `git log` holds that. See
[CLAUDE.md](../CLAUDE.md), "Documentation: three tiers, one home each," for
how this differs from the changelog and from current-state docs.

**When a decision is replaced, its entry is rewritten or removed, not left
standing beside its replacement.** A log that holds several versions of the
same rule is worse than no log.

Entries are chronological within each section.

---

## Mission Planner

### 2026-07-25 — Phase seams

- **Departure→Coast hand-off** — the epoch the departure technology actually
  delivers, which is also the coast's own start. It moves as the technology is
  tuned. The epoch frozen at mission creation is the REQUIREMENT graded
  against it, not a second date the coast runs on. See "One clock" below.

- **Coast→Arrival hand-off (the seam)** — **a window around the encounter,
  not a fixed date**: `closest approach − Δt` to `closest approach + ~1 day`,
  where

  `Δt = clamp( R_SOI(destination) / v∞ , 2 days , 5 days )`

  `R_SOI` is the destination's **own** Laplace SOI radius (for an Earth
  arrival, Earth's own — not an Earth–Moon composite). Both edges move with
  closest approach as the coast is tuned. The seam's job is to give the
  Arrival phase the right stretch of arc for final approach, and that stretch
  is defined relative to the encounter, not to the calendar. Derived live at
  recompute from `transfer-leg`'s measured pass — no stored field. With no
  encounter at all, fall back to the coast's own end.

  The lower clamp keeps small bodies workable (crossing Ceres' SOI takes only
  ~0.24 d). The upper clamp is presentation, not physics: uncapped, a Jupiter
  arrival would run ~100 days, which is cruise, not approach.

- **There is no committed arrival date.** The commitment is a BODY and an
  approach v∞ — where the mission is going and how fast it may show up — and
  it arrives at whatever closest approach it measures. See "The arrival date
  is measured" below.

- Compliance at a seam is **one boundary comparison**, non-blocking — never a
  reconciliation of events within or across a phase.

### 2026-07-25 — Timelines

- **Departure.** The committed hand-off is a fixed mark; the predicted SOI
  exit is a separate, moving one. On course = the predicted exit falls within
  **one day** of the committed hand-off. Which edge frames the visible span
  (Earth/Moon: start pinned at the release anchor, end floats; bodies without
  satellites: end anchored, start floats) governs only the drawing, never
  what compliance means.
- **Coast.** Ends at the seam; the chevron cannot be scrubbed past it, though
  the trajectory continues to be drawn. Its measurement horizon extends past
  its own seam to true closest approach, and the trajectory is drawn ~10°
  farther still.
- **Arrival.** Both edges derive from the live closest approach, so the whole
  window slides with the encounter rather than either edge being pinned.

The ship's state at the seam is *not* constrained to move "toward" the
destination — aiming often moves it sideways. What is constrained is the
encounter outcome downstream.

### 2026-07-25 — Waypoint impulse controls, coast

Axes ±100 m/s; step **0.1 m/s on both waypoints**. The floor is not a
thruster limit — real corrections reach mm/s — it is that below ~0.1 m/s the
effect drops under the model's own fidelity. (0.1 m/s at 200 days out still
moves arrival ~1,700 km.) 2,000 steps across an axis cannot be resolved by
dragging, so the card carries shift-drag fine mode (10× slower, as in
`Shared/sim/date-bar.js` and `ui/phase-slider.js`) **plus** numeric entry with
nudge arrows and keyboard nudges, stepping 1 m/s by default and 0.1 m/s with
shift.

### 2026-07-25 — Coast edit commit

**The unit of commit is the edit session, not the nudge.** Entering the coast
waypoint editor snapshots the committed plan; the user may then move anything
— both cards, positions, all axes — with live preview. **Update** compares
the working state to the snapshot and enables only when the outcome improved;
**Revert** restores the snapshot. Intermediate states are never commits.

This is what makes "only improvements are stored" workable. Three cases need
it: a single burn axis can always descend on its own (so a blocked Update
there genuinely means "wrong direction"); the position slider always makes
things worse until the burn is re-tuned; and redistributing effort between
two waypoints has no expression as a sequence of individually-improving
single-card steps.

### 2026-07-25, extended 2026-08-12 — Technology platforms

**One platform = one folder** holding the substance: geometry, parameters,
kinematics, drawing, and its calculator exchange packet. **Two thin role
adapters** sit on top — *departure* (a **carrier**: composes into the
kinematic chain and produces a release) and *arrival* (a **terminal** stage:
consumes the delivered ship-state and evaluates a catch). The roles cannot be
one descriptor: the registry validates `accepts`/`emits` statically, and
`mission-view.js` identifies tech stages structurally by those types. A
platform with only one real role ships one adapter.

Built as `modules/platform/platform-spec.js` + `-roles.js`. Five scope rules
bound it, each chosen so the six platforms still to be written (space
elevator, tug, ring mass driver, linear mass driver, tip spin launcher,
aerobrake) have an honest home:

- **A platform contributes one of TWO chain element kinds.** A ROTOR carries
  the payload round and lets go (skyhook, space elevator, ring mass driver,
  tip spin launcher); an IMPULSE pushes — a plain Δv with no position or
  motion of its own (linear mass driver, tug, chemical rocket). A surface
  launcher is normally both. Forcing an impulse into a rotor would mean
  inventing a radius and rate, and would point the velocity perpendicular to
  the radius, which is not where a track launches.
  `Shared/kinematic-chain.js` carries both; composition is a plain vector
  sum, so element order does not affect the result.

- **Platforms model kinematics and impulse only** — geometry, motion, the
  impulse imparted or absorbed, and the gates deciding whether that is
  physically available. Mass, taper, materials, power and cost stay in
  `Website/Calculators/` and reach a card through the exchange packet. This
  ceiling bounds every future platform's work and keeps one physics in one
  place.

- **The arrival role has two kinds.** `rendezvous` — the ship meets moving
  hardware and any speed gap is a trim burn (skyhook, elevator, tug); and
  `pass-through` — the flight itself sheds the energy, there is no hardware
  to meet, and the platform draws onto the trajectory rather than building
  geometry (aerobrake).

- **Second-layer add-ons are their own platforms riding the chain**, not
  modes inside a base platform — the skyhook already rides `moon-platform`
  that way. A platform declares `ridesOn` (`[]` must be the base, `"*"` free,
  or a list of platform ids), which IS the rule set for which combinations
  are offered. Deliberately left open: a two-layer CATCH, since the arrival
  stage is terminal and takes a ship-state, with no chain to extend.

- **A platform declares its own body applicability** (`bodies` plus an
  optional `appliesTo` predicate) and `ui/tech-options.js` asks it. Where a
  technology can be used is decided beside its physics, once. Only unbuilt
  `future` entries carry a hand-written body list, having no platform to ask.

Consequence: a platform's card is BUILT FROM ITS DECLARED PARAMS (label,
unit, scale, step, which roles show it, per-role label overrides), so adding
a control is a data change per platform rather than new DOM code.

### 2026-07-28 — Skyhook release phase is free, not kinematically constrained

The user picks a carrier platform's release **phase** freely rather than
having it constrained by real-time carrier kinematics. This keeps the app's
efficiency comparisons enjoyable rather than adding timing-realism busywork.
It is a property of the carrier-chain tech family in general, not of whether
the origin has a satellite, and it is what the Departure slider's pinned-start
behaviour rests on.

### 2026-07-31 — Overlays on the shared canvas must not have an opaque ancestor

The shell owns ONE renderer whose canvas sits behind the whole scene area,
and every pane draws by scissoring a rect of it. Any DOM overlay that wants
live 3D inside itself must be **transparent all the way up to the canvas**:
giving the overlay, or any ancestor of its 3D region, a background paints
over the exact pixels the scissored render just produced. An overlay that
needs visible chrome puts the background on sibling bands *around* the 3D
strip, never on the container.

Such an overlay must also be added to `mission-view.js`'s
`updateMainOcclusion` hole list, or the main pane's globally-painted
caption/HUD/label layers show through the transparent region.

(This has bitten twice — the floating panes and the ship card.)

### 2026-07-31 — Never dispose a shared THREE geometry on teardown

`ArrowHelper` builds its line and cone from two module-level geometry
singletons shared by every instance ever constructed; its materials are
per-instance. Disposing the geometry in a teardown pass blanks every arrow in
the app, and the failure is silent, appearing only on the *next* arrow drawn.
The same holds for any module-level geometry a widget reuses across instances
(the ship card's line cylinder). Teardown disposes materials only.

### 2026-08-03 — The ship card's gizmo draws lines, not arrows

Arrowheads crowded the gizmo, and the two layers hid each other where they
nearly coincide — the exact case the card exists to show. So: no heads,
needed drawn thick and current drawn thin, current always over needed.
Thickness has to be geometry (WebGL ignores `LineBasicMaterial.linewidth`),
so each line is a scaled cylinder. "Always on top" is two depth passes inside
the card's scissor rect — needed, a depth-only clear, then current — rather
than `depthTest: false`, so each layer keeps its own self-occlusion. The
second pass must null `scene.background`: a Color background makes three.js
force a full clear regardless of `autoClear`, wiping the first pass.

### 2026-08-08 — The arrival leg reads its start state off the coast, not off the packet

The arrival phase begins at the seam (`closest approach − Δt`), but the
packet the chain hands it sits later, at the coast's own leg end. That end
must stay where it is: `frozen-plan`'s boundary work and the arrival
comparison measure there, and at the seam the ship is a whole SOI radius from
the body, which would make every miss look enormous.

So `arrival-leg` takes the window from `computeArrivalSeam` and reads the
state at its left edge off `transfer-leg`'s own `legFor`/`stateAtElapsed`.
The packet still supplies `dvUsed`, and is the fallback when no coast leg is
reachable.

Corollary: **there is no constructed pass anywhere in the arrival phase.**
Where the ship goes past the destination, how close and how fast, are
whatever the coast delivers, integrated under the destination's gravity. A
mission that misses shows a miss.

### 2026-08-10 — Coast hand-off to Arrival is deferred, and snapshotted on the coast stage

Waypoint edits on Coast change the drawn arc immediately but reach the
Arrival phase only when the ship card's commit button is pressed. The
snapshot lives in the transfer-leg stage's `handoff` param (the waypoint list
as of the last commit; null means "nothing pending"), so it saves and
restores with the mission.

Why: there is no single correct coast — many passes arrive successfully — so
the user tunes against live readouts and commits when the pass is one they
want, instead of dragging the whole arrival phase behind every nudge.

Consequences, both deliberate:

- transfer-leg computes its leg TWICE while an edit is pending. `legFor`
  serves the live leg (drawn arc, chevron, ship card); `handoffLegFor` serves
  the committed one (emitted packet, events, everything Arrival reads).
- The emitted packet and events come from the hand-off, so the phase sliders
  and events bar hold still while the arc moves. Warnings come from the live
  leg, because they are feedback on what is on screen.

### 2026-08-10 — The Coast card's approach square is a B-plane bearing

Which side of the destination the ship passes is read off the B-plane — the
plane through the body's centre perpendicular to the incoming asymptote
(`OrbitalMath.bPlane`) — with ecliptic north projected into that plane as
"up". Not a view-direction projection: the B-plane is defined by the approach
itself, so the bearing stays stable and its sign never flips on a near-head-on
geometry. The dot sits at a fixed radius and conveys no distance.

### 2026-08-11 — Closest approach is measured in time, never off the polyline

`transfer-leg.nearestApproach()` is the single source for "how close does the
flight come to this body". It scans a coarse time grid to bracket the
approach dip, then ternary-refines every local minimum; resolution comes from
the refinement, not the grid.

Not the drawn samples: inside an SOI they come from the integrated encounter
and are dense, but outside one they are roughly a Kepler point per day —
hundreds of thousands of km apart at approach speeds. A sample-based figure
jumps discontinuously the moment a waypoint nudge moves the pass across the
SOI boundary, and is non-monotonic outside it.

The span is the leg PLUS its display overrun — the pass the reader is looking
at is the drawn one — which is why the overrun records segs
(`leg.overrunSegs`) even though it records no events.

### 2026-08-11 — The arrival seam is placed from a measured pass, not an event

`computeArrivalSeam` takes `{ destination, pass, fallbackArrivalJd }` where
`pass` is transfer-leg's `nearestApproach` result; `pass.insideSoi` is what
makes it an encounter. It does not read an emitted closest-approach event.

Why: an event is emitted per SOI encounter and measured inside the leg's own
span, so it disappears when the encounter falls past the leg's end and
reports the leg boundary when the leg ends before periapsis. Either way the
window jumped to the plan's committed epoch and the Arrival phase landed on
the wrong days as the coast was tuned.

Consequences:

- Coast and Arrival remain separate chains but describe ONE pass. The coast
  measures it to place the window; the arrival leg integrates that window in
  the body frame and finds it independently. The two agree to ~1 km and a few
  seconds, and a test holds them there.
- `arrival-leg` takes closest approach only from its segments' own refined
  minima, never seeded from the window-start distance, and reports `caAtEdge`
  when the minimum sits on a window boundary.
- transfer-leg replaces the destination's own closest-approach event with the
  measured pass, so the events bar and the ship card cannot disagree.

### 2026-08-11 — An SOI candidate is tested after refinement, never on the grid

`findFirstEncounter`'s end-of-window case requires only that the distance
still be descending at the last grid point. It must NOT also require that
point to lie inside the SOI: a pass whose periapsis falls inside the window
but which has climbed back out by the window's end would be rejected, and the
body's gravity never applied to the arc at all — a trajectory error, not just
a reporting one. Whether the dip truly enters the SOI is settled after
ternary refinement.

### 2026-08-11 — World save format has no migration; a version mismatch is refused

`deserializeWorld` refuses any save whose `version` isn't exactly
`WORLD_VERSION`, older or newer. The version stamp still exists, so a stale or
foreign save is refused with a clear reason instead of being misread against a
stage contract it wasn't written for.

Why: the only holders of old saves are `localStorage` autosave and share
links, both test data with no value beyond the current session. Checked-in
presets never relied on migration either — each is hand-edited to the current
version, so the shipped file doubles as the canonical example of the chain's
present shape.

### 2026-08-11 — There is no Coast→Arrival compliance boundary

`frozen-plan`'s departure-side boundary has no mirror at the far seam, and a
stage that tried to be one was removed.

Why: `frozen-plan` earns its boundary two ways — it is what the coast
*actually starts from* (an authoritative substitute, so a broken departure
tech never blanks the mission), and it is the only target departure tech has,
since a skyhook doesn't know where the destination is and just delivers a
velocity. Neither applies at arrival: there is nothing to substitute, and
`transfer-leg` isn't blind — it targets the real destination and reports the
actual approach live as waypoints are tuned. A boundary there would be a
second rendering of numbers the coast already shows. The ship card's
Coast-phase job is to show progress toward the destination, not to re-litigate
the plan the coast was frozen from.

Consequence accepted, not fixed: a broken departure/coast leaves `arrival-leg`
in the ordinary `blocked` state rather than getting a tailored "nothing
delivered" diagnostic. That is the standard block propagation every other
stage has.

`frozen-plan`'s `arrival: { body, jd, vInf }` commitment is untouched —
`arrival-seam.js` and `arrival-skyhook.js` read its `jd` as a fallback
default.

### 2026-08-11 — The Coast card's timing readout compares to the last commit, not the plan

`ui/ship-card.js`'s `timingModel`/`setTiming` take `(deliveredJd, refJd)` and
return a plain `{ hours }` delta, rendered as one line ("4.6 h later").
`mission-view.js` feeds it the coast's own last-committed arrival pass — the
same reference the approach chips use — and only while an edit is pending.

Why: the readout's job is "how does the trip's duration move as I tune this",
not "how far off the original plan am I". The plan's ±1-day window doesn't
carry over either — that is a real compliance tolerance for the departure
seam, but "how much has this edit moved things" has no natural fixed width.

### 2026-08-11 — Arrival compliance is measured at the pass, never at a leg's end

Every row of the Coast→Arrival comparison — encounter, v∞ and epoch —
measures the destination pass (`transfer-leg.nearestApproach`), reached
through `arrival-approach.js`'s `approachFromPass`. `approachAt`, which
measures at a delivered packet's own epoch, remains only as the fallback for
when no trajectory is reachable.

Why: a leg's end is `jd0 + legDays` — a parameter, not an event. Measuring
there made the epoch row structurally incapable of moving when waypoints were
tuned, and made the encounter row report the separation at an arbitrary
instant.

The same rule applies to any stage asking "what approach do we have":
arrival-skyhook takes the arrival leg's own pass (`arrival-leg.passFor`), not
the state at its leg end.

### 2026-08-19 — Each waypoint readout pane tracks ONE lever, live

The two panes beside a coast waypoint each report a single thing, with no
plan-relative diffing between them:

- the **waypoint** section's pane reports the PLAN's own burn fired from
  wherever the waypoint currently sits — the same fixed burn numbers every
  time, read through whatever local frame the live (possibly relocated)
  position puts them in. It moves only when the location moves.
- the **impulse** section's pane reports only what has been added on top of
  that baseline — the burn edit itself, isolated from where the ship happens
  to be when it fires.

The plan section's own descriptive line always describes the frozen plan's
own day and never changes.

Why: raw pro/rad/nrm components are read off whatever local frame the ship is
in on its OWN day, so moving a waypoint's day rotates that frame and identical
components stop meaning the same physical burn. Splitting the two levers apart
means neither pane has to compare across frames at all.

### 2026-08-21 — The Ephemeris scene shows the timeline's date, never the marker's implied one

`ephemeris-view.js`'s `updateMarker()` re-poses every body in the scene to
the DATE BAR's own `dateState.jd`. It must never reposition the system to the
marker's implied arrival time (`dateState.jd + tof / DAY`), however
convenient that looks for lining a body up with the ship.

**What the "×" means:** it marks where the destination will be at the
marker's implied arrival time — a genuinely future position, drawn *while the
rest of the scene stays at the timeline's own date*. The point is to let it
visibly diverge from the destination's current rendered position; posing the
scene at the implied time makes the two coincide and defeats it.

This once broke for weeks unnoticed, because the × and the mis-posed
destination landed on top of each other and nothing looked wrong in
isolation. **In this tab, "the visible symptom looks plausible" is a weak
signal** — check a body's rendered position against what the date bar claims
"now" is, directly, when in doubt.

### 2026-08-24 — The Ephemeris tab authors the HAND-OFF, not a burn at the body's centre

A ship is not on an interplanetary flight until it is clear of the origin, so
the flight starts at the origin's SOI crossing — in the tab and in the freeze
both.

The Departure card's prograde/radial/normal vector IS the ship's
v-infinity — speed and heading — where it leaves the origin's sphere of
influence, and the tab's clock IS that hand-off's epoch. The drawn arc starts
there, at t = 0. `core/freeze.js` commits that state verbatim.

Why: the frozen plan's Departure→Coast boundary already IS a hand-off state
(`frozen-plan.departure.{r,v,jd}`). Editing that same quantity means the two
sides never translate, so freeze commits verbatim and "Paste mission link…"
reads back verbatim — the round trip is exact by construction, for any plan,
including one whose hand-off came from a real carrier chain rather than an
authored heading.

The Moon assist is INFORMATION only: `departure-estimate.js` reads it
backwards from the hand-off, for the Moon widget and the release-anchor
readout, and it never bends the drawn arc. (Folding it into the authored burn,
as an earlier model did, needed three separate two-pass nettings to undo,
which disagreed by 131.56 m/s on a real plan — about 3 M km of arrival error
over a 273-day coast.)

**Where on the SOI sphere the ship exits** is `state.handoff`, with two modes.
DERIVED (authoring from scratch): one SOI radius along the outbound asymptote,
so it tracks the heading as the card is edited. ADOPTED (pasting a mission):
the plan's own body-relative offset, held fixed, because a real departure
chain's exit point is not something the tab can reconstruct. An adopted offset
survives date scrubs; changing the origin drops back to derived, as does the
card's "re-derive exit point" control. The two can place the coast's start up
to ~2 SOI radii apart — ~1.85 M km at Earth — so the readout always names
which is in force.

The arrival side is untouched: the marker's rendezvous is still the
destination body's own position, with SOI entry estimated backwards from it.

`injectionJd` is a legacy field. Nothing reads it, freeze does not write it,
and older saves carrying it load fine.

### 2026-08-25 — Re-targeting the departure, not adopting what it delivers

A frozen plan commits to a hand-off STATE — position, velocity, epoch at the
origin's SOI edge. When the Ephemeris tab authors one from scratch, that
position is DERIVED (body position + R_soi × heading): a geometric
convenience, not a place any real departure chain comes out. On the shipped
Moon→Ceres mission the chain exits 209,335 km from the point its plan assumes,
and that offset alone — flown with the plan's own waypoint burns — throws the
arrival 2,374,577 km off.

So the mission bar's button does not adopt the delivered hand-off. It
RE-TARGETS: keep the exit point and epoch the technology actually reaches, and
re-solve the velocity that reaches the plan's destination FROM there
(`core/retarget.js`). The plan then states a requirement that is both
achievable and correct, and the user re-tunes the technology towards it.
Re-tuning moves the exit point a little, which re-targets a little: a loop
that closes on something the technology can really fly.

WHY NOT LET THE COAST ABSORB IT: a coast waypoint is a trim, capped at ±100
m/s per axis (`WAYPOINT_AXIS_CAP_MPS`), and its job is drift. Spending that
budget on a departure geometry error two orders of magnitude larger leaves
nothing for what the budget is for.

THE SOLVE is a damped Newton differential correction on the departure
velocity, flying the whole coast through its waypoint burns. Aiming at the
plan's first waypoint instead is NOT enough: matching position there leaves a
velocity mismatch that grew into a 249,418 km miss over the remaining 275
days. The conic-only solve is then VERIFIED by flying it through `computeLeg`,
which integrates SOI encounters.

SEEDED FROM REAL TRAJECTORIES — the velocity the technology delivers, then the
one the plan commits to — never from a two-point conic. A Lambert arc answers
a different question ("what orbit joins these two POSITIONS in this time") and
is singular where the two points are 180° apart, since the plane through them
is undefined. Seeded there, the correction starts an out-of-plane climb it
cannot walk back: on a 551-day Earth→Ceres coast sweeping 176.5° it stalled
9.7 million km from the aim, and the stalled velocity was returned as the
requirement — 12.34 km/s with an 11.2 km/s normal. Seeded from the delivered
velocity the same case converges exactly, to a 108 m/s trim. Nothing in the
flight is singular there; the state has a definite position and velocity at
every point, and a correction that starts from one arrives.

A SOLVE THAT DID NOT REACH ITS AIM IS NOT AN ANSWER. The correction returns
its best attempt whatever happens, so a residual over one `AIM_PASS_ALTITUDE`
is reported as "no requirement to state", never as a requirement.

RE-TARGETING DOES NOT TOUCH `releaseAnchorJd`. The anchor is when the chain
actually lets go; re-deriving it would make the button chase a hand-off that
moves every time it is clicked. Leaving it alone makes it idempotent —
repeated clicks settle on one answer and stop.

What it re-bases: waypoint days shift with the hand-off so every burn keeps
its ABSOLUTE epoch, and `legDays` stretches so the arrival still lands on the
committed date. The arrival commitment is untouched.

### 2026-08-26 — A re-target aims for a PASS, not the plan's arrival point

`solveDepartureTarget` aims for closest approach at `AIM_PASS_ALTITUDE`
(15,000 km above the destination's surface) on the side the flight already
goes by, and the standard it must land inside is `MAX_PASS_ALTITUDE`
(30,000 km). Both are altitudes above the SURFACE, at closest approach — what
the arrival phase deals in.

THAT PASS IS THE WHOLE OF `withinTolerance`, and the only thing Update is
gated on. The SIZE of the change a re-target asks the departure for decides
nothing: a requirement is correct when meeting it lands the mission at the
destination, and a correct requirement does not become wrong for being
expensive. An ask the technology cannot meet yet is answered by building the
technology up towards the Needed column — that is what the column is for. The
ask is still reported, so the mission report can show it shrinking across
iterations. (Superseded 2026-08-31: it was previously also held to
`WAYPOINT_AXIS_CAP_MPS`, ±100 m/s per axis, which blocked correct
requirements — the course-correction budget is a bound on a coast trim and has
nothing to do with what a departure must deliver.)

WHAT THIS GIVES UP, deliberately: a plan's own flyby offset. THE SIDE of the
body is kept; only the distance is standardised. The offset is whatever the
Ephemeris tab happened to be pointed at, and once a real departure is flying
the mission what matters is arriving close enough for the arrival phase to
take over. This is what lets the Earth→Mars reference — authored around a
~44,100 km flyby, and previously impossible to re-target — land at 14,893 km.

AIMING INSIDE THE BOUND IS THE POINT. A re-target cannot land on its own
answer: solving moves the requirement, re-tuning moves the exit point, and the
next flight starts somewhere new. Aiming at half the bound leaves that
residual room to land in.

Closest approach does not fall at the coast’s horizon, so one solve
does not hit the aim. The solve iterates: target the body's position at that
epoch pushed out along the pass's own direction, fly it for real, correct by
the altitude error, repeat — converging in 2–3 passes, 8–16 ms.

STILL PROVISIONAL: the honest bound is what the arrival technology can catch —
a cone of approach vectors and a maximum speed, per destination and per
technology. These two flat numbers stand in until the arrival module can say.

### 2026-08-26 — Moving the clock recomputes nothing

A `world.set({ jd })` fires a pass at the recompute engine's listeners
carrying the results as they stand, and reruns no module's `update()`.
Parameter changes recompute from the dirty stage downstream as before.

WHY IT IS SAFE: no module's `update()` reads the clock. Every `world.jd`
reference in a module is inside `draw()` or a card renderer. The clock decides
what a stage DRAWS — where the chevron sits, the speed under it, where the
bodies are — never what it COMPUTES. A stage that needed the clock inside
`update()` would break this rule.

WHY IT MATTERS: a leg passing through a body's SOI is RK4-integrated and
dominates — the shipped Moon→Ceres coast costs 4.4 ms per pass, and
transfer-leg flies it TWICE whenever a waypoint edit is pending. Recomputing
for the clock paid that on every tick of a slider drag for an answer that
could not have changed. Measured end to end: 23.7 ms → 15.8 ms per clock tick.

This is what makes live derived figures affordable — anything keyed on the
plan rather than the clock can be recomputed on edits alone and memoized
across scrubbing.

### 2026-08-26 — The mission bar states the flight the ship is actually on

EVERY FIGURE IN THE BAR — v∞ out, coast Δv, closest approach, v∞ in —
describes the flight flown from what the departure technology is delivering according to the latest update,
through the waypoints as they currently stand (`core/delivered-flight.js`).
Not the plan's commitments and not its requirements.

WHY THIS IS ONE RULE AND NOT FOUR CHOICES: there is only ONE closest approach,
one v∞ out, one v∞ in, and the bar states them. Since the flown flight became
the clock the drawn coast flies from the same delivered hand-off, so the bar
and the trajectory agree by construction. What they still measure differently
was their HORIZON, and since no arrival date is committed any more both fly
the coast's own `legDays`.

GRADED: v∞ out (against the plan's requirement, or a standing Check's target)
and closest approach (against `MAX_PASS_ALTITUDE`). Coast Δv and v∞ in are
not, because neither has a standard.

PHASE DOTS ARE HARD-FAULT LIGHTS ONLY — err or blocked. Compliance is the
COLOUR OF THE FIGURE beside the button, so the grade and the number it grades
are read together.

CHECK READS, UPDATE WRITES. Check re-solves the requirement at the real exit
point and reports it, touching nothing; its answer becomes a provisional
target held in the view (never in the World, so nothing redraws and nothing is
saved) that the Departure card's Needed column steers at. Update re-solves
from the CURRENT delivery — deliberately not Check's stored answer, stale the
moment the technology is re-tuned — and commits that.

LIVE, NOT SNAPSHOT. The figures recompute on every edit and are memoized on
(delivered hand-off, waypoints), never on the clock, so scrubbing is free and
an edit costs about one leg integration (3.8 ms on the shipped mission).

### 2026-08-26 — What the compliance check is, and what it is not

THE CHECK (`frozen-plan.js`'s `computeCompliance`) compares the plan's frozen
hand-off against the technology's delivered one on exactly three scalars:

    |v_inf| within 10 m/s, aim direction within 1 degree, epoch within the
    plan's hand-off window (+/-1 d default).

POSITION IS NEVER COMPARED. The two r vectors are read only to check they are
finite, and the delivered one is copied out so the re-target can use it.

The position hole is real. A chain matching v∞ to 10 m/s and 1° can still exit
the SOI hundreds of thousands of km away, because where a trajectory crosses
the SOI depends on its PERIAPSIS, not only on its asymptote. From LEO the exit
point sits 0.8° from the asymptote direction; from lunar distance, 25°. The
Ephemeris tab places a derived hand-off at `body position + R_soi × unit(v∞)`,
which is therefore accurate for a low-periapsis departure and tens of degrees
out for a high-periapsis one. Measured on Moon→Ceres with the technology tuned
so heading and speed match exactly: all three rows PASS, and the flight still
passes 13.9 million km from Ceres while the drawn trajectory shows a clean
17,185 km arrival. That is the case the mission bar exists to expose.

THE FIX IS NOT A FOURTH COMPLIANCE ROW. A position readout reports a number
the user cannot act on — no control sets an exit point, and aiming at one
would not improve the arrival. The explanation belongs in the message bar,
whose job is to say why the figures are changing.

### 2026-08-28 — The marker card's swept-angle hold is analytic, not sampled

The Ephemeris tab's marker card can hold the ship's "radial from origin"
(swept true anomaly) fixed while the departure impulse or timeline is edited.
That hold is computed from `Shared/math-utils.js`'s `sweptTrueAnomaly` /
`timeAtSweptTrueAnomaly` — closed-form functions of the leg's own conic
(a, e, nu at the hand-off), NOT by sampling the drawn polyline and unwrapping
its discrete true-anomaly differences.

WHY: the true anomaly does not sweep at a uniform rate (Kepler's second law),
but the MEAN anomaly does — it is the angle on the ellipse's own reference
(auxiliary) circle, moving at the exact constant rate `meanMotion(a)`. Solving
through mean anomaly gives an EXACT, unbounded-lap inverse for any dt, with no
sampling error and no artificial range.

THE SAMPLED APPROACH FAILED SILENTLY: its usable degree range was however far
the leg happened to be drawn (`legDays`, sample density), which could shrink
between recomputes for reasons unrelated to the marker's own position.
`timeAtDeg()` clamped an out-of-range hold to the table's nearest edge, so a
plain burn edit or timeline scrub could snap the marker to the start or end of
the drawn arc and leave it stuck there — never reaching back the angle it was
actually holding once the range recovered.

Elliptical (e<1) needs one lap-count (`floor`) after solving the wrapped
Kepler equation, since `trueAnomalyFromMean` always returns a value in
`(-PI, PI]`; hyperbolic (e>=1) needs none, being already a monotonic bijection
over all reals. See the functions' own headers for the exact bookkeeping.

### 2026-08-28 — One clock: the flown flight is what the coast flies

`frozen-plan.update()` emits the state the departure technology ACTUALLY
DELIVERED — position, velocity and epoch. The coast therefore begins exactly
where and when the departure phase ended: one mission clock, one epoch at the
seam. The plan's frozen `departure` is the REQUIREMENT the compliance rows
grade against and a mark on the timelines, never a second flight.

FALLBACK: with nothing delivered — an empty technology slot, or a departure
whose flight fails — the plan's own frozen state is what the coast flies. That
is what keeps a freshly frozen mission flying while its departure is built,
and it is the whole of the `boundary` carve-out's remaining job.

WHAT THIS REPLACED: the plan used to be authoritative for the drawn coast, so
the seam carried two epochs a ±1 d window had to reconcile — the tech's real
SOI exit and the plan's committed hand-off — with the ship parked at both ends
of the gap at once. Every figure that mattered then had to be computed twice,
once for what was drawn and once for what was flown
(`core/delivered-flight.js`).

THE VISIBLE COST, ACCEPTED: the shipped Moon→Ceres preset's skyhook does not
deliver its committed hand-off (its injection has no modelled tech yet), so
the preset's coast now misses Ceres by 1.2 AU instead of drawing a clean
arrival. That was always the truth; only its hiding place has changed.

### 2026-08-28 — Waypoints are held by swept angle when the arc moves

When the trajectory under a waypoint changes, the burn keeps the HELIOCENTRIC
ANGLE it sweeps from the hand-off, not the number of days it sat at. A
waypoint belongs to a point on the arc, and days are only how that point is
addressed. Same hold the Ephemeris tab's marker uses ("deg" mode).

The conversion is two-sided by necessity — an angle can only be read off the
leg the waypoint is on and only inverted on the leg it is moving to — so it is
two functions, `transfer-leg.js`'s `sweptAnglesOf` and `placeAtSweptAngles`,
with the recompute in between (`mission-view.js`'s `applyRetarget`).

NOTHING IS DROPPED: a waypoint whose angle a shortened leg never reaches
clamps to that leg's end. The plan's reference copy is index-matched against
this list (`planWaypointsFor`), and a hole would mis-pair every waypoint after
it.

### 2026-08-28 — Update is a full commit

Update re-solves the departure requirement at the real exit point and writes
it, and then leaves nothing downstream stale: `legDays` is reset so the
arrival still lands on the committed date, the plan's reference waypoints are
re-based to keep their absolute epochs, the working waypoints are re-placed by
swept angle on the new arc, and the coast is handed to Arrival
(`commitHandoff`). An Update is a commitment, so the arrival phase runs on the
trajectory it commits to.

Check still writes nothing. The release epoch is still untouched — it lives on
the departure leg, and moving it would leave it chasing a hand-off that shifts
every time the button is pressed.

### 2026-08-28 — The arrival date is measured, not committed

A frozen plan commits to a DESTINATION and an APPROACH v∞ — where the mission
is going and how fast it may show up, the two things an arrival technology has
to be built for. It commits to no DATE. The mission arrives at the coast's own
measured closest approach (`transfer-leg`'s `nearestApproach`), which moves as
the flight is tuned, exactly as the departure epoch is whatever the technology
delivers.

`frozen-plan`'s `arrival` is therefore `{ body, vInf }`, and it emits no
arrival event: the coast measures the pass and emits it, so there is one
arrival epoch rather than a measured one competing with a committed one.

THE HORIZON IS NOT AN ARRIVAL DATE. Flying an arc still needs an end, and that
is `transfer-leg`'s own `legDays` — a duration the coast owns, seeded at
freeze from the epoch the Ephemeris tab's marker was scrubbed to. The
re-target solve aims at where the destination will be at that horizon
(`retarget.js`'s `horizonJd`, named for what it is), and closest approach
falls wherever it falls inside the span. `Update` no longer stretches
`legDays`, there being no committed date left to stretch it to.

WITH NO ENCOUNTER there is no arrival to date. The seam collapses to the
coast's own end and the Arrival phase places a standard-width window there —
the same fallback the arrival leg and the sliders use, so they agree. The
flight's true closest approach can sit far earlier (the shipped preset's is
182 million km out, twenty months before its coast ends), and using THAT as
the arrival would drag the arrival phase back into mid-cruise. Closest
approach is the arrival date when the flight actually reaches the body; short
of that, the end of the coast is the only honest anchor.

### 2026-08-31 — A mission carries a plan history; a link carries two sets of it

A mission's plan is not only what it holds now — it is also what it held when
it was frozen. `core/revisions.js` keeps that: an ORIGINAL (the serialized
World `core/freeze.js` wrote) plus a STEP per commit. Each entry is a whole
serialized World, never a diff, because a World already is the complete
description of a mission and there is no smaller thing a plan can be rebuilt
from.

TWO SCOPES, DIFFERENT SIZES. Locally the whole run of steps is kept — it costs
about a kilobyte a commit and it is what the mission report reads. A LINK
carries exactly two: the original, and the latest step if there is one.
Intermediate steps are the author's working record and nobody else's, and a
link has to fit in a chat message.

MARKING A MISSION FINISHED COMPACTS to original + finished, discarding the
steps between — the same shape a link carries. `markFinished` exists and is
tested; the control that calls it belongs to the arrival phase and is not
built yet. Finishing does not lock: a later edit simply starts accumulating
steps again.

LINKS ARE DEFLATE-COMPRESSED (`Shared/exchange.js`'s `encodeFragmentZ`, marked
with a leading "z"; plain fragments always start "ey"). Two sets do not fit in
a Discord message uncompressed — 2,768 characters against a 2,000 limit — and
compress to about 717, because the sets are near-copies of each other. The
sync `encodeFragment`/`decodeFragment` are untouched and remain the
calculators' `#pkt=` transport. There is no synchronous inflate, so the
planner's start-up and the paste dialog are async.

PASTING SPLITS THE TWO SETS BY WHAT THEY ARE. The original loads into the
Ephemeris scratchpad, which is where a plan is authored and revised; the
latest opens as its own mission tab, because a committed plan with a
technology stack behind it is a mission, not a sketch. A link with one set
does what paste always did. The scratchpad is a singleton with no undo, so the
paste dialog carries a standing warning to use another browser window to keep
what is there.

THE REPORT'S ORIGINALS TABLE IS STORED VALUES ONLY (`planSummaryOf`) —
read off two serialized Worlds with no physics, so the frozen column costs
nothing however old it is and cannot drift from what was committed. Derived
figures stay in the report's flight table, which is recomputed live. A
technology's dials are enumerated from whatever params its stage holds, keyed
by module and occurrence rather than chain position: a technology added above
another must not make the other's dials read as changed.

THE MOON IS AN ORIGIN (2026-09-01). A mission may depart from the Moon. That
makes it the one origin whose departure phase ends at a DIFFERENT body's
sphere of influence than the one it left: a ship leaving the Moon is still
850,000 km inside Earth's SOI, so the hand-off is at Earth's edge and its v∞
is measured against EARTH's heliocentric velocity. `Shared/frames.js` holds
both halves of that split — `bodyHelioState` resolves the Moon's POSITION
through the lunar ephemeris (a second hop; it has no Sun-centred ellipse),
while `escapeReferenceFor` answers the separate question of which body's
velocity a hand-off is measured against. Measuring against the Moon's own
velocity instead would fold its monthly 1 km/s swing into compliance, so the
same plan would grade differently by lunar phase.

THE LUNAR DEPARTURE CARD IS THE SHIP'S SHARE; THE MOON'S IS A BONUS
(2026-09-02). The Departure card at a Moon origin states what the SHIP's own
actions deliver at Earth's SOI — release plus burns — and nothing the Moon
contributes appears in it. The card is the ship's bill, comparable with every
other origin's, and like every other origin's it is the EDGE speed (see the
entry above). The Moon's ~1,022 m/s rides on top for free — a BONUS, reach the
ship did not pay for, not a discount on the bill: the card is the input and the
arc is the output, so what the Moon adds is extra distance rather than a
smaller requirement. On the wrong phase it is a penalty instead. It is handed
over deep inside Earth's well, so what reaches Earth's SOI is a RESIDUAL:
sampled over dates and cards it runs 0.9 to 1.9 times the Moon's own speed,
above face value about half the time. The drawn arc uses card + residual, so
the same card on a different day of the lunar month is a different trajectory
while the card keeps reading what the ship must supply.

The two shares cannot be propagated separately and added: energy goes as speed
squared, and the Moon's 1,022 m/s alone does not even escape Earth (escape at
lunar distance is 1,440 m/s). So `core/lunar-departure.js` runs the chain
through the one state where both are simply present together — the ship's
velocity at the Moon. The card is INVERTED to that velocity (vis-viva fixes
its speed; a 1-D solve fixes its direction), the Moon's velocity is added
there, and the sum is taken out through Earth's well exactly. Validated
against numerical integration to six significant figures and 0.005°, with a
null control: zero the Moon's velocity and the residual vanishes.

LUNAR DEPARTURES HEAD AWAY FROM EARTH, OR ARE REFUSED (2026-09-02). Only
departures moving outward at the Moon are supported, which keeps the ship from
passing Earth on the way out and picks one of the two inversion branches. A
card fixed on Earth's heliocentric axes points the same way all month while the
Moon goes round it, so roughly half of all (date, card) pairs are refused by
name — `card-needs-earth-pass` most often — and drawn not at all rather than
drawn wrong: the Ephemeris tab clears the trajectory on a refusal, because the
state it would otherwise propagate is the Moon's own and the arc it produces is
just the Moon coasting on around the Sun — plausible-looking, and not the
flight. The dive-to-low-periapsis Oberth departure is a real and powerful
manoeuvre that this excludes; it is deferred, not rejected, and every refusal
routes through `flyEarthPassDeparture` — a placeholder returning null today —
so filling it in needs no new wiring.

EARTH IS AN ORDINARY ORIGIN (2026-09-01). It departs from Earth the way Mars
departs from Mars: the generic `body-departure-leg`, a self-originating
skyhook, no platform stage. Only a MOON origin gets `moon-platform` +
the geocentric `departure-leg`. This replaces the old arrangement where an
"Earth" origin silently meant a lunar departure — the shipped mission was
titled "Moon → Ceres" while storing origin "Earth". With it goes the
dive-in/direct-out Moon-wedge estimate, which existed to time that lunar
departure and is superseded by solving it.

THE CARD IS THE EDGE SPEED; THE ARC FLIES THE ASYMPTOTE (2026-09-03, replacing
the 2026-09-01 entry that covered only the estimate). The Departure card states
the ship's velocity AT the SOI edge, on the escape reference's heliocentric
axes — a boundary summary, in the convention a first-pass mission design is
read in. It is NOT the hyperbolic excess: the primary's potential is not yet
spent there, 928.5 m/s worth for Earth, 24.8 for Mars.

So every consumer that works in energy terms converts first
(`departure-estimate.js`'s `asymptoticVInf`, and `edgeVInf` back):

- The DRAWN ARC leaves on the asymptote. Handing it the edge speed let it keep
  energy the primary was still owed — 147 m/s of a 3 km/s card, 322 m/s of a
  1.5 km/s one, since it is speeds squared that subtract.
- The DEPARTURE ESTIMATE converts, or it overstates the energy and shortens
  the span by 8% for a fast departure and 24% for a slow one.
- TARGET MODE converts BACK: Lambert answers in the arc's frame, so the solved
  vector is scaled up to an edge speed before it is written to the card or
  checked against the budget. Round-trips to 4e-12 m/s.
- A LUNAR card converts before the inversion, since `solveShipVelocity` inverts
  an escape hyperbola.

A card that does not escape the reference's SOI is not a departure and is not
drawn: refused as "card-below-escape" at the Moon (the ship's share must be an
escape in its own right for the decomposition to state it separately), and as
no flight at any other origin. This includes the tab's opening state — with no
card, drawing the origin body's own orbit around the Sun was the misleading
default it replaced.

The coast is unaffected: it propagates a full state, not an asymptote.

The hand-off is therefore position at the SOI boundary with the velocity the
ship has once the primary is fully behind it — deliberately a convention
rather than a physical instant, since the ship is not yet moving that slowly
where it is placed. The alternative (collapsing the boundary to the body's
centre) would throw away the exit point, which `state.handoff` and the
re-target both need.
