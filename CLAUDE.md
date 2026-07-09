# Moonwards Project — working notes for Claude

## The two views of the files

There are two ways to touch files, and they are not always in sync:

- **Read / Write / Edit tools** — the **authoritative** view. Never stale, never truncated. Treat these as the source of truth for what is actually on disk.
- **The bash shell (`mcp__workspace__bash`)** — sees the project through a **separate mount that is only eventually-consistent.** Right after a write, and during bursts of edits, the shell may read a file as empty, truncated, or out of date — usually for seconds, but observed (2026-07-06) persisting for several minutes, and in one case **across sessions/hours, surviving a commit** (a fresh session's mount still served stale copies of files edited the session before). A stale read serves the file's **new content forced to its old byte length**: if the file grew, the tail is cut mid-word; if it shrank, the real content is followed by **NUL-byte padding** (`^@^@…`). Both are recoverable — strip trailing NULs, or stitch the missing tail from an authoritative Read (see the snapshot pattern below). While the mount is stale, even **read-only git can fail** ("unknown error occurred while reading the configuration files"). (Testing showed this lag is intermittent and **not** tied to the C:/D: drive split — it is a property of the sync bridge.) The shell also **cannot delete** project files (a safety guard).

Rule of thumb: **decide truth with the Read tool; use the shell for muscle (copying, slicing, computing, testing).**

## Shell file operations are allowed — just verify, because of the lag

Earlier notes forbade shell writes entirely. That was too strict. Copying, moving, slicing, and concatenating files in the shell is fine and is the **preferred** way to relocate or extract content — do **not** re-emit thousands of lines through the Write tool when `cp`/`sed`/`awk` will do it. The only real hazard is the sync lag, so:

- **Creating a new file** (e.g. `cp a b`, or `sed -n '165,1257p' src > new.js`): allowed. There is no existing content to clobber. **Verify the result with the Read tool afterward** (right first/last lines, sane length) before relying on it or deleting any original.
- **Reading/slicing FROM a file in the shell**: the source can be served truncated/stale. Before trusting it, **confirm the shell's copy is complete and current** — e.g. it ends with the expected last line, the line count is sane, or it contains a known-recent edit. If it looks short, wait a few seconds and re-copy.
- **Overwriting an existing file** from the shell: allowed, but it carries the only genuine clobber risk — if the destination changed since you last saw it (see Concurrency), a stale-based overwrite loses that change. So overwrite from a freshly-verified source, and **Read-tool the destination afterward** to confirm.
- **Targeted content edits**: still prefer the **Edit** tool. It is authoritative and diff-safe, and avoids the verify dance.
- **Deleting** project files: not possible from the shell. Ask the user to delete (and they may want to review the change anyway).

### The efficient "snapshot → slice → verify" pattern

To split or relocate a large file (e.g. pull an inline `<script>` into a sibling `.js`):

1. Copy the source to the sandbox and **confirm it is complete** (tail matches the real last line; if the mount truncated it, wait/re-copy, and stitch the known tail from an authoritative Read if needed).
2. Slice / transform with `sed`/`awk` into the new file(s).
3. **Verify with the Read tool** that each new file is intact, then wire up references.
4. Leave the original in place until the new files are verified, so nothing can be lost.

## Running tests / harnesses in the shell

- **Pure logic** (`Shared/math-utils.js`, `format-utils.js`, `constants.js`, `lunar-ephemeris.js`, `orbit.js`) is ESM — unit-test it **directly in Node** with `import` — no DOM, no jsdom, no mount games. This is the fastest, most reliable check and should be the default for orbital-mechanics maths. The repo root's `package.json` sets `"type": "module"`; when snapshotting files to `/tmp` for testing, drop a `{"type":"module"}` `package.json` next to them or Node parses `.js` as CommonJS and rejects `import`.
- `node --check` (on a `/tmp` snapshot under a `type:module` package.json) catches syntax errors; `eslint` with `no-undef` + browser env + `THREE` as a global catches strict-mode hazards (undeclared variables) that only explode at runtime. Both proved their worth during the ESM conversion.
- **DOM / calculator behavior**: jsdom does **not** execute `<script type="module">`, so the old jsdom page harness no longer works on the calculator pages. Page-level checks happen in a real browser — `serve.bat` locally or the deployed Pages site (see Notes for how Claude reaches each). jsdom remains usable only for hand-driving isolated DOM logic that you import yourself.

## Project structure (current)

- **The site is live** at <https://moonwards1.github.io/Moonwards-Project/> (GitHub Pages serves `Website/` as committed, no build step). Local viewing goes through **`serve.bat`** at the repo root (`http://localhost:8000/`) — ES modules do not load over `file://`, so double-clicking an `.html` no longer works.
- Calculators live in `Website/Calculators/<name>/`, each split into **`name.html` + `name.css` + `name.js`** (no inline `<style>`/`<script>` blocks; the tether-tool embeds keep a small inline module that imports and starts the tool).
- Shared libraries live in `Website/Shared/`, as **ES modules with named exports** (see convention below):
  - `orbit.js` → `systems` (a `Map` of bodies: `GM`, `radius`, `orbit`, …) — the planetary-system data; also exports `System`, `Orbit`, `Vector`, `Time`, `Transfer`, `Atmosphere`, `Geology`, `constants`.
  - `math-utils.js` → `OrbitalMath` — pure orbital mechanics (circular/escape/vis-viva speed, hyperbolic excess, period, Hohmann, SOI, Hill radius, synodic period, Tsiolkovsky, tether taper integral/ratio, …).
  - `format-utils.js` → `Fmt` (plus legacy aliases `fmtForce`, `myRound`, … as named exports) — number/unit formatting.
  - `ui-components.js` → `create` — the DOM builder.
  - `animation.js` → `SkyAnim` — SVG reveal / viewBox-tween helpers.
  - `three.min.js` → **the one classic-script exception**: vendored Three.js, loaded with a plain `<script src>` tag ahead of the page module, provides the global `THREE`.
- A calculator that imports from `Shared/` references it as `../../Shared/...` and **breaks if its folder is moved without `Website/Shared/` coming along.** Each calculator's README states whether it has this dependency.
- `Website/Shared/README.md` is the canonical description of the libraries and conventions. New calculators start by copying `Website/Calculators/_template/`.

## Conventions for shared code

- **ES modules throughout** (converted 2026-07) — `import`/`export` with **named exports**, one `<script type="module">` per page. `Shared/three.min.js` (global `THREE`) is the sole classic script left; pages that use Three.js load it with a plain tag before their module.
- **Module code runs in strict mode** — assigning to an undeclared variable throws at runtime. The old tether-tool-derived calculators relied on implicit globals; they now carry explicit `var` declarations near the top. Declare everything in new code.
- **Keep pure logic pure** — maths and formatting take/return plain values, no DOM, so they stay Node-testable (root `package.json` is `"type": "module"`).
- Prefer the namespaced APIs (`OrbitalMath.*`, `Fmt.*`) in new code.
- When adding orbital-mechanics maths, put it in `math-utils.js` with a Node test, rather than inlining it in a calculator.

## Git: never run write operations against the mount

- **Git cannot operate on the mounted project from the shell.** Every git write goes through lock files that must be renamed/unlinked, and the mount's no-delete guard blocks that. A `git init` attempt (2026-07-06) died on `.git/config.lock` and left a corrupt half-created `.git` that Kim had to delete by hand. Do not run `git init`/`add`/`commit`/`checkout` against the mount — and be wary of `git status`, which opportunistically rewrites the index.
- **The repo is operated from Kim's side (GitHub Desktop):** Claude edits files with the file tools; Kim reviews the diff in Desktop, commits, and pushes. Read-only commands (`git log`, `git show`, `git diff`) from the shell are fine once `.git` exists.
- The repo is `https://github.com/moonwards1/Moonwards-Project` (org `moonwards1`), default branch **`master`**. The published site is `Website/` via GitHub Pages (workflow: `.github/workflows/deploy-pages.yml`, deploys on push). `Notes/` is untracked by `.gitignore`.

## Concurrency: more than one job may touch a file

- This project is sometimes worked on from more than one thread/job; two jobs editing the same file can clobber each other.
- Before editing a file that another job may have touched, **re-Read it immediately** so the edit is based on current content. Don't rely on a remembered version after a gap.
- Prefer to edit any given file from **one thread at a time**.

## Before large edits to important files

- Keep the previous content recoverable (a copy, or the original left in place) so a bad write can be **restored** rather than reconstructed from a possibly-stale view.
- After finishing, verify the file ends as expected: a self-running calculator `.js` ends with its tool's run call (e.g. `skyhookTool(document.getElementById("insertItHere"));`) or its init wiring (`calc();` / `if (document.readyState === "loading") …`); the tether-tool modules end with the closing `}` of their exported function (the embed page calls it); the `.html` ends with `</body></html>` and carries the right `<link>` and `<script type="module">` references.

## Notes

- **Viewing pages in Chrome.** The deployed site (<https://moonwards1.github.io/Moonwards-Project/...>) is plain `https`, so Claude can `navigate` an MCP tab to it directly — the easiest way to check a page once a push has deployed. For **local** checking, Kim runs `serve.bat` and Claude can `navigate` straight to `http://localhost:8000/...` — **the served root is `Website/`** (mirroring Pages), so local URLs carry no `Website/` prefix: e.g. `http://localhost:8000/MissionPlanner/...`, not `/Website/MissionPlanner/...` (the latter 404s; confirmed 2026-07-08) — **confirmed working (2026-07-06)** as long as the `http://` scheme is written explicitly (the old `https://`-prefix mangling only hit schemeless/odd URLs, e.g. it turned `file:///D:/...` into `https://file:///D:/...`). The full check loop — navigate, screenshot, `read_console_messages` for errors — was used to verify all calculator pages after the ESM conversion. The MCP-controlled tab must be initiated by Cowork (e.g. via `tabs_create_mcp`) — a tab opened by the Claude extension directly in Chrome is not accessible to Cowork. (`file://` pages themselves are moot now: ES modules don't run over `file://`; note `serve.bat` prints its "Serving…" banner *before* Python starts, so check for a line like `Serving HTTP on :: port 8000` to confirm the server is actually up, and remember the root URL renders blank while `index.html` is a stub — test a calculator URL instead.)
- **The MCP tab group is scoped to the current session and does not carry over.** A tab group created in an earlier conversation/session is invisible to a new one — `tabs_context_mcp` in a fresh session reports no tab group at all, even if the user still has that old tab open in their browser. The user re-pasting an address into that stale tab does **not** help; Claude needs its **own** tab handle in the **current** session. So each time this comes up in a new session: Claude calls `tabs_context_mcp` with `createIfEmpty: true` (or `tabs_create_mcp`) to get a fresh empty tab in *this* session's group first, tells the user the tab is ready, and only then does the user paste/load the address into it.
- A browser tab merely **viewing** a local file does not write to it and cannot truncate it; it only shows a stale render until reloaded. It is not a cause of file-corruption issues.
- The session **outputs** scratch folder (under `C:\Users\…\local_…\outputs`) is ephemeral and separate from the project; files there don't need cleanup and won't travel with the repo.

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
