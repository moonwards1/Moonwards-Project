/* MissionPlanner/modules/frozen-plan — the frozen flight plan (comply mode).
 *
 * A mission tab's backbone: its params ARE the flight plan captured when the
 * mission was created from the Ephemeris tab (core/freeze.js does the
 * capturing). The module sits AT THE DEPARTURE→COAST BOUNDARY — see
 * ARCHITECTURE.md's "Phases are chains; compliance is a boundary check, not
 * a reconciliation" for the general shape — and enforces the comply rule:
 *
 *   THE FLOWN FLIGHT IS THE CLOCK. update() emits the state the departure
 *   technology actually DELIVERED — position, velocity and epoch — so the
 *   coast everyone sees is the flight the ship is really on, starting exactly
 *   where and when the departure phase ended. There is one mission clock and
 *   one seam epoch on it. The plan's own frozen state is the fallback for
 *   when nothing is delivered (an empty tech slot, or a departure whose
 *   flight fails), so a mission with no departure yet still flies its plan.
 *
 *   THE PLAN IS THE REQUIREMENT, NOT THE FLIGHT. What it commits to is
 *   reported through the envelope's WARNINGS channel (v-infinity out, epoch,
 *   aim direction), each carrying the required/delivered numbers so
 *   mission-view.js's compliance bar can render its PLAN REQUIRES / TECH
 *   DELIVERS readout, and the committed hand-off is drawn as a MARK on the
 *   timelines beside the real one. The plan never re-solves to follow the
 *   tech: moving it is the Update button's deliberate, user-asked commit
 *   (core/retarget.js), never something this boundary performs.
 *
 * `computeCompliance`'s `data` argument is a SINGLE, OPAQUE end result —
 * whatever the departure phase's own stage chain (a platform, any carriers,
 * and the integrated leg, each transforming what the last one produced)
 * composed to. This module never looks inside that composition and never
 * needs to; it makes exactly one comparison, delivered-vs-required, at this
 * one boundary. A gap is a warning naming the boundary mismatch itself, never
 * a reconciliation of whatever steps produced either side.
 *
 * THE PLAN'S SCOPE IS THE COAST AND ITS TWO ENDS, NOTHING ELSE: where and
 * when the mission starts (the hand-off at the origin's SOI edge), where and
 * when it is going (the arrival commitment), and the trajectory between (the
 * waypoints). It states a REQUIREMENT at the Departure→Coast boundary and
 * imposes nothing on how the departure phase meets it — in particular it does
 * not own the release epoch, which is a departure-phase decision living on the
 * departure leg stage (core/release-epoch.js).
 *
 * The param schema (what core/freeze.js writes):
 *
 *   origin:    "Earth"       — the departure system's primary; the required
 *                              v-infinity is measured against its heliocentric
 *                              velocity at the departure epoch
 *   departure: { r, v, jd }  — the frozen heliocentric hand-off state the
 *                              departure tech must deliver (m, m/s, jd), AT
 *                              THE ORIGIN'S SOI EDGE, where a departure leg
 *                              ends. A REQUIREMENT, and the coast's starting
 *                              state only while no tech delivers one. No burn
 *                              happens at this seam (see transfer-leg.js's
 *                              header for the reasoning the two modules
 *                              share)
 *   arrival:   { body, vInf } — the plan's arrival commitment: the body, and
 *                              the approach v-infinity (m/s) the arrival tech
 *                              must be able to catch. Read back by
 *                              arrivalCommitmentFor below.
 *
 *                              THERE IS NO COMMITTED ARRIVAL DATE. The
 *                              mission arrives when it arrives: the arrival
 *                              epoch is the coast's own measured closest
 *                              approach (transfer-leg's nearestApproach),
 *                              which moves as the flight is tuned, the same
 *                              way the departure epoch is whatever the
 *                              technology delivers. The coast's HORIZON — how
 *                              far it is flown — is its own `legDays`, a
 *                              duration the coast owns, not a date the plan
 *                              imposes.
 *   handoffWindowDays:        — half-width (d) of the hand-off WINDOW around
 *                              departure.jd; the epoch compliance row checks
 *                              against it, and so does the arrival seam's
 *                              (handoffWindowFor below)
 *   waypoints: [{ days, burn }]  — reference copy of the plan's waypoint
 *                              burns, for readouts and comparison (the
 *                              WORKING copy lives on the transfer-leg stage,
 *                              where the user edits them); the plan does not
 *                              recompute the coast from them. Also the line
 *                              between an original plan waypoint and a
 *                              later course correction: transfer-leg's
 *                              sidebar card reads this back through
 *                              planWaypointsFor to lock/reset the former
 *                              (index-matched) and freely remove the latter.
 *
 * The module declares `inputOptional: true` (a comply-mode carve-out in
 * recompute.js): a mission spawned with an empty tech slot still shows its
 * plan — no tech upstream is a warning, not a block.
 *
 * update() is pure (no DOM, no THREE) and Node-testable. There is no init
 * (sidebar card) and no draw hook: this stage's whole view presence is the
 * phase bar. Dates surface via the events bar, and the PLAN REQUIRES / TECH
 * DELIVERS comparison plus the plan's own facts (v∞ in/out, epoch, flight
 * time, plan Δv — `planSummary` below) render in mission-view.js's
 * `renderComplianceBar`. `sidebarCard: false` opts this stage out of the
 * generic per-stage card entirely.
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
// warning is raised. Exported so the shell's readouts and the Node tests share
// them. The epoch tolerance is not a constant here — the hand-off epoch is
// checked against the plan's own hand-off WINDOW, params.handoffWindowDays,
// the half-width core/freeze.js bakes at mission creation (±1 d default).
// Saves without the field default to DEFAULT_WINDOW_DAYS below, kept equal to
// freeze.js's own DEFAULT_WINDOW_DAYS — the consumer-side copy of the same
// agreement.
export var VINF_TOL = 10;             // m/s   — |v∞| mismatch
export var AIM_TOL_DEG = 1.0;         // deg   — v∞ direction (asymptote) mismatch
export var DEFAULT_WINDOW_DAYS = 1;   // days  — hand-off window half-width fallback

export var defaultParams = {
	origin: "Earth",
	departure: { r: null, v: null, jd: null },
	arrival: { body: "", vInf: null },
	handoffWindowDays: null,   // half-width (d); null → DEFAULT_WINDOW_DAYS
	waypoints: []
};

// The half-width (days) of a plan's hand-off window, with the default for
// saves that carry no such field.
export function windowDaysOf(params) {
	var w = params ? params.handoffWindowDays : null;
	return (isFinite(w) && w > 0) ? w : DEFAULT_WINDOW_DAYS;
}

// The mission's ARRIVAL COMMITMENT: the plan's { body, vInf } — WHERE it is
// going and HOW FAST it may show up, the two things an arrival technology has
// to be built for. The arrival technologies and mission-view.js read it
// through this one function rather than each groping through the stages.
// Returns null when the mission has no frozen plan or commits to no body.
//
// NO EPOCH. When the mission arrives is measured, not committed — the coast's
// own closest approach (see the param schema above) — so there is no date
// here to read and nothing to reconcile a measured one against.
export function arrivalCommitmentFor(world) {
	if (!world || typeof world.stages !== "function") { return null; }
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId !== "frozen-plan") { continue; }
		var arr = (stages[i].params && stages[i].params.arrival) || {};
		if (typeof arr.body === "string" && arr.body !== "") {
			return { body: arr.body, vInf: isFinite(arr.vInf) ? arr.vInf : null };
		}
	}
	return null;
}

// The mission's ORIGINAL waypoint burns — the reference copy frozen at plan
// creation (core/freeze.js), read the same way arrivalCommitmentFor reads
// its field. transfer-leg's sidebar card uses
// this to tell an original plan waypoint (part of the committed mission,
// not removable — only resettable to these values) from one added later as
// a course correction during Coast (freely removable). Index-matched against
// the working copy on the transfer-leg stage: edits mutate waypoints in
// place and never reorder them, so position i here is plan waypoint i there.
// [] when the mission has no frozen plan.
export function planWaypointsFor(world) {
	if (!world || typeof world.stages !== "function") { return []; }
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId !== "frozen-plan") { continue; }
		return ((stages[i].params && stages[i].params.waypoints) || []).map(function (wp) {
			return { days: wp.days, burn: copyBurn(wp.burn) };
		});
	}
	return [];
}

// The mission's hand-off window half-width (days), read off the plan the same
// way arrivalCommitmentFor reads its field: this
// module's own epoch row, and the ship card's Coast-phase timing bar.
// DEFAULT_WINDOW_DAYS when the mission has no plan at all.
export function handoffWindowFor(world) {
	if (!world || typeof world.stages !== "function") { return DEFAULT_WINDOW_DAYS; }
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId === "frozen-plan") { return windowDaysOf(stages[i].params || {}); }
	}
	return DEFAULT_WINDOW_DAYS;
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

function copyBurn(b) {
	b = b || {};
	return { pro: b.pro || 0, rad: b.rad || 0, nrm: b.nrm || 0 };
}

// The plan's own facts for the phase bar's compliance readout
// (mission-view.js, reached via the registry like complianceFor). v∞ IN/OUT
// are named from the FLIGHT PLAN's point of view: "in" is the ship entering
// the plan (leaving the origin's SOI — the required departure v∞, derived the
// same way computeCompliance derives it), "out" is the ship leaving the plan
// (reaching the destination's SOI — the stored arrival commitment). Plan Δv is
// the mission's total demand: v∞ in + v∞ out + the waypoint burns. The
// injection and the capture are the endpoint techs' jobs; the waypoint burns
// are the ship's own.
//
// NO ARRIVAL DATE OR FLIGHT TIME HERE. Both are properties of the flown coast,
// not of the plan's params — the arrival epoch is the measured closest
// approach — so a pure function of the plan cannot state them, and should not
// pretend to.
export function planSummary(params) {
	var p = Object.assign({}, defaultParams, params);
	var arr = p.arrival || {};
	var dep = p.departure || {};
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
// respectively. Exported for Node tests and the shell's compliance bar.
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
	// Required: the plan's v-infinity out, measured against the origin's
	// heliocentric velocity at the plan's departure epoch. Derived from the
	// frozen state rather than stored, so the two can never disagree.
	var reqVec = O.vSub(dep.v, Frames.bodyHelioState(p.origin, dep.jd).v);
	var required = { vInf: O.vMag(reqVec), vInfVec: reqVec, jd: dep.jd };

	if (!data) { return { ok: true, required: required, delivered: null, rows: [] }; }

	// Delivered: the same measurement on the tech's hand-off state, against
	// the origin's velocity at the TECH's epoch (it releases when it releases).
	var delVec = O.vSub(data.v, Frames.bodyHelioState(p.origin, data.jd).v);
	// `state` is the delivered hand-off itself, carried through so a view can
	// offer to ADOPT it as the plan's new departure (mission-view.js's
	// compliance bar). Comparing is still all this module does — adopting is a
	// deliberate user action elsewhere, never something the boundary performs.
	var delivered = { vInf: O.vMag(delVec), vInfVec: delVec, jd: data.jd,
	                  state: { r: data.r.slice(), v: data.v.slice(), jd: data.jd } };

	// A ~zero v∞ vector has no direction to compare (vUnit of it is NaN), and
	// that is legitimate: a waypoint-only plan freezes to required v∞ 0. The
	// magnitude row already reports any mismatch in that case.
	var aimDeg = 0;
	if (required.vInf > 1e-6 && delivered.vInf > 1e-6) {
		var cosA = O.vDot(O.vUnit(reqVec), O.vUnit(delVec));
		aimDeg = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
	}

	// The epoch row asks "is the delivered hand-off inside the plan's window"
	// (see the tolerance comment up top); the row carries the window itself, so
	// a readout can render the band and not just the verdict.
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

// Last computed compliance per (World, stage), for the shell's readouts. Keyed
// by World first because N missions coexist and their Worlds reuse stage ids —
// a stageId-only cache would let one mission's recompute clobber another's
// readouts. WeakMap, so a closed mission's entries go with its World.
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
	// the shortfall becomes a compliance warning, not a block. The
	// Coast→Arrival seam has no equivalent boundary.
	boundary: true,
	rendersIn: ["helio"],
	// No sidebar card: this stage's readouts and diagnostics all render in the
	// phase bar instead — see renderComplianceBar in mission-view.js.
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

		// THE FLOWN FLIGHT IS THE CLOCK: the state that flows downstream is the
		// one the departure technology actually delivered — position, velocity
		// AND epoch — so the coast drawn below this seam starts exactly where
		// and when the departure phase ended. The plan's own frozen state is
		// the FALLBACK, used when nothing is delivered (an empty tech slot, or
		// a departure whose flight fails); a mission with no departure yet
		// still flies its plan. Δv spent so far is a fact of the tech, so that
		// passes through.
		var src = comp.delivered ? comp.delivered.state : params.departure;
		var flown = comp.delivered ? comp.delivered.vInf : comp.required.vInf;
		var packet = PacketTypes.make("ship-state",
			{ r: src.r.slice(), v: src.v.slice(), jd: src.jd, frame: "helio",
			  dvUsed: data ? (data.dvUsed || 0) : 0 },
			{ tool: "mission-planner/frozen-plan",
			  label: comp.delivered ? "delivered hand-off" : "plan departure",
			  iso: isoOf(src.jd) });

		// One event: the flight's own hand-off, which is where the Coast
		// timeline begins — the same instant the Departure timeline ends. The
		// plan's committed hand-off is a mark beside it, not an event
		// (mission-view.js's plannedDeparture).
		//
		// The coast's other end is NOT emitted here. The mission arrives at its
		// measured closest approach, which only transfer-leg can measure, and
		// it emits that itself (its "closest approach" event, the one the seam
		// and the sliders read). A "plan arrival" event here would be a second
		// arrival date competing with the real one.
		var events = [{ jd: src.jd,
		                label: "Exit origin SOI — v∞ " + (flown / 1000).toFixed(2) + " km/s" }];
		return { packet: packet, warnings: complianceWarnings(comp), events: events };
	},

	// No view layer: no init (see sidebarCard above) and no draw hook (the
	// plan owns no hardware). complianceFor/planSummary/arrivalCommitmentFor are
	// exposed on the descriptor (not just the named export) so the shell can
	// reach them via `registry.get("frozen-plan")` without a static import —
	// modules stay dynamically loaded (planner.js's MODULE_URLS), only the
	// registry is a shared/known handle.
	complianceFor: complianceFor,
	planSummary: planSummary,
	arrivalCommitmentFor: arrivalCommitmentFor,
	handoffWindowFor: handoffWindowFor,
	planWaypointsFor: planWaypointsFor
};
