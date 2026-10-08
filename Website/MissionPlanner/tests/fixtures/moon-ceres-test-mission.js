// MissionPlanner/tests/fixtures/moon-ceres-test-mission.js — a complete
// Moon → Ceres 2031 mission, used as sample data by the Node test suites.
// Nothing in the running app loads it, and it is not an example mission.
//
// It is a serialized World (core/world.js's `serialize()` shape at the current
// WORLD_VERSION), loaded the same way a share link is, so a test gets a whole
// mission to recompute, measure and edit:
//
//   moon-platform → orbital-skyhook → departure-leg → adopted-plan →
//   transfer-leg → arrival-leg
//
//   release    jd 2463220.2961 (2031-12-19) — lunar skyhook, CoM 275 km,
//              release from the tether top at 6000 km, phase 94.49 deg;
//              the departure leg's `releaseJd`
//   hand-off   jd 2463222.3845 (2031-12-21) — the plan's committed
//              Departure→Coast state at Earth's SOI edge, window ±1 d
//   waypoint   day 473.365 of the coast — P 2.14 / R -1.18 / N -2.73 km/s
//   coast      748.365 days, to Ceres; the arrival-tech slot is empty
//
// The skyhook UNDER-DELIVERS against the plan on purpose — lower v∞ and aimed
// off the plan's heading — so the suites exercise the non-compliant case:
// compliance warnings, the coast still flying the plan's own state, and
// re-targeting from what was actually delivered.
//
// Its numbers were solved against the planet and asteroid positions in
// Shared/orbit.js as they stood before the 2030–2130 element fit
// (Notes/decisions.md). Against the current positions its coast passes Ceres
// at 0.023 AU, outside the 0.02 AU arrival bound, so the tests that require
// it to reach Ceres fail until it is re-solved.
//
// The plan carries no `lunarRelease`, so the Ephemeris tab cannot reopen it
// for revision: a lunar departure is authored forward from the release, and
// this plan's release is not recoverable from its hand-off.

export var moonCeresTestMission = {
	kind: "moonwards-world",
	version: 5,
	jd: 2463220.180402478,   // the clock opens at the release anchor
	nextStage: 7,
	stages: [
		{
			// The Moon card: read-only top of the departure stack.
			id: "stg-1",
			moduleId: "moon-platform",
			params: {}
		},
		{
			id: "stg-2",
			moduleId: "orbital-skyhook",
			params: {
				body: "Moon",
				comAlt: 275e3,
				relAlt: 6000e3,
				releasePhaseDeg: 94.49
			}
		},
		{
			// The headless integrated departure flight.
			id: "stg-3",
			moduleId: "departure-leg",
			params: { releaseJd: 2463220.296116752, waypoints: [] }
		},
		{
			// The adopted flight plan: the mission's commitment, shaped exactly
			// as core/adopt.js would have written it had this tab been spawned
			// from the Ephemeris tab. departure.r/v/jd are the SOI-edge hand-off
			// the authored injection reaches (see this file's header);
			// arrival vInf is the leg's speed relative to Ceres at the
			// rendezvous; handoffWindowDays is the plan's own timing field (the
			// release epoch lives on the departure leg — see the header).
			id: "stg-4",
			moduleId: "adopted-plan",
			params: {
				origin: "Moon",
				departure: {
					r: [660083682.164505, 147206054850.250427, 33427377.406683],
					v: [-36804.3535975916, 557.9835955893, 236.6369368047],
					jd: 2463222.384503543
				},
				arrival: { body: "Ceres", vInf: 3776.34 },
				handoffWindowDays: 1,
				waypoints: [{ days: 473.365496, burn: { pro: 2140, rad: -1180, nrm: -2730 } }]
			}
		},
		{
			id: "stg-5",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 473.365496, burn: { pro: 2140, rad: -1180, nrm: -2730 } }],
				legDays: 748.365496,
				destination: "Ceres"
			}
		},
		{
			// The arrival flyby leg: the visible Coast→Arrival hand-off — starts
			// a day out along the delivered heading, passes Ceres at SOI/2, ends
			// a day past. No burns programmed: the unburned pass-by is what
			// the tests expect.
			id: "stg-6",
			moduleId: "arrival-leg",
			params: { body: "Ceres", waypoints: [] }
		}
	]
};
