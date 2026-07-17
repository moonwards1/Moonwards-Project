/* MissionPlanner/modules/transfer-leg — the canonical transfer-leg module.
 *
 * The Coast phase: a ballistic arc between two ship states, with up to two
 * waypoint burns along the way — the compute core of the
 * Solar-System-Trajectory-Plotter's `computeTrajectory()`, re-hosted behind
 * the module contract. "Two" is this phase's current UI choice (how many
 * waypoint cards fit the sidebar today), not an architectural ceiling — see
 * ARCHITECTURE.md's "Phases are chains; compliance is a boundary check, not
 * a reconciliation": a phase is any length of ordinary stage chain, and
 * Departure/Arrival could each grow their own multi-stage chains (WP-F, H2)
 * the same way. The plotter's snap-to and Lambert targeting are NOT here
 * yet — they come across when the marker/targeting UI ports (migration-path
 * step 4.5).
 *
 * Consumes a ship-state packet (any frame — converted to "helio" via
 * Shared/frames.js) AS THE COAST'S STARTING STATE, unmodified — no burn of
 * its own happens at that seam (removed 2026-07-14, Kim: "only a minority
 * of the delta-v needed to get somewhere comes from engine burns," so the
 * Departure→Coast handoff is a given heading and speed, not a burn formula
 * applied to some baseline. Whatever put the ship there — a departure
 * tech's release physics, a chain of burns upstream, anything — is that
 * upstream stage's business; transfer-leg just coasts from where it's
 * handed off). The two WAYPOINT burns are real, though — genuine mid-course
 * corrections during Coast — and stay. By the same reasoning the ship's
 * heading and speed at the END of Coast is likewise just the resultant of
 * that starting state plus whatever waypoint burns happened along the way —
 * nothing at the Coast→Arrival seam needs a burn concept either; a future
 * Arrival module would simply consume `leg.end` as its own input, the same
 * way this module consumes its own upstream packet.
 *
 * If a destination body is set, the miss distance at arrival is reported
 * through the envelope's WARNINGS channel — non-blocking, per the core's
 * comply-mode refinement: a leg that misses Ceres is a diagnosed mission,
 * not a blank screen.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; `init` (sidebar
 * card) and `draw` (trajectory polyline in the "helio" frame) are the
 * browser-only view hooks.
 *
 * Imports from ../../../Shared/ and ../../core/ — this folder breaks if
 * moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { makeShipSprite } from "../../../Shared/sim/marker-card.js";

var O = OrbitalMath;
var SUN = systems.get("Sun");
var GM_SUN = SUN.GM;
var AU = 149597870700;   // m
var DAY = 86400;

// Bodies offered as leg destinations (a subset of the plotter's list).
export var DESTINATIONS = ["Venus", "Earth", "Mars", "Ceres", "Vesta", "Psyche",
	"Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

// Warn when the leg ends farther than this from the destination body.
export var MISS_WARN_AU = 0.02;

export var defaultParams = {
	waypoints: [],                       // up to 2: { days, burn: {pro,rad,nrm} }
	legDays: 480,                        // duration from leg start to the emitted state
	destination: ""                      // body name, or "" for none
};

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

function burnMag(b) { return Math.hypot(b.pro || 0, b.rad || 0, b.nrm || 0); }

// The segment chain, pure. `data` is a helio-frame ship-state payload.
// Returns { ok: true, samples, end, events, totalDv, miss } or
// { ok: false, diagnostic }. Exported for Node tests and the card readouts.
export function computeLeg(params, data) {
	var p = params;
	if (!(isFinite(p.legDays) && p.legDays > 0)) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The leg needs a positive duration.", { values: { legDays: p.legDays } }) };
	}
	var wps = (p.waypoints || []).slice().sort(function (a, b) { return a.days - b.days; });
	for (var w = 0; w < wps.length; w++) {
		if (!(isFinite(wps[w].days) && wps[w].days > 0 && wps[w].days < p.legDays)) {
			return { ok: false, diagnostic: makeDiagnostic("waypoint-outside-leg",
				"Waypoint " + (w + 1) + " at day " + wps[w].days +
				" falls outside the leg (0 – " + p.legDays + " days).",
				{ values: { days: wps[w].days, legDays: p.legDays },
				  fix: "Move the waypoint inside the leg, or lengthen the leg." }) };
		}
	}

	var jd0 = data.jd;
	var r = data.r.slice();
	var v = data.v.slice();   // the coast's own starting state — no burn at this seam (see header)
	var totalDv = 0;
	var events = [];

	// Walk the chain: each segment ends at the next waypoint (burn applied
	// there), the last at legDays. Samples accumulate for the drawn polyline;
	// segs keeps each segment's own starting state (r0/v0 — the coast's own
	// start for the first segment, post-waypoint-burn for the rest) and
	// [tStart, tStart+dur) window so stateAtElapsed() below can re-propagate
	// the EXACT state (with velocity, which the polyline samples don't carry)
	// at any point along the leg — the ship-marker chevron's position source.
	var samples = [];
	var segs = [];
	var tPrev = 0;   // days since jd0
	var bounds = wps.map(function (wp) { return wp.days; }).concat([p.legDays]);
	for (var seg = 0; seg < bounds.length; seg++) {
		var durS = (bounds[seg] - tPrev) * DAY;
		segs.push({ r0: r, v0: v, tStart: tPrev * DAY, dur: durS });
		var arc = O.sampleArc(GM_SUN, r, v, durS, seg === bounds.length - 1 ? 200 : 120);
		for (var k = (seg > 0 ? 1 : 0); k < arc.length; k++) {
			samples.push({ r: arc[k].r, t: tPrev * DAY + arc[k].t });
		}
		var endState = O.propagateState(GM_SUN, r, v, durS);
		r = endState.r; v = endState.v;
		tPrev = bounds[seg];
		if (seg < wps.length) {
			var wb = wps[seg].burn || { pro: 0, rad: 0, nrm: 0 };
			var mag = burnMag(wb);
			totalDv += mag;
			events.push({ jd: jd0 + wps[seg].days,
			              label: "Waypoint impulse — " + (mag / 1000).toFixed(2) + " km/s" });
			v = O.applyBurn(r, v, wb.pro || 0, wb.nrm || 0, wb.rad || 0);
		}
	}

	var jdEnd = jd0 + p.legDays;
	var miss = null;
	if (p.destination && systems.get(p.destination)) {
		var dest = O.bodyStateAtJD(GM_SUN, systems.get(p.destination).orbit, jdEnd);
		miss = O.vMag(O.vSub(r, dest.r)) / AU;
		events.push({ jd: jdEnd, label: "Leg ends — " + miss.toFixed(3) + " AU from " + p.destination });
	} else {
		events.push({ jd: jdEnd, label: "Leg ends" });
	}

	return { ok: true, jd0: jd0, samples: samples, segs: segs, end: { r: r, v: v, jd: jdEnd },
	         events: events, totalDv: totalDv, miss: miss };
}

// Heliocentric state (r, v in m, m/s) at elapsed time t (s) since the leg's
// own start (jd0) -- TRUE two-body propagation per segment, matching the
// Solar-System-Trajectory-Plotter's stateAtGlobalTime (Shared/sim/
// marker-card.js's doc comment). Unlike `samples` (dense polyline points,
// position only), this gives velocity too and isn't limited to sample
// resolution -- the ship-marker chevron's position/orientation source.
// Clamps into the nearest segment at either end (t<0 sits at the leg start,
// t>legDays*DAY at its end), so a clock outside the leg's own span still
// resolves to a sensible pinned state rather than null.
export function stateAtElapsed(leg, t) {
	if (!leg || !leg.segs || !leg.segs.length) { return null; }
	var segs = leg.segs;
	var seg = segs[segs.length - 1];
	for (var i = 0; i < segs.length; i++) {
		if (t <= segs[i].tStart + segs[i].dur + 1e-6) { seg = segs[i]; break; }
	}
	var dt = Math.max(0, Math.min(seg.dur, t - seg.tStart));
	return O.propagateState(GM_SUN, seg.r0, seg.v0, dt);
}

// Last computed leg per (World, stage), for the card readouts and the
// polyline. Keyed by World first because N missions coexist (task A1) and
// their Worlds reuse stage ids like "stg-2" — a stageId-only cache would let
// one mission's recompute clobber another's drawn leg. WeakMap, so a closed
// mission's entries go with its World.
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
	id: "transfer-leg",
	title: "Transfer leg",
	attachesTo: null,
	accepts: ["ship-state"],
	emits: ["ship-state"],
	rendersIn: ["helio"],
	// No title/status header on the sidebar card (Kim, 2026-07-13): the
	// Coast sidebar shows just the waypoint cards + add button (see init).
	// Warnings/diagnostics still render in the card via the generic boxes.
	plainCard: true,

	update: function (ctx, input) {
		var params = Object.assign({}, defaultParams, ctx.params);
		var data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");

		var leg = computeLeg(params, data);
		rememberLeg(ctx.world, ctx.stageId, leg);
		if (!leg.ok) { return leg.diagnostic; }

		var packet = PacketTypes.make("ship-state",
			{ r: leg.end.r, v: leg.end.v, jd: leg.end.jd, frame: "helio",
			  dvUsed: (data.dvUsed || 0) + leg.totalDv },
			{ tool: "mission-planner/transfer-leg", label: "leg end", iso: isoOf(leg.end.jd) });

		var warnings = [];
		if (leg.miss !== null && leg.miss > MISS_WARN_AU) {
			warnings.push(makeDiagnostic("misses-destination",
				"The leg ends " + leg.miss.toFixed(3) + " AU from " + params.destination +
				" (within " + MISS_WARN_AU + " AU counts as arrival).",
				{ values: { missAU: leg.miss, destination: params.destination },
				  fix: "Adjust the waypoint impulses, the leg duration, or whatever delivers the coast's starting state." }));
		}

		return { packet: packet, warnings: warnings, events: leg.events };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	// Sidebar card, reshaped per Kim (2026-07-13) for the frozen-mission
	// flow: ONLY the waypoint burns live here — one small card per existing
	// waypoint plus the add button (capped at 2). The old departure-burn /
	// leg-duration / destination fields and the readout rows are gone: since
	// E2's post-burn hand-off those are the frozen plan's business (the
	// injection is the departure tech's job, the duration and destination
	// are the plan's commitment), not knobs to twiddle on the coast — the
	// plan's figures render in the phase bar instead. The stage also opts
	// out of the generic title/status header (`plainCard` below); the leg's
	// warnings and diagnostics still render underneath via the generic diag
	// boxes.

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
			var u = document.createElement("span"); u.className = "mp-unit"; u.textContent = unit;
			wrap.appendChild(u); row.appendChild(wrap); parent.appendChild(row);
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

		var wpHost = document.createElement("div"); host.appendChild(wpHost);
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
					setParam("waypoints", list);
					rebuildWaypointRows();
				});
				head.appendChild(del); card.appendChild(head);
				numRow(card, "at day", "", wp.days, 5, function (v) {
					var list = stageParams().waypoints.slice(); list[i].days = v;
					setParam("waypoints", list);
				});
				var burnHost = document.createElement("div"); card.appendChild(burnHost);
				buildVectorEditor(burnHost, wp.burn, function (axis, mps) {
					var list = stageParams().waypoints.slice(); list[i].burn[axis] = mps;
					setParam("waypoints", list);
				});
				wpHost.appendChild(card);
			});
			if (wps.length < 2) {
				var add = document.createElement("button"); add.className = "mp-btn mp-ghost";
				add.textContent = "+ add waypoint";
				add.addEventListener("click", function () {
					var list = stageParams().waypoints.slice();
					var half = Math.round(stageParams().legDays / 2);
					list.push({ days: list.length ? Math.min(list[0].days + 60, stageParams().legDays - 10) : half,
					            burn: { pro: 0, rad: 0, nrm: 0 } });
					setParam("waypoints", list);
					rebuildWaypointRows();
				});
				wpHost.appendChild(add);
			}
		}
		rebuildWaypointRows();
	},

	// Trajectory polyline in the heliocentric frame. snap = { world, stageId,
	// params, result }.
	draw: function (view, snap) {
		while (view.group.children.length) {
			var c = view.group.children[0];
			view.group.remove(c);
			if (c.geometry) { c.geometry.dispose(); }
			if (c.material) { c.material.dispose(); }
			if (c.material && c.material.map) { c.material.map.dispose(); }
		}
		var leg = legFor(snap.world, snap.stageId);
		if (!leg || !leg.ok || snap.result.status !== "ok") { view.chevron = null; return; }
		var U = view.metresPerUnit;

		var pts = leg.samples.map(function (s) {
			return new THREE.Vector3(s.r[0] / U, s.r[1] / U, s.r[2] / U);
		});
		view.group.add(new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineBasicMaterial({ color: 0x66f0ff })));

		// Constant-pixel dots: leg start (release) and leg end.
		function dot(rM, colorHex, sizePx) {
			var g = new THREE.BufferGeometry();
			g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
				rM[0] / U, rM[1] / U, rM[2] / U]), 3));
			return new THREE.Points(g, new THREE.PointsMaterial({
				color: colorHex, size: sizePx, sizeAttenuation: false,
				transparent: true, depthTest: false }));
		}
		if (leg.samples.length) { view.group.add(dot(leg.samples[0].r, 0xff5fd0, 6)); }
		view.group.add(dot(leg.end.r, 0xe8ecf5, 6));

		// Destination position at arrival, if one is set — the "how far off
		// are we" mark the warning talks about.
		var params = Object.assign({}, defaultParams, snap.params);
		if (params.destination && systems.get(params.destination)) {
			var dest = O.bodyStateAtJD(GM_SUN, systems.get(params.destination).orbit, leg.end.jd);
			view.group.add(dot(dest.r, 0xe0a84a, 8));
		}

		// The ship-marker chevron (ported from the Ephemeris tab's marker —
		// Shared/sim/marker-card.js's makeShipSprite/orientMarkerSprite):
		// unlike the Ephemeris marker's own slider, this one has no state of
		// its own — its position is simply wherever the shared mission clock
		// (snap.world.jd) currently sits along the leg, via stateAtElapsed's
		// exact two-body re-propagation (samples alone don't carry velocity,
		// which the chevron needs to orient along the direction of travel).
		// Recreated fresh every draw() alongside everything else in the
		// group; view.chevron is a stable reference the shell's render loop
		// re-reads every animation frame to keep the sprite screen-facing as
		// the camera moves (orientMarkerSprite needs the live camera, which
		// draw() itself is never called with).
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
