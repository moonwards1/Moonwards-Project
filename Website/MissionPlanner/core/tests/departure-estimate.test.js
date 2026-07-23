// Node tests for core/departure-estimate.js (task D7). Run from the repo
// root:  node --test Website/MissionPlanner/core/tests/departure-estimate.test.js
//
// The wedge-rule cases construct real dates: quarter epochs are found by
// scanning the module's own moonElongationDeg (the same signal the widget's
// glyph draws), and "prograde" means Earth's real heliocentric velocity
// direction at that date — so these tests exercise the actual geometry, not
// a mocked Moon.

import test from "node:test";
import assert from "node:assert/strict";

import {
	estimateDeparture, estimateArrival, moonElongationDeg, moonProgradeSpeed,
	originSoiRadius, MIN_VINF, MOON_DIST, DIVE_WEDGE_DEG
} from "../departure-estimate.js";
import { LunarEphemeris as LE } from "../../../Shared/lunar-ephemeris.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

var GM_SUN = systems.get("Sun").GM;
var EARTH = systems.get("Earth");
var DAY = 86400;
var JD_BASE = 2462502.5;   // 2030-01-01 — inside every planner's date span

// Find the date nearest jd0 (scanning one synodic month at 0.05 d steps)
// where the elongation is closest to targetDeg.
function dateAtElongation(jd0, targetDeg) {
	var best = jd0, bestErr = Infinity;
	for (var d = 0; d <= 29.6; d += 0.05) {
		var jd = jd0 + d;
		var err = Math.abs(((moonElongationDeg(jd) - targetDeg + 540) % 360) - 180);
		if (err < bestErr) { bestErr = err; best = jd; }
	}
	return best;
}

// Earth's heliocentric state via the same elements the planner uses.
function earthState(jd) {
	return O.bodyStateAtJD(GM_SUN, EARTH.orbit, jd);
}

// A launch spec whose exit heading is along (sign +1) or against (sign -1)
// Earth's prograde at the LAUNCH date, handing off at jdLaunch + the
// profile's own estimated flight time. To seat the Moon test at a known
// quarter, we pick the launch date first and derive a hand-off epoch from a
// first-pass estimate — mirroring how the module itself works backwards.
function specFor(jdLaunchWanted, sign, vinf) {
	var pro = O.vUnit(earthState(jdLaunchWanted).v);
	var vInfVec = O.vScale(pro, sign * vinf);
	// first pass: direct-out time locates the hand-off near the wanted launch
	var t0 = estimateDeparture({ origin: "Earth", vInfVec: vInfVec, jdHandoff: jdLaunchWanted }).seconds;
	return { origin: "Earth", vInfVec: vInfVec, jdHandoff: jdLaunchWanted + t0 / DAY };
}

test("wedge rule: first quarter + prograde launch -> dive-in", () => {
	var jdQ1 = dateAtElongation(JD_BASE, 90);
	var est = estimateDeparture(specFor(jdQ1, +1, 5500));
	assert.ok(est.ok);
	assert.equal(est.profile, "dive-in");
	assert.ok(Math.abs(est.days - 2.58) < 0.05, "got " + est.days.toFixed(3) + " d");
});

test("wedge rule: last quarter + retrograde launch -> dive-in", () => {
	var jdQ3 = dateAtElongation(JD_BASE, 270);
	var est = estimateDeparture(specFor(jdQ3, -1, 5500));
	assert.ok(est.ok);
	assert.equal(est.profile, "dive-in");
});

test("wedge rule: full/new and the near-side quarter -> direct-out", () => {
	var jdFull = dateAtElongation(JD_BASE, 180);
	var jdNew = dateAtElongation(JD_BASE, 0);
	var jdQ3 = dateAtElongation(JD_BASE, 270);
	[ [jdFull, +1], [jdNew, +1], [jdQ3, +1],          // prograde: only Q1 dives
	  [jdFull, -1], [jdNew, -1] ].forEach(function (c) {
		var est = estimateDeparture(specFor(c[0], c[1], 5500));
		assert.ok(est.ok);
		assert.equal(est.profile, "direct-out",
			"elong " + moonElongationDeg(c[0]).toFixed(0) + " sign " + c[1]);
		assert.ok(Math.abs(est.days - 1.75) < 0.05, "got " + est.days.toFixed(3) + " d");
	});
});

// A spec whose exit heading sits at a chosen angle from the ANTI-Moon
// direction at the launch the estimate will resolve to: the hand-off epoch
// is seeded so the module's pass-2 Moon lookup (jdHandoff − tDirect) lands
// exactly on jdLaunch, making the wedge angle exact rather than approximate.
function specAtWedgeAngle(jdLaunch, offDeg, vinf) {
	var mHat = O.vUnit(LE.moonVector(jdLaunch));
	var anti = O.vScale(mHat, -1);
	// a unit vector perpendicular to mHat (cross with z, or x if degenerate)
	var perp = O.vUnit(Math.hypot(mHat[0], mHat[1]) > 1e-6
		? [ -mHat[1], mHat[0], 0 ] : [ 1, 0, 0 ]);
	var a = offDeg * Math.PI / 180;
	var dir = O.vUnit(O.vAdd(O.vScale(anti, Math.cos(a)), O.vScale(perp, Math.sin(a))));
	var vInfVec = O.vScale(dir, vinf);
	var tDirect = estimateDeparture({ origin: "Earth", vInfVec: vInfVec,
		jdHandoff: jdLaunch, profile: "direct-out" }).seconds;
	return { origin: "Earth", vInfVec: vInfVec, jdHandoff: jdLaunch + tDirect / DAY };
}

test("the dive wedge is 75° wide: 35° off the anti-Moon axis dives, 40° does not", () => {
	assert.equal(DIVE_WEDGE_DEG, 75);
	var jd = JD_BASE + 3;
	var inside = estimateDeparture(specAtWedgeAngle(jd, 35, 5500));
	var outside = estimateDeparture(specAtWedgeAngle(jd, 40, 5500));
	assert.ok(inside.ok && outside.ok);
	assert.equal(inside.profile, "dive-in");
	assert.equal(outside.profile, "direct-out");   // dived under the old ±45° quarter rule
});

test("profile override pins the course regardless of the Moon's wedge", () => {
	// dive geometry (Q1 + prograde), forced direct-out:
	var qDive = specFor(dateAtElongation(JD_BASE, 90), +1, 5500);
	var f1 = estimateDeparture(Object.assign({}, qDive, { profile: "direct-out" }));
	assert.ok(f1.ok);
	assert.equal(f1.profile, "direct-out");
	assert.ok(Math.abs(f1.days - 1.75) < 0.05, "got " + f1.days.toFixed(3) + " d");
	// direct geometry (full moon), forced dive-in:
	var qDirect = specFor(dateAtElongation(JD_BASE, 180), +1, 5500);
	var f2 = estimateDeparture(Object.assign({}, qDirect, { profile: "dive-in" }));
	assert.ok(f2.ok);
	assert.equal(f2.profile, "dive-in");
	assert.ok(Math.abs(f2.days - 2.58) < 0.05, "got " + f2.days.toFixed(3) + " d");
	// anything unrecognized falls back to the auto wedge rule:
	var auto = estimateDeparture(qDive);
	var junk = estimateDeparture(Object.assign({}, qDive, { profile: "banana" }));
	assert.equal(junk.profile, auto.profile);
	assert.equal(junk.seconds, auto.seconds);
});

test("jdLaunch sits estimate-days before the hand-off", () => {
	var spec = specFor(dateAtElongation(JD_BASE, 180), +1, 5500);
	var est = estimateDeparture(spec);
	assert.ok(est.ok);
	assert.ok(Math.abs((spec.jdHandoff - est.jdLaunch) - est.days) < 1e-9);
});

test("tiny or missing v-infinity: nothing to time", () => {
	assert.equal(estimateDeparture({ origin: "Earth", vInfVec: [MIN_VINF / 2, 0, 0], jdHandoff: JD_BASE }).ok, false);
	assert.equal(estimateDeparture({ origin: "Earth", vInfVec: null, jdHandoff: JD_BASE }).ok, false);
});

test("non-Earth origin keeps the naive estimate; unknown origin refuses", () => {
	var est = estimateDeparture({ origin: "Mars", vInfVec: [3000, 0, 0], jdHandoff: JD_BASE });
	assert.ok(est.ok);
	assert.equal(est.profile, "naive");
	assert.ok(Math.abs(est.seconds - originSoiRadius("Mars") / 3000) < 1);
	assert.equal(estimateDeparture({ origin: "Moon", vInfVec: [3000, 0, 0], jdHandoff: JD_BASE }).ok, false);
});

test("moonElongationDeg cycles through a synodic month", () => {
	// over ~29.5 days the elongation should sweep the full 0..360 wheel:
	// its quarter dates must be spaced roughly a week apart, in order.
	var jdNew = dateAtElongation(JD_BASE, 0);
	var jdQ1 = dateAtElongation(jdNew + 1, 90);
	var jdFull = dateAtElongation(jdNew + 1, 180);
	var jdQ3 = dateAtElongation(jdNew + 1, 270);
	assert.ok(jdQ1 > jdNew && jdFull > jdQ1 && jdQ3 > jdFull);
	assert.ok(Math.abs((jdQ1 - jdNew) - 7.4) < 1.5);
	assert.ok(Math.abs((jdQ3 - jdNew) - 22.1) < 1.5);
});

test("moonProgradeSpeed: ~+1 km/s at full moon, ~-1 km/s at new, ~0 at quarters", () => {
	var jdFull = dateAtElongation(JD_BASE, 180);
	var jdNew = dateAtElongation(JD_BASE, 0);
	var jdQ1 = dateAtElongation(JD_BASE, 90);
	var vFull = moonProgradeSpeed(jdFull, earthState(jdFull).v);
	var vNew = moonProgradeSpeed(jdNew, earthState(jdNew).v);
	var vQ1 = moonProgradeSpeed(jdQ1, earthState(jdQ1).v);
	assert.ok(vFull > 850 && vFull < 1200, "full: " + vFull.toFixed(0));
	assert.ok(vNew < -850 && vNew > -1200, "new: " + vNew.toFixed(0));
	assert.ok(Math.abs(vQ1) < 350, "quarter: " + vQ1.toFixed(0));
});

test("estimateArrival mirrors the direct-out crossing at the same v-infinity", () => {
	var arr = estimateArrival([0, 5500, 0], JD_BASE + 500);
	assert.ok(arr.ok);
	// same two-body crossing time as a 5.5 km/s direct-out departure (~1.75 d)
	assert.ok(Math.abs(arr.days - 1.75) < 0.05, "got " + arr.days.toFixed(3) + " d");
	assert.ok(Math.abs((JD_BASE + 500 - arr.jdSoiEntry) - arr.days) < 1e-9);
	assert.equal(estimateArrival([1, 0, 0], JD_BASE).ok, false);
});

test("MOON_DIST (m) matches the ephemeris's real Moon distance (km) — no unit slip", async () => {
	var LE = (await import("../../../Shared/lunar-ephemeris.js")).LunarEphemeris;
	var distM = O.vMag(LE.moonVector(JD_BASE)) * 1e3;
	assert.ok(Math.abs(distM - MOON_DIST) / MOON_DIST < 0.06,
		"ephemeris says " + (distM / 1e6).toFixed(1) + " thousand km");
});
