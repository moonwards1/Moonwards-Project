// Earth → Venus 2039, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var earthVenus2039UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2465944.5,
	"nextStage": 5,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "body-departure-leg",
			"params": {
				"waypoints": [],
				"releaseJd": 2465941.482681413
			}
		},
		{
			"id": "stg-2",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Earth",
				"departure": {
					"r": [
						-43392714092.126625,
						-145401984128.38226,
						-422566791.0049597
					],
					"v": [
						25312.2308885708,
						-7626.533088908821,
						-1429.6695552240442
					],
					"jd": 2465944.5
				},
				"arrival": {
					"body": "Venus",
					"vInf": 11473.816692485563
				},
				"handoffWindowDays": 1,
				"waypoints": []
			}
		},
		{
			"id": "stg-3",
			"moduleId": "transfer-leg",
			"params": {
				"waypoints": [],
				"legDays": 169.02030443027616,
				"destination": "Venus"
			}
		},
		{
			"id": "stg-4",
			"moduleId": "arrival-leg",
			"params": {
				"body": "Venus",
				"waypoints": []
			}
		}
	]
};

export var earthVenus2039UnbuiltWorkspace = "helio";
