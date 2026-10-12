// Venus → Mercury 2037, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var venusMercury2037UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2465254.338377183,
	"nextStage": 5,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "body-departure-leg",
			"params": {
				"waypoints": [],
				"releaseJd": 2465188.90736825
			}
		},
		{
			"id": "stg-2",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Venus",
				"departure": {
					"r": [
						13974002586.750439,
						106773658793.66838,
						573682977.732963
					],
					"v": [
						-30051.876565110335,
						3125.5896162184226,
						950.7800372698712
					],
					"jd": 2465190.25
				},
				"arrival": {
					"body": "Mercury",
					"vInf": 15674.966851534373
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
				"legDays": 66.09026532107964,
				"destination": "Mercury"
			}
		},
		{
			"id": "stg-4",
			"moduleId": "arrival-leg",
			"params": {
				"body": "Mercury",
				"waypoints": []
			}
		}
	]
};

export var venusMercury2037UnbuiltWorkspace = "helio";
