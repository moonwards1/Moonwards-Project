// Earth → Mars 2035, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var earthMars2035UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2464527.5,
	"nextStage": 5,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "body-departure-leg",
			"params": {
				"waypoints": [],
				"releaseJd": 2464524.6376789184
			}
		},
		{
			"id": "stg-2",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Earth",
				"departure": {
					"r": [
						66821096891.55222,
						-136662050631.63367,
						-156149676.76366913
					],
					"v": [
						29521.39678919771,
						14047.090884251387,
						-610.0257588172334
					],
					"jd": 2464527.5
				},
				"arrival": {
					"body": "Mars",
					"vInf": 5929.043868304022
				},
				"handoffWindowDays": 1,
				"waypoints": [
					{
						"days": 154.1659362923178,
						"burn": {
							"pro": -33.662109971413756,
							"rad": -777.8310956923391,
							"nrm": 686.674558356039
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
						"days": 154.1659362923178,
						"burn": {
							"pro": -33.662109971413756,
							"rad": -777.8310956923391,
							"nrm": 686.674558356039
						}
					}
				],
				"legDays": 302.3063148041256,
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
		}
	]
};

export var earthMars2035UnbuiltWorkspace = "helio";
