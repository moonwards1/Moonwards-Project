// Node tests for diagnostics.js. Run with:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDiagnostic, isDiagnostic, DIAGNOSTIC_KIND } from "../diagnostics.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";

test("makeDiagnostic builds the full shape", function () {
	var d = makeDiagnostic("vinf-too-high", "v-inf exceeds tip speed", {
		stageId: "stg-3",
		values: { vInf: 3400, tipSpeed: 2100 },
		fix: "lower arrival v-inf below 2.1 km/s"
	});
	assert.equal(d.kind, DIAGNOSTIC_KIND);
	assert.equal(d.stageId, "stg-3");
	assert.equal(d.code, "vinf-too-high");
	assert.equal(d.message, "v-inf exceeds tip speed");
	assert.deepEqual(d.values, { vInf: 3400, tipSpeed: 2100 });
	assert.equal(d.fix, "lower arrival v-inf below 2.1 km/s");
});

test("makeDiagnostic defaults: stageId null, values {}, no fix key", function () {
	var d = makeDiagnostic("x", "y");
	assert.equal(d.stageId, null);
	assert.deepEqual(d.values, {});
	assert.equal("fix" in d, false);
});

test("makeDiagnostic is JSON-able", function () {
	var d = makeDiagnostic("x", "y", { values: { a: 1 } });
	assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});

test("makeDiagnostic throws on missing code or message", function () {
	assert.throws(function () { makeDiagnostic("", "msg"); }, /code/);
	assert.throws(function () { makeDiagnostic("code", ""); }, /message/);
});

test("isDiagnostic tells diagnostics from packets and junk", function () {
	assert.equal(isDiagnostic(makeDiagnostic("x", "y")), true);
	var packet = PacketTypes.make("ship-state",
		{ r: [1, 0, 0], v: [0, 1, 0], jd: 2461000, frame: "helio" }, { tool: "test" });
	assert.equal(isDiagnostic(packet), false);
	assert.equal(isDiagnostic(null), false);
	assert.equal(isDiagnostic(undefined), false);
	assert.equal(isDiagnostic("moonwards-diagnostic"), false);
	assert.equal(isDiagnostic({}), false);
});
