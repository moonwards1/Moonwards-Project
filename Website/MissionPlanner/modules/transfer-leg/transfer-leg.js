/* MissionPlanner/modules/transfer-leg — the canonical transfer-leg module.
 *
 * The Coast phase: a ballistic arc between two ship states, with up to two
 * waypoint burns along the way — the compute core of the
 * Solar-System-Trajectory-Plotter's `computeTrajectory()`, re-hosted behind
 * the module contract, EXTENDED (2026-07-18) with real SOI encounters: where
 * the arc dips inside any body's sphere of influence the flight switches to
 * Shared/body-leg.js's body+Sun integration and resumes Kepler at exit, so a
 * close pass genuinely bends and a rendezvous can be set up against the
 * body's own gravity (see the encounter block below). "Two" is this phase's current UI choice (how many
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
import { buildVectorEditor } from "../../../Shared/sim/vector-editor.js";
import { bodyConstants, integrateEncounter, stateAtLegTime } from "../../../Shared/body-leg.js";

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

// ---- SOI encounters (2026-07-18, Kim: "the gravity of the body is
// absolutely critical, it isn't possible to set up rendezvous without it.
// Revise the code to include it for all bodies") -----------------------------
//
// The coast is Sun-only Kepler EXCEPT where it dips inside a body's sphere
// of influence: there the flight switches to Shared/body-leg.js's real
// body + Sun integration (integrateEncounter — same RK4 and indirect term
// the departure legs use, so a close approach genuinely bends) and resumes
// Kepler at SOI exit. "All bodies" is literal: every `systems` entry with a
// heliocentric orbit and a mass, no per-body special cases (the project's
// body convention).

// Every body the coast can feel: built once from `systems`, not hardcoded.
var GRAVITY_BODIES = [];
systems.forEach(function (sys, name) {
	if (name !== "Sun" && sys.orbit && sys.orbit.system === SUN &&
	    isFinite(sys.mass) && sys.GM) { GRAVITY_BODIES.push(name); }
});

function bodyPosAt(name, jd) { return O.bodyStateAtJD(GM_SUN, systems.get(name).orbit, jd).r; }

// Find the FIRST SOI entry along the Kepler arc from (r, v) at absolute
// Julian date jdAbs over the next `durS` seconds, against every gravity
// body. Returns { body, tEnter } (seconds from the arc start; 0 for "starts
// inside") or null. Coarse grid scan (the approach to any SOI rides a
// weeks-wide distance dip, so grid-scale local minima can't miss it) with
// ternary-search refinement of each candidate minimum and a bisected
// SOI-crossing time.
//
// `insideBody`: the body whose SOI the walk is CURRENTLY inside because the
// previous stretch ended mid-encounter (a waypoint burn inside the SOI, or
// the overrun continuing a leg that ends there) — that encounter resumes
// immediately. Any OTHER body the arc merely STARTS inside of is the
// patched-conic departure case (the plan's frozen hand-off states live at
// the origin body's own position with v∞ folded in — see frozen-plan) and
// its gravity belongs to the departure stage, not the coast: that body is
// ignored until the arc has first LEFT its SOI.
function findFirstEncounter(r, v, jdAbs, durS, insideBody) {
	if (insideBody) {
		var ci = bodyConstants(insideBody);
		var di = O.vMag(O.vSub(r, bodyPosAt(insideBody, jdAbs)));
		if (di < ci.SOI) { return { body: insideBody, tEnter: 0 }; }
	}
	// Radial-band prefilter: a body whose orbit (± SOI) never overlaps the
	// arc's own radial range can't be met. The osculating q/Q overstate the
	// windowed arc's range — that only admits extra candidates, never drops
	// a real one.
	var el = O.elementsFromState(GM_SUN, r, v);
	var qs = el.a * (1 - el.e), Qs = el.e < 1 ? el.a * (1 + el.e) : Infinity;
	var candidates = GRAVITY_BODIES.filter(function (name) {
		var c = bodyConstants(name), orb = systems.get(name).orbit;
		var qb = (orb.periapsis || c.aHelio) - c.SOI, Qb = (orb.apoapsis || c.aHelio) + c.SOI;
		return qs <= Qb && Qs >= qb;
	});
	if (!candidates.length) { return null; }

	function distTo(name, t) {
		var s = O.propagateState(GM_SUN, r, v, t);
		return O.vMag(O.vSub(s.r, bodyPosAt(name, jdAbs + t / DAY)));
	}

	// Coarse grid: >= 1-day spacing floor, ~3-day spacing on a long leg.
	var N = Math.max(8, Math.min(240, Math.round(durS / DAY)));
	var best = null;   // earliest { body, tEnter }
	candidates.forEach(function (name) {
		var c = bodyConstants(name);
		var d = new Array(N + 1);
		for (var i = 0; i <= N; i++) { d[i] = distTo(name, durS * i / N); }
		var spacing = durS / N;
		var refineBound = c.SOI + spacing * 6e4;   // grid offset at <= 60 km/s relative speed
		// Patched-conic start (see header): scan only after first leaving
		// this body's SOI if the arc begins inside it.
		var iFirst = 1;
		if (d[0] < c.SOI) {
			while (iFirst <= N && d[iFirst] < c.SOI) { iFirst++; }
			iFirst++;   // the exit sample itself can't be an entry minimum
		}
		for (var i = iFirst; i <= N; i++) {
			var isMin = (i < N) ? (d[i] <= d[i - 1] && d[i] <= d[i + 1])
			                    : (d[i] < d[i - 1] && d[i] < c.SOI);   // dip still falling at the window end
			if (!isMin || d[i] > refineBound) { continue; }
			var lo = spacing * (i - 1), hi = Math.min(durS, spacing * (i + 1));
			for (var k = 0; k < 60; k++) {   // ternary search for the true minimum
				var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
				if (distTo(name, m1) <= distTo(name, m2)) { hi = m2; } else { lo = m1; }
			}
			var tMin = (lo + hi) / 2;
			if (distTo(name, tMin) >= c.SOI) { continue; }
			// Bisect the SOI crossing on [last grid point outside, tMin].
			var a = spacing * (i - 1), b = tMin;
			if (distTo(name, a) <= c.SOI) { a = 0; }
			for (var k2 = 0; k2 < 60; k2++) {
				var mid = (a + b) / 2;
				if (distTo(name, mid) > c.SOI) { a = mid; } else { b = mid; }
			}
			if (!best || b < best.tEnter) { best = { body: name, tEnter: b }; }
		}
	});
	return best;
}

// One burn-free coast stretch of `durS` seconds from (r, v) at jdAbs:
// Kepler arcs stitched with integrated SOI encounters. Appends samples
// ({ r (helio, m), t (s since leg start) }), typed segs, and events to
// `out`; returns { r, v, tEnd, impact, insideBody } — `insideBody` names
// the body whose SOI the stretch ENDS inside (mid-encounter at a waypoint
// or the leg boundary), for the next stretch to resume. `tStart` is
// seconds since leg start. When `out.quiet` is set (the display-only
// overrun) no segs or events are recorded.
function coastStretch(r, v, jdAbs, tStart, durS, out, insideBody) {
	var remaining = durS, t0 = tStart;
	for (var guard = 0; guard < 12 && remaining > 1; guard++) {
		var enc = findFirstEncounter(r, v, jdAbs, remaining, insideBody);
		insideBody = null;   // only ever applies to the stretch's own start
		var kepDur = enc ? enc.tEnter : remaining;
		if (kepDur > 1) {
			if (!out.quiet) { out.segs.push({ type: "kepler", r0: r, v0: v, tStart: t0, dur: kepDur }); }
			var n = Math.max(60, Math.min(240, Math.round(kepDur / DAY * 0.5)));
			var arc = O.sampleArc(GM_SUN, r, v, kepDur, n);
			for (var k = (out.samples.length ? 1 : 0); k < arc.length; k++) {
				out.samples.push({ r: arc[k].r, t: t0 + arc[k].t });
			}
			var st = O.propagateState(GM_SUN, r, v, kepDur);
			r = st.r; v = st.v;
			t0 += kepDur; jdAbs += kepDur / DAY; remaining -= kepDur;
		}
		if (!enc) { break; }

		var res = integrateEncounter(enc.body, r, v, jdAbs, remaining);
		var c = bodyConstants(enc.body);
		if (!out.quiet) {
			out.segs.push({ type: "enc", body: enc.body,
			                leg: { samples: res.samples, jde0: jdAbs },
			                tStart: t0, dur: res.duration });
			if (enc.tEnter > 0) {   // a resumed encounter already announced itself
				out.events.push({ jd: jdAbs, label: enc.body + " SOI entry — " +
					(res.vinf != null ? "v∞ " + (res.vinf / 1000).toFixed(2) + " km/s" : "bound") });
			}
			// Closest approach, from the integrated trail (surface altitude).
			var iMin = 0;
			for (var si = 1; si < res.samples.length; si++) {
				if (O.vMag(res.samples[si].r) < O.vMag(res.samples[iMin].r)) { iMin = si; }
			}
			out.events.push({ jd: jdAbs + res.samples[iMin].t / DAY,
				label: enc.body + " closest approach — " + Fmt3(res.rmin - c.R) + " km" });
		}
		// Lift the body-centred trail to helio samples (decimated to keep the
		// polyline light; the seg keeps the full trail for stateAtElapsed).
		var stride = Math.max(1, Math.floor(res.samples.length / 400));
		var lastIdx = res.samples.length - 1;
		for (var si2 = 1; si2 <= lastIdx; si2 += stride) {
			var idx = (si2 + stride > lastIdx) ? lastIdx : si2;   // never skip the exit point
			var s = res.samples[idx];
			out.samples.push({ r: O.vAdd(s.r, bodyPosAt(enc.body, jdAbs + s.t / DAY)),
			                   t: t0 + s.t });
			if (idx === lastIdx) { break; }
		}
		r = res.end.r; v = res.end.v;
		t0 += res.duration; jdAbs += res.duration / DAY; remaining -= res.duration;
		if (res.branch === "entry") {
			if (!out.quiet) {
				out.events.push({ jd: jdAbs, label: "Impacts " + enc.body + " — " +
					(res.entry.v / 1000).toFixed(2) + " km/s" });
			}
			return { r: r, v: v, tEnd: t0, impact: { body: enc.body, jd: jdAbs, entry: res.entry },
			         insideBody: null };
		}
		if (res.branch === "time") {   // stretch boundary reached still inside the SOI
			return { r: r, v: v, tEnd: t0, impact: null, insideBody: enc.body };
		}
		if (!out.quiet) { out.events.push({ jd: jdAbs, label: enc.body + " SOI exit" }); }
	}
	return { r: r, v: v, tEnd: t0, impact: null, insideBody: null };
}

function Fmt3(m) {   // metres -> "12,345" km
	return Math.round(m / 1000).toLocaleString("en-US");
}

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

	// Walk the chain: one coast stretch to each waypoint (burn applied
	// there), the last to legDays. Each stretch is Kepler EXCEPT inside a
	// body's SOI, where coastStretch switches to the real body+Sun
	// integration (see the encounter block above). `samples` accumulate for
	// the drawn polyline; `segs` (typed "kepler" | "enc") let
	// stateAtElapsed() below recover the EXACT state — with velocity, which
	// the polyline samples don't carry — at any point along the leg: the
	// ship-marker chevron's position source.
	var out = { samples: [], segs: [], events: [] };
	var tPrev = 0;   // days since jd0
	var impact = null, inside = null;
	var bounds = wps.map(function (wp) { return wp.days; }).concat([p.legDays]);
	for (var seg = 0; seg < bounds.length && !impact; seg++) {
		var res = coastStretch(r, v, jd0 + tPrev, tPrev * DAY, (bounds[seg] - tPrev) * DAY, out, inside);
		r = res.r; v = res.v;
		impact = res.impact;
		inside = res.insideBody;
		tPrev = bounds[seg];
		if (!impact && seg < wps.length) {
			var wb = wps[seg].burn || { pro: 0, rad: 0, nrm: 0 };
			var mag = burnMag(wb);
			totalDv += mag;
			out.events.push({ jd: jd0 + wps[seg].days,
			                  label: "Waypoint impulse — " + (mag / 1000).toFixed(2) + " km/s" });
			v = O.applyBurn(r, v, wb.pro || 0, wb.nrm || 0, wb.rad || 0);
		}
	}

	var jdEnd = impact ? impact.jd : jd0 + p.legDays;
	var miss = null;
	if (impact) {
		// The walk stopped at the surface; the leg has no coast state past it.
	} else if (p.destination && systems.get(p.destination)) {
		var dest = O.bodyStateAtJD(GM_SUN, systems.get(p.destination).orbit, jdEnd);
		miss = O.vMag(O.vSub(r, dest.r)) / AU;
		out.events.push({ jd: jdEnd, label: "Leg ends — " + miss.toFixed(3) + " AU from " + p.destination });
	} else {
		out.events.push({ jd: jdEnd, label: "Leg ends" });
	}

	// Display-only OVERRUN (2026-07-18, Kim): the drawn path continues dimmer
	// past the leg's own end, long enough to convey the trajectory PAST the
	// destination — the leg is a section snipped from a longer flight, and the
	// snip shouldn't hide the pass. Runs through the same coastStretch (so a
	// rendezvous encounter in progress at leg end completes on screen); the
	// EMITTED end state is untouched — phases stay chains, the hand-off stays
	// at legDays.
	var overrun = [];
	if (!impact) {
		var overrunDays = Math.min(60, Math.max(15, Math.round(p.legDays * 0.1)));
		var over = { samples: overrun, segs: [], events: [], quiet: true };
		coastStretch(r, v, jd0 + p.legDays, p.legDays * DAY, overrunDays * DAY, over, inside);
	}

	return { ok: true, jd0: jd0, samples: out.samples, segs: out.segs,
	         end: { r: r, v: v, jd: jdEnd }, impact: impact, overrun: overrun,
	         events: out.events, totalDv: totalDv, miss: miss };
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
	if (seg.type === "enc") {
		// Inside an SOI encounter: interpolate the integrated body-centred
		// trail (geo-leg's stateAtLegTime) and lift to helio at that instant.
		var s = stateAtLegTime(seg.leg, dt);
		var b = O.bodyStateAtJD(GM_SUN, systems.get(seg.body).orbit, s.jde);
		return { r: O.vAdd(s.r, b.r), v: O.vAdd(s.v, b.v) };
	}
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
		if (leg.impact) {
			warnings.push(makeDiagnostic("impacts-body",
				"The coast impacts " + leg.impact.body + " on " + isoOf(leg.impact.jd) +
				" at " + (leg.impact.entry.v / 1000).toFixed(2) + " km/s.",
				{ values: { body: leg.impact.body, jd: leg.impact.jd },
				  fix: "Adjust the waypoint impulses or the upstream hand-off to raise the pass." }));
		}
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

		// The display-only overrun: the path continued dimmer past the leg's
		// own end, so the pass by the destination reads as a pass (see
		// computeLeg's overrun block).
		if (leg.overrun && leg.overrun.length > 1) {
			var opts = leg.overrun.map(function (s) {
				return new THREE.Vector3(s.r[0] / U, s.r[1] / U, s.r[2] / U);
			});
			view.group.add(new THREE.Line(
				new THREE.BufferGeometry().setFromPoints(opts),
				new THREE.LineBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.3 })));
		}

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
