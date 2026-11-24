# Website

## Architecture

The front page (`index.html`) is the **home page**: a banner, the design band where a visitor picks the bodies in their space economy and the giant infrastructure at each, the workbench that mounts the matching calculator, and the apps list. Its code lives in `Home/`; [`Home/README.md`](Home/README.md) describes it.

The page is planned to grow **lazy-loaded sections** below that: each section an **HTML fragment** (no `<html>/<head>/<body>` tags) fetched and injected by `main.js` as the user scrolls to it. Sections may be split across multiple pages later if the page becomes too heavy.

All visual content — diagrams, animations, calculators — is implemented in **JS and SVG**. Plain prose is minimized; the site teaches through interactives.

The codebase is **ES modules throughout** (`Shared/three.min.js`, which provides the global `THREE`, is the one classic script left), so pages are always viewed over http(s) — ES modules do not load from `file://` links. The site is live at <https://moonwards1.github.io/Moonwards-Project/> (GitHub Pages serves this folder exactly as committed, no build step); for local viewing run `serve.bat` at the repo root and open `http://localhost:8000/`.

The longer-term plan for growing the standalone calculators into one integrated solar-system simulator is described in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## File Structure

```
Website/
├── index.html              # Home page — banner, design band, workbench, apps (code in Home/)
├── Home/                   # The home page's code: design model, body facts, page script and styles
├── main.js                 # Bootstrap: registers sections, scroll observers, fragment fetching (stub)
├── main.css                # Layout, typography, CSS custom properties (no component styles here)
├── ARCHITECTURE.md         # Plan: calculators → modules of one integrated simulator
│
├── Sections/               # One subfolder per section; each is a self-contained fragment (all stubs)
│   ├── Intro/  WorldMap/  LetsCalculate/  Moon/
│   ├── LunarMassDriver/  MainLunarSkyhook/  DeepspaceLunarSkyhook/  EarthSkyhook/
│   └── Ceres/  CeresSpaceElevator/  PsycheSpinLauncher/
│
├── Calculators/            # Standalone calculator tools (ES-module pages), embeddable or linked from sections
│   ├── _template/                              # Canonical wiring — copy this to start a new calculator
│   ├── Earth-Aerobrake-Calculator/             # model only: no page of its own
│   ├── Hanging-skyhooks/
│   ├── Mars-Elevator/                          # model + home-workbench cards (off-equator elevator)
│   ├── Mars-Phobos-Skyhook-Trajectory-Plotter/
│   ├── Modified-tether-tool/                   # Tether/skyhook simulator (adapted from Sigvart Brendberg's tether-tool)
│   ├── Mass-Driver-Launch-Calculator/          # model only: no page of its own
│   ├── Moon-L1-Elevator/                       # model + home-workbench cards
│   ├── Moon-Skyhook-Trajectory-Plotter/
│   ├── Skyhook-Spin-Launcher/
│   ├── Solar-System-Trajectory-Plotter/
│   ├── Space-Elevator-Calculator/              # model + home-workbench cards
│   ├── Tether-geometry/
│   ├── Tip-Mass-Driver-Calculator/             # model only: no page of its own
│   └── Tip-Spin-Launcher-Calculator/
│
├── Animations/             # Standalone animation files (SVG/JS), referenced by sections
│   ├── skyhook_animation.html
│   └── skyhook_animation_275.html
│
├── MissionPlanner/         # The integrated simulator shell (ARCHITECTURE.md step 4)
│   └── core/               # Headless mission core: World, registry, diagnostics,
│                           #   chain-recompute engine + Node tests (no UI yet)
│
├── Shared/                 # ES modules (named exports) used by calculators and sections
│   │                       #   — canonical description: Shared/README.md
│   ├── orbit.js            # Planetary-system data (`systems`) + orbit/system classes
│   ├── math-utils.js       # Orbital mechanics (`OrbitalMath`) — pure, Node-testable
│   ├── lunar-ephemeris.js  # Meeus Moon/Sun positions (`LunarEphemeris`)
│   ├── constants.js        # Physical/astronomical constants (`Const`)
│   ├── date-format.js      # Dates year first: "2080/03/14 h7"
│   ├── format-utils.js     # Number/unit formatting (`Fmt`)
│   ├── ui-components.js    # DOM builder (`create`)
│   ├── animation.js        # SVG reveal / viewBox-tween helpers (`SkyAnim`)
│   └── three.min.js        # Vendored Three.js — the one classic script (global `THREE`)
│
└── General_Assets/         # Logos and brand assets
```

## Section Conventions

Each section folder contains at minimum:

- `sectionName.js` — exports `init()` and `teardown()`; self-contained, no global side effects
  - Comments at beginning outline plans for section development
- `sectionName.css` — scoped styles for this section only

`init()` is called by `main.js` when the section enters the viewport. `teardown()` is called if the section is ever unloaded. Sections should not assume they are the only thing running.

## Shared Utilities

Before adding logic to a section, check `Shared/` first. If the same calculation or UI pattern is needed in two or more sections, it belongs in `Shared/`. Do not import from one section into another — go through `Shared/`. [`Shared/README.md`](Shared/README.md) is the canonical description of the libraries, their exports, and the conventions (named exports, pure logic stays Node-testable, one responsibility per file).

## Calculators

Calculators in `Calculators/` are self-contained ES-module pages that run standalone (for direct linking or embedding) as well as being referenced from within a section. Earth Aerobrake, Mass Driver Launch and Tip Mass Driver are now model files only, with Node tests and no page of their own; the Moon–L1 and Space Elevator folders likewise hold a model and the cards the home workbench mounts. Each folder carries its own README stating what it computes and which `Shared/` modules it imports; new calculators start by copying `_template/`. The **Modified-tether-tool** (and the `Tether-geometry` variant of it) is adapted from [Sigvart Brendberg's tether-tool](https://hohmiyazawa.github.io/tether-tool/tetherEmbed.html) — see its own README for details.

## Info tiers and the Lore page

Explanations are layered in three tiers so plain text stays to a minimum: a **dotted underline** gives a tooltip (what a word means, how a control works); an **orange dotted underline** opens a pop-up beside the word, a speech bubble pointing at it, with a fuller entry; an **orange ⓘ** opens the same pop-up for central information. Every mark shows the help cursor. Inside an entry, links to other entries expand in place, **[Nutshell](https://ncase.me/nutshell/)**-style, at most two levels deep.

Pop-ups show only the entry's text; the Lore page adds its title and any Lore-page-only blocks. All the text lives in one hand-written Markdown file, `Lore/entries.md`, and the same entries make up the **Lore page** (`Lore/index.html`), grouped by the file's chapters. A mark on any page names only an entry's id; the tier belongs to the entry. The runtime is `Shared/lore.js` (parsing and rendering in `Shared/lore-markdown.js`); each page calls `initLore()` once. Nutshell-style annotations inside 3D model viewers are a later goal for the same entries.

## 3D Models

3D model files are developed separately (outside this folder) in Blender, exported as `.usdz`. Viewers are embedded in relevant sections. The viewer library under consideration is [model-viewer](https://modelviewer.dev). Models are also available for download.

## Sections (current, in order of appearance on the website)

| Section               | Status | Subject                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intro                 | stub   | How to use website, aim and vision of project                                                                                                                                                                                                                                                                                                                                                |
| WorldMap              | stub   | Infographic of all worlds that host infrastructure, and the basics of space industry flows in this society                                                                                                                                                                                                                                                                                   |
| LetsCalculate         | stub   | Collection of calculators so users can check the math of project designs, get familiar with the physics, and explore alternatives.                                                                                                                                                                                                                                                           |
| Moon                  | stub   | Overview of lunar industry and a very brief timeline of how it was built                                                                                                                                                                                                                                                                                                                     |
| EquatorialFacilities  | stub   | Overview of production and infrastructure on the equator                                                                                                                                                                                                                                                                                                                                     |
| LalandeFacilities     | stub   | Overview of production and infrastructure at Lalande Crater                                                                                                                                                                                                                                                                                                                                  |
| MainShuttles          | stub   | Shows the shuttles that go between massdriver and skyhook; their engineering and operation, the packages they carry, their typical manifests                                                                                                                                                                                                                                                 |
| LunarMassDriver       | stub   | Launches shuttles to skyhooks, does other launches. Shows its layout, supporting facilities, and operations. Also covers the catcher complex near it for returning shuttles.                                                                                                                                                                                                                 |
| MainLunarSkyhook      | stub   | Receives shuttles from the surface and exports 10 MT of goods to Earth every year. Also hosts extensive industry at its anchor at orbital altitude. Receives cargo from Ceres and Psyche. Shows operations along its length and goes over facilities and engineering.                                                                                                                        |
| Earthdivers           | stub   | Shows the Earthdivers that launch from the main skyhook tip, taking cargo to Earth - their engineering and operation, example loads, breakdown of annual export volumes, the mini-tugs that refine their trajectory after launch. Animation of a launch, infographic of trip to Earth, animation of entry sequence, infographic of receiving centers on Earth.                               |
| EarthSkyhook          | stub   | Receives rockets from the surface and sends their cargo up to the tip, to load on shuttles from the moon, which take it to the main lunar skyhook. Also hosts various datacenters, communications hubs, telescopes, human habitats, and facilities that clear orbital debris.  Infographic of operations along its length, with nested infographics that go over facilities and engineering. |
| DeepspaceLunarSkyhook | stub   | Launches to Ceres and other points in deep space. Hosts large orbital habitat at anchor (orbital altitude) that is developing ecosystems in space. Infographic of facilities, another on the orbital habitat, another on its orbit, and an animation of the launch process.                                                                                                                  |
| Ceres                 | stub   | infographic of Ceres planetary science and the substances mined from it. Animation of trajectories between the moon and Ceres, showing outbound trip to Ceres.                                                                                                                                                                                                                               |
| CeresOperations       | stub   | infographics and 3d models of mining operations on the surface, processing installations, and trolly lines to the facilities on the anchor at synchronous orbit altitude, where CNT is fabricated for local use in the space elevator.                                                                                                                                                       |
| CeresSpaceElevator    | stub   | Launches ships to the moon, including doing plane change by imparting a velocity on the normal vector with a spin launcher. Spin launcher also captures incoming ships. Infographic of space elevator and facilities along its length.                                                                                                                                                       |
|                       |        |                                                                                                                                                                                                                                                                                                                                                                                              |
