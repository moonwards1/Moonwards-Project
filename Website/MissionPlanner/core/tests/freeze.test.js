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

test("freeze output deserializes into a working World with the E2 profile", () => {
	var data = freezeMissionWorld(makeSpec());
	var res = deserializeWorld(data);
	assert.equal(res.ok, true, res.reason);
	var stages = res.world.serialize().stages;
	assert.deepEqual(stages.map(s => s.moduleId), ["frozen-plan", "transfer-leg"]);
	assert.equal(data.nextStage, 3);
});

test("frozen-plan and transfer-leg carry matching waypoint copies, not shared refs", () => {
	var spec = makeSpec();
	var data = freezeMissionWorld(spec);
	var plan = data.stages[0].params, leg = data.stages[1].params;
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
	var plan = data.stages[0].params, leg = data.stages[1].params;
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
	var wps = freezeMissionWorld(spec).stages[1].params.waypoints;
	assert.deepEqual(wps.map(w => w.days), [80, 200]);
	assert.deepEqual(wps[0].burn, { pro: 0, rad: -50, nrm: 0 });   // burn normalized to all three axes
});

test("required v∞ is the injection the departure burn demanded", () => {
	var spec = makeSpec();
	var data = freezeMissionWorld(spec);
	var comp = computeCompliance(data.stages[0].params, null);
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
	var comp = computeCompliance(data.stages[0].params, null);
	assert.equal(comp.ok, true);
	assert.ok(comp.required.vInf < 1e-6, "required v∞ should be ~0, got " + comp.required.vInf);
});

test("defaultMissionTitle names origin → destination + departure year", () => {
	var jd = O.julianDate(2031, 12, 20, 6, 0, 0);
	assert.equal(defaultMissionTitle("Earth", "Ceres", jd), "Earth → Ceres 2031");
});
