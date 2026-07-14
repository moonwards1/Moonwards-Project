/* MissionPlanner/modules/transfer-leg — the canonical transfer-leg module.
 *
 * A coast + burns arc between two ship states: the compute core of the
 * Solar-System-Trajectory-Plotter's `computeTrajectory()` (departure burn →
 * up to two waypoint burns → final coast, all analytic two-body work),
 * re-hosted behind the module contract. The plotter's snap-to and Lambert
 * targeting are NOT here yet — they come across when the marker/targeting UI
 * ports (migration-path step 4.5); this is the manual-burns chain.
 *
 * Consumes a ship-state packet (any frame — converted to "helio" via
 * Shared/frames.js), applies its burns, and emits the ship-state at the end
 * of the leg. If a destination body is set, the miss distance at arrival is
 * reported through the envelope's WARNINGS channel — non-blocking, per the
 * core's comply-mode refinement: a leg that misses Ceres is a diagnosed
 * mission, not a blank screen.
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
	burn: { pro: 0, rad: 0, nrm: 0 },   // m/s, departure burn on the incoming state
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
	var v = O.applyBurn(data.r, data.v, p.burn.pro || 0, p.burn.nrm || 0, p.burn.rad || 0);
	var totalDv = burnMag(p.burn);
	var events = [];
	if (totalDv >= 1) {
		events.push({ jd: jd0, label: "Departure burn — " + (totalDv / 1000).toFixed(2) + " km/s" });
	}

	// Walk the chain: each segment ends at the next waypoint (burn applied
	// there), the last at legDays. Samples accumulate for the drawn polyline;
	// segs keeps each segment's own starting state (r0/v0, post-burn) and
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
			              label: "Waypoint burn — " + (mag / 1000).toFixed(2) + " km/s" });
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
				  fix: "Adjust the departure or waypoint burns, the leg duration, or the release date." }));
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
			var p = Object.assign({}, defaultParams, stage ? stage.params : {});
			p.burn = Object.assign({ pro: 0, rad: 0, nrm: 0 }, p.burn);
			return p;
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
				["pro", "rad", "nrm"].forEach(function (axis) {
					numRow(card, axis, "km/s", (wp.burn[axis] || 0) / 1000, 0.05, function (v) {
						var list = stageParams().waypoints.slice(); list[i].burn[axis] = v * 1000;
						setParam("waypoints", list);
					});
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
