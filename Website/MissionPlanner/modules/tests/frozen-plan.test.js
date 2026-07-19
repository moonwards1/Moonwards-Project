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
import moonPlatform from "../moon-platform/moon-platform.js";
import skyhook from "../lunar-skyhook/lunar-skyhook.js";
import departureLeg from "../departure-leg/departure-leg.js";
import transferLeg from "../transfer-leg/transfer-leg.js";
import captureBurn from "../capture-burn/capture-burn.js";
import arrivalLeg from "../arrival-leg/arrival-leg.js";
import frozenPlan, { computeCompliance, complianceWarnings, planSummary,
	releaseAnchorFor, windowDaysOf,
	VINF_TOL, AIM_TOL_DEG, DEFAULT_WINDOW_DAYS } from "../frozen-plan/frozen-plan.js";
import { defaultMission } from "../../presets/default-mission.js";
import { estimateDeparture } from "../../core/departure-estimate.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";

var JD = O.julianDate(2031, 12, 20, 6, 0, 0);   // the worked example's hand-off epoch

function makeRegistry() {
	var reg = createRegistry();
	reg.register(moonPlatform);
	reg.register(skyhook);
	reg.register(departureLeg);
	reg.register(frozenPlan);
	reg.register(transferLeg);
	reg.register(arrivalLeg);    // the preset's arrival flyby leg (task H3)
	reg.register(captureBurn);   // the preset's terminal arrival stage (task H2)
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
		delivered([3420 + VINF_TOL * 0.5, 0, 0], JD + DEFAULT_WINDOW_DAYS * 0.5));
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

test("compliance: the epoch row is the plan's hand-off WINDOW, not a point (task I3)", function () {
	// Inside the default ±1 d window: no epoch warning at all.
	var inside = computeCompliance(planParams(3420), delivered([3420, 0, 0], JD + 0.5));
	assert.equal(complianceWarnings(inside).filter(function (w) { return w.code === "epoch-mismatch"; }).length, 0);

	// Outside it: warned, and the warning names the window.
	var comp = computeCompliance(planParams(3420), delivered([3420, 0, 0], JD + 1.5));
	var warnings = complianceWarnings(comp);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].code, "epoch-mismatch");
	assert.match(warnings[0].message, /late/);
	assert.match(warnings[0].message, /window/);
	assert.ok(Math.abs(warnings[0].values.deltaDays - 1.5) < 1e-9);
	assert.equal(warnings[0].values.windowDays, DEFAULT_WINDOW_DAYS);

	// A plan's own wider window is honoured (the baked field, not a constant).
	var wide = computeCompliance(Object.assign({}, planParams(3420), { handoffWindowDays: 2 }),
		delivered([3420, 0, 0], JD + 1.5));
	assert.equal(complianceWarnings(wide).length, 0);
	assert.equal(windowDaysOf({ handoffWindowDays: 2 }), 2);
	assert.equal(windowDaysOf({}), DEFAULT_WINDOW_DAYS);
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

test("planSummary: v∞ in/out, epoch, flight time, and Kim's plan Δv formula", function () {
	// Kim (2026-07-13): plan Δv = v∞ in (leaving the origin's SOI) + v∞ out
	// (reaching the destination's) + the waypoint burns. The frozen leg burn
	// no longer exists (E2's post-burn hand-off), so it's not a term.
	var p = planParams(3420);
	p.waypoints = [{ days: 100, burn: { pro: 300, rad: 0, nrm: -400 } }];   // 500 m/s
	var s = planSummary(p);
	assert.ok(Math.abs(s.vInfIn - 3420) < 1e-6, "v∞ in should be 3420, got " + s.vInfIn);
	assert.equal(s.vInfOut, 3776);
	assert.equal(s.epochJd, JD);
	assert.equal(s.arrivalJd, JD + 750);
	assert.equal(s.flightDays, 750);
	assert.ok(Math.abs(s.waypointDv - 500) < 1e-9);
	assert.ok(Math.abs(s.dv - (s.vInfIn + 3776 + 500)) < 1e-9);
});

test("planSummary: a damaged plan degrades to nulls, not a throw", function () {
	var s = planSummary({ origin: "Earth" });   // no departure state, no arrival
	assert.equal(s.vInfIn, null);
	assert.equal(s.vInfOut, null);
	assert.equal(s.epochJd, null);
	assert.equal(s.arrivalJd, null);
	assert.equal(s.flightDays, null);
	assert.equal(s.dv, 0);
});

// ---- the comply rule through the real engine --------------------------------

// The shipped preset IS the comply-mode chain; deviations are dialled on the
// skyhook and observed on the plan stage, while the leg's output must not
// move (the plan's frozen state feeds it, not the tech's).
function presetChain() {
	var res = deserializeWorld(defaultMission);
	assert.equal(res.ok, true, res.reason);
	var engine = createEngine(res.world, makeRegistry());
	var stages = res.world.stages();   // moon-platform, lunar-skyhook, departure-leg,
	                                   // frozen-plan, transfer-leg (task I3's chain)
	return { world: res.world, engine: engine,
	         moon: stages[0].id, sky: stages[1].id, dep: stages[2].id,
	         plan: stages[3].id, leg: stages[4].id };
}

test("comply: the shipped preset's skyhook alone falls short of the full departure requirement", function () {
	// Since the 2026-07-14 migration folded the preset's old separate
	// leg-side burn into departure.v (presets/default-mission.js's header),
	// the skyhook's own unchanged release physics no longer covers the
	// whole committed departure by itself — an honest, expected gap (Kim:
	// show the real warning rather than retune the skyhook to paper over
	// it — no departure-phase tech models that extra burn yet). The plan
	// itself still reports its own facts regardless of the tech's shortfall.
	var c = presetChain();
	var rPlan = c.engine.resultFor(c.plan);
	assert.equal(rPlan.status, "ok");
	assert.deepEqual(rPlan.warnings.map(function (w) { return w.code; }).sort(),
		["aim-mismatch", "vinf-mismatch"]);
	assert.equal(rPlan.output.data.jd, JD);
	// plan endpoints on the events channel (the coast slider's future span)
	assert.equal(rPlan.events.length, 2);
	assert.match(rPlan.events[0].label, /Plan departure/);
	assert.match(rPlan.events[1].label, /Plan arrival — Ceres/);
	assert.equal(rPlan.events[1].jd, JD + 750);

	// The coast still flies the FROZEN plan's state, not the tech's
	// shortfall — so it still rendezvouses clean, the comply rule's whole point.
	var rLeg = c.engine.resultFor(c.leg);
	assert.equal(rLeg.status, "ok");
	assert.deepEqual(rLeg.warnings, []);
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

test("comply: a mission with NO departure system still shows its whole plan", function () {
	// E2's "empty tech slot" is the whole departure STACK absent (a freeze-
	// spawned mission is [frozen-plan, transfer-leg] until WP-I's I5 adds
	// carriers), so drop all three departure stages, not just the skyhook.
	var c = presetChain();
	c.world.set({ removeStage: c.dep });
	c.world.set({ removeStage: c.sky });
	c.world.set({ removeStage: c.moon });
	var rPlan = c.engine.resultFor(c.plan);
	var rLeg = c.engine.resultFor(c.leg);

	assert.equal(rPlan.status, "ok");
	assert.equal(rPlan.warnings.length, 1);
	assert.equal(rPlan.warnings[0].code, "no-departure-tech");
	assert.equal(rLeg.status, "ok");                 // the coast still draws
	assert.deepEqual(rLeg.warnings, []);             // and still arrives
});

test("comply: reverting the tech to its shipped params reproduces the same (still-short) warnings", function () {
	// "Fixing" no longer means "clears every warning" (the shipped skyhook
	// alone was never sufficient post-migration, see the test above) — this
	// tests the recompute is deterministic and reversible: a detune changes
	// the shortfall, and undoing it lands back on the exact baseline, not a
	// fresh solve.
	var c = presetChain();
	var baseline = c.engine.resultFor(c.plan).warnings;
	assert.ok(baseline.length >= 1);

	c.world.set({ stage: c.sky, params: { relAlt: 5000e3 } });   // detune further
	assert.notDeepEqual(c.engine.resultFor(c.plan).warnings, baseline);

	c.world.set({ stage: c.sky, params: { relAlt: 6000e3 } });   // back to the shipped default
	assert.deepEqual(c.engine.resultFor(c.plan).warnings, baseline);
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

test("the baked preset plan is internally consistent: v∞, anchor, window", function () {
	// Guards the preset's frozen numbers. The committed departure state is
	// historical data now (baked 2026-07-14 from the then-current release
	// model plus the folded injection — the preset header tells the story;
	// the old computeRelease that produced it is gone since I3), so what's
	// checkable is its own consistency: the required v∞ it encodes, and that
	// the timing fields were baked exactly the way core/freeze.js bakes them
	// (anchor = hand-off − the D7 departure estimate for that same v∞).
	var planStage = defaultMission.stages[3];
	assert.equal(planStage.moduleId, "frozen-plan");
	var p = planStage.params;
	var vInfVec = O.vSub(p.departure.v, Frames.bodyHelioState("Earth", p.departure.jd).v);
	assert.ok(Math.abs(O.vMag(vInfVec) - 6548.4) < 1, "required v∞ ~6.55 km/s, got " + O.vMag(vInfVec));

	assert.equal(p.handoffWindowDays, 1);
	var est = estimateDeparture({ origin: "Earth", vInfVec: vInfVec, jdHandoff: p.departure.jd });
	assert.equal(est.ok, true);
	assert.ok(Math.abs(p.releaseAnchorJd - (p.departure.jd - est.days)) < 1e-6,
		"anchor = hand-off − the freeze-time estimate (" + est.profile + ", " +
		est.days.toFixed(4) + " d)");
});

// ---- releaseAnchorFor (the read-only anchor's one lookup, task I3) ----------

test("releaseAnchorFor: plan anchor → plan departure.jd → legacy releaseJd → null", function () {
	function worldWith(stages) {
		var w = createWorld({ jd: JD });
		stages.forEach(function (s) { w.set({ addStage: s }); });
		return w;
	}
	// 1. a post-D7 plan: its baked anchor wins
	var w1 = worldWith([{ moduleId: "frozen-plan",
		params: { departure: { jd: JD }, releaseAnchorJd: JD - 2.2 } }]);
	assert.equal(releaseAnchorFor(w1), JD - 2.2);
	// 2. a pre-D7 plan: no anchor recorded — the hand-off epoch stands in
	var w2 = worldWith([{ moduleId: "frozen-plan", params: { departure: { jd: JD } } }]);
	assert.equal(releaseAnchorFor(w2), JD);
	// 3. no plan at all: a legacy releaseJd on any stage (pre-I3 saves kept
	// it on the skyhook) still anchors the chain
	var w3 = worldWith([{ moduleId: "lunar-skyhook", params: { releaseJd: JD - 1 } }]);
	assert.equal(releaseAnchorFor(w3), JD - 1);
	// 3b. the plan outranks a legacy releaseJd when both exist
	var w4 = worldWith([
		{ moduleId: "lunar-skyhook", params: { releaseJd: JD - 1 } },
		{ moduleId: "frozen-plan", params: { departure: { jd: JD }, releaseAnchorJd: JD - 2.2 } }]);
	assert.equal(releaseAnchorFor(w4), JD - 2.2);
	// 4. nothing anywhere → null (and a null/bare world is null too)
	assert.equal(releaseAnchorFor(worldWith([{ moduleId: "transfer-leg", params: {} }])), null);
	assert.equal(releaseAnchorFor(null), null);
});
