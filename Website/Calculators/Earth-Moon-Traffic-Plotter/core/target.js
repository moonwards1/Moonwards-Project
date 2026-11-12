/* Earth-Moon-Traffic-Plotter/core/target — Target mode's solve: adjust the
 * release so the ship meets the destination tether, at the point along it
 * where the ship's motion relative to the tether is least.
 *
 * Nothing about the hardware, the clock or the waypoint burns is touched (a
 * burn stays at its time since release, so it moves with the release). The two things a
 * departure skyhook can choose for free are WHEN it lets go (which, on the
 * clock, is also which way) and FROM HOW HIGH on the tether (how fast). Those
 * are the two unknowns.
 *
 * MEETING ONE POINT (solveCatch). Two conditions, core/arrival.js's lineApproach:
 *
 *     miss(tau, h)            = 0     the ship passes through the tether's line
 *     radius(tau, h) - rCatch = 0     and does so at the radius asked for
 *
 *     tau     shift of the release instant, s
 *     h       release altitude, m
 *     miss    signed distance of the closest pass from the tether's line, m
 *     radius  where along the line that pass is, from the body's centre, m
 *     rCatch  the radius of the point to be met, m
 *
 * solved by the Levenberg–Marquardt method (Newton's method with a damping
 * term) on a finite-difference Jacobian, each trial a real flight through
 * core/flight.js — so an answer is a flight that arrives, not an estimate of
 * one. The damping matters: when the ship arrives in the tether's own plane
 * the first condition holds by itself, the two equations become one, and
 * plain Newton has nothing to divide by. Steps are capped so each trial stays
 * on the same pass of the tether as the one before.
 *
 * THE BEST POINT (solveBestCatch). The mobile catcher can be anywhere on the
 * tether, so rCatch is free too. Every rCatch has its own release (tau, h)
 * that meets it, and its own relative motion there:
 *
 *     speed(rCatch) = | v_ship - omega * rCatch * prograde |
 *
 *     v_ship    the ship's velocity at the meeting, relative to the tether's body
 *     omega     the tether's rotation rate, rad/s
 *     prograde  unit vector the way the tether moves
 *
 * solveBestCatch walks rCatch along the tether, downhill in that speed, each
 * step solved as above from the nearest point already solved, then closes in
 * on the lowest point by golden-section search. The flight is a catch when that lowest
 * speed is within arrival.js's CATCH_SPEED_LIMIT.
 *
 * Both are LOCAL by design: they refine a flight the user has already brought
 * close in Free mode, and report failure rather than hunting for a different
 * flight when there is nothing near. The relative motion left at the best
 * point depends on the date, which is the user's to explore.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { computeFlight } from "./flight.js";
import { resolveParams } from "./facilities.js";
import { lineApproach, approachWindow, CATCH_SPEED_LIMIT } from "./arrival.js";

var DAY = 86400;
var GOLD = (Math.sqrt(5) - 1) / 2;
var TOL = 50;                     // m, both conditions — well inside arrival.js's CATCH_REACH
var D_TAU = 0.05, D_H = 2;        // finite-difference steps: s, m
var MAX_TAU = 8, MAX_H = 3e3;     // largest change per iteration: s, m (keeps the pass in the search window)
var H_UNIT = 100;                 // m per unit of h in the damping, so both unknowns weigh alike
var MAX_ITER = 60;
var WALK_FIRST = 64;              // the walk along the tether starts with a stride of this fraction of its length
var POINT_FRAC = 1 / 40;          // how closely the best point is located, as a fraction of the tether (the speed is flat there)
var SURVEY_TOL = 1e3;             // m: how nearly a point surveyed along the way has to be met — its speed is good to about 1 m/s
var SURVEY_FLIGHTS = 10;          // trial flights allowed in reaching one surveyed point from its neighbour

var FAR = "Target could not close the miss from here. Bring the path closer to the tether in Free mode and try again.";
function fail(reason, message) { return { ok: false, reason: reason, message: message }; }

// The flight as the page shows it, and what every solve starts from: the pass
// it is making, and how far past it a trial has to be flown.
// Returns { ok: true, p0, first, reach } or a failure.
function opening(input) {
	var first = computeFlight(input);
	if (!first.ok) { return fail("no-flight", first.diagnostic.message); }
	if (!first.arrival || !first.arrival.found) {
		return fail("no-approach", first.arrival && first.arrival.reason === "never-beside"
			? "This path ends before it comes round to the tether's side."
			: "This path stays in orbit around the Moon, so it never reaches the tether.");
	}
	return { ok: true, first: first, reach: approachWindow(first.toFig) + 600,
	         p0: resolveParams(input.from, input.params && input.params[input.from]) };
}

// Levenberg–Marquardt from `start` to a pass through the tether's line at
// radius rCatch.
//   start: { tau, h, nearT, raw, J } — where to begin, and the pass to follow.
//          `raw` and `J` are optional: the flight already flown at (tau, h) and
//          the Jacobian measured near it, both as a previous refine returned
//          them. A neighbouring point of the tether is then reached in a flight
//          or two, where measuring a Jacobian afresh costs two more each time;
//          a carried Jacobian is measured again as soon as it stops paying.
//   tol    optional: how nearly both conditions must hold, m (default TOL)
//   budget optional: give up after this many trial flights
// Returns { ok: true, tau, h, t, speed, raw, J, iterations } — t the pass's
// time since release, speed the relative motion there — or a failure.
function refine(input, p0, reach, rCatch, start, tol, budget) {
	var nearT = start.nearT, flown = 0;
	tol = tol || TOL;
	function fly(tau, h) {
		if (budget && ++flown > budget) { return null; }
		var params = Object.assign({}, input.params);
		params[input.from] = Object.assign({}, p0, { relAlt: h });
		var f = computeFlight({ from: input.from, to: input.to, jd: input.jd + tau / DAY,
		                        params: params, waypoints: input.waypoints,
		                        maxTime: nearT + reach, skipArrival: true });
		if (!f.ok) { return null; }
		var la = lineApproach(f.final, f.toFig, nearT);
		return la ? judged(la) : null;
	}
	function judged(la) {
		var F = [la.miss, la.radius - rCatch];
		return { raw: la, F: F, norm: Math.hypot(F[0], F[1]), t: la.t, speed: la.speed };
	}
	var tau = start.tau, h = start.h;
	var cur = start.raw ? judged(start.raw) : fly(tau, h);
	if (!cur) { return fail("no-approach", FAR); }
	nearT = cur.t;

	var lambda = 1e-3, J = start.J || null, measuredHere = false;
	for (var it = 0; it < MAX_ITER; it++) {
		if (Math.abs(cur.F[0]) < tol && Math.abs(cur.F[1]) < tol) {
			return { ok: true, tau: tau, h: h, t: cur.t, speed: cur.speed, raw: cur.raw, J: J, iterations: it };
		}
		if (!J) {
			var a = fly(tau + D_TAU, h), b = fly(tau, h + D_H);
			if (!a || !b) { return fail("stalled", FAR); }
			// Jacobian, with h counted in H_UNIT metres.
			J = { j11: (a.F[0] - cur.F[0]) / D_TAU, j21: (a.F[1] - cur.F[1]) / D_TAU,
			      j12: (b.F[0] - cur.F[0]) / D_H * H_UNIT, j22: (b.F[1] - cur.F[1]) / D_H * H_UNIT };
			measuredHere = true;
		}
		var g1 = J.j11 * cur.F[0] + J.j21 * cur.F[1], g2 = J.j12 * cur.F[0] + J.j22 * cur.F[1];
		var a11 = J.j11 * J.j11 + J.j21 * J.j21, a12 = J.j11 * J.j12 + J.j21 * J.j22, a22 = J.j12 * J.j12 + J.j22 * J.j22;
		var next = null, hitEnd = false;
		for (var tries = 0; tries < (measuredHere ? 14 : 3) && !next; tries++) {
			var m11 = a11 * (1 + lambda), m22 = a22 * (1 + lambda);
			var det = m11 * m22 - a12 * a12;
			if (Math.abs(det) > 0) {
				var dTau = -(m22 * g1 - a12 * g2) / det;
				var dH = -(-a12 * g1 + m11 * g2) / det * H_UNIT;
				var scale = Math.min(1, MAX_TAU / Math.abs(dTau || 1e-30), MAX_H / Math.abs(dH || 1e-30));
				var hTry = h + scale * dH;
				if (hTry < p0.footAlt || hTry > p0.topAlt) { hitEnd = true; }
				else {
					var trial = fly(tau + scale * dTau, hTry);
					if (trial && trial.norm < cur.norm) { next = { tau: tau + scale * dTau, h: hTry, res: trial }; }
				}
			}
			if (!next) { lambda *= 8; }
		}
		if (!next) {
			if (!measuredHere) { J = null; lambda = 1e-3; continue; }
			return hitEnd
				? fail("off-tether", "Meeting the tether from here would need a release point beyond the end of the departure tether. Try another date.")
				: fail("stalled", FAR);
		}
		// A Jacobian is kept for the next step only while it is closing the gap fast.
		if (next.res.norm > 0.3 * cur.norm) { J = null; }
		measuredHere = false;
		tau = next.tau; h = next.h; cur = next.res; nearT = cur.t;
		lambda = Math.max(1e-9, lambda / 4);
	}
	return fail("stalled", FAR);
}

// Solve for a catch at the destination's catch altitude (params' catchAlt).
//   input: core/flight.js's computeFlight input, with `to` set.
// Returns { ok: true, jd, relAlt, speed, iterations } — the release instant and
// altitude that arrive, and the relative motion at the meeting, m/s; fly them
// through computeFlight for the path — or { ok: false, reason, message } with
// reason "no-flight" | "no-approach" | "stalled" | "off-tether".
export function solveCatch(input) {
	var o = opening(input);
	if (!o.ok) { return o; }
	var r = refine(input, o.p0, o.reach, o.first.toFig.rCatch, { tau: 0, h: o.p0.relAlt, nearT: o.first.arrival.t });
	return r.ok ? { ok: true, jd: input.jd + r.tau / DAY, relAlt: r.h, speed: r.speed, iterations: r.iterations } : r;
}

// Solve for a catch at whichever point of the destination tether the ship
// meets with the least relative motion.
//   input: as solveCatch's (the destination's catchAlt is not used).
// Returns { ok: true, jd, relAlt, catchAlt, speed, caught, solves } or a
// failure as solveCatch's:
//   jd, relAlt  the release that arrives
//   catchAlt    altitude of the point on the tether where it arrives, m
//   speed       the relative motion there, m/s — the lowest found
//   caught      speed <= CATCH_SPEED_LIMIT
//   solves      how many points along the tether were solved for
export function solveBestCatch(input) {
	var o = opening(input);
	if (!o.ok) { return o; }
	var fig = o.first.toFig, lo = fig.rFoot, hi = fig.rTop, solved = [], solves = 0, lastFail = null;
	// The release that meets the tether at radius rc, started from the nearest
	// point already solved for. Null where there is none. A surveyed point is
	// met only to SURVEY_TOL, and stands at the radius it actually reached.
	function at(rc, exact) {
		var from = null;
		solved.forEach(function (q) { if (!from || Math.abs(q.rc - rc) < Math.abs(from.rc - rc)) { from = q; } });
		solves++;
		var r = refine(input, o.p0, o.reach, rc, from || { tau: 0, h: o.p0.relAlt, nearT: o.first.arrival.t },
			exact ? TOL : SURVEY_TOL, from && !exact ? SURVEY_FLIGHTS : 0);
		if (!r.ok) { lastFail = r; return null; }
		var q = { rc: clamp(r.raw.radius), tau: r.tau, h: r.h, nearT: r.t, speed: r.speed, raw: r.raw, J: r.J };
		solved.push(q);
		return q;
	}
	function clamp(rc) { return Math.max(lo, Math.min(hi, rc)); }
	// Start where the flight passes the tether now.
	var best = at(clamp(o.first.arrival.point));
	if (!best) { return lastFail; }

	// Walk along the tether while the relative motion keeps falling, doubling
	// the stride each time. x0 and x1 end as the radii, either side of the best
	// point found, that the lowest point lies between.
	var stride = (hi - lo) / WALK_FIRST;
	var x0 = clamp(best.rc - stride), x1 = clamp(best.rc + stride);
	var a = x0 < best.rc ? at(x0) : null, b = x1 > best.rc ? at(x1) : null;
	var dir = a && a.speed < best.speed && (!b || a.speed <= b.speed) ? -1 : (b && b.speed < best.speed ? 1 : 0);
	if (dir) {
		var behind = best.rc;
		best = dir < 0 ? a : b;
		for (;;) {
			stride *= 2;
			var x = clamp(best.rc + dir * stride), ahead = x !== best.rc ? at(x) : null;
			if (dir < 0) { x0 = x; x1 = behind; } else { x0 = behind; x1 = x; }
			if (!ahead || ahead.speed >= best.speed) { break; }
			behind = best.rc; best = ahead;
		}
	}

	// Close in on the lowest point between them by golden-section search. A
	// point that cannot be solved for counts as worse than any that can.
	function probe(rc) {
		var q = at(rc);
		if (q && q.speed < best.speed) { best = q; }
		return q ? q.speed : Infinity;
	}
	var pointTol = (hi - lo) * POINT_FRAC;
	if (x1 - x0 > pointTol) {
		var c = x1 - GOLD * (x1 - x0), d = x0 + GOLD * (x1 - x0), fc = probe(c), fd = probe(d);
		while (x1 - x0 > pointTol) {
			if (fc < fd) { x1 = d; d = c; fd = fc; c = x1 - GOLD * (x1 - x0); fc = probe(c); }
			else { x0 = c; c = d; fc = fd; d = x0 + GOLD * (x1 - x0); fd = probe(d); }
		}
	}
	// The survey's best point, now met exactly.
	best = at(best.rc, true) || best;
	return { ok: true, jd: input.jd + best.tau / DAY, relAlt: best.h, catchAlt: best.rc - fig.R,
	         speed: best.speed, caught: best.speed <= CATCH_SPEED_LIMIT, solves: solves };
}
