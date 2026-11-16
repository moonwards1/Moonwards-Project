# Off-equator Mars Elevator

A single tether from an anchor well off Mars's equator (the Olympus Mons
summit by default, 18.65°N, 21.9 km above the areoid), bowing toward the
equatorial plane and running out past areostationary orbit to a
counterweight. It stays a few hundred km off the plane all the way out, so
it passes above Phobos's slightly tilted orbit. Deimos's orbit is tilted
more: either the counterweight stops inside Deimos's orbit, or the tether
dodges Deimos with a north–south swing built up by timing climber traffic.

The workbench shows it as Mars's one space-elevator form (the `*` in the
design grid); an equatorial elevator at Mars stays blocked.

## Files

- `marsElevatorModel.js`: what is Mars's own, pure (no DOM): the Mars system's
  figures, the anchor, Phobos's reach from the plane, Deimos's passes and
  dodges, the swing scaled to dodge size, pumping, the backup thrusters, the
  westward lean, and the orbit after release
- `marsElevatorModel.test.js`: Node test pinning the two design studies the
  cards were built from:
  `node --test Website/Calculators/Mars-Elevator/marsElevatorModel.test.js`
- `marsElevatorBench.js`: the home workbench's cards,
  `mountMarsElevator(root, opts)` (see "In the workbench" below)

The tether itself is `Shared/meridian-tether.js`, tested in
`Shared/tests/meridian-tether.test.js`.

## Dependencies

**Not self-contained.** It loads from `Website/Shared/`:

- `../../Shared/meridian-tether.js` (the tether and its swings)
- `../../Shared/orbit.js` (Mars, Phobos and Deimos), `body-profiles.js`
  (Phobos's tilt), `math-utils.js` (`OrbitalMath`), `constants.js`
- the workbench cards also use `calc-shell.js` / `calc-shell.css`,
  `material-card.js`, `materials.js` and `counterweight-card.js`

Moving this folder without `Website/Shared/` coming along will break it.

## Model

### Force field

The tether lies in one meridian plane, which turns with Mars. Write $x$ for
distance from the spin axis and $z$ for height above the equatorial plane,
with $r = \sqrt{x^2 + z^2}$. The potential per kg is

$$
\Phi(x, z) = -\frac{GM}{r} + \frac{GM J_2 R_e^2}{2 r^3}\left(\frac{3 z^2}{r^2} - 1\right) - \tfrac12 \omega^2 x^2
$$

- $\Phi$: gravity-plus-spin potential per kg
- $GM$: Mars's gravitational parameter
- $J_2$: Mars's oblateness coefficient, $1.960\times10^{-3}$
- $R_e$: its reference radius, 3,396.2 km
- $\omega$: Mars's spin rate
- $x$, $z$, $r$: as above ($z/r$ is the sine of the latitude)

and the net force per kg is $\mathbf f = -\nabla\Phi$. Areostationary orbit,
where $\mathbf f$ vanishes on the plane, comes out at 20,428.2 km.

### The tether's shape and tension

A piece of tether of length $ds$ is held by the tension at its two ends and
pulled by the field:

$$
\frac{d(T\,\hat{\mathbf t})}{ds} + \lambda\,\mathbf f = 0, \qquad \lambda = \frac{\rho}{\sigma_\text{eff}}\,T + \lambda_\text{track}
$$

- $T$: tension
- $\hat{\mathbf t}$: unit tangent, pointing out along the tether
- $\lambda$: mass per metre: the cable, whose cross-section is $T/\sigma_\text{eff}$ everywhere, plus the track
- $\rho$: cable density
- $\sigma_\text{eff}$: working strength (strength ÷ safety factor)
- $\lambda_\text{track} = \lambda_\text{min} + \lambda_\text{grav}\,|\mathbf f|/|\mathbf f_\text{anchor}|$: the track, 0.4 kg/m everywhere plus 1.2 kg/m at the anchor thinning with local gravity (the other workbench elevators' gauges)

Along the tether this splits into a tension equation and a bending equation:

$$
\frac{dT}{ds} = -\lambda\,\mathbf f\cdot\hat{\mathbf t}, \qquad T\,\frac{d\hat{\mathbf t}}{ds} = -\lambda\,\mathbf f_\perp
$$

- $\mathbf f\cdot\hat{\mathbf t}$: the pull along the tether (negative below the balance point, where it points down toward Mars)
- $\mathbf f_\perp$: the pull across it, which bends it

For the bare cable ($\lambda_\text{track} = 0$) the tension equation integrates
straight away: $\lambda/T = \rho/\sigma_\text{eff}$, so

$$
\frac{T(s)}{T_0} = \exp\!\Big[\frac{\rho}{\sigma_\text{eff}}\big(\Phi(s) - \Phi_\text{anchor}\big)\Big]
$$

- $T_0$: the hold-down tension at the anchor
- $\Phi(s)$: the potential at that point of the tether

The taper depends on the potential alone, wherever the path goes. The bending
equation becomes $d\hat{\mathbf t}/ds = -(\rho/\sigma_\text{eff})\,\mathbf f_\perp$, which
doesn't involve $T$ at all, so the bare cable's shape doesn't depend on the
hold-down either. The track adds weight that the tension doesn't scale with,
so with a track the shape does depend on it: the lighter the counterweight,
the less tension at the bottom, and the more the track bends the tether down
toward the equator there.

### Solving it

The counterweight hangs on the tether's line, so at the tip
$T\,\hat{\mathbf t} = M\,\mathbf f$: the tether points along the counterweight's
net pull. Integrating downward from the counterweight (RK4) with a counterweight of mass $M$ at
distance $r_c$ from Mars's centre, the only unknown is its height $z_c$
above the plane. It is shot for (false position) so the tether meets the
anchor's sphere at the anchor's latitude. Too far off the plane and the tether
swings over the pole instead of landing, so the search steps out from the plane.

A station of mass $m_s$ at distance $r_s$ from Mars's centre is a point load where
the tether passes that distance: going down, the tension vector gains
$m_s\,\mathbf f$ there, putting a small kink in the tether.

### Pulls and the multiple

Along a solved path the tension equation is linear in the loads, so the
hold-down splits into each load's pull at the anchor, as for the radial
elevators (`Calculators/Moon-L1-Elevator/README.md`):

$$
T_0 = M\,|\mathbf f_c|\,w_c + \int \lambda_\text{track}\,(\mathbf f\cdot\hat{\mathbf t})\,w\,ds + \sum_s m_s\,(\mathbf f\cdot\hat{\mathbf t})_s\,w_s,
\qquad w = \exp\!\Big[\frac{\rho}{\sigma_\text{eff}}\big(\Phi_\text{anchor} - \Phi\big)\Big]
$$

- $\mathbf f_c$, $w_c$: the net pull and the weight factor at the counterweight
- $w$: how much of a load's pull reaches the anchor through the tapering cable

The multiple is the sum of the positive pulls ÷ the sum of the negative ones, as
on the other elevators: below 1.5× the counterweight is raised to reach it.
There is a second floor of the tether's own: it must leave the anchor at least
10° above horizontal, and a counterweight too light to manage that is raised
until it does, with the card saying so. At the 51,000 km default with the
track aboard, 3× is enough; at 22,820 km it takes about 2.5×.

### Moons

Phobos's worst case is its apoapsis times the sine of its 1.08° tilt, plus its
radius: 191 km from the plane. The tether must be farther off the plane than
that where it passes Phobos's radius.

Deimos, at a radius $a_D$ with tilt $i$ to the equator, reaches
$Z = a_D \sin i$ from the plane. If the counterweight sits inside Deimos's orbit,
Deimos never meets the tether. Otherwise it crosses the tether's line once
every

$$
t_\text{pass} = \frac{1}{1/P_\text{Mars} - 1/P_D} \approx 131.2\ \text{h}
$$

- $P_\text{Mars}$: Mars's sidereal day
- $P_D$: Deimos's orbital period

at $\omega a_D - \sqrt{GM/a_D} \approx 312$ m/s. Its height at each crossing is
$Z\sin u$, $u$ being where along its orbit it is; over many passes $u$ is spread
evenly, so the chance that its path falls within a band of width $w$ around
the tether's height $z_t$ is

$$
P \approx \frac{w}{\pi\sqrt{Z^2 - z_t^2}}
$$

- $P$: chance per pass that a dodge is needed
- $w$: the trigger band (100 km: dodge when the predicted miss is under 50 km)
- $Z$, $z_t$: as above

and zero when $Z \le z_t$. Each pass Deimos is about 118° further along its
orbit, so every third pass it is back near the same $u$, $\delta u \approx 5.6°$
on. The hazard passes in a row number about $w / (\sqrt{Z^2 - z_t^2}\,\delta u)$, 16.4 days
apart; clusters a year = dodges a year ÷ that.

### The north–south swing

A swing across the tether, in its own plane ($\eta$ along
$\hat{\mathbf n}$, the tangent turned 90° toward its north side), obeys

$$
\lambda\,\ddot\eta = \frac{\partial}{\partial s}\!\left(T\,\frac{\partial\eta}{\partial s}\right) + \lambda K\,\eta, \qquad K = \hat{\mathbf n}\cdot\frac{\partial\mathbf f}{\partial \hat{\mathbf n}}
$$

- $\eta(s)$: the swing's displacement
- $K$: how the field changes across the tether; where the tether runs near the plane, $\hat{\mathbf n}$ points north–south and $K \approx -GM/r^3$

with $\eta = 0$ at the anchor and the counterweight a point mass
($M\ddot\eta = -T\,\partial\eta/\partial s + MK\eta$). The equation is cut into
pieces at least 5 km long, lumped masses at the joints, and the lowest few
periods found (Sturm bisection, then inverse iteration for the shapes).

For a rigid tilt about Mars's centre, $\eta = \theta r$, the tension term and $K$
together give exactly $\ddot\eta = -\omega^2\eta$. Tilting the whole tether is
tilting an orbit, so its period is one sidereal day whatever the tension; the
anchor, fixed at the surface, makes it a little shorter. North–south motion
feels no Coriolis force (it runs along the spin axis), so this swing stays
separate from the east–west sway; motion of the tilted bottom few hundred km
toward and away from the spin axis is left out.

Each swing is scaled to the dodge size at Deimos's radius. Its energy is

$$
E = \tfrac12\,\Omega^2 \sum_i m_i\,\eta_i^2
$$

- $\Omega$: the swing's angular frequency
- $m_i$, $\eta_i$: the lumped masses and the swing at each

For the default design in the dodge study: 24.4, 10.0 and 5.6 h; the slowest,
at 60 km at Deimos's radius, moves the tether 22 km at Phobos's radius and 134
km at the counterweight, and holds 12.4 GJ.

### Pumping with climber traffic

Cargo on a slanted stretch low down pulls partly across the tether, with
$f_n$ per kg. A load varying by $\Delta m$ in step with a swing of size $\eta$
there does work

$$
W = \pi\,\Delta m\,f_n\,\eta
$$

per cycle, averaged over the stretch. The swing grows by the same amount each
cycle, so building it to energy $E$ over $N$ cycles takes

$$
\Delta m = \frac{2E}{N\,\pi\,\langle f_n\,\eta\rangle}
$$

- $N$: cycles to build the swing up
- $\langle f_n\,\eta\rangle$: averaged over the stretch's length

Simply loading the stretch for half of each cycle and leaving it empty for the
other half delivers $2/\pi$ of that, so it takes $\pi/2$ times more. The cargo
on the stretch is the flow times the time spent crossing it,
$m = \dot m\,L/v$, so slowing or pausing climbers there in the "on" half
holds the load with far less flow than bunching departures.

### Backup thrusters

Thrusters on the counterweight can do the same job. An impulse $J$ at the
counterweight gives the swing its full size when

$$
J = \frac{\Omega \sum_i m_i\,\eta_i^2}{\eta_c}
$$

- $\eta_c$: the swing at the counterweight

Thrusting steadily, on and off in step with the swing, takes $4/\pi$ of that;
the card shows that figure and the propellant at 8 and 50 km/s exhaust.

### Westward lean

Cargo going up is spun up to the tether's speed: each kg released from the
counterweight carries $\omega r_c^2$ of angular momentum, which Mars supplies
through the anchor. The tether leans west where it leaves the anchor until the
sideways part of the hold-down supplies it:

$$
\theta \approx \frac{\dot m\,\omega\,r_c^2}{T_0\,R\cos\varphi}
$$

- $\theta$: the westward lean at the anchor
- $\dot m$: cargo released from the counterweight
- $r_c$: the counterweight's distance from Mars's centre
- $T_0$: the hold-down
- $R\cos\varphi$: the anchor's distance from the spin axis

### Orbit after release

A vessel let go at the counterweight moves east at $\omega r_c$, above
circular speed there, so release is the periapsis of its orbit about Mars,
or it escapes if $\omega r_c > \sqrt{2GM/r_c}$ (from about 25,700 km out).
The counterweight's small height off the plane is left out.

## In the workbench

`marsElevatorBench.js` puts the model on the home page's Architecture tab, on
the calculator shell.

- **Inputs:** Anchor (latitude and height above the areoid, default the
  Olympus Mons summit); Tether materials (the shared card, early CNT ×2.5);
  Counterweight & stations (`Shared/counterweight-card.js`; default 51,000 km
  from Mars's centre, station altitudes measured above the anchor's distance
  from the centre); Deimos dodge (Deimos's tilt, the trigger band, the dodge
  swing); Climber traffic (the pumping stretch, build-up cycles, climber
  speeds, the cargo flow for the lean).
- **Results:** Cable properties, Forces, Path and the moons, Orbit after
  release, Deimos passes, North–south swing, Pumping with climber traffic,
  Westward lean.
- **No cargo yet.** As on the other workbench elevators, the cable carries its
  track and stations but no cargo; the multiple leaves room for it.
- **The two studies.** Run bare (no track, 10 MN hold-down) the model gives the
  studies' figures, which the Node test pins. Beyond Deimos (51,000 km): 38°
  departure, 119 kt counterweight, 485 kt tether, taper 6.68, 370 km off the
  plane at Phobos's radius and 291 km at Deimos's. Below Deimos (22,820 km):
  2,043 kt counterweight, 206 kt tether, 305 km at Phobos's radius. With the
  track, the defaults leave the anchor lower (about 17°) and pass Phobos
  closer (about 100 km clear), because the track's weight bends the bottom of
  the tether down.
