// Node tests for core/freeze.js: the Ephemeris-tab -> mission-tab
// freeze contract. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/freeze.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { freezeMissionWorld, defaultMissionTitle } from "../freeze.js";
import { deserializeWorld } from "../world.js";
import { computeCompliance } from "../../modules/frozen-plan/frozen-plan.js";
import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { originSoiRadius } from "../departure-estimate.js";
import { Frames } from "../../../Shared/frames.js";

var O = OrbitalMath;
var GM_SUN = systems.get("Sun").GM;

// A realistic spec, shaped exactly as ephemeris-view.js's buildFreezeSpec
// hands it over: jd IS the hand-off epoch, `handoff` IS the coast's starting
// state at the origin's SOI edge, and waypoint days already count from it.
// 260-day leg to Mars.
//
// The hand-off is built the way departureState does: v-infinity applied to the
// origin body's own motion, at an exit point one SOI radius along the outbound
// heading. VINF below is the v-infinity that state carries, for assertions.
// The reference is the ESCAPE body, which is Earth for a Moon origin — a lunar
// departure hands over at Earth's SOI edge (Shared/frames.js).
var VINF = { pro: 2940, rad: 0, nrm: 0 };
function handoffFor(jd, origin, vinf) {
	var body = Frames.bodyHelioState(Frames.escapeReferenceFor(origin), jd);
	var v = O.applyBurn(body.r, body.v, vinf.pro || 0, vinf.nrm || 0, vinf.rad || 0);
	var vInfVec = O.vSub(v, body.v), mag = O.vMag(vInfVec);
	var R = originSoiRadius(origin);
	var off = (R > 0 && mag > 1e-6) ? O.vScale(O.vUnit(vInfVec), R) : [0, 0, 0];
	return { r: O.vAdd(body.r, off), v: v };
}
function makeSpec() {
	var jd = O.julianDate(2031, 3, 1, 0, 0, 0);
	return {
		origin: "Moon",
		destination: "Mars",
		jd: jd,
		handoff: handoffFor(jd, "Moon", VINF),
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

test("freeze output deserializes into a working World with the E2 profile (Moon scaffold)", () => {
	var data = freezeMissionWorld(makeSpec());   // origin Moon
	var res = deserializeWorld(data);
	assert.equal(res.ok, true, res.reason);
	var stages = res.world.serialize().stages;
	// Moon: the fixed Moon platform + the geocentric leg (empty carrier slot),
	// then the plan, coast, and the flyby leg (empty arrival-tech slot).
	assert.deepEqual(stages.map(s => s.moduleId),
		["moon-platform", "departure-leg", "frozen-plan", "transfer-leg", "arrival-leg"]);
	assert.equal(data.nextStage, 6);
	// the departure leg starts with no waypoints; the flyby leg carries the
	// destination explicitly (body convention) and is the terminal stage.
	assert.deepEqual(Object.keys(paramsOf(data, "departure-leg")).sort(), ["releaseJd", "waypoints"]);
	assert.deepEqual(paramsOf(data, "departure-leg").waypoints, []);
	assert.deepEqual(paramsOf(data, "arrival-leg"), { body: "Mars", waypoints: [] });
	// The clock opens at the hand-off — the coast's own start, since a spawned
	// mission opens on the coast phase. Phase clocks are only consistent WITHIN
	// a phase; the departure's estimated span leaves a gap at this seam.
	assert.equal(data.jd, paramsOf(data, "frozen-plan").departure.jd);
	assert.ok(paramsOf(data, "departure-leg").releaseJd < data.jd,
		"release leads the hand-off the clock opens at");
	// the plan states the boundary requirement only — release is not its business
	assert.equal("releaseAnchorJd" in paramsOf(data, "frozen-plan"), false);
});

test("every origin but the Moon scaffolds just the generic departure leg", () => {
	// Earth is one of them now: a mission from Earth departs from Earth, the
	// same way one from Mars departs from Mars. Only the Moon rides a platform.
	var jd = O.julianDate(2033, 6, 1, 0, 0, 0);
	[["Mars", "Ceres"], ["Earth", "Mars"]].forEach(function ([origin, dest]) {
		var data = freezeMissionWorld({
			origin: origin, destination: dest, jd: jd,
			handoff: handoffFor(jd, origin, { pro: 1800, rad: 0, nrm: 0 }),
			waypoints: [], arrivalJd: jd + 300, arrivalVInf: 3000
		});
		var res = deserializeWorld(data);
		assert.equal(res.ok, true, res.reason);
		// no platform stage — the generic leg's skyhook, when added,
		// self-originates — then the plan, coast, and the flyby.
		assert.deepEqual(res.world.serialize().stages.map(s => s.moduleId),
			["body-departure-leg", "frozen-plan", "transfer-leg", "arrival-leg"], origin);
		assert.equal(data.nextStage, 5);
		assert.equal(paramsOf(data, "frozen-plan").origin, origin);
	});
});

test("frozen-plan and transfer-leg carry matching waypoint copies, not shared refs", () => {
	var spec = makeSpec();
	var data = freezeMissionWorld(spec);
	var plan = paramsOf(data, "frozen-plan"), leg = paramsOf(data, "transfer-leg");
	assert.deepEqual(plan.waypoints, leg.waypoints);
	assert.notEqual(plan.waypoints[0], leg.waypoints[0]);       // copies
	assert.notEqual(plan.departure.r, spec.handoff.r);          // nor the live input
	// the clock IS the hand-off, so the coast is the full span the marker set
	assert.equal(plan.departure.jd, spec.jd);
	assert.ok(Math.abs(leg.legDays - 260) < 1e-9);
	assert.equal(leg.destination, "Mars");
	assert.equal(plan.arrival.body, "Mars");
	assert.equal(plan.arrival.vInf, 2650);
});

test("the hand-off is committed verbatim, carries no burn field, and re-derives nothing", () => {
	var spec = makeSpec();
	var data = freezeMissionWorld(spec);
	var plan = paramsOf(data, "frozen-plan"), leg = paramsOf(data, "transfer-leg");
	// no burn field at all — the hand-off state IS the coast's start, and
	// nothing at that seam is recorded as an impulse anywhere in the chain
	assert.equal("burn" in leg, false);
	assert.equal("burn" in plan, false);
	// EXACT copies of what the tab handed in — this is the whole contract:
	// whatever produced the hand-off (an authored heading, or a real carrier
	// chain's delivered state) survives the freeze bit for bit, so pasting
	// the plan back into the Ephemeris tab reproduces it exactly.
	assert.deepEqual(plan.departure.r, spec.handoff.r);
	assert.deepEqual(plan.departure.v, spec.handoff.v);
	assert.equal(plan.departure.jd, spec.jd);
	// and it sits one SOI radius out from Earth, where this spec put it
	var earth = O.bodyStateAtJD(GM_SUN, systems.get("Earth").orbit, plan.departure.jd);
	var sep = O.vMag(O.vSub(plan.departure.r, earth.r));
	assert.ok(Math.abs(sep / originSoiRadius("Earth") - 1) < 1e-9, "sep " + sep);
	// the legacy injection epoch is gone: the clock IS the hand-off now
	assert.equal("injectionJd" in plan, false);
});

test("waypoints are sorted chronologically and post-arrival ones dropped", () => {
	var spec = makeSpec();
	spec.waypoints = [
		{ days: 200, burn: { pro: 100 } },
		{ days: 80, burn: { rad: -50 } },
		{ days: 300, burn: { pro: 999 } },    // ≥ the 260-day rendezvous — dropped
		{ days: NaN, burn: { pro: 1 } }       // unresolved — dropped
	];
	var data = freezeMissionWorld(spec);
	var wps = paramsOf(data, "transfer-leg").waypoints;
	// days re-based onto the hand-off: authored from the burn, flown from the
	// SOI edge, so each loses the crossing while its absolute epoch stands
	var crossingDays = paramsOf(data, "frozen-plan").departure.jd - spec.jd;
	assert.deepEqual(wps.map(w => w.days), [80 - crossingDays, 200 - crossingDays]);
	assert.deepEqual(wps[0].burn, { pro: 0, rad: -50, nrm: 0 });   // burn normalized to all three axes
});

test("required v∞ is the injection the departure burn demanded, read at the SOI edge", () => {
	var spec = makeSpec();
	var data = freezeMissionWorld(spec);
	var comp = computeCompliance(paramsOf(data, "frozen-plan"), null);
	assert.equal(comp.ok, true);
	assert.equal(comp.delivered, null);   // empty tech slot: warning territory, not a block
	// v∞ = |hand-off v − origin's helio v|. At the burn that is exactly the
	// burn's Δv (the burn frame is orthonormal); the requirement is read one
	// SOI crossing later instead, where differential solar gravity has bent
	// the two apart by a little — the same measurement, and the same place,
	// the departure tech's delivered hand-off is judged at.
	var expect = Math.hypot(VINF.pro, VINF.rad, VINF.nrm);
	assert.ok(Math.abs(comp.required.vInf - expect) < 0.005 * expect,
		"required v∞ should be near " + expect + ", got " + comp.required.vInf);
});

test("a waypoint-only plan (no departure burn) freezes to required v∞ 0", () => {
	var spec = makeSpec();
	spec.handoff = handoffFor(spec.jd, "Moon", { pro: 0, rad: 0, nrm: 0 });
	var data = freezeMissionWorld(spec);
	var comp = computeCompliance(paramsOf(data, "frozen-plan"), null);
	assert.equal(comp.ok, true);
	assert.ok(comp.required.vInf < 1e-6, "required v∞ should be ~0, got " + comp.required.vInf);
});

test("defaultMissionTitle names origin → destination + departure year", () => {
	var jd = O.julianDate(2031, 12, 20, 6, 0, 0);
	assert.equal(defaultMissionTitle("Earth", "Ceres", jd), "Earth → Ceres 2031");
});

// ---- timing fields: the plan's window + the leg's release epoch ------------

test("freeze bakes a hand-off window (default ±1 d) and seeds release ahead of the hand-off", async () => {
	var spec = makeSpec();
	var world = freezeMissionWorld(spec);
	var plan = paramsOf(world, "frozen-plan");
	var releaseJd = paramsOf(world, "departure-leg").releaseJd;
	assert.equal(plan.handoffWindowDays, 1);
	// release leads departure.jd by the departure-estimate module's own
	// figure for this spec — same source, so they must agree exactly
	var DE = await import("../departure-estimate.js");
	var ref = Frames.bodyHelioState(Frames.escapeReferenceFor(spec.origin), plan.departure.jd);
	var est = DE.estimateDeparture({
		origin: spec.origin,
		vInfVec: O.vSub(plan.departure.v, ref.v),
		jdHandoff: plan.departure.jd
	});
	assert.ok(est.ok);
	assert.ok(Math.abs(releaseJd - est.jdLaunch) < 1e-9);
	assert.ok(releaseJd < plan.departure.jd);
	// a 2.94 km/s injection is day-scale, not hour- or month-scale
	var leadDays = plan.departure.jd - releaseJd;
	assert.ok(leadDays > 1 && leadDays < 10, "lead " + leadDays.toFixed(2) + " d");
});

test("a custom windowDays is honoured; a waypoint-only plan releases at the hand-off itself", () => {
	var spec = makeSpec();
	spec.windowDays = 2.5;
	assert.equal(paramsOf(freezeMissionWorld(spec), "frozen-plan").handoffWindowDays, 2.5);

	var spec2 = makeSpec();
	spec2.handoff = handoffFor(spec2.jd, "Moon", { pro: 0, rad: 0, nrm: 0 });   // v∞ ~ 0, nothing to time
	var world2 = freezeMissionWorld(spec2);
	assert.equal(paramsOf(world2, "departure-leg").releaseJd, spec2.jd);
	assert.equal(paramsOf(world2, "frozen-plan").handoffWindowDays, 1);
});

test("waypoint days are already hand-off-relative and pass through untouched", () => {
	var spec = makeSpec();
	spec.waypoints = [
		{ days: 60, burn: { pro: 120 } },
		{ days: 190, burn: { nrm: -80 } }
	];
	var data = freezeMissionWorld(spec);
	var plan = paramsOf(data, "frozen-plan"), leg = paramsOf(data, "transfer-leg");
	assert.deepEqual(leg.waypoints.map(w => Math.round(w.burn.pro)), [120, 0]);
	assert.deepEqual(leg.waypoints.map(w => w.days), [60, 190]);
	// each waypoint fires at the epoch it was authored for
	leg.waypoints.forEach(function (wp, i) {
		var authored = spec.jd + [60, 190][i];
		assert.ok(Math.abs((plan.departure.jd + wp.days) - authored) < 1e-9);
	});
	// and the rendezvous still lands where the marker put it
	assert.ok(Math.abs((plan.departure.jd + leg.legDays) - spec.arrivalJd) < 1e-9);
});
