// Node tests for world.js. Run with:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, deserializeWorld, WORLD_KIND, WORLD_VERSION } from "../world.js";

var JD = 2461234.5;

function worldWithChain() {
	var w = createWorld({ jd: JD });
	var a = w.set({ addStage: { moduleId: "src", params: { v: 1000 } } });
	var b = w.set({ addStage: { moduleId: "leg", params: { dv: 500 } } });
	var c = w.set({ addStage: { moduleId: "sink", params: {} } });
	return { w: w, a: a, b: b, c: c };
}

test("createWorld requires a finite jd", function () {
	assert.throws(function () { createWorld(); }, /jd/);
	assert.throws(function () { createWorld({ jd: NaN }); }, /jd/);
	assert.equal(createWorld({ jd: JD }).jd, JD);
});

test("set({jd}) moves the clock and notifies with index 0", function () {
	var w = createWorld({ jd: JD });
	var seen = null;
	w.onChange(function (info) { seen = info; });
	w.set({ jd: JD + 10 });
	assert.equal(w.jd, JD + 10);
	assert.equal(seen.index, 0);
	assert.equal(seen.transient, false);
});

test("addStage appends, inserts before, and returns stable ids", function () {
	var t = worldWithChain();
	assert.deepEqual(t.w.stages().map(function (s) { return s.id; }), [t.a, t.b, t.c]);
	assert.equal(t.a, "stg-1");
	var mid = t.w.set({ addStage: { moduleId: "leg2" }, before: t.b });
	assert.deepEqual(t.w.stages().map(function (s) { return s.id; }), [t.a, mid, t.b, t.c]);
	assert.deepEqual(t.w.getStage(mid).params, {});   // params default to {}
});

test("stage ids are never reused after a removal", function () {
	var t = worldWithChain();
	t.w.set({ removeStage: t.c });
	var d = t.w.set({ addStage: { moduleId: "sink" } });
	assert.notEqual(d, t.c);
});

test("set({stage, params}) merges partially", function () {
	var t = worldWithChain();
	t.w.set({ stage: t.b, params: { dv: 900 } });
	assert.deepEqual(t.w.getStage(t.b).params, { dv: 900 });
	t.w.set({ stage: t.b, params: { plane: 5 } });
	assert.deepEqual(t.w.getStage(t.b).params, { dv: 900, plane: 5 });
});

test("moveStage reorders; notify index is the earlier position", function () {
	var t = worldWithChain();
	var seen = null;
	t.w.onChange(function (info) { seen = info; });
	t.w.set({ moveStage: t.c, before: t.a });          // c to front
	assert.deepEqual(t.w.stages().map(function (s) { return s.id; }), [t.c, t.a, t.b]);
	assert.equal(seen.index, 0);
	t.w.set({ moveStage: t.c, before: null });          // null = to end
	assert.deepEqual(t.w.stages().map(function (s) { return s.id; }), [t.a, t.b, t.c]);
	assert.equal(seen.index, 0);
	t.w.set({ moveStage: t.b, before: t.b });           // before itself: no-op
	assert.deepEqual(t.w.stages().map(function (s) { return s.id; }), [t.a, t.b, t.c]);
});

test("removeStage notifies with the removed index", function () {
	var t = worldWithChain();
	var seen = null;
	t.w.onChange(function (info) { seen = info; });
	t.w.set({ removeStage: t.b });
	assert.deepEqual(t.w.stages().map(function (s) { return s.id; }), [t.a, t.c]);
	assert.equal(seen.index, 1);
});

test("swapStage keeps the id, replaces module and params", function () {
	var t = worldWithChain();
	t.w.set({ swapStage: t.b, moduleId: "spin-launcher", params: { tip: 2000 } });
	var s = t.w.getStage(t.b);
	assert.equal(s.id, t.b);
	assert.equal(s.moduleId, "spin-launcher");
	assert.deepEqual(s.params, { tip: 2000 });
	assert.equal(t.w.indexOf(t.b), 1);                  // position unchanged
});

test("malformed changes and unknown ids throw", function () {
	var t = worldWithChain();
	assert.throws(function () { t.w.set({}); }, /unrecognised change/);
	assert.throws(function () { t.w.set({ jd: "tuesday" }); }, /jd/);
	assert.throws(function () { t.w.set({ stage: "stg-99", params: {} }); }, /stg-99/);
	assert.throws(function () { t.w.set({ stage: t.a }); }, /params/);
	assert.throws(function () { t.w.set({ addStage: {} }); }, /moduleId/);
	assert.throws(function () { t.w.set({ removeStage: "nope" }); }, /nope/);
	assert.throws(function () { t.w.set({ swapStage: t.a }); }, /moduleId/);
});

test("transient flag reaches listeners", function () {
	var w = createWorld({ jd: JD });
	var seen = null;
	w.onChange(function (info) { seen = info; });
	w.set({ jd: JD + 0.01 }, { transient: true });
	assert.equal(seen.transient, true);
});

test("onChange unsubscribe works", function () {
	var w = createWorld({ jd: JD });
	var n = 0;
	var off = w.onChange(function () { n++; });
	w.set({ jd: JD + 1 });
	off();
	w.set({ jd: JD + 2 });
	assert.equal(n, 1);
});

test("lock() makes set() throw before mutating; unlock() restores", function () {
	var w = createWorld({ jd: JD });
	w.lock("recompute in progress");
	assert.throws(function () { w.set({ jd: 0 }); }, /locked/);
	assert.equal(w.jd, JD);                             // nothing mutated
	w.unlock();
	w.set({ jd: JD + 1 });
	assert.equal(w.jd, JD + 1);
});

test("serialize: versioned, JSON-able, and a deep copy", function () {
	var t = worldWithChain();
	var s = t.w.serialize();
	assert.equal(s.kind, WORLD_KIND);
	assert.equal(s.version, WORLD_VERSION);
	assert.equal(s.jd, JD);
	assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
	s.stages[0].params.v = 9999;                        // mutating the copy...
	assert.equal(t.w.getStage(t.a).params.v, 1000);     // ...leaves World alone
});

test("deserialize round-trips a mission, ids intact", function () {
	var t = worldWithChain();
	t.w.set({ stage: t.b, params: { dv: 777 } });
	var r = deserializeWorld(t.w.serialize());
	assert.equal(r.ok, true);
	assert.deepEqual(r.world.serialize(), t.w.serialize());
	// New stages after a load keep ids fresh (counter survived the trip):
	var d = r.world.set({ addStage: { moduleId: "x" } });
	assert.equal(t.w.getStage(d), null);
	assert.equal(r.world.getStage(d).id, "stg-4");
});

test("deserialize derives the id counter when nextStage is absent", function () {
	var t = worldWithChain();
	var s = t.w.serialize();
	delete s.nextStage;
	var r = deserializeWorld(s);
	assert.equal(r.ok, true);
	assert.equal(r.world.set({ addStage: { moduleId: "x" } }), "stg-4");
});

test("an infeasible or unknown-module mission is still storable", function () {
	var w = createWorld({ jd: JD });
	w.set({ addStage: { moduleId: "module-that-does-not-exist", params: { broken: true } } });
	var r = deserializeWorld(w.serialize());
	assert.equal(r.ok, true);
	assert.equal(r.world.stages()[0].moduleId, "module-that-does-not-exist");
});

test("deserialize refuses bad saves with a reason, never throws", function () {
	assert.equal(deserializeWorld(null).ok, false);
	assert.equal(deserializeWorld({ kind: "something-else" }).ok, false);
	var newer = { kind: WORLD_KIND, version: WORLD_VERSION + 1, jd: JD, stages: [] };
	var r = deserializeWorld(newer);
	assert.equal(r.ok, false);
	assert.match(r.reason, /newer/);
	assert.equal(deserializeWorld({ kind: WORLD_KIND, version: 1, jd: "x", stages: [] }).ok, false);
	assert.equal(deserializeWorld({ kind: WORLD_KIND, version: 1, jd: JD }).ok, false);
	assert.equal(deserializeWorld({ kind: WORLD_KIND, version: 1, jd: JD,
		stages: [{ id: "", moduleId: "m" }] }).ok, false);
	var dup = deserializeWorld({ kind: WORLD_KIND, version: 1, jd: JD,
		stages: [{ id: "stg-1", moduleId: "m" }, { id: "stg-1", moduleId: "m" }] });
	assert.equal(dup.ok, false);
	assert.match(dup.reason, /duplicate/);
});
