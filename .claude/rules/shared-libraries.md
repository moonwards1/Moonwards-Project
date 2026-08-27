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
| `math-utils.js` | `OrbitalMath` | pure orbital mechanics — circular/escape/vis-viva speed, hyperbolic excess, period, Hohmann, SOI, Hill radius, synodic period, Tsiolkovsky, tether taper integral/ratio, … |
| `format-utils.js` | `Fmt` (plus legacy aliases `fmtForce`, `myRound`, … as named exports) | number/unit formatting |
| `ui-components.js` | `create` | the DOM builder |
| `animation.js` | `SkyAnim` | SVG reveal / viewBox-tween helpers |
| `frames.js` | `Frames` | converts ship-state VECTORS between frames (not to be confused with MissionPlanner's `scene-frames.js`, which builds renderable scenes) |
| `exchange.js` / `exchange-types.js` | `Exchange` / `PacketTypes` | the calculator-to-calculator mailbox and its versioned payload registry |
| `three.min.js` | global `THREE` | **the one classic-script exception** — vendored, loaded with a plain `<script src>` tag ahead of the page module |

`Shared/sim/` holds the scene kit shared by the plotters: `camera-controller.js`,
`date-bar.js`, `body-renderer.js`, `orbit-rings.js`, `approach-markers.js`,
`burn-widget.js`, `readout-panes.js`, `marker-card.js`.

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
