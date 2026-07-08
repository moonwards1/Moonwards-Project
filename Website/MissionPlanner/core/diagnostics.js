// The structured-diagnostic model for the mission-profile chain. ES module:
//   import { makeDiagnostic, isDiagnostic, DIAGNOSTIC_KIND } from "./diagnostics.js";
// Pure (no DOM), imports directly in Node for unit testing.
//
// See Website/ARCHITECTURE.md, "Mission profiles and recompute rules" >
// "Infeasibility is a diagnostic, not an error": a stage's update() returns
// either its output packet or one of these. A diagnostic is a plain,
// JSON-able object, distinguishable from a packet by its `kind`:
//
//   {
//     kind: "moonwards-diagnostic",
//     stageId: "stg-3",     // which stage failed (the engine fills this in
//                           // if the module leaves it out — modules usually
//                           // should, they know it via ctx.stageId)
//     code: "vinf-too-high",// machine-readable failure id, per module
//     message: "...",       // what failed, in words a novice can act on
//     values: { ... },      // the offending numbers, as plain data
//     fix: "..."            // optional: what would fix it, where cheap to
//                           // compute — omit rather than guess
//   }
//
// The engine also produces its own diagnostics (unknown module, thrown
// update, malformed output packet, input-type mismatch — see recompute.js
// for the code list). Same shape, so the UI renders both identically.

export const DIAGNOSTIC_KIND = "moonwards-diagnostic";

// Build a diagnostic. `code` and `message` are required (fail loud — this is
// the authoring side); `opts` may carry `stageId`, `values`, `fix`.
export function makeDiagnostic(code, message, opts) {
	if (typeof code !== "string" || code === "") {
		throw new Error("makeDiagnostic: missing code");
	}
	if (typeof message !== "string" || message === "") {
		throw new Error("makeDiagnostic: missing message");
	}
	var o = opts || {};
	var d = {
		kind: DIAGNOSTIC_KIND,
		stageId: o.stageId !== undefined ? o.stageId : null,
		code: code,
		message: message,
		values: o.values !== undefined ? o.values : {}
	};
	if (o.fix !== undefined) { d.fix = o.fix; }
	return d;
}

// True if `x` is a diagnostic (the check update()'s callers use to tell a
// diagnostic from an output packet). Never throws.
export function isDiagnostic(x) {
	return !!x && typeof x === "object" && x.kind === DIAGNOSTIC_KIND;
}
