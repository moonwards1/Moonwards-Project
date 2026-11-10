# Earth–Moon Traffic Plotter

A to-scale 3-D view of the Earth–Moon system with its infrastructure drawn
where a clock puts it, and the path of a ship flying from one piece of it to
another. It grows out of the Moon Skyhook Trajectory Plotter and will cover
the Moon skyhook, the L1 elevator, the lunar mass driver and the Earth skyhook.

**Built so far (step 1):** the two skyhooks, a release from either one, and the
open path the ship then flies. Arrivals at a facility, Free/Target aiming, the
rotating view, waypoint burns, the L1 elevator and the mass driver come next.

## Files

- `earthMoonTraffic.html`, `.css` (`emt-` prefix), `.js` — the page: scene, date
  bar, sidebar cards, read-outs. It computes nothing the core could not.
- `core/facilities.js` — the facilities as data, and their kinematics on the clock. Pure.
- `core/flight.js` — `computeFlight(input)` and `flightStateAt(flight, t)`. Pure.
- `core/tests/flight.test.js` — Node tests:
  `node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/*.test.js`

## Everything follows one clock

No facility has a phase dial. A skyhook's angle at any Julian date is

    phase(jd) = phase0 + omega * (jd - CLOCK_EPOCH) * 86400

- `phase0` — its angle at `CLOCK_EPOCH` (2080-01-01 00:00), fixed per facility
- `omega` — its rotation rate, rad/s: the circular orbital rate of its centre of mass
- `jd` — Julian date

so two facilities shown at the same instant are where they would really be
relative to each other. The date bar's two sliders (2080–2085, then one lunar
orbit) and the **Release time** slider (one orbit of the departure skyhook)
together set the release instant; the **Flight** slider is time since release,
and moves the whole scene — Moon, Sun, tethers, ship — to that time.

## Defaults

The skyhooks' default altitudes are the example design exported from the home
workbench on 2026-11-10 (Moon: foot 1 km, CoM 275 km, top 2,000 km, release
deck 949.4 km; Earth: foot 120 km, CoM 2,900 km, top 6,200 km). The tests pin
the resulting speeds, periods and v∞ to the workbench's own figures.

## Dependencies

`Shared/` (orbit, math-utils, kinematic-chain, geo-leg, lunar-ephemeris and the
`sim/` scene kit), `MissionPlanner/scene-frames.js` (the geocentric Earth–Moon
scene) and `MissionPlanner/modules/skyhook/skyhook.js` (the equatorial plane a
skyhook orbits in). The folder breaks if moved without them.
