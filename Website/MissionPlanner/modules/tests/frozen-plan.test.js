// Node tests for the frozen-plan module — the comply-mode
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
import skyhook from "../skyhook/skyhook-departure.js";
import departureLeg from "../departure-leg/departure-leg.js";
import transferLeg from "../transfer-leg/transfer-leg.js";
import arrivalLeg from "../arrival-leg/arrival-leg.js";
import frozenPlan, { computeCompliance, complianceWarnings, planSummary,
	windowDaysOf,
	VINF_TOL, AIM_TOL_DEG, DEFAULT_WINDOW_DAYS } from "../frozen-plan/frozen-plan.js";
import { releaseEpochFor } from "../../core/release-epoch.js";
import { defaultMission } from "../../presets/default-mission.js";
import { estimateDeparture, originSoiRadius } from "../../core/departure-estimate.js";
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
	reg.register(arrivalLeg);    // the preset's terminal stage — the arrival
	                             // flyby leg; arrival tech is empty by default
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
		arrival: { body: "Ceres", vInf: 3776 },
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

test("compliance: the epoch row is the plan's hand-off WINDOW, not a point", function () {
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

test("compliance: unknown origin / arrival bodies are bad-params", function () {
	var p = planParams(3420);
	assert.equal(computeCompliance(Object.assign({}, p, { origin: "Krypton" }), null).diagnostic.code, "bad-params");
	assert.equal(computeCompliance(Object.assign({}, p,
		{ arrival: { body: "Krypton", vInf: 0 } }), null).diagnostic.code, "bad-params");
	// There is no arrival EPOCH to be inverted against the departure: the
	// mission arrives at its measured closest approach, so the plan has no
	// date here to validate.
	assert.equal(computeCompliance(Object.assign({}, p,
		{ arrival: { body: "Ceres", vInf: 0 } }), null).ok, true);
});

test("planSummary: v∞ in/out, epoch, and the plan Δv formula", function () {
	// plan Δv = v∞ in (leaving the origin's SOI) + v∞ out (reaching the
	// destination's) + the waypoint burns. A frozen leg carries no burn of its
	// own — the hand-off is post-burn — so there is no leg-burn term.
	var p = planParams(3420);
	p.waypoints = [{ days: 100, burn: { pro: 300, rad: 0, nrm: -400 } }];   // 500 m/s
	var s = planSummary(p);
	assert.ok(Math.abs(s.vInfIn - 3420) < 1e-6, "v∞ in should be 3420, got " + s.vInfIn);
	assert.equal(s.vInfOut, 3776);
	assert.equal(s.epochJd, JD);
	// no arrivalJd/flightDays: both are properties of the flown coast, not of
	// the plan, so a pure function of the params cannot state them
	assert.equal(s.arrivalJd, undefined);
	assert.equal(s.flightDays, undefined);
	assert.ok(Math.abs(s.waypointDv - 500) < 1e-9);
	assert.ok(Math.abs(s.dv - (s.vInfIn + 3776 + 500)) < 1e-9);
});

test("planSummary: a damaged plan degrades to nulls, not a throw", function () {
	var s = planSummary({ origin: "Earth" });   // no departure state, no arrival
	assert.equal(s.vInfIn, null);
	assert.equal(s.vInfOut, null);
	assert.equal(s.epochJd, null);
	assert.equal(s.arrivalJd, undefined);
	assert.equal(s.flightDays, undefined);
	assert.equal(s.dv, 0);
});

// ---- the comply rule through the real engine --------------------------------

// The shipped preset IS the comply-mode chain; deviations are dialled on the
// skyhook and observed on the plan stage, and on the coast, which flies from
// what the skyhook really delivers.
function presetChain() {
	var res = deserializeWorld(defaultMission);
	assert.equal(res.ok, true, res.reason);
	var engine = createEngine(res.world, makeRegistry());
	var stages = res.world.stages();   // moon-platform, orbital-skyhook, departure-leg,
	                                   // frozen-plan, transfer-leg
	return { world: res.world, engine: engine,
	         moon: stages[0].id, sky: stages[1].id, dep: stages[2].id,
	         plan: stages[3].id, leg: stages[4].id };
}

test("comply: the shipped preset's skyhook alone falls short of the full departure requirement", function () {
	// The preset's departure.v folds the injection into the committed hand-off
	// state (presets/default-mission.js's header), so the skyhook's own release
	// physics does not cover the whole committed departure by itself. That gap
	// is deliberate and shipped: the mission shows the real warning rather than
	// having the skyhook retuned to paper over it. The plan still reports its
	// own facts regardless of the tech's shortfall.
	var c = presetChain();
	var rPlan = c.engine.resultFor(c.plan);
	assert.equal(rPlan.status, "ok");
	assert.deepEqual(rPlan.warnings.map(function (w) { return w.code; }).sort(),
		["aim-mismatch", "vinf-mismatch"]);
	// ONE CLOCK: the emitted hand-off is the epoch the DEPARTURE LEG really
	// delivers, not the plan's committed one, so the Coast timeline starts
	// where the Departure timeline ends. The plan's own epoch is what the
	// compliance rows grade against, and it is NOT this.
	var presetPlan = defaultMission.stages[3].params;
	var delivered = c.engine.resultFor(c.dep).output.data;
	assert.equal(rPlan.output.data.jd, delivered.jd);
	assert.deepEqual(rPlan.output.data.r, delivered.r);
	assert.notEqual(rPlan.output.data.jd, presetPlan.departure.jd);

	// ONE event on the channel: the real hand-off. The coast's other end is not
	// the plan's to state — the mission arrives at the closest approach
	// transfer-leg measures, and emits.
	assert.equal(rPlan.events.length, 1);
	assert.match(rPlan.events[0].label, /Exit origin SOI/);
	assert.equal(rPlan.events[0].jd, delivered.jd);
	assert.equal(presetPlan.arrival.jd, undefined,
		"the shipped plan commits to a destination and a catch speed, not a date");

	// The coast flies that delivered hand-off, so the shipped shortfall is
	// visible as a real miss rather than hidden behind a clean drawn arc —
	// the whole point of making the flown flight the clock.
	var rLeg = c.engine.resultFor(c.leg);
	assert.equal(rLeg.status, "ok");
	assert.ok(rLeg.warnings.length >= 1,
		"the shortfall should show as a miss on the coast, not a clean arrival");
});

test("comply: detuning the tech warns on the plan AND moves the coast with it", function () {
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

	// THE FLOWN FLIGHT IS THE CLOCK: a weaker release is a different flight, so
	// the coast the user sees is a different coast. Under the old comply rule
	// this arc was pinned to the plan and stayed put while the warning
	// accumulated beside it.
	assert.equal(rLeg.status, "ok");                 // downstream unblocked...
	assert.notDeepEqual(rLeg.output.data.r, legBefore.r);
	assert.notDeepEqual(rLeg.output.data.v, legBefore.v);
	// ...and the coast's own start is the delivered hand-off, one epoch shared
	// with the departure leg that produced it
	assert.equal(rPlan.output.data.jd, c.engine.resultFor(c.dep).output.data.jd);
});

test("boundary fallback: with nothing delivered the coast flies the PLAN's own state", function () {
	// The other half of the one-clock rule. A mission whose departure stack is
	// absent has no delivered epoch to start from, so the plan's frozen state
	// is what the coast flies — which is also every freshly frozen mission,
	// before a technology is chosen.
	var c = presetChain();
	c.world.set({ removeStage: c.dep });
	c.world.set({ removeStage: c.sky });
	c.world.set({ removeStage: c.moon });

	var presetPlan = defaultMission.stages[3].params;
	var rPlan = c.engine.resultFor(c.plan);
	assert.equal(rPlan.status, "ok");
	assert.equal(rPlan.output.data.jd, presetPlan.departure.jd);
	assert.deepEqual(rPlan.output.data.r, presetPlan.departure.r);
	assert.deepEqual(rPlan.output.data.v, presetPlan.departure.v);
	assert.equal(rPlan.events[0].jd, presetPlan.departure.jd);
	// and it still arrives clean, because that is the plan it was frozen from
	assert.deepEqual(c.engine.resultFor(c.leg).warnings, []);
});

test("comply: a mission with NO departure system still shows its whole plan", function () {
	// E2's "empty tech slot" is the whole departure STACK absent (a freeze-
	// spawned mission is [frozen-plan, transfer-leg] until the shell adds
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

// ---- the boundary rule: a present-but-FAILING departure (not
// just an absent one) must still leave the committed plan and coast flying.
// Before frozen-plan became a `boundary` stage, a departure diagnostic blocked
// the plan and blanked the whole coast — breaking the comply rule's promise
// that the frozen plan is always shown.

test("boundary: a bound-at-moon skyhook does NOT blank the plan or coast", function () {
	var c = presetChain();
	c.world.set({ stage: c.sky, params: { relAlt: 100e3 } });   // tip below escape → bound-at-moon
	var rSky = c.engine.resultFor(c.sky);
	var rDep = c.engine.resultFor(c.dep);
	var rPlan = c.engine.resultFor(c.plan);
	var rLeg = c.engine.resultFor(c.leg);

	assert.equal(rSky.status, "diagnostic");          // the tech shows its own failure...
	assert.equal(rSky.diagnostic.code, "bound-at-body");
	assert.equal(rDep.status, "blocked");             // ...its leg is blocked on it...
	assert.equal(rDep.blockedOn, c.sky);
	assert.equal(rPlan.status, "ok");                 // ...but the boundary is NOT blocked
	assert.equal(rPlan.warnings.length, 1);
	assert.equal(rPlan.warnings[0].code, "no-departure-tech");
	assert.equal(rLeg.status, "ok");                  // the committed coast still flies
	assert.deepEqual(rLeg.warnings, []);
});

test("boundary: removing the last carrier (no-carrier) still leaves the coast flying", function () {
	var c = presetChain();
	c.world.set({ removeStage: c.sky });              // moon-platform → departure-leg, no rotor
	var rDep = c.engine.resultFor(c.dep);
	var rPlan = c.engine.resultFor(c.plan);
	var rLeg = c.engine.resultFor(c.leg);

	assert.equal(rDep.status, "diagnostic");
	assert.equal(rDep.diagnostic.code, "no-carrier");
	assert.equal(rPlan.status, "ok");
	assert.equal(rPlan.warnings[0].code, "no-departure-tech");
	assert.equal(rLeg.status, "ok");                  // still draws and arrives
	assert.deepEqual(rLeg.warnings, []);
});

test("comply: reverting the tech to its shipped params reproduces the same (still-short) warnings", function () {
	// "Fixing" does not mean "clears every warning" here — the shipped skyhook
	// alone never covers the whole committed departure (see the test above).
	// What this checks is that recompute is deterministic and reversible: a
	// detune changes the shortfall, and undoing it lands back on the exact
	// baseline rather than a fresh solve.
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
	// Guards the preset's frozen numbers. The committed departure state is baked
	// data, not something any live code re-derives, so what is checkable is its
	// own internal consistency: the required v∞ it encodes, that the hand-off
	// really sits on Earth's SOI edge (where a departure leg delivers, and where
	// core/freeze.js commits), and that the timing fields were baked exactly the
	// way core/freeze.js bakes them — anchor = hand-off − the departure flight
	// core/lunar-departure.js solves for that same v∞.
	var planStage = defaultMission.stages[3];
	assert.equal(planStage.moduleId, "frozen-plan");
	var p = planStage.params;
	var earthAt = Frames.bodyHelioState("Earth", p.departure.jd);
	var vInfVec = O.vSub(p.departure.v, earthAt.v);
	assert.ok(Math.abs(O.vMag(vInfVec) - 6545.7) < 1, "required v∞ ~6.55 km/s, got " + O.vMag(vInfVec));

	var sep = O.vMag(O.vSub(p.departure.r, earthAt.r));
	assert.ok(Math.abs(sep / originSoiRadius("Earth") - 1) < 1e-6,
		"hand-off sits on Earth's SOI edge, got " + (sep / 1000).toFixed(0) + " km");
	// the plan carries no release epoch of its own — that is the departure
	// leg's, and it leads the hand-off by the freeze-time estimate
	assert.equal("releaseAnchorJd" in p, false);
	assert.equal("injectionJd" in p, false);

	assert.equal(p.handoffWindowDays, 1);
	// Origin Moon: the seed is a solved lunar departure, not a naive estimate.
	var est = estimateDeparture({ origin: p.origin, vInfVec: vInfVec, jdHandoff: p.departure.jd });
	assert.equal(est.ok, true);
	var legParams = defaultMission.stages
		.filter(function (s) { return s.moduleId === "departure-leg"; })[0].params;
	assert.ok(Math.abs(legParams.releaseJd - (p.departure.jd - est.days)) < 1e-6,
		"release = hand-off − the freeze-time estimate (" + est.profile + ", " +
		est.days.toFixed(4) + " d)");
});

// ---- releaseEpochFor: the departure phase's own epoch, one lookup ----------

test("releaseEpochFor: the departure leg's releaseJd → null", function () {
	function worldWith(stages) {
		var w = createWorld({ jd: JD });
		stages.forEach(function (s) { w.set({ addStage: s }); });
		return w;
	}
	// 1. the geocentric leg carries it
	var w1 = worldWith([{ moduleId: "departure-leg", params: { releaseJd: JD - 2.2 } }]);
	assert.equal(releaseEpochFor(w1), JD - 2.2);
	// 2. so does the generic one
	var w2 = worldWith([{ moduleId: "body-departure-leg", params: { releaseJd: JD - 1.1 } }]);
	assert.equal(releaseEpochFor(w2), JD - 1.1);
	// 3. a leg with no epoch recorded, no leg at all, and a null world → null.
	//    The plan is NOT consulted: it never owned this.
	assert.equal(releaseEpochFor(worldWith([{ moduleId: "departure-leg", params: {} }])), null);
	assert.equal(releaseEpochFor(worldWith([{ moduleId: "frozen-plan",
		params: { departure: { jd: JD } } }])), null);
	assert.equal(releaseEpochFor(null), null);
});
