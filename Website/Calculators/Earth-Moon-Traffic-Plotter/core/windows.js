/* Earth-Moon-Traffic-Plotter/core/windows — when the Earth–Moon alignment
 * suits traffic to or from the Earth skyhook.
 *
 * The Earth skyhook turns in Earth's equatorial plane, and a ship it lets go
 * or takes hold of is moving in that plane. The Moon's orbit is tilted to it,
 * so the Moon is in that plane only twice in each lunar orbit: the CROSSINGS.
 * They are the alignments, whatever is at the Moon's end of the flight —
 * the Moon skyhook, the L1 elevator or the mass driver — because they are set
 * by the Earth skyhook's plane and the Moon's position alone.
 *
 *   To the Moon   the ship stays near Earth's equatorial plane, so it reaches
 *                 the Moon only if it ARRIVES around a crossing. The release
 *                 window is the crossing's, moved earlier by the flight time.
 *   To Earth      the ship's path lies in a plane holding Earth's centre and
 *                 the point it left from, so it can only come in along the
 *                 tether's plane if it is RELEASED around a crossing.
 *
 * HOW GOOD A CROSSING IS. At a crossing, the path that fits the Earth skyhook
 * has, out at the Moon's distance, the velocity
 *
 *     V_ship = Vt * e          e  = unit(nE x rHat)
 *     Vt     = sqrt( GM_E * (2 / ra - 2 / (ra + rp)) )
 *
 *     rHat   unit vector from Earth to the Moon
 *     nE     the Earth skyhook's pole (Earth's spin axis)
 *     ra     the Moon's distance from Earth, m
 *     rp     the radius of the Earth skyhook's point for Moon traffic, m
 *     Vt     the speed at the far end of an ellipse from rp to ra
 *
 * and so passes the Moon at
 *
 *     u = V_ship - V_moon        vInf = |u|
 *     m = u . nM                 the MISMATCH, m/s
 *
 *     V_moon the Moon's velocity round Earth
 *     nM     the Moon skyhook's pole (the Moon's spin axis)
 *
 * m is the part of the ship's motion past the Moon that sticks out of the
 * plane the Moon skyhook turns in. Neither tether can take it up, and which
 * end it lands on depends on the direction of travel:
 *
 *   To the Moon   the ship meets the Moon tether crossing its plane at
 *                     toMoon = v * |m| / vInf
 *                 v the ship's speed where it matches the tether's,
 *                 omega_M * r = sqrt(vInf^2 + 2 GM_M / r).
 *   To Earth      the ship leaves in the Moon tether's plane, so the mismatch
 *                 tilts its whole path to Earth's equator by
 *                     i = atan( |m| * |nM . nE| / Vt )
 *                 and it meets the Earth tether at
 *                     toEarth = 2 * (omega_E * rp) * sin(i / 2)
 *
 * The same few hundred m/s of mismatch is a few hundred m/s at the Moon and
 * several km/s at Earth, because Vt is small and the speed at Earth is large.
 *
 * These are estimates for marking the timelines; a flight's own figures come
 * from core/flight.js and core/arrival.js.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { moonGeoPos, moonGeoVel } from "../../../Shared/geo-leg.js";
import { CATCH_SPEED_LIMIT } from "./arrival.js";

var O = OrbitalMath;
var DAY = 86400;

// A flight from the Earth skyhook can be bent onto the Moon skyhook by the
// Moon's pull while the Moon is within this distance of Earth's equatorial
// plane on arrival (m).
export var PLANE_REACH = 7e6;
// A flight to the Earth skyhook is tilted to its plane by at least the angle
// the Moon stands off that plane at release; this much is allowed (rad).
export var PLANE_ANGLE = 3 * Math.PI / 180;
// Flight times from the Earth skyhook's Moon release point to the Moon (s):
// from the slowest path that reaches it to one let go about 50 km higher.
export var TO_MOON_FLIGHT = [2.4 * DAY, 3.5 * DAY];

// The Moon's distance from the plane of the Earth skyhook `eFig`, m.
function offPlane(eFig, jd) { return O.vDot(moonGeoPos(jd), eFig.normal); }

// Julian dates between jd0 and jd1 at which the Moon's centre passes through
// the Earth skyhook's plane.
export function planeCrossings(eFig, jd0, jd1) {
	var out = [], STEP = 0.25, prev = offPlane(eFig, jd0);
	for (var t = jd0 + STEP; t < jd1 + STEP; t += STEP) {
		var cur = offPlane(eFig, t);
		if (prev * cur < 0) {
			var a = t - STEP, b = t, fa = prev;
			for (var i = 0; i < 40; i++) {
				var mid = (a + b) / 2, fm = offPlane(eFig, mid);
				if (fa * fm <= 0) { b = mid; } else { a = mid; fa = fm; }
			}
			if ((a + b) / 2 <= jd1) { out.push((a + b) / 2); }
		}
		prev = cur;
	}
	return out;
}

// How well a crossing at Julian date jd suits the two skyhooks (the header's
// model). rp: the Earth skyhook's point for Moon traffic, m from Earth's centre.
// Returns { mismatch, vInf, toMoon, toEarth } in m/s.
export function alignmentAt(eFig, mFig, rp, jd) {
	var r = moonGeoPos(jd), V = moonGeoVel(jd), ra = O.vMag(r);
	var e = O.vUnit(O.vCross(eFig.normal, O.vUnit(r)));
	var Vt = O.visVivaVelocity(eFig.GM, ra, (ra + rp) / 2);
	var u = O.vSub(O.vScale(e, Vt), V), m = O.vDot(u, mFig.normal), vInf = O.vMag(u);
	// Where on the Moon tether the ship's speed is the tether's own.
	var lo = mFig.rFoot, hi = mFig.rTop;
	for (var k = 0; k < 50; k++) {
		var mid = (lo + hi) / 2;
		if (mFig.omega * mid < Math.sqrt(vInf * vInf + 2 * mFig.GM / mid)) { lo = mid; } else { hi = mid; }
	}
	var tilt = Math.atan2(Math.abs(m) * Math.abs(O.vDot(mFig.normal, eFig.normal)), Vt);
	return { mismatch: m, vInf: vInf,
	         toMoon: mFig.omega * lo * Math.abs(m) / vInf,
	         toEarth: 2 * eFig.omega * rp * Math.sin(tilt / 2) };
}

// The release windows between jd0 and jd1 for traffic between the Earth
// skyhook and the Moon.
//   toward  "Moon" for ships leaving the Earth skyhook, "Earth" for ships
//           bound for it
//   eFig, mFig  the two skyhooks' figures (core/facilities.js)
//   rp      the Earth skyhook's point for Moon traffic, m from Earth's centre
// Returns [{ start, end, crossing, speed, within }], in date order:
//   start, end  the Julian dates to release between
//   crossing    the crossing the window belongs to
//   speed       the relative motion to expect at the catch, m/s (alignmentAt)
//   within      speed <= arrival.js's CATCH_SPEED_LIMIT
export function releaseWindows(toward, eFig, mFig, rp, jd0, jd1) {
	var lead = toward === "Moon" ? TO_MOON_FLIGHT[1] / DAY + 1 : 1;
	return planeCrossings(eFig, jd0 - 1, jd1 + lead).map(function (tc) {
		// The Moon moves through the plane at a steady rate for the hours that matter.
		var rate = Math.abs(offPlane(eFig, tc + 0.02) - offPlane(eFig, tc - 0.02)) / 0.04;   // m per day
		var q = alignmentAt(eFig, mFig, rp, tc), w;
		if (toward === "Moon") {
			var half = PLANE_REACH / rate;
			w = { start: tc - half - TO_MOON_FLIGHT[1] / DAY, end: tc + half - TO_MOON_FLIGHT[0] / DAY, speed: q.toMoon };
		} else {
			var halfE = O.vMag(moonGeoPos(tc)) * Math.sin(PLANE_ANGLE) / rate;
			w = { start: tc - halfE, end: tc + halfE, speed: q.toEarth };
		}
		w.crossing = tc; w.within = w.speed <= CATCH_SPEED_LIMIT;
		return w;
	}).filter(function (w) { return w.end >= jd0 && w.start <= jd1; });
}
