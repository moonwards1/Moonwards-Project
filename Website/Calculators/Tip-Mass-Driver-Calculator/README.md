# Tip Mass Driver Calculator

Sizes a straight sled mass driver whose track is loaded only in tension — the
kind that could swivel at a skyhook tip. A reusable sled carries a drone cargo
ship from rest to release speed, the ship leaves at the hub, and the empty sled
brakes in a short section beyond the hub.

## Files

- `tipDriverCalc.html` — page markup
- `tipDriverCalc.css` — this calculator's own styling (identity colour, result rows, info pop-up); layout comes from the shared frame
- `tipDriverCalc.js` — page wiring: inputs, presets, results, info pop-ups
- `tipDriverModel.js` — the sizing model (pure, Node-importable)
- `tipDriverInfo.js` — the text and formulas shown in each result's info pop-up
- `tipDriverModel.test.js` — Node tests for the model:
  `node --test Website/Calculators/Tip-Mass-Driver-Calculator/tipDriverModel.test.js`

## Dependencies

Links `../../Shared/calc-frame.css` (the shared calculator layout: sections
reflow to the width of the column they sit in, from 400 px up). That
stylesheet is the only `Shared/` dependency; no scripts are imported. The info
pop-ups render their formulas with **KaTeX 0.16.11 from cdn.jsdelivr.net**
(stylesheet linked in the HTML, module imported on first use). Without network
access the calculator still works and the pop-ups show the TeX source instead.

## Model

The info pop-ups carry the full explanation of each result; this is the outline.

**Kinematics.** Moving mass $m = m_{ship} + m_s$. At constant acceleration
$a$, the track is $L = v^2/2a$ and the peak power $m a v$. With the power cap
$P$, acceleration holds at $a$ up to $v_c = P/(m a)$, then the run continues at
constant power:

$$
L = \frac{v_c^2}{2a} + \frac{m\,(v^3 - v_c^3)}{3P}
$$

**Spine.** Ships launch toward the hub and the sled brakes away from it, so the
track between sled and hub is always in tension and a CNT spine anchored at the
hub carries the drive reaction. Every section carries the starting force:

$$
M_{spine} = SF\,\frac{F_{max}\,L\,\rho}{\sigma}
$$

which at constant acceleration is $SF\cdot E/(\sigma/\rho)$.

**Guideway blade.** The sled's magnets straddle a central blade with windings
on both faces. The thrust shear, $q = F/\ell$ per metre of track, travels on
average $h/2$ to the spine at the blade root, through CNT diagonals (tension)
and cordierite posts (compression). A cordierite skin of fixed thickness backs
the windings.

**Windings.** Linear synchronous motor, aluminium sheet windings energised in
sled-length blocks. Shear $\tau_s = F/(n h \ell) = \tfrac12 B K$. Each block heats
adiabatically during its on-time $t_{on}$ from $T_0$ to $T_1$, which limits the
current density:

$$
J = \sqrt{G/t_{on}}, \qquad G = \int_{T_0}^{T_1} \frac{\rho_m c_p}{\rho_e}\,dT
$$

using a table of high-purity aluminium properties. To a good approximation the
winding mass is independent of acceleration and of the power cap:

$$
M_w \approx \frac{4\sqrt{2}}{3}\,\frac{\rho_m\,k_e\,m\,v^{3/2}}{B\,\sqrt{G\,\ell}}
$$

**Storage.** Thin-rim CNT flywheels, $e_{rim} = \sigma/(2\rho\,SF)$, discharged
from full speed to a fraction $r$ of it, holding $(E + Q)/\eta$.

**Power delivery.** One flywheel bank at the hub serves both sections: the
launch ends there and the sled's braking starts there. Generators follow the
windings' heating rule over the whole launch-and-brake duty, so the gap area
cancels:

$$
M_{gen} = k_s\,\frac{2\,\rho_m\,k_e\,\sqrt{\int P^2\,dt}}{B_g\,v_s\,\sqrt{G}}
$$

Converters, which match each block's frequency to the sled, are rated for the
larger of the launch and braking peak powers; their mass is that rating over a
specific power. Feeders carry $I = P/V$; the feeder at a point carries current
while the sled is beyond it, giving an adiabatic cross-section
$A = \sqrt{\int P^2 dt / G}\,/V$. The heat in generators and feeders is added to
the storage needed.

Banks spread along the track are not offered. With converters, their ratings add
up to many times the hub's. Without converters it can't work: a discharging
flywheel's frequency falls while the accelerating sled needs it to rise, and the
track's pole pitch can't be graded to compensate because it must match the
sled's fixed magnet spacing.

**Not included:** supports against the local field and Coriolis loads (they
depend on the mounting location), the sled, the hub and swivel, switchgear,
cooling, flywheel hubs and housings, and the tether mass that holds it all up
at a skyhook tip.
