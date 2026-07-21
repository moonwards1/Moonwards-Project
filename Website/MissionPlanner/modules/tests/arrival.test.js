// Node tests for the arrival phase (tasks H2/H3): the arrival flyby leg
// (arrival-leg), the arrival-skyhook catch (WP-J's generic tether run in
// reverse), the arrival-tech catalog, and the frozen plan's arrival-commitment
// lookup. The chemical capture-burn was retired 2026-07-20 (arrival is empty by
// default now); its own tests go with its redo. The shared arrival-approach
// helpers (approachAt / interceptWarning) are tested in arrival-approach.test.js.
// Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/arrival.test.js
// The view hooks (init/draw) are browser-only and not exercised here.

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld, deserializeWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import { freezeMissionWorld } from "../../core/freeze.js";
import frozenPlan, { arrivalCommitmentFor } from "../frozen-plan/frozen-plan.js";
import transferLeg from "../transfer-leg/transfer-leg.js";
import arrivalSkyhook, { computeCatch } from "../arrival-skyhook/arrival-skyhook.js";
import arrivalLeg, { computeArrivalLeg, referencePeriapsis,
	LEAD_S, TAIL_S, PERI_SOI_FRACTION } from "../arrival-leg/arrival-leg.js";
import { bodySOI } from "../../../Shared/body-leg.js";
import { tetherGeometry, tetherKinematics, resolveParams as resolveSkyhookParams,
	bodyPhysics } from "../orbital-skyhook/orbital-skyhook.js";
import { arrivalTechOptionsFor, ARRIVAL_TECH_OPTIONS } from "../../ui/tech-options.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";
import { systems } from "../../../Shared/orbit.js";

var GM_SUN = systems.get("Sun").GM;
var JD = O.julianDate(2034, 1, 8, 0, 0, 0);

// A helio ship-state payload arriving AT `body` with exactly `vInf` m/s of
// hyperbolic excess along +x (miss 0 unless offset by `missM` metres).
function arrivingAt(body, vInf, missM) {
	var bs = Frames.bodyHelioState(body, JD);
	var r = bs.r.slice();
	if (missM) { r[0] += missM; }
	return { r: r, v: O.vAdd(bs.v, [vInf, 0, 0]), jd: JD, frame: "helio", dvUsed: 0 };
}

// ---- arrival-skyhook: the catch ---------------------------------------------

test("computeCatch: trim Δv is the gap between hyperbolic periapsis speed and tip speed", function () {
	var vInf = 3776;
	var cat = computeCatch({ body: "Mars" }, arrivingAt("Mars", vInf, 0));
	assert.equal(cat.ok, true, cat.ok ? "" : cat.diagnostic.message);
	// Mars defaults seed the CoM at Phobos's orbit radius
	var geo = tetherGeometry(resolveSkyhookParams({ body: "Mars" }));
	assert.ok(Math.abs(cat.geo.rCom - geo.rCom) < 1e-6);
	var vCatch = Math.sqrt(vInf * vInf + 2 * geo.GM / geo.rRel);
	assert.ok(Math.abs(cat.vCatch - vCatch) < 1e-9);
	assert.ok(Math.abs(cat.trimDv - (vCatch - geo.vRel)) < 1e-9);
	assert.deepEqual(cat.warnings, []);
});

test("computeCatch: a sub-escape tip is a legitimate catch (only a RELEASE demands escape)", function () {
	// Tip barely above the CoM: far below escape speed — the departure module
	// refuses this geometry, the catch accepts it.
	var phys = bodyPhysics("Mars");
	var comAlt = 9376e3 - phys.R;
	var params = { body: "Mars", comAlt: comAlt, topAlt: comAlt + 100e3, relAlt: comAlt + 100e3 };
	assert.equal(tetherKinematics(params).ok, false);
	assert.equal(tetherKinematics(params).diagnostic.code, "bound-at-body");
	var cat = computeCatch(params, arrivingAt("Mars", 2500, 0));
	assert.equal(cat.ok, true, cat.ok ? "" : cat.diagnostic.message);
	assert.equal(cat.geo.vInfBody, 0);          // bound tip
	assert.ok(cat.trimDv > 0);                  // the ship burns off the rest
});

test("computeCatch: no body / bad geometry diagnose like the departure skyhook", function () {
	var data = arrivingAt("Mars", 2500, 0);
	assert.equal(computeCatch({}, data).diagnostic.code, "no-body");
	var bad = computeCatch({ body: "Mars", comAlt: 9000e3, topAlt: 8000e3, relAlt: 8000e3 }, data);
	assert.equal(bad.ok, false);
	assert.equal(bad.diagnostic.code, "bad-params");
});

// ---- arrival-leg: the constructed flyby hand-off (task H3) ------------------

test("referencePeriapsis: periapsis at the requested radius, incoming asymptote along the delivered heading", function () {
	var GM = bodyPhysics("Ceres").GM;
	var vInf = 3776, rp = PERI_SOI_FRACTION * bodySOI("Ceres");
	var s = O.vUnit([0.3, -0.9, 0.1]);
	var peri = referencePeriapsis(GM, s, vInf, rp);
	assert.ok(Math.abs(O.vMag(peri.r) - rp) < 1e-3, "periapsis radius");
	assert.ok(Math.abs(O.vMag(peri.v) - Math.sqrt(vInf * vInf + 2 * GM / rp)) < 1e-9, "periapsis speed");
	assert.ok(Math.abs(O.vDot(peri.r, peri.v)) < 1e-3 * O.vMag(peri.r) * O.vMag(peri.v), "r ⊥ v at periapsis");
	// propagate far backward: the incoming motion direction converges on s
	var back = O.propagateState(GM, peri.r, peri.v, -10 * 86400);
	var dirIn = O.vUnit(back.v);
	assert.ok(O.vDot(dirIn, s) > 0.9999, "incoming heading matches, dot " + O.vDot(dirIn, s));
	// energy: the excess speed round-trips
	var vB = O.vMag(back.v), rB = O.vMag(back.r);
	assert.ok(Math.abs(Math.sqrt(vB * vB - 2 * GM / rB) - vInf) < 1, "v∞ from energy");
});

test("computeArrivalLeg: no burn — a pure pass-by, one day out to one day past, pass at SOI/2", function () {
	var leg = computeArrivalLeg({ body: "Ceres", waypoints: [] }, arrivingAt("Ceres", 3776, 0));
	assert.equal(leg.ok, true, leg.ok ? "" : leg.diagnostic.message);
	assert.ok(Math.abs(leg.jd0 - (JD - 1)) < 1e-9, "hand-off a day before the pass");
	assert.ok(Math.abs(leg.jdEnd - (JD + 1)) < 1e-9, "ends a day after");
	var rp = PERI_SOI_FRACTION * bodySOI("Ceres");
	assert.ok(Math.abs(leg.ca.r - rp) < 0.02 * rp, "closest approach ~SOI/2, got " + leg.ca.r);
	assert.ok(Math.abs(leg.ca.t - LEAD_S) < 600, "pass ~1 day in, got " + (leg.ca.t / 3600).toFixed(1) + " h");
	// symmetric window: start and end sit at comparable distances
	var r0 = O.vMag(leg.samples[0].r), r1 = O.vMag(leg.samples[leg.samples.length - 1].r);
	assert.ok(Math.abs(r0 - r1) < 0.05 * r0, "≈symmetric endpoints");
	// unburned: the emitted end keeps the approach v∞ (relative to the body)
	assert.equal(leg.totalDv, 0);
	assert.ok(Math.abs(O.vMag(leg.end.v) - Math.sqrt(3776 * 3776 + 2 * bodyPhysics("Ceres").GM / r1)) < 1);
	assert.equal(leg.events.length, 3);
});

test("computeArrivalLeg: a waypoint burn changes the outcome and is evented; bad times diagnose", function () {
	var data = arrivingAt("Ceres", 3776, 0);
	var free = computeArrivalLeg({ body: "Ceres", waypoints: [] }, data);
	// retro burn at the pass: slows the ship, pulls the later track in
	var burned = computeArrivalLeg({ body: "Ceres",
		waypoints: [{ t: LEAD_S, burn: { pro: -1500, rad: 0, nrm: 0 } }] }, data);
	assert.equal(burned.ok, true, burned.ok ? "" : burned.diagnostic.message);
	assert.equal(burned.totalDv, 1500);
	assert.ok(O.vMag(burned.end.v) < O.vMag(free.end.v) - 1000, "retro burn slows the leg end");
	assert.equal(burned.events.length, 4);
	assert.ok(burned.events.some(function (e) { return /Arrival waypoint impulse — 1\.50/.test(e.label); }));
	assert.ok(burned.wpVisuals[0] && burned.wpVisuals[0].eff, "gizmo/readout visuals recorded");
	// outside the two-day window → diagnostic
	var bad = computeArrivalLeg({ body: "Ceres",
		waypoints: [{ t: LEAD_S + TAIL_S + 60, burn: { pro: 0, rad: 0, nrm: 0 } }] }, data);
	assert.equal(bad.ok, false);
	assert.equal(bad.diagnostic.code, "waypoint-outside-leg");
});

test("computeArrivalLeg: diagnostics — no body, unknown body, ~zero approach speed", function () {
	var data = arrivingAt("Ceres", 3776, 0);
	assert.equal(computeArrivalLeg({ waypoints: [] }, data).diagnostic.code, "no-body");
	assert.equal(computeArrivalLeg({ body: "Xyzzy" }, data).diagnostic.code, "bad-params");
	assert.equal(computeArrivalLeg({ body: "Ceres" }, arrivingAt("Ceres", 0.5, 0)).diagnostic.code,
		"no-approach-speed");
});

// ---- the arrival-tech catalog (ui/tech-options.js) --------------------------

test("arrivalTechOptionsFor: generic techs for any body, the elevator only at Ceres", function () {
	var ceres = arrivalTechOptionsFor("Ceres").map(function (o) { return o.id; });
	assert.deepEqual(ceres, ["capture-burn", "arrival-skyhook", "ceres-elevator-catch"]);
	var mars = arrivalTechOptionsFor("Mars").map(function (o) { return o.id; });
	assert.deepEqual(mars, ["capture-burn", "arrival-skyhook"]);
	assert.deepEqual(arrivalTechOptionsFor(""), []);
	assert.deepEqual(arrivalTechOptionsFor(null), []);
	// built entries carry a moduleId + moduleUrl; the future one carries neither
	ARRIVAL_TECH_OPTIONS.forEach(function (o) {
		if (o.future) { assert.equal(o.moduleId, undefined); }
		else { assert.ok(o.moduleId && o.moduleUrl); }
	});
});

// ---- arrivalCommitmentFor (the plan's arrival endpoint, one lookup) ---------

test("arrivalCommitmentFor: the plan's arrival { body, jd, vInf }, else null", function () {
	var w = createWorld({ jd: JD });
	assert.equal(arrivalCommitmentFor(w), null);
	w.set({ addStage: { moduleId: "frozen-plan",
		params: { arrival: { body: "Ceres", jd: JD, vInf: 3776 } } } });
	assert.deepEqual(arrivalCommitmentFor(w), { body: "Ceres", jd: JD, vInf: 3776 });
	// a destination-less plan commits to nothing
	var w2 = createWorld({ jd: JD });
	w2.set({ addStage: { moduleId: "frozen-plan", params: { arrival: { body: "", jd: null } } } });
	assert.equal(arrivalCommitmentFor(w2), null);
});

// ---- through the real engine: freeze → coast → capture, then the tech swap --

function makeFrozenMission() {
	var jd = O.julianDate(2031, 3, 1, 0, 0, 0);
	var dep = O.bodyStateAtJD(GM_SUN, systems.get("Earth").orbit, jd);
	var data = freezeMissionWorld({
		origin: "Earth", destination: "Mars", jd: jd,
		departure: { r: dep.r, v: dep.v },
		burn: { pro: 2940, rad: 0, nrm: 0 },
		waypoints: [],
		arrivalJd: jd + 260,
		arrivalVInf: 2650
	});
	var res = deserializeWorld(data);
	assert.equal(res.ok, true, res.reason);
	var reg = createRegistry();
	reg.register(frozenPlan);
	reg.register(transferLeg);
	reg.register(arrivalLeg);
	reg.register(arrivalSkyhook);
	return { world: res.world, engine: createEngine(res.world, reg) };
}

test("engine: a frozen mission flies coast → flyby leg; arrival tech is empty by default", function () {
	var m = makeFrozenMission();
	var stages = m.world.stages();
	assert.deepEqual(stages.map(function (s) { return s.moduleId; }),
		["frozen-plan", "transfer-leg", "arrival-leg"]);

	// this synthetic prograde-only shot doesn't actually reach Mars — the
	// coast's own miss warning reports that
	var rLeg = m.engine.resultFor(stages[1].id);
	assert.deepEqual(rLeg.warnings.map(function (w) { return w.code; }), ["misses-destination"]);

	// the flyby leg builds the REFERENCE pass regardless (pinned at the body,
	// the delivered state supplying heading/speed/epoch), and it is the
	// terminal stage now — nothing flows downstream until a tech is loaded.
	var rArr = m.engine.resultFor(stages[2].id);
	assert.equal(rArr.status, "ok");
	assert.equal(rArr.events.length, 3);
});

test("engine: an arrival skyhook appended after the flyby leg computes clean", function () {
	var m = makeFrozenMission();
	var catchId = m.world.set({ addStage: { moduleId: "arrival-skyhook",
		params: { body: "Mars" } }, before: null });   // append after the flyby leg
	var r = m.engine.resultFor(catchId);
	assert.equal(r.status, "ok");
	assert.equal(r.output, null);   // terminal: nothing flows downstream
	assert.equal(r.events.length, 1);
	assert.match(r.events[0].label, /Skyhook catch at Mars/);
	assert.deepEqual(r.warnings, []);
});
