import test from "node:test";
import assert from "node:assert/strict";
import { createFleet, shipDv, PROPELLANTS, DEFAULT_PROPELLANT } from "../ships.js";

test("chemical propellants only, magnesium / LOX by default", () => {
	assert.equal(DEFAULT_PROPELLANT, "mg-lox");
	assert.ok(PROPELLANTS.every((p) => p.isp < 500));
});

test("rocket equation", () => {
	const dv = shipDv({ isp: 300, dry: 10, payload: 10, tank: 20 });
	assert.ok(Math.abs(dv.loaded - 300 * 9.80665 * Math.log(2)) < 1e-9);
	assert.ok(Math.abs(dv.empty - 300 * 9.80665 * Math.log(3)) < 1e-9);
});

test("installations share one class until one is copied", () => {
	const f = createFleet();
	f.sync({ a: ["shuttle"], b: ["shuttle", "freighter"] });
	const s = f.classFor("a", "shuttle");
	assert.equal(f.classFor("b", "shuttle"), s);
	assert.deepEqual(f.usedBy(s.id).sort(), ["a", "b"]);
	f.update(s.id, { payload: 99 });
	assert.equal(f.classFor("b", "shuttle").payload, 99);
	const c = f.copy(s.id, "b");
	assert.notEqual(f.classFor("b", "shuttle"), s);
	assert.deepEqual(f.usedBy(s.id), ["a"]);
	assert.equal(c.payload, 99);
});

test("capsules always carry a heat shield; edits are cleaned", () => {
	const f = createFleet();
	f.sync({ a: ["capsule"] });
	const c = f.classFor("a", "capsule");
	f.update(c.id, { shield: false, dry: -5, role: "freighter" });
	assert.equal(c.shield, true);
	assert.equal(c.role, "capsule");
	assert.ok(c.dry > 0);
});

test("sync drops removed installations; round trip through JSON", () => {
	const f = createFleet();
	f.sync({ a: ["shuttle"], b: ["freighter"] });
	f.sync({ a: ["shuttle"] });
	assert.deepEqual(Object.keys(f.toJSON().use), ["a/shuttle"]);
	const g = createFleet(JSON.parse(JSON.stringify(f.toJSON())));
	assert.equal(g.classFor("a", "shuttle").id, f.classFor("a", "shuttle").id);
	assert.equal(g.list("freighter").length, 1);   // kept although unused
	assert.equal(createFleet({ classes: [{ id: "x", role: "nope" }] }).list("shuttle").length, 0);
});
