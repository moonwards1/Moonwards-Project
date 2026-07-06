# Website/Shared — shared libraries for the calculators

All calculators in `Website/Calculators/<name>/` draw on these shared files.
They are plain **classic scripts** (no ES modules) so every calculator keeps
working when opened directly from a `file://` link, and the pure ones are also
`require()`-able in Node for unit testing.

## Modules

| File | Global | Purpose |
|------|--------|---------|
| `orbit.js` | `systems` | Planetary-system data (a `Map` of bodies: `GM`, `radius`, `orbit`, …). |
| `lunar-ephemeris.js` | `LunarEphemeris` | Low-precision geocentric Moon position (Meeus Ch. 47, full tables 47.A/47.B): ecliptic `lon`/`lat`/`dist`, rectangular `moonVector`/`moonState` (km, km/s), plus the Sun's ecliptic longitude/direction (Meeus Ch. 25) for lighting. ~arcminute accuracy. |
| `constants.js` | `Const` | Physical/astronomical constants shared across tools: `G`, `g0`, `AU`, `GM_sun`, and a per-body `scaleHeight` table (earth/venus/titan/mars). (Body-specific data stays in `orbit.js`.) |
| `math-utils.js` | `OrbitalMath` | Pure orbital mechanics — circular/escape/vis-viva speed, hyperbolic excess, specific energy, period, angular velocity, synchronous-orbit radius, synodic period, apsis↔element conversions, Hohmann transfer, sphere of influence, Hill radius, Tsiolkovsky, the tether taper integral/ratio, the Allen–Eggers entry peak-deceleration, point-to-orbit-ring distance (`distanceToOrbit`, via the robust point-to-ellipse primitive `distancePointEllipse`), and Lambert's problem (`lambert`, zero-rev universal-variable transfer solver). |
| `format-utils.js` | `Fmt` (+ legacy `fmtForce`, `fmtMass`, `myRound`, …) | Number/unit formatting: force, torque, mass, power, time, truncating round, sig-figs. |
| `ui-components.js` | `create` | DOM builder used to assemble tool UIs. |
| `animation.js` | `SkyAnim` | SVG reveal / viewBox-tween helpers. |

## Using them in a calculator

Include the modules you need in `<head>` (before your own page script), via a
relative path, then load your script at the end of `<body>`:

```html
<script src="../../Shared/orbit.js"></script>
<script src="../../Shared/math-utils.js"></script>
<script src="../../Shared/format-utils.js"></script>
<script src="../../Shared/ui-components.js"></script>
...
<script src="myCalc.js"></script>
```

In code, prefer the namespaced APIs:

```js
var moon = systems.get("Moon");
var v = OrbitalMath.circularVelocity(moon.GM, moon.radius + 100e3);
out.textContent = "Speed: " + Fmt.round(v, 1) + " m/s";
```

**A calculator that loads anything from here breaks if its folder is moved
without `Website/Shared/` coming along.** Note that in the calculator's README.

## Adding a new calculator

Copy `Calculators/_template/` to `Calculators/<YourCalc>/`, rename the three
`template.*` files to match, and build on the shared utilities. That template is
the canonical example of the standard wiring.

## Testing

The pure modules export via `module.exports`, so they unit-test directly in Node:

```js
const M = require("./math-utils.js");
console.assert(Math.abs(M.circularVelocity(3.986e14, 6678e3) - 7726) < 1);
```

DOM and animation behaviour is best exercised with jsdom.

## Conventions

- **Classic scripts only** — no `import`/`export`, no `type="module"` (keeps
  `file://` use working). Each module wraps an IIFE and assigns its global.
- **Pure logic stays pure** — orbital maths and formatting take plain numbers
  and return numbers/strings (no DOM), so they stay testable.
- **One responsibility per file** — data (`orbit.js`), maths (`math-utils.js`),
  formatting (`format-utils.js`), DOM (`ui-components.js`), animation
  (`animation.js`).
