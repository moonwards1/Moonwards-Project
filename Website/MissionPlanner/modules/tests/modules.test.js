// Node tests for the mission modules' headless side: the departure carrier
// chain (moon-platform → orbital-skyhook → departure-leg) and the transfer-leg
// module, chained through the real World + registry + recompute engine. Run
// from the repo root:
//   node --test Website/MissionPlanner/modules/tests/modules.test.js
// The view hooks (init/draw) are browser-only and not exercised here.

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld, deserializeWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import moonPlatform, { moonFigures } from "../moon-platform/moon-platform.js";
import skyhook, { tetherKinematics, rotorFor } from "../orbital-skyhook/orbital-skyhook.js";
import departureLeg, { computeDepartureLeg, stateAtElapsed as depStateAtElapsed }
	from "../departure-leg/departure-leg.js";
import frozenPlan from "../frozen-plan/frozen-plan.js";
import transferLeg, { computeLeg, stateAtElapsed, degAtDay, dayAtDeg, MISS_WARN_AU,
	handoffPending, commitHandoff, sameWaypoints, copyWaypoints, legFor, nearestApproach }
	from "../transfer-leg/transfer-leg.js";
import { findClosestApproach as findClosestApproachEvent,
	computeArrivalSeam as computeArrivalSeamFor } from "../../core/arrival-seam.js";
import arrivalBoundary, { arrivalComplianceFor } from "../arrival-boundary/arrival-boundary.js";
import arrivalLeg, { legFor as arrivalLegFor } from "../arrival-leg/arrival-leg.js";
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

// The worked-example lunar skyhook geometry (the shipped preset's own values),
// now carried on the unified orbital-skyhook with its `body` named explicitly.
var MOON_SKYHOOK = { body: "Moon", comAlt: 275e3, topAlt: 6000e3, relAlt: 6000e3, releasePhaseDeg: 92 };

function makeRegistry() {
	var reg = createRegistry();
	reg.register(moonPlatform);
	reg.register(skyhook);
	reg.register(departureLeg);
	reg.register(frozenPlan);
	reg.register(transferLeg);
	reg.register(arrivalBoundary);   // the Coast→Arrival compliance boundary
	reg.register(arrivalLeg);    // the preset's terminal stage — the arrival
	                             // flyby leg; arrival tech is empty by default
	return reg;
}

// A departure chain + coast with NO frozen plan: the release anchor resolves
// through releaseAnchorFor's LEGACY fallback — a releaseJd param left on the
// skyhook stage, exactly what a pre-I3 save carries through migration.
function makeChain(skyhookParams, legParams) {
	var world = createWorld({ jd: JD_ANCHOR });
	var ids = {};
	ids.moon = world.set({ addStage: { moduleId: "moon-platform", params: {} } });
	ids.skyhook = world.set({ addStage: { moduleId: "orbital-skyhook",
		params: Object.assign({ body: "Moon" }, skyhookParams) } });
	ids.dep = world.set({ addStage: { moduleId: "departure-leg", params: {} } });
	ids.leg = world.set({ addStage: { moduleId: "transfer-leg", params: legParams } });
	var engine = createEngine(world, makeRegistry());
	return { world: world, engine: engine, ids: ids };
}

// ---- tetherKinematics + rotorFor (pure carrier geometry) --------------------

test("tetherKinematics: the worked-example geometry spins clear of lunar escape", function () {
	var kin = tetherKinematics(MOON_SKYHOOK);   // the worked-example geometry
	assert.equal(kin.ok, true);
	// omega * rRel with CoM at 275 km, release from the top at 6000 km
	assert.ok(kin.vRel > 5900 && kin.vRel < 6100, "release speed ~6.0 km/s, got " + kin.vRel);
	assert.ok(kin.vInfBody > 5700 && kin.vInfBody < 6100, "lunar v-inf ~5.9 km/s, got " + kin.vInfBody);
	assert.ok(kin.period > 0 && kin.period < 24 * 3600, "rotation period under a day");
});

test("tetherKinematics: a low release point is bound at the Moon, with a fix", function () {
	var kin = tetherKinematics(Object.assign({}, MOON_SKYHOOK, { relAlt: 300e3 }));
	assert.equal(kin.ok, false);
	assert.equal(kin.diagnostic.code, "bound-at-body");
	assert.ok(kin.diagnostic.fix.indexOf("km") !== -1);
});

test("tetherKinematics: rejects a release point beyond the tether top", function () {
	var kin = tetherKinematics(Object.assign({}, MOON_SKYHOOK, { relAlt: 7000e3 }));
	assert.equal(kin.ok, false);
	assert.equal(kin.diagnostic.code, "bad-params");
});

test("rotorFor: the kinematic-chain rotor pins the release phase at the anchor", function () {
	var kin = tetherKinematics(MOON_SKYHOOK);
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
	var kin = tetherKinematics(MOON_SKYHOOK);
	return { base: "Moon", rotors: [rotorFor(kin, JD_ANCHOR)] };
}

test("departure flight: the preset chain escapes to a hand-off at Earth-SOI exit", function () {
	var leg = computeDepartureLeg({ waypoints: [] }, presetChainData(), JD_ANCHOR);
	assert.equal(leg.ok, true);
	// The shipped chain's own figures: v∞ ≈ 4.93 km/s asymptotic,
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
	var kin = tetherKinematics(MOON_SKYHOOK);
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

// ---- departure-leg's stateAtElapsed (2.5's chevron position source) --------

test("departure-leg stateAtElapsed: t=0 matches the release state", function () {
	var leg = computeDepartureLeg({ waypoints: [] }, presetChainData(), JD_ANCHOR);
	var s = depStateAtElapsed(leg, 0);
	assert.ok(O.vMag(O.vSub(s.r, leg.samples[0].r)) < 1);
	assert.ok(O.vMag(O.vSub(s.v, leg.samples[0].v)) < 1e-6);
});

test("departure-leg stateAtElapsed: at the hand-off matches leg.handoff exactly", function () {
	var leg = computeDepartureLeg({ waypoints: [] }, presetChainData(), JD_ANCHOR);
	var s = depStateAtElapsed(leg, leg.handoff.tSoi);
	assert.ok(O.vMag(O.vSub(s.r, leg.handoff.r)) < 1);
	assert.ok(O.vMag(O.vSub(s.v, leg.handoff.v)) < 1e-6);
});

test("departure-leg stateAtElapsed: crossing a waypoint impulse still lands on the hand-off", function () {
	var leg = computeDepartureLeg({
		waypoints: [{ t: 12 * 3600, burn: { pro: 300, rad: 0, nrm: 0 } }]
	}, presetChainData(), JD_ANCHOR);
	assert.equal(leg.ok, true);
	var s = depStateAtElapsed(leg, leg.handoff.tSoi);
	assert.ok(O.vMag(O.vSub(s.r, leg.handoff.r)) < 1);
});

test("departure-leg stateAtElapsed: clamps outside the flight's span to its nearest end", function () {
	var leg = computeDepartureLeg({ waypoints: [] }, presetChainData(), JD_ANCHOR);
	var before = depStateAtElapsed(leg, -1e6);
	assert.ok(O.vMag(O.vSub(before.r, leg.samples[0].r)) < 1);
	var after = depStateAtElapsed(leg, leg.handoff.tSoi + 1e6);
	assert.ok(O.vMag(O.vSub(after.r, leg.handoff.r)) < 1);
});

test("departure-leg stateAtElapsed: a malformed/missing leg returns null", function () {
	assert.equal(depStateAtElapsed({ ok: false }, 0), null);
	assert.equal(depStateAtElapsed(null, 0), null);
});

// ---- computeLeg (pure chain) — unchanged by I3 ------------------------------

var HELIO_START = (function () {
	// At Earth's own position with v∞ folded in — the patched-conic departure
	// state frozen-plan really emits. The coast's SOI-encounter pass
	// deliberately ignores a body the arc STARTS inside of until it first
	// leaves that SOI, so this stays a legal coast start.
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

// ---- degAtDay / dayAtDeg (the waypoint card's day<->degree UI conversion) --

test("degAtDay: 0 degrees swept at the leg's own start", function () {
	var leg = computeLeg({ waypoints: [], legDays: 480, destination: "" }, HELIO_START);
	var deg = degAtDay(leg, 0);
	assert.ok(deg < 1e-6 || deg > 360 - 1e-6);   // floating-point straddles the 0/360 wrap
});

test("degAtDay: increases with day (prograde coast sweeps forward around the Sun)", function () {
	var leg = computeLeg({ waypoints: [], legDays: 480, destination: "" }, HELIO_START);
	var d1 = degAtDay(leg, 60), d2 = degAtDay(leg, 240);
	assert.ok(d1 > 0 && d2 > d1);
});

test("dayAtDeg: inverts degAtDay back to (about) the same day", function () {
	var leg = computeLeg({
		waypoints: [{ days: 120, burn: { pro: 500, rad: 0, nrm: 0 } }],
		legDays: 480, destination: ""
	}, boosted(HELIO_START, 3000));
	[30, 120, 300, 450].forEach(function (day) {
		var deg = degAtDay(leg, day);
		var back = dayAtDeg(leg, 480, day, deg);
		assert.ok(Math.abs(back - day) < 0.05, "day " + day + " -> " + deg + "deg -> " + back);
	});
});

test("dayAtDeg: a small degree nudge near a waypoint moves it a small number of days", function () {
	var leg = computeLeg({ waypoints: [], legDays: 480, destination: "" }, HELIO_START);
	var deg = degAtDay(leg, 200);
	var nudged = dayAtDeg(leg, 480, 200, deg + 1);
	assert.ok(nudged > 200 && nudged - 200 < 10);
});

test("degAtDay/dayAtDeg: a malformed or not-ok leg is a safe no-op", function () {
	assert.equal(degAtDay(null, 10), 0);
	assert.equal(degAtDay({ ok: false }, 10), 0);
	assert.equal(dayAtDeg(null, 480, 10, 50), 10);
	assert.equal(dayAtDeg({ ok: false }, 480, 10, 50), 10);
});

// ---- the chained profile through the engine --------------------------------

test("chain: Moon base → skyhook rotor → integrated flight → transfer leg; all ok", function () {
	var c = makeChain(
		Object.assign({}, MOON_SKYHOOK, { releaseJd: JD_ANCHOR }),   // legacy-fallback anchor
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
	assert.equal(rSky.diagnostic.code, "bound-at-body");
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
		Object.assign({}, MOON_SKYHOOK, { releaseJd: JD_ANCHOR }),
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
	assert.equal(stages.length, 7);
	assert.deepEqual(stages.map(function (s) { return s.moduleId; }),
		["moon-platform", "orbital-skyhook", "departure-leg", "frozen-plan", "transfer-leg",
		 "arrival-boundary",   // the far seam's compliance check
		 "arrival-leg"]);      // arrival tech empty by default — the mission ends at the flyby

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

	// the arrival flyby leg: the pass pinned at the delivered
	// arrival epoch, hand-off a day before, end a day after; closest
	// approach at half Ceres's SOI (the reference construction).
	// the terminal stage: the arrival flyby leg, pinned at the
	// delivered arrival epoch, hand-off a day before, end a day after; closest
	// approach at half Ceres's SOI (the reference construction).
	// the arrival boundary between them: the shipped coast flies the FROZEN
	// plan, so it arrives exactly on the commitment — no deviation at all
	var rBound = engine.resultFor(stages[5].id);
	assert.equal(rBound.status, "ok");
	assert.deepEqual(rBound.warnings, []);
	assert.equal(rBound.output, rLeg.output);   // measured, never substituted

	var rArr = engine.resultFor(stages[6].id);
	assert.equal(rArr.status, "ok");
	// The arrival leg ends ARRIVAL_TAIL_DAYS past the measured pass — not past
	// the coast's leg end, which merely happens to sit near it. The pass is the
	// true periapsis and falls a few minutes INSIDE the coast leg.
	var coastPass = nearestApproach(legFor(res.world, stages[4].id), "Ceres");
	assert.ok(coastPass && coastPass.insideSoi, "the shipped coast must reach Ceres");
	assert.ok(Math.abs(rArr.output.data.jd - (coastPass.jd + 1)) < 1e-9);
	assert.ok(coastPass.jd < rLeg.output.data.jd, "closest approach should precede the leg's end");
	assert.ok(rLeg.output.data.jd - coastPass.jd < 0.01, "but only just");

	// THE POINT OF THE SHARED MEASUREMENT: the coast measures the pass to place
	// the arrival window, then the arrival leg integrates that window in the
	// body frame and finds the pass for itself. Two independent routes over
	// different physics must land on the same event, or the phases are once
	// again describing two different passes.
	var aLeg = arrivalLegFor(res.world, stages[6].id);
	assert.ok(aLeg && aLeg.ok, "the arrival leg must have flown");
	assert.equal(aLeg.caAtEdge, false, "the pass must not sit on a window edge");
	var arrCaJd = aLeg.jd0 + aLeg.ca.t / DAY;
	assert.ok(Math.abs(arrCaJd - coastPass.jd) * DAY < 60,
		"epochs differ by " + (Math.abs(arrCaJd - coastPass.jd) * DAY).toFixed(1) + " s");
	assert.ok(Math.abs(aLeg.ca.r - coastPass.rmin) < 5000,
		"distances differ by " + ((aLeg.ca.r - coastPass.rmin) / 1000).toFixed(1) + " km");

	assert.equal(rArr.events.length, 2);   // hand-off, closest approach
	assert.match(rArr.events[0].label, /Arrival hand-off/);
	assert.match(rArr.events[1].label, /Closest approach/);
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
	// v1→v2 wraps the skyhook in the carrier chain; v3→v4 appends the arrival
	// compliance boundary after the coast
	assert.deepEqual(stages.map(function (s) { return s.moduleId; }),
		["moon-platform", "orbital-skyhook", "departure-leg", "frozen-plan", "transfer-leg",
		 "arrival-boundary"]);
	// original ids survive; inserted ids are fresh, beyond the old counter
	assert.equal(stages[1].id, "stg-1");
	assert.equal(stages[3].id, "stg-3");
	assert.notEqual(stages[0].id, stages[2].id);
	assert.equal(stages.filter(function (s) { return s.id === stages[5].id; }).length, 1);
	// the skyhook's params — including the legacy releaseJd — pass through, and
	// the v3 migration adds the explicit body the unified skyhook needs
	assert.equal(stages[1].params.releaseJd, 2463220.75);
	assert.equal(stages[1].params.body, "Moon");
	// a re-serialize is the current version (no double migration on the next load)
	assert.equal(res.world.serialize().version, 4);

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
	// v1→v2 has nothing to wrap (no skyhook); v3→v4 still adds the arrival
	// boundary, because there IS a coast whose delivery can be measured
	assert.deepEqual(res.world.stages().map(function (s) { return s.moduleId; }),
		["frozen-plan", "transfer-leg", "arrival-boundary"]);
});

test("migration: a save with no coast gets no arrival boundary — nothing is delivered to measure", function () {
	var v3 = { kind: "moonwards-world", version: 3, jd: JD_HANDOFF, nextStage: 2,
		stages: [{ id: "stg-1", moduleId: "frozen-plan", params: V1_PRESET.stages[1].params }] };
	var res = deserializeWorld(v3);
	assert.equal(res.ok, true, res.reason);
	assert.deepEqual(res.world.stages().map(function (s) { return s.moduleId; }), ["frozen-plan"]);
	assert.equal(res.world.serialize().version, 4);
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

// ---- computeLeg: SOI encounters — the coast feels every body --------------

import { bodyConstants } from "../../../Shared/body-leg.js";
import { Frames as Fr } from "../../../Shared/frames.js";

test("computeLeg: a pass inside Mars's SOI bends the leg and logs the encounter", function () {
	var c = bodyConstants("Mars");
	var jd = 2463000;
	var b = Fr.bodyHelioState("Mars", jd);
	// Start just outside Mars's SOI, aimed to pass ~0.15 SOI beside it.
	var start = { r: O.vAdd(b.r, [c.SOI * 1.05, c.SOI * 0.15, 0]),
	              v: O.vAdd(b.v, [-4000, 0, 0]), jd: jd, frame: "helio", dvUsed: 0 };
	var leg = computeLeg({ waypoints: [], legDays: 30, destination: "" }, start);
	assert.equal(leg.ok, true);
	var labels = leg.events.map(function (e) { return e.label; }).join(" | ");
	assert.match(labels, /Mars SOI entry/);
	assert.match(labels, /Mars closest approach/);
	assert.match(labels, /Mars SOI exit/);
	// The flyby genuinely bent the path: the end state differs from the pure
	// Sun-only Kepler coast by far more than integration noise.
	var kepler = O.propagateState(systems.get("Sun").GM, start.r, start.v, 30 * 86400);
	assert.ok(O.vMag(O.vSub(leg.end.r, kepler.r)) > 1e7,
		"flyby moved the endpoint " + O.vMag(O.vSub(leg.end.r, kepler.r)) + " m");
	// And the seg chain stays consistent: stateAtElapsed still lands on leg.end.
	var s = stateAtElapsed(leg, 30 * 86400);
	assert.ok(O.vMag(O.vSub(s.r, leg.end.r)) < 1e4);
});

test("computeLeg: a wide miss stays pure Kepler to the metre", function () {
	var c = bodyConstants("Mars");
	var jd = 2463000;
	var b = Fr.bodyHelioState("Mars", jd);
	var start = { r: O.vAdd(b.r, [c.SOI * 1.05, c.SOI * 8, 0]),
	              v: O.vAdd(b.v, [-4000, 0, 0]), jd: jd, frame: "helio", dvUsed: 0 };
	var leg = computeLeg({ waypoints: [], legDays: 30, destination: "" }, start);
	assert.equal(leg.ok, true);
	assert.ok(!leg.events.some(function (e) { return /SOI/.test(e.label); }));
	var kepler = O.propagateState(systems.get("Sun").GM, start.r, start.v, 30 * 86400);
	assert.ok(O.vMag(O.vSub(leg.end.r, kepler.r)) < 1, "no encounter, no deviation");
});

test("computeLeg: aimed dead at Mars the coast reports an impact and truncates", function () {
	var c = bodyConstants("Mars");
	var jd = 2463000;
	var b = Fr.bodyHelioState("Mars", jd);
	var start = { r: O.vAdd(b.r, [c.SOI * 1.05, 0, 0]),
	              v: O.vAdd(b.v, [-4000, 0, 0]), jd: jd, frame: "helio", dvUsed: 0 };
	var leg = computeLeg({ waypoints: [], legDays: 30, destination: "" }, start);
	assert.equal(leg.ok, true);
	assert.ok(leg.impact && leg.impact.body === "Mars");
	assert.ok(leg.end.jd < jd + 30, "leg ends at the impact, not the full duration");
	assert.match(leg.events.map(function (e) { return e.label; }).join(" | "), /Impacts Mars/);
	assert.equal(leg.overrun.length, 0, "nothing coasts past an impact");
});

test("computeLeg: the drawn overrun continues past the leg end (display only)", function () {
	var leg = computeLeg({ waypoints: [], legDays: 480, destination: "" }, boosted(HELIO_START, 3000));
	assert.ok(leg.overrun.length > 10, "overrun sampled: " + leg.overrun.length);
	assert.ok(Math.abs(leg.overrun[0].t - 480 * 86400) < 86400, "starts at the leg end");
	assert.ok(leg.overrun[leg.overrun.length - 1].t > 480 * 86400 + 40 * 86400,
		"long enough to read the pass (48 d for a 480 d leg)");
	// The emitted end state is untouched by the overrun.
	assert.equal(leg.end.jd, HELIO_START.jd + 480);
});

// ---- the Coast hand-off snapshot ------------------------------------------
// Waypoint edits move the drawn coast at once but reach the Arrival phase only
// when the ship card's Update is pressed. transfer-leg carries that as a
// `handoff` param: the waypoint list as of the last commit.

// A coast state well clear of any body, so these tests measure the snapshot
// mechanism and not an encounter.
function plainCoastInput() {
	var jd = 2463000;
	return { kind: "moonwards-packet", type: "ship-state", version: 1, source: {},
		data: { r: [1.2 * 149597870700, 0, 0], v: [0, 24000, 300], jd: jd,
		        frame: "helio", dvUsed: 0 } };
}

function coastUpdate(params) {
	return makeRegistry().get("transfer-leg").update(
		{ world: null, jd: 2463000, stageId: "stg-t", params: params }, plainCoastInput());
}

var WP_A = [{ days: 100, burn: { pro: 0, rad: 0, nrm: 0 } }];
var WP_B = [{ days: 100, burn: { pro: 60, rad: 0, nrm: 0 } }];

test("handoff: null hands off the live waypoints — a save predating the feature is unchanged", function () {
	var withNull = coastUpdate({ waypoints: WP_B, handoff: null, legDays: 300, destination: "" });
	var without = coastUpdate({ waypoints: WP_B, legDays: 300, destination: "" });
	assert.deepEqual(withNull.packet.data.r, without.packet.data.r);
	assert.equal(handoffPending({ waypoints: WP_B, handoff: null }), false);
});

test("handoff: a pending edit moves the live leg but not the emitted packet", function () {
	// Committed at WP_A, live at WP_B: the packet must still be the WP_A flight.
	var pending = coastUpdate({ waypoints: WP_B, handoff: WP_A, legDays: 300, destination: "" });
	var committed = coastUpdate({ waypoints: WP_A, handoff: null, legDays: 300, destination: "" });
	var live = coastUpdate({ waypoints: WP_B, handoff: null, legDays: 300, destination: "" });
	assert.deepEqual(pending.packet.data.r, committed.packet.data.r,
		"the packet followed the pending edit instead of the hand-off");
	assert.ok(O.vMag(O.vSub(live.packet.data.r, committed.packet.data.r)) > 1e8,
		"the two waypoint settings should give visibly different flights");
	assert.equal(handoffPending({ waypoints: WP_B, handoff: WP_A }), true);
});

test("handoff: dvUsed follows the hand-off, not the pending burn", function () {
	var pending = coastUpdate({ waypoints: WP_B, handoff: WP_A, legDays: 300, destination: "" });
	assert.equal(pending.packet.data.dvUsed, 0, "WP_A is a zero burn");
});

test("handoff: editing back to the committed values clears the pending state", function () {
	assert.equal(handoffPending({ waypoints: WP_A, handoff: WP_A }), false);
	// Same numbers, different objects — the comparison is by value.
	assert.equal(handoffPending({ waypoints: copyWaypoints(WP_A), handoff: WP_A }), false);
	assert.equal(sameWaypoints(WP_A, WP_B), false);
	assert.equal(sameWaypoints(WP_A, []), false);
});

test("handoff: commitHandoff snapshots the live waypoints and clears pending", function () {
	var world = createWorld({ jd: 2463000 });
	var id = world.set({ addStage: { moduleId: "transfer-leg",
		params: { waypoints: copyWaypoints(WP_B), handoff: copyWaypoints(WP_A),
		          legDays: 300, destination: "" } } });
	assert.equal(handoffPending(world.getStage(id).params), true);
	commitHandoff(world, id);
	assert.equal(handoffPending(world.getStage(id).params), false);
	assert.deepEqual(world.getStage(id).params.handoff, copyWaypoints(WP_B));
	// The snapshot must not alias the live list, or a later edit would silently
	// move the hand-off with it.
	world.getStage(id).params.waypoints[0].burn.pro = 999;
	assert.equal(world.getStage(id).params.handoff[0].burn.pro, 60);
});

test("handoff: the arrival phase runs on the committed coast, not the pending one", function () {
	// The shipped chain: plan → coast → boundary → arrival leg. With an edit
	// pending, nothing downstream of the coast may move.
	function build(waypoints, handoff) {
		var res = deserializeWorld(defaultMission);
		assert.equal(res.ok, true, res.reason);
		var world = res.world;
		var coast = world.stages().filter(function (s) {
			return s.moduleId === "transfer-leg"; })[0];
		world.set({ stage: coast.id, params: { waypoints: waypoints, handoff: handoff } });
		var engine = createEngine(world, makeRegistry());
		var arrival = world.stages().filter(function (s) {
			return s.moduleId === "arrival-leg"; })[0];
		// Position, not epoch: the arrival leg's end epoch is pinned to the seam
		// window's right edge, so it barely moves even when the pass does.
		return { coast: engine.resultFor(coast.id).output.data.r,
		         arrival: engine.resultFor(arrival.id).output.data.r };
	}
	var committedOnly = build(copyWaypoints(WP_A), null);
	var pending = build(copyWaypoints(WP_B), copyWaypoints(WP_A));
	var liveCommitted = build(copyWaypoints(WP_B), null);
	assert.deepEqual(pending.coast, committedOnly.coast,
		"a pending edit reached the arrival boundary");
	assert.deepEqual(pending.arrival, committedOnly.arrival,
		"a pending edit moved the arrival leg");
	assert.ok(O.vMag(O.vSub(liveCommitted.arrival, committedOnly.arrival)) > 1e6,
		"WP_B should genuinely move the arrival phase once committed");
});

// ---- nearestApproach: one continuous measurement of the pass ---------------
// The Coast ship card's closest-approach figure. The bug these pin: reading the
// nearest POLYLINE SAMPLE made the figure jump by tens of thousands of km the
// moment a waypoint nudge walked the pass out of the destination's SOI, because
// outside an SOI the samples are a Kepler point per day and at a few km/s that
// is hundreds of thousands of km apart.

function ceresLeg(deltaPro) {
	var res = deserializeWorld(defaultMission);
	assert.equal(res.ok, true, res.reason);
	var world = res.world;
	var coast = world.stages().filter(function (s) { return s.moduleId === "transfer-leg"; })[0];
	var wps = JSON.parse(JSON.stringify(coast.params.waypoints));
	wps[0].burn.pro += deltaPro;
	world.set({ stage: coast.id, params: { waypoints: wps, handoff: null } });
	createEngine(world, makeRegistry());
	return legFor(world, coast.id);
}

test("nearestApproach: agrees with the integrated encounter's own rmin", function () {
	var leg = ceresLeg(0);
	var na = nearestApproach(leg, "Ceres");
	var ca = findClosestApproachEvent(leg.events, "Ceres");
	assert.ok(na && ca, "expected both an encounter event and a measurement");
	// Two independent routes to the same number: integrateEncounter's refined
	// rmin, and a ternary search over the seg chain it produced.
	assert.ok(Math.abs(na.rmin - ca.rmin) / ca.rmin < 0.002,
		"rmin " + na.rmin + " vs event " + ca.rmin);
	assert.ok(Math.abs(na.jd - ca.jd) < 0.01, "epochs differ by " + (na.jd - ca.jd) + " d");
	assert.equal(na.insideSoi, true);
});

test("nearestApproach: continuous across the SOI boundary", function () {
	// Walk the waypoint's prograde impulse down through the value where the arc
	// stops entering Ceres's SOI. Sampling the polyline used to leap from
	// ~25,000 km to ~78,000 km here on a 0.05 m/s step.
	var deltas = [-3, -3.1, -3.15, -3.2, -3.25, -3.3, -3.5];
	var vals = deltas.map(function (d) { return nearestApproach(ceresLeg(d), "Ceres"); });
	vals.forEach(function (v, i) { assert.ok(v, "no measurement at " + deltas[i]); });
	for (var i = 1; i < vals.length; i++) {
		// Monotonic: reducing the impulse can only widen the pass here.
		assert.ok(vals[i].rmin > vals[i - 1].rmin,
			"not monotonic at " + deltas[i] + ": " + vals[i].rmin + " after " + vals[i - 1].rmin);
		// And smooth — no step may exceed a few hundred km per 0.05 m/s, which a
		// branch change would blow through by two orders of magnitude.
		var perMps = (vals[i].rmin - vals[i - 1].rmin) / Math.abs(deltas[i] - deltas[i - 1]);
		assert.ok(perMps < 5e6, "jump of " + (perMps / 1000) + " km per m/s at " + deltas[i]);
	}
});

test("nearestApproach: finds a pass that falls past the leg's own end", function () {
	// A bigger prograde impulse moves closest approach into the display overrun.
	// The emitted event cannot see it (the encounter scan stops at the leg
	// boundary), but the drawn arc goes there and so must the readout.
	var leg = ceresLeg(6);
	var na = nearestApproach(leg, "Ceres");
	assert.ok(na, "expected a measurement");
	assert.equal(na.pastLegEnd, true);
	assert.ok(na.rmin < 1e7, "expected a close pass, got " + na.rmin + " m");
	// Sanity: the reported state really is that distance from Ceres.
	assert.ok(Math.abs(O.vMag(na.rRel) - na.rmin) < 1, "rRel disagrees with rmin");
});

test("nearestApproach: safe on a leg with no destination, body, or segs", function () {
	var leg = ceresLeg(0);
	assert.equal(nearestApproach(leg, ""), null);
	assert.equal(nearestApproach(leg, "Nowhere"), null);
	assert.equal(nearestApproach(null, "Ceres"), null);
	assert.equal(nearestApproach({ ok: true, segs: [] }, "Ceres"), null);
});

test("seam: the arrival window follows the pass continuously as the coast is tuned", function () {
	// The regression this whole shared-measurement change exists for. The seam
	// used to be hung on the emitted closest-approach EVENT, which vanished
	// whenever the pass climbed back out of the SOI before the leg's end — the
	// window then silently collapsed onto the plan's committed epoch and the
	// Arrival phase was placed on the wrong days. Walking the impulse through
	// that band, the window must stay an encounter window and move smoothly.
	var deltas = [-3, -3.1, -3.2, -3.3, -3.5, -4];
	var prev = null;
	deltas.forEach(function (d) {
		var leg = ceresLeg(d);
		var pass = nearestApproach(leg, "Ceres");
		var seam = computeArrivalSeamFor({ destination: "Ceres", pass: pass,
			fallbackArrivalJd: leg.end.jd + 500 });   // a fallback so wrong it cannot hide
		assert.equal(seam.hasEncounter, true, "seam lost the encounter at " + d);
		assert.ok(Math.abs(seam.jd - leg.end.jd) < 5,
			"window ran away to the fallback at " + d);
		if (prev !== null) {
			assert.ok(Math.abs(seam.jd - prev) < 0.05,
				"window jumped " + ((seam.jd - prev) * 24).toFixed(2) + " h at " + d);
		}
		prev = seam.jd;
	});
});

test("seam: an SOI entry is detected even when the leg ends just outside it", function () {
	// The detector's own end-of-window case. A pass whose periapsis falls inside
	// the leg but which has climbed back out of the SOI by the leg's end used to
	// be rejected outright — so the body's gravity was never applied to the arc
	// at all, not merely mis-reported.
	var leg = ceresLeg(-3.5);
	var labels = leg.events.map(function (e) { return e.label; }).join(" | ");
	assert.match(labels, /Ceres SOI entry/);
	var pass = nearestApproach(leg, "Ceres");
	assert.ok(pass.insideSoi, "the pass genuinely enters the SOI");
	// The emitted event agrees with the measurement — one figure, not two.
	var ev = findClosestApproachEvent(leg.events, "Ceres");
	assert.ok(ev, "no closest-approach event emitted for the destination");
	assert.ok(Math.abs(ev.rmin - pass.rmin) < 1,
		"event " + ev.rmin + " vs measurement " + pass.rmin);
	assert.ok(Math.abs(ev.jd - pass.jd) * DAY < 1, "epochs disagree");
});

test("compliance: the arrival epoch row moves when waypoints move the pass", function () {
	// The defect this replaced: the epoch row measured the coast's leg end,
	// which is `jd0 + legDays` — fixed by construction — so tuning waypoints
	// swung the actual arrival by most of a day while the compliance row read
	// exactly zero deviation every time.
	var seen = [-6, -3, 0, 3, 6].map(function (d) {
		var res = deserializeWorld(defaultMission);
		var world = res.world;
		var coast = world.stages().filter(function (s) {
			return s.moduleId === "transfer-leg"; })[0];
		var wps = JSON.parse(JSON.stringify(coast.params.waypoints));
		wps[0].burn.pro += d;
		world.set({ stage: coast.id, params: { waypoints: wps, handoff: null } });
		createEngine(world, makeRegistry());
		var bnd = world.stages().filter(function (s) {
			return s.moduleId === "arrival-boundary"; })[0];
		var comp = arrivalComplianceFor(world, bnd.id);
		var epoch = comp.rows.filter(function (r) { return r.key === "epoch"; })[0];
		var enc = comp.rows.filter(function (r) { return r.key === "encounter"; })[0];
		return { d: d, epoch: epoch.delta, miss: enc.delivered };
	});
	// Monotonic in the impulse, and actually moving — a fixed leg end gave the
	// same number five times.
	for (var i = 1; i < seen.length; i++) {
		assert.ok(seen[i].epoch > seen[i - 1].epoch,
			"epoch row not monotonic at " + seen[i].d + ": " + JSON.stringify(seen));
	}
	assert.ok(seen[seen.length - 1].epoch - seen[0].epoch > 0.5,
		"the epoch row barely moved across the sweep — is it reading the leg end again?");
	// The shipped mission flies its own frozen plan, so it sits on the epoch.
	var onPlanRow = seen.filter(function (s) { return s.d === 0; })[0];
	assert.ok(Math.abs(onPlanRow.epoch) < 0.01, "the unmodified preset should arrive on time");
});
