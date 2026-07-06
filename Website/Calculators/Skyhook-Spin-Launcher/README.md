# Skyhook + Tip Spin-Launcher Calculator

A variant of the Gravity-gradient Skyhook calculator that adds a **counter-rotating
spin launcher at the launch deck** for the outbound leg (e.g. Moon → Ceres). It
keeps everything the original tool does (geometry, velocities, taper, mass,
climber energy, throughput, VASIMR station-keeping, Earth-reentry) and adds a
section that sizes the spin launcher needed to reach a target heliocentric
apoapsis when the skyhook is deliberately shortened.

## Files

- `skyhookSpinLauncher.html` — page markup
- `skyhookSpinLauncher.css` — page styling
- `skyhookSpinLauncher.js` — calculator logic (self-contained `skyhookTool`)

## Dependencies

Loads `../../Shared/orbit.js`, `../../Shared/math-utils.js`, and
`../../Shared/constants.js`. **Breaks if moved without `Website/Shared/`.** The
spin-launcher maths reuse the shared `OrbitalMath.planeChangeComponent /
spinReleaseSpeed / spinTipAccel / spinArmLength / spinRate / spinPlaneTilt /
spinTaperRatio` helpers.

## What the spin-launcher section does

You set a **target heliocentric apoapsis** (AU) and a **plane-change angle**. The
tool inverts the Moon→Earth→Sun escape chain:

$$
v = \sqrt{GM_\odot\left(\frac{2}{r_\text{parent}} - \frac{1}{a_\text{transfer}}\right)} \qquad a_\text{transfer} = \tfrac{1}{2}(r_\text{parent} + r_\text{apo})
$$

- $v$ — heliocentric speed needed at the parent body's distance
- $GM_\odot$ — the Sun's gravitational parameter
- $r_\text{parent}$ — the parent body's (Moon's) heliocentric distance
- $a_\text{transfer}$ — the transfer orbit's semi-major axis
- $r_\text{apo}$ — the target heliocentric apoapsis (the destination's distance, e.g. Ceres)

That speed is then chained down through the parent bodies:

1. $v_{\infty,\text{Earth}} = v - V_\text{parent}$ — excess speed needed at Earth ($V_\text{parent}$ = the Moon's heliocentric speed)
2. $v_\text{Earth-rel} = \sqrt{v_{\infty,\text{Earth}}^2 + 2\cdot GM_\text{Earth}/a_\text{moon}}$ — Earth-relative speed at lunar distance
3. $v_{\infty,\text{Moon}} = v_\text{Earth-rel} - V_\text{Moon}$ — excess speed from the Moon (released prograde, the Moon's motion helps)
4. $v_\text{deck} = \sqrt{v_{\infty,\text{Moon}}^2 + 2\cdot GM_\text{Moon}/r_\text{deck}}$ — required launch-deck speed

The skyhook supplies its natural launch-deck speed; the spin launcher's **prograde
boost** is the remainder. The **plane change** adds an out-of-plane component

$$
v_\perp = v_\text{helio}\cdot\tan(\Delta i)
$$

- $v_\perp$ — out-of-plane velocity component
- $v_\text{helio}$ — the heliocentric departure speed being tilted
- $\Delta i$ — the plane-change angle

so the required tip speed is $\sqrt{v_\text{boost}^2 + v_\perp^2}$. From
there the arm is sized exactly as in the Ceres elevator tool (length ↔ tip g,
taper, mass, energy, power, angular momentum, gyro torque, recoil, timing).

Two equal counter-rotating arms are assumed (one ship, one counter-mass), so net
angular momentum ≈ 0.

## Note

Reaching Ceres from a small Moon skyhook is demanding (≈5.8 km/s launch-deck
speed needed), so a short skyhook forces a large spin launcher (tens to a couple
hundred km of arm). Raising the skyhook's top/launch-deck altitude cuts the
launcher's share — which is the tradeoff this tool is for.
