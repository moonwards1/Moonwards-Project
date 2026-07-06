# Earth Aerobrake Reality-Check Calculator

A sizing sanity-check for the inbound Ceres-fleet manoeuvre described in
`Moonwards society technology/In process/CeresTransportSystem.md` (sections
*Ceres-moon flights* and *Ceres elevator + spin launcher (inbound)*).

A ship returns from Ceres on a hyperbolic approach to Earth, makes **one grazing
pass** through the upper atmosphere, and exits into a very eccentric orbit whose
**apoapsis is near the edge of Earth's sphere of influence** — where the
inclination/periapsis burn that sets up the lunar encounter is cheap. The pass
sheds only a small slice off the top of the entry speed, so this is the
*grazing* regime, not a steep capsule entry.

## What it computes

- **Speed to shed** — from the entry speed down to the periapsis speed of an
  ellipse whose apoapsis is the chosen fraction of the SOI radius. (Only ~2 km/s
  out of ~13: the target orbit is *barely* bound, just below escape.)
- **Peak deceleration (g)** — grazing-pass model; depends on the speed shed and
  the trajectory geometry, **independent of ballistic coefficient**.
- **Ballistic coefficient, periapsis depth, dynamic pressure** — set by the
  ship's mass and heat-shield area. This is the swing variable: a compact ship
  dives deep into dense air (high pressure, high flux); a large, low-β
  decelerator brakes high and gently.
- **Convective heat flux and a first-cut heat-shield mass** — Sutton–Graves
  stagnation flux × soak time ÷ PICA heat of ablation, with a margin factor,
  compared against the proposed heat-shield mass budget.

## Inputs of note

- *Braking periapsis altitude* is only the nominal radius used for the orbital
  speeds (which are insensitive to it). The **actual** braking altitude is an
  output, driven by the ballistic coefficient.
- *Heat-shield diameter* is the lever that sets the ballistic coefficient — try
  80 m vs 300 m and watch dynamic pressure and heat flux move.

## Caveats

- The heat-shield mass is **convective only**. Radiative heating becomes
  significant above ~11 km/s and grows with nose radius, so the larger-diameter
  designs carry an unmodelled radiative penalty — treat the TPS figure as a
  lower bound and a first reality check, not a flight sizing.
- Single grazing pass, exponential-atmosphere approximation, no lift modulation
  or guidance corridor analysis. Real speeds and corridors await a proper
  orbital simulator; TPS needs a coupled radiative/ablation code.

## Dependencies

Loads from `Website/Shared/`: `orbit.js` (Earth/Sun data), `constants.js`
(`Const`), and `math-utils.js` (`OrbitalMath` — the grazing-aerobrake helpers
`grazingPathScale`, `grazingPeakDecel`, `grazingPeriapsisDensity`,
`ballisticCoefficient`, `dynamicPressure`, `suttonGravesHeatFlux`,
`altitudeForDensity`). Breaks if its folder is moved without `Website/Shared/`
coming along. Classic scripts only, so it works opened from a `file://` link.
