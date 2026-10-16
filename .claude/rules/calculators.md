---
paths:
  - "Website/Calculators/**"
---

# Calculators

Each lives in `Website/Calculators/<name>/`, split into **`name.html` +
`name.css` + `name.js`** — no inline `<style>` or `<script>` blocks. (The
tether-tool embeds are the exception: they keep a small inline module that
imports and starts the tool.) A new calculator starts by copying
`Website/Calculators/_template/`.

## The calculator shell (new calculators)

New calculators sit on the **calculator shell**, which `_template/` shows
whole: `Shared/calc-shell.css` + `calc-shell.js` (`CalcShell`) +
`zoom-view.js` (`ZoomView`). The page is a header (title, then two chip
groups: input modules on the left, result modules on the right, each two
lines high and scrolling beyond that) over three columns — inputs, the
drawing, results — each scrolling on its own.

- **Cards.** Permanent cards hold the main inputs and results; a card with
  `module` shows only while its module is on. Every card collapses to its
  `short` title plus a one-line summary (`card.setSummary`), so keep both
  short. The main result card may open with a key-figure bar (`shell.hero`).
- **Modules.** Input modules add input cards, result modules add result
  cards. Declare `needs` (switched on with it) and, on an input module,
  `brings` (its paired results). Dependencies resolve in `switchModule`.
- **Drawing.** World units are the calculator's choice (km in the template).
  Lines take `vector-effect="non-scaling-stroke"`; markers, text and offsets
  are sized in pixels × `view.u` inside the `onRender` callback. Each card's
  `focus` names a `view.addTarget` rect the drawing glides to; fields can
  carry their own `focus`. Draggable markers use `view.draggable`, and call
  `shell.focusCard(id, false)` to highlight their card without moving the view.
- **Colours.** Take card/drawing accent pairs from `ShellColors` so a module's
  chip, cards and marks match. A calculator sets only `--cs-core` and its
  drawing's own rules (own class prefix) in its stylesheet.
- **Narrowing.** Side columns shrink and cards tighten (container queries)
  before anything stacks — results go under the drawing below 940 px, all
  stacks below 640 px. Don't add fixed widths that defeat this.
- Style script-filled text by class, never by bare element (`.x span`):
  filled-in text may arrive wrapped in its own element.

## The older frame

Calculators built before the shell sit on `Shared/calc-frame.css`; they keep
working and move to the shell one at a time, when Kim asks. On that frame: one `cf-calc` card,
sections that reflow to the width of the column they are in (usable from 400
px), input sections with a solid tint, result cards with striped lines, the
info button and "About this calculator" pop-up (`Shared/calc-about.js`). Notes
that explain one input go in a **small tip** instead of a note paragraph: a
`cf-info` button with `data-cf-tip="…"` at the end of the row's label opens a
small floating box beside itself. A tool
sets only its identity colour (`.cf-calc { --cf-hue: … }`) and its own
specifics in its own stylesheet. The class list is the header of
`calc-frame.css`; `Hanging-skyhooks/` shows the shape. Section content is a heading
element followed by its lines (the striping counts children). Diagrams are SVG
with a `viewBox` inside a `cf-graphic` so they scale with the column; a drag
handler must convert pointer pixels to SVG units.

## The Shared/ dependency

A calculator that imports from `Shared/` references it as `../../Shared/…` and
**breaks if its folder is moved without `Website/Shared/` coming along.** Each
calculator's README states whether it has this dependency; keep that statement
true when you add or remove an import.

## The standalone plotters are adopted

`Solar-System-Trajectory-Plotter`, `Moon-Skyhook-Trajectory-Plotter` and
`Mars-Phobos-Skyhook-Trajectory-Plotter` are **not to be modified uninvited.**
Their fate is uncertain — the Mission Planner's Ephemeris tab already ports
their authoring experience and may supersede them. If you find a bug or
limitation in one while working on ported or shared code, fix it where the
port lives and mention the original; don't touch the plotter unless Kim asks.

Several calculators are also the source material for Mission Planner
technology platforms still to be written — Space-Elevator-Calculator and
Moon-L1-Elevator, Mass-Driver-Launch-Calculator, Tip-Spin-Launcher-Calculator,
Earth-Aerobrake-Calculator. Read one before porting its physics; don't
reinvent it.

## Strict mode

Module code runs in strict mode, so assigning to an undeclared variable throws
at runtime. The older tether-tool-derived calculators relied on implicit
globals and now carry explicit `var` declarations near the top. Declare
everything in new code.

## Verifying

jsdom does **not** execute `<script type="module">`, so there is no page-level
jsdom harness for these. Page checks happen in a real browser — `serve.bat`
locally (served root is `Website/`, so no `Website/` prefix in the URL) or the
deployed Pages site. jsdom remains usable only for hand-driving isolated DOM
logic you import yourself.

After a large edit, confirm the file still ends as it should: a self-running
calculator `.js` ends with its tool's run call (e.g.
`skyhookTool(document.getElementById("insertItHere"));`) or its init wiring
(`calc();` / `if (document.readyState === "loading") …`); the tether-tool
modules end with the closing `}` of their exported function, since the embed
page calls it; the `.html` ends with `</body></html>` and carries the right
`<link>` and `<script type="module">` references.
