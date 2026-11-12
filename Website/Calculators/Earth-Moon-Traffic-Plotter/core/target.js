/* Earth-Moon-Traffic-Plotter/core/target — Target mode's solve: adjust the
 * release so the ship meets the destination tether at its catch point.
 *
 * Nothing about the hardware, the clock or the waypoint burns is touched (a
 * burn stays at its time since release, so it moves with the release). The two things a
 * departure skyhook can choose for free are WHEN it lets go (which, on the
 * clock, is also which way) and FROM HOW HIGH on the tether (how fast). Those
 * are the two unknowns; the two conditions are core/arrival.js's lineApproach:
 *
 *     miss(tau, h)            = 0     the ship passes through the tether's line
 *     radius(tau, h) - rCatch = 0     and does so at the catch altitude
 *
 *     tau     shift of the release instant, s
 *     h       release altitude, m
 *     miss    signed distance of the closest pass from the tether's line, m
 *     radius  where along the line that pass is, from the body's centre, m
 *     rCatch  the destination's catch radius, m
 *
 * solved by the Levenberg–Marquardt method (Newton's method with a damping
 * term) on a finite-difference Jacobian, each trial a real flight through
 * core/flight.js — so an answer is a flight that arrives, not an estimate of
 * one. The damping matters: when the ship arrives in the tether's own plane
 * the first condition holds by itself, the two equations become one, and
 * plain Newton has nothing to divide by. Steps are capped so each trial stays
 * on the same pass of the tether as the one before.
 *
 * It is LOCAL by design: it refines a flight the user has already brought
 * close in Free mode, and reports failure rather than hunting for a different
 * flight when there is nothing near.
 *
 * What it does not do is match the ship's velocity to the tether's. The speed
 * left over at the catch is core/arrival.js's trim; which date and which
 * catch altitude make that small is for the user to explore.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { computeFlight } from "./flight.js";
import { resolveParams } from "./facilities.js";
import { lineApproach, approachWindow } from "./arrival.js";

var DAY = 86400;
var TOL = 50;                     // m, both conditions — well inside arrival.js's CATCH_REACH
var D_TAU = 0.05, D_H = 2;        // finite-difference steps: s, m
var MAX_TAU = 8, MAX_H = 3e3;     // largest change per iteration: s, m (keeps the pass in the search window)
var H_UNIT = 100;                 // m per unit of h in the damping, so both unknowns weigh alike
var MAX_ITER = 60;

// Solve for a catch.
//   input: core/flight.js's computeFlight input, with `to` set.
// Returns { ok: true, jd, relAlt, iterations } — the release instant and
// altitude that arrive; fly them through computeFlight for the path — or
// { ok: false, reason, message } with reason "no-flight" | "no-approach" |
// "stalled" | "off-tether".
export function solveCatch(input) {
	var p0 = resolveParams(input.from, input.params && input.params[input.from]);
	var nearT = null;

	function fly(tau, h) {
		var params = Object.assign({}, input.params);
		params[input.from] = Object.assign({}, p0, { relAlt: h });
		var f = computeFlight({ from: input.from, to: input.to, jd: input.jd + tau / DAY,
		                        params: params, waypoints: input.waypoints,
		                        maxTime: nearT + reach, skipArrival: true });
		if (!f.ok) { return null; }
		var la = lineApproach(f.final, f.toFig, nearT);
		if (!la) { return null; }
		var F = [la.miss, la.radius - f.toFig.rCatch];
		return { F: F, norm: Math.hypot(F[0], F[1]), t: la.t };
	}
	function fail(reason, message) { return { ok: false, reason: reason, message: message }; }
	var FAR = "Target could not close the miss from here. Bring the path closer to the tether in Free mode and try again.";

	var first = computeFlight(input);
	if (!first.ok) { return fail("no-flight", first.diagnostic.message); }
	if (!first.arrival || !first.arrival.found) {
		return fail("no-approach", first.arrival && first.arrival.reason === "never-beside"
			? "This path ends before it comes round to the tether's side."
			: "This path stays in orbit around the Moon, so it never reaches the tether.");
	}
	// Start from the pass the page is showing, and follow it from here on. Each
	// trial is flown just far enough past it to hold the search window.
	nearT = first.arrival.t;
	var reach = approachWindow(first.toFig) + 600;
	var tau = 0, h = p0.relAlt;
	var cur = fly(tau, h);
	if (!cur) { return fail("no-approach", FAR); }
	nearT = cur.t;

	var lambda = 1e-3;
	for (var it = 0; it < MAX_ITER; it++) {
		if (Math.abs(cur.F[0]) < TOL && Math.abs(cur.F[1]) < TOL) {
			return { ok: true, jd: input.jd + tau / DAY, relAlt: h, iterations: it };
		}
		var a = fly(tau + D_TAU, h), b = fly(tau, h + D_H);
		if (!a || !b) { return fail("stalled", FAR); }
		// Jacobian, with h counted in H_UNIT metres.
		var j11 = (a.F[0] - cur.F[0]) / D_TAU, j21 = (a.F[1] - cur.F[1]) / D_TAU;
		var j12 = (b.F[0] - cur.F[0]) / D_H * H_UNIT, j22 = (b.F[1] - cur.F[1]) / D_H * H_UNIT;
		var g1 = j11 * cur.F[0] + j21 * cur.F[1], g2 = j12 * cur.F[0] + j22 * cur.F[1];
		var a11 = j11 * j11 + j21 * j21, a12 = j11 * j12 + j21 * j22, a22 = j12 * j12 + j22 * j22;
		var next = null, hitEnd = false;
		for (var tries = 0; tries < 14 && !next; tries++) {
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
			return hitEnd
				? fail("off-tether", "Meeting the catch point from here would need a release point beyond the end of the tether. Try another date or catch altitude.")
				: fail("stalled", FAR);
		}
		tau = next.tau; h = next.h; cur = next.res; nearT = cur.t;
		lambda = Math.max(1e-9, lambda / 4);
	}
	return fail("stalled", FAR);
}
