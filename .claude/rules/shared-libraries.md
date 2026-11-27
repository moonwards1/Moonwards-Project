---
paths:
  - "Website/Shared/**"
---

# Shared/ — the common libraries

`Website/Shared/README.md` is the canonical description of these libraries and
their conventions. All are ES modules with **named exports**.

| Module | Exports | What it holds |
| ------ | ------- | ------------- |
| `orbit.js` | `systems` (a `Map` of bodies: `GM`, `radius`, `orbit`, …), plus `System`, `Orbit`, `Vector`, `Time`, `Transfer`, `Atmosphere`, `Geology`, `constants` | the planetary-system data |
| `body-profiles.js` | `BODY_PROFILES`, `CONDITIONS`, `applies`, `specialsAt`, `footFloor`, `anchorConfig`, … | what is special about each body: per-body figures, the conditions body-specific cards declare as `where`, moon-anchored configurations |
| `math-utils.js` | `OrbitalMath` | pure orbital mechanics — circular/escape/vis-viva speed, hyperbolic excess, period, Hohmann, SOI, Hill radius, synodic period, Tsiolkovsky, tether taper integral/ratio, … |
| `format-utils.js` | `Fmt` (plus legacy aliases `fmtForce`, `myRound`, … as named exports) | number/unit formatting |
| `date-format.js` | `dateYMD`, `dateYMDH`, `parseDateYMDH`, … | dates written and read year first, hour as h0–h23 |
| `ui-components.js` | `create` | the DOM builder |
| `calc-shell.css` / `calc-shell.js` | `CalcShell`, `ShellColors` | the three-column calculator page: cards, fields, result lines (see `rules/calculators.md`) |
| `zoom-view.js` | `ZoomView`, `svgEl`, plus pure `niceNumber`, `fitRect`, `viewBoxOf`, `zoomAbout` | the pan-and-zoom drawing panel of the calculator shell |
| `animation.js` | `SkyAnim` | SVG reveal / viewBox-tween helpers |
| `kinematic-chain.js` / `lagrange-elevator.js` | `evaluateChain`, `lineElement`, … / `lagrangeLineAt`, `lineElementFor`, … | a departure platform stack composed into a release state; the L1/L2 elevators' kinematics, used by the traffic plotter and the planner's elevator platform |
| `radial-tether.js` | `standardField`, `earthMoonField`, `tetherContext`, `tetherMetrics`, `pullBalance`, `counterweightFor`, … | the tether sizing the radial space elevators on the workbench share (standard, L1, L2), stations included |
| `mars-elevator.js` | `elevatorShape`, `elevatorAt`, `pointAt`, … | the off-equator Mars elevator's shape, lean and Phobos check, and its points on the clock; used by the Mars traffic plotter (which adds the Deimos dodges) and the planner's space elevator platform |
| `meridian-tether.js` | `oblateField`, `solveMeridianTether`, `heightAtRadius`, `northSouthModes`, … | a tether anchored off a spinning body's equator, bowing toward the equatorial plane (the off-equator Mars elevator): shape, tensions, pulls, north–south swings |
| `material-card.js` / `counterweight-card.js` | `addMaterialCard` / `addCounterweightCard` | the tether calculators' shared cards |
| `mars-ephemeris.js` | `MarsEphemeris` | the Mars system on a clock: Mars's orientation, Phobos and Deimos, the Sun, Mars-centred |
| `frames.js` | `Frames` | converts ship-state VECTORS between frames (not to be confused with MissionPlanner's `scene-frames.js`, which builds renderable scenes) |
| `exchange.js` / `exchange-types.js` | `Exchange` / `PacketTypes` | the calculator-to-calculator mailbox and its versioned payload registry |
| `lore-markdown.js` / `lore.js` | `parseLore`, `renderMarkdown` / `initLore`, `loreMark`, `loreHTML`, … | the info tiers and Lore entries (`Website/Lore/entries.md`): parsing, rendering, tooltips, dialogs, nested expansion |
| `flight-save.js` | `packFlight`, `unpackFlights`, `fragmentFromText`, … | the traffic plotters' saved-flight envelope and list, and pasted-link cleanup |
| `three.min.js` | global `THREE` | **the one classic-script exception** — vendored, loaded with a plain `<script src>` tag ahead of the page module |

`Shared/sim/` holds the scene kit shared by the plotters: `camera-controller.js`,
`date-bar.js`, `body-renderer.js`, `orbit-rings.js`, `approach-markers.js`,
`burn-widget.js`, `readout-panes.js`, `marker-card.js`, `flight-clock.js`,
`save-panel.js`, `screen-line.js`.

## Rules

- **New orbital-mechanics maths goes in `math-utils.js` with a Node test** —
  never inlined in a calculator or a planner module.
- **Keep pure logic pure.** Maths and formatting take and return plain values,
  no DOM, so they stay Node-testable.
- Prefer the namespaced APIs (`OrbitalMath.*`, `Fmt.*`) in new code.
- A change here has many callers. Grep for them before altering a signature —
  the plotters, the calculators and the Mission Planner all import from here.

## Testing

Test pure logic **directly in Node** with `import` — no DOM, no jsdom. This is
the fastest and most reliable check and is the default for orbital mechanics.
The repo root's `package.json` sets `"type": "module"`; when snapshotting files
elsewhere to test, drop a `{"type":"module"}` `package.json` beside them or
Node parses `.js` as CommonJS and rejects `import`.

`node --check` catches syntax errors. `eslint` with `no-undef`, a browser env
and `THREE` as a global catches strict-mode hazards — undeclared variables that
only explode at runtime.
