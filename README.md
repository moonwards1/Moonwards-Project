# Moonwards World-building Project - Aims

- Present the probable architectures that will one day be used to build an industrial space economy. They must:

  - Makes economic sense - returning real value to the Earth for the investment made

  - Be entirely technically realistic - starting with sensible extrapolations, the world portrayed is a reliable, productive, efficient industrial design

  - Be a usable model - the main steps for all major processes are laid out

- Engage users by conveying:

  - How space works and how to engineer for it

  - The vastness and potential of the solar system

  - The transformative nature of space development and advanced technology

- Present the full range of realistic options for space transport in a developed space economy, specializing in fixed infrastructure approaches

## Website - project core

- Relies on interactives, calculators, diagrams, and animations

  - In js and svg

  - Plain text external to js / svg content is minimized. Instead, uses pop-ups in context through Nutshell, see below

- Lays out how the envisioned industry and transport works

- Split into two main modes: the Moonwards design, and free design:

  - The Moonwards design is the one chosen as the most effective leveraging of the portrayed technology for a robust, profitable, beneficial space economy. It minimizes fuel use by rockets, and instead focuses on providing a system of giant infrastructure facilities. The set of facilities finally chosen will be the ones that get the needed inputs for profitable manufacturing as reliably and cheaply as possible from the bodies where they can be obtained, and are only as big and expensive as is needed to do so. A central assertion of the paradigm is that, over time, it is more efficient and effective for most delta v to be achieved by facilities, not rockets. 

  - The free design allows users to explore alternative approaches, in order to learn about the physics involved, the engineering and economics trade-offs that must be made, and to get a feel for what the undertaking of building such a world would be. It also allows a user to frame an alternate system based on different assertions about what the best way is to build a space economy, and to argue for their system.

  - The Moonwards design is being completed as the free design space construction advances, as it allows Kim to validate what the best design is. So, the Moonwards mode will be built afterwards. The default designs worked out for each app and calculator are the current best guess as to what might work, but not all of them will be adopted into the Moonwards system - only the ones needed to perform the required duties. 

- Is currently a single page with lazy loading, where apps are opened as part of the page. May later be packaged for download as a set of integrated apps and associated calculators, with a dashboard interface very similar to the website. 

- Once the Moonwards mode is being actively worked on, a separate lore page is currently envisioned. This would be where all sorts of concepts that underlie the calculators and apps, but are never explained, would be explored: their technical viability explained, the engineering gaps clarified, the supporting technology spelled out, the whole setting framed. For instance, why the Materials card lists a certain set of materials wiith certain properties, why the celestial bodies that are part of Moonwards are included, and the kind of AI and robots that allow work to be done without humans present.

- Lore passages are drawn on through Nutshell for pop-up notes on the home page

- All content has a permissive license

### Nutshell - from https://ncase.me/nutshell/

- Incorporate within js and svg content where feasible 

- Provides access to technical detail while keeping page clean, clear, and accessible

- Should not exceed two levels

- Try to enable this in annotations within 3d viewer

- Adaptation for the 3D viewer happens in a fork, **https://github.com/moonwards1/nutshell** (upstream is CC0, so this is unrestricted); the fork's built file then gets vendored into `Website/Shared/` (see `Website/README.md`, "Nutshell")

# Repository and local use

The whole project folder is a git repository, published on GitHub. `Website/`
is the deployed site: GitHub Pages serves it exactly as committed, with no
build step (workflow in `.github/workflows/deploy-pages.yml`). `Notes/` is
private working material and stays untracked (see `.gitignore`).

To view the site locally after cloning or downloading, double-click
`serve.bat` (Windows), or run one of:

    python -m http.server 8000 --directory Website
    npx serve Website

then open http://localhost:8000/. A local server is required because the site
is moving to ES modules, which browsers refuse to load from `file://` links.
