/* Earth-Moon-Traffic-Plotter/core/sun-route — the route from an arrival's
 * aerobrake to the L1 elevator, using the Sun's pull to do the heavy work.
 *
 * After the pass (core/aerobrake.js) the ship is on a long, thin orbit about
 * Earth, its perigee still in the air. Out near its apoapsis the Sun's tide
 * twists that orbit, and in the right quadrant it adds angular momentum:
 *
 *     torque ≈ (3/2) n² r² sin 2φ          r_p ≈ h² / (2 GM)
 *
 *     n     Earth's angular rate round the Sun, rad/s
 *     r     the ship's distance from Earth, m
 *     φ     the angle between the ship's direction from Earth and the Sun's
 *     h     the orbit's angular momentum per unit mass, m²/s
 *     r_p   its perigee radius, m
 *
 * The twist builds as r² times the time spent out there, so it grows fast
 * with apoapsis: a loop to 1.3 million km can come back with its perigee at
 * the Moon's distance having burned nothing. That is a ballistic lunar
 * transfer, the route Hiten, GRAIL and CAPSTONE flew.
 *
 * WHAT IS SOLVED. Three levers, all cheap:
 *
 *     r_a     the exit apoapsis — set by how deep the aerobrake goes, free
 *     Δv_a    a burn at apoapsis, where the ship moves at a few tens of m/s:
 *             a few m/s there moves the returning perigee by thousands of km
 *             and its timing by hours
 *     Δv_t    a trim TRIM_LEAD before the meeting, for what is left
 *
 * so that the ship comes back through the elevator's line (core/
 * elevator-arrival.js) between its lower point and its counterweight. The
 * meeting is judged at the ship's closest pass to the line; its miss is
 * split across the line's motion (timing) and out of the plane it turns in.
 * Levenberg–Marquardt (core/least-squares.js) solves r_a and Δv_a together,
 * with a small weight on Δv_a so that of all the meetings it finds the one
 * that burns least; then the trim takes the miss to under CATCH_REACH.
 *
 * MODES. "sun" lets r_a range out to 1.45 million km, inside Earth's Hill
 * sphere (about 1.5 million km), where the Sun lifts the perigee. "direct"
 * keeps r_a within Earth's sphere of influence, where the Sun does little and
 * the apoapsis burn does the lifting: the comparison is fuel against months.
 *
 * SPEED. The search flies the loop many times, so it uses the Moon's and
 * the Sun's positions tabulated once per solve (every 15 minutes and every 6
 * hours) and interpolated, instead of the full ephemeris at every step. The
 * result is flown again in full by core/flight.js, and the trim is corrected
 * on that flight.
 *
 * Pure (no DOM): Node-tested in core/tests/sun-route.test.js.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { LunarEphemeris as LE } from "../../../Shared/lunar-ephemeris.js";
import { buildIntegratedLeg } from "../../../Shared/geo-leg.js";
import { facilityFigures, elevatorAt, L1_FRACTION } from "./facilities.js";
import { computeFlight, arrivalPass, FINE_STEP } from "./flight.js";
import { evaluateElevatorArrival } from "./elevator-arrival.js";
import { brakingNeeds, passAt, speedAt, NOMINAL_ALT, defaultFreighter, EARTH_SOI } from "./aerobrake.js";
import { burnBodyAt, MAX_AXIS_MPS } from "./waypoints.js";
import { CATCH_REACH } from "./arrival.js";
import { leastSquares } from "./least-squares.js";

var O = OrbitalMath;
var DAY = 86400;
var GM_E = systems.get("Earth").GM, GM_M = systems.get("Moon").GM, GM_S = systems.get("Sun").GM;
var R_E = +systems.get("Earth").radius;

export var MODES = {
	sun: { label: "Sun-assisted", range: [0.9e9, 1.45e9] },
	direct: { label: "Direct", range: [0.4e9, 0.9 * EARTH_SOI] }
};
export var TRIM_LEAD = 2 * DAY;
var SCAN_STEP = 0.01e9;           // m: the first search over exit apoapsis
var SPAN_DAYS = 220;              // the longest loop flown
var MOON_DT = 900, SUN_DT = 6 * 3600;
var TURN = 0.01, DT_MAX = 3600;   // RK4 step: ~0.6° of turn, at most an hour
var NEAR = 7e8;                   // m: the meeting is looked for this close to Earth, on the way back in
var ESCAPE = 1.7e9;               // m: a loop that gets this far out has left Earth
var REL_AIM = 600, REL_W = 50;    // m/s: the relative motion aimed under, and its weight

function fail(message) { return { ok: false, message: message }; }

// The Moon and the Sun, tabulated from jd0 and interpolated linearly.
function tables(jd0) {
	var nM = Math.ceil(SPAN_DAYS * DAY / MOON_DT) + 2, nS = Math.ceil(SPAN_DAYS * DAY / SUN_DT) + 2, M = [], S = [];
	for (var i = 0; i < nM; i++) { var m = LE.moonVector(jd0 + i * MOON_DT / DAY); M.push([m[0] * 1e3, m[1] * 1e3, m[2] * 1e3]); }
	for (var j = 0; j < nS; j++) { var s = LE.sunVector(jd0 + j * SUN_DT / DAY); S.push([s[0] * 1e3, s[1] * 1e3, s[2] * 1e3]); }
	function at(T, dt, t) {
		var x = Math.max(0, Math.min(T.length - 1.001, t / dt)), k = Math.floor(x), f = x - k, a = T[k], b = T[k + 1];
		return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
	}
	return {
		moon: function (t) { return at(M, MOON_DT, t); },
		moonVel: function (t) { var a = at(M, MOON_DT, t - 300), b = at(M, MOON_DT, t + 300); return O.vScale(O.vSub(b, a), 1 / 600); },
		sun: function (t) { return at(S, SUN_DT, t); }
	};
}

function third(a, r, rB, GM) {
	var dx = rB[0] - r[0], dy = rB[1] - r[1], dz = rB[2] - r[2];
	var d = Math.hypot(dx, dy, dz), d3 = d * d * d, b = Math.hypot(rB[0], rB[1], rB[2]), b3 = b * b * b;
	a[0] += GM * (dx / d3 - rB[0] / b3); a[1] += GM * (dy / d3 - rB[1] / b3); a[2] += GM * (dz / d3 - rB[2] / b3);
}

// A fast flyer on the tables. t is seconds from the tables' start.
function flyer(T) {
	function acc(r, t) {
		var rm = Math.hypot(r[0], r[1], r[2]), rm3 = rm * rm * rm;
		var a = [-GM_E * r[0] / rm3, -GM_E * r[1] / rm3, -GM_E * r[2] / rm3];
		third(a, r, T.moon(t), GM_M); third(a, r, T.sun(t), GM_S);
		return a;
	}
	function rk4(r, v, t, h) {
		var a1 = acc(r, t);
		var r2 = O.vAdd(r, O.vScale(v, h / 2)), v2 = O.vAdd(v, O.vScale(a1, h / 2)), a2 = acc(r2, t + h / 2);
		var r3 = O.vAdd(r, O.vScale(v2, h / 2)), v3 = O.vAdd(v, O.vScale(a2, h / 2)), a3 = acc(r3, t + h / 2);
		var r4 = O.vAdd(r, O.vScale(v3, h)), v4 = O.vAdd(v, O.vScale(a3, h)), a4 = acc(r4, t + h);
		return { r: O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2, 2)), O.vAdd(O.vScale(v3, 2), v4)), h / 6)),
		         v: O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2, 2)), O.vAdd(O.vScale(a3, 2), a4)), h / 6)) };
	}
	function step(r, v, t) {
		var a = acc(r, t), am = Math.max(1e-12, O.vMag(a)), dm = O.vMag(O.vSub(r, T.moon(t)));
		var cap = dm < 1e8 ? Math.min(DT_MAX, 2e6 / Math.max(1, O.vMag(v))) : DT_MAX;
		return Math.max(1, Math.min(cap, TURN * Math.max(1, O.vMag(v)) / am));
	}
	// Fly (r, v) from t0 to t1. Returns the end state, or { impact } / { escape }.
	function to(r, v, t0, t1, onStep) {
		var t = t0;
		while (t < t1) {
			var h = Math.min(step(r, v, t), t1 - t), s = rk4(r, v, t, h);
			if (onStep) { onStep(r, v, t, h); }
			r = s.r; v = s.v; t += h;
			var rm = O.vMag(r);
			if (rm < R_E) { return { impact: true, t: t }; }
			if (rm > ESCAPE) { return { escape: true, t: t }; }
		}
		return { r: r, v: v, t: t };
	}
	return { to: to, rk4: rk4, step: step };
}

// The ship against the elevator's line at time t (s from the tables' start):
// where along it (x, from the Moon's centre towards Earth), and the miss
// split along the line's motion (dT) and out of its plane (dN), m.
function lineProbe(T, r, t, v) {
	var rM = T.moon(t), vM = T.moonVel(t), D = O.vMag(rM), u = O.vScale(rM, -1 / D);
	var w = O.vScale(vM, -1), uDot = O.vScale(O.vSub(w, O.vScale(u, O.vDot(u, w))), 1 / D);
	var travel = O.vScale(O.vUnit(uDot), -1), n = O.vUnit(O.vCross(u, travel));
	var d = O.vSub(r, rM), x = O.vDot(d, u), perp = O.vSub(d, O.vScale(u, x));
	var rel = v ? O.vMag(O.vSub(v, O.vAdd(vM, O.vScale(uDot, x)))) : null;
	return { x: x, dT: O.vDot(perp, travel), dN: O.vDot(perp, n), dist: O.vMag(perp), rel: rel };
}

// Solve the route. input: core/flight.js's computeFlight input, from an
// offworld arrival to the L1 elevator; mode: "sun" | "direct".
// Returns { ok: true, exitApo, waypoints, flight, burns, speed, met, caught,
// days } or { ok: false, message }.
export function solveRoute(input, mode) {
	var M = MODES[mode] || MODES.sun;
	var fig = facilityFigures("offworld", input.params && input.params.offworld);
	if (!fig.ok) { return fail(fig.diagnostic.message); }
	var toFig = facilityFigures(input.to, input.params && input.params[input.to]);
	if (!toFig.ok || toFig.kind !== "elevator") { return fail("The route is solved to the L1 elevator."); }
	var pass = arrivalPass(fig, input.jd, fig.trim, []);
	if (!pass || pass.impact || pass.alt <= 0) { return fail("The ship does not pass through the air. Aim the pass at the corridor first."); }
	var ship = fig.ship || defaultFreighter();
	var mid = (M.range[0] + M.range[1]) / 2;
	var needs = brakingNeeds(ship, pass.speed, pass.alt, mid, fig.tankFill);
	if (!passAt(needs, pass.alt, pass.speed).inCorridor) {
		return fail("The pass is not in the aerobrake corridor. Use Aim at the corridor on the Offworld arrival card first.");
	}

	var T = tables(pass.jd), F = flyer(T), rp = O.vMag(pass.r), vHat = O.vUnit(pass.v);
	var sLo = toFig.rLowSet, sHi = toFig.rCw;
	function vOut(ra) { return Math.sqrt(2 * GM_E * ra / (rp * (ra + rp))); }
	function tApoOf(ra) { var a = (rp + ra) / 2; return Math.PI * Math.sqrt(a * a * a / GM_E); }

	// The meeting from a state (r, v) at t: the closest pass to the line on
	// the way back in. Returns { t, x, dT, dN, r, v } or null.
	function meet(r, v, t, tMin) {
		var best = null, prevIn = false;
		var end = F.to(r, v, t, SPAN_DAYS * DAY, function (rr, vv, tt, h) {
			if (tt < tMin) { return; }
			var rm = O.vMag(rr);
			if (rm > NEAR) { if (prevIn && best) { throw best; } return; }
			prevIn = true;
			var q = lineProbe(T, rr, tt);
			if (q.x > 0 && (!best || q.dist < best.q.dist)) { best = { q: q, r: rr, v: vv, t: tt, h: h }; }
		});
		if (!best) { return null; }
		return refine(best, end);
	}
	function refine(best) {
		var lo = Math.max(0, best.t - best.h), base = best;
		function at(dt) { var s = F.rk4(base.r, base.v, base.t, dt); return { r: s.r, v: s.v, q: lineProbe(T, s.r, base.t + dt, s.v) }; }
		var a = -best.h, b = best.h, G = (Math.sqrt(5) - 1) / 2;
		var c = b - G * (b - a), d = a + G * (b - a), fc = at(c).q.dist, fd = at(d).q.dist;
		for (var i = 0; i < 40 && b - a > 0.5; i++) {
			if (fc < fd) { b = d; d = c; fd = fc; c = b - G * (b - a); fc = at(c).q.dist; }
			else { a = c; c = d; fc = fd; d = a + G * (b - a); fd = at(d).q.dist; }
		}
		var dt = (a + b) / 2, s = at(dt);
		return { t: best.t + dt, x: s.q.x, dT: s.q.dT, dN: s.q.dN, rel: s.q.rel, r: s.r, v: s.v };
	}
	// The returning perigee from a state (r, v) at t: { t, r, v } or null.
	function perigee(r, v, t, tMin) {
		var best = null, rising = false;
		try {
			F.to(r, v, t, SPAN_DAYS * DAY, function (rr, vv, tt, h) {
				if (tt < tMin) { return; }
				var rm = O.vMag(rr);
				if (!best || rm < best.rm) { best = { rm: rm, r: rr, v: vv, t: tt, h: h }; }
				else if (rm > best.rm * 1.02 && best.rm < NEAR) { throw best; }
			});
		} catch (got) { best = got; }
		if (!best || best.rm > NEAR) { return null; }
		var a = -best.h, b = best.h, G = (Math.sqrt(5) - 1) / 2, base = best;
		function rad(dt) { return O.vMag(F.rk4(base.r, base.v, base.t, dt).r); }
		var c = b - G * (b - a), d = a + G * (b - a), fc = rad(c), fd = rad(d);
		for (var i = 0; i < 40 && b - a > 0.5; i++) {
			if (fc < fd) { b = d; d = c; fd = fc; c = b - G * (b - a); fc = rad(c); }
			else { a = c; c = d; fc = fd; d = a + G * (b - a); fd = rad(d); }
		}
		var st = F.rk4(base.r, base.v, base.t, (a + b) / 2);
		return { t: base.t + (a + b) / 2, r: st.r, v: st.v };
	}
	// The perigee against the elevator's line, as farburn.js judges a skyhook's:
	// how far the perigee is from the line's plane (z), the ship's speed out of
	// it (cross), how far round from the line it is (phase, rad), its radius,
	// and the ship's speed along the line's motion less the line's own there.
	function shape(p) {
		var rM = T.moon(p.t), vM = T.moonVel(p.t), D = O.vMag(rM), u = O.vScale(rM, -1 / D);
		var w = O.vScale(vM, -1), uDot = O.vScale(O.vSub(w, O.vScale(u, O.vDot(u, w))), 1 / D);
		var travel = O.vScale(O.vUnit(uDot), -1), n = O.vUnit(O.vCross(u, travel)), rh = O.vUnit(p.r), rp = O.vMag(p.r);
		var x = D - rp, ptSpeed = O.vMag(O.vAdd(vM, O.vScale(uDot, x)));
		return { rp: rp, target: D * (1 - L1_FRACTION), z: O.vDot(p.r, n), cross: O.vDot(p.v, n),
		         phase: Math.atan2(O.vDot(rh, travel), O.vDot(rh, O.vScale(u, -1))),
		         surplus: O.vDot(p.v, travel) - ptSpeed };
	}
	function safeMeet(r, v, t, tMin) {
		try { return meet(r, v, t, tMin); } catch (got) { return refine(got); }
	}
	// The loop for exit apoapsis ra and apoapsis burn b: the state at the burn,
	// and the meeting.
	function loop(ra, b) {
		var tA = tApoOf(ra), s = F.to(pass.r.slice(), O.vScale(vHat, vOut(ra)), 0, tA);
		if (!s.r) { return null; }
		var v1 = O.applyBurn(s.r, s.v, b[0], b[2], b[1]);
		var m = safeMeet(s.r, v1, tA, tA + 5 * DAY);
		return m ? { tA: tA, burnState: s, m: m } : null;
	}
	function loopPerigee(ra, b) {
		var tA = tApoOf(ra), s = F.to(pass.r.slice(), O.vScale(vHat, vOut(ra)), 0, tA);
		if (!s.r) { return null; }
		var p = perigee(s.r, O.applyBurn(s.r, s.v, b[0], b[2], b[1]), tA, tA + 5 * DAY);
		return p ? shape(p) : null;
	}
	// Stage one: a perigee on the line, in its plane, going its way, at L1's distance from Earth.
	function shapeResidual(lam) {
		return function (y) {
			var ra = y[0] * 1e8;
			if (ra < M.range[0] || ra > M.range[1]) { return null; }
			var q = loopPerigee(ra, [y[1], y[2], y[3]]);
			if (!q || q.surplus < -q.rp * 1e-3) { return null; }
			var R = [q.z / 2e6, q.cross / 20, q.phase * q.rp / 2e6, (q.rp - q.target) / 2e6,
			         lam * y[1], lam * y[2], lam * y[3]];
			return { R: R, norm: Math.hypot.apply(null, R), q: q };
		};
	}
	function sPen(x) { return x < sLo ? sLo - x : (x > sHi ? x - sHi : 0); }
	// Relative motion over REL_AIM counts against a meeting, a unit per REL_W.
	function relPen(rel) { return Math.max(0, rel - REL_AIM) / REL_W; }
	function residual(W, lam) {
		return function (y) {
			var ra = y[0] * 1e8;
			if (ra < M.range[0] || ra > M.range[1]) { return null; }
			var L = loop(ra, [y[1], y[2], y[3]]);
			if (!L) { return null; }
			var R = [L.m.dT / W, L.m.dN / W, sPen(L.m.x) / W, relPen(L.m.rel), lam * y[1], lam * y[2], lam * y[3]];
			return { R: R, norm: Math.hypot.apply(null, R), L: L };
		};
	}

	// A first look along the range with no burn: where the loop's perigee
	// comes back, going the Moon's way round.
	var starts = [];
	for (var ra = M.range[0]; ra <= M.range[1] + 1; ra += SCAN_STEP) {
		var q0 = loopPerigee(ra, [0, 0, 0]);
		if (q0 && q0.surplus > -q0.rp * 1e-3) {
			starts.push({ ra: ra, score: Math.hypot(q0.z / 2e6, q0.phase * q0.rp / 2e6, (q0.rp - q0.target) / 2e6) });
		}
	}
	if (!starts.length) {
		return fail("From this pass, no loop out to between " + Math.round(M.range[0] / 1e6) + " and "
			+ Math.round(M.range[1] / 1e6) + " thousand km comes back near the Moon's distance: the ship hits Earth or leaves it. "
			+ "Try turning the arrival with the entry trim, then Aim again.");
	}
	starts.sort(function (a, b) { return a.score - b.score; });
	// Distinct starts: no two closer than three scan steps.
	starts = starts.filter(function (st, i) {
		return !starts.slice(0, i).some(function (o) { return Math.abs(o.ra - st.ra) < 3 * SCAN_STEP; });
	});

	// Then the shape (stage one), then the meeting itself on the line (stage
	// two), from the best few starts; the one that burns least wins.
	var H = [0.002, 0.01, 0.01, 0.01], CAP = [0.3, 10, 10, 10];
	var best = null;
	starts.slice(0, 4).forEach(function (st0) {
		var y = [st0.ra / 1e8, 0, 0, 0];
		var f1 = leastSquares(shapeResidual(1 / 100), y, H, CAP, 30, 1e-3);
		if (f1) { y = f1.x; }
		var fit = null;
		[[2e6, 1 / 200], [2e5, 1 / 400]].forEach(function (stage) {
			var f = leastSquares(residual(stage[0], stage[1]), y, H, [0.1, 3, 3, 3], 25, 1e-3);
			if (f) { y = f.x; fit = f; }
		});
		if (!fit || !fit.res.L) { return; }
		var L = fit.res.L, miss = Math.hypot(L.m.dT, L.m.dN, sPen(L.m.x)), burn = Math.hypot(y[1], y[2], y[3]);
		var score = miss / 1e4 + burn + 10 * relPen(L.m.rel) * REL_W;
		if (!best || score < best.score) { best = { y: y, L: L, miss: miss, burn: burn, score: score }; }
	});
	if (!best || best.miss > 5e7) {
		return fail("No burn near apoapsis brings this loop back past the elevator. Try the other mode, or turn the arrival with the entry trim.");
	}

	// The trim, TRIM_LEAD before the meeting, on the fast flyer.
	var ra1 = best.y[0] * 1e8, L1 = best.L, tTrim = L1.m.t - TRIM_LEAD;
	var b1 = [best.y[1], best.y[2], best.y[3]];
	var vAfter = O.applyBurn(L1.burnState.r, L1.burnState.v, b1[0], b1[2], b1[1]);
	var atTrim = F.to(L1.burnState.r, vAfter, L1.tA, tTrim);
	if (!atTrim.r) { return fail("The loop ends before the trim."); }
	function trimRes(dv) {
		var m = safeMeet(atTrim.r, O.vAdd(atTrim.v, dv), tTrim, tTrim);
		if (!m) { return null; }
		var R = [m.dT / 1e3, m.dN / 1e3, sPen(m.x) / 1e3];
		return { R: R, norm: Math.hypot.apply(null, R), m: m };
	}
	var tf = leastSquares(trimRes, [0, 0, 0], [1e-3, 1e-3, 1e-3], [5, 5, 5], 30, 0.05);
	var dvTrim = tf ? tf.x : [0, 0, 0];

	// The waypoints, on the arrival's own clock, and the flight flown in full.
	var t0 = pass.t;
	function components(r, v, jd, dv) {
		var body = burnBodyAt(r, jd), rel = O.vSub(r, body.r), relV = O.vSub(v, body.v), c = O.burnComponents(rel, relV, dv);
		return { pro: c.pro, rad: c.rad, nrm: c.nrm };
	}
	var apoBurn = { pro: b1[0], rad: b1[1], nrm: b1[2] };
	var trimBurn = components(atTrim.r, atTrim.v, pass.jd + tTrim / DAY, dvTrim);
	var params = Object.assign({}, input.params, { offworld: Object.assign({}, input.params.offworld, { exitApo: ra1 }) });
	var wps = [{ t: t0 + L1.tA, burn: apoBurn }, { t: t0 + tTrim, burn: trimBurn }];
	var big = wps.some(function (w) { return Math.max(Math.abs(w.burn.pro), Math.abs(w.burn.rad), Math.abs(w.burn.nrm)) > MAX_AXIS_MPS; });
	if (big) { return fail("The burns this route needs are over " + MAX_AXIS_MPS + " m/s along one axis."); }

	// The full flight's own figures differ a little from the tables': solve
	// the trim again on the ship's state as the full flight has it there,
	// flying only the last few days each time.
	var flight = computeFlight(Object.assign({}, input, { params: params, waypoints: wps }));
	var w2 = flight.ok ? flight.waypoints[1] : null;
	if (w2 && w2.reached) {
		var fine = leastSquares(function (dv) {
			var leg = buildIntegratedLeg(w2.r, O.vAdd(w2.v, dv), w2.jd, Object.assign({ maxTime: TRIM_LEAD + 2 * DAY }, FINE_STEP));
			var a = evaluateElevatorArrival(leg, toFig);
			if (!a.found) { return null; }
			var at = elevatorAt(toFig, a.jd), D = O.vSub(a.rGeo, a.pointGeo), n = O.vUnit(O.vCross(at.u, at.travel));
			var R = [O.vDot(D, at.travel) / 1e3, O.vDot(D, n) / 1e3, a.gap / 1e3];
			return { R: R, norm: Math.hypot.apply(null, R) };
		}, w2.dv.slice(), [1e-3, 1e-3, 1e-3], [2, 2, 2], 20, CATCH_REACH / 4e3);
		if (fine) {
			var c2 = O.burnComponents(w2.relR, w2.relV, fine.x);
			wps[1] = { t: wps[1].t, burn: { pro: c2.pro, rad: c2.rad, nrm: c2.nrm } };
			trimBurn = wps[1].burn;
			flight = computeFlight(Object.assign({}, input, { params: params, waypoints: wps }));
		}
	}
	var arr = flight && flight.ok && flight.arrival && flight.arrival.found ? flight.arrival : null;
	return { ok: true, mode: mode, exitApo: ra1, waypoints: wps, flight: flight,
	         burns: Math.hypot(b1[0], b1[1], b1[2]) + Math.hypot(trimBurn.pro, trimBurn.rad, trimBurn.nrm),
	         speed: arr ? arr.trim : null, met: !!(arr && arr.met), caught: !!(arr && arr.caught),
	         days: (t0 + L1.m.t) / DAY };
}
