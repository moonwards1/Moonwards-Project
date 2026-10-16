# Hanging Skyhook Calculator

Models a vertical (non-rotating) gravity-gradient skyhook: geometry, speeds,
taper ratios, masses, climber energy, cargo throughput, VASIMR
station-keeping, release points for transfers to neighbouring bodies, and
Earth reentry of cargo released toward Earth.

Built on the calculator shell: inputs, a zoomable drawing and results in three
columns. Stations, tip payload, cargo throughput, station-keeping and Earth
reentry are input modules; the fall from the foot, climber energy, release
points, forces, throughput, station-keeping, reentry and sending the tether to
another calculator are result modules. Card titles glide the drawing to their
part; the foot, centre-of-mass and top markers can be dragged.

## Files

- `Hanging-skyhooks.html` — page markup: fonts, stylesheets, one `#app` element
- `Hanging-skyhooks.css` — this page's own styling (core accent, About text)
- `Hanging-skyhooks.js` — the page: cards, modules, drawing, exchange
- `skyhookModel.js` — the physics, pure (no DOM): `computeSkyhook(body, inputs)`
- `skyhookModel.test.js` — Node test pinning the default design's figures:
  `node --test Website/Calculators/Hanging-skyhooks/skyhookModel.test.js`

## Dependencies

This folder loads shared code from the site's `Website/Shared/` folder via a
relative path:

- `../../Shared/calc-shell.css`, `calc-shell.js`, `zoom-view.js` — the page layout and drawing panel
- `../../Shared/orbit.js` — planetary-system data
- `../../Shared/math-utils.js`, `constants.js` — the maths
- `../../Shared/exchange.js`, `exchange-types.js` — sending the tether to the Skyhook Spin-Launcher

**It will break if this folder is moved without `Website/Shared/` coming with
it.**
