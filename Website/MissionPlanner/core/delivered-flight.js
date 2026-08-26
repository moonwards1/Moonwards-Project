/* MissionPlanner/core/delivered-flight — the flight the ship is ACTUALLY on.
 *
 * ONE RULE, and this module is where it lives: every figure the compliance bar
 * shows describes the flight flown from what the departure technology really
 * delivers, through the waypoints as they currently stand. Not the plan's
 * commitments, not its requirements — the real thing.
 *
 * WHY THAT NEEDS ITS OWN COMPUTATION. `frozen-plan` is authoritative by design:
 * it always emits the plan's own frozen departure state downstream, so the
 * coast that gets drawn and measured flies from the point the plan ASSUMES the
 * ship leaves. When the plan was authored in the Ephemeris tab that point is
 * derived geometry (body position + R_soi x heading), not a place any real
 * chain comes out — measured on the shipped Moon->Ceres mission, 209,335 km
 * away. So the drawn coast is not the ship's flight. It is the plan's, and
 * until a re-target has closed the gap the two arrive in different places.
 *
 * There is only ONE closest approach, one v-infinity out, one v-infinity in.
 * The drawn coast is a stale estimate of them; this module computes them.
 *
 * CHEAP ENOUGH TO BE LIVE, if it is not recomputed for nothing. The answer
 * depends on the delivered hand-off and the waypoints — never on the clock —
 * so `signatureOf` gives callers a key to memoize on across clock scrubbing.
 * One call costs about one leg integration (3.8 ms on the shipped Moon->Ceres
 * plan), which is the right price on an edit and the wrong one per frame.
 *
 * Pure: plain values in, plain values out, no DOM and no THREE, so it is
 * Node-testable directly.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Frames } from "../../Shared/frames.js";
import { systems } from "../../Shared/orbit.js";
import { computeLeg, nearestApproach } from "../modules/transfer-leg/transfer-leg.js";

var O = OrbitalMath;

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

// What the coast's own burns cost, in m/s: the scalar sum of the waypoint
// impulses. Trims do not cancel — each one is propellant spent — so this adds
// magnitudes rather than the vectors.
export function waypointDv(list) {
	return (list || []).reduce(function (sum, wp) {
		var b = wp.burn || {};
		return sum + O.vMag([b.pro || 0, b.rad || 0, b.nrm || 0]);
	}, 0);
}

// The hyperbolic excess of a body-relative state — the speed the flight still
// has once the body's gravity is done with it. For a distant pass this is
// barely less than the relative speed; inside an SOI it is much less. Returns
// 0 for a state that is bound to the body rather than passing it.
export function vInfOf(GM, rRel, vRel) {
	var r = O.vMag(rRel);
	if (!(r > 0)) { return O.vMag(vRel); }
	var e2 = O.vDot(vRel, vRel) - 2 * GM / r;
	return e2 > 0 ? Math.sqrt(e2) : 0;
}

// A key for memoizing a flight across clock scrubbing: everything the answer
// depends on, and nothing it does not. The clock is deliberately absent.
export function signatureOf(spec) {
	var d = spec.delivered;
	if (!d) { return "none"; }
	return [spec.origin, spec.destination, spec.arrivalJd,
	        d.r.join(","), d.v.join(","), d.jd,
	        (spec.waypoints || []).map(function (w) {
	        	var b = w.burn || {};
	        	return w.days + ":" + (b.pro || 0) + "," + (b.rad || 0) + "," + (b.nrm || 0);
	        }).join("|")].join("/");
}

/* Fly what the technology delivers.
 *
 * spec: {
 *   origin,        // HELIO_BODIES name — the v-infinity out's reference body
 *   destination,   // the plan's arrival body ("" / null for a mission with none)
 *   delivered,     // { r, v, jd } — where the technology ACTUALLY hands over
 *   waypoints,     // the coast's waypoints, in the DELIVERED hand-off's own
 *                  // day-numbering (rebaseWaypoints if they are the plan's)
 *   arrivalJd      // the plan's committed arrival epoch
 * }
 *
 * Returns:
 *   { ok, vInfOut, coastDv, legDays,
 *     pass: { altitude, speed, vInf, jd, insideSoi, rRel, vRel } | null,
 *     leg,                       // the flown leg, for anything wanting the arc
 *     reason }                   // why not, when ok is false
 *
 * `pass` is null when the flight never encounters the destination — a real
 * answer ("this goes nowhere near it"), not a failure.
 */
export function deliveredFlight(spec) {
	var d = spec && spec.delivered;
	if (!d || !d.r || !d.v || !isFinite(d.jd)) {
		return { ok: false, reason: "No hand-off delivered.", pass: null };
	}
	var wps = spec.waypoints || [];
	var out = { ok: false, pass: null, leg: null,
	            vInfOut: NaN, coastDv: waypointDv(wps), legDays: NaN };

	// v-infinity OUT is a property of the hand-off alone — it needs no flight,
	// so it survives even a coast that will not compute.
	var originSys = systems.get(spec.origin);
	if (originSys) {
		out.vInfOut = O.vMag(O.vSub(d.v, Frames.bodyHelioState(spec.origin, d.jd).v));
	}

	if (!isFinite(spec.arrivalJd)) {
		out.reason = "This plan commits to no arrival epoch.";
		return out;
	}
	out.legDays = spec.arrivalJd - d.jd;
	if (!(out.legDays > 0)) {
		out.reason = "The delivered hand-off is at or after the plan's arrival date — " +
			"there is no coast left to fly.";
		return out;
	}

	var leg = computeLeg({ waypoints: wps, legDays: out.legDays, destination: spec.destination },
		{ r: d.r, v: d.v, jd: d.jd });
	if (!leg.ok) {
		out.reason = "The coast flown from the delivered hand-off does not compute.";
		return out;
	}
	out.leg = leg;
	out.ok = true;

	if (!spec.destination) { return out; }        // no destination: no pass to find

	// An outright impact IS the closest approach — altitude 0 — and
	// nearestApproach has no minimum to find past the surface.
	if (leg.impact && leg.impact.body === spec.destination) {
		out.pass = { altitude: 0, speed: (leg.impact.entry || {}).v, vInf: NaN,
		             jd: leg.impact.jd, insideSoi: true, rRel: null, vRel: null };
		return out;
	}

	var ca = nearestApproach(leg, spec.destination);
	if (ca) {
		var sys = systems.get(spec.destination);
		out.pass = { altitude: ca.altitude, speed: ca.speed, jd: ca.jd,
		             insideSoi: ca.insideSoi, rRel: ca.rRel, vRel: ca.vRel,
		             vInf: (sys && ca.rRel && ca.vRel) ? vInfOf(sys.GM, ca.rRel, ca.vRel) : NaN };
	}
	return out;
}
