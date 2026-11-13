// Node tests for Shared/lagrange-elevator.js — elevators through Earth–Moon L1 and L2.
// Run from the repo root:
//   node --test Website/Shared/tests/lagrange-elevator.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { LAGRANGE_SIDES, lagrangeSide, lagrangeLineAt, linePointState, lineElementFor, anchorPositions }
	from "../lagrange-elevator.js";
import { evaluateChain, appendElement, emptyChain, lineFrame } from "../kinematic-chain.js";
import { OrbitalMath as O } from "../math-utils.js";
import { systems } from "../orbit.js";

function within(actual, expected, tol, label) {
	assert.ok(Math.abs(actual - expected) <= tol, label + ": " + actual + " not within " + tol + " of " + expected);
}

var JD = O.julianDate(2080, 1, 1, 0, 0, 0) + 81;   // 2080-03-22
var DAY = 86400, DEG = 180 / Math.PI;
var R_MOON = +systems.get("Moon").radius, GM_E = systems.get("Earth").GM, GM_M = systems.get("Moon").GM;

test("the two sides: L1 toward Earth, L2 away from it, at their Lagrange fractions", function () {
	assert.equal(LAGRANGE_SIDES.L1.sign, 1);
	assert.equal(LAGRANGE_SIDES.L2.sign, -1);
	within(LAGRANGE_SIDES.L1.fraction, 0.1509, 5e-4, "L1 fraction");
	within(LAGRANGE_SIDES.L2.fraction, 0.1679, 5e-4, "L2 fraction");
	assert.throws(function () { lagrangeSide("L3"); });
});

test("each side's points lie on the Earth–Moon line, on their own side of the Moon", function () {
	[0, 5.3, 11, 19.7].forEach(function (d) {
		var jd = JD + d, s = 200000e3;
		var a1 = lagrangeLineAt("L1", jd), a2 = lagrangeLineAt("L2", jd);
		var p1 = linePointState(a1, s), p2 = linePointState(a2, s);
		// Earth, the L1 point and the Moon in that order; the Moon, then the L2 point beyond it.
		within(O.vMag(p1.r) + s, a1.D, 1e-3, "L1 side: Earth to point to Moon");
		within(O.vMag(p2.r) - s, a2.D, 1e-3, "L2 side: Earth to Moon to point");
		within(O.vDot(a1.u, a2.u), -1, 1e-12, "opposite directions");
		within(O.vDot(p2.relR, p2.relV), 0, 1, "it keeps its distance from the Moon");
		// Both sides travel round Earth the same way, the Moon's way.
		assert.deepEqual(a1.travel, a2.travel);
		assert.ok(O.vDot(a1.travel, a1.moon.v) > 0.9 * O.vMag(a1.moon.v));
	});
});

test("a point's velocity is the rate of change of its position", function () {
	var h = 0.01;
	["L1", "L2"].forEach(function (side) {
		[R_MOON + 45000e3, 220000e3].forEach(function (s) {
			var a = linePointState(lagrangeLineAt(side, JD - h), s).r;
			var b = linePointState(lagrangeLineAt(side, JD + h), s).r;
			var v = linePointState(lagrangeLineAt(side, JD), s).v;
			within(O.vMag(O.vSub(O.vScale(O.vSub(b, a), 1 / (2 * h * DAY)), v)), 0, 0.05, side + " finite difference, m/s");
		});
	});
});

test("the Earth–Moon distance's rate is dD/dt", function () {
	var h = 0.01, D0 = lineFrame("Moon", "Earth", JD - h).D, D1 = lineFrame("Moon", "Earth", JD + h).D;
	within(lineFrame("Moon", "Earth", JD).dDot, (D1 - D0) / (2 * h * DAY), 0.05, "m/s");
	within(lagrangeLineAt("L2", JD).dDot, (D1 - D0) / (2 * h * DAY), 0.05, "the same on either side, m/s");
});

test("the chain's line element is the same point", function () {
	["L1", "L2"].forEach(function (side) {
		[0, 9.4].forEach(function (d) {
			var jd = JD + d, s = 150000e3;
			var p = linePointState(lagrangeLineAt(side, jd), s);
			var c = evaluateChain(appendElement(emptyChain("Moon"), lineElementFor(side, s)), jd);
			within(O.vMag(O.vSub(c.r, p.r)), 0, 1e-6, side + " position, m");
			within(O.vMag(O.vSub(c.v, p.v)), 0, 1e-9, side + " velocity, m/s");
		});
	});
});

test("each Lagrange point slides along the tether as the Earth–Moon distance changes", function () {
	["L1", "L2"].forEach(function (side) {
		var lo = Infinity, hi = 0;
		for (var d = 0; d < 60; d += 0.25) {
			var at = lagrangeLineAt(side, JD + d);
			within(at.rLagrange, LAGRANGE_SIDES[side].fraction * at.D, 1e-3, side + ": a fixed fraction of the distance");
			lo = Math.min(lo, at.rLagrange); hi = Math.max(hi, at.rLagrange);
		}
		var mid = LAGRANGE_SIDES[side].fraction * 384400e3;
		assert.ok(lo < 0.97 * mid && hi > 1.03 * mid, side + " moves over the month: " + lo + " to " + hi);
	});
	// L2 is always further out than L1 is at the same instant.
	assert.ok(lagrangeLineAt("L2", JD).rLagrange > lagrangeLineAt("L1", JD).rLagrange);
});

test("far enough beyond L2 the elevator is faster than Earth's escape speed; L1's side never is", function () {
	[0, 7, 14, 21].forEach(function (d) {
		var jd = JD + d;
		function energy(side, s) {
			var p = linePointState(lagrangeLineAt(side, jd), s);
			return O.vDot(p.v, p.v) / 2 - GM_E / O.vMag(p.r) - GM_M / s;
		}
		// Escape needs omega R >= sqrt(2 GM / R): R >= 2^(1/3) D, some 100,000 km beyond the Moon.
		assert.ok(energy("L2", 250000e3) > 0, "L2 side, 250,000 km out: unbound from Earth");
		assert.ok(energy("L2", 70000e3) < 0, "L2 side, just past L2: still bound");
		assert.ok(energy("L1", 250000e3) < 0, "L1 side: bound");
	});
});

test("anchors sit on the ground and straddle their own side's direction", function () {
	var near = [{ lat: 20, lon: 20 }, { lat: 20, lon: -20 }, { lat: -20, lon: -20 }, { lat: -20, lon: 20 }];
	var far = [{ lat: 20, lon: 160 }, { lat: 20, lon: 200 }, { lat: -20, lon: 200 }, { lat: -20, lon: 160 }];
	[0, 7, 14, 21].forEach(function (d) {
		var jd = JD + d;
		[["L1", near], ["L2", far]].forEach(function (pair) {
			var at = lagrangeLineAt(pair[0], jd), sum = [0, 0, 0];
			anchorPositions(pair[1], R_MOON, jd).forEach(function (a) {
				within(O.vMag(a), R_MOON, 1e-3, "on the surface");
				sum = O.vAdd(sum, a);
			});
			// Never more than the librations (about 10 degrees) off the elevator's own line.
			assert.ok(Math.acos(O.vDot(O.vUnit(sum), at.u)) * DEG < 10.5, pair[0] + ": the legs straddle the line");
		});
	});
});
