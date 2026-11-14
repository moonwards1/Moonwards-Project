/* Earth-Moon-Traffic-Plotter/core/elevator-arrival — how a flight meets the
 * L1 elevator.
 *
 * The catchable part of the elevator is its single line along the
 * Earth–Moon direction: from its lower point (hanging below L1) out through
 * L1 to the counterweight. The line is carried round Earth with the Moon
 * (core/facilities.js's elevatorAt), and a point of it at distance s from the
 * Moon's centre moves with
 *
 *     r(s) = r_M + s * u,     v(s) = v_M + s * du/dt
 *
 *     r_M, v_M  the Moon's geocentric position and velocity
 *     u         unit vector from the Moon's centre along the elevator
 *
 * A mobile catcher moves along it, as on a skyhook (core/arrival.js), so the
 * ship is caught where it passes within CATCH_REACH of the line, anywhere
 * between the two ends, with no more relative motion than CATCH_SPEED_LIMIT:
 *
 *     x     = (r - r_M) . u                         where along the line, m
 *     point = clamp(x, s_low, s_cw)                 the nearest point of it
 *     miss  = | r - r(point) |
 *     vRel  = v - v(point),   trim = | vRel |
 *
 *     r, v         the ship's geocentric position and velocity
 *     s_low, s_cw  the lower point's and the counterweight's distances from
 *                  the Moon's centre
 *
 * The result has core/arrival.js's evaluateArrival shape, so the page reads
 * an elevator's arrival as it reads a skyhook's. Speeds are geocentric: the
 * line's own speed round Earth and the ship's.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/elevator.test.js.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { shipAccel } from "../../../Shared/geo-leg.js";
import { elevatorAt, elevatorPointState } from "./facilities.js";
import { CATCH_REACH, CATCH_SPEED_LIMIT } from "./arrival.js";

var O = OrbitalMath;
var DAY = 86400;
var GOLD = (Math.sqrt(5) - 1) / 2;
var SUB = 60;                         // s: RK4 step from a sample to a time between samples

// The ship's geocentric state at leg time t (s), flown from the sample before
// it under Earth + Moon + Sun.
export function legStateAt(leg) {
	var a = leg.samples;
	return function (t) {
		var lo = 0, hi = a.length - 1;
		t = Math.max(a[0].t, Math.min(a[hi].t, t));
		while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (a[mid].t <= t) { lo = mid; } else { hi = mid; } }
		var r = a[lo].r, v = a[lo].v, rest = t - a[lo].t;
		if (rest <= 1e-9) { return { r: r.slice(), v: v.slice() }; }
		var n = Math.ceil(rest / SUB), h = rest / n, jde = leg.jde0 + a[lo].t / DAY;
		for (var i = 0; i < n; i++) {
			var hd = h / 2 / DAY, a1 = shipAccel(r, jde);
			var r2 = O.vAdd(r, O.vScale(v, h / 2)), v2 = O.vAdd(v, O.vScale(a1, h / 2)), a2 = shipAccel(r2, jde + hd);
			var r3 = O.vAdd(r, O.vScale(v2, h / 2)), v3 = O.vAdd(v, O.vScale(a2, h / 2)), a3 = shipAccel(r3, jde + hd);
			var r4 = O.vAdd(r, O.vScale(v3, h)), v4 = O.vAdd(v, O.vScale(a3, h)), a4 = shipAccel(r4, jde + h / DAY);
			r = O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2, 2)), O.vAdd(O.vScale(v3, 2), v4)), h / 6));
			v = O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2, 2)), O.vAdd(O.vScale(a3, 2), a4)), h / 6));
			jde += h / DAY;
		}
		return { r: r, v: v };
	};
}

function goldenMin(f, lo, hi) {
	var c = hi - GOLD * (hi - lo), d = lo + GOLD * (hi - lo), fc = f(c), fd = f(d);
	for (var i = 0; i < 70 && hi - lo > 1e-3; i++) {
		if (fc < fd) { hi = d; d = c; fd = fc; c = hi - GOLD * (hi - lo); fc = f(c); }
		else { lo = c; c = d; fc = fd; d = lo + GOLD * (hi - lo); fd = f(d); }
	}
	return (lo + hi) / 2;
}

// The ship against the elevator's line at leg time t.
export function elevatorProbe(stateAt, leg, fig, t) {
	var st = stateAt(t), jd = leg.jde0 + t / DAY, at = elevatorAt(fig, jd);
	var d = O.vSub(st.r, at.moon.r), x = O.vDot(d, at.u);
	var lo = at.rLow, hi = fig.rCw, point = Math.max(lo, Math.min(hi, x));
	return { t: t, jd: jd, st: st, at: at, x: x, lo: lo, hi: hi, point: point,
	         segDist: O.vMag(O.vSub(d, O.vScale(at.u, point))),
	         lineDist: O.vMag(O.vSub(d, O.vScale(at.u, x))) };
}

// Judge a flight's arrival at the elevator `fig` (facilities.js's
// elevatorFigures): core/arrival.js's evaluateArrival result, with `gap`
// measured past the counterweight (+) or below the lower point (-), and
// `altitude` the catch point's height above the Moon.
export function evaluateElevatorArrival(leg, fig) {
	if (leg.kind === "moonEllipse") { return { found: false, reason: "never-leaves" }; }
	var stateAt = legStateAt(leg), a = leg.samples;
	function dist(t) { return elevatorProbe(stateAt, leg, fig, t).segDist; }
	var tEnd = a[a.length - 1].t, t = a[0].t, best = null, prevT = t, bestLo = t, bestHi = t;
	while (t <= tEnd) {
		var q = elevatorProbe(stateAt, leg, fig, t);
		var step = Math.max(10, Math.min(3600, q.segDist / 8e3));
		if (!best || q.segDist < best.d) { best = { d: q.segDist, t: t }; bestLo = prevT; bestHi = Math.min(tEnd, t + step); }
		prevT = t;
		if (t >= tEnd) { break; }
		t = Math.min(tEnd, t + step);
	}
	if (!best) { return { found: false, reason: "never-beside" }; }
	var tc = goldenMin(dist, bestLo, bestHi);
	if (!(dist(tc) <= best.d)) { tc = best.t; }
	var p = elevatorProbe(stateAt, leg, fig, tc);
	var pt = elevatorPointState(fig, p.point, p.jd, p.at);
	var D = O.vSub(p.st.r, pt.r), vRel = O.vSub(p.st.v, pt.v);
	var miss = O.vMag(D), trim = O.vMag(vRel), met = miss <= CATCH_REACH;
	var gap = p.x > p.hi ? p.x - p.hi : (p.x < p.lo ? p.x - p.lo : 0);
	var pointSpeed = O.vMag(pt.v), nrm = O.vUnit(O.vCross(p.at.u, p.at.travel));
	var reason = met ? (trim <= CATCH_SPEED_LIMIT ? null : "too-fast")
		: (gap > 0 ? "above-top" : (gap < 0 ? "below-foot" : "off-arm"));
	return {
		found: true, met: met, caught: reason === null, reason: reason,
		t: tc, jd: p.jd, r: O.vSub(p.st.r, p.at.moon.r), v: O.vSub(p.st.v, p.at.moon.v), rGeo: p.st.r,
		point: p.point, pointGeo: pt.r, altitude: p.point - fig.R,
		gap: gap, miss: miss, wait: O.vDot(D, p.at.travel) / Math.max(1, pointSpeed),
		pointSpeed: pointSpeed, shipSpeed: O.vMag(p.st.v), vRel: vRel, trim: trim,
		components: { pro: O.vDot(vRel, p.at.travel), out: O.vDot(vRel, p.at.u), nrm: O.vDot(vRel, nrm) }
	};
}
