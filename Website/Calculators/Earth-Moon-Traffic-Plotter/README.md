# Earth–Moon Traffic Plotter

A to-scale 3-D view of the Earth–Moon system with its infrastructure drawn
where a clock puts it, and the path of a ship flying from one piece of it to
another. It grows out of the Moon Skyhook Trajectory Plotter and will cover
the Moon skyhook, the L1 elevator, the lunar mass driver and the Earth skyhook.

**Built so far:** the two skyhooks and the L1 elevator, a release from any of
them, an open path, and a flight to a skyhook — judged at its closest pass to
the destination tether; up to two waypoint burns along the way. Target aiming,
the far-burn solve and the release windows are for flights from one skyhook to
the other; a flight from the elevator is aimed by hand. The rotating view,
arrivals at the elevator and the mass driver come next.

## Files

- `earthMoonTraffic.html`, `.css` (`emt-` prefix), `.js` — the page: scene, date
  bar, sidebar cards, read-outs. It computes nothing the core could not.
- `core/facilities.js` — the facilities as data, and their kinematics on the clock:
  the skyhooks' tethers and the L1 elevator. Pure.
- `core/flight.js` — `computeFlight(input)` and `flightStateAt(flight, t)`, flying
  through any waypoint burns. Pure.
- `core/waypoints.js` — the burns: the ±50 m/s cap, which body a burn is measured
  against, and applying it (`applyWaypointBurn`). Pure.
- `core/arrival.js` — how a flight meets a tether: the closest pass, the miss, the
  trim burn (`evaluateArrival`), and the smooth form Target solves on (`lineApproach`). Pure.
- `core/target.js` — `solveCatch(input)`: adjusts the release time and altitude until
  the ship meets the destination tether at its catch altitude. Pure.
- `core/tests/*.test.js` (flight, waypoints, windows, farburn, elevator) — Node tests:
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

## The L1 elevator

A tether from the Moon's surface, through the Earth–Moon L1 point, to a
counterweight beyond it. Its own swinging left aside, it lies along the line
from the Moon's centre to Earth's and turns with that line, so the Moon's
ephemeris is its clock. A point of it at distance `s` from the Moon's centre is at

    r(s) = r_M + s * u                u = (r_E - r_M) / D
    v(s) = v_M + s * du/dt            du/dt = (w - u (u . w)) / D

- `r_M`, `v_M` — the Moon's geocentric position and velocity (the ephemeris)
- `r_E` — Earth's position, the origin
- `D` — the Earth–Moon distance at that instant
- `u` — unit vector from the Moon toward Earth
- `w` — Earth's velocity relative to the Moon, `-v_M`
- `du/dt` — how fast `u` is turning: the part of `w` across the line, over `D`

Each point keeps its distance from the Moon and is carried round Earth at the
line's own turning rate, which is faster near perigee and slower near apogee.
The counterweight, about 162,000 km from Earth's centre, moves round Earth at
some 430 m/s; let go there, a ship falls to a perigee at or near Earth's atmosphere.

**L1 is not a point of the tether.** It is the place on the line where Earth's
pull, the Moon's pull and the turning balance, and it stays at a fixed fraction
of the Earth–Moon distance from the Moon:

    s_L1 = gamma * D                  gamma = 0.1509

- `gamma` — `OrbitalMath.lagrangeL1Fraction(GM_Earth, GM_Moon)`, the root of
  `GM_E / (1 - x)^2 - GM_M / x^2 + (GM_E + GM_M) x - GM_E = 0`
- `D` — the Earth–Moon distance

so over the month it slides along the tether between about 52,100 and 59,650 km
above the Moon. The dot marking L1 moves with it.

**Four legs** run from anchors on the ground, at 20° north and south and 20°
east and west of the Moon's prime meridian, to L1, where they join the single
tether to the counterweight. The anchors are fixed to the Moon's body, which
turns steadily about its own pole (`LunarEphemeris.moonOrientation`, Cassini's
laws) while its orbital motion speeds up and slows down, so they nod about the
line to Earth by up to 8° east–west and 7° north–south: the librations.

**Two release-or-catch points**, each an arrow marker that slides. The upper one
is on the single tether, anywhere from L1 to the counterweight. The lower one
hangs below L1 on the line to the Moon's centre, on its own line from L1. Each
is held at L1 while L1 is in its way. A flight starts from whichever is chosen
(the card's **Release from**, or by dragging a marker): from the upper point a
ship falls toward Earth, from the lower one toward the Moon. A release from the
default 45,000 km comes down to a periapsis about 1,600 km above the Moon,
within the Moon skyhook's reach.

A release from the elevator is always integrated under Earth + Moon + Sun
gravity, never drawn as a two-body ellipse: that far out Earth shapes the path
as much as the Moon does. A path that stays with the Moon is drawn as the Moon
sees it, carried along with the Moon, so an orbit of the Moon looks like one.
The elevator has no orbit of its own, so with it as the origin the **Release
time** slider spans one day.

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
that depends on the date (each tether turns in its own body's equatorial plane,
and the ship arrives in a plane set by where the Moon is) and on the catch altitude.

Choosing a destination puts the release point where that route starts from
(`releaseFor` in `core/facilities.js`): the Moon skyhook's release deck for a
flight to Earth, 5,200 km on the Earth skyhook for a flight to the Moon. Each is
also that skyhook's default catch point — the place where traffic between the
two moves at the tether's own speed.

**A flight from the Earth skyhook only reaches the Moon near two dates in each
lunar orbit.** The ship is let go in Earth's equatorial plane and stays close to
it, so it meets the Moon only if the Moon is crossing that plane when it gets
there. The **Moon from the release plane** figure under the view is the Moon's
distance from that plane at the closest pass; it has to come down to a few
thousand kilometres before a catch is possible (the Moon's pull bends the path
the rest of the way), and is marked while it is over 10,000 km. A flight from the Moon
skyhook has no such limit: whatever plane the ship falls toward Earth in, Earth
is in it.

## Waypoint burns

The **Waypoint burns** card, between the departure and arrival cards, holds up
to two small course corrections. Each is placed by its **time since release**
(not, as in the Mission Planner, by angle round the orbit) and set with the
Mission Planner's burn-vector editor, capped at ±50 m/s along each of the
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
centre of mass, top, release point or catch point, the elevator's L1 point,
counterweight or either of its two markers — makes the camera follow it;
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

The elevator's counterweight is 222,200 km above the Moon's surface, its upper
point at the counterweight and its lower point at 45,000 km. The counterweight
may be set between 70,000 and 300,000 km.

## Dependencies

`Shared/` (orbit, math-utils, kinematic-chain, geo-leg, lunar-ephemeris — the
Moon's position, and the way its body is turned — and the
`sim/` scene kit), `MissionPlanner/scene-frames.js` (the geocentric Earth–Moon
scene) and `MissionPlanner/modules/skyhook/skyhook.js` (the equatorial plane a
skyhook orbits in). The folder breaks if moved without them.
