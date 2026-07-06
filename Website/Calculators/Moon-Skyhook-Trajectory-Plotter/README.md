# Moon Skyhook Trajectory Plotter

A navigable, to-scale 3-D view of the Earth–Moon system with a gravity-gradient
lunar **skyhook**, and the release physics for a vessel let go from it.

**This is Phase 1.** It builds the three-pane tool — the ephemeris date bar, the
3-D Earth–Moon–skyhook view, and the sidebar of inputs and read-outs. Drawing
the actual escape / Earth-flyby **trajectories** (with waypoints and the Oberth
effect) is Phase 2 and is not yet implemented.

## Files

- `moonSkyhookTrajectory.html` — markup and script/stylesheet wiring.
- `moonSkyhookTrajectory.css` — styling (`msk-` prefix).
- `moonSkyhookTrajectory.js` — the tool (ES module; imports from `Shared/`, with `three.min.js` loaded as a classic script ahead of it).
- `2k_moon-Wrap.jpg`, `NASA-Earth-world.200407.3x5400x2700.jpg` — sphere textures.

## What it shows

**Date bar (top).** Three sliders:
1. **3 years** — Jan 1 2030 → Dec 31 2033 (midnight to midnight).
2. **One lunar month** centred on slider 1 — the Moon sweeps exactly 360°
   (one sidereal month, 27.32 d) end to end.
3. **Skyhook phase** — rotates the tether through 360° of its orbit.

The Moon is placed from a Meeus low-precision lunar ephemeris
(`Shared/lunar-ephemeris.js`), so it sits at its real position and its orbital
**nodes precess** correctly across the span. The Sun is off-screen; its
direction only sets the lighting on the two spheres.

**3-D view (centre).** Earth at the origin (textured), the Moon at its
geocentric position (textured, tidally locked), each body's **sphere of
influence**, and the Moon's geocentric **orbit** drawn as two arcs split at the
line of nodes (bright north / dim south). Navigate with drag (rotate), wheel
(zoom), right-drag (pan). **Double-click** the Moon to view it from 20 000 km, or
the Earth from 30 000 km; double-click empty space to release.

The **skyhook** (gravity-gradient, radial, rotating once per orbit) is drawn to
scale at the Moon: the circle traced by its **top**, the circle traced by its
**centre of mass**, a **radial line** (tether base 20 km above the surface, out
through the CoM and top), and a draggable **arrow** at the release point.

**Sidebar (right).**
- CoM altitude → orbital velocity.
- Top altitude → angular velocity and tip centrifugal load.
- Release-point altitude (between CoM and top, or drag the arrow) → speed on
  release, v∞ at the Moon's SOI, and a first-cut v∞ at Earth's SOI.

## The physics (Phase 1)

The tether is gravity-gradient: it stays radial and rotates at the CoM's
circular orbital rate

$$
\omega = \sqrt{GM_\text{moon} / r_\text{com}^3}
$$

- $\omega$ — the skyhook's angular rotation rate
- $GM_\text{moon}$ — the Moon's gravitational parameter
- $r_\text{com}$ — orbital radius of the skyhook's centre of mass

so a point at radius $r$ moves at $v = \omega\cdot r$.

- Orbital velocity of the CoM: $v_\text{com} = \sqrt{GM_\text{moon} / r_\text{com}}$.
- Centrifugal acceleration at the top: $a = \omega^2\cdot r_\text{top}$, where $r_\text{top}$ is the tether-top radius.
- Release speed (inertial, Moon frame): $v_\text{rel} = \omega\cdot r_\text{rel}$, where $r_\text{rel}$ is the release-point radius.
- Hyperbolic excess vs the Moon: $v_\infty = \sqrt{v_\text{rel}^2 - 2\cdot GM_\text{moon}/r_\text{rel}}$
  (shown as "bound" if the release is sub-escape).
- **First-cut** $v_\infty$ vs Earth: assumes the release is **prograde to the Moon's
  geocentric motion**, so the Moon-relative excess adds to the Moon's speed
  $V_\text{moon}$; then

  $$
  v_{\infty,\text{earth}} = \sqrt{2\cdot(\tfrac{1}{2}v_\text{geo}^2 - GM_\text{earth}/r_\text{geo})}
  $$

  - $v_{\infty,\text{earth}}$ — hyperbolic excess speed relative to Earth
  - $v_\text{geo} = V_\text{moon} + v_{\infty,\text{moon}}$ — the ship's geocentric speed at lunar distance
  - $GM_\text{earth}$ — Earth's gravitational parameter
  - $r_\text{geo}$ — the Earth–Moon distance

  This is a placeholder until the Phase-2 trajectory model supplies the real release
  geometry.

Defaults: CoM 275 km, top 6000 km, release 950 km → period 2.25 h,
$v_\text{com}$ 1561 m/s, tip 4.66 m/s² (0.48 g), $v_\text{rel}$ 2085 m/s, $v_\infty$(Moon) 835 m/s,
$v_\infty$(Earth, first-cut) ≈ 1.2 km/s.

## Dependencies

Loads from `../../Shared/`: `three.min.js`, `orbit.js` (`systems`),
`math-utils.js` (`OrbitalMath`), and `lunar-ephemeris.js` (`LunarEphemeris`).
**Moving this folder without `Website/Shared/` coming along will break it.**

The pure maths is Node-testable: the ephemeris reproduces Meeus' 1992-04-12
worked example (λ 133.162655°, β −3.229126°, Δ 368409.7 km) to <0.01″ / 0.02 km.

## Known Phase-1 simplifications

- Textures load from local files; if a browser blocks `file://` image→WebGL
  uploads, the spheres fall back to flat colours (run from a local web server to
  see the maps).
- The skyhook orbits the Moon's equatorial plane, approximated by the Moon's
  axial tilt to the ecliptic (1.54°) with the node at ecliptic longitude 0.
- The Moon mesh is tidally locked but libration is not modelled.
- No trajectory arcs yet — that is Phase 2.
