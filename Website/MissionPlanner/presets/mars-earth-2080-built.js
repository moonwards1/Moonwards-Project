// Mars → Earth Feb 2080, built: the same mission as its unbuilt twin, solved —
// technology and waypoints defined.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses.

export var marsEarth2080BuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2480821.8214487047,
	"nextStage": 6,
	"stages": [
		{
			"id": "stg-5",
			"moduleId": "orbital-skyhook",
			"params": {
				"body": "Mars",
				"orbitPlane": "equatorial",
				"releasePhaseDeg": 241.22,
				"relAlt": 4580882
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
							"nrm": -580
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
						-210564385738.2588,
						-114345089380.1409,
						2848798685.139185
					],
					"v": [
						11443.309947534564,
						-16915.9704501123,
						-633.3129466979573
					],
					"jd": 2480821.8214487047
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
				"waypoints": [
					{
						"days": 37.513952351111065,
						"burn": {
							"pro": 0,
							"rad": 0.10519046337777217,
							"nrm": -3.0860815253492206
						}
					}
				],
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
