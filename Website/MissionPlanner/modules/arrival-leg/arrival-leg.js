/* MissionPlanner/modules/arrival-leg — the arrival flyby leg: the visible
 * Coast→Arrival hand-off, and waypoint burns on the approach (task H3).
 *
 * THE SHAPE (Kim, 2026-07-18): the coast phase needs to terminate at a
 * visible point where it hands off to the arrival phase. That point is a bit
 * arbitrary, but chosen sufficiently far out it's reasonable:
 *
 *   - the incoming trajectory PASSES the destination at HALF ITS SOI RADIUS
 *     (the reference flyby's periapsis),
 *   - it STARTS ONE DAY OUT, headed along the coast trajectory's own
 *     delivered heading (the approach v∞ direction),
 *   - it ENDS ONE DAY AFTER passing the body.
 *
 * With no burn programmed the trajectory just passes by, endpoints as noted.
 * Waypoints (up to 2, the standard vector-editor interface) put burns on it —
 * a retro burn near the pass drops/captures, a nudge earlier moves the pass.
 *
 * THE CONSTRUCTION is a REFERENCE flyby, not a patched continuation: the
 * delivered coast state supplies the v∞ heading, magnitude and epoch (the
 * pass is pinned at the delivered arrival epoch), and the leg builds the
 * two-body hyperbola around the destination with that asymptote and a
 * periapsis of SOI/2 — in the plane through the asymptote closest to the
 * ecliptic (which side of the body it passes is thereby arbitrary; the
 * delivered position's own miss is transfer-leg's and the capture card's
 * business, not re-judged here). Tweaking the COAST so the drawn trajectories
 * are continuous across the hand-off is deferred (Kim: "we can come back to
 * that"). Physics is two-body around the destination (Kepler segments, exact
 * conics — O.propagateState/sampleArc handle the hyperbola); at one day out
 * the arc is near its asymptote anyway, where a straight-ish line is honest.
 *
 * Waypoint times are SECONDS AFTER THE HAND-OFF (the leg start); the pass
 * itself sits at t = 1 day. Burns use the ecliptic-anchored prograde/normal/
 * radial frame (O.applyBurn via geo-leg's burnEffect — the same convention
 * every waypoint editor in the planner means by its axes).
 *
 * HEADLESS (`plainCard`), like the departure legs: its card is the waypoint
 * cards + a pass-by readout box; its visible output is the polyline in the
 * destination frame (start/pass/end dots, waypoint gizmos + burn arrows).
 * Emits the leg-end ship-state (one day past the body, lifted to helio) so
 * the arrival technology downstream keeps its ship-state input.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; init/draw are the
 * browser-only view hooks. rendersIn "body:destination" — aliased to the
 * mission's destination frame by mission-view (task H2). `body` is explicit,
 * never implied (the body convention).
 *
 * Imports from ../../../Shared/, ../../core/ and sibling modules — this
 * folder breaks if moved without them coming along.
 */
/* global THREE */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { burnEffect } from "../../../Shared/geo-leg.js";
import { bodySOI } from "../../../Shared/body-leg.js";
import { buildVectorEditor } from "../../../Shared/sim/vector-editor.js";
import { createWaypointGizmo, makeBurnArrow } from "../../../Shared/sim/burn-widget.js";
import { renderReadoutBoxes, positionReadoutBoxes } from "../../../Shared/sim/readout-panes.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { approachAt } from "../arrival-approach.js";
import { bodyPhysics } from "../orbital-skyhook/orbital-skyhook.js";

var O = OrbitalMath;
var DAY = 86400;

export var LEAD_S = DAY;            // hand-off: one day before the pass
export var TAIL_S = DAY;            // leg end: one day after the pass
export var PERI_SOI_FRACTION = 0.5; // reference periapsis: half the SOI radius

var BURN_VEC_SCALE = 8;
var DV_COLOR = 0xff5fd0, DSPEED_COLOR = 0xffd24a;
var dvHex = "#ff5fd0", spdHex = "#ffd24a";
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

// The reference flyby's periapsis state (body-centric r, v arrays): the
// hyperbola with incoming-asymptote MOTION direction s (unit), excess speed
// vInf, and periapsis radius rp, in the plane through s closest to the
// ecliptic. Which side of the body it passes is set by that plane choice —
// arbitrary, per the header. Exported for Node tests.
export function referencePeriapsis(GM, s, vInf, rp) {
	var e = 1 + rp * vInf * vInf / GM;
	var vp = Math.sqrt(vInf * vInf + 2 * GM / rp);

	// Plane normal: ecliptic +z with its along-asymptote component removed
	// (x-axis fallback for a near-vertical asymptote).
	var h0 = O.vSub([0, 0, 1], O.vScale(s, s[2]));
	if (O.vMag(h0) < 1e-9) { h0 = O.vSub([1, 0, 0], O.vScale(s, s[0])); }
	var h = O.vUnit(h0);

	// Canonical 2D frame (x = periapsis direction, y = periapsis motion,
	// z = plane normal): the incoming asymptote's motion direction there.
	var cosTh = -1 / e;
	var sinTh = Math.sqrt(Math.max(0, 1 - cosTh * cosTh));
	var uIn = O.vUnit([sinTh, e + cosTh, 0]);

	// The rotation taking the canonical frame {uIn, z×uIn, z} onto the target
	// frame {s, h×s, h}; applied to canonical x̂ and ŷ.
	var A = [s, O.vCross(h, s), h];                    // target basis (columns)
	var B = [uIn, O.vCross([0, 0, 1], uIn), [0, 0, 1]]; // canonical basis
	function rot(vec) {
		var c = [O.vDot(B[0], vec), O.vDot(B[1], vec), O.vDot(B[2], vec)];
		return O.vAdd(O.vScale(A[0], c[0]), O.vAdd(O.vScale(A[1], c[1]), O.vScale(A[2], c[2])));
	}
	return { r: O.vScale(rot([1, 0, 0]), rp), v: O.vScale(rot([0, 1, 0]), vp), e: e, vp: vp };
}

// The whole leg, pure. `data` is a helio-frame ship-state payload (the
// delivered coast end). Returns { ok: true, body, jd0, jdPeri, jdEnd, rp,
// samples, segs, wpVisuals, ca, end, events, totalDv, approach } or
// { ok: false, diagnostic }. `samples` are body-centric { r, t } (t seconds
// after the hand-off). Exported for Node tests and the view hooks.
export function computeArrivalLeg(params, data) {
	var body = params.body;
	if (!body) {
		return { ok: false, diagnostic: makeDiagnostic("no-body",
			"This arrival leg has no destination body set.",
			{ fix: "Set the arrival body (the mission's destination)." }) };
	}
	var approach = approachAt(body, data);
	if (!approach) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The arrival body '" + body + "' is not a body with a heliocentric orbit.",
			{ values: { body: body } }) };
	}
	if (!(approach.vInf > 1)) {
		return { ok: false, diagnostic: makeDiagnostic("no-approach-speed",
			"The delivered coast arrives essentially co-moving with " + body +
			" — there is no incoming heading to build the approach from.",
			{ values: { vInf: approach.vInf } }) };
	}

	var wps = (params.waypoints || []).map(function (wp, i) {
		return Object.assign({ originalIndex: i }, wp);
	}).sort(function (a, b) { return a.t - b.t; });
	if (wps.length > 2) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The arrival leg supports at most 2 waypoint impulses.",
			{ values: { count: wps.length } }) };
	}
	var T = LEAD_S + TAIL_S;
	for (var w = 0; w < wps.length; w++) {
		if (!(isFinite(wps[w].t) && wps[w].t > 0 && wps[w].t < T)) {
			return { ok: false, diagnostic: makeDiagnostic("waypoint-outside-leg",
				"Waypoint " + (wps[w].originalIndex + 1) + " at " + ((wps[w].t || 0) / 3600).toFixed(1) +
				" h after hand-off falls outside the leg (0 – " + (T / 3600).toFixed(0) + " h).",
				{ values: { t: wps[w].t, legSeconds: T },
				  fix: "Keep the waypoint inside the two-day arrival window (the pass sits at hour " +
				       (LEAD_S / 3600).toFixed(0) + ")." }) };
		}
	}

	var GM = bodyPhysics(body).GM;
	var rp = PERI_SOI_FRACTION * bodySOI(body);
	var peri = referencePeriapsis(GM, O.vUnit(approach.vInfVec), approach.vInf, rp);

	// The pass is pinned at the delivered arrival epoch; the leg starts one
	// day before it.
	var jdPeri = data.jd;
	var jd0 = jdPeri - LEAD_S / DAY;
	var st0 = O.propagateState(GM, peri.r, peri.v, -LEAD_S);

	// The segment chain, transfer-leg style: each segment ends at the next
	// waypoint (burn applied there), the last at the leg end.
	var r = st0.r, v = st0.v;
	var samples = [], segs = [], wpVisuals = [], events = [];
	var totalDv = 0, tPrev = 0;
	var bounds = wps.map(function (wp) { return wp.t; }).concat([T]);
	for (var seg = 0; seg < bounds.length; seg++) {
		var durS = bounds[seg] - tPrev;
		segs.push({ r0: r, v0: v, tStart: tPrev, dur: durS });
		var arc = O.sampleArc(GM, r, v, durS, seg === bounds.length - 1 ? 200 : 120);
		for (var k = (seg > 0 ? 1 : 0); k < arc.length; k++) {
			samples.push({ r: arc[k].r, t: tPrev + arc[k].t });
		}
		var endState = O.propagateState(GM, r, v, durS);
		r = endState.r; v = endState.v;
		tPrev = bounds[seg];
		if (seg < wps.length) {
			var wp = wps[seg];
			var eff = burnEffect(GM, r, v, Object.assign({ pro: 0, rad: 0, nrm: 0 }, wp.burn));
			wpVisuals[wp.originalIndex] = { renderPos: r, rLocal: r, vLocal: v, eff: eff };
			var mag = burnMag(wp.burn);
			totalDv += mag;
			events.push({ jd: jd0 + wp.t / DAY, flight: false,
			              label: "Arrival waypoint impulse — " + (mag / 1000).toFixed(2) + " km/s" });
			v = eff.vAfter;
		}
	}

	// Closest approach, from the (anomaly-dense) samples.
	var ca = { t: 0, r: Infinity };
	for (var c = 0; c < samples.length; c++) {
		var rm = Math.hypot(samples[c].r[0], samples[c].r[1], samples[c].r[2]);
		if (rm < ca.r) { ca = { t: samples[c].t, r: rm }; }
	}

	var jdEnd = jd0 + T / DAY;
	events.unshift({ jd: jd0, flight: false,
	                 label: "Arrival hand-off — " + body + " approach begins" });
	events.push({ jd: jd0 + ca.t / DAY, flight: false,
	              label: "Closest approach — " + Math.round(ca.r / 1e3).toLocaleString("en-US") +
	                     " km from " + body });
	events.push({ jd: jdEnd, flight: false, label: "Arrival leg ends — past " + body });
	events.sort(function (a, b) { return a.jd - b.jd; });

	return {
		ok: true, body: body, jd0: jd0, jdPeri: jdPeri, jdEnd: jdEnd, rp: rp,
		samples: samples, segs: segs, wpVisuals: wpVisuals, ca: ca,
		end: { r: r, v: v }, events: events, totalDv: totalDv, approach: approach
	};
}

// Last computed leg per (World, stage) — the WeakMap pattern.
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

export default {
	id: "arrival-leg",
	title: "Arrival leg",
	attachesTo: null,             // rendered body-centric (the destination is the frame origin)
	accepts: ["ship-state"],
	emits: ["ship-state"],
	rendersIn: ["body:destination"],   // aliased to the mission's destination frame (task H2)
	plainCard: true,

	update: function (ctx, input) {
		var params = Object.assign({}, defaultParams, ctx.params);
		var data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");

		var leg = computeArrivalLeg(params, data);
		rememberLeg(ctx.world, ctx.stageId, leg);
		if (!leg.ok) { return leg.diagnostic; }

		var lifted = Frames.localToHelio(leg.body, leg.jdEnd, leg.end.r, leg.end.v);
		var packet = PacketTypes.make("ship-state",
			{ r: lifted.r, v: lifted.v, jd: leg.jdEnd, frame: "helio",
			  dvUsed: (data.dvUsed || 0) + leg.totalDv },
			{ tool: "mission-planner/arrival-leg", label: "arrival leg end (past " + leg.body + ")",
			  iso: isoOf(leg.jdEnd) });
		return { packet: packet, events: leg.events };
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

		// The pass-by readout box (mirrors the departure legs' release box).
		var passHead = document.createElement("div"); passHead.className = "mp-wp-head";
		passHead.textContent = "pass-by";
		host.appendChild(passHead);
		var passBox = null;
		function updatePassBox(leg) {
			if (passBox) { ctx.readoutLayer.removeChild(passBox.el); passBox = null; }
			if (!ctx.readoutLayer || !leg) { return; }
			var box = document.createElement("div"); box.className = "mp-readout";
			box.innerHTML =
				'<div class="mp-readout-row"><span class="mp-readout-label">hand-off</span>' +
				'<span class="mp-readout-val">' + isoOf(leg.jd0) + '</span></div>' +
				'<div class="mp-readout-row"><span class="mp-readout-label">approach v∞</span>' +
				'<span class="mp-readout-val">' + (leg.approach.vInf / 1000).toFixed(2) + ' km/s</span></div>' +
				'<div class="mp-readout-row"><span class="mp-readout-label">closest approach</span>' +
				'<span class="mp-readout-val">' + Math.round(leg.ca.r / 1e3).toLocaleString("en-US") + ' km</span></div>';
			ctx.readoutLayer.appendChild(box);
			passBox = { el: box, host: passHead };
		}

		var wpHost = document.createElement("div"); host.appendChild(wpHost);
		var burnReadoutBoxes = [];
		var wpRows = [];

		function positionReadouts() {
			if (!ctx.readoutLayer) { return; }
			var all = burnReadoutBoxes.slice();
			if (passBox) { all.push(passBox); }
			positionReadoutBoxes(all, ctx.mainEl, ctx.panelEl);
		}
		if (ctx.panelEl) { ctx.panelEl.addEventListener("scroll", positionReadouts); }

		function rebuildWaypointRows() {
			wpHost.innerHTML = "";
			wpRows = [];
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
					updateReadouts();
				});
				head.appendChild(del); card.appendChild(head);
				numRow(card, "at hour", "h", (wp.t || 0) / 3600, 1, function (v) {
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
				wpRows.push({ burnHost: burnHost });
			});
			if (wps.length < 2) {
				var add = document.createElement("button"); add.className = "mp-btn mp-ghost";
				add.textContent = "+ add waypoint";
				add.addEventListener("click", function () {
					var list = stageParams().waypoints.slice();
					// first waypoint defaults to the pass itself (t = 1 day),
					// a second lands an hour after the first
					list.push({ t: list.length ? Math.min(list[0].t + 3600, LEAD_S + TAIL_S - 3600) : LEAD_S,
					            burn: { pro: 0, rad: 0, nrm: 0 } });
					rebuildWaypointRowsFor(list);
					setParam("waypoints", list);
					updateReadouts();
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

		function updateReadouts() {
			var leg = legFor(ctx.world, ctx.stageId);
			updatePassBox(leg && leg.ok ? leg : null);

			var entries = wpRows.map(function (row, i) {
				var wv = leg && leg.ok && leg.wpVisuals && leg.wpVisuals[i];
				return { host: row.burnHost, data: wv ? wv.eff : null };
			});
			burnReadoutBoxes = renderReadoutBoxes(ctx.readoutLayer, burnReadoutBoxes, entries,
				{ classPrefix: "mp", dvHex: dvHex, spdHex: spdHex, planeChangeLabel: "plane change (to ecliptic)" });
			positionReadouts();
		}

		ctx.onResult(updateReadouts);
	},

	// The flyby polyline in the destination frame: hand-off dot (magenta),
	// leg-end dot (white), closest-approach dot (amber), waypoint gizmos +
	// burn arrows. snap = { world, stageId, params, result }.
	draw: function (view, snap) {
		function disposeDeep(o) {
			if (o.children) { o.children.slice().forEach(disposeDeep); }
			if (o.geometry) { o.geometry.dispose(); }
			if (o.material) { o.material.dispose(); }
		}
		while (view.group.children.length) {
			var c = view.group.children[0];
			view.group.remove(c);
			disposeDeep(c);
		}
		view.pxScaled = [];
		var leg = legFor(snap.world, snap.stageId);
		if (!leg || !leg.ok || snap.result.status !== "ok") { return; }
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
		if (leg.samples.length) {
			view.group.add(dot(leg.samples[0].r, 0xff5fd0, 6));
			view.group.add(dot(leg.samples[leg.samples.length - 1].r, 0xe8ecf5, 6));
		}
		// closest approach — nearest sample to ca.t
		var caSample = leg.samples[0];
		for (var i = 1; i < leg.samples.length; i++) {
			if (Math.abs(leg.samples[i].t - leg.ca.t) < Math.abs(caSample.t - leg.ca.t)) {
				caSample = leg.samples[i];
			}
		}
		view.group.add(dot(caSample.r, 0xe0a84a, 8));

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
	}
};
