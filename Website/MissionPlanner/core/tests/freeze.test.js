// Node tests for core/freeze.js (task E2): the Ephemeris-tab -> mission-tab
// freeze contract. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/freeze.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { freezeMissionWorld, defaultMissionTitle } from "../freeze.js";
import { deserializeWorld } from "../world.js";
import { computeCompliance } from "../../modules/frozen-plan/frozen-plan.js";
import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";

var O = OrbitalMath;
var GM_SUN = systems.get("Sun").GM;

// A realistic spec: departure = Earth's own helio state (exactly what the
// Ephemeris tab hands over), 260-day leg to Mars.
function makeSpec() {
	var jd = O.julianDate(2031, 3, 1, 0, 0, 0);
	var dep = O.bodyStateAtJD(GM_SUN, systems.get("Earth").orbit, jd);
	return {
		origin: "Earth",
		destination: "Mars",
		jd: jd,
		departure: { r: dep.r, v: dep.v },
		burn: { pro: 2940, rad: 0, nrm: 0 },
		waypoints: [{ days: 130, burn: { pro: 0, rad: 0, nrm: 500 } }],
		arrivalJd: jd + 260,
		arrivalVInf: 2650
	};
}

// Find a stage's params by moduleId — stage positions shifted once freeze grew
// the departure scaffold, so never index by position.
function paramsOf(data, moduleId) {
	var s = data.stages.find(function (x) { return x.moduleId === moduleId; });
	return s ? s.params : null;
}

test("freeze output deserializes into a working World with the E2 profile (Earth scaffold)", () => {
	var data = freezeMissionWorld(makeSpec());   // origin Earth
	var res = deserializeWorld(data);
	assert.equal(res.ok, true, res.reason);
	var stages = res.world.serialize().stages;
	// Earth: the fixed Moon platform + the geocentric leg (empty carrier slot),
	// then the plan, coast and flyby leg (empty arrival-tech slot).
	assert.deepEqual(stages.map(s => s.moduleId),
		["moon-platform", "departure-leg", "frozen-plan", "transfer-leg", "arrival-leg"]);
	assert.equal(data.nextStage, 6);
	// the departure leg starts with no waypoints; the flyby leg carries the
	// destination explicitly (body convention) and is the terminal stage.
	assert.deepEqual(paramsOf(data, "departure-leg"), { waypoints: [] });
	assert.deepEqual(paramsOf(data, "arrival-leg"), { body: "Mars", waypoints: [] });
	// The clock opens at the hand-off — the coast's own start, since a spawned
	// mission opens on the coast phase. Phase clocks are only consistent WITHIN
	// a phase; the departure's estimated span leaves a gap at this seam.
	assert.equal(data.jd, paramsOf(data, "frozen-plan").departure.jd);
	assert.ok(paramsOf(data, "frozen-plan").releaseAnchorJd < data.jd,
		"the release anchor leads the hand-off the clock opens at");
});

test("freeze from a non-Earth origin scaffolds just the generic departure leg", () => {
	var jd = O.julianDate(2033, 6, 1, 0, 0, 0);
	var dep = O.bodyStateAtJD(GM_SUN, systems.get("Mars").orbit, jd);
	var data = freezeMissionWorld({
		origin: "Mars", destination: "Ceres", jd: jd,
		departure: { r: dep.r, v: dep.v },
		burn: { pro: 1800, rad: 0, nrm: 0 },
		waypoints: [], arrivalJd: jd + 300, arrivalVInf: 3000
	});
	var res = deserializeWorld(data);
	assert.equal(res.ok, true, res.reason);
	// no Moon platform for a non-Earth origin — just the generic leg (its
	// skyhook, when added, self-originates), then the plan, coast and flyby.
	assert.deepEqual(res.world.serialize().stages.map(s => s.moduleId),
		["body-departure-leg", "frozen-plan", "transfer-leg", "arrival-leg"]);
	assert.equal(data.nextStage, 5);
	assert.equal(paramsOf(data, "frozen-plan").origin, "Mars");
});

test("frozen-plan and transfer-leg carry matching waypoint copies, not shared refs", () => {
	var spec = makeSpec();
	var data = freezeMissionWorld(spec);
	var plan = paramsOf(data, "frozen-plan"), leg = paramsOf(data, "transfer-leg");
	assert.deepEqual(plan.waypoints, leg.waypoints);
	assert.notEqual(plan.waypoints[0], leg.waypoints[0]);       // copies
	assert.notEqual(plan.departure.r, spec.departure.r);        // nor the live input
	assert.equal(leg.legDays, 260);
	assert.equal(leg.destination, "Mars");
	assert.equal(plan.arrival.body, "Mars");
	assert.equal(plan.arrival.vInf, 2650);
});

test("the hand-off is POST-burn: neither stage carries a burn field, injection lives in the frozen state", () => {
	var spec = makeSpec();
	var data = freezeMissionWorld(spec);
	var plan = paramsOf(data, "frozen-plan"), leg = paramsOf(data, "transfer-leg");
	// no burn field at all — the injection is baked into departure.v itself,
	// not recorded separately anywhere in the chain (removed 2026-07-14)
	assert.equal("burn" in leg, false);
	assert.equal("burn" in plan, false);
	// the frozen departure velocity is the origin state + the authored burn
	var expected = O.applyBurn(spec.departure.r, spec.departure.v,
		spec.burn.pro, spec.burn.nrm, spec.burn.rad);
	assert.deepEqual(plan.departure.v, expected);
	assert.deepEqual(plan.departure.r, spec.departure.r);       // burn is impulsive: r unchanged
});

test("waypoints are sorted chronologically and post-arrival ones dropped", () => {
	var spec = makeSpec();
	spec.waypoints = [
		{ days: 200, burn: { pro: 100 } },
		{ days: 80, burn: { rad: -50 } },
		{ days: 300, burn: { pro: 999 } },    // ≥ the 260-day rendezvous — dropped
		{ days: NaN, burn: { pro: 1 } }       // unresolved — dropped
	];
	var wps = paramsOf(freezeMissionWorld(spec), "transfer-leg").waypoints;
	assert.deepEqual(wps.map(w => w.days), [80, 200]);
	assert.deepEqual(wps[0].burn, { pro: 0, rad: -50, nrm: 0 });   // burn normalized to all three axes
});

test("required v∞ is the injection the departure burn demanded", () => {
	var spec = makeSpec();
	var data = freezeMissionWorld(spec);
	var comp = computeCompliance(paramsOf(data, "frozen-plan"), null);
	assert.equal(comp.ok, true);
	assert.equal(comp.delivered, null);   // empty tech slot: warning territory, not a block
	// v∞ = |hand-off v − origin's helio v| = |the burn's Δv| — the burn frame
	// is orthonormal, so that's the components' own magnitude.
	var expect = Math.hypot(spec.burn.pro, spec.burn.rad, spec.burn.nrm);
	assert.ok(Math.abs(comp.required.vInf - expect) < 1e-6,
		"required v∞ should be " + expect + ", got " + comp.required.vInf);
});

test("a waypoint-only plan (no departure burn) freezes to required v∞ 0", () => {
	var spec = makeSpec();
	spec.burn = { pro: 0, rad: 0, nrm: 0 };
	var data = freezeMissionWorld(spec);
	var comp = computeCompliance(paramsOf(data, "frozen-plan"), null);
	assert.equal(comp.ok, true);
	assert.ok(comp.required.vInf < 1e-6, "required v∞ should be ~0, got " + comp.required.vInf);
});

test("defaultMissionTitle names origin → destination + departure year", () => {
	var jd = O.julianDate(2031, 12, 20, 6, 0, 0);
	assert.equal(defaultMissionTitle("Earth", "Ceres", jd), "Earth → Ceres 2031");
});

// ---- timing fields (task D7: the hand-off window + release anchor) ---------

test("freeze bakes a hand-off window (default ±1 d) and a release anchor ahead of the hand-off", async () => {
	var spec = makeSpec();
	var plan = paramsOf(freezeMissionWorld(spec), "frozen-plan");
	assert.equal(plan.handoffWindowDays, 1);
	// the anchor leads departure.jd by the departure-estimate module's own
	// figure for this spec — same source, so they must agree exactly
	var DE = await import("../departure-estimate.js");
	var est = DE.estimateDeparture({
		origin: spec.origin,
		vInfVec: O.vSub(plan.departure.v, spec.departure.v),
		jdHandoff: spec.jd
	});
	assert.ok(est.ok);
	assert.ok(Math.abs(plan.releaseAnchorJd - est.jdLaunch) < 1e-9);
	assert.ok(plan.releaseAnchorJd < spec.jd);
	// a 2.94 km/s injection is day-scale, not hour- or month-scale
	var leadDays = spec.jd - plan.releaseAnchorJd;
	assert.ok(leadDays > 1 && leadDays < 10, "lead " + leadDays.toFixed(2) + " d");
});

test("a custom windowDays is honoured; a waypoint-only plan anchors at the hand-off itself", () => {
	var spec = makeSpec();
	spec.windowDays = 2.5;
	assert.equal(paramsOf(freezeMissionWorld(spec), "frozen-plan").handoffWindowDays, 2.5);

	var spec2 = makeSpec();
	spec2.burn = { pro: 0, rad: 0, nrm: 0 };       // no injection: v∞ ~ 0, nothing to time
	var plan2 = paramsOf(freezeMissionWorld(spec2), "frozen-plan");
	assert.equal(plan2.releaseAnchorJd, spec2.jd);
	assert.equal(plan2.handoffWindowDays, 1);
});
