// Moon → Venus 2039, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var moonVenus2039UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2465936.841914833,
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
				"releaseJd": 2465934.25
			}
		},
		{
			"id": "stg-3",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Moon",
				"departure": {
					"r": [
						-61451329848.026634,
						-138256368432.54022,
						-282749254.83795315
					],
					"v": [
						24062.352169553,
						-11290.053342208084,
						-1274.6740105850795
					],
					"jd": 2465936.841914833
				},
				"arrival": {
					"body": "Venus",
					"vInf": 11357.955306603673
				},
				"handoffWindowDays": 1,
				"waypoints": [],
				"lunarRelease": {
					"jd": 2465934.25,
					"burn": {
						"pro": -2107.5652877263506,
						"rad": -435.4085151606207,
						"nrm": -967.4272339757163
					}
				}
			}
		},
		{
			"id": "stg-4",
			"moduleId": "transfer-leg",
			"params": {
				"waypoints": [],
				"legDays": 172.91249299934134,
				"destination": "Venus"
			}
		},
		{
			"id": "stg-5",
			"moduleId": "arrival-leg",
			"params": {
				"body": "Venus",
				"waypoints": []
			}
		}
	]
};

export var moonVenus2039UnbuiltWorkspace = "helio";
