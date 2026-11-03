// Node tests for massDriverModel.js. Run from the repo root:
//   node --test Website/Calculators/Mass-Driver-Launch-Calculator/massDriverModel.test.js
//
// Pins the figures of the original page's default design: a 37.4 km track, 13.4 t
// payload (+ 7 % sled), 2.2 km sled braking track, released 25 m up at 1727.3 m/s
// against the ground, 80 % efficient. The original page's figures for these and
// several other inputs were compared with the model's before the page was removed.

import test from "node:test";
import assert from "node:assert/strict";
import { computeMassDriver, MOON } from "./massDriverModel.js";

var base = { length: 37400, payload: 13.4, declen: 2200, height: 25, effPct: 80, useApo: false, apoalt: 233, speed: 1727.3 };
var d = computeMassDriver(base);

function near(actual, expected, dp, label) {
	assert.equal(Number(actual.toFixed(dp)), expected, label + ": " + actual);
}

test("the Moon's reference speeds", function () {
	near(MOON.V_SURF, 4.6, 1, "equatorial surface speed");
	near(MOON.V_CIRC, 1679.9, 1, "circular speed at the surface");
	near(MOON.V_ESC, 2375.7, 1, "escape speed at the surface");
});

test("default release reaches orbit, with periapsis at the release", function () {
	assert.equal(d.regime, "orbit");
	near(d.vi, 1731.92, 2, "inertial release speed");
	near(d.orbit.e, 0.063, 3, "eccentricity");
	near(d.orbit.apoapsisAltitude / 1e3, 233.47, 2, "apoapsis altitude km");
	near(d.orbit.coast, 3582.1, 1, "coast to apoapsis s");
	near(d.orbit.burn, 2.32, 2, "burn at apoapsis raising periapsis to 10 km, m/s");
	near(d.orbit.period, 7193.2, 1, "period after the burn s");
});

test("energy, acceleration and power", function () {
	near(d.energy.drawPayload / 1e9, 24.99, 2, "energy drawn for the payload GJ");
	near(d.energy.drawTotal / 1e9, 26.74, 2, "energy drawn, payload and sled GJ");
	near(d.acceleration.a, 39.89, 2, "acceleration m/s²");
	near(d.acceleration.time, 43.30, 2, "time on the track s");
	near(d.deceleration.a, 678.08, 2, "sled braking m/s²");
	near(d.power.average / 1e6, 617.41, 2, "average power MW");
	near(d.power.peak / 1e6, 1234.81, 2, "peak power MW");
});

test("a slower release is sub-orbital and lands downrange", function () {
	var s = computeMassDriver(Object.assign({}, base, { speed: 1500 }));
	assert.equal(s.regime, "suborbital");
	near(s.sub.distance / 1e3, 18.77, 2, "distance km");
	near(s.sub.flightTime, 12.48, 2, "flight time s");
	near(s.sub.extraSpeedForOrbit, 175.2, 1, "inertial speed still needed m/s");
});

test("a faster release escapes", function () {
	var e = computeMassDriver(Object.assign({}, base, { speed: 2500 }));
	assert.equal(e.regime, "escape");
	near(e.escape.vInf, 793.3, 1, "v∞ m/s");
	near(e.escape.C3, 0.629, 3, "C3 km²/s²");
});

test("an apoapsis altitude gives the release speed", function () {
	var a = computeMassDriver(Object.assign({}, base, { useApo: true, apoalt: 233 }));
	near(a.vg, 1727.2, 1, "release speed m/s");
});

test("inputs out of range are refused", function () {
	assert.match(computeMassDriver(Object.assign({}, base, { speed: -5 })).error, /speed must be positive/);
	assert.match(computeMassDriver(Object.assign({}, base, { effPct: 0 })).error, /efficiency/);
	assert.match(computeMassDriver(Object.assign({}, base, { length: 0 })).error, /must be positive/);
	assert.match(computeMassDriver(Object.assign({}, base, { useApo: true, apoalt: 0 })).error, /Apoapsis/);
});
