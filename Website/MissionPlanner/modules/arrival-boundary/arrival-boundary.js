/* MissionPlanner/modules/arrival-boundary — the Coast→Arrival compliance
 * boundary: the mirror of frozen-plan at the other end of the mission.
 *
 * ONE COMPARISON, AT ONE SEAM. The frozen plan commits to an arrival — body,
 * epoch, approach v∞ — when the mission is created, and never moves after
 * that. This stage sits between the coast and the arrival phase and makes
 * exactly one comparison: what the coast actually delivers at the destination,
 * against what the plan committed to. See ARCHITECTURE.md's "Phases are
 * chains; compliance is a boundary check, not a reconciliation" — the same
 * shape modules/frozen-plan implements at the departure seam.
 *
 * WHAT IS AND ISN'T MIRRORED. frozen-plan is AUTHORITATIVE: it emits the
 * plan's own frozen departure state downstream whatever the departure tech
 * delivered, so the coast everyone sees is the committed plan. This boundary
 * emphatically does NOT do that, and the asymmetry is deliberate:
 *
 *   - At the departure seam the plan is the thing being flown TOWARD, so it
 *     can stand in for a tech that isn't delivering yet.
 *   - At the arrival seam the ship is simply where the coast put it. The
 *     arrival phase's whole job is refining THAT approach, so substituting a
 *     committed state would defeat the phase. And the commitment could not
 *     stand in anyway: it fixes a body, an epoch and an approach SPEED, but no
 *     approach DIRECTION — there is no state to synthesize from it.
 *
 * So the delivered ship-state passes through UNCHANGED and the mismatch goes
 * out on the warnings channel. This stage measures; it never alters.
 *
 * THE BOUNDARY FLAG (recompute.js's `boundary: true`) means a broken or
 * half-built departure/coast upstream does not mark this stage "blocked": it is
 * computed with input null and reports the shortfall itself, so the seam always
 * states what the arrival phase is missing rather than the whole phase greying
 * out with no explanation. Note the consequence downstream: with nothing
 * delivered there is no packet to pass on, so arrival-leg then reports its own
 * missing-input diagnostic instead of "blocked — waiting on the coast leg".
 * That is honest — the arrival leg genuinely has no state to build from — and
 * it is the price of the boundary reporting at all. A boundary never blocks;
 * only its own damaged params would.
 *
 * NO PARAMS, NO SAVE-FORMAT DATA. The commitment belongs to the plan, and is
 * read through frozen-plan's own arrivalCommitmentFor(world) — the function
 * that exists precisely so arrival stages need not grope through the stage list
 * for it. The stage entry itself carries `{}`. Its presence in the chain IS a
 * profile fact, so core/world.js's v3→v4 migration inserts it into saves that
 * predate it.
 *
 * THE EPOCH TOLERANCE is the plan's own hand-off window half-width
 * (handoffWindowDays, ±1 d by default) — the same field the departure seam
 * checks against, read through frozen-plan's handoffWindowFor. One window
 * serves both seams.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; `init` is the
 * browser-only card — a PLAN COMMITS / COAST DELIVERS readout and nothing
 * else. No draw hook: the boundary owns no hardware.
 *
 * Imports from ../../core/ and sibling modules — this folder breaks if moved
 * without them coming along.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { approachAt, approachFromPass, interceptWarning } from "../arrival-approach.js";
import { MISS_WARN_AU, handoffLegFor as coastHandoffLegFor,
	nearestApproach as coastNearestApproach } from "../transfer-leg/transfer-leg.js";
import { arrivalCommitmentFor, handoffWindowFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;

// How far the delivered approach speed may miss the committed one before a
// warning is raised. Its own constant rather than frozen-plan's VINF_TOL,
// though it holds the same value: the two ends of a mission are judged by
// different hardware (an injection carrier vs a catch platform), so the two
// tolerances are free to diverge.
export var ARRIVAL_VINF_TOL = 10;   // m/s

export var defaultParams = {};      // the commitment lives on the plan

// isFinite(null) is true (null coerces to 0), and arrivalCommitmentFor returns
// a null vInf for a plan that records no approach speed — so "is there a
// committed speed at all?" needs the type check, not just finiteness.
function isNum(x) { return typeof x === "number" && isFinite(x); }

// The COMMITTED coast's measured pass at `body` — the same sideways,
// registry-free read arrival-leg makes for its own window (the packet carries
// one instant; a pass needs the trajectory). The committed leg, not the live
// one: this seam reports on what the arrival phase is running on, so a pending
// waypoint edit must not move it. null in a bare Node call, before the coast
// has computed, or with no arrival body committed.
function coastPassFor(world, body) {
	if (!world || typeof world.stages !== "function" || !body) { return null; }
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId !== "transfer-leg") { continue; }
		var leg = coastHandoffLegFor(world, stages[i].id);
		return leg ? coastNearestApproach(leg, body) : null;
	}
	return null;
}

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

// The comparison, pure. spec = {
//   commitment,   // { body, jd, vInf } from the plan, or null (no commitment)
//   pass,          // the coast's MEASURED pass at the commitment's body
//                  // (transfer-leg's nearestApproach) — what the three rows are
//                  // measured from whenever a coast trajectory is reachable
//   data,          // the coast's delivered helio-frame ship-state payload, or
//                  // null when nothing is reaching the seam. Still what says
//                  // whether anything arrived at all; the FALLBACK measurement
//                  // when there is no pass (see arrival-approach.js)
//   windowDays     // epoch tolerance half-width (d)
// }
//
// ALL THREE ROWS MEASURE THE PASS, not the coast leg's end. The leg's end is
// `jd0 + legDays` — a parameter, not an event — so measuring there made the
// epoch row structurally incapable of moving when waypoints were tuned (it read
// zero deviation while the actual arrival swung by ±0.7 d), and made the
// encounter row report the separation at an arbitrary instant rather than at
// closest approach.
// Returns { ok: false, diagnostic } only when the COMMITMENT ITSELF is
// unusable (a damaged save), else:
//
//   { ok: true,
//     commitment: { body, jd, vInf } | null,
//     delivered:  { body, jd, vInf, missAU, vInfVec } | null,
//     rows: [{ key: "encounter"|"vinf"|"epoch", required, delivered, delta, ok }] }
//
// rows exist only when both sides do; a commitment with no vInf simply omits
// the vinf row rather than inventing a requirement. Delta units are AU, m/s and
// days respectively. Exported for Node tests and the card.
export function computeArrivalCompliance(spec) {
	var commitment = spec.commitment || null;
	var data = spec.data || null;

	if (!commitment) {
		// Nothing was ever committed to (a mission with no frozen plan, or a plan
		// with no destination). There is no standard to measure against, so there
		// is nothing to say — not even a warning.
		return { ok: true, commitment: null, delivered: null, rows: [] };
	}
	if (!data) {
		return { ok: true, commitment: commitment, delivered: null, rows: [] };
	}

	var approach = (spec.pass ? approachFromPass(commitment.body, spec.pass) : null)
		|| approachAt(commitment.body, data);
	if (!approach) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The plan's arrival body '" + commitment.body + "' is not a body with a heliocentric orbit.",
			{ values: { body: commitment.body } }) };
	}

	var delivered = { body: commitment.body, jd: approach.jd, vInf: approach.vInf,
	                  missAU: approach.missAU, vInfVec: approach.vInfVec };

	// The encounter row replaces the departure seam's "aim" row. The plan
	// commits no approach DIRECTION, so there is no asymptote to compare; what
	// it does commit is a body, and whether the coast actually gets there is
	// the most basic thing this seam can be asked. Threshold is transfer-leg's
	// own MISS_WARN_AU, so both ends of the flight agree on what counts as an
	// encounter.
	var rows = [
		{ key: "encounter", required: MISS_WARN_AU, delivered: approach.missAU,
		  delta: approach.missAU - MISS_WARN_AU, ok: !(approach.missAU > MISS_WARN_AU) }
	];
	if (isNum(commitment.vInf)) {
		rows.push({ key: "vinf", required: commitment.vInf, delivered: approach.vInf,
		            delta: approach.vInf - commitment.vInf,
		            ok: Math.abs(approach.vInf - commitment.vInf) <= ARRIVAL_VINF_TOL });
	}
	var windowDays = (isNum(spec.windowDays) && spec.windowDays > 0) ? spec.windowDays : 1;
	// The epoch of the PASS — when the ship actually gets there — not when the
	// coast stage's parameter runs out.
	rows.push({ key: "epoch", required: commitment.jd, delivered: approach.jd,
	            delta: approach.jd - commitment.jd, window: windowDays,
	            ok: Math.abs(approach.jd - commitment.jd) <= windowDays });

	return { ok: true, commitment: commitment, delivered: delivered, rows: rows };
}

// Deviation warnings from a compliance result — the non-blocking channel, the
// mirror of frozen-plan's complianceWarnings. Exported so tests can assert the
// exact mapping.
export function arrivalComplianceWarnings(comp) {
	var warnings = [];
	if (!comp.ok || !comp.commitment) { return warnings; }

	if (!comp.delivered) {
		// Covers "the coast is broken", "the departure is broken and the coast
		// never ran", and "there is no coast stage at all" alike: the boundary
		// keeps reporting either way, and the specific failure shows on the
		// failing stage's own card.
		warnings.push(makeDiagnostic("no-coast-delivery",
			"No delivered state is reaching the arrival seam — the coast is absent or " +
			"failing — so there is nothing to compare against the plan's arrival at " +
			comp.commitment.body + ".",
			{ values: { body: comp.commitment.body, committedJd: comp.commitment.jd },
			  fix: "Fix the departure or coast upstream; the arrival phase needs a delivered " +
			       "approach before it can be planned." }));
		return warnings;
	}

	comp.rows.forEach(function (row) {
		if (row.ok) { return; }
		if (row.key === "encounter") {
			// interceptWarning already words this exactly right, and is the same
			// measurement the arrival technologies raise — reuse it rather than
			// writing a second sentence about the same miss.
			var w = interceptWarning({ body: comp.commitment.body, missAU: row.delivered });
			if (w) { warnings.push(w); }
		} else if (row.key === "vinf") {
			var fast = row.delta > 0;   // positive = arriving hotter than committed
			warnings.push(makeDiagnostic("arrival-vinf-mismatch",
				"The coast delivers v∞ " + (row.delivered / 1000).toFixed(2) + " km/s at " +
				comp.commitment.body + "; the plan commits to " + (row.required / 1000).toFixed(2) +
				" km/s (" + (fast ? "over by " : "short by ") +
				(Math.abs(row.delta) / 1000).toFixed(2) + " km/s).",
				{ values: { required: row.required, delivered: row.delivered, delta: row.delta },
				  fix: "Tune the coast's waypoint impulses toward the committed approach speed, " +
				       "or expect the capture platform to absorb " +
				       (Math.abs(row.delta) / 1000).toFixed(2) + " km/s more than it was planned for." }));
		} else if (row.key === "epoch") {
			warnings.push(makeDiagnostic("arrival-epoch-mismatch",
				"The coast reaches " + comp.commitment.body + " on " + isoOf(row.delivered) + ", " +
				// Plural for everything except exactly "1.0" as printed — the row
				// reports the pass now, so fractional day counts are the norm and
				// a >= 1.95 threshold read "1.4 day".
				Math.abs(row.delta).toFixed(1) + " day" +
				(Math.abs(row.delta).toFixed(1) === "1.0" ? "" : "s") +
				(row.delta > 0 ? " late" : " early") + " — outside the plan's ±" + row.window +
				" d window around " + isoOf(row.required) + ".",
				{ values: { required: row.required, delivered: row.delivered,
				            deltaDays: row.delta, windowDays: row.window },
				  fix: "Tune the coast's waypoint impulses, or re-plan the mission for a different " +
				       "arrival date from the Ephemeris tab." }));
		}
	});
	return warnings;
}

// Last computed compliance per (World, stage) — the WeakMap pattern, so a
// closed mission's entries go with its World.
var lastByWorld = new WeakMap();
export function arrivalComplianceFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function remember(world, stageId, comp) {
	if (!world || typeof world !== "object") { return; }   // a bare Node call has no view to feed
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, comp);
}

export default {
	id: "arrival-boundary",
	title: "Arrival commitment",
	attachesTo: null,
	accepts: ["ship-state"],
	emits: ["ship-state"],
	// The Coast→Arrival compliance boundary — the same flag frozen-plan sets at
	// the Departure→Coast seam (recompute.js). It also covers the missing-input
	// carve-out, so no separate inputOptional is needed: with nothing upstream
	// this stage is still called, with input null.
	boundary: true,
	rendersIn: ["body:destination"],   // aliased to the mission's destination frame
	                                    // by mission-view.js's resolveFrameId

	update: function (ctx, input) {
		var data = null;
		if (input) {
			data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");
		}
		var commitment = arrivalCommitmentFor(ctx.world);
		var comp = computeArrivalCompliance({
			commitment: commitment,
			pass: coastPassFor(ctx.world, commitment && commitment.body),
			data: data,
			windowDays: handoffWindowFor(ctx.world)
		});
		remember(ctx.world, ctx.stageId, comp);
		if (!comp.ok) { return comp.diagnostic; }

		// PASS-THROUGH, UNCHANGED (see the header): the arrival phase refines
		// the approach the coast actually delivered, so the packet that arrived
		// is the packet that leaves. `input` is null only when the boundary
		// terminated a block chain, and then there is nothing to pass on.
		return { packet: input || null, warnings: arrivalComplianceWarnings(comp) };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------
	// A readouts-only card in the Arrival phase's sidebar: the seam's verdict
	// has to be visible somewhere, and the generic card already renders this
	// stage's warnings below whatever init() builds. No controls — there is
	// nothing here the user sets; the commitment is the plan's and the delivery
	// is the coast's.
	init: function (ctx) {
		var out = document.createElement("div");
		out.className = "mp-readouts";
		ctx.panelHost.appendChild(out);

		function row(k, v, cls) {
			var r = document.createElement("div"); r.className = "mp-row";
			var ke = document.createElement("span"); ke.className = "mp-k"; ke.textContent = k;
			var ve = document.createElement("span"); ve.className = "mp-v" + (cls ? " " + cls : "");
			ve.textContent = v;
			r.appendChild(ke); r.appendChild(ve); out.appendChild(r);
		}

		ctx.onResult(function () {
			var comp = arrivalComplianceFor(ctx.world, ctx.stageId);
			out.innerHTML = "";
			if (!comp || !comp.ok) { return; }
			if (!comp.commitment) {
				var note = document.createElement("div");
				note.className = "mp-muted";
				note.textContent = "This mission commits to no arrival, so there is nothing to compare.";
				out.appendChild(note);
				return;
			}
			var c = comp.commitment, d = comp.delivered;
			var byKey = {};
			comp.rows.forEach(function (r) { byKey[r.key] = r; });

			row("committed body", c.body);
			row("committed arrival", isoOf(c.jd));
			row("delivered arrival", d ? isoOf(d.jd) : "—",
				(byKey.epoch && !byKey.epoch.ok) ? "mp-bad" : "");
			if (isNum(c.vInf)) {
				row("committed v∞", (c.vInf / 1000).toFixed(2) + " km/s");
				row("delivered v∞", d ? (d.vInf / 1000).toFixed(2) + " km/s" : "—",
					(byKey.vinf && !byKey.vinf.ok) ? "mp-bad" : "");
			}
			// Not "miss at hand-off" any more: every row here measures the PASS,
			// so this is how close the coast actually comes, not its separation
			// at whatever instant the leg happened to end.
			row("closest approach", d ? d.missAU.toFixed(4) + " AU" : "—",
				(byKey.encounter && !byKey.encounter.ok) ? "mp-bad" : "");
		});
	},

	// Exposed on the descriptor (not just as named exports) so the shell can
	// reach them via registry.get("arrival-boundary") without a static import —
	// the same access rule frozen-plan follows.
	arrivalComplianceFor: arrivalComplianceFor
};
