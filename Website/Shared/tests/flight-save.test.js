// Node tests for Shared/flight-save.js. Run from the repo root:
//   node --test Website/Shared/tests/flight-save.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { encodeFragmentZ, decodeFragmentAny } from "../exchange.js";
import { packFlight, packCollection, unpackFlights, putEntry, removeEntry, findEntry, uniqueName,
         readList, fileNameFor, fragmentFromText, FLIGHT_KIND } from "../flight-save.js";

var APP = "earth-moon-traffic";
var F = { from: "moonSkyhook", to: "earthSkyhook", dateJd: 2480000.25, relFrac: 0.3,
          params: { moonSkyhook: { footAlt: 1e3 } }, waypoints: [{ t: 3600, burn: { pro: 1, rad: 0, nrm: 0 } }] };

test("a packed flight unpacks to the same flight", function () {
	var env = packFlight(APP, 1, "  Moon to Earth  ", F, "2026-11-20");
	assert.equal(env.kind, FLIGHT_KIND);
	assert.equal(env.name, "Moon to Earth");
	var r = unpackFlights(JSON.parse(JSON.stringify(env)), APP, 1);
	assert.ok(r.ok);
	assert.equal(r.entries.length, 1);
	assert.deepEqual(r.entries[0].flight, F);
	assert.equal(r.entries[0].name, "Moon to Earth");
});

test("a flight from another plotter, or a newer format, is refused with a reason", function () {
	var other = unpackFlights(packFlight("mars-system-traffic", 1, "x", F), APP, 1);
	assert.equal(other.ok, false);
	assert.match(other.reason, /Mars System/);
	var newer = unpackFlights(packFlight(APP, 3, "x", F), APP, 2);
	assert.equal(newer.ok, false);
	assert.match(newer.reason, /newer/);
	assert.equal(unpackFlights({ hello: 1 }, APP, 1).ok, false);
	assert.equal(unpackFlights(null, APP, 1).ok, false);
});

test("a collection keeps what it can read and reports the rest", function () {
	var col = packCollection(APP, 1, [{ name: "a", flight: F }, { name: "b", flight: F }]);
	col.flights.push(packFlight(APP, 9, "too new", F));
	var r = unpackFlights(col, APP, 1);
	assert.ok(r.ok);
	assert.deepEqual(r.entries.map(function (e) { return e.name; }), ["a", "b"]);
	assert.equal(r.skipped.length, 1);
});

test("the list: put replaces by name, newest first; remove; unique names", function () {
	var list = [];
	list = putEntry(list, { name: "One", flight: F });
	list = putEntry(list, { name: "Two", flight: F });
	list = putEntry(list, { name: "one", flight: { from: "x" } });
	assert.deepEqual(list.map(function (e) { return e.name; }), ["one", "Two"]);
	assert.equal(findEntry(list, "ONE").flight.from, "x");
	assert.equal(uniqueName(list, "Two"), "Two (2)");
	assert.equal(uniqueName(putEntry(list, { name: "Two (2)", flight: F }), "Two"), "Two (3)");
	assert.equal(uniqueName(list, "Three"), "Three");
	assert.deepEqual(removeEntry(list, "two").map(function (e) { return e.name; }), ["one"]);
});

test("readList survives anything", function () {
	assert.deepEqual(readList(null), []);
	assert.deepEqual(readList("not json"), []);
	assert.deepEqual(readList('{"a":1}'), []);
	assert.equal(readList(JSON.stringify([{ name: "a", flight: {} }, { name: 3 }, 7])).length, 1);
});

test("file names are safe", function () {
	assert.equal(fileNameFor("emt-flight", "Moon skyhook → Earth: 2080/03/22"), "emt-flight-Moon-skyhook-to-Earth-20800322.json");
	assert.equal(fileNameFor("emt-flights", ""), "emt-flights.json");
});

test("pasted links are cleaned up, prose is not taken for one", function () {
	var frag = "zAbC_123-xyzQRS";
	assert.equal(fragmentFromText("https://x.io/page.html#flight=" + frag, "flight"), frag);
	assert.equal(fragmentFromText("see https://x.io/p#flight=zAbC_\n123-xy​z QRS.", "flight"), frag);
	assert.equal(fragmentFromText(frag, "flight"), frag);
	assert.equal(fragmentFromText("not a link at all", "flight"), null);
	assert.equal(fragmentFromText("https://x.io/#mission=" + frag, "flight"), null);
	assert.equal(fragmentFromText("#flight=ab", "flight"), null);
});

test("a flight survives the compressed link fragment", async function () {
	var env = packFlight(APP, 1, "Linked", F);
	var frag = await encodeFragmentZ(env);
	assert.ok(frag.length < 2000);
	var back = unpackFlights(await decodeFragmentAny(fragmentFromText("https://x.io/#flight=" + frag, "flight")), APP, 1);
	assert.ok(back.ok);
	assert.deepEqual(back.entries[0].flight, F);
});
