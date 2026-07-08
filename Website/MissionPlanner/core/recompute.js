// The chain-recompute engine — turns a World's mission profile into packets
// and diagnostics. ES module:
//   import { createEngine } from "./recompute.js";
// Pure (no DOM, no Three.js), imports directly in Node for unit testing.
//
// See Website/ARCHITECTURE.md, "Mission profiles and recompute rules". The
// rule is deliberately boring:
//
//   1. Any world.set() marks a stage dirty (the change record's `index` is
//      the earliest chain position it can affect; jd marks index 0, since
//      one clock feeds every stage).
//   2. The engine recomputes from there DOWNSTREAM, IN ORDER, SYNCHRONOUSLY.
//      Stages upstream of the dirty index keep their previous outputs —
//      nothing upstream changed, so nothing upstream reruns.
//
// Each stage's input is the upstream stage's output packet plus its own
// params from World. A stage's update() returns its output packet, or null
// (nothing to pass downstream), or a structured diagnostic (see
// diagnostics.js). On a diagnostic, every stage downstream is marked
// *blocked, waiting on stage N* — parameters and UI intact, update() not
// called — rather than everything going blank; that is the whole
// accessibility story for novices building impossible missions.
//
// Per-stage results, keyed by stable stage id (never array index):
//
//   { stageId, moduleId, status, output, diagnostic, blockedOn }
//     status "ok"          — update returned a packet (in `output`) or null
//     status "diagnostic"  — this stage failed; see `diagnostic`
//     status "blocked"     — an upstream stage failed; its id is `blockedOn`
//
// The engine also converts its own failure modes into the same diagnostic
// shape, so the UI renders them identically. Engine codes:
//
//   "unknown-module"       — the profile names a moduleId the registry
//                            doesn't have (a saved mission is always
//                            storable, so this is data, not an exception)
//   "missing-input"        — the stage consumes packets but nothing arrived
//                            (first in chain, or upstream returned null)
//   "input-type-mismatch"  — upstream emitted a type this stage's `accepts`
//                            doesn't list
//   "module-error"         — update() threw; the message is preserved
//   "bad-output"           — update() returned something that is neither a
//                            valid packet of a declared `emits` type, nor
//                            null, nor a diagnostic
//
// DEVIATION from the ARCHITECTURE.md sketch (`update(world, input)`): the
// engine calls `update(ctx, input)` with ctx = { world, jd, stageId,
// params }. A module can appear at more than one stage of the same profile
// (two transfer legs), so update() must be told *which* stage it is
// computing — its per-stage params and its stageId (the latter lets it
// author diagnostics). `ctx.world` is the World itself, for reads; the
// World is LOCKED for the duration of a recompute pass, so a module that
// tries to world.set() from inside update() throws immediately — the
// "modules never mutate World directly" rule, enforced.

import { PacketTypes } from "../../Shared/exchange-types.js";
import { isDiagnostic, makeDiagnostic } from "./diagnostics.js";

export function createEngine(world, registry) {
	var results = [];        // per-stage results, chain order
	var byId = {};           // stageId -> result
	var listeners = [];

	function engineDiag(stageId, code, message, values, fix) {
		return makeDiagnostic(code, message, { stageId: stageId, values: values, fix: fix });
	}

	// One synchronous pass from chain index `from` downstream. Results for
	// stages upstream of `from` are carried over by stable id; if the carry
	// doesn't line up (defensive — shouldn't happen), recompute everything.
	function recompute(from) {
		var stages = world.stages();
		var d = (typeof from === "number" && from >= 0) ? Math.min(from, stages.length) : 0;

		var next = [];
		for (var k = 0; k < d; k++) {
			if (!results[k] || results[k].stageId !== stages[k].id) { d = 0; next = []; break; }
			next.push(results[k]);
		}

		// Who, if anyone, is already blocking at the boundary.
		var blockedOn = null;
		for (var b = 0; b < next.length; b++) {
			if (next[b].status === "diagnostic") { blockedOn = next[b].stageId; break; }
		}

		world.lock("recompute in progress");
		try {
			for (var i = d; i < stages.length; i++) {
				var stage = stages[i];
				var res = {
					stageId: stage.id,
					moduleId: stage.moduleId,
					status: "ok",
					output: null,
					diagnostic: null,
					blockedOn: null
				};

				if (blockedOn !== null) {
					res.status = "blocked";
					res.blockedOn = blockedOn;
					next.push(res);
					continue;
				}

				var input = (i === 0) ? null : next[i - 1].output;
				var desc = registry.get(stage.moduleId);
				var diag = null;

				if (!desc) {
					diag = engineDiag(stage.id, "unknown-module",
						"No module '" + stage.moduleId + "' is registered.",
						{ moduleId: stage.moduleId });
				} else if (desc.accepts.length > 0 && input === null) {
					diag = engineDiag(stage.id, "missing-input",
						"'" + desc.title + "' needs a " + desc.accepts.join(" / ") +
						" packet from upstream, but nothing arrived.",
						{ accepts: desc.accepts.slice() });
				} else if (desc.accepts.length > 0 && desc.accepts.indexOf(input.type) === -1) {
					diag = engineDiag(stage.id, "input-type-mismatch",
						"'" + desc.title + "' consumes " + desc.accepts.join(" / ") +
						", but upstream sent '" + input.type + "'.",
						{ got: input.type, accepts: desc.accepts.slice() });
				} else {
					var out;
					try {
						out = desc.update(
							{ world: world, jd: world.jd, stageId: stage.id, params: stage.params },
							input
						);
					} catch (err) {
						diag = engineDiag(stage.id, "module-error",
							"'" + desc.title + "' failed while computing: " +
							(err && err.message ? err.message : String(err)),
							{});
					}
					if (!diag) {
						if (isDiagnostic(out)) {
							if (out.stageId === null || out.stageId === undefined) { out.stageId = stage.id; }
							diag = out;
						} else if (out === null || out === undefined) {
							res.output = null;
						} else {
							var v = PacketTypes.validate(out);
							if (!v.ok) {
								diag = engineDiag(stage.id, "bad-output",
									"'" + desc.title + "' returned an invalid packet: " + v.reason,
									{});
							} else if (desc.emits.indexOf(out.type) === -1) {
								diag = engineDiag(stage.id, "bad-output",
									"'" + desc.title + "' returned a '" + out.type +
									"' packet but declares emits: [" + desc.emits.join(", ") + "].",
									{ got: out.type, emits: desc.emits.slice() });
							} else {
								res.output = out;
							}
						}
					}
				}

				if (diag) {
					res.status = "diagnostic";
					res.diagnostic = diag;
					blockedOn = stage.id;
				}
				next.push(res);
			}
		} finally {
			world.unlock();
		}

		results = next;
		byId = {};
		for (var r = 0; r < results.length; r++) { byId[results[r].stageId] = results[r]; }

		for (var l = 0; l < listeners.length; l++) { listeners[l](results.slice()); }
	}

	var unsubscribe = world.onChange(function (info) {
		recompute(info.index);
	});

	var engine = {

		// The per-stage results, in chain order (a fresh array each call;
		// the result records themselves are the live ones).
		results: function () { return results.slice(); },

		// One stage's result by stable id, or null.
		resultFor: function (stageId) {
			return Object.prototype.hasOwnProperty.call(byId, stageId) ? byId[stageId] : null;
		},

		// Force a pass by hand — from a chain index, or the whole chain.
		// Normal operation never needs this (world.set() triggers it); it
		// exists for tests and for registering modules after the profile
		// already references them.
		recompute: function (from) { recompute(typeof from === "number" ? from : 0); },

		// Subscribe to recompute passes; cb(resultsArray). Returns an
		// unsubscribe function.
		onRecompute: function (cb) {
			listeners.push(cb);
			return function () {
				var i = listeners.indexOf(cb);
				if (i !== -1) { listeners.splice(i, 1); }
			};
		},

		// Detach from the World (stop listening). For tests and teardown.
		dispose: function () { unsubscribe(); listeners = []; }
	};

	recompute(0);   // initial pass, so results exist before the first set()
	return engine;
}
