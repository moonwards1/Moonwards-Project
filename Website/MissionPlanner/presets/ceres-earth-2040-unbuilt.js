// Ceres → Earth 2040, unbuilt: the state a mission arrives in from the Ephemeris
// tab — the adopted plan with no departure or arrival technology configured.
//
// A SERIALIZED WORLD (core/world.js's `serialize()` shape), loaded through the
// same deserializeWorld path a share link uses. Never revised, so there is no
// plan history beyond the adoption itself.

export var ceresEarth2040UnbuiltMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2466214.25,
	"nextStage": 5,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "body-departure-leg",
			"params": {
				"waypoints": [],
				"releaseJd": 2466214.068955442
			}
		},
		{
			"id": "stg-2",
			"moduleId": "adopted-plan",
			"params": {
				"origin": "Ceres",
				"departure": {
					"r": [
						251766304901.48248,
						332214725082.20984,
						-34767329270.41875
					],
					"v": [
						-10537.037358452682,
						6949.171151845059,
						2114.5613413479678
					],
					"jd": 2466214.25
				},
				"arrival": {
					"body": "Earth",
					"vInf": 15135.76450306462
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
				"legDays": 467.3594243847765,
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

export var ceresEarth2040UnbuiltWorkspace = "helio";
