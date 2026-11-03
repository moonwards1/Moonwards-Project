# Lunar Mass Driver Launch Calculator

A track on the Moon's surface accelerates a payload, carried on a sled 7 % of
its mass, to release speed; the sled brakes over a deceleration length and the
payload flies on. The release is horizontal at the top of the track, so the
orbit it gives decides the outcome: sub-orbital (lands downrange), an orbit
(periapsis at the release, coasting to apoapsis where a burn raises periapsis
to 10 km) or escape. It also gives the energy drawn, the acceleration and
force on the track, and the power.

## Files

- `massDriverModel.js` — the physics, pure (no DOM): `computeMassDriver(inp)`
  (inputs and units in its header) and the `MOON` constants
- `massDriverModel.test.js` — Node test pinning the original default design:
  `node --test Website/Calculators/Mass-Driver-Launch-Calculator/massDriverModel.test.js`

The calculator's page was removed; the model reproduces its figures exactly.

## Dependencies

None: the model imports nothing.
