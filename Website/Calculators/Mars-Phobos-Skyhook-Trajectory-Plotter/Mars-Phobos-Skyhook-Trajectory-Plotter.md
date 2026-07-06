# Mars-Phobos Skyhook Trajectory Plotter

## Purpose

Shows the trajectories that result when a vessel is released from a skyhook
built onto Phobos, in orbit around Mars — as a means of enabling traffic to
and from Mars, both via interplanetary trajectories and via releases that
result in atmospheric entry over Mars' surface. Closely related to, and
sharing most of its code and graphics style with, the
Moon-Skyhook-Trajectory-Plotter, except that Mars is the central body and
Phobos hosts the skyhook.

## Design

In three panes: Ephemeris date section, 3-D simulation of the Mars-Phobos
system with skyhook, sidebar with input fields/sliders and read-outs.

### Key structural difference from the sister tool

Phobos **is** the skyhook's centre of mass — a tether descends from Phobos
down to just above the atmosphere (150 km above Mars' surface by default),
and another tether ascends from Phobos to 25 000 km altitude. Because
Phobos' own orbit around Mars already **is** the hook's CoM orbit, this
collapses the sister tool's two-tier hierarchy (hook-around-Moon,
Moon-around-Earth) into one tier (hook-around-Mars, with Phobos as a fixed
point on that same orbit). There is no separate "skyhook phase" slider as a
result — sweeping Phobos around its orbit already sweeps the whole rigid
structure.

### Ephemeris date section

- Top slider scrubs through 12 years, from midnight on Jan. 1, 2030, to
  midnight on Jan. 1, 2042.
- Second slider covers one orbit of Phobos, centered on the point set by the
  top slider — Phobos moves through exactly 360° from the beginning to the
  end of the slider.

### 3-D model of the Mars-Phobos system and skyhook

- Mars at the origin, Phobos at its position on a fixed circular, equatorial
  orbit around Mars; the Sun off-screen, indicated only by lighting
  direction on the two spheres.
- Navigable the same way as the sister tool (drag/wheel/right-drag), with
  Mars' sphere of influence shown (Phobos has no physically meaningful SOI
  of its own — it works out smaller than Phobos itself — so none is drawn).
- Skyhook drawn to scale: the circle traced by the lower tether end, the
  circle traced by the upper tether end (Phobos' own orbit ring doubles as
  the CoM circle), a radial line through bottom/CoM/top, and a draggable
  triangle marker at the release point.
- Skyhook default: bottom tether end 150 km above Mars' surface, top tether
  end 25 000 km above Mars' surface.
- Zoom: double-click Phobos to focus from 130 km; double-click Mars to focus
  from 16 000 km.
- A toggle switches to a solar-system context view (all planets, Mars' true
  heliocentric orbit, and the released trajectory patched into true
  heliocentric coordinates) — mirrors the sister tool's heliocentric overlay.

### Sidebar

- **Skyhook**: paired fields for the bottom and top tether-end altitudes,
  with read-outs of CoM orbital velocity below the (fixed) CoM altitude, and
  each end's angular velocity / centrifugal load.
- **Release point**: a toggle choosing release **above** Phobos (outbound,
  can exceed local circular speed and escape Mars' SOI onto a heliocentric
  transfer) or **below** Phobos (inbound — sub-orbital by construction, since
  the tether's fixed angular rate is sub-circular at any radius under
  Phobos, so these releases always dive toward Mars). A slider/field sets
  the release altitude within the active side's range, including a 0.1×
  fine-control speed while Shift is held (both on the slider and while
  dragging the in-view marker). Read-outs always show release speed and
  $v_\infty$ vs Mars; depending on the trajectory's actual outcome, either an
  **outbound block** (heliocentric primary body, periapsis/apoapsis,
  inclination, $v_\infty$ at the Sun's SOI) or an **inbound block**
  (ballistic atmospheric-entry classification, entry speed, flight-path
  angle, Allen–Eggers peak deceleration, Sutton–Graves peak heat flux, with
  adjustable entry-vehicle mass and diameter) is shown.
- **Waypoint burns**: up to two waypoints, each burnable along
  prograde/radial/normal axes via a draggable in-view gizmo and an isometric
  vector-editor widget — identical in design to the sister tool.

## Analysis depth for atmospheric entry

Ballistic-entry read-outs only: entry-interface speed and flight-path angle,
periapsis-based impact/entry classification, Allen–Eggers peak deceleration,
and Sutton–Graves peak heat flux. Explicitly **not** in scope: landing site,
ground track, or a full descent simulation.
