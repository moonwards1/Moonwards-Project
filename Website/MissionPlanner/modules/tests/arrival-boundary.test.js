// Node tests for the Coast→Arrival compliance boundary
// (modules/arrival-boundary/arrival-boundary.js): the pure comparison and its
// warning mapping. The `boundary: true` behaviour itself — that an upstream
// failure doesn't mark this stage blocked — belongs to the engine and is
// tested in core/tests/recompute.test.js. Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/arrival-boundary.test.js

import test from "node:test";
import assert from "node:assert/strict";

import arrivalBoundary, { computeArrivalCompliance, arrivalComplianceWarnings,
                          ARRIVAL_VINF_TOL } from "../arrival-boundary/arrival-boundary.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";
import { MISS_WARN_AU } from "../transfer-leg/transfer-leg.js";

var AU = 149597870700;   // m
var ARR_JD = O.julianDate(2034, 1, 8, 0, 0, 0);
var COMMIT = { body: "Ceres", jd: ARR_JD, vInf: 3776 };

// A helio ship-state delivered at `body`: `vInf` m/s along +x relative to the
// body, `missM` metres off it, at `jd`.
function delivered(body, vInf, missM, jd) {
	var t = (jd === undefined) ? ARR_JD : jd;
	var bs = Frames.bodyHelioState(body, t);
	var r = bs.r.slice();
	if (missM) { r[0] += missM; }
	return { r: r, v: O.vAdd(bs.v, [vInf, 0, 0]), jd: t, frame: "helio", dvUsed: 0 };
}

function onPlan() {
	return computeArrivalCompliance({ commitment: COMMIT, data: delivered("Ceres", 3776, 0), windowDays: 1 });
}
function rowsOf(comp) {
	var by = {};
	comp.rows.forEach(function (r) { by[r.key] = r; });
	return by;
}

// ---- the descriptor's own contract -----------------------------------------

test("descriptor: a boundary that passes ship-states through, with no params", function () {
	assert.equal(arrivalBoundary.id, "arrival-boundary");
	assert.equal(arrivalBoundary.boundary, true);
	assert.deepEqual(arrivalBoundary.accepts, ["ship-state"]);
	assert.deepEqual(arrivalBoundary.emits, ["ship-state"]);
	// NOT a terminal stage — mission-view identifies arrival TECH structurally
	// as "accepts ship-state, emits nothing" (mission-view.js's isArrivalTech),
	// and the boundary must never be mistaken for one.
	assert.notEqual(arrivalBoundary.emits.length, 0);
});

// ---- the comparison ---------------------------------------------------------

test("no commitment: nothing to measure, and nothing said about it", function () {
	var comp = computeArrivalCompliance({ commitment: null, data: delivered("Ceres", 3776, 0), windowDays: 1 });
	assert.equal(comp.ok, true);
	assert.equal(comp.commitment, null);
	assert.deepEqual(comp.rows, []);
	assert.deepEqual(arrivalComplianceWarnings(comp), []);
});

test("no delivery: one warning, and NEVER a diagnostic (the boundary can't block)", function () {
	var comp = computeArrivalCompliance({ commitment: COMMIT, data: null, windowDays: 1 });
	assert.equal(comp.ok, true);
	assert.equal(comp.delivered, null);
	assert.deepEqual(comp.rows, []);
	var w = arrivalComplianceWarnings(comp);
	assert.equal(w.length, 1);
	assert.equal(w[0].code, "no-coast-delivery");
	assert.match(w[0].message, /Ceres/);
});

test("an unknown committed body is the one hard failure (a damaged save)", function () {
	var comp = computeArrivalCompliance({
		commitment: { body: "Xyzzy", jd: ARR_JD, vInf: 3776 },
		data: delivered("Ceres", 3776, 0), windowDays: 1 });
	assert.equal(comp.ok, false);
	assert.equal(comp.diagnostic.code, "bad-params");
});

test("a coast delivering exactly what was committed raises nothing", function () {
	var comp = onPlan();
	assert.equal(comp.ok, true);
	assert.equal(comp.rows.every(function (r) { return r.ok; }), true);
	assert.deepEqual(arrivalComplianceWarnings(comp), []);
});

test("v∞ row: measured against the commitment, tolerance ARRIVAL_VINF_TOL", function () {
	// just inside
	var near = computeArrivalCompliance({ commitment: COMMIT,
		data: delivered("Ceres", 3776 + ARRIVAL_VINF_TOL - 1, 0), windowDays: 1 });
	assert.equal(rowsOf(near).vinf.ok, true);
	assert.deepEqual(arrivalComplianceWarnings(near), []);

	// clearly outside, arriving hot
	var hot = computeArrivalCompliance({ commitment: COMMIT,
		data: delivered("Ceres", 3776 + 400, 0), windowDays: 1 });
	var row = rowsOf(hot).vinf;
	assert.equal(row.ok, false);
	assert.ok(Math.abs(row.delta - 400) < 1e-6);
	var w = arrivalComplianceWarnings(hot);
	assert.equal(w.length, 1);
	assert.equal(w[0].code, "arrival-vinf-mismatch");
	assert.match(w[0].message, /over by 0\.40 km\/s/);

	// and arriving slow reads the other way
	var slow = computeArrivalCompliance({ commitment: COMMIT,
		data: delivered("Ceres", 3776 - 400, 0), windowDays: 1 });
	assert.match(arrivalComplianceWarnings(slow)[0].message, /short by 0\.40 km\/s/);
});

test("a pre-H2 commitment with no v∞ omits the row rather than inventing a requirement", function () {
	var comp = computeArrivalCompliance({ commitment: { body: "Ceres", jd: ARR_JD, vInf: null },
		data: delivered("Ceres", 3776, 0), windowDays: 1 });
	assert.equal(rowsOf(comp).vinf, undefined);
	assert.equal(rowsOf(comp).epoch !== undefined, true);
	assert.deepEqual(arrivalComplianceWarnings(comp), []);
});

test("epoch row: checked against the plan's own hand-off window, not a constant", function () {
	// 0.5 d late is inside a ±1 d window, outside a ±0.25 d one — the window is
	// the plan's field (frozen-plan's handoffWindowDays), reused at this seam.
	var late = delivered("Ceres", 3776, 0, ARR_JD + 0.5);
	assert.equal(rowsOf(computeArrivalCompliance({ commitment: COMMIT, data: late, windowDays: 1 })).epoch.ok, true);
	var tight = computeArrivalCompliance({ commitment: COMMIT, data: late, windowDays: 0.25 });
	assert.equal(rowsOf(tight).epoch.ok, false);
	var w = arrivalComplianceWarnings(tight);
	assert.equal(w[0].code, "arrival-epoch-mismatch");
	assert.match(w[0].message, /late/);
	assert.match(w[0].message, /±0\.25 d/);
});

test("epoch row: early reads as early", function () {
	var comp = computeArrivalCompliance({ commitment: COMMIT,
		data: delivered("Ceres", 3776, 0, ARR_JD - 3), windowDays: 1 });
	assert.match(arrivalComplianceWarnings(comp)[0].message, /3\.0 days early/);
});

test("encounter row: the coast has to actually get there, at transfer-leg's own threshold", function () {
	var missed = computeArrivalCompliance({ commitment: COMMIT,
		data: delivered("Ceres", 3776, (MISS_WARN_AU + 0.05) * AU), windowDays: 1 });
	var row = rowsOf(missed).encounter;
	assert.equal(row.ok, false);
	assert.equal(row.required, MISS_WARN_AU);
	// worded by the SAME interceptWarning the arrival technologies raise, so a
	// miss reads identically wherever it surfaces
	var w = arrivalComplianceWarnings(missed);
	assert.equal(w.filter(function (x) { return x.code === "intercept-miss"; }).length, 1);

	// inside the threshold, no encounter warning
	assert.equal(rowsOf(computeArrivalCompliance({ commitment: COMMIT,
		data: delivered("Ceres", 3776, 0.5 * MISS_WARN_AU * AU), windowDays: 1 })).encounter.ok, true);
});

test("several deviations at once each get their own warning — one comparison, not a reconciliation", function () {
	var comp = computeArrivalCompliance({ commitment: COMMIT,
		data: delivered("Ceres", 3776 + 900, (MISS_WARN_AU + 0.05) * AU, ARR_JD + 4), windowDays: 1 });
	var codes = arrivalComplianceWarnings(comp).map(function (w) { return w.code; }).sort();
	assert.deepEqual(codes, ["arrival-epoch-mismatch", "arrival-vinf-mismatch", "intercept-miss"]);
});

test("every warning carries a fix line", function () {
	var comp = computeArrivalCompliance({ commitment: COMMIT,
		data: delivered("Ceres", 3776 + 900, 0, ARR_JD + 4), windowDays: 1 });
	arrivalComplianceWarnings(comp).forEach(function (w) {
		assert.ok(typeof w.fix === "string" && w.fix.length > 0, w.code + " has no fix");
	});
	assert.ok(arrivalComplianceWarnings(
		computeArrivalCompliance({ commitment: COMMIT, data: null, windowDays: 1 }))[0].fix.length > 0);
});

// ---- all three rows measure the PASS, not the delivered instant -------------
// The delivered packet sits at the coast leg's END — `jd0 + legDays`, a
// parameter rather than an event — which is neither where the ship comes
// closest nor when it gets there. Measuring there left the epoch row
// structurally unable to move when waypoints were tuned.

// A pass at `rmin` metres, `vInf` m/s, `jd` — the shape transfer-leg's
// nearestApproach returns.
function passAt(rmin, vInf, jd) {
	return { jd: jd, rmin: rmin, vInf: vInf, speed: vInf, insideSoi: true, vRel: [vInf, 0, 0] };
}

test("compliance: the epoch row reads the pass, not the delivered epoch", function () {
	// Delivered half a day AFTER the pass — exactly the coast's own situation,
	// since its leg routinely runs on past closest approach.
	var comp = computeArrivalCompliance({
		commitment: COMMIT,
		pass: passAt(1e7, 3776, ARR_JD + 0.3),
		data: delivered("Ceres", 3776, 0, ARR_JD),
		windowDays: 1
	});
	var rows = rowsOf(comp);
	assert.ok(Math.abs(rows.epoch.delivered - (ARR_JD + 0.3)) < 1e-9,
		"epoch row took the delivered instant instead of the pass");
	assert.ok(Math.abs(rows.epoch.delta - 0.3) < 1e-9);
	assert.equal(comp.delivered.jd, ARR_JD + 0.3);
});

test("compliance: the encounter row reads the pass distance", function () {
	// Delivered a long way off, but the PASS is close — the coast reached the
	// body and then carried on, which must not read as a miss.
	var comp = computeArrivalCompliance({
		commitment: COMMIT,
		pass: passAt(2e7, 3776, ARR_JD),
		data: delivered("Ceres", 3776, 0.5 * AU),
		windowDays: 1
	});
	var rows = rowsOf(comp);
	assert.ok(Math.abs(rows.encounter.delivered - 2e7 / AU) < 1e-12);
	assert.equal(rows.encounter.ok, true, "a close pass must not read as a miss");
	assert.deepEqual(arrivalComplianceWarnings(comp), []);
});

test("compliance: the v∞ row reads the pass's asymptotic speed", function () {
	var comp = computeArrivalCompliance({
		commitment: COMMIT,
		pass: passAt(1e7, 3776 + ARRIVAL_VINF_TOL + 5, ARR_JD),
		data: delivered("Ceres", 3776, 0),   // on-plan at the delivered instant
		windowDays: 1
	});
	var rows = rowsOf(comp);
	assert.ok(Math.abs(rows.vinf.delivered - (3776 + ARRIVAL_VINF_TOL + 5)) < 1e-9);
	assert.equal(rows.vinf.ok, false, "the pass is outside tolerance and must say so");
});

test("compliance: with no pass it falls back to the delivered instant", function () {
	// A bare Node call, or a chain whose coast hasn't computed: the delivered
	// state is all there is, and the old behaviour is exactly right there.
	var withoutPass = computeArrivalCompliance({
		commitment: COMMIT, data: delivered("Ceres", 3776, 0), windowDays: 1 });
	assert.deepEqual(rowsOf(withoutPass).epoch.delivered, ARR_JD);
	assert.equal(rowsOf(withoutPass).encounter.ok, true);
	// null and undefined alike mean "no measurement available".
	var nullPass = computeArrivalCompliance({
		commitment: COMMIT, pass: null, data: delivered("Ceres", 3776, 0), windowDays: 1 });
	assert.deepEqual(rowsOf(nullPass).epoch.delivered, ARR_JD);
});

test("compliance: fractional day counts read as plural", function () {
	// The epoch row reports the PASS now, so non-integer day counts are the
	// norm rather than an oddity — "1.4 day early" was the old threshold showing.
	function msgFor(deltaDays) {
		var comp = computeArrivalCompliance({
			commitment: COMMIT,
			pass: passAt(1e7, 3776, ARR_JD + deltaDays),
			data: delivered("Ceres", 3776, 0),
			windowDays: 1
		});
		return arrivalComplianceWarnings(comp).map(function (w) { return w.message; }).join(" ");
	}
	assert.match(msgFor(-1.4), /1\.4 days early/);
	assert.match(msgFor(2.5), /2\.5 days late/);
	// Exactly one day stays singular.
	assert.match(msgFor(-1.02), /1\.0 day early/);
});
