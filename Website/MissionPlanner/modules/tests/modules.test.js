// Node tests for the first two mission modules' headless side: the
// lunar-skyhook technology module and the transfer-leg module, chained
// through the real World + registry + recompute engine. Run from the repo
// root:
//   node --test Website/MissionPlanner/modules/tests/modules.test.js
// The view hooks (init/draw) are browser-only and not exercised here.

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld, deserializeWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import skyhook, { computeRelease, defaultParams as skyhookDefaults } from "../lunar-skyhook/lunar-skyhook.js";
import frozenPlan from "../frozen-plan/frozen-plan.js";
import transferLeg, { computeLeg, MISS_WARN_AU } from "../transfer-leg/transfer-leg.js";
import { defaultMission } from "../../presets/default-mission.js";
import { encodeFragment, decodeFragment } from "../../../Shared/exchange.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

// The worked example's release epoch (2031-12-20 06:00 UT) — the module
// defaults are the example's values, so tests pin the same date.
var JD_RELEASE = O.julianDate(2031, 12, 20, 6, 0, 0);

function makeRegistry() {
	var reg = createRegistry();
	reg.register(skyhook);
	reg.register(frozenPlan);
	reg.register(transferLeg);
	return reg;
}

function makeChain(skyhookParams, legParams) {
	var world = createWorld({ jd: JD_RELEASE });
	var ids = {};
	ids.skyhook = world.set({ addStage: { moduleId: "lunar-skyhook", params: skyhookParams } });
	ids.leg = world.set({ addStage: { moduleId: "transfer-leg", params: legParams } });
	var engine = createEngine(world, makeRegistry());
	return { world: world, engine: engine, ids: ids };
}

// ---- computeRelease (pure physics) ----------------------------------------

test("computeRelease: the worked-example geometry escapes the Moon and Earth", function () {
	var phys = computeRelease(skyhookDefaults);   // defaults ARE the example
	assert.equal(phys.ok, true);
	// omega * rRel with CoM at 275 km, release from the top at 6000 km
	assert.ok(phys.vRel > 5900 && phys.vRel < 6100, "release speed ~6.0 km/s, got " + phys.vRel);
	assert.ok(phys.vInfMoon > 5700 && phys.vInfMoon < 6100, "lunar v-inf ~5.9 km/s, got " + phys.vInfMoon);
	assert.ok(phys.vInfEarth > 5000 && phys.vInfEarth < 6000, "Earth v-inf ~5.5 km/s, got " + phys.vInfEarth);
});

test("computeRelease: the release phase aims the escape (2031-12-20 geometry)", function () {
	// Phase 92 deg on this date points the lunar v-infinity within a few
	// degrees of Earth's heliocentric prograde; the post-release orbit is
	// therefore OUTWARD (apoapsis well beyond 1 AU). The same geometry at
	// phase 272 (opposite tangent) must fall inward instead.
	var GM_SUN = systems.get("Sun").GM;
	var aimed = computeRelease(skyhookDefaults);
	var elAimed = O.elementsFromState(GM_SUN, aimed.r, aimed.v);
	var AU = 149597870700;
	assert.ok(elAimed.a * (1 + elAimed.e) / AU > 2.0,
		"aimed apoapsis > 2 AU, got " + (elAimed.a * (1 + elAimed.e) / AU).toFixed(2));

	var opposite = computeRelease(Object.assign({}, skyhookDefaults, { releasePhaseDeg: 272 }));
	assert.equal(opposite.ok, true);   // still escapes Earth (5.9 km/s dwarfs the losses)
	var elOpp = O.elementsFromState(GM_SUN, opposite.r, opposite.v);
	assert.ok(elOpp.a * (1 - elOpp.e) < elAimed.a * (1 - elAimed.e),
		"opposite-phase periapsis falls inside the aimed one");
});

test("computeRelease: emits ordered flight milestones (release < Moon SOI < Earth SOI)", function () {
	var phys = computeRelease(skyhookDefaults);
	assert.ok(phys.moonSoiJd != null && phys.earthSoiJd != null, "both SOI milestones resolve");
	assert.ok(phys.moonSoiJd > phys.releaseJd, "Moon SOI exit is after release");
	assert.ok(phys.earthSoiJd > phys.moonSoiJd, "Earth SOI exit is after Moon SOI exit");
	// Moon SOI exit within a few hours; Earth SOI exit within a few days —
	// the very different gaps are what make the departure slider event-scaled.
	var hMoon = (phys.moonSoiJd - phys.releaseJd) * 24;
	var dEarth = phys.earthSoiJd - phys.releaseJd;
	assert.ok(hMoon > 1 && hMoon < 12, "Moon SOI exit ~hours, got " + hMoon.toFixed(2) + " h");
	assert.ok(dEarth > 0.5 && dEarth < 10, "Earth SOI exit ~days, got " + dEarth.toFixed(2) + " d");
});

test("coastTimeToRadius: dt lands the propagated state on the target radius", function () {
	// Hyperbolic escape: coast from a 7000 km periapsis out to 66 000 km.
	var GM = systems.get("Moon").GM;
	var dt = O.coastTimeToRadius(GM, [7.0e6, 0, 0], [0, 6000, 0], 66.0e6);
	assert.ok(dt > 0);
	assert.ok(Math.abs(O.vMag(O.propagateState(GM, [7.0e6, 0, 0], [0, 6000, 0], dt).r) - 66.0e6) < 1, "lands at 66 000 km");
	// A radius inside periapsis, or beyond a bound orbit's apoapsis, is unreachable.
	var GMe = systems.get("Earth").GM;
	assert.equal(O.coastTimeToRadius(GMe, [7.0e6, 0, 0], [0, 9000, 0], 5.0e6), null);
	assert.equal(O.coastTimeToRadius(GMe, [7.0e6, 0, 0], [0, 9000, 0], 1.0e9), null);
});

test("computeRelease: a low release point is bound at the Moon, with a fix", function () {
	var phys = computeRelease(Object.assign({}, skyhookDefaults,
		{ relAlt: 300e3, releaseJd: JD_RELEASE }));
	assert.equal(phys.ok, false);
	assert.equal(phys.diagnostic.code, "bound-at-moon");
	assert.ok(phys.diagnostic.fix.indexOf("km") !== -1);
});

test("computeRelease: rejects a release point beyond the tether top", function () {
	var phys = computeRelease(Object.assign({}, skyhookDefaults,
		{ relAlt: 7000e3, releaseJd: JD_RELEASE }));
	assert.equal(phys.ok, false);
	assert.equal(phys.diagnostic.code, "bad-params");
});

// ---- computeLeg (pure chain) -----------------------------------------------

var HELIO_START = (function () {
	var e = O.bodyStateAtJD(systems.get("Sun").GM, systems.get("Earth").orbit, JD_RELEASE);
	return { r: e.r, v: O.vAdd(e.v, O.vScale(O.vUnit(e.v), 1200)), jd: JD_RELEASE, frame: "helio", dvUsed: 0 };
})();

test("computeLeg: propagates, applies burns, accumulates dv, reports miss", function () {
	var leg = computeLeg({
		burn: { pro: 3000, rad: 0, nrm: 0 },
		waypoints: [{ days: 120, burn: { pro: 500, rad: 0, nrm: 0 } }],
		legDays: 480, destination: "Ceres"
	}, HELIO_START);
	assert.equal(leg.ok, true);
	assert.equal(leg.totalDv, 3500);
	assert.equal(leg.end.jd, JD_RELEASE + 480);
	assert.ok(leg.samples.length > 200);
	assert.ok(typeof leg.miss === "number" && leg.miss >= 0);
	// events: departure burn + waypoint burn + leg end
	assert.equal(leg.events.length, 3);
});

test("computeLeg: waypoint outside the leg is a diagnostic", function () {
	var leg = computeLeg({
		burn: { pro: 0, rad: 0, nrm: 0 },
		waypoints: [{ days: 500, burn: { pro: 0, rad: 0, nrm: 0 } }],
		legDays: 480, destination: ""
	}, HELIO_START);
	assert.equal(leg.ok, false);
	assert.equal(leg.diagnostic.code, "waypoint-outside-leg");
});

// ---- the chained profile through the engine --------------------------------

test("chain: skyhook release feeds the transfer leg; both ok", function () {
	var c = makeChain(
		{ releaseJd: JD_RELEASE },
		{ burn: { pro: 3000, rad: 0, nrm: 0 }, waypoints: [], legDays: 480, destination: "" });
	var r1 = c.engine.resultFor(c.ids.skyhook);
	var r2 = c.engine.resultFor(c.ids.leg);
	assert.equal(r1.status, "ok");
	assert.equal(r1.output.type, "ship-state");
	assert.equal(r1.output.data.frame, "helio");
	// release + the two flight milestones (Moon-SOI exit, Earth-SOI exit)
	assert.equal(r1.events.length, 3);
	assert.equal(r2.status, "ok");
	assert.equal(r2.output.data.jd, JD_RELEASE + 480);
	assert.equal(r2.output.data.dvUsed, 3000);
});

test("chain: a bound-at-moon skyhook blocks the leg, params intact", function () {
	var c = makeChain(
		{ relAlt: 100e3, releaseJd: JD_RELEASE },
		{ burn: { pro: 3000, rad: 0, nrm: 0 }, waypoints: [], legDays: 480, destination: "" });
	var r1 = c.engine.resultFor(c.ids.skyhook);
	var r2 = c.engine.resultFor(c.ids.leg);
	assert.equal(r1.status, "diagnostic");
	assert.equal(r1.diagnostic.code, "bound-at-moon");
	assert.equal(r2.status, "blocked");
	assert.equal(r2.blockedOn, c.ids.skyhook);
	assert.equal(c.world.getStage(c.ids.leg).params.legDays, 480);
	// fixing the release altitude unblocks the whole chain
	c.world.set({ stage: c.ids.skyhook, params: { relAlt: 6000e3 } });
	assert.equal(c.engine.resultFor(c.ids.leg).status, "ok");
});

test("chain: missing a destination by a lot is a WARNING, not a block", function () {
	var c = makeChain(
		{ releaseJd: JD_RELEASE },
		{ burn: { pro: 1000, rad: 0, nrm: 0 }, waypoints: [], legDays: 200, destination: "Ceres" });
	var r2 = c.engine.resultFor(c.ids.leg);
	assert.equal(r2.status, "ok");
	assert.equal(r2.warnings.length, 1);
	assert.equal(r2.warnings[0].code, "misses-destination");
	assert.ok(r2.warnings[0].values.missAU > MISS_WARN_AU);
	assert.ok(r2.output !== null, "the leg still emits its output while warning");
});

test("chain: a transfer leg with nothing upstream is missing-input", function () {
	var world = createWorld({ jd: JD_RELEASE });
	var id = world.set({ addStage: { moduleId: "transfer-leg", params: {} } });
	var engine = createEngine(world, makeRegistry());
	var r = engine.resultFor(id);
	assert.equal(r.status, "diagnostic");
	assert.equal(r.diagnostic.code, "missing-input");
});

test("chain: moving the clock recomputes but does not change the mission", function () {
	var c = makeChain(
		{ releaseJd: JD_RELEASE },
		{ burn: { pro: 3000, rad: 0, nrm: 0 }, waypoints: [], legDays: 480, destination: "" });
	var before = c.engine.resultFor(c.ids.leg).output.data.r.slice();
	c.world.set({ jd: JD_RELEASE + 100 });   // the viewing clock, not the release epoch
	var after = c.engine.resultFor(c.ids.leg).output.data.r;
	assert.deepEqual(after, before);
});

// ---- the shipped worked-example preset (step 4.4) ---------------------------

test("preset: deserializes and genuinely rendezvouses (no warnings)", function () {
	var res = deserializeWorld(defaultMission);
	assert.equal(res.ok, true, res.reason);
	var engine = createEngine(res.world, makeRegistry());
	var stages = res.world.stages();
	assert.equal(stages.length, 3);   // skyhook → frozen-plan (C1) → transfer-leg
	stages.forEach(function (s) {
		var r = engine.resultFor(s.id);
		assert.equal(r.status, "ok", s.moduleId);
		assert.equal(r.warnings.length, 0, s.moduleId + " must comply and arrive: " +
			JSON.stringify(r.warnings.map(function (w) { return w.message; })));
	});
	// arrival: release + 750 days = 2034-01-08
	var arr = O.dateFromJulian(engine.resultFor(stages[2].id).output.data.jd);
	assert.deepEqual([arr.Y, arr.Mo, arr.D], [2034, 1, 8]);
});

test("preset: survives the share-link fragment round trip", function () {
	var res = deserializeWorld(defaultMission);
	var frag = encodeFragment(res.world.serialize());
	var back = deserializeWorld(decodeFragment(frag));
	assert.equal(back.ok, true);
	assert.deepEqual(back.world.serialize(), res.world.serialize());
});

test("transfer-leg update: converts a body-frame input to helio", function () {
	// Hand the leg a ship-state expressed relative to Earth; the module must
	// lift it to helio before propagating.
	var reg = makeRegistry();
	var earth = O.bodyStateAtJD(systems.get("Sun").GM, systems.get("Earth").orbit, JD_RELEASE);
	var local = { r: [3.844e8, 0, 0], v: [0, 1500, 0], jd: JD_RELEASE, frame: "body:Earth" };
	var input = { kind: "moonwards-packet", type: "ship-state", version: 1, source: {}, data: local };
	var out = reg.get("transfer-leg").update(
		{ world: null, jd: JD_RELEASE, stageId: "stg-t", params: { burn: { pro: 0, rad: 0, nrm: 0 }, waypoints: [], legDays: 10, destination: "" } },
		input);
	assert.equal(out.packet.data.frame, "helio");
	// The starting point of the propagation was ~Earth's position + 3.844e8 m.
	var startR = out.packet.data.r;   // after 10 days it has moved, but stays near 1 AU
	assert.ok(Math.abs(O.vMag(startR) - O.vMag(earth.r)) < 0.2 * O.vMag(earth.r));
});
