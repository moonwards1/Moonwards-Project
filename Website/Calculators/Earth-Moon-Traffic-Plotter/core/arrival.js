/* Earth-Moon-Traffic-Plotter/core/arrival — how a flight meets a skyhook.
 *
 * The tether is a straight line from the foot to the top, turning with the
 * clock. A ship is caught when it comes within reach of that line. This file
 * finds the flight's CLOSEST PASS to the tether and says how the meeting goes:
 *
 *   - the nearest point of the tether at that instant, and its altitude;
 *   - the MISS: the distance between the ship and that point;
 *   - the TRIM: the ship's speed relative to that point of the tether, which a
 *     burn must cancel for the ship to be held there.
 *
 *     point = clamp(r . along, rFoot, rTop)       nearest point's radius, m
 *     miss  = | r - point * along |
 *     vRel  = v - omega * point * prograde
 *     trim  = | vRel |
 *
 *     r, v      the ship's position and velocity relative to the tether's body
 *     along     unit vector from the body's centre out along the tether, at
 *               that instant (the clock: core/facilities.js's tetherAxes)
 *     prograde  unit vector the way the tether moves
 *     omega     the tether's rotation rate, rad/s
 *
 * Only moments when the ship is on the tether's own side of the body count:
 * those where r . along is at least the body's radius, so the straight line
 * from the ship to the nearest point of the tether never passes through the
 * body. Without that, a ship rounding the far side while the tether points
 * away would be "closest" to the foot, straight through the planet — a
 * distance that means nothing for a catch. (The tether sweeps every direction
 * once a turn, so any flight of a few hours has such moments.)
 *
 * Two readings of "closest" are needed, and both are here:
 *
 *   evaluateArrival  the closest pass to the tether AS BUILT — a segment with
 *                    two ends. This is what the page reports, and what decides
 *                    whether the ship is caught.
 *   lineApproach     the closest pass to the tether's LINE, carried on past
 *                    both ends, as a signed miss and a radius. Smooth where
 *                    the segment's ends are not, so it is what core/target.js
 *                    solves on.
 *
 * Why not "where the path crosses the tether's plane", as
 * MissionPlanner/modules/skyhook/skyhook.js's tetherContact does: the catches
 * worth having are the ones where the ship arrives IN the tether's plane,
 * moving with it, and there a plane crossing is not a sharp event at all.
 * The closest pass is well defined at any inclination. The verdicts keep
 * tetherContact's vocabulary (off-arm / above-top / below-foot).
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { baseState } from "../../../Shared/kinematic-chain.js";
import { tetherAxes } from "./facilities.js";

var O = OrbitalMath;
var DAY = 86400;
var GOLD = (Math.sqrt(5) - 1) / 2;

// How far from the tether, in metres, the ship may pass and still be caught
// (skyhook.js's own figure).
export var CATCH_REACH = 1e3;

// The ship's state relative to the tether's body at flight time t (s), read
// off an integrated leg. Between two samples the ship is flown as a two-body
// orbit about that body from the earlier one: the integration's steps are
// short enough (a fraction of a degree of turn) for that to be exact at the
// scale of a catch, where a straight line between samples would be off by
// hundreds of metres.
function makeStateAt(leg, fig) {
	var a = leg.samples, cache = {};
	function rel(k) {
		if (!cache[k]) {
			var base = baseState(fig.body, leg.jde0 + a[k].t / DAY);
			cache[k] = { r: O.vSub(a[k].r, base.r), v: O.vSub(a[k].v, base.v) };
		}
		return cache[k];
	}
	return function (t) {
		var lo = 0, hi = a.length - 1;
		t = Math.max(a[0].t, Math.min(a[hi].t, t));
		while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (a[mid].t <= t) { lo = mid; } else { hi = mid; } }
		var s0 = rel(lo), dt = t - a[lo].t;
		return dt > 1e-9 ? O.propagateState(fig.GM, s0.r, s0.v, dt) : { r: s0.r.slice(), v: s0.v.slice() };
	};
}

// Minimum of f on [lo, hi] by golden-section search; f is single-dipped there.
function goldenMin(f, lo, hi) {
	var c = hi - GOLD * (hi - lo), d = lo + GOLD * (hi - lo), fc = f(c), fd = f(d);
	for (var i = 0; i < 70 && hi - lo > 1e-4; i++) {
		if (fc < fd) { hi = d; d = c; fd = fc; c = hi - GOLD * (hi - lo); fc = f(c); }
		else { lo = c; c = d; fc = fd; d = lo + GOLD * (hi - lo); fd = f(d); }
	}
	return (lo + hi) / 2;
}

// The ship against the tether at flight time t: everything both readings need.
function probe(stateAt, leg, fig, t) {
	var st = stateAt(t), ax = tetherAxes(fig, leg.jde0 + t / DAY);
	var x = O.vDot(st.r, ax.along);
	var point = Math.max(fig.rFoot, Math.min(fig.rTop, x));
	return { t: t, st: st, ax: ax, x: x, point: point,
	         segDist: O.vMag(O.vSub(st.r, O.vScale(ax.along, point))),
	         lineDist: x > 0 ? O.vMag(O.vSub(st.r, O.vScale(ax.along, x))) : O.vMag(st.r) };
}

// Judge a flight's arrival at the skyhook `fig` (facilities.js's skyhookFigures).
// Returns { found: false, reason } — "never-leaves" for a Moon-bound ellipse,
// "never-beside" for a flight that is never on the tether's side of the body
// (one that ends within minutes) — or
//   { found: true, caught, reason, t, jd, r, v, rGeo, point, pointGeo, altitude,
//     gap, miss, wait, pointSpeed, shipSpeed, vRel, trim, components }
//   caught      true when the ship can be taken hold of
//   reason      null when caught, else "above-top" | "below-foot" | "off-arm"
//   t, jd       the closest pass: seconds since release, and its Julian date
//   r, v        the ship there, relative to the tether's body; rGeo geocentric
//   point       radius of the nearest point of the tether, m; pointGeo its
//               geocentric position; altitude its height above the surface
//   gap         how far past an end the ship is, measured along the tether:
//               metres above the top (+) or below the foot (-); 0 beside it
//   miss        distance from the ship to that point, m
//   wait        the sideways part of the miss as time, s: positive when the
//               ship gets there before the tether does
//   components  vRel along { pro, out, nrm }: the tether's motion, outward
//               along the tether, and its orbit's pole
export function evaluateArrival(leg, fig) {
	if (leg.kind === "moonEllipse") { return { found: false, reason: "never-leaves" }; }
	var stateAt = makeStateAt(leg, fig), a = leg.samples;
	// Distance to the tether, counted only on the tether's side of the body.
	function dist(t) {
		var q = probe(stateAt, leg, fig, t);
		return q.x >= fig.R ? q.segDist : Infinity;
	}

	// Walk the flight looking for the smallest distance to the tether. The
	// step shrinks as the ship nears the tether's reach, where the distance
	// changes by kilometres a second; far out, minutes are fine enough to
	// follow the tether's turning. (The step is sized by the plain distance,
	// so it stays short through the stretches that do not count.)
	var tEnd = a[a.length - 1].t, t = a[0].t, best = null, prevT = t, bestLo = t, bestHi = t;
	while (t <= tEnd) {
		var q = probe(stateAt, leg, fig, t);
		var step = Math.max(5, Math.min(300, q.segDist / 4e4));
		if (q.x >= fig.R && (!best || q.segDist < best.d)) {
			best = { d: q.segDist, t: t }; bestLo = prevT; bestHi = Math.min(tEnd, t + step);
		}
		prevT = t;
		if (t >= tEnd) { break; }
		t = Math.min(tEnd, t + step);
	}
	if (!best) { return { found: false, reason: "never-beside" }; }
	var tc = goldenMin(dist, bestLo, bestHi);
	if (!(dist(tc) <= best.d)) { tc = best.t; }      // the dip lay against the edge of what counts
	var p = probe(stateAt, leg, fig, tc);
	var jd = leg.jde0 + tc / DAY, base = baseState(fig.body, jd);
	var gap = p.x > fig.rTop ? p.x - fig.rTop : (p.x < fig.rFoot ? p.x - fig.rFoot : 0);
	var pointSpeed = fig.omega * p.point;
	var pointR = O.vScale(p.ax.along, p.point);
	var D = O.vSub(p.st.r, pointR);
	var vRel = O.vSub(p.st.v, O.vScale(p.ax.prograde, pointSpeed));
	var miss = O.vMag(D);
	var reason = gap > 0 ? "above-top" : (gap < 0 ? "below-foot" : (miss > CATCH_REACH ? "off-arm" : null));
	return {
		found: true, caught: reason === null, reason: reason,
		t: tc, jd: jd, r: p.st.r, v: p.st.v, rGeo: O.vAdd(base.r, p.st.r),
		point: p.point, pointGeo: O.vAdd(base.r, pointR), altitude: p.point - fig.R,
		gap: gap, miss: miss, wait: O.vDot(D, p.ax.prograde) / pointSpeed,
		pointSpeed: pointSpeed, shipSpeed: O.vMag(p.st.v),
		vRel: vRel, trim: O.vMag(vRel),
		components: { pro: O.vDot(vRel, p.ax.prograde), out: O.vDot(vRel, p.ax.along), nrm: O.vDot(vRel, fig.normal) }
	};
}

// The closest pass to the tether's LINE near flight time nearT (s): the dip in
// the ship's distance from that line nearest in time to nearT, searched within
// `window` seconds either side (default: just over half a turn of the tether —
// the line sweeps past the ship once per turn, so that always holds one dip).
// Returns { t, radius, miss } or null when the window holds no dip:
//   radius  where along the line the ship passes, from the body's centre, m
//   miss    signed distance from the line, m — signed along (along x vRel),
//           so it runs smoothly through zero as the ship moves from one side
//           of the tether to the other
export function approachWindow(fig) { return fig.period / 2 + 300; }
export function lineApproach(leg, fig, nearT, window) {
	if (leg.kind === "moonEllipse") { return null; }
	var stateAt = makeStateAt(leg, fig), a = leg.samples;
	var W = window || approachWindow(fig), STEP = 4;
	var t0 = Math.max(a[0].t, nearT - W), t1 = Math.min(a[a.length - 1].t, nearT + W);
	function dist(t) { return probe(stateAt, leg, fig, t).lineDist; }
	var dips = [], d0 = dist(t0), d1 = dist(Math.min(t1, t0 + STEP));
	for (var t = t0 + 2 * STEP; t <= t1; t += STEP) {
		var d2 = dist(t);
		if (d1 <= d0 && d1 <= d2) { dips.push(t - STEP); }
		d0 = d1; d1 = d2;
	}
	if (!dips.length) { return null; }
	var pick = dips[0];
	dips.forEach(function (td) { if (Math.abs(td - nearT) < Math.abs(pick - nearT)) { pick = td; } });
	var tc = goldenMin(dist, pick - STEP, pick + STEP);
	var p = probe(stateAt, leg, fig, tc);
	var D = O.vSub(p.st.r, O.vScale(p.ax.along, p.x));
	var vRel = O.vSub(p.st.v, O.vScale(p.ax.prograde, fig.omega * p.x));
	var side = O.vCross(p.ax.along, vRel), sMag = O.vMag(side);
	return { t: tc, radius: p.x, miss: sMag > 1e-9 ? O.vDot(D, side) / sMag : O.vMag(D) };
}
