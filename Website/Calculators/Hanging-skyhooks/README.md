# Hanging Skyhook Calculator

Models a vertical (non-rotating) gravity-gradient skyhook: geometry, speeds,
taper ratios, masses, climber energy, cargo throughput, VASIMR
station-keeping, release points for transfers to neighbouring bodies, and
Earth reentry of cargo released toward Earth.

Built on the calculator shell: inputs, a zoomable drawing and results in three
columns. Stations, loads, cargo throughput, station-keeping and Earth
reentry are input modules; the fall from the foot, climber energy, release
points, forces, throughput, station-keeping, reentry and sending the tether to
another calculator are result modules. Card titles glide the drawing to their
part; the foot, centre-of-mass and top markers can be dragged.

## Files

- `Hanging-skyhooks.html` — page markup: fonts, stylesheets, one `#app` element
- `Hanging-skyhooks.css` — this page's own styling (core accent, About text)
- `Hanging-skyhooks.js` — the standalone page's script: mounts one calculator into `#app`
- `skyhookCalc.js` — the calculator: cards, modules, drawing, exchange, as
  `mountHangingSkyhook(root, opts)`. The home page's workbench mounts it
  directly, one per hanging skyhook in the design, with the body chosen there
  (`lockBody`), filling its container (`embedded`), and restoring saved
  settings (`state`); the header comment lists the options. Each card and
  chip names its workbench tab: geometry, material, loads, speeds,
  the fall from the foot, tether properties and forces on Architecture;
  stations, cargo throughput, throughput, climber energy, Earth reentry and
  release points on Logistics; station-keeping on Engineering
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
- `../../Shared/exchange.js`, `exchange-types.js` — sending the tether to the Skyhook Spin-Launcher

**It will break if this folder is moved without `Website/Shared/` coming with
it.**

## Loads, stations and the anchor station

The Loads card takes five masses: a tip load at the top and at the foot, a load
spread evenly along each tether (climbers, power, fuel, tracks), and the
anchor station. The Stations card gives each of the three stations a
mass as well: the facility plus its maximum load of ships, cargo and supplies,
held at that one point. Each half is swept from its tip inward
(`sweepTether`): tension grows with the taper and gains the weight of every load
it passes, and the tether's own mass follows from the tension. A station adds
its mass times the net pull where it sits (m·|ω²r − GM/r²|) as a step in
tension, and the taper carries on from there, so the tether thickens in steps
as it passes each station; a station's weight counts on whichever half it hangs
from, the one between it and the anchor station. A station beyond the
nominal centre from its half's tip (a receiving deck just below the centre,
with the anchor station pushed lower still) eases that half's tension
rather than adding to it.

The Tether properties card gives each half's tether mass as a multiple of
everything that half holds up (tip, spread load and stations), and a fold-out
breaks the mass down by section: tip to first station, station to station, and
last station to the anchor station. The Forces card's fold-out does the
same for tension: each section's tension where it arrives at its inner end, and
what each station adds.

The anchor station is the principal station and the heaviest mass on the tether.
It sits at the radius where the lower tension, the upper tension and its own net
pull cancel, so the installation's true centre of mass stays at the centre-of-mass
altitude set in Tether geometry, which is what fixes the orbit; the more the two
halves' loads differ, the farther from that altitude it sits. It may sit anywhere
along the tether the loads demand, down to the foot's altitude or up toward the
top, as long as the tether material can carry the tension; where several
positions balance, the one nearest the nominal centre is used. Past the nominal
centre the pull on the tether reverses and its tension falls again, and a
position where it would go slack does not count. If no position balances (too
light an anchor for the loads), the anchor station is drawn at the centre and the
Forces card says how far out of balance it is. The Forces card reports the
totals, the tensions on both sides of the anchor station, its position, and the
anchor mass that would hold it within 1 km of the centre-of-mass altitude. The
drawing marks the anchor station with a square and its altitude.

## The drawn taper

The tether is drawn as a filled shape, symmetric about its axis, whose width at
each point is the tether's diameter, √(T/T_ref): the tension from the load sweep
(cross-section = T/σ) against the thinnest point that carries a real tension. The
thin end is drawn 3 px wide until the thickest point would pass 16 px; beyond that
the ends thin toward a 1 px minimum to make room, and once they reach it the
thickest point keeps growing without limit, so a very large taper shows as a
tether that balloons in the middle. A label gives the true diameter ratio. With no loads at all there is no tension to scale by, and the tether is
drawn as a plain thin line.
