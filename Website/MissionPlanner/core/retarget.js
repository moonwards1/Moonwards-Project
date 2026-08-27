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
 * WHAT IT AIMS FOR is a PASS — closest approach at proximity.js's
 * AIM_PASS_ALTITUDE above the destination's surface, on the side the flight
 * already goes by — not the arrival POINT the plan was authored with. A plan's
 * own flyby offset is whatever the Ephemeris tab happened to be pointed at;
 * once a real departure is flying the mission, what matters is arriving close
 * enough for the arrival phase to take over.
 *
 * Pure: plain values in, plain values out. Every answer is VERIFIED by flying
 * it through core/delivered-flight.js — a solve that doesn't actually arrive
 * is not an answer.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Frames } from "../../Shared/frames.js";
import { systems } from "../../Shared/orbit.js";
import { WAYPOINT_AXIS_CAP_MPS } from "../modules/transfer-leg/transfer-leg.js";
import { MAX_PASS_ALTITUDE, AIM_PASS_ALTITUDE } from "./proximity.js";
import { deliveredFlight, rebaseWaypoints } from "./delivered-flight.js";

var O = OrbitalMath;
var DAY = 86400;

function GM_SUN() { return systems.get("Sun").GM; }

export function fmtKm(m) {
	if (!isFinite(m)) { return "an unmeasurable distance"; }
	return Math.round(m / 1000).toLocaleString("en-US") + " km";
}

// Re-exported so callers that re-base a plan's waypoints onto a new hand-off
// reach it here, alongside the solve that moves the hand-off. One definition,
// in core/delivered-flight.js.
export { rebaseWaypoints };

// How high above the destination does the flight pass, flown from `from` with
// `waypoints` (already re-based) out to `arrivalJd`? Metres above the SURFACE,
// 0 for an outright impact, Infinity when there is no encounter or the leg
// won't compute. Measured at the CLOSEST APPROACH, never at the leg's end,
// which routinely falls before it.
export function passAltitudeFrom(from, waypoints, arrivalJd, destination) {
	var f = deliveredFlight({ origin: null, destination: destination, delivered: from,
		waypoints: waypoints, arrivalJd: arrivalJd });
	return (f.ok && f.pass) ? f.pass.altitude : Infinity;
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
 *     passBefore, passAfter }    // pass altitude, delivered vs re-solved
 * or { ok: false, reason, passBefore }.
 */
export function solveDepartureTarget(spec) {
	var d = spec.delivered, p = spec.planDeparture;
	var out = { ok: false, passBefore: Infinity };
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
	var now = deliveredFlight({ origin: spec.origin, destination: spec.destination,
		delivered: d, waypoints: wps, arrivalJd: spec.arrivalJd });
	out.passBefore = (now.ok && now.pass) ? now.pass.altitude : Infinity;

	// THE AIM IS A PASS, NOT A POINT: closest approach at AIM_PASS_ALTITUDE
	// above the destination's surface. The solver targets a POSITION at the
	// committed arrival epoch, so the aim point is the body's own position
	// there, pushed out along the side the flight already passes on.
	//
	// Keeping the side matters — flipping to the other face of the body would
	// be a different encounter geometry for no reason — but the DISTANCE is
	// deliberately standardised. A plan authored in the Ephemeris tab carries
	// whatever flyby offset it was built with (the Earth->Mars reference aims
	// at ~50,000 km), and once a real departure is flying the mission that
	// offset is not a commitment worth preserving: what matters is
	// arriving close enough for the arrival phase to take over.
	//
	// Closest approach does not fall exactly at the arrival epoch, so one solve
	// does not land on the aim. The loop corrects the offset by the altitude
	// error it measures and re-solves — a few passes, each one a Newton solve
	// plus a real integrated flight, which is affordable on a button.
	var aimDir = passOffsetDir(now, spec, p, wps);
	if (!aimDir) {
		out.reason = "The flight from the delivered hand-off never comes near " +
			spec.destination + ", so there is no approach to re-aim. This departure is " +
			"too far off base to re-target; author a fresh mission in the Ephemeris tab.";
		return out;
	}
	var bodyR = Frames.bodyHelioState(spec.destination, spec.arrivalJd).r;
	var offset = destSys.radius + AIM_PASS_ALTITUDE;
	var sol = null, solved = null, passAfter = Infinity;

	for (var pass = 0; pass < 4; pass++) {
		var target = O.vAdd(bodyR, O.vScale(aimDir, offset));
		var guess = O.lambert(GM_SUN(), d.r, target, legDays * DAY, true);
		sol = solveArrivalVelocity(d.r, guess ? guess.v1 : d.v, wps, legDays, target);
		solved = { r: d.r, v: sol.v, jd: d.jd };

		// Verified by flying it for real — the solve above is conic-only, and
		// the leg that actually gets flown integrates SOI encounters.
		var flown = deliveredFlight({ origin: spec.origin, destination: spec.destination,
			delivered: solved, waypoints: wps, arrivalJd: spec.arrivalJd });
		if (!flown.ok || !flown.pass) { passAfter = Infinity; break; }
		passAfter = flown.pass.altitude;
		if (Math.abs(passAfter - AIM_PASS_ALTITUDE) < 0.02 * AIM_PASS_ALTITUDE) { break; }

		// Push the aim out (or pull it in) by the altitude error, and re-point
		// it at the side the flight just passed on.
		offset = Math.max(destSys.radius * 1.05, offset + (AIM_PASS_ALTITUDE - passAfter));
		if (flown.pass.rRel) { aimDir = O.vUnit(flown.pass.rRel); }
	}

	if (!(passAfter < MAX_PASS_ALTITUDE)) {
		out.reason = "Re-solved from the delivered exit point the flight still passes " +
			fmtKm(passAfter) + " above " + spec.destination + " — needs to be within " +
			fmtKm(MAX_PASS_ALTITUDE) + ". This departure is too far off base to re-target; " +
			"author a fresh mission in the Ephemeris tab.";
		out.passAfter = passAfter;
		return out;
	}

	var bodyV = Frames.bodyHelioState(spec.origin, d.jd).v;
	var vInfVec = O.vSub(sol.v, bodyV);

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
		out.passAfter = passAfter;
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
	         passBefore: out.passBefore, passAfter: passAfter };
}

// Which side of the destination to aim past. The flight as delivered already
// passes on one side, and that is the side to keep. When it has no encounter
// at all to take a bearing from, the PLAN's own intended arrival point stands
// in — it was built to pass somewhere sensible, even if the technology is not
// flying it. Null when neither yields a usable direction.
function passOffsetDir(now, spec, planDeparture, wps) {
	if (now.ok && now.pass && now.pass.rRel && O.vMag(now.pass.rRel) > 0) {
		return O.vUnit(now.pass.rRel);
	}
	var planEnd = propagateWithWaypoints(planDeparture.r, planDeparture.v,
		spec.planWaypoints, spec.arrivalJd - planDeparture.jd).r;
	var rel = O.vSub(planEnd, Frames.bodyHelioState(spec.destination, spec.arrivalJd).r);
	return O.vMag(rel) > 0 ? O.vUnit(rel) : null;
}
