/* MissionPlanner/modules/departure-leg — the integrated geocentric flight
 * from carrier release to the Departure→Coast hand-off (task I3, WP-I's
 * heart; absorbs F5's departure half).
 *
 * HEADLESS in the sense Kim meant it ("the departure leg includes everything
 * that leads up to the hand-off, so there is no point in having that be a
 * [status] card") — `plainCard` still holds: no title/status header, since
 * this stage's own health is exactly the flight's (impact/bound/no-handoff
 * diagnostics). It does have an `init` now (task I4): up to 2 waypoint-impulse
 * cards + a release-point readout, alongside the shell's generic diagnostic
 * boxes. Its visible output is the drawn trajectory polyline in the
 * Earth–Moon frame, its flight events (release, waypoint impulses, SOI exits
 * — the departure slider's real marks at last), and (task I4) each
 * waypoint's gizmo/arrows and the release/waypoint readout boxes.
 *
 * What update() does, per WP-I's timing model (every recompute one FORWARD
 * pass, no fixed-point iteration, no hidden solving):
 *
 *   1. Read the release-epoch ANCHOR from the frozen plan
 *      (frozen-plan.js's releaseAnchorFor) — READ-ONLY, never re-derived.
 *   2. Evaluate the incoming carrier-chain packet there
 *      (Shared/kinematic-chain.js) — the released ship's geocentric state.
 *   3. Integrate FORWARD with restricted N-body gravity
 *      (Shared/geo-leg.js's RK4: Earth + Moon + Sun, real ephemerides, no
 *      SOI kink), applying up to 2 waypoint impulses along the way, each in
 *      its leg's own local dynamical frame (geo-leg's localFrameAt /
 *      burnEffect — prograde means prograde around the leg's actual
 *      primary). A waypoint impulse that leaves the ship diving to a low
 *      perigee before boosting is exactly how a plotted mission cheaply
 *      amplifies v∞ — the Oberth pattern the old patched-conic release
 *      chain could not model.
 *   4. The flight ends at EARTH-SOI EXIT — the hand-off. Emit the ship's
 *      heliocentric state there (Frames.bodyHelioState lift, the same Earth
 *      model frozen-plan measures against, so the compliance comparison is
 *      apples-to-apples). The course check (frozen-plan, downstream)
 *      measures this INTEGRATED hand-off against the plan's window.
 *
 * A flight that never escapes (bound to the Moon or Earth) or that impacts
 * a body is a hard diagnostic: there is no hand-off to emit. The USER closes
 * the timing/energy loop — the course check reports the gap; fixing it means
 * adjusting the carriers, the waypoint impulses, or re-planning from the
 * Ephemeris tab. Nothing here ever solves backwards.
 *
 * Params:
 *   waypoints: [{ t, burn: { pro, rad, nrm } }] — up to 2 impulses, t in
 *     SECONDS after release (geo-leg's own leg-time convention; the I4 UI
 *     presents it however it likes), each strictly inside the flight as
 *     integrated so far. Burn axes are the local frame's at that point.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; `init` (the sidebar
 * cards) and `draw` (the polyline + gizmos/arrows) are the view hooks.
 *
 * Imports from ../../../Shared/, ../../core/ and ../frozen-plan/ — this
 * folder breaks if moved without them coming along.
 */
/* global THREE */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { evaluateChain } from "../../../Shared/kinematic-chain.js";
import { buildIntegratedLeg, stateAtLegTime, localFrameAt, burnEffect,
         moonGeoPos, SOI_MOON, SOI_EARTH } from "../../../Shared/geo-leg.js";
import { createWaypointGizmo, makeBurnArrow } from "../../../Shared/sim/burn-widget.js";
import { renderReadoutBoxes, positionReadoutBoxes } from "../../../Shared/sim/readout-panes.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { releaseAnchorFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;
var DAY = 86400;

// Burn-vector arrows: same physical scale (scene-units per km/s) and colours
// as the Moon-Skyhook/Mars-Phobos local views, which draw in the same
// Earth-Moon frame (1000 km per scene unit) this leg's samples already use.
var BURN_VEC_SCALE = 8;
var DV_COLOR = 0xff5fd0, DSPEED_COLOR = 0xffd24a;
var dvHex = "#ff5fd0", spdHex = "#ffd24a";
var GIZMO_PX = 42;   // matches the Ephemeris tab's own waypoint gizmos

export var defaultParams = {
	waypoints: []   // up to 2: { t (s after release), burn: { pro, rad, nrm } }
};

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

function burnMag(b) { b = b || {}; return Math.hypot(b.pro || 0, b.rad || 0, b.nrm || 0); }

// First outward crossing of radius `target` (m) by `samples` (geocentric),
// measuring |r| (measure = null) or distance to a moving body's position
// (measure = fn(sample, k) -> m). Returns the linearly-interpolated elapsed
// time (s), or null if never crossed.
function firstCrossing(samples, target, measure) {
	var prev = measure(samples[0]);
	for (var k = 1; k < samples.length; k++) {
		var cur = measure(samples[k]);
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
// { ok: true, samples, jd0, segs, wpVisuals, handoff, events, totalDv,
// vinfEarth } or { ok: false, diagnostic }. `samples` are geocentric
// { r, v, t } — TRUNCATED AT THE HAND-OFF (everything after Earth-SOI exit
// belongs to the coast); `segs` records each integrated piece's own leg
// record + the global time (s) it starts at. `wpVisuals` (task I4) is
// indexed by each waypoint's position in `params.waypoints` (NOT the
// chronological order used internally) — { renderPos, rLocal, vLocal, eff }
// per waypoint, the exact inputs the draw hook's gizmo/arrows/readout need,
// already evaluated in that waypoint's own local dynamical frame (geo-leg's
// localFrameAt/burnEffect). Exported for Node tests and the draw hook.
export function computeDepartureLeg(params, chainData, anchorJd) {
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

	// A bare base with no rotors can't release anything — "released" would
	// mean the base body's own state, which is degenerate for the integrator
	// (zero body-relative radius) and meaningless as a mission. This is also
	// I5's "removed the last carrier" state.
	var rotors = chainData.rotors || [];
	if (rotors.length === 0) {
		return { ok: false, diagnostic: makeDiagnostic("no-carrier",
			"The carrier chain has no releasing carrier — nothing sets the payload moving.",
			{ fix: "Add a carrier technology (e.g. the lunar skyhook) to the departure stack." }) };
	}

	// The released ship: the carrier chain composed at the anchor. The last
	// rotor's plane normal is the tech's own reference plane for any
	// Moon-bound piece's inclination (geo-leg's moonPlaneNormal parameter —
	// what the plotter measured against its skyhook's plane).
	var state = evaluateChain(chainData, anchorJd);
	var opts = rotors.length ? { moonPlaneNormal: O.vUnit(rotors[rotors.length - 1].normal) } : undefined;

	// Walk the impulse chain: integrate, cut at the next waypoint, apply the
	// impulse in the local frame there, integrate on.
	var segs = [];        // [{ leg, tStart (s, global), tEnd (s, global | null on the last) }]
	var samples = [];     // concatenated geocentric { r, v, t } — t global
	var wpVisuals = [];   // indexed by originalIndex — see the export comment above
	var events = [];
	var totalDv = 0;
	var tBase = 0;
	var r = state.r, v = state.v;

	for (var i = 0; i <= wps.length; i++) {
		var leg = buildIntegratedLeg(r, v, anchorJd + tBase / DAY, opts);
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

		// Append this piece's samples (global t), up to the cut.
		for (var k = (samples.length ? 1 : 0); k < leg.samples.length; k++) {
			var s = leg.samples[k];
			if (tCut !== null && s.t > tCut) { break; }
			samples.push({ r: s.r, v: s.v, t: tBase + s.t });
		}

		if (isLast) { break; }

		// The impulse, in the leg's own local dynamical frame — the SAME
		// frame the draw hook's gizmo orients to (task I4: "prograde" means
		// prograde around the leg's own primary at this point, gated on the
		// leg itself via leg.primary, not on proximity to a body).
		var at = stateAtLegTime(leg, tCut);
		samples.push({ r: at.r, v: at.v, t: wps[i].t });
		var frame = localFrameAt(at.r, at.jde, leg.primary);
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
			"The departure flight impacts the " + finalLeg.impact + " — no hand-off.",
			{ values: { impact: finalLeg.impact },
			  fix: "Adjust the release phase, the waypoint impulses, or the carrier geometry." }) };
	}
	if (finalLeg.primary !== "Sun" || !(finalLeg.vinfEarth > 0)) {
		var where = finalLeg.primary === "Moon" ? "the Moon" : "Earth";
		return { ok: false, diagnostic: makeDiagnostic("bound-no-handoff",
			"The flight stays bound to " + where + " — it never escapes to a hand-off.",
			{ values: { primary: finalLeg.primary },
			  fix: "Add speed: raise the release altitude, aim the release phase with the " +
			       "Moon's own motion, or boost at a waypoint (a low-perigee prograde " +
			       "impulse buys the most)." }) };
	}

	// The hand-off: first outward Earth-SOI crossing. The integrator ran on
	// to its natural 0.1 AU end, but everything past the SOI belongs to the
	// coast — truncate the flight there.
	var tSoi = firstCrossing(samples, SOI_EARTH,
		function (s) { return Math.hypot(s.r[0], s.r[1], s.r[2]); });
	if (tSoi === null) {   // escaping but capped before reaching the SOI — shouldn't happen
		return { ok: false, diagnostic: makeDiagnostic("no-soi-exit",
			"The flight escapes but never reached Earth's SOI within the integration budget.",
			{ values: { duration_d: (tBase + finalLeg.duration) / DAY } }) };
	}

	// Moon-SOI exit (an event mark, informational): first time the ship pulls
	// beyond the Moon's SOI. Uses each sample's own epoch for the Moon.
	var tMoonSoi = firstCrossing(samples, SOI_MOON, function (s) {
		var m = moonGeoPos(anchorJd + s.t / DAY);
		return Math.hypot(m[0] - s.r[0], m[1] - s.r[1], m[2] - s.r[2]);
	});

	// Exact hand-off state (re-derived from the final leg, not the truncated
	// sample list, for interpolation symmetry with stateAtLegTime).
	var lastSeg = segs[segs.length - 1];
	var handoffState = stateAtLegTime(lastSeg.leg, tSoi - lastSeg.tStart);
	var jdHandoff = anchorJd + tSoi / DAY;

	// Truncate the drawn flight at the hand-off.
	var cut = [];
	for (var c = 0; c < samples.length && samples[c].t <= tSoi; c++) { cut.push(samples[c]); }
	cut.push({ r: handoffState.r, v: handoffState.v, t: tSoi });

	events.unshift({ jd: anchorJd, label: "Release — carrier chain lets go" });
	if (tMoonSoi !== null && tMoonSoi < tSoi) {
		events.push({ jd: anchorJd + tMoonSoi / DAY, label: "Moon SOI exit" });
	}
	events.push({ jd: jdHandoff,
	              label: "Earth SOI exit — hand-off at v∞ " + (finalLeg.vinfEarth / 1000).toFixed(2) + " km/s" });
	events.sort(function (a, b) { return a.jd - b.jd; });

	return {
		ok: true, jd0: anchorJd,
		samples: cut, segs: segs, wpVisuals: wpVisuals,
		handoff: { r: handoffState.r, v: handoffState.v, jd: jdHandoff, tSoi: tSoi },
		vinfEarth: finalLeg.vinfEarth,
		events: events, totalDv: totalDv
	};
}

// Last computed flight per (World, stage) — the draw hook's and I4's data
// source (same WeakMap pattern as every module: N missions coexist, Worlds
// reuse stage ids).
var lastByWorld = new WeakMap();
export function legFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberLeg(world, stageId, leg) {
	if (!world || typeof world !== "object") { return; }   // a bare Node call
	                                                       // (ctx.world null) has no view to feed
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, leg);
}

export default {
	id: "departure-leg",
	title: "Departure leg",
	attachesTo: null,          // the flight is geocentric, not parented at a body
	accepts: ["carrier-chain"],
	emits: ["ship-state"],
	rendersIn: ["body:Earth-Moon"],
	// Still no title/status header (see header comment) — `init` (task I4)
	// only ever adds the waypoint-impulse cards + release readout; the
	// generic diagnostic boxes still render below whatever it builds.
	plainCard: true,

	update: function (ctx, input) {
		var params = Object.assign({}, defaultParams, ctx.params);

		// The read-only anchor. moon-platform diagnoses a missing one at the
		// top of the chain; this stage would be blocked before running then,
		// but it may also be exercised bare (tests), so it carries the check.
		var anchorJd = releaseAnchorFor(ctx.world);
		if (anchorJd === null) {
			rememberLeg(ctx.world, ctx.stageId, null);
			return makeDiagnostic("no-release-anchor",
				"This mission has no release anchor — no frozen flight plan (or legacy " +
				"release date) fixes when the carrier chain releases.",
				{ fix: "Start missions from the Ephemeris tab (Start Mission Plan bakes the anchor)." });
		}

		var leg = computeDepartureLeg(params, input.data, anchorJd);
		rememberLeg(ctx.world, ctx.stageId, leg);
		if (!leg.ok) { return leg.diagnostic; }

		var lifted = Frames.localToHelio("Earth", leg.handoff.jd, leg.handoff.r, leg.handoff.v);
		var packet = PacketTypes.make("ship-state",
			{ r: lifted.r, v: lifted.v, jd: leg.handoff.jd, frame: "helio", dvUsed: leg.totalDv },
			{ tool: "mission-planner/departure-leg", label: "hand-off (Earth SOI exit)",
			  iso: isoOf(leg.handoff.jd) });

		return { packet: packet, events: leg.events };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	// Task I4: up to 2 waypoint-impulse cards (the coast sidebar's stripped
	// per-waypoint pattern, transfer-leg.js's own init — but `t` here is
	// SECONDS after release, presented as hours since a departure flight
	// runs hours-to-days, not the coast's hundreds of days) plus a
	// release-point readout box. Burn Δv/plane-change/prograde-Δv readouts
	// use the SAME straddling-box mechanism the Ephemeris tab's waypoints do
	// (Shared/sim/readout-panes.js) — geo-leg's burnEffect (computeDepartureLeg,
	// stored per-waypoint in leg.wpVisuals) already returns exactly the shape
	// renderReadoutBoxes expects, so no separate readout-data function is
	// needed here the way the Ephemeris tab's own burnReadoutData is.
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

		// Vector editor widget (ported from SST)
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

		// The release-point readout: a straddling box (same mechanism as the
		// per-waypoint burn readouts below) anchored to this "release" row,
		// showing the flight's headline figures near where the release dot
		// actually sits in the Earth-Moon pane.
		var releaseHead = document.createElement("div"); releaseHead.className = "mp-wp-head";
		releaseHead.textContent = "release";
		host.appendChild(releaseHead);
		var releaseBox = null;   // { el, host } | null
		function updateReleaseBox(leg) {
			if (releaseBox) { ctx.readoutLayer.removeChild(releaseBox.el); releaseBox = null; }
			if (!ctx.readoutLayer || !leg) { return; }
			var box = document.createElement("div"); box.className = "mp-readout";
			box.innerHTML =
				'<div class="mp-readout-row"><span class="mp-readout-label">release</span>' +
				'<span class="mp-readout-val">' + isoOf(leg.jd0) + '</span></div>' +
				'<div class="mp-readout-row"><span class="mp-readout-label">hand-off v∞</span>' +
				'<span class="mp-readout-val">' + (leg.vinfEarth / 1000).toFixed(2) + ' km/s</span></div>' +
				'<div class="mp-readout-row"><span class="mp-readout-label">flight time</span>' +
				'<span class="mp-readout-val">' + (leg.handoff.tSoi / DAY).toFixed(2) + ' d</span></div>';
			ctx.readoutLayer.appendChild(box);
			releaseBox = { el: box, host: releaseHead };
		}

		var wpHost = document.createElement("div"); host.appendChild(wpHost);
		var burnReadoutBoxes = [];
		var wpRows = [];   // [{ burnHost }] — one per current waypoint, in param order

		function positionReadouts() {
			if (!ctx.readoutLayer) { return; }
			var all = burnReadoutBoxes.slice();
			if (releaseBox) { all.push(releaseBox); }
			positionReadoutBoxes(all, ctx.mainEl, ctx.panelEl);
		}
		if (ctx.panelEl) { ctx.panelEl.addEventListener("scroll", positionReadouts); }

		// setParam's recompute fires ctx.onResult SYNCHRONOUSLY, so whenever the
		// waypoint COUNT changes, wpRows must already reflect the new set of
		// cards before setParam runs — otherwise the recompute that carries the
		// new/removed waypoint's data lands against stale rows and its readout
		// box never appears until some unrelated later recompute. rebuild first,
		// commit second (updateReadouts() then re-syncs immediately after, so
		// the fresh rows aren't left showing stale data either).
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
		// Rebuilds against an explicit (not-yet-committed) waypoint list — the
		// add/remove handlers' own pre-commit call — falling back to reading
		// the world's stored params (rebuildWaypointRows itself, and the
		// initial build below).
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

	// The flight polyline in the Earth–Moon frame (geocentric — the frame's
	// own coordinates), release and hand-off dots, plus (task I4) each
	// waypoint's prograde/radial/normal gizmo and dV/prograde-speed-change
	// arrows. snap = { world, stageId, params, result }.
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

		// Constant-pixel dots: release (magenta, matching the skyhook's release
		// point) and the hand-off at Earth-SOI exit.
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

		// Waypoint gizmos (Shared/sim/burn-widget.js) + dV/prograde-speed-change
		// arrows, each oriented from its OWN local dynamical frame (computed once
		// in computeDepartureLeg, stored in leg.wpVisuals) rather than the plain
		// ecliptic-anchored frame createWaypointGizmo would derive from renderPos
		// alone — exactly the split its own header documents (render position vs.
		// burn-frame position can differ). Held at a constant on-screen size via
		// view.pxScaled, the shell's per-frame rescale hook (mission-view.js).
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
