# Website

## Architecture

The site is a **single-page app with lazy-loaded sections**. One shell page (`index.html`) provides the shared layout — nav, header, footer, global CSS and JS. Each section is an **HTML fragment** (no `<html>/<head>/<body>` tags) fetched and injected by `main.js` as the user scrolls to it. Sections may be split across multiple pages later if the page becomes too heavy.

All visual content — diagrams, animations, calculators — is implemented in **JS and SVG**. Plain prose is minimized; the site teaches through interactives.

## File Structure

```
Website/
├── index.html              # Shell page — layout, nav, section mount points
├── main.js                 # Bootstrap: registers sections, sets up scroll observers, fetches fragments
├── main.css                # Layout, typography, CSS custom properties (no component styles here)
│
├── Sections/               # One subfolder per section; each is a self-contained fragment
│   ├── Intro/
│   ├── MainLunarSkyhook/
│   ├── DeepspaceLunarSkyhook/
│   ├── LetsCalculate/
│   └── WorldMap/
│
├── Calculators/            # Standalone calculator tools, embeddable or linked from sections
│   ├── Modified-tether-tool/   # Tether/skyhook simulator (adapted from Sigvart Brendberg's tether-tool)
│   └── Space-Elevator-Calculator/
│
├── Animations/             # Standalone animation files (SVG/JS), referenced by sections
│   └── skyhook_animation.html
│
├── Shared/                 # Utilities imported by multiple sections — do not duplicate logic here
│   ├── math-utils.js       # Orbital mechanics, vectors, physics calculations
│   ├── animation.js        # Shared animation helpers (requestAnimationFrame patterns, easing, etc.)
│   └── ui-components.js    # Reusable UI elements (tooltips, Nutshell expanders, etc.)
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

Before adding logic to a section, check `Shared/` first. If the same calculation or UI pattern is needed in two or more sections, it belongs in `Shared/`. Do not import from one section into another — go through `Shared/`.

## Calculators

Calculators in `Calculators/` are self-contained and can run standalone (for direct linking or embedding) as well as being referenced from within a section. The **Modified-tether-tool** is adapted from [Sigvart Brendberg's tether-tool](https://hohmiyazawa.github.io/tether-tool/tetherEmbed.html) — see its own README for details.

## Nutshell

Technical detail is layered using **[Nutshell](https://ncase.me/nutshell/)**, a library that lets readers expand inline explanations without leaving the page. It should not exceed two levels of nesting. The goal is to also enable Nutshell-style annotations within 3D model viewers — this may require adaptation of the library once we get there. This is the principal means of reducing plain text to a minimum.

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
