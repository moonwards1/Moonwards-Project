import { test } from "node:test";
import assert from "node:assert/strict";
import {
	originWindow, soiEntryBefore, destinationWindow, POV_MIN_DAYS, POV_AFTER_CA_DAYS
} from "../pov-window.js";

var DAY = 86400;

// A straight-line pass: speed v (m/s), miss distance b (m), closest at tc (s).
function linePass(v, b, tc) {
	return function (t) { return Math.hypot(v * (t - tc), b); };
}

test("originWindow spans the first POV_MIN_DAYS, cut short by a shorter flight", function () {
	assert.deepEqual(originWindow(100 * DAY), { t0: 0, t1: POV_MIN_DAYS * DAY });
	assert.deepEqual(originWindow(3 * DAY), { t0: 0, t1: 3 * DAY });
	assert.equal(originWindow(0), null);
});

test("soiEntryBefore finds the inward crossing to the second", function () {
	var v = 3000, soiR = 577e6, tc = 200 * DAY;
	var dist = linePass(v, 0, tc);
	var expected = tc - soiR / v;
	var got = soiEntryBefore(dist, tc, soiR);
	assert.ok(Math.abs(got - expected) < 2, got + " vs " + expected);
});

test("soiEntryBefore: null outside the sphere, 0 when inside from the start", function () {
	assert.equal(soiEntryBefore(linePass(3000, 1e9, 50 * DAY), 50 * DAY, 577e6), null);
	assert.equal(soiEntryBefore(function () { return 1e6; }, 5 * DAY, 577e6), 0);
});

test("destinationWindow: a small SOI gets the 10-day floor, ending a day past closest approach", function () {
	var tc = 200 * DAY, soiR = 577e6;
	var w = destinationWindow(linePass(3000, 1e7, tc), tc, soiR, 400 * DAY);
	assert.equal(w.t1, tc + POV_AFTER_CA_DAYS * DAY);
	assert.equal(w.t0, w.t1 - POV_MIN_DAYS * DAY);   // SOI crossing is ~2.2 d before, inside the floor
	assert.ok(w.soiEntry > w.t0 && w.soiEntry < tc);
});

test("destinationWindow: a giant planet's SOI sets the start", function () {
	var tc = 500 * DAY, soiR = 48.2e9, v = 6000;
	var w = destinationWindow(linePass(v, 1e8, tc), tc, soiR, 900 * DAY);
	assert.ok(Math.abs(w.t0 - w.soiEntry) < 1e-6);
	assert.ok((tc - w.t0) / DAY > 90, "Jupiter approach should span months, got " + (tc - w.t0) / DAY);
});

test("destinationWindow clamps to the flight: no negative start, no end past the leg", function () {
	var tc = 2 * DAY;
	var w = destinationWindow(linePass(3000, 1e9, tc), tc, 577e6, 2.5 * DAY);
	assert.equal(w.t0, 0);
	assert.equal(w.t1, 2.5 * DAY);
	assert.equal(w.soiEntry, null);
	assert.equal(destinationWindow(linePass(1, 1, 0), NaN, 1, 10), null);
});
