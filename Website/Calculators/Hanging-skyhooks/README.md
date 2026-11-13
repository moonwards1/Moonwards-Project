# Hanging Skyhook Calculator

Models a vertical (non-rotating) gravity-gradient skyhook: geometry, speeds,
taper ratios, masses, climber energy, traffic, VASIMR
station-keeping, release points for transfers to neighbouring bodies, and
entry at the parent planet for cargo released toward it. The same calculator
also serves the Phobos-anchored skyhook (below).

Built on the calculator shell: inputs, a zoomable drawing and results in three
columns. Every card is always there on its tab; each optional station is a
ticked line in the Optional Stations card. Card titles glide the drawing to their
part; the foot, centre-of-mass and top markers can be dragged.

The drawing's text fades out once the body spans less than half the drawing's
width (gone at 0.4), leaving the glyphs; zooming in brings it back. In the home
workbench each card's eye button shows that card alone, and its labels then
stay at any zoom. The structure stays as context: the tether, the core-facility
markers (top, anchor station, foot) and the centre-of-mass orbit, without their
labels.

The Basics card owns three dashed paths, one for each point in its list: what an
object released there along the tether's direction of motion does. The centre of
mass gives its circular orbit; the top gives an open or elongated arc through the
top; the foot gives the ellipse with its apoapsis at the foot, ending on the
surface. Each is drawn symmetrically about the tether: the half the object flies,
and its mirror image, the path that would bring it to that point at the tether's
speed (`OrbitalMath.conicArc` draws the arcs).

The Foot ↔ Ground trips card (folded: Foot trips) owns the impact marker and the
velocity triangle drawn at it: the net speed, and its horizontal and vertical
parts, to one scale (the net speed is 120 px long), with labels. The card reads
each figure (speed, angle, distance, time) both ways, as a drop from the foot and as the launch that mirrors it.
The triangle and its labels appear once the impact is more than 220 px from the foot on screen.

## Files

- `Hanging-skyhooks.html` — page markup: fonts, stylesheets, one `#app` element
- `Hanging-skyhooks.css` — this page's own styling (core accent, result-group spacing)
- `Hanging-skyhooks.js` — the standalone page's script: mounts one calculator into `#app`
- `skyhookCalc.js` — the calculator: cards, drawing, as
  `mountHangingSkyhook(root, opts)`. The home page's workbench mounts it
  directly, one per hanging skyhook in the design, with the body chosen there
  (`lockBody`), filling its container (`embedded`), and restoring saved
  settings (`state`), or in a moon-anchored configuration (`anchor`); the
  header comment lists the options. A new workbench skyhook (not anchored)
  opens on round figures that work at every workbench body: foot 1,000 km,
  centre of mass 2,000 km, top 3,000 km; 10 kt for each Core Facilities load
  except the anchor station, 1,000 kt. Every optional station starts unticked, at 2,500 km (release deck),
  1,250 km (outer docks) and 1,500 km (receiving deck), 10 kt each. The
  standalone page opens on the Moon design. Each card
  names its workbench tab: basics (the three altitudes with their speeds), material, loads,
  the foot ↔ ground trips, release points, loads and
  stations (inputs and results) on Architecture; traffic, climber energy and
  entry at the parent planet on Logistics; station-keeping on Engineering
- `skyhookModel.js` — the physics, pure (no DOM): `computeSkyhook(body, inputs)`
- `skyhookModel.test.js` — Node test pinning the default design's figures:
  `node --test Website/Calculators/Hanging-skyhooks/skyhookModel.test.js`
- `trafficCard.js` — the Traffic card and its Energy and orbit balance result card (below), `addTrafficCard(shell, opts)`; it reads
  the design's ship classes (`opts.fleet`, `opts.instId`) and the other installations
  at the body (`opts.neighbours`), and `skyhookCalc.js` hands it the tether each recalculation
- `trafficModel.js` — the Traffic card's arithmetic, pure: flights, hauls, ship moves, balance
- `trafficModel.test.js` — its Node test:
  `node --test Website/Calculators/Hanging-skyhooks/trafficModel.test.js`

## Dependencies

This folder loads shared code from the site's `Website/Shared/` folder via a
relative path:

- `../../Shared/calc-shell.css`, `calc-shell.js`, `zoom-view.js` — the page layout and drawing panel
- `../../Shared/orbit.js` — planetary-system data
- `../../Shared/math-utils.js`, `constants.js` — the maths
- `../../Shared/materials.js`, `material-card.js` — the Tether materials card and its presets
- `../../Shared/body-profiles.js` — what is special about each body: the foot floor, which
  body-specific cards apply, and the Phobos anchor configuration

**It will break if this folder is moved without `Website/Shared/` coming with
it.**

## Core facilities, optional stations and the anchor station

The centre of mass divides the upper tether (top → centre of mass) from the lower
(foot → centre of mass). The Core Facilities card takes five masses: the top and
foot stations at the tips, a load spread evenly along each tether (tracks, power
lines, equipment), and the anchor station. The Optional Stations card lists three
stations (each with a tick), each with an altitude and a peak mass: the facility
plus its maximum load of ships, cargo and supplies, held at that one point. An
unticked station is left out: the receiving deck then sits at the foot, and the
outer docks and release deck at the top. The Stations results card lists the top and foot stations, each optional
station and the anchor station, top down with its total tension, the net pull felt there, and where a ship released
at the tether's speed ends up: escape with a v∞, an apoapsis, or the speed at
impact (a periapsis when its lowest point clears the surface). Each tether is swept from its tip to the centre
of mass (`sweepTether`): tension grows with the taper and gains the weight of
every load it passes, and the tether's own mass follows from the tension. A
station adds its mass times the net pull where it sits (m·|ω²r − GM/r²|) as a step
in tension, and the taper carries on from there, so the tether thickens in steps
as it passes each station. A station counts on whichever tether it lies on: above
the centre of mass it hangs from the upper one, below it from the lower one.

The Tether materials card gives, for the lower and the upper tether, the taper ratio
and then the tether's mass as a multiple of everything that tether holds up
(tip, spread load and stations; the anchor station is left out), each as a
small bar of figures, "load carried" under the mass. When the anchor station is off the centre of mass (C.o.M.), a
third line gives the stretch from the anchor station to the C.o.M. as a mass
multiple of everything on that tether including the station; the tether the
anchor station lies on is then split in two parts, tip to anchor station
(holding up what lies beyond it) and anchor station to C.o.M. The Loads
card gives the masses. A fold-out breaks the mass
down by section: tip to first station, station to station, and last station to
the centre of mass. The Stations card gives the tension at each station's level.

The cable is continuous through the centre of mass and nothing hangs there, so the
tension arriving from above equals the tension arriving from below. The anchor
station sits at the altitude where that holds, so the installation's true centre
of mass stays at the centre-of-mass altitude set in Basics, which is
what fixes the orbit; the more the two tethers' loads differ, the farther from
that altitude it sits. It is treated like the other stations: it adds its mass
times the net pull it feels at that altitude, on the tether it lies on. It may sit
anywhere along the tether the loads demand, down to the foot's altitude or up
toward the top, as long as the tether material can carry the tension; where
several positions balance, the one nearest the centre of mass is used, and a
position where the tether would go slack does not count. If no position balances
(too light an anchor for the loads), the anchor station is drawn at the centre of
mass and the Loads card shows both tensions and says how far out of balance
they are. The Loads card reports the total load on each tether, the anchor station's
offset from the centre of mass, and the tension at the centre of mass (the peak). The drawing marks the
anchor station with a square and its altitude.

## Traffic

The Traffic card (Logistics tab) sets out what arrives, how it divides and what
leaves, and what moving it along the tether asks of the power supply and the
orbit. It is a compact form, one line per item, figures on the right, without
notes. Masses are in kt, each route averaged over its own period, which
"average" beside the card's title says once for all. Amount fields hold five
digits and three decimals. Computed masses show whole kilotons, or three decimals
below 1 kt; the calculation itself is not rounded. Every section title (Incoming
resources, each route, Total annual resources, Outgoing products per year) has
a chevron that folds the rest of its section: Incoming and Outgoing fold their
routes, Total annual resources (not part of Incoming) its three shares. Folds are saved with the design.

- **Routes**: each starts on one line with its name, its period (radio buttons)
  and its amount. In: from the surface by shuttle (per orbit or day, with the
  launch method: Detect, the surface launchers built at this body, a launchpad);
  from the body's near market by freighter (the Moon's is Earth and Earth's the
  Moon; per day or week; no section elsewhere); from interplanetary by freighter
  (per year). Out: to the near market (freighters, and capsules where it has an
  atmosphere), to interplanetary, and to the surface by shuttle. Every route's
  amount is typed, on its own, with the one exception that where the near market
  has capsules, its line is the total and the By freighter and By capsule lines make it up between them: the one edited last stays and the other takes the rest.
  Total annual resources holds the shares you set: what leaves as products and
  what goes to the surface, with waste and use on the anchor taking the rest.
  The shares are the budget the typed routes should add up to (the near market
  and interplanetary to the products; the surface route to the surface share); a
  warning says when they do not. A new card starts with its routes at the budgets.
- **Ships** come from the design's classes: the installation's shuttle and
  capsule, and a multiple-choice dropdown of the freighter versions, the same
  choice on both directions of a route. Each route pair has one Bulk tick: that
  direction shows "flights per <period>", its flights full; the other shows
  "load per flight", its cargo shared evenly over the same flights, red past a
  ship's payload. Several freighter versions fly an equal number of flights each.
- **Docking and release points**: a multiple-choice dropdown of the places in
  use, then a line per chosen place with its amount and the haul it needs. One
  place takes what the others leave: the anchor where chosen, otherwise the one
  not edited last (in italic).

All cargo passes through the anchor station: arrivals are hauled from their
docking point to it, departures from it to their release point. Ships are hauled
empty (dry mass and heat shield) from their docking points to their release
points, spread over both in the cargo's shares. Docking and release are at the
tether's own speed, so they pass no impulse; the hauls are all the skyhook feels.
For a mass flow hauled from r₁ to r₂:

P = ṁ · [φ(r₂) − φ(r₁)],  τ = ṁ · ω · (r₂² − r₁²),  F = τ / r_top

- **P** — power the hauling delivers (W); negative is energy it can recover (gain)
- **ṁ** — mass flow (kg/s)
- **φ** — the effective potential above (J/kg)
- **τ** — torque taken from the orbit (N·m); negative returns angular momentum (gain)
- **F** — steady thrust at the top, where the reboost engines sit, that cancels τ (N)

Each haul shows its power and thrust as a loss (red) or gain (green). The
Energy and orbit balance card (Logistics results) adds them up as energy and impulse per orbit and per year, with the
efficiency that will turn each into equipment: the climbers' (a line waiting for
a Climber card) and the reboost thrusters' (from the Station-keeping card).
Release by a mass driver on the skyhook, whose push is not along the tether's
motion, is not modelled yet.

## Station-keeping: from the traffic balance

The reboost engines at the top cancel the net drag the traffic puts on the
orbit. Their thrust is the Traffic card's balance: the sum of every haul's
thrust (see Traffic). `trafficCard.js`'s `update` returns that balance and the
tonnage released from the tether, and `stationKeeping(b, env)` in `skyhookModel.js` turns
them into the Station-keeping figures:

τ = F · r_mount,  P_jet = ½ |F| vₑ,  P_elec = P_jet / η_th,  P_gen = P_elec / η_sup,  ṁ_prop = |F| / vₑ,  E_t = P_gen / ṁ_rel

- **F** — net thrust at the top (N); negative means the net traffic speeds the orbit and the engines brake, at the same power
- **r_mount** — distance of the engines from the body's centre (m)
- **τ** — torque the engines supply (N·m)
- **P_jet, P_elec, P_gen** — jet power, electrical power at the thrusters, and generated power required (W)
- **vₑ** — exhaust velocity (m/s), held to the propellant's ceiling (`exhaustSpeed`)
- **η_th, η_sup** — thruster and power-supply efficiency
- **ṁ_prop** — propellant flow (kg/s)
- **ṁ_rel** — all the tonnage released from the tether, products and surface (kg/s)
- **E_t** — generated energy per tonne released (J/kg; shown as GJ/t)

Everything is an average over each route's period, so the thrust is the mean
reboost, not the peak.

## Body-specific parts

What changes from body to body comes from `Shared/body-profiles.js`, not from
checks in this calculator:

- **Entry at the parent planet** (a result card with no inputs of its own,
  `where: "parentEntry"`) exists only where the body's parent planet has an
  atmosphere — today, the Moon, entering at Earth. Elsewhere it has no card. Its titles name the parent ("Entry at Earth"). It follows the natural
  path of a release from the release deck, with no burn: the cargo leaves the
  body's distance at apogee moving only sideways, v∞ fixes the perigee, and the
  entry angle, entry speed and peak deceleration are measured where that path
  crosses the parent's interface altitude (`entryInterface`). A perigee below
  the parent's surface is a direct hit; one above the interface is no entry. The
  peak-deceleration estimate uses the parent's scale height
  (`Shared/constants.js`); a parent with none gets no peak-g figure.
  The drawing shows the departure in the body-centred frame that does not
  rotate, at the moment of release: the hyperbola from the release deck (its
  periapsis) out to seven body radii, an arrow to the parent through the point
  facing it (longitude 0 for the Moon), the angle between that point and the
  tether, and the body's own orbit round the parent: a line through its centre,
  with an arrowhead just off the surface on each side pointing the way it
  travels. The path carries a second arrowhead near its start, just past the
  release deck's label when that shows, with the v∞ label under it. The body's pull turns the departure by
  δ = arccos(−1/e) − 90°, with e = r·v²/GM − 1 at the deck, so the release comes
  δ before the tether passes longitude 0 (≈ 46° for the default tether), and the
  cargo then leaves against the body's orbit. This assumes the tether orbits the
  same way the body orbits its parent, and leaves out the parent's pull near the
  body (patched conics).
- **The foot floor.** At a body with an atmosphere the foot may not hang below
  that body's `footFloor` (Earth 120 km, Venus 140, Mars 115, Titan 860). A lower
  value is rejected: the field is set back to the floor and a warning says why
  until the value next changes; while it is being typed it is only flagged. The
  foot marker stops at the floor, which the drawing shows as a dashed circle.

## Anchored on a moon: the Phobos skyhook

With `anchor: "Phobos"` (the home workbench's Phobos skyhook) the body is Mars and
Phobos is the anchor station. Its 1.07 × 10¹⁶ kg outweighs any tether by so much
that the tension arriving from above need not equal that from below: Phobos holds
the difference, and its orbit settles lower or higher by

Δ = F / (3ω²M)

- **Δ** — how far Phobos's orbit moves (m)
- **F** — the net pull of the tether on Phobos, toward Mars (+) or away from it (N)
- **ω** — the orbital angular velocity (rad/s); 3ω² is how fast the net outward
  pull per unit mass, ω²r − GM/r², changes with radius on a circular orbit
- **M** — Phobos's mass (kg)

which the Loads card reports in place of the anchor station's offset (a few
metres for the opening design). So the centre-of-mass altitude is fixed at
Phobos's orbit (shown, not editable), there is no anchor-station mass to set, and
the drawing marks Phobos at the centre of mass. Two limits come from Phobos's
eccentric orbit, which carries the whole tether ±142 km each orbit: the foot
may not go below Mars's floor plus that swing (257 km), and the top may not reach
above Deimos's periapsis less the swing (19,924 km). Both are rejected the same way
as the foot floor. The configuration's figures come from `anchorConfig("Phobos")`.

## The drawn taper

The tether is drawn as a filled shape, symmetric about its axis. The upper and
lower tethers are each drawn to their own scale, so each shape shows that
tether's own taper ratio. Widths are not comparable between the two: the one
holding the heavier load is not drawn thicker, because how heavy a tether looks
should come from its taper, not from the load it holds. The two meet at the
anchor station (at the centre of mass when there is none). The cable between
the anchor station and the centre of mass carries the same tension as the
tether it continues, so it is drawn as part of that tether.

Within each tether the width at a point is its diameter, √(T/T_ref): T is the
tension from the load sweep (cross-section = T/σ), and T_ref is that tether's
thinnest point carrying a real tension. A tether's thin end is drawn 3 px wide
until its thickest point would pass 16 px. Beyond that the thin end narrows
toward a 0.5 px minimum to make room (anti-aliasing leaves it faint), and once
it reaches 0.5 px the thickest point keeps growing without limit, so a very large
taper shows as a tether that balloons toward the anchor station. With no loads
at all there is no tension to scale by, and the tether is drawn as a plain thin
line.
