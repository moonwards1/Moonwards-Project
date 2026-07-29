// The COMPLIANT reference example: unlike the shipped
// default (presets/default-mission.js), which deliberately ships a v∞/aim
// gap as a teaching exercise, this mission's frozen-plan commitment is
// EXACTLY what the configured technology actually delivers at both
// boundaries — built by running the real departure/coast physics first
// (orbital-skyhook + departure-leg's computeDepartureLeg, transfer-leg's
// computeLeg with a Lambert-solved waypoint correction) and then copying
// the genuine result back into frozen-plan's departure/arrival fields, so
// opening it shows a clean flight with no comply-boundary warnings — a
// state nothing else in the example set demonstrates. Also the only example
// carrying a configured arrival-skyhook CATCH (modules/arrival-skyhook/arrival-skyhook.js,
// real trim-Δv physics, not a stub), since the other examples leave arrival
// tech empty like the default.
//
//   release   2033-01-10 (jd 2463607.5) — lunar skyhook, CoM 275 km,
//             release from the tether top at 6000 km, phase 195 deg (chosen
//             by scanning release phase for a low, sanely-aimed v∞ at this
//             anchor — see the solving note below)
//   hand-off  2033-01-12 (jd 2463610.059797283) — Earth-SOI exit, v∞
//             4.771 km/s local / 4.772 km/s vs Earth — this IS the frozen
//             plan's departure requirement, verbatim
//   waypoint  day 91 of the coast — a single Lambert-solved correction burn
//             (pro -0.317 / rad -3.044 / nrm -1.132 km/s, 3.26 km/s total)
//             aimed at a 50,000 km flyby offset from Mars, not its exact
//             centre (a dead-centre Lambert target is a collision orbit)
//   arrival   2033-09-29 (jd 2463870.059797283, the leg's own end epoch),
//             Mars closest approach at ~47,900 km (real integrated SOI
//             encounter, not an estimate) with an asymptotic v∞ 4.669 km/s —
//             but the commitment below is 4.857 km/s, the RAW relative
//             speed AT THE LEG'S END, because that is what arrival-boundary
//             actually compares (arrival-approach.js's approachAt, measured
//             at the delivered state's own epoch, not the encounter event's
//             asymptotic figure) — leg end sits close enough to periapsis
//             that the two numbers genuinely differ. What arrival-skyhook's
//             default Mars geometry (CoM at Phobos's orbit) actually catches
//             is a 2.24 km/s trim burn against the true periapsis speed.
//
// SOLVING METHOD (reusable for the other example missions): run
// computeDepartureLeg with a chosen release anchor + skyhook geometry to
// get the REAL heliocentric hand-off state (no target to hit — whatever the
// tech delivers, delivers); two-body-propagate that state to a waypoint day;
// Lambert-solve from there to a flyby-offset point near the destination at
// the desired arrival epoch; decompose the resulting Δv into the waypoint's
// pro/rad/nrm via OrbitalMath.burnComponents; run transfer-leg's real
// computeLeg (whose SOI-encounter physics finds the true closest approach,
// not just the Lambert aim point) to confirm a clean flyby; then copy the
// departure hand-off and the leg's own "closest-approach" event straight
// into frozen-plan's departure/arrival fields. Verified end-to-end through
// the real module chain (see modules/tests/ — same registry/engine
// machinery, not reimplemented physics) before being shipped here.
//
// This is a SERIALIZED WORLD (core/world.js `serialize()` shape, current
// WORLD_VERSION), loaded through the same deserializeWorld path a share
// link uses. Pure data, so Node tests can verify it actually loads,
// integrates, and arrives clean.

export var earthMarsReferenceMission = {
	kind: "moonwards-world",
	version: 4,
	jd: 2463607.5,   // the clock opens at the release anchor, like the shipped default
	nextStage: 9,
	stages: [
		{
			id: "stg-1",
			moduleId: "moon-platform",
			params: {}
		},
		{
			id: "stg-2",
			moduleId: "orbital-skyhook",
			params: {
				body: "Moon",
				comAlt: 275e3,
				topAlt: 6000e3,
				relAlt: 6000e3,
				releasePhaseDeg: 195
			}
		},
		{
			id: "stg-3",
			moduleId: "departure-leg",
			params: { waypoints: [] }
		},
		{
			// Compliant by construction: departure/arrival below are copied
			// verbatim from the real computeDepartureLeg / computeLeg results
			// this preset's header describes, so the tech's delivered state
			// matches the plan's commitment exactly at both boundaries.
			id: "stg-4",
			moduleId: "frozen-plan",
			params: {
				origin: "Earth",
				departure: {
					r: [-55250072397.27843, 135366879897.14548, -26223756.651247278],
					v: [-27527.926707411603, -16220.510078668216, -68.4829236571825],
					jd: 2463610.059797283
				},
				arrival: { body: "Mars", jd: 2463870.059797283, vInf: 4856.648803943818 },
				handoffWindowDays: 1,
				releaseAnchorJd: 2463607.5,
				waypoints: [{ days: 91, burn: { pro: -316.9993726441208, rad: -3044.1368693226227, nrm: -1132.4501990653685 } }]
			}
		},
		{
			id: "stg-5",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 91, burn: { pro: -316.9993726441208, rad: -3044.1368693226227, nrm: -1132.4501990653685 } }],
				legDays: 260,
				destination: "Mars"
			}
		},
		{
			id: "stg-6",
			moduleId: "arrival-boundary",
			params: {}
		},
		{
			id: "stg-7",
			moduleId: "arrival-leg",
			params: { body: "Mars", waypoints: [] }
		},
		{
			// The one example carrying a configured arrival technology (task
			// H2): the generic skyhook catch, run in reverse, at Mars' default
			// geometry (CoM at Phobos's own orbit radius).
			id: "stg-8",
			moduleId: "arrival-skyhook",
			params: { body: "Mars" }
		}
	]
};

// Workspace suggestion for a fresh spawn: open on the departure system (the
// Moon in Earth-Moon space), matching the shipped default's own choice.
export var earthMarsReferenceWorkspace = "body:Earth-Moon";
