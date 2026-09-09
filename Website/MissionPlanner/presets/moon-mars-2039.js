// An adopted-plan-only example: the state a freshly created mission carries
// once its plan is adopted on the Ephemeris tab, with no departure or arrival
// technology configured yet (moon-platform's Moon card sits bare, and the
// arrival leg ends with no capture burn) and no mid-course waypoint needed.
//
// Moon origin: release at jd 2466067.75, hand-off at jd 2466069.743 where that
// release crosses Earth's SOI (the two are ~2 days apart at this origin, see
// Notes/decisions.md 2026-09-09), Mars arrival at 5.096 km/s.
//
// This is a SERIALIZED WORLD (core/world.js's `serialize()` shape, at the
// current WORLD_VERSION), loaded through the same deserializeWorld path a
// share link uses. `plan` is the two-set history from core/revisions.js —
// this mission has only ever been adopted, never revised, so `latest` is null.

export var moonMars2039Mission = {
	kind: "moonwards-world",
	version: 5,
	jd: 2466067.75,
	nextStage: 6,
	stages: [
		{ id: "stg-1", moduleId: "moon-platform", params: {} },
		{
			id: "stg-2",
			moduleId: "departure-leg",
			params: { waypoints: [], releaseJd: 2466067.75 }
		},
		{
			id: "stg-3",
			moduleId: "adopted-plan",
			params: {
				origin: "Moon",
				departure: {
					r: [144540011809.642, 37788221841.802246, 129271343.3518278],
					v: [-10945.984778206774, 31676.0369943115, 803.1498587747895],
					jd: 2466069.742964474
				},
				arrival: { body: "Mars", vInf: 5095.523897126727 },
				handoffWindowDays: 1,
				waypoints: [],
				lunarRelease: {
					jd: 2466067.75,
					burn: { pro: 2784.250395381644, rad: 1728.5477472237542, nrm: 717.3694806025901 }
				}
			}
		},
		{
			id: "stg-4",
			moduleId: "transfer-leg",
			params: { waypoints: [], legDays: 456.9185012411326, destination: "Mars" }
		},
		{ id: "stg-5", moduleId: "arrival-leg", params: { body: "Mars", waypoints: [] } }
	]
};

export var moonMars2039Workspace = "body:Earth-Moon";
