// The worked-example default mission — Moon → Ceres 2031, the mission a fresh
// browser opens with when nothing is saved and no share link is present
// (planner.js's initialMissions). Also the first entry in the example-mission
// dropdown (presets/examples-catalog.js).
//
//   release   2031-12-17 ~19:07 UT (jd 2463218.5467 — the plan's frozen
//             release ANCHOR; see TIMING below) — lunar skyhook, CoM 275 km,
//             release from the tether top at 6000 km, phase 92 deg
//   hand-off  2031-12-20 06:00 UT (jd 2463220.75) — the plan's committed
//             Departure→Coast hand-off, required departure v∞ 6.55 km/s,
//             hand-off window ±1 d
//   waypoint  day 475 of the coast, at 2.97 AU moving 12.25 km/s —
//             P 2.14 / R -1.18 / N -2.73 km/s  (net 3.66)
//   arrival   2034-01-08 (750 days after hand-off), miss 0.0001 AU,
//             3.78 km/s relative to Ceres
//
// THE CHAIN:
//
//   moon-platform → orbital-skyhook → departure-leg → frozen-plan →
//   transfer-leg → arrival-boundary → arrival-leg
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
// TIMING: releaseAnchorJd below is baked the way core/freeze.js bakes it —
// the hand-off epoch minus core/departure-estimate.js's estimate for the plan's
// own required v∞ (6.55 km/s → dive-in profile, 2.2033 d) = 2463220.75 − 2.2033
// = 2463218.546734214. The anchor is read-only plan data.
//
// THE DELIBERATE GAP: released at the anchor with phase 92, the chain delivers
// v∞ ≈ 5.02 km/s against the committed 6.55, aimed ≈ 9.6° off, with the
// hand-off ≈ 0.51 d late but INSIDE the ±1 d window. So this mission opens
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
	version: 4,
	jd: 2463218.546734214,   // the clock opens at the release anchor
	nextStage: 8,
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
				topAlt: 6000e3,
				relAlt: 6000e3,
				releasePhaseDeg: 92
			}
		},
		{
			// The headless integrated departure flight.
			id: "stg-3",
			moduleId: "departure-leg",
			params: { waypoints: [] }
		},
		{
			// The frozen flight plan: the mission's commitment, shaped exactly
			// as core/freeze.js would have written it had this tab been spawned
			// from the Ephemeris tab. departure.r/v are the baked hand-off state
			// (release physics plus the folded-in injection — see this file's
			// header); arrival vInf is the leg's speed relative to Ceres at
			// hand-off + 750 d; releaseAnchorJd/handoffWindowDays are the timing
			// fields whose bake is recorded in the header.
			id: "stg-4",
			moduleId: "frozen-plan",
			params: {
				origin: "Earth",
				departure: {
					r: [5856642340.899307, 147066185880.355, 0],
					v: [-36785.2006878309, 1422.8029976413443, 236.73516629337746],
					jd: 2463220.75
				},
				arrival: { body: "Ceres", jd: 2463970.75, vInf: 3776.34 },
				handoffWindowDays: 1,
				releaseAnchorJd: 2463218.546734214,
				waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }]
			}
		},
		{
			id: "stg-5",
			moduleId: "transfer-leg",
			params: {
				waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }],
				legDays: 750,
				destination: "Ceres"
			}
		},
		{
			// The Coast→Arrival compliance boundary: measures what the coast
			// above delivers at Ceres against the commitment in stg-4, and
			// reports the gap as warnings. Paramless, and placed at the seam —
			// exactly where core/world.js's v3→v4 migration inserts it into
			// older saves. Its id is stg-7 rather than stg-6 for the same reason
			// that migration allocates a fresh number: stage ids are stable
			// handles, never positions, so renumbering stg-6 would rewrite an id
			// that already exists in saved missions.
			id: "stg-7",
			moduleId: "arrival-boundary",
			params: {}
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
