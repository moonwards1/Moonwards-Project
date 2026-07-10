# Website/MissionPlanner — the integrated simulator shell

This folder is where the standalone calculators compose into one mission
simulator — see [`../ARCHITECTURE.md`](../ARCHITECTURE.md), "Migration path"
step 4, and `MissionPlannerDesign.md` in this folder, Kim's UI design the
shell follows (phase-based mission tabs, comply mode). **Current status:
headless core (step 4.1) + phase-layout mockups (step 4.2, direction chosen:
mockup A, plain phase buttons).** There is no real UI or Three.js here yet;
`core/` is pure logic with Node tests, so the recompute/blocked semantics
were verified before any UI exists (step 4.3, the scaffold UI, builds on top
of this), and `mockups/` holds the disposable step-4.2 layout mockups (see
its README; `mockups/chain-strip/` is an earlier, superseded round).

## core/ — the headless mission core

Pure ES modules, named exports, no DOM. One responsibility per file:

| File             | Named exports                                            | Purpose                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `world.js`       | `createWorld`, `deserializeWorld`, `WORLD_KIND`, `WORLD_VERSION` | World — the single source of truth: `jd` (one clock) + the mission profile (ordered stages with stable, never-reused ids). Every mutation goes through the one choke point, `world.set(change)`; listeners get `{ change, index, id, transient }` where `index` is where "dirty" starts. Versioned serialization; a save is **always storable**, feasible or not, known modules or not. |
| `diagnostics.js` | `makeDiagnostic`, `isDiagnostic`, `DIAGNOSTIC_KIND`      | The structured-diagnostic model: `{ kind, stageId, code, message, values, fix? }` — what a stage's `update()` returns instead of a packet when the mission is infeasible. Plain and JSON-able, distinguishable from a packet by `kind`.                                                                                                                                              |
| `registry.js`    | `createRegistry`, `validateDescriptor`                   | The module registry. Validates a descriptor's `id`/`title`/`accepts`/`emits`/`update` at registration (packet types checked against `PacketTypes`, so typos fail loud and early); view-facing fields (`rendersIn`, `init`, …) are optional and unexamined here. An *unregistered* id in a profile is user data, not an error — the engine reports it as a diagnostic.                 |
| `recompute.js`   | `createEngine`                                           | The chain-recompute engine. Subscribes to the World; on any change recomputes from the dirty index **downstream, in order, synchronously**. Per-stage results keyed by stage id: `ok` (with the output packet), `diagnostic`, or `blocked` (waiting on the failed stage, `update()` not called, params intact); results also carry `warnings` and `events` arrays (see the module contract below). Locks the World during a pass, so modules cannot `set()` from `update()`. |

Engine-generated diagnostic codes: `unknown-module`, `missing-input`,
`input-type-mismatch`, `module-error` (an `update()` that threw),
`bad-output`. Module-authored diagnostics use their own codes.

### The module contract (headless part)

A stage's module is called as `update(ctx, input)` where
`ctx = { world, jd, stageId, params }` and `input` is the upstream stage's
output packet (or `null`). It returns an output packet built with
`PacketTypes.make` (of a type listed in its `emits`), or `null` (nothing to
pass downstream), or a diagnostic built with `makeDiagnostic`. This is a
deliberate refinement of the `update(world, input)` sketch in
ARCHITECTURE.md: the same module can appear at more than one stage (two
transfer legs), so each call carries *that stage's* params and id.

It may instead return an **envelope**, `{ packet, warnings, events }`
(added 2026-07-09 for comply mode — see `MissionPlannerDesign.md`):

- `packet` — anything a bare return accepts (packet / `null` / diagnostic;
  a diagnostic still fails the stage hard and drops the envelope's extras).
- `warnings` — diagnostic-shaped objects that do **not** block downstream.
  This is comply mode's reporting channel: the frozen-plan stage keeps
  emitting its own output while carrying "the tech misses the plan by X"
  here. `stageId` is filled with the authoring stage's id when absent; set
  it explicitly to aim a warning at another stage.
- `events` — `[{ jd, label, ... }]` timeline entries (finite `jd`,
  non-empty `label`, extra fields pass through) for the phase sliders and
  the stage strip.

Malformed `warnings`/`events` are authoring errors and fail the stage with
a `bad-output` diagnostic. Hard-failure blocking semantics are unchanged
throughout: diagnostics (module-authored or engine-generated) still block
every downstream stage, params intact.

Imports from `../../Shared/` (`exchange-types.js`); this folder breaks if
moved without `Website/Shared/` coming along.

## Tests

`core/tests/*.test.js` — `node:test` suites, 63 tests covering World
mutations/serialization, registry validation, the
recompute/diagnostic/blocked semantics, and the warnings/events envelope
(`warnings-events.test.js`, including a comply-mode-shaped chain). Run from
the repo root:

```
node --test Website/MissionPlanner/core/tests/*.test.js
```

(If copying elsewhere to test, keep the `Website/MissionPlanner/core` +
`Website/Shared` relative layout and put a `{"type":"module"}` `package.json`
at the copy's root.)

## Not here yet

The mission-profile chain-strip UI (step 4.2 mockups first), the scaffold
shell with scissored multi-views (4.3), the worked-example default mission
(4.4), and the technology/transfer-leg modules themselves (4.5) — see
ARCHITECTURE.md for the ordering and reasoning.
