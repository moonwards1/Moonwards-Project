// node --test Website/Home/tests/workbench-math.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { WM, G0 } from "../workbench-math.js";
import { BODY_FACTS } from "../body-facts.js";

function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || "") + " " + a + " vs " + b); }

test("rocket equation", function () {
	// e-fold mass ratio gives Δv = Isp · g0
	near(WM.rocketDv(300, Math.E, 1), 300 * G0, 1e-9);
	assert.equal(WM.rocketDv(450, 10, 10), 0);
});

test("Earth–Mars windows every ~780 days, minimum-energy trip ~259 days", function () {
	near(WM.synodicDays(BODY_FACTS.Earth.periodD, BODY_FACTS.Mars.periodD), 780, 1);
	near(WM.hohmannDays(1, 1.524), 259, 1);
	assert.equal(WM.synodicDays(365.256, 365.256), Infinity);
});

test("Earth's stationary orbit is ~35,786 km up", function () {
	var r = WM.stationaryRadius(3.986004418e14, 86164.1);
	near((r - 6378137) / 1e3, 35786, 2);
});

test("circular, escape speed and period at Earth's surface radius", function () {
	near(WM.circularSpeed(3.986004418e14, 6.371e6), 7910, 2);
	near(WM.escapeSpeed(3.986004418e14, 6.371e6), 11186, 2);
	near(WM.orbitalPeriod(3.986004418e14, 6.771e6) / 60, 92.4, 0.2);
});

test("track exit speed and kinetic energy", function () {
	// 100 g over 20 km: √(2 · 980.665 · 20000) ≈ 6.26 km/s
	near(WM.trackExitSpeed(100 * G0, 20000), 6263, 1);
	assert.equal(WM.kineticEnergy(2, 3), 9);
});

test("body facts carry the numbers the skeleton needs", function () {
	Object.keys(BODY_FACTS).forEach(function (n) {
		var f = BODY_FACTS[n];
		assert.ok(isFinite(f.rotH) && f.rotH !== 0, n);
		assert.ok(f.aAU > 0 && f.periodD > 0, n);
	});
});
