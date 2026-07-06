# Mars-Phobos Skyhook Trajectory Plotter

A navigable, to-scale 3-D view of the Mars–Phobos system (Three.js) with a
gravity-gradient skyhook built onto **Phobos itself**, plus the full
integrated trajectory (Mars + Sun gravity), waypoint burns, and ballistic
atmospheric-entry read-outs for a vessel released from it.

## Files

- `marsPhobosSkyhookTrajectory.html` — markup and script/stylesheet wiring.
- `marsPhobosSkyhookTrajectory.css` — styling (`mps-` prefix).
- `marsPhobosSkyhookTrajectory.js` — the tool (ES module; imports from `Shared/`, with `three.min.js` loaded as a classic script ahead of it).
- `Mars-Phobos-Skyhook-Trajectory-Plotter.md` — the design spec this tool was built to.
- No `Mars-Wrap.jpg` / `Phobos-Wrap.jpg` ship with this tool (see
  **Known simplifications**) — drop matching image files into this folder to
  enable textures; the spheres fall back to flat colours without them.

## What it shows

**Date bar (top).** Two sliders:
1. **12 years** — Jan 1 2030 → Jan 1 2042 (midnight to midnight). A lock
   toggle (🔒) next to it captures Phobos' current phase relative to the Sun
   — e.g. "at Mars midnight" (Phobos on Mars' far side from the Sun) — and
   preserves that relationship as you scrub through the years: the second
   slider's offset jumps to whatever point within Phobos' current orbit
   restores it, since a plain day-count would otherwise land on an
   essentially arbitrary phase (Phobos completes over 3 orbits per day).
2. **One Phobos orbit** centred on slider 1 — Phobos (and the skyhook it
   carries) sweeps exactly 360° end to end. There is no separate "skyhook
   phase" slider: because Phobos *is* the tether's centre of mass, sweeping
   Phobos around its orbit already sweeps the whole rigid structure.

**3-D view (centre).** Mars at the origin (textured if available), Phobos at
its position on a fixed circular, equatorial orbit (textured if available,
tidally locked), Mars' **sphere of influence**, and Phobos' orbit drawn as
two arcs (bright "north" half / dim "south" half). Navigate with drag
(rotate), wheel (zoom), right-drag (pan). **Double-click** Phobos to view it
from 130 km, or Mars from 16 000 km; double-click empty space to release.

The **skyhook** is drawn to scale: circles traced by the lower tether end,
Phobos (the centre of mass), and the upper tether end; a radial line through
all three; and a draggable **triangle marker** at the release point. A
top-left button swaps to a **solar-system context view** (all the planets,
Mars' true heliocentric orbit, and the released trajectory patched into true
heliocentric coordinates) — this is also where **waypoint burns** (below)
are placed and drawn, since a flyby of Mars itself isn't a useful place for
one.

**Sidebar (right).**
- **Skyhook** — top/bottom tether-end altitude fields, with read-outs of CoM
  orbital velocity, tether rotation period, and each end's speed and
  centrifugal load.
- **Release point** — a toggle between releasing **above** Phobos (outbound)
  or **below** Phobos (inbound), a slider/field for the release altitude
  (supports the 0.1× fine-control speed while Shift is held, both on the
  slider and while dragging the in-view marker), and the full trajectory
  read-out: primary body, periapsis/apoapsis or heliocentric orbital
  elements, inclination, and — depending on outcome — either the
  heliocentric departure read-outs or the ballistic atmospheric-entry
  read-outs.
- **Waypoint burns** — up to two waypoints, available once the release
  trajectory escapes Mars ("Sun" primary). Each waypoint snaps to an
  apoapsis/periapsis or an ascending/descending node of the *post-escape*
  heliocentric coast (a ±90° slider fine-tunes the position around that
  snapped feature), plus an isometric prograde/radial/normal burn-vector
  widget — functioning exactly like the waypoints in the sister
  `Solar-System-Trajectory-Plotter` tool. The gizmos and burn-vector arrows
  are drawn only in the solar-system view (see "The physics" below for why).

## The physics

The tether is gravity-gradient: it stays radial and co-rotates with Phobos
at Phobos' own circular orbital rate,

$$
\omega = \sqrt{GM_\text{mars} / r_\text{com}^3}
$$

- $\omega$ — the skyhook's (and Phobos') angular rotation rate
- $GM_\text{mars}$ — Mars' gravitational parameter
- $r_\text{com}$ — Phobos' orbital radius (the skyhook's fixed centre of mass)

so a point at radius $r$ on the tether moves at $v = \omega\cdot r$, and
because Phobos already traces this same circle, the hook's CoM ring **is**
Phobos' orbit — there is no separate "hook around a moon around a planet"
hierarchy the way the sister tool needs for Earth's Moon.

- CoM orbital velocity: $v_\text{com} = \sqrt{GM_\text{mars} / r_\text{com}}$.
- Centrifugal acceleration at either tether end: $a = \omega^2\cdot r$, for
  that end's radius $r$.
- Release speed (inertial, Mars frame): $v_\text{rel} = \omega\cdot r_\text{rel}$,
  where $r_\text{rel}$ is the release-point radius.
- Hyperbolic excess vs Mars: $v_\infty = \sqrt{v_\text{rel}^2 - 2\cdot GM_\text{mars}/r_\text{rel}}$
  (shown as "bound" if the release is sub-escape — always true for releases
  below Phobos, since the tether's fixed angular rate is sub-circular at any
  radius under the CoM).

**Trajectory (full integration, not a first-cut estimate).** From the
release state, the ship is integrated (RK4, adaptive step) under Mars **and**
the Sun's gravity — Phobos itself is treated as massless (its $GM$ is
~$6\times10^{-9}$ of Mars', and its own sphere of influence works out smaller
than Phobos itself) — until one of three outcomes is reached: it crosses
Mars' ~100 km atmosphere interface ("entry"), it completes roughly one bound
Mars orbit without reaching the atmosphere or escaping ("Mars"), or it clears
to a heliocentric orbit ("Sun"). This integrated leg is drawn in full and
never carries a waypoint burn — a flyby of Mars itself isn't a useful place
for one.

**Waypoint burns (post-escape, pure two-body).** When the integrated leg
escapes to a heliocentric orbit, up to two waypoint burns chain onto it as
**exact two-body Sun-only Kepler arcs** (no further RK4/Mars-gravity
integration — Mars' influence is already negligible there), matching the
`Solar-System-Trajectory-Plotter` tool's waypoint model, adapted for one
difference: the first waypoint's leg opens with no controlling burn at all
(it's just wherever the integrated leg happened to cross the escape
boundary), so — unlike a leg opened by an actual burn, where only the *newly
created* apsis is offered (a net prograde burn opens an apoapsis opposite
the burn point, net retrograde a periapsis; the other one is degenerate,
being where you just started) — a burn-less leg generally sits at neither
apsis to begin with, so **both** periapsis and apoapsis are independently
available as snap targets (apoapsis further needs the resulting orbit to be
bound). Each waypoint can otherwise snap to an ascending/descending node
(for a near-ecliptic leg, substituted with the points 90°/270° of true
anomaly ahead). A ±90° slider fine-tunes the position around whichever
feature is snapped. Because each leg is an exact Kepler conic, the predicted
heliocentric orbit drawn past the final waypoint (or past escape, with no
waypoints at all) is exact — not an estimate, unlike the escape point
itself, which inherits the integrated leg's cutoff-boundary approximation.

**Ballistic atmospheric entry** (for a "below Phobos" release that reaches
Mars' atmosphere interface) reports the entry speed and flight-path angle
directly from the integrated state, then estimates peak deceleration and
peak convective heat flux via the classical Allen–Eggers ballistic-entry
model:

$$
a_\text{peak} = \frac{k\, v_\text{entry}^2 \sin\gamma}{2 e\, H}
$$

- $a_\text{peak}$ — peak deceleration (m/s², reported in Earth-$g$)
- $k$ — empirical correction, 0.55 (the Stardust calibration)
- $v_\text{entry}$ — entry-interface speed
- $\gamma$ — flight-path angle below the local horizontal
- $e$ — Euler's number (from the exponential-atmosphere density profile)
- $H$ — Mars' atmospheric scale height (~11 100 m)

with the density and speed **at** that peak-deceleration point (not at
entry) feeding the Sutton–Graves convective heat-flux estimate:

$$
\rho_\text{peak} = \frac{\beta \sin\gamma}{H}, \qquad
v_\text{peak} = \frac{v_\text{entry}}{\sqrt{e}}, \qquad
q_\text{peak} = 1.7415\times10^{-4}\sqrt{\rho_\text{peak}/R_n}\; v_\text{peak}^3
$$

- $\beta = m / (C_d A)$ — the entry vehicle's ballistic coefficient
- $m$ — vehicle mass (sidebar field, default 4000 kg)
- $C_d$ — drag coefficient, fixed at 1.5
- $A$ — frontal area from the vehicle-diameter field (default 5 m)
- $R_n$ — nose radius, taken as half the vehicle diameter
- $q_\text{peak}$ — peak convective heat flux (W/m², reported in W/cm²) —
  convective only; excludes radiative heating, so treat as a lower bound

## Dependencies

Loads from `../../Shared/`: `three.min.js`, `orbit.js` (`systems`),
`constants.js` (`Const`), and `math-utils.js` (`OrbitalMath`).
**Moving this folder without `Website/Shared/` coming along will break it.**

`math-utils.js` gained two small additions for this tool —
`allenEggersPeakDensity` and `allenEggersPeakVelocity`, the classical
Allen–Eggers companions to the pre-existing `allenEggersPeakDecel` — so the
peak-heat-flux estimate above uses the same ballistic-entry model as the
peak-deceleration read-out, rather than mixing in the separate
grazing-aerobrake density model further down that same file.

## Known simplifications

- **Phobos is treated as circular and exactly equatorial** — its small real
  eccentricity (~1.5%) and inclination to Mars' equator (~1°) are neglected,
  the same style of simplification the sister tool uses for the skyhook's
  own orbital plane.
- **Phobos is massless in the trajectory integration** — only Mars and the
  Sun's gravity act on a released vessel (see "The physics" above for why).
- **Waypoint burns only exist post-escape** — a released vessel that stays
  bound to Mars or re-enters has no waypoints available; the two burns chain
  onto the heliocentric coast only, as pure two-body Sun-only Kepler arcs
  (no further Mars-gravity perturbation modelled there).
- **Mars' axial tilt is a hardcoded fallback constant** (25.19°): the shared
  `System` class (`Shared/orbit.js`) does not expose an `axialTilt` getter
  for any body, so this mirrors the exact pattern the sister tool uses for
  the Moon's own axial tilt.
- **No landing-site, ground-track, or descent simulation** — atmospheric
  entry is reported as instantaneous ballistic read-outs (speed, flight-path
  angle, peak deceleration, peak heat flux) at the interface-crossing point
  only.
- **Entry-vehicle drag coefficient is fixed at 1.5** — only mass and diameter
  are adjustable.
- Textures load from local files; if a browser blocks `file://` image→WebGL
  uploads, or no image files have been placed in this folder, the spheres
  fall back to flat colours.
