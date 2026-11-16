# Mars System Traffic Plotter

A to-scale 3-D view of the Mars system on a clock, for plotting cargo flights
between the system's transport facilities: the Phobos skyhook, a hanging
skyhook, a space elevator (Layout A or B) and a surface mass driver on the
equator. Flights stay inside the system; it exchanges nothing with the Mission
Planner.

**Built so far:** the scene and its clock — Mars turning, Phobos and Deimos on
their orbits, the Sun — the three views, the POV buttons and click-to-follow.
The facilities are listed folded in the sidebar and come next, starting with
the Phobos skyhook. The ground model for the mass driver (terrain and the
track profile) is in the core, not yet on the page.

## Files

- `marsSystemTraffic.html`, `.css` (`mst-` prefix), `.js` — the page: date bar,
  view, key figures, sidebar. It computes nothing the core and
  `Shared/mars-ephemeris.js` could not.
- `scene.js` — the Three.js scene: Mars with its grid and spin arrows, the
  moons and their orbits, the areostationary ring, the sphere of influence,
  the Sun, and the stretch of Mars's orbit round the Sun it is on.
  `place(jd, viewId)` puts everything where the clock has it.
- `core/clock.js` — `CLOCK_EPOCH` (2080-01-01) and `SPAN_DAYS`. Pure.
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

## Pointing at the scene

Clicking Mars or a moon makes the camera follow it; the label in the view's
corner names it, and its ✕ or a right-drag pan lets go. The POV buttons set
what is followed and how far back the camera sits. Shift (¼) and Ctrl (1/10)
slow either slider.

## Dependencies

`Shared/` (orbit, math-utils, mars-ephemeris, body-profiles through it, and the
`sim/` scene kit) and `MissionPlanner/scene-frames.js` (the star field). The
folder breaks if moved without them.
