// Ceres → Mars 2041, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var ceresMars2041UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2466843.3878674717,
	"nextStage": 5,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "body-departure-leg",
			"params": {
				"waypoints": [],
				"releaseJd": 2466843.1176505643
			}
		},
		{
			"id": "stg-2",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Ceres",
				"departure": {
					"r": [
						-356655786958.4579,
						-148876708865.1337,
						60339229278.05442
					],
					"v": [
						4882.269322093915,
						-14584.17759868853,
						-1746.4009665466094
					],
					"jd": 2466843.375
				},
				"arrival": {
					"body": "Mars",
					"vInf": 6268.858602509178
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
				"legDays": 640.2458303356543,
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

export var ceresMars2041UnbuiltWorkspace = "helio";
