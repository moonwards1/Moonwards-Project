import test from "node:test";
import assert from "node:assert/strict";
import { createFleet, shipDv, shieldMass, SHIELDS, shipTitle, versionName, MAX_VERSIONS, PROPELLANTS, DEFAULT_PROPELLANT } from "../ships.js";

test("chemical propellants only, magnesium / LOX by default", () => {
	assert.equal(DEFAULT_PROPELLANT, "mg-lox");
	assert.ok(PROPELLANTS.every((p) => p.isp < 500));
});

test("a new freighter starts on methane / LOX, others on the default", () => {
	const f = createFleet();
	f.sync({ a: ["freighter", "shuttle"] });
	const fr = f.classFor("a", "freighter");
	assert.equal(fr.propellant, "ch4-lox");
	assert.equal(fr.isp, 370);
	assert.equal(fr.tank, 20000);
	assert.equal(f.classFor("a", "shuttle").propellant, DEFAULT_PROPELLANT);
});

test("heat shields: none, crude 10%, advanced 4% of the loaded ship, on top of dry mass", () => {
	assert.deepEqual(SHIELDS.map((s) => s.key), ["none", "crude", "advanced"]);
	const c = { isp: 370, dry: 4000, payload: 50000, tank: 20000, shield: "advanced" };
	assert.equal(shieldMass(c), 2960);
	const hull = 4000 + 2960, g = 370 * 9.80665;
	assert.ok(Math.abs(shipDv(c).loaded - g * Math.log((hull + 70000) / (hull + 50000))) < 1e-9);
	assert.ok(Math.abs(shipDv(c).empty - g * Math.log((hull + 20000) / hull)) < 1e-9);
	assert.equal(shieldMass({ ...c, shield: "none" }), 0);
	assert.equal(shieldMass({ ...c, shield: "crude" }), 7400);
	assert.equal(shieldMass({ ...c, shield: true }), 2960);   // a design saved with the old yes / no
});

test("Isp follows the propellant; a saved Isp is ignored", () => {
	const f = createFleet({ classes: [{ id: "x", role: "shuttle", propellant: "lh2-lox", isp: 123 }] });
	assert.equal(f.list("shuttle")[0].isp, 450);
	f.update("x", { propellant: "ch4-lox", isp: 999 });
	assert.equal(f.list("shuttle")[0].isp, 370);
});

test("saved yes / no shields become advanced / none", () => {
	const f = createFleet({ classes: [
		{ id: "a", role: "freighter", shield: true }, { id: "b", role: "freighter", shield: false }] });
	assert.deepEqual(f.list("freighter").map((c) => c.shield), ["advanced", "none"]);
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

test("capsules always carry a heat shield, crude or advanced; edits are cleaned", () => {
	const f = createFleet();
	f.sync({ a: ["capsule"] });
	const c = f.classFor("a", "capsule");
	f.update(c.id, { shield: "crude" });
	assert.equal(c.shield, "crude");
	f.update(c.id, { shield: "none", dry: -5, role: "freighter" });
	assert.equal(c.shield, "advanced");
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

test("standard class; a local version reverts and is dropped", () => {
	const f = createFleet();
	f.sync({ a: ["shuttle"], b: ["shuttle"] });
	const s = f.standard("shuttle");
	assert.ok(f.isStandard(f.classFor("a", "shuttle")));
	const loc = f.copy(s.id, "a");
	assert.ok(!f.isStandard(loc));
	f.revert("a", "shuttle");
	assert.equal(f.classFor("a", "shuttle"), s);
	assert.equal(f.list("shuttle").length, 1);
	f.revert("a", "shuttle");   // already standard: nothing changes
	assert.equal(f.list("shuttle").length, 1);
});

test("titles: freighter versions by payload in kt and heat shield", () => {
	assert.equal(shipTitle({ role: "shuttle", payload: 30 }, false), "Shuttle");
	assert.equal(shipTitle({ role: "freighter", payload: 500 }, true), "Freighter");
	assert.equal(shipTitle({ role: "freighter", payload: 500, shield: "none" }, false), "Freighter 0.5 kt");
	assert.equal(shipTitle({ role: "freighter", payload: 12500, shield: "advanced" }, false), "Freighter 12.5 kt HS");
	assert.equal(versionName({ role: "freighter", payload: 12500, shield: "advanced" }), "12.5 kt HS");
	assert.equal(versionName({ role: "freighter", payload: 12500, shield: "crude" }), "12.5 kt CHS");
	assert.equal(versionName({ role: "freighter", payload: 500, shield: "none" }, true), "0.5");
});

test("freighter versions: at most MAX_VERSIONS, switchable, kept while unused", () => {
	const f = createFleet();
	f.sync({ a: ["freighter"], b: ["freighter"], c: ["shuttle"] });
	const s = f.standard("freighter");
	const v1 = f.copy(s.id, "a");
	const v2 = f.copy(v1.id, "a");   // one installation can make both versions
	assert.equal(f.list("freighter").length, MAX_VERSIONS);
	assert.equal(f.copy(s.id, "b"), null);
	f.assign("b", v1.id);
	assert.deepEqual(f.usedBy(v1.id), ["b"]);
	assert.ok(f.get(v2.id));
	const loc = f.copy(f.standard("shuttle").id, "c");
	f.sync({ b: ["freighter"] });   // c removed: its local shuttle goes, freighter versions stay
	assert.equal(f.get(loc.id), null);
	assert.equal(f.list("freighter").length, 3);
});

test("removing a version sends its installations to the standard", () => {
	const f = createFleet();
	f.sync({ a: ["freighter"], b: ["freighter"] });
	const s = f.standard("freighter");
	const v = f.copy(s.id, "a");
	f.assign("b", v.id);
	f.remove(v.id);
	assert.equal(f.get(v.id), null);
	assert.equal(f.classFor("a", "freighter"), s);
	assert.equal(f.classFor("b", "freighter"), s);
	f.remove(s.id);   // the standard can't be removed
	assert.equal(f.get(s.id), s);
});
