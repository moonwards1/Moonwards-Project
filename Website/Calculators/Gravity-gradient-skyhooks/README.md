# Gravity-gradient Skyhook Calculator

Models a vertical (non-rotating) gravity-gradient skyhook: geometry, velocities,
taper ratios, masses, climber energy, cargo throughput, VASIMR station-keeping,
and release / Earth-reentry targets.

## Files

- `Gravity-gradient-skyhooks.html` — page markup
- `Gravity-gradient-skyhooks.css` — page styling
- `Gravity-gradient-skyhooks.js` — the calculator logic

## Dependencies

This folder loads shared code from the site's `Website/Shared/` folder via a
relative path:

- `../../Shared/orbit.js` — planetary-system data

**It will break if this folder is moved without `Website/Shared/` coming with
it.** To use it standalone, copy `Shared/orbit.js` next to this page and change
the `<script src="../../Shared/orbit.js">` reference in the HTML.

(The old per-folder `js/orbit.js` copy is now unused and can be deleted.)
