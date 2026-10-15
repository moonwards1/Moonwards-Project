# Hanging Skyhook Calculator

Models a vertical (non-rotating) gravity-gradient skyhook: geometry, velocities,
taper ratios, masses, climber energy, cargo throughput, VASIMR station-keeping,
and release / Earth-reentry targets.

## Files

- `Hanging-skyhooks.html` — page markup
- `Hanging-skyhooks.css` — this page's own styling; the layout comes from the shared frame
- `Hanging-skyhooks.js` — the calculator logic

## Dependencies

This folder loads shared code from the site's `Website/Shared/` folder via a
relative path:

- `../../Shared/orbit.js` — planetary-system data
- `../../Shared/math-utils.js`, `constants.js`, `exchange.js`, `exchange-types.js`
- `../../Shared/calc-frame.css` — the shared calculator layout
- `../../Shared/calc-about.js` — the "About this calculator" pop-up and the small input tips

**It will break if this folder is moved without `Website/Shared/` coming with
it.**
