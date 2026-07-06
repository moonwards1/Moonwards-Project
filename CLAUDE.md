# Moonwards Project — working notes for Claude

## The two views of the files

There are two ways to touch files, and they are not always in sync:

- **Read / Write / Edit tools** — the **authoritative** view. Never stale, never truncated. Treat these as the source of truth for what is actually on disk.
- **The bash shell (`mcp__workspace__bash`)** — sees the project through a **separate mount that is only eventually-consistent.** Right after a write, and during bursts of edits, the shell may read a file as empty, truncated, or out of date — usually for seconds, but observed (2026-07-06) persisting for several minutes. A stale read can also serve the file's **new content clamped to its old byte length** (cut mid-word at the end), so a complete-looking file that ends abruptly is suspect. (Testing showed this lag is intermittent and **not** tied to the C:/D: drive split — it is a property of the sync bridge.) The shell also **cannot delete** project files (a safety guard).

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

- **Pure logic** (`Shared/math-utils.js`, `Shared/format-utils.js`) exports via `module.exports`, so unit-test it **directly in Node** — no DOM, no jsdom, no mount games. This is the fastest, most reliable check and should be the default for orbital-mechanics maths.
- **DOM / calculator behavior** needs jsdom. Don't point jsdom at the live mounted file (it may be stale). **Snapshot first**: Read the file authoritatively, write that exact content to `/tmp`, and run jsdom against the snapshot. jsdom doesn't implement `innerText` or SMIL `beginElement` — map `innerText`→`textContent` in the test copy, and ignore the harmless `beginElement` error (it fires after `calc()` has already set the outputs).

## Project structure (current)

- Calculators live in `Website/Calculators/<name>/`, each split into **`name.html` + `name.css` + `name.js`** (no inline `<style>`/`<script>` blocks).
- Shared libraries live in `Website/Shared/`, loaded as **classic scripts** (see convention below):
  - `orbit.js` → global `systems` (a `Map` of bodies: `GM`, `radius`, `orbit`, …) — the planetary-system data.
  - `math-utils.js` → `OrbitalMath` — pure orbital mechanics (circular/escape/vis-viva speed, hyperbolic excess, period, Hohmann, SOI, Hill radius, synodic period, Tsiolkovsky, tether taper integral/ratio, …).
  - `format-utils.js` → `Fmt` (plus legacy bare aliases `fmtForce`, `myRound`, …) — number/unit formatting.
  - `ui-components.js` → `create` — the DOM builder.
  - `animation.js` → `SkyAnim` — SVG reveal / viewBox-tween helpers.
- A calculator that loads from `Shared/` references it as `../../Shared/...` and **breaks if its folder is moved without `Website/Shared/` coming along.** Each calculator's README states whether it has this dependency.
- `Website/Shared/README.md` is the canonical description of the libraries and conventions. New calculators start by copying `Website/Calculators/_template/`.

## Conventions for shared code

- **Classic scripts only** — no `import`/`export`, no `type="module"`. The calculators must keep working when opened from a `file://` link, and ES modules are blocked over `file://`. Each Shared module is an IIFE that assigns its global and also sets `module.exports` (for Node tests).
- **Keep pure logic pure** — maths and formatting take/return plain values, no DOM, so they stay Node-testable.
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
- After finishing, verify the file ends as expected: a calculator `.js` ends with its tool's run call (e.g. `skyhookTool(document.getElementById("insertItHere"));`); the `.html` ends with `</body></html>` and carries the right `<link>`/`<script src>` references.

## Notes

- **Claude can't open a local `file://` page in Chrome on its own.** The Chrome `navigate` tool forces an `https://` prefix onto the URL (turning `file:///D:/...` into `https://file:///D:/...`), so the page never loads. The user must paste/load the `file://` address into the MCP-controlled tab; Claude then continues from that tab (read_page / javascript_tool / computer all work once the page is actually loaded). The MCP-controlled tab must be initiated by Cowork (e.g. via `tabs_create_mcp`) — a tab opened by the Claude extension directly in Chrome is not accessible to Cowork.
- **The MCP tab group is scoped to the current session and does not carry over.** A tab group created in an earlier conversation/session is invisible to a new one — `tabs_context_mcp` in a fresh session reports no tab group at all, even if the user still has that old tab open in their browser. The user re-pasting the `file://` address into that stale tab does **not** help; Claude needs its **own** tab handle in the **current** session. So each time this comes up in a new session: Claude calls `tabs_context_mcp` with `createIfEmpty: true` (or `tabs_create_mcp`) to get a fresh empty tab in *this* session's group first, tells the user the tab is ready, and only then does the user paste/load the `file://` address into it.
- A browser tab merely **viewing** a local file does not write to it and cannot truncate it; it only shows a stale render until reloaded. It is not a cause of file-corruption issues.
- The session **outputs** scratch folder (under `C:\Users\…\local_…\outputs`) is ephemeral and separate from the project; files there don't need cleanup and won't travel with the repo.
