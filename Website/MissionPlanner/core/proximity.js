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
 * A FLOWN MISSION ASKS A DIFFERENT, STRICTER QUESTION — see MAX_PASS_ALTITUDE
 * below. Once a mission exists, the coast flown from the delivered hand-off
 * has to actually REACH the destination, not merely cross its orbit somewhere
 * near the right month, and how close it comes is the mission's headline
 * number. Experimentation that throws the flight further off than that is a
 * new mission to author in the Ephemeris tab, not a plan to rewrite in place.
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
// MEASURED AS ALTITUDE ABOVE THE DESTINATION'S SURFACE, never as a distance
// from its centre, and at the flight's CLOSEST APPROACH, never at the leg's
// end (a leg routinely ends before its own closest approach, so its end
// separation says little about whether the destination was reached —
// transfer-leg.js makes the same point where it computes the figure).
//
// Altitude because that is what the arrival phase deals in: an arrival
// technology catches at some height above a surface, and a dead-centre aim is
// a collision orbit, not an arrival. It is also the figure the reader already
// sees everywhere else the pass is quoted.
export var MAX_PASS_ALTITUDE = 30e6;    // m — 30,000 km: close enough to arrive
export var AIM_PASS_ALTITUDE = 15e6;    // m — 15,000 km: what a re-target aims for

// AIM INSIDE THE BOUND, deliberately. A re-target cannot land exactly on its
// own answer: solving moves the departure requirement, re-tuning the technology
// towards it moves the exit point, and the next flight starts somewhere new.
// Aiming at half the bound leaves that residual somewhere to land, so an
// iteration that overshoots is still inside the standard.
//
// BOTH ARE PROVISIONAL. The honest bound is whatever the arrival technology can
// actually catch — a cone of approach vectors and a maximum speed — and it
// should come from the arrival module once that exists, per destination and per
// technology, rather than being one flat number for every body from Mars to
// Psyche. Until then these are a first cut, and re-targeting standardises a
// mission's pass on AIM_PASS_ALTITUDE rather than preserving whatever flyby
// offset it was authored with.

// Does a flight come close enough to call this an arrival? `altitudeM` is the
// closest approach in METRES ABOVE THE SURFACE (transfer-leg's nearestApproach
// reports exactly this as `altitude`), or 0 for a trajectory that actually
// intercepts the body. Returns { ok, altitudeM }.
export function checkPassAltitude(altitudeM) {
	var ok = isFinite(altitudeM) && altitudeM >= 0 && altitudeM < MAX_PASS_ALTITUDE;
	return { ok: ok, altitudeM: altitudeM };
}

// That verdict as one sentence, for a button's title or the message area.
export function passAltitudeReason(res, destName) {
	function km(m) { return Math.round(m / 1000).toLocaleString("en-US") + " km"; }
	if (!isFinite(res.altitudeM)) {
		return "Flown from the delivered hand-off, the flight never comes near " + destName + ".";
	}
	if (res.ok) {
		return "Flown from the delivered hand-off the ship reaches " + destName +
			", passing " + km(res.altitudeM) + " above it.";
	}
	return "Flown from the delivered hand-off the ship passes " + km(res.altitudeM) +
		" above " + destName + " — needs to be within " + km(MAX_PASS_ALTITUDE) + ".";
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
