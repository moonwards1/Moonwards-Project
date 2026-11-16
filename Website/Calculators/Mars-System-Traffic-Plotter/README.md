# Mars System Traffic Plotter

A to-scale 3-D view of the Mars system on a clock, for plotting cargo flights
between the system's transport facilities: the Phobos skyhook, a hanging
skyhook, a space elevator (Layout A or B) and a surface mass driver on the
equator. Flights stay inside the system; it exchanges nothing with the Mission
Planner.

**Built so far:** the scene and its clock — Mars turning, Phobos and Deimos on
their orbits, the Sun — the three views, the POV buttons and click-to-follow;
and the Phobos skyhook, with a release from any point of its tether flown to
its end: down to the air, round an orbit, or out of Mars's sphere of influence.
The other facilities are listed folded in the sidebar; the hanging skyhook,
with flights from one skyhook to the other, comes next. The ground model for
the mass driver (terrain and the track profile) is in the core, not yet on the
page.

## Files

- `marsSystemTraffic.html`, `.css` (`mst-` prefix), `.js` — the page: date bar,
  view, key figures, sidebar. It computes nothing the core and
  `Shared/mars-ephemeris.js` could not.
- `overlay.js` — what is drawn over the scene: the skyhook's tether and
  markers, the flight's path and the ship.
- `scene.js` — the Three.js scene: Mars with its grid and spin arrows, the
  moons and their orbits, the areostationary ring, the sphere of influence,
  the Sun, and the stretch of Mars's orbit round the Sun it is on.
  `place(jd, viewId)` puts everything where the clock has it.
- `core/clock.js` — `CLOCK_EPOCH` (2080-01-01) and `SPAN_DAYS`. Pure.
- `core/facilities.js` — the facilities as data, and their kinematics on the
  clock: the Phobos skyhook's figures, limits and tether points. Pure.
- `core/flight.js` — `computeFlight(input)` and `flightStateAt(flight, t)`: a
  release flown to its end, and what the page reads off it. Pure.
- `core/view-frames.js` — `viewBasis(kind, jd)` and `toView`: the axes the view
  is drawn in. Pure.
- `core/terrain.js` — ground heights from the terrain files: loads the
  overview and the tiles a track needs, and interpolates a height at any
  latitude and longitude in the band. Pure apart from the fetch it is given.
- `core/track-profile.js` — the ground under a mass driver's track: the
  points from breech to muzzle, their heights, the grades, the muzzle's
  height and distance from Mars's centre. Pure.
- `terrain/` — heights of the band 18° S to 18° N from the MOLA mosaic, in
  whole metres above the areoid: `overview.bin` (8 per degree, ~1.7 MB),
  `detail/lon<W>.bin` (32 per degree, 36 tiles of 10° by the whole band,
  ~0.74 MB each) and `terrain.json` describing the grid.
- `tools/make-terrain.py` — makes `terrain/` from the TerreSculptor export
  kept (untracked) at the repo root; its header gives the conversion.
- `core/tests/*.test.js` — Node tests:
  `node --test Website/Calculators/Mars-System-Traffic-Plotter/core/tests/*.test.js`

## Everything follows one clock

Mars's turning, both moons and the Sun are placed from the Julian date
(`Shared/mars-ephemeris.js`, whose header has the formulas), so anything shown
at one instant is where it would be relative to everything else. The date bar
spans three Mars years from 2080-01-01 (2,061 days, to 2085-08-23): the top
slider moves by whole days, the lower one covers three days around it, about
nine orbits of Phobos.

Phobos and Deimos are precessing ellipses from JPL's mean elements. Phobos's
orbit keeps its real eccentricity (9,234 to 9,518 km from Mars's centre) and
its 1.08° tilt to Mars's equator, which swings round once in 2.262 years.
Deimos's orbit swings round a plane 0.9° off the equator in 56.2 years, so its
tilt to the equator runs between 0.9° and 2.7°. These give the geometry and
motion of the system; they do not forecast where along its orbit a moon is on a
date in the 2080s.

## The three views

All positions are computed in Mars-centred ecliptic axes, the frame
`Shared/body-leg.js` flies a ship in. The view is drawn in axes of its own
(`core/view-frames.js`), chosen with the buttons at the view's top right:

- **Fixed stars** — Mars's north pole up, nothing turning with the view.
- **Mars surface** — turning with the ground: a space elevator and anything
  areostationary stand still.
- **Phobos** — turning with the line from Mars to Phobos, the pole of Phobos's
  orbit up: Phobos and a tether built on it stand still.

A point `r` is drawn at

    p = ( r . x,  r . y,  r . z )

- `r` — the point's position from Mars's centre, ecliptic axes
- `x, y, z` — the view's three unit axes at that instant (`viewBasis`)

A path seen from a turning view puts each of its points through the axes of
that point's own instant.

## The Phobos skyhook

A tether built on Phobos, hanging toward Mars and reaching away from it.
Phobos outweighs any tether by many orders of magnitude, so its orbit is the
tether's. The tether's own swinging left aside, it lies along the line from
Mars's centre through Phobos's, and a point of it at distance `s` from
Phobos's centre (positive away from Mars) is at

    r(s) = r_P + s * u                u = r_P / D
    v(s) = v_P + s * du/dt            du/dt = (v_P - u (u . v_P)) / D

- `r_P`, `v_P` — Phobos's position and velocity from Mars's centre
- `D` — Phobos's distance from Mars's centre at that instant
- `u` — unit vector from Mars to Phobos
- `du/dt` — how fast `u` is turning: the part of `v_P` across the line, over `D`

Each point keeps its distance from Phobos and is carried round Mars at the
line's own turning rate. Phobos's distance changes by 283 km over each orbit,
so the whole tether rises and falls by that much. **Altitudes on the card are
with Phobos at its mean distance**; the card and the key figures also give
what they are at the instant shown.

The foot may be set from 257 km (Mars's 115 km floor for a tether, plus the
142 km the tether drops at Phobos's periapsis) to 50 km below Phobos; the top
from 50 km above Phobos to 19,924 km, short of Deimos (`Shared/body-profiles.js`,
`anchorConfig`). Defaults: foot 260 km, top 10,000 km. The release point is
anywhere between, set on the card or by dragging the pink marker.

## A flight

A ship is let go with the position and velocity its release point has at the
release instant: the date bar's date plus the **Release time** slider, which
spans one orbit of Phobos. It then coasts under

    a = -GM r / |r|^3  +  a_bulge(r)  +  a_Sun(r, t)

- `GM` — Mars's gravitational parameter
- `a_bulge` — the extra pull of Mars's equatorial bulge
  (`OrbitalMath.j2Acceleration`, J2 = 1.96 × 10⁻³)
- `a_Sun` — the Sun's pull on the ship less its pull on Mars

integrated by `Shared/body-leg.js` (RK4) until it comes down to 125 km (the
entry interface), has gone once round its orbit, or leaves Mars's sphere of
influence (577,000 km) unbound. The key figures under the view give the
ship's altitude and speed at the Flight slider's instant, then the outcome: for
an entry, the time, the speed there and the angle of descent; for an orbit, its lowest and
highest points, period and tilt; for an escape, the speed kept after leaving
Mars. Speeds are against the stars; with **Speed relative to the surface**
ticked, the ship's speed and an entry's speed and angle are as the ground of
Mars sees them (`groundRelative` in `core/flight.js`), which near the ground is
the speed against the air. The bulge is in because it is what speeds Phobos round its orbit: with
it, a ship let go at Phobos stays within a few tens of km of Phobos over an
orbit.

The **Flight** slider is time since release and moves the whole scene to that
time. In a turning view the path is drawn as that view sees it.

## Pointing at the scene

Clicking Mars, a moon, the ship or one of the skyhook's markers (foot, top,
release point) makes the camera follow it; the label in the view's
corner names it, and its ✕ or a right-drag pan lets go. The POV buttons set
what is followed and how far back the camera sits. Shift (¼) and Ctrl (1/10)
slow any slider.

## Dependencies

`Shared/` (orbit, math-utils, mars-ephemeris, body-profiles, body-leg, and the
`sim/` scene kit) and `MissionPlanner/scene-frames.js` (the star field). The
folder breaks if moved without them.
