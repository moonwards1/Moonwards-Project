// Node tests for core/release-arc.js. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/release-arc.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseArc, releaseArcStateAt, releaseArcSamples } from "../release-arc.js";
import { originSoiRadius } from "../departure-estimate.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

var O = OrbitalMath;
var EARTH = systems.get("Earth");
var R_SOI = originSoiRadius("Earth");
var R_LOW = EARTH.lowOrbit.periapsis;
var POLE = O.poleVectorEcliptic(EARTH.pole.ra, EARTH.pole.dec);

function edgeVec(vInf, dir) {
	var edge = Math.sqrt(vInf * vInf + 2 * EARTH.GM / R_SOI);
	return O.vScale(O.vUnit(dir), edge);
}

function arcFor(vInf, dir, extra) {
	return releaseArc(Object.assign({ GM: EARTH.GM, rLow: R_LOW, rSoi: R_SOI,
		vEdgeVec: edgeVec(vInf, dir), pole: POLE }, extra));
}

test("the arc starts at the low-orbit radius and ends on the SOI sphere", function () {
	var a = arcFor(3000, [1, 0.3, 0.1]);
	assert.ok(a.ok);
	assert.ok(Math.abs(O.vMag(a.release.r) - R_LOW) < 1);
	assert.ok(Math.abs(O.vMag(a.exit.r) - R_SOI) < 1e3);
});

test("energy is conserved: periapsis and exit speeds match vis-viva", function () {
	var a = arcFor(3000, [1, 0.3, 0.1]);
	var vPeri = Math.sqrt(3000 * 3000 + 2 * EARTH.GM / R_LOW);
	assert.ok(Math.abs(O.vMag(a.release.v) - vPeri) < 1e-3);
	assert.ok(Math.abs(O.vMag(a.exit.v) - O.vMag(edgeVec(3000, [1, 0.3, 0.1]))) < 1e-3);
});

test("velocity at periapsis is perpendicular to the release point", function () {
	var a = arcFor(3000, [1, 0.3, 0.1]);
	assert.ok(Math.abs(O.vDot(a.release.r, a.release.v)) / (O.vMag(a.release.r) * O.vMag(a.release.v)) < 1e-9);
});

test("the release point is on the equator and the motion is prograde", function () {
	[[1, 0.3, 0.1], [0, 1, -0.2], [-1, -0.5, 0.3], [0.2, -1, 0.3]].forEach(function (dir) {
		var a = arcFor(3500, dir);
		assert.ok(Math.abs(O.vDot(O.vUnit(a.release.r), POLE)) < 1e-9, "on the equator");
		assert.ok(O.vDot(a.normal, POLE) > 0, "angular momentum along the spin pole");
	});
});

test("a reachable heading is matched exactly at the SOI edge", function () {
	var a = arcFor(3000, [1, 0.3, 0.1]);
	assert.ok(a.headingErrorDeg < 1e-4, "miss " + a.headingErrorDeg);
	var want = O.vUnit(edgeVec(3000, [1, 0.3, 0.1]));
	assert.ok(O.vMag(O.vSub(O.vUnit(a.exit.v), want)) < 1e-9);
});

test("a heading the equator cannot reach still draws, off by a stated miss", function () {
	var a = arcFor(1500, POLE);                         // straight out of the pole, slowly
	assert.ok(a.ok);
	assert.ok(a.headingErrorDeg > 1);
	assert.ok(Math.abs(O.vMag(a.exit.v) - O.vMag(edgeVec(1500, POLE))) < 1e-3, "energy still right");
});

test("flight time is the two-body periapsis-to-SOI time, shorter than R/v-infinity", function () {
	var a = arcFor(3000, [1, 0.3, 0.1]);
	assert.equal(a.tExit, O.soiExitTimeDirect(EARTH.GM, 3000, R_LOW, R_SOI));
	assert.ok(a.tExit < R_SOI / 3000);
	assert.ok(a.tExit > 0.5 * R_SOI / 3000);
});

test("heading changes the exit POINT, not the flight time", function () {
	var a = arcFor(3000, [1, 0.3, 0.1]), b = arcFor(3000, [-0.4, 1, -0.2]);
	assert.equal(a.tExit, b.tExit);
	assert.ok(O.vMag(O.vSub(a.exit.r, b.exit.r)) > 1e8);
});

test("the exit point sits within a few degrees of the heading", function () {
	var dir = [1, 0.3, 0.1];
	var a = arcFor(3000, dir);
	var ang = Math.acos(O.vDot(O.vUnit(a.exit.r), O.vUnit(dir))) * 180 / Math.PI;
	assert.ok(ang < 5, "angle " + ang);
});

test("a card that does not escape is refused", function () {
	var slow = O.vScale([1, 0, 0], Math.sqrt(2 * EARTH.GM / R_SOI) * 0.99);
	var a = releaseArc({ GM: EARTH.GM, rLow: R_LOW, rSoi: R_SOI, vEdgeVec: slow, pole: POLE });
	assert.equal(a.ok, false);
	assert.equal(a.reason, "no-escape");
	assert.equal(releaseArc({ GM: EARTH.GM, rLow: R_LOW, rSoi: R_SOI, vEdgeVec: [0, 0, 0] }).ok, false);
});

test("samples run from the release (t = -tExit) to the exit (t = 0), radius rising", function () {
	var a = arcFor(3000, [1, 0.3, 0.1]);
	var s = releaseArcSamples(a, 200);
	assert.equal(s.length, 201);
	assert.ok(Math.abs(s[0].t + a.tExit) < 1e-6);
	assert.equal(s[200].t, 0);
	for (var i = 1; i < s.length; i++) { assert.ok(O.vMag(s[i].r) >= O.vMag(s[i - 1].r) - 1e-6); }
	assert.ok(O.vMag(O.vSub(s[200].r, a.exit.r)) < 1);
	assert.ok(O.vMag(O.vSub(releaseArcStateAt(a, a.tExit / 2).r, s[Math.round(200 / Math.SQRT2)].r)) < 5e6);
});

test("no pole data falls back to the ecliptic north", function () {
	var a = releaseArc({ GM: EARTH.GM, rLow: R_LOW, rSoi: R_SOI, vEdgeVec: edgeVec(3000, [1, 0.3, 0]) });
	assert.ok(a.ok);
	assert.ok(Math.abs(O.vDot(O.vUnit(a.release.r), [0, 0, 1])) < 1e-9);
});
