/* MissionPlanner/core/retarget — the Update button's solve: re-state the
 * plan's departure REQUIREMENT at the exit point the technology actually
 * delivers.
 *
 * The plan commits to a hand-off state at the origin's SOI edge; the real
 * departure chain exits somewhere else on that sphere, and the position gap
 * alone can miss the arrival by millions of km while compliance reads "on
 * course" (it compares speed, epoch and aim, never position). This module
 * keeps the REAL exit point and epoch and solves the velocity that reaches
 * the plan's destination from there. Why re-target rather than adopt the
 * delivered state or let coast waypoints absorb the error:
 * Notes/decisions.md, 2026-08-25.
 *
 * It aims for a PASS — closest approach at AIM_PASS_ALTITUDE above the
 * destination, on the side the flight already goes by — and that pass is the
 * ONLY gate on committing (withinTolerance). The size of the ask decides
 * nothing. Notes/decisions.md, 2026-08-26.
 *
 * SCOPE: the departure requirement, nothing else. The coast and arrival
 * phases gate their own commits, and this solve has no say in those. It takes
 * the coast's waypoints exactly as they currently stand — including edits
 * made after the plan was adopted — and solves the departure that flies THAT
 * coast to the destination.
 *
 * Pure: plain values in, plain values out. Every answer is verified by flying
 * it through core/delivered-flight.js — a solve that doesn't actually arrive
 * is not an answer.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Frames } from "../../Shared/frames.js";
import { systems } from "../../Shared/orbit.js";
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
// `waypoints` (already re-based) out to `horizonJd`? Metres above the SURFACE,
// 0 for an outright impact, Infinity when there is no encounter or the leg
// won't compute. Measured at the CLOSEST APPROACH, never at the leg's end,
// which routinely falls before it.
export function passAltitudeFrom(from, waypoints, horizonJd, destination) {
	var f = deliveredFlight({ origin: null, destination: destination, delivered: from,
		waypoints: waypoints, horizonJd: horizonJd });
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

// Differential correction on the departure velocity: find the v at r0 whose
// flight — through the waypoint burns, taken as authored — arrives at `target`
// after `tDays`. Newton with a numerical Jacobian, damped so a full step on a
// long sensitive arc cannot overshoot.
//
// The WHOLE flight is what gets solved. Aiming only at the first waypoint
// matches position there but leaves a velocity mismatch that compounds over
// the rest of the coast into a large miss (Notes/decisions.md, 2026-08-25).
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
		var step = O.solve3(J, F);
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

// A solve counts as an answer only if it reached its aim: solveArrivalVelocity
// returns its best attempt whatever happens, and a stalled attempt can sit
// millions of km from the target. Inside one aim offset the flown verification
// decides; outside it there is nothing to report.
var CONVERGED_M = AIM_PASS_ALTITUDE;

// The departure velocity that hits `target`, from the seeds worth trying.
// Every seed is a real trajectory's own velocity — the one the technology
// delivers, then the one the plan commits to — so the correction converges in
// a few steps. Never seed from a two-point (Lambert) conic: it is singular
// near a 180-degree sweep and starts the correction on an out-of-plane climb
// it cannot walk back (Notes/decisions.md, 2026-08-25).
function bestSolve(r0, seeds, wps, legDays, target) {
	var best = null;
	for (var i = 0; i < seeds.length; i++) {
		if (!seeds[i]) { continue; }
		var s = solveArrivalVelocity(r0, seeds[i], wps, legDays, target);
		if (!best || s.err < best.err) { best = s; }
		if (best.err < CONVERGED_M) { break; }
	}
	return best;
}

/* Solve the departure requirement at the delivered exit point.
 *
 * spec: {
 *   origin,           // HELIO_BODIES name — the v-infinity's reference body
 *   destination,      // the plan's arrival body
 *   delivered,        // { r, v, jd } — where the technology ACTUALLY hands over
 *   planDeparture,    // { r, v, jd } — what the plan currently commits to
 *   coastWaypoints,   // the coast's waypoints, numbered in DAYS FROM THE
 *                     //   DELIVERED hand-off — the same numbering transfer-leg
 *                     //   flies them in, taken as they stand
 *   horizonJd         // the epoch the coast's own duration runs to (its
 *                     //   hand-off + legDays) — the aim epoch, NOT a
 *                     //   committed arrival: the mission arrives at the
 *                     //   closest approach it measures
 * }
 *
 * Returns, whenever a targeting solution exists at all (even one the
 * technology cannot yet deliver — that is what `withinTolerance` is for):
 *   { ok: true, withinTolerance, reason,   // reason is set only when false
 *     r, v, jd,                  // the new committed hand-off state
 *     vInfVec, vInf,             // what the technology must now deliver
 *     turnDeg, dSpeed,           // how far that is from the current delivery
 *     waypoints, legDays,        // the coast, re-based onto the new epoch
 *     passBefore, passAfter }    // pass altitude, delivered vs re-solved
 * `withinTolerance` gates whether Update may commit this; Check reports the
 * figures regardless. `ok: false` (no figures at all — `reason, passBefore`
 * only) means no targeting solution exists to report: no delivered hand-off,
 * no destination, or no encounter anywhere near it.
 */
export function solveDepartureTarget(spec) {
	var d = spec.delivered, p = spec.planDeparture;
	var out = { ok: false, passBefore: Infinity };
	if (!d || !p || !isFinite(spec.horizonJd)) {
		out.reason = "The plan has no hand-off to re-target.";
		return out;
	}
	var destSys = systems.get(spec.destination);
	if (!destSys || !destSys.orbit) { out.reason = "Unknown destination body."; return out; }

	var legDays = spec.horizonJd - d.jd;
	if (!(legDays > 0)) {
		out.reason = "The delivered hand-off is at or after the end of the coast's own " +
			"duration — there is no coast left to fly.";
		return out;
	}
	// The coast's waypoints are already numbered in days from the DELIVERED
	// hand-off — the same clock transfer-leg flies them on — so they are taken
	// as they stand, only clipped to the leg's span. Shifting them onto the
	// plan's assumed epoch would fire burns at dates the drawn coast never
	// fires them at.
	var wps = rebaseWaypoints(spec.coastWaypoints, 0, legDays);

	// What the technology delivers RIGHT NOW, flown with the coast's own burns.
	var now = deliveredFlight({ origin: spec.origin, destination: spec.destination,
		delivered: d, waypoints: wps, horizonJd: spec.horizonJd });
	out.passBefore = (now.ok && now.pass) ? now.pass.altitude : Infinity;

	// The aim is a PASS, not a point: closest approach at AIM_PASS_ALTITUDE,
	// on the side the flight already goes by — the side is kept, the distance
	// standardised (Notes/decisions.md, 2026-08-26). The solver targets a
	// POSITION at the coast's horizon, so the aim point is the body's position
	// there, pushed out along that side. Closest approach does not fall exactly
	// at the horizon, so the loop corrects the offset by the measured altitude
	// error and re-solves — a few passes, each a Newton solve plus a real
	// integrated flight, affordable on a button.
	var aimDir = passOffsetDir(now, spec, p, wps);
	if (!aimDir) {
		out.reason = "The flight from the delivered hand-off never comes near " +
			spec.destination + ", so there is no approach to re-aim. Build the departure " +
			"technology up until it delivers something near what the plan asks for, " +
			"then Check again.";
		return out;
	}
	var bodyR = Frames.bodyHelioState(spec.destination, spec.horizonJd).r;
	var offset = destSys.radius + AIM_PASS_ALTITUDE;
	var sol = null, solved = null, passAfter = Infinity;
	var seeds = [d.v.slice(), p.v.slice()];

	for (var pass = 0; pass < 4; pass++) {
		var target = O.vAdd(bodyR, O.vScale(aimDir, offset));
		sol = bestSolve(d.r, seeds, wps, legDays, target);
		seeds = [sol.v, d.v.slice()];          // each pass starts where the last landed
		solved = { r: d.r, v: sol.v, jd: d.jd };

		// Verified by flying it for real — the solve above is conic-only, and
		// the leg that actually gets flown integrates SOI encounters.
		var flown = deliveredFlight({ origin: spec.origin, destination: spec.destination,
			delivered: solved, waypoints: wps, horizonJd: spec.horizonJd });
		if (!flown.ok || !flown.pass) { passAfter = Infinity; break; }
		passAfter = flown.pass.altitude;
		if (Math.abs(passAfter - AIM_PASS_ALTITUDE) < 0.02 * AIM_PASS_ALTITUDE) { break; }

		// Push the aim out (or pull it in) by the altitude error, and re-point
		// it at the side the flight just passed on.
		offset = Math.max(destSys.radius * 1.05, offset + (AIM_PASS_ALTITUDE - passAfter));
		if (flown.pass.rRel) { aimDir = O.vUnit(flown.pass.rRel); }
	}

	// Only a divergent solve (no encounter at all) has nothing to report. A
	// pass outside MAX_PASS_ALTITUDE, or an expensive ask, is still a real
	// answer: Check's job is to SHOW the requirement, and only Update's commit
	// is gated (withinTolerance, below).
	if (!sol || !(sol.err < CONVERGED_M)) {
		out.reason = "No departure from the delivered exit point reaches " +
			spec.destination + " over the coast's own duration — the closest aim found " +
			"still comes out " + fmtKm(sol ? sol.err : Infinity) + " away, which is not a " +
			"requirement worth stating. Build the departure technology up until it " +
			"delivers something near what the plan asks for, then Check again.";
		return out;
	}

	if (!isFinite(passAfter)) {
		out.reason = "The re-solved flight never comes near " + spec.destination +
			", so there is no requirement to report. Build the departure technology up " +
			"until it delivers something near what the plan asks for, then Check again.";
		return out;
	}

	// The escape body, not always the origin — see Shared/frames.js.
	var bodyV = Frames.bodyHelioState(Frames.escapeReferenceFor(spec.origin), d.jd).v;
	var vInfVec = O.vSub(sol.v, bodyV);

	// How far the technology has to move — a figure for the mission report,
	// never a gate.
	var curVInf = O.vSub(d.v, bodyV);
	var ask = O.burnComponents(d.r, bodyV, O.vSub(vInfVec, curVInf));
	var worst = Math.max(Math.abs(ask.pro), Math.abs(ask.rad), Math.abs(ask.nrm));
	var mA = O.vMag(curVInf), mB = O.vMag(vInfVec);
	var turnDeg = (mA > 1e-6 && mB > 1e-6) ? O.angleBetweenDeg(curVInf, vInfVec) : 0;

	// The one gate: where the re-solved flight actually passes. The size of
	// the ask decides nothing (Notes/decisions.md, 2026-08-26).
	var withinTolerance = passAfter < MAX_PASS_ALTITUDE;
	var reason = withinTolerance ? null
		: "Re-solved from the delivered exit point the flight still passes " +
			fmtKm(passAfter) + " above " + spec.destination + " — needs to be within " +
			fmtKm(MAX_PASS_ALTITUDE) + " before Update can commit it. Build the departure " +
			"technology up until it delivers something near what the plan asks for.";

	return { ok: true, withinTolerance: withinTolerance, reason: reason,
	         r: solved.r, v: solved.v, jd: solved.jd,
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
		spec.coastWaypoints, spec.horizonJd - planDeparture.jd).r;
	var rel = O.vSub(planEnd, Frames.bodyHelioState(spec.destination, spec.horizonJd).r);
	return O.vMag(rel) > 0 ? O.vUnit(rel) : null;
}
