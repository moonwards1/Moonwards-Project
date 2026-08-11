/* MissionPlanner/modules/transfer-leg — the canonical transfer-leg module.
 *
 * The Coast phase: a ballistic arc between two ship states, with up to two
 * waypoint burns along the way — the compute core of the
 * Solar-System-Trajectory-Plotter's `computeTrajectory()`, re-hosted behind
 * the module contract and extended with real SOI encounters: where the arc
 * dips inside any body's sphere of influence the flight switches to
 * Shared/body-leg.js's body+Sun integration and resumes Kepler at exit, so a
 * close pass genuinely bends and a rendezvous can be set up against the body's
 * own gravity (see the encounter block below). "Two" waypoints is this phase's
 * UI choice (how many waypoint cards fit the sidebar), not an architectural
 * ceiling — per ARCHITECTURE.md's "Phases are chains; compliance is a boundary
 * check, not a reconciliation", a phase is any length of ordinary stage chain.
 * The plotter's snap-to and Lambert targeting are not here: they live on the
 * Ephemeris tab (ephemeris-view.js), which authors a plan before it is frozen.
 *
 * Consumes a ship-state packet (any frame — converted to "helio" via
 * Shared/frames.js) AS THE COAST'S STARTING STATE, unmodified. No burn of its
 * own happens at that seam: the Departure→Coast hand-off is a given heading and
 * speed, not a burn formula applied to some baseline, because only a minority
 * of the delta-v needed to get somewhere comes from engine burns. Whatever put
 * the ship there — a departure tech's release physics, a chain of burns
 * upstream, anything — is that upstream stage's business; transfer-leg just
 * coasts from where it is handed off. The two WAYPOINT burns are real, though:
 * genuine mid-course corrections during Coast. By the same reasoning the ship's
 * heading and speed at the END of Coast is just the resultant of that starting
 * state plus whatever waypoint burns happened along the way, so nothing at the
 * Coast→Arrival seam needs a burn concept either — arrival-boundary passes the
 * emitted state through untouched, and arrival-leg simply continues this leg's
 * own flight from the seam (it reads the state there off
 * handoffLegFor/stateAtElapsed below, since the EMITTED state sits later, at
 * this leg's end, where arrival-boundary has to measure it).
 *
 * THE LEG IS COMPUTED TWICE, and the two answers go to different places: the
 * live tuning is drawn and reported on the ship card, while the last committed
 * hand-off is what the Arrival phase runs on. See the hand-off snapshot block
 * below defaultParams for why, and legFor/handoffLegFor for which consumer
 * reads which.
 *
 * If a destination body is set, the miss distance at arrival is reported
 * through the envelope's WARNINGS channel — non-blocking, per the core's
 * comply-mode contract: a leg that misses Ceres is a diagnosed mission, not a
 * blank screen.
 *
 * The events this module emits are also read structurally elsewhere:
 * core/arrival-seam.js finds the destination's closest-approach event to derive
 * the Coast→Arrival window, and mission-view.js spans the Coast slider on it.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; `init` (sidebar
 * card) and `draw` (trajectory polyline in the "helio" frame) are the
 * browser-only view hooks.
 *
 * Imports from ../../../Shared/, ../../core/ and ../frozen-plan/ — this
 * folder breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { computeArrivalSeam } from "../../core/arrival-seam.js";
import { makeShipSprite, sweepAngleFrom } from "../../../Shared/sim/marker-card.js";
import { buildVectorEditor } from "../../../Shared/sim/vector-editor.js";
import { bodyConstants, integrateEncounter, stateAtLegTime } from "../../../Shared/body-leg.js";
import { createWaypointGizmo, makeBurnArrow } from "../../../Shared/sim/burn-widget.js";
import { planWaypointsFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;
var SUN = systems.get("Sun");
var GM_SUN = SUN.GM;
var AU = 149597870700;   // m
var DAY = 86400;

// Burn-vector arrows: a fixed physical scale (AU drawn per km/s), matching ephemeris-view.js
var BURN_VEC_SCALE = 0.03;
var DV_COLOR = 0xff5fd0, DSPEED_COLOR = 0xffd24a;
var GIZMO_PX = 42;   // constant on-screen size for waypoint gizmos, matching other phases

// Bodies offered as leg destinations (a subset of the plotter's list).
export var DESTINATIONS = ["Venus", "Earth", "Mars", "Ceres", "Vesta", "Psyche",
	"Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

// A waypoint burn edited during Coast is a COURSE CORRECTION, not a fresh
// injection: the sidebar card caps how far any single axis may move from its
// baseline (the frozen plan's original burn for an existing waypoint, or
// zero for one added after freezing — see rebuildWaypointRows). Exported so
// the shell/tests can reference the same figure.
export var WAYPOINT_AXIS_CAP_MPS = 100;

// Warn when the leg ends farther than this from the destination body.
export var MISS_WARN_AU = 0.02;

// ---- the hand-off snapshot --------------------------------------------------
// Waypoint edits on Coast take effect on the DRAWN coast immediately, but they
// do not reach the Arrival phase until the ship card's Update button is
// pressed. There is no single right approach — many passes arrive successfully —
// so the user tunes against the card's live closest-approach/speed readouts and
// commits when the pass is one they want, rather than dragging the whole
// arrival phase along behind every nudge.
//
// `handoff` holds the waypoint list as of the last commit. null means nothing
// is pending and the live waypoints ARE the hand-off — which is also what every
// save written before this feature deserializes to, so no migration is needed:
// such a mission simply behaves as it always did until its first waypoint edit,
// which captures the snapshot (see init's commitWaypoints).
export var defaultParams = {
	waypoints: [],                       // up to 2: { days, burn: {pro,rad,nrm} }
	handoff: null,                       // waypoints as of the last Update, or null
	legDays: 480,                        // duration from leg start to the emitted state
	destination: ""                      // body name, or "" for none
};

// Waypoint lists equal for hand-off purposes: same count, same times, same
// burns. Compared rather than identity-checked so that editing a waypoint and
// putting it back reads as "nothing pending" instead of leaving the card
// offering an Update that would change nothing.
export function sameWaypoints(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { return false; }
	for (var i = 0; i < a.length; i++) {
		var x = a[i] || {}, y = b[i] || {};
		var xb = x.burn || {}, yb = y.burn || {};
		if (x.days !== y.days || (xb.pro || 0) !== (yb.pro || 0) ||
		    (xb.rad || 0) !== (yb.rad || 0) || (xb.nrm || 0) !== (yb.nrm || 0)) { return false; }
	}
	return true;
}

// A detached copy of a waypoint list — the snapshot must not alias the live
// objects the vector editor mutates in place.
export function copyWaypoints(list) {
	return (list || []).map(function (wp) {
		var b = wp.burn || {};
		return { days: wp.days, burn: { pro: b.pro || 0, rad: b.rad || 0, nrm: b.nrm || 0 } };
	});
}

// Does the live coast differ from the one the Arrival phase is running on?
// The ship card's Update button exists exactly when this is true. Takes a
// stage's raw params.
export function handoffPending(params) {
	var p = Object.assign({}, defaultParams, params || {});
	return Array.isArray(p.handoff) && !sameWaypoints(p.handoff, p.waypoints);
}

// Hand the live coast to Arrival: the Update button's whole effect. Snapshots
// the current waypoints, which makes handoffPending false until the next edit.
export function commitHandoff(world, stageId) {
	var stage = world.getStage(stageId);
	if (!stage) { return; }
	var p = Object.assign({}, defaultParams, stage.params);
	world.set({ stage: stageId, params: { handoff: copyWaypoints(p.waypoints) } });
}

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

function burnMag(b) { return Math.hypot(b.pro || 0, b.rad || 0, b.nrm || 0); }

// ---- SOI encounters ---------------------------------------------------------
// The coast is Sun-only Kepler EXCEPT where it dips inside a body's sphere
// of influence: there the flight switches to Shared/body-leg.js's real
// body + Sun integration (integrateEncounter — same RK4 and indirect term
// the departure legs use, so a close approach genuinely bends) and resumes
// Kepler at SOI exit. A body's own gravity is what makes a rendezvous
// possible to set up at all. "All bodies" is literal: every `systems` entry
// with a heliocentric orbit and a mass, no per-body special cases (the
// project's body convention).

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
			// At the window's last grid point there is no sample on the far side
			// to complete a local minimum, so a still-descending dip counts as a
			// candidate. It must NOT additionally require that last point to be
			// inside the SOI: a pass whose periapsis falls inside the window but
			// which has climbed back out by the window's end would be rejected,
			// and the body's gravity never applied to the arc at all. Whether the
			// dip really enters the SOI is settled after refinement below, exactly
			// as it is for an interior minimum.
			var isMin = (i < N) ? (d[i] <= d[i - 1] && d[i] <= d[i + 1])
			                    : (d[i] < d[i - 1]);
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
			// Segs are recorded even on the quiet (overrun) walk: they are what
			// lets a state be recovered anywhere along the drawn flight, and
			// nearestApproach measures across the overrun too. `quiet` suppresses
			// EVENTS only — the overrun is display-only and must not put entries
			// in the events bar or move the arrival seam.
			out.segs.push({ type: "kepler", r0: r, v0: v, tStart: t0, dur: kepDur });
			var n = Math.max(60, Math.min(240, Math.round(kepDur / DAY * 0.5)));
			var arc = O.sampleArc(GM_SUN, r, v, kepDur, n);
			for (var k = (out.samples.length ? 1 : 0); k < arc.length; k++) {
				out.samples.push({ r: arc[k].r, v: arc[k].v, t: t0 + arc[k].t });
			}
			var st = O.propagateState(GM_SUN, r, v, kepDur);
			r = st.r; v = st.v;
			t0 += kepDur; jdAbs += kepDur / DAY; remaining -= kepDur;
		}
		if (!enc) { break; }

		var res = integrateEncounter(enc.body, r, v, jdAbs, remaining);
		var c = bodyConstants(enc.body);
		out.segs.push({ type: "enc", body: enc.body,
		                leg: { samples: res.samples, jde0: jdAbs },
		                tStart: t0, dur: res.duration });
		if (!out.quiet) {
			if (enc.tEnter > 0) {   // a resumed encounter already announced itself
				out.events.push({ jd: jdAbs, label: enc.body + " SOI entry — " +
					(res.vinf != null ? "v∞ " + (res.vinf / 1000).toFixed(2) + " km/s" : "bound") });
			}
			// Closest approach, from the integrated trail (surface altitude) —
			// integrateEncounter's own refined rmin/tmin, so the epoch the
			// arrival window is hung on and the epoch the arrival leg finds are
			// the same measurement. `kind`/`body`/`vInf`/`rmin` are structured
			// fields alongside the label, so core/arrival-seam.js can find the
			// destination's own encounter and its approach speed without parsing
			// the label string. display: false — the reader sees arrival-leg's
			// own closest-approach event instead; this one stays in the envelope
			// for arrival-seam.js to consume.
			out.events.push({ jd: jdAbs + res.tmin / DAY, display: false,
				kind: "closest-approach", body: enc.body, vInf: res.vinf, rmin: res.rmin,
				label: enc.body + " closest approach — " + Fmt3(res.rmin - c.R) + " km" });
		}
		// Lift the body-centred trail to helio samples (decimated to keep the
		// polyline light; the seg keeps the full trail for stateAtElapsed).
		// Velocity is lifted alongside position — the ship card's speed bar
		// reads its profile straight off these samples, and a pass through an
		// SOI is exactly where the speed is most worth seeing.
		var stride = Math.max(1, Math.floor(res.samples.length / 400));
		var lastIdx = res.samples.length - 1;
		for (var si2 = 1; si2 <= lastIdx; si2 += stride) {
			var idx = (si2 + stride > lastIdx) ? lastIdx : si2;   // never skip the exit point
			var s = res.samples[idx];
			var bs = O.bodyStateAtJD(GM_SUN, systems.get(enc.body).orbit, jdAbs + s.t / DAY);
			out.samples.push({ r: O.vAdd(s.r, bs.r), v: O.vAdd(s.v, bs.v), t: t0 + s.t });
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
	// display: false on both — bookkeeping for mission-view.js's coastSpan
	// fallback (the envelope of departure/coast event jd's, when no frozen
	// plan supplies the span directly), not a ship event worth showing the
	// reader; the leg's own end is already the next phase's hand-off.
	if (impact) {
		// The walk stopped at the surface; the leg has no coast state past it.
	} else if (p.destination && systems.get(p.destination)) {
		// The label states the leg's END, which is what it says; `miss` — the
		// figure the "misses destination" warning is judged on — is set from the
		// PASS further down, once the leg exists to measure. A leg routinely ends
		// before its own closest approach, so its end separation says little
		// about whether the destination was reached.
		var dest = O.bodyStateAtJD(GM_SUN, systems.get(p.destination).orbit, jdEnd);
		out.events.push({ jd: jdEnd, display: false, label: "Leg ends — " +
			(O.vMag(O.vSub(r, dest.r)) / AU).toFixed(3) + " AU from " + p.destination });
	} else {
		out.events.push({ jd: jdEnd, display: false, label: "Leg ends" });
	}

	// Display-only OVERRUN: the drawn path continues dimmer past the leg's own
	// end, long enough to convey the trajectory PAST the destination — the leg
	// is a section snipped from a longer flight, and the snip shouldn't hide the
	// pass. Runs through the same coastStretch (so a rendezvous encounter in
	// progress at leg end completes on screen); the EMITTED end state is
	// untouched — phases stay chains, the hand-off stays at legDays.
	var overrun = [], overrunSegs = [];
	if (!impact) {
		var overrunDays = Math.min(60, Math.max(15, Math.round(p.legDays * 0.1)));
		var over = { samples: overrun, segs: overrunSegs, events: [], quiet: true };
		coastStretch(r, v, jd0 + p.legDays, p.legDays * DAY, overrunDays * DAY, over, inside);
	}

	var leg = { ok: true, jd0: jd0, samples: out.samples, segs: out.segs,
	            end: { r: r, v: v, jd: jdEnd }, impact: impact, overrun: overrun,
	            overrunSegs: overrunSegs,
	            events: out.events, totalDv: totalDv, miss: miss };

	// THE DESTINATION'S PASS IS REPORTED FROM THE MEASUREMENT, not from whichever
	// SOI encounter happened to fall inside the leg. The per-encounter events
	// above stay — they are real, and they cover every body the arc meets — but
	// for the destination they can be absent (its encounter falls past the leg's
	// end) or truncated (the leg ends before periapsis, so the boundary distance
	// is reported as the approach). nearestApproach searches the leg and its
	// overrun together and is continuous in the waypoints, so the destination's
	// event is replaced with its answer. This is the same figure the seam, the
	// sliders and the ship card read: one measurement, reported once.
	if (!impact && p.destination && systems.get(p.destination)) {
		var pass = nearestApproach(leg, p.destination);
		// "Did this coast reach its destination" is the closest it ever comes,
		// not where its own duration parameter happened to run out.
		if (pass) { leg.miss = pass.rmin / AU; }
		if (pass && pass.insideSoi) {
			var c2 = bodyConstants(p.destination);
			out.events = out.events.filter(function (e) {
				return !(e.kind === "closest-approach" && e.body === p.destination);
			});
			out.events.push({ jd: pass.jd, display: false,
				kind: "closest-approach", body: p.destination,
				vInf: pass.vInf, rmin: pass.rmin,
				label: p.destination + " closest approach — " + Fmt3(pass.rmin - c2.R) + " km" });
			out.events.sort(function (a, b) { return a.jd - b.jd; });
			leg.events = out.events;
		}
	}
	return leg;
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

// The closest the drawn flight comes to `body`, and how fast it is going
// relative to it there. ONE measurement, whether or not the arc enters the
// body's SOI — which is the point of it.
//
// The obvious cheap version, scanning the polyline samples, is wrong and was
// tried first: inside an SOI the samples come from the integrated encounter and
// are dense, but outside one they are a Kepler point per day or so, and at a
// few km/s relative that is hundreds of thousands of kilometres between
// samples. The figure then jumped by tens of thousands of km the instant a
// waypoint nudge walked the pass out of the SOI, and moved non-monotonically
// outside it — sampling luck, not physics.
//
// So this scans TIME, not samples: a grid coarse enough to be cheap (the
// approach to any body rides a weeks-wide distance dip, exactly the property
// findFirstEncounter above relies on) with every local minimum ternary-refined
// to convergence. Resolution comes from the refinement, so the answer is a
// continuous function of the trajectory and agrees with the integrated
// encounter's own rmin where there is one.
//
// The span is the flight AS DRAWN — the leg plus its display overrun (see
// computeLeg), which is why the overrun records segs. A pass that falls just
// past the leg boundary is still the pass the reader is looking at.
//
// Returns { jd, tElapsed, rmin, altitude, speed, rRel, vRel, insideSoi,
// pastLegEnd } or null. rRel/vRel are the BODY-RELATIVE state at the minimum,
// so a caller wanting the approach geometry (the ship card's B-plane square)
// takes it from here rather than re-deriving a state the scan already had.
// Pure; Node-tested.
export function nearestApproach(leg, body) {
	if (!leg || !leg.ok || !body) { return null; }
	var sys = systems.get(body);
	if (!sys || !sys.orbit) { return null; }
	var segs = leg.segs || [];
	if (!segs.length) { return null; }
	var oSegs = leg.overrunSegs || [];
	function spanEndOf(list) {
		var last = list[list.length - 1];
		return last.tStart + last.dur;
	}
	var legEnd = spanEndOf(segs);
	var end = oSegs.length ? spanEndOf(oSegs) : legEnd;

	function sep(t) {
		var s = (t <= legEnd || !oSegs.length)
			? stateAtElapsed(leg, t)
			: stateAtElapsed({ segs: oSegs }, t);
		if (!s) { return Infinity; }
		var b = O.bodyStateAtJD(GM_SUN, sys.orbit, leg.jd0 + t / DAY);
		return O.vMag(O.vSub(s.r, b.r));
	}

	// ~1-day grid, bounded so a very long leg stays cheap and a very short one
	// still gets enough points to bracket its dip.
	var N = Math.max(24, Math.min(1500, Math.round(end / DAY)));
	var d = new Array(N + 1);
	for (var i = 0; i <= N; i++) { d[i] = sep(end * i / N); }

	var bestT = 0, bestD = Infinity;
	function consider(lo, hi) {
		for (var k = 0; k < 80; k++) {
			var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
			if (sep(m1) <= sep(m2)) { hi = m2; } else { lo = m1; }
		}
		var t = (lo + hi) / 2, val = sep(t);
		if (val < bestD) { bestD = val; bestT = t; }
	}
	var step = end / N;
	for (var j = 0; j <= N; j++) {
		var isMin = (j === 0) ? (d[0] <= d[1])
			: (j === N) ? (d[N] <= d[N - 1])
				: (d[j] <= d[j - 1] && d[j] <= d[j + 1]);
		if (!isMin) { continue; }
		consider(Math.max(0, step * (j - 1)), Math.min(end, step * (j + 1)));
	}
	if (!isFinite(bestD)) { return null; }

	var s = (bestT <= legEnd || !oSegs.length)
		? stateAtElapsed(leg, bestT)
		: stateAtElapsed({ segs: oSegs }, bestT);
	var b = O.bodyStateAtJD(GM_SUN, sys.orbit, leg.jd0 + bestT / DAY);
	var rRel = O.vSub(s.r, b.r), vRel = O.vSub(s.v, b.v);
	var vRelMag = O.vMag(vRel);
	// v∞, the speed the approach still has once clear of the body — what the
	// seam's SOI-crossing estimate is measured at, and what an arrival
	// commitment is written in. Null when the pass is bound (no asymptote).
	var vInfSq = vRelMag * vRelMag - 2 * sys.GM / bestD;
	return {
		jd: leg.jd0 + bestT / DAY, tElapsed: bestT, rmin: bestD,
		altitude: bestD - sys.radius, speed: vRelMag,
		vInf: vInfSq > 0 ? Math.sqrt(vInfSq) : null,
		rRel: rRel, vRel: vRel,
		insideSoi: bestD < bodyConstants(body).SOI, pastLegEnd: bestT > legEnd
	};
}

// The waypoint card's "at deg" field: heliocentric degrees swept from the
// leg's own start (day 0) to the point reached `day` days in — the same
// "swept from origin" quantity Shared/sim/marker-card.js's marker readout
// shows, reusing its sweepAngleFrom so a waypoint's angle and a marker's mean
// the same thing. The card still stores/edits the waypoint by DAY internally
// (computeLeg's chain-walk is time-parameterized, and freeze/reset compare
// against the frozen plan's own days) -- this and dayAtDeg below are purely
// the display/edit conversion at the UI boundary.
export function degAtDay(leg, day) {
	if (!leg || !leg.ok || !leg.segs.length) { return 0; }
	var s = stateAtElapsed(leg, Math.max(0, day) * DAY);
	return s ? sweepAngleFrom(leg.segs[0].r0, leg.segs[0].v0, s.r) : 0;
}

// Inverse of degAtDay: the day in [0, legDays] whose swept angle is closest
// to targetDeg, found by Newton iteration from dayGuess (the waypoint's
// current day) so a small nudge in degrees lands on the same nearby crossing
// rather than some other day sharing the same angle mod 360 -- relevant on
// legs that sweep more than a full turn.
export function dayAtDeg(leg, legDays, dayGuess, targetDeg) {
	if (!leg || !leg.ok || !leg.segs.length || !(legDays > 0)) { return dayGuess; }
	function wrap180(a) { return ((a + 180) % 360 + 360) % 360 - 180; }
	function f(d) { return wrap180(degAtDay(leg, d) - targetDeg); }
	var day = Math.max(0, Math.min(legDays, dayGuess));
	var h = Math.max(0.02, legDays * 0.001);
	for (var i = 0; i < 40; i++) {
		var f0 = f(day);
		if (Math.abs(f0) < 0.01) { break; }
		var hh = (day + h <= legDays) ? h : -h;
		var deriv = (f(day + hh) - f0) / hh;
		if (!isFinite(deriv) || Math.abs(deriv) < 1e-9) { break; }
		var step = Math.max(-legDays / 3, Math.min(legDays / 3, f0 / deriv));
		day = Math.max(0.01, Math.min(legDays - 0.01, day - step));
	}
	return day;
}

// Last computed legs per (World, stage), for the card readouts and the
// polyline. Keyed by World first because N missions coexist and their Worlds
// reuse stage ids like "stg-2" — a stageId-only cache would let one mission's
// recompute clobber another's drawn leg. WeakMap, so a closed mission's entries
// go with its World.
//
// TWO legs per stage, because the coast has two answers at once (see the
// hand-off snapshot block above): `live` is the coast as currently tuned — the
// drawn polyline, the chevron, the ship card's live readouts — and `handoff` is
// the coast the Arrival phase is running on. They are the same object whenever
// nothing is pending.
var lastByWorld = new WeakMap();
function legsOf(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}

// The coast as currently tuned. Everything that DRAWS the coast wants this.
export function legFor(world, stageId) {
	var l = legsOf(world, stageId);
	return l ? l.live : null;
}

// The coast the Arrival phase is running on — the last hand-off. Arrival stages
// read the coast through THIS, so a pending waypoint edit moves the drawn arc
// without moving the approach the arrival phase has been built against.
export function handoffLegFor(world, stageId) {
	var l = legsOf(world, stageId);
	return l ? l.handoff : null;
}

function rememberLegs(world, stageId, live, handoff) {
	if (!world || typeof world !== "object") { return; }   // a bare Node call
	                                                       // (ctx.world null) has no view to feed
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, { live: live, handoff: handoff });
}

export default {
	id: "transfer-leg",
	title: "Transfer leg",
	attachesTo: null,
	accepts: ["ship-state"],
	emits: ["ship-state"],
	rendersIn: ["helio"],
	// No title/status header on the sidebar card: the Coast sidebar shows just
	// the waypoint cards + add button (see init). Warnings/diagnostics still
	// render in the card via the shell's generic boxes.
	plainCard: true,

	// Exposed on the DESCRIPTOR, not just as named exports, so the shell
	// (mission-view.js's Coast ship card) can reach them through
	// registry.get("transfer-leg") — modules stay dynamically loaded
	// (planner.js's MODULE_URLS) and only the registry is a shared handle. The
	// same arrangement frozen-plan uses for complianceFor and friends.
	legFor: legFor,
	handoffLegFor: handoffLegFor,
	stateAtElapsed: stateAtElapsed,
	nearestApproach: nearestApproach,
	handoffPending: handoffPending,
	commitHandoff: commitHandoff,

	update: function (ctx, input) {
		var params = Object.assign({}, defaultParams, ctx.params);
		var data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");

		// The live coast: what is drawn, and what the ship card reports against.
		var leg = computeLeg(params, data);
		// The hand-off coast: what Arrival is running on. Identical unless a
		// waypoint edit is pending, in which case this is the SECOND full
		// integration of the leg — the price of letting the arc move without
		// dragging the arrival phase with it.
		var handoff = leg;
		if (Array.isArray(params.handoff) && !sameWaypoints(params.handoff, params.waypoints)) {
			handoff = computeLeg(Object.assign({}, params, { waypoints: params.handoff }), data);
		}
		rememberLegs(ctx.world, ctx.stageId, leg, handoff.ok ? handoff : leg);
		if (!leg.ok) { return leg.diagnostic; }
		// A pending edit that breaks the leg must not take the committed
		// hand-off down with it, and vice versa: fall back to whichever ran.
		if (!handoff.ok) { handoff = leg; }

		// PACKET AND EVENTS COME FROM THE HAND-OFF, warnings from the live arc.
		// The packet is the Arrival phase's input and the events carry the
		// structure hung off this leg — core/arrival-seam.js's window, the
		// phase sliders, the events bar — so all of that holds still until
		// Update. The warnings are feedback on the arc the user is looking at
		// and is actively dragging, so they track the live leg instead.
		var packet = PacketTypes.make("ship-state",
			{ r: handoff.end.r, v: handoff.end.v, jd: handoff.end.jd, frame: "helio",
			  dvUsed: (data.dvUsed || 0) + handoff.totalDv },
			{ tool: "mission-planner/transfer-leg", label: "leg end", iso: isoOf(handoff.end.jd) });

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
				"The coast comes no closer than " + leg.miss.toFixed(3) + " AU to " + params.destination +
				" (within " + MISS_WARN_AU + " AU counts as arrival).",
				{ values: { missAU: leg.miss, destination: params.destination },
				  fix: "Adjust the waypoint impulses, the leg duration, or whatever delivers the coast's starting state." }));
		}

		return { packet: packet, warnings: warnings, events: handoff.events };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	// Sidebar card: ONLY the waypoint burns live here — one small card per
	// existing waypoint plus the add button (capped at 2). Leg duration,
	// destination and the departure injection are the frozen plan's business,
	// not knobs on the coast, and its figures render in the phase bar's
	// compliance readout instead. The stage opts out of the generic title/status
	// header (`plainCard` above); the leg's warnings and diagnostics still render
	// underneath via the shell's generic diag boxes.
	//
	// An ORIGINAL plan waypoint (index-matched against planWaypointsFor's
	// frozen reference copy) is a committed course correction, not a knob the
	// user can delete outright: its card's button reads "reset" and restores
	// the plan's own days/burn rather than removing the row. A waypoint added
	// AFTER freezing (index beyond the frozen list) is a later course
	// correction with no commitment behind it yet, so it keeps the ordinary
	// "remove" button.
	//
	// Every waypoint's burn editor runs the vector-editor's delta-cap mode
	// (WAYPOINT_AXIS_CAP_MPS, ±100 m/s per axis), baselined at the value the
	// "reset" button would restore — the plan's original burn for an original
	// waypoint, zero for one added later. Both cases read the same way: a
	// waypoint on Coast is a bounded trim from wherever it started, never a
	// fresh injection.

	init: function (ctx) {
		var host = ctx.panelHost;

		function stageParams() {
			var stage = ctx.world.getStage(ctx.stageId);
			return Object.assign({}, defaultParams, stage ? stage.params : {});
		}
		// EVERY waypoint mutation goes through here. It writes the new list and,
		// the first time anything on this leg is touched, captures the pre-edit
		// list as the hand-off snapshot — in ONE patch, so there is never an
		// instant where the live waypoints have moved and the hand-off has not.
		//
		// `list` must be DETACHED (copyWaypoints), never the live param objects:
		// the callers below hand the vector editor a copy of each burn precisely
		// so that the params still hold the pre-edit values when this runs. An
		// editor writing through to the live burn would erase the very snapshot
		// this is here to take.
		function commitWaypoints(list) {
			var p = stageParams();
			var patch = { waypoints: list };
			if (!Array.isArray(p.handoff)) { patch.handoff = copyWaypoints(p.waypoints); }
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
			var planWps = planWaypointsFor(ctx.world);   // the frozen plan's original waypoints, by index
			wps.forEach(function (wp, i) {
				var card = document.createElement("div"); card.className = "mp-card";
				var head = document.createElement("div"); head.className = "mp-wp-head";
				head.textContent = "waypoint " + (i + 1);
				var original = planWps[i] || null;
				var btn = document.createElement("button"); btn.className = "mp-btn";
				if (original) {
					// Part of the committed plan: not removable, only resettable.
					btn.textContent = "reset";
					btn.addEventListener("click", function () {
						var list = copyWaypoints(stageParams().waypoints);
						list[i] = { days: original.days, burn: Object.assign({}, original.burn) };
						commitWaypoints(list);
						rebuildWaypointRows();
					});
				} else {
					btn.textContent = "remove";
					btn.addEventListener("click", function () {
						var list = copyWaypoints(stageParams().waypoints);
						list.splice(i, 1);
						commitWaypoints(list);
						rebuildWaypointRows();
					});
				}
				head.appendChild(btn); card.appendChild(head);
				numRow(card, "at", "°", degAtDay(legFor(ctx.world, ctx.stageId), wp.days), 1, function (v) {
					var list = copyWaypoints(stageParams().waypoints);
					var leg = legFor(ctx.world, ctx.stageId);
					list[i].days = dayAtDeg(leg, stageParams().legDays, list[i].days, v);
					commitWaypoints(list);
				});
				var hint = document.createElement("div"); hint.className = "mp-muted";
				hint.textContent = "course correction — up to ±" + WAYPOINT_AXIS_CAP_MPS +
					" m/s per axis from " + (original ? "the plan" : "zero");
				card.appendChild(hint);
				var burnBaseline = original ? original.burn : { pro: 0, rad: 0, nrm: 0 };
				var burnHost = document.createElement("div"); card.appendChild(burnHost);
				// A COPY of the burn, not the live object — see commitWaypoints.
				buildVectorEditor(burnHost, Object.assign({}, wp.burn), function (axis, mps) {
					var list = copyWaypoints(stageParams().waypoints);
					list[i].burn[axis] = mps;
					commitWaypoints(list);
				}, { baseline: burnBaseline, maxDeltaMps: WAYPOINT_AXIS_CAP_MPS,
				     displayDiv: 1, decimals: 1, step: 0.1, unitLabel: "m/s" });
				wpHost.appendChild(card);
			});
			if (wps.length < 2) {
				var add = document.createElement("button"); add.className = "mp-btn mp-ghost";
				add.textContent = "+ add waypoint";
				add.addEventListener("click", function () {
					var list = copyWaypoints(stageParams().waypoints);
					var half = Math.round(stageParams().legDays / 2);
					list.push({ days: list.length ? Math.min(list[0].days + 60, stageParams().legDays - 10) : half,
					            burn: { pro: 0, rad: 0, nrm: 0 } });
					commitWaypoints(list);
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
		view.pxScaled = [];
		var leg = legFor(snap.world, snap.stageId);
		if (!leg || !leg.ok || snap.result.status !== "ok") { view.chevron = null; return; }
		var U = view.metresPerUnit;
		var params = Object.assign({}, defaultParams, snap.params);

		// The Coast->Arrival seam (core/arrival-seam.js) -- where this phase
		// hands off to Arrival, regardless of which phase is currently active.
		// Past it the drawn line switches to the same dimmed treatment as the
		// destination overrun below, so the hand-off point reads clearly on
		// sight instead of only being visible as where the chevron stops.
		var seam = null, seamT = null;
		if (params.destination && systems.get(params.destination)) {
			seam = computeArrivalSeam({ destination: params.destination,
			                             pass: nearestApproach(leg, params.destination),
			                             fallbackArrivalJd: leg.end.jd });
			seamT = (seam.start - leg.jd0) * DAY;
		}

		function ptsFrom(samples) {
			return samples.map(function (s) { return new THREE.Vector3(s.r[0] / U, s.r[1] / U, s.r[2] / U); });
		}

		// Split index: the first sample at/after the seam. splitIdx ===
		// samples.length (no destination, or the seam never arrives) keeps the
		// whole line bright, matching the pre-split behaviour.
		var splitIdx = leg.samples.length;
		if (seamT !== null) {
			for (var si0 = 0; si0 < leg.samples.length; si0++) {
				if (leg.samples[si0].t >= seamT) { splitIdx = si0; break; }
			}
		}
		view.group.add(new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(ptsFrom(leg.samples.slice(0, splitIdx + 1))),
			new THREE.LineBasicMaterial({ color: 0x66f0ff })));
		if (splitIdx < leg.samples.length) {
			// Shares the seam-index vertex with the bright segment above, so
			// the two segments join without a visible gap.
			view.group.add(new THREE.Line(
				new THREE.BufferGeometry().setFromPoints(ptsFrom(leg.samples.slice(splitIdx))),
				new THREE.LineBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.3 })));
		}

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

		// Constant-pixel dots: the only two points worth marking are the point
		// of closest approach (white) and where the destination itself sits at
		// that same moment (amber) -- the leg's own start/end exist to
		// structure the interface (the hand-off clamp, the miss-distance
		// warning), not to be looked at. seam.jd (computed above) already IS
		// this epoch: the real closest-approach date for an encountered
		// destination, or the plan's committed arrival epoch as a stand-in
		// when the coast never actually reaches its SOI.
		function dot(rM, colorHex, sizePx) {
			var g = new THREE.BufferGeometry();
			g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
				rM[0] / U, rM[1] / U, rM[2] / U]), 3));
			return new THREE.Points(g, new THREE.PointsMaterial({
				color: colorHex, size: sizePx, sizeAttenuation: false,
				transparent: true, depthTest: false }));
		}
		if (seam && systems.get(params.destination)) {
			var caState = stateAtElapsed(leg, (seam.jd - leg.jd0) * DAY);
			if (caState) { view.group.add(dot(caState.r, 0xe8ecf5, 6)); }
			var destAtCA = O.bodyStateAtJD(GM_SUN, systems.get(params.destination).orbit, seam.jd);
			view.group.add(dot(destAtCA.r, 0xe0a84a, 8));
		}

		// Waypoint gizmos and burn arrows: display each waypoint with three axes
		// and burn vectors, just like the Ephemeris tab. For each waypoint, get
		// the exact state at that point using stateAtElapsed, then create the
		// gizmo and burn arrows. Gizmos are held at constant on-screen size via
		// view.pxScaled, the shell's per-frame rescale hook.
		if (params.waypoints && params.waypoints.length) {
			params.waypoints.forEach(function (wp) {
				var wpTimeS = (wp.days || 0) * DAY;
				var wpState = stateAtElapsed(leg, wpTimeS);
				if (!wpState) { return; }

				// Create the waypoint gizmo (three axes: prograde, radial, normal)
				var gizPos = new THREE.Vector3(wpState.r[0] / U, wpState.r[1] / U, wpState.r[2] / U);
				var giz = createWaypointGizmo(wpState.r, wpState.v, gizPos);
				view.group.add(giz);
				view.pxScaled.push({ obj: giz, px: GIZMO_PX });

				// Create burn arrows for the waypoint impulse
				if (wp.burn && (wp.burn.pro || wp.burn.rad || wp.burn.nrm)) {
					var vAfter = O.applyBurn(wpState.r, wpState.v, wp.burn.pro || 0,
						wp.burn.nrm || 0, wp.burn.rad || 0);
					var dSpeed = O.vMag(vAfter) - O.vMag(wpState.v);
					var dSpeedVec = O.vScale(O.vUnit(vAfter), dSpeed);

					// Prograde speed change arrow (yellow)
					var spdArrow = makeBurnArrow(gizPos, dSpeedVec, DSPEED_COLOR, BURN_VEC_SCALE);
					if (spdArrow) { view.group.add(spdArrow); }

					// Delta-v arrow (pink)
					var dvVec = O.vSub(vAfter, wpState.v);
					var dvArrow = makeBurnArrow(gizPos, dvVec, DV_COLOR, BURN_VEC_SCALE);
					if (dvArrow) { view.group.add(dvArrow); }
				}
			});
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
		//
		// WHILE COAST IS THE ACTIVE PHASE (snap.phase, supplied by
		// mission-view.js's drawStage), the chevron cannot be scrubbed past the
		// Coast->Arrival seam (core/arrival-seam.js). The drawn trajectory line
		// above continues through closest approach and the overrun regardless;
		// only the marker is held back, so a stray clock move past the seam (e.g.
		// clicking the plan's own arrival event) can't show the ship somewhere the
		// Coast phase has no business displaying. In any other phase the clamp
		// lifts and the same marker continues on to the real encounter.
		var t = (snap.world.jd - leg.jd0) * DAY;
		if (snap.phase === "coast" && seamT !== null && t > seamT) { t = seamT; }
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
