# Earth–Moon Traffic Plotter

A to-scale 3-D view of the Earth–Moon system with its infrastructure drawn
where a clock puts it, and the path of a ship flying from one piece of it to
another. It grows out of the Moon Skyhook Trajectory Plotter and will cover
the Moon skyhook, the L1 elevator, the lunar mass driver and the Earth skyhook.

**Built so far:** the two skyhooks, a release from either one, an open path,
and the Earth skyhook as the destination of a flight from the Moon's — judged at
its closest pass to the tether, with Free and Target aiming. The rotating view,
waypoint burns, the L1 elevator and the mass driver come next.

## Files

- `earthMoonTraffic.html`, `.css` (`emt-` prefix), `.js` — the page: scene, date
  bar, sidebar cards, read-outs. It computes nothing the core could not.
- `core/facilities.js` — the facilities as data, and their kinematics on the clock. Pure.
- `core/flight.js` — `computeFlight(input)` and `flightStateAt(flight, t)`. Pure.
- `core/arrival.js` — how a flight meets a tether: the closest pass, the miss, the
  trim burn (`evaluateArrival`), and the smooth form Target solves on (`lineApproach`). Pure.
- `core/target.js` — `solveCatch(input)`: adjusts the release time and altitude until
  the ship meets the destination tether at its catch altitude. Pure.
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

## Arrivals, Free and Target

With a destination chosen, the path is flown with a finer step
(`Shared/geo-leg.js`'s `turnStep` option) and judged where it passes closest to
the destination's tether. The **miss** is the distance between the ship and the
nearest point of the tether there; the **trim burn** is the ship's speed
relative to that point. The ship is caught when the miss is within 1 km.

**Free** leaves the release time and altitude to the user. **Target** solves for
the two of them so the ship passes through the tether at the catch altitude,
starting from wherever Free left the flight, and solves again whenever the date,
the catch altitude or the hardware change. It does not reduce the trim burn:
that depends on the date (the tether turns in Earth's equatorial plane, and the
ship arrives in a plane set by where the Moon is) and on the catch altitude.

## Pointing at the scene

A single click on anything — Earth, the Moon, the ship, a skyhook's centre of
mass, top, release point or catch point — makes the camera follow it; the label
in the view's corner names it, and its ✕ or a right-drag pan lets go. Dragging
the ship moves it along its path with the camera on it, the way a map is
dragged: the ship stays centred and the scene scrolls. Double-clicking the path
puts the ship at that point. The Flight slider is linear in time. **Hold skyhook
phase** keeps the departure tether's angle to the Earth direction fixed while the
date changes. Shift (¼) and Ctrl (1/10) slow any slider and the ship drag.

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
