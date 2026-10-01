// An adopted-plan-only example: the state a freshly created mission carries
// once its plan is adopted on the Ephemeris tab, with no departure or arrival
// technology configured yet and no mid-course waypoint. A plain Earth origin,
// so the mission is a body-departure-leg chain.
//
// Earth origin, jd 2464564.75 departure hand-off, Mars arrival at 4.796 km/s.
// The drawn coast passes Mars's orbit close enough, and close enough in time,
// to qualify on the Ephemeris tab — a convenient case for exercising its
// proximity rings.
//
// This is a SERIALIZED WORLD (core/world.js's `serialize()` shape, at the
// current WORLD_VERSION), loaded through the same deserializeWorld path a
// share link uses.

export var earthMars2035Mission = {
	kind: "moonwards-world",
	version: 5,
	jd: 2464564.75,
	nextStage: 5,
	stages: [
		{
			id: "stg-1",
			moduleId: "body-departure-leg",
			params: { waypoints: [], releaseJd: 2464562.225845856 }
		},
		{
			id: "stg-2",
			moduleId: "adopted-plan",
			params: {
				origin: "Earth",
				departure: {
					r: [133085443405.82668, -71437445954.54239, -81115763.65387136],
					v: [15016.076496995545, 30187.714007372684, -380.75756052456364],
					jd: 2464564.75
				},
				arrival: { body: "Mars", vInf: 4796.227361162434 },
				handoffWindowDays: 1,
				waypoints: []
			}
		},
		{
			id: "stg-3",
			moduleId: "transfer-leg",
			params: { waypoints: [], legDays: 462.9094650526531, destination: "Mars" }
		},
		{ id: "stg-4", moduleId: "arrival-leg", params: { body: "Mars", waypoints: [] } }
	]
};

export var earthMars2035Workspace = "body:Earth-Moon";
