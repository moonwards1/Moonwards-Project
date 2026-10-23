// Node tests for skyhookModel.js. Run from the repo root:
//   node --test Website/Calculators/Hanging-skyhooks/skyhookModel.test.js
//
// Pins the page's default design (Moon; foot 10, centre 275, top 2000 km;
// decks 233 / 606.5 / 950 km; lunar silica ×3; 100 t tip load; 1000 t/day
// in 100 t climbers at 200 m/s, 70 %; oxygen at 8 km/s, 60 % / 90 %; perigee
// 50 km, interface 122 km) to the figures the calculator showed before it
// moved to the calculator shell.

import test from "node:test";
import assert from "node:assert/strict";

import { systems } from "../../Shared/orbit.js";
import { computeSkyhook } from "./skyhookModel.js";
import { MATERIALS } from "../../Shared/materials.js";

var moon = systems.get("Moon");
var m = MATERIALS.silica;
var t = computeSkyhook(moon, {
	foot: 10e3, centre: 275e3, top: 2000e3,
	receivingDeck: 233e3, outerDocks: 606.5e3, launchDeck: 950e3,
	strength: (m.strength / 3) / m.density, tipMass: 100e3,
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
	near(t.highMass, 2.59, 2, "upper mass ratio");
	near(t.lowIntegral, 69839, 0, "lower climb J/kg");
	near(t.highIntegral, 1860487, 0, "upper climb J/kg");
});

test("forces", function () {
	near(t.tensionCoM_top / 1e3, 509.77, 2, "tension, load at top");
	near(t.tensionCoM_foot / 1e3, 57.59, 2, "tension, load at foot");
	near(t.massAbs / 1e3, 267.23, 2, "tether mass t");
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
	near(th.addedTensionPct, 3.93, 2, "added tension %");
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
