/* MissionPlanner/core/arrival-seam.js — the Coast->Arrival seam derivation.
 *
 * The Coast->Arrival hand-off is a WINDOW around closest approach, not a fixed
 * date (MissionPlannerDesign_v2.md's Coast section) —
 *
 *   Δt = clamp( R_SOI(destination) / v∞ , 2 days , 5 days )
 *   window = [ closest approach − Δt, closest approach + ~1 day ]
 *
 * R_SOI is the destination body's own Laplace SOI radius (its own, against
 * the Sun — not a composite with any satellite); v∞ is the ship's speed
 * relative to the destination at that encounter. The Coast slider ends at the
 * window's LEFT edge (closest approach − Δt); the Arrival phase spans the whole
 * window. Both are wired up in mission-view.js — see its coastSeam/coastSpan/
 * arrivalSpan.
 *
 * NOTHING IS STORED: the seam is recomputed live from the coast’s own MEASURED
 * pass (transfer-leg’s nearestApproach) every time it recomputes, so its two
 * edges move with closest approach as the coast is tuned — smoothly, which was
 * the whole reason for taking a measurement rather than an emitted event. See
 * computeArrivalSeam below for what went wrong with the event.
 *
 * With no encounter at all against the destination (a coast that misses, or
 * a destination this leg's arc never dips inside the SOI of), there is no
 * v∞ to measure — the window collapses to a single point at the plan's own
 * committed arrival epoch (frozen-plan's arrival.jd, read via
 * frozen-plan.js's arrivalCommitmentFor). That is the whole of the
 * no-encounter fallback: no Δt, no window, just the plan's date.
 *
 * Pure (no DOM, no THREE) — Node-testable.
 *
 * Imports from ../../Shared/ and this folder — this file breaks if moved
 * without them coming along.
 */

import { originSoiRadius } from "./departure-estimate.js";

var DAY = 86400;

export var SEAM_MIN_DAYS = 2;      // lower clamp — small bodies (Ceres, say) still
                                    // get a workable window
export var SEAM_MAX_DAYS = 5;      // upper clamp — a presentation choice, not physics;
                                    // keeps giant-SOI arrivals from running months
export var ARRIVAL_TAIL_DAYS = 1;  // the window's right edge past closest approach

// Δt (days): the destination SOI-crossing time at the ship's approach speed,
// clamped to [SEAM_MIN_DAYS, SEAM_MAX_DAYS]. null when either input is
// non-positive or non-finite — nothing meaningful to time.
export function seamDeltaDays(rSoiM, vInfMps) {
	if (!(isFinite(rSoiM) && rSoiM > 0) || !(isFinite(vInfMps) && vInfMps > 0)) { return null; }
	var days = rSoiM / vInfMps / DAY;
	return Math.max(SEAM_MIN_DAYS, Math.min(SEAM_MAX_DAYS, days));
}

// The destination's own closest-approach event, from a leg's emitted events —
// the earliest one whose body matches, if more than one somehow qualifies.
// null if there is none.
//
// NOT the seam's own input any more: computeArrivalSeam takes a measured pass
// (transfer-leg's nearestApproach) instead, because an event can be absent or
// truncated exactly when the pass sits near the leg's end. Kept for readers
// that genuinely want the event — the events bar, tests.
export function findClosestApproach(events, destination) {
	if (!Array.isArray(events) || !destination) { return null; }
	var hit = null;
	for (var i = 0; i < events.length; i++) {
		var e = events[i];
		if (e && e.kind === "closest-approach" && e.body === destination) {
			if (!hit || e.jd < hit.jd) { hit = e; }
		}
	}
	return hit;
}

// The seam, derived live. spec = {
//   destination,        // the arrival commitment's body name
//   pass,                // the MEASURED pass at that body — transfer-leg's
//                        // nearestApproach({ jd, vInf, rmin, insideSoi }) — or
//                        // null when the coast has none
//   fallbackArrivalJd    // the plan's committed arrival epoch (frozen-plan's
//                        // arrival.jd) — used verbatim when there's no
//                        // encounter to derive a window from
// }
//
// WHY A MEASURED PASS RATHER THAN THE EMITTED EVENT. The obvious source would
// be transfer-leg's closest-approach EVENT, but that is emitted per SOI
// encounter and measured inside the leg's own span. Both properties fail at the
// worst moment: a pass sitting near the leg's end reports the leg boundary
// instead of the periapsis, and a pass whose encounter falls past the leg end
// emits no event at all — either way the window collapses to the plan's
// committed epoch and the Arrival phase lands on the wrong days,
// discontinuously, as a coast waypoint is tuned. nearestApproach measures the
// same thing continuously across the leg AND its overrun, so the seam moves
// smoothly with the coast instead of jumping between branches.
//
// `insideSoi` is what makes it an encounter: a coast that merely comes closest
// half an AU away has a measurable pass but no arrival to open a window around.
//
// Returns { hasEncounter, jd, deltaDays, start, end, vInf, rmin }:
//   jd          — closest approach epoch, or the fallback epoch
//   deltaDays   — Δt, or null when there's no encounter
//   start       — the Coast slider's own end: jd − Δt, or just jd when there's
//                 no encounter (the window collapses to a point)
//   end         — the Arrival window's right edge: jd + ARRIVAL_TAIL_DAYS, or
//                 just jd with no encounter
export function computeArrivalSeam(spec) {
	var pass = spec.pass;
	if (pass && pass.insideSoi && isFinite(pass.jd)) {
		var rSoi = originSoiRadius(spec.destination);
		var dt = seamDeltaDays(rSoi, pass.vInf);
		if (dt == null) { dt = SEAM_MIN_DAYS; }   // an encounter with no usable v∞ still gets a window
		return {
			hasEncounter: true, jd: pass.jd, deltaDays: dt,
			start: pass.jd - dt, end: pass.jd + ARRIVAL_TAIL_DAYS,
			vInf: pass.vInf, rmin: pass.rmin
		};
	}
	var jd = spec.fallbackArrivalJd;
	return { hasEncounter: false, jd: jd, deltaDays: null, start: jd, end: jd, vInf: null, rmin: null };
}
