// node --test Website/Home/tests/design-model.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	sampleDesign, variantBlock, addBody, removeBody, addInstallation, removeInstallation,
	parseDesign, serializeDesign, calcFor, markHint, isSpecial, instLabel, findBody, BODY_ORDER, FAMILIES, MARKS
} from "../design-model.js";
import { BODY_FACTS } from "../body-facts.js";

test("every offered body has facts", function () {
	BODY_ORDER.forEach(function (n) { assert.ok(BODY_FACTS[n], n); });
});

test("marks refer to real bodies, families and variants", function () {
	Object.keys(MARKS).forEach(function (k) {
		var p = k.split("|");
		assert.ok(BODY_ORDER.indexOf(p[0]) >= 0, k);
		assert.ok(FAMILIES[p[1]], k);
		(MARKS[k].allow || []).forEach(function (v) { assert.ok(FAMILIES[p[1]].vars[v], k + " " + v); });
	});
});

test("the Moon takes only the L1 and L2 elevators; Mars, Venus, Mercury take none", function () {
	var d = sampleDesign();
	assert.match(variantBlock(d, "Moon", "elevator", "standard"), /\*/);
	assert.equal(variantBlock(d, "Moon", "elevator", "l2"), null);
	assert.equal(instLabel({ fam: "elevator", v: "l2" }), "L2 elevator");
	["Mars", "Venus", "Mercury"].forEach(function (n) {
		d = addBody(d, n);
		assert.ok(variantBlock(d, n, "elevator", "standard"), n);
		assert.ok(variantBlock(d, n, "elevator", "l1"), n);
	});
	assert.ok(variantBlock(d, "Earth", "elevator", "l1"));
	assert.equal(variantBlock(addBody(d, "Vesta"), "Vesta", "elevator", "standard"), null);
});

test("an asterisk's hint says what clicking offers; a × only explains", function () {
	assert.match(markHint("Moon|elevator"), /^No standard elevator at the Moon\. Click to choose/);
	assert.match(markHint("Mars|elevator"), /Click for why\.$/);
	assert.equal(markHint("Earth|elevator"), "");
});

test("special forms can be added only once each", function () {
	var d = sampleDesign();   // the Moon has its L1 elevator, Mars its Phobos skyhook
	assert.equal(variantBlock(d, "Moon", "elevator", "l1"), "Already added.");
	var r = addInstallation(d, "Moon", "elevator", "l2");
	assert.ok(r.inst);
	assert.equal(variantBlock(r.design, "Moon", "elevator", "l2"), "Already added.");
	assert.equal(variantBlock(d, "Mars", "skyhook", "phobos"), "Already added.");
	var m = addInstallation(d, "Mars", "skyhook", "deimos");
	assert.ok(m.inst);
	assert.equal(variantBlock(m.design, "Mars", "skyhook", "deimos"), "Already added.");
	assert.equal(variantBlock(addInstallation(d, "Ceres", "elevator", "standard").design, "Ceres", "elevator", "standard"), "Already added.");
});

test("Mars's skyhook asterisk adds its moons without closing the ordinary forms", function () {
	var d = sampleDesign();
	assert.equal(MARKS["Mars|skyhook"].k, "*");
	assert.equal(variantBlock(d, "Mars", "skyhook", "hanging"), null);
	assert.equal(variantBlock(d, "Mars", "skyhook", "deimos"), null);
	assert.ok(variantBlock(d, "Moon", "skyhook", "deimos"));
	assert.match(markHint("Mars|skyhook"), /Click to choose Phobos or Deimos\.$/);
	assert.match(markHint("Moon|elevator"), /Click to choose Through L1 or Through L2\.$/);
});

test("special variants stay out of the menus; the elevator has no menu", function () {
	assert.equal(isSpecial("skyhook", "phobos"), true);
	assert.equal(isSpecial("skyhook", "hanging"), false);
	assert.equal(isSpecial("elevator", "l2"), true);
	assert.equal(isSpecial("elevator", "standard"), false);
	assert.equal(FAMILIES.elevator.menu, false);
});

test("Phobos and Deimos skyhooks only at Mars", function () {
	var d = sampleDesign();
	assert.notEqual(variantBlock(d, "Mars", "skyhook", "phobos"), "Only at Mars.");
	assert.equal(variantBlock(d, "Moon", "skyhook", "phobos"), "Only at Mars.");
	assert.equal(variantBlock(d, "Moon", "skyhook", "deimos"), "Only at Mars.");
});

test("a mass driver on an elevator needs the elevator, and goes with it", function () {
	var d = addBody(sampleDesign(), "Vesta");
	assert.ok(variantBlock(d, "Vesta", "driver", "elevator"));
	var r = addInstallation(d, "Vesta", "elevator", "standard");
	assert.ok(r.inst);
	var r2 = addInstallation(r.design, "Vesta", "driver", "elevator");
	assert.ok(r2.inst);
	var after = removeInstallation(r2.design, "Vesta", r.inst.id);
	assert.equal(findBody(after, "Vesta").inst.length, 0);
});

test("blocked additions leave the design unchanged", function () {
	var d = sampleDesign();
	var r = addInstallation(d, "Mars", "elevator", "standard");
	assert.ok(r.error);
	assert.equal(r.design, d);
});

test("bodies keep the order they were added; no duplicates; removing works", function () {
	var d = addBody(addBody(sampleDesign(), "Mercury"), "Vesta");
	assert.deepEqual(d.bodies.map(function (b) { return b.body; }), ["Moon", "Earth", "Mars", "Ceres", "Psyche", "Mercury", "Vesta"]);
	assert.equal(addBody(d, "Mars"), d);
	assert.equal(addBody(d, "Pluto"), d);
	assert.equal(findBody(removeBody(d, "Mars"), "Mars"), null);
});

test("serialize → parse round-trips, with the selection", function () {
	var d = sampleDesign();
	var sel = { body: "Mars", inst: d.bodies[2].inst[1].id, tab: "log" };
	var back = parseDesign(JSON.parse(serializeDesign(d, sel)));
	assert.deepEqual(back.bodies, d.bodies);
	assert.deepEqual(back.selected, sel);
});

test("parse refuses foreign data and drops unknown entries", function () {
	assert.throws(function () { parseDesign({ kind: "something-else" }); }, /isn't a Moonwards design/);
	assert.throws(function () { parseDesign({ kind: "moonwards-design", version: 99, bodies: [] }); }, /different version/);
	var p = parseDesign({ kind: "moonwards-design", version: 1, bodies: [
		{ body: "Pluto", inst: [] },
		{ body: "Ceres", inst: [{ id: "a", fam: "elevator", v: "standard" }, { id: "b", fam: "warp", v: "x" }] },
		{ body: "Ceres", inst: [] }
	] });
	assert.equal(p.bodies.length, 1);
	assert.equal(p.bodies[0].inst.length, 1);
});

test("only the hanging skyhook has its own calculator so far", function () {
	var hang = { id: "h", fam: "skyhook", v: "hanging" };
	assert.equal(calcFor(hang), "hanging-skyhook");
	assert.equal(calcFor({ id: "p", fam: "skyhook", v: "phobos" }), null);
	assert.equal(calcFor(null), null);
	assert.equal(instLabel(hang), "Hanging skyhook");
	assert.equal(instLabel({ fam: "elevator", v: "l1" }), "L1 elevator");
});

test("calculator settings ride along with their installation", function () {
	var d = sampleDesign();
	d.bodies[0].inst[0].state = { fields: { "geo/Top altitude": "2500" }, modules: { st: false }, collapsed: [] };
	var back = parseDesign(JSON.parse(serializeDesign(d, null)));
	assert.deepEqual(back.bodies[0].inst[0].state, d.bodies[0].inst[0].state);
	assert.equal("state" in back.bodies[1].inst[0], false);
});
