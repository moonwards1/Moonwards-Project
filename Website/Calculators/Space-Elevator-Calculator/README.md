# Space Elevator Calculator

A cable from a rotating body's equator, past synchronous orbit, to a
counterweight at its tip.

## Files

- `spaceElevatorCalc.html` — page markup
- `spaceElevatorCalc.css` — this calculator's own styling; the layout comes from the shared frame
- `spaceElevatorCalc.js` — the standalone page: presets, fields, outputs and the draggable diagram
- `spaceElevatorModel.js` — the physics, pure (no DOM): `computeSpaceElevator`
  (synchronous orbit, taper, cable mass per kg of tip payload, tip release,
  orbit after release), `cableMassRatio`
- `spaceElevatorModel.test.js` — Node test pinning the page's Ceres defaults:
  `node --test Website/Calculators/Space-Elevator-Calculator/spaceElevatorModel.test.js`
- `spaceElevatorBench.js` — the home workbench's cards for a standard space
  elevator, `mountSpaceElevator(root, opts)`: Tether geometry and the shared
  Material card (mature CNT ×2) in; Orbital mechanics, Cable properties, Tip
  release and Orbit after release out, all on the Architecture tab. The body's
  GM, equatorial radius, rotation and distance from the Sun come from
  `Shared/orbit.js`.

## Dependencies

**Not self-contained.** The page uses `../../Shared/calc-frame.css` (layout),
`calc-about.js` (the "About this calculator" pop-up), `math-utils.js` and
`constants.js`; the workbench cards add `orbit.js`, `calc-shell.js` /
`calc-shell.css`, `material-card.js` and `materials.js`. The folder needs
`Website/Shared/` beside it.
