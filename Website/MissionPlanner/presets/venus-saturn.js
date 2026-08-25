// The INNER → OUTER example: the mirror of
// presets/jupiter-mercury.js — a modest departure v∞ from Venus, followed
// by the largest ARRIVAL SOI in the set (Saturn's) and a multi-year coast.
// No arrival technology configured, same as the Jupiter example — this pair
// is about the departure/arrival SOI extremes and the transfer length, not
// a catch.
//
// Solved with the same method as presets/earth-mars-reference.js (see that
// file's header for the reusable recipe), with one addition this leg
// needed: the Lambert-solved waypoint burn targets a flyby point at the
// LAMBERT epoch (handoff + transferDays), but the real integrated SOI
// encounter's periapsis lands a little before that epoch — Saturn's own
// gravity is strong enough that a few days past periapsis, the leg's own
// miss distance climbs back over transfer-leg's MISS_WARN_AU. The fix:
// TRIM the leg's own emitted length (legDays below) short of the Lambert
// target so the emitted end-state sits shortly after periapsis rather than
// well past it — same arc, no re-solve, just measured earlier along it.
//
//   release   2034-03-01 (jd 2464022.5) — a skyhook orbiting Venus itself
//             (CoM ~12.1 Mm, tip ~21.2 Mm — Venus's default geometry, no
//             satellite to seed a smaller one), phase 345 deg — chosen for
//             a prograde-boosted departure (heliocentric speed ~39.1 km/s
//             vs Venus's own ~35.0 km/s), the direction an outward transfer
//             wants
//   hand-off  2034-03-02 (jd 2464024.126766075) — Venus-SOI exit, v∞
//             4.765 km/s local
//   waypoint  day 660 of the coast — a single Lambert-solved correction burn
//             (pro 7.43 / rad 12.75 / nrm 1.53 km/s, 14.84 km/s total) —
//             genuinely this large: reaching Saturn's distance from Venus's
//             is most of a Hohmann transfer across the whole outer solar
//             system
//   arrival   2040-03-08 (jd 2466221.626766075, the leg's own TRIMMED end,
//             ~1.5 days after the real periapsis), Saturn closest approach
//             at ~15,734 km altitude 2040-03-06, asymptotic v∞ 7.00 km/s —
//             but the commitment below is 9.75 km/s, the RAW relative speed
//             at the leg's own (trimmed) end epoch (arrival-approach.js's
//             approachAt) — still climbing out of Saturn's deep well at
//             that point, not yet down to the asymptotic figure
//
// THE HAND-OFF IS THIS PLAN'S DEPARTURE, VERBATIM. `departure` below is
// the REAL departure leg's Venus-SOI exit — a state a genuine carrier
// chain delivered, not an impulse at the body's centre. Both the Ephemeris
// tab and core/freeze.js now treat that state as the thing itself, so
// "Paste mission link…" reproduces this plan EXACTLY: it opens on the
// hand-off epoch, reads the v-infinity off the state, and adopts the exit
// point's own offset from Venus rather than re-deriving it.
// `injectionJd` below is a legacy field from when the tab authored a
// centre-of-body burn and freeze followed the arc out; nothing reads it.
//
// This is a SERIALIZED WORLD (core/world.js `serialize()` shape, current
// WORLD_VERSION), loaded through the same deserializeWorld path a share link
// uses. Pure data, so Node tests can verify it actually loads, integrates,
// and arrives clean.

export var venusSaturnMission = {
	kind: "moonwards-world",
	version: 4,
	jd: 2464022.5,   // the clock opens at the release anchor
	nextStage: 7,
	stages: [
		{
			id: "stg-1",
			moduleId: "orbital-skyhook",
			params: {
				body: "Venus",
				comAlt: 12103600,
				topAlt: 21181300,
				relAlt: 21181300,
				releasePhaseDeg: 345
			}
		},
		{
			id: "stg-2",
			moduleId: "body-departure-leg",
			params: { waypoints: [] }
		},
		{
			// Compliant by construction (see header): departure/arrival copied
			// verbatim from the real computeBodyDepartureLeg / computeLeg run.
			id: "stg-3",
			moduleId: "frozen-plan",
			params: {
				origin: "Venus",
				departure: {
					r: [104747025284.18042, 28223778784.303925, -5672576245.507142],
					v: [-9757.102206391384, 37821.09161834681, 982.6728206505492],
					jd: 2464024.126766075
				},
				injectionJd: 2464022.422908,
				arrival: { body: "Saturn", jd: 2466221.626766075, vInf: 9754.537416938687 },
				handoffWindowDays: 1,
				releaseAnchorJd: 2464022.5,
				waypoints: [{ days: 660, burn: { pro: 7432.959774971017, rad: 12753.660047286197, nrm: 1529.2755250152884 } }]
			}
		},
		{
			id: "stg-4",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 660, burn: { pro: 7432.959774971017, rad: 12753.660047286197, nrm: 1529.2755250152884 } }],
				legDays: 2197.5,
				destination: "Saturn"
			}
		},
		{
			// The arrival-tech slot is empty, like the shipped default's: this
			// mission is about the departure/coast extremes, not a catch.
			id: "stg-6",
			moduleId: "arrival-leg",
			params: { body: "Saturn", waypoints: [] }
		}
	]
};

// Workspace suggestion for a fresh spawn: open on the departure system (the
// skyhook orbiting Venus itself).
export var venusSaturnWorkspace = "body:Venus";
