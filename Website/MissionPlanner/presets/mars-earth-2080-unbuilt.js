// Mars → Earth Feb 2080, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses.

export var marsEarth2080UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2480821.875,
	"nextStage": 6,
	"stages": [
		{
			"id": "stg-5",
			"moduleId": "orbital-skyhook",
			"params": {
				"body": "Mars",
				"orbitPlane": "equatorial",
				"releasePhaseDeg": 241.88,
				"relAlt": 4575156.383957516
			}
		},
		{
			"id": "stg-1",
			"moduleId": "body-departure-leg",
			"params": {
				"waypoints": [
					{
						"t": 186408,
						"burn": {
							"pro": 0,
							"rad": 0,
							"nrm": -606
						}
					}
				],
				"releaseJd": 2480819.30709859
			}
		},
		{
			"id": "stg-2",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Mars",
				"departure": {
					"r": [
						-210562891601.69025,
						-114357806009.63629,
						2850175479.736669
					],
					"v": [
						11443.143917318934,
						-16914.50578006711,
						-641.4431976787047
					],
					"jd": 2480821.8275318784
				},
				"arrival": {
					"body": "Earth",
					"vInf": 9732.183105223674
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
				"legDays": 259.5376388733275,
				"destination": "Earth"
			}
		},
		{
			"id": "stg-4",
			"moduleId": "arrival-leg",
			"params": {
				"body": "Earth",
				"waypoints": []
			}
		}
	]
};

export var marsEarth2080UnbuiltWorkspace = "helio";
