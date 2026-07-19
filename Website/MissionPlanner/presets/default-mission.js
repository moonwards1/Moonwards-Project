// The worked-example default mission (migration-path step 4.4): Kim's
// Moon -> Ceres 2031 design, fine-tuned (2026-07-10, Lambert re-solve of the
// waypoint burn against the vector-patched skyhook release model) so it
// genuinely rendezvouses instead of demonstrating a miss warning.
//
//   release   2031-12-17 ~19:07 UT (jd 2463218.5467 — the plan's frozen
//             release ANCHOR; see below) — lunar skyhook, CoM 275 km,
//             release from the tether top at 6000 km, phase 92 deg
//   hand-off  2031-12-20 06:00 UT (jd 2463220.75) — the plan's committed
//             Departure→Coast hand-off, required departure v∞ 6.55 km/s,
//             hand-off window ±1 d
//   waypoint  day 475 of the coast, at 2.97 AU moving 12.25 km/s —
//             P 2.14 / R -1.18 / N -2.73 km/s  (net 3.66)
//   arrival   2034-01-08 (750 days after hand-off), miss 0.0001 AU,
//             3.78 km/s relative to Ceres
//
// RESHAPED BY TASK I3 (WP-I, 2026-07-16): the departure is a CARRIER CHAIN
// with a real integrated flight, not a patched-conic formula —
//
//   moon-platform → lunar-skyhook → departure-leg → frozen-plan → transfer-leg
//   → arrival-leg (task H3: the flyby hand-off around Ceres)
//   → capture-burn (task H2: the baseline chemical arrival at Ceres)
//
// moon-platform emits the chain base (the Moon's own ~1 km/s), the skyhook
// appends its rotor, and the headless departure-leg evaluates the chain at
// the plan's frozen release anchor and integrates the released ship with
// restricted N-body gravity (Shared/geo-leg.js) out to Earth-SOI exit — the
// delivered hand-off the course check measures against the window.
//
// TIMING (WP-I's window + anchor model): releaseAnchorJd below is baked the
// way core/freeze.js bakes it — hand-off epoch minus the D7 departure
// estimate for the plan's own required v∞ (6.55 km/s → dive-in profile,
// 2.2033 d) = 2463220.75 − 2.2033 = 2463218.546734214. The skyhook's old
// releaseJd param is gone; the anchor is read-only plan data.
//
// THE HONEST GAP, quantified with the real integration (2026-07-16 numbers,
// from the I3 experiment run): released at the anchor with phase 92, the
// chain delivers v∞ ≈ 5.02 km/s against the committed 6.55 (the skyhook
// alone never covered the folded-in injection — see the 2026-07-14 note
// below), aimed ≈ 9.6° off, hand-off ≈ 0.51 d late but INSIDE the ±1 d
// window. So the shipped mission shows vinf-mismatch + aim-mismatch
// warnings and a compliant epoch — deliberately: closing the gap (e.g. a
// low-perigee Oberth impulse on the departure leg, task I4's UI) is the
// mission-planning exercise the preset teaches. The coast still flies the
// FROZEN plan's state regardless, so it still rendezvouses clean.
//
// (2026-07-14, Kim: the departure hand-off is a given heading and speed, not
// a burn formula — the old preset's separate 1.21 km/s injection burn was
// folded directly into the plan's departure.v, making the required v∞ the
// single true figure 6.55 km/s a departure technology must deliver. Those
// baked departure numbers are unchanged here: the commitment is the same,
// only the tech side got real physics.)
//
// This is a SERIALIZED WORLD (core/world.js `serialize()` shape, version 2),
// loaded through the same deserializeWorld path a share link uses — the
// whole point of the step. The curation half of 4.4 (which pane arrangement
// teaches best) waits for the fuller interface; re-curating is editing this
// file.
//
// Pure data, so Node tests can verify the shipped preset actually loads,
// integrates, and arrives.

export var defaultMission = {
	kind: "moonwards-world",
	version: 2,
	jd: 2463218.546734214,   // the clock opens at the release anchor
	nextStage: 8,
	stages: [
		{
			// The Moon card: read-only top of the departure stack (task I3).
			id: "stg-1",
			moduleId: "moon-platform",
			params: {}
		},
		{
			id: "stg-2",
			moduleId: "lunar-skyhook",
			params: {
				comAlt: 275e3,
				topAlt: 6000e3,
				relAlt: 6000e3,
				releasePhaseDeg: 92
			}
		},
		{
			// The headless integrated departure flight (task I3).
			id: "stg-3",
			moduleId: "departure-leg",
			params: { waypoints: [] }
		},
		{
			// The frozen flight plan (task C1): the mission's commitment,
			// captured as if E2 had spawned this tab from the Ephemeris tab.
			// departure.r/v are the 2026-07-14 baked hand-off state (release
			// physics + folded injection — see this file's header); arrival
			// vInf is the leg's speed relative to Ceres at hand-off + 750 d.
			// releaseAnchorJd/handoffWindowDays are WP-I's timing fields
			// (bake recorded in the header).
			id: "stg-4",
			moduleId: "frozen-plan",
			params: {
				origin: "Earth",
				departure: {
					r: [5856642340.899307, 147066185880.355, 0],
					v: [-36785.2006878309, 1422.8029976413443, 236.73516629337746],
					jd: 2463220.75
				},
				arrival: { body: "Ceres", jd: 2463970.75, vInf: 3776.34 },
				handoffWindowDays: 1,
				releaseAnchorJd: 2463218.546734214,
				waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }]
			}
		},
		{
			id: "stg-5",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }],
				legDays: 750,
				destination: "Ceres"
			}
		},
		{
			// The arrival flyby leg (task H3): the visible Coast→Arrival
			// hand-off — starts a day out along the delivered heading, passes
			// Ceres at SOI/2, ends a day past. No burns programmed: the
			// unburned pass-by is the shipped state; capturing is the user's
			// exercise.
			id: "stg-6",
			moduleId: "arrival-leg",
			params: { body: "Ceres", waypoints: [] }
		},
		{
			// The arrival technology (task H2): the baseline chemical capture
			// burn at Ceres — the terminal stage every mission spawns with
			// (swappable via the Arrival technology dropdown). Altitudes left
			// to the module's body-scaled defaults.
			id: "stg-7",
			moduleId: "capture-burn",
			params: { body: "Ceres" }
		}
	]
};

// Workspace suggestion for a fresh load (no saved workspace yet): open on
// the departure system, per the phase the mission starts in.
export var defaultWorkspaceMain = "body:Earth-Moon";
