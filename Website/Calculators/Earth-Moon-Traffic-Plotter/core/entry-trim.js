/* Earth-Moon-Traffic-Plotter/core/entry-trim — aiming an arrival's pass at
 * the aerobrake corridor with the entry trim.
 *
 * The entry trim is the burn an arrival from another world makes where it
 * enters Earth's sphere of influence (core/flight.js). Aim solves it so the
 * loop the aerobrake leaves the ship on reaches out to AIM_APO as flown
 * (core/aerobrake.js), changing the trim the user has set by as little as it
 * can. Every trim it tries lies on one line through the trim as set:
 *
 *     trim(k) = trim_0 + k * u          u = g / |g|
 *
 *     trim_0  the trim as set, m/s on the prograde / radial / normal axes
 *     g       how fast the pass's height changes with each axis of the trim,
 *             m per m/s, from the two-body path about Earth (the direction
 *             that moves the pass most per m/s of burn)
 *     k       m/s along u
 *
 * In two steps:
 *
 *   1. THE TWO-BODY HEIGHT. k is solved by the secant method so the pass as
 *      flown (Earth + Moon + Sun, core/flight.js's arrivalPass) comes down to
 *      the height whose shed leaves for AIM_APO on Earth's conic
 *      (aerobrake.js's heightForApo), to within AIM_TOLERANCE.
 *
 *   2. THE LOOP AS FLOWN. Far out the Sun's pull shortens or stretches the
 *      loop by a fifth or more, so from there k is solved again on the flown
 *      apogee itself:
 *
 *          apo(k) = AIM_APO
 *
 *      apo(k)  the loop's apogee, m from Earth's centre, read off the whole
 *              flight through the pass (core/flight.js's computeFlight)
 *
 *      The apogee climbs with the pass height until, just short of escape, it
 *      jumps to a ship that does not come back; that jump is why this step
 *      brackets the answer first and then closes in by regula falsi (the
 *      Illinois variant), rather than trusting a secant step. A loop that
 *      does not come back counts as too long. Done when the apogee is within
 *      APO_TOLERANCE of AIM_APO, or the bracket is narrower than a few
 *      centimetres of pass height, and the loop on the near side of the jump
 *      is kept.
 *
 * Only the waypoints before the pass are flown, so a burn later in the
 * flight does not move the loop Aim is solving.
 *
 * A trim of more than TRIM_MAX in all is refused: an arrival that needs that
 * much has to be aimed in the Mission Planner.
 *
 * Pure (no DOM): Node-tested in core/tests/aerobrake.test.js.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { arrivalPass, capTrim, computeFlight, TRIM_MAX } from "./flight.js";
import { applyWaypointBurn, burnSize } from "./waypoints.js";
import { brakingNeeds, heightForApo, defaultFreighter, AIM_APO } from "./aerobrake.js";

var O = OrbitalMath;
var GM = systems.get("Earth").GM;
var R_E = +systems.get("Earth").radius;
var AXES = ["pro", "rad", "nrm"];
export var AIM_TOLERANCE = 0.5;            // m of pass height: the corridor is only a few hundred metres wide
export var APO_TOLERANCE = 0.01;           // of AIM_APO: 14,000 km, a few centimetres of pass height
var BRACKET_STEP = 5;                      // m of pass height, the first step looking for the far side of AIM_APO
var MIN_BRACKET = 0.02;                    // m of pass height: a narrower bracket is as close as the trim can tell

// The two-body pass height (m) for the arrival `fig` (core/facilities.js's
// offworldFigures) with trim `t`.
function conicAlt(fig, jd, t) {
	var v = applyWaypointBurn(fig.r, fig.v, jd, t).vAfter, el = O.elementsFromState(GM, fig.r, v);
	return O.periapsisRadius(el.a, el.e) - R_E;
}

// Solve the entry trim. wps: the flight's waypoints (cleanWaypoints). Returns
// { ok: true, trim, alt, target, apo } or { ok: false, reason }:
//   alt     the pass's height as flown with that trim, m
//   target  step 1's two-body height, m
//   apo     the loop's apogee as flown, m from Earth's centre (null if step 2
//           found no loop that comes back, when the trim is step 1's)
export function solveEntryTrim(fig, jd, wps) {
	var ship = fig.ship || defaultFreighter();
	var t0 = capTrim(fig.trim), h0 = conicAlt(fig, jd, t0), g = {};
	AXES.forEach(function (a) {
		var t = Object.assign({}, t0); t[a] += 0.5;
		g[a] = (conicAlt(fig, jd, t) - h0) / 0.5;
	});
	var gm = Math.hypot(g.pro, g.rad, g.nrm);
	if (!(gm > 0)) { return { ok: false, reason: "The trim cannot move this pass." }; }
	function trimAt(k) { var t = {}; AXES.forEach(function (a) { t[a] = t0[a] + k * g[a] / gm; }); return t; }

	// Step 1: the two-body height.
	function miss(k) {
		var p = arrivalPass(Object.assign({}, fig, { trim: null }), jd, trimAt(k), wps);
		if (!p) { return null; }
		var needs = brakingNeeds(ship, p.speed, p.alt, null, fig.tankFill);
		var target = heightForApo(needs, AIM_APO, p.speed, p.alt);
		if (!isFinite(target)) { return null; }
		return { f: p.alt - target, alt: p.alt, target: target, t: p.t };
	}
	var a = 0, fa = miss(0);
	if (!fa) { return { ok: false, reason: "The ship is not coming in towards Earth." }; }
	var b = -fa.f / gm;
	if (burnSize(trimAt(b)) > 1.2 * TRIM_MAX) { return tooBig(burnSize(trimAt(b))); }
	var fb = miss(b);
	for (var i = 0; i < 10 && fb && Math.abs(fb.f) > AIM_TOLERANCE; i++) {
		var c = b - fb.f * (b - a) / (fb.f - fa.f);
		a = b; fa = fb; b = c; fb = miss(b);
	}
	if (!fb || Math.abs(fb.f) > AIM_TOLERANCE) { return { ok: false, reason: "Aim did not settle on the corridor." }; }
	var k1 = b, step1 = fb;

	// Step 2: the loop as flown.
	var before = (wps || []).filter(function (w) { return w.t < step1.t; });
	var params = { r: fig.r, v: fig.v, jd: fig.jd, ship: fig.ship, tankFill: fig.tankFill };
	function flown(k) {
		var f = computeFlight({ from: "offworld", jd: jd,
			params: { offworld: Object.assign({}, params, { trim: trimAt(k) }) }, waypoints: before });
		var ab = f.ok ? f.aerobrake : null;
		if (!ab || ab.pass.falls) { return { k: k, f: -AIM_APO, apo: null, alt: ab ? ab.alt : null }; }
		var lp = ab.loop, back = lp && lp.apo !== null && (lp.peri !== null || !!lp.impact);
		return { k: k, f: back ? lp.apo - AIM_APO : AIM_APO, apo: back ? lp.apo : null, alt: ab.alt };
	}
	var dk = BRACKET_STEP / gm, lo = flown(k1), hi = null, best = lo;
	if (Math.abs(lo.f) > APO_TOLERANCE * AIM_APO) {
		// Find the far side of AIM_APO: higher passes if the loop is short, lower if long.
		var dir = lo.f < 0 ? 1 : -1, near = lo;
		for (var j = 0; j < 10; j++) {
			var far = flown(near.k + dir * dk);
			if ((far.f < 0) !== (near.f < 0)) { lo = near; hi = far; break; }
			near = far; dk *= 2;
		}
		if (hi) {
			if (lo.f > 0) { var sw = lo; lo = hi; hi = sw; }       // lo short of AIM_APO, hi past it
			var side = 0;
			for (var n = 0; n < 40 && Math.abs(hi.k - lo.k) * gm > MIN_BRACKET; n++) {
				var fl = side === -1 ? lo.f / 2 : lo.f, fh = side === 1 ? hi.f / 2 : hi.f;
				var km = lo.k - fl * (hi.k - lo.k) / (fh - fl);
				var m = flown(km);
				if (Math.abs(m.f) <= APO_TOLERANCE * AIM_APO && m.apo !== null) { lo = m; hi = null; break; }
				if (m.f < 0) { lo = m; side = -1; } else { hi = m; side = 1; }
			}
			best = hi && hi.apo !== null && Math.abs(hi.f) < Math.abs(lo.f) ? hi : lo;
		}
	}
	var trim = trimAt(best.apo !== null ? best.k : k1), size = burnSize(trim);
	if (size > TRIM_MAX + 1e-6) { return tooBig(size); }
	return { ok: true, trim: trim, alt: best.apo !== null ? best.alt : step1.alt, target: step1.target, apo: best.apo };
}
function tooBig(size) {
	return { ok: false, reason: "Reaching the corridor needs a trim of about " + Math.round(size) + " m/s, more than the "
		+ TRIM_MAX + " m/s allowed. Aim the arrival closer in the Mission Planner." };
}
