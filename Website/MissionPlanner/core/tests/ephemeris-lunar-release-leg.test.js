// Node tests for core/ephemeris-lunar-release-leg.js. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/ephemeris-lunar-release-leg.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { flyLunarDeparture, releaseSpeedFor } from "../ephemeris-lunar-departure.js";
import {
	lunarReleaseLeg, lunarReleaseLegStateAt, lunarMoonLegSamples, lunarSeamGap, lunarPatchedExit
} from "../ephemeris-lunar-release-leg.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { moonGeoPos, moonGeoVel, SOI_MOON } from "../../../Shared/geo-leg.js";

var O = OrbitalMath;
var JD = 2462502.5;
var DAY = 86400;
var R_LOW = systems.get("Moon").lowOrbit.periapsis;

function legFor(card, dayOffset) {
	var f = flyLunarDeparture({ jd: JD + (dayOffset || 0), card: card || { pro: 3600, rad: 0, nrm: 0 } });
	assert.ok(f.ok && f.soiExit, "flight: " + f.reason);
	return { f: f, leg: lunarReleaseLeg(f) };
}

test("the leg starts at the release epoch, low over the Moon, at the release speed", function () {
	var x = legFor(), s0 = lunarReleaseLegStateAt(x.leg, 0);
	var rel = O.vSub(s0.r, moonGeoPos(JD));
	assert.ok(Math.abs(O.vMag(rel) - R_LOW) < 1);
	assert.ok(Math.abs(O.vMag(O.vSub(s0.v, moonGeoVel(JD))) - releaseSpeedFor(x.f.uMag, R_LOW)) < 1e-3);
	assert.deepEqual(x.leg.release.r, s0.r);
});

test("the Moon hyperbola ends on the Moon's SOI sphere", function () {
	var x = legFor(), tau = x.leg.tMoon;
	var rel = O.vSub(lunarReleaseLegStateAt(x.leg, tau).r, moonGeoPos(JD + tau / DAY));
	assert.ok(Math.abs(O.vMag(rel) - SOI_MOON) < 1e3);
	assert.ok(tau > 3600 && tau < 12 * 3600, "hours " + tau / 3600);
});

test("the leg ends on the flight's own Earth-SOI crossing, a coast after the release", function () {
	var x = legFor();
	assert.equal(x.leg.coast, x.f.soiExit.dt);
	var end = lunarReleaseLegStateAt(x.leg, x.leg.coast);
	assert.ok(O.vMag(O.vSub(end.r, x.f.soiExit.r)) < 1e4);
	assert.ok(O.vMag(O.vSub(end.v, x.f.soiExit.v)) < 1);
});

test("the two pieces meet within a few thousand km, and on the same energy", function () {
	[[{ pro: 3600, rad: 0, nrm: 0 }, 0], [{ pro: 2500, rad: 300, nrm: 200 }, 8], [{ pro: 3600, rad: 0, nrm: 0 }, 16]]
		.forEach(function (c) {
			var x = legFor(c[0], c[1]), g = lunarSeamGap(x.leg);
			assert.ok(g.position < 5e6, "gap " + g.position / 1e3 + " km");
			assert.ok(g.velocity < 1500, "velocity gap " + g.velocity);
			// A patched flight and the sketch's crossing time agree to under two hours.
			assert.ok(Math.abs(lunarPatchedExit(x.leg) - x.leg.coast) < 2 * 3600);
		});
});

test("hyperbola samples start at the release and are densest there", function () {
	var x = legFor(), s = lunarMoonLegSamples(x.leg, 100);
	assert.equal(s.length, 101);
	assert.equal(s[0].tau, 0);
	assert.ok(Math.abs(s[100].tau - x.leg.tMoon) < 1e-6);
	assert.ok(O.vMag(O.vSub(s[1].r, s[0].r)) < O.vMag(O.vSub(s[100].r, s[99].r)));
});

test("a release share too small to leave the Moon alone has no hyperbola, and starts at the Moon's centre", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 3600, rad: 0, nrm: 0 } });
	var weak = Object.assign({}, f, { u: O.vScale(O.vUnit(f.u), 300) });
	var leg = lunarReleaseLeg(weak);
	assert.equal(leg.moonArc, null);
	assert.equal(leg.tMoon, 0);
	assert.equal(lunarSeamGap(leg), null);
	assert.deepEqual(leg.release.r, f.rMoon);
	assert.deepEqual(lunarMoonLegSamples(leg, 10), []);
});

test("no crossing, no leg", function () {
	assert.equal(lunarReleaseLeg({ ok: true, soiExit: null }), null);
	assert.equal(lunarReleaseLeg({ ok: false }), null);
});
