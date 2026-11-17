// Node tests for core/view-frames.js. Run from the repo root:
//   node --test Website/Calculators/Mars-System-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { VIEW_FRAMES, viewBasis, toView } from "../view-frames.js";
import { CLOCK_EPOCH, SPAN_DAYS } from "../clock.js";
import { MarsEphemeris as ME } from "../../../../Shared/mars-ephemeris.js";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";

function near(x, want, tol, what) {
	assert.ok(Math.abs(x - want) <= tol, (what || "value") + " " + x + " is not within " + tol + " of " + want);
}
var JD = CLOCK_EPOCH + 200.37;

test("the clock spans three Mars years from 2080", function () {
	var d = O.dateFromJulian(CLOCK_EPOCH);
	assert.deepEqual([d.Y, d.Mo, d.D], [2080, 1, 1]);
	near(SPAN_DAYS / 686.98, 3, 0.001);
});

test("every view's axes are unit vectors at right angles, right-handed", function () {
	VIEW_FRAMES.forEach(function (f) {
		var b = viewBasis(f.id, JD);
		near(O.vMag(b.x), 1, 1e-12); near(O.vMag(b.y), 1, 1e-12); near(O.vMag(b.z), 1, 1e-12);
		near(O.vDot(b.x, b.y), 0, 1e-12); near(O.vDot(b.x, b.z), 0, 1e-12);
		near(O.vMag(O.vSub(O.vCross(b.x, b.y), b.z)), 0, 1e-12, f.id + " handedness");
	});
});

test("Mars's pole is straight up in the surface view", function () {
	var p = toView(viewBasis("surface", JD), ME.pole);
	near(p[0], 0, 1e-12); near(p[1], 0, 1e-12); near(p[2], 1, 1e-12);
});

test("the Sun view has ecliptic north up and the Sun ahead along x", function () {
	[0, 77, 300, 600].forEach(function (dt) {
		var b = viewBasis("sun", JD + dt), p = toView(b, ME.sunVector(JD + dt));
		near(O.vMag(O.vSub(b.z, [0, 0, 1])), 0, 1e-15, "z");
		near(p[1], 0, 1e-3, "sideways (m)");
		assert.ok(p[0] > 0, "the Sun is ahead");
		// No more than Mars's 1.85 deg orbital tilt above or below the ecliptic.
		assert.ok(Math.abs(Math.atan2(p[2], p[0])) < 1.9 * Math.PI / 180, "Sun's elevation");
	});
});

test("a point on the ground stands still in the surface view", function () {
	var a = toView(viewBasis("surface", JD), ME.surfaceState(12, -113, JD).r);
	var b = toView(viewBasis("surface", JD + 0.4), ME.surfaceState(12, -113, JD + 0.4).r);
	near(O.vMag(O.vSub(a, b)), 0, 1e-3, "movement (m)");
});

test("Phobos stays on the x axis in the Phobos view", function () {
	[0, 0.07, 0.2, 31.5].forEach(function (dt) {
		var s = ME.moonState("Phobos", JD + dt), p = toView(viewBasis("phobos", JD + dt), s.r);
		near(p[0], O.vMag(s.r), 1e-3); near(p[1], 0, 1e-3); near(p[2], 0, 1e-3);
	});
});
