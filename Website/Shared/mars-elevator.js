/* Shared/mars-elevator — the Mars space elevator's shape: one tether
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
 * THE CARGO. Cargo going up the tether at a steady net flow weighs on it,
 * and is brought up to the ground's speed by it, pushing it west in return.
 * The tether's equilibrium with both is solved in three dimensions
 * (Shared/meridian-tether.js, leanedTether), the counterweight held at its
 * design distance; at the anchor the lean satisfies
 *
 *     sin(theta) * T0 * x_A = mdot * w * ( x_c^2 - x_A^2 )
 *
 *     theta   the lean west of the anchor's meridian where the tether leaves it
 *     T0      the tension at the anchor, with the cargo aboard
 *     x_A, x_c   the anchor's and the counterweight's distance from the axis
 *     mdot    the net cargo flow up, kg/s
 *     w       Mars's spin rate
 *
 * Past some flow (mostFlow) the two together drag the bottom of the tether
 * down to the ground and no equilibrium is left; such a flow is refused.
 * Every figure below, the curve drawn and the Phobos clearance, is the
 * tether with its cargo aboard. The dodge swing's shape and the pumping are
 * worked out on the tether without it.
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
 *
 * DEIMOS. A tether reaching past Deimos is dodged round its crossings by its
 * slowest north-south swing; the swing's shape along the tether (`swing`,
 * `curve.eta`) is worked out here, but WHEN it swings is a schedule over a
 * span of dates, which belongs to whoever keeps the clock — the Mars System
 * Traffic Plotter (its core/elevator.js). Here the tether stands at rest
 * unless a caller hands elevatorAt a swing.
 *
 * A POINT OF THE TETHER is carried round by Mars's spin, so at distance R
 * from Mars's centre it moves at
 *
 *     v = w x r
 *
 *     w   Mars's spin, as a vector along its pole (Shared/mars-ephemeris.js)
 *     r   the point's position from Mars's centre (pointAt)
 *
 * which is what a ship let go there leaves with, and what a ship caught
 * there has to match.
 *
 * Used by the Mars System Traffic Plotter and by the Mission Planner's space
 * elevator platform (MissionPlanner/modules/space-elevator).
 *
 * Pure (no DOM, no THREE): Node-tested in Shared/tests/ and through both
 * callers' suites. Imports Calculators/Mars-Elevator/marsElevatorModel.js,
 * the workbench calculator that sizes the tether, so the sizing stays in one
 * place.
 */

import { systems } from "./orbit.js";
import { OrbitalMath } from "./math-utils.js";
import { MarsEphemeris as EPH } from "./mars-ephemeris.js";
import { MATERIALS } from "./materials.js";
import { anchorConfig } from "./body-profiles.js";
import { leanedTether, mostFlow } from "./meridian-tether.js";
import { MarsElevator as MEL } from "../Calculators/Mars-Elevator/marsElevatorModel.js";

var O = OrbitalMath;
var DEG = Math.PI / 180, DAY = 86400, TWO_PI = 2 * Math.PI;
var SYS = MEL.marsSystem();
var R_MARS = +systems.get("Mars").radius;
var PHOBOS = anchorConfig("Phobos");

// The defaults are a design for heavy traffic: the anchor on the summit of
// Olympus Mons, a heavy counterweight, and 150 kg/s (about 4.7 Mt a year). lat and lon in degrees
// (north and east positive), rCW the counterweight's distance from Mars's
// centre (m), cwMass its mass (kg), or null for the one that holds the
// structure up three times over. cargoFlow is the net flow of cargo up the
// tether, kg/s, which leans it west.
export var ELEVATOR_DEFAULTS = { lat: 18.65, lon: 226.2, material: "ecnt", safety: 2.4, rCW: 55000e3, cwMass: 700e6, cargoFlow: 150 };
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

function wrap(a) { a = a % TWO_PI; return a > Math.PI ? a - TWO_PI : (a <= -Math.PI ? a + TWO_PI : a); }

// ---- the figures -----------------------------------------------------------------

// Along a tether path { r, x, y, z } (anchor first) at distance R from Mars's
// centre: distance from the axis, height above the plane (on the anchor's
// side) and how far west of the anchor's meridian it stands, as an angle
// about the axis.
export function alongPath(lp, R) {
	var ln = lp.r.length, lo = 0, hi = ln - 1;
	if (R <= lp.r[0]) { hi = 1; } else if (R >= lp.r[hi]) { lo = hi - 1; R = lp.r[hi]; }
	else { while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (lp.r[mid] < R) { lo = mid; } else { hi = mid; } } }
	var t = Math.max(0, Math.min(1, (R - lp.r[lo]) / (lp.r[hi] - lp.r[lo])));
	var x = lp.x[lo] + t * (lp.x[hi] - lp.x[lo]), y = lp.y[lo] + t * (lp.y[hi] - lp.y[lo]), z = lp.z[lo] + t * (lp.z[hi] - lp.z[lo]);
	return { x: Math.hypot(x, y), z: z, west: Math.atan2(-y, x) };
}

// Recently figured designs, so the two callers (and a mission's two ends)
// don't size the same tether twice; a few kept, the oldest dropped.
var MEMO_SIZE = 6;
var memo = new Map();
var mostMemo = new Map();    // the most flow, which doesn't depend on the flow shown
function remember(map, key, make) {
	if (map.has(key)) { var v = map.get(key); map.delete(key); map.set(key, v); return v; }
	var value = make();
	map.set(key, value);
	if (map.size > MEMO_SIZE) { map.delete(map.keys().next().value); }
	return value;
}

// The elevator's shape and figures for one param set (ELEVATOR_DEFAULTS with `params`
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
//   curve     the tether as drawn, anchor first: { x, z, eta, nx, nz, r }
//             — distance from the spin axis and height on the anchor's side
//             of the plane, the dodge swing's displacement along the unit
//             normal (nx, nz), and distance from Mars's centre, all m
//             — and `west`, how far west of the anchor's meridian each point
//             stands under the cargo's lean, as an angle about the axis (rad)
//   stretch   the pumping stretch's first and last indices in `curve`
//   path      the leaned tether in full, anchor first: { r, x, y, z, s }
//             (alongPath reads it), x toward the anchor's meridian, y east
//   lean      the tether with its cargo aboard: { flow (kg/s), angle (west
//             of the meridian at the anchor, rad), elevation (above level at
//             the anchor, rad), side (the sideways pull on the anchor, N),
//             torque (N·m), T0, Tpeak (the tension at the anchor and the
//             peak, N), cargo (kg on the tether at once), atPhobos, atDeimos,
//             atCW ({ angle, distance }: how far west of the anchor's
//             meridian the tether stands there, rad and m; atDeimos null
//             where it ends short of Deimos), most (the most flow it
//             carries, kg/s), mostBy ("ground": past it the tether is drawn
//             down to the ground; "phobos": past it, too near Phobos),
//             mostElevation (how far above level it leaves the anchor at
//             that flow), floor (the least departure the
//             empty tether is sized for, rad) }
//   zCW, zPhobos, zDeimos, phobosClear, phobosTopCap are with the cargo
//   aboard too; length, the masses, Tpeak, T0, Tcw and departure are the
//   tether as sized, empty
export function elevatorShape(params) {
	var p = Object.assign({}, ELEVATOR_DEFAULTS, params || {});
	var key = [p.lat, p.lon, p.material, p.safety, p.rCW, p.cwMass, p.cargoFlow].join("|");
	return remember(memo, key, function () { return figure(p); });
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
	if (!(isFinite(p.cargoFlow) && p.cargoFlow >= 0)) { return fail("flow-range", "The cargo flow up the tether must be zero or more."); }
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

	// The tether as it stands with the cargo aboard, and the most flow it
	// carries: until the bottom of it is drawn down to the ground, or it is
	// drawn so near the equatorial plane that it no longer clears Phobos.
	// The dodge swing's size along the tether is the empty tether's.
	var reaches = p.rCW >= de.peri - de.radius - KEEP_CLEAR;
	var sw = MEL.swings(SYS, sol, { rRef: Math.min(de.a, p.rCW), dodge: DODGE.swing }), slow = sw.modes[0];
	function etaAt(R) { return reaches ? MEL.etaAt(sw.nodes, slow.eta, Math.max(sw.nodes.r[0], Math.min(R, p.rCW * (1 - 1e-12)))) || 0 : 0; }
	function swingAt(rho) { return Math.abs(etaAt(rho)); }
	var topCeiling = R_MARS + (PHOBOS.topCeiling + PHOBOS.swing) * 1e3;
	function clearOf(path) { return phobosClearance(function (rho) { return alongPath(path, rho).z; }, swingAt, Math.min(p.rCW, topCeiling)); }
	// Empty, it must clear Phobos already.
	var pc0 = clearOf(sol.path.y ? sol.path : { r: sol.path.r, x: sol.path.x, y: new Float64Array(sol.path.r.length), z: sol.path.z });
	if (pc0.clear < KEEP_CLEAR) {
		return fail("phobos", "This tether passes " + (pc0.clear > 0 ? "only " + kmText(pc0.clear) + " from" : "through") + " Phobos's reach; "
			+ kmText(KEEP_CLEAR) + " is the least allowed. A lower safety factor, a heavier counterweight or an anchor farther from the equator each lift it farther off the equatorial plane.");
	}
	var mostKey = [p.lat, p.material, p.safety, p.rCW, p.cwMass].join("|");
	var mostV = remember(mostMemo, mostKey, function () {
		var mf = mostFlow(SYS.field, sol, { v: TRAFFIC.vFull, tol: 0.003,
			accept: function (L) { return clearOf(L.path).clear >= KEEP_CLEAR; } });
		return { flow: mf.flow, elevation: mf.at ? mf.at.elevation : 0, by: mf.by };
	}), most = mostV.flow;
	var lt = p.cargoFlow > most * 1.0001 ? { ok: false } : leanedTether(SYS.field, sol, { mdot: p.cargoFlow, v: TRAFFIC.vFull });
	if (!lt.ok) {
		return fail("flow-limit", "This tether carries at most about " + Math.floor(most) + " kg/s (" + (most * 365.25 * DAY / 1e9).toFixed(2) + " Mt a year): "
			+ (mostV.by === "accept"
				? "the cargo's weight draws it down toward the equatorial plane, and past that it passes within " + kmText(KEEP_CLEAR) + " of Phobos's reach."
				: "by then the cargo's weight and its push west together have drawn the bottom of the tether down until it leaves the anchor only "
					+ (mostV.elevation / DEG).toFixed(1) + "° above level, and past that no equilibrium holds it up off the ground.")
			+ " A heavier counterweight, a stronger cable or a lower safety factor carries more.");
	}
	var lp = lt.path, ln = lp.r.length;
	function along(R) { return alongPath(lp, R); }
	function westPoint(R) { var q = along(R); return { angle: q.west, distance: q.west * q.x }; }
	function height(rho) { return along(rho).z; }
	var pc = clearOf(lp);
	if (pc.clear < KEEP_CLEAR) {
		return fail("phobos", "This tether passes " + (pc.clear > 0 ? "only " + kmText(pc.clear) + " from" : "through") + " Phobos's reach"
			+ (p.cargoFlow > 0 ? " with this cargo aboard" : "") + "; " + kmText(KEEP_CLEAR)
			+ " is the least allowed. A lower safety factor, a heavier counterweight, an anchor farther from the equator or less cargo each lift it farther off the equatorial plane.");
	}

	// The drawn curve, thinned from the leaned tether's points.
	var idx = [0];
	for (var i = 1; i < ln - 1; i++) {
		var last = idx[idx.length - 1], want = Math.min(CURVE_STEP[2], CURVE_STEP[0] + CURVE_STEP[1] * (lp.r[last] - anchor.r));
		if (lp.s[i] - lp.s[last] >= want) { idx.push(i); }
	}
	idx.push(ln - 1);
	var n = idx.length, cx = new Float64Array(n), cz = new Float64Array(n), ce = new Float64Array(n);
	var cnx = new Float64Array(n), cnz = new Float64Array(n), cr = new Float64Array(n), cw = new Float64Array(n);
	idx.forEach(function (j, k) {
		cr[k] = lp.r[j]; cz[k] = lp.z[j]; cx[k] = Math.hypot(lp.x[j], lp.y[j]);
		cw[k] = Math.atan2(-lp.y[j], lp.x[j]);
		ce[k] = etaAt(lp.r[j]);
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

	var nd = sw.nodes;
	var pumping = reaches ? MEL.pumping({ nodes: nd, mode: slow, rA: anchor.r, from: TRAFFIC.from, to: TRAFFIC.to,
		cycles: TRAFFIC.cycles, vFull: TRAFFIC.vFull, vSlow: TRAFFIC.vSlow }) : null;
	var lon = wrap(p.lon * DEG);
	var cwAt = along(p.rCW);
	return {
		ok: true, id: "spaceElevator", kind: "spaceElevator",
		lat: p.lat * DEG, lon: lon, side: side, rA: anchor.r, rCW: p.rCW,
		material: p.material, safety: p.safety,
		cwMass: sized.M, mult: sized.mult, raised: sized.raised, asked: sized.asked,
		length: sol.length, cableMass: sol.mass, trackMass: sol.trackMass,
		Tpeak: sol.Tpeak, rPeak: sol.rPeak, T0: sol.T0, Tcw: sol.Tcw, departure: sol.departure,
		zCW: cwAt.z, zPhobos: height(ph.a), zDeimos: reaches ? height(de.a) : null,
		phobosClear: pc.clear,
		phobosTopCap: pc.capRadius == null ? null : pc.capRadius - PHOBOS.swing * 1e3 - R_MARS,
		release: MEL.releaseOrbit(SYS, p.rCW),
		swing: reaches ? { period: slow.period, omega: slow.omega, energy: slow.energy, atPhobos: slow.atPhobos, atCW: slow.atCW } : null,
		pumping: pumping,
		curve: { x: cx, z: cz, eta: ce, nx: cnx, nz: cnz, r: cr, west: cw }, stretch: [sLo, sHi], path: lp,
		lean: { flow: p.cargoFlow, angle: lt.lean, side: lt.side, torque: lt.torque, elevation: lt.elevation,
			T0: lt.T0, Tpeak: lt.Tpeak, cargo: lt.cargo,
			atPhobos: westPoint(ph.a), atDeimos: reaches ? westPoint(de.a) : null, atCW: westPoint(p.rCW),
			most: most, mostBy: mostV.by === "accept" ? "phobos" : "ground", mostElevation: mostV.elevation, floor: MEL.MIN_DEPARTURE }
	};
}

// ---- on the clock ------------------------------------------------------------------

var AT_REST = { d: 0, size: 0, trend: 0 };

// Where the elevator is at Julian date jd:
//   out, pole, east   unit vectors from the spin axis toward the anchor's
//               meridian, along the spin axis (north), and east at the anchor
//   spin        Mars's spin as a vector, rad/s
//   swing       the dodge swing then, as given ({ d (displacement north at
//               Deimos's distance, m), size, trend }); at rest when not given
//   q           the swing as a fraction of the full dodge swing, signed along
//               the curve's own normal
export function elevatorAt(fig, jd, swing) {
	var o = EPH.orientation(jd);
	var out = O.vAdd(O.vScale(o.meridian, Math.cos(fig.lon)), O.vScale(o.east, Math.sin(fig.lon)));
	swing = swing || AT_REST;
	return { out: out, pole: o.pole, east: O.vCross(o.pole, out), spin: O.vScale(o.pole, o.rate), swing: swing,
	         q: fig.side * swing.d / DODGE.swing };
}

// Position from Mars's centre (m, ecliptic axes) of point k of the curve,
// where the elevator is as elevatorAt gave it: swung by the dodge in its own
// plane, then turned west about the axis by the lean.
export function elevatorPoint(fig, at, k) {
	var c = fig.curve, e = at.q * c.eta[k], x = c.x[k] + e * c.nx[k], w = c.west[k];
	var across = O.vAdd(O.vScale(at.out, Math.cos(w)), O.vScale(at.east, -Math.sin(w)));
	return O.vAdd(O.vScale(across, x), O.vScale(at.pole, fig.side * (c.z[k] + e * c.nz[k])));
}

// The point of the tether at distance R from Mars's centre (m), where the
// elevator is as elevatorAt gave it, at rest (the dodge swing left out):
// { r, v } from Mars's centre, ecliptic axes, plus
//   x, z        its distance from the spin axis and height on the anchor's
//               side of the equatorial plane, m
//   west        how far west of the anchor's meridian it stands, rad
// R is held to the tether, anchor to counterweight. v is w x r (header).
export function pointAt(fig, at, R) {
	var lp = fig.path, q = alongPath(lp, Math.max(lp.r[0], Math.min(R, lp.r[lp.r.length - 1])));
	var across = O.vAdd(O.vScale(at.out, Math.cos(q.west)), O.vScale(at.east, -Math.sin(q.west)));
	var r = O.vAdd(O.vScale(across, q.x), O.vScale(at.pole, fig.side * q.z));
	return { r: r, v: O.vCross(at.spin, r), x: q.x, z: q.z, west: q.west };
}
