# Chain-strip mockups (Migration step 4.2)

Cheap, clickable mockups of the mission-profile chain strip — the one UI
element with no precedent in the existing tools (ARCHITECTURE.md, step 4.2) —
made for review **before** the scaffold UI (step 4.3) hardens around it.

Open via `serve.bat` at
<http://localhost:8000/MissionPlanner/mockups/chain-strip/chain-strip.html>
(the server's root is `Website/`), or on the deployed site under
`MissionPlanner/mockups/chain-strip/chain-strip.html`. Three layout variants — horizontal card
strip, vertical sidebar list, compact "metro line" — all driven by one shared
fake mission (the ARCHITECTURE.md worked example), with working
select / add / remove / reorder / swap interactions and a toggle that injects
a failure to show the diagnostic + blocked-downstream rendering.

**Disposable by design.** No imports (not even `Shared/`), no real physics —
every number is canned. Whatever direction review picks gets rebuilt properly
against `MissionPlanner/core` in step 4.3; this folder is then a design
record, not live code.
