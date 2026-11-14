# Moon–L1 Elevator Calculator

A tether from the Moon's surface, through Earth–Moon L1, to a counterweight
beyond it. The workbench's L2 elevator (from the far side, through L2) is the
same calculator with `side: "L2"`, and this README derives the tether model
every workbench elevator shares (`Shared/radial-tether.js`).

## Files

- `l1ElevatorModel.js` — the standalone example design's model, pure (no DOM):
  `L1Elevator.buildContext`, `loadedMetrics` (its cargo traffic on top of
  `Shared/radial-tether.js`), `sweepSpeeds`, `releaseOrbit`, `findL1`, `omega`
- `l1ElevatorModel.test.js` — Node test pinning the original example design:
  `node --test Website/Calculators/Moon-L1-Elevator/l1ElevatorModel.test.js`
- `l1ElevatorBench.js` — the home workbench's cards for the L1 or L2 elevator,
  `mountMoonLagrangeElevator(root, opts)` (see "In the workbench" below)

## Dependencies

**Not self-contained.** The model and the workbench cards load from `Website/Shared/`:

- `../../Shared/math-utils.js` (`OrbitalMath`)
- `../../Shared/constants.js` (`Const`)
- `../../Shared/radial-tether.js` (the tether sizing)
- the workbench cards also use `../../Shared/orbit.js` (Earth and Moon data),
  `calc-shell.js` / `calc-shell.css`, `material-card.js`, `materials.js` and
  `counterweight-card.js`

Moving this folder without `Website/Shared/` coming along will break it.

## Model

### Force field

The Moon and Earth orbit their common barycentre; in the frame that rotates with
them, a point at distance $r$ from the Moon's centre (measured toward Earth) feels
a net radial acceleration

$$
g(r) = \frac{GM_e}{(D-r)^2} - \frac{GM_m}{r^2} + \omega^2 (r - x_b)
$$

- $g(r)$ — net radial acceleration in the rotating frame, at distance $r$ from the Moon's centre
- $GM_e$, $GM_m$ — gravitational parameters of Earth and the Moon
- $D$ — Earth–Moon centre-to-centre distance
- $r$ — distance from the Moon's centre, measured toward Earth
- $\omega$ — angular rotation rate of the Earth–Moon system
- $x_b$ — the barycentre's offset from the Moon's centre

three pieces added together: Earth's pull (toward Earth), the Moon's own pull
(toward the Moon), and the centrifugal term from the system's rotation ($\omega$ =
angular rate, $x_b$ = barycentre offset from the Moon's centre). $g(r)=0$ defines
L1; beyond it $g(r)$ flips sign and points *away* from the Moon — that reversal is
the only reason a counterweight out there can hold the cable taut.

The matching potential, used below for the cable's own-weight taper, is

$$
\Phi(r) = -\frac{GM_m}{r} - \frac{GM_e}{D-r} - \frac{1}{2}\omega^2 (r-x_b)^2
$$

- $\Phi(r)$ — the effective potential; $g(r)$ is (minus) its gradient
- $GM_m$, $GM_e$, $D$, $r$, $\omega$, $x_b$ — as above

### Loads on the cable

- **Cargo**, $\lambda_\text{cargo}$ — a moving load (cargo mass × a climber-tare
  factor), present only while the elevator is loaded.
- **Track**, $\lambda_\text{track}(r) = \lambda_\text{min} + \lambda_\text{grav}\cdot|g(r)|/g_s$
  — always on: a minimum gauge everywhere, plus reinforcement that scales with
  local gravity ($g_s = |g(R_\text{moon})|$), so it's heaviest near the Moon and
  thins to the minimum out near the gravity well's edge.

### Tension

The cable is sized so stress equals strength ÷ safety factor everywhere, i.e.
$\rho$ (density) and $\sigma_\text{eff}$ (strength ÷ safety factor) satisfy

$$
\frac{dT}{dr} = -\frac{\rho}{\sigma_\text{eff}}\,g(r)\,T \;-\; \big(\lambda_\text{track}(r) + \lambda_\text{cargo}\big)\,g(r)
$$

- $T$ — tension in the cable at $r$
- $\rho$ — cable material density
- $\sigma_\text{eff}$ — effective strength (material strength ÷ safety factor)
- $g(r)$ — net radial acceleration (defined above)
- $\lambda_\text{track}(r)$ — the track's mass per unit length at $r$ (always present)
- $\lambda_\text{cargo}$ — cargo's mass per unit length (present only while loaded)

integrated (RK4) from the counterweight down to the surface. Being linear, it
splits into two unit responses, both started from $C_1=C_g=0$ at the counterweight:

$$
\frac{dC_1}{dr} = -\frac{\rho}{\sigma_\text{eff}}g(r)\,C_1 - g(r) \qquad\qquad \frac{dC_g}{dr} = -\frac{\rho}{\sigma_\text{eff}}g(r)\,C_g - h(r)\,g(r)
$$

- $C_1(r)$ — unit tension response to a constant distributed load
- $C_g(r)$ — unit tension response to the gravity-shaped track reinforcement
- $\rho$, $\sigma_\text{eff}$, $g(r)$ — as above
- $h(r) = |g(r)|/g_s$ — gravity "shape" factor: $1$ at the surface, $\approx 0$ near L1 and beyond

A constant load $\lambda$ contributes $\lambda\cdot C_1(r)$
to the tension; the gravity-shaped track reinforcement contributes
$\lambda_\text{grav}\cdot C_g(r)$. The counterweight's own pull and the cable's
self-weight are folded in separately via

$$
E(r) = \exp\!\Big[\tfrac{\rho}{\sigma_\text{eff}}\big(\Phi(r)-\Phi(r_\text{cw})\big)\Big]
$$

- $E(r)$ — self-weight / counterweight taper factor at $r$
- $\rho$, $\sigma_\text{eff}$ — as above
- $\Phi(r)$ — effective potential (defined above)
- $r_\text{cw}$ — the counterweight's radial position

### Empty vs. full envelope

Tension is linear in cargo, so at each point the cable is sized to the worse of
two real operating states — empty (track only) or full (track + cargo):

$$
T_\text{full}(r) - T_\text{empty}(r) = \lambda_\text{cargo}\cdot C_1(r)
$$

- $T_\text{full}(r)$ — tension at $r$ with cargo present (loaded state)
- $T_\text{empty}(r)$ — tension at $r$ with no cargo (unloaded state)
- $\lambda_\text{cargo}$, $C_1(r)$ — as above

$C_1(r)$ starts at $0$ at the counterweight and changes sign once on the way down
to the surface: full governs wherever $C_1(r) > 0$, empty governs wherever
$C_1(r) < 0$. That crossover is a tension-balance threshold set by the equation
above — it is **not** the L1 point itself, and can sit much closer to the surface
than L1 does (for the calculator's default inputs, ~3,000 km altitude vs. L1's
~56,000 km altitude).

### Minimum counterweight

The surface hold-down tension is the net outward force suspending the whole
structure (counterweight + cable + cargo):

$$
T_\text{surf} = M_\text{cw}\,g(r_\text{cw})\,E(R_\text{moon}) + (\lambda_\text{min}+\lambda_\text{cargo})\,C_1(R_\text{moon}) + \lambda_\text{grav}\,C_g(R_\text{moon})
$$

- $T_\text{surf}$ — tension at the Moon's surface: the load the anchor must hold down
- $M_\text{cw}$ — counterweight mass
- $g(r_\text{cw})$, $E(R_\text{moon})$ — as above, evaluated at the counterweight and at the surface respectively
- $\lambda_\text{min}$ — the track's minimum (always-on) gauge, mass per length
- $\lambda_\text{cargo}$, $C_1(R_\text{moon})$ — as above, evaluated at the surface
- $\lambda_\text{grav}$ — the track's gravity-scaled reinforcement coefficient
- $C_g(R_\text{moon})$ — as above, evaluated at the surface
- $R_\text{moon}$ — the Moon's radius (the surface anchor's position)

The full-load case drives the floor (adding cargo lowers $T_\text{surf}$ near the
surface — see the envelope above). Setting $T_\text{surf}=0$ there gives the
minimum counterweight:

$$
M_\text{cw,min} = \frac{-\big[(\lambda_\text{min}+\lambda_\text{cargo})\,C_1(R_\text{moon}) + \lambda_\text{grav}\,C_g(R_\text{moon})\big]}{g(r_\text{cw})\,E(R_\text{moon})}
$$

- $M_\text{cw,min}$ — the smallest counterweight mass for which $T_\text{surf} \ge 0$
- all other symbols — same as in $T_\text{surf}$ above, evaluated at the Moon's surface

Below this mass the net effective force points toward the Moon; a surface anchor
can hold the cable down but not up, so the whole elevator sinks and crashes onto
the Moon. Hence the two-step UI: fix structure + traffic first (which fixes the
minimum), then choose a counterweight at or above it.

### Other fields

The same tether serves the standard elevator and the L2 one; only the field
changes, with $r$ measured from the anchoring body's centre and $g$ positive
away from it. A standard elevator on a body turning at $\omega$:

$$
g(r) = \omega^2 r - \frac{GM}{r^2}, \qquad \Phi(r) = -\frac{GM}{r} - \tfrac12 \omega^2 r^2
$$

- $GM$ — the body's gravitational parameter
- $\omega$ — its rotation rate; $g = 0$ at synchronous orbit

The L2 elevator, from the far side, away from Earth:

$$
g(r) = -\frac{GM_m}{r^2} - \frac{GM_e}{(D+r)^2} + \omega^2 (r + x_b), \qquad
\Phi(r) = -\frac{GM_m}{r} - \frac{GM_e}{D+r} - \tfrac12\omega^2 (r + x_b)^2
$$

- symbols as for L1; $g = 0$ at L2

In all three, $g$ rises steadily with $r$, so a felt force names one point on
each side of the balance point.

### Stations and the multiple

A station of mass $m_s$ at $r_s$ is a point load. It adds to the tension
everywhere between the surface and itself:

$$
\Delta T_s(r) = m_s\, g(r_s)\, \exp\!\Big[\tfrac{\rho}{\sigma_\text{eff}}\big(\Phi(r) - \Phi(r_s)\big)\Big] \qquad (R_\text{moon} < r < r_s)
$$

- $\Delta T_s(r)$ — the station's share of the tension at $r$
- $m_s$, $r_s$ — its mass and position
- $g(r_s)$ — its felt force, signed: positive (outward) beyond the balance
  point, where it helps hold the structure up; negative inside it, where it
  hangs on the cable
- $\rho$, $\sigma_\text{eff}$, $\Phi$ — as above

Every load's pull at the surface anchor has this form, $P = F\,w$ with
$w = \exp[\tfrac{\rho}{\sigma_\text{eff}}(\Phi(R_\text{moon}) - \Phi(r))]$:

- counterweight: $P_\text{cw} = M_\text{cw}\, g(r_\text{cw})\, E(R_\text{moon})$
- track: $P_\text{track} = (\lambda_\text{min} + \lambda_\text{cargo})\,C_1(R_\text{moon}) + \lambda_\text{grav}\,C_g(R_\text{moon})$
- station: $P_s = m_s\, g(r_s)\, w(r_s)$

The surface tension is their sum. The **multiple** compares the two sides:

$$
\mu = \frac{\sum P_\text{up}}{\left|\sum P_\text{down}\right|}
$$

- $\mu$ — the multiple the card shows
- $P_\text{up}$ — the pulls that are positive (the counterweight, stations
  beyond the balance point)
- $P_\text{down}$ — the pulls that are negative (the track, counted as one net
  load; stations inside the balance point)

Tension is least either at the surface or at the counterweight, so
$\mu \ge 1$ means the cable is taut everywhere. With no stations,
$\mu = M_\text{cw}/M_\text{cw,min}$. The counterweight that reaches a multiple
$\mu^*$ is

$$
M_\text{cw} = \frac{\mu^* \left|\sum P_\text{down}\right| - \sum_\text{stations} P_\text{up}}{g(r_\text{cw})\, E(R_\text{moon})}
$$

- $\mu^*$ — the target multiple (1.5 on the workbench, the floor)
- other symbols — as above

Holding the multiple fixed, a station inside the balance point raises the
counterweight and so thickens the cable above it; a station beyond the
balance point lowers it.

## In the workbench

`l1ElevatorBench.js` puts the model on the home page's Architecture tab, on
the calculator shell, for L1 (`side: "L1"`) or L2 (`side: "L2"`). The
Earth–Moon system comes from `Shared/orbit.js` (barycentre from the two GMs,
rotation by Kepler's law, the Lagrange point where $g(r)=0$).

- **Inputs:** Tether materials (the shared card; mature CNT ×3), and
  Counterweight & stations (`Shared/counterweight-card.js`, shared with the
  standard elevator):
  - **Counterweight distance** from the Moon's centre (default 222,100 km for
    L1, 100,000 km for L2).
  - **Counterweight mass** in kilotonnes. Empty, it takes the mass for 3×.
    Below 1.5× it is raised to 1.5×, and the card says so; below 3× a small
    warning stays.
  - **Multiple** — $\mu$ above.
  - **Stations** — up to three: one on the Moon side of the Lagrange point,
    two beyond it, one at it. "Create station" asks for the side, then an
    altitude or a felt force (the net acceleration there, toward the Moon on
    the inner side, toward Earth or away from the Moon on the outer), each
    with its range; then the station takes a mass. A station at the
    Lagrange point feels no force and changes nothing here.
- **Results:** Cable properties, Forces, Orbit after release.
- **No cargo yet.** The cable carries its track (the original example's
  default gauges) and the stations, but no cargo; the 1.5× floor and the 3×
  advice leave room for it until traffic is modelled on the Logistics and
  Engineering tabs.
- **Orbit after release** is the natural two-body orbit about Earth of a
  vessel let go at the counterweight. From L1 it moves below circular speed
  about Earth, so release is the apogee; the card gives the perigee and, when
  it lies below a 122 km interface, the entry angle and peak deceleration.
  From L2 it moves above circular speed, so release is the perigee; the card
  gives the apogee, or the hyperbolic excess speed when it escapes Earth
  (beyond about 99,000 km from the Moon). The Moon's pull is left out.
