// The OUTER → INNER example: the largest origin SOI in the
// set and the longest transfer, falling almost the full width of the solar
// system. Jupiter self-originates its skyhook (via body-departure-leg,
// no platform stage) — no arrival technology is configured, so the flight
// ends as an unburned flyby past Mercury, same as the shipped default's own
// empty arrival slot.
//
// Solved with the same method as presets/earth-mars-reference.js (see that
// file's header for the reusable recipe): computeBodyDepartureLeg gives the
// real hand-off, a Lambert-solved waypoint burn (aimed at an offset point
// near Mercury, not its exact centre — a dead-centre Lambert target is a
// collision orbit) redirects the coast, and transfer-leg's own SOI-encounter
// integration confirms the real flyby. Compliant BY CONSTRUCTION: the frozen
// plan's departure/arrival fields are copied verbatim from what the tech
// actually delivers (including the ARRIVAL figure being the leg's raw v∞ AT
// ITS OWN END EPOCH, per arrival-approach.js's approachAt — NOT the
// asymptotic v∞ the closest-approach event reports, since the leg ends close
// enough to periapsis that the two differ).
//
//   release   2035-06-01 (jd 2464479.5) — a skyhook orbiting Jupiter itself
//             (CoM ~140 Mm, tip ~245 Mm — Jupiter's default geometry, no
//             satellite modelled to seed a smaller one), phase 180 deg
//   hand-off  2035-06-24 (jd 2464502.7503403076) — Jupiter-SOI exit, v∞
//             23.49 km/s local
//   waypoint  day 450 of the coast — a single Lambert-solved correction burn
//             (pro -18.49 / rad 8.29 / nrm -0.27 km/s, 20.27 km/s total) —
//             genuinely this large: falling from Jupiter's distance to
//             Mercury's crosses almost the whole depth of the Sun's well
//   arrival   2039-08-02 (jd 2466002.7503403076, the leg's own end epoch),
//             Mercury closest approach at ~12,557 km altitude, v∞ 74.87 km/s
//             at leg end — genuinely this extreme: conservation of energy
//             from a near-Jupiter-distance start means whatever falls this
//             deep arrives very fast, no matter how gently it started
//
// THE HAND-OFF IS THIS PLAN'S DEPARTURE, VERBATIM. `departure` below is
// the REAL departure leg's Jupiter-SOI exit — a state a genuine carrier
// chain delivered, not an impulse at the body's centre. Both the Ephemeris
// tab and core/freeze.js now treat that state as the thing itself, so
// "Paste mission link…" reproduces this plan EXACTLY: it opens on the
// hand-off epoch, reads the v-infinity off the state, and adopts the exit
// point's own offset from Jupiter rather than re-deriving it.
// This is a SERIALIZED WORLD (core/world.js `serialize()` shape, current
// WORLD_VERSION), loaded through the same deserializeWorld path a share link
// uses. Pure data, so Node tests can verify it actually loads, integrates,
// and arrives clean.

export var jupiterMercuryMission = {
	kind: "moonwards-world",
	version: 5,
	jd: 2464479.5,   // the clock opens at the release anchor
	nextStage: 7,
	stages: [
		{
			id: "stg-1",
			moduleId: "orbital-skyhook",
			params: {
				body: "Jupiter",
				comAlt: 139822000,
				relAlt: 244688500,
				releasePhaseDeg: 180
			}
		},
		{
			id: "stg-2",
			moduleId: "body-departure-leg",
			params: { releaseJd: 2464479.5, waypoints: [] }
		},
		{
			// Compliant by construction (see header): departure/arrival copied
			// verbatim from the real computeBodyDepartureLeg / computeLeg run.
			id: "stg-3",
			moduleId: "frozen-plan",
			params: {
				origin: "Jupiter",
				departure: {
					r: [654126506587.927, 340765994188.9179, -15776133834.907137],
					v: [3008.671132521057, -9635.621244072072, 106.48324217748035],
					jd: 2464502.7503403076
				},
				arrival: { body: "Mercury", vInf: 74872.5234714629 },
				handoffWindowDays: 1,
				waypoints: [{ days: 450, burn: { pro: -18490.52786224306, rad: 8290.288029831447, nrm: -274.2022225472196 } }]
			}
		},
		{
			id: "stg-4",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 450, burn: { pro: -18490.52786224306, rad: 8290.288029831447, nrm: -274.2022225472196 } }],
				legDays: 1500,
				destination: "Mercury"
			}
		},
		{
			// The arrival-tech slot is empty, like the shipped default's: this
			// mission is about the departure/coast extremes, not a catch.
			id: "stg-6",
			moduleId: "arrival-leg",
			params: { body: "Mercury", waypoints: [] }
		}
	]
};

// Workspace suggestion for a fresh spawn: open on the departure system (the
// skyhook orbiting Jupiter itself).
export var jupiterMercuryWorkspace = "body:Jupiter";
