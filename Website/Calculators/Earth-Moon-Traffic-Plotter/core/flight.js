/* Earth-Moon-Traffic-Plotter/core/flight — one flight through the Earth–Moon
 * system, computed from the plotter's state. The page draws what this returns
 * and computes nothing of its own.
 *
 * A flight starts at a facility (core/facilities.js) at a release date. The
 * facility's position and velocity at that instant come from the clock, so
 * the release state is not chosen — it is where the release point IS then
 * (facilities.js's releaseState: a skyhook's release point, or the one of the
 * L1 elevator's two that the flight is let go from).
 * The ship then coasts under Earth + Moon + Sun gravity (Shared/geo-leg.js,
 * RK4, real ephemerides, no sphere-of-influence hand-off).
 *
 * Two leg shapes come back, both Shared/geo-leg.js's own:
 *   - "integrated": geocentric { r, v, t } samples;
 *   - "moonEllipse": the exact two-body ellipse of a release that stays bound
 *     inside the Moon's sphere of influence, as MOON-RELATIVE samples (the
 *     same split the Moon-Skyhook-Trajectory-Plotter makes). Unlike that
 *     plotter, a release from below the centre of mass is allowed here, so
 *     the ellipse can meet the ground: such a leg is cut at the impact and
 *     carries impact "Moon". Only a skyhook's release is ever drawn this way.
 *     One from the elevator starts tens of thousands of kilometres out, where
 *     Earth's pull shapes the path as much as the Moon's does, so it is always
 *     integrated; if it stays with the Moon it comes back as an integrated
 *     leg whose primary is "Moon".
 *
 * A flight may carry WAYPOINT BURNS (core/waypoints.js), each at a time since
 * release. It is then flown in segments, one integrated leg from the release
 * to the first burn, from there to the next, and on to the natural end, and
 * the segments are joined into one "integrated" leg whose samples run on the
 * one clock from release. Each burn shows in the joined samples as two
 * samples at the same t, before and after, so every reader of a leg (the
 * drawing, the Flight slider, bodyPass, core/arrival.js) takes a flight with
 * burns exactly as it takes one without. A Moon-bound release with a burn on
 * it is flown integrated too, since the burn may take it away from the Moon.
 *
 * A flight may name a destination facility. The path is then flown with a
 * finer step (the tether it has to meet is a few metres wide at the scale of
 * the trip) and judged where it meets the destination: core/arrival.js.
 * core/target.js adjusts the release until it does.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { buildIntegratedLeg, buildMoonEllipseLeg, stateAtLegTime, moonGeoPos, moonGeoVel,
         shipAccel, SOI_MOON } from "../../../Shared/geo-leg.js";
import { facilityFigures, releaseState, bodyOffPlane } from "./facilities.js";
import { evaluateArrival } from "./arrival.js";
import { cleanWaypoints, applyWaypointBurn } from "./waypoints.js";

var O = OrbitalMath;
var DAY = 86400;
var R_E = +systems.get("Earth").radius;
var R_M = +systems.get("Moon").radius;
var GM_M = systems.get("Moon").GM;
var A_EARTH = (systems.get("Earth").orbit.apoapsis + systems.get("Earth").orbit.periapsis) / 2;

// Time (s) at which a two-body path from (r0, v0) first comes down to radius
// R, searched up to tMax; null if it never does. Coarse walk, then bisection.
function timeToRadius(GM, r0, v0, R, tMax) {
	var N = 720, prev = 0;
	for (var k = 1; k <= N; k++) {
		var t = tMax * k / N;
		if (O.vMag(O.propagateState(GM, r0, v0, t).r) < R) {
			var lo = prev, hi = t;
			for (var i = 0; i < 50; i++) {
				var mid = (lo + hi) / 2;
				if (O.vMag(O.propagateState(GM, r0, v0, mid).r) < R) { hi = mid; } else { lo = mid; }
			}
			return hi;
		}
		prev = t;
	}
	return null;
}

// The Moon-bound ellipse leg, cut at the ground when its periapsis is below it.
function moonBoundLeg(relR, relV, jd, elM) {
	var leg = buildMoonEllipseLeg(relR, relV, jd, elM);
	if (leg.periAlt >= 0) { return leg; }
	var tHit = timeToRadius(GM_M, relR, relV, R_M, leg.duration);
	if (tHit === null) { return leg; }
	var hit = O.propagateState(GM_M, relR, relV, tHit);
	leg.samples = O.sampleArc(GM_M, relR, relV, tHit, 180);
	leg.duration = tHit;
	leg.impact = "Moon";
	leg.impactSpeed = O.vMag(hit.v);
	return leg;
}

// What the page reads off the flight's last leg, in display-ready units.
function summarize(leg) {
	var s = { primary: leg.primary, impact: leg.impact || null, impactSpeed: leg.impactSpeed || null,
	          duration: leg.duration, periAlt: null, apoAlt: null, periAU: null, apoAU: null,
	          vInfEarth: null, inclRad: leg.inclRad == null ? null : leg.inclRad, inclRef: null };
	if (leg.primary === "Moon") {
		s.periAlt = leg.periAlt * 1e3; s.apoAlt = leg.apoAlt * 1e3;
		s.inclRef = "skyhook plane";
	} else if (leg.primary === "Earth") {
		s.periAlt = leg.rmin - R_E;
		s.apoAlt = leg.rmax > 0 ? leg.rmax - R_E : null;
		s.inclRef = "ecliptic";
	} else {
		var h = leg.helioEl;
		if (h) {
			s.periAU = O.periapsisRadius(h.a, h.e) / A_EARTH;
			s.apoAU = h.e < 1 ? O.apoapsisRadius(h.a, h.e) / A_EARTH : null;
		}
		s.vInfEarth = leg.vinfEarth;
		s.inclRef = "ecliptic, heliocentric";
	}
	return s;
}

// A segment's geocentric state exactly dt seconds in, for a segment flown at
// least that far: the last sample at or before dt, flown the rest of the way
// under the same Earth + Moon + Sun gravity (Shared/geo-leg.js's shipAccel),
// in RK4 steps of at most REST_STEP. A two-body orbit about the nearer body is
// not good enough here: over the up to ~2,000 s left of a step, the other
// body's tidal pull changes the velocity by about a metre a second, the size
// of the burns themselves. Returns { kept, end }: the samples before dt, and
// the state at dt.
var REST_STEP = 60;
function cutSegment(seg, dt) {
	var a = seg.samples, k = 0;
	while (k + 1 < a.length && a[k + 1].t <= dt) { k++; }
	var s = a[k], rest = dt - s.t;
	if (rest <= 1e-9) { return { kept: a.slice(0, k), end: { r: s.r.slice(), v: s.v.slice() } }; }
	var n = Math.ceil(rest / REST_STEP), h = rest / n, r = s.r, v = s.v, jde = seg.jde0 + s.t / DAY;
	for (var i = 0; i < n; i++) {
		var hd = h / 2 / DAY;
		var a1 = shipAccel(r, jde);
		var r2 = O.vAdd(r, O.vScale(v, h / 2)), v2 = O.vAdd(v, O.vScale(a1, h / 2)), a2 = shipAccel(r2, jde + hd);
		var r3 = O.vAdd(r, O.vScale(v2, h / 2)), v3 = O.vAdd(v, O.vScale(a2, h / 2)), a3 = shipAccel(r3, jde + hd);
		var r4 = O.vAdd(r, O.vScale(v3, h)), v4 = O.vAdd(v, O.vScale(a3, h)), a4 = shipAccel(r4, jde + h / DAY);
		r = O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2, 2)), O.vAdd(O.vScale(v3, 2), v4)), h / 6));
		v = O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2, 2)), O.vAdd(O.vScale(a3, 2), a4)), h / 6));
		jde += h / DAY;
	}
	return { kept: a.slice(0, k + 1), end: { r: r, v: v } };
}

// Fly from the geocentric release state (r0, v0) at jd through the waypoints
// `wps` (cleanWaypoints' list), each segment an integrated leg with `opts`,
// no further than maxTime (s) when given. A waypoint the flight ends before
// (an impact, the path's natural end, or maxTime) is not reached, nor is any
// after it. Returns { legs, joined, resolved }:
//   legs      the segments, each on its own clock from its start
//   joined    one integrated leg on the release's clock (see the header)
//   resolved  one entry per reached waypoint: { index, reached: true, t, jd,
//             burn, r, v, vAfter } plus core/waypoints.js's applyWaypointBurn
//             fields (body, relR, relV, relVAfter, dv, dSpeed)
function flyWaypoints(r0, v0, jd, wps, opts, maxTime) {
	var cap = maxTime || Infinity, r = r0, v = v0, t0 = 0;
	var samples = [], legs = [], resolved = [], seg = null;
	function append(list) {
		list.forEach(function (s, k) {
			if (k === 0 && samples.length) { return; }       // the state just after a burn, already in
			samples.push({ r: s.r, v: s.v, t: t0 + s.t });
		});
	}
	for (var i = 0; ; i++) {
		var wp = i < wps.length && wps[i].t < cap ? wps[i] : null;
		var segOpts = Object.assign({}, opts), until = wp ? wp.t : cap;
		if (isFinite(until)) { segOpts.maxTime = until - t0; }
		seg = buildIntegratedLeg(r, v, jd + t0 / DAY, segOpts);
		legs.push(seg);
		if (!wp || seg.duration < wp.t - t0) { append(seg.samples); break; }
		var cut = cutSegment(seg, wp.t - t0);
		append(cut.kept);
		var jdW = jd + wp.t / DAY, b = applyWaypointBurn(cut.end.r, cut.end.v, jdW, wp.burn);
		samples.push({ r: cut.end.r, v: cut.end.v, t: wp.t });
		samples.push({ r: cut.end.r.slice(), v: b.vAfter, t: wp.t });
		resolved.push(Object.assign({ index: wp.index, reached: true, t: wp.t, jd: jdW, burn: wp.burn,
		                              r: cut.end.r, v: cut.end.v }, b));
		r = cut.end.r; v = b.vAfter; t0 = wp.t;
	}
	var joined = Object.assign({}, seg, { samples: samples, jde0: jd, duration: samples[samples.length - 1].t });
	return { legs: legs, joined: joined, resolved: resolved };
}

// Compute a flight.
//   input: { from, to, jd, params, maxTime, waypoints }
//     from     facility id (core/facilities.js) the ship is released from
//     to       optional facility id it is meant to arrive at
//     jd       release Julian date
//     params   optional { <facility id>: its params } — a skyhook's { footAlt, comAlt,
//              topAlt, relAlt, catchAlt }, the elevator's { cwAlt, lowAlt, highAlt, relPoint }
//     maxTime  optional: fly no longer than this (s) — core/target.js's trial flights
//     skipArrival  optional: leave `arrival` null (a trial flight judged otherwise)
//     waypoints    optional [{ t, burn: { pro, rad, nrm } }] — core/waypoints.js
// Returns { ok: true, from, to, jd, fig, toFig, release, legs, final, summary,
// arrival, offPlane, waypoints } or { ok: false, diagnostic }.
//   fig       the origin's figures (facilities.js's facilityFigures)
//   release   facilities.js's releaseState at jd: { r, v, relR, relV, radius },
//             and for a skyhook `phase`, the tether's clock angle (rad)
//   legs      the Shared/geo-leg.js legs flown, in flight order: one, or one
//             per segment between burns (each on its own clock from its start)
//   final     the flight as one leg: legs[0] itself, or the segments joined
//   waypoints one entry per input waypoint, in the input's order: flyWaypoints'
//             result (reached ones carry the states either side of the burn)
//   toFig     the destination's skyhookFigures, or null
//   arrival   core/arrival.js's evaluateArrival result, or null with no destination
//   bodyPass  bodyPass's result for the destination's body, or null with no destination
//   offPlane  for a flight to another body's facility: how far that body's
//             centre is from the origin tether's plane at the closest pass
//             (m, facilities.js's bodyOffPlane); null otherwise
export var FINE_STEP = { turnStep: 0.005, maxSteps: 40000 };
// A release from the elevator's upper point is on its way to Earth, however
// slowly it starts: it is flown this long (s) before a path still near the
// Moon is called a Moon orbit (Shared/geo-leg.js's moonCap).
export var UPPER_RELEASE_MOON_CAP = 40 * DAY;
export function computeFlight(input) {
	var fig = facilityFigures(input.from, input.params && input.params[input.from]);
	if (!fig.ok) { return fig; }
	var toFig = null;
	if (input.to) {
		toFig = facilityFigures(input.to, input.params && input.params[input.to]);
		if (!toFig.ok) { return toFig; }
		if (toFig.kind !== "skyhook") {
			return { ok: false, diagnostic: { code: "no-arrival", values: { to: input.to },
				message: "Arrivals at the " + input.to + " are not worked out yet." } };
		}
	}
	var jd = input.jd;
	var rel = releaseState(fig, jd);

	var wps = cleanWaypoints(input.waypoints);
	var opts = { moonPlaneNormal: fig.normal };
	if (toFig) { Object.assign(opts, FINE_STEP); }
	if (fig.kind === "elevator" && fig.relPoint === "high") { opts.moonCap = UPPER_RELEASE_MOON_CAP; }
	var leg = null, legs, wpOut = (input.waypoints || []).map(function (w) { return { reached: false, t: +w.t }; });
	if (wps.length) {
		var flown = flyWaypoints(rel.r, rel.v, jd, wps, opts, input.maxTime);
		legs = flown.legs; leg = flown.joined;
		flown.resolved.forEach(function (w) { wpOut[w.index] = w; });
	} else {
		if (fig.kind === "skyhook" && fig.body === "Moon") {
			var elM = O.elementsFromState(GM_M, rel.relR, rel.relV);
			if (elM.e < 1 && O.apoapsisRadius(elM.a, elM.e) < SOI_MOON) {
				leg = moonBoundLeg(rel.relR, rel.relV, jd, elM);
			}
		}
		if (!leg) {
			if (input.maxTime) { opts.maxTime = input.maxTime; }
			leg = buildIntegratedLeg(rel.r, rel.v, jd, opts);
		}
		legs = [leg];
	}

	var arrival = toFig && !input.skipArrival ? evaluateArrival(leg, toFig) : null;
	return { ok: true, from: input.from, to: input.to || null, jd: jd, fig: fig, toFig: toFig, release: rel,
	         legs: legs, final: leg, waypoints: wpOut, summary: summarize(leg), arrival: arrival,
	         bodyPass: toFig && !input.skipArrival ? bodyPass(leg, toFig.body) : null,
	         offPlane: arrival && arrival.found && toFig.body !== fig.body
	         	? bodyOffPlane(fig, toFig.body, arrival.jd) : null };
}

// The flight's closest pass to a body ("Earth" | "Moon"): the recorded sample
// where the ship is nearest that body's centre, over the whole flight.
// Returns { t, distance } (s since release, m from the centre), or null when
// the nearest point is the release itself — a ship that only draws away.
//
//   distance = | r_ship(t) - r_body(t) |
//
//   r_ship  the ship's geocentric position (a Moon-bound ellipse's samples are
//           Moon-relative, and are carried with the Moon)
//   r_body  the body's geocentric position: zero for Earth, the ephemeris for
//           the Moon
//
// The whole flight, not the first approach: a path can dip a little towards
// the body soon after release and only come truly close much later.
// Sample-level timing is enough, since the page uses this to end the Flight
// slider PAST_PASS beyond it.
export var PAST_PASS = 1800;
export function bodyPass(leg, body) {
	var a = leg.samples, best = null;
	for (var k = 0; k < a.length; k++) {
		var jde = leg.jde0 + a[k].t / DAY;
		var r = leg.kind === "moonEllipse" ? O.vAdd(moonGeoPos(jde), a[k].r) : a[k].r;
		var d = O.vMag(body === "Moon" ? O.vSub(r, moonGeoPos(jde)) : r);
		if (!best || d < best.distance) { best = { t: a[k].t, distance: d }; }
	}
	return best && best.t > a[0].t ? best : null;
}

// Geocentric state { r, v, jde } of the ship t seconds after release, clamped
// to the flight's span. A Moon-bound ellipse is carried along with the Moon.
export function flightStateAt(flight, t) {
	var leg = flight.final;
	t = Math.max(0, Math.min(leg.duration, t));
	if (leg.kind !== "moonEllipse") { return stateAtLegTime(leg, t); }
	var jde = leg.jde0 + t / DAY;
	var s = O.propagateState(GM_M, leg.relR, leg.relV, t);
	return { r: O.vAdd(moonGeoPos(jde), s.r), v: O.vAdd(moonGeoVel(jde), s.v), jde: jde };
}
