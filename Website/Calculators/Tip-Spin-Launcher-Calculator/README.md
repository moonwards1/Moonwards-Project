# Tip Spin-Launcher Calculator

A variant of the Space Elevator Calculator that adds a **counter-rotating spin
launcher at the elevator tip**. The elevator section is the same model as
`Space-Elevator-Calculator`; the spin-launcher section takes a chosen retrograde
boost and plane change (figured out in other trajectory tools) and sizes the
rotating arm that would deliver them.

## Files

- `spinLauncherCalc.html` — page markup
- `spinLauncherCalc.css` — page styling
- `spinLauncherCalc.js` — calculator logic

## Dependencies

Loads `../../Shared/math-utils.js` (`OrbitalMath`) and
`../../Shared/constants.js` (`Const`). **This folder breaks if moved without
`Website/Shared/` coming along.** The spin-launcher maths are the pure
`OrbitalMath.planeChangeComponent / spinReleaseSpeed / spinTipAccel /
spinArmLength / spinRate / spinPlaneTilt / spinTaperRatio` helpers, all
Node-testable.

## The design assumed

Two equal **counter-rotating** arms share one hub at the tip. One arm carries
the ship; the other carries an equal counter-mass. Because they spin in opposite
senses, the steady-state assembly is balanced (centre of mass fixed) and stores
almost no *net* angular momentum, so it exerts no net gyroscopic torque on the
elevator as the whole structure swings round once per rotation day. Each arm
still carries its own load; the outputs report both the per-arm figures and the
cancelled net.

## Inputs

Elevator: body parameters (radius, surface gravity, rotation period, axial tilt,
distance from Sun), cable material, and counterweight (tip) altitude — defaults
to Ceres at 20,000 km.

Spin launcher:

- **Retrograde boost to add** — in-plane velocity the arm adds (e.g. to restore
  the periapsis lost by shortening the elevator).
- **Plane-change angle** and **velocity being tilted (ref.)** — the out-of-plane
  component is $v_\text{ref}\times\tan(\Delta i)$. The reference is the heliocentric in-plane
  departure speed, taken from a transfer calculator.
- **Arm sizing** — choose to cap tip g and read the arm length, or set the arm
  length and read the tip g.
- **Max load at arm tip**, **counterweight / hub mass**, **launches per rotation
  day**, and an **arm material** block.

## Outputs

Required release (tip) speed and its out-of-plane part; arm length, spin rate,
rotation period, tip g, and required spin-plane tilt; arm taper ratio, tip
cross-section, arm and total structure mass, peak hub tension; energy to payload
per launch, stored spin (flywheel) energy, average spin-up power; angular
momentum per arm and net, per-arm gyroscopic torque, release recoil and the
counterweight velocity kick; and release-timing sensitivity plus the tumble
handed to the payload.

## Key relations

$$
v_\perp = v_\text{ref}\cdot\tan(\Delta i) \qquad v_\text{spin} = \sqrt{v_\text{retro}^2 + v_\perp^2} \qquad a = \frac{v_\text{spin}^2}{L} \;\leftrightarrow\; L = \frac{v_\text{spin}^2}{a}
$$

$$
\omega = \frac{v_\text{spin}}{L} \qquad \text{taper} = \exp\!\left(\frac{v_\text{spin}^2}{2\cdot\sigma_\text{eff}/\rho}\right) \qquad \text{tilt} = \arctan\!\left(\frac{v_\perp}{v_\text{retro}}\right) \qquad E = \tfrac{1}{2}\, m_\text{tip}\, v_\text{spin}^2
$$

- $v_\perp$ — out-of-plane velocity component added by the plane change
- $v_\text{ref}$ — reference in-plane heliocentric departure speed
- $\Delta i$ — plane-change angle
- $v_\text{spin}$ — required release (tip) speed
- $v_\text{retro}$ — in-plane retrograde boost
- $a$ — tip acceleration (sets crew/cargo g-limit)
- $L$ — arm length
- $\omega$ — arm's spin rate
- taper — hub/tip cross-section ratio; depends only on tip speed, not arm length
- $\sigma_\text{eff}$, $\rho$ — cable effective strength and density (as in the elevator model)
- tilt — required spin-plane tilt angle
- $E$ — energy delivered to the payload per launch
- $m_\text{tip}$ — payload mass at the tip
