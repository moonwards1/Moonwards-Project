// The worked-example default mission — Moon → Ceres 2031, the mission a fresh
// browser opens with when nothing is saved and no share link is present
// (planner.js's initialMissions). Also the first entry in the example-mission
// dropdown (presets/examples-catalog.js).
//
//   release   2031-12-19 ~19:06 UT (jd 2463220.2961 — the plan's frozen
//             release ANCHOR; see TIMING below) — lunar skyhook, CoM 275 km,
//             release from the tether top at 6000 km, phase 92 deg
//   injection 2031-12-20 06:00 UT (jd 2463220.75) — the epoch the plan's
//             departure impulse was authored at, one SOI crossing before the
//             hand-off (see THE HAND-OFF below)
//   hand-off  2031-12-21 ~21:14 UT (jd 2463222.3845) — the plan's committed
//             Departure→Coast hand-off, at EARTH'S SOI EDGE, required
//             departure v∞ 6.55 km/s, hand-off window ±1 d
//   waypoint  day 473.365 of the coast, at 2.97 AU moving 12.25 km/s —
//             P 2.14 / R -1.18 / N -2.73 km/s  (net 3.66)
//   arrival   2034-01-08 (748.365 days after hand-off), miss 0.0001 AU,
//             3.78 km/s relative to Ceres
//
// THE CHAIN:
//
//   moon-platform → orbital-skyhook → departure-leg → frozen-plan →
//   transfer-leg → arrival-leg
//
// moon-platform emits the chain base (the Moon's own ~1 km/s), the skyhook
// appends its rotor, and the headless departure-leg evaluates the chain at the
// plan's frozen release anchor and integrates the released ship with restricted
// N-body gravity (Shared/geo-leg.js) out to Earth-SOI exit — the delivered
// hand-off frozen-plan measures against its window. The mission ends at the
// arrival flyby: the arrival-tech slot is empty, symmetric with the empty
// departure-tech slot (both are filled from the mission view's technology
// cards).
//
// THE HAND-OFF IS AT EARTH'S SOI EDGE, where the departure leg above actually
// delivers its ship, and where core/freeze.js commits a plan authored on the
// Ephemeris tab (see that file's header). The plan's departure state is the
// authored injection — a 6.55 km/s impulse on Earth's own state at jd
// 2463220.75 — followed out along its own arc to the SOI crossing 1.6345 d
// later; the coast's duration and its waypoint day are measured from there, so
// every absolute epoch (the waypoint burn, the Ceres rendezvous) is exactly
// where it was before the hand-off moved out.
//
// TIMING: the departure leg's releaseJd below is seeded the way core/freeze.js
// seeds it. This mission departs the MOON, so that seed is not an estimate at
// all: core/lunar-departure.js integrates Earth + Moon + Sun from the release
// out to Earth's SOI and solves for the flight that delivers the plan's own
// required v∞ (6.55 km/s), giving a lead of 2.0884 d =
// 2463222.3845 − 2.0884 = 2463220.296116752. Both epochs name the SOI exit, so
// the crossing is counted once, not once by the estimate and again by the
// coast. The epoch belongs to the departure phase, not to the plan
// (core/release-epoch.js).
//
// THE DELIBERATE GAP: released at that epoch with phase 92, the chain delivers
// v∞ ≈ 5.41 km/s against the committed 6.55, aimed ≈ 23.9° off, with the
// hand-off ≈ 0.47 d late but INSIDE the ±1 d window. So this mission opens
// showing vinf-mismatch and aim-mismatch warnings against a compliant epoch —
// on purpose. Closing that gap (a low-perigee Oberth impulse on the departure
// leg, say) is the mission-planning exercise this preset teaches, and it is the
// one example that ships non-compliant; every other entry in the catalog is
// compliant by construction. The coast flies the FROZEN plan's state
// regardless, so the mission still rendezvouses clean.
//
// This is a SERIALIZED WORLD (core/world.js's `serialize()` shape, at the
// current WORLD_VERSION — kept up to date rather than relying on load-time
// migration, so this file is also the canonical example of the chain's present
// shape), loaded through the same deserializeWorld path a share link uses.
//
// Pure data, so Node tests can verify the shipped preset actually loads,
// integrates, and arrives.

export var defaultMission = {
	kind: "moonwards-world",
	version: 5,
	jd: 2463220.180402478,   // the clock opens at the release anchor
	nextStage: 7,
	stages: [
		{
			// The Moon card: read-only top of the departure stack.
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
				releasePhaseDeg: 92
			}
		},
		{
			// The headless integrated departure flight.
			id: "stg-3",
			moduleId: "departure-leg",
			params: { releaseJd: 2463220.296116752, waypoints: [] }
		},
		{
			// The frozen flight plan: the mission's commitment, shaped exactly
			// as core/freeze.js would have written it had this tab been spawned
			// from the Ephemeris tab. departure.r/v/jd are the SOI-edge hand-off
			// the authored injection reaches (see this file's header);
			// arrival vInf is the leg's speed relative to Ceres at the
			// rendezvous; handoffWindowDays is the plan's own timing field (the
			// release epoch lives on the departure leg — see the header).
			id: "stg-4",
			moduleId: "frozen-plan",
			params: {
				origin: "Moon",
				departure: {
					r: [660083682.164505, 147206054850.250427, 33427377.406683],
					v: [-36804.3535975916, 557.9835955893, 236.6369368047],
					jd: 2463222.384503543
				},
				arrival: { body: "Ceres", vInf: 3776.34 },
				handoffWindowDays: 1,
				waypoints: [{ days: 473.365496, burn: { pro: 2140, rad: -1180, nrm: -2730 } }]
			}
		},
		{
			id: "stg-5",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 473.365496, burn: { pro: 2140, rad: -1180, nrm: -2730 } }],
				legDays: 748.365496,
				destination: "Ceres"
			}
		},
		{
			// The arrival flyby leg: the visible Coast→Arrival hand-off — starts
			// a day out along the delivered heading, passes Ceres at SOI/2, ends
			// a day past. No burns programmed: the unburned pass-by is the
			// shipped state, and capturing is the user's exercise.
			id: "stg-6",
			moduleId: "arrival-leg",
			params: { body: "Ceres", waypoints: [] }
		}
	]
};

// Workspace suggestion for a fresh load, when no saved workspace exists: open
// on the departure system (mission-view.js's `defaultMain`).
export var defaultWorkspaceMain = "body:Earth-Moon";
