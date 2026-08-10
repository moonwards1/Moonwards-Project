/* MissionPlanner/modules/arrival-leg — the arrival approach: the coast's own
 * flight, continued under the destination's gravity, plus waypoint burns on it.
 *
 * THE SHAPE. This leg IS the coast, re-parameterized. It spans the seam window
 * core/arrival-seam.js derives —
 *
 *   [ closest approach − Δt , closest approach + ~1 day ]
 *
 * — starting from the state the COAST ITSELF is in at the window's left edge,
 * and integrating forward under the destination's gravity (RK4, body + Sun with
 * the indirect term: Shared/body-leg.js's integrateEncounter, the same physics
 * the coast uses inside an SOI). Nothing about the pass is constructed: where
 * the ship goes past the body, how close, and how fast are whatever the coast
 * delivers. With no burn programmed the drawn arrival trajectory is the drawn
 * coast trajectory, continuing.
 *
 * Waypoints (up to 2, the standard vector-editor interface) put burns on it —
 * a retro burn near the pass drops or captures, a nudge earlier moves the pass.
 *
 * WHERE THE STARTING STATE COMES FROM, and why it is not simply the input
 * packet. The chain hands this stage the coast's emitted state, which sits at
 * the coast's own leg end — at (or just before) closest approach, because that
 * is where arrival-boundary has to measure the delivered approach against the
 * plan's commitment. The arrival phase begins EARLIER than that, at the seam.
 * So the seam state is read off the coast leg directly: transfer-leg's
 * legFor()/stateAtElapsed() (the same registry-reached, cross-stage read
 * arrival-boundary makes for the plan's commitment), sampled at the window's
 * left edge. The input packet is still what supplies `dvUsed`, and it is the
 * fallback source when no coast leg is reachable — then the window is placed
 * around the delivered epoch and its start state found by plain heliocentric
 * back-propagation, which is exact precisely in the case that produces it (a
 * coast that never encountered the destination is pure Kepler out there).
 *
 * Because the window's width is Δt + 1 day rather than a fixed span, waypoint
 * times — SECONDS AFTER THE HAND-OFF, as before — can fall outside it when the
 * coast is retuned and the window shrinks. That is a warning and a clamp, not a
 * diagnostic: the coast getting faster must not blank the arrival phase.
 * Burns use the ecliptic-anchored prograde/normal/radial frame (geo-leg's
 * burnEffect — the same convention every waypoint editor in the planner means
 * by its axes).
 *
 * HEADLESS (`plainCard`), like the departure legs: its card is the window
 * readout plus the waypoint cards; its visible output is the polyline in the
 * destination frame (hand-off/closest-approach/end dots, waypoint gizmos + burn
 * arrows). Emits the leg-end ship-state (lifted to helio) so an arrival
 * technology downstream (arrival-skyhook) keeps its ship-state input.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; init/draw are the
 * browser-only view hooks. rendersIn "body:destination" is aliased to the
 * mission's destination frame by mission-view.js's resolveFrameId. `body` is
 * explicit, never implied (the body convention).
 *
 * Imports from ../../../Shared/, ../../core/ and sibling modules — this
 * folder breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { bodyConstants, integrateEncounter, stateAtLegTime } from "../../../Shared/body-leg.js";
import { burnEffect } from "../../../Shared/geo-leg.js";
import { buildVectorEditor } from "../../../Shared/sim/vector-editor.js";
import { createWaypointGizmo, makeBurnArrow } from "../../../Shared/sim/burn-widget.js";
import { makeShipSprite } from "../../../Shared/sim/marker-card.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { computeArrivalSeam, SEAM_MIN_DAYS, ARRIVAL_TAIL_DAYS } from "../../core/arrival-seam.js";
import { legFor as coastLegFor, stateAtElapsed as coastStateAtElapsed }
	from "../transfer-leg/transfer-leg.js";
import { arrivalCommitmentFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;
var GM_SUN = systems.get("Sun").GM;
var DAY = 86400;

var MAX_POLY_SAMPLES = 400;   // per segment, decimated from the RK4 trail

var BURN_VEC_SCALE = 8;
var DV_COLOR = 0xff5fd0, DSPEED_COLOR = 0xffd24a;
var GIZMO_PX = 42;

export var defaultParams = {
	body: null,     // destination body name — explicit, never implied
	waypoints: []   // up to 2: { t (s after hand-off), burn: { pro, rad, nrm } }
};

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

function burnMag(b) { b = b || {}; return Math.hypot(b.pro || 0, b.rad || 0, b.nrm || 0); }

function kmOf(m) { return Math.round(m / 1000).toLocaleString("en-US"); }

// The seam window and the state the coast is in at its left edge, in
// heliocentric terms. `coastLeg` is transfer-leg's own last computed leg (or
// null); `data` the delivered helio ship-state payload; `commitJd` the plan's
// committed arrival epoch (or null) — the no-encounter fallback core/
// arrival-seam.js uses, kept the same here as in mission-view.js's coastSeam so
// the leg and the Arrival slider agree on where the window sits.
//
// Returns { jd0, jdEnd, r, v, ca, deltaDays, hasEncounter, fromCoast }.
// `fromCoast` records whether the start state was read off the coast leg or
// back-propagated from the delivered state (see the header).
export function arrivalWindow(body, coastLeg, data, commitJd) {
	// isFinite(null) is true (null coerces to 0), so "is there a committed
	// epoch at all?" needs the type check, not just finiteness.
	var fallbackJd = (typeof commitJd === "number" && isFinite(commitJd)) ? commitJd : data.jd;
	var seam = computeArrivalSeam({
		destination: body,
		events: (coastLeg && coastLeg.ok) ? coastLeg.events : [],
		fallbackArrivalJd: fallbackJd
	});
	// With no encounter the seam collapses to a point (arrival-seam's fallback);
	// the phase still needs a window to work in, so one of the standard width is
	// placed around that epoch.
	var jd0 = seam.hasEncounter ? seam.start : seam.jd - SEAM_MIN_DAYS;
	var jdEnd = seam.hasEncounter ? seam.end : seam.jd + ARRIVAL_TAIL_DAYS;

	var st = null;
	if (coastLeg && coastLeg.ok) {
		var tSeam = (jd0 - coastLeg.jd0) * DAY;
		var legSpan = (coastLeg.end.jd - coastLeg.jd0) * DAY;
		if (tSeam >= 0 && tSeam <= legSpan) { st = coastStateAtElapsed(coastLeg, tSeam); }
	}
	if (st) {
		return { jd0: jd0, jdEnd: jdEnd, r: st.r, v: st.v, ca: seam.jd,
		         deltaDays: seam.deltaDays, hasEncounter: seam.hasEncounter, fromCoast: true };
	}
	var back = O.propagateState(GM_SUN, data.r, data.v, (jd0 - data.jd) * DAY);
	return { jd0: jd0, jdEnd: jdEnd, r: back.r, v: back.v, ca: seam.jd,
	         deltaDays: seam.deltaDays, hasEncounter: seam.hasEncounter, fromCoast: false };
}

// The whole leg, pure. `spec` is a heliocentric start state plus the window it
// spans: { r, v, jd0, jdEnd } — normally arrivalWindow()'s output. Returns
//
//   { ok: true, body, jd0, jdEnd, T, samples, segs, wpVisuals, ca, end,
//     events, warnings, totalDv, vInf0, rStart, impact }
//
// or { ok: false, diagnostic }. `samples` are body-centric { r, t } (t seconds
// after the hand-off) for the drawn polyline; `segs` keep the full RK4 trails
// stateAtElapsed() interpolates. Exported for Node tests and the view hooks.
export function computeArrivalLeg(params, spec) {
	var body = params.body;
	if (!body) {
		return { ok: false, diagnostic: makeDiagnostic("no-body",
			"This arrival leg has no destination body set.",
			{ fix: "Set the arrival body (the mission's destination)." }) };
	}
	var c;
	try { c = bodyConstants(body); } catch (e) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The arrival body '" + body + "' is not a body with a heliocentric orbit.",
			{ values: { body: body } }) };
	}
	var T = (spec.jdEnd - spec.jd0) * DAY;
	if (!(isFinite(T) && T > 0)) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The arrival window has no duration — the coast delivers no usable epoch.",
			{ values: { jd0: spec.jd0, jdEnd: spec.jdEnd } }) };
	}

	var wps = (params.waypoints || []).map(function (wp, i) {
		return Object.assign({ originalIndex: i }, wp);
	}).sort(function (a, b) { return a.t - b.t; });
	if (wps.length > 2) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The arrival leg supports at most 2 waypoint impulses.",
			{ values: { count: wps.length } }) };
	}
	var warnings = [];
	for (var w = 0; w < wps.length; w++) {
		if (!isFinite(wps[w].t)) {
			return { ok: false, diagnostic: makeDiagnostic("waypoint-outside-leg",
				"Waypoint " + (wps[w].originalIndex + 1) + " has no valid time.",
				{ values: { t: wps[w].t } }) };
		}
		// The window's width follows Δt, so tuning the coast can pull it in from
		// under a waypoint. Clamp and say so rather than failing the leg — the
		// arrival phase must not go blank because the approach got faster.
		var clamped = Math.max(60, Math.min(T - 60, wps[w].t));
		if (Math.abs(clamped - wps[w].t) > 1e-6) {
			warnings.push(makeDiagnostic("waypoint-outside-window",
				"Waypoint " + (wps[w].originalIndex + 1) + " sits at hour " +
				(wps[w].t / 3600).toFixed(1) + ", outside the " + (T / DAY).toFixed(1) +
				"-day approach window — it is being flown at hour " +
				(clamped / 3600).toFixed(1) + " instead.",
				{ values: { t: wps[w].t, flownAt: clamped, windowSeconds: T },
				  fix: "Move the waypoint inside the window, or lengthen it by slowing the approach." }));
			wps[w].t = clamped;
		}
	}
	wps.sort(function (a, b) { return a.t - b.t; });

	// The segment chain, transfer-leg style: each segment ends at the next
	// waypoint (burn applied there), the last at the window's end. Every segment
	// is real body + Sun integration, run to its own boundary — exitEnds false,
	// since the window routinely begins and ends outside a small destination's
	// SOI (see body-leg.js's integrateEncounter).
	var rH = spec.r.slice(), vH = spec.v.slice();
	var local = Frames.helioToLocal(body, spec.jd0, rH, vH);   // body-centric, for a zero-length first segment
	var jd = spec.jd0, tPrev = 0;
	var samples = [], segs = [], wpVisuals = [], events = [];
	var totalDv = 0, impact = null;
	var ca = { t: 0, r: O.vMag(local.r) };
	var vInf0 = null, rStart = O.vMag(local.r);
	var bounds = wps.map(function (wp) { return wp.t; }).concat([T]);

	for (var seg = 0; seg < bounds.length && !impact; seg++) {
		var durS = bounds[seg] - tPrev;
		// Two waypoints can land on the same instant once both have been clamped
		// into a shrunken window; the burn still happens, there is just no arc
		// between them to integrate.
		if (durS >= 1) {
			var res = integrateEncounter(body, rH, vH, jd, durS, { exitEnds: false });
			if (vInf0 === null) { vInf0 = res.vinf; }
			segs.push({ leg: { samples: res.samples, jde0: jd }, tStart: tPrev, dur: res.duration });

			// Polyline points, decimated (the RK4 trail is turn-angle-capped, so
			// it is dense exactly where the curve bends); the last is never lost.
			var last = res.samples.length - 1;
			var stride = Math.max(1, Math.floor(res.samples.length / MAX_POLY_SAMPLES));
			for (var si = (samples.length ? stride : 0); si <= last; si += stride) {
				var idx = (si + stride > last) ? last : si;
				samples.push({ r: res.samples[idx].r, t: tPrev + res.samples[idx].t });
				if (idx === last) { break; }
			}
			if (res.rmin < ca.r) { ca = { t: tPrev + res.tmin, r: res.rmin }; }

			local = { r: res.samples[last].r, v: res.samples[last].v };
			rH = res.end.r; vH = res.end.v;
			jd += res.duration / DAY;
			tPrev += res.duration;

			if (res.branch === "entry") {
				impact = { body: body, jd: jd, entry: res.entry };
				break;
			}
		}
		if (seg < wps.length) {
			var wp = wps[seg];
			var eff = burnEffect(c.GM, local.r, local.v, Object.assign({ pro: 0, rad: 0, nrm: 0 }, wp.burn));
			wpVisuals[wp.originalIndex] = { renderPos: local.r, rLocal: local.r, vLocal: local.v, eff: eff };
			var mag = burnMag(wp.burn);
			totalDv += mag;
			events.push({ jd: jd,
			              label: "Arrival waypoint impulse — " + (mag / 1000).toFixed(2) + " km/s" });
			local = { r: local.r, v: eff.vAfter };
			var lifted = Frames.localToHelio(body, jd, local.r, local.v);
			rH = lifted.r; vH = lifted.v;
		}
	}

	if (!segs.length) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The arrival window is too short to fly.",
			{ values: { windowSeconds: T } }) };
	}

	var jdEnd = jd;

	events.unshift({ jd: spec.jd0,
	                 label: "Arrival hand-off — " + body + " approach begins" });
	// display/mark policy: the seam's own closest approach is already marked on
	// the Arrival slider's track (mission-view's arrivalSpan, .mp-mark-ca), so
	// this finer figure carries flight:false to avoid a second mark a few hours
	// away from the first. It keeps transfer-leg's structured shape so it reads
	// as the same kind of thing.
	events.push({ jd: spec.jd0 + ca.t / DAY, flight: false,
	              kind: "closest-approach", body: body, vInf: vInf0, rmin: ca.r,
	              label: "Closest approach — " + kmOf(Math.max(0, ca.r - c.R)) + " km above " + body });
	if (impact) {
		events.push({ jd: impact.jd, label: "Impacts " + body + " — " +
			(impact.entry.v / 1000).toFixed(2) + " km/s" });
		warnings.push(makeDiagnostic("impacts-body",
			"The approach hits " + body + " on " + isoOf(impact.jd) + " at " +
			(impact.entry.v / 1000).toFixed(2) + " km/s.",
			{ values: { body: body, jd: impact.jd, speed: impact.entry.v },
			  fix: "Raise the pass with a waypoint impulse here, or with the coast's own corrections." }));
	}
	events.sort(function (a, b) { return a.jd - b.jd; });

	return {
		ok: true, body: body, jd0: spec.jd0, jdEnd: jdEnd, T: tPrev,
		samples: samples, segs: segs, wpVisuals: wpVisuals, ca: ca,
		end: { r: local.r, v: local.v }, impact: impact,
		events: events, warnings: warnings, totalDv: totalDv,
		vInf0: vInf0, rStart: rStart
	};
}

// Last computed leg per (World, stage) — the WeakMap pattern every module here
// uses: keyed by World first, since N missions coexist and reuse stage ids.
var lastByWorld = new WeakMap();
export function legFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberLeg(world, stageId, leg) {
	if (!world || typeof world !== "object") { return; }
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, leg);
}

// State (r, v; body-centric m, m/s) at elapsed time t (s) since the hand-off
// (leg.jd0), interpolated off the segment's own RK4 trail (geo-leg's
// stateAtLegTime — the trail is dense wherever the curve bends, so this is the
// same "true state" the drawn polyline is a decimation of). Clamped to
// [0, leg.T]: the phase clock persists across a phase switch, so a stray t
// outside this leg's window still resolves to the nearest end.
export function stateAtElapsed(leg, t) {
	if (!leg || !leg.segs || !leg.segs.length) { return null; }
	var tc = Math.max(0, Math.min(leg.T, t));
	var segs = leg.segs;
	var seg = segs[segs.length - 1];
	for (var i = 0; i < segs.length; i++) {
		if (tc <= segs[i].tStart + segs[i].dur) { seg = segs[i]; break; }
	}
	var s = stateAtLegTime(seg.leg, Math.max(0, Math.min(seg.dur, tc - seg.tStart)));
	return { r: s.r, v: s.v };
}

export default {
	id: "arrival-leg",
	title: "Arrival leg",
	attachesTo: null,             // rendered body-centric (the destination is the frame origin)
	accepts: ["ship-state"],
	emits: ["ship-state"],
	rendersIn: ["body:destination"],   // aliased to the mission's destination frame
	                                    // by mission-view.js's resolveFrameId
	plainCard: true,

	update: function (ctx, input) {
		var params = Object.assign({}, defaultParams, ctx.params);
		var data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");

		// The coast leg itself, for the seam window and the state at its left
		// edge (see the header). Absent in a bare Node call, or before the coast
		// has computed — arrivalWindow falls back to the delivered state.
		var coastLeg = null;
		if (ctx.world && typeof ctx.world.stages === "function") {
			var stages = ctx.world.stages();
			for (var i = 0; i < stages.length; i++) {
				if (stages[i].moduleId === "transfer-leg") {
					coastLeg = coastLegFor(ctx.world, stages[i].id);
					break;
				}
			}
		}
		var commit = ctx.world ? arrivalCommitmentFor(ctx.world) : null;
		var commitJd = (commit && commit.body === params.body) ? commit.jd : null;

		var win = arrivalWindow(params.body, coastLeg, data, commitJd);
		var leg = computeArrivalLeg(params, win);
		rememberLeg(ctx.world, ctx.stageId, leg);
		if (!leg.ok) { return leg.diagnostic; }

		var lifted = Frames.localToHelio(leg.body, leg.jdEnd, leg.end.r, leg.end.v);
		var packet = PacketTypes.make("ship-state",
			{ r: lifted.r, v: lifted.v, jd: leg.jdEnd, frame: "helio",
			  dvUsed: (data.dvUsed || 0) + leg.totalDv },
			{ tool: "mission-planner/arrival-leg", label: "arrival leg end (past " + leg.body + ")",
			  iso: isoOf(leg.jdEnd) });
		return { packet: packet, warnings: leg.warnings, events: leg.events };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	init: function (ctx) {
		var host = ctx.panelHost;

		function stageParams() {
			var stage = ctx.world.getStage(ctx.stageId);
			return Object.assign({}, defaultParams, stage ? stage.params : {});
		}
		function setParam(name, value) {
			var patch = {}; patch[name] = value;
			ctx.world.set({ stage: ctx.stageId, params: patch });
		}

		function numRow(parent, label, unit, value, step, commit) {
			var row = document.createElement("div"); row.className = "mp-inrow";
			var lab = document.createElement("label"); lab.textContent = label; row.appendChild(lab);
			var wrap = document.createElement("span");
			var inp = document.createElement("input");
			inp.type = "number"; inp.step = step; inp.value = value;
			wrap.appendChild(inp);
			if (unit) { var u = document.createElement("span"); u.className = "mp-unit"; u.textContent = unit; wrap.appendChild(u); }
			row.appendChild(wrap); parent.appendChild(row);
			inp.addEventListener("change", function () {
				var v = parseFloat(inp.value);
				if (isFinite(v)) { commit(v); }
			});
			return inp;
		}

		// The window is no longer a fixed two days, so its width and where the
		// pass falls inside it are what a waypoint's "at hour" is measured
		// against — say so, or the field has no scale.
		var windowNote = document.createElement("div");
		windowNote.className = "mp-muted";
		host.appendChild(windowNote);

		var wpHost = document.createElement("div"); host.appendChild(wpHost);

		function refreshWindowNote() {
			var leg = legFor(ctx.world, ctx.stageId);
			windowNote.textContent = (leg && leg.ok)
				? "approach window " + (leg.T / DAY).toFixed(1) + " d — closest approach at hour " +
				  (leg.ca.t / 3600).toFixed(1)
				: "";
		}

		function rebuildWaypointRows() {
			wpHost.innerHTML = "";
			var wps = stageParams().waypoints.slice();
			wps.forEach(function (wp, i) {
				var card = document.createElement("div"); card.className = "mp-card";
				var head = document.createElement("div"); head.className = "mp-wp-head";
				head.textContent = "waypoint " + (i + 1);
				var del = document.createElement("button"); del.className = "mp-btn"; del.textContent = "remove";
				del.addEventListener("click", function () {
					var list = stageParams().waypoints.slice();
					list.splice(i, 1);
					rebuildWaypointRowsFor(list);
					setParam("waypoints", list);
				});
				head.appendChild(del); card.appendChild(head);
				numRow(card, "at hour", "h", ((wp.t || 0) / 3600).toFixed(1), 0.5, function (v) {
					var list = stageParams().waypoints.slice(); list[i].t = v * 3600;
					setParam("waypoints", list);
				});
				var burnHost = document.createElement("div"); card.appendChild(burnHost);
				var burnObj = Object.assign({ pro: 0, rad: 0, nrm: 0 }, wp.burn);
				buildVectorEditor(burnHost, burnObj, function (axis, mps) {
					var list = stageParams().waypoints.slice();
					list[i].burn = Object.assign({ pro: 0, rad: 0, nrm: 0 }, list[i].burn);
					list[i].burn[axis] = mps;
					setParam("waypoints", list);
				});
				wpHost.appendChild(card);
			});
			if (wps.length < 2) {
				var add = document.createElement("button"); add.className = "mp-btn mp-ghost";
				add.textContent = "+ add waypoint";
				add.addEventListener("click", function () {
					var list = stageParams().waypoints.slice();
					var live = legFor(ctx.world, ctx.stageId);
					// Placed at the chevron's current location (4.4) -- the elapsed time
					// since hand-off the chevron is drawn at, same clock as stateAtElapsed.
					var t = (live && live.ok)
						? Math.max(60, Math.min(live.T - 60, (ctx.world.jd - live.jd0) * DAY))
						: 12 * 3600;
					list.push({ t: t, burn: { pro: 0, rad: 0, nrm: 0 } });
					rebuildWaypointRowsFor(list);
					setParam("waypoints", list);
				});
				wpHost.appendChild(add);
			}
		}
		function rebuildWaypointRowsFor(list) {
			var saved = stageParams;
			stageParams = function () { return { waypoints: list }; };
			rebuildWaypointRows();
			stageParams = saved;
		}
		rebuildWaypointRows();
		// Only the readout follows every recompute; rebuilding the waypoint
		// cards here would tear down a vector editor mid-drag.
		ctx.onResult(refreshWindowNote);
	},

	// The approach polyline in the destination frame: hand-off dot (magenta),
	// leg-end dot (white), closest-approach dot (amber), waypoint gizmos +
	// burn arrows. snap = { world, stageId, params, result }.
	draw: function (view, snap) {
		function disposeDeep(o) {
			if (o.children) { o.children.slice().forEach(disposeDeep); }
			if (o.geometry) { o.geometry.dispose(); }
			if (o.material) { o.material.dispose(); }
			if (o.material && o.material.map) { o.material.map.dispose(); }
		}
		while (view.group.children.length) {
			var c = view.group.children[0];
			view.group.remove(c);
			disposeDeep(c);
		}
		view.pxScaled = [];
		var leg = legFor(snap.world, snap.stageId);
		if (!leg || !leg.ok || snap.result.status !== "ok") { view.chevron = null; return; }
		var U = view.metresPerUnit;

		var pts = leg.samples.map(function (s) {
			return new THREE.Vector3(s.r[0] / U, s.r[1] / U, s.r[2] / U);
		});
		view.group.add(new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineBasicMaterial({ color: 0x66f0ff })));

		function dot(rM, colorHex, sizePx) {
			var g = new THREE.BufferGeometry();
			g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
				rM[0] / U, rM[1] / U, rM[2] / U]), 3));
			return new THREE.Points(g, new THREE.PointsMaterial({
				color: colorHex, size: sizePx, sizeAttenuation: false,
				transparent: true, depthTest: false }));
		}
		// The only point worth marking: the ship's own position at closest
		// approach (white). Unlike Coast's matching dot, there is no separate
		// destination marker here -- the destination IS this frame's origin,
		// at every instant, so a dot for it would just sit on the body itself.
		// The hand-off/leg-end states exist to structure the interface, not to
		// be looked at.
		var caSample = leg.samples[0];
		for (var i = 1; i < leg.samples.length; i++) {
			if (Math.abs(leg.samples[i].t - leg.ca.t) < Math.abs(caSample.t - leg.ca.t)) {
				caSample = leg.samples[i];
			}
		}
		view.group.add(dot(caSample.r, 0xe8ecf5, 6));

		(leg.wpVisuals || []).forEach(function (wv) {
			if (!wv) { return; }
			var renderPos = new THREE.Vector3(wv.renderPos[0] / U, wv.renderPos[1] / U, wv.renderPos[2] / U);
			var giz = createWaypointGizmo(wv.rLocal, wv.vLocal, renderPos);
			view.group.add(giz);
			view.pxScaled.push({ obj: giz, px: GIZMO_PX });

			var spdArrow = makeBurnArrow(renderPos, wv.eff.dSpeedVec, DSPEED_COLOR, BURN_VEC_SCALE);
			var dvArrow = makeBurnArrow(renderPos, wv.eff.dv, DV_COLOR, BURN_VEC_SCALE);
			[spdArrow, dvArrow].forEach(function (a) { if (a) { view.group.add(a); } });
		});

		// The ship-marker chevron (2.5) -- see departure-leg.js's sibling code
		// for the shell contract (no state of its own, positioned wherever
		// snap.world.jd sits along the flight, re-oriented/rescaled every
		// render frame by mission-view.js via the stable view.chevron slot).
		var t = (snap.world.jd - leg.jd0) * DAY;
		var s = stateAtElapsed(leg, t);
		if (s) {
			var chevron = makeShipSprite();
			chevron.position.set(s.r[0] / U, s.r[1] / U, s.r[2] / U);
			view.group.add(chevron);
			view.chevron = { sprite: chevron,
				velDir: new THREE.Vector3(s.v[0], s.v[1], s.v[2]).normalize() };
		} else {
			view.chevron = null;
		}
	},

	// Exposed on the descriptor (not just as a named export) so the shell can
	// reach the last computed leg via registry.get("arrival-leg") without a
	// static import — the same access rule the departure legs follow.
	legFor: legFor
};
