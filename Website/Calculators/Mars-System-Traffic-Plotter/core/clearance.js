/* Mars-System-Traffic-Plotter/core/clearance — keeping the hanging skyhook's
 * tether clear of the Phobos skyhook's, by timing.
 *
 * Both tethers lie along lines through Mars's centre, so they can only touch
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
import { hangingAt } from "./hanging-skyhook.js";
import { planSidestep } from "./ballast.js";

var O = OrbitalMath;
var DAY = 86400, TWO_PI = 2 * Math.PI;
export var DEFAULT_LIMIT = 200e3;      // least clearance allowed, m
var SLIPS = 24;                        // sidestep sizes tried each way, as 24ths of an orbit
var MAX_SIDESTEPS = 400, MAX_UNAVOIDED = 60;

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

// Go through the passes from jdFrom to jdTo in order, calling visit(pass) for
// each; a visit that returns true stops the walk and that pass is returned.
export function walkPasses(h, p, timing, jdFrom, jdTo, limit, visit) {
	var slant = slantFactor(h), a = hangingAt(h, jdFrom, timing).angle;
	var half = Math.PI / h.omega / DAY;                      // half an orbit, days
	var jd = jdFrom + (Math.ceil(a / Math.PI) * Math.PI - a) / h.omega / DAY;
	while (jd <= jdTo) {
		var cross = crossingNear(h, timing, jd);
		if (cross >= jdFrom) {
			var pass = measurePass(h, p, timing, cross, limit, slant);
			if (visit(pass)) { return pass; }
		}
		// Half an orbit on, at the rate the skyhook is turning now.
		jd = cross + half / (1 + hangingAt(h, cross, timing).slip.rate);
	}
	return null;
}

// The first pass from jdFrom to jdTo closer than `limit`, or null.
export function firstClosePass(h, p, timing, jdFrom, jdTo, limit) {
	return walkPasses(h, p, timing, jdFrom, jdTo, limit, function (pass) { return pass.distance < limit; });
}

// The closest pass from jdFrom to jdTo: { jd, distance, exact }, or null if there is none.
export function closestPass(h, p, timing, jdFrom, jdTo, limit) {
	var best = null;
	walkPasses(h, p, timing, jdFrom, jdTo, limit, function (pass) {
		if (!best || pass.distance < best.distance) { best = pass; }
	});
	return best;
}

// Where round its orbit to start the skyhook at CLOCK_EPOCH: the angle (rad)
// whose closest pass in the first five days is the widest.
export function bestStartAngle(h, p, limit) {
	var best = 0, bestD = -1, N = 72;
	for (var j = 0; j < N; j++) {
		var a0 = j * TWO_PI / N;
		var c = closestPass(h, p, { a0: a0, sidesteps: [] }, CLOCK_EPOCH, CLOCK_EPOCH + 5, limit);
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

// Work out the sidesteps that keep every pass at least `limit` clear, from
// CLOCK_EPOCH over the whole date span (or opts.days of it).
//   h, p   the hanging and Phobos skyhooks' figures; h.timing.a0 is kept
//   opts   { limit (m), days }
// Returns
//   { limit, a0, sidesteps, unavoided, complete, jdReached, closest }
//   sidesteps   in order, each a ballast.js sidestep plus
//               { jdStart, jdEnd, psiBefore, avoids: the close pass it puts off, clearUntil: jd of the next close pass or null }
//   unavoided   [{ jd, jdLast, passes, distance }] spells of close passes no
//               sidestep put off: first and last pass, how many, the closest
//   complete    false when the count of either ran out before the span did;
//               jdReached is how far the working got
//   closest     the closest pass left standing: { jd, distance }, or null
export function workOutSidesteps(h, p, opts) {
	var o = opts || {}, limit = o.limit || DEFAULT_LIMIT;
	var jdEnd = CLOCK_EPOCH + (o.days || SPAN_DAYS), half = Math.PI / h.omega / DAY;
	var timing = { a0: h.timing.a0, sidesteps: [] }, unavoided = [];
	var psiSum = 0, lastEnd = CLOCK_EPOCH, complete = true, jdReached = jdEnd;
	var close = firstClosePass(h, p, timing, CLOCK_EPOCH, jdEnd, limit);
	while (close) {
		if (timing.sidesteps.length >= MAX_SIDESTEPS || unavoided.length >= MAX_UNAVOIDED) {
			complete = false; jdReached = close.jd; break;
		}
		var best = null;
		for (var j = 1; j <= SLIPS; j++) {
			for (var sign = -1; sign <= 1; sign += 2) {
				var plan = quickest(h, sign * j * TWO_PI / SLIPS);
				if (!plan) { continue; }
				var jdStart = Math.max(lastEnd, close.jd - plan.duration / DAY - half);
				var step = Object.assign({ jdStart: jdStart, jdEnd: jdStart + plan.duration / DAY, psiBefore: psiSum }, plan);
				var trial = { a0: timing.a0, sidesteps: timing.sidesteps.concat([step]) };
				var next = firstClosePass(h, p, trial, jdStart, jdEnd, limit);
				var until = next ? next.jd : Infinity;
				if (!best || until > best.until) { best = { step: step, next: next, until: until }; }
				if (until === Infinity) { break; }
			}
			if (best && best.until === Infinity) { break; }
		}
		if (best && best.until > close.jd + 1) {
			best.step.avoids = { jd: close.jd, distance: close.distance };
			best.step.clearUntil = best.next ? best.next.jd : null;
			timing.sidesteps.push(best.step);
			psiSum += best.step.psi; lastEnd = best.step.jdEnd;
			close = best.next;
		} else {
			var spell = unavoided[unavoided.length - 1];
			if (spell && close.jd - spell.jdLast < 1.5) {
				spell.jdLast = close.jd; spell.passes++; spell.distance = Math.min(spell.distance, close.distance);
			} else { unavoided.push({ jd: close.jd, jdLast: close.jd, passes: 1, distance: close.distance }); }
			close = firstClosePass(h, p, timing, close.jd + half / 2, jdEnd, limit);
		}
	}
	var closest = closestPass(h, p, timing, CLOCK_EPOCH, jdReached - half / 2, limit);
	return { limit: limit, a0: timing.a0, sidesteps: timing.sidesteps, unavoided: unavoided,
	         complete: complete, jdReached: jdReached, closest: closest };
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
