/* MissionPlanner/core/lunar-departure — the departure flight from the Moon to
 * Earth's SOI edge, solved from the hand-off the Ephemeris tab authors.
 *
 * A Moon origin is the one origin where the body a ship leaves and the body
 * whose sphere of influence its departure phase exits are different bodies
 * (Shared/frames.js's `escapeReferenceFor`). Leaving the Moon puts a ship
 * 66,168 km from the Moon and still 850,000 km inside Earth's SOI; the
 * departure is not over until it crosses THAT boundary, so the hand-off — the
 * Departure card's own vector — is a velocity relative to EARTH at Earth's SOI
 * edge, exactly as it is for an Earth origin.
 *
 * What this file adds is the flight between those two points, and it is
 * integrated, not constructed. Three gravitational terms decide where and how
 * fast a lunar departure crosses Earth's SOI, and none of them is small:
 *
 *   - The Moon's orbital velocity (~1,022 m/s). It is not spent climbing out:
 *     energy conservation carries it through, slightly amplified (the exit
 *     speed is lower than the release speed, so the derivative exceeds one).
 *     Delete it and a 1.4 km/s release does not escape Earth at all.
 *   - The Moon's own well (2,311 m/s escape at a 100 km release). Ignoring it
 *     misstates the speed at Earth's SOI by 0.9 to 2.2 km/s.
 *   - Earth's remaining well from lunar distance (1,440 m/s escape).
 *
 * A straight line from the Moon along the hand-off heading captures none of
 * the first two and misses the true exit point by 33,000-440,000 km — the
 * flight bends 6-56 degrees on the way out, and the exit lands 75-130 degrees
 * around the sphere from the Moon's own direction. So the leg is flown with
 * Shared/geo-leg.js's Earth+Moon+Sun integrator, the same physics the mission
 * tab's departure leg uses, and the exit point is whatever comes out.
 *
 * WHAT IS SOLVED. The card fixes the hand-off velocity (3 numbers) and its
 * epoch (the tab's clock). The unknowns are the ship's velocity relative to
 * the Moon as it leaves the Moon's SOI (3) and how long before the hand-off it
 * was released (1) — square, and solved by a damped Newton with Broyden
 * updates. The release POINT is placed one Moon-SOI radius along that velocity,
 * the same "one SOI radius along the outbound asymptote" convention the
 * Ephemeris tab already uses at every other origin, and defensible here
 * because the Moon's well is nearly spent at its own SOI edge.
 *
 * The solve has more than one root: a hand-off reachable by a short course can
 * often also be reached by a longer one, at a materially different release
 * cost (856 m/s apart in the case that first showed it). Distinct roots ARE
 * the distinct departure courses, so `searchCourses` enumerates them by seed
 * sweep and the caller picks; `solveLunarDeparture` tracks one root warm,
 * which is what keeps a drawn arc from jumping courses mid-keystroke.
 *
 * IMPACTS ARE NOT THIS FILE'S BUSINESS. A course that would hit the Moon or
 * Earth still solves here — the Ephemeris tab is authoring a plan, and whether
 * a real departure stack can fly it is the mission tab's question, where the
 * departure leg integrates the actual release and reports impacts itself.
 *
 * Pure (no DOM, no THREE) and Node-testable, like the rest of core/.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { systems } from "../../Shared/orbit.js";
import { SOI_EARTH, SOI_MOON, moonGeoPos, moonGeoVel, integrateTrajectory }
	from "../../Shared/geo-leg.js";

var O = OrbitalMath;
var GM_EARTH = systems.get("Earth").GM;
var GM_MOON = systems.get("Moon").GM;
var R_MOON = Number(systems.get("Moon").radius);
var DAY = 86400;

// The altitude the reported release speed is quoted at — a nominal skyhook
// release, not a commitment. Only the RADIUS enters the vis-viva step below,
// never a release direction, so this number is the whole assumption.
export var RELEASE_ALTITUDE = 100e3;

// Convergence: the hand-off velocity to within 0.05 m/s and its epoch to
// within 0.05 s. Two independent solves of the same input agree on the exit
// point to ~0.3 km at this tolerance, well under the ~300 km the exit point
// genuinely moves for a 5 m/s change of the card.
var TOL = 0.05;
var MAX_ITERS = 30;
var LEAD_MIN = 0.05, LEAD_MAX = 60;      // days before the hand-off

// The speed a release at radius rRelease must have to arrive at the Moon's SOI
// edge with excess speed uMag. An exact two-body step through the Moon's well,
// and exact is not an overstatement: against the full Earth+Moon+Sun
// integration it reproduces the release speed to 0.1%.
export function releaseSpeedFor(uMag, rRelease) {
	var r = rRelease == null ? R_MOON + RELEASE_ALTITUDE : rRelease;
	return Math.sqrt(uMag * uMag + 2 * GM_MOON * (1 / r - 1 / SOI_MOON));
}

// Where the flight crosses Earth's SOI, interpolated between the two samples
// that straddle it. Null if it never gets there (bound, or captured by the
// Moon) — the caller reports that, it is not an error here.
function soiCrossing(samples, jd0) {
	for (var i = 1; i < samples.length; i++) {
		var a = O.vMag(samples[i - 1].r), b = O.vMag(samples[i].r);
		if (a < SOI_EARTH && b >= SOI_EARTH) {
			var f = (SOI_EARTH - a) / (b - a), s0 = samples[i - 1], s1 = samples[i];
			var t = s0.t + f * (s1.t - s0.t);
			return {
				t: t, jd: jd0 + t / DAY,
				r: O.vAdd(s0.r, O.vScale(O.vSub(s1.r, s0.r), f)),
				v: O.vAdd(s0.v, O.vScale(O.vSub(s1.v, s0.v), f))
			};
		}
	}
	return null;
}

// One trial flight: released at the Moon's SOI edge along `u`, moving at the
// Moon's velocity plus `u`, integrated with Earth + Moon + Sun gravity.
// Returns the Earth-SOI crossing plus the leg itself, so a caller that wants
// the drawn geometry gets it from the same integration the solve converged on.
export function flyFromMoon(u, jdRelease) {
	var r0 = O.vAdd(moonGeoPos(jdRelease), O.vScale(O.vUnit(u), SOI_MOON));
	var v0 = O.vAdd(moonGeoVel(jdRelease), u);
	var leg = integrateTrajectory(r0, v0, jdRelease, {});
	var cross = soiCrossing(leg.samples, jdRelease);
	return cross ? { exit: cross, leg: leg, r0: r0, v0: v0 } : null;
}

// A first guess good enough to converge from: take the straight-ray exit point
// the tab used to construct outright, walk it BACK along the two-body Earth
// conic to lunar distance, and subtract the Moon. Wrong by hundreds of
// thousands of km as an answer; entirely serviceable as a seed.
function seedU(vInfVec, jdRelease) {
	var mR = moonGeoPos(jdRelease), mV = moonGeoVel(jdRelease);
	var uh = O.vUnit(vInfVec);
	var b = O.vDot(mR, uh), c = O.vDot(mR, mR) - SOI_EARTH * SOI_EARTH;
	var disc = b * b - c;
	if (disc < 0) { return null; }
	var rExit = O.vAdd(mR, O.vScale(uh, -b + Math.sqrt(disc)));
	var rev = O.vScale(vInfVec, -1);
	var tBack = O.coastTimeToRadius(GM_EARTH, rExit, rev, O.vMag(mR));
	if (tBack == null) { return null; }
	var back = O.propagateState(GM_EARTH, rExit, rev, tBack);
	return O.vSub(O.vScale(back.v, -1), mV);
}

// Gauss elimination with partial pivoting on the 4x4 Newton step.
function solve4(J, f) {
	var A = J.map(function (row, i) { return row.concat([-f[i]]); });
	for (var c = 0; c < 4; c++) {
		var p = c;
		for (var r = c + 1; r < 4; r++) { if (Math.abs(A[r][c]) > Math.abs(A[p][c])) { p = r; } }
		if (Math.abs(A[p][c]) < 1e-30) { return null; }
		var tmp = A[c]; A[c] = A[p]; A[p] = tmp;
		for (var r2 = 0; r2 < 4; r2++) {
			if (r2 === c) { continue; }
			var m = A[r2][c] / A[c][c];
			for (var k = c; k <= 4; k++) { A[r2][k] -= m * A[c][k]; }
		}
	}
	return [A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2], A[3][4] / A[3][3]];
}

// The solve. spec = {
//   vInfVec,     // m/s — the card's hand-off velocity, relative to EARTH
//   jdHandoff,   // the tab's clock: when the ship crosses Earth's SOI
//   warm,        // optional previous result — tracks the same course and cuts
//                //   a solve from ~15 integrations to ~4
//   releaseRadius// optional, defaults to a 100 km release
// }
// Returns { ok: true, u, uMag, lead, jdRelease, exit, leg, releaseSpeed, J }
// or { ok: false, reason } with reason one of "no-vinf", "no-seed",
// "no-escape", "singular", "lead-out-of-range", "no-convergence".
export function solveLunarDeparture(spec) {
	var target = spec.vInfVec || [0, 0, 0];
	if (!(O.vMag(target) > 1e-6)) { return { ok: false, reason: "no-vinf" }; }
	var jdH = spec.jdHandoff;

	var u, lead;
	if (spec.warm && spec.warm.u) {
		u = spec.warm.u.slice(); lead = spec.warm.lead;
	} else {
		// A crude time-of-flight guess is enough — the lead is one of the
		// unknowns, so the Newton is what actually places it.
		var rM = O.vMag(moonGeoPos(jdH));
		var vAtMoon = Math.sqrt(O.vDot(target, target) + 2 * GM_EARTH * (1 / rM - 1 / SOI_EARTH));
		lead = (SOI_EARTH - rM) / ((vAtMoon + O.vMag(target)) / 2) / DAY;
		u = seedU(target, jdH - lead);
		if (!u) { return { ok: false, reason: "no-seed" }; }
	}

	function residual(uv, ld) {
		var f = flyFromMoon(uv, jdH - ld);
		if (!f) { return null; }
		var dv = O.vSub(f.exit.v, target);
		return { f: [dv[0], dv[1], dv[2], (f.exit.jd - jdH) * DAY], flight: f };
	}

	var x = [u[0], u[1], u[2], lead];
	var cur = residual(u, lead);
	if (!cur) { return { ok: false, reason: "no-escape" }; }
	var J = (spec.warm && spec.warm.J) ? spec.warm.J.map(function (r) { return r.slice(); }) : null;
	var refreshed = false;
	var STEPS = [2, 2, 2, 0.002];          // m/s, m/s, m/s, days

	for (var it = 0; it < MAX_ITERS; it++) {
		if (Math.hypot(cur.f[0], cur.f[1], cur.f[2], cur.f[3]) < TOL) {
			var uOut = [x[0], x[1], x[2]], uMag = O.vMag(uOut);
			return {
				ok: true, u: uOut, uMag: uMag, lead: x[3], jdRelease: jdH - x[3],
				exit: cur.flight.exit, leg: cur.flight.leg,
				releaseSpeed: releaseSpeedFor(uMag, spec.releaseRadius), J: J
			};
		}
		// Fresh finite-difference Jacobian on the first step (and after any
		// step that walked off the escaping branch); Broyden rank-1 updates
		// after that, which is what makes a warm re-solve cheap.
		if (!J) {
			J = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
			for (var k = 0; k < 4; k++) {
				var xp = x.slice(); xp[k] += STEPS[k];
				var rp = residual([xp[0], xp[1], xp[2]], xp[3]);
				if (!rp) { return { ok: false, reason: "no-escape" }; }
				for (var j = 0; j < 4; j++) { J[j][k] = (rp.f[j] - cur.f[j]) / STEPS[k]; }
			}
		}
		var d = solve4(J, cur.f);
		if (!d) { return { ok: false, reason: "singular" }; }
		var xn = [x[0] + 0.9 * d[0], x[1] + 0.9 * d[1], x[2] + 0.9 * d[2], x[3] + 0.9 * d[3]];
		if (!(xn[3] > LEAD_MIN && xn[3] < LEAD_MAX)) {
			if (J && !refreshed) { J = null; refreshed = true; continue; }
			return { ok: false, reason: "lead-out-of-range" };
		}
		var nxt = residual([xn[0], xn[1], xn[2]], xn[3]);
		if (!nxt) {
			// Overshot into a non-escaping course: halve the step and rebuild.
			J = null; refreshed = true;
			x = [(x[0] + xn[0]) / 2, (x[1] + xn[1]) / 2, (x[2] + xn[2]) / 2, (x[3] + xn[3]) / 2];
			var half = residual([x[0], x[1], x[2]], x[3]);
			if (!half) { return { ok: false, reason: "no-escape" }; }
			cur = half;
			continue;
		}
		var dx = xn.map(function (v, i) { return v - x[i]; });
		var df = nxt.f.map(function (v, i) { return v - cur.f[i]; });
		var dd = dx.reduce(function (s, v) { return s + v * v; }, 0);
		if (dd > 0) {
			var Jdx = J.map(function (row) {
				return row.reduce(function (s, v, i) { return s + v * dx[i]; }, 0);
			});
			for (var jj = 0; jj < 4; jj++) {
				for (var kk = 0; kk < 4; kk++) { J[jj][kk] += (df[jj] - Jdx[jj]) * dx[kk] / dd; }
			}
		}
		x = xn; cur = nxt;
	}
	return { ok: false, reason: "no-convergence" };
}

// Seed leads (days) swept when enumerating courses. Spans the plausible range
// of lunar departure flight times, coarse enough to stay affordable.
var COURSE_SEEDS = [0.4, 0.8, 1.2, 1.8, 2.5, 3.2, 4, 5, 6, 7.5, 9, 11, 14, 18];

// Every distinct course reaching the same hand-off, cheapest release first.
// Roots less than 0.02 d apart in lead are the same course found twice.
// Costs one cold solve per seed, so this is for a deliberate re-plan (a new
// date, a new origin, an explicit "find courses"), not for every keystroke —
// track a chosen course with `warm` instead.
export function searchCourses(spec) {
	var found = [];
	COURSE_SEEDS.forEach(function (lead0) {
		var u0 = seedU(spec.vInfVec, spec.jdHandoff - lead0);
		if (!u0) { return; }
		var s = solveLunarDeparture({
			vInfVec: spec.vInfVec, jdHandoff: spec.jdHandoff,
			releaseRadius: spec.releaseRadius,
			warm: { u: u0, lead: lead0, J: null }
		});
		if (!s.ok) { return; }
		var dup = found.some(function (f) { return Math.abs(f.lead - s.lead) < 0.02; });
		if (!dup) { found.push(s); }
	});
	found.sort(function (a, b) { return a.releaseSpeed - b.releaseSpeed; });
	return found;
}
