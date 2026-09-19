// A partly solved example: Moon → Ceres with the Moon-orbit skyhook configured
// as the departure technology, one departure-leg waypoint burn and one coast
// correction. Departure and coast are solved — the flight passes Ceres about
// 16,700 km up — and the arrival is left to the user. The clock opens at the
// release, matching the Departure view the example opens in.
//
// This is a SERIALIZED WORLD (core/world.js's `serialize()` shape, at the
// current WORLD_VERSION), loaded through the same deserializeWorld path a
// share link uses.

export var moonCeres2032PartialMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2463232.5,
	"nextStage": 7,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "moon-platform",
			"params": {}
		},
		{
			"id": "stg-6",
			"moduleId": "orbital-skyhook",
			"params": {
				"body": "Moon",
				"comAlt": 275000,
				"releasePhaseDeg": 92.6,
				"relAlt": 6276450.124643876
			}
		},
		{
			"id": "stg-2",
			"moduleId": "departure-leg",
			"params": {
				"waypoints": [
					{
						"t": 2124,
						"burn": {
							"pro": -17,
							"rad": -149,
							"nrm": 760
						}
					}
				],
				"releaseJd": 2463232.5
			}
		},
		{
			"id": "stg-3",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Moon",
				"departure": {
					"r": [
						-28364582435.009884,
						144716937102.4821,
						18219083.514521513
					],
					"v": [
						-36451.605420177,
						-6655.939414769096,
						621.647051874142
					],
					"jd": 2463233.5499391896
				},
				"arrival": {
					"body": "Ceres",
					"vInf": 5830.069093394039
				},
				"handoffWindowDays": 1,
				"waypoints": [
					{
						"days": 389.7833477959881,
						"burn": {
							"pro": 677,
							"rad": 572,
							"nrm": -2279
						}
					}
				],
				"lunarRelease": {
					"jd": 2463232.5,
					"burn": {
						"pro": 5988.7883798402,
						"rad": -718.4194919208977,
						"nrm": 624.8010181222755
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
						"days": 389.77806160206967,
						"burn": {
							"pro": 677.2,
							"rad": 572.8,
							"nrm": -2278.7
						}
					}
				],
				"legDays": 744.9962834394537,
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

export var moonCeres2032PartialWorkspace = "body:Earth-Moon";
