# Moonwards Project — working notes for Claude

## Touching files

The shell (Bash / PowerShell) and the Read / Write / Edit tools see the same
filesystem, immediately and consistently. Use whichever fits the job:

- **Bulk moves — copying, slicing, concatenating, relocating** — belong in the
  shell (`cp`, `sed -n '165,1257p' src > new.js`, `awk`). Do not re-emit
  thousands of lines through the Write tool when a shell command will do it.
- **Targeted content edits** belong in the **Edit** tool: it matches exactly
  and fails loudly rather than silently mangling, which `sed` will not.
- **Leave the original in place** until whatever replaced it is verified, so a
  bad write can be restored rather than reconstructed. Before a large edit to
  an important file, keep the previous content recoverable — a copy, or the
  original untouched.
- Deleting a project file is possible from the shell, but check with Kim
  first — he usually wants to see the change in GitHub Desktop anyway.

(Older versions of these notes described an eventually-consistent mount that
served truncated or NUL-padded reads. That was a property of a previous shell
tool and does not apply now. If shell reads ever start disagreeing with the
Read tool again, say so rather than working around it silently.)

## Project structure

**The site is live** at <https://moonwards1.github.io/Moonwards-Project/>
(GitHub Pages serves `Website/` as committed, no build step). Local viewing
goes through **`serve.bat`** at the repo root — ES modules do not load over
`file://`, so double-clicking an `.html` does not work.

`Website/` has three areas, each with its own detailed rules in
`.claude/rules/`, which load when you touch files there:

- **`Calculators/`** — the standalone tools, one folder each.
- **`Shared/`** — the common ES-module libraries every tool imports.
- **`MissionPlanner/`** — where those calculators compose into one mission
  simulator. This is where nearly all current work happens.

`Website/ARCHITECTURE.md` covers the model they rest on: World, modules,
packets, the recompute chain, frames.

## Documentation: three tiers, one home each

Task docs, READMEs, and code comments tend to re-fight for the same space as
the project revises mid-stream — a comment or task item accretes "originally
X, then we realized Y, so now Z" instead of just stating the current Z. Keep
three tiers separate so nothing has to double as both a current description
and a history of how it got that way:

- **Current-state docs** — READMEs, design docs, and code comments. Always
  describe things as they are today; rewritten in place when something
  changes, never appended to with superseded alternatives or chronology.
- **Decisions log** — `Notes/decisions.md`. Terse, dated entries for settled
  architecture decisions that are load-bearing for more than one file (a
  formula, a clamp, a structural rule). States the decision and the one-line
  why; not a narrative of how it was debated. **When a decision is replaced,
  rewrite or remove its entry — never leave it standing beside its
  replacement.** A log holding several versions of one rule is worse than no
  log, and it will be read as current. Tracked in git: the READMEs link to it.
- **Changelog** — `Notes/changelog.md`. Transient, plain-language notes for
  Kim after a natural chunk of work, ending in a suggested commit message.
  Cleared once the change is committed — git log is the permanent record after
  that. Gitignored, since tracking drafts that get deleted is pure churn.

Code comments state the current invariant only — no chronology, no rejected
alternatives, no narrating the conversation that produced them. If a comment
is tempted to explain "why we changed this," that content belongs in the
decisions log (if it's a lasting rule) or nowhere (if it was just
deliberation) — not in the comment. In practice the tell is the phrase "used
to", "no longer", "originally", or "the old X": rewrite as a statement about
what is true now. Explaining why an *obvious alternative* is wrong is fair
game and often valuable — that is a live invariant, not history.

**There is no task doc, and don't start one.** Work comes from Kim directly,
a request at a time; a task doc that tracks completed work becomes a second,
stale account of the code within weeks, which is why the Mission Planner's
were retired.

### The two notes folders

- **`Notes/`** is mine to maintain and Kim's to read — `decisions.md` and
  `changelog.md`, nothing else. Anything I write for the project that isn't a
  README, a code comment, or the design doc belongs here.
- **`Notes-and-Obsolete/`** is **Kim's own working material** — sketches,
  SVG and Blender mockups, bug screenshots, and running to-do lists he keeps
  for himself. His description: disorganized, half-baked, highly provisional.
  **Do not read it, search it, cite it, or write into it unless Kim points at
  a specific file.** In particular `ToDo-MissionPlanner.md` is a scratchpad,
  never a spec — quoting an item back at him as though it were settled work
  wastes his time correcting the premise.

Repo-wide greps sweep everything, so when searching for how something works,
exclude that folder rather than reading what comes back.

## Where the rest of this lives

Area-specific guidance is in `.claude/rules/`, scoped by path so each file
loads only when you touch the code it covers: `mission-planner.md`,
`shared-libraries.md`, `calculators.md`. Put new area-specific guidance there
rather than growing this file, which loads in full every session.

## Code conventions

- **ES modules throughout** — `import`/`export` with **named exports**, one
  `<script type="module">` per page. `Shared/three.min.js` (global `THREE`) is
  the sole classic script; pages using Three.js load it with a plain tag
  before their module.
- **Module code runs in strict mode**, so assigning to an undeclared variable
  throws at runtime. Declare everything.
- **Keep pure logic pure** — maths and formatting take and return plain
  values, no DOM, so they stay Node-testable. Test them directly in Node with
  `import`; the root `package.json` is `"type": "module"`.
- **One responsibility per file**, one folder per module or calculator, CSS
  class prefixes per tool.
- New orbital-mechanics maths goes in `Shared/math-utils.js` with a Node test,
  never inline.

## Git: Kim commits, Claude doesn't

- **The repo is operated from Kim's side (GitHub Desktop):** Claude edits
  files; Kim reviews the diff in Desktop, commits, and pushes. This is a
  review workflow, not a technical limit — do not run `git add`/`commit`/
  `checkout`/`branch` unless Kim asks for it in so many words.
- Read-only commands (`git log`, `git show`, `git diff`, `git status`) from
  the shell are fine and useful — `git log -S` is often the fastest way to
  date when a behaviour changed.
- The repo is `https://github.com/moonwards1/Moonwards-Project` (org `moonwards1`), default branch **`master`**. The published site is `Website/` via GitHub Pages (workflow: `.github/workflows/deploy-pages.yml`, deploys on push). `Notes-and-Obsolete/` is untracked by `.gitignore`.

## Concurrency: more than one job may touch a file

- This project is sometimes worked on from more than one thread/job; two jobs editing the same file can clobber each other.
- Before editing a file that another job may have touched, **re-Read it immediately** so the edit is based on current content. Don't rely on a remembered version after a gap.
- Prefer to edit any given file from **one thread at a time**.

## Verifying in a browser

The integrated Browser pane (`preview_start`, `navigate`, `read_page`,
`read_console_messages`, `computer`) persists within a session and needs no
external tab management. Locally, `preview_start` with `name: "serve.bat"` or
navigate straight to `http://localhost:8000/…` — **the served root is
`Website/`**, mirroring GitHub Pages, so local URLs carry no `Website/`
prefix. For the deployed site, navigate to
<https://moonwards1.github.io/Moonwards-Project/…>.

Two traps:

- `serve.bat` prints its "Serving…" banner *before* Python starts, so check
  for a line like `Serving HTTP on :: port 8000` to confirm the server is
  really up. The root URL renders blank while `index.html` is a stub — open a
  tool's URL instead.
- **The browser caches ES modules, and this WILL produce false negatives.**
  After editing a module a plain reload can keep running the old copy, because
  the page's module graph comes from the HTTP cache. This once made a correct
  change look inert for several rounds of debugging. Fetching the file and
  seeing the new content proves only what the *server* has, not what the page
  *loaded*; and `fetch(url, {cache: "no-store"})` deliberately does not update
  the cache, so it fixes nothing. What works: `fetch(url, {cache: "reload"})`
  for each changed module, then reload the page. When a verified-correct
  change appears to do nothing, suspect this before suspecting the code.

## Who does what

**Kim** — founder and owner, years into this project. Does the design side:
worldbuilding, artwork, writing, working in Blender with some Unreal. Has real
knowledge of planetary science, space development and orbital mechanics, and
researches realistic infrastructure and logistics together with Claude. **Does
not write code** — so explain in terms of what the app does and why, not in
terms of the diff.

**Claude** — writes all the code, and has primary responsibility for keeping
the architecture organized, subject to Kim's review. Free to advise and make
suggestions on anything, and is consulted on engineering, materials science
and orbital mechanics as much as on software.

**ToughSF** — consulted for technical review of website material once live.
Kim has been active with them in the past; communication is through their
Discord server.
