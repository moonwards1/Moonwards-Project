# Home page

The site's front page (`Website/index.html`): a banner, the **design band**,
the **workbench**, and the apps list.

- **Design band** — "Make your own" lists the bodies in the user's space
  economy against the three families of giant infrastructure (Skyhook, Space
  Elevator, Kinetic Launcher), each with its variants. The Kinetic Launcher menu
  groups mass driver and spin launcher under "On the surface", then offers a
  launcher on a space elevator or on a skyhook. Clicking a body or one of its
  installation chips selects it; the panel on the right shows that body's main
  facts. A `*` in a cell means the family has special forms there (the Moon's
  elevator runs through L1 or L2; Mars's skyhooks can anchor on Phobos or
  Deimos); an `×` means it can't be built there with this world's technology.
  Both open a card explaining why, and the `*` card is where its special forms
  are added, each at most once. Column menus carry no notes and leave the
  special forms out; the Space Elevator column has no menu at all, since its
  variants depend on the body (a plain body gets a "+ add" for the standard
  one). Three bodies show at a time; more scroll. The "Moonwards" tab, the world used for
  Moonwards media, comes later.
- **Workbench** — four tabs in working order: Architecture, Logistics,
  Engineering, Economy, all on the same three-column layout (header with
  module chips, inputs, drawing, results) for the selected body and
  installation. Each installation has one calculator serving all four tabs;
  every card and chip belongs to a tab. An installation with its own
  calculator (today: the hanging skyhook, the standard space elevator and the
  Moon's L1 elevator) shows its cards on the tabs they
  belong to, and **skeleton cards** fill any tab it has none on. Others are
  made entirely of skeleton cards. Skeleton input cards are wired to their
  result cards; results that are plain arithmetic are computed, the rest show
  "—" until a model exists. The drawing panel stays empty where no
  calculator draws yet. Each card has a checkbox, in the card's colour, before
  its title: ticked cards have their marks in the drawing, unticked ones
  don't (clicking the title still glides the drawing to the card). The ticks
  are saved with the design.
- **Save design** keeps the design, every mounted calculator's settings and
  the current selection in the browser's local storage, and the page reopens
  on it. **Export** downloads the same as a `.moonwards.json` file; **Import**
  reads one back, from a file or pasted text.

## Files

- `../index.html` — page markup
- `home.css` — the page's styling (prefix `hm-`); colours and type follow
  `Shared/calc-shell.css` so mounted calculators sit in the page without a seam
- `home.js` — the page: rendering, menus, selection, save / export / import
- `design-model.js` — the design and its rules, pure (no DOM): bodies,
  infrastructure families and variants, the `*` / `×` marks, what may be
  added where, parse / serialize, and `calcFor()` — which calculator the
  workbench mounts for a tab and installation
- `body-facts.js` — display strings for the facts panel, plus the rotation
  and heliocentric-orbit numbers the skeleton cards use
- `skeleton.js` — skeleton cards for every tab: `addSkeletonCards(shell, ctx,
  tabs)` fills tabs on an existing calculator, `mountSkeleton(root, opts)`
  builds a calculator of skeleton cards only
- `workbench-math.js` — the skeleton's arithmetic, pure: rocket equation,
  launch-window spacing, minimum-energy transfer time, stationary orbit,
  circular and escape speed, track exit speed
- `tests/` — `node --test Website/Home/tests/` (design rules and the skeleton's arithmetic)

## Mounting a calculator

A calculator joins the workbench in two places: a case in `calcFor()`
(`design-model.js`) naming it for an installation, and an entry in
`CALCULATORS` (`home.js`) that loads its mount function. Its cards and chips
carry `tab`; the workbench calls `shell.setTab()` as the viewer switches tabs,
and adds skeleton cards to any tab the calculator leaves empty. As a
calculator gains cards for a tab, the skeleton steps aside there. The calculator side
of the contract — a mount function that keeps its state in a closure and
takes `body`, `lockBody`, `embedded`, `overline` and `state` — is described in
`Shared/README.md` ("Mounting in the home workbench") and shown by `Calculators/Hanging-skyhooks/skyhookCalc.js`.

Each installation gets its own mounted calculator, created the first time it
is shown and kept hidden while the viewer looks elsewhere, so its settings
survive moving around the design. Removing the installation removes it;
importing a design replaces them all. Save and Export copy each calculator's
`getState()` into its installation's `state`, which is handed back on the
next mount.

## Dependencies

`index.html` loads `Shared/calc-shell.css` and
`General_Assets/MoonwardsLogo_26_150px.png`; `home.js` loads each calculator
module from `Calculators/` when it is first shown.
