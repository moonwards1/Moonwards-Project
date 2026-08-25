// Node tests for the arrival phase: the arrival flyby leg (arrival-leg), the
// arrival-skyhook catch (the generic tether run in reverse), the arrival-tech
// catalog, and the frozen plan's arrival-commitment lookup. The shared
// arrival-approach helpers (approachAt / interceptWarning) are tested in
// arrival-approach.test.js. Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/arrival.test.js
// The view hooks (init/draw) are browser-only and not exercised here.

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld, deserializeWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import { freezeMissionWorld } from "../../core/freeze.js";
import { originSoiRadius } from "../../core/departure-estimate.js";
import moonPlatform from "../moon-platform/moon-platform.js";
import departureLeg from "../departure-leg/departure-leg.js";
import frozenPlan, { arrivalCommitmentFor } from "../frozen-plan/frozen-plan.js";
import transferLeg from "../transfer-leg/transfer-leg.js";
import arrivalSkyhook, { computeCatch } from "../skyhook/skyhook-arrival.js";
import arrivalLeg, { computeArrivalLeg, arrivalWindow, stateAtElapsed,
	legFor as arrivalLegFor } from "../arrival-leg/arrival-leg.js";
import { legFor as coastLegFor, stateAtElapsed as coastStateAtElapsed }
	from "../transfer-leg/transfer-leg.js";
import { SEAM_MIN_DAYS, ARRIVAL_TAIL_DAYS } from "../../core/arrival-seam.js";
import { bodySOI, bodyConstants } from "../../../Shared/body-leg.js";
import { tetherGeometry, tetherKinematics, resolveParams as resolveSkyhookParams,
	bodyPhysics } from "../skyhook/skyhook.js";
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
	var params = { body: "Mars", comAlt: comAlt, relAlt: comAlt + 100e3 };
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
	var bad = computeCatch({ body: "Mars", comAlt: 9000e3, relAlt: -1 }, data);
	assert.equal(bad.ok, false);
	assert.equal(bad.diagnostic.code, "bad-params");
});

// ---- arrival-leg: the coast, continued -------------------------------------
// The leg spans the seam window and flies whatever the coast hands it, under
// the destination's own gravity (task 7.1). Nothing about the pass is
// constructed, so these tests check that the delivered geometry — not a
// reference periapsis — is what comes out the far end.

// A heliocentric approach spec for computeArrivalLeg: a ship that at epoch JD
// would sit `offsetM` off `body` (perpendicular to its relative velocity) with
// `vInf` m/s of excess along +x, wound back `days` days on a Sun-only arc so
// the window opens before the encounter. Body gravity then bends the real pass
// in, which is exactly the effect under test.
function approachSpec(body, vInf, offsetM, days) {
	var bs = Frames.bodyHelioState(body, JD);
	var atCa = { r: O.vAdd(bs.r, [0, offsetM, 0]), v: O.vAdd(bs.v, [vInf, 0, 0]) };
	var back = O.propagateState(GM_SUN, atCa.r, atCa.v, -days * 86400);
	return { r: back.r, v: back.v, jd0: JD - days, jdEnd: JD + ARRIVAL_TAIL_DAYS };
}

var CERES_R = bodyConstants("Ceres").R;

test("computeArrivalLeg: no burn — the whole window is flown, ending where it says", function () {
	var spec = approachSpec("Ceres", 3776, 6e6, SEAM_MIN_DAYS);
	var leg = computeArrivalLeg({ body: "Ceres", waypoints: [] }, spec);
	assert.equal(leg.ok, true, leg.ok ? "" : leg.diagnostic.message);
	assert.equal(leg.jd0, spec.jd0);
	assert.ok(Math.abs(leg.jdEnd - spec.jdEnd) < 1e-6, "runs to the window's right edge");
	assert.ok(Math.abs(leg.T - (spec.jdEnd - spec.jd0) * 86400) < 1, "T is the window's own width");
	assert.equal(leg.totalDv, 0);
	assert.equal(leg.impact, null);
	assert.deepEqual(leg.warnings, []);
	// hand-off + closest approach; nothing else with no waypoints
	assert.equal(leg.events.length, 2);
	assert.ok(/approach begins/.test(leg.events[0].label));
	assert.ok(/Closest approach/.test(leg.events[1].label));
	// the pass sits inside the window and clear of the surface
	assert.ok(leg.ca.t > 0 && leg.ca.t < leg.T, "closest approach inside the window");
	assert.ok(leg.ca.r > CERES_R, "clears the surface");
});

test("computeArrivalLeg: the pass is whatever the coast delivers — NOT a constructed periapsis", function () {
	var near = computeArrivalLeg({ body: "Ceres", waypoints: [] },
		approachSpec("Ceres", 3776, 6e6, SEAM_MIN_DAYS));
	var far = computeArrivalLeg({ body: "Ceres", waypoints: [] },
		approachSpec("Ceres", 3776, 3e7, SEAM_MIN_DAYS));
	assert.equal(near.ok, true, near.ok ? "" : near.diagnostic.message);
	assert.equal(far.ok, true, far.ok ? "" : far.diagnostic.message);
	// the delivered offset drives the pass distance, monotonically
	assert.ok(far.ca.r > near.ca.r * 3, "a wider delivery passes wider: " +
		near.ca.r.toExponential(2) + " vs " + far.ca.r.toExponential(2));
	// the two passes differ at all: the retired reference flyby pinned BOTH at
	// half the SOI radius regardless of what the coast delivered
	var halfSoi = 0.5 * bodySOI("Ceres");
	assert.ok(Math.abs(near.ca.r - far.ca.r) > 0.1 * halfSoi, "two deliveries, two passes");
	// gravitational focusing pulls each pass INSIDE its unperturbed offset
	assert.ok(near.ca.r < 6e6 && far.ca.r < 3e7, "focused inward by the body's own pull");
});

test("computeArrivalLeg: the leg starts exactly at the state it was handed", function () {
	var spec = approachSpec("Ceres", 3776, 6e6, SEAM_MIN_DAYS);
	var leg = computeArrivalLeg({ body: "Ceres", waypoints: [] }, spec);
	var handed = Frames.helioToLocal("Ceres", spec.jd0, spec.r, spec.v);
	var s = stateAtElapsed(leg, 0);
	assert.ok(O.vMag(O.vSub(s.r, handed.r)) < 1, "position continuous across the seam");
	assert.ok(O.vMag(O.vSub(s.v, handed.v)) < 1e-6, "velocity continuous across the seam");
	assert.ok(O.vMag(O.vSub(leg.samples[0].r, handed.r)) < 1, "and the drawn line starts there too");
});

test("computeArrivalLeg: a waypoint burn changes the outcome and is evented", function () {
	var spec = approachSpec("Ceres", 3776, 6e6, SEAM_MIN_DAYS);
	var free = computeArrivalLeg({ body: "Ceres", waypoints: [] }, spec);
	// retro burn at the pass: slows the ship, pulls the later track in
	var burned = computeArrivalLeg({ body: "Ceres",
		waypoints: [{ t: free.ca.t, burn: { pro: -1500, rad: 0, nrm: 0 } }] }, spec);
	assert.equal(burned.ok, true, burned.ok ? "" : burned.diagnostic.message);
	assert.equal(burned.totalDv, 1500);
	assert.ok(O.vMag(burned.end.v) < O.vMag(free.end.v) - 1000, "retro burn slows the leg end");
	assert.equal(burned.events.length, 3);
	assert.ok(burned.events.some(function (e) { return /Arrival waypoint impulse — 1\.50/.test(e.label); }));
	assert.ok(burned.wpVisuals[0] && burned.wpVisuals[0].eff, "gizmo/readout visuals recorded");
});

test("computeArrivalLeg: a waypoint outside the window is clamped and warned, never blanked", function () {
	var spec = approachSpec("Ceres", 3776, 6e6, SEAM_MIN_DAYS);
	var T = (spec.jdEnd - spec.jd0) * 86400;
	var leg = computeArrivalLeg({ body: "Ceres",
		waypoints: [{ t: T + 20 * 3600, burn: { pro: -50, rad: 0, nrm: 0 } }] }, spec);
	assert.equal(leg.ok, true, leg.ok ? "" : leg.diagnostic.message);
	assert.equal(leg.warnings.length, 1);
	assert.equal(leg.warnings[0].code, "waypoint-outside-window");
	assert.equal(leg.totalDv, 50, "the burn still happens, at the window's edge");
	// a non-finite time IS damaged params, and still diagnoses
	var bad = computeArrivalLeg({ body: "Ceres",
		waypoints: [{ t: NaN, burn: { pro: 0, rad: 0, nrm: 0 } }] }, spec);
	assert.equal(bad.ok, false);
	assert.equal(bad.diagnostic.code, "waypoint-outside-leg");
});

test("computeArrivalLeg: an approach that hits the body warns and stops there", function () {
	// aimed straight at the centre: the integration reaches the surface
	var spec = approachSpec("Ceres", 3776, 0, SEAM_MIN_DAYS);
	var leg = computeArrivalLeg({ body: "Ceres", waypoints: [] }, spec);
	assert.equal(leg.ok, true, leg.ok ? "" : leg.diagnostic.message);
	assert.ok(leg.impact, "records the impact");
	assert.equal(leg.impact.body, "Ceres");
	assert.ok(leg.jdEnd < spec.jdEnd, "the leg ends early, at the surface");
	assert.ok(leg.warnings.some(function (w) { return w.code === "impacts-body"; }));
	assert.ok(leg.events.some(function (e) { return /Impacts Ceres/.test(e.label); }));
});

test("computeArrivalLeg: diagnostics — no body, unknown body, an empty window", function () {
	var spec = approachSpec("Ceres", 3776, 6e6, SEAM_MIN_DAYS);
	assert.equal(computeArrivalLeg({ waypoints: [] }, spec).diagnostic.code, "no-body");
	assert.equal(computeArrivalLeg({ body: "Xyzzy" }, spec).diagnostic.code, "bad-params");
	assert.equal(computeArrivalLeg({ body: "Ceres" },
		{ r: spec.r, v: spec.v, jd0: JD, jdEnd: JD }).diagnostic.code, "bad-params");
});

// ---- arrivalWindow: where the phase begins ---------------------------------

test("arrivalWindow: with no coast leg, the window brackets the delivered epoch by Kepler", function () {
	var data = arrivingAt("Ceres", 3776, 0);
	var win = arrivalWindow("Ceres", null, data, null);
	assert.equal(win.hasEncounter, false);
	assert.equal(win.fromCoast, false);
	assert.ok(Math.abs(win.jd0 - (JD - SEAM_MIN_DAYS)) < 1e-9);
	assert.ok(Math.abs(win.jdEnd - (JD + ARRIVAL_TAIL_DAYS)) < 1e-9);
	// the start state is the delivered state wound back on a Sun-only arc
	var fwd = O.propagateState(GM_SUN, win.r, win.v, SEAM_MIN_DAYS * 86400);
	assert.ok(O.vMag(O.vSub(fwd.r, data.r)) < 1, "round-trips to the delivered position");
});

test("arrivalWindow: the plan's committed epoch is the no-encounter anchor, not the delivered one", function () {
	var data = arrivingAt("Ceres", 3776, 0);
	var win = arrivalWindow("Ceres", null, data, JD + 3);
	assert.ok(Math.abs(win.jd0 - (JD + 3 - SEAM_MIN_DAYS)) < 1e-9);
});

// ---- stateAtElapsed (2.5's chevron position source) ------------------------

function ceresLeg() {
	return computeArrivalLeg({ body: "Ceres", waypoints: [] },
		approachSpec("Ceres", 3776, 6e6, SEAM_MIN_DAYS));
}

test("arrival-leg stateAtElapsed: at the leg's full span matches leg.end", function () {
	var leg = ceresLeg();
	var s = stateAtElapsed(leg, leg.T);
	assert.ok(O.vMag(O.vSub(s.r, leg.end.r)) < 1);
	assert.ok(O.vMag(O.vSub(s.v, leg.end.v)) < 1e-6);
});

test("arrival-leg stateAtElapsed: mid-segment agrees with a drawn polyline sample at the same t", function () {
	var leg = ceresLeg();
	var sample = leg.samples[50];
	var s = stateAtElapsed(leg, sample.t);
	assert.ok(O.vMag(O.vSub(s.r, sample.r)) < 1);
});

test("arrival-leg stateAtElapsed: clamps outside the leg's span to its nearest end", function () {
	var leg = ceresLeg();
	var before = stateAtElapsed(leg, -1e6);
	assert.ok(O.vMag(O.vSub(before.r, leg.samples[0].r)) < 1);
	var after = stateAtElapsed(leg, leg.T + 1e6);
	assert.ok(O.vMag(O.vSub(after.r, leg.end.r)) < 1);
});

test("arrival-leg stateAtElapsed: a malformed/missing leg returns null", function () {
	assert.equal(stateAtElapsed({ ok: false }, 0), null);
	assert.equal(stateAtElapsed(null, 0), null);
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
	// jd IS the hand-off epoch, and `handoff` the coast's starting state at
	// Earth's SOI edge — the shape ephemeris-view.js's buildFreezeSpec hands
	// over (a 2.94 km/s v∞ on an exit point one SOI radius along its heading).
	var jd = O.julianDate(2031, 3, 1, 0, 0, 0);
	var body = O.bodyStateAtJD(GM_SUN, systems.get("Earth").orbit, jd);
	var vh = O.applyBurn(body.r, body.v, 2940, 0, 0);
	var off = O.vScale(O.vUnit(O.vSub(vh, body.v)), originSoiRadius("Earth"));
	var data = freezeMissionWorld({
		origin: "Earth", destination: "Mars", jd: jd,
		handoff: { r: O.vAdd(body.r, off), v: vh },
		waypoints: [],
		arrivalJd: jd + 260,
		arrivalVInf: 2650
	});
	var res = deserializeWorld(data);
	assert.equal(res.ok, true, res.reason);
	var reg = createRegistry();
	reg.register(moonPlatform);   // the Earth-origin departure scaffold (empty
	reg.register(departureLeg);   // carrier slot) freeze now prepends
	reg.register(frozenPlan);
	reg.register(transferLeg);
	reg.register(arrivalLeg);
	reg.register(arrivalSkyhook);
	return { world: res.world, engine: createEngine(res.world, reg) };
}

test("engine: a frozen mission flies its scaffold → coast → flyby leg; both tech slots empty", function () {
	var m = makeFrozenMission();   // origin Earth
	var stages = m.world.stages();
	// Earth scaffold (moon-platform + departure-leg, empty carrier) up front;
	// the flyby leg is terminal (empty arrival-tech slot).
	assert.deepEqual(stages.map(function (s) { return s.moduleId; }),
		["moon-platform", "departure-leg", "frozen-plan", "transfer-leg", "arrival-leg"]);
	function stageId(m2) { return stages.find(function (s) { return s.moduleId === m2; }).id; }

	// the empty carrier slot: departure-leg has no releasing carrier, but the
	// frozen-plan boundary keeps the coast flying regardless.
	assert.equal(m.engine.resultFor(stageId("departure-leg")).diagnostic.code, "no-carrier");
	assert.equal(m.engine.resultFor(stageId("frozen-plan")).status, "ok");

	// this synthetic prograde-only shot doesn't actually reach Mars — the
	// coast's own miss warning reports that
	var rLeg = m.engine.resultFor(stageId("transfer-leg"));
	assert.deepEqual(rLeg.warnings.map(function (w) { return w.code; }), ["misses-destination"]);

	// the arrival leg continues that coast anyway (7.1: no constructed pass to
	// fall back on), so the miss it flies is the miss the coast delivered. It is
	// the terminal stage here — nothing flows downstream until a tech is loaded.
	var rArr = m.engine.resultFor(stageId("arrival-leg"));
	assert.equal(rArr.status, "ok");
	assert.equal(rArr.events.length, 2);
	var arrLeg = arrivalLegFor(m.world, stageId("arrival-leg"));
	assert.ok(arrLeg.ca.r > 0.1 * 149597870700,
		"a 0.17 AU miss stays a 0.17 AU miss — the retired reference flyby would " +
		"have passed Mars at SOI/2 whatever the coast did");
	// and it starts from the coast's own state at the seam, not from the packet
	var coast = coastLegFor(m.world, stageId("transfer-leg"));
	var atSeam = coastStateAtElapsed(coast, (arrLeg.jd0 - coast.jd0) * 86400);
	var handed = Frames.helioToLocal("Mars", arrLeg.jd0, atSeam.r, atSeam.v);
	assert.ok(O.vMag(O.vSub(stateAtElapsed(arrLeg, 0).r, handed.r)) < 1,
		"continuous with the coast at the seam");
});

test("engine: a BROKEN coast blocks the arrival phase, standard propagation", function () {
	// Without a compliance boundary at this seam, a failing coast blocks
	// downstream the ordinary way (recompute.js's ok/diagnostic/blocked rule) —
	// no special-cased reporting at the seam.
	var m = makeFrozenMission();
	var stages = m.world.stages();
	function stageId(m2) { return stages.find(function (s) { return s.moduleId === m2; }).id; }

	m.world.set({ stage: stageId("transfer-leg"), params: { legDays: -1 } });

	assert.equal(m.engine.resultFor(stageId("transfer-leg")).status, "diagnostic");
	assert.equal(m.engine.resultFor(stageId("arrival-leg")).status, "blocked");
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
	// This synthetic shot misses Mars, and the arrival leg no longer papers over
	// that with a constructed pass, so the catch says so — the geometry it
	// reports is still computed, which is what "computes clean" means here.
	assert.deepEqual(r.warnings.map(function (w) { return w.code; }), ["intercept-miss"]);
});
