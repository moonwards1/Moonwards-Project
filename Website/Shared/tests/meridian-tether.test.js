// Node tests for meridian-tether.js. Run from the repo root:
//   node --test Website/Shared/tests/meridian-tether.test.js
//
// On the equator of a round body the meridian tether is the radial one, so
// with J2 = 0 and the anchor at latitude 0 it must agree with
// radial-tether.js's standard elevator: same tensions, masses and pulls,
// track and stations included. Off the equator: the shape lands on the
// anchor, the taper follows the potential alone, and the slowest
// north–south swing of a tether anchored at the centre would be one turn
// of the body exactly.

import test from "node:test";
import assert from "node:assert/strict";

import { oblateField, areoidRadius, stationaryRadius, solveMeridianTether, heightAtRadius, northSouthModes, eastWestLean, leanedTether, mostFlow } from "../meridian-tether.js";
import { standardField, tetherContext, tetherMetrics, pullBalance, counterweightFor } from "../radial-tether.js";

var GM = 4.282837e13, R = 3396.2e3, W = 2 * Math.PI / 88642.66;

function near(actual, expected, rel, label) {
	assert.ok(Math.abs(actual / expected - 1) < rel, label + ": " + actual + " vs " + expected);
}

test("on the equator it is the radial tether", function () {
	var rCW = 40000e3, M = 2e8, rho = 1450, sigEff = 7.2e9, st = [{ r: 8000e3, m: 5e6 }, { r: 30000e3, m: 2e7 }];
	var mer = solveMeridianTether(oblateField(GM, 0, R, W), { latA: 0, rA: R, rCW: rCW, M: M, rho: rho, sigEff: sigEff, lamMin: 0.4, lamGrav: 1.2, stations: st });
	assert.ok(mer.ok);
	assert.ok(Math.abs(mer.zCW) < 1, "stays in the plane");
	var ctx = tetherContext(standardField(GM, R, W), { rCW: rCW, rho: rho, sigEff: sigEff, lamMin: 0.4, lamGrav: 1.2, stations: st });
	var rad = tetherMetrics(ctx, M);
	near(mer.T0, rad.TsurfHold, 1e-4, "hold-down");
	near(mer.Tpeak, rad.Tpeak, 1e-4, "peak tension");
	near(mer.mass, rad.mass, 1e-3, "cable mass");
	near(mer.trackMass, rad.trackMass, 1e-3, "track mass");
	near(mer.Ptrack, ctx.Ptrack, 1e-3, "track's pull at the anchor");
	near(mer.McwMin, ctx.McwMin, 1e-3, "minimum counterweight");
	near(pullBalance(mer, M).mult, pullBalance(ctx, M).mult, 1e-3, "multiple");
	near(counterweightFor(mer, 3), counterweightFor(ctx, 3), 1e-3, "counterweight for 3×");
	// The pulls add up to the hold-down.
	var b = pullBalance(mer, M);
	near(b.up - b.down, mer.T0, 2e-3, "pulls sum to the hold-down");
});

test("off the equator: lands on the anchor, taper from the potential", function () {
	var f = oblateField(GM, 1.96045e-3, R, W);
	var lat = 18.65 * Math.PI / 180, rA = areoidRadius(R, 3376.2e3, lat) + 21.9e3, k = 1450 / 7.2e9;
	var s = solveMeridianTether(f, { latA: lat, rA: rA, rCW: 51000e3, M: 1e8, rho: 1450, sigEff: 7.2e9 });
	assert.ok(s.ok);
	near(Math.atan2(s.path.z[0], s.path.x[0]), lat, 1e-6, "anchor latitude");
	near(s.path.r[0], rA, 1e-6, "anchor radius");
	near(s.rPeak, stationaryRadius(f), 0.002, "peak near areostationary");
	var dPhi = f.Phi(s.path.x[s.path.x.length - 1], s.zCW) - f.Phi(s.path.x[0], s.path.z[0]);
	near(s.Tcw / s.T0, Math.exp(k * dPhi), 1e-4, "tension ratio follows the potential");
	assert.ok(heightAtRadius(s, 9376e3) > 300e3, "well above Phobos's orbit");
	assert.ok(isNaN(heightAtRadius(s, 60000e3)), "nothing beyond the counterweight");
	// A shape that can't land says so.
	assert.equal(solveMeridianTether(f, { latA: 1.2, rA: rA, rCW: 21000e3, M: 1e8, rho: 1450, sigEff: 7.2e9 }).ok, false);
	assert.equal(solveMeridianTether(f, { latA: lat, rA: rA, rCW: 15000e3, M: 1e8, rho: 1450, sigEff: 7.2e9 }).why, "inside");
});

test("slowest north–south swing is close to one turn", function () {
	var f = oblateField(GM, 0, R, W);
	var s = solveMeridianTether(f, { latA: 0, rA: R, rCW: 51000e3, M: 1.2e8, rho: 1450, sigEff: 7.2e9 });
	var ms = northSouthModes(f, s, { count: 2 });
	var turn = 2 * Math.PI / W;
	assert.ok(ms.modes[0].period < turn && ms.modes[0].period > 0.98 * turn, "slightly under one turn: " + ms.modes[0].period / turn);
	assert.ok(ms.modes[1].period < 0.5 * turn, "the next is much faster");
	near(ms.modes[0].eta[ms.modes[0].eta.length - 1], 1, 1e-12, "scaled to 1 at the counterweight");
	assert.equal(ms.modes[0].eta[0], 0, "fixed at the anchor");
});

test("cargo's lean: the full solution matches the small-deflection one where the lean is small", async function () {
	var { MarsElevator: MEL } = await import("../../Calculators/Mars-Elevator/marsElevatorModel.js");
	var sys = MEL.marsSystem(), a = MEL.anchor(sys, 18.65, 0);
	var sol = MEL.sizeStructure(sys, { lat: a.lat, rA: a.r, rCW: 51000e3, density: 1450, sigmaEff: 18e9 / 2.5 }).sol;
	var zero = leanedTether(sys.field, sol, { mdot: 0, v: 200 });
	assert.ok(zero.ok); assert.ok(Math.abs(zero.T0 / sol.T0 - 1) < 1e-4, "no cargo: the tether as sized");
	assert.ok(Math.abs(zero.elevation - sol.departure) < 1e-4);
	var full = leanedTether(sys.field, sol, { mdot: 2, v: 200 }), small = eastWestLean(sys.field, sol, { mdot: 2, v: 200 });
	assert.ok(Math.abs(full.lean / Math.asin(small.side / small.T0) - 1) < 0.03, full.lean + " vs " + Math.asin(small.side / small.T0));
	// The anchor's sideways pull times its distance from the axis carries the whole torque.
	var xA = Math.hypot(full.path.x[0], full.path.y[0]);
	assert.ok(Math.abs(full.side * xA / full.torque - 1) < 1e-3);
	// Past the most flow, no equilibrium; just under it, one.
	var most = mostFlow(sys.field, sol, { v: 200 });
	assert.ok(most.flow > 33 && most.flow < 40, "most " + most.flow);
	assert.ok(most.at.elevation > 0 && most.at.elevation < 8 * Math.PI / 180, "low over the ground at the anchor by then");
	assert.ok(!leanedTether(sys.field, sol, { mdot: most.flow * 1.15, v: 200 }).ok, "well past it, none");
});

