# Moonwards World-building Project - Aims

- Present the probable architectures that will one day be used to build an industrial space economy. They must:

  - Makes economic sense - returning real value to the Earth for the investment made

  - Be entirely technically realistic - starting with sensible extrapolations, the world portrayed is a reliable, productive, efficient industrial design

  - Be a usable model: the main steps for all major processes are laid out

- Engage users by conveying:

  - How space works and how to engineer for it

  - The vastness and potential of the solar system

  - The transformative nature of space development and advanced technology

- Present the full range of realistic options for space transport in a developed space economy, specializing in fixed infrastructure approaches

- Provide means to explore and expand on this world

# Ladder of Products:

## Website - First step and core reference

- Relies on interactives, calculators, diagrams, and animations

  - In js and svg

  - Plain text external to js / svg content is minimized. Instead, uses pop-ups in context through Nutshell, see below

- Lays out how the envisioned industry and transport works

- One pager with lazy-load sections

  - May be split into a few pages if it becomes too heavy

- 3d models of infrastructure and equipment is included in viewers

  - Which would work here? modelviewer.dev?

- 3d models also can be downloaded

- All content has a permissive license

### Nutshell - from https://ncase.me/nutshell/

- Incorporate within js and svg content where feasible 

- Provides access to technical detail while keeping page clean, clear, and accessible

- Should not exceed two levels

- Try to enable this in annotations within 3d viewer

### 3D models - Next step

- Models of major infrastructure and equipment built in Blender

- Designs are low-poly

- In .usdz

- Communicate the engineering and operations

- 3D models developed outside repository

### Virtual environment - Final destination to enable storytelling

- May be chiefly used to film explanatory videos for the website

- If there is sufficient interest, may be fleshed out over time as fully modelled locations in Blender and Unreal

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

# Workflows and Skillsets

## Kim

- Founder and owner of project, has worked on it for a number of years

- Does design - worldbuilding, artwork, writing

  - Works in Blender and has some knowledge of Unreal

- Has some knowledge in planetary science, space development, and orbital mechanics

- Researches together with Claude to find realistic approaches to the world's infrastructure and logistics

- Does not know how to write code

## Claude

- Advises on all matters and is free to make suggestions

- Writes all code

- Has primary responsibility for keeping the project architecture well organized, subject to Kim's review

- Is consulted on technical matters such as engineering, materials science, orbital mechanics, et cetera

## ToughSF

- Is consulted to do technical review of material on the website, once live

- Kim has been active with them in the past

- Communication is through their Discord server


