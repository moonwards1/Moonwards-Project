/* MissionPlanner/modules/body-departure-leg — the integrated escape flight
 * from a generic-origin skyhook release to the Departure→Coast hand-off
 * (task J2, WP-J: departure from any body on the HELIO_BODIES list).
 *
 * The GENERIC sibling of departure-leg.js: same headless role and same shape,
 * but the flight is BODY-centric (origin body + Sun, Shared/body-leg.js — the
 * Mars-Phobos plotter's escape integrator, generalized) instead of geocentric
 * (Earth + Moon + Sun, geo-leg.js). The origin body comes from the incoming
 * carrier chain's `base` (orbital-skyhook set it), so one module serves Mars,
 * Ceres, Vesta, … — the release physics only ever needs the body's own
 * GM/radius/SOI.
 *
 * HEADLESS (`plainCard`): no title/status header — this stage's health is
 * exactly the flight's (impact/bound/no-handoff diagnostics). Its `init` adds
 * up to 2 waypoint-impulse cards + a release readout (mirroring departure-leg's
 * task-I4 UI); its visible output is the trajectory polyline in the origin-body
 * frame, its flight events (release, waypoint impulses, body-SOI exit), and
 * each waypoint's gizmo/arrows/readout boxes.
 *
 * update() (every recompute one FORWARD pass, no fixed-point iteration):
 *   1. Read the release-epoch ANCHOR from the frozen plan (releaseAnchorFor) —
 *      READ-ONLY, never re-derived.
 *   2. Evaluate the incoming carrier-chain packet there
 *      (Shared/kinematic-chain.js) — the released ship's body-centric state.
 *   3. Integrate FORWARD with body + Sun gravity (Shared/body-leg.js RK4),
 *      applying up to 2 waypoint impulses, each in its leg's own local
 *      dynamical frame (body-leg's localFrameAt / burnEffect).
 *   4. The flight ends at ORIGIN-BODY-SOI EXIT — the hand-off. Emit the ship's
 *      heliocentric state there (Frames.localToHelio(body, …)). The course
 *      check (frozen-plan, downstream) measures this integrated hand-off
 *      against the plan's window.
 *
 * A flight that never escapes (bound to the body) or impacts it is a hard
 * diagnostic — there is no hand-off to emit. The USER closes the loop: the
 * course check reports the gap; fixing it means adjusting the carrier, the
 * waypoint impulses, or re-planning from the Ephemeris tab.
 *
 * Params: waypoints: [{ t, burn: { pro, rad, nrm } }] — up to 2, t in SECONDS
 * after release, each strictly inside the flight as integrated so far.
 *
 * RENDER FRAME: rendersIn declares "body:origin" — task J3 aliases it to the
 * mission's own origin frame (buildBodyFrame, J1). See orbital-skyhook.js.
 *
 * This is a close structural copy of departure-leg.js's I4 view layer (the
 * waypoint cards, vector editor, readout boxes, gizmo/arrow draw) — a future
 * refactor could share it; kept separate here to leave the working lunar leg
 * untouched. update() is pure and Node-testable.
 *
 * Imports from ../../../Shared/, ../../core/ and ../frozen-plan/ — this folder
 * breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { evaluateChain } from "../../../Shared/kinematic-chain.js";
import { buildIntegratedLeg, stateAtLegTime, localFrameAt, burnEffect,
         bodySOI } from "../../../Shared/body-leg.js";
import { createWaypointGizmo, makeBurnArrow } from "../../../Shared/sim/burn-widget.js";
import { renderReadoutBoxes, positionReadoutBoxes } from "../../../Shared/sim/readout-panes.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { releaseAnchorFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;
var DAY = 86400;

var BURN_VEC_SCALE = 8;
var DV_COLOR = 0xff5fd0, DSPEED_COLOR = 0xffd24a;
var dvHex = "#ff5fd0", spdHex = "#ffd24a";
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
// ({ base, rotors }); `anchorJd` the release epoch. Returns
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

	var rotors = (chainData.rotors) || [];
	if (rotors.length === 0) {
		return { ok: false, diagnostic: makeDiagnostic("no-carrier",
			"The carrier chain has no releasing carrier — nothing sets the payload moving.",
			{ fix: "Add a carrier technology (e.g. the orbital skyhook) to the departure stack." }) };
	}

	var SOI_BODY = bodySOI(body);
	var state = evaluateChain(chainData, anchorJd);

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
	if (finalLeg.impact) {
		return { ok: false, diagnostic: makeDiagnostic("impact",
			"The departure flight impacts " + finalLeg.impact + " — no hand-off.",
			{ values: { impact: finalLeg.impact },
			  fix: "Adjust the release phase, the waypoint impulses, or the carrier geometry." }) };
	}
	if (finalLeg.primary !== "Sun" || !(finalLeg.vinfBody > 0)) {
		return { ok: false, diagnostic: makeDiagnostic("bound-no-handoff",
			"The flight stays bound to " + body + " — it never escapes to a hand-off.",
			{ values: { primary: finalLeg.primary },
			  fix: "Add speed: raise the release altitude, aim the release phase with the " +
			       "body's own motion, or boost at a waypoint (a low-perigee prograde impulse buys the most)." }) };
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

	events.unshift({ jd: anchorJd, label: "Release — carrier chain lets go" });
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
// source (same WeakMap pattern as every module).
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
	id: "body-departure-leg",
	title: "Departure leg",
	attachesTo: null,
	accepts: ["carrier-chain"],
	emits: ["ship-state"],
	rendersIn: ["body:origin"],   // resolved to the mission's origin frame by task J3
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

		// Vector editor widget (ported from SST — same as departure-leg's).
		var SVGNS = "http://www.w3.org/2000/svg";
		function svgEl(tag, attrs) {
			var e = document.createElementNS(SVGNS, tag);
			for (var k in attrs) { e.setAttribute(k, attrs[k]); }
			return e;
		}
		function buildVectorEditor(host, values, onChange) {
			host.innerHTML = "";
			var W = 278, H = 300, OX = 139, OY = 150, SCALE = 7.5, MAXV = 15, LEN = MAXV * SCALE;
			var axes = [
				{ key: "pro", name: "prograde", col: "#6fd49a", dx:  Math.cos(-Math.PI/6), dy: Math.sin(-Math.PI/6) },
				{ key: "rad", name: "radial",   col: "#ffb45a", dx:  Math.cos( Math.PI/6), dy: Math.sin( Math.PI/6) },
				{ key: "nrm", name: "normal",   col: "#8ab4ff", dx: 0, dy: -1 }
			];

			var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "sst-vecwidget" });

			(function () {
				var ux = Math.cos(-Math.PI/6), uy = Math.sin(-Math.PI/6);
				var vx = -uy, vy = ux;
				function P(lx, ly) { return [OX + lx*ux + ly*vx, OY + lx*uy + ly*vy]; }
				var A1 = P(-20, -6), A2 = P(-9, -12), A3 = P(-9, 10), A4 = P(-20, 16), E = P(28, -1);
				function poly(pts, fill) {
					return svgEl("polygon", {
						points: pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "),
						fill: fill, stroke: "#0c0f17", "stroke-width": 1.2, "stroke-linejoin": "round" });
				}
				svg.appendChild(poly([A1, A2, A3, A4], "#595d66"));
				svg.appendChild(poly([A1, A2, E],      "#7e828c"));
				svg.appendChild(poly([A2, A3, E],      "#3b3e46"));
			})();

			axes.forEach(function (a) {
				svg.appendChild(svgEl("line", {
					x1: OX - a.dx*LEN, y1: OY - a.dy*LEN, x2: OX + a.dx*LEN, y2: OY + a.dy*LEN,
					stroke: a.col, "stroke-opacity": 0.22, "stroke-width": 1 }));
				var t = svgEl("text", { x: OX + a.dx*(LEN+11), y: OY + a.dy*(LEN+11),
					fill: a.col, "fill-opacity": 0.7, "font-size": 11,
					"text-anchor": "middle", "dominant-baseline": "central" });
				t.textContent = a.name.charAt(0).toUpperCase();
				svg.appendChild(t);
			});

			axes.forEach(function (a) {
				a.line = svgEl("line", { stroke: a.col, "stroke-width": 2.5, "stroke-linecap": "round" });
				a.head = svgEl("polygon", { fill: a.col });
				a.val  = svgEl("text", { fill: a.col, "font-size": 11, "font-weight": 600,
					"text-anchor": "middle", "dominant-baseline": "central" });
				svg.appendChild(a.line); svg.appendChild(a.head); svg.appendChild(a.val);
			});
			host.appendChild(svg);

			var nums = {};
			var row = document.createElement("div"); row.className = "sst-vec-nums";
			axes.forEach(function (a) {
				var cell = document.createElement("label"); cell.className = "sst-vec-num";
				var tag = document.createElement("span");
				tag.textContent = a.name.charAt(0).toUpperCase() + a.name.slice(1);
				tag.style.color = a.col;
				var inp = document.createElement("input");
				inp.type = "number"; inp.step = 0.01; inp.value = (values[a.key]/1000).toFixed(2);
				inp.addEventListener("change", function () {
					var v = parseFloat(inp.value); if (!isFinite(v)) { v = 0; }
					values[a.key] = v * 1000; redraw(); onChange(a.key, v * 1000);
				});
				nums[a.key] = inp;
				cell.appendChild(tag); cell.appendChild(inp); row.appendChild(cell);
			});
			host.appendChild(row);

			function redraw() {
				axes.forEach(function (a) {
					var v = values[a.key] / 1000;
					var vis = Math.max(-MAXV, Math.min(MAXV, v));
					var tx = OX + a.dx*vis*SCALE, ty = OY + a.dy*vis*SCALE;
					var show = Math.abs(vis) > 0.12;
					[a.line, a.head].forEach(function (n) { n.style.display = show ? "" : "none"; });
					if (show) {
						a.line.setAttribute("x1", OX); a.line.setAttribute("y1", OY);
						a.line.setAttribute("x2", tx); a.line.setAttribute("y2", ty);
						var s = vis < 0 ? -1 : 1, hx = s*a.dx, hy = s*a.dy, px = -hy, py = hx;
						var bx = tx - hx*9, by = ty - hy*9;
						a.head.setAttribute("points",
							tx + "," + ty + " " + (bx+px*5) + "," + (by+py*5) + " " + (bx-px*5) + "," + (by-py*5));
					}
					if (Math.abs(v) > 0.005) {
						a.val.style.display = "";
						a.val.setAttribute("x", tx + (vis<0?-1:1)*a.dx*15);
						a.val.setAttribute("y", ty + (vis<0?-1:1)*a.dy*15);
						a.val.textContent = v.toFixed(2);
					} else { a.val.style.display = "none"; }
					if (document.activeElement !== nums[a.key]) { nums[a.key].value = v.toFixed(2); }
				});
			}

			function toVB(e) {
				var r = svg.getBoundingClientRect();
				return [ (e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H ];
			}
			function pickAxis(px, py) {
				var best = -1, bestPerp = 18, rx = px - OX, ry = py - OY;
				for (var i = 0; i < axes.length; i++) {
					var a = axes[i];
					var proj = rx*a.dx + ry*a.dy, perp = Math.abs(rx*a.dy - ry*a.dx);
					if (Math.abs(proj) > 6 && perp < bestPerp) { bestPerp = perp; best = i; }
				}
				return best;
			}

			var dragIdx = -1, lastVB = null;
			var BURN_SENS = 1 / (SCALE * 10);
			function setAxisAbsolute(p, a) {
				var proj = (p[0] - OX) * a.dx + (p[1] - OY) * a.dy;
				var v = Math.max(-MAXV, Math.min(MAXV, proj / SCALE));
				values[a.key] = v * 1000;
				redraw();
				onChange(a.key, v * 1000);
			}
			svg.addEventListener("pointerdown", function (e) {
				var p = toVB(e), idx = pickAxis(p[0], p[1]);
				if (idx < 0) { return; }
				dragIdx = idx; lastVB = p;
				setAxisAbsolute(p, axes[idx]);
				try { svg.setPointerCapture(e.pointerId); } catch (err) {}
				e.preventDefault();
			});
			svg.addEventListener("pointermove", function (e) {
				if (dragIdx < 0) { return; }
				var p = toVB(e), a = axes[dragIdx];
				var dproj = (p[0] - lastVB[0]) * a.dx + (p[1] - lastVB[1]) * a.dy;
				lastVB = p;
				var sens = BURN_SENS * (e.shiftKey ? 0.25 : 1);
				var v = Math.max(-MAXV, Math.min(MAXV, values[a.key] / 1000 + dproj * sens));
				values[a.key] = v * 1000;
				redraw();
				onChange(a.key, v * 1000);
			});
			function endDrag() { dragIdx = -1; lastVB = null; }
			svg.addEventListener("pointerup", endDrag);
			svg.addEventListener("pointercancel", endDrag);

			host._sstRedraw = redraw;
			redraw();
		}

		// The release-point readout box.
		var releaseHead = document.createElement("div"); releaseHead.className = "mp-wp-head";
		releaseHead.textContent = "release";
		host.appendChild(releaseHead);
		var releaseBox = null;
		function updateReleaseBox(leg) {
			if (releaseBox) { ctx.readoutLayer.removeChild(releaseBox.el); releaseBox = null; }
			if (!ctx.readoutLayer || !leg) { return; }
			var box = document.createElement("div"); box.className = "mp-readout";
			box.innerHTML =
				'<div class="mp-readout-row"><span class="mp-readout-label">release</span>' +
				'<span class="mp-readout-val">' + isoOf(leg.jd0) + '</span></div>' +
				'<div class="mp-readout-row"><span class="mp-readout-label">hand-off v∞</span>' +
				'<span class="mp-readout-val">' + (leg.vinfBody / 1000).toFixed(2) + ' km/s</span></div>' +
				'<div class="mp-readout-row"><span class="mp-readout-label">flight time</span>' +
				'<span class="mp-readout-val">' + (leg.handoff.tSoi / DAY).toFixed(2) + ' d</span></div>';
			ctx.readoutLayer.appendChild(box);
			releaseBox = { el: box, host: releaseHead };
		}

		var wpHost = document.createElement("div"); host.appendChild(wpHost);
		var burnReadoutBoxes = [];
		var wpRows = [];

		function positionReadouts() {
			if (!ctx.readoutLayer) { return; }
			var all = burnReadoutBoxes.slice();
			if (releaseBox) { all.push(releaseBox); }
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
					var leg = legFor(ctx.world, ctx.stageId);
					var mid = (leg && leg.ok) ? leg.handoff.tSoi / 2 : 6 * 3600;
					list.push({ t: list.length ? Math.min(list[0].t + 3600, mid) : mid,
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
			updateReleaseBox(leg && leg.ok ? leg : null);

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
