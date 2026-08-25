/* MissionPlanner/core/proximity — the ONE definition of "close enough to call
 * this an arrival".
 *
 * Two independent questions, both of which must pass:
 *
 *   SPACE — is the ship's point within APPROACH_FAR of the destination's ORBIT
 *           ELLIPSE? Not of the body itself: the question is whether the path
 *           reaches where the destination travels at all. A path that misses
 *           the ring by more than this never had an encounter to time.
 *   TIME  — does the destination pass through that point within TEMP_FAR days
 *           of the ship being there? Signed phasing (Shared/sim/marker-card.js's
 *           phasingDays): + the body arrives after the ship, − it has gone by.
 *
 * Both thresholds are the outermost tier of the proximity rings the Ephemeris
 * tab draws (the tier TABLES stay with the views that render them — those are
 * colours and pixel sizes, not standards).
 *
 * That pair is the EPHEMERIS TAB'S gate on "Start Mission Plan": is the marker
 * a plausible rendezvous to build a mission around? It is a scrubbable marker
 * against a body's ring, so ring-scale tolerances are the right question.
 *
 * ADOPTION ASKS A DIFFERENT, STRICTER QUESTION — see MAX_ADOPT_MISS below.
 * Once a mission exists, re-pointing its departure is a refinement, not a
 * re-plan: the coast flown from the delivered hand-off has to actually REACH
 * the destination, not merely cross its orbit somewhere near the right month.
 * Experimentation that throws the flight further off than that is a new
 * mission to author in the Ephemeris tab, not a plan to rewrite in place.
 *
 * Both standards live here so the numbers have one home and can be compared
 * at a glance, even though they answer different questions.
 *
 * Pure: plain values in, plain values out, no DOM and no THREE, so it is
 * Node-testable directly.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { phasingDays } from "../../Shared/sim/marker-card.js";

var O = OrbitalMath;
var AU = 149597870700;

// Space: distance from the ship's point to the destination's orbit ellipse.
export var APPROACH_FAR = 0.004 * AU;      // m — the gate
export var APPROACH_NEAR = 0.001 * AU;     // m — inner ring tiers, display only
export var APPROACH_CLOSE = 0.0002 * AU;   // m

// Time: how far off the destination's own pass through that point is.
export var TEMP_FAR = 30;    // days — the gate
export var TEMP_NEAR = 10;   // days — inner ring tiers, display only
export var TEMP_CLOSE = 3;

// Is `r` (m, heliocentric) a real encounter with the body on `orbit` at epoch
// `jd`? A hyperbolic/parabolic destination has no closed ring to measure
// against, so it can never pass the space test.
//
// Returns { ok, spaceOk, timeOk, distToOrbit (m), dtDays (signed, null when
// the space test already failed — there is no meeting point to time) }.
export function checkProximity(GM, orbit, r, jd) {
	var out = { ok: false, spaceOk: false, timeOk: false, distToOrbit: Infinity, dtDays: null };
	if (!orbit || !(orbit.e < 1) || !r || !isFinite(jd)) { return out; }

	out.distToOrbit = O.distanceToOrbit(orbit, r);
	out.spaceOk = out.distToOrbit < APPROACH_FAR;
	// Timing is only a coherent question once the path reaches the ring at all.
	if (out.spaceOk) {
		out.dtDays = phasingDays(GM, orbit, r, jd);
		out.timeOk = Math.abs(out.dtDays) < TEMP_FAR;
	}
	out.ok = out.spaceOk && out.timeOk;
	return out;
}

// ADOPTION'S standard: how close the coast, re-flown from a departure
// technology's actually-delivered hand-off, must come to the destination BODY
// — its centre, the same measure transfer-leg reports as `leg.miss`.
//
// Measured at the flight's CLOSEST APPROACH, never at the leg's end: a leg
// routinely ends before its own closest approach, so its end separation says
// little about whether the destination was reached (transfer-leg.js makes the
// same point where it computes the figure).
export var MAX_ADOPT_MISS = 0.0002 * AU;   // m — ~29,920 km

// PROVISIONAL, and known to be tight. Missions here are routinely designed to
// FLY PAST the destination at an offset rather than at its centre — a
// dead-centre aim is a collision orbit, and an arrival technology catches at
// some altitude — so a well-built plan's own closest approach can sit well
// outside this. The shipped Earth->Mars reference deliberately aims at a
// 50,000 km flyby offset and passes ~47,900 km from Mars, so nothing on that
// mission is adoptable under this figure. Tying the bound to the destination's
// SOI, or to what the arrival technology can actually catch, would fit how the
// missions are really built; this flat distance is a first cut.

// Does a re-flown coast reach the destination closely enough to adopt its
// departure? `missM` is the closest approach in METRES (transfer-leg's
// `leg.miss` is in AU — convert before calling), or 0 for a trajectory that
// actually intercepts the body. Returns { ok, missM }.
export function checkAdoptable(missM) {
	var ok = isFinite(missM) && missM >= 0 && missM < MAX_ADOPT_MISS;
	return { ok: ok, missM: missM };
}

// That verdict as one sentence, for the adopt button's title.
export function adoptableReason(res, destName) {
	if (!isFinite(res.missM)) {
		return "Flown from the delivered hand-off, the flight never comes near " + destName + ".";
	}
	if (res.ok) {
		return "Flown from the delivered hand-off the ship still reaches " + destName +
			", passing within " + Math.round(res.missM / 1000).toLocaleString("en-US") + " km.";
	}
	return "Flown from the delivered hand-off the ship passes " +
		Math.round(res.missM / 1000).toLocaleString("en-US") + " km from " + destName +
		" — needs to be within " + Math.round(MAX_ADOPT_MISS / 1000).toLocaleString("en-US") +
		" km. A departure that far off is a new mission to author in the Ephemeris tab, " +
		"not a plan to re-point here.";
}

// The RINGS' verdict as one sentence, for a button's title or a card's note.
// `subject` names what was measured ("Marker", "The delivered hand-off"), and
// `destName` the body it was measured against.
export function proximityReason(res, subject, destName) {
	if (res.ok) {
		return subject + " reaches " + destName + " inside both closest-approach limits " +
			"(space and time).";
	}
	if (!res.spaceOk) {
		return isFinite(res.distToOrbit)
			? subject + " is " + (res.distToOrbit / AU).toFixed(4) + " AU from " + destName +
				"'s orbit — needs to be within " + (APPROACH_FAR / AU).toFixed(3) + " AU."
			: subject + " isn't near " + destName + "'s orbit.";
	}
	return subject + "'s timing is off by " + Math.abs(res.dtDays).toFixed(1) + " d — needs to be " +
		"within " + TEMP_FAR + " d of " + destName + " passing this point.";
}
