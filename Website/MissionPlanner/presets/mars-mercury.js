// The EXTREME-Δv example: pushes departure AND arrival
// delta-v up together, rather than either extreme in isolation — Mars
// self-originates its skyhook (no platform stage), and the fall to Mercury,
// deep in the Sun's well, delivers a genuinely large arrival v∞ on top of a
// real mid-course correction burn. No arrival technology configured, like
// the other extremes in the set.
//
// Solved with the same method as presets/earth-mars-reference.js (see that
// file's header for the reusable recipe): computeBodyDepartureLeg gives the
// real hand-off, a Lambert-solved waypoint burn (aimed at an offset point
// near Mercury, not its exact centre) redirects the coast, and transfer-
// leg's own SOI-encounter integration confirms the real flyby. Compliant BY
// CONSTRUCTION: the frozen plan's departure/arrival fields are copied
// verbatim from what the tech actually delivers.
//
//   release   2032-09-01 (jd 2463476.5) — a skyhook orbiting Mars itself,
//             CoM at Phobos's own orbit radius (Mars' default geometry),
//             phase 285 deg — chosen (by scanning release phase) for the
//             lowest heliocentric speed, i.e. the most retrograde-leaning
//             start available, since falling in toward Mercury wants to
//             SHED energy, not add it
//   hand-off  2032-09-04 (jd 2463479.5958245187) — Mars-SOI exit, v∞
//             2.949 km/s local
//   waypoint  day 77 of the coast — a single Lambert-solved correction burn
//             (pro -5.46 / rad 2.43 / nrm -1.73 km/s, 6.22 km/s total)
//   arrival   2033-04-12 (jd 2463699.5958245187, the leg's own end epoch,
//             landing essentially at closest approach), Mercury closest
//             approach at ~12,476 km altitude, v∞ 16.13 km/s at leg end —
//             genuinely this large: crossing from Mars' distance to
//             Mercury's is most of the depth of the inner solar system's
//             potential well
//
// THE HAND-OFF IS THIS PLAN'S DEPARTURE, VERBATIM. `departure` below is
// the REAL departure leg's Mars-SOI exit — a state a genuine carrier
// chain delivered, not an impulse at the body's centre. Both the Ephemeris
// tab and core/freeze.js now treat that state as the thing itself, so
// "Paste mission link…" reproduces this plan EXACTLY: it opens on the
// hand-off epoch, reads the v-infinity off the state, and adopts the exit
// point's own offset from Mars rather than re-deriving it.
// This is a SERIALIZED WORLD (core/world.js `serialize()` shape, current
// WORLD_VERSION), loaded through the same deserializeWorld path a share link
// uses. Pure data, so Node tests can verify it actually loads, integrates,
// and arrives clean.

export var marsMercuryMission = {
	kind: "moonwards-world",
	version: 5,
	jd: 2463476.5,   // the clock opens at the release anchor
	nextStage: 7,
	stages: [
		{
			id: "stg-1",
			moduleId: "orbital-skyhook",
			params: {
				body: "Mars",
				comAlt: 5986500,
				relAlt: 10674500,
				releasePhaseDeg: 285
			}
		},
		{
			id: "stg-2",
			moduleId: "body-departure-leg",
			params: { releaseJd: 2463476.5, waypoints: [] }
		},
		{
			// Compliant by construction (see header): departure/arrival copied
			// verbatim from the real computeBodyDepartureLeg / computeLeg run.
			id: "stg-3",
			moduleId: "frozen-plan",
			params: {
				origin: "Mars",
				departure: {
					r: [-171105883657.2049, 178363221563.01913, 7947056055.387644],
					v: [-14931.949183460785, -13416.610756130991, 97.27008525638203],
					jd: 2463479.5958245187
				},
				arrival: { body: "Mercury", vInf: 16128.24344031587 },
				handoffWindowDays: 1,
				waypoints: [{ days: 77, burn: { pro: -5464.7864681775045, rad: 2425.545260281457, nrm: -1731.5463029351615 } }]
			}
		},
		{
			id: "stg-4",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 77, burn: { pro: -5464.7864681775045, rad: 2425.545260281457, nrm: -1731.5463029351615 } }],
				legDays: 220,
				destination: "Mercury"
			}
		},
		{
			// The arrival-tech slot is empty, like the shipped default's: this
			// mission is about the departure/arrival delta-v extremes, not a
			// catch.
			id: "stg-6",
			moduleId: "arrival-leg",
			params: { body: "Mercury", waypoints: [] }
		}
	]
};

// Workspace suggestion for a fresh spawn: open on the departure system (the
// skyhook orbiting Mars itself).
export var marsMercuryWorkspace = "body:Mars";
