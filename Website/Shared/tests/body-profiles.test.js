// Node tests for Shared/body-profiles.js. Run from the repo root:
//   node --test Website/Shared/tests/body-profiles.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { systems } from "../orbit.js";
import { BODY_PROFILES, CONDITIONS, applies, specialsAt, footFloor, parentName, anchorConfig, ANCHORS } from "../body-profiles.js";

test("profiles and anchors name real bodies", function () {
	Object.keys(BODY_PROFILES).forEach(function (n) { assert.ok(systems.get(n), n); });
	Object.keys(ANCHORS).forEach(function (n) {
		assert.ok(systems.get(n), n);
		assert.ok(systems.get(ANCHORS[n].primary), n + " primary");
		assert.ok(systems.get(n).mass > 0, n + " mass");
	});
});

test("every body with a foot floor has an atmosphere, and the floors are the chosen ones", function () {
	Object.keys(BODY_PROFILES).forEach(function (n) {
		if (BODY_PROFILES[n].footFloor != null) assert.ok(systems.get(n).atmosphere, n);
	});
	assert.equal(footFloor("Earth"), 120);
	assert.equal(footFloor("Mars"), 115);
	assert.equal(footFloor("Venus"), 140);
	assert.equal(footFloor("Titan"), 860);
	assert.equal(footFloor("Moon"), null);
});

test("entry at the parent planet holds where the parent has an atmosphere", function () {
	assert.ok(applies("parentEntry", "Moon"));
	assert.ok(applies("parentEntry", "Phobos"));
	["Earth", "Mars", "Ceres", "Vesta"].forEach(function (n) { assert.ok(!applies("parentEntry", n), n); });
	assert.equal(parentName("Moon"), "Earth");
	assert.equal(parentName("Mars"), null);
	assert.throws(function () { applies("nonsense", "Moon"); });
});

test("specialsAt lists the conditions that hold", function () {
	assert.deepEqual(specialsAt("Moon").map(function (s) { return s.id; }), ["parentEntry"]);
	assert.deepEqual(specialsAt("Mars").map(function (s) { return s.id; }), ["footFloor"]);
	assert.deepEqual(specialsAt("Ceres"), []);
	Object.keys(CONDITIONS).forEach(function (id) { assert.ok(CONDITIONS[id].label && CONDITIONS[id].text, id); });
});

test("Phobos: centre at its orbit, foot floor raised by its eccentric swing, top below Deimos", function () {
	var c = anchorConfig("Phobos");
	assert.equal(c.primary, "Mars");
	assert.equal(c.centre, 5986.5);
	assert.ok(Math.abs(c.swing - 141.58) < 0.01, "swing " + c.swing);
	assert.equal(c.footFloor, 257);   // 115 + 141.58, rounded up
	assert.equal(c.topCeiling, 19924);   // Deimos periapsis − swing − Mars radius, rounded down
	assert.equal(anchorConfig("Moon"), null);
});
