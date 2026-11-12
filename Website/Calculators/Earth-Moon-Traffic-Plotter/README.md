# Earth–Moon Traffic Plotter

A to-scale 3-D view of the Earth–Moon system with its infrastructure drawn
where a clock puts it, and the path of a ship flying from one piece of it to
another. It grows out of the Moon Skyhook Trajectory Plotter and will cover
the Moon skyhook, the L1 elevator, the lunar mass driver and the Earth skyhook.

**Built so far:** the two skyhooks, a release from either one, an open path,
and a flight from either skyhook to the other — judged at its closest pass to
the destination tether, with Free and Target aiming; up to two waypoint burns
along the way. The rotating view, the L1 elevator and the mass driver come next.

## Files

- `earthMoonTraffic.html`, `.css` (`emt-` prefix), `.js` — the page: scene, date
  bar, sidebar cards, read-outs. It computes nothing the core could not.
- `core/facilities.js` — the facilities as data, and their kinematics on the clock. Pure.
- `core/flight.js` — `computeFlight(input)` and `flightStateAt(flight, t)`, flying
  through any waypoint burns. Pure.
- `core/waypoints.js` — the burns: the ±300 m/s cap, which body a burn is measured
  against, and applying it (`applyWaypointBurn`). Pure.
- `core/arrival.js` — how a flight meets a tether: the closest pass, the miss, the
  relative motion and whether the catcher can take it (`evaluateArrival`), and the
  smooth form Target solves on (`lineApproach`). Pure.
- `core/target.js` — `solveBestCatch(input)`: adjusts the release time and altitude
  until the ship meets the destination tether at the point where its relative
  motion is least; `solveCatch(input)` does the same for one given point. Pure.
- `core/windows.js` — the release windows marked on the date sliders: when the Moon
  crosses the Earth skyhook's plane, and how good each crossing is. Pure.
- `core/tests/flight.test.js`, `waypoints.test.js`, `windows.test.js` — Node tests:
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
and moves the whole scene — Moon, Sun, tethers, ship — to that time. With a
destination it runs to half an hour past the flight's closest pass to the
destination's body (`core/flight.js`'s `bodyPass`), so the ship can be watched
coming up on the tether and going past it; otherwise over the whole drawn path.

## Arrivals, Free and Target

With a destination chosen, the path is flown with a finer step
(`Shared/geo-leg.js`'s `turnStep` option) and judged where it passes closest to
the destination's tether. The **miss** is the distance between the ship and the
nearest point of the tether there; the **relative motion** is the ship's speed
relative to that point.

A ship can be caught anywhere along the tether: a **mobile catcher** is moved
along it to wherever the ship will pass, and absorbs the relative motion. It is
kept light enough to move by limiting what it absorbs to 800 m/s
(`CATCH_SPEED_LIMIT` in `core/arrival.js`). So the ship is caught when the miss
is within 1 km and the relative motion is within 800 m/s. The catch point drawn
on the tether is where the catcher has to be: the nearest point of the tether
at the closest pass.

**Free** leaves the release time and altitude to the user. **Target** solves for
the two of them so the ship passes through the tether at the point where its
relative motion is least, starting from wherever Free left the flight, and
solves again whenever the date or the hardware change. Meeting the tether at
one given radius `rCatch` fixes both the release time and the release altitude,
and gives one relative motion there,

    speed(rCatch) = | v_ship - omega * rCatch * prograde |

- `v_ship` — the ship's velocity at the meeting, relative to the tether's body
- `omega` — the tether's rotation rate, rad/s
- `rCatch` — the meeting point's distance from the body's centre
- `prograde` — unit vector the way the tether moves

Target walks `rCatch` along the tether downhill in that speed and closes in on
the lowest point. If the lowest is within 800 m/s the flight is a catch;
otherwise Target says what the lowest is and stays on, so the date can be
searched for a better one. How low it gets depends on the date: each tether
turns in its own body's equatorial plane, and the ship arrives in a plane set
by where the Moon is.

Choosing a destination puts the release point where that route starts from
(`releaseFor` in `core/facilities.js`): the Moon skyhook's release deck for a
flight to Earth, 5,200 km on the Earth skyhook for a flight to the Moon — the
place on each skyhook where traffic between the two moves at about the tether's
own speed.

**A flight from the Earth skyhook only reaches the Moon near two dates in each
lunar orbit.** The ship is let go in Earth's equatorial plane and stays close to
it, so it meets the Moon only if the Moon is crossing that plane when it gets
there. The **Moon from the release plane** figure under the view is the Moon's
distance from that plane at the closest pass; it has to come down to a few
thousand kilometres before a catch is possible (the Moon's pull bends the path
the rest of the way), and is marked while it is over 10,000 km. A flight from the Moon
skyhook has no such limit: whatever plane the ship falls toward Earth in, Earth
is in it.

## Release windows

The strip under each date slider marks the dates to release on, for the
direction the flight is going (`core/windows.js`). They come from one fact: the
Earth skyhook turns in Earth's equatorial plane, and the Moon is in that plane
only twice in each lunar orbit.

- **From the Earth skyhook**, the ship has to *arrive* while the Moon is within
  about 7,000 km of the plane, so the window is that crossing moved earlier by
  the flight time (2.4 to 3.5 days): about a day and a half long, ending two or
  three days before the crossing.
- **To the Earth skyhook**, the ship has to *leave* while the Moon is within 3°
  of the plane: about a day, centred on the crossing.

Both hold for anything at the Moon's end of the flight, since only the Earth
skyhook's plane and the Moon's position go into them. Traffic that does not use
the Earth skyhook has no such windows.

A mark is green when the relative motion expected at the catch is within the
catcher's limit and amber when it is not; the line under the sliders names the
current or next window and gives that figure. It is estimated from the
**mismatch** at the crossing,

    m = (Vt * e - V_moon) . nM

- `Vt` — the speed, out at the Moon's distance, of the path that fits the Earth
  skyhook: the far end of an ellipse from its Moon-traffic point (5,200 km)
- `e` — the direction of that speed: along Earth's equatorial plane, square to
  the Earth–Moon line
- `V_moon` — the Moon's velocity round Earth
- `nM` — the Moon skyhook's pole

the part of the ship's motion past the Moon that sticks out of the Moon
tether's plane. A ship going to the Moon brings it to the Moon tether, as
`v * |m| / vInf` (`v` the ship's speed at the tether, `vInf` its speed past the
Moon far out). A ship going to Earth leaves in the Moon tether's plane, so the
mismatch instead tilts its whole path to Earth's equator by
`i = atan(|m| * |nM . nE| / Vt)` and reaches the Earth tether as
`2 * v_tether * sin(i / 2)`. Through 2080–2085 the mismatch is 110 to 190 m/s:
290 to 460 m/s at the Moon skyhook, but 3,200 to 4,800 m/s at the Earth
skyhook, so every window to the Moon is green and every window to the Earth
skyhook is amber.

## Waypoint burns

The **Waypoint burns** card, between the departure and arrival cards, holds up
to two small course corrections. Each is placed by its **time since release**
(not, as in the Mission Planner, by angle round the orbit) and set with the
Mission Planner's burn-vector editor, capped at ±300 m/s along each of the
prograde, radial and normal axes. A new waypoint goes where the ship is on the
Flight slider. A burn is an instant change of velocity,

    v_after = v + pro * p + rad * q + nrm * n

- `v` — the ship's velocity just before the burn
- `p, q, n` — the prograde, radial and normal unit vectors of
  `OrbitalMath.burnFrame`, built on the ship's position and velocity relative to
  the Moon while it is inside the Moon's sphere of influence (~66,000 km), and
  relative to Earth elsewhere
- `pro, rad, nrm` — the burn's three components, m/s

The flight is flown in segments between the burns under the same Earth + Moon +
Sun gravity, and the segments are joined on one clock, so the drawing, the
Flight slider and the arrival read a flight with burns as they read one
without. Target keeps the burns as they are, each at its time since release,
and solves the release time and altitude around them. In the view each burn
shows the gizmo of its frame and two arrows — the impulse, and the change in
speed relative to that body — and its marker drags along the path like the ship.

Nothing in the waypoints depends on how the flight began, so the same card and
core serve the releases still to come: the L1 elevator's and the mass driver's.

## Pointing at the scene

A single click on anything — Earth, the Moon, the ship, a waypoint, a skyhook's
centre of mass, top, release point or catch point — makes the camera follow it;
the label in the view's corner names it, and its ✕ or a right-drag pan lets go.
Dragging the ship moves it along its path with the camera on it, the way a map is
dragged: the ship stays centred and the scene scrolls. A waypoint's marker drags
the same way, moving the burn along the path. Double-clicking the path
puts the ship at that point. The Flight slider is linear in time. **Hold skyhook
phase** keeps the departure tether's angle to the Earth direction fixed while the
date changes. Shift (¼) and Ctrl (1/10) slow any slider and both drags.

## Defaults

The skyhooks' default altitudes are the example design exported from the home
workbench on 2026-11-10 (Moon: foot 1 km, CoM 275 km, top 2,000 km, release
deck 949.4 km; Earth: foot 120 km, CoM 2,900 km, top 6,200 km). The Earth
skyhook's 5,200 km point is this plotter's own figure, not the workbench's. The tests pin
the resulting speeds, periods and v∞ to the workbench's own figures.

## Dependencies

`Shared/` (orbit, math-utils, kinematic-chain, geo-leg, lunar-ephemeris and the
`sim/` scene kit), `MissionPlanner/scene-frames.js` (the geocentric Earth–Moon
scene) and `MissionPlanner/modules/skyhook/skyhook.js` (the equatorial plane a
skyhook orbits in). The folder breaks if moved without them.
