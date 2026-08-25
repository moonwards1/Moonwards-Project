/* MissionPlanner/modules/body-departure-leg — the integrated escape flight
 * from a generic-origin skyhook release to the Departure→Coast hand-off, for
 * departures from any body on scene-frames.js's HELIO_BODIES list.
 *
 * The GENERIC sibling of departure-leg.js: same headless role and same shape,
 * but the flight is BODY-centric (origin body + Sun, Shared/body-leg.js — the
 * Mars-Phobos plotter's escape integrator, generalized) instead of geocentric
 * (Earth + Moon + Sun, geo-leg.js). The origin body comes from the incoming
 * carrier chain's `base`, which the departure platform sets, so one module serves
 * Mars, Ceres, Vesta, … — the release physics only ever needs the body's own
 * GM/radius/SOI.
 *
 * HEADLESS (`plainCard`): no title/status header — this stage's health is
 * exactly the flight's (impact/bound/no-handoff diagnostics). Its `init` adds
 * up to 2 waypoint-impulse cards, each carrying a straddling impulse/
 * prograde/plane-change readout box (Shared/sim/readout-panes.js) the same
 * way the Ephemeris tab's own waypoint cards do; its visible output is the
 * trajectory polyline in the origin-body frame, its flight events (release,
 * waypoint impulses, body-SOI exit), and each waypoint's gizmo/arrows. The
 * hand-off's own readouts (not tied to any one waypoint) still live in the
 * Ephemeris tab only.
 *
 * update() — every recompute is one FORWARD pass, no fixed-point iteration:
 *   1. Read the release-epoch ANCHOR from the frozen plan (releaseAnchorFor) —
 *      READ-ONLY, never re-derived.
 *   2. Evaluate the incoming carrier-chain packet there
 *      (Shared/kinematic-chain.js) — the released ship's body-centric state.
 *   3. Integrate FORWARD with body + Sun gravity (Shared/body-leg.js RK4),
 *      applying up to 2 waypoint impulses, each in its leg's own local
 *      dynamical frame (body-leg's localFrameAt / burnEffect).
 *   4. The flight ends at ORIGIN-BODY-SOI EXIT — the hand-off. Emit the ship's
 *      heliocentric state there (Frames.localToHelio(body, …)). frozen-plan,
 *      downstream, measures this integrated hand-off against the plan's window.
 *
 * A flight that never escapes (bound to the body) or impacts it still draws —
 * `samples` just runs to wherever the integration stopped — but emits no
 * hand-off packet (`handoff: null`), so there is nothing for the coast to
 * pick up. The USER closes the loop: the compliance check reports the gap;
 * fixing it means adjusting the carrier, the waypoint impulses, or
 * re-planning from the Ephemeris tab.
 *
 * Params: waypoints: [{ t, burn: { pro, rad, nrm } }] — up to 2, t in SECONDS
 * after release, each strictly inside the flight as integrated so far.
 *
 * RENDER FRAME: rendersIn declares "body:origin", which mission-view.js's
 * resolveFrameId aliases to the mission's own origin frame
 * (scene-frames.js's buildBodyFrame). See modules/skyhook/skyhook.js.
 *
 * The view layer here is a close structural copy of departure-leg.js's (the
 * waypoint cards, gizmo/arrow draw); only the vector editor is genuinely
 * shared, via Shared/sim/vector-editor.js. update() is pure and Node-testable.
 *
 * Imports from ../../../Shared/, ../../core/ and ../frozen-plan/ — this folder
 * breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { evaluateChain, elementCount } from "../../../Shared/kinematic-chain.js";
import { buildIntegratedLeg, stateAtLegTime, localFrameAt, burnEffect,
         bodySOI } from "../../../Shared/body-leg.js";
import { createWaypointGizmo, makeBurnArrowPair } from "../../../Shared/sim/burn-widget.js";
import { makeShipSprite } from "../../../Shared/sim/marker-card.js";
import { buildVectorEditor } from "../../../Shared/sim/vector-editor.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { releaseAnchorFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;
var DAY = 86400;

var DV_COLOR = 0xff5fd0, DSPEED_COLOR = 0xffd24a;
var GIZMO_PX = 42;

export var defaultParams = {
	waypoints: []   // up to 2: { t (s after release), burn: { pro, rad, nrm } }
};

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

function burnMag(b) { b = b || {}; return Math.hypot(b.pro || 0, b.rad || 0, b.nrm || 0); }

// True if `body` is a real heliocentric origin the integrator can escape.
function isHeliocentricBody(body) {
	var sys = systems.get(body);
	return !!(sys && sys.orbit && sys.orbit.system === systems.get("Sun"));
}

// First outward crossing of body-centric radius `target` (m) by `samples`,
// linearly interpolated. Returns the elapsed time (s), or null.
function firstCrossing(samples, target) {
	var prev = Math.hypot(samples[0].r[0], samples[0].r[1], samples[0].r[2]);
	for (var k = 1; k < samples.length; k++) {
		var cur = Math.hypot(samples[k].r[0], samples[k].r[1], samples[k].r[2]);
		if (prev < target && cur >= target) {
			var f = (target - prev) / (cur - prev);
			return samples[k - 1].t + f * (samples[k].t - samples[k - 1].t);
		}
		prev = cur;
	}
	return null;
}

// The whole flight, pure. `chainData` is a carrier-chain payload
// ({ base, rotors, impulses }); `anchorJd` the release epoch. Returns
// { ok:true, samples, jd0, segs, wpVisuals, handoff, events, totalDv,
// vinfBody, body } or { ok:false, diagnostic }. `samples` are body-centric
// { r, v, t }, TRUNCATED AT THE HAND-OFF (past body-SOI exit belongs to the
// coast). Exported for Node tests and the draw hook.
export function computeBodyDepartureLeg(params, chainData, anchorJd) {
	var body = chainData && chainData.base;
	if (!isHeliocentricBody(body)) {
		return { ok: false, diagnostic: makeDiagnostic("bad-origin",
			"The departure origin '" + body + "' is not a body with a heliocentric orbit — " +
			"there is no interplanetary hand-off to escape to.",
			{ values: { base: body } }) };
	}

	var wps = (params.waypoints || []).map(function (wp, i) {
		return Object.assign({ originalIndex: i }, wp);
	}).sort(function (a, b) { return a.t - b.t; });
	if (wps.length > 2) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The departure leg supports at most 2 waypoint impulses.",
			{ values: { count: wps.length } }) };
	}
	for (var w = 0; w < wps.length; w++) {
		if (!(isFinite(wps[w].t) && wps[w].t > 0)) {
			return { ok: false, diagnostic: makeDiagnostic("bad-params",
				"Waypoint " + (wps[w].originalIndex + 1) + " needs a positive time after release.",
				{ values: { t: wps[w].t } }) };
		}
	}

	if (elementCount(chainData) === 0) {
		return { ok: false, diagnostic: makeDiagnostic("no-carrier",
			"The carrier chain has no releasing carrier — nothing sets the payload moving.",
			{ fix: "Add a carrier technology (e.g. the skyhook) to the departure stack." }) };
	}

	var SOI_BODY = bodySOI(body);
	var state = evaluateChain(chainData, anchorJd);
	if (!(O.vMag(state.r) > 0)) {
		return { ok: false, diagnostic: makeDiagnostic("no-release-point",
			"The carrier chain releases from the centre of " + body +
			" — nothing on it places the payload above the surface.",
			{ fix: "Add a carrier with a release point above the body (e.g. the skyhook)." }) };
	}

	var segs = [];        // [{ leg, tStart, tEnd }]
	var samples = [];     // concatenated body-centric { r, v, t } — t global
	var wpVisuals = [];   // indexed by originalIndex
	var events = [];
	var totalDv = 0;
	var tBase = 0;
	var r = state.r, v = state.v;

	for (var i = 0; i <= wps.length; i++) {
		var leg = buildIntegratedLeg(body, r, v, anchorJd + tBase / DAY);
		var isLast = i === wps.length;
		var tCut = isLast ? null : wps[i].t - tBase;

		if (!isLast && !(tCut > 0 && tCut < leg.duration)) {
			return { ok: false, diagnostic: makeDiagnostic("waypoint-outside-leg",
				"Waypoint " + (wps[i].originalIndex + 1) + " at " + ((wps[i].t) / 3600).toFixed(1) +
				" h after release falls outside the flight as integrated so far (" +
				(tBase / 3600).toFixed(1) + " – " + ((tBase + leg.duration) / 3600).toFixed(1) + " h).",
				{ values: { t: wps[i].t, from: tBase, to: tBase + leg.duration },
				  fix: "Move the waypoint earlier, or change what comes before it." }) };
		}

		segs.push({ leg: leg, tStart: tBase, tEnd: isLast ? null : wps[i].t });

		for (var k = (samples.length ? 1 : 0); k < leg.samples.length; k++) {
			var s = leg.samples[k];
			if (tCut !== null && s.t > tCut) { break; }
			samples.push({ r: s.r, v: s.v, t: tBase + s.t });
		}

		if (isLast) { break; }

		var at = stateAtLegTime(leg, tCut);
		samples.push({ r: at.r, v: at.v, t: wps[i].t });
		var frame = localFrameAt(body, at.r, at.jde, leg.primary);
		var rLocal = O.vSub(at.r, frame.originR), vLocal = O.vSub(at.v, frame.originV);
		var burn = { pro: wps[i].burn && wps[i].burn.pro || 0,
		             rad: wps[i].burn && wps[i].burn.rad || 0,
		             nrm: wps[i].burn && wps[i].burn.nrm || 0 };
		var eff = burnEffect(frame.GM, rLocal, vLocal, burn);
		wpVisuals[wps[i].originalIndex] = { renderPos: at.r, rLocal: rLocal, vLocal: vLocal, eff: eff };
		var mag = burnMag(wps[i].burn);
		totalDv += mag;
		events.push({ jd: anchorJd + wps[i].t / DAY,
		              label: "Waypoint impulse — " + (mag / 1000).toFixed(2) + " km/s" });
		r = at.r;
		v = O.vAdd(eff.vAfter, frame.originV);
		tBase = wps[i].t;
	}

	var finalLeg = segs[segs.length - 1].leg;
	events.unshift({ jd: anchorJd, label: "Release — carrier chain lets go" });

	// A flight that impacts the body or never escapes it has no hand-off to
	// offer — draw whatever was integrated (already all in `samples`) and
	// leave the coast with nothing to pick up.
	if (finalLeg.impact || finalLeg.primary !== "Sun" || !(finalLeg.vinfBody > 0)) {
		events.sort(function (a, b) { return a.jd - b.jd; });
		return {
			ok: true, jd0: anchorJd, body: body,
			samples: samples, segs: segs, wpVisuals: wpVisuals,
			handoff: null, vinfBody: 0,
			events: events, totalDv: totalDv
		};
	}

	// The hand-off: first outward body-SOI crossing. The integrator ran on to
	// 0.1 AU; everything past the SOI belongs to the coast — truncate there.
	var tSoi = firstCrossing(samples, SOI_BODY);
	if (tSoi === null) {
		return { ok: false, diagnostic: makeDiagnostic("no-soi-exit",
			"The flight escapes but never reached " + body + "'s SOI within the integration budget.",
			{ values: { duration_d: (tBase + finalLeg.duration) / DAY } }) };
	}

	var lastSeg = segs[segs.length - 1];
	var handoffState = stateAtLegTime(lastSeg.leg, tSoi - lastSeg.tStart);
	var jdHandoff = anchorJd + tSoi / DAY;

	var cut = [];
	for (var c = 0; c < samples.length && samples[c].t <= tSoi; c++) { cut.push(samples[c]); }
	cut.push({ r: handoffState.r, v: handoffState.v, t: tSoi });

	events.push({ jd: jdHandoff,
	              label: body + " SOI exit — hand-off at v∞ " + (finalLeg.vinfBody / 1000).toFixed(2) + " km/s" });
	events.sort(function (a, b) { return a.jd - b.jd; });

	return {
		ok: true, jd0: anchorJd, body: body,
		samples: cut, segs: segs, wpVisuals: wpVisuals,
		handoff: { r: handoffState.r, v: handoffState.v, jd: jdHandoff, tSoi: tSoi },
		vinfBody: finalLeg.vinfBody,
		events: events, totalDv: totalDv
	};
}

// Last computed flight per (World, stage) — the draw hook's and init's data
// source. Same WeakMap pattern as every module here: keyed by World first,
// because N missions coexist and their Worlds reuse stage ids.
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

// Each waypoint card's burn-editor host (init, below), by index — draw()
// needs these to anchor the straddling readout box (Shared/sim/readout-panes.js)
// on the same card the user is editing. Same WeakMap-per-World pattern as
// lastByWorld above.
var wpHostsByWorld = new WeakMap();
function wpHostsFor(world, stageId) {
	var m = wpHostsByWorld.get(world);
	return (m && m.get(stageId)) || [];
}
function rememberWpHosts(world, stageId, hosts) {
	if (!world || typeof world !== "object") { return; }
	var m = wpHostsByWorld.get(world);
	if (!m) { m = new Map(); wpHostsByWorld.set(world, m); }
	m.set(stageId, hosts);
}

// State (r, v; body-centric m, m/s) at elapsed time t (s) since release
// (leg.jd0) -- TRUE re-propagation via body-leg's stateAtLegTime, walking
// leg.segs to find which impulse-to-impulse sub-flight t falls in. Same
// pattern as departure-leg.js's sibling function (and transfer-leg.js's
// original) -- the drawn polyline's `samples` only carry position, not
// velocity, which the chevron needs to orient along the direction of travel.
// Clamped to [0, leg.handoff.tSoi]: each sub-leg's own integration runs on
// past the hand-off, and the phase clock persists across a phase switch, so a
// stray t outside the drawn (truncated) flight still resolves to the nearest
// end rather than running past it.
export function stateAtElapsed(leg, t) {
	if (!leg || !leg.segs || !leg.segs.length) { return null; }
	var tEnd = leg.handoff ? leg.handoff.tSoi : leg.samples[leg.samples.length - 1].t;
	var tc = Math.max(0, Math.min(tEnd, t));
	var segs = leg.segs;
	var seg = segs[segs.length - 1];
	for (var i = 0; i < segs.length; i++) {
		if (segs[i].tEnd === null || tc <= segs[i].tEnd) { seg = segs[i]; break; }
	}
	return stateAtLegTime(seg.leg, tc - seg.tStart);
}

export default {
	id: "body-departure-leg",
	title: "Departure leg",
	attachesTo: null,
	accepts: ["carrier-chain"],
	emits: ["ship-state"],
	rendersIn: ["body:origin"],   // aliased to the mission's origin frame by
	                               // mission-view.js's resolveFrameId
	plainCard: true,

	update: function (ctx, input) {
		var params = Object.assign({}, defaultParams, ctx.params);

		var anchorJd = releaseAnchorFor(ctx.world);
		if (anchorJd === null) {
			rememberLeg(ctx.world, ctx.stageId, null);
			return makeDiagnostic("no-release-anchor",
				"This mission has no release anchor — no frozen flight plan (or legacy " +
				"release date) fixes when the carrier chain releases.",
				{ fix: "Start missions from the Ephemeris tab (Start Mission Plan bakes the anchor)." });
		}

		var leg = computeBodyDepartureLeg(params, input.data, anchorJd);
		rememberLeg(ctx.world, ctx.stageId, leg);
		if (!leg.ok) { return leg.diagnostic; }
		if (!leg.handoff) { return { packet: null, events: leg.events }; }

		var lifted = Frames.localToHelio(leg.body, leg.handoff.jd, leg.handoff.r, leg.handoff.v);
		var packet = PacketTypes.make("ship-state",
			{ r: lifted.r, v: lifted.v, jd: leg.handoff.jd, frame: "helio", dvUsed: leg.totalDv },
			{ tool: "mission-planner/body-departure-leg", label: "hand-off (" + leg.body + " SOI exit)",
			  iso: isoOf(leg.handoff.jd) });

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

		var wpHost = document.createElement("div"); host.appendChild(wpHost);

		function rebuildWaypointRows() {
			wpHost.innerHTML = "";
			var wps = stageParams().waypoints.slice();
			var burnHosts = [];
			wps.forEach(function (wp, i) {
				var card = document.createElement("div"); card.className = "mp-card mp-card-inset";
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
				numRow(card, "at hour", "h", (wp.t || 0) / 3600, 1, function (v) {
					var list = stageParams().waypoints.slice(); list[i].t = v * 3600;
					setParam("waypoints", list);
				});
				var burnHost = document.createElement("div"); burnHost.className = "mp-pane-host"; card.appendChild(burnHost);
				var burnObj = Object.assign({ pro: 0, rad: 0, nrm: 0 }, wp.burn);
				buildVectorEditor(burnHost, burnObj, function (axis, mps) {
					var list = stageParams().waypoints.slice();
					list[i].burn = Object.assign({ pro: 0, rad: 0, nrm: 0 }, list[i].burn);
					list[i].burn[axis] = mps;
					setParam("waypoints", list);
				});
				wpHost.appendChild(card);
				burnHosts.push(burnHost);
			});
			rememberWpHosts(ctx.world, ctx.stageId, burnHosts);
			if (wps.length < 2) {
				var add = document.createElement("button"); add.className = "mp-btn mp-ghost";
				add.textContent = "+ add waypoint";
				add.addEventListener("click", function () {
					var list = stageParams().waypoints.slice();
					var leg = legFor(ctx.world, ctx.stageId);
					// Placed at the chevron's current location (4.4) -- the elapsed time
					// since release the chevron is drawn at, same clock as stateAtElapsed.
					var t = (leg && leg.ok)
						? Math.max(1, Math.min(leg.handoff.tSoi - 1, (ctx.world.jd - leg.jd0) * DAY))
						: 6 * 3600;
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
	},

	// The last computed flight, for shell readouts that need the flown arc
	// rather than just the hand-off packet — the ship card's speed bar reads
	// `samples` for the current and peak speeds. Same registry-reached
	// accessor pattern frozen-plan.js uses for complianceFor.
	legFor: legFor,

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
		view.readoutEntries = [];
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
		if (leg.samples.length) {
			view.group.add(dot(leg.samples[0].r, 0xff5fd0, 6));
			view.group.add(dot(leg.samples[leg.samples.length - 1].r, 0xe8ecf5, 6));
		}

		// wv.eff (body-leg's re-exported burnEffect) carries the burnDv/
		// planeChange/progradeDv trio for the straddling readout box, paired
		// with that waypoint's own card (wpHostsFor, indexed by originalIndex
		// same as wpVisuals).
		var wpHosts = wpHostsFor(snap.world, snap.stageId);
		(leg.wpVisuals || []).forEach(function (wv, i) {
			if (!wv) { return; }
			var renderPos = new THREE.Vector3(wv.renderPos[0] / U, wv.renderPos[1] / U, wv.renderPos[2] / U);
			var giz = createWaypointGizmo(wv.rLocal, wv.vLocal, renderPos);
			view.group.add(giz);
			view.pxScaled.push({ obj: giz, px: GIZMO_PX });

			var pair = makeBurnArrowPair(renderPos, wv.eff.dSpeedVec, wv.eff.dv, DSPEED_COLOR, DV_COLOR);
			[pair.spdArrow, pair.dvArrow].forEach(function (a) {
				if (a) { view.group.add(a); view.pxScaled.push({ obj: a, px: GIZMO_PX }); }
			});

			if (wpHosts[i]) { view.readoutEntries.push({ host: wpHosts[i], data: wv.eff }); }
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
	}
};
