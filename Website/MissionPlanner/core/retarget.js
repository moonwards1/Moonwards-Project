/* MissionPlanner/core/retarget — re-state the departure REQUIREMENT at the
 * point the ship actually leaves from.
 *
 * THE PROBLEM. A frozen plan commits to a hand-off state — a position, a
 * velocity and an epoch at the origin's SOI edge. When the plan is authored in
 * the Ephemeris tab that position is DERIVED (`body position + R_soi x
 * heading`): a geometric convenience, not a place any real departure chain
 * comes out. A skyhook release with an Oberth pass leaves from somewhere else
 * on that sphere entirely — measured on the shipped Moon->Ceres mission,
 * 209,335 km away — and that offset alone, flown with the plan's own waypoint
 * burns, throws the arrival off by about two million kilometres. It does this
 * while the compliance boundary reads "on course", because that boundary
 * compares speed, epoch and aim direction, and never position.
 *
 * THE FIX IS NOT TO ABSORB IT DOWNSTREAM. A coast waypoint is a trim — the
 * editors cap it at +/-100 m/s per axis (transfer-leg's WAYPOINT_AXIS_CAP_MPS)
 * — and its job is drift, not a systematic aiming error two orders of
 * magnitude larger. Spending the correction budget on the departure's geometry
 * leaves nothing for what the budget is for.
 *
 * So instead: keep the REAL exit point and re-solve what has to be delivered
 * FROM it. This module answers "leaving from where the technology actually
 * leaves, at that moment, what heading and speed reaches the plan's
 * destination?" The answer becomes the plan's new departure requirement, the
 * compliance boundary goes back to reading honestly against it, and the user
 * re-tunes the technology towards it. Re-tuning moves the exit point a little,
 * which re-targets a little: a loop that closes on something the technology can
 * really fly, instead of on a point no chain was ever going to hit.
 *
 * Pure: plain values in, plain values out. Imports computeLeg to VERIFY its own
 * answer by flying it — a solve that doesn't actually arrive is not an answer.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Frames } from "../../Shared/frames.js";
import { systems } from "../../Shared/orbit.js";
import { computeLeg, WAYPOINT_AXIS_CAP_MPS } from "../modules/transfer-leg/transfer-leg.js";
import { MAX_ADOPT_MISS } from "./proximity.js";

var O = OrbitalMath;
var DAY = 86400;
var AU = 149597870700;

function GM_SUN() { return systems.get("Sun").GM; }

export function fmtKm(m) {
	if (!isFinite(m)) { return "an unmeasurable distance"; }
	return Math.round(m / 1000).toLocaleString("en-US") + " km";
}

// Waypoints re-based onto a new hand-off epoch, keeping every ABSOLUTE epoch.
// Any that would fall at or before the new hand-off, or at/after the arrival,
// drop out — they cannot shape a flight that has not started or has ended.
export function rebaseWaypoints(list, shiftDays, legDays) {
	return (list || [])
		.map(function (wp) {
			return { days: wp.days - shiftDays, burn: Object.assign({}, wp.burn) };
		})
		.filter(function (wp) { return isFinite(wp.days) && wp.days > 0 && wp.days < legDays; });
}

// How close does the flight come to the destination, flown from `from` with
// `waypoints` (already re-based) out to `arrivalJd`? Returns metres, 0 for an
// outright interception, Infinity when there is no encounter or the leg won't
// compute. This is `leg.miss` — the CLOSEST the flight ever comes, searched
// across the leg and its overrun — never the state at the leg's end, which
// routinely falls before the closest approach.
export function missFrom(from, waypoints, arrivalJd, destination) {
	var legDays = arrivalJd - from.jd;
	if (!(legDays > 0)) { return Infinity; }
	var leg = computeLeg({ waypoints: waypoints, legDays: legDays, destination: destination },
		{ r: from.r, v: from.v, jd: from.jd });
	if (!leg.ok) { return Infinity; }
	if (leg.impact && leg.impact.body === destination) { return 0; }
	return isFinite(leg.miss) ? leg.miss * AU : Infinity;
}

// The flight as a piecewise conic: coast, burn, coast, ... — the same shape
// computeLeg flies, without its SOI-encounter integration. Fast enough to sit
// inside a differential correction, and faithful enough to aim with; the answer
// is always verified afterwards by flying it for real.
//
// `waypoints` carry days from the start epoch, burns in pro/nrm/rad. Returns
// the state `tDays` after it.
export function propagateWithWaypoints(r0, v0, waypoints, tDays) {
	var wps = (waypoints || []).slice().sort(function (a, b) { return a.days - b.days; });
	var r = r0, v = v0, t = 0;
	for (var i = 0; i < wps.length; i++) {
		if (wps[i].days >= tDays) { break; }
		var st = O.propagateState(GM_SUN(), r, v, (wps[i].days - t) * DAY);
		var b = wps[i].burn || {};
		r = st.r;
		v = O.applyBurn(st.r, st.v, b.pro || 0, b.nrm || 0, b.rad || 0);
		t = wps[i].days;
	}
	return O.propagateState(GM_SUN(), r, v, (tDays - t) * DAY);
}

// Solve a 3x3 system by Gaussian elimination with partial pivoting. Returns
// null if the matrix is singular to working precision.
function solve3(M, b) {
	var A = [[M[0][0], M[0][1], M[0][2], b[0]],
	         [M[1][0], M[1][1], M[1][2], b[1]],
	         [M[2][0], M[2][1], M[2][2], b[2]]];
	for (var c = 0; c < 3; c++) {
		var piv = c;
		for (var r2 = c + 1; r2 < 3; r2++) {
			if (Math.abs(A[r2][c]) > Math.abs(A[piv][c])) { piv = r2; }
		}
		if (Math.abs(A[piv][c]) < 1e-12) { return null; }
		var tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
		for (var r3 = 0; r3 < 3; r3++) {
			if (r3 === c) { continue; }
			var f = A[r3][c] / A[c][c];
			for (var k = c; k < 4; k++) { A[r3][k] -= f * A[c][k]; }
		}
	}
	return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

// DIFFERENTIAL CORRECTION on the departure velocity: find the v at r0 whose
// flight — across the waypoint burns, which stay exactly as authored — arrives
// at `target` after `tDays`. Newton with a numerical Jacobian, damped so a full
// step on a long sensitive arc cannot overshoot into nonsense.
//
// Aiming at the first waypoint instead — matching position there and letting
// the rest replay — is NOT enough. Matching position leaves a VELOCITY mismatch
// at that point, and on the Moon->Ceres mission the few m/s left over grew into
// a 249,418 km miss across the remaining 275 days. The whole flight has to be
// the thing being solved.
export function solveArrivalVelocity(r0, v0Guess, waypoints, tDays, target) {
	var v = v0Guess.slice();
	var best = v.slice(), bestErr = Infinity;
	for (var it = 0; it < 12; it++) {
		var F = O.vSub(propagateWithWaypoints(r0, v, waypoints, tDays).r, target);
		var err = O.vMag(F);
		if (err < bestErr) { bestErr = err; best = v.slice(); }
		if (err < 1e3) { break; }                      // a kilometre over an AU: converged
		var J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
		var d = 1e-3;                                  // 1 mm/s — well inside the linear regime
		for (var c = 0; c < 3; c++) {
			var vp = v.slice(); vp[c] += d;
			var Fp = O.vSub(propagateWithWaypoints(r0, vp, waypoints, tDays).r, target);
			for (var row = 0; row < 3; row++) { J[row][c] = (Fp[row] - F[row]) / d; }
		}
		var step = solve3(J, F);
		if (!step) { break; }
		var damp = 1, improved = false;
		for (var tryN = 0; tryN < 10; tryN++) {
			var vTry = [v[0] - damp * step[0], v[1] - damp * step[1], v[2] - damp * step[2]];
			var e2 = O.vMag(O.vSub(propagateWithWaypoints(r0, vTry, waypoints, tDays).r, target));
			if (e2 < err) { v = vTry; improved = true; break; }
			damp *= 0.5;
		}
		if (!improved) { break; }                      // no step helps — keep the best so far
	}
	return { v: best, err: bestErr };
}

/* Solve the departure requirement at the delivered exit point.
 *
 * spec: {
 *   origin,           // HELIO_BODIES name — the v-infinity's reference body
 *   destination,      // the plan's arrival body
 *   delivered,        // { r, v, jd } — where the technology ACTUALLY hands over
 *   planDeparture,    // { r, v, jd } — what the plan currently commits to
 *   planWaypoints,    // the coast's waypoints, in the PLAN's own day-numbering
 *   arrivalJd         // the plan's committed arrival epoch
 * }
 *
 * Returns, on success:
 *   { ok: true, r, v, jd,        // the new committed hand-off state
 *     vInfVec, vInf,             // what the technology must now deliver
 *     turnDeg, dSpeed,           // how far that is from the current delivery
 *     waypoints, legDays,        // the coast, re-based onto the new epoch
 *     missBefore, missAfter }    // closest approach, delivered vs re-solved
 * or { ok: false, reason, missBefore }.
 */
export function solveDepartureTarget(spec) {
	var d = spec.delivered, p = spec.planDeparture;
	var out = { ok: false, missBefore: Infinity };
	if (!d || !p || !isFinite(spec.arrivalJd)) {
		out.reason = "The plan has no hand-off to re-target.";
		return out;
	}
	var destSys = systems.get(spec.destination);
	if (!destSys || !destSys.orbit) { out.reason = "Unknown destination body."; return out; }

	var legDays = spec.arrivalJd - d.jd;
	if (!(legDays > 0)) {
		out.reason = "The delivered hand-off is at or after the plan's arrival date — " +
			"there is no coast left to fly.";
		return out;
	}
	var shift = d.jd - p.jd;
	var wps = rebaseWaypoints(spec.planWaypoints, shift, legDays);

	// What the technology delivers RIGHT NOW, flown with the plan's own burns.
	out.missBefore = missFrom(d, wps, spec.arrivalJd, spec.destination);

	// THE TARGET is where the PLAN's own flight is at the committed arrival
	// epoch — its intended arrival POINT, not the body's centre. Aiming at the
	// centre would be a collision orbit, and would throw away the flyby offset
	// these plans are deliberately built around.
	var target = propagateWithWaypoints(p.r, p.v, spec.planWaypoints, spec.arrivalJd - p.jd).r;

	// A first guess good enough for Newton to close on: the straight transfer
	// from the delivered exit point to the target, ignoring the burns.
	var guess = O.lambert(GM_SUN(), d.r, target, legDays * DAY, true);
	var sol = solveArrivalVelocity(d.r, guess ? guess.v1 : d.v, wps, legDays, target);

	var bodyV = Frames.bodyHelioState(spec.origin, d.jd).v;
	var vInfVec = O.vSub(sol.v, bodyV);
	var solved = { r: d.r, v: sol.v, jd: d.jd };

	// Verify by flying it for real — the solve above is conic-only, and the leg
	// that actually gets flown integrates SOI encounters.
	var missAfter = missFrom(solved, wps, spec.arrivalJd, spec.destination);
	if (!(missAfter < MAX_ADOPT_MISS)) {
		out.reason = "Re-solved from the delivered exit point the flight still passes " +
			fmtKm(missAfter) + " from " + spec.destination + " — needs to be within " +
			fmtKm(MAX_ADOPT_MISS) + ". This departure is too far off base to re-target; " +
			"author a fresh mission in the Ephemeris tab.";
		out.missAfter = missAfter;
		return out;
	}

	// HOW FAR THE TECHNOLOGY HAS TO MOVE, and the limit on it. Re-targeting
	// compensates for the exit point sitting elsewhere on the SOI sphere, which
	// is at most a couple of SOI radii and costs single-digit m/s to absorb (a
	// 400,000 km offset on the shipped Moon->Ceres plan asks for 1.1 degrees and
	// 3.2 m/s). A Lambert solve will happily answer for a hand-off flung an AU
	// away too — at a 115 degree turn and 14 km/s — but that is not a departure
	// being refined, it is a different mission, and it belongs in the Ephemeris
	// tab. So the required change is held to the same per-axis bound a course
	// correction gets (transfer-leg's WAYPOINT_AXIS_CAP_MPS): normal correction
	// scale, in the frame the departure card states its own vector in.
	var curVInf = O.vSub(d.v, bodyV);
	var ask = O.burnComponents(d.r, bodyV, O.vSub(vInfVec, curVInf));
	var worst = Math.max(Math.abs(ask.pro), Math.abs(ask.rad), Math.abs(ask.nrm));
	if (worst > WAYPOINT_AXIS_CAP_MPS) {
		out.reason = "Re-targeting would ask the departure for " + Math.round(worst) +
			" m/s on one axis, past the " + WAYPOINT_AXIS_CAP_MPS + " m/s correction limit. " +
			"This departure is too far off base to re-point; author a fresh mission in the " +
			"Ephemeris tab.";
		out.missAfter = missAfter;
		return out;
	}
	var mA = O.vMag(curVInf), mB = O.vMag(vInfVec);
	var turnDeg = (mA > 1e-6 && mB > 1e-6)
		? Math.acos(Math.max(-1, Math.min(1, O.vDot(O.vUnit(curVInf), O.vUnit(vInfVec))))) * 180 / Math.PI
		: 0;

	return { ok: true, r: solved.r, v: solved.v, jd: solved.jd,
	         vInfVec: vInfVec, vInf: mB, turnDeg: turnDeg, dSpeed: mB - mA,
	         ask: ask, askWorst: worst,
	         waypoints: wps, legDays: legDays,
	         missBefore: out.missBefore, missAfter: missAfter };
}
