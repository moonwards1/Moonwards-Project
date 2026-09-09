// An adopted-plan-only example: the state a freshly created mission carries
// once its plan is adopted on the Ephemeris tab, with no departure or arrival
// technology configured yet (the body-departure leg has no platform stage
// ahead of it, and the arrival leg ends with no capture burn). One mid-course
// waypoint burn is part of the adopted plan itself, needed to reach the
// destination. A non-Earth/Moon origin, so the mission is a body-departure-leg
// chain rather than moon-platform + departure-leg.
//
// Ceres origin, jd 2462565.375 departure hand-off, Mercury arrival at
// 24.763 km/s.
//
// This is a SERIALIZED WORLD (core/world.js's `serialize()` shape, at the
// current WORLD_VERSION), loaded through the same deserializeWorld path a
// share link uses. `plan` is the two-set history from core/revisions.js —
// this mission has only ever been adopted, never revised, so `latest` is null.

export var ceresMercury2030Mission = {
	kind: "moonwards-world",
	version: 5,
	jd: 2462565.375,
	nextStage: 5,
	stages: [
		{
			id: "stg-1",
			moduleId: "body-departure-leg",
			params: { waypoints: [], releaseJd: 2462565.2268148344 }
		},
		{
			id: "stg-2",
			moduleId: "adopted-plan",
			params: {
				origin: "Ceres",
				departure: {
					r: [435455454230.67017, -24591045377.766712, -81001615078.1912],
					v: [285.7624250474148, 10641.363019809329, 284.26747563092204],
					jd: 2462565.375
				},
				arrival: { body: "Mercury", vInf: 24762.58486029521 },
				handoffWindowDays: 1,
				waypoints: [
					{
						days: 41.996356485704005,
						burn: { pro: -2633.610681923129, rad: 5.901134443339174, nrm: 940.868824755456 }
					}
				]
			}
		},
		{
			id: "stg-3",
			moduleId: "transfer-leg",
			params: {
				waypoints: [
					{
						days: 41.996356485704005,
						burn: { pro: -2633.610681923129, rad: 5.901134443339174, nrm: 940.868824755456 }
					}
				],
				legDays: 408.97496447805315,
				destination: "Mercury"
			}
		},
		{ id: "stg-4", moduleId: "arrival-leg", params: { body: "Mercury", waypoints: [] } }
	]
};

export var ceresMercury2030Workspace = "body:Ceres";
