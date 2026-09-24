// A partly solved example: Ceres → Mars with a Ceres-orbit skyhook departure
// AND a Mars-orbit skyhook catch both configured — departure, coast and
// arrival all carry technology, unlike moon-ceres-2032-partial.js (arrival
// left to the user). Opens straight into the Arrival phase (workspace
// "body:Mars"), so the catch skyhook and the arrival chevron are visible
// without switching phases first.
//
// This is a SERIALIZED WORLD (core/world.js's `serialize()` shape, at the
// current WORLD_VERSION), loaded through the same deserializeWorld path a
// share link uses.

export var ceresMars2038PartialMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2466258.6744445856,
	"nextStage": 7,
	"stages": [
		{
			"id": "stg-6",
			"moduleId": "orbital-skyhook",
			"params": {
				"body": "Ceres",
				"releasePhaseDeg": 280.5,
				"comAlt": 200000,
				"relAlt": 5262568.589765181
			}
		},
		{
			"id": "stg-1",
			"moduleId": "body-departure-leg",
			"params": {
				"waypoints": [
					{
						"t": 720,
						"burn": {
							"pro": 0,
							"rad": -3,
							"nrm": 2693
						}
					}
				],
				"releaseJd": 2465494.63285244
			}
		},
		{
			"id": "stg-2",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Ceres",
				"departure": {
					"r": [
						44396642257.70099,
						-426718438110.0965,
						-21634901955.31487
					],
					"v": [
						14921.690869241591,
						133.95094260512946,
						-65.16131787827962
					],
					"jd": 2465494.8783874535
				},
				"arrival": {
					"body": "Mars",
					"vInf": 5292.2028086924465
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
						"days": 453.65541786698367,
						"burn": {
							"pro": 4.5,
							"rad": 22.142373951547228,
							"nrm": 25.52207448081774
						}
					},
					{
						"days": 745.8353043296374,
						"burn": {
							"pro": -17.84319135377743,
							"rad": 5.740216717276345,
							"nrm": 7.0160859859815385
						}
					}
				],
				"legDays": 762.9999512308277,
				"destination": "Mars"
			}
		},
		{
			"id": "stg-4",
			"moduleId": "arrival-leg",
			"params": {
				"body": "Mars",
				"waypoints": []
			}
		},
		{
			"id": "stg-5",
			"moduleId": "arrival-skyhook",
			"params": {
				"body": "Mars",
				"comAlt": 2550000,
				"relAlt": 9111430.15128086,
				"releasePhaseDeg": 0
			}
		}
	]
};

export var ceresMars2038PartialWorkspace = "body:Mars";
