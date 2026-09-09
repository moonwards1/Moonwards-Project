// An adopted-plan-only example: the state a freshly created mission carries
// once its plan is adopted on the Ephemeris tab, with no departure or arrival
// technology configured yet (moon-platform's Moon card sits bare, and the
// arrival leg ends with no capture burn). One mid-course waypoint burn is
// part of the adopted plan itself, needed to reach the destination.
//
// Moon origin, jd 2463232.5 departure hand-off, Ceres arrival at 6.234 km/s.
//
// This is a SERIALIZED WORLD (core/world.js's `serialize()` shape, at the
// current WORLD_VERSION), loaded through the same deserializeWorld path a
// share link uses. `plan` is the two-set history from core/revisions.js —
// this mission has only ever been adopted, never revised, so `latest` is null.

export var moonCeres2032Mission = {
	kind: "moonwards-world",
	version: 5,
	jd: 2463232.5,
	nextStage: 6,
	stages: [
		{ id: "stg-1", moduleId: "moon-platform", params: {} },
		{
			id: "stg-2",
			moduleId: "departure-leg",
			params: { waypoints: [], releaseJd: 2463232.5 }
		},
		{
			id: "stg-3",
			moduleId: "adopted-plan",
			params: {
				origin: "Moon",
				departure: {
					r: [-25049083820.26364, 145285585657.73358, -36017688.29711221],
					v: [-36487.1126339701, -6111.122899150319, 616.3186187658914],
					jd: 2463232.5
				},
				arrival: { body: "Ceres", vInf: 6233.581699928556 },
				handoffWindowDays: 1,
				waypoints: [
					{
						days: 389.77806160206967,
						burn: { pro: 459.5124277791254, rad: -91.97275681936298, nrm: -2242.336750573809 }
					}
				],
				lunarRelease: {
					jd: 2463232.5,
					burn: { pro: 5988.7883798402, rad: -718.4194919208977, nrm: 624.8010181222755 }
				}
			}
		},
		{
			id: "stg-4",
			moduleId: "transfer-leg",
			params: {
				waypoints: [
					{
						days: 389.77806160206967,
						burn: { pro: 459.5124277791254, rad: -91.97275681936298, nrm: -2242.336750573809 }
					}
				],
				legDays: 736.1847151550464,
				destination: "Ceres"
			}
		},
		{ id: "stg-5", moduleId: "arrival-leg", params: { body: "Ceres", waypoints: [] } }
	]
};

export var moonCeres2032Workspace = "body:Earth-Moon";
