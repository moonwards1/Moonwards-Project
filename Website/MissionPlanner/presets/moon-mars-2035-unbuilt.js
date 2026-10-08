// Moon → Mars 2035, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan (a lunar release, one coast waypoint, a Mars
// rendezvous) with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var moonMars2035UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2464529.4776798855,
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
				"releaseJd": 2464526.125
			}
		},
		{
			"id": "stg-3",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Moon",
				"departure": {
					"r": [
						71350164438.62598,
						-134666464857.61859,
						91848219.31611045
					],
					"v": [
						29088.757935434707,
						15302.181944212627,
						175.0707984832614
					],
					"jd": 2464529.4776798855
				},
				"arrival": {
					"body": "Mars",
					"vInf": 5825.86746250854
				},
				"handoffWindowDays": 1,
				"waypoints": [
					{
						"days": 161.12530321249304,
						"burn": {
							"pro": 13.96654214865351,
							"rad": 32.25894495168042,
							"nrm": 828.8577023605484
						}
					}
				],
				"lunarRelease": {
					"jd": 2464526.125,
					"burn": {
						"pro": 2683,
						"rad": 130.58417967401607,
						"nrm": 129.37186334050173
					}
				}
			}
		},
		{
			"id": "stg-4",
			"moduleId": "transfer-leg",
			"params": {
				"waypoints": [
					{
						"days": 161.12530321249304,
						"burn": {
							"pro": 13.96654214865351,
							"rad": 32.25894495168042,
							"nrm": 828.8577023605484
						}
					}
				],
				"legDays": 317.9499886664562,
				"destination": "Mars"
			}
		},
		{
			"id": "stg-5",
			"moduleId": "arrival-leg",
			"params": {
				"body": "Mars",
				"waypoints": []
			}
		}
	]
};

export var moonMars2035UnbuiltWorkspace = "helio";
