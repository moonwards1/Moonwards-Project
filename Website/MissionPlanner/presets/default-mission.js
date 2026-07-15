// The worked-example default mission (migration-path step 4.4): Kim's
// Moon -> Ceres 2031 design, fine-tuned (2026-07-10, Lambert re-solve of the
// waypoint burn against the vector-patched skyhook release model) so it
// genuinely rendezvouses instead of demonstrating a miss warning.
//
//   release   2031-12-20 06:00 UT — lunar skyhook, CoM 275 km, release from
//             the tether top at 6000 km, phase 92 deg (aimed so the lunar
//             v-infinity of 5.90 km/s leaves near Earth's heliocentric
//             prograde; Earth-escape v-infinity 5.50 km/s), followed by a
//             P 1.07 / R 0.49 / N 0.28 km/s (net 1.21) injection completing
//             the departure — folded into one hand-off state below (see
//             "migrated" note)
//   waypoint  day 475, at 2.97 AU moving 12.25 km/s —
//             P 2.14 / R -1.18 / N -2.73 km/s  (net 3.66)
//   arrival   2034-01-08 (750 days), miss 0.0001 AU,
//             3.78 km/s relative to Ceres; required departure v∞ 6.55 km/s
//
// (Kim's original numbers carried a 2.85 km/s burn at a low-Earth perigee;
// the scaffold's patched-conic release has no geocentric leg and therefore
// no Oberth gain, so the tuned burns differ from the plotted ones — see the
// lunar-skyhook module header.)
//
// MIGRATED 2026-07-14 (Kim): the departure hand-off is a given heading and
// speed, not a burn formula — "only a minority of the delta-v needed to get
// somewhere comes from engine burns" — so frozen-plan/transfer-leg no longer
// carry a departure-burn field at all (see transfer-leg.js's header). This
// preset originally baked departure.v as the raw skyhook-release state and
// carried the 1.07/0.49/0.28 km/s injection above as a SEPARATE, still-live
// transfer-leg burn — the one place in the codebase where that old
// convention survived, and exactly what let a pasted copy of this mission
// silently lose that injection on the way back into the Ephemeris tab.
// departure.v below now folds that injection directly into the hand-off
// state (computeRelease's release state, then that same burn applied to it
// via O.applyBurn — one-time migration, not a live computation), so the
// required departure v∞ is now the single true figure (6.55 km/s) a
// departure technology must deliver, matching how every other mission's
// frozen plan already works.
//
// The profile is the full comply-mode chain (task C1): skyhook (the tech) →
// frozen-plan (the commitment, baked from this same design, so the shipped
// mission complies with itself) → transfer-leg (the working coast). Detuning
// the skyhook shows plan-deviation warnings while the coast keeps showing
// the frozen plan's trajectory.
//
// This is a SERIALIZED WORLD (core/world.js `serialize()` shape), loaded
// through the same deserializeWorld path a share link uses — the whole point
// of the step. The curation half of 4.4 (which pane arrangement teaches
// best) waits for the fuller interface; re-curating is editing this file.
//
// Pure data + one pure export, so Node tests can verify the shipped preset
// actually loads and arrives.

export var defaultMission = {
	kind: "moonwards-world",
	version: 1,
	jd: 2463220.75,        // the clock opens at the release epoch
	nextStage: 4,
	stages: [
		{
			id: "stg-1",
			moduleId: "lunar-skyhook",
			params: {
				comAlt: 275e3,
				topAlt: 6000e3,
				relAlt: 6000e3,
				releasePhaseDeg: 92,
				releaseJd: 2463220.75
			}
		},
		{
			// The frozen flight plan (task C1): the mission's commitment,
			// captured as if E2 had spawned this tab from the Ephemeris tab.
			// departure.r is the skyhook release position baked at full
			// precision from computeRelease(defaults) (2026-07-11); departure.v
			// is that release velocity with the P1.07/R0.49/N0.28 km/s
			// injection folded in (migrated 2026-07-14 — see this file's header)
			// — so this IS the coast's true starting state, no burn left
			// hiding on transfer-leg. arrival vInf is the leg's speed relative
			// to Ceres at release + 750 d.
			id: "stg-3",
			moduleId: "frozen-plan",
			params: {
				origin: "Earth",
				departure: {
					r: [5856642340.899307, 147066185880.355, 0],
					v: [-36785.2006878309, 1422.8029976413443, 236.73516629337746],
					jd: 2463220.75
				},
				arrival: { body: "Ceres", jd: 2463970.75, vInf: 3776.34 },
				waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }]
			}
		},
		{
			id: "stg-2",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }],
				legDays: 750,
				destination: "Ceres"
			}
		}
	]
};

// Workspace suggestion for a fresh load (no saved workspace yet): open on
// the departure system, per the phase the mission starts in.
export var defaultWorkspaceMain = "body:Earth-Moon";
