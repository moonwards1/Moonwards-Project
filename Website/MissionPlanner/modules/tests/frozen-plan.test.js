// Node tests for the frozen-plan module (task C1) — the comply-mode
// semantics: the plan's frozen departure state always flows downstream;
// tech deviations surface as warnings (v∞ / epoch / aim), never re-planning;
// a missing tech is a warning too (inputOptional), not a block. Run from the
// repo root:
//   node --test Website/MissionPlanner/modules/tests/frozen-plan.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld, deserializeWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import skyhook, { computeRelease, defaultParams as skyhookDefaults } from "../lunar-skyhook/lunar-skyhook.js";
import transferLeg from "../transfer-leg/transfer-leg.js";
import frozenPlan, { computeCompliance, complianceWarnings, planDv,
	VINF_TOL, EPOCH_TOL_DAYS, AIM_TOL_DEG } from "../frozen-plan/frozen-plan.js";
import { defaultMission } from "../../presets/default-mission.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";

var JD = O.julianDate(2031, 12, 20, 6, 0, 0);   // the worked example's epoch

function makeRegistry() {
	var reg = createRegistry();
	reg.register(skyhook);
	reg.register(frozenPlan);
	reg.register(transferLeg);
	return reg;
}

// A synthetic plan whose required v∞ out is EXACTLY `vInf` m/s along +x of
// the frame in which Earth's velocity is subtracted out — so tests can dial
// deviations in single quantities (the mockup's 3.42-vs-3.18 shape).
function planParams(vInf) {
	var e = Frames.bodyHelioState("Earth", JD);
	return {
		origin: "Earth",
		departure: { r: e.r.slice(), v: O.vAdd(e.v, [vInf, 0, 0]), jd: JD },
		arrival: { body: "Ceres", jd: JD + 750, vInf: 3776 },
		burn: { pro: 0, rad: 0, nrm: 0 },
		waypoints: []
	};
}

// A delivered hand-off with v∞ vector `vec` (m/s, same convention) at `jd`.
function delivered(vec, jd) {
	var e = Frames.bodyHelioState("Earth", jd);
	return { r: e.r.slice(), v: O.vAdd(e.v, vec), jd: jd, frame: "helio", dvUsed: 0 };
}

// ---- computeCompliance (pure) ----------------------------------------------

test("compliance: an exactly-matching tech passes every row", function () {
	var comp = computeCompliance(planParams(3420), delivered([3420, 0, 0], JD));
	assert.equal(comp.ok, true);
	assert.ok(Math.abs(comp.required.vInf - 3420) < 1e-6);
	assert.ok(Math.abs(comp.delivered.vInf - 3420) < 1e-6);
	assert.equal(comp.rows.length, 3);
	comp.rows.forEach(function (row) { assert.equal(row.ok, true, row.key); });
	assert.deepEqual(complianceWarnings(comp), []);
});

test("compliance: deviations inside the tolerances stay green", function () {
	var comp = computeCompliance(planParams(3420),
		delivered([3420 + VINF_TOL * 0.5, 0, 0], JD + EPOCH_TOL_DAYS * 0.5));
	// the epoch shift also shifts Earth's velocity a little; only assert the
	// explicitly-dialled rows
	var byKey = {};
	comp.rows.forEach(function (r) { byKey[r.key] = r; });
	assert.equal(byKey.vinf.ok, true);
	assert.equal(byKey.epoch.ok, true);
});

test("compliance: an under-delivering tech warns 'short by', with the numbers", function () {
	var comp = computeCompliance(planParams(3420), delivered([3180, 0, 0], JD));
	var byKey = {};
	comp.rows.forEach(function (r) { byKey[r.key] = r; });
	assert.equal(byKey.vinf.ok, false);
	assert.ok(Math.abs(byKey.vinf.delta - (-240)) < 1e-6);
	assert.equal(byKey.epoch.ok, true);
	assert.equal(byKey.aim.ok, true);

	var warnings = complianceWarnings(comp);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].code, "vinf-mismatch");
	assert.match(warnings[0].message, /short by 0\.24 km\/s/);
	assert.ok(Math.abs(warnings[0].values.required - 3420) < 1e-6);
	assert.ok(Math.abs(warnings[0].values.delivered - 3180) < 1e-6);
	assert.match(warnings[0].fix, /Raise .*0\.24 km\/s/);
});

test("compliance: a late hand-off warns on epoch only (v∞ re-measured at its own epoch)", function () {
	var comp = computeCompliance(planParams(3420), delivered([3420, 0, 0], JD + 0.5));
	var warnings = complianceWarnings(comp);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].code, "epoch-mismatch");
	assert.match(warnings[0].message, /late/);
	assert.ok(Math.abs(warnings[0].values.deltaDays - 0.5) < 1e-9);
});

test("compliance: an off-aim asymptote of the same speed warns on aim only", function () {
	var a = 5 * Math.PI / 180;
	var comp = computeCompliance(planParams(3420),
		delivered([3420 * Math.cos(a), 3420 * Math.sin(a), 0], JD));
	var warnings = complianceWarnings(comp);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].code, "aim-mismatch");
	assert.ok(Math.abs(warnings[0].values.angleDeg - 5) < 0.01);
	assert.ok(AIM_TOL_DEG < 5);
});

test("compliance: a required v∞ of ~0 has no aim to compare — row stays finite and ok", function () {
	// Legitimate since E2's freeze contract: a waypoint-only plan (no
	// departure burn) freezes to a hand-off co-moving with the origin, so
	// the required v∞ vector is ~0 and has no direction. The aim row must
	// not go NaN; the v∞ magnitude row still reports the mismatch.
	var comp = computeCompliance(planParams(0), delivered([3420, 0, 0], JD));
	var byKey = {};
	comp.rows.forEach(function (r) { byKey[r.key] = r; });
	assert.ok(isFinite(byKey.aim.delivered), "aim must be finite, got " + byKey.aim.delivered);
	assert.equal(byKey.aim.ok, true);
	assert.equal(byKey.vinf.ok, false);   // the over-delivery still warns, just on magnitude
});

test("compliance: no tech at all → delivered null, no rows", function () {
	var comp = computeCompliance(planParams(3420), null);
	assert.equal(comp.ok, true);
	assert.equal(comp.delivered, null);
	assert.deepEqual(comp.rows, []);
	var warnings = complianceWarnings(comp);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].code, "no-departure-tech");
	assert.match(warnings[0].fix, /3\.42 km\/s/);
});

test("compliance: a plan without a departure state is a hard bad-params", function () {
	var comp = computeCompliance({ origin: "Earth" }, null);
	assert.equal(comp.ok, false);
	assert.equal(comp.diagnostic.code, "bad-params");
	assert.match(comp.diagnostic.message, /no departure state/);
});

test("compliance: unknown origin / arrival bodies and inverted epochs are bad-params", function () {
	var p = planParams(3420);
	assert.equal(computeCompliance(Object.assign({}, p, { origin: "Krypton" }), null).diagnostic.code, "bad-params");
	assert.equal(computeCompliance(Object.assign({}, p,
		{ arrival: { body: "Krypton", jd: JD + 1, vInf: 0 } }), null).diagnostic.code, "bad-params");
	assert.equal(computeCompliance(Object.assign({}, p,
		{ arrival: { body: "Ceres", jd: JD - 1, vInf: 0 } }), null).diagnostic.code, "bad-params");
});

test("planDv sums the departure and waypoint burns", function () {
	var dv = planDv({
		burn: { pro: 1070, rad: 490, nrm: 280 },
		waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }]
	});
	assert.ok(Math.abs(dv - (Math.hypot(1070, 490, 280) + Math.hypot(2140, 1180, 2730))) < 1e-9);
	assert.ok(dv > 4800 && dv < 4950, "the worked example's ~4.87 km/s, got " + dv);
});

// ---- the comply rule through the real engine --------------------------------

// The shipped preset IS the comply-mode chain; deviations are dialled on the
// skyhook and observed on the plan stage, while the leg's output must not
// move (the plan's frozen state feeds it, not the tech's).
function presetChain() {
	var res = deserializeWorld(defaultMission);
	assert.equal(res.ok, true, res.reason);
	var engine = createEngine(res.world, makeRegistry());
	var stages = res.world.stages();
	return { world: res.world, engine: engine,
	         sky: stages[0].id, plan: stages[1].id, leg: stages[2].id };
}

test("comply: the shipped preset complies with its own frozen plan", function () {
	var c = presetChain();
	var rPlan = c.engine.resultFor(c.plan);
	assert.equal(rPlan.status, "ok");
	assert.deepEqual(rPlan.warnings, []);
	assert.equal(rPlan.output.data.jd, JD);
	// plan endpoints on the events channel (the coast slider's future span)
	assert.equal(rPlan.events.length, 2);
	assert.match(rPlan.events[0].label, /Plan departure/);
	assert.match(rPlan.events[1].label, /Plan arrival — Ceres/);
	assert.equal(rPlan.events[1].jd, JD + 750);
});

test("comply: detuning the tech warns on the plan but does NOT move the coast", function () {
	var c = presetChain();
	var legBefore = c.engine.resultFor(c.leg).output.data;

	c.world.set({ stage: c.sky, params: { relAlt: 5000e3 } });   // weaker release
	var rSky = c.engine.resultFor(c.sky);
	var rPlan = c.engine.resultFor(c.plan);
	var rLeg = c.engine.resultFor(c.leg);

	assert.equal(rSky.status, "ok");                 // the tech itself still computes
	assert.equal(rPlan.status, "ok");                // comply mode: warned, not failed
	assert.ok(rPlan.warnings.length >= 1);
	var codes = rPlan.warnings.map(function (w) { return w.code; });
	assert.ok(codes.indexOf("vinf-mismatch") !== -1, "expected vinf-mismatch, got " + codes);

	assert.equal(rLeg.status, "ok");                 // downstream unblocked...
	assert.deepEqual(rLeg.output.data.r, legBefore.r);   // ...and UNCHANGED: the
	assert.deepEqual(rLeg.output.data.v, legBefore.v);   // frozen plan feeds it
	assert.deepEqual(rLeg.warnings, []);             // still rendezvouses
});

test("comply: a mission with NO departure tech still shows its whole plan", function () {
	var c = presetChain();
	c.world.set({ removeStage: c.sky });             // E2's "empty tech slot"
	var rPlan = c.engine.resultFor(c.plan);
	var rLeg = c.engine.resultFor(c.leg);

	assert.equal(rPlan.status, "ok");
	assert.equal(rPlan.warnings.length, 1);
	assert.equal(rPlan.warnings[0].code, "no-departure-tech");
	assert.equal(rLeg.status, "ok");                 // the coast still draws
	assert.deepEqual(rLeg.warnings, []);             // and still arrives
});

test("comply: fixing the tech clears the warnings on the same recompute rules", function () {
	var c = presetChain();
	c.world.set({ stage: c.sky, params: { relAlt: 5000e3 } });
	assert.ok(c.engine.resultFor(c.plan).warnings.length >= 1);
	c.world.set({ stage: c.sky, params: { relAlt: 6000e3 } });
	assert.deepEqual(c.engine.resultFor(c.plan).warnings, []);
});

test("update: dvUsed passes through from the tech; zero when there is none", function () {
	var withTech = frozenPlan.update(
		{ world: null, jd: JD, stageId: "stg-t", params: planParams(3420) },
		{ kind: "moonwards-packet", type: "ship-state", version: 1, source: {},
		  data: Object.assign(delivered([3420, 0, 0], JD), { dvUsed: 123 }) });
	assert.equal(withTech.packet.data.dvUsed, 123);

	var without = frozenPlan.update(
		{ world: null, jd: JD, stageId: "stg-t", params: planParams(3420) }, null);
	assert.equal(without.packet.data.dvUsed, 0);
});

test("update: a damaged plan fails hard (diagnostic), not as a warning", function () {
	var out = frozenPlan.update(
		{ world: null, jd: JD, stageId: "stg-t", params: { origin: "Earth" } }, null);
	assert.equal(out.kind, "moonwards-diagnostic");
	assert.equal(out.code, "bad-params");
});

test("the baked preset plan matches the skyhook's own release physics", function () {
	// Guards the preset's frozen numbers against drift in computeRelease: if
	// the release model changes, this test says "re-bake the plan", not just
	// "warnings appeared somewhere".
	var phys = computeRelease(skyhookDefaults);
	var planStage = defaultMission.stages[1];
	assert.equal(planStage.moduleId, "frozen-plan");
	var dep = planStage.params.departure;
	assert.ok(O.vMag(O.vSub(phys.r, dep.r)) < 1, "baked r matches computeRelease");
	assert.ok(O.vMag(O.vSub(phys.v, dep.v)) < 1e-3, "baked v matches computeRelease");
	assert.equal(dep.jd, phys.releaseJd);
});
