// Node tests for radial-tether.js. Run from the repo root:
//   node --test Website/Shared/tests/radial-tether.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { OrbitalMath } from "../math-utils.js";
import { standardField, earthMoonField, tetherContext, tetherMetrics, pullBalance, counterweightFor, radiusAtForce } from "../radial-tether.js";

function near(actual, expected, rel, label) {
	assert.ok(Math.abs(actual / expected - 1) < rel, label + ": " + actual + " vs " + expected);
}

// Ceres, mature CNT ×2, tip at 1.2 × synchronous radius.
var R = 476.2e3, GM = 0.2763 * R * R, omega = 2 * Math.PI / (9.074 * 3600);
var ceres = standardField(GM, R, omega);
var rTip = 1.2 * ceres.rBalance;
var cnt = { rho: 1400, sigEff: 21e9 };

// The cable mass per kg hung at the tip, by direct quadrature of the
// exponential taper — an independent check on the RK4 sizing.
function massPerTipKg(f, rFoot, rTip, rho, sig) {
	var n = 20000, dr = (rTip - rFoot) / n, k = rho / sig, mass = 0;
	for (var i = 0; i <= n; i++) {
		var r = rFoot + i * dr, w = (i === 0 || i === n) ? 0.5 : 1;
		mass += w * rho * (f.g(rTip) / sig) * Math.exp(k * (f.Phi(r) - f.Phi(rTip))) * dr;
	}
	return mass;
}

test("standard field: synchronous orbit is the balance point", function () {
	near(ceres.rBalance, OrbitalMath.synchronousRadius(GM, omega), 1e-12, "balance radius");
	assert.ok(Math.abs(ceres.g(ceres.rBalance)) < 1e-12);
});

test("a bare cable reproduces the exponential taper", function () {
	var ctx = tetherContext(ceres, Object.assign({ rCW: rTip }, cnt));
	assert.equal(ctx.McwMin, 0, "nothing hangs on a bare cable");
	var m = tetherMetrics(ctx, 1);
	near(m.Apeak / m.Acw, OrbitalMath.taperRatio(GM, omega, ceres.rBalance, rTip, cnt.sigEff / cnt.rho), 1e-6, "taper sync / tip");
	near(m.mass, massPerTipKg(ceres, R, rTip, cnt.rho, cnt.sigEff), 1e-6, "cable kg per tip kg");
});

test("a station is a point load carried down the cable", function () {
	var base = Object.assign({ rCW: rTip, lamMin: 0.4, lamGrav: 1.2 }, cnt);
	var rIn = R + 300e3, rOut = R + 850e3, mIn = 2e6, mOut = 5e6;
	var bare = tetherContext(ceres, base);
	var withIn = tetherContext(ceres, Object.assign({ stations: [{ r: rIn, m: mIn }] }, base));
	var both = tetherContext(ceres, Object.assign({ stations: [{ r: rIn, m: mIn }, { r: rOut, m: mOut }] }, base));
	var M = 3 * bare.McwMin;
	var t0 = tetherMetrics(bare, M), t1 = tetherMetrics(withIn, M), t2 = tetherMetrics(both, M);

	// Surface tension shifts by each station's surface pull.
	var Pin = mIn * ceres.g(rIn) * Math.exp(cnt.rho / cnt.sigEff * (ceres.Phi(R) - ceres.Phi(rIn)));
	var Pout = mOut * ceres.g(rOut) * Math.exp(cnt.rho / cnt.sigEff * (ceres.Phi(R) - ceres.Phi(rOut)));
	near(t1.TsurfHold - t0.TsurfHold, Pin, 1e-9, "inward station's pull");
	near(t2.TsurfHold - t1.TsurfHold, Pout, 1e-9, "outward station's pull");
	assert.ok(Pin < 0 && Pout > 0);
	// An inward station raises the minimum, an outward one lowers it.
	assert.ok(withIn.McwMin > bare.McwMin && both.McwMin < withIn.McwMin);
	// At a fixed counterweight an inward station takes up part of the anchor's
	// hold-down, so the cable below it thins; held at the same multiple, the
	// heavier counterweight it calls for thickens everything above: more cable.
	assert.ok(t1.mass < t0.mass);
	assert.ok(tetherMetrics(withIn, counterweightFor(withIn, 3)).mass > tetherMetrics(bare, counterweightFor(bare, 3)).mass);
	// Peak tension at sync: the outward station adds its pull carried inward to there.
	var Ppk = mOut * ceres.g(rOut) * Math.exp(cnt.rho / cnt.sigEff * (ceres.Phi(ceres.rBalance) - ceres.Phi(rOut)));
	near(t2.Tpeak - t1.Tpeak, Ppk, 1e-9, "outward station at the peak");
});

test("the multiple and the counterweight that reaches it", function () {
	var base = Object.assign({ rCW: rTip, lamMin: 0.4, lamGrav: 1.2 }, cnt);
	var bare = tetherContext(ceres, base);
	near(pullBalance(bare, 2 * bare.McwMin).mult, 2, 1e-12, "no stations: multiple = mass ÷ minimum");
	near(counterweightFor(bare, 1.5), 1.5 * bare.McwMin, 1e-12, "1.5× floor");
	var st = tetherContext(ceres, Object.assign({ stations: [{ r: R + 300e3, m: 2e6 }, { r: R + 850e3, m: 5e6 }] }, base));
	var M = counterweightFor(st, 1.5);
	near(pullBalance(st, M).mult, 1.5, 1e-12, "floor reached");
	// At a multiple of exactly 1 the anchor holds nothing.
	assert.ok(Math.abs(tetherMetrics(st, counterweightFor(st, 1)).TsurfHold) < 1e-6 * pullBalance(st, M).up);
	// Outward stations heavy enough to hold everything up: no counterweight needed.
	var heavy = tetherContext(ceres, Object.assign({ stations: [{ r: R + 900e3, m: 1e9 }] }, base));
	assert.equal(counterweightFor(heavy, 1.5), 0);
});

test("Earth–Moon fields: L1 and L2", function () {
	var GMe = 3.986e14, GMm = 4.902e12, D = 384400e3;
	var p = { GMe: GMe, GMm: GMm, D: D, xb: D - 4671e3, omega: OrbitalMath.angularVelocity(GMe + GMm, D), Rmoon: 1738e3 };
	var l1 = earthMoonField("L1", p), l2 = earthMoonField("L2", p);
	near(l1.rBalance, OrbitalMath.lagrangeL1Fraction(GMe, GMm) * D, 2e-3, "L1");
	near(l2.rBalance, OrbitalMath.lagrangeL2Fraction(GMe, GMm) * D, 2e-3, "L2");
	[l1, l2].forEach(function (f) {
		assert.ok(f.g(f.R) < 0 && f.g(2 * f.rBalance) > 0);
		var r = 1.5 * f.R;
		near(-(f.Phi(r + 1) - f.Phi(r - 1)) / 2, f.g(r), 1e-5, f.kind + " g = −dΦ/dr");
	});
	// A felt force names one point on each side.
	var rIn = radiusAtForce(l2, -0.5, l2.R, l2.rBalance);
	near(l2.g(rIn), -0.5, 1e-9, "inward felt force");
});
