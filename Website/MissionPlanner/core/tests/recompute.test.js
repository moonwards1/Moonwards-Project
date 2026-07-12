// Node tests for recompute.js — the recompute/blocked semantics that
// ARCHITECTURE.md step 4.1 says must be verified before any UI exists.
// Run with:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../world.js";
import { createRegistry } from "../registry.js";
import { createEngine } from "../recompute.js";
import { makeDiagnostic, isDiagnostic } from "../diagnostics.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";

var JD = 2461234.5;

// A three-module toy chain that exercises the real contract:
//   src  (accepts [],           emits ship-state) — a release point; params.v
//        sets speed, params.fail makes it return a module-authored diagnostic
//   leg  (accepts [ship-state], emits ship-state) — adds params.dv to speed
//   sink (accepts [ship-state], emits [])         — terminal; returns null
function fixture() {
	var calls = { src: 0, leg: 0, sink: 0 };
	var reg = createRegistry();

	reg.register({
		id: "src", title: "Test source", attachesTo: "Moon",
		accepts: [], emits: ["ship-state"],
		update: function (ctx, input) {
			calls.src++;
			assert.equal(input, null);
			if (ctx.params.fail) {
				return makeDiagnostic("src-fail", "the source cannot release", {
					values: { v: ctx.params.v }, fix: "unset fail"
				});
			}
			return PacketTypes.make("ship-state",
				{ r: [0, 0, 0], v: [ctx.params.v, 0, 0], jd: ctx.jd, frame: "helio" },
				{ tool: "test-src" });
		}
	});

	reg.register({
		id: "leg", title: "Test leg",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) {
			calls.leg++;
			return PacketTypes.make("ship-state",
				{ r: input.data.r, v: [input.data.v[0] + ctx.params.dv, 0, 0],
				  jd: ctx.jd, frame: "helio" },
				{ tool: "test-leg" });
		}
	});

	reg.register({
		id: "sink", title: "Test sink",
		accepts: ["ship-state"], emits: [],
		update: function () { calls.sink++; return null; }
	});

	var w = createWorld({ jd: JD });
	var a = w.set({ addStage: { moduleId: "src", params: { v: 1000 } } });
	var b = w.set({ addStage: { moduleId: "leg", params: { dv: 500 } } });
	var c = w.set({ addStage: { moduleId: "sink", params: {} } });
	var engine = createEngine(w, reg);
	return { w: w, reg: reg, engine: engine, calls: calls, a: a, b: b, c: c };
}

function statuses(engine) {
	return engine.results().map(function (r) { return r.status; });
}

test("initial pass: whole chain computes, packets flow downstream", function () {
	var t = fixture();
	assert.deepEqual(statuses(t.engine), ["ok", "ok", "ok"]);
	assert.deepEqual(t.calls, { src: 1, leg: 1, sink: 1 });
	assert.equal(t.engine.resultFor(t.a).output.data.v[0], 1000);
	assert.equal(t.engine.resultFor(t.b).output.data.v[0], 1500);   // 1000 + dv 500
	assert.equal(t.engine.resultFor(t.c).output, null);             // terminal
	assert.equal(t.engine.resultFor(t.b).output.data.jd, JD);
});

test("jd change recomputes every stage (one clock feeds all)", function () {
	var t = fixture();
	t.w.set({ jd: JD + 30 });
	assert.deepEqual(t.calls, { src: 2, leg: 2, sink: 2 });
	assert.equal(t.engine.resultFor(t.b).output.data.jd, JD + 30);
});

test("a mid-chain param change recomputes downstream only", function () {
	var t = fixture();
	var srcOutBefore = t.engine.resultFor(t.a).output;
	t.w.set({ stage: t.b, params: { dv: 900 } });
	assert.deepEqual(t.calls, { src: 1, leg: 2, sink: 2 });          // src NOT rerun
	assert.equal(t.engine.resultFor(t.a).output, srcOutBefore);     // same object
	assert.equal(t.engine.resultFor(t.b).output.data.v[0], 1900);
});

test("a diagnostic blocks downstream, keeping params intact; fixing it unblocks", function () {
	var t = fixture();
	t.w.set({ stage: t.a, params: { fail: true } });
	var rs = t.engine.results();

	assert.equal(rs[0].status, "diagnostic");
	assert.equal(rs[0].diagnostic.code, "src-fail");
	assert.equal(rs[0].diagnostic.stageId, t.a);                    // engine filled it in
	assert.equal(rs[0].diagnostic.fix, "unset fail");
	assert.deepEqual(rs[0].diagnostic.values, { v: 1000 });         // offending numbers

	assert.equal(rs[1].status, "blocked");
	assert.equal(rs[1].blockedOn, t.a);                             // "waiting on stage N"
	assert.equal(rs[2].status, "blocked");
	assert.equal(rs[2].blockedOn, t.a);
	assert.deepEqual(t.calls, { src: 2, leg: 1, sink: 1 });          // blocked stages not run
	assert.deepEqual(t.w.getStage(t.b).params, { dv: 500 });        // params intact

	// A change on a BLOCKED stage recomputes from there — still blocked,
	// upstream diagnostic untouched, upstream not rerun:
	t.w.set({ stage: t.b, params: { dv: 700 } });
	assert.equal(t.engine.resultFor(t.b).status, "blocked");
	assert.deepEqual(t.calls, { src: 2, leg: 1, sink: 1 });

	// Fix the source; the whole chain comes back with the new dv:
	t.w.set({ stage: t.a, params: { fail: false } });
	assert.deepEqual(statuses(t.engine), ["ok", "ok", "ok"]);
	assert.equal(t.engine.resultFor(t.b).output.data.v[0], 1700);
});

test("an infeasible mission is storable: it lives in World, blocked or not", function () {
	var t = fixture();
	t.w.set({ stage: t.a, params: { fail: true } });
	var saved = t.w.serialize();                                    // no throw, full profile
	assert.equal(saved.stages.length, 3);
	assert.equal(saved.stages[0].params.fail, true);
});

test("unknown moduleId is a diagnostic, not an exception", function () {
	var t = fixture();
	t.w.set({ addStage: { moduleId: "warp-drive" }, before: t.c });
	var rs = t.engine.results();
	assert.equal(rs[2].status, "diagnostic");
	assert.equal(rs[2].diagnostic.code, "unknown-module");
	assert.equal(rs[3].status, "blocked");
	assert.equal(rs[3].blockedOn, rs[2].stageId);
});

test("a module registered late is picked up by a manual recompute", function () {
	var t = fixture();
	var d = t.w.set({ addStage: { moduleId: "late" }, before: t.c });
	assert.equal(t.engine.resultFor(d).diagnostic.code, "unknown-module");
	t.reg.register({
		id: "late", title: "Late module",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) { return input; }             // pass-through
	});
	t.engine.recompute();
	assert.equal(t.engine.resultFor(d).status, "ok");
});

test("update() throwing becomes a module-error diagnostic; engine survives", function () {
	var t = fixture();
	t.reg.register({
		id: "boom", title: "Exploding module",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function () { throw new Error("kaboom"); }
	});
	var d = t.w.set({ addStage: { moduleId: "boom" }, before: t.c });
	var r = t.engine.resultFor(d);
	assert.equal(r.diagnostic.code, "module-error");
	assert.match(r.diagnostic.message, /kaboom/);
	assert.equal(t.engine.resultFor(t.c).status, "blocked");
});

test("bad outputs become bad-output diagnostics", function () {
	var t = fixture();
	t.reg.register({
		id: "garbage", title: "Garbage emitter",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function () { return { totally: "not a packet" }; }
	});
	t.reg.register({
		id: "liar", title: "Undeclared-type emitter",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) {
			return PacketTypes.make("tether-spec",
				{ body: "Moon", footAlt: 1, centreAlt: 2, topAlt: 3,
				  material: { sigma: 1, rho: 1 } }, { tool: "liar" });
		}
	});
	var g = t.w.set({ addStage: { moduleId: "garbage" }, before: t.c });
	assert.equal(t.engine.resultFor(g).diagnostic.code, "bad-output");
	t.w.set({ swapStage: g, moduleId: "liar" });
	var r = t.engine.resultFor(g);
	assert.equal(r.diagnostic.code, "bad-output");
	assert.match(r.diagnostic.message, /tether-spec/);
});

test("input-type mismatch is a diagnostic on the consuming stage", function () {
	var t = fixture();
	t.reg.register({
		id: "tether-eater", title: "Tether consumer",
		accepts: ["tether-spec"], emits: [],
		update: function () { return null; }
	});
	var d = t.w.set({ addStage: { moduleId: "tether-eater" }, before: t.c });
	var r = t.engine.resultFor(d);
	assert.equal(r.diagnostic.code, "input-type-mismatch");
	assert.deepEqual(r.diagnostic.values, { got: "ship-state", accepts: ["tether-spec"] });
});

test("a consumer with nothing upstream gets missing-input", function () {
	var t = fixture();
	t.w.set({ moveStage: t.a, before: null });                      // leg is now first
	var r = t.engine.resultFor(t.b);
	assert.equal(r.status, "diagnostic");
	assert.equal(r.diagnostic.code, "missing-input");
	// ...and a consumer after a null-emitting terminal stage, likewise:
	var d = t.w.set({ addStage: { moduleId: "leg" } });             // after sink (emits null)
	assert.equal(t.engine.resultFor(d).status, "blocked");          // blocked by leg's diag above
});

test("null output flows as missing-input, not a crash", function () {
	var t = fixture();
	var d = t.w.set({ addStage: { moduleId: "leg" } });             // append after sink
	var r = t.engine.resultFor(d);
	assert.equal(r.diagnostic.code, "missing-input");               // sink emitted nothing
	assert.deepEqual(statuses(t.engine).slice(0, 3), ["ok", "ok", "ok"]);   // rest untouched
});

test("world.set() from inside update() throws (locked) and surfaces as module-error", function () {
	var t = fixture();
	t.reg.register({
		id: "mutator", title: "World-mutating module",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) { ctx.world.set({ jd: 0 }); return input; }
	});
	var d = t.w.set({ addStage: { moduleId: "mutator" }, before: t.c });
	var r = t.engine.resultFor(d);
	assert.equal(r.diagnostic.code, "module-error");
	assert.match(r.diagnostic.message, /locked/);
	assert.equal(t.w.jd, JD);                                       // the set was refused
});

test("removing a stage drops its result and re-links the chain", function () {
	var t = fixture();
	t.w.set({ removeStage: t.b });
	assert.equal(t.engine.resultFor(t.b), null);
	assert.deepEqual(statuses(t.engine), ["ok", "ok"]);
	assert.equal(t.engine.resultFor(t.c).status, "ok");             // sink now fed by src
	assert.deepEqual(t.calls, { src: 1, leg: 1, sink: 2 });          // only sink reran
});

test("inserting a stage recomputes from the insertion point only", function () {
	var t = fixture();
	var mid = t.w.set({ addStage: { moduleId: "leg", params: { dv: 250 } }, before: t.b });
	assert.equal(t.calls.src, 1);                                   // upstream untouched
	assert.equal(t.engine.resultFor(mid).output.data.v[0], 1250);
	assert.equal(t.engine.resultFor(t.b).output.data.v[0], 1750);   // 1250 + 500
	assert.deepEqual(statuses(t.engine), ["ok", "ok", "ok", "ok"]);
});

test("same module at two stages gets its own params at each (ctx per stage)", function () {
	var t = fixture();
	var mid = t.w.set({ addStage: { moduleId: "leg", params: { dv: 111 } }, before: t.b });
	assert.equal(t.engine.resultFor(mid).output.data.v[0], 1111);
	assert.equal(t.engine.resultFor(t.b).output.data.v[0], 1611);
});

test("results are keyed by stable id and survive reordering", function () {
	var t = fixture();
	t.reg.register({
		id: "leg2", title: "Second leg",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) {
			return PacketTypes.make("ship-state",
				{ r: input.data.r, v: [input.data.v[0] * 2, 0, 0], jd: ctx.jd, frame: "helio" },
				{ tool: "leg2" });
		}
	});
	var d = t.w.set({ addStage: { moduleId: "leg2" }, before: t.b });
	t.w.set({ moveStage: d, before: t.c });                         // src, leg, leg2, sink
	assert.equal(t.engine.resultFor(d).output.data.v[0], 3000);     // (1000+500)*2
	assert.equal(t.engine.resultFor(t.b).output.data.v[0], 1500);
});

test("onRecompute fires per pass and unsubscribes cleanly", function () {
	var t = fixture();
	var passes = 0, lastLen = 0;
	var off = t.engine.onRecompute(function (rs) { passes++; lastLen = rs.length; });
	t.w.set({ jd: JD + 1 });
	assert.equal(passes, 1);
	assert.equal(lastLen, 3);
	off();
	t.w.set({ jd: JD + 2 });
	assert.equal(passes, 1);
});

test("dispose() detaches the engine from the World", function () {
	var t = fixture();
	t.engine.dispose();
	t.w.set({ jd: JD + 5 });
	assert.deepEqual(t.calls, { src: 1, leg: 1, sink: 1 });          // no further passes
});

test("transient sets (mid-gesture) still recompute live", function () {
	var t = fixture();
	t.w.set({ jd: JD + 0.25 }, { transient: true });
	assert.equal(t.engine.resultFor(t.a).output.data.jd, JD + 0.25);
});

test("inputOptional: a consumer with nothing upstream runs with input null", function () {
	// The comply-mode carve-out (see recompute.js header): the frozen-plan
	// module must emit its plan even when the mission has no departure tech
	// yet, so a descriptor may declare missing input survivable.
	var t = fixture();
	var seen = "unset";
	t.reg.register({
		id: "optional-in", title: "Optional consumer",
		accepts: ["ship-state"], emits: ["ship-state"], inputOptional: true,
		update: function (ctx, input) {
			seen = input;
			return PacketTypes.make("ship-state",
				{ r: [0, 0, 0], v: [7777, 0, 0], jd: ctx.jd, frame: "helio" },
				{ tool: "optional-in" });
		}
	});
	// Appended after sink, which emits null — the exact spot where a plain
	// consumer gets missing-input (see the test above).
	var d = t.w.set({ addStage: { moduleId: "optional-in" } });
	var r = t.engine.resultFor(d);
	assert.equal(r.status, "ok");
	assert.equal(seen, null);                                       // called, with null
	assert.equal(r.output.data.v[0], 7777);
	assert.deepEqual(statuses(t.engine), ["ok", "ok", "ok", "ok"]);
});

test("inputOptional: when input DOES arrive it is type-checked as usual", function () {
	var t = fixture();
	t.reg.register({
		id: "optional-picky", title: "Optional but picky",
		accepts: ["tether-spec"], emits: [], inputOptional: true,
		update: function () { return null; }
	});
	var d = t.w.set({ addStage: { moduleId: "optional-picky" }, before: t.c });
	var r = t.engine.resultFor(d);                                  // fed a ship-state
	assert.equal(r.status, "diagnostic");
	assert.equal(r.diagnostic.code, "input-type-mismatch");
});

test("module-authored diagnostics keep their own stageId if set", function () {
	var t = fixture();
	t.reg.register({
		id: "self-id", title: "Self-identifying failer",
		accepts: [], emits: ["ship-state"],
		update: function (ctx) {
			return makeDiagnostic("custom", "failed", { stageId: ctx.stageId, values: { n: 1 } });
		}
	});
	var d = t.w.set({ addStage: { moduleId: "self-id" }, before: t.a });
	var r = t.engine.resultFor(d);
	assert.equal(isDiagnostic(r.diagnostic), true);
	assert.equal(r.diagnostic.stageId, d);
});
