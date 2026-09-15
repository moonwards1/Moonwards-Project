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

### 2026-07-25 — Departure timeline

The Departure slider spans the departure flight itself: pinned at the release
epoch (the departure leg's `releaseJd`), ending at the predicted origin-SOI
exit, or at the flight-time estimate before a technology resolves one. Same
for every origin. The plan's committed hand-off is a MARK on the track, never
an edge; when the flight finishes early the track extends to keep the mark on
it.

Why: the plan states a requirement at the boundary, not how the departure
phase runs, so slack and overrun both have to be visible.

### 2026-07-25 — Waypoint impulse controls, coast

Each axis of a coast waypoint burn moves at most ±100 m/s from its baseline
(`WAYPOINT_AXIS_CAP_MPS`), and typed entry is hard-clamped to that too. The
numeric fields step 0.1 m/s; shift-drag on an arrow is the fine mode.

Why: a waypoint is a trim, not an injection, and below ~0.1 m/s the effect
drops under the model's own fidelity.

### 2026-07-28 — Carrier release phase is free

The user sets a carrier platform's release phase (`releasePhaseDeg`) freely;
it is not constrained by the carrier's real-time kinematics. This holds for
the whole carrier-chain family, at every origin.

Why: efficiency comparisons stay enjoyable rather than turning into timing
busywork.

### 2026-07-31 — Overlays on the shared canvas must not have an opaque ancestor

The shell owns ONE renderer whose canvas sits behind the whole scene area;
every pane draws by scissoring a rect of it. A DOM overlay with live 3D inside
must be transparent all the way up to the canvas. A background on the overlay
or any ancestor of its 3D region paints over the pixels the scissored render
just produced. Visible chrome goes on sibling bands around the 3D strip.

Such an overlay must also join `mission-view.js`'s `updateMainOcclusion` hole
list, or the main pane's caption/HUD/label layers show through it.

### 2026-07-31 — Never dispose a shared THREE geometry on teardown

`ArrowHelper` builds its line and cone from module-level geometry singletons
shared by every instance; its materials are per-instance. Disposing that
geometry blanks every arrow in the app, and the failure is silent until the
*next* arrow is drawn. The same holds for any module-level geometry a widget
reuses (the ship card's line cylinder). Teardown disposes materials only.

### 2026-08-03 — The ship card's gizmo draws lines, not arrows

No arrowheads; needed drawn thick, current thin, current always over needed.
Thickness is geometry (a scaled cylinder), because WebGL ignores
`LineBasicMaterial.linewidth`. "Always on top" is two depth passes inside the
card's scissor rect (needed, depth-only clear, current), not
`depthTest: false`, so each layer keeps its own self-occlusion. The second
pass must null `scene.background`: a Color background makes three.js force a
full clear whatever `autoClear` says, which silently wipes the first pass.

Why: heads crowded the gizmo and hid each other exactly where the two vectors
nearly coincide, which is the case the card exists to show.

### 2026-08-10 — The Coast card's approach square is a B-plane bearing

Which side of the destination the ship passes is read off the B-plane
(`OrbitalMath.bPlane`, fed by `nearestApproach`'s body-relative state), with
ecliptic north projected in as "up". The dot sits at a fixed radius and
conveys no distance.

Why: the B-plane is defined by the approach itself, so the bearing is stable
and never flips sign on a near-head-on pass the way a view projection does.

### 2026-08-11 — Closest approach is measured in time, never off the polyline

`transfer-leg`'s `nearestApproach()` is the single source for "how close does
the flight come to this body". It scans a coarse time grid and ternary-refines
every local minimum; resolution comes from the refinement. Its span is the leg
PLUS its display overrun, which is why the overrun records segs. transfer-leg
replaces the destination's own closest-approach event with this measurement,
so there is one figure, reported once.

Why not the drawn samples: outside an SOI they are about a Kepler point per
day, hundreds of thousands of km apart, so a sample-based figure jumps when a
waypoint nudge moves the pass across the SOI boundary.

### 2026-08-11 — An SOI candidate is tested after refinement, never on the grid

`findFirstEncounter` accepts a still-descending dip at the window's last grid
point as a candidate without requiring that point to be inside the SOI.
Whether the dip enters the SOI is settled after ternary refinement.

Why: requiring it on the grid rejects a pass whose periapsis is inside the
window but which has climbed back out by its end, and the body's gravity is
then silently never applied to the arc.

### 2026-08-11 — World save format has no migration

`deserializeWorld` refuses any save whose `version` isn't exactly
`WORLD_VERSION`, with a clear reason. Presets are hand-edited to the current
version and double as its canonical example.

Why: the only old saves are autosave and share links, test data with no value
past the session.

### 2026-08-12 — Technology platforms

One platform = one folder holding the substance: geometry, parameters,
kinematics, drawing, and its calculator exchange packet
(`modules/platform/platform-spec.js`). Two thin role adapters sit on top
(`platform-roles.js`): *departure*, a carrier that composes into the kinematic
chain and produces a release; and *arrival*, a terminal stage that evaluates a
catch on the delivered ship-state. They cannot be one descriptor, because the
registry validates `accepts`/`emits` statically and `mission-view.js` finds
tech stages by those types. A platform with one real role ships one adapter.

- **Two chain element kinds** (`Shared/kinematic-chain.js`): a ROTOR carries
  the payload round and lets go; an IMPULSE is a plain Δv with no position or
  motion. Composition is a vector sum. An impulse forced into a rotor would
  need an invented radius and rate and would point the wrong way.
- **Kinematics and impulse only.** Mass, taper, materials, power and cost stay
  in `Website/Calculators/` and reach a card through the exchange packet, so
  there is one physics in one place.
- **Two arrival kinds**: `rendezvous` (meet moving hardware; any speed gap is
  a trim burn) and `pass-through` (the flight sheds the energy; the platform
  draws onto the trajectory).
- **Add-ons are their own platforms riding the chain**, declared by `ridesOn`
  (`[]` base only, `"*"` free, or a list of ids). That declaration IS the rule
  set for which combinations are offered.
- **A platform declares where it applies** (`bodies` plus optional
  `appliesTo`), and `ui/tech-options.js` asks it. Only unbuilt `future`
  entries carry a hand-written body list.

A platform's card is built from its declared params, so adding a control is a
data change, not new DOM code.

### 2026-08-19 — Each waypoint readout pane tracks ONE lever, live

The **waypoint** section's pane reports the plan's own burn fired from
wherever the waypoint now sits; it moves only when the location moves. The
**impulse** section's pane reports only the edit on top of that baseline. The
plan section's descriptive line always describes the plan's own day.

Why: pro/rad/nrm components are read in the local frame of the ship's own
day, so comparing a burn across two positions compares across two frames.
Splitting the levers means no pane ever has to.

### 2026-08-21 — The Ephemeris scene shows the timeline's date, never the marker's implied one

`ephemeris-view.js`'s `updateMarker()` poses every body at the date bar's own
`dateState.jd`, never at the marker's implied arrival time. The "×" marks
where the destination will be at that implied time, drawn while the rest of
the scene stays at the timeline's date, so the two can visibly diverge.

Why it fails silently: posed at the implied time, the × and the destination
coincide and nothing looks wrong. When in doubt, check a body's rendered
position against the date bar directly.

### 2026-08-24 — The Ephemeris tab authors the hand-off

The flight starts at the origin's SOI crossing. The Departure card's vector is
the ship's velocity there (the edge speed, see 2026-09-03). The tab's clock is
the hand-off epoch at every origin but the Moon (see 2026-09-09). `core/adopt.js`
commits that state verbatim, so adopt and "Paste mission link…" round-trip
exactly.

Where on the SOI sphere the ship exits is `state.handoff`. DERIVED mode, when
authoring, places it one SOI radius along the heading. ADOPTED mode, when
pasting, holds the plan's own body-relative offset, because a real chain's
exit point can't be reconstructed. Changing origin or "re-derive exit point"
returns to derived.

At every origin but the Moon the departure estimate (`departure-estimate.js`)
is information only: read backwards from the hand-off for the Moon widget and
the release anchor, never bending the drawn arc. The marker's rendezvous is
the destination body's own position.

### 2026-08-25 — Re-target the departure requirement at the real exit point

The mission bar's Check and Update never adopt the delivered hand-off. They
keep the exit point and epoch the technology actually reaches and re-solve the
velocity that reaches the destination from there (`core/retarget.js`).

Why not let the coast absorb the gap: a waypoint is a ±100 m/s trim, and a
departure geometry error is orders of magnitude larger.

- **The solve** is a damped Newton correction on the departure velocity,
  flying the WHOLE coast through its waypoint burns, then verified by flying
  it for real through `computeLeg`. Aiming only at the first waypoint leaves a
  velocity mismatch that grows into a large miss.
- **Seeded from real trajectories**: the delivered velocity, then the plan's.
  Never from Lambert, which is singular near a 180° sweep and starts an
  out-of-plane climb the correction cannot walk back. It fails silently: the
  stalled velocity comes back looking like a requirement.
- **An unconverged solve is not an answer**: a residual over one
  `AIM_PASS_ALTITUDE` is reported as "no requirement to state".
- **The release epoch is never touched.** Re-deriving it would chase a
  hand-off that moves on every click; leaving it makes repeated clicks settle.

### 2026-08-26 — A re-target aims for a pass; the pass is the only gate

`solveDepartureTarget` aims for closest approach at `AIM_PASS_ALTITUDE`
(15,000 km above the surface) on the side the flight already passes, and
`withinTolerance` is exactly "the re-solved pass is inside `MAX_PASS_ALTITUDE`
(30,000 km)". That is the only thing Update is gated on. The size of the
ask decides nothing; it is reported so the mission report can show it
shrinking.

- The plan's own flyby distance is not kept, only its side.
- Aiming at half the bound leaves room for the residual that re-tuning
  introduces.
- Closest approach doesn't fall at the horizon, so the solve iterates: aim,
  fly for real, correct the offset by the altitude error.

Both numbers are provisional stand-ins until the arrival technology can state
what it catches (a cone of approach vectors and a maximum speed).

### 2026-08-26 — Moving the clock recomputes nothing

A `world.set({ jd })` fires a pass at the recompute engine's listeners with
the results as they stand and runs no module's `update()`. Parameter changes
recompute from the dirty stage downstream.

No `update()` may read the clock: every `world.jd` in a module belongs in
`draw()` or a card renderer. The clock decides what a stage draws, never what
it computes. Anything keyed on the plan can therefore be memoized across
scrubbing.

### 2026-08-26 — What the compliance check is, and what it is not

`adopted-plan.js`'s `computeCompliance` compares the plan's hand-off with the
delivered one on exactly three scalars:

    |v∞| within 10 m/s, aim within 1°, epoch within the plan's
    hand-off window (handoffWindowDays, ±1 d default).

v∞ is measured against the escape reference's heliocentric velocity
(`Frames.escapeReferenceFor`). **Position is never compared.** Where a
trajectory crosses the SOI depends on its periapsis, not only its asymptote,
so a chain can pass all three rows and exit hundreds of thousands of km from
the plan's exit point.

The answer is the re-target (2026-08-25), not a fourth row: no control sets
an exit point, so a position row would report a number the user can't act on.

### 2026-08-28 — One clock: the flown flight is what the coast flies

`adopted-plan.update()` emits the state the departure technology actually
delivered: position, velocity and epoch. The coast begins exactly where and
when the departure phase ended, so there is one epoch at the seam. The plan's
own departure is the REQUIREMENT the compliance rows grade and a mark on the
timelines, never a second flight.

With nothing delivered (an empty slot, or a failing departure) the plan's own
state is what the coast flies. That is the whole job of adopted-plan's
recompute `boundary` flag: a broken departure never blanks the coast.

### 2026-08-28 — The arrival date is measured, not committed

The plan commits to a destination and an approach v∞,
`adopted-plan.arrival = { body, vInf }`, and to no date. The mission arrives
at the coast's measured closest approach. adopted-plan emits no arrival event;
transfer-leg emits the measured pass.

`transfer-leg`'s `legDays` is the coast's HORIZON, a duration it owns, seeded
at adopt from the Ephemeris marker's epoch. Update never changes it, and the
re-target aims over it (`horizonJd`).

There is no Coast→Arrival compliance boundary. The coast targets the real
destination and reports the real pass live, so there is nothing to grade and
nothing to substitute. A broken coast leaves arrival-leg `blocked` by ordinary
propagation.

### 2026-08-28 — The marker card's swept-angle hold is analytic, not sampled

The Ephemeris marker's "radial from origin" hold uses
`Shared/math-utils.js`'s `sweptTrueAnomaly` / `timeAtSweptTrueAnomaly`,
closed-form in the leg's own conic, solved through the mean anomaly. It is
never computed by sampling the drawn polyline.

Why the sampled version fails silently: its usable range is however far the
leg happens to be drawn, and a clamped out-of-range hold snaps the marker to
the arc's end and leaves it stuck there.

### 2026-08-28 — The mission bar, Check and Update

**Every figure in the bar** (v∞ out, coast Δv, closest approach, v∞ in)
describes the flight flown from the delivered hand-off through the waypoints
as they stand (`core/delivered-flight.js`), over the coast's own `legDays`.
That is the same flight the drawn coast flies. The figures are memoized on the
flight spec, never on the clock.

**Graded**: v∞ out (against the plan, or a standing Check's target) and
closest approach (against `MAX_PASS_ALTITUDE`). Coast Δv and v∞ in have no
standard and are not coloured.

**Check reads.** It re-solves at the real exit point, writes nothing to the
World, and holds its answer in the view as a provisional target for the
Departure card's Needed column. It is saved with the workspace, tied to the
plan it was solved against.

**Update writes.** It re-solves from the CURRENT delivery (Check's stored
answer is stale once the technology is re-tuned) and commits the plan's
departure. The plan's reference waypoints are re-based to keep their absolute
epochs. The working waypoints are re-placed by the heliocentric angle they
sweep from the hand-off (`sweptAnglesOf` before the write, `placeAtSweptAngles`
after), because a burn belongs to a point on the arc. None is dropped (an
unreachable angle clamps to the leg's end), since the plan's reference copy is
index-matched to this list. `legDays` and the release epoch are untouched.

### 2026-08-31 — A mission carries a plan history; a link carries two sets of it

`core/revisions.js` keeps an ORIGINAL (the World `core/adopt.js` wrote) plus a
STEP per commit, each a whole serialized World. Locally every step is kept for
the mission report. A link carries only the original and the latest step,
because intermediate steps are the author's working record and a link has to
fit in a chat message. `markFinished` compacts to original + finished; its
control is not built yet.

- Links are deflate-compressed (`Shared/exchange.js`'s `encodeFragmentZ`,
  leading "z"). The sync `encodeFragment`/`decodeFragment` remain the
  calculators' `#pkt=` transport. There is no sync inflate, so start-up and
  paste are async.
- Pasting sends the original to the Ephemeris scratchpad and opens the latest
  as its own mission tab. The scratchpad has no undo, so the paste dialog
  warns to use another window to keep what is there.
- The report's originals table is stored values only (`planSummaryOf`), so it
  cannot drift from what was committed. A technology's dials are keyed by
  module and occurrence, not chain position, so adding a technology above
  another doesn't make its dials read as changed.

### 2026-09-03 — The Departure card is the edge speed; the arc flies the asymptote

The Departure card states the ship's velocity AT the SOI edge, on the escape
reference's heliocentric axes. It is not the hyperbolic excess: the primary
still holds 928.5 m/s at Earth's edge. Anything working in energy terms
converts first (`departure-estimate.js`'s `asymptoticVInf`, and `edgeVInf`
back):

- the drawn arc leaves on the asymptote;
- the departure estimate converts before timing the crossing;
- Target mode converts Lambert's answer back to an edge speed before writing
  the card or checking the budget.

Handing the arc the edge speed lets it keep energy the primary is still owed.

A card that does not escape the reference's SOI is not a departure and is not
drawn. The coast is unaffected: it propagates a full state from the SOI
position.

### 2026-09-09 — A Moon origin

A mission may depart from the Moon. Only a Moon origin gets `moon-platform` +
the geocentric `departure-leg`; every other origin, Earth included, uses the
generic `body-departure-leg` with a self-originating skyhook.

- **The hand-off is the Earth-SOI crossing.** A ship leaving the Moon is still
  deep inside Earth's SOI, so the plan's `departure.{r,v,jd}` (what Needed
  reads) is where the release's escape hyperbola crosses Earth's SOI: its
  position, edge velocity and epoch, from `core/lunar-departure.js`'s
  `soiExit`. The drawn arc starts there. Committing the Moon's own position
  instead is the tempting shortcut. It fails silently, because compliance
  never compares position.
- **The clock is the release**, alone among the origins. The crossing is about
  2 days later; the release travels as `releaseJd` and `lunarRelease`.
- **v∞ is measured against Earth** (`Frames.escapeReferenceFor`); against the
  Moon, its monthly 1 km/s swing would make the same plan grade differently by
  lunar phase.
- **The card is the ship's share; the Moon's is a bonus.** The card states
  what the ship's own release and burns deliver at Earth's SOI. The Moon's
  motion rides on top for free as a residual (sometimes more reach, on the
  wrong phase a penalty), so the flown arc is card + residual. The two cannot
  be propagated separately and added, because energy goes as speed squared.
  `lunar-departure.js` inverts the card to the ship's velocity at the Moon,
  adds the Moon's velocity there, and takes the sum out through Earth's well
  exactly.
- **Target mode solves for the card, not the total.** `solveLunarCard`
  iterates card = wanted − residual(card) with a damped Newton fallback, asked
  at the crossing (`at: "exit"`) at the release epoch. It refuses rather than
  answering when no card reaches the ask. Writing Lambert's total into the
  card bills the ship for the Moon and overshoots on every refresh.
- **Only departures heading away from Earth are supported.** Others are
  refused by name and not drawn: the state left over is the Moon's own, and
  its arc looks plausible while not being the flight. Every refusal routes
  through `flyEarthPassDeparture`, the placeholder for the Earth-pass
  departure.

### 2026-09-15 — The Coast→Arrival seam

The seam is a window around the encounter, derived live from `transfer-leg`'s
measured pass (`nearestApproach`, where `insideSoi` makes it an encounter):

    Δt = clamp( R_SOI(destination) / v∞ , 2 days , 5 days )
    window = [ closest approach − Δt , closest approach + 1 day ]

`R_SOI` is the destination's own SOI. The lower clamp keeps small bodies
workable; the upper is presentation. Never derive it from an emitted event:
an event is absent or truncated when the pass sits near the leg's end, and the
window jumps.

- **Coast** ends at the window's left edge. While Coast is active the chevron
  is clamped there; the line is drawn through closest approach and the
  overrun, dimmed past the seam.
- **Arrival** spans the whole window; both edges slide with closest approach.
- **With no encounter** the seam collapses to the coast's own end. The Arrival
  slider shows its empty state, and arrival-leg places a standard-width window
  there.
- **One coast.** transfer-leg computes one leg, and the drawn arc, emitted
  packet, events, seam, sliders and arrival leg all follow a waypoint edit in
  the same recompute. There is no commit step between Coast and Arrival.
- **arrival-leg starts from the coast's own state** at the window's left edge
  (`legFor`/`stateAtElapsed`), not from the packet, which sits later at the
  coast's leg end. The packet supplies `dvUsed` and is the fallback when no
  coast leg is reachable. There is no constructed pass: the coast's state is
  integrated under the destination's gravity, and a miss shows a miss.
- **arrival-leg takes closest approach only from its segments' own refined
  minima**, never seeded from the window-start distance, which would let a
  window edge masquerade as the pass. It flags `caAtEdge`. A test holds the
  coast's and arrival leg's passes together.
- **Arrival technology measures at the pass**: `arrival-leg.passFor` through
  `approachFromPass`. `approachAt`, at a packet's own epoch, is only the
  fallback. A leg's end is a parameter, not an event.
