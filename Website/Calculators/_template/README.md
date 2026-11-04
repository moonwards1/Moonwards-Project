# Calculator template

The canonical starting point for a new calculator. Copy this folder to
`Calculators/<YourCalc>/` and rename the three `template.*` files.

It is a small working calculator — a circular orbit around a chosen body, a
target orbit with the Hohmann transfer between them, and the escape speed —
written to show every part of the calculator shell once:

- input and result cards, with collapsed summaries and short titles
- the key-figure bar at the top of the main result card
- the pan-and-zoom drawing: focus targets that card titles and fields glide
  to, draggable markers, a legend, scale bar and overview map
- live recalculation on every edit or drag

## Files

- `template.html` — page markup: fonts, stylesheets, one `#app` element
- `template.css` — this calculator's own styling (its core accent)
- `template.js` — the calculator: cards, maths, drawing

## Dependencies

This folder loads shared code from the site's `Website/Shared/` folder via a
relative path:

- `../../Shared/calc-shell.css`, `calc-shell.js` — the page layout and cards
- `../../Shared/zoom-view.js` — the pan-and-zoom drawing panel
- `../../Shared/orbit.js` — body data; `math-utils.js` — `OrbitalMath`;
  `ui-components.js` (via calc-shell.js)

**It will break if this folder is moved without `Website/Shared/` coming with
it.**
