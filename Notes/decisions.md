# Design decisions log

Standing rules that are load-bearing for more than one file. Each entry states
the rule and, briefly, why — and where it matters, what it forbids. It is not
a narrative of how the decision was reached; `git log` holds that. 

**When a decision is replaced, its entry is rewritten or removed, not left
standing beside its replacement.** A log that holds several versions of the
same rule is worse than no log.

Entries are chronological within each section, but not dated. 

---

## Mission Planner

### Departure timeline

The Departure slider spans the departure flight itself: pinned at the release
epoch (the departure leg's `releaseJd`), ending at the estimated origin-SOI
exit initially, and then at the calculated exit once an exit can be calculated. Same for every origin. 

### Waypoint impulse controls, coast and arrival

Each axis of a waypoint burn — a coast course correction or an arrival-phase
waypoint — moves at most ±100 m/s from its baseline (`WAYPOINT_AXIS_CAP_MPS`,
transfer-leg.js), and typed entry is hard-clamped to that too. The numeric
fields step 0.1 m/s (shift-drag or a shifted nudge steps 0.01 m/s, the fine
mode).

Why: a waypoint is a trim, not an injection.

### Carrier release phase is free

The user sets a carrier platform's release phase (`releasePhaseDeg`) freely;
it is not constrained by the carrier's real-time kinematics. This holds for
the whole carrier-chain family, at every origin.

Why: efficiency comparisons stay enjoyable rather than turning into timing
busywork.

### Overlays on the shared canvas must not have an opaque ancestor

The shell owns ONE renderer whose canvas sits behind the whole scene area;
every pane draws by scissoring a rect of it. A DOM overlay with live 3D inside
must be transparent all the way up to the canvas. A background on the overlay
or any ancestor of its 3D region paints over the pixels the scissored render
just produced. Visible chrome goes on sibling bands around the 3D strip.

Such an overlay must also join `mission-view.js`'s `updateMainOcclusion` hole
list, or the main pane's caption/HUD/label layers show through it.

### Never dispose a shared THREE geometry on teardown

`ArrowHelper` builds its line and cone from module-level geometry singletons
shared by every instance; its materials are per-instance. Disposing that
geometry blanks every arrow in the app, and the failure is silent until the
*next* arrow is drawn. The same holds for any module-level geometry a widget
reuses (the ship card's line cylinder). Teardown disposes materials only.

### The Coast card's approach square: B-plane bearing, closest-approach height

The dot's bearing is read off the B-plane (`OrbitalMath.bPlane`, fed by
`nearestApproach`'s body-relative state), with ecliptic north projected in as
"up". Its distance from the body is the measured closest-approach altitude
(`pass.rmin` less the body radius), on a fixed scale: body disc 18 px, rings
from 30 px every 12 px, each 10,000 km. The body's true size is not to scale.
A pass beyond the square shows as an edge arrow on the same bearing.

Why: the B-plane is defined by the approach itself, so the bearing is stable
and never flips sign on a near-head-on pass the way a view projection does.
Altitude, not the impact parameter |B|, because |B| overstates the miss
(gravity bends the pass inward) and would put an impacting ship outside the
disc; periapsis lies on B's side of the body, so the two combine exactly.

### Closest approach is measured in time, never off the polyline

`transfer-leg`'s `nearestApproach()` is the single source for "how close does
the flight come to this body". It scans a coarse time grid and ternary-refines
every local minimum; resolution comes from the refinement. Its span is the leg
PLUS its display overrun, which is why the overrun records segs. transfer-leg
replaces the destination's own closest-approach event with this measurement,
so there is one figure, reported once.

Why not the drawn samples: outside an SOI they are about a Kepler point per
day, hundreds of thousands of km apart, so a sample-based figure jumps when a
waypoint nudge moves the pass across the SOI boundary.

### An SOI candidate is tested after refinement, never on the grid

`findFirstEncounter` accepts a still-descending dip at the window's last grid
point as a candidate without requiring that point to be inside the SOI.
Whether the dip enters the SOI is settled after ternary refinement.

Why: requiring it on the grid rejects a pass whose periapsis is inside the
window but which has climbed back out by its end, and the body's gravity is
then silently never applied to the arc.

### World save format has no migration

`deserializeWorld` refuses any save whose `version` isn't exactly
`WORLD_VERSION`, with a clear reason. Presets are hand-edited to the current
version and double as its canonical example.

Why: the only old saves are autosave and share links, test data with no value
past the session.

### Technology platforms

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

### Every skyhook orbits its primary's equator, turning with its spin

The skyhook's rotor normal is its body's spin pole (`sys.pole`), in both
roles and at every body. A body with no published pole falls back to the
ecliptic. A RELEASE's phase is pinned at the release epoch, 0° being the
body's heliocentric retrograde direction (the Moon's: Earth's) on that date,
projected into the equator.

A CATCH has the same three controls, but its phase is pinned at the
approach's **arrival mark** (`arrivalMark`, `modules/arrival-approach.js`),
and 0° points at the ship's position there, projected into the equator. At 0°
the tether lies along the ship's line at that epoch; the catch phase is an
offset from that aim. The mark is the flown arc's FIRST equatorial crossing
within `MAX_PASS_ALTITUDE`, else closest approach. It slides as the trajectory
is tuned, and is also the Arrival timeline's zero and where Δθ is taken (Δθ
is null when the mark is closest approach). A mark over the pole keeps the
retrograde 0°.

CONTACT (2026-09-24, `tetherContact`) is at the mark too: the ship touches
the tether if its crossing lies on the arm, within `CATCH_REACH` (1 km) to one
side and anywhere from the arm's base to the catch point, not only the tip.
Otherwise there is no catch solution yet. The Arrival ship card's frame is the
tether point's own, on the burn-frame convention: prograde along its motion,
normal along the spin pole, radial down the arm. That point moves at ω·r,
because the tether turns rigidly at its CoM's orbital rate.

Why: one geometry for every skyhook until a real case calls for another
plane. Retrograde rotators need no special case, because `pole` is the spin
pole. Aiming a catch costs nothing physically: the hook's phase at mission
start is a free choice, and aiming it at the mark is that choice made.

### Each waypoint readout pane tracks ONE lever, live

The **waypoint** section's pane reports the plan's own burn fired from
wherever the waypoint now sits; it moves only when the location moves. The
**impulse** section's pane reports only the edit on top of that baseline. The
plan section's descriptive line always describes the plan's own day.

Why: pro/rad/nrm components are read in the local frame of the ship's own
day, so comparing a burn across two positions compares across two frames.
Splitting the levers means no pane ever has to.

### The Ephemeris scene shows the timeline's date, never the marker's implied one

`ephemeris-view.js`'s `updateMarker()` poses every body at the date bar's own
`dateState.jd`, never at the marker's implied arrival time. The "×" marks
where the destination will be at that implied time, drawn while the rest of
the scene stays at the timeline's date, so the two can visibly diverge.

Why it fails silently: posed at the implied time, the × and the destination
coincide and nothing looks wrong. When in doubt, check a body's rendered
position against the date bar directly.

### The Ephemeris tab authors the hand-off

The flight starts at the origin's SOI crossing. The Departure card's vector is
the ship's velocity there. The tab's clock is
the hand-off epoch at every origin but the Moon. `core/adopt.js`
commits that state verbatim, so adopt and "Paste mission link…" round-trip
exactly for a plan authored here.

The exit point on the SOI sphere is always this tab's own model: the end of
the escape hyperbola traced forward from a low-orbit release (see "The
Origin view shows the release arc"), or for a Moon origin the crossing its
nominal release reaches. A pasted mission whose technology left from elsewhere is
NOT pinned to that point: the Ephemeris tab is a sketching tool, and
disagreeing with the mission tab by the difference between the two departure
models is expected (~100,000 km at Ceres in the Moon → Ceres example).

At every origin the departure estimate (`departure-phase-estimate.js`)
is information only: read backwards from the hand-off for the Moon widget and
the release anchor, never bending the drawn arc. The marker's rendezvous is
the destination body's own position.

### The Origin view shows the release arc

The flight's clock still starts at the SOI exit (t = 0): the interplanetary
trajectory is what the Ephemeris tab sketches. Ahead of it, at every origin but
the Moon, the Origin view draws the escape hyperbola from the body's low orbit
(`core/ephemeris-release-arc.js`), at t < 0 down to the release.

- The release is a point on the body's equator, moving in its spin sense,
  chosen so the hyperbola leaves along the card's heading; the exit point is
  wherever that arc reaches the SOI edge. A heading the equator cannot reach
  gets the nearest release point, and the arc is not described further.
- Periapsis is the body's low orbit (`lowOrbitAltitude` in `Shared/orbit.js`;
  the gas giants are 1,000 km up). Flight time from there to the SOI edge is the
  departure estimate, and depends on speed alone, never on the heading.
- A card that does not escape draws nothing; the readout says why.
- A Moon origin is drawn the same way in the Origin view
  (`core/ephemeris-lunar-release-leg.js`): a hyperbola about the Moon from a 100 km
  equatorial low orbit to the Moon's SOI, then the Earth-frame coast
  `core/ephemeris-lunar-departure.js` already flies, from the release epoch (the tab's
  date, which is the Moon widget's phase) to the Earth-SOI crossing. The
  release is at t = -coast, the same figure the Moon widget states in days;
  the hyperbola adds no time. The two pieces are not a patched conic: the coast
  starts at the Moon's centre and the join shows a gap of about 2,000-3,000 km
  and a crossing time that would differ by up to ~40 minutes if patched
  (`lunarSeamGap`, `lunarPatchedExit`).

### The marker slider stays put while the date is scrubbed

Scrubbing the Ephemeris date reshapes the flight (the window and the slider's
span change, sharply at a Moon origin), and the thumb used to move with it.
Now the first date change after the marker was last touched records the thumb's
place as a fraction of its track, and every refresh the date drives puts it back
there, in the heliocentric view and in a POV alike; the marker's flight time
follows. Moving the marker, switching view, or any edit that is not a date
change drops the pin, so the next scrub pins wherever the thumb is then.

### Recalculate the departure requirement once the real exit point is known

Once departure technology has been set up and the figures in the Ship card Needed row have been matched, the Check button becomes available. Once it has been clicked, the full flight of the ship is recalculated based on the now known precise location of release and the exact impulse events. This is used to calculate new Needed figures, ones that will yield an arc that passes around 15,000 km from the destination.

### A re-target aims for a pass; the pass is the only gate

`solveDepartureTarget` aims for closest approach at `AIM_PASS_ALTITUDE`
(15,000 km above the surface), and
`withinTolerance` is exactly "the re-solved pass is inside `MAX_PASS_ALTITUDE`
(30,000 km)". That is the only thing departure Update is gated on. 

### Moving the clock recomputes nothing

A `world.set({ jd })` fires a pass at the recompute engine's listeners with
the results as they stand and runs no module's `update()`. Parameter changes
recompute from the dirty stage downstream.

No `update()` may read the clock: every `world.jd` in a module belongs in
`draw()` or a card renderer. The clock decides what a stage draws, never what
it computes. Anything keyed on the plan can therefore be memoized across
scrubbing.

### One clock: the flown flight is what the coast flies

`adopted-plan.update()` emits the state the departure technology actually
delivered: position, velocity and epoch. The coast begins exactly where and
when the departure phase ended, so there is one epoch at the seam. The plan's
own departure is the REQUIREMENT the compliance rows grade and a mark on the
timelines, never a second flight.

With nothing delivered (an empty slot, or a failing departure) the plan's own
state is what the coast flies. That is the whole job of adopted-plan's
recompute `boundary` flag: a broken departure never blanks the coast.

### The marker card's swept-angle hold is analytic, not sampled

The Ephemeris marker's "radial from origin" hold uses
`Shared/math-utils.js`'s `sweptTrueAnomaly` / `timeAtSweptTrueAnomaly`,
closed-form in the leg's own conic, solved through the mean anomaly. It is
never computed by sampling the drawn polyline.

Why the sampled version fails silently: its usable range is however far the
leg happens to be drawn, and a clamped out-of-range hold snaps the marker to
the arc's end and leaves it stuck there.

**Inside an SOI the angle is measured around the BODY**, off that
encounter's own integrated trail, and the segments' degrees accumulate. A
capture loop's heliocentric sweep doubles back, so a Sun-measured domain has
several times answering to one degree and the marker jumps between them; around
the body the same loop is a monotone 360° and gets slider room in proportion to
its turning. Steps are accumulated with the running maximum, so a perturbed
trail cannot hand back a domain that dips.

### The Ephemeris marker and waypoints ride the flown leg, not a conic

Both read their state from `transfer-leg`'s `stateAtElapsed` over the computed
leg, which carries the integrated SOI encounters. Propagating the hand-off on
Sun-only Kepler instead puts them off the drawn line by hundreds of thousands
of km past any flyby — the line bends, the conic does not. Waypoint SNAPS
(apsis, node) stay conic: they have no other definition.

### Check and Update

**Check reads.** It re-solves at the real departure exit point, writes nothing to the
World, and revises the Ship card's Needed column. 

**Update writes.** It populates the columns in the mission report, and writes to the serialized world.
It is offered after a Refine within tolerance (a re-target), or on a successful catch — contact
under `MAX_CATCH_SPEED`, 250 m/s, relative to the arrival hardware — when the mission differs from
its last commit (a record of the mission as it stands, nothing re-solved).

**Arrival Δv in the report**: total is the ship's unburned speed at the catch radius (v∞ in plus
the fall), counted to rest relative to the destination — the mirror of departure tech, which counts
from rest at the origin. Fuel is the arrival waypoints; tech is the remainder, blank without a catch.

### A mission carries a plan history; a link carries two sets of it

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

### The Departure card is the edge speed; the arc flies the asymptote

The Departure card states the ship's velocity AT the SOI edge, on the escape
reference's heliocentric axes. It is not the hyperbolic excess: the primary
still holds 928.5 m/s at Earth's edge. Anything working in energy terms
converts first (`departure-phase-estimate.js`'s `asymptoticVInf`, and `edgeVInf`
back):

- the drawn arc leaves on the asymptote;
- the departure estimate converts before timing the crossing;
- Target mode converts Lambert's answer back to an edge speed before writing
  the card or checking the budget.

Handing the arc the edge speed lets it keep energy the primary is still owed.

A card that does not escape the reference's SOI is not a departure and is not
drawn. The coast is unaffected: it propagates a full state from the SOI
position.

### A Moon origin

A mission may depart from the Moon. Only a Moon origin gets `moon-platform` +
the geocentric `departure-leg`; every other origin, Earth included, uses the
generic `body-departure-leg` with a self-originating skyhook.

- **The hand-off is the Earth-SOI crossing.** A ship leaving the Moon is still
  deep inside Earth's SOI, so the plan's `departure.{r,v,jd}` (what Needed
  reads) is where the release's escape hyperbola crosses Earth's SOI: its
  position, edge velocity and epoch, from `core/ephemeris-lunar-departure.js`'s
  `soiExit`. The drawn arc starts there. Committing the Moon's own position
  instead is the tempting shortcut. It fails silently, because compliance
  never compares position.
- **The clock is the release**, alone among the origins. The crossing is about
  2 days later; the release travels as `releaseJd` and `lunarRelease`.
- **v∞ is measured against Earth** (`Frames.escapeReferenceFor`); against the
  Moon, its monthly 1 km/s swing would make the same plan grade differently by
  lunar phase.
- **The card is the ship's share; the Moon's is a bonus.** The card states
  what the release delivers at Earth's SOI; the Ephemeris tab assumes no
  burns after it. The Moon's
  motion rides on top for free as a residual (sometimes more reach, on the
  wrong phase a penalty), so the flown arc is card + residual. The two cannot
  be propagated separately and added, because energy goes as speed squared.
  `ephemeris-lunar-departure.js` inverts the card to the ship's velocity at the Moon,
  adds the Moon's velocity there, and takes the sum out through Earth's well
  exactly.
- **Target mode solves for the card, not the total.** `solveLunarCard`
  iterates card = wanted − residual(card) with a damped Newton fallback, asked
  at the crossing (`at: "exit"`) at the release epoch. It refuses rather than
  answering when no card reaches the ask. Writing Lambert's total into the
  card bills the ship for the Moon and overshoots on every refresh.
- **The card is a length along the flown heading, all month.** Its length is
  the technology's share, which fixes the release speed; its direction is the
  heading the ship leaves Earth on. `flyEarthPassDeparture` traces that
  heading's coasting route back to the Moon (`passiveReleaseFor`, the short
  way round Earth), so the Moon's contribution is a gain or loss of speed
  along the heading and never a turn of it. Why: reading the card as the
  share's own vector made the flown heading card + residual, which swings up
  to ~25° with the lunar phase and jumped where that reading gave out. Cost:
  a weak card (below ~2 km/s) on an unfavourable phase has no route and is
  refused ("no-pass-route") rather than flown on another reading.
  The release aim is free: the release direction swings with the phase (up to
  ~85° over the month) to hold the heading, because the Ephemeris tab finds the
  trajectory and the mission tab works out what the technology must be to fly
  it. A skyhook's pointing at any epoch depends on where it was placed, so
  demanding a fixed aim here would be precision for its own sake.

### The Coast→Arrival seam

The seam is a window around the encounter, derived live from `transfer-leg`'s
measured pass (`nearestApproach`, where `insideSoi` makes it an encounter):

    Δt = clamp( R_SOI(destination) / v∞ , 2 days , 5 days )
    window = [ closest approach − Δt , closest approach + 1 day ]

`R_SOI` is the destination's own SOI. The lower clamp keeps small bodies
workable; the upper is presentation. Never derive it from an emitted event:
an event is absent or truncated when the pass sits near the leg's end, and the
window jumps.

- **Coast** ends at the window's incoming edge, but its slider tacks the whole
  arrival window on past that edge as one dim-blue segment (the polyline's
  own dimmed tone past the seam, `ui/phase-slider.js`'s `coastSliderState`),
  so the heliocentric approach and arrival scrub as one continuous track.
  While Coast is active the chevron follows the clock into that tail but
  clamps at the window's own right edge — the line is drawn through closest
  approach and the overrun regardless, dimmed past the seam.
- **Arrival** spans the whole window; both edges slide with closest approach.
  Its zero, and the epoch it opens on, is the arrival mark (see the skyhook
  entry), which is not clamped into the window.
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

---

## Shared libraries

### A body's `pole` is its spin pole

`sys.pole` in `Shared/orbit.js` is the pole the body turns counter-clockwise
about (right-hand rule), not the IAU "north" pole. For Venus, Uranus and Pluto
it lies south of the ecliptic. `tiltBody` points the equator ring's +Z along it
and draws the spin arrowheads counter-clockwise about +Z.

Why: the equator ring alone looks the same for either pole, but the arrows
don't. With the IAU convention a retrograde rotator's arrows would be backwards.

### Body-specific parts declare a condition; bodies don't list cards

What is special about a body lives in `Shared/body-profiles.js`: its figures
(`footFloor`, `entryInterface`) and named conditions. A card that belongs
only at some bodies carries `where: "<condition>"`, and `CalcShell.setConditions`
leaves out whatever fails. A condition tests the body's
physics (orbit.js data plus its profile), never a hand-kept list of body names.
Why: the same physics recurs at bodies nobody thought to list (an atmosphere at
the foot is Earth's, Venus's, Mars's and Titan's problem), and a condition catches
every body that meets it. `specialsAt(body)` gives the per-body view.

### Sun-orbiting bodies carry mean elements fitted to Horizons, 2030–2130

Every body with `orbit.system` "Sun" in `Shared/orbit.js` holds mean Keplerian
elements least-squares fitted to JPL Horizons positions over 2030-01-01 to
2130-01-01, referred to epoch JD 2480764.5 (2080-01-01), through the same
`OrbitalMath.bodyStateAtJD` the app flies. They are not osculating elements and
are only valid inside that window — the planner's own date range. Mean motion
comes from `semiMajor` and the Sun's GM, so there is no separate `period` field
to disagree with it. Earth's orbit is the Earth–Moon barycentre's, held in the
ecliptic. `Shared/tools/fit-mean-elements.mjs` regenerates the values;
`Shared/tests/orbit-ephemeris.test.js` pins the result against Horizons
checkpoints.

Why: one fixed osculating ellipse drifts from the real orbit as perturbations
act, by up to 20% of Saturn's orbit radius by 2130; a window fit turns that
into a bounded wobble (under 0.4% of orbit radius for every planet; 1–3% for
most asteroids; worst 13.2%, for Hygiea, whose orbit Jupiter disturbs more than
any single ellipse can follow).

Consequence: missions authored against other positions (the example missions)
arrive only as well as their authoring ephemeris
matched this one — re-target them with Update after the elements change.

### A ship that meets an atmosphere is a capsule

`Shared/ships.js`: any ship class with a heat shield is taken to be
capsule-shaped, the shield its whole face and the engines opposite, and
carries the shield's diameter (`shieldD`, m). Its ballistic coefficient is

    β = m / (Cd · A),  A = π D² / 4

with `Cd = CAPSULE_CD` (1.5, the Earth aerobrake model's figure) and `m` the
entry mass, shield included, with the tanks as full as the caller says
(`entryMass(c, fill)`). The workbench card quotes β with full tanks, the
worst case; the Earth–Moon Traffic Plotter takes an arrival's tanks as the
user sets them, 20% full by default (`TANK_FILL`), since tanks are sized for
the worst route and an arrival keeps only a reserve. Every aerobrake figure
reads β from here.

Why: the shape is what a ship flown through the air dozens of times can
plausibly be.

---

## Calculators

### Earth–Moon Traffic: an offworld arrival's aerobrake is one instant shed at periapsis

`core/aerobrake.js`. The pass is an instant loss of speed along the ship's
motion at periapsis, and its height alone decides the exit: the speed shed
goes with the air's density, `shed_0 · exp(-(h_p - h_0) / H)`, H = 7.16 km,
anchored on the Earth aerobrake model's reference pass for the ship's β
(`Shared/ships.js`) leaving for REF_APO, its entry speed taken at its own
height. No exit apoapsis is set anywhere: the entry trim sets the pass and the
pass sets the loop. The corridor is the band of pass heights that leave on a
loop out to 450,000–1,450,000 km, a few hundred metres wide, so the trim is
edited to 0.1 mm/s.

Why: the exit leaves only just below escape, so the loop is extremely
sensitive to the pass height, and it is the course the trim sets that the
ship flies, not a target typed in.

An arrival is accepted, and Aim solves the entry trim, on the pass as flown
(Earth + Moon + Sun), never the two-body conic: from the SOI edge the Sun and
the Moon move the pass by hundreds to thousands of kilometres.

### New calculators use the three-column calculator shell

A calculator page is the shell in `Shared/calc-shell.*` + `Shared/zoom-view.js`:
inputs | zoomable drawing | results. Every card is always in its column and
collapsible to a short title and summary; there are no on/off modules. A part
of the design that may or may not exist is a ticked line inside its card. `Calculators/_template/` is the reference. The shell is
deliberately light and earthy (sand, paper, basalt drawing panel) so a
calculator is told apart at a glance from the dark Mission Planner and plotters.
Calculators on the older `calc-frame.css` keep working and move over one at a
time.

Why: folding keeps a long column short without hiding that a part exists,
and column space goes to cards rather than switches; the drawing stays in view
while editing.

### Tether calculators share one Material card and one preset list

Every tether calculator on the shell, and the workbench's skeleton cards, take
their material from `Shared/material-card.js` over the presets in
`Shared/materials.js`. A calculator picks only its default preset and safety
factor. Why: one list of materials, so a material reads the same wherever a
design uses it.

### The workbench's elevators are sized by one tether model, against a 1.5× pull multiple

The standard, L1 and L2 elevators on the workbench are the same tether in three
force fields (`Shared/radial-tether.js`), and the off-equator Mars elevator is
its two-dimensional counterpart (`Shared/meridian-tether.js`), all sized for their structure: cable,
track and up to three stations, not cargo. The card shows the multiple — the
surface pull of everything holding the structure up (counterweight, stations
beyond the balance point) ÷ everything hanging on it (track, stations inside
it), each weighted by exp[(ρ/σ_eff)(Φ(R) − Φ(r))]. Below 1.5× the counterweight
is raised to reach it; below 3× a warning stays. Why: the multiple counts what
outward stations contribute, which a "multiple of the minimum counterweight"
cannot; tension is least at the anchor or the counterweight, so 1× is exactly
taut, and the margin stands in for cargo until traffic is modelled on the
Logistics and Engineering tabs.

### Mars's elevator is anchored off the equator; it clears Phobos and stops short of or dodges Deimos

An equatorial elevator at Mars stays blocked: Phobos and Deimos both cross its line.
The one form offered is a single tether from an anchor well off the equator (Olympus
Mons, 18.65°N, by default), bowing toward the plane and staying a few hundred km off
it, clear of Phobos's 1.08° tilt (191 km at worst). Deimos, tilted more, is handled by
stopping the counterweight inside its orbit or by dodging: the tether's slowest
north–south swing (≈24.4 h), built up over about a week by timing how much cargo sits
on a slanted stretch low on the tether. Why: one anchor and no second leg; the swing
needs no propellant, and north–south motion is free of Coriolis coupling.

The tether bends in its meridian plane, so it is solved in two dimensions
(`Shared/meridian-tether.js`), with J2: shot from the counterweight, whose net pull
the tether lies along, to land at the anchor's latitude. The card carries the track
and stations of the other elevators, so the multiple floor of 1.5× applies; and the
counterweight is also raised until the tether leaves the anchor at least 10° above
horizontal. Why: a lighter counterweight leaves less tension at the bottom, where the
track's weight bends the tether down toward the ground, and below some mass it no
longer lands at the anchor at all.

### A hanging skyhook's tethers are split at its centre of mass

The upper tether runs from the top to the centre of mass and the lower from the foot
to it; each tether's spread load is spread over that length. The anchor station is a
mass on whichever tether it lies on, adding its mass times its net pull like any other
station, and its altitude is the one at which the tension arriving at the centre of mass
from above equals that from below. Peak tension is read along that one continuous cable.
Why: the cable is continuous through the centre of mass and nothing hangs there, so it is
the physical dividing point and the one reference for every measurement.

### A hanging tether's foot has a floor at each atmosphere

`footFloor` in `Shared/body-profiles.js`: Earth 120 km (about 2 × 10⁻⁸ kg/m³),
Venus 140, Mars 115, Titan 860. A foot set lower is rejected and set back to the
floor, with a warning. Why: near 10⁻⁸ kg/m³ drag costs little reboost propellant
and the foot station stays cool; lower, both grow by about e per scale height.
Earth and Mars sit nearer the line than the margin would put them because an Earth
skyhook can afford the reboost and Mars has Phobos as a momentum store.

### Skyhook traffic reaches the orbit only through hauls along the tether

On a hanging skyhook without a mass driver, ships dock and are released at the
tether's own speed: no impulse. The Traffic card's energy and orbit balance is
therefore the sum of hauls, cargo between its docking or release point and the
anchor station, and empty ships from docking to release point, each costing
ṁ·Δφ in energy and ṁ·ω·Δ(r²) in angular momentum. A mass driver on the skyhook
releases with a radial or normal push and will add its own terms. Why: a
matched-speed docking moves no momentum; only moving mass along the tether does.

Station-keeping reads that balance: the reboost thrust is the balance's net thrust, and its
energy and propellant per tonne are per tonne released from the tether. The tether has
no separate climber-throughput model.

### A moon-anchored skyhook: the moon is the anchor station

A skyhook anchored on a moon (`ANCHORS`, today Phobos) is the hanging-skyhook model
with the moon as the anchor: the centre of mass is the moon's orbit, the two halves
need not balance, and the moon's orbit shifts by Δ = F / (3ω²M) under the net pull.
The tether rides the moon's eccentric orbit, so the foot floor is the primary's floor
plus that swing, and the top stays below the next moon out at its periapsis, less
the swing. Why: the moon outweighs any tether by many orders of magnitude (Phobos:
a few metres of shift for the opening design), so an anchor-station balance would
only add a meaningless input.

### Lagrange elevators ride the Earth–Moon line, and their Lagrange point slides along it

An elevator through Earth–Moon L1 or L2 lies along the instantaneous line through the
Moon's centre and Earth's (toward Earth for L1, away for L2), each point at a fixed
distance from the Moon and moving with the line's own turning rate
(`Shared/lagrange-elevator.js`; in a departure chain, `kinematic-chain.js`'s line
element). The Lagrange point is γ·D from the Moon (γ = 0.1509 for L1, 0.1679 for L2,
`OrbitalMath.lagrangeL1Fraction`/`lagrangeL2Fraction`), so it moves along the tether as
the distance D changes; the legs' anchors are fixed to the Moon's body and follow its
librations. The tether's own pendulum swing is left out.
Why: that is the motion the ephemeris alone gives, predictable years ahead, and it
is what sets a released ship's path; the swing is a smaller correction riding on it.

In the traffic plotter, each of the L1 elevator's two release points is held on its
own side of L1. A release from the
elevator is always integrated, and a path from a Moon facility that stays with the
Moon is drawn Moon-relative. Why: near L1 a two-body ellipse about the Moon is wrong,
and a lunar orbit drawn geocentric is an unreadable wavy line.

### A Lagrange elevator is the only carrier in its chain

In the Mission Planner a Lagrange elevator rides the Moon's base platform and
nothing else, and nothing rides it (`alone` on its platform spec): `makeCarrier`
refuses either stacking with a diagnostic, and the departure dropdown offers no
second technology beside it. Why: chain elements compose by plain vector sum, so
a skyhook rotor after the elevator's line element would describe a tether turning
about a point of the elevator at a rate set by the Moon's gravity, which is no
hardware; a launcher built to ride an elevator would replace this rule with a
`ridesOn` check.

### The Mars system is computed in ecliptic axes and drawn with Mars's pole up

`Shared/mars-ephemeris.js` and every flight in the Mars System Traffic Plotter work in
Mars-centred ecliptic axes, the frame `Shared/body-leg.js` integrates in. Only the
drawing changes axes (`core/view-frames.js`): fixed to the stars, turning with Mars, or
turning with Phobos, each a set of unit axes at a date. Why: one frame for the physics
keeps the shared integrators usable as they are, and nearly everything at Mars lies
near its equator, 26.7° off the ecliptic, so an ecliptic-up drawing is hard to read.

Phobos and Deimos are precessing ellipses from JPL mean elements, with Phobos's
eccentricity and 1.08° tilt kept. Why: the tilt and the in-and-out motion set the
clearances between tethers; the moons' absolute places along their orbits in the 2080s
are not predictable to that precision and nothing depends on them.

### Flights inside the Mars system feel Mars's equatorial bulge

The Mars System Traffic Plotter flies a ship under Mars + its J2 bulge + the Sun
(`core/flight.js`, through `Shared/body-leg.js`'s `extraAccel`). Why: the moons' motion
comes from observed mean elements, which include the bulge's effect (it speeds Phobos
round by 0.04%); without it a ship let go beside Phobos drifts away from it and a
tilted orbit's plane does not turn, so nothing flown would line up with the facilities
it is meant to meet. A flight ends at the 125 km entry interface, after one orbit, or
at the sphere of influence.

The Phobos skyhook's altitudes are stated with Phobos at its mean distance; the tether
rides Phobos's eccentric orbit, 142 km up and down, along the line from Mars's centre
through Phobos's.

### The hanging skyhook at Mars keeps clear of the Phobos tether by timing, re-timed with ballast

Where the two tethers share altitudes, the hanging skyhook's passes through the plane
of Phobos's orbit are timed to miss the Phobos tether (`core/clearance.js`). A period in
resonance with Phobos holds that timing by itself: with p orbits to q turns of Phobos
against the skyhook's node line, the passes find the Phobos tether in D fixed
directions, D the denominator of (p − q)/(2p) in lowest terms, and the gap is 180°/D
(4:1 → 22.5°, 3:1 → 60°). Any other period is allowed and is re-timed by **sidesteps**:
ballast out along the tether, held, and home again (`core/ballast.js`). Angular
momentum is unchanged while ballast moves, so the skyhook only turns faster or slower
while the ballast is away and the orbit returns with it: a sidestep owes thrusters
nothing. Why not thrusters: the timing has to be changed within a day or two, and
ballast does that without propellant.

A tilt under 20° or over 160° is refused while the tethers share altitudes: that near
the equator the tether stays beside Phobos's plane for too much of each orbit for timing
to separate them. With no shared altitude any tilt is allowed.

### In the Mars system, the space elevator limits the Phobos tether, and dodges Deimos on the clock

With a space elevator in the Mars System Traffic Plotter's design, the Phobos
skyhook's top is held short of where its tether, which sweeps ρ·sin(1.08°) from the
equatorial plane at distance ρ, would come within 50 km of the elevator's tether
(swung toward the plane by the dodge swing, Phobos at apoapsis): `KEEP_CLEAR` in
`core/elevator.js`, applied by `moonSkyhookFigures` in `core/facilities.js`. An
elevator that passes Phobos itself by less is refused. Why a hard limit and not
timing: the elevator's tether stands still over the ground and the Phobos tether
sweeps past it every 11 hours, at every height the two share.

Deimos's crossings of the tether's meridian come from the ephemeris, not from the
workbench card's chance-per-pass estimate; one with a miss under 50 km is dodged. The
trigger band (100 km), the swing (60 km at Deimos's distance) and the climber traffic
that pumps it (400–800 km stretch, 6 swings) are fixed in `core/elevator.js`, not
inputs. The swing is carried as a phasor that timed traffic moves by one full swing
in 6 cycles at most, so build-up, crossings close together and dying-down all come
from one rule.

The elevator's sizing is `MarsElevator.sizeStructure` (`Calculators/Mars-Elevator/`),
the workbench card's rule without its stations; the pull multiples it is held to
(`MULT_FLOOR`, `MULT_ADVISED`) live in `Shared/radial-tether.js`.

### The hanging skyhook at Mars is timed against the space elevator's tether too

The elevator's tether passes through the plane of the hanging skyhook's orbit twice a
Mars day (counted against the skyhook's node line), and each is a pass like one of the
Phobos tether's: `core/clearance.js` walks both, and a sidestep is chosen for how long
it puts off the next close pass of either. A period with a whole number of orbits to
one Mars day or two holds the timing against the elevator as a Phobos resonance does
against Phobos; no period does both, so a hanging tether sharing heights with both
needs sidesteps for one of them. A tilt within 10° above the elevator tether's
latitudes at the shared heights is refused; one at least 3° below them never meets it
and needs no timing. Every facility has an "In the design" tick, the Phobos skyhook
included, so any two can be modelled without the third.
