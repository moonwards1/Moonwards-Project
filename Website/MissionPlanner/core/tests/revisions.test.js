/* core/revisions — the plan history: what a mission stored when it was frozen,
 * what it stores now, and the two sets a link carries between them. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	createHistory, recordUpdate, markFinished, latestOf, stateOf, isFinished,
	packSets, readSets, readHistory, entriesOf, planSummaryOf, changesBetween
} from "../revisions.js";
import { defaultMission } from "../../presets/default-mission.js";

function planWith(changes) {
	var w = JSON.parse(JSON.stringify(defaultMission));
	changes(w);
	return w;
}

test("a fresh history is the original alone", function () {
	var h = createHistory({ a: 1 });
	assert.equal(stateOf(h), "original");
	assert.equal(latestOf(h), null);
	assert.deepEqual(entriesOf(h).map(function (e) { return e.state; }), ["original"]);
	assert.equal(packSets(h).latest, null);
});

test("updates append; the original never moves", function () {
	var h = recordUpdate(recordUpdate(createHistory({ a: 1 }), { a: 2 }), { a: 3 });
	assert.equal(h.original.a, 1);
	assert.equal(h.steps.length, 2);
	assert.equal(stateOf(h), "updated");
	assert.deepEqual(latestOf(h).world, { a: 3 });
});

test("each commit returns a NEW history, so a held reference can't go stale silently", function () {
	var first = createHistory({ a: 1 });
	var second = recordUpdate(first, { a: 2 });
	assert.equal(first.steps.length, 0);
	assert.notEqual(first, second);
});

test("finishing compacts to original + the finished set", function () {
	var h = recordUpdate(recordUpdate(createHistory({ a: 1 }), { a: 2 }), { a: 3 });
	var f = markFinished(h, { a: 4 });
	assert.equal(f.original.a, 1);
	assert.equal(f.steps.length, 1);
	assert.equal(stateOf(f), "finished");
	assert.ok(isFinished(f));
	assert.deepEqual(latestOf(f).world, { a: 4 });
});

test("editing after finishing re-opens the run rather than being refused", function () {
	var f = markFinished(createHistory({ a: 1 }), { a: 2 });
	var again = recordUpdate(f, { a: 3 });
	assert.equal(stateOf(again), "updated");
	assert.equal(again.original.a, 1);
});

test("a link carries two sets however long the local run is", function () {
	var h = createHistory({ a: 0 });
	for (var i = 1; i <= 12; i++) { h = recordUpdate(h, { a: i }); }
	assert.equal(h.steps.length, 12);
	var sets = packSets(h);
	assert.equal(Object.keys(sets).length, 2);
	assert.deepEqual(sets.original, { a: 0 });
	assert.deepEqual(sets.latest.world, { a: 12 });
});

test("packSets/readSets round-trips through JSON", function () {
	var h = markFinished(recordUpdate(createHistory({ a: 1 }), { a: 2 }), { a: 3 });
	var back = readSets(JSON.parse(JSON.stringify(packSets(h))));
	assert.equal(stateOf(back), "finished");
	assert.deepEqual(back.original, { a: 1 });
	assert.deepEqual(latestOf(back).world, { a: 3 });
});

test("malformed records cost the history, not the mission", function () {
	assert.equal(readSets(null), null);
	assert.equal(readSets({}), null);
	assert.equal(readSets({ original: "not an object" }), null);
	assert.equal(readHistory({ original: { a: 1 }, steps: "nonsense" }).steps.length, 0);
	// A step with no world is dropped; the rest survive.
	var h = readHistory({ original: { a: 1 }, steps: [{ state: "updated" }, { state: "updated", world: { a: 2 } }] });
	assert.equal(h.steps.length, 1);
});

test("an unfamiliar state label is kept as a later plan, read as 'updated'", function () {
	var h = readSets({ original: { a: 1 }, latest: { state: "abandoned", world: { a: 2 } } });
	assert.equal(stateOf(h), "updated");
	assert.deepEqual(latestOf(h).world, { a: 2 });
});

test("planSummaryOf reads the shipped mission's stored values", function () {
	var rows = planSummaryOf(defaultMission).rows;
	function val(k) { return rows.filter(function (r) { return r.key === k; })[0].value; }
	assert.equal(val("origin"), "Moon");
	assert.equal(val("destination"), "Ceres");
	assert.equal(val("handoffJd"), 2463222.384503543);
	assert.equal(val("releaseJd"), 2463220.296116752);
	assert.equal(val("arrivalVInf"), 3776.34);
	assert.equal(val("legDays"), 748.365496);
	assert.equal(val("planWps"), 1);
	assert.equal(val("tech"), "moon-platform → orbital-skyhook");
});

test("a plan compared with itself shows no change (a JSON round trip is not an edit)", function () {
	var copy = JSON.parse(JSON.stringify(defaultMission));
	assert.equal(changesBetween(defaultMission, copy).filter(function (c) { return c.changed; }).length, 0);
});

test("changesBetween names exactly what moved", function () {
	var after = planWith(function (w) {
		w.stages[4].params.legDays = 800;              // transfer-leg horizon
		w.stages[3].params.arrival.vInf = 4000;        // frozen-plan commitment
	});
	var moved = changesBetween(defaultMission, after).filter(function (c) { return c.changed; });
	assert.deepEqual(moved.map(function (c) { return c.key; }).sort(), ["arrivalVInf", "legDays"]);
	var horizon = moved.filter(function (c) { return c.key === "legDays"; })[0];
	assert.equal(horizon.was, 748.365496);
	assert.equal(horizon.now, 800);
});

test("a technology added to the stack shows up as a change", function () {
	var after = planWith(function (w) {
		w.stages.splice(2, 0, { id: "stg-9", moduleId: "some-carrier", params: {} });
	});
	var moved = changesBetween(defaultMission, after).filter(function (c) { return c.changed; });
	assert.deepEqual(moved.map(function (c) { return c.key; }), ["tech"]);
	assert.match(moved[0].now, /some-carrier/);
});

test("a plan missing stages summarises as nulls rather than throwing", function () {
	var rows = planSummaryOf({ stages: [] }).rows;
	assert.ok(rows.every(function (r) { return r.value === null || r.key === "tech"; }));
	assert.equal(planSummaryOf({}).rows.length, rows.length);
});

test("a technology's own stored dials each get a row", function () {
	var rows = planSummaryOf(defaultMission).rows;
	var dial = rows.filter(function (r) { return /release phase deg/.test(r.label); })[0];
	assert.ok(dial, "the skyhook's release phase is reported");
	assert.equal(dial.value, 92);
	assert.match(dial.label, /^orbital-skyhook · /);
});

test("re-tuning a technology shows up as a change", function () {
	var after = planWith(function (w) { w.stages[1].params.releasePhaseDeg = 100; });
	var moved = changesBetween(defaultMission, after).filter(function (c) { return c.changed; });
	assert.equal(moved.length, 1);
	assert.equal(moved[0].was, 92);
	assert.equal(moved[0].now, 100);
});

test("a technology inserted ABOVE another doesn't make the other's dials read as changed", function () {
	// Keys are per-module-occurrence, not per chain position: a row that moved
	// down the stack is the same row.
	var after = planWith(function (w) {
		w.stages.splice(1, 0, { id: "stg-9", moduleId: "mass-driver", params: { railKm: 12 } });
	});
	var moved = changesBetween(defaultMission, after).filter(function (c) { return c.changed; });
	var keys = moved.map(function (c) { return c.key; });
	assert.ok(keys.indexOf("tech") >= 0, "the stack itself changed");
	assert.ok(keys.some(function (k) { return /mass-driver/.test(k); }), "the new tech's dials appear");
	assert.ok(!keys.some(function (k) { return /orbital-skyhook/.test(k); }),
		"the untouched skyhook reports nothing");
});

test("two of the same module are told apart", function () {
	var w = planWith(function (x) {
		x.stages.splice(2, 0, { id: "stg-9", moduleId: "orbital-skyhook", params: { comAlt: 1 } });
	});
	var labels = planSummaryOf(w).rows.map(function (r) { return r.label; });
	assert.ok(labels.some(function (l) { return /^orbital-skyhook · com alt/.test(l); }));
	assert.ok(labels.some(function (l) { return /^orbital-skyhook #2 · com alt/.test(l); }));
});

test("a dial only one side has reads null on the other, in both directions", function () {
	var after = planWith(function (w) { w.stages[1].params.newDial = 5; });
	var added = changesBetween(defaultMission, after).filter(function (c) { return c.changed; });
	assert.equal(added.length, 1);
	assert.equal(added[0].was, null);
	assert.equal(added[0].now, 5);

	var removed = changesBetween(after, defaultMission).filter(function (c) { return c.changed; });
	assert.equal(removed.length, 1);
	assert.equal(removed[0].was, 5);
	assert.equal(removed[0].now, null);
});

test("nested params are left out rather than stringified into a fake row", function () {
	var w = planWith(function (x) { x.stages[1].params.nested = { a: 1 }; x.stages[1].params.list = [1, 2, 3]; });
	var rows = planSummaryOf(w).rows;
	assert.ok(!rows.some(function (r) { return /nested/.test(r.label); }));
	var list = rows.filter(function (r) { return /· list/.test(r.label); })[0];
	assert.equal(list.value, 3, "a list reports its length");
});
