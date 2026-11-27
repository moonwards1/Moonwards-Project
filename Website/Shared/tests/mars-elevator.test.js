// Node tests for Shared/mars-elevator.js — the Mars space elevator's shape on
// the clock. Its sizing, lean and Phobos limit are pinned in the Mars System
// Traffic Plotter's suite (core/tests/elevator.test.js), through the same
// functions; these cover what this file adds.
// Run from the repo root:
//   node --test Website/Shared/tests/mars-elevator.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { elevatorShape, elevatorAt, elevatorPoint, pointAt } from "../mars-elevator.js";
import { OrbitalMath as O } from "../math-utils.js";

var JD = 2480821.875;

test("a point of the tether turns with Mars: its velocity is the spin across its position", function () {
	var f = elevatorShape({}), at = elevatorAt(f, JD);
	[f.rA + 1e3, 20000e3, 40000e3, f.rCW].forEach(function (R) {
		var p = pointAt(f, at, R);
		assert.ok(Math.abs(O.vMag(p.r) - R) < 1, "at " + R);
		assert.ok(O.vMag(O.vSub(p.v, O.vCross(at.spin, p.r))) < 1e-9);
		assert.ok(Math.abs(O.vMag(p.v) - O.vMag(at.spin) * p.x) < 1e-6);
	});
});

test("at rest, the point at the counterweight is the drawn curve's last point", function () {
	var f = elevatorShape({}), at = elevatorAt(f, JD), n = f.curve.r.length;
	assert.equal(at.q, 0, "no swing given: at rest");
	assert.ok(O.vMag(O.vSub(pointAt(f, at, f.rCW).r, elevatorPoint(f, at, n - 1))) < 1);
	assert.ok(O.vMag(O.vSub(pointAt(f, at, f.rA).r, elevatorPoint(f, at, 0))) < 1);
});

test("the same design is figured once", function () {
	assert.equal(elevatorShape({ cargoFlow: 150 }), elevatorShape({}));
	assert.notEqual(elevatorShape({ cargoFlow: 100 }), elevatorShape({}));
});
