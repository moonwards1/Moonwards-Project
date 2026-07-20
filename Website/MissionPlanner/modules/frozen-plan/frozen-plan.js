/* MissionPlanner/modules/frozen-plan — the frozen flight plan (comply mode).
 *
 * A mission tab's backbone (task C1): its params ARE the flight plan captured
 * when the mission was created from the Ephemeris tab (task E2 does the
 * capturing). The module sits AT THE DEPARTURE→COAST BOUNDARY — see
 * ARCHITECTURE.md's "Phases are chains; compliance is a boundary check, not
 * a reconciliation" for the general shape this is one instance of — and
 * enforces the design doc's comply rule:
 *
 *   THE PLAN IS AUTHORITATIVE. update() always emits the plan's own frozen
 *   departure ship-state downstream — never the tech's — so the coast
 *   trajectory everyone sees is the committed plan. When the tech's delivered
 *   state deviates from the plan, the deviation is reported through the
 *   envelope's WARNINGS channel (v-infinity out, epoch, aim direction), each
 *   carrying the required/delivered numbers so the compliance card (task C2)
 *   can render its PLAN REQUIRES / TECH DELIVERS grid. The plan never
 *   re-solves to follow the tech.
 *
 * `computeCompliance`'s `data` argument is a SINGLE, OPAQUE end result —
 * whatever the departure phase's own stage chain (one stage today, lunar-
 * skyhook; possibly several once WP-F lands, each transforming the ship-
 * state the last one produced) composed to. This module never looks inside
 * that composition and never needs to; it makes exactly one comparison,
 * delivered-vs-required, at this one boundary. A gap is a warning naming the
 * boundary mismatch itself, never a reconciliation of whatever steps
 * produced either side.
 *
 * The param schema (decided against what E2 will export — Kim reviews):
 *
 *   origin:    "Earth"       — the departure system's primary; the required
 *                              v-infinity is measured against its heliocentric
 *                              velocity at the departure epoch
 *   departure: { r, v, jd }  — the frozen heliocentric hand-off state the
 *                              departure tech must deliver (m, m/s, jd) —
 *                              THE COAST'S OWN STARTING STATE, full stop; no
 *                              burn happens at this seam (2026-07-14, Kim —
 *                              see transfer-leg.js's header for the reasoning
 *                              this and that module now share)
 *   arrival:   { body, jd, vInf } — the plan's arrival commitment: body name,
 *                              epoch, and approach v-infinity (m/s) the
 *                              arrival tech must be able to catch
 *   handoffWindowDays:        — half-width (d) of the hand-off WINDOW around
 *                              departure.jd (WP-I's timing model, task D7);
 *                              the epoch compliance row checks against it
 *   releaseAnchorJd:          — the READ-ONLY release anchor: the epoch the
 *                              departure chain releases at, baked at freeze
 *                              and never re-derived (see releaseAnchorFor)
 *   waypoints: [{ days, burn }]  — reference copy of the plan's waypoint
 *                              burns, for readouts and later comparison (the
 *                              WORKING copy lives on the transfer-leg stage,
 *                              where the user edits them); the plan does not
 *                              recompute the coast from them.
 *
 * (A `burn` field — a frozen reference copy of a "departure burn" — lived
 * here and on transfer-leg until 2026-07-14. It was always zero for
 * anything this plan's own freeze contract produced (the departure state
 * above already IS the coast's start), but the shipped preset predated that
 * contract and carried a genuinely non-zero one on transfer-leg — a second
 * injection sitting on the WRONG SIDE of this exact boundary, uncounted by
 * the one comparison above. The fix was never to reconcile it against
 * departure.v; it was to recognize it belonged to whatever composed the
 * departure requirement, and fold it there (presets/default-mission.js).
 * Removed rather than fixed in place: this module has no business
 * describing HOW a departure state was reached, only WHAT it is.)
 *
 * The module declares `inputOptional: true` (a comply-mode carve-out in
 * recompute.js): a mission spawned with an empty tech slot still shows its
 * plan — no tech upstream is a warning, not a block.
 *
 * update() is pure (no DOM, no THREE) and Node-testable. There is no init
 * (sidebar card) and no draw hook — Kim redirected the module's whole view
 * presence (2026-07-12) to the phase bar: dates already surface via the
 * events bar, the PLAN REQUIRES / TECH DELIVERS comparison lives in
 * mission-view.js's `renderComplianceBar`, and the plan's own facts (v∞
 * in/out, epoch, flight time, plan Δv — `planSummary` below) render there
 * too, via the registry descriptor (`sidebarCard: false` opts this stage
 * out of the generic per-stage card entirely). In-pane comply indicators
 * are task C4, parked pending design.
 *
 * Imports from ../../../Shared/ and ../../core/ — this folder breaks if
 * moved without them coming along.
 */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { makeDiagnostic } from "../../core/diagnostics.js";

var O = OrbitalMath;

// Compliance tolerances: how far the tech may deviate from the plan before a
// warning is raised. Exported so C2's card and C3's assists share them.
// The epoch tolerance is NOT a constant any more (task I3, WP-I's timing
// model): the hand-off epoch is checked against the plan's own hand-off
// WINDOW — params.handoffWindowDays, the half-width core/freeze.js bakes at
// mission creation (±1 d default) — which promoted the old fixed ±0.25 d
// point tolerance to a visible plan field. Pre-D7 saves lack the field and
// default to DEFAULT_WINDOW_DAYS below (kept equal to freeze.js's own
// DEFAULT_WINDOW_DAYS — the consumer-side copy of the same agreement).
export var VINF_TOL = 10;             // m/s   — |v∞| mismatch
export var AIM_TOL_DEG = 1.0;         // deg   — v∞ direction (asymptote) mismatch
export var DEFAULT_WINDOW_DAYS = 1;   // days  — hand-off window half-width fallback

export var defaultParams = {
	origin: "Earth",
	departure: { r: null, v: null, jd: null },
	arrival: { body: "", jd: null, vInf: null },
	handoffWindowDays: null,   // half-width (d); null → DEFAULT_WINDOW_DAYS
	releaseAnchorJd: null,     // read-only release epoch; null → departure.jd
	waypoints: []
};

// The half-width (days) of a plan's hand-off window, with the pre-D7 default.
export function windowDaysOf(params) {
	var w = params ? params.handoffWindowDays : null;
	return (isFinite(w) && w > 0) ? w : DEFAULT_WINDOW_DAYS;
}

// The mission's READ-ONLY release anchor (WP-I's timing model): the epoch the
// departure chain releases at, frozen into the plan when the mission was
// created (core/freeze.js bakes it from D7's departure-duration estimate) and
// never re-derived — the Moon card shows exactly the Moon the user planned
// around in the Ephemeris tab. Resolution order:
//   1. the frozen-plan stage's releaseAnchorJd (post-D7 saves),
//   2. its departure.jd (pre-D7 saves: no flight-time lead recorded),
//   3. any stage's legacy releaseJd param (pre-I3 saves kept the release
//      epoch on the lunar-skyhook stage itself; migration preserves it so
//      a plan-less old save still anchors),
//   4. null — no anchor; the departure chain reports it as a diagnostic.
// Lives here because the plan owns the anchor; moon-platform, lunar-skyhook
// and departure-leg all read it through this one function.
export function releaseAnchorFor(world) {
	if (!world || typeof world.stages !== "function") { return null; }
	var stages = world.stages();
	var i, p;
	for (i = 0; i < stages.length; i++) {
		if (stages[i].moduleId !== "frozen-plan") { continue; }
		p = stages[i].params || {};
		if (isFinite(p.releaseAnchorJd)) { return p.releaseAnchorJd; }
		if (p.departure && isFinite(p.departure.jd)) { return p.departure.jd; }
	}
	for (i = 0; i < stages.length; i++) {
		p = stages[i].params || {};
		if (isFinite(p.releaseJd)) { return p.releaseJd; }
	}
	return null;
}

// The mission's ARRIVAL COMMITMENT (task H2): the plan's { body, jd, vInf },
// read the same way releaseAnchorFor reads the release anchor — the plan owns
// both mission endpoints, and the arrival technologies (capture-burn,
// arrival-skyhook) read the catch epoch through this one function rather than
// each groping through the stages themselves. Returns null when the mission
// has no frozen plan or the plan commits to no arrival body.
export function arrivalCommitmentFor(world) {
	if (!world || typeof world.stages !== "function") { return null; }
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId !== "frozen-plan") { continue; }
		var arr = (stages[i].params && stages[i].params.arrival) || {};
		if (typeof arr.body === "string" && arr.body !== "" && isFinite(arr.jd)) {
			return { body: arr.body, jd: arr.jd, vInf: isFinite(arr.vInf) ? arr.vInf : null };
		}
	}
	return null;
}

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

function vec3Finite(a) {
	return Array.isArray(a) && a.length === 3 &&
		isFinite(a[0]) && isFinite(a[1]) && isFinite(a[2]);
}

function burnMag(b) { return Math.hypot(b.pro || 0, b.rad || 0, b.nrm || 0); }

// The plan's own facts for the phase bar's compliance readout
// (mission-view.js, reached via the registry like complianceFor). Field
// names follow Kim's convention (2026-07-13): v∞ IN/OUT are from the FLIGHT
// PLAN's point of view — "in" is the ship entering the plan (leaving the
// origin's SOI, i.e. the required departure v∞, derived the same way
// computeCompliance derives it), "out" is the ship leaving the plan
// (reaching the destination's SOI, the stored arrival commitment). Plan Δv
// is the mission's total demand: v∞ in + v∞ out + the waypoint burns —
// the injection and the capture are the endpoint techs' jobs, the waypoint
// burns the ship's own. (The old planDv, departure-burn + waypoints, went
// with this redefinition: frozen legs carry a zero departure burn since
// E2's post-burn hand-off.)
export function planSummary(params) {
	var p = Object.assign({}, defaultParams, params);
	var arr = p.arrival || {};
	var dep = p.departure || {};
	var hasArrival = !!(arr.body && isFinite(arr.jd));
	var origin = systems.get(p.origin);

	var vInfIn = null;
	if (vec3Finite(dep.r) && vec3Finite(dep.v) && isFinite(dep.jd) && origin && origin.orbit) {
		vInfIn = O.vMag(O.vSub(dep.v, Frames.bodyHelioState(p.origin, dep.jd).v));
	}
	var vInfOut = isFinite(arr.vInf) ? arr.vInf : null;
	var waypointDv = 0;
	(p.waypoints || []).forEach(function (wp) { waypointDv += burnMag(wp.burn || {}); });

	return {
		epochJd: isFinite(dep.jd) ? dep.jd : null,
		arrivalJd: hasArrival ? arr.jd : null,
		flightDays: (hasArrival && isFinite(dep.jd)) ? (arr.jd - dep.jd) : null,
		vInfIn: vInfIn,
		vInfOut: vInfOut,
		waypointDv: waypointDv,
		dv: (vInfIn || 0) + (vInfOut || 0) + waypointDv
	};
}

// The comply-mode comparison, pure. `data` is the departure tech's delivered
// helio-frame ship-state payload, or null when no tech feeds the plan yet.
// Returns { ok: false, diagnostic } when the PLAN ITSELF is unusable (a
// damaged save — this fails the stage hard), else:
//
//   { ok: true,
//     required:  { vInf, vInfVec, jd },          — from the frozen plan
//     delivered: { vInf, vInfVec, jd } | null,   — from the tech, if any
//     rows: [{ key: "vinf"|"epoch"|"aim", required, delivered, delta, ok }] }
//
// rows exist only when delivered does; delta units are m/s, days, deg
// respectively. Exported for Node tests and the compliance card (C2).
export function computeCompliance(params, data) {
	var p = Object.assign({}, defaultParams, params);
	var dep = p.departure || {};

	if (!vec3Finite(dep.r) || !vec3Finite(dep.v) || !isFinite(dep.jd)) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The frozen plan has no departure state — this mission's save may be damaged.",
			{ values: { departure: dep } }) };
	}
	var origin = systems.get(p.origin);
	if (!origin || !origin.orbit) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The frozen plan's origin body '" + p.origin + "' is unknown.",
			{ values: { origin: p.origin } }) };
	}
	var arr = p.arrival || {};
	if (arr.body && !systems.get(arr.body)) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The frozen plan's arrival body '" + arr.body + "' is unknown.",
			{ values: { body: arr.body } }) };
	}
	if (arr.body && !(isFinite(arr.jd) && arr.jd > dep.jd)) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The frozen plan's arrival epoch must fall after its departure epoch.",
			{ values: { departureJd: dep.jd, arrivalJd: arr.jd } }) };
	}

	// Required: the plan's v-infinity out, measured against the origin's
	// heliocentric velocity at the plan's departure epoch. Derived from the
	// frozen state rather than stored, so the two can never disagree.
	var reqVec = O.vSub(dep.v, Frames.bodyHelioState(p.origin, dep.jd).v);
	var required = { vInf: O.vMag(reqVec), vInfVec: reqVec, jd: dep.jd };

	if (!data) { return { ok: true, required: required, delivered: null, rows: [] }; }

	// Delivered: the same measurement on the tech's hand-off state, against
	// the origin's velocity at the TECH's epoch (it releases when it releases).
	var delVec = O.vSub(data.v, Frames.bodyHelioState(p.origin, data.jd).v);
	var delivered = { vInf: O.vMag(delVec), vInfVec: delVec, jd: data.jd };

	// A ~zero v∞ vector has no direction to compare (vUnit of it is NaN) —
	// legitimate since E2: a waypoint-only plan freezes to required v∞ 0.
	// The magnitude row already reports any mismatch in that case.
	var aimDeg = 0;
	if (required.vInf > 1e-6 && delivered.vInf > 1e-6) {
		var cosA = O.vDot(O.vUnit(reqVec), O.vUnit(delVec));
		aimDeg = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
	}

	// The epoch row is "inside the hand-off window" (task I3 — see the
	// tolerance comment up top); the row carries the window so C2's card can
	// render the band, not just the verdict.
	var windowDays = windowDaysOf(p);
	var rows = [
		{ key: "vinf", required: required.vInf, delivered: delivered.vInf,
		  delta: delivered.vInf - required.vInf,
		  ok: Math.abs(delivered.vInf - required.vInf) <= VINF_TOL },
		{ key: "epoch", required: required.jd, delivered: delivered.jd,
		  delta: delivered.jd - required.jd, window: windowDays,
		  ok: Math.abs(delivered.jd - required.jd) <= windowDays },
		{ key: "aim", required: 0, delivered: aimDeg, delta: aimDeg,
		  ok: aimDeg <= AIM_TOL_DEG }
	];
	return { ok: true, required: required, delivered: delivered, rows: rows };
}

// Deviation warnings from a compliance result — the comply-mode channel.
// Exported so tests can assert the exact mapping.
export function complianceWarnings(comp) {
	var warnings = [];
	if (!comp.ok) { return warnings; }

	if (!comp.delivered) {
		// Covers both "no tech yet" and "a tech is present but its flight
		// fails to deliver a hand-off" (a bound skyhook, a no-carrier chain,
		// an impact) — the boundary keeps the plan flowing in either case; the
		// specific failure shows on the failing stage's own card.
		warnings.push(makeDiagnostic("no-departure-tech",
			"No departure state is reaching the plan — the departure technology is " +
			"absent, or its flight doesn't deliver a hand-off — so the coast shows the " +
			"frozen plan itself.",
			{ values: { requiredVInf: comp.required.vInf },
			  fix: "Add or fix a departure technology so it delivers v∞ " +
			       (comp.required.vInf / 1000).toFixed(2) + " km/s on " + isoOf(comp.required.jd) + "." }));
		return warnings;
	}

	comp.rows.forEach(function (row) {
		if (row.ok) { return; }
		if (row.key === "vinf") {
			var shortBy = -row.delta;   // positive when the tech under-delivers
			warnings.push(makeDiagnostic("vinf-mismatch",
				"Tech delivers v∞ " + (row.delivered / 1000).toFixed(2) + " km/s; the plan requires " +
				(row.required / 1000).toFixed(2) + " km/s (" +
				(shortBy > 0 ? "short by " : "over by ") + (Math.abs(row.delta) / 1000).toFixed(2) + " km/s).",
				{ values: { required: row.required, delivered: row.delivered, delta: row.delta },
				  fix: (shortBy > 0 ? "Raise" : "Lower") + " the tech's escape v∞ by ≈" +
				       (Math.abs(row.delta) / 1000).toFixed(2) + " km/s." }));
		} else if (row.key === "epoch") {
			warnings.push(makeDiagnostic("epoch-mismatch",
				"Hand-off lands on " + isoOf(row.delivered) + ", " +
				Math.abs(row.delta).toFixed(1) + " day" + (Math.abs(row.delta) >= 1.95 ? "s" : "") +
				(row.delta > 0 ? " late" : " early") + " — outside the plan's ±" + row.window +
				" d window around " + isoOf(row.required) + ".",
				{ values: { required: row.required, delivered: row.delivered,
				            deltaDays: row.delta, windowDays: row.window },
				  fix: "Shorten or lengthen the departure flight (waypoint impulses, carrier " +
				       "aiming), or re-plan from the Ephemeris tab for a different hand-off date." }));
		} else if (row.key === "aim") {
			warnings.push(makeDiagnostic("aim-mismatch",
				"Tech's departure asymptote points " + row.delivered.toFixed(1) +
				"° away from the plan's.",
				{ values: { angleDeg: row.delivered },
				  fix: "Adjust the tech's aiming (e.g. release phase) to close the " +
				       row.delivered.toFixed(1) + "° gap." }));
		}
	});
	return warnings;
}

// Last computed compliance per (World, stage), for the cards. Keyed by World
// first because N missions coexist (task A1) and their Worlds reuse stage
// ids — a stageId-only cache would let one mission's recompute clobber
// another's readouts. WeakMap, so a closed mission's entries go with its
// World.
var lastByWorld = new WeakMap();
export function complianceFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberCompliance(world, stageId, comp) {
	if (!world || typeof world !== "object") { return; }   // a bare Node call
	                                                       // (ctx.world null) has no view to feed
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, comp);
}

export default {
	id: "frozen-plan",
	title: "Flight plan",
	attachesTo: null,
	accepts: ["ship-state"],
	emits: ["ship-state"],
	inputOptional: true,
	// The Departure→Coast compliance boundary (recompute.js's `boundary`): the
	// plan is authoritative and the departure tech is measured against it, so
	// an upstream departure that is absent, half-built, or failing (a bound
	// skyhook, a no-carrier chain, an impacting flight) must never blank the
	// committed plan or the coast beyond it. The block chain terminates here;
	// the shortfall becomes a compliance warning, not a block. (The Coast→
	// Arrival boundary will set the same flag once its stage exists.)
	boundary: true,
	rendersIn: ["helio"],
	// No sidebar card (Kim, 2026-07-12): this stage's readouts and diagnostics
	// all render in the phase bar instead — see renderComplianceBar and its
	// callers in mission-view.js.
	sidebarCard: false,

	update: function (ctx, input) {
		var params = Object.assign({}, defaultParams, ctx.params);
		var data = null;
		if (input) {
			data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");
		}

		var comp = computeCompliance(params, data);
		rememberCompliance(ctx.world, ctx.stageId, comp);
		if (!comp.ok) { return comp.diagnostic; }

		// THE COMPLY RULE: the plan's own frozen state flows downstream,
		// regardless of what the tech delivered. Δv spent so far is a fact of
		// the tech, so that passes through.
		var dep = params.departure;
		var packet = PacketTypes.make("ship-state",
			{ r: dep.r.slice(), v: dep.v.slice(), jd: dep.jd, frame: "helio",
			  dvUsed: data ? (data.dvUsed || 0) : 0 },
			{ tool: "mission-planner/frozen-plan", label: "plan departure", iso: isoOf(dep.jd) });

		// The plan's endpoint dates — what the Coast slider spans once it
		// reads the frozen plan (task B2's noted one-line swap).
		var events = [{ jd: dep.jd,
		                label: "Plan departure — v∞ " + (comp.required.vInf / 1000).toFixed(2) + " km/s" }];
		var arr = params.arrival || {};
		if (arr.body && isFinite(arr.jd)) {
			events.push({ jd: arr.jd,
			              label: "Plan arrival — " + arr.body +
			                     (isFinite(arr.vInf) ? " at v∞ " + (arr.vInf / 1000).toFixed(2) + " km/s" : "") });
		}

		return { packet: packet, warnings: complianceWarnings(comp), events: events };
	},

	// No view layer: no init (see sidebarCard above) and no draw hook (the
	// plan owns no hardware). complianceFor/planSummary/releaseAnchorFor are
	// exposed on the descriptor (not just the named export) so the shell can
	// reach them via `registry.get("frozen-plan")` without a static import —
	// modules stay dynamically loaded (planner.js's MODULE_URLS), only the
	// registry is a shared/known handle.
	complianceFor: complianceFor,
	planSummary: planSummary,
	releaseAnchorFor: releaseAnchorFor,
	arrivalCommitmentFor: arrivalCommitmentFor
};
