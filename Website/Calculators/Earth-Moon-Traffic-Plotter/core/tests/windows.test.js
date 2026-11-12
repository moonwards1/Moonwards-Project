// Node tests for the Earth-Moon-Traffic-Plotter's alignment windows. Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { moonGeoPos } from "../../../../Shared/geo-leg.js";
import { CLOCK_EPOCH, skyhookFigures, routeReleaseAlt } from "../facilities.js";
import { planeCrossings, alignmentAt, releaseWindows, PLANE_REACH, PLANE_ANGLE } from "../windows.js";
import { solveBestCatch } from "../target.js";

var E = skyhookFigures("earthSkyhook"), M = skyhookFigures("moonSkyhook");
var RP = E.R + routeReleaseAlt("earthSkyhook", "moonSkyhook");
var JD0 = CLOCK_EPOCH, JD1 = CLOCK_EPOCH + 1827;

test("the Moon crosses Earth's equatorial plane twice in each lunar orbit", function () {
	var c = planeCrossings(E, JD0, JD1);
	assert.ok(c.length >= 132 && c.length <= 135, "crossings in five years: " + c.length);
	c.forEach(function (jd, k) {
		assert.ok(Math.abs(O.vDot(moonGeoPos(jd), E.normal)) < 1e3, "Moon in the plane at crossing " + k);
		if (k) { assert.ok(jd - c[k - 1] > 12 && jd - c[k - 1] < 15.5, "half a lunar orbit apart: " + (jd - c[k - 1])); }
	});
});

test("the mismatch is a few hundred m/s at the Moon and several km/s at Earth", function () {
	planeCrossings(E, JD0, JD1).forEach(function (jd) {
		var q = alignmentAt(E, M, RP, jd);
		assert.ok(Math.abs(q.mismatch) > 80 && Math.abs(q.mismatch) < 220, "mismatch " + q.mismatch);
		assert.ok(q.vInf > 700 && q.vInf < 950, "v-infinity at the Moon " + q.vInf);
		assert.ok(q.toMoon > 200 && q.toMoon < 520, "to the Moon " + q.toMoon);
		assert.ok(q.toEarth > 2500 && q.toEarth < 5500, "to Earth " + q.toEarth);
	});
});

test("release windows for the Moon lie a flight time before each crossing", function () {
	var w = releaseWindows("Moon", E, M, RP, JD0, JD1);
	assert.ok(w.length >= 132 && w.length <= 135);
	w.forEach(function (x) {
		assert.ok(x.end < x.crossing && x.crossing - x.start < 4, "before the crossing");
		assert.ok(x.end - x.start > 1.2 && x.end - x.start < 1.7, "about a day and a half long: " + (x.end - x.start));
		assert.equal(x.within, true);
		// The Moon is within reach of the plane a slow flight after the window opens.
		assert.ok(Math.abs(O.vDot(moonGeoPos(x.start + 3.5), E.normal)) < 1.1 * PLANE_REACH);
	});
	// The releases the flight tests use are inside one.
	[81 + 9.6927, 81 + 10.0021].forEach(function (d) {
		assert.ok(w.some(function (x) { return x.start <= JD0 + d && JD0 + d <= x.end; }), "day " + d);
	});
});

test("a window's estimate is close to what Target finds in it", function () {
	var jd = JD0 + 81 + 10.0021;
	var w = releaseWindows("Moon", E, M, RP, jd, jd)[0];
	var s = solveBestCatch({ from: "earthSkyhook", to: "moonSkyhook", jd: jd, params: { earthSkyhook: { relAlt: 5250e3 } } });
	assert.ok(s.ok, s.message);
	assert.ok(Math.abs(s.speed - w.speed) < 100, "solved " + s.speed + " against estimated " + w.speed);
});

test("release windows for Earth are at the crossings, and none is within the catcher's limit", function () {
	var w = releaseWindows("Earth", E, M, RP, JD0, JD1);
	assert.ok(w.length >= 132 && w.length <= 136);
	w.forEach(function (x) {
		assert.ok(x.start < x.crossing && x.crossing < x.end);
		var r = moonGeoPos(x.start);
		assert.ok(Math.abs(Math.asin(O.vDot(r, E.normal) / O.vMag(r))) < 1.15 * PLANE_ANGLE, "Moon within 3 degrees of the plane");
		assert.equal(x.within, false);
	});
});
