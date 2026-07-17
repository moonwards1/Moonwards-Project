// Node tests for the mission modules' headless side: the departure carrier
// chain (moon-platform → lunar-skyhook → departure-leg, task I3) and the
// transfer-leg module, chained through the real World + registry + recompute
// engine. Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/modules.test.js
// The view hooks (init/draw) are browser-only and not exercised here.

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld, deserializeWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import moonPlatform, { moonFigures } from "../moon-platform/moon-platform.js";
import skyhook, { tetherKinematics, rotorFor, defaultParams as skyhookDefaults } from "../lunar-skyhook/lunar-skyhook.js";
import departureLeg, { computeDepartureLeg } from "../departure-leg/departure-leg.js";
import frozenPlan from "../frozen-plan/frozen-plan.js";
import transferLeg, { computeLeg, stateAtElapsed, MISS_WARN_AU } from "../transfer-leg/transfer-leg.js";
import { defaultMission } from "../../presets/default-mission.js";
import { encodeFragment, decodeFragment } from "../../../Shared/exchange.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { SOI_EARTH } from "../../../Shared/geo-leg.js";

// The shipped preset's release anchor (2031-12-17 ~19:07 UT — the frozen
// plan's baked releaseAnchorJd; presets/default-mission.js's header records
// the bake) and its committed hand-off epoch.
var JD_ANCHOR = 2463218.546734214;
var JD_HANDOFF = 2463220.75;
var DAY = 86400;

function makeRegistry() {
	var reg = createRegistry();
	reg.register(moonPlatform);
	reg.register(skyhook);
	reg.register(departureLeg);
	reg.register(frozenPlan);
	reg.register(transferLeg);
	return reg;
}

// A departure chain + coast with NO frozen plan: the release anchor resolves
// through releaseAnchorFor's LEGACY fallback — a releaseJd param left on the
// skyhook stage, exactly what a pre-I3 save carries through migration.
function makeChain(skyhookParams, legParams) {
	var world = createWorld({ jd: JD_ANCHOR });
	var ids = {};
	ids.moon = world.set({ addStage: { moduleId: "moon-platform", params: {} } });
	ids.skyhook = world.set({ addStage: { moduleId: "lunar-skyhook", params: skyhookParams } });
	ids.dep = world.set({ addStage: { moduleId: "departure-leg", params: {} } });
	ids.leg = world.set({ addStage: { moduleId: "transfer-leg", params: legParams } });
	var engine = createEngine(world, makeRegistry());
	return { world: world, engine: engine, ids: ids };
}

// ---- tetherKinematics + rotorFor (pure carrier geometry) --------------------

test("tetherKinematics: the worked-example geometry spins clear of lunar escape", function () {
	var kin = tetherKinematics(skyhookDefaults);   // defaults ARE the example
	assert.equal(kin.ok, true);
	// omega * rRel with CoM at 275 km, release from the top at 6000 km
	assert.ok(kin.vRel > 5900 && kin.vRel < 6100, "release speed ~6.0 km/s, got " + kin.vRel);
	assert.ok(kin.vInfMoon > 5700 && kin.vInfMoon < 6100, "lunar v-inf ~5.9 km/s, got " + kin.vInfMoon);
	assert.ok(kin.period > 0 && kin.period < 24 * 3600, "rotation period under a day");
});

test("tetherKinematics: a low release point is bound at the Moon, with a fix", function () {
	var kin = tetherKinematics(Object.assign({}, skyhookDefaults, { relAlt: 300e3 }));
	assert.equal(kin.ok, false);
	assert.equal(kin.diagnostic.code, "bound-at-moon");
	assert.ok(kin.diagnostic.fix.indexOf("km") !== -1);
});

test("tetherKinematics: rejects a release point beyond the tether top", function () {
	var kin = tetherKinematics(Object.assign({}, skyhookDefaults, { relAlt: 7000e3 }));
	assert.equal(kin.ok, false);
	assert.equal(kin.diagnostic.code, "bad-params");
});

test("rotorFor: the kinematic-chain rotor pins the release phase at the anchor", function () {
	var kin = tetherKinematics(skyhookDefaults);
	var rotor = rotorFor(kin, JD_ANCHOR);
	assert.deepEqual(rotor.normal, [0, 0, 1]);   // ecliptic plane, plotter convention
	assert.deepEqual(rotor.ref, [1, 0, 0]);
	assert.equal(rotor.radius, kin.rRel);
	assert.equal(rotor.rate, kin.omega);
	assert.ok(Math.abs(rotor.phase0 - 92 * Math.PI / 180) < 1e-12);
	assert.equal(rotor.epoch, JD_ANCHOR);
});

// ---- moonFigures (the read-only Moon card's readouts) -----------------------

test("moonFigures: the Moon's heading/impulse contribution at the anchor", function () {
	var fig = moonFigures(JD_ANCHOR);
	assert.ok(fig.dist > 3.5e8 && fig.dist < 4.1e8, "lunar distance, got " + fig.dist);
	assert.ok(fig.speed > 900 && fig.speed < 1150, "~1 km/s geocentric, got " + fig.speed);
	assert.ok(Math.abs(fig.prograde) <= fig.speed, "prograde component is a component");
});

// ---- computeDepartureLeg (pure integrated flight) ---------------------------

// The preset's own carrier chain, hand-built.
function presetChainData() {
	var kin = tetherKinematics(skyhookDefaults);
	return { base: "Moon", rotors: [rotorFor(kin, JD_ANCHOR)] };
}

test("departure flight: the preset chain escapes to a hand-off at Earth-SOI exit", function () {
	var leg = computeDepartureLeg({ waypoints: [] }, presetChainData(), JD_ANCHOR);
	assert.equal(leg.ok, true);
	// The I3 experiment's figures (2026-07-16): v∞ ≈ 4.93 km/s asymptotic,
	// SOI exit ≈ 2.72 d after release — 0.51 d late against the committed
	// hand-off, inside the ±1 d window.
	assert.ok(leg.vinfEarth > 4500 && leg.vinfEarth < 5500, "v∞ ~4.9 km/s, got " + leg.vinfEarth);
	var flightDays = leg.handoff.tSoi / DAY;
	assert.ok(flightDays > 2 && flightDays < 3.5, "flight ~2.7 d, got " + flightDays);
	assert.ok(Math.abs(leg.handoff.jd - JD_HANDOFF) < 1, "hand-off inside the ±1 d window, off by " +
		(leg.handoff.jd - JD_HANDOFF).toFixed(3) + " d");
	// The flight is truncated at the hand-off: its last sample IS the SOI exit.
	var last = leg.samples[leg.samples.length - 1];
	assert.ok(Math.abs(Math.hypot(last.r[0], last.r[1], last.r[2]) - SOI_EARTH) < 1e4,
		"last sample sits on Earth's SOI");
	assert.equal(last.t, leg.handoff.tSoi);
	// Events in flight order: release, Moon SOI exit, hand-off.
	assert.equal(leg.events.length, 3);
	assert.match(leg.events[0].label, /Release/);
	assert.match(leg.events[1].label, /Moon SOI exit/);
	assert.match(leg.events[2].label, /hand-off/);
	assert.ok(leg.events[0].jd < leg.events[1].jd && leg.events[1].jd < leg.events[2].jd);
});

test("departure flight: a prograde waypoint impulse raises the delivered v∞", function () {
	var plain = computeDepartureLeg({ waypoints: [] }, presetChainData(), JD_ANCHOR);
	var boosted = computeDepartureLeg({
		waypoints: [{ t: 12 * 3600, burn: { pro: 300, rad: 0, nrm: 0 } }]
	}, presetChainData(), JD_ANCHOR);
	assert.equal(boosted.ok, true);
	assert.equal(boosted.totalDv, 300);
	assert.ok(boosted.vinfEarth > plain.vinfEarth, "prograde impulse adds energy");
	assert.ok(boosted.events.some(function (e) { return /Waypoint impulse/.test(e.label); }));
});

test("departure flight: a waypoint outside the integrated flight is a diagnostic", function () {
	var leg = computeDepartureLeg({
		waypoints: [{ t: 400 * DAY, burn: { pro: 0, rad: 0, nrm: 0 } }]
	}, presetChainData(), JD_ANCHOR);
	assert.equal(leg.ok, false);
	assert.equal(leg.diagnostic.code, "waypoint-outside-leg");
});

test("departure flight: a Moon-bound release has no hand-off", function () {
	// A slow rotor: 900 m/s at the release radius is below lunar escape, so
	// the integrated flight stays a lunar orbit — bound, no hand-off. (The
	// skyhook module itself diagnoses this earlier via tetherKinematics; this
	// exercises departure-leg's own honesty for chains that slip past that.)
	var kin = tetherKinematics(skyhookDefaults);
	var slow = { base: "Moon", rotors: [Object.assign({}, rotorFor(kin, JD_ANCHOR),
		{ rate: 900 / kin.rRel })] };
	var leg = computeDepartureLeg({ waypoints: [] }, slow, JD_ANCHOR);
	assert.equal(leg.ok, false);
	assert.equal(leg.diagnostic.code, "bound-no-handoff");
	assert.match(leg.diagnostic.message, /Moon/);
});

test("departure flight: a chain with no releasing carrier is a diagnostic", function () {
	var leg = computeDepartureLeg({ waypoints: [] }, { base: "Moon", rotors: [] }, JD_ANCHOR);
	assert.equal(leg.ok, false);
	assert.equal(leg.diagnostic.code, "no-carrier");
});

// ---- computeLeg (pure chain) — unchanged by I3 ------------------------------

var HELIO_START = (function () {
	var e = O.bodyStateAtJD(systems.get("Sun").GM, systems.get("Earth").orbit, JD_HANDOFF);
	return { r: e.r, v: O.vAdd(e.v, O.vScale(O.vUnit(e.v), 1200)), jd: JD_HANDOFF, frame: "helio", dvUsed: 0 };
})();

function boosted(start, proMps) {
	return Object.assign({}, start, { v: O.vAdd(start.v, O.vScale(O.vUnit(start.v), proMps)) });
}

test("computeLeg: propagates from its given start, applies waypoint burns, accumulates dv, reports miss", function () {
	var leg = computeLeg({
		waypoints: [{ days: 120, burn: { pro: 500, rad: 0, nrm: 0 } }],
		legDays: 480, destination: "Ceres"
	}, boosted(HELIO_START, 3000));
	assert.equal(leg.ok, true);
	assert.equal(leg.totalDv, 500);   // only the waypoint burn — none at the coast's own start
	assert.equal(leg.end.jd, JD_HANDOFF + 480);
	assert.ok(leg.samples.length > 200);
	assert.ok(typeof leg.miss === "number" && leg.miss >= 0);
	assert.equal(leg.events.length, 2);
});

test("computeLeg: waypoint outside the leg is a diagnostic", function () {
	var leg = computeLeg({
		waypoints: [{ days: 500, burn: { pro: 0, rad: 0, nrm: 0 } }],
		legDays: 480, destination: ""
	}, HELIO_START);
	assert.equal(leg.ok, false);
	assert.equal(leg.diagnostic.code, "waypoint-outside-leg");
});

// ---- stateAtElapsed (the ship-marker chevron's position source) -----------

test("stateAtElapsed: t=0 matches the coast's own given start state", function () {
	var leg = computeLeg({
		waypoints: [{ days: 120, burn: { pro: 500, rad: 0, nrm: 0 } }],
		legDays: 480, destination: ""
	}, boosted(HELIO_START, 3000));
	var s = stateAtElapsed(leg, 0);
	assert.ok(O.vMag(O.vSub(s.r, leg.segs[0].r0)) < 1);
	assert.ok(O.vMag(O.vSub(s.v, leg.segs[0].v0)) < 1e-6);
});

test("stateAtElapsed: at the leg's full duration matches leg.end exactly", function () {
	var leg = computeLeg({
		waypoints: [{ days: 120, burn: { pro: 500, rad: 0, nrm: 0 } }],
		legDays: 480, destination: ""
	}, boosted(HELIO_START, 3000));
	var s = stateAtElapsed(leg, 480 * 86400);
	assert.ok(O.vMag(O.vSub(s.r, leg.end.r)) < 1);
	assert.ok(O.vMag(O.vSub(s.v, leg.end.v)) < 1e-6);
});

test("stateAtElapsed: mid-segment agrees with a drawn polyline sample at the same t", function () {
	var leg = computeLeg({
		waypoints: [{ days: 120, burn: { pro: 500, rad: 0, nrm: 0 } }],
		legDays: 480, destination: ""
	}, boosted(HELIO_START, 3000));
	var sample = leg.samples[50];   // well inside the first segment
	var s = stateAtElapsed(leg, sample.t);
	assert.ok(O.vMag(O.vSub(s.r, sample.r)) < 1);   // both exact two-body solutions at the same t
});

test("stateAtElapsed: clamps outside the leg's span to its nearest end", function () {
	var leg = computeLeg({
		waypoints: [], legDays: 480, destination: ""
	}, boosted(HELIO_START, 3000));
	var before = stateAtElapsed(leg, -1e6);
	assert.ok(O.vMag(O.vSub(before.r, leg.segs[0].r0)) < 1);
	var after = stateAtElapsed(leg, 480 * 86400 + 1e6);
	assert.ok(O.vMag(O.vSub(after.r, leg.end.r)) < 1);
});

test("stateAtElapsed: a leg with no segments (malformed) returns null", function () {
	assert.equal(stateAtElapsed({ ok: false }, 0), null);
	assert.equal(stateAtElapsed(null, 0), null);
});

// ---- the chained profile through the engine --------------------------------

test("chain: Moon base → skyhook rotor → integrated flight → transfer leg; all ok", function () {
	var c = makeChain(
		Object.assign({}, skyhookDefaults, { releaseJd: JD_ANCHOR }),   // legacy-fallback anchor
		{ waypoints: [], legDays: 480, destination: "" });
	var rMoon = c.engine.resultFor(c.ids.moon);
	var rSky = c.engine.resultFor(c.ids.skyhook);
	var rDep = c.engine.resultFor(c.ids.dep);
	var rLeg = c.engine.resultFor(c.ids.leg);

	assert.equal(rMoon.status, "ok");
	assert.equal(rMoon.output.type, "carrier-chain");
	assert.equal(rMoon.output.data.base, "Moon");
	assert.equal(rMoon.output.data.rotors.length, 0);

	assert.equal(rSky.status, "ok");
	assert.equal(rSky.output.type, "carrier-chain");
	assert.equal(rSky.output.data.rotors.length, 1);
	assert.equal(rSky.output.data.rotors[0].epoch, JD_ANCHOR);

	assert.equal(rDep.status, "ok");
	assert.equal(rDep.output.type, "ship-state");
	assert.equal(rDep.output.data.frame, "helio");
	// hand-off happens the flight's ~2.7 d after the anchor, not at it
	assert.ok(rDep.output.data.jd > JD_ANCHOR + 2 && rDep.output.data.jd < JD_ANCHOR + 3.5);
	// release + Moon SOI exit + hand-off on the departure slider's channel
	assert.equal(rDep.events.length, 3);

	assert.equal(rLeg.status, "ok");
	assert.equal(rLeg.output.data.jd, rDep.output.data.jd + 480);
	assert.equal(rLeg.output.data.dvUsed, 0);
});

test("chain: a bound-at-moon skyhook blocks the flight, params intact", function () {
	var c = makeChain(
		{ relAlt: 100e3, releaseJd: JD_ANCHOR },
		{ waypoints: [], legDays: 480, destination: "" });
	var rSky = c.engine.resultFor(c.ids.skyhook);
	var rDep = c.engine.resultFor(c.ids.dep);
	assert.equal(rSky.status, "diagnostic");
	assert.equal(rSky.diagnostic.code, "bound-at-moon");
	assert.equal(rDep.status, "blocked");
	assert.equal(rDep.blockedOn, c.ids.skyhook);
	assert.equal(c.world.getStage(c.ids.leg).params.legDays, 480);
	// fixing the release altitude unblocks the whole chain
	c.world.set({ stage: c.ids.skyhook, params: { relAlt: 6000e3 } });
	assert.equal(c.engine.resultFor(c.ids.leg).status, "ok");
});

test("chain: no anchor anywhere → moon-platform diagnoses at the top of the stack", function () {
	var c = makeChain(
		{},   // no legacy releaseJd, and no frozen plan in this profile
		{ waypoints: [], legDays: 480, destination: "" });
	var rMoon = c.engine.resultFor(c.ids.moon);
	assert.equal(rMoon.status, "diagnostic");
	assert.equal(rMoon.diagnostic.code, "no-release-anchor");
	assert.equal(c.engine.resultFor(c.ids.skyhook).status, "blocked");
	assert.equal(c.engine.resultFor(c.ids.dep).status, "blocked");
});

test("chain: a transfer leg with nothing upstream is missing-input", function () {
	var world = createWorld({ jd: JD_ANCHOR });
	var id = world.set({ addStage: { moduleId: "transfer-leg", params: {} } });
	var engine = createEngine(world, makeRegistry());
	var r = engine.resultFor(id);
	assert.equal(r.status, "diagnostic");
	assert.equal(r.diagnostic.code, "missing-input");
});

test("chain: moving the clock recomputes but does not change the mission", function () {
	var c = makeChain(
		Object.assign({}, skyhookDefaults, { releaseJd: JD_ANCHOR }),
		{ waypoints: [], legDays: 480, destination: "" });
	var before = c.engine.resultFor(c.ids.leg).output.data.r.slice();
	c.world.set({ jd: JD_ANCHOR + 100 });   // the viewing clock, not the release epoch
	var after = c.engine.resultFor(c.ids.leg).output.data.r;
	assert.deepEqual(after, before);
});

// ---- the shipped worked-example preset (step 4.4, reshaped by I3) -----------

test("preset: deserializes to the carrier-chain profile; the coast genuinely rendezvouses", function () {
	// The integrated departure honestly under-delivers the committed 6.55
	// km/s (the folded-in injection has no modelled tech yet — see the
	// preset's header), but the hand-off lands INSIDE the ±1 d window, so
	// the plan warns on v∞ and aim only. The coast still flies the FROZEN
	// plan's state regardless, so it still arrives clean.
	var res = deserializeWorld(defaultMission);
	assert.equal(res.ok, true, res.reason);
	var engine = createEngine(res.world, makeRegistry());
	var stages = res.world.stages();
	assert.equal(stages.length, 5);
	assert.deepEqual(stages.map(function (s) { return s.moduleId; }),
		["moon-platform", "lunar-skyhook", "departure-leg", "frozen-plan", "transfer-leg"]);

	var rMoon = engine.resultFor(stages[0].id);
	var rSky = engine.resultFor(stages[1].id);
	var rDep = engine.resultFor(stages[2].id);
	var rPlan = engine.resultFor(stages[3].id);
	var rLeg = engine.resultFor(stages[4].id);
	assert.equal(rMoon.status, "ok");
	assert.equal(rSky.status, "ok");
	assert.deepEqual(rSky.warnings, []);
	assert.equal(rDep.status, "ok");
	assert.equal(rPlan.status, "ok");
	assert.deepEqual(rPlan.warnings.map(function (w) { return w.code; }).sort(),
		["aim-mismatch", "vinf-mismatch"]);   // epoch is INSIDE the window — no epoch-mismatch
	assert.equal(rLeg.status, "ok");
	assert.deepEqual(rLeg.warnings, []);

	// arrival: hand-off + 750 days = 2034-01-08
	var arr = O.dateFromJulian(rLeg.output.data.jd);
	assert.deepEqual([arr.Y, arr.Mo, arr.D], [2034, 1, 8]);
});

test("preset: survives the share-link fragment round trip", function () {
	var res = deserializeWorld(defaultMission);
	var frag = encodeFragment(res.world.serialize());
	var back = deserializeWorld(decodeFragment(frag));
	assert.equal(back.ok, true);
	assert.deepEqual(back.world.serialize(), res.world.serialize());
});

// ---- v1 saves: the I3 migration (core/world.js) ------------------------------

// A faithful copy of the PRE-I3 shipped preset: skyhook first (with its old
// releaseJd param), no moon-platform, no departure-leg, a frozen plan with
// neither timing field.
var V1_PRESET = {
	kind: "moonwards-world",
	version: 1,
	jd: 2463220.75,
	nextStage: 4,
	stages: [
		{ id: "stg-1", moduleId: "lunar-skyhook",
		  params: { comAlt: 275e3, topAlt: 6000e3, relAlt: 6000e3,
		            releasePhaseDeg: 92, releaseJd: 2463220.75 } },
		{ id: "stg-3", moduleId: "frozen-plan",
		  params: {
			origin: "Earth",
			departure: {
				r: [5856642340.899307, 147066185880.355, 0],
				v: [-36785.2006878309, 1422.8029976413443, 236.73516629337746],
				jd: 2463220.75
			},
			arrival: { body: "Ceres", jd: 2463970.75, vInf: 3776.34 },
			waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }]
		  } },
		{ id: "stg-2", moduleId: "transfer-leg",
		  params: { waypoints: [{ days: 475, burn: { pro: 2140, rad: -1180, nrm: -2730 } }],
		            legDays: 750, destination: "Ceres" } }
	]
};

test("migration: a v1 save gains moon-platform + departure-leg around its skyhook and still flies", function () {
	var res = deserializeWorld(structuredClone(V1_PRESET));
	assert.equal(res.ok, true, res.reason);
	var stages = res.world.stages();
	assert.deepEqual(stages.map(function (s) { return s.moduleId; }),
		["moon-platform", "lunar-skyhook", "departure-leg", "frozen-plan", "transfer-leg"]);
	// original ids survive; inserted ids are fresh, beyond the old counter
	assert.equal(stages[1].id, "stg-1");
	assert.equal(stages[3].id, "stg-3");
	assert.notEqual(stages[0].id, stages[2].id);
	// the skyhook's params — including the legacy releaseJd — pass through
	assert.equal(stages[1].params.releaseJd, 2463220.75);
	// a re-serialize is version 2 (no double migration on the next load)
	assert.equal(res.world.serialize().version, 2);

	// The migrated mission RUNS: the anchor falls back to the plan's
	// departure.jd (pre-D7 plans have no releaseAnchorJd), so the integrated
	// flight releases at the old hand-off epoch and lands its real hand-off
	// ~2.6 d later — outside the ±1 d default window. Honest warnings, no
	// blocks, and the frozen coast still arrives.
	var engine = createEngine(res.world, makeRegistry());
	stages.forEach(function (s, i) {
		var st = engine.resultFor(s.id).status;
		assert.equal(st, "ok", "stage " + i + " (" + s.moduleId + ") is " + st);
	});
	var planWarnings = engine.resultFor(stages[3].id).warnings.map(function (w) { return w.code; }).sort();
	assert.deepEqual(planWarnings, ["aim-mismatch", "epoch-mismatch", "vinf-mismatch"]);
	var arr = O.dateFromJulian(engine.resultFor(stages[4].id).output.data.jd);
	assert.deepEqual([arr.Y, arr.Mo, arr.D], [2034, 1, 8]);
});

test("migration: v1 saves without a skyhook (freeze-spawned shape) pass through untouched", function () {
	var v1 = { kind: "moonwards-world", version: 1, jd: 2463220.75, nextStage: 3,
		stages: [
			{ id: "stg-1", moduleId: "frozen-plan", params: V1_PRESET.stages[1].params },
			{ id: "stg-2", moduleId: "transfer-leg", params: V1_PRESET.stages[2].params }
		] };
	var res = deserializeWorld(v1);
	assert.equal(res.ok, true);
	assert.deepEqual(res.world.stages().map(function (s) { return s.moduleId; }),
		["frozen-plan", "transfer-leg"]);
});

test("transfer-leg update: converts a body-frame input to helio", function () {
	// Hand the leg a ship-state expressed relative to Earth; the module must
	// lift it to helio before propagating.
	var reg = makeRegistry();
	var earth = O.bodyStateAtJD(systems.get("Sun").GM, systems.get("Earth").orbit, JD_HANDOFF);
	var local = { r: [3.844e8, 0, 0], v: [0, 1500, 0], jd: JD_HANDOFF, frame: "body:Earth" };
	var input = { kind: "moonwards-packet", type: "ship-state", version: 1, source: {}, data: local };
	var out = reg.get("transfer-leg").update(
		{ world: null, jd: JD_HANDOFF, stageId: "stg-t", params: { waypoints: [], legDays: 10, destination: "" } },
		input);
	assert.equal(out.packet.data.frame, "helio");
	// The starting point of the propagation was ~Earth's position + 3.844e8 m.
	var startR = out.packet.data.r;   // after 10 days it has moved, but stays near 1 AU
	assert.ok(Math.abs(O.vMag(startR) - O.vMag(earth.r)) < 0.2 * O.vMag(earth.r));
});
