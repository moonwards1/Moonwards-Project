// The OVERSHOOT-AND-RETURN example: the most demanding
// waypoint-tuning case in the set. The coast swings out past 3.5 AU — past
// Mars' own 1.52 AU orbit — before falling back to catch Venus at 0.72 AU,
// exercising BOTH waypoint slots (the departure/coast UI's own limit) with
// genuinely different jobs: waypoint 1 raises the apoapsis, waypoint 2
// redirects the fall onto an intercept. No arrival technology configured,
// like the other extremes in the set.
//
// Solved with the same method as presets/earth-mars-reference.js (see that
// file's header for the one-waypoint recipe) extended to two waypoints:
//
//   1. computeDepartureLeg gives the real Earth hand-off (this departure
//      phase already runs a little hot — 34.95 km/s heliocentric vs Earth's
//      own ~29.78 km/s — so the natural coast already reaches ~2 AU on its
//      own before any waypoint burn).
//   2. Waypoint 1 (day 60, a plain +3.00 km/s prograde burn — no Lambert
//      needed, just raising energy) pushes the apoapsis out to ~3.51 AU.
//      Found by a small search over burn magnitude against
//      OrbitalMath.elementsFromState's resulting apoapsis — a naive first
//      guess (9 km/s) overshot into an ESCAPE trajectory entirely (e > 1),
//      which is the whole reason to search rather than guess once.
//   3. Waypoint 2 (day 850, well past the ~day-650 apoapsis, on the way
//      back down) is Lambert-solved from there to a flyby-offset point near
//      Venus at the target arrival epoch, same technique as the one-
//      waypoint presets.
//   4. transfer-leg's own computeLeg confirms the real SOI-encounter flyby;
//      compliant BY CONSTRUCTION, with the arrival figure taken from the
//      leg's own end-state v∞ (arrival-approach.js's approachAt), not the
//      closest-approach event's asymptotic figure — see
//      earth-mars-reference.js's header for why those differ.
//
//   release   2036-01-01 (jd 2464693.5) — lunar skyhook, same CoM/tip
//             geometry as the shipped default, phase 120 deg (chosen for a
//             prograde-boosted departure, scanned the same way as the other
//             examples)
//   hand-off  2036-01-03 (jd 2464695.6110198037) — Earth-SOI exit, v∞
//             4.734 km/s local
//   waypoint 1  day 60 — +3.00 km/s prograde, apoapsis ~3.51 AU (past Mars)
//   waypoint 2  day 850 (r ≈ 3.24 AU, falling back in) — Lambert-solved
//             correction, 13.27 km/s total
//   arrival   2038-12-18 (jd 2465775.6110198037, the leg's own end epoch),
//             Venus closest approach at ~24,464 km altitude, v∞ 51.95 km/s
//             at leg end — genuinely this extreme: falling from 3.24 AU to
//             0.72 AU crosses most of the inner solar system's potential
//             well, same energy-conservation story as the outer-planet
//             examples
//
// THE HAND-OFF IS THIS PLAN'S DEPARTURE, VERBATIM. `departure` below is
// the REAL departure leg's Earth-SOI exit — a state a genuine carrier
// chain delivered, not an impulse at the body's centre. Both the Ephemeris
// tab and core/freeze.js now treat that state as the thing itself, so
// "Paste mission link…" reproduces this plan EXACTLY: it opens on the
// hand-off epoch, reads the v-infinity off the state, and adopts the exit
// point's own offset from Earth rather than re-deriving it.
// `injectionJd` below is a legacy field from when the tab authored a
// centre-of-body burn and freeze followed the arc out; nothing reads it.
//
// This is a SERIALIZED WORLD (core/world.js `serialize()` shape, current
// WORLD_VERSION), loaded through the same deserializeWorld path a share link
// uses. Pure data, so Node tests can verify it actually loads, integrates,
// and arrives clean.

export var earthVenusOvershootMission = {
	kind: "moonwards-world",
	version: 4,
	jd: 2464693.5,   // the clock opens at the release anchor
	nextStage: 8,
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
				relAlt: 6000e3,
				releasePhaseDeg: 120
			}
		},
		{
			id: "stg-3",
			moduleId: "departure-leg",
			params: { waypoints: [] }
		},
		{
			// Compliant by construction (see header): departure/arrival copied
			// verbatim from the real computeDepartureLeg / computeLeg run.
			id: "stg-4",
			moduleId: "frozen-plan",
			params: {
				origin: "Earth",
				departure: {
					r: [-30678747876.00545, 143236804776.33505, -2489001.4901082767],
					v: [-33918.082188770226, -8439.468796011004, -86.246699961888],
					jd: 2464695.6110198037
				},
				injectionJd: 2464693.617478,
				arrival: { body: "Venus", jd: 2465775.6110198037, vInf: 51950.43974646683 },
				handoffWindowDays: 1,
				releaseAnchorJd: 2464693.5,
				waypoints: [
					{ days: 60, burn: { pro: 3000, rad: 0, nrm: 0 } },
					{ days: 850, burn: { pro: -5149.660950134885, rad: 12224.491965731318, nrm: 172.47892650038924 } }
				]
			}
		},
		{
			id: "stg-5",
			moduleId: "transfer-leg",
			params: {
				waypoints: [
					{ days: 60, burn: { pro: 3000, rad: 0, nrm: 0 } },
					{ days: 850, burn: { pro: -5149.660950134885, rad: 12224.491965731318, nrm: 172.47892650038924 } }
				],
				legDays: 1080,
				destination: "Venus"
			}
		},
		{
			// The arrival-tech slot is empty, like the shipped default's: this
			// mission is about waypoint tuning on the coast, not a catch.
			id: "stg-7",
			moduleId: "arrival-leg",
			params: { body: "Venus", waypoints: [] }
		}
	]
};

// Workspace suggestion for a fresh spawn: open on the departure system.
export var earthVenusOvershootWorkspace = "body:Earth-Moon";
