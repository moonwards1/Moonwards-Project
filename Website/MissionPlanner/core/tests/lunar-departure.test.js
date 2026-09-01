// node --test MissionPlanner/core/tests/lunar-departure.test.js
//
// The lunar departure solve, checked the only way that means anything: against
// flights whose answer is already known, because they were flown forward with
// the same integrator before the solver was told anything about them.

import test from "node:test";
import assert from "node:assert/strict";

import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { SOI_EARTH, SOI_MOON, moonGeoPos, moonGeoVel, integrateTrajectory }
	from "../../../Shared/geo-leg.js";
import { Frames } from "../../../Shared/frames.js";
import {
	solveLunarDeparture, searchCourses, releaseSpeedFor, flyFromMoon, RELEASE_ALTITUDE
} from "../lunar-departure.js";

var GM_EARTH = systems.get("Earth").GM;
var GM_MOON = systems.get("Moon").GM;
var R_MOON = Number(systems.get("Moon").radius);
var DAY = 86400;
var JD = 2462005.0;

// Fly a departure forward from a chosen release, and report where it crosses
// Earth's SOI. The solver never sees the release — only this crossing.
function forwardFlight(uMag, tiltDeg, jdRelease) {
	var mR = moonGeoPos(jdRelease), mV = moonGeoVel(jdRelease);
	var p = O.vUnit(mV), n = O.vUnit(O.vCross(mR, mV)), q = O.vUnit(O.vCross(n, p));
	var a = tiltDeg * Math.PI / 180;
	var u = O.vScale(O.vAdd(O.vScale(p, Math.cos(a)), O.vScale(q, Math.sin(a))), uMag);
	var f = flyFromMoon(u, jdRelease);
	return f ? { u: u, exit: f.exit } : null;
}

test("Frames: the Moon resolves through its primary, not a Sun-centred conic", () => {
	var moon = Frames.bodyHelioState("Moon", JD);
	var earth = Frames.bodyHelioState("Earth", JD);
	var sep = O.vMag(O.vSub(moon.r, earth.r));
	assert.ok(sep > 356000e3 && sep < 407000e3, "Earth-Moon separation " + (sep / 1e3) + " km");
	var dv = O.vMag(O.vSub(moon.v, earth.v));
	assert.ok(dv > 900 && dv < 1120, "geocentric speed " + dv + " m/s");
});

test("Frames: a departure from the Moon escapes Earth's SOI, not the Moon's", () => {
	assert.equal(Frames.escapeReferenceFor("Moon"), "Earth");
	assert.equal(Frames.escapeReferenceFor("Mars"), "Mars");
	assert.equal(Frames.escapeReferenceFor("Ceres"), "Ceres");
});

test("the Moon's orbital velocity is not spent climbing out of Earth's well", () => {
	// The null control for the claim the whole module rests on. Same release
	// point, same throw, with and without the Moon's own motion.
	var jdRel = JD - 4;
	var mR = moonGeoPos(jdRel), mV = moonGeoVel(jdRel);
	var toss = O.vScale(O.vUnit(mV), 1400);

	var withMoon = O.coastTimeToRadius(GM_EARTH, mR, O.vAdd(mV, toss), SOI_EARTH);
	var without = O.coastTimeToRadius(GM_EARTH, mR, toss, SOI_EARTH);
	assert.ok(withMoon != null, "riding the Moon, a 1.4 km/s throw escapes");
	assert.equal(without, null, "without the Moon's velocity the same throw stays bound");
});

test("releaseSpeedFor is the exact two-body step through the Moon's well", () => {
	var r = R_MOON + RELEASE_ALTITUDE;
	// Zero excess at the SOI edge is exactly escape speed from the release radius.
	var escape = Math.sqrt(2 * GM_MOON * (1 / r - 1 / SOI_MOON));
	assert.ok(Math.abs(releaseSpeedFor(0, r) - escape) < 1e-6);
	// And energy adds in quadrature, never linearly.
	var s = releaseSpeedFor(800, r);
	assert.ok(Math.abs(s * s - (800 * 800 + escape * escape)) < 1e-3);
	assert.ok(s < 800 + escape, "quadrature, not a sum");
});

test("the solve recovers a flight it was only shown the hand-off of", () => {
	var cases = [[2600, 0], [3000, 25], [3400, -30]];
	var solved = 0;
	cases.forEach(function ([uMag, tilt]) {
		var lead = 4;
		var truth = forwardFlight(uMag, tilt, JD - lead);
		if (!truth) { return; }                       // that throw doesn't escape; skip
		var s = solveLunarDeparture({ vInfVec: truth.exit.v, jdHandoff: truth.exit.jd });
		assert.ok(s.ok, "solve failed: " + s.reason);
		solved++;

		// The hand-off it was asked for, hit to tolerance.
		assert.ok(O.vMag(O.vSub(s.exit.v, truth.exit.v)) < 0.05, "hand-off velocity");
		assert.ok(Math.abs(s.exit.jd - truth.exit.jd) * DAY < 0.05, "hand-off epoch");
		// The exit POINT was never an input, so agreeing on it is the real test.
		assert.ok(O.vMag(O.vSub(s.exit.r, truth.exit.r)) < 5e3,
			"exit point off by " + (O.vMag(O.vSub(s.exit.r, truth.exit.r)) / 1e3) + " km");
	});
	assert.ok(solved >= 2, "at least two cases actually escaped and were solved");
});

test("the integrated exit is nothing like a straight ray from the Moon", () => {
	// Guards the reason this module exists: if a ray were good enough, it
	// would be cheaper. The flight bends, and the exit lands far around the
	// sphere from where a ray puts it.
	var truth = forwardFlight(3000, 20, JD - 4);
	assert.ok(truth, "test flight escapes");
	var mR = moonGeoPos(JD - 4);
	var uh = O.vUnit(truth.exit.v);
	var b = O.vDot(mR, uh), c = O.vDot(mR, mR) - SOI_EARTH * SOI_EARTH;
	var ray = O.vAdd(mR, O.vScale(uh, -b + Math.sqrt(b * b - c)));
	var miss = O.vMag(O.vSub(ray, truth.exit.r));
	assert.ok(miss > 20e3, "ray misses the real exit by " + (miss / 1e3) + " km");
});

test("a warm re-solve tracks the same course and stays cheap", () => {
	var truth = forwardFlight(3000, 15, JD - 4);
	assert.ok(truth, "test flight escapes");
	var first = solveLunarDeparture({ vInfVec: truth.exit.v, jdHandoff: truth.exit.jd });
	assert.ok(first.ok, first.reason);

	var nudged = [truth.exit.v[0] + 5, truth.exit.v[1], truth.exit.v[2]];
	var warm = solveLunarDeparture({ vInfVec: nudged, jdHandoff: truth.exit.jd, warm: first });
	var cold = solveLunarDeparture({ vInfVec: nudged, jdHandoff: truth.exit.jd });
	assert.ok(warm.ok && cold.ok, "both solve");
	// Same course: the two agree far more closely than the exit point moves.
	assert.ok(Math.abs(warm.lead - cold.lead) < 0.02, "same root");
	assert.ok(O.vMag(O.vSub(warm.exit.r, cold.exit.r)) < 5e3, "same exit point");
});

test("distinct courses are found and ordered by what they cost to release", () => {
	var truth = forwardFlight(3000, 20, JD - 4);
	assert.ok(truth, "test flight escapes");
	var courses = searchCourses({ vInfVec: truth.exit.v, jdHandoff: truth.exit.jd });
	assert.ok(courses.length >= 1, "at least one course");
	for (var i = 1; i < courses.length; i++) {
		assert.ok(courses[i].releaseSpeed >= courses[i - 1].releaseSpeed, "cheapest first");
		assert.ok(Math.abs(courses[i].lead - courses[i - 1].lead) >= 0.02, "genuinely distinct");
	}
	courses.forEach(function (c) {
		assert.ok(O.vMag(O.vSub(c.exit.v, truth.exit.v)) < 0.05, "every course hits the hand-off");
	});
});

test("a hand-off with no meaningful v-infinity is refused, not guessed at", () => {
	var s = solveLunarDeparture({ vInfVec: [0, 0, 0], jdHandoff: JD });
	assert.equal(s.ok, false);
	assert.equal(s.reason, "no-vinf");
});
