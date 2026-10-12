// Moon → Ceres 2031, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var moonCeres2031UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2463199.341899692,
	"nextStage": 6,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "moon-platform",
			"params": {}
		},
		{
			"id": "stg-2",
			"moduleId": "departure-leg",
			"params": {
				"waypoints": [],
				"releaseJd": 2463197.5
			}
		},
		{
			"id": "stg-3",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Moon",
				"departure": {
					"r": [
						59413684728.787094,
						135176881934.81624,
						363305176.59248626
					],
					"v": [
						-34189.69767889611,
						12829.122271871836,
						2210.5262524053983
					],
					"jd": 2463199.341899692
				},
				"arrival": {
					"body": "Ceres",
					"vInf": 6194.477343691286
				},
				"handoffWindowDays": 1,
				"waypoints": [],
				"lunarRelease": {
					"jd": 2463197.5,
					"burn": {
						"pro": 5634.005069610844,
						"rad": 1875.105336504882,
						"nrm": 1999.852647057253
					}
				}
			}
		},
		{
			"id": "stg-4",
			"moduleId": "transfer-leg",
			"params": {
				"waypoints": [],
				"legDays": 572.2110941093415,
				"destination": "Ceres"
			}
		},
		{
			"id": "stg-5",
			"moduleId": "arrival-leg",
			"params": {
				"body": "Ceres",
				"waypoints": []
			}
		}
	]
};

export var moonCeres2031UnbuiltWorkspace = "helio";
