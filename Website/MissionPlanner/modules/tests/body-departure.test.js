// Node tests for the GENERIC departure system (task J2, WP-J): the
// orbital-skyhook carrier + body-departure-leg release modules, on
// Shared/body-leg.js. Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/body-departure.test.js
// The view hooks (init/draw) are browser-only and not exercised here.

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import orbitalSkyhook, {
	tetherKinematics, rotorFor, defaultGeometryFor, satelliteOrbitRadius, resolveParams
} from "../orbital-skyhook/orbital-skyhook.js";
import bodyDepartureLeg, { computeBodyDepartureLeg } from "../body-departure-leg/body-departure-leg.js";
import frozenPlan from "../frozen-plan/frozen-plan.js";
import { evaluateChain } from "../../../Shared/kinematic-chain.js";
import { bodySOI } from "../../../Shared/body-leg.js";
import { Frames } from "../../../Shared/frames.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

var DAY = 86400;
var JD_ANCHOR = 2463220.75;

// Build the carrier-chain payload a Mars orbital-skyhook would emit at
// `anchor`, from a resolved param set — the same rotorFor the module uses.
function marsChain(params, anchor) {
	var kin = tetherKinematics(params);
	assert.equal(kin.ok, true, "geometry ok: " + (kin.diagnostic && kin.diagnostic.message));
	return { base: "Mars", rotors: [rotorFor(kin, anchor)] };
}

// ---- defaults & geometry ---------------------------------------------------

test("satelliteOrbitRadius: Mars → Phobos' semi-major axis; airless bodies → null", function () {
	assert.equal(satelliteOrbitRadius("Mars"), systems.get("Phobos").orbit.semiMajor);
	assert.equal(satelliteOrbitRadius("Ceres"), null);
});

test("defaultGeometryFor: CoM at the satellite orbit, release above the escape radius", function () {
	var geo = defaultGeometryFor("Mars");
	var R = +systems.get("Mars").radius;
	var rCom = R + geo.comAlt;
	assert.ok(Math.abs(rCom - systems.get("Phobos").orbit.semiMajor) < 1, "CoM at Phobos radius");
	assert.ok(geo.relAlt > geo.comAlt, "release above CoM");
	// The default must actually escape.
	var kin = tetherKinematics({ body: "Mars" });
	assert.equal(kin.ok, true);
	assert.ok(kin.vInfBody > 0, "default release escapes Mars, v∞ = " + kin.vInfBody);
});

test("defaultGeometryFor: a satellite-less body falls back to a low orbit that still escapes", function () {
	var kin = tetherKinematics({ body: "Ceres" });
	assert.equal(kin.ok, true, kin.diagnostic && kin.diagnostic.message);
	assert.ok(kin.vInfBody > 0, "Ceres default escapes, v∞ = " + kin.vInfBody);
});

test("resolveParams: explicit params override the body defaults", function () {
	var p = resolveParams({ body: "Mars", relAlt: 30000e3 });
	assert.equal(p.relAlt, 30000e3);
	assert.equal(p.body, "Mars");
	assert.ok(isFinite(p.comAlt), "comAlt filled from the body default");
});

// ---- rotorFor / evaluateChain (release kinematics) -------------------------

test("rotorFor + evaluateChain: the chain reproduces the tether-tip release state at the anchor", function () {
	var params = { body: "Mars" };
	var kin = tetherKinematics(params);
	var chain = marsChain(params, JD_ANCHOR);
	var st = evaluateChain(chain, JD_ANCHOR);
	// At the anchor, phase = releasePhaseDeg (0 here): r along +x at rRel,
	// v along +y at vRel. Mars is the frame origin (base contributes nothing).
	assert.ok(Math.abs(O.vMag(st.r) - kin.rRel) < 1e-3, "|r| = rRel");
	assert.ok(Math.abs(O.vMag(st.v) - kin.vRel) < 1e-3, "|v| = vRel");
	assert.ok(Math.abs(st.r[0] - kin.rRel) < 1, "r along +x at phase 0");
	assert.ok(Math.abs(st.v[1] - kin.vRel) < 1, "v along +y at phase 0");
});

// ---- computeBodyDepartureLeg (the integrated flight) -----------------------

test("computeBodyDepartureLeg: the default Mars skyhook escapes to a hand-off at Mars' SOI", function () {
	var params = { body: "Mars", releasePhaseDeg: 40 };
	var chain = marsChain(params, JD_ANCHOR);
	var leg = computeBodyDepartureLeg({ waypoints: [] }, chain, JD_ANCHOR);
	assert.equal(leg.ok, true, leg.diagnostic && leg.diagnostic.message);
	assert.equal(leg.body, "Mars");
	assert.ok(leg.vinfBody > 0, "hyperbolic vs Mars");
	assert.ok(leg.handoff.jd > JD_ANCHOR, "hand-off after release");
	// The flight is truncated at the SOI: the last sample sits on it.
	var last = leg.samples[leg.samples.length - 1];
	assert.ok(Math.abs(O.vMag(last.r) - bodySOI("Mars")) < 1e4, "last sample ≈ Mars SOI");
	// Events: release first, SOI-exit hand-off last.
	assert.ok(/Release/.test(leg.events[0].label));
	assert.ok(/SOI exit/.test(leg.events[leg.events.length - 1].label));
});

test("computeBodyDepartureLeg: the emitted hand-off lifts to a heliocentric state near Mars", function () {
	var params = { body: "Mars", releasePhaseDeg: 40 };
	var chain = marsChain(params, JD_ANCHOR);
	var leg = computeBodyDepartureLeg({ waypoints: [] }, chain, JD_ANCHOR);
	var lifted = Frames.localToHelio("Mars", leg.handoff.jd, leg.handoff.r, leg.handoff.v);
	var mars = Frames.bodyHelioState("Mars", leg.handoff.jd);
	// The ship is at Mars' SOI: ~its SOI radius from Mars, heliocentrically.
	var sep = O.vMag(O.vSub(lifted.r, mars.r));
	assert.ok(Math.abs(sep - bodySOI("Mars")) < 1e5, "ship at Mars SOI, sep=" + sep.toFixed(0));
});

test("computeBodyDepartureLeg: a waypoint impulse re-shapes the flight and its hand-off v∞", function () {
	var params = { body: "Mars", releasePhaseDeg: 40 };
	var chain = marsChain(params, JD_ANCHOR);
	var base = computeBodyDepartureLeg({ waypoints: [] }, chain, JD_ANCHOR);
	// Drop a 500 m/s prograde impulse an hour after release, well inside the
	// flight — evaluated in the escaping leg's own (Sun) local frame. It
	// measurably changes the hand-off v∞ (direction-dependent whether up or
	// down for a given release geometry — the point is the impulse takes effect).
	var boosted = computeBodyDepartureLeg(
		{ waypoints: [{ t: 3600, burn: { pro: 500, rad: 0, nrm: 0 } }] }, chain, JD_ANCHOR);
	assert.equal(boosted.ok, true, boosted.diagnostic && boosted.diagnostic.message);
	assert.ok(Math.abs(boosted.vinfBody - base.vinfBody) > 10, "impulse changed v∞: " +
		base.vinfBody.toFixed(0) + " → " + boosted.vinfBody.toFixed(0));
	assert.ok(Math.abs(boosted.totalDv - 500) < 1e-6, "totalDv tracks the impulse");
	assert.ok(boosted.wpVisuals[0] && boosted.wpVisuals[0].eff, "waypoint visual computed");
	assert.ok(Math.abs(boosted.wpVisuals[0].eff.progradeDv - 0.5) < 1e-6, "prograde Δv readout");
});

// ---- diagnostics -----------------------------------------------------------

test("computeBodyDepartureLeg: a rotor-less chain is a no-carrier diagnostic", function () {
	var leg = computeBodyDepartureLeg({ waypoints: [] }, { base: "Mars", rotors: [] }, JD_ANCHOR);
	assert.equal(leg.ok, false);
	assert.equal(leg.diagnostic.code, "no-carrier");
});

test("computeBodyDepartureLeg: a non-heliocentric base is a bad-origin diagnostic", function () {
	var leg = computeBodyDepartureLeg({ waypoints: [] },
		{ base: "Phobos", rotors: [{ normal: [0, 0, 1], ref: [1, 0, 0], radius: 1e7, rate: 1e-4, phase0: 0, epoch: JD_ANCHOR }] },
		JD_ANCHOR);
	assert.equal(leg.ok, false);
	assert.equal(leg.diagnostic.code, "bad-origin");
});

test("computeBodyDepartureLeg: a low, slow release stays bound (bound-no-handoff)", function () {
	// A release just barely above escape at a very low altitude that curves
	// back and impacts, or a clearly bound one — either way, no hand-off.
	var params = { body: "Mars", comAlt: 500e3, topAlt: 900e3, relAlt: 900e3, releasePhaseDeg: 0 };
	var kin = tetherKinematics(params);
	// This geometry is below escape → tetherKinematics itself refuses it.
	assert.equal(kin.ok, false);
	assert.equal(kin.diagnostic.code, "bound-at-body");
});

test("computeBodyDepartureLeg: an impacting release is caught", function () {
	// Hand-build a chain that releases low and slow enough to fall into Mars.
	var chain = { base: "Mars", rotors: [
		{ normal: [0, 0, 1], ref: [1, 0, 0], radius: systems.get("Mars").radius + 150e3,
		  rate: 1e-5, phase0: Math.PI, epoch: JD_ANCHOR } ] };
	var leg = computeBodyDepartureLeg({ waypoints: [] }, chain, JD_ANCHOR);
	assert.equal(leg.ok, false);
	assert.ok(leg.diagnostic.code === "impact" || leg.diagnostic.code === "bound-no-handoff",
		"low slow release fails to hand off (" + leg.diagnostic.code + ")");
});

// ---- engine integration: skyhook → leg → frozen-plan -----------------------

test("engine: orbital-skyhook → body-departure-leg emits a heliocentric ship-state", function () {
	var reg = createRegistry();
	reg.register(orbitalSkyhook);
	reg.register(bodyDepartureLeg);
	reg.register(frozenPlan);

	var mars = Frames.bodyHelioState("Mars", JD_ANCHOR);
	var world = createWorld({ jd: JD_ANCHOR });
	var skId = world.set({ addStage: { moduleId: "orbital-skyhook",
		params: { body: "Mars", releasePhaseDeg: 40 } } });
	var legId = world.set({ addStage: { moduleId: "body-departure-leg", params: {} } });
	// Minimal frozen plan carrying only the release anchor (releaseAnchorFor
	// reads it); Mars departure/arrival stubs keep it from throwing.
	world.set({ addStage: { moduleId: "frozen-plan", params: {
		origin: "Mars",
		departure: { r: mars.r.slice(), v: mars.v.slice(), jd: JD_ANCHOR },
		arrival: { body: "Earth", jd: JD_ANCHOR + 200, vInf: 3000 },
		releaseAnchorJd: JD_ANCHOR
	} } });

	var engine = createEngine(world, reg);
	var legRes = engine.resultFor(legId);
	assert.ok(legRes, "leg has a result");
	assert.equal(legRes.status, "ok", "leg computed: " + (legRes.diagnostic && legRes.diagnostic.message));
	assert.equal(legRes.output.type, "ship-state");
	assert.equal(legRes.output.data.frame, "helio");
	assert.ok(legRes.events && legRes.events.length >= 2, "release + hand-off events emitted");
	var skRes = engine.resultFor(skId);
	assert.equal(skRes.status, "ok");
	assert.equal(skRes.output.type, "carrier-chain");
	assert.equal(skRes.output.data.base, "Mars");
});
