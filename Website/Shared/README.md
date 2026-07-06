# Website/Shared — shared libraries for the calculators

All calculators in `Website/Calculators/<name>/` draw on these shared files.
They are **ES modules** with named exports; each calculator's page script is a
`<script type="module">` that imports what it needs. Because ES modules do not
load over `file://`, pages are always viewed over http(s) — the deployed site
(<https://moonwards1.github.io/Moonwards-Project/>) or a local server
(`serve.bat` at the repo root). The pure modules import directly in Node for
unit testing.

## Modules

| File | Named exports | Purpose |
|------|---------------|---------|
| `orbit.js` | `systems` (+ `System`, `Orbit`, `Vector`, `Time`, `Transfer`, `Atmosphere`, `Geology`, `constants`) | Planetary-system data: `systems` is a `Map` of bodies (`GM`, `radius`, `orbit`, …), plus the orbit/system classes it is built from. |
| `lunar-ephemeris.js` | `LunarEphemeris` | Low-precision geocentric Moon position (Meeus Ch. 47, full tables 47.A/47.B): ecliptic `lon`/`lat`/`dist`, rectangular `moonVector`/`moonState` (km, km/s), plus the Sun's ecliptic longitude/direction (Meeus Ch. 25) for lighting. ~arcminute accuracy. |
| `constants.js` | `Const` | Physical/astronomical constants shared across tools: `G`, `g0`, `AU`, `GM_sun`, and a per-body `scaleHeight` table (earth/venus/titan/mars). (Body-specific data stays in `orbit.js`.) |
| `math-utils.js` | `OrbitalMath` | Pure orbital mechanics — circular/escape/vis-viva speed, hyperbolic excess, specific energy, period, angular velocity, synchronous-orbit radius, synodic period, apsis↔element conversions, Hohmann transfer, sphere of influence, Hill radius, Tsiolkovsky, the tether taper integral/ratio, the Allen–Eggers entry peak-deceleration, point-to-orbit-ring distance (`distanceToOrbit`, via the robust point-to-ellipse primitive `distancePointEllipse`), and Lambert's problem (`lambert`, zero-rev universal-variable transfer solver). |
| `format-utils.js` | `Fmt` (+ legacy `fmtForce`, `fmtMass`, `myRound`, …) | Number/unit formatting: force, torque, mass, power, time, truncating round, sig-figs. Prefer `Fmt.*`; the bare legacy names are named exports kept for older code. |
| `ui-components.js` | `create` | DOM builder used to assemble tool UIs. |
| `animation.js` | `SkyAnim` | SVG reveal / viewBox-tween helpers. |
| `three.min.js` | *(none — classic script)* | Vendored Three.js. **The one exception to the ESM convention:** loaded with a plain `<script src>` tag before the page module; provides the global `THREE`. |

## Using them in a calculator

Give the page one module script (head or end of body — module scripts are
deferred either way), and import what you need at the top of it:

```html
<script type="module" src="myCalc.js"></script>
```

```js
import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Fmt } from "../../Shared/format-utils.js";

var moon = systems.get("Moon");
var v = OrbitalMath.circularVelocity(moon.GM, moon.radius + 100e3);
out.textContent = "Speed: " + Fmt.round(v, 1) + " m/s";
```

A tool that uses Three.js additionally keeps one classic tag ahead of its
module (see the trajectory plotters):

```html
<script src="../../Shared/three.min.js"></script>
<script type="module" src="myPlotter.js"></script>
```

**A calculator that imports anything from here breaks if its folder is moved
without `Website/Shared/` coming along.** Note that in the calculator's README.

## Adding a new calculator

Copy `Calculators/_template/` to `Calculators/<YourCalc>/`, rename the three
`template.*` files to match, and build on the shared utilities. That template is
the canonical example of the standard wiring.

## Testing

The repo root's `package.json` sets `"type": "module"`, so the pure modules
(`math-utils.js`, `format-utils.js`, `constants.js`, `lunar-ephemeris.js`,
`orbit.js`) import directly in Node:

```js
import { OrbitalMath as M } from "./math-utils.js";
console.assert(Math.abs(M.circularVelocity(3.986e14, 6678e3) - 7726) < 1);
```

(If you copy files elsewhere to test them, put a `{"type":"module"}`
`package.json` next to them, or Node will parse `.js` as CommonJS and choke on
`import`.)

DOM behaviour can't be exercised with jsdom the old way — jsdom does not run
`<script type="module">` — so page-level checks happen in a real browser,
against `serve.bat` or the deployed site.

## Conventions

- **ES modules, named exports** — `import { X } from "…"`, no default exports,
  no globals. `three.min.js` (global `THREE`) is the sole exception. Module
  code runs in strict mode: declare every variable.
- **Pure logic stays pure** — orbital maths and formatting take plain numbers
  and return numbers/strings (no DOM), so they stay Node-testable.
- **One responsibility per file** — data (`orbit.js`), maths (`math-utils.js`),
  formatting (`format-utils.js`), DOM (`ui-components.js`), animation
  (`animation.js`).
