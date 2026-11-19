# Mars System Traffic Plotter

A to-scale 3-D view of the Mars system on a clock, for plotting cargo flights
between the system's transport facilities: the Phobos skyhook, a hanging
skyhook, a space elevator anchored off the equator and a surface mass driver
on the equator. Flights stay inside the system; it exchanges nothing with the Mission
Planner.

**Built so far:** the scene and its clock — Mars turning, Phobos and Deimos on
their orbits, the Sun — the three views, the POV buttons and click-to-follow;
the Phobos skyhook and the hanging skyhook, with a release from any point of
either tether flown to its end: down to the air, round an orbit, or out of
Mars's sphere of influence; the space elevator, with the limit it puts on the
Phobos skyhook's top and its dodges of Deimos marked on the date sliders; and
the hanging skyhook's timing against the Phobos tether and the elevator's,
with the sidesteps that keep them apart marked on the date sliders. Each of
the three can be left out of the design. The mass driver is listed folded in
the sidebar; flights to and from the elevator come next. The ground model for
the mass driver (terrain and the track profile) is in the core, not yet on the
page.

## The default design

The page opens on a design for heavy traffic, all three facilities in it:

- **Space elevator:** anchored on the summit of Olympus Mons, early carbon
  nanotube at a safety factor of 2.4, a 700 kt counterweight 55,000 km from
  Mars's centre, carrying 150 kg/s (about 4.7 Mt a year). It carries up to
  about 626 kg/s; at 150 it leans 7.8° west at the anchor and leaves it 34.5°
  above level.
- **Phobos skyhook:** foot 260 km, top 6,800 km (the elevator allows up to
  9,298 km).
- **Hanging skyhook:** sun-synchronous, foot 220 km, top 5,000 km, 200 kt of
  upper ballast at 4,000 km, the centre of mass set at the page's start to
  the 3:1 resonance with Phobos (1,118 km). It is then 9.66 orbits a Mars
  day, out of step with the elevator.

The worked figures elsewhere in this README are for fixed **study designs**,
the ones the Node tests pin (`core/tests/studies.js`): the Phobos skyhook's
top at 10,000 km; the hanging skyhook on 4:1 with Phobos, top 2,400 km, 30 kt
of upper ballast at the top; the elevator in early nanotube at 2.5, its
counterweight at 51,000 km of the mass that holds it up three times over
(151 kt), carrying 1 kg/s.

## Files

- `marsSystemTraffic.html`, `.css` (`mst-` prefix), `.js` — the page: date bar,
  view, key figures, sidebar. It computes nothing the core and
  `Shared/mars-ephemeris.js` could not.
- `overlay.js` — what is drawn over the scene: each skyhook's tether and
  markers, the space elevator's tether, the flight's path and the ship.
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
- `core/clearance.js` — the passes of the hanging tether by the Phobos tether
  and by the space elevator's, their clearance, and the working-out of the
  sidesteps. Pure.
- `core/elevator.js` — the space elevator: its figures, how far a Phobos
  tether may reach beside it, Deimos's crossings and the dodges, and where its
  tether is on the clock. Pure.
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
- `core/tests/studies.js` — the fixed study designs the tests pin their
  figures to, apart from the page's defaults.
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

A tether built on Phobos, hanging toward Mars and reaching away from it. The
card can leave it out of the design.
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
`anchorConfig`), or to the space elevator's limit where that is lower (see
"Keeping clear of Phobos"). Defaults: foot 260 km, top 6,800 km. The release point is
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

### Keeping clear of the space elevator

The elevator's tether climbs through every height the hanging tether has,
standing at latitudes that fall as it rises (3.9° to 13.2° N for the
defaults). A tilt that keeps the hanging tether at least 3° nearer the
equator than the lowest of those never meets it. Otherwise the tilt must be
at least 10° more than the highest (and as far short of 180°), or it is
refused: nearer, the tether stays beside the elevator's for too much of each
orbit.

Mars carries the elevator's tether through the plane of the hanging
skyhook's orbit twice a **Mars day**, counted against the skyhook's node line
(a solar day, for a sun-synchronous orbit). Each is a pass. The hanging
tether sweeps round its orbit while the elevator's stretch crosses the plane,
so starting an angle `D` apart they come no nearer than about

    clearance ~ D * r * v_p / sqrt( v_h^2 + v_p^2 )

- `D` — the angle round the orbit between the two at the crossing, less half
  the angle the elevator's stretch spans
- `r` — the distance from Mars's centre of the middle of that stretch
- `v_h` — the hanging tether's speed there
- `v_p` — the speed at which the elevator's stretch crosses the plane

A pass within one and a half times the limit by that estimate is measured
exactly: the least distance, over the minutes around their nearest, between
the hanging tether and the elevator's stretch taken as 12 straight pieces
(`elevatorDistance`), with the elevator's tether where its Deimos swing has
it. For the study design at the default 200 km clearance about one pass in
four is too near when the timing is left to chance.

**In step with Mars's day.** With a whole number of orbits to one Mars day
or two, the skyhook is at the same places round its orbit every time the
elevator's tether comes through, so a start that is clear stays clear. The
card lists the centres of mass that do it (for the study design, 13 a day at
309 km, 25 in 2 days at 407 km, 12 a day at 511 km, and so on); clicking one sets it exactly. Any
other period is allowed, and the card says how far the skyhook's place at a
pass moves from one day to the next.

No period is in step with both Phobos and Mars's day: 4:1 with Phobos is
12.88 orbits a Mars day. With the hanging tether sharing heights with both
others, one of the two needs sidesteps every few days. For the study design
at the default 200 km clearance the ballast cannot keep up and some passes are left too near; at 50
km it can, with a sidestep about every 12 days. Raising the Phobos skyhook's
foot above the hanging tether's top, or leaving one of the three out of the
design, lets one resonance hold the timing with no sidesteps.

### Working out the sidesteps

**Work out the sidesteps** goes through every pass of the date span, of
either tether. At the
first closer than the least clearance it puts a sidestep just before, trying
every slip from 1/24 of an orbit to a whole one, ahead and behind, and keeping
the one that puts off the next close pass longest. The sidesteps appear as
amber bars under both date sliders and move the skyhook in the scene; spells
of close passes that no sidestep puts off are red. The card gives, for the
sidestep at or after the date shown, which tether it avoids, the ballast's
move, the times, the energy and peak power, and the orbit meanwhile. Changing
the design clears the working. It stops at 400 sidesteps, at 60 spells of
passes it cannot avoid, or after 25 seconds, and says how far it got.

## The space elevator

One tether from an anchor off Mars's equator (the summit of Olympus Mons by
default, 18.65° N, 226.2° E), bowing toward the equatorial plane and running
out, a few hundred km off it, to a counterweight beyond areostationary orbit.
The tether and its sizing are `Shared/meridian-tether.js` and
`Calculators/Mars-Elevator/marsElevatorModel.js` (`sizeStructure`), derived in
that folder's README; the figures match the workbench's Off-equator Mars
Elevator cards for the same inputs, with the anchor on the areoid (the
ground's own height is left out) and no stations.

The card sets the anchor's latitude (within 20° of the equator) and longitude,
the cable (early carbon nanotube at a safety factor of 1.5 to 3, or mature at
1.5 to 4), the counterweight's distance from Mars's centre and its mass, and
the net flow of cargo up the tether.
An empty mass takes the counterweight that holds the cable and its track up
three times over; one too light to hold 1.5×, or to leave the anchor 10° above
level, is raised. The card can leave the elevator out of the design.

The tether lies in its anchor's meridian plane and turns with Mars. A point
of it at distance `x` from the spin axis and height `z` above the equatorial
plane is at

    r = x * ( m cos(lon) + e sin(lon) ) + z * p

- `m`, `e`, `p` — Mars's prime-meridian, 90°-east and pole directions at that
  instant (`Shared/mars-ephemeris.js`)
- `lon` — the anchor's east longitude

### The cargo aboard: weight and westward lean

Cargo climbing the tether has to be brought up to the speed of the ground
beneath it, and the tether does that by pushing it east; the cargo pushes the
tether west in return. The cargo also weighs on the tether. Both are in the
tether's equilibrium, solved in full in three dimensions (`leanedTether` in
`Shared/meridian-tether.js`), in axes turning with Mars (x toward the
anchor's meridian, y east, z north):

    d(T t) / ds  +  (lambda + mdot / v) f  -  2 mdot w (z x t)  =  0

- `T` — tension; `t` — unit vector along the tether, pointing out
- `s` — distance along the tether
- `lambda` — the cable and its track per metre, as sized with no cargo: the
  cable at each distance from Mars's centre keeps its cross-section
- `mdot / v` — the cargo per metre: the net flow up (kg/s) over the climbers'
  speed (200 m/s)
- `f` — gravity (with the equatorial bulge) and spin, per kg
- `w` — Mars's spin rate; `z x t` points east for a tether pointing out, so
  the last term is the cargo's push west, `2 mdot w` per metre of distance
  from the spin axis it climbs

The counterweight is held at its design distance from Mars's centre, as in
the sizing, the tether taking up or paying out whatever length that needs;
where on that sphere it hangs is solved for, from the counterweight's net
pull down the tether to the anchor (Newton's method on the counterweight's
latitude and longitude). Only the anchor resists turning the tether about
Mars's axis, so its sideways pull carries the whole torque:

    sin(theta) * T0 * x_A = mdot * w * ( x_c^2 - x_A^2 )

- `theta` — the lean west of the anchor's meridian where the tether leaves it
- `T0` — the tension at the anchor, with the cargo aboard
- `x_A`, `x_c` — the anchor's and the counterweight's distance from the axis

For the study elevator at 10 kg/s: 4.1° of lean at the anchor, the
counterweight turned 1.3° (1,180 km) west, the tether leaving the anchor
14.2° above level instead of 16.8°, and 8.05 MN at the anchor instead of 8.32.

**The most flow.** As the flow rises, the cargo's weight bows the bottom of
the tether down toward the ground and its push tips it west, and together
they lower the whole tether toward the equatorial plane. The card gives the
most flow the tether carries (`mostFlow`), whichever comes first of:

- **Phobos.** The tether drawn so near the plane that it passes Phobos's
  reach by less than 50 km. This is what holds the study elevator to about
  22 kg/s (0.72 Mt a year); it also lowers the cap on the Phobos skyhook's top
  as the flow rises (6,838 km empty, 6,390 km at 20 kg/s).
- **The ground.** The bottom of the tether drawn down until it leaves the
  anchor only a few degrees above level, past which no equilibrium holds it
  up. Mature nanotube at 2.5, which rides far above Phobos, reaches this at
  about 103 kg/s (3.3 Mt a year).

A flow past it is refused. A heavier counterweight, a stronger cable or a
lower safety factor carries more: with 300 kt instead of the study's 151 kt,
early nanotube carries about 144 kg/s. The search for the most flow steps up
from 1 kg/s and stops a few percent short of the true edge where the tether
leaves the anchor nearly level. The card warns once the loaded tether leaves
its anchor below the 10° the empty tether is sized for.

Everything on the card past the sizing, the drawing, Phobos's clearance and
the Phobos cap, Deimos's crossings and the hanging skyhook's passes are the
tether with its cargo aboard. The Deimos dodge swing's shape and the pumping
are worked out on the empty tether. Left out: the cargo's own turning along
the curved tether (`mdot * v * dt/ds`, under half a percent of the tension),
the cable's stretch, and the east–west sway that changes in the flow cause.

### Keeping clear of Phobos

A tether built on Phobos lies along the line from Mars's centre through
Phobos, whose orbit is tilted 1.08° to the equator, so its point at distance
`rho` from Mars's centre gets `rho * sin(1.08°)` from the equatorial plane, on
either side. The Phobos skyhook's top may be set only as high as

    z_e(rho) - swing(rho) - rho * sin(1.08°)  >=  50 km

- `z_e(rho)` — the elevator tether's height above the plane at that distance
- `swing(rho)` — the size of the Deimos-dodge swing there (zero for a tether
  that ends short of Deimos)
- `rho` — taken with Phobos at its apoapsis, 142 km beyond the card's altitude

holds all the way up it. For the study elevator empty that is 6,838 km; the
Phobos card gives the limit and a red marker on the Phobos tether's line
shows it. An elevator that passes Phobos itself (at apoapsis, its radius
added) by less than 50 km is refused. A stronger cable, a lower safety factor
or a heavier counterweight all straighten the tether, which carries it
farther off the plane and lets the Phobos tether reach farther.

### Dodging Deimos

Deimos crosses the tether's meridian plane every 131 h. Its **miss** at a
crossing is its height above the equatorial plane less the tether's at the
same distance, both from the clock. A crossing with a miss under 50 km (half
the 100 km trigger band) is dodged with the tether's slowest north–south
swing, built up to 60 km at Deimos's distance so that the tether stands at
the far end of its swing, on the side away from Deimos, as Deimos crosses.
The trigger band, the swing's size and the traffic figures below are fixed
(`DODGE` and `TRAFFIC` in `core/elevator.js`).

The swing is followed as a phasor `c`:

    d(t) = Re( c(t) * exp(i W (t - t0)) )

- `d` — the tether's displacement north at Deimos's distance
- `W` — the swing's own angular frequency (its period is about 24.5 h)
- `c` — the swing's size and phase; only the climber traffic changes it
- `t0` — the start of the clock

A dodge needs `c = D * dir * exp(-i W (t_pass - t0))` at the crossing, `D`
being the 60 km and `dir` +1 for north or −1 for south. Timed traffic moves
`c` by `D` in 6 swings at most, the build-up the pumping load is sized for. A
**spell** of dodging builds the swing from rest over 6 swings, goes straight
on to the phasor each further crossing needs while hazard crossings keep
coming within 17.5 days (three crossings on, when Deimos is back near the
same point of its orbit), then brings it to rest over 6 swings. Where two
hazard crossings fall too close together for the traffic to turn the swing
fully from one to the other, the phasors are chosen (over a grid on the disc
of the full swing) to leave the lesser of the two misses as large as it can
be. Every crossing's miss is then worked out with the tether where the swing
has it, and the card gives the least of them.

The spells appear as blue bars in the lower row under both date sliders, with
a pale tick at each crossing dodged; the drawn tether shows the swing, each
point moved by the swing's shape there (`northSouthModes`). **Previous dodge**
and **Next dodge** move the date to a dodged crossing, and the card gives
that crossing's miss, where the tether stands, and when the load timing
starts and the swing is at rest again.

In the 2080s Deimos's orbit is near the most tilted it gets (2.6° to the
equator), so it is seldom at the tether's height when it crosses: about two
crossings a year need a dodge, each on its own.

### Pumping the swing

Climbers are held on the slanted stretch 400 to 800 km above the anchor for
half of each swing, slowed from 200 m/s to 20 m/s, to build the swing in 6
swings (`MarsElevator.pumping`). The card gives the cargo that has to sit on
the stretch during that half, the flow that keeps it there, and the swing's
energy.

Left out: the pull of the Sun and the moons on the tether, Mars's gravity
beyond its equatorial bulge, the east–west sway that changes in the cargo
flow cause, and how the swing changes the tension.

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
**Pin**, at the end of the Flight slider's line, keeps the ship
there. Nothing yet searches for a release that ends in a catch.

The **Flight** slider moves the whole scene to a point of the flight. It spans
the whole flight on one of two axes (`Shared/sim/flight-clock.js`): **Time**
since release, or **Radial**, the angle the ship has swept round Mars since
release (`OrbitalMath.sweepTable`):

    theta_k = theta_(k-1) + atan2(|r_(k-1) x r_k|, r_(k-1) . r_k)

- `r_k` — the ship's position from Mars's centre at path sample `k`
- `theta_k` — the angle swept up to sample `k`, unwrapped past 360° on later laps

On the radial axis the ship holds its angle while the flight changes, so it
stays on the same ray from Mars and a change to the release or the date shows
as the destination tether coming early or late. The slider itself stays
linear in time on both axes, so a fast pass close to Mars gets no more of it
than any other stretch of the same length in time. **Pin** keeps
the ship at that pass instead, wherever it falls; moving the slider lets go.
In a turning view the path is drawn as that view sees it.

## Pointing at the scene

Clicking Mars, a moon, the ship or one of a skyhook's markers (foot, top,
release point, the hanging skyhook's centre of mass) makes the camera follow it; the label in the view's
corner names it, and its ✕ or a right-drag pan lets go. The POV buttons set
what is followed and how far back the camera sits. Shift (¼) and Ctrl (1/10)
slow any slider.

## Dependencies

`Shared/` (orbit, math-utils, mars-ephemeris, body-profiles, materials,
body-leg, meridian-tether, radial-tether, and the `sim/` scene kit),
`Calculators/Hanging-skyhooks/skyhookModel.js` (the hanging skyhook's masses),
`Calculators/Mars-Elevator/marsElevatorModel.js` (the space elevator) and `MissionPlanner/scene-frames.js` (the star field). The
folder breaks if moved without them.
