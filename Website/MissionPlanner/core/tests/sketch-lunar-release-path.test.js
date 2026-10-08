// Node tests for core/sketch-lunar-release-path.js. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/sketch-lunar-release-path.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { sketchLunarDeparture, releaseSpeedFor } from "../sketch-lunar-departure.js";
import {
	lunarReleasePath, lunarReleasePathStateAt, lunarMoonArcSamples, lunarSeamGap, lunarPatchedExit
} from "../sketch-lunar-release-path.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { moonGeoPos, moonGeoVel, SOI_MOON } from "../../../Shared/geo-leg.js";

var O = OrbitalMath;
var JD = 2462502.5;
var DAY = 86400;
var R_LOW = systems.get("Moon").lowOrbit.periapsis;

function pathFor(card, dayOffset) {
	var f = sketchLunarDeparture({ jd: JD + (dayOffset || 0), card: card || { pro: 3600, rad: 0, nrm: 0 } });
	assert.ok(f.ok && f.soiExit, "flight: " + f.reason);
	return { f: f, path: lunarReleasePath(f) };
}

test("the path starts at the release epoch, low over the Moon, at the release speed", function () {
	var x = pathFor(), s0 = lunarReleasePathStateAt(x.path, 0);
	var rel = O.vSub(s0.r, moonGeoPos(JD));
	assert.ok(Math.abs(O.vMag(rel) - R_LOW) < 1);
	assert.ok(Math.abs(O.vMag(O.vSub(s0.v, moonGeoVel(JD))) - releaseSpeedFor(x.f.uMag, R_LOW)) < 1e-3);
	assert.deepEqual(x.path.release.r, s0.r);
});

test("the Moon hyperbola ends on the Moon's SOI sphere", function () {
	var x = pathFor(), tau = x.path.tMoon;
	var rel = O.vSub(lunarReleasePathStateAt(x.path, tau).r, moonGeoPos(JD + tau / DAY));
	assert.ok(Math.abs(O.vMag(rel) - SOI_MOON) < 1e3);
	assert.ok(tau > 3600 && tau < 12 * 3600, "hours " + tau / 3600);
});

test("the path ends on the flight's own Earth-SOI crossing, a coast after the release", function () {
	var x = pathFor();
	assert.equal(x.path.coast, x.f.soiExit.dt);
	var end = lunarReleasePathStateAt(x.path, x.path.coast);
	assert.ok(O.vMag(O.vSub(end.r, x.f.soiExit.r)) < 1e4);
	assert.ok(O.vMag(O.vSub(end.v, x.f.soiExit.v)) < 1);
});

test("the two pieces meet within a few thousand km, and on the same energy", function () {
	[[{ pro: 3600, rad: 0, nrm: 0 }, 0], [{ pro: 2500, rad: 300, nrm: 200 }, 8], [{ pro: 3600, rad: 0, nrm: 0 }, 16]]
		.forEach(function (c) {
			var x = pathFor(c[0], c[1]), g = lunarSeamGap(x.path);
			assert.ok(g.position < 5e6, "gap " + g.position / 1e3 + " km");
			assert.ok(g.velocity < 1500, "velocity gap " + g.velocity);
			// A patched flight and the sketch's crossing time agree to under two hours.
			assert.ok(Math.abs(lunarPatchedExit(x.path) - x.path.coast) < 2 * 3600);
		});
});

test("hyperbola samples start at the release and are densest there", function () {
	var x = pathFor(), s = lunarMoonArcSamples(x.path, 100);
	assert.equal(s.length, 101);
	assert.equal(s[0].tau, 0);
	assert.ok(Math.abs(s[100].tau - x.path.tMoon) < 1e-6);
	assert.ok(O.vMag(O.vSub(s[1].r, s[0].r)) < O.vMag(O.vSub(s[100].r, s[99].r)));
});

test("a release share too small to leave the Moon alone has no hyperbola, and starts at the Moon's centre", function () {
	var f = sketchLunarDeparture({ jd: JD, card: { pro: 3600, rad: 0, nrm: 0 } });
	var weak = Object.assign({}, f, { u: O.vScale(O.vUnit(f.u), 300) });
	var path = lunarReleasePath(weak);
	assert.equal(path.moonArc, null);
	assert.equal(path.tMoon, 0);
	assert.equal(lunarSeamGap(path), null);
	assert.deepEqual(path.release.r, f.rMoon);
	assert.deepEqual(lunarMoonArcSamples(path, 10), []);
});

test("no crossing, no path", function () {
	assert.equal(lunarReleasePath({ ok: true, soiExit: null }), null);
	assert.equal(lunarReleasePath({ ok: false }), null);
});
