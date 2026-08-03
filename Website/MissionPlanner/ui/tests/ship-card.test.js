/* Node tests for ui/ship-card.js's pure halves — the DOM/three.js widget
 * itself is browser-only and not exercised here. */
import test from "node:test";
import assert from "node:assert/strict";

import { vInfComponents, gizmoScale, speedModel, speedAlong, peakSpeed }
	from "../ship-card.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";

var O = OrbitalMath;

// A state with velocity along +X and position along +Y, so the burn frame's
// axes are unambiguous: prograde +X, normal +Z (ecliptic up), radial = n x p.
var R = [0, 1.5e11, 0];
var V = [3e4, 0, 0];

test("vInfComponents splits a vector onto the burn frame, in km/s", function () {
	var f = O.burnFrame(R, V);
	// 2 km/s prograde + 1 km/s normal, built from the frame's own axes.
	var vec = O.vAdd(O.vScale(f.pro, 2000), O.vScale(f.nrm, 1000));
	var c = vInfComponents(R, V, vec);
	assert.ok(Math.abs(c.pro - 2) < 1e-9);
	assert.ok(Math.abs(c.nrm - 1) < 1e-9);
	assert.ok(Math.abs(c.rad) < 1e-9);
	assert.ok(Math.abs(c.net - Math.hypot(2, 1)) < 1e-9);
});

test("vInfComponents keeps the sign of a retrograde component", function () {
	var f = O.burnFrame(R, V);
	var c = vInfComponents(R, V, O.vScale(f.pro, -1500));
	assert.ok(c.pro < 0);
	assert.ok(Math.abs(c.pro + 1.5) < 1e-9);
	assert.ok(Math.abs(c.net - 1.5) < 1e-9, "net is a magnitude, always positive");
});

test("vInfComponents returns null on missing inputs", function () {
	assert.equal(vInfComponents(null, V, [1, 0, 0]), null);
	assert.equal(vInfComponents(R, V, null), null);
});

test("gizmoScale takes the largest magnitude across both layers", function () {
	var needed = { pro: -5.46, rad: 2.43, nrm: -1.73, net: 6.24 };
	var current = { pro: 4.48, rad: 3.13, nrm: -0.91, net: 5.54 };
	assert.equal(gizmoScale(needed, current), 6.24);
	assert.equal(gizmoScale(null, current), 5.54);
	assert.equal(gizmoScale(needed, null), 6.24);
});

test("gizmoScale never returns zero, so no line divides by it", function () {
	assert.equal(gizmoScale(null, null), 1);
	assert.equal(gizmoScale({ pro: 0, rad: 0, nrm: 0, net: 0 }, null), 1);
});

test("speedModel pins the bar's right edge at the peak", function () {
	var m = speedModel(4, 3, 8);
	assert.equal(m.currentFrac, 0.5);
	assert.equal(m.neededFrac, 0.375);
	assert.equal(m.peak, 8);
});

test("speedModel clamps a speed that exceeds the peak", function () {
	// A needed hand-off speed above anything the flight reaches still has to
	// land somewhere on the track rather than off the end of it.
	var m = speedModel(9, 12, 8);
	assert.equal(m.currentFrac, 1);
	assert.equal(m.neededFrac, 1);
});

test("speedModel degrades to a zero fill with no usable peak", function () {
	var m = speedModel(4, 3, 0);
	assert.equal(m.peak, null);
	assert.equal(m.currentFrac, 0);
	assert.equal(m.neededFrac, null);
});

var SAMPLES = [
	{ v: [1000, 0, 0], t: 0 },
	{ v: [3000, 0, 0], t: 100 },
	{ v: [2000, 0, 0], t: 200 }
];

test("speedAlong interpolates between the bracketing samples", function () {
	assert.equal(speedAlong(SAMPLES, 0), 1000);
	assert.equal(speedAlong(SAMPLES, 50), 2000);
	assert.equal(speedAlong(SAMPLES, 100), 3000);
	assert.equal(speedAlong(SAMPLES, 150), 2500);
});

test("speedAlong clamps outside the sampled span", function () {
	assert.equal(speedAlong(SAMPLES, -10), 1000);
	assert.equal(speedAlong(SAMPLES, 9999), 2000);
	assert.equal(speedAlong([], 5), null);
	assert.equal(speedAlong(null, 5), null);
});

test("peakSpeed is the fastest anywhere on the flight, not the last point", function () {
	assert.equal(peakSpeed(SAMPLES), 3000);
	assert.equal(peakSpeed([]), null);
	assert.equal(peakSpeed(null), null);
});
