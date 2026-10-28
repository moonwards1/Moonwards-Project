# Hanging Skyhook Calculator

Models a vertical (non-rotating) gravity-gradient skyhook: geometry, speeds,
taper ratios, masses, climber energy, cargo throughput, VASIMR
station-keeping, release points for transfers to neighbouring bodies, and
entry at the parent planet for cargo released toward it. The same calculator
also serves the Phobos-anchored skyhook (below).

Built on the calculator shell: inputs, a zoomable drawing and results in three
columns. Stations, loads, cargo throughput, station-keeping and entry at
the parent planet are input modules; the fall from the foot, climber energy, release
points, forces, throughput, station-keeping, and entry are result modules. Card titles glide the drawing to their
part; the foot, centre-of-mass and top markers can be dragged.

## Files

- `Hanging-skyhooks.html` — page markup: fonts, stylesheets, one `#app` element
- `Hanging-skyhooks.css` — this page's own styling (core accent, result-group spacing)
- `Hanging-skyhooks.js` — the standalone page's script: mounts one calculator into `#app`
- `skyhookCalc.js` — the calculator: cards, modules, drawing, as
  `mountHangingSkyhook(root, opts)`. The home page's workbench mounts it
  directly, one per hanging skyhook in the design, with the body chosen there
  (`lockBody`), filling its container (`embedded`), and restoring saved
  settings (`state`), or in a moon-anchored configuration (`anchor`); the
  header comment lists the options. A new workbench skyhook (not anchored)
  opens on round figures that work at every workbench body: foot 1,000 km,
  centre of mass 2,000 km, top 3,000 km; 10 kt for each Core Facilities load
  except the anchor station, 1,000 kt. Optional Stations starts switched off, and
  when switched on every station starts unticked, at 2,500 km (main launch deck),
  1,250 km (outer docks) and 1,500 km (receiving deck), 10 kt each. The
  standalone page opens on the Moon design. Each card and
  chip names its workbench tab: geometry, material, loads, speeds,
  the fall from the foot, release points, tether properties, forces and
  stations (inputs and results) on Architecture; cargo throughput, throughput, climber energy and
  entry at the parent planet on Logistics; station-keeping on Engineering
- `skyhookModel.js` — the physics, pure (no DOM): `computeSkyhook(body, inputs)`
- `skyhookModel.test.js` — Node test pinning the default design's figures:
  `node --test Website/Calculators/Hanging-skyhooks/skyhookModel.test.js`

## Dependencies

This folder loads shared code from the site's `Website/Shared/` folder via a
relative path:

- `../../Shared/calc-shell.css`, `calc-shell.js`, `zoom-view.js` — the page layout and drawing panel
- `../../Shared/orbit.js` — planetary-system data
- `../../Shared/math-utils.js`, `constants.js` — the maths
- `../../Shared/materials.js`, `material-card.js` — the Material card and its presets
- `../../Shared/body-profiles.js` — what is special about each body: the foot floor, which
  body-specific modules apply, and the Phobos anchor configuration

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
outer docks and launch deck at the top. The Stations results card lists the top and foot stations, each optional
station and the anchor station, top down with its total tension, the net pull felt there, and where a ship released
at the tether's speed ends up: escape with a v∞, an apoapsis, or the speed at
impact (a periapsis when its lowest point clears the surface). Each tether is swept from its tip to the centre
of mass (`sweepTether`): tension grows with the taper and gains the weight of
every load it passes, and the tether's own mass follows from the tension. A
station adds its mass times the net pull where it sits (m·|ω²r − GM/r²|) as a step
in tension, and the taper carries on from there, so the tether thickens in steps
as it passes each station. A station counts on whichever tether it lies on: above
the centre of mass it hangs from the upper one, below it from the lower one.

The Tether properties card gives each tether's mass as a multiple of everything
that tether holds up (tip, spread load and stations; the anchor station is
left out). The tether the anchor station lies on is shown in two parts, each
with its own ratio: from its tip to the anchor station, holding up what lies
beyond it, and from the anchor station to the centre of mass, holding up
everything on that tether including the station. A fold-out breaks the mass
down by section: tip to first station, station to station, and last station to
the centre of mass. The Forces card's fold-out does the same for tension: each
section's tension where it arrives at its inner end, and what each station adds.

The cable is continuous through the centre of mass and nothing hangs there, so the
tension arriving from above equals the tension arriving from below. The anchor
station sits at the altitude where that holds, so the installation's true centre
of mass stays at the centre-of-mass altitude set in Tether geometry, which is
what fixes the orbit; the more the two tethers' loads differ, the farther from
that altitude it sits. It is treated like the other stations: it adds its mass
times the net pull it feels at that altitude, on the tether it lies on. It may sit
anywhere along the tether the loads demand, down to the foot's altitude or up
toward the top, as long as the tether material can carry the tension; where
several positions balance, the one nearest the centre of mass is used, and a
position where the tether would go slack does not count. If no position balances
(too light an anchor for the loads), the anchor station is drawn at the centre of
mass and the Forces card shows both tensions and says how far out of balance
they are. The Forces card reports the tension at the centre of mass (the peak),
and the anchor station's offset from the centre of mass. The drawing marks the
anchor station with a square and its altitude.

## Cargo throughput: the route

Cargo climbs along one route, foot to top unless chosen otherwise. The From and
To lists offer the foot, the anchor station (the anchoring moon, on an anchored
tether), the top and each ticked optional station, top down; a station that is
unticked falls back to the foot (From) or the top (To). The anchor station's
stop is the altitude the balance gives it, which the model resolves from
`"anchor"`. The route may run either way. Return traffic, back to where the route
starts, is 1% of the delivery rate (`DESCENT_SHARE`). The energy per kilogram is
the change in effective potential along the route,

ΔE = φ(r_to) − φ(r_from),  φ(r) = −GM/r − ½ω²r²

- **ΔE** — energy per kilogram delivered (J/kg), before drive efficiency; negative means the climb regenerates
- **r_from, r_to** — the route's ends, from the body's centre (m)
- **GM** — the body's gravitational parameter (m³/s²)
- **ω** — the tether's angular velocity (rad/s)

φ peaks at the centre of mass, so climbing toward it costs and moving away from
it regenerates. Carrying cargo outward drains the orbit's angular momentum at
ṁ(1 − 0.01)ω(r_to² − r_from²), which the top engines make up; carried inward,
the torque reverses and the engines brake instead, at the same propellant and
power cost.

## Body-specific parts

What changes from body to body comes from `Shared/body-profiles.js`, not from
checks in this calculator:

- **Entry at the parent planet** (input and result modules, `where: "parentEntry"`)
  exists only where the body's parent planet has an atmosphere — today, the Moon,
  entering at Earth. Elsewhere it has no chip and no card. Its titles name the
  parent ("Entry at Earth"), its interface altitude opens at the parent's own
  (`entryInterface`), and the peak-deceleration estimate uses the parent's scale
  height (`Shared/constants.js`); a parent with none gets no peak-g figure.
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

which the Forces card reports in place of the anchor station's offset (a few
metres for the opening design). So the centre-of-mass altitude is fixed at
Phobos's orbit (shown, not editable), there is no anchor-station mass to set, and
the drawing marks Phobos at the centre of mass. Two limits come from Phobos's
eccentric orbit, which carries the whole tether ±142 km each orbit: the foot
may not go below Mars's floor plus that swing (257 km), and the top may not reach
above Deimos's periapsis less the swing (19,924 km). Both are rejected the same way
as the foot floor. The configuration's figures come from `anchorConfig("Phobos")`.

## The drawn taper

The tether is drawn as a filled shape, symmetric about its axis, whose width at
each point is the tether's diameter, √(T/T_ref): the tension from the load sweep
(cross-section = T/σ) against the thinnest point that carries a real tension. The
thin end is drawn 3 px wide until the thickest point would pass 16 px; beyond that
the ends thin toward a 1 px minimum to make room, and once they reach it the
thickest point keeps growing without limit, so a very large taper shows as a
tether that balloons in the middle. A label gives the true diameter ratio. With no loads at all there is no tension to scale by, and the tether is
drawn as a plain thin line.
