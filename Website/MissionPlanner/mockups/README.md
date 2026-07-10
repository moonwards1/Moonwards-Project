# Mission Planner UI mockups (migration step 4.2)

Cheap, disposable, single-file HTML mockups of the mission-tab layout from
`../MissionPlannerDesign.md`. No Shared/ imports, no Three.js — flat SVG stands in
for the 3D panes. All numbers are illustrative (a made-up Luna → Ceres 2033
mission). Delete this folder once the real scaffold (step 4.3) exists.

View via `serve.bat`:

- `http://localhost:8000/MissionPlanner/mockups/mock-a-phases.html` —
  **Variant A**: the design doc as written — three phase buttons
  (Departure / Coast / Arrival), per-phase slider, main pane + two floating
  panes, sidebar tech cards, comply-mode "Plan compliance" diagnostics.
  Includes a working Ephemeris tab with the "Start Mission Plan" flow.
- `http://localhost:8000/MissionPlanner/mockups/mock-b-chain-strip.html` —
  **Variant B**: same layout, but the phase bar shows the underlying stage
  list (1–5) as chips grouped into the three phases. Clicking a chip selects
  its phase and highlights its sidebar card.

Both are interactive: click phases/chips, tabs, or a floating pane (promotes
it to the main view). Both depict the two rules agreed 2026-07-09: **comply
mode** (the frozen flight plan is authoritative; tech is diagnosed against it,
never silently re-planned) and **one shared clock** (every slider is a window
onto the same jd; event-scaled sliders pin the playhead when the clock is
outside their span).
