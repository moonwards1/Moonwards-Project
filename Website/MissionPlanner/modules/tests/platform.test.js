// Node tests for the technology-platform layer: the spec contract
// (modules/platform/platform-spec.js), the two role adapters
// (modules/platform/platform-roles.js), and the skyhook migrated onto them
// (modules/skyhook/). Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/platform.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { RELEASE, CATCH, validatePlatformSpec, resolvePlatformParams,
         platformAppliesTo, canRideOn, paramsForRole, paramToDisplay,
         paramFromDisplay, createStageCache } from "../platform/platform-spec.js";
import { makeCarrier, makeTerminal, computeCapture } from "../platform/platform-roles.js";
import { SKYHOOK, tetherGeometry, defaultGeometryFor } from "../skyhook/skyhook.js";
import skyhookDeparture from "../skyhook/skyhook-departure.js";
import skyhookArrival from "../skyhook/skyhook-arrival.js";
import { validateDescriptor } from "../../core/registry.js";
import { evaluateChain, elementCount } from "../../../Shared/kinematic-chain.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";

var JD_ANCHOR = 2463220.75;

// A minimal made-up platform, so the contract is tested on something other
// than the one platform that exists. A "boost" carrier: no rotor, just a Δv.
function tugSpec(over) {
	return Object.assign({
		id: "test-tug", label: "Test tug",
		bodies: "*",
		ridesOn: ["skyhook"],
		defaultParams: { body: null, dv: 500 },
		params: [{ name: "dv", label: "Δv", unit: "m/s", step: 10 }],
		geometry: function (p) {
			return isFinite(p.dv) && p.dv > 0
				? { ok: true, dv: p.dv }
				: { ok: false, diagnostic: { code: "bad-params", message: "dv must be positive" } };
		},
		release: { element: function (geo) { return { kind: "impulse", dv: [geo.dv, 0, 0] }; } },
		capture: {
			kind: "rendezvous",
			figures: function (geo, approach) { return { shortfall: approach.vInf - geo.dv }; },
			eventLabel: function (cap) { return "Tug capture, shortfall " + Math.round(cap.shortfall); }
		}
	}, over || {});
}

// ---- the spec contract -----------------------------------------------------

test("validatePlatformSpec: the shipped skyhook and a minimal platform both pass", function () {
	assert.deepEqual(validatePlatformSpec(SKYHOOK), { ok: true });
	assert.deepEqual(validatePlatformSpec(tugSpec()), { ok: true });
});

test("validatePlatformSpec: a platform with neither half, or a bad capture kind, is refused", function () {
	assert.equal(validatePlatformSpec(tugSpec({ release: null, capture: null })).ok, false);
	var badKind = tugSpec();
	badKind.capture = Object.assign({}, badKind.capture, { kind: "sideways" });
	assert.match(validatePlatformSpec(badKind).reason, /capture kind/);
	assert.match(validatePlatformSpec({ id: "x", label: "X" }).reason, /geometry/);
});

test("resolvePlatformParams: static defaults, then per-body, then the stage's own", function () {
	// A Mars skyhook carrying only { body } still resolves to live geometry.
	var seeded = resolvePlatformParams(SKYHOOK, { body: "Mars" });
	var perBody = defaultGeometryFor("Mars");
	assert.equal(seeded.comAlt, perBody.comAlt);
	assert.equal(seeded.releasePhaseDeg, 0);

	// An explicit param beats the body default.
	var explicit = resolvePlatformParams(SKYHOOK, { body: "Mars", comAlt: 1234e3 });
	assert.equal(explicit.comAlt, 1234e3);
	assert.equal(explicit.topAlt, perBody.topAlt, "the rest still come from the body");

	// Resolving twice is idempotent — the adapters resolve, and a platform's own
	// geometry() may defensively resolve again.
	assert.deepEqual(resolvePlatformParams(SKYHOOK, explicit), explicit);
});

test("platformAppliesTo: the bodies list and the appliesTo predicate are ANDed", function () {
	assert.equal(platformAppliesTo(SKYHOOK, "Mars"), true);
	assert.equal(platformAppliesTo(SKYHOOK, ""), false);
	assert.equal(platformAppliesTo(tugSpec({ bodies: ["Ceres"] }), "Mars"), false);
	assert.equal(platformAppliesTo(tugSpec({ bodies: ["Ceres"] }), "Ceres"), true);
	var withAtmosphere = tugSpec({ appliesTo: function (b) { return b === "Venus"; } });
	assert.equal(platformAppliesTo(withAtmosphere, "Venus"), true);
	assert.equal(platformAppliesTo(withAtmosphere, "Mars"), false, "the predicate can veto '*'");
});

test("canRideOn: the add-on rule set — base-only, free, and must-ride platforms", function () {
	// The skyhook rides anything, or starts its own chain.
	assert.equal(canRideOn(SKYHOOK, null), true);
	assert.equal(canRideOn(SKYHOOK, "space-elevator"), true);

	// A platform that must be the base cannot sit on anything.
	var baseOnly = tugSpec({ ridesOn: [] });
	assert.equal(canRideOn(baseOnly, null), true);
	assert.equal(canRideOn(baseOnly, "skyhook"), false);

	// A layered add-on must ride one of its named platforms.
	var addOn = tugSpec({ ridesOn: ["skyhook", "space-elevator"] });
	assert.equal(canRideOn(addOn, "skyhook"), true);
	assert.equal(canRideOn(addOn, "mass-driver"), false);
	assert.equal(canRideOn(addOn, null), false, "an add-on cannot start a chain");
});

test("paramsForRole: role filtering and per-role labels", function () {
	var release = paramsForRole(SKYHOOK, RELEASE).map(function (p) { return p.name; });
	var catchRole = paramsForRole(SKYHOOK, CATCH).map(function (p) { return p.name; });
	assert.deepEqual(release, ["comAlt", "topAlt", "relAlt", "releasePhaseDeg"]);
	assert.deepEqual(catchRole, ["comAlt", "topAlt", "relAlt"],
		"the release-phase slider is the carrier's aiming control alone");

	var relLabel = paramsForRole(SKYHOOK, RELEASE).filter(function (p) { return p.name === "relAlt"; })[0];
	var catLabel = paramsForRole(SKYHOOK, CATCH).filter(function (p) { return p.name === "relAlt"; })[0];
	assert.equal(relLabel.label, "release altitude");
	assert.equal(catLabel.label, "catch altitude");
});

test("param display conversion: stored SI in, card units out, and back", function () {
	var km = { name: "comAlt", scale: 1e3 };
	assert.equal(paramToDisplay(km, 9376e3), 9376);
	assert.equal(paramFromDisplay(km, 9376), 9376e3);
	var plain = { name: "dv" };
	assert.equal(paramToDisplay(plain, 500), 500);
});

test("createStageCache: per (World, stage), and unknown keys read null", function () {
	var cache = createStageCache();
	var worldA = {}, worldB = {};
	cache.remember(worldA, "stg-1", { v: "a1" });
	cache.remember(worldB, "stg-1", { v: "b1" });
	assert.deepEqual(cache.get(worldA, "stg-1"), { v: "a1" });
	assert.deepEqual(cache.get(worldB, "stg-1"), { v: "b1" });
	assert.equal(cache.get(worldA, "stg-2"), null);
	assert.equal(cache.get({}, "stg-1"), null);
});

// ---- the role adapters -----------------------------------------------------

test("both skyhook adapters are valid registry descriptors with the right packet shapes", function () {
	assert.deepEqual(validateDescriptor(skyhookDeparture), { ok: true });
	assert.deepEqual(validateDescriptor(skyhookArrival), { ok: true });

	assert.equal(skyhookDeparture.id, "orbital-skyhook");
	assert.deepEqual(skyhookDeparture.accepts, ["carrier-chain"]);
	assert.deepEqual(skyhookDeparture.emits, ["carrier-chain"]);
	assert.equal(skyhookDeparture.inputOptional, true, "it may self-originate");
	assert.deepEqual(skyhookDeparture.rendersIn, ["body:origin"]);

	assert.equal(skyhookArrival.id, "arrival-skyhook");
	assert.deepEqual(skyhookArrival.accepts, ["ship-state"]);
	assert.deepEqual(skyhookArrival.emits, [], "terminal: the mission ends on the tether");
	assert.deepEqual(skyhookArrival.rendersIn, ["body:destination"]);
});

test("makeCarrier: ridesOn decides whether the input is required, optional or absent", function () {
	var free = makeCarrier(tugSpec({ ridesOn: "*" }), { id: "t-free", title: "Free" });
	assert.deepEqual(free.accepts, ["carrier-chain"]);
	assert.equal(free.inputOptional, true);

	var addOn = makeCarrier(tugSpec({ ridesOn: ["skyhook"] }), { id: "t-addon", title: "Add-on" });
	assert.deepEqual(addOn.accepts, ["carrier-chain"]);
	assert.ok(!addOn.inputOptional, "an add-on has nothing to sit on without an upstream chain");

	var baseOnly = makeCarrier(tugSpec({ ridesOn: [] }), { id: "t-base", title: "Base" });
	assert.deepEqual(baseOnly.accepts, [], "a base platform starts its own chain");
});

test("makeCarrier: a platform missing the role it is asked for throws at authoring time", function () {
	assert.throws(function () {
		makeCarrier(tugSpec({ release: null }), { id: "t-x", title: "X" });
	}, /no release half/);
	assert.throws(function () {
		makeTerminal(tugSpec({ capture: null }), { id: "t-y", title: "Y" });
	}, /no capture half/);
});

// A stand-in World carrying just enough frozen plan for releaseAnchorFor.
function plannedWorld() {
	return {
		jd: JD_ANCHOR,
		stages: function () {
			return [{ id: "fp", moduleId: "frozen-plan", params: { releaseAnchorJd: JD_ANCHOR } }];
		}
	};
}

test("makeCarrier: a boost platform contributes a Δv element, not a rotor", function () {
	var tug = makeCarrier(tugSpec({ ridesOn: "*" }), { id: "t-imp", title: "Imp" });
	var res = tug.update({ world: plannedWorld(), stageId: "s1",
		params: { body: "Mars", dv: 400 } }, null);
	var chain = res.packet.data;
	assert.equal(chain.base, "Mars");
	assert.equal(chain.rotors.length, 0, "a tug carries the payload nowhere");
	assert.deepEqual(chain.impulses, [{ kind: "impulse", dv: [400, 0, 0] }]);
	assert.equal(elementCount(chain), 1);
});

test("makeCarrier: a boost platform stacks onto the chain it rides", function () {
	var tug = makeCarrier(tugSpec({ ridesOn: "*" }), { id: "t-stack", title: "Stack" });
	var geo = tetherGeometry({ body: "Mars", comAlt: 9000e3, topAlt: 14000e3, relAlt: 13000e3 });
	var upstream = { base: "Mars", rotors: [SKYHOOK.release.element(geo, JD_ANCHOR)] };
	var res = tug.update({ world: plannedWorld(), stageId: "s1",
		params: { body: "Mars", dv: 400 } }, { data: upstream });
	var chain = res.packet.data;
	assert.equal(chain.rotors.length, 1, "the skyhook's rotor is still there");
	assert.equal(chain.impulses.length, 1);
	assert.equal(upstream.impulses, undefined, "the upstream packet was not mutated");

	// The released state is the tether tip plus the tug's kick.
	var tip = evaluateChain(upstream, JD_ANCHOR);
	var boosted = evaluateChain(chain, JD_ANCHOR);
	assert.ok(O.vMag(O.vSub(boosted.r, tip.r)) < 1e-9);
	assert.ok(O.vMag(O.vSub(boosted.v, O.vAdd(tip.v, [400, 0, 0]))) < 1e-9);
});

test("makeCarrier: a platform's own geometry failure is the stage's diagnostic", function () {
	var tug = makeCarrier(tugSpec({ ridesOn: "*" }), { id: "t-bad", title: "Bad" });
	var diag = tug.update({ world: plannedWorld(), stageId: "s1",
		params: { body: "Mars", dv: -1 } }, null);
	assert.equal(diag.code, "bad-params");
});

test("makeCarrier: the body-mismatch guard fires before any physics runs", function () {
	var tug = makeCarrier(tugSpec({ ridesOn: "*" }), { id: "t-mis", title: "Mis" });
	var world = { jd: JD_ANCHOR, stages: function () { return []; } };
	var diag = tug.update({ world: world, stageId: "s1", params: { body: "Mars", dv: 400 } },
		{ data: { base: "Moon", rotors: [] } });
	assert.equal(diag.code, "wrong-body");
	assert.match(diag.message, /Mars/);
	assert.match(diag.message, /Moon/);
});

test("makeCarrier: no body set is diagnosed in the role's own words", function () {
	var world = { jd: JD_ANCHOR, stages: function () { return []; } };
	var dep = skyhookDeparture.update({ world: world, stageId: "s1", params: {} }, null);
	assert.equal(dep.code, "no-body");
	assert.match(dep.message, /origin body/);
	assert.match(dep.fix, /departure body/);
});

// ---- one platform, two roles, one physics ---------------------------------

test("the release and the catch read the SAME tether geometry", function () {
	// The point of the shared spec: a skyhook configured once reports the same
	// hardware whichever end of the mission it is on.
	var params = { body: "Mars", comAlt: 9000e3, topAlt: 12000e3, relAlt: 11000e3 };
	var direct = tetherGeometry(params);
	var arriving = { r: [2.2e11, 0, 0], v: [0, 2.5e4, 0], jd: 2463400.5, frame: "helio" };
	var cap = computeCapture(SKYHOOK, params, arriving);
	assert.equal(cap.ok, true, cap.ok ? "" : cap.diagnostic.message);
	assert.equal(cap.geo.rRel, direct.rRel);
	assert.equal(cap.geo.omega, direct.omega);
	assert.equal(cap.geo.vRel, direct.vRel);
});

test("the release gate is the departure role's alone — a bound tip still catches", function () {
	// A slow tether: the tip never reaches Mars escape speed.
	var params = { body: "Mars", comAlt: 9000e3, topAlt: 9400e3, relAlt: 9300e3 };
	var geo = tetherGeometry(params);
	assert.equal(geo.ok, true);
	assert.equal(geo.vInfBody, 0, "the tip is bound");
	assert.ok(SKYHOOK.release.gate(geo), "a release demands escape");

	var arriving = { r: [2.2e11, 0, 0], v: [0, 2.5e4, 0], jd: 2463400.5, frame: "helio" };
	var cap = computeCapture(SKYHOOK, params, arriving);
	assert.equal(cap.ok, true, "a catch does not");
	assert.ok(cap.trimDv > 0, "the ship burns off whatever the hook cannot absorb");
});

test("the carrier's chain element reproduces the tether tip at the release anchor", function () {
	var params = { body: "Mars", comAlt: 9000e3, topAlt: 14000e3, relAlt: 13000e3 };
	var geo = tetherGeometry(params);
	var chain = { base: "Mars", rotors: [SKYHOOK.release.element(geo, JD_ANCHOR)] };
	assert.equal(elementCount(chain), 1);
	var st = evaluateChain(chain, JD_ANCHOR);
	// Phase 0: the tip sits on +x at the anchor, moving at ω·r in +y.
	assert.ok(Math.abs(O.vMag(st.r) - geo.rRel) < 1e-6);
	assert.ok(Math.abs(O.vMag(st.v) - geo.vRel) < 1e-9);
	assert.ok(Math.abs(st.r[0] - geo.rRel) < 1e-6, "phase 0 is +x");
});
