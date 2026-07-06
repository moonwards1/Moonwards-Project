# Solar System Trajectory Plotter

A navigable 3D heliocentric view for sketching interplanetary trajectories.
Pick a date and an origin body, set a departure burn, and the resulting
two-body arc is drawn through the solar system. Add up to two waypoints (each
able to carry its own mid-course burn; downstream arcs recompute automatically),
and drop a slidable **marker** anywhere on the path to read off its radius,
speed and ecliptic latitude.

## Files

- `solarSystemTrajectory.html` — markup and script/style wiring.
- `solarSystemTrajectory.css` — two-pane layout (view + input panel), responsive.
- `solarSystemTrajectory.js` — scene, camera controls, trajectory model, UI.

## Shared dependencies

Loads, by relative path, from `../../Shared/`:

- `three.min.js` — Three.js r128, bundled locally so the tool works from a
  `file://` link (the CDN build of `OrbitControls` does **not**, so this
  calculator uses its own small mouse-orbit controller instead).
- `orbit.js` — the `systems` body database. This tool relies on the
  **ephemeris fields** added to the Sun-orbiting bodies: `epoch` (JD) and
  `meanAnomaly` (rad), plus `inclination`, `longitude` (Ω) and `argument` (ω).
- `math-utils.js` — `OrbitalMath`, specifically the interplanetary block:
  `bodyStateAtJD`, `stateFromElements` / `elementsFromState`, `propagateState`,
  `sampleTrajectory`, `applyBurn`, `distanceToOrbit` (point-to-orbit-ring
  distance, used by the orbit-approach markers), the Kepler solvers and the
  Julian-date helpers.

**Moving this folder without `Website/Shared/` coming along will break it.**

## Model and conventions

- Frame: J2000 ecliptic, Sun-centred. Scene units are AU.
- Bodies are placed from fixed mean Keplerian elements propagated by mean
  anomaly (two-body). This is a **planning-grade** ephemeris: positions agree
  with JPL Horizons to well under a degree over the 2030–2130 span, dominated
  by neglected planetary perturbations — not a precision ephemeris.
- Trajectories are heliocentric two-body arcs joined by impulsive burns. There
  is no patched-conic flyby handling here (that lives in the Skyhook plotter).
- Burn frame at any point: **prograde** = v̂, **normal** = (r×v)̂,
  **radial** = normal × prograde. Components are entered in km/s.
- Burns are edited with an isometric arrow widget: a small ship (an elongated
  pyramid) at the origin with three draggable arrows — prograde up-right, radial
  down-right, normal vertical. The ship sits behind the axes so it never hides
  them. Two layered behaviours on each axis: **pressing** on it jumps the arrow
  straight to that point (coarse, absolute — the old click-to-set), and then
  **dragging** fine-tunes *relatively* from there (like the marker slider) —
  movement projected onto the axis, accumulated at ~1/10 the old rate (≈10× more
  hand travel per km/s), **4× finer again with Shift held**. So click to place
  roughly, drag to nudge precisely; lift and re-grab to push past the widget edge
  or through the origin into a negative component. Values resolve to **0.01
  km/s**; exact or out-of-range numbers can also be typed in the
  prograde/radial/normal fields beneath it (each labelled in full above its
  input). The same widget is used for the departure burn and each waypoint.
- Date 0 of the slider is 2030-01-01; the span is 100 Julian years.

## Body set

Sun plus Mercury, Venus, Earth, Mars, Ceres, Vesta, Psyche, Jupiter, Saturn,
Uranus, Neptune, Pluto. Each Sun-orbiting body has a semi-transparent
sphere-of-influence shell and an orbit ring.

Each body is drawn in its `color` from `orbit.js`. Those colours were revised
to a **distinct, legible palette** (min pairwise RGB distance ~62): the old
values left several bodies near-black (Mercury), near-white (Venus) or plain
grey (Ceres, Vesta, Psyche, Pluto), which is hard to read on a black sky.
Mercury and Venus are deliberately two different greens. The change lives in the
shared `orbit.js`, so other calculators pick up the same colours.

## Orbit rings and nodes

Each ring is split at its **line of nodes** so the nodes are obvious at a
glance: the half of the orbit above the ecliptic (north, z ≥ 0) is drawn
**bright** in the body's colour (opacity 0.6), the half below (south) a bit
dimmer (opacity 0.3) and nudged toward a cool blue, and the two colour changes
fall exactly on the ascending and descending nodes.

The split point comes from the argument of latitude $u = \omega + \nu$ ($\omega$ = argument of periapsis, $\nu$ = true anomaly): the orbit's
z-coordinate is zero where $u = 0$ (ascending) and $u = \pi$ (descending), so the
ascending node is at true anomaly $\nu = -\omega$. The north arc is sampled over
$\nu \in [-\omega,\ -\omega + \pi]$ and the south arc over $\nu \in [-\omega + \pi,\ -\omega + 2\pi]$. Orbits
effectively coplanar with the ecliptic (inclination < 0.5°, e.g. Earth, which
*defines* the J2000 ecliptic) have no meaningful nodes and are drawn as a
single uniform ring.

## True scale and labels

Bodies and their SOI shells are drawn **at real scale**, to convey how empty
the solar system actually is. Anything whose projected size drops below a
pixel collapses to a single bright point sitting on its orbit — so at a
system-wide view you mostly see orbit rings and bright dots, with only the
large outer-planet SOIs showing as shells. Zoom in and a body grows from a
point, to a translucent SOI shell, to a lit sphere.

Each body carries an **Arial name label** that floats beside it at a constant
screen size no matter the zoom, and hides itself when the body is off-screen
or behind the camera.

## Date bar

A full-width bar across the top sets the ephemeris date with two sliders: a
**coarse** slider spanning the whole 100-year period (2030–2130) and, beneath
it, a **fine** slider covering a one-year window (±6 months) centred on the
coarse position. Moving the coarse slider recenters the fine one; the fine
slider adjusts within the year without moving the coarse base. A date field
allows exact entry, and the current Julian date is shown alongside.

## Controls

- **Drag** to rotate, **wheel** to zoom, **right-drag** (or Shift-drag) to pan.
- **Double-click a body** (its dot or label) to lock the camera onto it, then
  wheel in to inspect it. **Double-click the Sun** to recenter heliocentrically
  (keeping the current zoom), or **double-click empty space** to release a lock.
  A double-click that isn't near anything does **nothing** — it never snaps or
  zooms the view — and a double-click never also drops a waypoint.
- **Click the trajectory** to place the **marker** (see *Marker* below) — a
  short click that doesn't rotate the view, registered ~0.35 s later so it can't
  be mistaken for the first half of a double-click. Waypoints are *not* dropped
  by clicking any more; they are created from the **Create waypoint 1/2**
  checkboxes. Each waypoint is marked by a small prograde/radial/normal axis
  gizmo (green/orange/blue, matching the panel) aligned to that point's coast
  frame and held at a constant on-screen size.

## Marker

A single **marker** — a small white **`x`** — can be dropped anywhere on the
trajectory to probe it. Click the plotted path and the marker snaps to the
nearest point; that point becomes **0°** on the marker's slider, and the marker
immediately becomes the **camera focus**, so dragging now rotates the view
*around the marker* and the wheel zooms straight in toward it. Clicking the `x`
again re-focuses on it without moving it.

A compact **card in the top-left corner of the view** carries the marker's
controls and readouts:

- a **−180°…+180° slider** that slides the marker along the *whole* trajectory
  (across every leg and waypoint, not just one arc). The clicked point is 0°;
  −180° walks back to the path's start and +180° forward to its end, each side
  scaled linearly so the slider's resolution is densest near where you clicked.
  Dragging it uses **custom relative motion**, so control isn't capped by the
  short track's pixel width: the marker moves at ~1/10 the native rate (about ten
  times more hand travel per degree), and **holding Shift** makes it 4× finer
  again. The drag accumulates, so you can lift and re-grab to "ratchet" across the
  full range. The **arrow keys** also nudge it by ⅓° (¹⁄₁₂° with Shift) when the
  slider has focus.
- **radius** — the heliocentric distance at the marker, in AU (with km beneath).
- **prograde velocity** — the ship's orbital (prograde) speed there, in km/s.
  This is `|v|`, the magnitude of the coast velocity, which by definition points
  along prograde.
- **ecliptic latitude** — the marker's angle above (+) or below (−) the J2000
  ecliptic seen from the Sun, $\beta = \arcsin(z / |r|)$ ($z$ = height above the ecliptic, $r$ = heliocentric position vector), in degrees.
- **radial from origin** — the heliocentric angle (0–360°) swept around the Sun
  from the **departure point** (the origin body's position at the departure date,
  i.e. the trajectory start) to the marker, measured in the direction of travel.
  It answers "how far around the Sun have I gone since launch?" — 0° at departure
  and growing as the marker advances; it is taken about the departure
  angular-momentum axis, so prograde motion increases it. (Measured from the
  origin only — waypoints don't reset it.)

The marker stays pinned to its fractional position as the date, origin or any
burn reshapes the path, and its readouts update live. Remove it with the card's
**✕**, or with **Reset**. **Single-clicking empty space** in the view releases
the marker focus (so dragging resumes free navigation while the marker stays
put); panning or double-clicking a body/the Sun/empty space releases it too.
Click the **`x`** again to refocus.

## Orbit-approach markers

Wherever the plotted path passes close to the **orbital ring of another body**
(any body except the current origin), a **hollow ring** appears on the trajectory
at that point, in **three proximity tiers**. Closer tiers are brighter but
*smaller and thinner* (the outermost tier is the big, bold one, tightening toward
the point as you get closer):

- **faint, largest, thickest** within **0.004 AU** of the body's orbit,
- **brighter, medium** within **0.001 AU**,
- **brightest, smallest, thinnest** within **0.0002 AU**.

These are always on.

**Sizing.** Each ring holds a fixed on-screen size when the view is far away
(so it stays visible as a marker even when its true distance is sub-pixel). But
once you zoom in past the point where the tier's actual distance would project
larger than that fixed size, the ring **grows to its true physical size** — its
radius then equals the tier's distance (0.004 / 0.001 / 0.0002 AU), so it reads
as a real proximity bubble around the crossing rather than a fixed glyph.

Important to read them correctly:

- It flags proximity to the body's *orbit path*, **not to the body** — there is
  no timing or sphere-of-influence check, so a ring only means "your path
  crosses near where this body's orbit runs," a necessary-but-not-sufficient
  condition for an actual encounter.
- Detection does **not** rely on the trajectory's drawn sample points (whose
  spacing, 0.015–0.09 AU, is far coarser than the thresholds, and whose
  chord-vs-arc error can reach tens of thousands of km on slow outer arcs).
  Candidate approaches are spotted on the samples but then **refined along the
  true Kepler arc** (`stateAtGlobalTime`) against the **analytic orbit ellipse**
  (`OrbitalMath.distanceToOrbit`), which resolves the distance to well below the
  0.0002 AU tier.
- **Fidelity caveat.** 0.0002 AU ≈ 30,000 km. Bodies are placed from *fixed mean
  Keplerian elements* (planning-grade; see above). At the bright-tier distance
  you are at or below the model's own physical fidelity for several bodies — the
  main-belt asteroids (Ceres/Vesta/Psyche), Pluto, and century-scale secular
  drift that is neglected here — so the bright ring faithfully reflects geometry
  against the *idealized* mean orbit, not a guaranteed real-world pass. The
  0.001 AU tier (~150,000 km) is comfortably meaningful for the major planets.

## Waypoints

Each waypoint card (`WP 1`, `WP 2`) carries three mutually-exclusive **snap-to**
checkboxes that pin the waypoint to an orbital feature of the arc it sits on,
instead of the spot you clicked:

- **apoapsis / periapsis** — context-sensitive on the burn that *opened this
  leg* (the departure burn for `WP 1`, the previous waypoint's burn for `WP 2`).
  A net **prograde** burn raises the far side of the orbit, so the option reads
  **apoapsis**; a net **retrograde** burn lowers it, so it reads **periapsis**.
  With no prograde/retrograde element (no burn, or a purely radial/normal one)
  no such apsis exists, and the checkbox is **disabled**. It's also disabled for
  the (non-existent) apoapsis of a hyperbolic escape.
- **ascending node** — where the arc crosses the ecliptic going north
  (argument of latitude $u = \omega + \nu = 0$).
- **descending node** — the southbound crossing ($u = \pi$).

When one is ticked, the waypoint's coast time is recomputed every frame to land
exactly on that feature (`timeToTrueAnomaly` solves the time to the target true
anomaly, for either conic), so it stays pinned even as upstream burns reshape
the arc. Ticking the active box again clears it, returning the waypoint to its
manually-clicked position. Snapping a waypoint changes where its own burn is
applied, so any downstream waypoints update too.

## Burn vectors

With **Burn vectors** enabled, each burn point (the departure origin and every
waypoint) gets two arrows in the 3D view:

- a **magenta Δv arrow** — the burn itself, $\vec v_\text{after} - \vec v_\text{before}$, i.e. the
  vector sum of the prograde/radial/normal components. Its length is the *real*
  delta-v expended,

  $$
  |\Delta v| = \sqrt{P^2 + R^2 + N^2}
  $$

  ($P$, $R$, $N$ = the prograde, radial and normal burn components), and the side-panel readouts print
  this magnitude in km/s. Because the components of an impulsive burn are
  applied simultaneously, this is the combined cost — there is no penalty for
  decomposing it into three axes.
- an **amber prograde-speed arrow** — the change in the *orbital* (prograde)
  speed, $|v_\text{after}| - |v_\text{before}|$. The reference $|v_\text{before}|$ is the origin
  body's speed at departure, or the coast speed just before the burn at a
  waypoint. It is a **signed scalar** drawn along the resulting prograde
  direction, and flips to point **retrograde** when the new orbit is slower than
  the reference. It answers "how much faster (or slower) is this orbit moving
  than what we started from?" — so a pure radial or normal burn, which mostly
  changes direction rather than speed, produces only a tiny amber arrow even
  when its magenta Δv is large.

Both arrows share one physical scale (`BURN_VEC_SCALE`, AU drawn per km/s) so
their lengths are directly comparable, and they render on top so they stay
visible through bodies and orbit rings.

### Readout panes

As soon as a burn has a value, a small readout pane appears straddling the
panel's left edge, level with that burn's editor (one per burn). It shows three
numbers:

- **burn Δv** — $\sqrt{P^2 + R^2 + N^2}$ in km/s (pink, matching the Δv arrow).
- **plane change** — the change in the orbit's inclination *to the ecliptic*
  caused by the burn ($i_\text{after} - i_\text{before}$, the rotation about the radial axis),
  in degrees, signed (also pink). A pure prograde/retrograde burn reads ~0°.
- **prograde Δv** — the change in orbital (prograde) speed, $|v_\text{after}| -
  |v_\text{before}|$, in km/s, signed (amber, matching the prograde-speed arrow).

The panes are positioned live (a transparent overlay on `#sst-main`, outside the
panel's clipping) so they track their editor as the panel scrolls, and hide when
their editor scrolls out of view.

## Not yet implemented / possible extensions

- On-canvas drag handles for the burn vectors (currently sliders + numeric
  fields in the panel).
- The `Link` hooks described in `Calculators to make.md` for importing an arc
  from the Hohmann or Skyhook plotters.
- Higher-fidelity ephemeris (secular element rates) if sub-arcminute body
  positions are ever wanted across the full century.
