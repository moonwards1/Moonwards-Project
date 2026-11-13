/* Earth-Moon-Traffic-Plotter/core/farburn — the solve for a flight that
 * reaches a skyhook by way of a burn far out from its body.
 *
 * A ship thrown straight from the Moon arrives at the Earth skyhook tilted to
 * the tether's plane, far too fast to be caught (core/windows.js). Thrown
 * instead onto a long loop out past the Moon's orbit, it is moving at only a
 * few hundred m/s at the far end, and a modest burn there can do what no
 * release can: turn its whole path into the tether's plane and set its
 * perigee where it meets the tether at the tether's own speed.
 *
 * Nothing about the release is touched. The solve works on two waypoint burns
 * (core/waypoints.js):
 *
 * 1. THE FAR BURN. After a burn the ship's path lies in the plane through the
 *    body's centre, the burn point and the new velocity, so that plane can be
 *    the tether's only if the burn point is in it:
 *
 *        sin(i_min) = z / r
 *
 *        i_min  the least tilt to the tether's plane the path can then have
 *        z      the burn point's distance from that plane, m
 *        r      its distance from the body's centre, m
 *
 *    So the burn is put where the coasting path crosses the tether's plane
 *    far out. The velocity wanted after it has three parts, each with a job:
 *
 *        vt  across the line to the body, in the tether's plane: sets the
 *            perigee, and with it the speed there. The ship matches the
 *            tether where  omega * rp = vp  (omega the tether's rotation
 *            rate, rp and vp the perigee's radius and the ship's speed at it)
 *        vn  out of the tether's plane: zero, but for what the Sun's pull
 *            will do to the plane on the way in
 *        vr  along the line to the body: sets how long the way in takes, so
 *            that the tether is pointing at the perigee when the ship is there
 *
 *    The Sun moves both the plane and the perigee too much on the way in for
 *    a two-body guess to land near them, so a start is found a part at a
 *    time: the vn that arrives least tilted, then the vt that matches the
 *    speed, bracketed and bisected. Then
 *    all three are solved together by Levenberg–Marquardt on the meeting at
 *    perigee, each trial an integrated flight from the burn point. The Sun
 *    also tilts the path on the way in, so the meeting's four conditions need
 *    a fourth unknown: the burn's instant, which ends up some days off the
 *    crossing.
 *
 * 2. THE TRIM. The catch is extremely sensitive to the far burn — a mm/s
 *    there moves the arrival by minutes. A second, small burn TRIM_LEAD
 *    before the arrival, solved the same way on the flight as actually flown
 *    through the first, takes up what is left, and is how such a flight would
 *    be flown.
 *
 * THE MEETING, judged at the perigee after the burn:
 *
 *        speed  = vp . e - omega * rp        e = unit(n x rHat)
 *        cross  = vp . n
 *        z      = rp_vec . n
 *        phase  = angle from the tether to rHat, about n, at that instant
 *
 *        rp_vec, vp  the ship's position and velocity at perigee
 *        rHat        unit(rp_vec);  n  the tether's pole
 *
 * All four are zero for a ship taken hold of at perigee with no relative
 * motion at all.
 *
 * It is LOCAL in the sense core/target.js is: it turns the release it is
 * given into a catch if that release's path allows one, and says why not
 * otherwise. It is written for the Earth skyhook as the destination.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { buildIntegratedLeg, shipAccel } from "../../../Shared/geo-leg.js";
import { computeFlight, FINE_STEP } from "./flight.js";
import { tetherAxes } from "./facilities.js";
import { MAX_AXIS_MPS } from "./waypoints.js";

var O = OrbitalMath;
var DAY = 86400;
var GOLD = (Math.sqrt(5) - 1) / 2;

// A far burn is made at least this far from Earth's centre (m): well outside
// the Moon's orbit, where the ship is slow.
export var FAR_MIN = 6e8;
// The trim burn is made this long before the arrival (s).
export var TRIM_LEAD = DAY;
var RETURN_MAX = 60 * DAY;        // the way in from the far burn is flown no longer than this
var SCAN = 24;                    // steps in the search for the perigee-setting speed
var W_SPEED = 20;                 // m/s per unit of residual
var W_FAR = 2e3, W_TRIM = 100;    // m per unit of residual: the far burn's solve, the trim's

function fail(reason, message) { return { ok: false, reason: reason, message: message }; }

// The perigee of an integrated geocentric leg: the closest recorded sample to
// Earth, refined as a two-body orbit from the sample before it. A leg that
// ends in the ground has its perigee below the surface, found the same way
// from its last sample — so a search can cross that boundary smoothly.
// Returns { t, r, v } (s into the leg, m, m/s) or null for a leg that only
// draws away or is cut short on its way in.
function perigeeOf(leg, GM, tFrom) {
	var a = leg.samples, k = -1, best = Infinity;
	for (var i = 0; i < a.length; i++) {
		if (a[i].t < (tFrom || 0)) { continue; }
		var d = O.vMag(a[i].r);
		if (d < best) { best = d; k = i; }
	}
	if (k <= 0) { return null; }
	if (k === a.length - 1) {
		if (leg.impact !== "Earth") { return null; }
		var dt = O.timeToTrueAnomaly(GM, a[k].r, a[k].v, 0);
		if (dt === null) { return null; }
		var hit = O.propagateState(GM, a[k].r, a[k].v, dt);
		return { t: a[k].t + dt, r: hit.r, v: hit.v };
	}
	var s0 = a[k - 1], lo = 0, hi = a[k + 1].t - s0.t;
	function rad(t) { return O.vMag(O.propagateState(GM, s0.r, s0.v, t).r); }
	var c = hi - GOLD * (hi - lo), e = lo + GOLD * (hi - lo), fc = rad(c), fe = rad(e);
	for (var n = 0; n < 60; n++) {
		if (fc < fe) { hi = e; e = c; fe = fc; c = hi - GOLD * (hi - lo); fc = rad(c); }
		else { lo = c; c = e; fc = fe; e = lo + GOLD * (hi - lo); fe = rad(e); }
	}
	var st = O.propagateState(GM, s0.r, s0.v, (lo + hi) / 2);
	return { t: s0.t + (lo + hi) / 2, r: st.r, v: st.v };
}

// The meeting at a perigee p ({ r, v }, at Julian date jd) with the tether
// `fig` (the header's four figures), and the residuals a solve drives to zero.
function meeting(p, jd, fig, wPos, withPhase) {
	var rp = O.vMag(p.r), rh = O.vUnit(p.r), e = O.vUnit(O.vCross(fig.normal, rh));
	var ax = tetherAxes(fig, jd);
	var m = { rp: rp, prograde: O.vDot(p.v, e) > 0,
	          tilt: Math.acos(Math.max(-1, Math.min(1, O.vDot(O.vUnit(O.vCross(p.r, p.v)), fig.normal)))),
	          speed: O.vDot(p.v, e) - fig.omega * rp, cross: O.vDot(p.v, fig.normal),
	          z: O.vDot(p.r, fig.normal), phase: Math.atan2(O.vDot(rh, ax.prograde), O.vDot(rh, ax.along)) };
	m.R = [m.speed / W_SPEED, m.cross / W_SPEED, m.z / wPos];
	if (withPhase) { m.R.push(m.phase * rp / wPos); }
	m.norm = Math.sqrt(m.R.reduce(function (s, x) { return s + x * x; }, 0));
	return m;
}

// Levenberg–Marquardt on fn(x) -> { R: [...], norm } | null, from x0, with
// finite-difference steps `h` and no unknown changing by more than its `cap`
// in one iteration — the meeting has other, far costlier answers than the one
// near the start, and an unbounded step can land in one of them.
// Returns { x, res } — the best point reached.
function leastSquares(fn, x0, h, cap, maxIter, tol) {
	var x = x0.slice(), cur = fn(x), n = x.length, lambda = 1e-3;
	if (!cur) { return null; }
	for (var it = 0; it < maxIter && cur.norm > tol; it++) {
		var J = [], m = cur.R.length, j, a, b, i;
		for (j = 0; j < n; j++) {
			var xp = x.slice(); xp[j] += h[j];
			var rj = fn(xp);
			if (!rj) { return { x: x, res: cur }; }
			J.push(rj.R.map(function (v, q) { return (v - cur.R[q]) / h[j]; }));
		}
		var next = null;
		for (var tries = 0; tries < 12 && !next; tries++) {
			// (JtJ + lambda * diag) d = -Jt R, by Gaussian elimination
			var A = [];
			for (a = 0; a < n; a++) {
				var row = [], g = 0;
				for (b = 0; b < n; b++) {
					var s = 0;
					for (i = 0; i < m; i++) { s += J[a][i] * J[b][i]; }
					row.push(a === b ? s * (1 + lambda) : s);
				}
				for (i = 0; i < m; i++) { g += J[a][i] * cur.R[i]; }
				row.push(-g); A.push(row);
			}
			for (a = 0; a < n; a++) {
				var pv = a;
				for (b = a + 1; b < n; b++) { if (Math.abs(A[b][a]) > Math.abs(A[pv][a])) { pv = b; } }
				var tmp = A[a]; A[a] = A[pv]; A[pv] = tmp;
				for (b = a + 1; b < n; b++) {
					var q = A[b][a] / A[a][a];
					for (i = a; i <= n; i++) { A[b][i] -= q * A[a][i]; }
				}
			}
			var d = [];
			for (a = n - 1; a >= 0; a--) {
				var acc = A[a][n];
				for (b = a + 1; b < n; b++) { acc -= A[a][b] * d[b]; }
				d[a] = acc / A[a][a];
			}
			var scale = 1;
			for (a = 0; a < n; a++) { scale = Math.min(scale, cap[a] / Math.abs(d[a] || 1e-30)); }
			var xt = x.map(function (v, q) { return v + scale * d[q]; });
			var rt = d.every(isFinite) ? fn(xt) : null;
			if (rt && rt.norm < cur.norm) { next = { x: xt, res: rt }; lambda = Math.max(1e-9, lambda / 4); }
			else { lambda *= 8; }
		}
		if (!next) { break; }
		var gained = cur.norm - next.res.norm;
		x = next.x; cur = next.res;
		if (gained < 1e-4 * cur.norm) { break; }       // as far as the arithmetic can tell them apart
	}
	return { x: x, res: cur };
}

// Solve a flight's far burn and trim for a catch.
//   input: core/flight.js's computeFlight input, with `to` the Earth skyhook.
//          Its first waypoint, if any, says roughly when the far burn is to be
//          made; the burns themselves are not used.
// Returns { ok: true, waypoints, flight, speed, caught, met } —
//   waypoints  [{ t, burn }, { t, burn }]: the far burn and the trim (the trim
//              is left out when the arrival is too soon after the far burn)
//   flight     computeFlight's result flown with them
//   speed      the relative motion at the catch, m/s; met, caught as arrival.js's
// — or { ok: false, reason, message } with reason "not-earth" | "no-flight" |
// "no-crossing" | "no-perigee" | "too-big" | "no-return".
export function solveFarBurn(input) {
	var coast = computeFlight(Object.assign({}, input, { waypoints: [], skipArrival: true }));
	if (!coast.ok) { return fail("no-flight", coast.diagnostic.message); }
	var fig = coast.toFig;
	if (!fig || fig.body !== "Earth") { return fail("not-earth", "A far burn is solved for flights to the Earth skyhook."); }
	if (coast.final.kind !== "integrated") { return fail("no-crossing", "This path stays in orbit around the Moon."); }

	// Where the coasting path crosses the tether's plane far out: the one
	// nearest the first waypoint's time, or the farthest from Earth.
	var a = coast.final.samples, hint = input.waypoints && input.waypoints[0] ? +input.waypoints[0].t : null;
	var t1 = null, score = Infinity;
	for (var k = 1; k < a.length; k++) {
		var z0 = O.vDot(a[k - 1].r, fig.normal), z1 = O.vDot(a[k].r, fig.normal);
		if (z0 * z1 > 0 || O.vMag(a[k].r) < FAR_MIN) { continue; }
		var tc = a[k - 1].t + (a[k].t - a[k - 1].t) * z0 / (z0 - z1);
		var sc = hint !== null && isFinite(hint) ? Math.abs(tc - hint) : -O.vMag(a[k].r);
		if (sc < score) { score = sc; t1 = tc; }
	}
	if (t1 === null) {
		return fail("no-crossing", "This path does not cross Earth's equatorial plane far beyond the Moon's orbit, which is where a burn can turn it into the tether's plane. Try another release time or altitude.");
	}

	// The ship's state at that instant, as a flight through a waypoint there has it.
	function stateAt(waypoints, index, t) {
		var f = computeFlight(Object.assign({}, input, { waypoints: waypoints, maxTime: t + 60, skipArrival: true }));
		return f.ok && f.waypoints[index].reached ? f.waypoints[index] : null;
	}
	var ZERO = { pro: 0, rad: 0, nrm: 0 };
	var w1 = stateAt([{ t: t1, burn: ZERO }], 0, t1);
	if (!w1) { return fail("no-flight", "The path ends before the far burn."); }
	// The coasting ship dt seconds either side of that instant (RK4; this far
	// out, ten-minute steps are exact to the last digit).
	function coasted(dt) {
		var n = Math.max(1, Math.ceil(Math.abs(dt) / 600)), h = dt / n, r = w1.r, v = w1.v, jd = w1.jd;
		for (var i = 0; i < n && dt !== 0; i++) {
			var hd = h / 2 / DAY, a1 = shipAccel(r, jd);
			var r2 = O.vAdd(r, O.vScale(v, h / 2)), v2 = O.vAdd(v, O.vScale(a1, h / 2)), a2 = shipAccel(r2, jd + hd);
			var r3 = O.vAdd(r, O.vScale(v2, h / 2)), v3 = O.vAdd(v, O.vScale(a2, h / 2)), a3 = shipAccel(r3, jd + hd);
			var r4 = O.vAdd(r, O.vScale(v3, h)), v4 = O.vAdd(v, O.vScale(a3, h)), a4 = shipAccel(r4, jd + h / DAY);
			r = O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2, 2)), O.vAdd(O.vScale(v3, 2), v4)), h / 6));
			v = O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2, 2)), O.vAdd(O.vScale(a3, 2), a4)), h / 6));
			jd += h / DAY;
		}
		return { r: r, v: v, jd: jd };
	}
	// The velocity wanted after a burn at position r: y = [vt, vr, vn].
	function after(r, y) {
		var rh = O.vUnit(r), e = O.vUnit(O.vCross(fig.normal, rh));
		return O.vAdd(O.vAdd(O.vScale(e, y[0]), O.vScale(rh, y[1])), O.vScale(fig.normal, y[2]));
	}
	// The way in from a burn at (r, v, jd), and how it meets the tether at
	// perigee. `fine` flies it with the step the page's own flight uses; the
	// coarse step is a quarter of the work and close enough to search with.
	function wayIn(r, v, jd, maxTime, wPos, withPhase, fine) {
		var leg = buildIntegratedLeg(r, v, jd, Object.assign({ maxTime: maxTime }, fine ? FINE_STEP : null));
		var p = perigeeOf(leg, fig.GM, 0);
		return p ? meeting(p, jd + p.t / DAY, fig, wPos, withPhase) : null;
	}
	// y = [vt, vr, vn, dt]: the far burn's velocity, and its shift in time.
	function far(y, withPhase, fine) {
		var s0 = coasted(y[3] || 0);
		return wayIn(s0.r, after(s0.r, y), s0.jd, RETURN_MAX, W_FAR, withPhase, fine);
	}

	// A place to start from, one part at a time, since the Sun moves both the
	// plane and the perigee too much on the way in for a two-body guess.
	// vn first: with plenty of vt, the vn whose path arrives least tilted to
	// the tether's plane (it barely depends on vt).
	var vr0 = O.vDot(w1.v, O.vUnit(w1.r)), vMax = Math.max(O.vMag(w1.v), 50);
	function tiltAt(vn) {
		var q = far([0.8 * vMax, vr0, vn], false);
		return q && q.prograde ? q.tilt : Infinity;
	}
	var vn0 = 0, tBest = Infinity, dVn = vMax / 20;
	for (var j = -10; j <= 10; j++) {
		var tj = tiltAt(j * dVn);
		if (tj < tBest) { tBest = tj; vn0 = j * dVn; }
	}
	if (!isFinite(tBest)) { return fail("no-perigee", "The path from a burn at the far crossing of Earth's equatorial plane does not come back to Earth."); }
	var nLo = vn0 - dVn, nHi = vn0 + dVn, nc = nHi - GOLD * (nHi - nLo), nd = nLo + GOLD * (nHi - nLo), fnc = tiltAt(nc), fnd = tiltAt(nd);
	for (var g = 0; g < 8; g++) {
		if (fnc < fnd) { nHi = nd; nd = nc; fnd = fnc; nc = nHi - GOLD * (nHi - nLo); fnc = tiltAt(nc); }
		else { nLo = nc; nc = nd; fnc = fnd; nd = nLo + GOLD * (nHi - nLo); fnd = tiltAt(nd); }
	}
	vn0 = (nLo + nHi) / 2;
	// Then vt, for the speed match: bracket it and bisect. More vt lifts the
	// perigee, where the ship is slower and the tether faster, so the match is
	// where the ship's surplus speed falls through zero with the ship still
	// going the tether's way round. (With very little vt the Sun's pull can
	// carry the path through Earth's centre line and bring it in backwards;
	// the surplus changes sign there too, with no match.)
	var lo = null, hi = null, prev = null;
	for (var s = 1; s <= SCAN && hi === null; s++) {
		var vt = 1.2 * vMax * s / SCAN, m = far([vt, vr0, vn0], false);
		if (m && prev && prev.m.speed > 0 && m.speed < 0 && m.prograde) { lo = prev; hi = { vt: vt, m: m }; }
		prev = m ? { vt: vt, m: m } : null;
	}
	if (hi === null) {
		return fail("no-perigee", "No burn at the path's far crossing of Earth's equatorial plane brings its perigee onto the tether. Try a release that goes out a different way.");
	}
	for (var b = 0; b < 12; b++) {
		var mid = (lo.vt + hi.vt) / 2, mm = far([mid, vr0, vn0], false);
		if (!mm) { break; }
		if (mm.speed < 0) { hi = { vt: mid, m: mm }; } else { lo = { vt: mid, m: mm }; }
	}
	// Then the whole meeting. First the speed and the plane, by vt, vn and the
	// burn's instant (vn turns the path's plane about the line to Earth, and
	// moving the burn off the crossing turns it the other way); then the
	// tether's timing too, with vr; then the same again with the fine step.
	var H4 = [1e-3, 1e-3, 1e-3, 5], CAP = [10, 10, 10, 6 * 3600];
	var fit = leastSquares(function (u) { return far([u[0], vr0, u[1], u[2]], false); }, [(lo.vt + hi.vt) / 2, vn0, 0],
		[H4[0], H4[2], H4[3]], [CAP[0], CAP[2], CAP[3]], 40, 1e-2);
	if (fit) {
		// Carry on from the burn's new instant, and bring the tether round to
		// the perigee with vr alone before solving all four together.
		var y = [fit.x[0], vr0, fit.x[1], 0], moved = coasted(fit.x[2]);
		t1 += fit.x[2]; w1 = { r: moved.r, v: moved.v, jd: moved.jd };
		for (var n = 0; n < 4; n++) {
			var here = far(y, true), there = far([y[0], y[1] + 0.05, y[2], 0], true);
			if (!here || !there) { break; }
			var slope = Math.atan2(Math.sin(there.phase - here.phase), Math.cos(there.phase - here.phase)) / 0.05;
			if (Math.abs(here.phase) < 1e-3 || !(Math.abs(slope) > 1e-9)) { break; }
			y[1] -= Math.max(-5, Math.min(5, here.phase / slope));
		}
		fit = leastSquares(function (q) { return far(q, true); }, y, H4, CAP, 12, 1);
	}
	if (!fit) { return fail("no-perigee", "The path from the far burn does not come back to Earth."); }
	var burnAt = coasted(fit.x[3]);
	t1 += fit.x[3];
	w1 = stateAt([{ t: t1, burn: ZERO }], 0, t1);
	if (!w1) { return fail("no-flight", "The path ends before the far burn."); }
	var c1 = O.burnComponents(w1.relR, w1.relV, O.vSub(after(burnAt.r, fit.x), w1.v));
	if (Math.max(Math.abs(c1.pro), Math.abs(c1.rad), Math.abs(c1.nrm)) > MAX_AXIS_MPS) {
		return fail("too-big", "The far burn this release needs is over " + MAX_AXIS_MPS + " m/s along one axis. Try a release that reaches further out, where the ship is slower.");
	}
	var waypoints = [{ t: t1, burn: { pro: c1.pro, rad: c1.rad, nrm: c1.nrm } }];

	// The flight as flown through the far burn, and its arrival.
	var flown = computeFlight(Object.assign({}, input, { waypoints: waypoints, maxTime: t1 + RETURN_MAX, skipArrival: true }));
	var pass = flown.ok ? perigeeOf(flown.final, fig.GM, t1 + DAY) : null;
	if (!pass) { return fail("no-return", "The path from the far burn does not come back to Earth."); }

	// The trim: a small burn TRIM_LEAD before the arrival, solved on that flight.
	var t2 = pass.t - TRIM_LEAD;
	if (t2 > t1 + DAY) {
		var w2 = stateAt(waypoints.concat([{ t: t2, burn: ZERO }]), 1, t2);
		if (w2) {
			var trimFit = leastSquares(function (d) { return wayIn(w2.r, O.vAdd(w2.v, d), w2.jd, 2 * TRIM_LEAD, W_TRIM, true, true); },
				[0, 0, 0], [1e-4, 1e-4, 1e-4], [5, 5, 5], 30, 0.02);
			if (trimFit) {
				var c2 = O.burnComponents(w2.relR, w2.relV, trimFit.x);
				waypoints.push({ t: t2, burn: { pro: c2.pro, rad: c2.rad, nrm: c2.nrm } });
			}
		}
	}

	var flight = computeFlight(Object.assign({}, input, { waypoints: waypoints }));
	var arr = flight.ok && flight.arrival && flight.arrival.found ? flight.arrival : null;
	return { ok: true, waypoints: waypoints, flight: flight,
	         speed: arr ? arr.trim : null, met: !!(arr && arr.met), caught: !!(arr && arr.caught) };
}
