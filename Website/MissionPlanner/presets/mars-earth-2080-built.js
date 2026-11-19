// Mars → Earth Feb 2080, built: the same mission as its unbuilt twin, solved —
// technology and waypoints defined.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses.

export var marsEarth2080BuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2481081.278436642,
	"nextStage": 6,
	"stages": [
		{
			"id": "stg-5",
			"moduleId": "orbital-skyhook",
			"params": {
				"body": "Mars",
				"orbitPlane": "equatorial",
				"releasePhaseDeg": 241.19,
				"relAlt": 4580881.667467543
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
							"pro": 1,
							"rad": -43,
							"nrm": -582
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

export var marsEarth2080BuiltWorkspace = "helio";
