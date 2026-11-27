/* Mars-System-Traffic-Plotter/core/elevator — the space elevator on this
 * plotter's clock: its shape, and Deimos's crossings and the dodges.
 *
 * THE SHAPE — the tether off its anchor, its cargo's lean, the Phobos
 * clearance, the limit it puts on a Phobos tether, the dodge swing's shape —
 * is Shared/mars-elevator.js, which the Mission Planner's space elevator uses
 * too; its header gives the formulas. This file adds what depends on a span
 * of dates: when Deimos crosses the tether, and the swing that dodges it.
 *
 * DEIMOS crosses the tether's meridian plane once every 131 h. At each
 * crossing its height above the equatorial plane, less the tether's at the
 * same distance, is its MISS (positive: Deimos passes north of the tether).
 * A crossing with a miss under half the trigger band is dodged: the tether's
 * slowest north-south swing is built up beforehand by timing climber traffic
 * on a slanted stretch low down, so that the tether stands at the far end of
 * its swing, on the side away from Deimos, as Deimos crosses.
 *
 * The swing is followed as a phasor c: the tether's displacement north at
 * Deimos's distance is
 *
 *     d(t) = Re( c(t) * exp(i W (t - t0)) )
 *
 *     W     the swing's own angular frequency (its period is near one day)
 *     c     its size and phase, which only the traffic changes
 *
 * A dodge needs c = D * dir * exp(-i W (t_pass - t0)) at the crossing (D the
 * dodge swing, dir +1 north or -1 south). Traffic moves c by at most D in
 * `cycles` swings, the build-up the pumping load is sized for. So a spell of
 * dodging runs: build up from rest, straight on to the phasor each further
 * crossing needs while crossings keep coming (a third pass apart, 16.4
 * days), then back to rest.
 * *
 * The dodges are planned over the plotter's span (core/clock.js), with a
 * margin either side so a spell straddling an end is whole.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { MarsEphemeris as EPH } from "../../../Shared/mars-ephemeris.js";
import { MarsElevator as MEL } from "../../Mars-Elevator/marsElevatorModel.js";
import { ELEVATOR_DEFAULTS, ELEVATOR_MATERIALS, LAT_MAX, CW_MAX, KEEP_CLEAR, DODGE, TRAFFIC,
         alongPath, elevatorShape, elevatorAt as shapeAt, elevatorPoint } from "../../../Shared/mars-elevator.js";
import { CLOCK_EPOCH, SPAN_DAYS } from "./clock.js";

export { ELEVATOR_DEFAULTS, ELEVATOR_MATERIALS, LAT_MAX, CW_MAX, KEEP_CLEAR, DODGE, TRAFFIC, elevatorPoint };

var O = OrbitalMath;
var DAY = 86400, TWO_PI = 2 * Math.PI;
var SYS = MEL.marsSystem();
// Hazard crossings no further apart than this many crossings of Deimos are
// dodged in one spell, the swing carried from one to the next.
var CHAIN_CROSSINGS = 3.2;
// Crossings are worked out this far either side of the clock's span, so a
// spell that straddles its start or end is whole.
var MARGIN_DAYS = 40;

// ---- Deimos ------------------------------------------------------------------

function wrap(a) { a = a % TWO_PI; return a > Math.PI ? a - TWO_PI : (a <= -Math.PI ? a + TWO_PI : a); }

// Every crossing of the meridian plane at east longitude lon (rad) by Deimos
// between two Julian dates: [{ jd, rho (its distance from Mars's centre, m),
// z (its height above the equatorial plane, m, north positive) }].
export function deimosCrossings(lon, jdFrom, jdTo) {
	// Deimos goes round slower than Mars turns, so it drifts west over the ground.
	var rate = TWO_PI / SYS.deimos.period - SYS.omega, tCross = TWO_PI / Math.abs(rate) / DAY;
	function ahead(jd) { return wrap(EPH.groundPoint(EPH.moonState("Deimos", jd).r, jd).lon - lon); }
	var out = [], d0 = ahead(jdFrom), jd = jdFrom + (d0 >= 0 ? d0 : d0 + TWO_PI) / Math.abs(rate) / DAY;
	while (jd <= jdTo) {
		for (var k = 0; k < 4; k++) { jd += ahead(jd) / Math.abs(rate) / DAY; }
		if (jd > jdTo) { break; }
		var r = EPH.moonState("Deimos", jd).r;
		out.push({ jd: jd, rho: O.vMag(r), z: O.vDot(r, EPH.pole) });
		jd += tCross;
	}
	return out;
}

// The phasors a run of hazard crossings is dodged with: one [re, im] per
// crossing. A lone crossing gets the full swing, standing away from Deimos.
// Crossings that follow closely may need phasors the traffic cannot get
// between in the time, so every phasor on a grid over the disc of the full
// swing is tried for each, keeping the path that the traffic can follow
// (`reach` m of phasor per day) and that leaves the least of the misses as
// large as it can be, moving the phasor least among equals.
function chainPhasors(run, need, reach) {
	var D = DODGE.swing, first = need(run[0]);
	if (run.length === 1) { return [first]; }
	var turn = Math.atan2(first[1], first[0]), grid = [[0, 0]];
	for (var ring = 1; ring <= 3; ring++) {
		for (var k = 0; k < 36; k++) { grid.push([D * ring / 3 * Math.cos(turn + k * TWO_PI / 36), D * ring / 3 * Math.sin(turn + k * TWO_PI / 36)]); }
	}
	// Deimos's miss at crossing j with the phasor at grid point g.
	function miss(j, g) { var n = need(run[j]); return Math.abs(run[j].miss) + (grid[g][0] * n[0] + grid[g][1] * n[1]) / D; }
	var G = grid.length, best = [], from = [];
	best[0] = grid.map(function (c, g) { return { least: miss(0, g), moved: Math.hypot(c[0], c[1]) }; });
	for (var j = 1; j < run.length; j++) {
		var far = reach * (run[j].jd - run[j - 1].jd);
		best[j] = []; from[j] = [];
		for (var g = 0; g < G; g++) {
			var top = null, via = -1;
			for (var h = 0; h < G; h++) {
				var step = Math.hypot(grid[g][0] - grid[h][0], grid[g][1] - grid[h][1]);
				if (step > far) { continue; }
				var cand = { least: Math.min(best[j - 1][h].least, miss(j, g)), moved: best[j - 1][h].moved + step };
				if (!top || cand.least > top.least + 1 || (cand.least > top.least - 1 && cand.moved < top.moved)) { top = cand; via = h; }
			}
			best[j][g] = top || { least: -Infinity, moved: Infinity };
			from[j][g] = via;
		}
	}
	var end = 0, last = run.length - 1;
	for (var g = 1; g < G; g++) {
		var x = best[last][g], y = best[last][end];
		if (x.least > y.least + 1 || (x.least > y.least - 1 && x.moved < y.moved)) { end = g; }
	}
	var out = [];
	for (var j = last; j >= 0; j--) { out[j] = grid[end]; end = j > 0 ? from[j][end] : end; }
	return out;
}

// The dodges for a list of crossings, each carrying `miss` (m).
//   omega    the swing's angular frequency, rad/s
// Returns { passes, spells, knots, closest }:
//   passes   the crossings, each with hazard (to be dodged), dir (+1: the
//            tether is to stand north of its rest line as Deimos crosses, -1
//            south), swing (the tether's displacement north then, m) and
//            actual (Deimos's miss with the tether where the swing has it, m)
//   spells   [{ jdStart, jdEnd, passes (the hazard crossings in it) }]: from
//            the first load timing to the swing at rest again
//   knots    [{ jd, re, im }]: the swing's phasor, straight between knots and
//            at rest outside them (m, north at Deimos's distance, against
//            CLOCK_EPOCH)
//   closest  the crossing with the least |actual|, or null
export function planDodges(crossings, omega) {
	var D = DODGE.swing, period = TWO_PI / omega;
	var reach = D / (TRAFFIC.cycles * period) * DAY;              // the phasor's most, m a day
	var rate = Math.abs(TWO_PI / SYS.deimos.period - SYS.omega);
	var chain = Math.max(2 * TRAFFIC.cycles * period, CHAIN_CROSSINGS * TWO_PI / rate) / DAY;
	var passes = crossings.map(function (c) {
		var hazard = Math.abs(c.miss) < DODGE.band / 2;
		return Object.assign({}, c, { hazard: hazard, dir: hazard ? (c.miss > 0 ? -1 : 1) : 0, swing: 0, actual: c.miss });
	});
	function need(p) {
		var ang = -omega * (p.jd - CLOCK_EPOCH) * DAY;
		return [p.dir * D * Math.cos(ang), p.dir * D * Math.sin(ang)];
	}
	var hz = passes.filter(function (p) { return p.hazard; }), knots = [], spells = [];
	for (var i = 0; i < hz.length; i++) {
		var run = [hz[i]];
		while (i + 1 < hz.length && hz[i + 1].jd - hz[i].jd <= chain) { run.push(hz[++i]); }
		var cs = chainPhasors(run, need, reach), last = run.length - 1;
		var spell = { jdStart: run[0].jd - Math.hypot(cs[0][0], cs[0][1]) / reach,
		              jdEnd: run[last].jd + Math.hypot(cs[last][0], cs[last][1]) / reach, passes: run };
		knots.push({ jd: spell.jdStart, re: 0, im: 0 });
		run.forEach(function (p, j) { knots.push({ jd: p.jd, re: cs[j][0], im: cs[j][1] }); });
		knots.push({ jd: spell.jdEnd, re: 0, im: 0 });
		spells.push(spell);
	}
	var closest = null;
	passes.forEach(function (p) {
		p.swing = swingFrom(knots, omega, p.jd).d;
		p.actual = p.miss - p.swing;
		if (!closest || Math.abs(p.actual) < Math.abs(closest.actual)) { closest = p; }
	});
	return { passes: passes, spells: spells, knots: knots, closest: closest };
}

// The swing at jd from a phasor's knots: { d (displacement north at Deimos's
// distance, m), size (the swing's size then, m), trend (+1 growing, -1
// dying down, 0 steady or at rest) }.
function swingFrom(knots, omega, jd) {
	var lo = 0, hi = knots.length - 1;
	if (hi < 1 || jd <= knots[0].jd || jd >= knots[hi].jd) { return { d: 0, size: 0, trend: 0 }; }
	while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (knots[mid].jd <= jd) { lo = mid; } else { hi = mid; } }
	var a = knots[lo], b = knots[hi], f = (jd - a.jd) / (b.jd - a.jd);
	var re = a.re + f * (b.re - a.re), im = a.im + f * (b.im - a.im), ang = omega * (jd - CLOCK_EPOCH) * DAY;
	var sa = Math.hypot(a.re, a.im), sb = Math.hypot(b.re, b.im);
	return { d: re * Math.cos(ang) - im * Math.sin(ang), size: Math.hypot(re, im),
	         trend: sb > sa + 1 ? 1 : (sb < sa - 1 ? -1 : 0) };
}

// ---- the figures -----------------------------------------------------------------

var memo = { key: null, value: null };

// The elevator's figures for one param set (ELEVATOR_DEFAULTS with `params`
// on top): Shared/mars-elevator.js's elevatorShape — see its list — plus
//   dodges    planDodges's result over the clock's span, or null where the
//             tether ends short of Deimos
export function elevatorFigures(params) {
	var shape = elevatorShape(params);
	if (!shape.ok) { return shape; }
	if (memo.key !== shape) { memo = { key: shape, value: withDodges(shape) }; }
	return memo.value;
}

function withDodges(shape) {
	var dodges = null, de = SYS.deimos;
	if (shape.swing) {
		// Deimos crosses the tether where it stands at Deimos's distance, west of the anchor's meridian by the lean.
		var crossings = deimosCrossings(shape.lon - alongPath(shape.path, de.a).west, CLOCK_EPOCH - MARGIN_DAYS, CLOCK_EPOCH + SPAN_DAYS + MARGIN_DAYS);
		crossings.forEach(function (c) { c.miss = c.z - shape.side * alongPath(shape.path, c.rho).z; });
		dodges = planDodges(crossings, shape.swing.omega);
	}
	return Object.assign({}, shape, { dodges: dodges });
}

// ---- on the clock ------------------------------------------------------------------

// Where the elevator is at Julian date jd (Shared/mars-elevator.js's
// elevatorAt), swung by the dodges as this plotter's clock has them.
export function elevatorAt(fig, jd) {
	return shapeAt(fig, jd, fig.dodges ? swingFrom(fig.dodges.knots, fig.swing.omega, jd) : null);
}

// The dodging spell under way at jd, else the next, else the last; null if there is none.
export function spellAt(fig, jd) {
	var list = fig.dodges ? fig.dodges.spells : [];
	for (var i = 0; i < list.length; i++) { if (list[i].jdEnd >= jd) { return list[i]; } }
	return list.length ? list[list.length - 1] : null;
}
