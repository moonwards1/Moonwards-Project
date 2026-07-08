// Node tests for registry.js. Run with:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, validateDescriptor } from "../registry.js";

function goodDesc(id) {
	return {
		id: id || "ceres-elevator",
		title: "Ceres space elevator",
		attachesTo: "Ceres",
		accepts: ["ship-state"],
		emits: ["ship-state"],
		update: function () { return null; }
	};
}

test("register + has + get + list", function () {
	var reg = createRegistry();
	var d = goodDesc();
	assert.equal(reg.register(d), d);
	assert.equal(reg.has("ceres-elevator"), true);
	assert.equal(reg.get("ceres-elevator"), d);
	reg.register(goodDesc("mass-driver"));
	assert.deepEqual(reg.list().map(function (m) { return m.id; }),
		["ceres-elevator", "mass-driver"]);
});

test("get of an unregistered id returns null (engine turns it into a diagnostic)", function () {
	var reg = createRegistry();
	assert.equal(reg.get("nope"), null);
	assert.equal(reg.has("nope"), false);
});

test("duplicate id throws", function () {
	var reg = createRegistry();
	reg.register(goodDesc());
	assert.throws(function () { reg.register(goodDesc()); }, /duplicate/);
});

test("malformed descriptors throw with the field named", function () {
	var reg = createRegistry();
	assert.throws(function () { reg.register(null); }, /not an object/);
	var noId = goodDesc(); delete noId.id;
	assert.throws(function () { reg.register(noId); }, /id/);
	var noTitle = goodDesc(); delete noTitle.title;
	assert.throws(function () { reg.register(noTitle); }, /title/);
	var noUpdate = goodDesc(); delete noUpdate.update;
	assert.throws(function () { reg.register(noUpdate); }, /update/);
	var noAccepts = goodDesc(); delete noAccepts.accepts;
	assert.throws(function () { reg.register(noAccepts); }, /accepts/);
	var noEmits = goodDesc(); delete noEmits.emits;
	assert.throws(function () { reg.register(noEmits); }, /emits/);
});

test("packet types in accepts/emits are checked against PacketTypes", function () {
	var reg = createRegistry();
	var badAccepts = goodDesc(); badAccepts.accepts = ["ship-sate"];   // typo
	assert.throws(function () { reg.register(badAccepts); }, /ship-sate/);
	var badEmits = goodDesc(); badEmits.emits = ["warp-field"];
	assert.throws(function () { reg.register(badEmits); }, /warp-field/);
});

test("empty accepts/emits are fine (producers and terminal stages)", function () {
	var reg = createRegistry();
	var src = goodDesc("src"); src.accepts = [];
	var sink = goodDesc("sink"); sink.emits = [];
	reg.register(src);
	reg.register(sink);
	assert.equal(reg.has("src") && reg.has("sink"), true);
});

test("validateDescriptor reports without throwing", function () {
	assert.equal(validateDescriptor(goodDesc()).ok, true);
	var r = validateDescriptor({ id: "x" });
	assert.equal(r.ok, false);
	assert.equal(typeof r.reason, "string");
});
