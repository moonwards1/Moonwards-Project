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

## The Shared/ dependency

A calculator that imports from `Shared/` references it as `../../Shared/…` and
**breaks if its folder is moved without `Website/Shared/` coming along.** Each
calculator's README states whether it has this dependency; keep that statement
true when you add or remove an import.

## The standalone plotters are frozen

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
