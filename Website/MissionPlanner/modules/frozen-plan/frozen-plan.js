/* MissionPlanner/modules/frozen-plan — the frozen flight plan (comply mode).
 *
 * A mission tab's backbone (task C1): its params ARE the flight plan captured
 * when the mission was created from the Ephemeris tab (task E2 does the
 * capturing). The module sits between the departure technology and the coast
 * leg, and enforces the design doc's comply rule:
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
 * The param schema (decided against what E2 will export — Kim reviews):
 *
 *   origin:    "Earth"       — the departure system's primary; the required
 *                              v-infinity is measured against its heliocentric
 *                              velocity at the departure epoch
 *   departure: { r, v, jd }  — the frozen heliocentric hand-off state the
 *                              departure tech must deliver (m, m/s, jd); this
 *                              is PRE-departure-burn — the leg's burns follow
 *   arrival:   { body, jd, vInf } — the plan's arrival commitment: body name,
 *                              epoch, and approach v-infinity (m/s) the
 *                              arrival tech must be able to catch
 *   burn:      { pro, rad, nrm } — the plan's departure burn (m/s), a frozen
 *                              reference copy of what E2 wrote into the leg
 *   waypoints: [{ days, burn }]  — likewise the plan's waypoint burns
 *
 * `burn`/`waypoints` are reference copies for readouts and later comparison
 * (the WORKING copies live on the transfer-leg stage, where the user edits
 * them); the plan does not recompute the coast from them.
 *
 * The module declares `inputOptional: true` (a comply-mode carve-out in
 * recompute.js): a mission spawned with an empty tech slot still shows its
 * plan — no tech upstream is a warning, not a block.
 *
 * update() is pure (no DOM, no THREE) and Node-testable. There is no init
 * (sidebar card) and no draw hook — Kim redirected the module's whole view
 * presence (2026-07-12) to the phase bar: dates already surface via the
 * events bar, the PLAN REQUIRES / TECH DELIVERS comparison lives in
 * mission-view.js's `renderComplianceBar`, and the plan's own facts (flight
 * time, v∞ in, plan Δv — `planSummary` below) render there too, via the
 * registry descriptor (`sidebarCard: false` opts this stage out of the
 * generic per-stage card entirely). In-pane comply indicators are task C4,
 * parked pending design.
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
export var VINF_TOL = 10;          // m/s   — |v∞| mismatch
export var EPOCH_TOL_DAYS = 0.25;  // days  — hand-off epoch mismatch (6 h)
export var AIM_TOL_DEG = 1.0;      // deg   — v∞ direction (asymptote) mismatch

export var defaultParams = {
	origin: "Earth",
	departure: { r: null, v: null, jd: null },
	arrival: { body: "", jd: null, vInf: null },
	burn: { pro: 0, rad: 0, nrm: 0 },
	waypoints: []
};

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

function vec3Finite(a) {
	return Array.isArray(a) && a.length === 3 &&
		isFinite(a[0]) && isFinite(a[1]) && isFinite(a[2]);
}

function burnMag(b) { return Math.hypot(b.pro || 0, b.rad || 0, b.nrm || 0); }

// The plan's total committed Δv (departure burn + waypoint burns), m/s.
// A readout figure, not physics — the working burns live on the leg stage.
export function planDv(params) {
	var p = Object.assign({}, defaultParams, params);
	var total = burnMag(p.burn || {});
	(p.waypoints || []).forEach(function (wp) { total += burnMag(wp.burn || {}); });
	return total;
}

// The plan's own facts that computeCompliance doesn't carry (it only
// measures departure v∞, not arrival): flight time and the arrival v∞
// commitment, plus the readout Δv above. Exported for the phase bar's
// compliance readout (mission-view.js), reached via the registry like
// complianceFor — these are plain params reads, no compliance math.
export function planSummary(params) {
	var p = Object.assign({}, defaultParams, params);
	var arr = p.arrival || {};
	var hasArrival = !!(arr.body && isFinite(arr.jd));
	return {
		flightDays: hasArrival ? (arr.jd - p.departure.jd) : null,
		arrivalVInf: isFinite(arr.vInf) ? arr.vInf : null,
		dv: planDv(p)
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

	var cosA = O.vDot(O.vUnit(reqVec), O.vUnit(delVec));
	var aimDeg = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;

	var rows = [
		{ key: "vinf", required: required.vInf, delivered: delivered.vInf,
		  delta: delivered.vInf - required.vInf,
		  ok: Math.abs(delivered.vInf - required.vInf) <= VINF_TOL },
		{ key: "epoch", required: required.jd, delivered: delivered.jd,
		  delta: delivered.jd - required.jd,
		  ok: Math.abs(delivered.jd - required.jd) <= EPOCH_TOL_DAYS },
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
		warnings.push(makeDiagnostic("no-departure-tech",
			"No departure technology is delivering the plan's departure state yet — " +
			"downstream shows the frozen plan itself.",
			{ values: { requiredVInf: comp.required.vInf },
			  fix: "Add a departure technology and configure it to deliver v∞ " +
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
				"Tech hands off on " + isoOf(row.delivered) + ", " +
				Math.abs(row.delta).toFixed(1) + " day" + (Math.abs(row.delta) >= 1.95 ? "s" : "") +
				(row.delta > 0 ? " late" : " early") + " against the plan's " + isoOf(row.required) + ".",
				{ values: { required: row.required, delivered: row.delivered, deltaDays: row.delta },
				  fix: "Move the release date " + (row.delta > 0 ? "earlier" : "later") + " by ≈" +
				       Math.abs(row.delta).toFixed(1) + " days." }));
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
	// plan owns no hardware). complianceFor/planSummary are exposed on the
	// descriptor (not just the named export) so the shell can reach them via
	// `registry.get("frozen-plan")` without a static import — modules stay
	// dynamically loaded (planner.js's MODULE_URLS), only the registry is a
	// shared/known handle.
	complianceFor: complianceFor,
	planSummary: planSummary
};
