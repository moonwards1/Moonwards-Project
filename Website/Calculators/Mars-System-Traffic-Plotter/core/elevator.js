/* Mars-System-Traffic-Plotter/core/elevator — the space elevator: one tether
 * from an anchor off Mars's equator, bowing toward the equatorial plane and
 * running out past areostationary orbit to a counterweight.
 *
 * THE TETHER is Shared/meridian-tether.js in Mars's field, sized by
 * Calculators/Mars-Elevator/marsElevatorModel.js (whose README derives it):
 * the cable and its track, held by a counterweight. It lies in the meridian
 * plane of its anchor, which turns with Mars, so a point of it at distance x
 * from the spin axis and height z above the equatorial plane is at
 *
 *     r = x * ( m cos(lon) + e sin(lon) ) + z * p
 *
 *     m, e, p   Mars's prime-meridian, 90-degrees-east and pole directions
 *               at that instant (Shared/mars-ephemeris.js)
 *     lon       the anchor's east longitude
 *
 * The anchor stands on the areoid: the ground's own height is left out.
 *
 * PHOBOS. A tether built on Phobos lies along the line from Mars's centre
 * through Phobos, whose orbit is tilted i = 1.08 degrees to the equator, so
 * its point at distance rho from Mars's centre gets as far as
 *
 *     rho * sin(i)
 *
 * from the equatorial plane, on either side. The elevator's tether is at
 * height z_e(rho) there, less the dodge swing's size when it is swinging.
 * Phobos's tether may reach out only as far as the two stay KEEP_CLEAR
 * apart:
 *
 *     z_e(rho) - swing(rho) - rho * sin(i)  >=  KEEP_CLEAR
 *
 * and the elevator itself must pass Phobos (at its apoapsis, its radius
 * added) by the same margin, or the design is refused.
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
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { MarsEphemeris as EPH } from "../../../Shared/mars-ephemeris.js";
import { MATERIALS } from "../../../Shared/materials.js";
import { anchorConfig } from "../../../Shared/body-profiles.js";
import { MarsElevator as MEL } from "../../Mars-Elevator/marsElevatorModel.js";
import { CLOCK_EPOCH, SPAN_DAYS } from "./clock.js";

var O = OrbitalMath;
var DEG = Math.PI / 180, DAY = 86400, TWO_PI = 2 * Math.PI;
var SYS = MEL.marsSystem();
var R_MARS = +systems.get("Mars").radius;
var PHOBOS = anchorConfig("Phobos");

// The anchor's default is the summit of Olympus Mons. lat and lon in degrees
// (north and east positive), rCW the counterweight's distance from Mars's
// centre (m), cwMass its mass (kg), or null for the one that holds the
// structure up three times over.
export var ELEVATOR_DEFAULTS = { lat: 18.65, lon: 226.2, material: "ecnt", safety: 2.5, rCW: 51000e3, cwMass: null };
// The cable materials on offer, each with the range its safety factor may take.
export var ELEVATOR_MATERIALS = {
	ecnt: { label: MATERIALS.ecnt.name, safety: [1.5, 3] },
	mwcnt: { label: MATERIALS.mwcnt.name, safety: [1.5, 4] }
};
export var LAT_MAX = 20;               // degrees either side of the equator
export var CW_MAX = 100000e3;          // the farthest the counterweight may be set, m from Mars's centre
// The least distance kept between the elevator's tether and Phobos or
// anything built on it, m.
export var KEEP_CLEAR = 50e3;
// The Deimos dodge: a crossing whose miss is under half `band` is dodged,
// with a swing of `swing` at Deimos's distance (m).
export var DODGE = { band: 100e3, swing: 60e3 };
// Pumping the swing: climbers are held on the stretch from `from` to `to`
// above the anchor's distance from the centre (m) for half of each swing, to
// build it up in `cycles` swings; they cross it at vFull, or at vSlow while
// held (m/s).
export var TRAFFIC = { from: 400e3, to: 800e3, cycles: 6, vFull: 200, vSlow: 20 };
// Hazard crossings no further apart than this many crossings of Deimos are
// dodged in one spell, the swing carried from one to the next.
var CHAIN_CROSSINGS = 3.2;
// Crossings are worked out this far either side of the clock's span, so a
// spell that straddles its start or end is whole.
var MARGIN_DAYS = 40;
var CURVE_STEP = [5e3, 0.01, 100e3];   // drawn points: 5 km apart at the anchor, 1% of the height further up, 100 km at most

function fail(code, message) { return { ok: false, id: "spaceElevator", kind: "spaceElevator", diagnostic: { code: code, message: message, values: {} } }; }
function kmText(m) { return Math.round(m / 1e3).toLocaleString("en-US") + " km"; }

// ---- Phobos ------------------------------------------------------------------

// How near the tether comes to Phobos, and how far out a tether built on
// Phobos may reach. `height(rho)` is the elevator's height above the plane
// (m, the anchor's side positive) at distance rho from Mars's centre, and
// `swing(rho)` the dodge swing's size there (m). Returns
//   clear   the tether's distance from Phobos's reach at Phobos's apoapsis, m
//   capRadius   the distance from Mars's centre at which a tether along the
//               Mars-Phobos line first comes within KEEP_CLEAR of the
//               elevator's, m; null when it never does short of `rEnd`
function phobosClearance(height, swing, rEnd) {
	var ph = SYS.phobos, sinI = Math.sin(ph.tilt);
	function gap(rho) { return height(rho) - swing(rho) - rho * sinI; }
	var clear = gap(ph.apo) - ph.radius, capRadius = null, step = 10e3;
	for (var rho = ph.apo; rho < rEnd; rho += step) {
		var a = gap(rho) - KEEP_CLEAR, next = Math.min(rho + step, rEnd), b = gap(next) - KEEP_CLEAR;
		if (a >= 0 && b < 0) { capRadius = rho + (next - rho) * a / (a - b); break; }
		if (a < 0) { capRadius = rho; break; }
	}
	return { clear: clear, capRadius: capRadius };
}

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
// on top). Returns { ok: false, diagnostic } or { ok: true, ... } in SI:
//   lat, lon (rad), side (+1 north, -1 south), rA, rCW
//   cwMass, mult, raised (null | "multiple" | "departure"), asked
//   length, cableMass, trackMass, Tpeak, rPeak, T0, Tcw, departure (rad)
//   zCW, zPhobos, zDeimos   the tether's distance from the equatorial plane
//             at the counterweight and at the moons' distances (zDeimos null
//             where the tether ends short of Deimos)
//   phobosClear, phobosTopCap   phobosClearance's clear, and the highest a
//             Phobos tether's top may be set (m above Mars's mean radius,
//             with Phobos at its mean distance), or null where the elevator
//             sets no limit
//   release   the orbit of a ship let go at the counterweight (releaseOrbit)
//   swing     the dodge swing: { period, omega, energy, atPhobos, atCW }, or
//             null where the tether ends short of Deimos
//   pumping   marsElevatorModel's pumping figures for TRAFFIC, or null
//   dodges    planDodges's result over the clock's span, or null
//   curve     the tether as drawn, anchor first: { x, z, eta, nx, nz, r }
//             — distance from the spin axis and height on the anchor's side
//             of the plane, the dodge swing's displacement along the unit
//             normal (nx, nz), and distance from Mars's centre, all m
//   stretch   the pumping stretch's first and last indices in `curve`
export function elevatorFigures(params) {
	var p = Object.assign({}, ELEVATOR_DEFAULTS, params || {});
	var key = [p.lat, p.lon, p.material, p.safety, p.rCW, p.cwMass].join("|");
	if (memo.key !== key) { memo = { key: key, value: figure(p) }; }
	return memo.value;
}

function figure(p) {
	var mat = ELEVATOR_MATERIALS[p.material], m = MATERIALS[p.material];
	if (!mat) { return fail("material", "The space elevator's cable is early or mature carbon nanotube."); }
	if (!(isFinite(p.lat) && isFinite(p.lon) && isFinite(p.safety) && isFinite(p.rCW))) {
		return fail("bad-params", "The space elevator needs a number in every field.");
	}
	if (!(Math.abs(p.lat) <= LAT_MAX)) { return fail("lat-range", "The anchor must be within " + LAT_MAX + "° of the equator."); }
	if (!(p.lon >= -180 && p.lon <= 360)) { return fail("lon-range", "The anchor's longitude runs from 0° to 360° east (or 180° west to 180° east)."); }
	if (!(p.safety >= mat.safety[0] && p.safety <= mat.safety[1])) {
		return fail("safety-range", "With " + mat.label.toLowerCase() + " the safety factor must be between " + mat.safety[0] + " and " + mat.safety[1] + ".");
	}
	if (p.cwMass != null && !(p.cwMass > 0)) { return fail("mass-range", "The counterweight's mass must be more than nothing; leave it empty for the usual one."); }
	if (!(p.rCW > SYS.rStat && p.rCW <= CW_MAX)) {
		return fail("cw-range", "The counterweight must be between " + kmText(SYS.rStat) + " from Mars's centre (areostationary orbit, beyond which it pulls outward) and " + kmText(CW_MAX) + ".");
	}
	var side = p.lat < 0 ? -1 : 1, anchor = MEL.anchor(SYS, Math.abs(p.lat), 0);
	var sized = MEL.sizeStructure(SYS, { lat: anchor.lat, rA: anchor.r, rCW: p.rCW, density: m.density, sigmaEff: m.strength / p.safety, mass: p.cwMass });
	if (!sized.ok) {
		return fail("no-landing", sized.why === "inside" ? "The counterweight must sit beyond areostationary orbit to pull the structure up."
			: "No counterweight at this distance makes the tether land at the anchor.");
	}
	var sol = sized.sol, de = SYS.deimos, ph = SYS.phobos;
	// The tether meets Deimos's orbit unless it ends short of it.
	var reaches = p.rCW >= de.peri - de.radius - KEEP_CLEAR;
	var sw = MEL.swings(SYS, sol, { rRef: Math.min(de.a, p.rCW), dodge: DODGE.swing }), slow = sw.modes[0];
	function height(rho) { return rho >= p.rCW ? sol.zCW : MEL.heightAtRadius(sol, rho); }
	function swingAt(rho) { return reaches ? Math.abs(MEL.etaAt(sw.nodes, slow.eta, Math.min(rho, p.rCW * (1 - 1e-12)))) || 0 : 0; }

	var topCeiling = R_MARS + (PHOBOS.topCeiling + PHOBOS.swing) * 1e3;
	var pc = phobosClearance(height, swingAt, Math.min(p.rCW, topCeiling));
	if (pc.clear < KEEP_CLEAR) {
		return fail("phobos", "This tether passes " + (pc.clear > 0 ? "only " + kmText(pc.clear) + " from" : "through") + " Phobos's reach; "
			+ kmText(KEEP_CLEAR) + " is the least allowed. A lower safety factor, a heavier counterweight or an anchor farther from the equator each lift it farther off the equatorial plane.");
	}

	// The drawn curve, thinned from the swing's nodes.
	var nd = sw.nodes, N = nd.r.length, idx = [0];
	for (var i = 1; i < N - 1; i++) {
		var last = idx[idx.length - 1], want = Math.min(CURVE_STEP[2], CURVE_STEP[0] + CURVE_STEP[1] * (nd.r[last] - anchor.r));
		if (nd.s[i] - nd.s[last] >= want) { idx.push(i); }
	}
	idx.push(N - 1);
	var n = idx.length, cx = new Float64Array(n), cz = new Float64Array(n), ce = new Float64Array(n);
	var cnx = new Float64Array(n), cnz = new Float64Array(n), cr = new Float64Array(n);
	idx.forEach(function (j, k) {
		cr[k] = nd.r[j]; cz[k] = nd.z[j]; cx[k] = Math.sqrt(Math.max(0, nd.r[j] * nd.r[j] - nd.z[j] * nd.z[j]));
		ce[k] = reaches ? slow.eta[j] : 0;
	});
	for (var k = 0; k < n; k++) {
		var a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), tx = cx[b] - cx[a], tz = cz[b] - cz[a], len = Math.hypot(tx, tz) || 1;
		cnx[k] = -tz / len; cnz[k] = tx / len;
	}
	var sLo = 0, sHi = 0;
	for (var k = 0; k < n; k++) {
		if (cr[k] <= anchor.r + TRAFFIC.from) { sLo = k; }
		if (cr[k] <= anchor.r + TRAFFIC.to) { sHi = k; }
	}

	var pumping = reaches ? MEL.pumping({ nodes: nd, mode: slow, rA: anchor.r, from: TRAFFIC.from, to: TRAFFIC.to,
		cycles: TRAFFIC.cycles, vFull: TRAFFIC.vFull, vSlow: TRAFFIC.vSlow }) : null;
	var lon = wrap(p.lon * DEG), dodges = null;
	if (reaches) {
		var crossings = deimosCrossings(lon, CLOCK_EPOCH - MARGIN_DAYS, CLOCK_EPOCH + SPAN_DAYS + MARGIN_DAYS);
		crossings.forEach(function (c) { c.miss = c.z - side * height(c.rho); });
		dodges = planDodges(crossings, slow.omega);
	}
	return {
		ok: true, id: "spaceElevator", kind: "spaceElevator",
		lat: p.lat * DEG, lon: lon, side: side, rA: anchor.r, rCW: p.rCW,
		material: p.material, safety: p.safety,
		cwMass: sized.M, mult: sized.mult, raised: sized.raised, asked: sized.asked,
		length: sol.length, cableMass: sol.mass, trackMass: sol.trackMass,
		Tpeak: sol.Tpeak, rPeak: sol.rPeak, T0: sol.T0, Tcw: sol.Tcw, departure: sol.departure,
		zCW: sol.zCW, zPhobos: height(ph.a), zDeimos: reaches ? height(de.a) : null,
		phobosClear: pc.clear,
		phobosTopCap: pc.capRadius == null ? null : pc.capRadius - PHOBOS.swing * 1e3 - R_MARS,
		release: MEL.releaseOrbit(SYS, p.rCW),
		swing: reaches ? { period: slow.period, omega: slow.omega, energy: slow.energy, atPhobos: slow.atPhobos, atCW: slow.atCW } : null,
		pumping: pumping, dodges: dodges,
		curve: { x: cx, z: cz, eta: ce, nx: cnx, nz: cnz, r: cr }, stretch: [sLo, sHi]
	};
}

// ---- on the clock ------------------------------------------------------------------

// Where the elevator is at Julian date jd:
//   out, pole   unit vectors from the spin axis toward the anchor's meridian,
//               and along the spin axis (north)
//   spin        Mars's spin as a vector, rad/s
//   swing       swingFrom's result: the dodge swing then
//   q           the swing as a fraction of the full dodge swing, signed along
//               the curve's own normal
export function elevatorAt(fig, jd) {
	var o = EPH.orientation(jd);
	var out = O.vAdd(O.vScale(o.meridian, Math.cos(fig.lon)), O.vScale(o.east, Math.sin(fig.lon)));
	var swing = fig.dodges ? swingFrom(fig.dodges.knots, fig.swing.omega, jd) : { d: 0, size: 0, trend: 0 };
	return { out: out, pole: o.pole, spin: O.vScale(o.pole, o.rate), swing: swing, q: fig.side * swing.d / DODGE.swing };
}

// Position from Mars's centre (m, ecliptic axes) of point k of the curve,
// where the elevator is as elevatorAt gave it.
export function elevatorPoint(fig, at, k) {
	var c = fig.curve, e = at.q * c.eta[k];
	return O.vAdd(O.vScale(at.out, c.x[k] + e * c.nx[k]), O.vScale(at.pole, fig.side * (c.z[k] + e * c.nz[k])));
}

// The dodging spell under way at jd, else the next, else the last; null if there is none.
export function spellAt(fig, jd) {
	var list = fig.dodges ? fig.dodges.spells : [];
	for (var i = 0; i < list.length; i++) { if (list[i].jdEnd >= jd) { return list[i]; } }
	return list.length ? list[list.length - 1] : null;
}
