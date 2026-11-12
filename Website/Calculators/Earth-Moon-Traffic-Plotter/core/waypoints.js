/* Earth-Moon-Traffic-Plotter/core/waypoints — small course-correction burns
 * along a flight, placed by time of flight.
 *
 * A waypoint is { t, burn }: t seconds after release, an impulse
 * burn = { pro, rad, nrm } (m/s) in the prograde / radial / normal frame of
 * OrbitalMath.burnFrame — the same frame and the same editor the Mission
 * Planner's waypoints use. Nothing here knows how the flight started, so the
 * same waypoints serve any release: a skyhook's, and later the L1 elevator's
 * or a mass driver's.
 *
 * WHICH BODY THE BURN IS MEASURED AGAINST. Inside the Moon's sphere of
 * influence the frame is Moon-relative, outside it Earth-relative:
 *
 *     body = Moon   when | r - r_Moon | < SOI_Moon
 *            Earth  otherwise
 *     r_b = r - r_body,   v_b = v - v_body        (the state the frame is built on)
 *     v_after = v + pro * p + rad * q + nrm * n   (p, q, n: burnFrame(r_b, v_b))
 *
 *     r, v     the ship's geocentric position and velocity, m and m/s
 *     r_body, v_body  the body's geocentric position and velocity (zero for Earth)
 *     SOI_Moon the Moon's sphere of influence, ~66,000 km
 *
 * so "prograde" near the Moon is along the ship's motion past the Moon — what
 * a trim before a catch on the Moon skyhook wants — and along its motion
 * around Earth everywhere else. Only the frame's axes depend on this; the
 * impulse itself is the same vector whichever body it is described against.
 *
 * Each component is capped at MAX_AXIS_MPS: enough to turn a path at the far
 * end of a long loop out from Earth, where the ship is moving slowly.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { moonGeoPos, moonGeoVel, SOI_MOON } from "../../../Shared/geo-leg.js";

var O = OrbitalMath;
var AXES = ["pro", "rad", "nrm"];

export var MAX_AXIS_MPS = 300;

// One burn component, capped to ±MAX_AXIS_MPS; anything not a number is 0.
export function capAxis(mps) {
	var x = +mps;
	return isFinite(x) ? Math.max(-MAX_AXIS_MPS, Math.min(MAX_AXIS_MPS, x)) : 0;
}

// The waypoints a flight is flown with: those after the release, each burn
// capped, in time order. The input list is not changed.
//   list: [{ t, burn: { pro, rad, nrm } }] — t in s since release
// Returns [{ index, t, burn }], index being the entry's place in `list`.
export function cleanWaypoints(list) {
	return (list || []).map(function (wp, i) {
		var b = wp.burn || {}, burn = {};
		AXES.forEach(function (k) { burn[k] = capAxis(b[k]); });
		return { index: i, t: +wp.t, burn: burn };
	}).filter(function (wp) { return isFinite(wp.t) && wp.t > 0; })
	  .sort(function (a, b) { return a.t - b.t; });
}

// The body a burn at geocentric position r (m), Julian date jde, is measured
// against: { body, r, v } — that body's own geocentric position and velocity.
export function burnBodyAt(r, jde) {
	var rM = moonGeoPos(jde);
	if (O.vMag(O.vSub(r, rM)) < SOI_MOON) { return { body: "Moon", r: rM, v: moonGeoVel(jde) }; }
	return { body: "Earth", r: [0, 0, 0], v: [0, 0, 0] };
}

// A burn applied to the geocentric state (r, v) at jde.
// Returns { body, relR, relV, relVAfter, vAfter, dv, dSpeed }:
//   body       "Moon" | "Earth", as burnBodyAt
//   relR, relV the state relative to that body, before the burn
//   relVAfter  its velocity relative to that body, after
//   vAfter     the geocentric velocity after the burn
//   dv         the impulse vector, m/s (geocentric = body-relative)
//   dSpeed     the change in speed relative to that body, m/s
export function applyWaypointBurn(r, v, jde, burn) {
	var b = burnBodyAt(r, jde);
	var relR = O.vSub(r, b.r), relV = O.vSub(v, b.v);
	var relVAfter = O.applyBurn(relR, relV, burn.pro || 0, burn.nrm || 0, burn.rad || 0);
	var dv = O.vSub(relVAfter, relV);
	return { body: b.body, relR: relR, relV: relV, relVAfter: relVAfter,
	         vAfter: O.vAdd(v, dv), dv: dv, dSpeed: O.vMag(relVAfter) - O.vMag(relV) };
}

// The size of a burn, m/s.
export function burnSize(burn) { return Math.hypot(burn.pro || 0, burn.rad || 0, burn.nrm || 0); }
