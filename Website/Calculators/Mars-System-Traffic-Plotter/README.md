# Mars System Traffic Plotter

A to-scale 3-D view of the Mars system on a clock, for plotting cargo flights
between the system's transport facilities: the Phobos skyhook, a hanging
skyhook, a space elevator (Layout A or B) and a surface mass driver on the
equator. Flights stay inside the system; it exchanges nothing with the Mission
Planner.

**Built so far:** the scene and its clock — Mars turning, Phobos and Deimos on
their orbits, the Sun — the three views, the POV buttons and click-to-follow;
the Phobos skyhook and the hanging skyhook, with a release from any point of
either tether flown to its end: down to the air, round an orbit, or out of
Mars's sphere of influence; and the hanging skyhook's timing against the
Phobos tether, with the sidesteps that keep the two apart marked on the date
sliders. The space elevator and the mass driver are listed folded in the
sidebar; flights from one skyhook to the other come next. The ground model for
the mass driver (terrain and the track profile) is in the core, not yet on the
page.

## Files

- `marsSystemTraffic.html`, `.css` (`mst-` prefix), `.js` — the page: date bar,
  view, key figures, sidebar. It computes nothing the core and
  `Shared/mars-ephemeris.js` could not.
- `overlay.js` — what is drawn over the scene: each skyhook's tether and
  markers, the flight's path and the ship.
- `scene.js` — the Three.js scene: Mars with its grid and spin arrows, the
  moons and their orbits, the areostationary ring, the sphere of influence,
  the Sun, and the stretch of Mars's orbit round the Sun it is on.
  `place(jd, viewId)` puts everything where the clock has it.
- `core/clock.js` — `CLOCK_EPOCH` (2080-01-01) and `SPAN_DAYS`. Pure.
- `core/facilities.js` — the facilities as data, and their kinematics on the
  clock: the Phobos skyhook's figures, limits and tether points, and the
  functions that read either skyhook the same way. Pure.
- `core/hanging-skyhook.js` — the hanging skyhook: its figures, its masses,
  its resonances with Phobos, and where it is on the clock. Pure.
- `core/ballast.js` — what moving ballast along a hanging skyhook does to its
  orbit, and the sidestep built from it. Pure.
- `core/clearance.js` — the passes of the hanging tether through the plane of
  Phobos's orbit, their clearance, and the working-out of the sidesteps. Pure.
- `core/flight.js` — `computeFlight(input)` and `flightStateAt(flight, t)`: a
  release flown to its end, and what the page reads off it. Pure.
- `core/arrival.js` — a flight's closest pass to the destination skyhook's
  tether, and whether the ship is caught there. Pure.
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

- **Sun** — ecliptic north up, so the horizontal is the ecliptic, with the
  view turned to keep the Sun ahead along x. Mars's equator, and the moons'
  orbits near it, lean 26.7° to it.
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

## The hanging skyhook

A tether held upright on a circular orbit of its own. It lies along the line
from Mars's centre through its centre of mass (C.o.M.), which goes round at

    w = sqrt( GM / r_c^3 )

- `r_c` — the C.o.M.'s distance from Mars's centre
- `GM` — Mars's gravitational parameter

so a point at radius `r` moves at `w * r`. Mars's equatorial bulge turns the
orbit's plane about Mars's spin axis:

    dNode/dt = -k * cos(i)
    k = (3/2) J2 GM Req^2 * sum( m / r^3 ) / ( w * sum( m r^2 ) )

- `i` — the orbit's tilt to Mars's equator
- `J2`, `Req` — the bulge's coefficient and its reference radius
- `m`, `r` — every piece of the skyhook: stations, ballast, slices of tether

**Sun-synchronous** is the tilt at which the plane turns once a Mars year
(`cos(i) = -n_Sun / k`, about 93° for the default). The plane starts the clock
face-on to the Sun. The bulge's small effect on the rate round the orbit is
left out. The masses are the Hanging-skyhooks calculator's model
(`computeSkyhook`): a tether of constant stress in best lunar silica at a
safety factor of 3, a station at each end, an anchor station placed where it
balances the two halves, and two lots of ballast at their homes: one that may
ride anywhere on the tether (at the foot by default) and an upper one riding
above the C.o.M. (at the top by default). A set of altitudes and masses the
anchor station cannot balance is refused.

The card can leave the hanging skyhook out of the design.

### Keeping clear of the Phobos tether

Both tethers lie along lines through Mars's centre, so they can touch only
where those lines point the same way. The hanging tether passes through the
plane of Phobos's orbit twice an orbit; the **clearance** of a pass is the
least distance between the two tethers around it. Where the tethers share no
altitude nothing needs timing. Where they do, a tilt under 20° or over 160°
is refused: that near the equator the tether stays beside Phobos's plane for
too much of each orbit.

**Resonances.** With `p` orbits of the skyhook to `q` turns of Phobos, both
counted against the skyhook's own node line, the passes find the Phobos tether
in a fixed set of `D` directions as seen from the passing tether:

    D = denominator of (p - q) / (2 p) in lowest terms
    gap = 180° / D

- `gap` — how far round Mars the Phobos tether stays from every pass, with
  the passes timed midway between those directions

4:1 gives 22.5°, 3:1 gives 60°, 2:1 gives 45°. The card lists the resonant
C.o.M. altitudes on the tether; clicking one sets the C.o.M. to it exactly. A
resonance has to be held closely: 1 km off the 4:1 altitude is a drift of half
a degree a day. Any other period is allowed, and the card says how far it is
from the nearest resonance, how often a sidestep is then needed and which way
it must change the rate.

**Sidesteps.** While ballast moves along the tether nothing pushes on the
skyhook from outside, so two things hold:

    L = w * sum( m r^2 )                          angular momentum, unchanged
    w^2 = GM * sum( m / r^2 ) / sum( m r )        the rate at which it neither rises nor falls

The whole skyhook settles higher or lower until both hold with the ballast in
its new place, and the `w` that results is its new rate: ballast far from the
C.o.M. makes it lower and faster, ballast near the C.o.M. higher and slower.
Ballast at the foot, beside the C.o.M., can therefore only speed the skyhook
up; the upper ballast, brought down toward the C.o.M., slows it. A sidestep is
one lot of ballast out, held, and home again, whichever lot and direction slips
the skyhook soonest; the skyhook has then slipped
round its orbit and the orbit is as it was, so thrusters owe nothing. The work
the ballast's drive does is the difference in

    E = w^2 * sum( m r^2 ) / 2  -  GM * sum( m / r )

between the settled states, and comes back, sign reversed, on the way home.
The ballast is not taken so far that the foot sinks below 115 km. The strain
on the tether while the ballast is away from home is not checked.

**Work out the sidesteps** goes through every pass of the date span. At the
first closer than the least clearance it puts a sidestep just before, trying
every slip from 1/24 of an orbit to a whole one, ahead and behind, and keeping
the one that puts off the next close pass longest. The sidesteps appear as
amber bars under both date sliders and move the skyhook in the scene; spells
of close passes that no sidestep puts off are red. The card gives, for the
sidestep at or after the date shown, the ballast's move, the times, the
energy and peak power, and the orbit meanwhile. Changing the design clears the
working. It stops at 400 sidesteps and says how far it got.

## A flight

The **Flight** card at the top of the sidebar sets the flight: **From** one of
the skyhooks in the design, **To** the surface or the other skyhook. The
departure's card shows the release point's controls and the destination's card
the arrival's readouts.

A ship is let go by the From skyhook with the position and velocity its
release point has at the release instant: the date bar's date plus the
**Release time** slider, which spans one orbit of that skyhook. It then coasts under

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

Bound for the other skyhook, the flight is flown the same way and then judged
at its **closest pass** to that tether (`core/arrival.js`):

    x     = r . u
    miss  = | r - r_point |
    trim  = | v - v_point |

- `r`, `v` — the ship's position and velocity from Mars's centre
- `u` — unit vector out along the destination's tether at that instant
- `r_point`, `v_point` — the point of the tether nearest `x`, between its foot
  and its top, and how that point is moving

The closest pass is the least `miss` of the whole flight; where Mars lies
between the ship and the tether at that moment, the page says so. The ship is
caught if `miss` is within 1 km and `trim` is no more than 800 m/s, the most a
catcher moving along the tether absorbs. The pass is marked in green, and
**Show the closest pass** moves the Flight slider to it. Nothing yet searches
for a release that ends in a catch.

The **Flight** slider is time since release and moves the whole scene to that
time. In a turning view the path is drawn as that view sees it.

## Pointing at the scene

Clicking Mars, a moon, the ship or one of a skyhook's markers (foot, top,
release point, the hanging skyhook's centre of mass) makes the camera follow it; the label in the view's
corner names it, and its ✕ or a right-drag pan lets go. The POV buttons set
what is followed and how far back the camera sits. Shift (¼) and Ctrl (1/10)
slow any slider.

## Dependencies

`Shared/` (orbit, math-utils, mars-ephemeris, body-profiles, materials,
body-leg, and the `sim/` scene kit), `Calculators/Hanging-skyhooks/skyhookModel.js`
(the hanging skyhook's masses) and `MissionPlanner/scene-frames.js` (the star field). The
folder breaks if moved without them.
