// Node tests for the date an offworld arrival is flown on (core/arrival-date.js). Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/arrival-date.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { LunarEphemeris as LE } from "../../../../Shared/lunar-ephemeris.js";
import { CLOCK_EPOCH } from "../facilities.js";
import { arrivalDateInSpan, SUN_LIMIT } from "../arrival-date.js";

var JD1 = CLOCK_EPOCH + 6799;

test("a date inside the span is kept", function () {
	var jd = CLOCK_EPOCH + 1000.25;
	assert.deepEqual(arrivalDateInSpan(jd, CLOCK_EPOCH, JD1), { jd: jd, moved: false, sunDeg: 0, moonMiss: 0 });
});

test("a 2040 arrival moves into the span with the Sun and the Moon close to where they were", function () {
	[O.julianDate(2040, 3, 12, 6, 0, 0), O.julianDate(2040, 7, 30, 0, 0, 0), O.julianDate(2041, 12, 1, 18, 0, 0)].forEach(function (jd) {
		var a = arrivalDateInSpan(jd, CLOCK_EPOCH, JD1);
		assert.ok(a && a.moved);
		assert.ok(a.jd >= CLOCK_EPOCH && a.jd <= JD1);
		assert.ok(a.sunDeg <= SUN_LIMIT);
		assert.ok(a.moonMiss < 65e6, "Moon " + Math.round(a.moonMiss / 1e3) + " km off");
		var m0 = LE.moonVector(jd), m1 = LE.moonVector(a.jd);
		assert.ok(Math.abs(Math.hypot(m1[0] - m0[0], m1[1] - m0[1], m1[2] - m0[2]) * 1e3 - a.moonMiss) < 1);
	});
});
