---
paths:
  - "Website/MissionPlanner/**"
---

# Mission Planner

The integrated mission simulator — where the standalone calculators compose
into one app. `Website/MissionPlanner/README.md` describes what the code does
now and is the first thing to read; `MissionPlannerDesign_v2.md` beside it is
Kim's design for what it should become; `Website/ARCHITECTURE.md` covers the
model both rest on (World, modules, packets, the recompute chain).

## Where the rules live

`Notes/decisions.md` holds the settled rules that cut across several files —
phase seams, timelines, waypoint controls, the technology-platform shape, the
compliance contract. **Read it before changing anything structural.** Several
of its entries exist because the obvious approach is wrong in a way that fails
silently (closest approach measured off the drawn polyline; disposing a shared
THREE geometry on teardown; giving a scene overlay a background). Don't
restate its content in code comments — cite the entry and its date.

## The shape

- `core/` — pure logic, no DOM, Node-tested: the World and its serialization,
  the recompute engine, diagnostics, the freeze contract, the arrival seam,
  the arrival standards, the delivered flight, the re-target solve.
- `modules/` — the mission-profile stages, one folder each, default-exporting
  a descriptor the shell `import()`s dynamically. Technology platforms are one
  folder of substance plus two thin role adapters (`modules/platform/`).
- `ui/` — shell-local widgets (phase slider, ship card, share link, the tech
  catalog).
- `presets/` — the shipped mission and the example catalog, checked in as
  serialized Worlds.
- `planner.js` + `mission-view.js` + `ephemeris-view.js` + `scene-frames.js` —
  the browser shell over `core/`.

## Invariants worth knowing before you start

- **`frozen-plan` is authoritative.** It always emits the PLAN's departure
  state downstream, so the drawn coast is the plan's flight, not the ship's.
  The mission bar (`core/delivered-flight.js`) is the honest read of what the
  technology actually delivers. The two disagreeing is the point.
- **A phase is a labeled sub-range of the one ordered stage list.** Stages
  compose in sequence; compliance at a seam is ONE boundary comparison. Never
  "reconcile" events within or across a phase.
- **The clock draws, it never computes.** No module's `update()` may read
  `world.jd` — a `world.set({ jd })` deliberately recomputes nothing.
- **Every carrier/leg packet names its `body` explicitly**, never implying one.

## Verifying

Node suites, from the repo root:

```
node --test Website/MissionPlanner/core/tests/*.test.js Website/MissionPlanner/modules/tests/*.test.js Website/MissionPlanner/ui/tests/*.test.js
```

In the browser, via `serve.bat`: `http://localhost:8000/MissionPlanner/planner.html`
(the served root is `Website/`, so no `Website/` prefix in local URLs).

Aim the camera with chevron-focus and a timeline scrub before zooming in the
Browser pane, rather than panning blind.
