// A partly solved example: Moon → Ceres with the Moon-orbit skyhook configured
// as the departure technology and one departure-leg waypoint burn, so the
// mission carries technology but is not yet a closed, compliant flight — the
// solving is left to the user.
//
// This is a SERIALIZED WORLD (core/world.js's `serialize()` shape, at the
// current WORLD_VERSION), loaded through the same deserializeWorld path a
// share link uses.

export var moonCeres2032PartialMission = {
	"kind": "moonwards-world",
	"version": 5,
	"jd": 2463232.52165493,
	"nextStage": 10,
	"stages": [
		{
			"id": "stg-1",
			"moduleId": "moon-platform",
			"params": {}
		},
		{
			"id": "stg-8",
			"moduleId": "orbital-skyhook",
			"params": {
				"body": "Moon",
				"comAlt": 275000,
				"relAlt": 6085734.5621997425,
				"releasePhaseDeg": 95.55
			}
		},
		{
			"id": "stg-2",
			"moduleId": "departure-leg",
			"params": {
				"waypoints": [
					{
						"t": 1872,
						"burn": {
							"pro": 43,
							"rad": -425,
							"nrm": 648
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
						-28398929314.892937,
						144704613145.51385,
						22109982.89277889
					],
					"v": [
						-36380.86924673573,
						-6696.3097562403555,
						647.2185392478101
					],
					"jd": 2463233.5628152196
				},
				"arrival": {
					"body": "Ceres",
					"vInf": 6233.581699928556
				},
				"handoffWindowDays": 1,
				"waypoints": [
					{
						"days": 388.7152463824401,
						"burn": {
							"pro": 459.5124277791254,
							"rad": -91.97275681936298,
							"nrm": -2242.336750573809
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
							"pro": 459.5124277791254,
							"rad": -91.97275681936298,
							"nrm": -2242.336750573809
						}
					}
				],
				"legDays": 736.1847151550464,
				"destination": "Ceres",
				"handoff": [
					{
						"days": 389.77806160206967,
						"burn": {
							"pro": 459.5124277791254,
							"rad": -91.97275681936298,
							"nrm": -2242.336750573809
						}
					}
				]
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
