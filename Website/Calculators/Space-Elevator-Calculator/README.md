# Space Elevator Calculator

A cable from a rotating body's equator, past synchronous orbit, to a
counterweight at its tip.

## Files

- `spaceElevatorModel.js` — the orbital figures, pure (no DOM):
  `computeSpaceElevator` (synchronous orbit, tip, tip release, orbit after
  release)
- `spaceElevatorModel.test.js` — Node test pinning the original Ceres defaults:
  `node --test Website/Calculators/Space-Elevator-Calculator/spaceElevatorModel.test.js`
- `spaceElevatorBench.js` — the home workbench's cards for a standard space
  elevator, `mountSpaceElevator(root, opts)`, all on the Architecture tab:
  Counterweight & stations and the shared Tether materials card (mature CNT
  ×2) in; Orbital mechanics, Cable properties, Forces, Tip release and Orbit
  after release out. The body's GM, equatorial radius, rotation and distance
  from the Sun come from `Shared/orbit.js`.

The cable is sized by `Shared/radial-tether.js` in the field
$g(r) = \omega^2 r - GM/r^2$, with the Moon–L1 elevator's track (0.4 kg/m,
plus 1.2 kg/m at the surface thinning to nothing at synchronous orbit) and no
cargo. `Moon-L1-Elevator/README.md` derives the model; the counterweight
card is described there under "In the workbench".

## Dependencies

**Not self-contained.** The model uses `../../Shared/math-utils.js` and
`constants.js`; the workbench cards add `orbit.js`, `calc-shell.js` /
`calc-shell.css`, `material-card.js`, `materials.js`, `radial-tether.js` and
`counterweight-card.js`. The folder needs
`Website/Shared/` beside it.
