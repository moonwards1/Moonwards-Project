# Home page

The site's front page (`Website/index.html`): a banner, the **design band**,
the **workbench**, and the **apps**.

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
  calculator (today: the hanging skyhook, the Phobos skyhook, the standard
  space elevator and the Moon's L1 elevator) shows its cards on the tabs they
  belong to, and **skeleton cards** fill any tab it has none on. Others are
  made entirely of skeleton cards. Skeleton input cards are wired to their
  result cards; results that are plain arithmetic are computed, the rest show
  "—" until a model exists. The drawing panel stays empty where no
  calculator draws yet. Each card has a checkbox, in the card's colour, before
  its title: ticked cards have their marks in the drawing, unticked ones
  don't (clicking the title still glides the drawing to the card). The ticks
  are saved with the design.
- **Ships** — support ships are not a family of their own: each installation
  needs some of three roles (`shipRolesFor` in `design-model.js`: surface
  launchers shuttles; launchers on an elevator or skyhook, and elevators and
  skyhooks themselves, freighters; the Moon's L1
  elevator, and skyhooks where the body or its parent planet has an
  atmosphere, capsules too), and its Logistics tab shows a card for each role
  plus a Ship legs result card (`Shared/ship-card.js`). A ship class belongs
  to the design (`Shared/ships.js`): installations using the same class share
  it, and an edit on any card changes it everywhere. Each role has a standard
  class; a capsule or shuttle card can make a local version for its one
  installation (and remove it to return to the standard). A freighter card
  makes other versions, up to three designs including the standard, titled
  by payload in kt and HS for a heat shield, and any freighter card can
  switch among them. The Economy skeleton cards take payload and
  propellant per flight from the installation's first role.
- **Save design** keeps the design, its ship classes, every mounted
  calculator's settings and the current selection in the browser's local storage, and the page reopens
  on it. **Export** downloads the same as a `.moonwards.json` file; **Import**
  reads one back, from a file or pasted text.

- **Apps** — tabs over the site's full-page apps (Mission Planner, Moon
  Skyhook and Mars–Phobos Skyhook trajectory plotters), each shown in a frame
  of the same site so it shares its own page's saved work. Nothing loads with
  the home page: the Mission Planner tab is selected on arrival but shows an
  introduction until clicked, and each app loads the first time its tab is
  clicked, then stays loaded while another tab shows. **Pop out** moves the
  selected app into a window of its own and **Bring back** returns it; only
  one copy of an app is ever live, since two Mission Planners would overwrite
  each other's saved missions. All calculators is a plain link.

## Files

- `../index.html` — page markup
- `home.css` — the page's styling (prefix `hm-`); colours and type follow
  `Shared/calc-shell.css` so mounted calculators sit in the page without a seam
- `home.js` — the page: rendering, menus, selection, save / export / import
- `apps.js` — the apps section: tabs, framed apps, pop out / bring back
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
`CALCULATORS` (`home.js`) that loads its mount function. An entry may add
`opts` to the mount options, so one calculator can serve a configuration: the
Phobos skyhook is the hanging-skyhook calculator with `anchor: "Phobos"`. Its cards and chips
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
