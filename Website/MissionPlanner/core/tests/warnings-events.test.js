// Node tests for the { packet, warnings, events } envelope return added to
// recompute.js for the Mission Planner's comply mode (MissionPlannerDesign.md):
// warnings are diagnostics that do NOT block downstream, events feed the
// phase sliders / stage strip. Hard-failure blocking semantics must be
// unchanged — that is asserted here too.
// Run with:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../world.js";
import { createRegistry } from "../registry.js";
import { createEngine } from "../recompute.js";
import { makeDiagnostic } from "../diagnostics.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";

var JD = 2461234.5;

function ship(v, jd) {
	return PacketTypes.make("ship-state",
		{ r: [0, 0, 0], v: [v, 0, 0], jd: jd, frame: "helio" },
		{ tool: "test" });
}

// A comply-mode-shaped chain:
//   src   (accepts [], emits ship-state) — the "tech": delivers params.v
//   plan  (accepts/emits ship-state)     — the frozen flight plan: ALWAYS
//         emits its own frozen output (params.planV), and when the incoming
//         speed misses params.requiredV it attaches a warning instead of
//         failing — the comply-mode contract.
//   sink  (accepts ship-state, emits []) — the arrival tech; returns null
function fixture() {
	var calls = { src: 0, plan: 0, sink: 0 };
	var reg = createRegistry();

	reg.register({
		id: "src", title: "Test tech", attachesTo: "Moon",
		accepts: [], emits: ["ship-state"],
		update: function (ctx) {
			calls.src++;
			return ship(ctx.params.v, ctx.jd);
		}
	});

	reg.register({
		id: "plan", title: "Frozen plan",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) {
			calls.plan++;
			var out = { packet: ship(ctx.params.planV, ctx.jd) };
			if (input.data.v[0] !== ctx.params.requiredV) {
				out.warnings = [makeDiagnostic("noncompliant",
					"tech delivers " + input.data.v[0] + ", plan requires " + ctx.params.requiredV, {
						values: { required: ctx.params.requiredV, delivered: input.data.v[0] },
						fix: "raise delivered speed by " + (ctx.params.requiredV - input.data.v[0])
					})];
			}
			return out;
		}
	});

	reg.register({
		id: "sink", title: "Test sink",
		accepts: ["ship-state"], emits: [],
		update: function () { calls.sink++; return null; }
	});

	var w = createWorld({ jd: JD });
	var a = w.set({ addStage: { moduleId: "src", params: { v: 3180 } } });
	var b = w.set({ addStage: { moduleId: "plan", params: { requiredV: 3420, planV: 4050 } } });
	var c = w.set({ addStage: { moduleId: "sink", params: {} } });
	var engine = createEngine(w, reg);
	return { w: w, reg: reg, engine: engine, calls: calls, a: a, b: b, c: c };
}

function statuses(engine) {
	return engine.results().map(function (r) { return r.status; });
}

test("comply mode: a warning does not block — the plan's output keeps flowing", function () {
	var t = fixture();                                  // src short: 3180 vs required 3420
	assert.deepEqual(statuses(t.engine), ["ok", "ok", "ok"]);   // NOTHING blocked
	assert.deepEqual(t.calls, { src: 1, plan: 1, sink: 1 });     // sink ran

	var r = t.engine.resultFor(t.b);
	assert.equal(r.warnings.length, 1);
	assert.equal(r.warnings[0].code, "noncompliant");
	assert.deepEqual(r.warnings[0].values, { required: 3420, delivered: 3180 });
	assert.match(r.warnings[0].fix, /240/);             // the offending gap, actionable
	assert.equal(r.output.data.v[0], 4050);             // frozen plan output, not the tech's
});

test("comply mode: fixing the tech clears the warning on the same recompute rules", function () {
	var t = fixture();
	t.w.set({ stage: t.a, params: { v: 3420 } });       // tech now complies
	var r = t.engine.resultFor(t.b);
	assert.deepEqual(r.warnings, []);
	assert.deepEqual(statuses(t.engine), ["ok", "ok", "ok"]);
	assert.deepEqual(t.calls, { src: 2, plan: 2, sink: 2 });
});

test("warning stageId: filled with the authoring stage when absent, kept when explicit", function () {
	var t = fixture();
	assert.equal(t.engine.resultFor(t.b).warnings[0].stageId, t.b);   // filled in

	t.reg.register({
		id: "pointer", title: "Cross-stage warner",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) {
			return { packet: input, warnings: [
				makeDiagnostic("about-upstream", "warning aimed at another stage",
					{ stageId: t.a })                    // explicit — must survive
			] };
		}
	});
	var d = t.w.set({ addStage: { moduleId: "pointer" }, before: t.c });
	assert.equal(t.engine.resultFor(d).warnings[0].stageId, t.a);
});

test("events attach to the result, order and extra fields intact", function () {
	var t = fixture();
	t.reg.register({
		id: "eventful", title: "Event emitter",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) {
			return { packet: input, events: [
				{ jd: ctx.jd - 2, label: "spin-up", kind: "prep" },
				{ jd: ctx.jd, label: "release" },
				{ jd: ctx.jd + 0.8, label: "WP-A burn" }
			] };
		}
	});
	var d = t.w.set({ addStage: { moduleId: "eventful" }, before: t.c });
	var ev = t.engine.resultFor(d).events;
	assert.equal(ev.length, 3);
	assert.deepEqual(ev.map(function (e) { return e.label; }), ["spin-up", "release", "WP-A burn"]);
	assert.equal(ev[0].kind, "prep");                   // extra field passed through
	assert.equal(ev[2].jd, JD + 0.8);
});

test("bare returns still work and carry empty warnings/events arrays", function () {
	var t = fixture();
	var ra = t.engine.resultFor(t.a);                   // bare packet return
	var rc = t.engine.resultFor(t.c);                   // bare null return
	assert.deepEqual(ra.warnings, []);
	assert.deepEqual(ra.events, []);
	assert.deepEqual(rc.warnings, []);
	assert.deepEqual(rc.events, []);
	assert.equal(ra.output.data.v[0], 3180);
});

test("{ packet: null, warnings } — no output plus a warning is legal", function () {
	var t = fixture();
	t.reg.register({
		id: "quiet", title: "Terminal warner",
		accepts: ["ship-state"], emits: [],
		update: function () {
			return { packet: null, warnings: [makeDiagnostic("note", "terminal note")] };
		}
	});
	var d = t.w.set({ swapStage: t.c, moduleId: "quiet" });
	var r = t.engine.resultFor(t.c);
	assert.equal(r.status, "ok");
	assert.equal(r.output, null);
	assert.equal(r.warnings[0].code, "note");
});

test("a diagnostic in the packet slot fails hard; warnings/events are dropped", function () {
	var t = fixture();
	t.reg.register({
		id: "hard-fail", title: "Hard failer with extras",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function () {
			return {
				packet: makeDiagnostic("infeasible", "cannot compute at all"),
				warnings: [makeDiagnostic("ignored", "should not survive")],
				events: [{ jd: JD, label: "should not survive" }]
			};
		}
	});
	var d = t.w.set({ addStage: { moduleId: "hard-fail" }, before: t.c });
	var r = t.engine.resultFor(d);
	assert.equal(r.status, "diagnostic");
	assert.equal(r.diagnostic.code, "infeasible");
	assert.equal(r.diagnostic.stageId, d);              // filled in, as for bare diagnostics
	assert.deepEqual(r.warnings, []);
	assert.deepEqual(r.events, []);
	assert.equal(t.engine.resultFor(t.c).status, "blocked");   // blocking unchanged
	assert.equal(t.engine.resultFor(t.c).blockedOn, d);
});

test("blocked stages carry empty warnings/events", function () {
	var t = fixture();
	t.reg.register({
		id: "failer", title: "Failer",
		accepts: [], emits: ["ship-state"],
		update: function () { return makeDiagnostic("nope", "fails"); }
	});
	t.w.set({ addStage: { moduleId: "failer" }, before: t.a });
	var r = t.engine.resultFor(t.b);
	assert.equal(r.status, "blocked");
	assert.deepEqual(r.warnings, []);
	assert.deepEqual(r.events, []);
});

test("malformed warnings become bad-output and DO block (authoring error)", function () {
	var t = fixture();
	t.reg.register({
		id: "bad-warner", title: "Bad warner",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) {
			return { packet: input, warnings: ["just a string"] };
		}
	});
	var d = t.w.set({ addStage: { moduleId: "bad-warner" }, before: t.c });
	var r = t.engine.resultFor(d);
	assert.equal(r.status, "diagnostic");
	assert.equal(r.diagnostic.code, "bad-output");
	assert.match(r.diagnostic.message, /warnings/);
	assert.equal(r.output, null);                       // nothing flows from a failed stage
	assert.equal(t.engine.resultFor(t.c).status, "blocked");
});

test("malformed events become bad-output", function () {
	var t = fixture();
	t.reg.register({
		id: "bad-eventer", title: "Bad eventer",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function (ctx, input) {
			return { packet: input, events: [{ jd: "tomorrow", label: "release" }] };
		}
	});
	var d = t.w.set({ addStage: { moduleId: "bad-eventer" }, before: t.c });
	var r = t.engine.resultFor(d);
	assert.equal(r.diagnostic.code, "bad-output");
	assert.match(r.diagnostic.message, /events/);
});

test("a plain object with none of the envelope keys is still bad-output", function () {
	var t = fixture();
	t.reg.register({
		id: "garbage", title: "Garbage emitter",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function () { return { totally: "not a packet" }; }
	});
	var d = t.w.set({ addStage: { moduleId: "garbage" }, before: t.c });
	assert.equal(t.engine.resultFor(d).diagnostic.code, "bad-output");
});

test("an envelope's packet is validated exactly like a bare return", function () {
	var t = fixture();
	t.reg.register({
		id: "env-liar", title: "Enveloped undeclared type",
		accepts: ["ship-state"], emits: ["ship-state"],
		update: function () {
			return { packet: PacketTypes.make("tether-spec",
				{ body: "Moon", footAlt: 1, centreAlt: 2, topAlt: 3,
				  material: { sigma: 1, rho: 1 } }, { tool: "env-liar" }) };
		}
	});
	var d = t.w.set({ addStage: { moduleId: "env-liar" }, before: t.c });
	var r = t.engine.resultFor(d);
	assert.equal(r.diagnostic.code, "bad-output");
	assert.match(r.diagnostic.message, /tether-spec/);
});

test("an infeasible-but-warned mission serializes like any other", function () {
	var t = fixture();                                  // warning active (3180 vs 3420)
	var saved = t.w.serialize();
	assert.equal(saved.stages.length, 3);
	assert.equal(saved.stages[0].params.v, 3180);       // World stores it plainly;
	                                                    // warnings live in results, not World
});
