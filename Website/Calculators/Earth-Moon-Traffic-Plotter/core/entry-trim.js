/* Earth-Moon-Traffic-Plotter/core/entry-trim — aiming an arrival's pass at
 * the aerobrake corridor with the entry trim.
 *
 * The entry trim is the burn an arrival from another world makes where it
 * enters Earth's sphere of influence (core/flight.js). Aim solves it so the
 * pass by Earth comes down to the braking altitude h_b the ship's own
 * aerobrake needs (core/aerobrake.js), changing the trim the user has set by
 * as little as it can:
 *
 *     trim(k) = trim_0 + k * u          u = g / |g|
 *     h(trim(k)) = h_b
 *
 *     trim_0  the trim as set, m/s on the prograde / radial / normal axes
 *     g       how fast the pass's height changes with each axis of the trim,
 *             m per m/s, from the two-body path about Earth (the direction
 *             that moves the pass most per m/s of burn)
 *     h       the pass's height as flown, Earth + Moon + Sun
 *             (core/flight.js's arrivalPass)
 *     k       solved by the secant method, starting from the two-body estimate
 *
 * A trim of more than TRIM_MAX in all is refused: an arrival that needs that
 * much has to be aimed in the Mission Planner.
 *
 * Pure (no DOM): Node-tested in core/tests/aerobrake.test.js.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { arrivalPass, capTrim, TRIM_MAX } from "./flight.js";
import { applyWaypointBurn, burnSize } from "./waypoints.js";
import { brakingNeeds, defaultFreighter, EXIT_APO_DEFAULT, speedAt, NOMINAL_ALT } from "./aerobrake.js";

var O = OrbitalMath;
var GM = systems.get("Earth").GM;
var R_E = +systems.get("Earth").radius;
var AXES = ["pro", "rad", "nrm"];
export var AIM_TOLERANCE = 100;            // m of pass height

// The two-body pass height (m) for the arrival `fig` (core/facilities.js's
// offworldFigures) with trim `t`.
function conicAlt(fig, jd, t) {
	var v = applyWaypointBurn(fig.r, fig.v, jd, t).vAfter, el = O.elementsFromState(GM, fig.r, v);
	return O.periapsisRadius(el.a, el.e) - R_E;
}

// Solve the entry trim. wps: the flight's waypoints (cleanWaypoints). Returns
// { ok: true, trim, alt, target } or { ok: false, reason }.
export function solveEntryTrim(fig, jd, wps) {
	var ship = fig.ship || defaultFreighter(), apo = fig.exitApo || EXIT_APO_DEFAULT;
	var t0 = capTrim(fig.trim), h0 = conicAlt(fig, jd, t0), g = {};
	AXES.forEach(function (a) {
		var t = Object.assign({}, t0); t[a] += 0.5;
		g[a] = (conicAlt(fig, jd, t) - h0) / 0.5;
	});
	var gm = Math.hypot(g.pro, g.rad, g.nrm);
	if (!(gm > 0)) { return { ok: false, reason: "The trim cannot move this pass." }; }
	function trimAt(k) { var t = {}; AXES.forEach(function (a) { t[a] = t0[a] + k * g[a] / gm; }); return t; }
	function miss(k) {
		var p = arrivalPass(Object.assign({}, fig, { trim: null }), jd, trimAt(k), wps);
		if (!p) { return null; }
		var target = brakingNeeds(ship, speedAt(NOMINAL_ALT, p.speed, p.alt), apo).hBrake;
		if (!isFinite(target)) { return null; }
		return { f: p.alt - target, alt: p.alt, target: target };
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
	var trim = trimAt(b), size = burnSize(trim);
	if (size > TRIM_MAX + 1e-6) { return tooBig(size); }
	return { ok: true, trim: trim, alt: fb.alt, target: fb.target };
}
function tooBig(size) {
	return { ok: false, reason: "Reaching the corridor needs a trim of about " + Math.round(size) + " m/s, more than the "
		+ TRIM_MAX + " m/s allowed. Aim the arrival closer in the Mission Planner." };
}
