// Node tests for aerobrakeModel.js. Run from the repo root:
//   node --test Website/Calculators/Earth-Aerobrake-Calculator/aerobrakeModel.test.js
//
// Pins the original page's default case: 13 km/s arrival, 70 km periapsis, apoapsis
// at Earth's SOI, a 60,000 t cargo (5 % structure, 3.5 % shield budget, 700 t
// fuel) behind a 150 m shield with Cd 1.5. The original page's figures for these
// and three other cases were compared with the model's before the page was removed.

import test from "node:test";
import assert from "node:assert/strict";
import { computeAerobrake } from "./aerobrakeModel.js";

var base = { vEntry: 13, hPeri: 70, apoFrac: 1, scaleH: 7160, cargo: 60000, structPct: 5, tpsPct: 3.5, fuel: 700, shieldD: 150, cd: 1.5, noseR: 0, qStar: 15 };
var r = computeAerobrake(base);

function near(actual, expected, dp, label) {
	assert.equal(Number(actual.toFixed(dp)), expected, label + ": " + actual);
}

test("speed shed", function () {
	near(r.soi / 1e3, 924642, 0, "Earth SOI km");
	near(r.vEsc / 1e3, 11.125, 3, "escape speed at periapsis km/s");
	near(r.vExit / 1e3, 11.087, 3, "periapsis speed after the brake km/s");
	near(r.shed / 1e3, 1.913, 3, "speed to shed km/s");
	near(r.margin, 38.5, 1, "margin below escape m/s");
});

test("deceleration and loads", function () {
	near(r.gPeak, 3.46, 2, "peak g");
	near(r.tau, 79.6, 1, "soak time s");
	near(r.entryMass / 1e6, 65.8, 1, "entry mass kt");
	near(r.beta, 2482, 0, "ballistic coefficient kg/m²");
});

test("atmospheric pass and heating", function () {
	near(r.brakingAltitude / 1e3, 49.8, 1, "braking altitude km");
	near(r.dynamicPressureAtm, 0.83, 2, "dynamic pressure atm");
	near(r.heatFluxWcm2, 119.0, 1, "convective flux W/cm²");
	near(r.heatLoadKJcm2, 9.5, 1, "integrated load kJ/cm²");
	near(r.shieldMassNeeded / 1e3, 279, 0, "heat-shield mass needed t");
	assert.equal(r.flags.escapeMargin, "caution");
	assert.equal(r.flags.shield, "ok");
});

test("a nose radius of 0 means half the shield diameter", function () {
	var same = computeAerobrake(Object.assign({}, base, { noseR: 75 }));
	assert.ok(Math.abs(same.heatFluxWcm2 / r.heatFluxWcm2 - 1) < 1e-12, "flux with an explicit 75 m nose");
});
