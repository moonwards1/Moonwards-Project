// Node tests for l1ElevatorModel.js. Run from the repo root:
//   node --test Website/Calculators/Moon-L1-Elevator/l1ElevatorModel.test.js
//
// Pins the standalone page's example design (its default fields: mature CNT
// 42 GPa, 1400 kg/m³, ×3; counterweight at 222,100 km; 30,700 t/day in 1000 t
// climbers at 200 m/s, 10 % tare; track 0.4 + 1.2 kg/m) to the figures the
// page showed before its physics moved into the model, plus the workbench's
// no-cargo structure and the natural orbit after release.

import test from "node:test";
import assert from "node:assert/strict";

import { L1Elevator } from "./l1ElevatorModel.js";

var KM = 1e3;
var page = {
	Rmoon: 1738 * KM, D: 384400 * KM, baryE: 4671 * KM, GMm: 4.902e12, GMe: 3.986e14, rL1: 58000 * KM,
	omegaSrc: "kepler", Vorb: 1022, sig: 42e9, rho: 1400, safety: 3, rCW: 222100 * KM,
	rate: 30700, perClimber: 1000, vClimb: 200, infraPct: 10, trackMin: 0.4, trackGrav: 1.2
};

function near(actual, expected, rel, label) {
	assert.ok(Math.abs(actual / expected - 1) < rel, label + ": " + actual + " vs " + expected);
}

test("minimum counterweight and the loaded cable", function () {
	var ctx = L1Elevator.buildContext(page);
	near(ctx.McwMin, 424634849.384, 1e-9, "minimum counterweight kg");
	var m = L1Elevator.loadedMetrics(page, ctx, 1e9);
	near(m.mass, 361670864.485, 1e-9, "cable mass kg");
	near(m.trackMass, 90798856.288, 1e-9, "track mass kg");
	near(m.TL1, 17416774.386, 1e-9, "tension at L1 N");
	near(m.TsurfHold, 9908893.097, 1e-9, "hold-down tension N");
	near(m.AL1 / m.Asurf, 0.0012440553132783 / 0.0007077780783689, 1e-9, "taper L1 / surface");
});

test("no cargo: the minimum comes from the track alone", function () {
	var p = Object.assign({}, page, { rate: 0 });
	var ctx = L1Elevator.buildContext(p);
	near(ctx.McwMin, 147.1e6, 1e-3, "minimum counterweight kg");
	var bare = L1Elevator.buildContext(Object.assign({}, p, { trackMin: 0, trackGrav: 0 }));
	assert.equal(bare.McwMin, 0, "a cable sized to its counterweight needs no minimum");
});

test("L1 is where the net force vanishes", function () {
	var r = L1Elevator.findL1(page);
	near(r, 58016.1e3, 1e-5, "L1 from the Moon's centre");
	var ctx = L1Elevator.buildContext(Object.assign({}, page, { rL1: r }));
	assert.ok(Math.abs(ctx.g(r)) < 1e-12);
});

test("natural orbit after release from the counterweight", function () {
	var q = { GMe: page.GMe, D: page.D, rCW: page.rCW, omega: L1Elevator.omega(page), Rearth: 6371e3, ifaceAlt: 122e3 };
	var ro = L1Elevator.releaseOrbit(q);
	assert.ok(ro.bound);
	near(ro.vRel, 432.58, 1e-4, "release speed m/s");
	near(ro.rPer - 6371e3, 56.92e3, 1e-3, "perigee altitude m");
	assert.equal(ro.burn, null);
	near(ro.entry.gamma * 180 / Math.PI, 5.630, 1e-3, "entry angle °");
	near(ro.entry.peakG, 16.69, 1e-3, "peak g");
	var burned = L1Elevator.releaseOrbit(Object.assign({ targetAlt: 50e3 }, q));
	near(burned.burn.dv, 0.2242, 1e-3, "burn to a 50 km perigee m/s");
});
