// Node test for core/workbench-import.js:
//   node --test Website/MissionPlanner/core/tests/workbench-import.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readWorkbenchDesign, workbenchConfigs, importsFromWorkbench } from "../workbench-import.js";
import { anchorConfig } from "../../../Shared/body-profiles.js";
import { systems } from "../../../Shared/orbit.js";

function hook(id, fields, v) { return { id: id, fam: "skyhook", v: v || "hanging", state: fields ? { fields: fields } : undefined }; }
function design(bodies) { return JSON.stringify({ kind: "moonwards-design", version: 1, name: "t", bodies: bodies }); }

var HOOK = { "geo/Top altitude": "3000", "geo/Centre of mass altitude": "2000", "st/Release deck used": "0", "st/Release deck": "2500" };

test("no saved design: nothing to import, and says why", function () {
	var r = workbenchConfigs(readWorkbenchDesign(null), "skyhook", "release", "Earth");
	assert.equal(r.configs.length, 0);
	assert.match(r.why, /No design/);
	assert.equal(readWorkbenchDesign("not json"), null);
});

test("only the skyhook and the Lagrange elevators import", function () {
	assert.ok(importsFromWorkbench("skyhook"));
	assert.ok(importsFromWorkbench("l1-elevator"));
	assert.ok(importsFromWorkbench("l2-elevator"));
	assert.ok(!importsFromWorkbench("moon-platform"));
});

test("hanging skyhook: balance point, and the top as the release point", function () {
	var d = readWorkbenchDesign(design([{ body: "Earth", inst: [hook("a", HOOK)] }]));
	var r = workbenchConfigs(d, "skyhook", "release", "Earth");
	assert.equal(r.configs.length, 1);
	assert.deepEqual(r.configs[0].params, { comAlt: 2000e3, relAlt: 3000e3 });
	assert.equal(r.configs[0].label, "Hanging skyhook");
	assert.match(r.configs[0].detail, /\(top\)/);
	assert.equal(workbenchConfigs(d, "skyhook", "release", "Moon").configs.length, 0);
});

test("a ticked release deck is the release point; a catch still takes the top", function () {
	var f = Object.assign({}, HOOK, { "st/Release deck used": "1" });
	var d = readWorkbenchDesign(design([{ body: "Earth", inst: [hook("a", f)] }]));
	assert.equal(workbenchConfigs(d, "skyhook", "release", "Earth").configs[0].params.relAlt, 2500e3);
	assert.equal(workbenchConfigs(d, "skyhook", "catch", "Earth").configs[0].params.relAlt, 3000e3);
});

test("unsaved settings are skipped; repeated names are numbered", function () {
	var d = readWorkbenchDesign(design([{ body: "Earth", inst: [hook("a", HOOK), hook("b", null), hook("c", HOOK)] }]));
	var r = workbenchConfigs(d, "skyhook", "release", "Earth");
	assert.deepEqual(r.configs.map(function (c) { return c.label; }), ["Hanging skyhook 1", "Hanging skyhook 3"]);
	var only = readWorkbenchDesign(design([{ body: "Earth", inst: [hook("b", null)] }]));
	assert.match(workbenchConfigs(only, "skyhook", "release", "Earth").why, /aren't saved/);
});

test("Phobos skyhook: its balance point is Phobos's orbit", function () {
	var d = readWorkbenchDesign(design([{ body: "Mars", inst: [hook("p", HOOK, "phobos")] }]));
	var c = workbenchConfigs(d, "skyhook", "release", "Mars").configs[0];
	assert.equal(c.label, "Phobos skyhook");
	assert.equal(c.params.comAlt, anchorConfig("Phobos").centre * 1e3);
});

test("L1 elevator: counterweight distance to altitude, release at the counterweight", function () {
	var e = { id: "e", fam: "elevator", v: "l1", state: { fields: { "cw/Counterweight distance": "222100" } } };
	var d = readWorkbenchDesign(design([{ body: "Moon", inst: [e] }]));
	var c = workbenchConfigs(d, "l1-elevator", "release", "Moon").configs[0];
	var alt = 222100e3 - Number(systems.get("Moon").radius);
	assert.deepEqual(c.params, { cwAlt: alt, relAlt: alt });
	assert.equal(workbenchConfigs(d, "l2-elevator", "release", "Moon").configs.length, 0);
});
