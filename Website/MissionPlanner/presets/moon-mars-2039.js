// An adopted-plan-only example: the state a freshly created mission carries
// once its plan is adopted on the Ephemeris tab, with no departure or arrival
// technology configured yet (moon-platform's Moon card sits bare, and the
// arrival leg ends with no capture burn) and no mid-course waypoint needed.
//
// Moon origin, jd 2466067.75 departure hand-off, Mars arrival at 5.096 km/s.
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
					r: [146340488362.37106, 32300335632.5578, -10293020.447654689],
					v: [-9951.990737688151, 31915.985066837253, 803.5950547092622],
					jd: 2466067.75
				},
				arrival: { body: "Mars", vInf: 5095.648390144863 },
				handoffWindowDays: 1,
				waypoints: [],
				lunarRelease: {
					jd: 2466067.75,
					burn: { pro: 2885.5185079315834, rad: 1760.3507268094106, nrm: 734.9497746059197 }
				}
			}
		},
		{
			id: "stg-4",
			moduleId: "transfer-leg",
			params: { waypoints: [], legDays: 458.9114657151513, destination: "Mars" }
		},
		{ id: "stg-5", moduleId: "arrival-leg", params: { body: "Mars", waypoints: [] } }
	]
};

export var moonMars2039Workspace = "body:Earth-Moon";
