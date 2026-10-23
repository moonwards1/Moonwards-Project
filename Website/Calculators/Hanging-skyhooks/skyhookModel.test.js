// Node tests for skyhookModel.js. Run from the repo root:
//   node --test Website/Calculators/Hanging-skyhooks/skyhookModel.test.js
//
// Pins the page's default design (Moon; foot 10, centre 275, top 2000 km;
// decks 233 / 606.5 / 950 km; lunar silica ×3; loads 40 / 60 / 5000 / 300 / 200 kt (top tip, upper
// tether, centre-of-mass station, lower tether, foot tip); 1000 t/day
// in 100 t climbers at 200 m/s, 70 %; oxygen at 8 km/s, 60 % / 90 %; perigee
// 50 km, interface 122 km) to the figures the calculator showed before it
// moved to the calculator shell.

import test from "node:test";
import assert from "node:assert/strict";

import { systems } from "../../Shared/orbit.js";
import { computeSkyhook, sweepTether } from "./skyhookModel.js";
import { MATERIALS } from "../../Shared/materials.js";

var moon = systems.get("Moon");
var m = MATERIALS.silica;
var t = computeSkyhook(moon, {
	foot: 10e3, centre: 275e3, top: 2000e3,
	receivingDeck: 233e3, outerDocks: 606.5e3, launchDeck: 950e3,
	strength: (m.strength / 3) / m.density, loadTop: 40e6, distUpper: 60e6, comMass: 5000e6, distLower: 300e6, loadFoot: 200e6,
	rate: 1000, perClimber: 100, vClimb: 200, effDrive: 0.7,
	propellant: "oxygen", vExhaust: 8, effThruster: 0.6, effSupply: 0.9,
	targetPerigee: 50, ifaceAlt: 122
});

function near(actual, expected, dp, label) {
	assert.equal(Number(actual.toFixed(dp)), expected, label + ": " + actual);
}

test("orbit and speeds", function () {
	near(t.time / 3600, 2.25, 2, "period h");
	near(t.footVel, 1355.68, 2, "foot speed");
	near(t.centreVel, 1561.31, 2, "centre speed");
	near(t.topVel, 2899.84, 2, "top speed");
});

test("dropped from the foot", function () {
	assert.ok(t.hitsSurface);
	near(t.hitTheGround, 1367.55, 2, "surface speed");
	near(t.impactFromVertical * 180 / Math.PI, 85.58, 2, "angle from vertical");
});

test("tether properties and climbers", function () {
	near(t.lowAcceleration, 0.55, 2, "foot accel");
	near(100 * t.lowAcceleration / t.surfaceGravity, 34.14, 2, "foot % g");
	near(t.highAcceleration, 1.9, 2, "top accel");
	near(100 * t.highAcceleration / t.surfaceGravity, 116.83, 2, "top % g");
	near(t.lowRatio, 1.04, 2, "lower taper");
	near(t.highRatio, 2.68, 2, "upper taper");
	near(t.lowMass, 0.08, 2, "lower mass ratio");
	near(t.highMass, 3.42, 2, "upper mass ratio");
	near(t.lowIntegral, 69839, 0, "lower climb J/kg");
	near(t.highIntegral, 1860487, 0, "upper climb J/kg");
});

test("a tip load alone: tension and tether mass", function () {
	var R = Number(moon.radius), w = t.angularVelocity, s = (m.strength / 3) / m.density;
	var up = sweepTether(moon.GM, w, s, 2000e3 + R, 275e3 + R, 100e3, 0, 1000);
	var low = sweepTether(moon.GM, w, s, 10e3 + R, 275e3 + R, 100e3, 0, 1000);
	near(up.tension / 1e3, 509.77, 2, "tension at centre, 100 t at the top, kN");
	near(low.tension / 1e3, 57.59, 2, "tension at centre, 100 t at the foot, kN");
	var viaRatios = (t.lowMass + t.highMass) * 100e3;
	assert.ok(Math.abs((up.mass + low.mass) - viaRatios) / viaRatios < 1e-3, "tether mass agrees with the mass multiples");
	near(t.highMass * 100, 341.85, 2, "upper tether mass for 100 t, t");
});

test("loads, balance and the centre-of-mass station", function () {
	var R = Number(moon.radius), w = t.angularVelocity;
	assert.ok(t.balanced);
	near(t.loads.upperTotal / 1e6, 100, 2, "upper total kt");
	near(t.loads.lowerTotal / 1e6, 500, 2, "lower total kt");
	// the station's net pull makes up the difference between the two tethers' tensions
	var rs = R + t.centre + t.comOffset;
	var pull = w * w * rs - moon.GM / (rs * rs);
	var gap = t.tensionLower - t.tensionUpper - t.loads.com * pull;
	assert.ok(Math.abs(gap) / t.tensionPeak < 1e-6, "forces balance at the station: " + gap);
	near(t.comOffset / 1e3, -12.5, 1, "station offset km (below the centre)");
	assert.ok(t.tensionPeak > 1e8, "peak tension is now set by the real loads");
	assert.ok(Math.abs(t.tetherMass - (t.tetherMassUpper + t.tetherMassLower)) < 1, "tether mass is the two halves");
	assert.ok(t.comMassAt1km > t.loads.com, "holding the station to 1 km takes more ballast");
});

test("the tension profile for the drawing", function () {
	var P = t.profile;
	assert.equal(P.up.r.length, P.up.T.length);
	assert.ok(P.up.r.length > 100 && P.low.r.length > 100);
	assert.ok(Math.abs(P.up.T[0] - 40e6 * t.highAcceleration) < 1e-6 * P.up.T[0], "top tip tension is the tip load's weight");
	assert.equal(P.up.T[P.up.T.length - 1], t.tensionUpper, "the sweep ends at the station with the upper tension");
	assert.equal(P.low.T[P.low.T.length - 1], t.tensionLower, "...and the lower tension");
	var rCentre = Number(moon.radius) + 275e3;
	for (var i = 1; i < P.up.T.length && P.up.r[i] >= rCentre; i++) assert.ok(P.up.T[i] >= P.up.T[i - 1], "tension never falls toward the centre until past it");
});

test("the station may sit anywhere the tether can carry it", function () {
	var weak = MATERIALS.earlylunarglass;
	var base = {
		foot: 10e3, centre: 275e3, top: 2000e3,
		receivingDeck: 233e3, outerDocks: 606.5e3, launchDeck: 950e3,
		strength: (weak.strength / 3) / weak.density,
		loadTop: 40e6, distUpper: 60e6, comMass: 5000e6, distLower: 300e6, loadFoot: 200e6,
		rate: 1000, perClimber: 100, vClimb: 200, effDrive: 0.7,
		propellant: "oxygen", vExhaust: 8, effThruster: 0.6, effSupply: 0.9, targetPerigee: 50, ifaceAlt: 122
	};
	// too little ballast: no position balances, and that is reported
	var u = computeSkyhook(moon, base);
	assert.equal(u.balanced, false);
	assert.equal(u.comOffset, 0);
	assert.ok(u.unbalance < 0, "the upper tether outweighs the lower");
	assert.ok(u.warnings.some(function (w) { return /Out of balance/.test(w); }));
	assert.ok(isNaN(u.comMassAt1km));
	// enough ballast: it balances far below the centre, near the foot, with no limit on the offset
	var v = computeSkyhook(moon, Object.assign({}, base, { comMass: 20000e6 }));
	assert.ok(v.balanced);
	assert.ok(v.comOffset < -200e3, "station sits well below the centre: " + v.comOffset);
	assert.ok(Math.abs(v.unbalance) / v.tensionPeak < 1e-6);
	assert.ok(t.warnings.every(function (w) { return !/balance/.test(w); }), "the default design balances");
});

test("no load at all gives no tension", function () {
	var R = Number(moon.radius), s = (m.strength / 3) / m.density;
	var none = sweepTether(moon.GM, t.angularVelocity, s, 2000e3 + R, 275e3 + R, 0, 0, 500);
	assert.equal(none.tension, 0);
	assert.equal(none.mass, 0);
});

test("a heavier load along the tether raises tension and mass", function () {
	var R = Number(moon.radius), w = t.angularVelocity, s = (m.strength / 3) / m.density;
	var a = sweepTether(moon.GM, w, s, 2000e3 + R, 275e3 + R, 40e6, 0, 1000);
	var b = sweepTether(moon.GM, w, s, 2000e3 + R, 275e3 + R, 40e6, 60e6, 1000);
	assert.ok(b.tension > a.tension && b.mass > a.mass);
	// spread load carries less than the same mass at the tip: the tip is the worst case
	var c = sweepTether(moon.GM, w, s, 2000e3 + R, 275e3 + R, 100e6, 0, 1000);
	assert.ok(c.tension > b.tension);
});

test("throughput", function () {
	var th = t.throughput;
	near(th.tripUpDays * 24, 1.0, 2, "trip h");
	near(th.tripDownDays * 24, 0.83, 2, "descent h");
	near(th.intervalH, 2.4, 2, "cadence h");
	near(th.onCable, 0.4, 1, "on cable");
	near(th.spacingKm, 1728, 0, "spacing km");
	near(th.cargoUpT, 41.49, 2, "cargo up t");
	near(th.cargoDownT * 1e3, 345.2, 1, "cargo down kg");
	near(th.addedTension / 1e3, 20.01, 2, "added tension kN");
	near(th.addedTensionPct, 0.01, 2, "added tension %");   // of the tension at the centre, now set by the real loads
	near(th.liftPower / 1e6, -5.64, 2, "lift power MW");
	near(th.energyPerT, -0.49, 2, "GJ/t");
});

test("station-keeping", function () {
	var sk = t.keeping;
	near(sk.thrust / 1e3, 7.97, 2, "thrust kN");
	near(sk.torque / 1e9, 29.77, 2, "torque GN·m");
	near(sk.propFlow, 1.0, 2, "kg/s");
	near(sk.propFlow * 86400 / 1e3, 86.03, 2, "t/day");
	near(sk.jetPower / 1e6, 31.86, 2, "jet MW");
	near(sk.orbitPower / 1e6, 23.1, 2, "orbit MW");
	near(sk.elecPower / 1e6, 53.11, 2, "electrical MW");
	near(sk.genPower / 1e6, 59.01, 2, "generated MW");
	near(sk.energyPerT, 5.1, 2, "GJ/t");
});

test("Earth reentry", function () {
	var re = t.reentry;
	assert.ok(re.applies && re.escapes && re.entry);
	near(re.vinf, 835, 0, "v∞");
	near(re.arrivalSpeed, 184, 0, "arrival");
	near(re.naturalPerigeeAlt / 1e3, -26, 0, "natural perigee km");
	near(re.burn, 1.1, 1, "burn");
	near(re.entryAngle * 180 / Math.PI, 6.0, 1, "entry angle");
	near(re.entrySpeed / 1e3, 10.99, 2, "entry speed");
	near(re.peakG, 18, 0, "peak g");
});

test("release points include Earth", function () {
	var earth = t.targets.find(function (x) { return x.name === "Earth"; });
	assert.ok(earth && isFinite(earth.altitude));
});
