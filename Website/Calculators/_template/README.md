# Calculator template

The canonical starting point for a new calculator. Copy this folder to
`Calculators/<YourCalc>/` and rename the three `template.*` files.

It is a small working calculator — a circular orbit around a chosen body, an
optional target orbit with the Hohmann transfer between them, and an optional
escape card — written to show every part of the calculator shell once:

- permanent input and result cards, with collapsed summaries and short titles
- an **input module** (Target orbit) that brings its paired **result module**
  (Transfer), and a result module that needs no inputs (Escape)
- the key-figure bar at the top of the main result card
- the pan-and-zoom drawing: focus targets that card titles and fields glide
  to, draggable markers, a legend, scale bar and overview map
- live recalculation on every edit or drag

## Files

- `template.html` — page markup: fonts, stylesheets, one `#app` element
- `template.css` — this calculator's own styling (its core accent)
- `template.js` — the calculator: cards, modules, maths, drawing

## Dependencies

This folder loads shared code from the site's `Website/Shared/` folder via a
relative path:

- `../../Shared/calc-shell.css`, `calc-shell.js` — the page layout, cards and modules
- `../../Shared/zoom-view.js` — the pan-and-zoom drawing panel
- `../../Shared/orbit.js` — body data; `math-utils.js` — `OrbitalMath`;
  `ui-components.js` (via calc-shell.js)

**It will break if this folder is moved without `Website/Shared/` coming with
it.**
