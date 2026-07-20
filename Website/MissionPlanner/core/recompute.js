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
//   { stageId, moduleId, status, output, diagnostic, blockedOn,
//     warnings, events }
//     status "ok"          — update returned a packet (in `output`) or null
//     status "diagnostic"  — this stage failed; see `diagnostic`
//     status "blocked"     — an upstream stage failed; its id is `blockedOn`
//     warnings             — non-blocking diagnostics (see envelope below);
//                            always an array, empty unless status is "ok"
//     events               — [{ jd, label, ... }] timeline entries for this
//                            stage (the phase sliders and the stage strip
//                            read these); always an array, empty unless
//                            status is "ok"
//
// ENVELOPE RETURNS (added 2026-07-09 for the Mission Planner's comply mode —
// see MissionPlannerDesign.md). Besides a bare packet / null / diagnostic,
// update() may return an envelope:
//
//   { packet, warnings, events }
//     packet   — anything a bare return accepts: a packet, null, or a
//                diagnostic (a diagnostic still fails the stage hard, and
//                the envelope's warnings/events are then dropped)
//     warnings — optional array of diagnostic-shaped objects (diagnostics.js)
//                that do NOT block downstream. This is how comply mode
//                reports "the tech misses the frozen plan by X" while the
//                plan's own numbers keep flowing: the frozen-plan stage
//                emits its output regardless and carries the mismatch here.
//                stageId is filled with the authoring stage's id when absent
//                (set it explicitly to point the warning at another stage).
//     events   — optional array of { jd, label } (extra fields pass through
//                untouched); jd must be a finite number, label a non-empty
//                string
//
// An object with no `kind` and none of those three keys is not an envelope —
// it falls through to packet validation and becomes "bad-output", as before.
//
// The engine also converts its own failure modes into the same diagnostic
// shape, so the UI renders them identically. Engine codes:
//
//   "unknown-module"       — the profile names a moduleId the registry
//                            doesn't have (a saved mission is always
//                            storable, so this is data, not an exception)
//   "missing-input"        — the stage consumes packets but nothing arrived
//                            (first in chain, or upstream returned null).
//                            A descriptor may set `inputOptional: true` to
//                            opt out: its update() is then called with
//                            input null instead of failing. This exists for
//                            the frozen-plan module (comply mode): a mission
//                            spawned with an empty tech slot must still show
//                            its plan, so the plan tolerates having no tech
//                            upstream and reports it as a warning, not a
//                            block. When input DOES arrive it is type-checked
//                            against `accepts` exactly as for anyone else.
//   "input-type-mismatch"  — upstream emitted a type this stage's `accepts`
//                            doesn't list
//   "module-error"         — update() threw; the message is preserved
//   "bad-output"           — update() returned something that is neither a
//                            valid packet of a declared `emits` type, nor
//                            null, nor a diagnostic, nor a valid envelope
//                            (malformed `warnings` or `events` land here too)
//
// COMPLIANCE BOUNDARIES (a descriptor may set `boundary: true`). Comply mode
// (MissionPlannerDesign.md; ARCHITECTURE.md's "Phases are chains; compliance
// is a boundary check, not a reconciliation") says a phase boundary is a
// thing MEASURED against, never a prerequisite: the frozen plan is
// authoritative and the departure technology is diagnosed against it. So a
// broken, half-built, or absent departure must NOT blank the committed plan
// or the coast beyond it — the tech's failure is the tech's problem, reported
// where the tech lives, while the plan keeps flowing. A `boundary` stage
// therefore TERMINATES the block chain: when everything upstream of it has
// failed (diagnostic/blocked), the boundary is still computed — called with
// input null, the same tolerance `inputOptional` grants — and it surfaces the
// shortfall through its own warnings channel instead of going "blocked". The
// stages that produced the upstream failure keep their own diagnostic/blocked
// status (rendered on their own cards); only propagation PAST the boundary is
// cut. A boundary's OWN failure (its params are damaged) still blocks
// downstream normally. Today only frozen-plan (the Departure→Coast seam) is a
// boundary; the Coast→Arrival seam reuses this identical flag once its own
// boundary stage exists, so departure and arrival share one mechanism.
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

	// An envelope is a plain object with no `kind` marker carrying at least
	// one of the three envelope keys (see header comment). Packets and
	// diagnostics both have `kind`, so they can never be mistaken for one.
	function isEnvelope(x) {
		return !!x && typeof x === "object" && x.kind === undefined && (
			Object.prototype.hasOwnProperty.call(x, "packet") ||
			Object.prototype.hasOwnProperty.call(x, "warnings") ||
			Object.prototype.hasOwnProperty.call(x, "events")
		);
	}

	// Check an envelope's `warnings`. Returns { ok, list } or { ok: false,
	// reason }. Fills each warning's stageId with `stageId` when absent —
	// same policy as hard diagnostics; an explicitly-set stageId (a warning
	// pointed at another stage) is left alone.
	function checkWarnings(warnings, stageId) {
		if (!Array.isArray(warnings)) {
			return { ok: false, reason: "warnings must be an array" };
		}
		for (var i = 0; i < warnings.length; i++) {
			if (!isDiagnostic(warnings[i])) {
				return { ok: false, reason: "warnings[" + i + "] is not a diagnostic (use makeDiagnostic)" };
			}
			if (warnings[i].stageId === null || warnings[i].stageId === undefined) {
				warnings[i].stageId = stageId;
			}
		}
		return { ok: true, list: warnings.slice() };
	}

	// Check an envelope's `events`: [{ jd, label, ... }], jd finite, label a
	// non-empty string. Extra fields pass through untouched.
	function checkEvents(events) {
		if (!Array.isArray(events)) {
			return { ok: false, reason: "events must be an array" };
		}
		for (var i = 0; i < events.length; i++) {
			var e = events[i];
			if (!e || typeof e !== "object" ||
				typeof e.jd !== "number" || !isFinite(e.jd) ||
				typeof e.label !== "string" || e.label === "") {
				return { ok: false, reason: "events[" + i + "] needs a finite numeric jd and a non-empty label" };
			}
		}
		return { ok: true, list: events.slice() };
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

		// Who, if anyone, is already blocking at the carry boundary. Walk the
		// whole carried region (not just to the first failure): a `boundary`
		// stage among the carried results TERMINATES an upstream block chain
		// exactly as it does in the live loop below, so a diagnostic carried
		// from before a boundary must not leak past it. A boundary's own
		// failure still blocks on (its status is "diagnostic").
		var blockedOn = null;
		for (var b = 0; b < next.length; b++) {
			var carriedDesc = registry.get(next[b].moduleId);
			if (carriedDesc && carriedDesc.boundary === true) { blockedOn = null; }
			if (next[b].status === "diagnostic") { blockedOn = next[b].stageId; }
		}

		world.lock("recompute in progress");
		try {
			for (var i = d; i < stages.length; i++) {
				var stage = stages[i];
				var desc = registry.get(stage.moduleId);
				var res = {
					stageId: stage.id,
					moduleId: stage.moduleId,
					status: "ok",
					output: null,
					diagnostic: null,
					blockedOn: null,
					warnings: [],
					events: []
				};

				// A compliance boundary terminates the block chain (see header):
				// an upstream failure must not blank the plan or the phase past
				// it. Reset before the blocked check so the boundary is computed
				// (with input null) rather than marked blocked.
				if (blockedOn !== null && desc && desc.boundary === true) {
					blockedOn = null;
				}

				if (blockedOn !== null) {
					res.status = "blocked";
					res.blockedOn = blockedOn;
					next.push(res);
					continue;
				}

				var input = (i === 0) ? null : next[i - 1].output;
				var diag = null;

				if (!desc) {
					diag = engineDiag(stage.id, "unknown-module",
						"No module '" + stage.moduleId + "' is registered.",
						{ moduleId: stage.moduleId });
				} else if (desc.accepts.length > 0 && input === null &&
				           desc.inputOptional !== true && desc.boundary !== true) {
					diag = engineDiag(stage.id, "missing-input",
						"'" + desc.title + "' needs a " + desc.accepts.join(" / ") +
						" packet from upstream, but nothing arrived.",
						{ accepts: desc.accepts.slice() });
				} else if (desc.accepts.length > 0 && input !== null && desc.accepts.indexOf(input.type) === -1) {
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
						// Unwrap an envelope; a bare return is its own payload.
						// (Explicit undefined initializers: `var` hoists to
						// function scope, so without them a previous loop
						// iteration's envelope would leak into this stage.)
						var payload = out, envWarnings = undefined, envEvents = undefined;
						if (isEnvelope(out)) {
							payload = (out.packet === undefined) ? null : out.packet;
							envWarnings = out.warnings;
							envEvents = out.events;
						}

						if (isDiagnostic(payload)) {
							if (payload.stageId === null || payload.stageId === undefined) { payload.stageId = stage.id; }
							diag = payload;
						} else if (payload === null || payload === undefined) {
							res.output = null;
						} else {
							var v = PacketTypes.validate(payload);
							if (!v.ok) {
								diag = engineDiag(stage.id, "bad-output",
									"'" + desc.title + "' returned an invalid packet: " + v.reason,
									{});
							} else if (desc.emits.indexOf(payload.type) === -1) {
								diag = engineDiag(stage.id, "bad-output",
									"'" + desc.title + "' returned a '" + payload.type +
									"' packet but declares emits: [" + desc.emits.join(", ") + "].",
									{ got: payload.type, emits: desc.emits.slice() });
							} else {
								res.output = payload;
							}
						}

						// warnings/events attach only when the stage didn't
						// fail hard (a diagnostic drops them — see header).
						if (!diag && envWarnings !== undefined && envWarnings !== null) {
							var wc = checkWarnings(envWarnings, stage.id);
							if (!wc.ok) {
								diag = engineDiag(stage.id, "bad-output",
									"'" + desc.title + "' returned malformed warnings: " + wc.reason, {});
								res.output = null;
							} else {
								res.warnings = wc.list;
							}
						}
						if (!diag && envEvents !== undefined && envEvents !== null) {
							var ec = checkEvents(envEvents);
							if (!ec.ok) {
								diag = engineDiag(stage.id, "bad-output",
									"'" + desc.title + "' returned malformed events: " + ec.reason, {});
								res.output = null;
								res.warnings = [];
							} else {
								res.events = ec.list;
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
