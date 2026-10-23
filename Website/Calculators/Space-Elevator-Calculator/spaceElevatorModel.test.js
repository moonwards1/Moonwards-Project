// Node tests for spaceElevatorModel.js. Run from the repo root:
//   node --test Website/Calculators/Space-Elevator-Calculator/spaceElevatorModel.test.js
//
// Pins the standalone page's Ceres defaults (radius 476.2 km, surface gravity
// 0.2763 m/s², day 9.074 h, 2.77 AU; mature CNT 42 GPa, 1400 kg/m³, ×2; tip
// auto at 1.2 × the synchronous radius) and an Earth elevator.

import test from "node:test";
import assert from "node:assert/strict";

import { Const } from "../../Shared/constants.js";
import { computeSpaceElevator } from "./spaceElevatorModel.js";

function near(actual, expected, rel, label) {
	assert.ok(Math.abs(actual / expected - 1) < rel, label + ": " + actual + " vs " + expected);
}

var R = 476.2e3;
var ceres = { GM: 0.2763 * R * R, R: R, omega: 2 * Math.PI / (9.074 * 3600), sigmaEff: 21e9, density: 1400, aSun: 2.77 * Const.AU };

test("Ceres defaults", function () {
	var se = computeSpaceElevator(ceres);
	assert.ok(se.autoTip);
	near(se.hSync, 715.78e3, 1e-5, "synchronous altitude");
	near(se.vSync, 229.27, 1e-5, "synchronous speed");
	near(se.rTip, 1.2 * se.rSync, 1e-12, "auto tip");
	near(se.taper, 1.000186913, 1e-9, "taper");
	near(se.vTip, 275.12, 1e-4, "tip speed");
	assert.equal(se.escapes, false);
	near(se.helio.bodyApo - R, 8610.86e3, 1e-4, "apoapsis altitude");
});

test("a release that escapes the body lands in a heliocentric orbit", function () {
	var se = computeSpaceElevator(Object.assign({}, ceres, { rTip: R + 4000e3 }));
	assert.ok(se.escapes);
	assert.ok(se.helio.retroPeri < ceres.aSun && se.helio.proApo > ceres.aSun);
});

test("Earth", function () {
	var se = computeSpaceElevator({ GM: 3.986004418e14, R: 6378.1e3, omega: 2 * Math.PI / 86164.1, sigmaEff: 21e9, density: 1400, aSun: Const.AU });
	near(se.hSync, 35786e3, 1e-3, "geostationary altitude");
	near(se.taper, 1.0342, 1e-3, "taper");
});
