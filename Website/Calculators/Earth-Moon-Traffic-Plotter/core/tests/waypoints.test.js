// Node tests for the waypoint burns (core/waypoints.js, and core/flight.js's
// flying through them). Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { moonGeoPos, moonGeoVel, SOI_MOON } from "../../../../Shared/geo-leg.js";
import { CLOCK_EPOCH } from "../facilities.js";
import { computeFlight, flightStateAt, bodyPass } from "../flight.js";
import { solveCatch } from "../target.js";
import { MAX_AXIS_MPS, capAxis, cleanWaypoints, burnBodyAt, applyWaypointBurn, burnSize } from "../waypoints.js";

function within(actual, expected, tol, label) {
	assert.ok(Math.abs(actual - expected) <= tol, label + ": " + actual + " not within " + tol + " of " + expected);
}
var JD = CLOCK_EPOCH + 81;   // 2080-03-22
var H = 3600, ZERO = { pro: 0, rad: 0, nrm: 0 };

test("each burn component is held to ±300 m/s", function () {
	assert.equal(MAX_AXIS_MPS, 300);
	assert.equal(capAxis(380), 300);
	assert.equal(capAxis(-420), -300);
	assert.equal(capAxis(12.5), 12.5);
	assert.equal(capAxis("x"), 0);
	var list = [{ t: 5 * H, burn: { pro: 390, rad: -3 } }, { t: 2 * H, burn: ZERO }, { t: -1, burn: ZERO }];
	var c = cleanWaypoints(list);
	assert.deepEqual(c.map(function (w) { return w.index; }), [1, 0], "in time order, none before the release");
	assert.deepEqual(c[1].burn, { pro: 300, rad: -3, nrm: 0 });
	assert.equal(list[0].burn.pro, 390, "the input is left alone");
});

test("a burn is measured against the Moon inside its sphere of influence, Earth outside", function () {
	var jde = JD, rM = moonGeoPos(jde), vM = moonGeoVel(jde);
	var near = O.vAdd(rM, [20000e3, 0, 0]);
	assert.equal(burnBodyAt(near, jde).body, "Moon");
	assert.equal(burnBodyAt(O.vAdd(rM, O.vScale(O.vUnit(rM), -2 * SOI_MOON)), jde).body, "Earth");
	// 30 m/s prograde near the Moon: along the ship's motion past the Moon, not around Earth.
	var vRel = [0, 900, 0], v = O.vAdd(vM, vRel);
	var b = applyWaypointBurn(near, v, jde, { pro: 30, rad: 0, nrm: 0 });
	assert.equal(b.body, "Moon");
	within(O.vMag(b.dv), 30, 1e-9, "impulse size");
	within(O.vDot(O.vUnit(b.dv), O.vUnit(vRel)), 1, 1e-9, "along the Moon-relative motion");
	within(b.dSpeed, 30, 1e-9, "speed past the Moon");
	within(burnSize({ pro: 3, rad: 4, nrm: 12 }), 13, 1e-12, "burnSize");
});

test("a zero burn leaves the flight as it was", function () {
	// The fine step a flight with a destination is flown with: with the coarse
	// one, the two flights differ by the integration's own error, several km.
	var plain = computeFlight({ from: "moonSkyhook", to: "earthSkyhook", jd: JD });
	var wp = computeFlight({ from: "moonSkyhook", to: "earthSkyhook", jd: JD, waypoints: [{ t: 10 * H, burn: ZERO }] });
	assert.equal(wp.legs.length, 2);
	assert.equal(wp.final.kind, "integrated");
	assert.equal(wp.waypoints[0].reached, true);
	[5 * H, 10 * H, 30 * H, 60 * H].forEach(function (t) {
		var d = O.vMag(O.vSub(flightStateAt(wp, t).r, flightStateAt(plain, t).r));
		assert.ok(d < 5e3, "within 5 km at T+" + t / H + " h: " + d);
	});
	assert.equal(wp.summary.primary, plain.summary.primary);
});

test("a burn changes the velocity by exactly the burn, at its time of flight", function () {
	var burn = { pro: 20, rad: -10, nrm: 40 }, t = 12 * H;
	var f = computeFlight({ from: "moonSkyhook", jd: JD, waypoints: [{ t: t, burn: burn }] });
	var w = f.waypoints[0];
	assert.equal(w.reached, true);
	within(w.t, t, 1e-9, "time");
	within(O.vMag(O.vSub(w.vAfter, w.v)), burnSize(burn), 1e-9, "impulse size");
	// The joined leg holds the burn as two samples at the same t.
	var at = f.final.samples.filter(function (s) { return s.t === t; });
	assert.equal(at.length, 2);
	assert.deepEqual(at[0].r, at[1].r);
	assert.deepEqual(at[1].v, w.vAfter);
	// It is where the flight without the burn is at that time.
	var plain = computeFlight({ from: "moonSkyhook", jd: JD });
	assert.ok(O.vMag(O.vSub(w.r, flightStateAt(plain, t).r)) < 2e3, "on the unburned path");
	// And it moves the ship: after a day it is far from where it would have been.
	var d = O.vMag(O.vSub(flightStateAt(f, t + 24 * H).r, flightStateAt(plain, t + 24 * H).r));
	assert.ok(d > 1000e3, "moved by " + d);
	// Samples run on one clock, never backwards.
	for (var k = 1; k < f.final.samples.length; k++) { assert.ok(f.final.samples[k].t >= f.final.samples[k - 1].t); }
	assert.ok(bodyPass(f.final, "Earth"));
});

test("a waypoint after the flight has ended is not reached", function () {
	// A release from the foot, 1 km up, reaches the lunar surface within a minute.
	var f = computeFlight({ from: "moonSkyhook", jd: JD, params: { moonSkyhook: { relAlt: 1e3 } },
		waypoints: [{ t: 20, burn: { pro: 5 } }, { t: 30 * 24 * H, burn: { pro: 5 } }] });
	assert.equal(f.waypoints[0].reached, true);
	assert.equal(f.waypoints[1].reached, false);
	assert.equal(f.waypoints[1].t, 30 * 24 * H);
	assert.equal(f.summary.impact, "Moon");
});

test("a Moon-bound release with a burn is flown integrated, its burn measured against the Moon", function () {
	// Released just above the CoM: a lunar orbit, drawn as the ellipse without burns.
	var input = { from: "moonSkyhook", jd: JD, params: { moonSkyhook: { relAlt: 400e3 } } };
	assert.equal(computeFlight(input).final.kind, "moonEllipse");
	var f = computeFlight(Object.assign({ waypoints: [{ t: 600, burn: { pro: 50 } }] }, input));
	assert.equal(f.final.kind, "integrated");
	assert.equal(f.waypoints[0].body, "Moon");
	within(f.waypoints[0].dSpeed, 50, 1e-6, "speed past the Moon");
});

test("Target still brings the ship to a catch with a burn on the way", function () {
	var wps = [{ t: 24 * H, burn: { pro: 0, rad: 15, nrm: -20 } }];
	var input = { from: "moonSkyhook", to: "earthSkyhook", jd: JD, waypoints: wps };
	var s = solveCatch(input);
	assert.ok(s.ok, s.message);
	var f = computeFlight({ from: "moonSkyhook", to: "earthSkyhook", jd: s.jd,
		params: { moonSkyhook: { relAlt: s.relAlt } }, waypoints: wps });
	assert.equal(f.waypoints[0].reached, true);
	assert.equal(f.arrival.met, true, "miss " + f.arrival.miss);
	within(f.arrival.altitude, 5200e3, 200, "catch altitude");
});
