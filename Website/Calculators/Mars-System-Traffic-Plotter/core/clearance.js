/* Mars-System-Traffic-Plotter/core/clearance — keeping the hanging skyhook's
 * tether clear of the Phobos skyhook's and of the space elevator's, by timing.
 *
 * THE PHOBOS TETHER. Both tethers lie along lines through Mars's centre, so they can only touch
 * where those lines point the same way. The Phobos tether stays in the plane
 * of Phobos's orbit; the hanging skyhook's passes through that plane twice an
 * orbit. A PASS is one of those moments. At each, what matters is where
 * Phobos's tether is pointing: far round Mars from the passing tether, or
 * close to it.
 *
 * The CLEARANCE of a pass is the least distance between the two tethers
 * around it, each taken as the straight stretch from its foot to its top
 * where they are at that instant (OrbitalMath.segmentDistance). A pass that
 * slants through the plane gets nearer than it is at the moment of crossing:
 *
 *     clearance ~ d * sin(i) / sqrt( sin(i)^2 + (cos(i) - 1/n)^2 )
 *
 *     d   the distance between the tethers at the moment of crossing
 *     i   the hanging skyhook's tilt to the equator
 *     n   its orbits per turn of Phobos
 *
 * That estimate sorts the passes; any within three times the limit is then
 * measured exactly, by searching the minutes either side of the crossing.
 *
 * THE SPACE ELEVATOR'S TETHER stands over its anchor and is carried round by
 * Mars, so the stretch of it at the hanging tether's heights goes through
 * the plane of the hanging skyhook's orbit twice a Mars day. Each of those
 * is a pass too. What matters at one is how far round its orbit the hanging
 * tether is from the place the elevator's goes through: it sweeps round at
 * v_h while the elevator's tether crosses the plane at v_p, so starting an
 * angle D apart they come no nearer than about
 *
 *     clearance ~ D * r * v_p / sqrt( v_h^2 + v_p^2 )
 *
 *     D     the angle round the orbit between the two at the crossing, less
 *           half the angle the elevator's stretch spans
 *     r     the distance from Mars's centre of the middle of that stretch
 *     v_h   the hanging tether's speed there, w * r
 *     v_p   the speed at which the elevator's stretch crosses the plane
 *
 * A pass within one and a half times the limit by that estimate is measured
 * exactly: the least distance, over the minutes around their nearest, between
 * the hanging tether and the elevator's stretch as a chain of straight pieces.
 *
 * A SCHEDULE is worked out by going through the passes in order. At the first
 * whose clearance is under the limit, a sidestep (core/ballast.js) is put in
 * just before it: every slip from 1/24 of an orbit to a whole one, ahead and
 * behind, is tried, and the one that puts off the next close pass longest is
 * kept, so long as it buys at least a day. Close passes that no sidestep puts
 * off are listed as ones the ballast cannot avoid, those within a day and a
 * half of each other counted as one spell.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { MarsEphemeris as ME } from "../../../Shared/mars-ephemeris.js";
import { CLOCK_EPOCH, SPAN_DAYS } from "./clock.js";
import { skyhookAt } from "./facilities.js";
import { hangingAt, planeAt } from "./hanging-skyhook.js";
import { elevatorAt, elevatorPoint } from "./elevator.js";
import { planSidestep } from "./ballast.js";

var O = OrbitalMath;
var DAY = 86400, TWO_PI = 2 * Math.PI;
export var DEFAULT_LIMIT = 200e3;      // least clearance allowed, m
var SLIPS = 24;                        // sidestep sizes tried each way, as 24ths of an orbit
var MAX_SIDESTEPS = 400, MAX_UNAVOIDED = 60;
var CHAIN_PIECES = 12;                 // straight pieces the elevator's stretch is measured as
var CHAIN_PAD = 50e3;                  // how far past the hanging tether's ends the stretch is taken, m

// The pole of Phobos's orbit, which turns once in 2.26 years: looked up once a day.
var poleMemo = {};
function phobosPole(jd) {
	var day = Math.floor(jd);
	return poleMemo[day] || (poleMemo[day] = ME.moonState("Phobos", day + 0.5).normal);
}

// Distance (m) between the two tethers at jd, each from its foot to its top.
//   h, p     the hanging and the Phobos skyhook's figures
//   timing   the hanging skyhook's { a0, sidesteps }
export function tetherDistance(h, p, timing, jd) {
	var a = hangingAt(h, jd, timing), b = skyhookAt(p, jd);
	return O.segmentDistance(O.vScale(a.u, a.rCom + h.sFoot), O.vScale(a.u, a.rCom + h.sTop),
		O.vScale(b.u, b.dist + p.sFoot), O.vScale(b.u, b.dist + p.sTop)).distance;
}

// How much of the distance at the crossing a slanting pass keeps (see the header).
export function slantFactor(h) {
	var s = Math.sin(h.tilt), c = Math.cos(h.tilt) - 1 / h.ratio;
	return s / Math.sqrt(s * s + c * c);
}

// The instant (Julian date) the hanging tether passes through the plane of
// Phobos's orbit nearest to jdGuess.
function crossingNear(h, timing, jdGuess) {
	var jd = jdGuess;
	for (var k = 0; k < 3; k++) {
		var a = hangingAt(h, jd, timing), n = phobosPole(jd);
		jd -= O.vDot(a.u, n) / O.vDot(a.uDot, n) / DAY;
	}
	return jd;
}

// The pass at the crossing jdCross: { jd, distance (m), exact }. `limit`
// decides which passes are worth measuring exactly.
function measurePass(h, p, timing, jdCross, limit, slant) {
	var estimate = tetherDistance(h, p, timing, jdCross) * slant;
	if (estimate > 3 * limit) { return { jd: jdCross, distance: estimate, exact: false }; }
	// Golden-section search of the minutes either side.
	var W = Math.min(900, h.period / 5) / DAY, lo = jdCross - W, hi = jdCross + W, G = 0.6180339887;
	var x1 = hi - G * (hi - lo), x2 = lo + G * (hi - lo);
	var f1 = tetherDistance(h, p, timing, x1), f2 = tetherDistance(h, p, timing, x2);
	for (var k = 0; k < 22; k++) {
		if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - G * (hi - lo); f1 = tetherDistance(h, p, timing, x1); }
		else { lo = x1; x1 = x2; f1 = f2; x2 = lo + G * (hi - lo); f2 = tetherDistance(h, p, timing, x2); }
	}
	return { jd: 0.5 * (lo + hi), distance: Math.min(f1, f2), exact: true };
}

// Go through the passes of the Phobos tether from jdFrom to jdTo in order,
// calling visit(pass) for each; a visit that returns true stops the walk and
// that pass is returned.
export function walkPasses(h, p, timing, jdFrom, jdTo, limit, visit) {
	var slant = slantFactor(h), a = hangingAt(h, jdFrom, timing).angle;
	var half = Math.PI / h.omega / DAY;                      // half an orbit, days
	var jd = jdFrom + (Math.ceil(a / Math.PI) * Math.PI - a) / h.omega / DAY;
	while (jd <= jdTo) {
		var cross = crossingNear(h, timing, jd);
		if (cross >= jdFrom) {
			var pass = measurePass(h, p, timing, cross, limit, slant);
			pass.against = "phobos";
			if (visit(pass)) { return pass; }
		}
		// Half an orbit on, at the rate the skyhook is turning now.
		jd = cross + half / (1 + hangingAt(h, cross, timing).slip.rate);
	}
	return null;
}

// ---- the space elevator's tether ---------------------------------------------------

// The stretch of the elevator's tether at the hanging tether's heights, as
// the indices of the points of its curve it is measured between, and `mid`,
// the one whose crossings of the orbit's plane count as the passes.
function elevatorChain(h, e) {
	var c = e.curve, lo = h.R + h.footAlt - CHAIN_PAD, hi = h.R + h.topAlt + CHAIN_PAD, first = -1, last = -1;
	for (var k = 0; k < c.r.length; k++) {
		if (c.r[k] >= lo && first < 0) { first = k; }
		if (c.r[k] <= hi) { last = k; }
	}
	if (first < 0 || last <= first) { return null; }
	var idx = [], n = Math.min(CHAIN_PIECES, last - first);
	for (var j = 0; j <= n; j++) { idx.push(Math.round(first + (last - first) * j / n)); }
	var mid = idx[idx.length >> 1];
	// The angle the stretch spans, north–south and, under the lean, east–west.
	var span = Math.hypot(Math.atan2(c.z[first], c.x[first]) - Math.atan2(c.z[last], c.x[last]), c.west[first] - c.west[last]);
	return { idx: idx, mid: mid, r: c.r[mid], halfSpan: span / 2 };
}

// Distance (m) between the hanging tether, from its foot to its top, and the
// space elevator's tether at jd.
//   h, e     the hanging skyhook's and the elevator's figures
//   timing   the hanging skyhook's { a0, sidesteps }
//   chain    elevatorChain's result, when the caller has one already
export function elevatorDistance(h, e, timing, jd, chain) {
	var ch = chain || elevatorChain(h, e);
	if (!ch) { return Infinity; }
	var a = hangingAt(h, jd, timing), foot = O.vScale(a.u, a.rCom + h.sFoot), top = O.vScale(a.u, a.rCom + h.sTop);
	var at = elevatorAt(e, jd), prev = elevatorPoint(e, at, ch.idx[0]), best = Infinity;
	for (var k = 1; k < ch.idx.length; k++) {
		var next = elevatorPoint(e, at, ch.idx[k]);
		best = Math.min(best, O.segmentDistance(foot, top, prev, next).distance);
		prev = next;
	}
	return best;
}

// Go through the passes of the space elevator's tether from jdFrom to jdTo in
// order, as walkPasses does for Phobos's.
export function walkElevatorPasses(h, e, timing, jdFrom, jdTo, limit, visit) {
	var ch = elevatorChain(h, e);
	if (!ch) { return null; }
	// How far the middle of the stretch is from the orbit's plane, as a fraction of its distance from Mars's centre.
	function off(jd) { return O.vDot(O.vUnit(elevatorPoint(e, elevatorAt(e, jd), ch.mid)), planeAt(h, jd).normal); }
	var step = ME.SIDEREAL_DAY / 16 / DAY, jd = jdFrom, g = off(jd);
	while (jd < jdTo) {
		var jdNext = jd + step, gNext = off(jdNext);
		if (g === 0 || g * gNext < 0) {
			var lo = jd, hi = jdNext, gLo = g;
			for (var k = 0; k < 14; k++) {
				var mid = 0.5 * (lo + hi), gm = off(mid);
				if (gm * gLo <= 0) { hi = mid; } else { lo = mid; gLo = gm; }
			}
			var pass = measureElevatorPass(h, e, timing, 0.5 * (lo + hi), limit, ch, off);
			pass.against = "elevator";
			if (pass.jd >= jdFrom && pass.jd <= jdTo && visit(pass)) { return pass; }
		}
		jd = jdNext; g = gNext;
	}
	return null;
}

// The pass at the crossing jdCross: { jd, distance (m), exact }.
function measureElevatorPass(h, e, timing, jdCross, limit, ch, off) {
	var a = hangingAt(h, jdCross, timing), pl = a.plane;
	var dir = O.vUnit(elevatorPoint(e, elevatorAt(e, jdCross), ch.mid));
	// The hanging tether's angle round its orbit ahead of the elevator's stretch.
	var ahead = a.angle - Math.atan2(O.vDot(dir, pl.quarter), O.vDot(dir, pl.node));
	ahead -= TWO_PI * Math.round(ahead / TWO_PI);
	var dt = 30 / DAY, vp = Math.abs(off(jdCross + dt) - off(jdCross - dt)) / (2 * 30) * ch.r;
	var w = h.omega * (1 + a.slip.rate), vh = w * ch.r, both = Math.sqrt(vh * vh + vp * vp);
	var estimate = Math.max(0, Math.abs(ahead) - ch.halfSpan) * ch.r * vp / both;
	// What the guidance reads: how far apart the two are round the orbit at
	// the crossing, and the angle within which that is closer than `limit`.
	var geo = { ahead: ahead, danger: ch.halfSpan + limit * both / (ch.r * vp) };
	if (estimate > 1.5 * limit) { return { jd: jdCross, distance: estimate, exact: false, geo: geo }; }
	// The hanging tether is at the stretch `ahead / w` before the crossing:
	// look through the minutes round that, then close in on the least.
	var centre = jdCross - ahead * ch.r * vh / (both * both) / DAY;
	var reach = (ch.halfSpan / w + 120) / DAY, tick = 8 / DAY, best = centre, bestD = Infinity;
	for (var t = centre - reach; t <= centre + reach; t += tick) {
		var d = elevatorDistance(h, e, timing, t, ch);
		if (d < bestD) { bestD = d; best = t; }
	}
	var lo = best - tick, hi = best + tick, G = 0.6180339887;
	var x1 = hi - G * (hi - lo), x2 = lo + G * (hi - lo);
	var f1 = elevatorDistance(h, e, timing, x1, ch), f2 = elevatorDistance(h, e, timing, x2, ch);
	for (var k = 0; k < 12; k++) {
		if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - G * (hi - lo); f1 = elevatorDistance(h, e, timing, x1, ch); }
		else { lo = x1; x1 = x2; f1 = f2; x2 = lo + G * (hi - lo); f2 = elevatorDistance(h, e, timing, x2, ch); }
	}
	return { jd: 0.5 * (lo + hi), distance: Math.min(f1, f2, bestD), exact: true, geo: geo };
}

// ---- every tether the hanging skyhook must keep clear of -----------------------------

// `others` is { phobos, elevator }: the Phobos skyhook's and the space
// elevator's figures, either left out or null where it is not in the design.
// Only a tether the hanging one can meet is walked.
function walks(h, others) {
	var o = others || {}, list = [];
	if (o.elevator && o.elevator.ok && h.shareElevator) {
		list.push(function (timing, from, to, limit, visit) { return walkElevatorPasses(h, o.elevator, timing, from, to, limit, visit); });
	}
	if (o.phobos && o.phobos.ok && h.share) {
		list.push(function (timing, from, to, limit, visit) { return walkPasses(h, o.phobos, timing, from, to, limit, visit); });
	}
	return list;
}

// Whether the hanging skyhook has any tether to be timed against.
export function needsTiming(h, others) { return walks(h, others).length > 0; }

// The first pass from jdFrom to jdTo closer than `limit`, to either tether:
// { jd, distance, exact, against: "phobos" | "elevator" }, or null.
export function firstClosePass(h, others, timing, jdFrom, jdTo, limit) {
	var first = null;
	walks(h, others).forEach(function (walk) {
		// No need to look past a close pass already found.
		var pass = walk(timing, jdFrom, first ? first.jd : jdTo, limit, function (ps) { return ps.distance < limit; });
		if (pass && (!first || pass.jd < first.jd)) { first = pass; }
	});
	return first;
}

// The closest pass from jdFrom to jdTo, to either tether, or null if there is none.
export function closestPass(h, others, timing, jdFrom, jdTo, limit) {
	var best = null;
	walks(h, others).forEach(function (walk) {
		walk(timing, jdFrom, jdTo, limit, function (pass) {
			if (!best || pass.distance < best.distance) { best = pass; }
		});
	});
	return best;
}

// Where round its orbit to start the skyhook at CLOCK_EPOCH: the angle (rad)
// whose closest pass in the first five days is the widest.
export function bestStartAngle(h, others, limit) {
	var best = 0, bestD = -1, N = 72;
	for (var j = 0; j < N; j++) {
		var a0 = j * TWO_PI / N;
		var c = closestPass(h, others, { a0: a0, sidesteps: [] }, CLOCK_EPOCH, CLOCK_EPOCH + 5, limit);
		if (c && c.distance > bestD) { bestD = c.distance; best = a0; }
	}
	return best;
}

// The quickest sidestep slipping psi rad, from whichever lot of ballast and
// whichever way along the tether does it soonest.
function quickest(h, psi) {
	var best = null;
	h.ballast.responses.forEach(function (resp) {
		var s = planSidestep(resp, h.omega, psi, h.ballast.speed);
		if (s && (!best || s.duration < best.duration)) { best = s; }
	});
	return best;
}

// Work out the sidesteps that keep every pass of either tether at least
// `limit` clear, from CLOCK_EPOCH over the whole date span (or opts.days of it).
//   h        the hanging skyhook's figures; h.timing.a0 is kept
//   others   { phobos, elevator }: the figures of the tethers to keep clear of
//   opts     { limit (m), days, budgetMs: stop after this long at work }
// Returns
//   { limit, a0, sidesteps, unavoided, complete, jdReached, closest }
//   sidesteps   in order, each a ballast.js sidestep plus
//               { jdStart, jdEnd, psiBefore, avoids: the close pass it puts off
//               ({ jd, distance, against }), clearUntil: jd of the next close pass or null }
//   unavoided   [{ jd, jdLast, passes, distance, against }] spells of close
//               passes no sidestep put off: first and last pass, how many, the
//               closest, and which tether the closest was
//   complete    false when the count of either, or the time allowed, ran out
//               before the span did; jdReached is how far the working got, and
//               stopped says which ran out: "count" or "time".
//   closest     the closest pass left standing: { jd, distance }, or null
export function workOutSidesteps(h, others, opts) {
	var o = opts || {}, limit = o.limit || DEFAULT_LIMIT;
	var jdEnd = CLOCK_EPOCH + (o.days || SPAN_DAYS), half = Math.PI / h.omega / DAY;
	var timing = { a0: h.timing.a0, sidesteps: [] }, unavoided = [];
	var psiSum = 0, lastEnd = CLOCK_EPOCH, complete = true, jdReached = jdEnd, stopped = null;
	var began = o.budgetMs ? Date.now() : 0;
	var close = firstClosePass(h, others, timing, CLOCK_EPOCH, jdEnd, limit);
	while (close) {
		var late = o.budgetMs && Date.now() - began > o.budgetMs;
		if (late || timing.sidesteps.length >= MAX_SIDESTEPS || unavoided.length >= MAX_UNAVOIDED) {
			complete = false; jdReached = close.jd; stopped = late ? "time" : "count"; break;
		}
		var best = null;
		for (var j = 1; j <= SLIPS; j++) {
			for (var sign = -1; sign <= 1; sign += 2) {
				var plan = quickest(h, sign * j * TWO_PI / SLIPS);
				if (!plan) { continue; }
				var jdStart = Math.max(lastEnd, close.jd - plan.duration / DAY - half);
				var step = Object.assign({ jdStart: jdStart, jdEnd: jdStart + plan.duration / DAY, psiBefore: psiSum }, plan);
				var trial = { a0: timing.a0, sidesteps: timing.sidesteps.concat([step]) };
				var next = firstClosePass(h, others, trial, jdStart, jdEnd, limit);
				var until = next ? next.jd : Infinity;
				if (!best || until > best.until) { best = { step: step, next: next, until: until }; }
				if (until === Infinity) { break; }
			}
			if (best && best.until === Infinity) { break; }
		}
		if (best && best.until > close.jd + 1) {
			best.step.avoids = { jd: close.jd, distance: close.distance, against: close.against };
			best.step.clearUntil = best.next ? best.next.jd : null;
			timing.sidesteps.push(best.step);
			psiSum += best.step.psi; lastEnd = best.step.jdEnd;
			close = best.next;
		} else {
			var spell = unavoided[unavoided.length - 1];
			if (spell && close.jd - spell.jdLast < 1.5) {
				spell.jdLast = close.jd; spell.passes++;
				if (close.distance < spell.distance) { spell.distance = close.distance; spell.against = close.against; }
			} else { unavoided.push({ jd: close.jd, jdLast: close.jd, passes: 1, distance: close.distance, against: close.against }); }
			close = firstClosePass(h, others, timing, close.jd + half / 2, jdEnd, limit);
		}
	}
	var closest = closestPass(h, others, timing, CLOCK_EPOCH, jdReached - half / 2, limit);
	return { limit: limit, a0: timing.a0, sidesteps: timing.sidesteps, unavoided: unavoided,
	         complete: complete, jdReached: jdReached, stopped: stopped, closest: closest };
}

// What the skyhook's period means for its timing against Phobos, before any
// working out:
//   near        the resonance (hanging-skyhook.js) its period is nearest: { p, q, ratio, gap }
//   off         how far its turning rate is from that resonance, as a fraction
//               (positive: turning too fast)
//   danger      the angle round Mars within which a pass is closer than `limit`, rad
//   interval    about how long a sidestep lasts before the next is due, s
//               (Infinity on the resonance)
//   needs       "faster" | "slower" | null: the way a sidestep must change the rate
//   faster, slower   the most the ballast can change the rate each way, as fractions (0 if it cannot)
//
//     interval ~ ( 2 * gap - 2 * danger ) / ( |off| * n )
//
//     gap   the resonance's gap
//     n     Phobos's rate round Mars against the skyhook's node line, rad/s
export function timingGuidance(h, ratios, limit) {
	var near = null;
	ratios.forEach(function (r) { if (!near || Math.abs(h.ratio - r.ratio) < Math.abs(h.ratio - near.ratio)) { near = r; } });
	var off = h.ratio / near.ratio - 1, n = h.omega / h.ratio;
	var rLow = h.R + (h.share ? h.share.lo : h.footAlt);
	var danger = Math.asin(Math.min(1, (limit || DEFAULT_LIMIT) / rLow)) / slantFactor(h);
	var room = 2 * near.gap - 2 * danger, faster = 0, slower = 0;
	h.ballast.responses.forEach(function (resp) {
		resp.rate.forEach(function (x) { faster = Math.max(faster, x); slower = Math.max(slower, -x); });
	});
	return { near: near, off: off, danger: danger,
	         interval: Math.abs(off) > 1e-9 && room > 0 ? room / (Math.abs(off) * n) : (room > 0 ? Infinity : 0),
	         needs: Math.abs(off) < 2e-6 ? null : (off > 0 ? "slower" : "faster"), faster: faster, slower: slower };
}

// What the skyhook's period means for its timing against the space
// elevator's tether, before any working out. `ratios` is hanging-skyhook.js's
// DAY_RATIOS. Null where the two cannot meet.
//   near     the resonance with Mars's turning its period is nearest: { p, q, ratio }
//   off      how far its turning rate is from that resonance, as a fraction
//   creep    how far round its orbit the skyhook's place at a pass moves from
//            one turn of Mars to the next, rad: 2 pi * (dayRatio - near.ratio)
//   chance   the share of passes that come within `limit` with the timing
//            left to chance: danger / pi, danger being the angle round the
//            orbit either side of the elevator's stretch that is too near
//   held     true on the resonance, where the timing holds itself
export function elevatorGuidance(h, e, ratios, limit) {
	if (!(e && e.ok && h.shareElevator)) { return null; }
	var near = null;
	ratios.forEach(function (r) { if (!near || Math.abs(h.dayRatio - r.ratio) < Math.abs(h.dayRatio - near.ratio)) { near = r; } });
	var off = h.dayRatio / near.ratio - 1, sum = 0, n = 0;
	walkElevatorPasses(h, e, h.timing, CLOCK_EPOCH, CLOCK_EPOCH + 1.2, limit || DEFAULT_LIMIT, function (pass) {
		sum += Math.min(1, pass.geo.danger / Math.PI); n++;
	});
	return { near: near, off: off, creep: TWO_PI * (h.dayRatio - near.ratio), chance: n ? sum / n : 0, held: Math.abs(off) < 2e-6 };
}

