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

- **The Departure card is a velocity at the SOI edge, not an impulse.** Its
  three numbers are the ship's speed relative to the escape reference where it
  crosses that body's sphere of influence, on the reference's heliocentric
  prograde/normal/radial axes — the same axes at every origin. It states a
  boundary condition and says nothing about how the ship got there. It is NOT
  the hyperbolic excess: the primary still has a grip at the SOI edge (928.5
  m/s for Earth), so anything working in energy terms converts first —
  `asymptoticVInf` out, `edgeVInf` back. **The drawn arc flies the asymptote;
  the card and every readout state the edge speed.**
- **At a MOON origin the card is the technology's share alone.** It is what the
  ship had to spend energy to supply. The Moon's own motion is deliberately not
  in it, because that part is free — the ship inherits it by leaving a body
  that is already moving, and it shows up as extra REACH rather than a smaller
  bill (a bonus, not a discount; on the wrong lunar phase, a penalty). The
  flown arc is card + residual, so the same card on a different day of the
  month is a different trajectory. Never add the two before showing them: the
  split is the whole point, and conflating them is the mistake this origin
  invites.
- **The flown flight is the clock.** `frozen-plan` emits what the departure
  technology actually DELIVERED — position, velocity and epoch — so the drawn
  coast is the ship's flight and the Coast timeline starts where the Departure
  timeline ends. The plan's frozen state is the REQUIREMENT (and the fallback
  when nothing is delivered), never a second flight on a second clock. Moving
  the plan onto what is flown is the Update button's deliberate commit
  (`core/retarget.js`), never something the boundary does by itself.
- **The arrival date is measured.** The plan commits to a destination body and
  an approach v∞, never to a date; the mission arrives at the coast's own
  measured closest approach. `transfer-leg`'s `legDays` is the coast's
  HORIZON, not an arrival date, and is what a re-target aims over.
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
