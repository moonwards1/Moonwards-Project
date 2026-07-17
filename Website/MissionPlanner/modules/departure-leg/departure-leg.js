/* MissionPlanner/modules/departure-leg — the integrated geocentric flight
 * from carrier release to the Departure→Coast hand-off (task I3, WP-I's
 * heart; absorbs F5's departure half).
 *
 * HEADLESS by design (Kim: "the departure leg includes everything that leads
 * up to the hand-off, so there is no point in having that be a card") — no
 * sidebar card of its own (`plainCard`, no init: the card body stays empty
 * and only the shell's generic diagnostic boxes ever show in it). Its
 * visible output is the drawn trajectory polyline in the Earth–Moon frame,
 * its flight events (release, waypoint impulses, SOI exits — the departure
 * slider's real marks at last), and — task I4 — the release-point tooltip
 * and per-waypoint impulse cards.
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
 * update() is pure (no DOM, no THREE) and Node-testable; `draw` (the
 * polyline) is the one view hook.
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
import { makeDiagnostic } from "../../core/diagnostics.js";
import { releaseAnchorFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;
var DAY = 86400;

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
// { ok: true, samples, jd0, segs, handoff, events, totalDv, vinfEarth }
// or { ok: false, diagnostic }. `samples` are geocentric { r, v, t } —
// TRUNCATED AT THE HAND-OFF (everything after Earth-SOI exit belongs to the
// coast); `segs` records each integrated piece's own leg record + the global
// time (s) it starts at, so I4's gizmos can re-derive states along the
// flight. Exported for Node tests and the draw hook.
export function computeDepartureLeg(params, chainData, anchorJd) {
	var wps = (params.waypoints || []).slice().sort(function (a, b) { return a.t - b.t; });
	if (wps.length > 2) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The departure leg supports at most 2 waypoint impulses.",
			{ values: { count: wps.length } }) };
	}
	for (var w = 0; w < wps.length; w++) {
		if (!(isFinite(wps[w].t) && wps[w].t > 0)) {
			return { ok: false, diagnostic: makeDiagnostic("bad-params",
				"Waypoint " + (w + 1) + " needs a positive time after release.",
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
				"Waypoint " + (i + 1) + " at " + ((wps[i].t) / 3600).toFixed(1) +
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

		// The impulse, in the leg's own local dynamical frame.
		var at = stateAtLegTime(leg, tCut);
		samples.push({ r: at.r, v: at.v, t: wps[i].t });
		var frame = localFrameAt(at.r, at.jde, leg.primary);
		var eff = burnEffect(frame.GM,
			O.vSub(at.r, frame.originR), O.vSub(at.v, frame.originV), {
				pro: wps[i].burn && wps[i].burn.pro || 0,
				rad: wps[i].burn && wps[i].burn.rad || 0,
				nrm: wps[i].burn && wps[i].burn.nrm || 0
			});
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
		samples: cut, segs: segs,
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
	// Headless (see header): no title/status header, no init — the generic
	// card renders as an empty box that only ever shows diagnostics.
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

	// The flight polyline in the Earth–Moon frame (geocentric — the frame's
	// own coordinates), release and hand-off dots. snap = { world, stageId,
	// params, result }.
	draw: function (view, snap) {
		while (view.group.children.length) {
			var c = view.group.children[0];
			view.group.remove(c);
			if (c.geometry) { c.geometry.dispose(); }
			if (c.material) { c.material.dispose(); }
		}
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
	}
};
