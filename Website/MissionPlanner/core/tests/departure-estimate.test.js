// Node tests for core/departure-estimate.js. Run from the repo
// root:  node --test Website/MissionPlanner/core/tests/departure-estimate.test.js
//
// Dates here are real: quarter epochs are found by scanning the module's own
// moonElongationDeg (the same signal the widget's glyph draws), and "prograde"
// means Earth's real heliocentric velocity direction at that date — so these
// tests exercise the actual geometry, not a mocked Moon.

import test from "node:test";
import assert from "node:assert/strict";

import {
	estimateDeparture, estimateArrival, moonElongationDeg, moonProgradeSpeed,
	originSoiRadius, MIN_VINF, MOON_DIST
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
// Earth's prograde at the LAUNCH date, handing off at jdLaunch + the estimated
// flight time. The launch date is picked first and the hand-off epoch derived
// from a first-pass estimate — mirroring how the module itself works backwards.
function specFor(jdLaunchWanted, sign, vinf) {
	var pro = O.vUnit(earthState(jdLaunchWanted).v);
	var vInfVec = O.vScale(pro, sign * vinf);
	var t0 = estimateDeparture({ origin: "Earth", vInfVec: vInfVec, jdHandoff: jdLaunchWanted }).seconds;
	return { origin: "Earth", vInfVec: vInfVec, jdHandoff: jdLaunchWanted + t0 / DAY };
}

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

test("non-Earth origin keeps the naive estimate, on the TRUE excess speed", () => {
	var est = estimateDeparture({ origin: "Mars", vInfVec: [3000, 0, 0], jdHandoff: JD_BASE });
	assert.ok(est.ok);
	assert.equal(est.profile, "naive");
	// The card's 3,000 m/s is measured at the SOI edge, where Mars still has a
	// grip; the excess behind it is smaller, so the crossing takes longer than
	// dividing by the edge speed would say.
	assert.ok(est.vInf < 3000, "excess is below the edge speed");
	assert.ok(Math.abs(est.seconds - originSoiRadius("Mars") / est.vInf) < 1);
	assert.ok(est.seconds > originSoiRadius("Mars") / 3000, "and longer than the naive edge-speed answer");
});

test("a Moon origin is solved, not estimated; an unknown origin refuses", () => {
	// The Moon has no heliocentric orbit record, but it does have a departure:
	// it escapes EARTH's SOI, and the flight there is integrated.
	var est = estimateDeparture({ origin: "Moon", vInfVec: [1900, -600, 120], jdHandoff: JD_BASE });
	assert.ok(est.ok, "reason: " + est.reason);
	assert.equal(est.profile, "lunar-integrated");
	assert.ok(est.days > 0.5 && est.days < 20, "release lead " + est.days + " d");
	assert.ok(Math.abs((JD_BASE - est.jdLaunch) - est.days) < 1e-9);
	// It escapes Earth's sphere, so it is timed against Earth's SOI, not the Moon's.
	assert.equal(originSoiRadius("Moon"), originSoiRadius("Earth"));

	assert.equal(estimateDeparture({ origin: "Nowhere", vInfVec: [3000, 0, 0], jdHandoff: JD_BASE }).ok, false);
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

test("estimateArrival: the inbound crossing from Earth's SOI to lunar distance", () => {
	var arr = estimateArrival([0, 5500, 0], JD_BASE + 500);
	assert.ok(arr.ok);
	// The two-body crossing at 5.5 km/s measured at the SOI edge, ~1.75 d.
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
