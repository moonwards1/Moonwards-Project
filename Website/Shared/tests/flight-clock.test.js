// Node tests for Shared/math-utils.js's sweep table and Shared/sim/flight-clock.js.
// Run from the repo root:
//   node --test Website/Shared/tests/flight-clock.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { OrbitalMath as O } from "../math-utils.js";
import { flightClock, clockSeconds, clockDegrees, clockSliderFrac, clockSetFrac, clockSetTime,
         clockSetAxis, clockSetPin, clockReset } from "../sim/flight-clock.js";

var GM_E = 3.986004418e14;

// A sampled two-body path from (r, v) over `dur` seconds.
function path(r, v, dur, n) {
	var pts = [];
	for (var k = 0; k <= n; k++) {
		var t = dur * k / n;
		pts.push({ t: t, r: O.propagateState(GM_E, r, v, t).r });
	}
	return pts;
}
function circle(R, laps, n) {
	var vc = Math.sqrt(GM_E / R), T = 2 * Math.PI * R / vc;
	return { pts: path([R, 0, 0], [0, vc, 0], laps * T, n), T: T };
}

test("sweepTable: a circular orbit sweeps 360° per period, unwrapped over laps", function () {
	var c = circle(7e6, 2.5, 900), tb = O.sweepTable(c.pts);
	assert.ok(Math.abs(tb.deg[tb.deg.length - 1] - 900) < 1e-6);
	assert.ok(Math.abs(O.sweepDegAt(tb, c.T) - 360) < 1e-6);
	assert.ok(Math.abs(O.sweepTimeAt(tb, 540) - 1.5 * c.T) < 1e-6 * c.T);
});

test("sweepTable: never decreases, and a burn's repeated time adds nothing", function () {
	var c = circle(7e6, 1, 100), pts = c.pts.slice(0, 50).concat([{ t: c.pts[49].t, r: c.pts[49].r }], c.pts.slice(50));
	var tb = O.sweepTable(pts);
	for (var k = 1; k < tb.deg.length; k++) { assert.ok(tb.deg[k] >= tb.deg[k - 1]); }
	assert.equal(tb.deg[50], tb.deg[49]);
});

test("sweepTable: an ellipse sweeps fast at perigee, slow at apogee (equal angles, unequal times)", function () {
	var rp = 7e6, ra = 4e8, a = (rp + ra) / 2, vp = Math.sqrt(GM_E * (2 / rp - 1 / a));
	var T = 2 * Math.PI * Math.sqrt(a * a * a / GM_E);
	var tb = O.sweepTable(path([rp, 0, 0], [0, vp, 0], T, 4000));
	var t90 = O.sweepTimeAt(tb, 90), t180 = O.sweepTimeAt(tb, 180);
	assert.ok(Math.abs(t180 - T / 2) < T / 1000);
	assert.ok(t90 < 0.05 * T);
	// Inverse pair round-trips.
	assert.ok(Math.abs(O.sweepDegAt(tb, O.sweepTimeAt(tb, 123.4)) - 123.4) < 1e-6);
});

test("sweepTable: a plane change keeps counting forward", function () {
	// A quarter turn from x to y, then a quarter turn from y up to z: 180° in all,
	// where a fixed plane (x-y) would read 90°.
	var pts = [];
	for (var k = 0; k <= 100; k++) { var q = Math.PI / 2 * k / 100; pts.push({ t: k, r: [Math.cos(q), Math.sin(q), 0] }); }
	for (var j = 1; j <= 100; j++) { var w = Math.PI / 2 * j / 100; pts.push({ t: 100 + j, r: [0, Math.cos(w), Math.sin(w)] }); }
	var tb = O.sweepTable(pts);
	assert.ok(Math.abs(tb.deg[tb.deg.length - 1] - 180) < 1e-9);
});

var ORB = circle(7e6, 3, 1200);
var SHAPE = { span: 2 * ORB.T, duration: 3 * ORB.T, table: O.sweepTable(ORB.pts), pinT: null };

test("clock: time axis holds its time when the span changes, however it was set", function () {
	var c = flightClock();
	clockSetFrac(c, SHAPE, 0.5);
	assert.ok(Math.abs(clockSeconds(c, SHAPE) - ORB.T) < 1e-6);
	var longer = Object.assign({}, SHAPE, { span: 4 * ORB.T });
	assert.ok(Math.abs(clockSeconds(c, longer) - ORB.T) < 1e-6);
	assert.ok(Math.abs(clockSliderFrac(c, longer) - 0.25) < 1e-9);   // the thumb moves instead
	clockSetTime(c, SHAPE, 100);
	assert.equal(clockSeconds(c, longer), 100);
});

test("clock: radial axis holds the swept angle when the path changes", function () {
	var c = flightClock();
	clockSetAxis(c, SHAPE, "radial");
	clockSetFrac(c, SHAPE, 0.25);                    // a quarter of 720°: 180°
	assert.ok(Math.abs(clockDegrees(c, SHAPE) - 180) < 1e-6);
	// The same circle at twice the radius: slower, so 180° comes later.
	var big = circle(1.4e7, 3, 1200);
	var shape2 = { span: 2 * big.T, duration: 3 * big.T, table: O.sweepTable(big.pts), pinT: null };
	assert.ok(Math.abs(clockSeconds(c, shape2) - big.T / 2) < 1e-6 * big.T);
	assert.ok(Math.abs(clockSliderFrac(c, shape2) - 0.25) < 1e-9);
});

test("clock: the slider is linear in time on the radial axis too", function () {
	// An ellipse sweeps most of its angle close to perigee; the slider still
	// gives each hour the same length.
	var rp = 7e6, ra = 4e8, a = (rp + ra) / 2, vp = Math.sqrt(GM_E * (2 / rp - 1 / a));
	var T = 2 * Math.PI * Math.sqrt(a * a * a / GM_E);
	var tb = O.sweepTable(path([rp, 0, 0], [0, vp, 0], T, 4000));
	var ell = { span: T, duration: T, table: tb, pinT: null };
	var c = flightClock();
	clockSetAxis(c, ell, "radial");
	clockSetFrac(c, ell, 0.25);
	assert.ok(Math.abs(clockSeconds(c, ell) - T / 4) < T / 1000);
	assert.ok(Math.abs(clockSliderFrac(c, ell) - 0.25) < 1e-3);
	assert.ok(clockDegrees(c, ell) > 150);            // well past a quarter of the angle
});

test("clock: switching axis keeps the ship where it is", function () {
	var c = flightClock();
	clockSetFrac(c, SHAPE, 0.3);
	var t = clockSeconds(c, SHAPE);
	clockSetAxis(c, SHAPE, "radial");
	assert.ok(Math.abs(clockSeconds(c, SHAPE) - t) < 1e-6 * ORB.T);
	clockSetAxis(c, SHAPE, "time");
	assert.ok(Math.abs(clockSeconds(c, SHAPE) - t) < 1e-6 * ORB.T);
});

test("clock: the pin follows the pass, any move by hand lets go, letting go stays there", function () {
	var c = flightClock();
	clockSetAxis(c, SHAPE, "radial");
	clockSetPin(c, SHAPE, true);
	var pinned = Object.assign({}, SHAPE, { pinT: 1000 });
	assert.equal(clockSeconds(c, pinned), 1000);
	assert.equal(clockSeconds(c, Object.assign({}, SHAPE, { pinT: 2000 })), 2000);
	// No pass: the held place stands.
	assert.equal(clockSeconds(c, SHAPE), 0);
	clockSetPin(c, pinned, false);
	assert.ok(Math.abs(clockSeconds(c, pinned) - 1000) < 1e-6);
	clockSetPin(c, pinned, true);
	clockSetTime(c, pinned, 50);
	assert.equal(c.pin, false);
	assert.ok(Math.abs(clockSeconds(c, pinned) - 50) < 1e-6);
});

test("clock: reset returns to the release, keeping the axis and the pin", function () {
	var c = flightClock();
	clockSetAxis(c, SHAPE, "radial");
	clockSetFrac(c, SHAPE, 0.6);
	clockSetPin(c, SHAPE, true);
	clockReset(c);
	assert.equal(clockSeconds(c, SHAPE), 0);
	assert.equal(c.axis, "radial");
	assert.equal(c.pin, true);
});

test("clock: no flight shows the release", function () {
	assert.equal(clockSeconds(flightClock(), { span: 0, duration: 0, table: null, pinT: null }), 0);
});
