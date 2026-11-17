/* Mars-System-Traffic-Plotter/core/arrival — how a flight meets a skyhook.
 *
 * The destination's tether is a straight line from its foot to its top,
 * moving with the clock. A ship is taken hold of by a catcher that is moved
 * along the tether to wherever the ship will pass and absorbs the ship's
 * motion relative to the tether, up to CATCH_SPEED_LIMIT. This file finds the
 * flight's CLOSEST PASS to the tether and says how the meeting goes:
 *
 *     x     = r . u                             how far out along the tether's line the ship is
 *     point = the tether's point nearest x      held between the foot and the top
 *     miss  = | r - r_point |
 *     trim  = | v - v_point |
 *
 *     r, v              the ship's position and velocity from Mars's centre
 *     u                 unit vector from Mars's centre out along the tether then
 *     r_point, v_point  that point of the tether's position and velocity
 *                       (core/facilities.js's pointState)
 *
 * The closest pass is the least `miss` of the whole flight. For a ship that
 * never comes near the tether it can fall while Mars lies between the two (a
 * ship rounding the far side is "closest" to the foot straight through the
 * planet); the result says so (`blocked`), since such a distance only shows
 * how far from a meeting the flight is.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { stateAtLegTime } from "../../../Shared/body-leg.js";
import { facilityAt, pointState, centreRadius } from "./facilities.js";

var O = OrbitalMath;
var DAY = 86400;
var GOLD = (Math.sqrt(5) - 1) / 2;

// How far from the tether, m, the ship may pass and still be caught.
export var CATCH_REACH = 1e3;
// The most relative motion, m/s, the catcher can absorb.
export var CATCH_SPEED_LIMIT = 800;

// The ship against the tether t seconds into the leg.
function probe(leg, fig, t) {
	var st = stateAtLegTime(leg, t), at = facilityAt(fig, st.jde), c = centreRadius(fig, at);
	var x = O.vDot(st.r, at.u), s = Math.max(fig.sFoot, Math.min(fig.sTop, x - c));
	var pt = pointState(fig, at, s), gapV = O.vSub(pt.r, st.r), g2 = O.vDot(gapV, gapV);
	// The point of the line from the ship to the tether that is nearest Mars's centre.
	var k = g2 > 0 ? Math.max(0, Math.min(1, -O.vDot(st.r, gapV) / g2)) : 0;
	return { t: t, st: st, x: x, s: s, c: c, pt: pt, dist: Math.sqrt(g2),
	         clear: O.vMag(O.vAdd(st.r, O.vScale(gapV, k))) >= fig.R };
}

// Judge the leg's arrival at the skyhook `fig`. Returns
//   { found: true, met, caught, reason, blocked, t, jd, r, pointR, altitude, gap, miss, trim, shipSpeed, pointSpeed }
//   blocked   Mars lies between the ship and the tether at the closest pass
//   met       the ship comes within CATCH_REACH of the tether
//   caught    met, with a relative motion of no more than CATCH_SPEED_LIMIT
//   reason    null when caught; "too-fast" for a ship that meets the tether
//             faster than that; "above-top" | "below-foot" | "off-arm" for one
//             that does not meet it
//   t, jd     the closest pass: seconds since release, and its Julian date
//   r         the ship there; pointR the nearest point of the tether, both from Mars's centre
//   altitude  that point's height above Mars's mean radius then, m
//   gap       how far past an end the ship is, along the tether: m above the
//             top (+) or below the foot (-); 0 beside it
//   miss      distance from the ship to that point, m
//   trim      the ship's speed relative to that point, m/s
export function evaluateArrival(leg, fig) {
	function dist(t) { return probe(leg, fig, t).dist; }
	// Walk the flight for the smallest distance, the step shrinking as the ship
	// nears the tether, where the distance changes by kilometres a second.
	var tEnd = leg.duration, t = 0, best = null, prevT = 0, lo = 0, hi = 0;
	while (t <= tEnd) {
		var q = probe(leg, fig, t), step = Math.max(5, Math.min(240, q.dist / 4e4));
		if (!best || q.dist < best.d) { best = { d: q.dist, t: t }; lo = prevT; hi = Math.min(tEnd, t + step); }
		prevT = t;
		if (t >= tEnd) { break; }
		t = Math.min(tEnd, t + step);
	}
	var c = hi - GOLD * (hi - lo), d = lo + GOLD * (hi - lo), fc = dist(c), fd = dist(d);
	for (var i = 0; i < 60 && hi - lo > 1e-3; i++) {
		if (fc < fd) { hi = d; d = c; fd = fc; c = hi - GOLD * (hi - lo); fc = dist(c); }
		else { lo = c; c = d; fc = fd; d = lo + GOLD * (hi - lo); fd = dist(d); }
	}
	var tc = (lo + hi) / 2;
	if (!(dist(tc) <= best.d)) { tc = best.t; }
	var p = probe(leg, fig, tc), along = p.x - p.c;
	var gap = along > fig.sTop ? along - fig.sTop : (along < fig.sFoot ? along - fig.sFoot : 0);
	var trim = O.vMag(O.vSub(p.st.v, p.pt.v)), met = p.dist <= CATCH_REACH;
	var reason = met ? (trim <= CATCH_SPEED_LIMIT ? null : "too-fast")
		: (gap > 0 ? "above-top" : (gap < 0 ? "below-foot" : "off-arm"));
	return { found: true, met: met, caught: reason === null, reason: reason, blocked: !p.clear, t: tc, jd: p.st.jde,
	         r: p.st.r, pointR: p.pt.r, altitude: O.vMag(p.pt.r) - fig.R, gap: gap, miss: p.dist, trim: trim,
	         shipSpeed: O.vMag(p.st.v), pointSpeed: O.vMag(p.pt.v) };
}
