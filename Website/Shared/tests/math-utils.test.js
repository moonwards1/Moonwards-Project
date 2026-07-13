// Node tests for Shared/math-utils.js. Run from the repo root:
//   node --test Website/Shared/tests/math-utils.test.js
//
// Coverage here is the waypoint "snap to" helpers promoted from the
// Solar-System-Trajectory-Plotter for Mission Planner task D2
// (apsisFromBurn, nodeInfo, snapTargetNu, timeToTrueAnomaly, snapTau),
// plus burnComponents (task D3 — the Lambert-targeting decomposition).
// math-utils.js's older functions predate this suite (see Shared/README.md,
// "Testing") and aren't re-covered here.

import test from "node:test";
import assert from "node:assert/strict";

import { OrbitalMath as O } from "../math-utils.js";

var GM_SUN = 1.32712440018e20;
var AU = 149597870700;
var DAY = 86400;

// A circular orbit at 1 AU, at true anomaly 0 (periapsis == apoapsis, so
// "apsis" targets are exactly opposite the start point).
function circularState(nu) {
	nu = nu || 0;
	return O.stateFromElements(GM_SUN, AU, 0, 0, 0, 0, nu);
}
// An elliptical orbit (e=0.5) starting at periapsis, in the ecliptic plane.
function ellipticalStateAtPeriapsis() {
	return O.stateFromElements(GM_SUN, AU, 0.5, 0, 0, 0, 0);
}

test("apsisFromBurn: prograde -> apoapsis, retrograde -> periapsis, none -> unavailable", () => {
	assert.equal(O.apsisFromBurn({ pro: 500 }).label, "apoapsis");
	assert.equal(O.apsisFromBurn({ pro: 500 }).available, true);
	assert.equal(O.apsisFromBurn({ pro: -500 }).label, "periapsis");
	assert.equal(O.apsisFromBurn({ pro: -500 }).available, true);
	assert.equal(O.apsisFromBurn({ pro: 0 }).available, false);
	assert.equal(O.apsisFromBurn(null).available, false);
});

test("nodeInfo: a near-ecliptic arc substitutes the 90/270 true-anomaly points", () => {
	var s = circularState(0.3);
	var ni = O.nodeInfo(GM_SUN, s.r, s.v);
	assert.equal(ni.earthLike, true);
	assert.ok(Math.abs(ni.asc - (0.3 + Math.PI / 2)) < 1e-9);
	assert.ok(Math.abs(ni.desc - (0.3 - Math.PI / 2)) < 1e-9);
});

test("nodeInfo: an inclined orbit reports the true ascending/descending nodes", () => {
	var s = O.stateFromElements(GM_SUN, AU, 0.1, 20 * Math.PI / 180, 0.4, 1.1, 0.2);
	var ni = O.nodeInfo(GM_SUN, s.r, s.v);
	assert.equal(ni.earthLike, false);
	assert.equal(ni.ascLabel, "ascending node");
	assert.equal(ni.descLabel, "descending node");
});

test("snapTargetNu: apsis follows the burn's prograde sign", () => {
	var s = circularState(0);
	assert.equal(O.snapTargetNu(GM_SUN, s.r, s.v, { pro: 500 }, "apsis"), Math.PI);
	assert.equal(O.snapTargetNu(GM_SUN, s.r, s.v, { pro: -500 }, "apsis"), 0);
	assert.equal(O.snapTargetNu(GM_SUN, s.r, s.v, { pro: 0 }, "apsis"), null);
});

test("snapTargetNu: asc/desc read off nodeInfo, an unknown key returns null", () => {
	var s = circularState(0.1);
	var ni = O.nodeInfo(GM_SUN, s.r, s.v);
	assert.equal(O.snapTargetNu(GM_SUN, s.r, s.v, null, "asc"), ni.asc);
	assert.equal(O.snapTargetNu(GM_SUN, s.r, s.v, null, "desc"), ni.desc);
	assert.equal(O.snapTargetNu(GM_SUN, s.r, s.v, null, "bogus"), null);
});

test("timeToTrueAnomaly: half a period to the opposite point on a circular orbit", () => {
	var s = circularState(0);
	var t = O.timeToTrueAnomaly(GM_SUN, s.r, s.v, Math.PI);
	var period = O.ellipticalPeriod(GM_SUN, AU);
	assert.ok(Math.abs(t - period / 2) < 1);
});

test("timeToTrueAnomaly: the exact current point is zero seconds away (snapTau's job to push it forward)", () => {
	var s = circularState(0.7);
	var t = O.timeToTrueAnomaly(GM_SUN, s.r, s.v, 0.7);
	assert.ok(Math.abs(t) < 1e-6);
});

test("timeToTrueAnomaly: null target or non-finite input returns null", () => {
	var s = circularState(0);
	assert.equal(O.timeToTrueAnomaly(GM_SUN, s.r, s.v, null), null);
	assert.equal(O.timeToTrueAnomaly(GM_SUN, s.r, s.v, NaN), null);
});

test("snapTau: apoapsis of a departure burn on a circular start is half a period out", () => {
	var s = circularState(0);
	var tau = O.snapTau(GM_SUN, s.r, s.v, { pro: 500 }, "apsis", 0);
	var period = O.ellipticalPeriod(GM_SUN, AU);
	assert.ok(Math.abs(tau - period / 2) < 1);
});

test("snapTau: a positive offset lands later on the arc than a negative one", () => {
	var s = circularState(0);
	var early = O.snapTau(GM_SUN, s.r, s.v, { pro: 500 }, "apsis", -0.2);
	var late  = O.snapTau(GM_SUN, s.r, s.v, { pro: 500 }, "apsis", 0.2);
	assert.ok(early < late);
});

test("snapTau: a feature essentially at the start pushes to its NEXT pass, not tau~0", () => {
	// Starting AT periapsis and asking for "periapsis" (retrograde-burn apsis)
	// is the degenerate case the DAY floor guards against.
	var s = ellipticalStateAtPeriapsis();
	var tau = O.snapTau(GM_SUN, s.r, s.v, { pro: -500 }, "apsis", 0);
	var period = O.ellipticalPeriod(GM_SUN, AU);
	assert.ok(tau > DAY);
	assert.ok(Math.abs(tau - period) < 1);
});

test("snapTau: no available apsis (zero-prograde burn) returns null", () => {
	var s = circularState(0);
	assert.equal(O.snapTau(GM_SUN, s.r, s.v, { pro: 0 }, "apsis", 0), null);
});

test("burnComponents: round-trips applyBurn on an inclined arc", () => {
	// An inclined, eccentric state — the case where the ecliptic-anchored
	// burnFrame and the osculating r x v frame genuinely differ.
	var s = O.stateFromElements(GM_SUN, 1.3 * AU, 0.3, 12 * Math.PI / 180, 0.7, 1.9, 0.5);
	var pro = 850, nrm = -320, rad = 140;                      // m/s
	var vAfter = O.applyBurn(s.r, s.v, pro, nrm, rad);
	var dv = O.vSub(vAfter, s.v);
	var c = O.burnComponents(s.r, s.v, dv);
	assert.ok(Math.abs(c.pro - pro) < 1e-6);
	assert.ok(Math.abs(c.nrm - nrm) < 1e-6);
	assert.ok(Math.abs(c.rad - rad) < 1e-6);
});

test("burnComponents: an arbitrary Δv re-applies to exactly itself", () => {
	var s = O.stateFromElements(GM_SUN, AU, 0.1, 5 * Math.PI / 180, 0.2, 0.9, 2.1);
	var dv = [431.7, -1200.2, 88.8];                            // m/s, no axis alignment
	var c = O.burnComponents(s.r, s.v, dv);
	var vAfter = O.applyBurn(s.r, s.v, c.pro, c.nrm, c.rad);
	var dvBack = O.vSub(vAfter, s.v);
	assert.ok(O.vMag(O.vSub(dvBack, dv)) < 1e-6);
});

test("lambert: a feasible transfer's v1 really coasts to r2 in dt", () => {
	// 1 AU -> 1.5 AU, ~120° prograde sweep, 200 days: a tame elliptical case.
	var r1 = [AU, 0, 0];
	var ang = 120 * Math.PI / 180;
	var r2 = [1.5 * AU * Math.cos(ang), 1.5 * AU * Math.sin(ang), 0];
	var dt = 200 * DAY;
	var sol = O.lambert(GM_SUN, r1, r2, dt, true);
	assert.ok(sol, "expected a solution");
	assert.ok(Math.abs(sol.dt - dt) < 1);
	var end = O.propagateState(GM_SUN, r1, sol.v1, dt);
	assert.ok(O.vMag(O.vSub(end.r, r2)) / AU < 1e-6);
});

test("lambert: an unreachable time of flight returns null, never a wrong-dt arc", () => {
	// A large prograde sweep demanded in far too little time: the true psi
	// lies below the solver's -4π bracket floor, so the bisection collapses
	// short of dt. It must say null — returning the collapsed 'solution'
	// sent a Target-mode marker 1.4 AU off Mars (task D3 verification).
	var r1 = [AU, 0, 0];
	var ang = 200 * Math.PI / 180;
	var r2 = [1.6 * AU * Math.cos(ang), 1.6 * AU * Math.sin(ang), 0];
	var dt = 20 * DAY;
	var sol = O.lambert(GM_SUN, r1, r2, dt, true);
	if (sol) {
		// if the solver CAN do it, the result must be self-consistent
		var end = O.propagateState(GM_SUN, r1, sol.v1, dt);
		assert.ok(O.vMag(O.vSub(end.r, r2)) / AU < 1e-4);
	} else {
		assert.equal(sol, null);
	}
});
