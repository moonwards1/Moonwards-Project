// Mars → Jupiter 2037, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var marsJupiter2037UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2465321.5,
	"nextStage": 5,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "body-departure-leg",
			"params": {
				"waypoints": [],
				"releaseJd": 2465320.5115334545
			}
		},
		{
			"id": "stg-2",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Mars",
				"departure": {
					"r": [
						196318226593.52917,
						80318830659.18268,
						-3140894293.416357
					],
					"v": [
						-10325.015107976094,
						30896.265802093178,
						522.5146689115668
					],
					"jd": 2465321.5
				},
				"arrival": {
					"body": "Jupiter",
					"vInf": 60779.741492950634
				},
				"handoffWindowDays": 1,
				"waypoints": [
					{
						"days": 392.3701466276847,
						"burn": {
							"pro": 0,
							"rad": 0,
							"nrm": -150.40772621662197
						}
					}
				]
			}
		},
		{
			"id": "stg-3",
			"moduleId": "transfer-leg",
			"params": {
				"waypoints": [
					{
						"days": 392.3701466276847,
						"burn": {
							"pro": 0,
							"rad": 0,
							"nrm": -150.40772621662197
						}
					}
				],
				"legDays": 635.5193989947438,
				"destination": "Jupiter"
			}
		},
		{
			"id": "stg-4",
			"moduleId": "arrival-leg",
			"params": {
				"body": "Jupiter",
				"waypoints": []
			}
		}
	]
};

export var marsJupiter2037UnbuiltWorkspace = "helio";
