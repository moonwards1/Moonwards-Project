/* Mars-System-Traffic-Plotter/core/hanging-skyhook — the hanging skyhook: a
 * tether held upright on its own orbit of Mars, tilted to the equator.
 *
 * ITS ORBIT. The tether lies along the line from Mars's centre through its
 * balance point (BP), which goes round a circle at
 *
 *     w = sqrt( GM / r_c^3 )
 *
 *     r_c   the BP's distance from Mars's centre
 *     GM    Mars's gravitational parameter
 *
 * so a point at radius r moves at w * r: slower than a free orbit below the
 * BP, faster above it. Mars's equatorial bulge turns the orbit's plane
 * about Mars's spin axis, the tilt staying as it is:
 *
 *     dNode/dt = -k * cos(i)
 *     k = (3/2) J2 GM Req^2 * sum( m / r^3 ) / ( w * sum( m r^2 ) )
 *
 *     i        the orbit's tilt to Mars's equator
 *     J2, Req  the bulge's coefficient and its reference radius (orbit.js)
 *     m, r     every piece of the skyhook (OrbitalMath.j2NodeCoefficient)
 *
 * SUN-SYNCHRONOUS is the tilt at which the plane turns once a Mars year, the
 * way the Sun goes round: cos(i) = -n_Sun / k. The plane starts the clock
 * face-on to the Sun, the orbit running over the line between day and night.
 * The bulge's small effect on the rate round the orbit is left out.
 *
 * The direction of the tether at an instant:
 *
 *     u = cos(a) * N + sin(a) * M
 *
 *     N   unit vector from Mars's centre to where the orbit rises through the equator
 *     M   a quarter turn on round the orbit from N
 *     a   the angle round the orbit from N: a0 + w * t + whatever its sidesteps
 *         have slipped it (core/ballast.js)
 *
 * ITS MASSES are the Hanging-skyhooks calculator's model of a tether of
 * constant stress with a station at each end, an anchor station placed where
 * it balances the two halves, and two lots of ballast riding at their home
 * altitudes: one that may be anywhere on the tether, one above the BP
 *
 * RESONANCES. The tether passes through the plane of Phobos's orbit twice an
 * orbit. With p orbits of the skyhook to q turns of Phobos (both counted
 * against the skyhook's own node line), those passes find Phobos's tether in
 * a fixed set of D directions as seen from the passing tether, evenly spaced:
 *
 *     D = denominator of (p - q) / (2 p) in lowest terms
 *     gap = 180 deg / D
 *
 * and timed to fall midway between them, the Phobos tether is never nearer
 * than `gap` round Mars from a pass.
 *
 * A space elevator's tether is carried through the plane of the orbit twice
 * for each turn of Mars against the skyhook's node line (a Mars day, where
 * the plane keeps pace with the Sun). With a whole number of orbits to one
 * or two of those turns, the skyhook is at the same few places round its
 * orbit every time the elevator's tether comes through.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { MarsEphemeris as ME } from "../../../Shared/mars-ephemeris.js";
import { MATERIALS } from "../../../Shared/materials.js";
import { footFloor } from "../../../Shared/body-profiles.js";
import { computeSkyhook, massPoints } from "../../Hanging-skyhooks/skyhookModel.js";
import { CLOCK_EPOCH } from "./clock.js";
import { ballastResponse, sidestepState } from "./ballast.js";

var O = OrbitalMath;
var DAY = 86400, DEG = Math.PI / 180, TWO_PI = 2 * Math.PI;
var MARS = systems.get("Mars"), SUN = systems.get("Sun"), PHOBOS = systems.get("Phobos");
var GM = MARS.GM, R = +MARS.radius, J2 = MARS.J2;
var N_SUN = Math.sqrt(SUN.GM / Math.pow(Number(MARS.orbit.a), 3));    // the Sun's mean rate round Mars's sky, rad/s
var N_PHOBOS = TWO_PI / ME.moonFigures("Phobos").period;
var N_MARS = TWO_PI / ME.SIDEREAL_DAY;                                // Mars's turning against the stars, rad/s
var FLOOR = footFloor("Mars") * 1e3;                                  // lowest a tether's foot may hang, m
// The top stays below Phobos itself at its nearest.
var TOP_MAX = PHOBOS.orbit.periapsis - R - 50e3;
// With the two tethers sharing altitudes, the least tilt to the equator (and
// the most, measured the same way from the other side).
export var MIN_TILT = 20 * DEG;
// Beside a space elevator, a tilt that takes the tether to within
// ELEVATOR_BELOW of the lowest latitude the elevator's tether has at the
// heights they share is one that meets it, and it must then be at least
// ELEVATOR_ABOVE more than the highest.
var ELEVATOR_BELOW = 3 * DEG, ELEVATOR_ABOVE = 10 * DEG;

// What the tether carries besides its anchor station and its ballast, kg, and
// its material: best lunar silica at a safety factor of 2.5.
export var STRUCTURE = {
	topStation: 60e6, footStation: 150e6, upperLoad: 20e6, lowerLoad: 10e6,
	strength: MATERIALS.bestsilica.strength / MATERIALS.bestsilica.density / 2.5
};

// Altitudes in metres above Mars's mean radius; tilt in degrees.
//   anchorMass    kg, the anchor station: the bulk of the skyhook, placed where
//                 it balances the two halves of the tether
//   ballastMass   kg of ballast free to move along the tether
//   ballastHome   the altitude it rides at
//   upperBallastMass, upperBallastHome   a second lot of ballast, riding above
//                 the balance point: brought down toward it, it slows the skyhook
//   ballastSpeed  how fast ballast moves along the tether, m/s
//   timing        { a0, sidesteps } — where round its orbit the skyhook is at
//                 CLOCK_EPOCH (rad from the rising node), and the sidesteps
//                 made since (core/clearance.js)
export var HANGING_DEFAULTS = {
	footAlt: 220e3, comAlt: 1120e3, topAlt: 5000e3, relAlt: 5000e3, tilt: 93, sunSync: true,
	anchorMass: 8000e6, ballastMass: 400e6, ballastHome: 220e3,
	upperBallastMass: 200e6, upperBallastHome: 4000e3, ballastSpeed: 20, timing: null
};

function fail(code, message, values) {
	return { ok: false, diagnostic: { code: code, message: message, values: values || {} } };
}
function kmText(m) { return Math.round(m / 1e3).toLocaleString("en-US") + " km"; }

// ---- the masses --------------------------------------------------------------

var structureMemo = { key: null, value: null };
// The skyhook's pieces for one set of altitudes and ballast:
// { balanced, fixed: [{ r, m }] everything but the ballast, total (kg, ballast
// included), tetherMass, lower, upper } — lower and upper are each lot of
// ballast as { which, mass, home, up, down }, up and down being ballast.js
// responses to moving it toward the top and toward the foot (null where it
// has nowhere to go).
function structure(p) {
	var key = [p.footAlt, p.comAlt, p.topAlt, p.anchorMass, p.ballastMass, p.ballastHome, p.upperBallastMass, p.upperBallastHome].join("|");
	if (structureMemo.key === key) { return structureMemo.value; }
	var lots = [{ which: "lower", mass: p.ballastMass, home: p.ballastHome },
	            { which: "upper", mass: p.upperBallastMass, home: p.upperBallastHome }];
	var t = computeSkyhook(MARS, {
		foot: p.footAlt, centre: p.comAlt, top: p.topAlt, receivingDeck: null,
		outerDocks: lots[0].mass > 0 ? lots[0].home : null, releaseDeck: lots[1].mass > 0 ? lots[1].home : null,
		stationMass: { outerDocks: lots[0].mass, releaseDeck: lots[1].mass },
		strength: STRUCTURE.strength, loadTop: STRUCTURE.topStation, loadFoot: STRUCTURE.footStation,
		distUpper: STRUCTURE.upperLoad, distLower: STRUCTURE.lowerLoad, comMass: p.anchorMass
	});
	// Take each lot of ballast out of the model's pieces.
	var all = massPoints(MARS, t), fixed = [], total = 0, pending = lots.filter(function (b) { return b.mass > 0; });
	for (var i = all.length - 1; i >= 0; i--) {
		total += all[i].m;
		var hit = -1;
		for (var j = 0; j < pending.length && hit < 0; j++) {
			if (all[i].r === pending[j].home + R && all[i].m === pending[j].mass) { hit = j; }
		}
		if (hit >= 0) { pending.splice(hit, 1); } else { fixed.push(all[i]); }
	}
	// How the orbit answers to each lot going toward the top, and toward the
	// foot (core/ballast.js), the other lot staying at home. The foot may sink
	// only as far as the air's edge.
	lots.forEach(function (b, n) {
		var other = lots[1 - n], rHome = b.home + R;
		var rest = other.mass > 0 ? fixed.concat([{ r: other.home + R, m: other.mass }]) : fixed;
		function response(rFar) {
			if (!(t.balanced && b.mass > 0 && Math.abs(rFar - rHome) > 1e3)) { return null; }
			var resp = ballastResponse(GM, rest, b.mass, rHome, rFar, 48, FLOOR - p.footAlt);
			resp.which = b.which;
			return resp;
		}
		b.up = response(R + p.topAlt); b.down = response(R + p.footAlt);
	});
	structureMemo = { key: key, value: { balanced: !!t.balanced, fixed: fixed, total: total, tetherMass: t.tetherMass,
		lower: lots[0], upper: lots[1] } };
	return structureMemo.value;
}

// ---- resonances with Phobos ---------------------------------------------------

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
// The directions-count D and the gap (rad) of p orbits to q turns of Phobos.
export function resonanceGap(p, q) {
	var D = 2 * p / gcd(Math.abs(p - q), 2 * p);
	return { D: D, gap: Math.PI / D };
}
// The ratios offered: q up to 3, a gap of at least 12 degrees.
export var RATIOS = (function () {
	var out = [];
	for (var q = 1; q <= 3; q++) {
		for (var p = q + 1; p <= 5 * q; p++) {
			if (gcd(p, q) !== 1) { continue; }
			var g = resonanceGap(p, q);
			if (g.gap >= 12 * DEG) { out.push({ p: p, q: q, ratio: p / q, D: g.D, gap: g.gap }); }
		}
	}
	return out.sort(function (a, b) { return b.ratio - a.ratio; });
})();

// The orbits offered to each turn of Mars: whole numbers to one turn or to two.
export var DAY_RATIOS = (function () {
	var out = [];
	for (var q = 1; q <= 2; q++) {
		for (var p = 3 * q; p <= 14 * q; p++) {
			if (gcd(p, q) === 1) { out.push({ p: p, q: q, ratio: p / q }); }
		}
	}
	return out.sort(function (a, b) { return b.ratio - a.ratio; });
})();

// The BP radius at which the skyhook makes `ratio` orbits per turn of
// Phobos (or of Mars, with `rate` N_MARS) against its node line, the node
// turning at nodeRate(w) rad/s.
function resonantRadius(ratio, nodeRate, rate) {
	var n = rate || N_PHOBOS, w = ratio * n;
	for (var k = 0; k < 4; k++) { w = ratio * (n - nodeRate(w)); }
	return Math.cbrt(GM / (w * w));
}

// ---- figures -------------------------------------------------------------------

// The hanging skyhook's fixed figures for one param set. `phobos` is the
// Phobos skyhook's figures (core/facilities.js), or null when it is not ok.
// Returns { ok: true, ...figures } (SI, rad) or { ok: false, diagnostic }.
//   omega, period        the turning rate and one orbit
//   tilt, nodeRate       to Mars's equator; the plane's turning, rad/s (+ eastward)
//   sunSyncTilt          the tilt that keeps pace with the Sun (NaN if none does)
//   node0                the rising node's angle at CLOCK_EPOCH, in Mars's equator from ME.equinox
//   sFoot, sTop, sRel    foot, top and release point as distances from the BP, m
//   ratio                orbits per turn of Phobos, against the node line
//   resonances           [{ p, q, ratio, D, gap, comAlt }] with the BP on this tether
//   dayRatio             orbits per turn of Mars, against the node line
//   dayResonances        [{ p, q, ratio, comAlt }] with the BP on this tether
//   share                the altitudes shared with the Phobos tether { lo, hi } (m), or null
//   shareElevator        what is shared with the space elevator's tether, or
//                        null where the two cannot meet: { lo, hi } (m), and
//                        latLo, latHi, the least and greatest latitude (rad,
//                        north or south alike) that tether has between them
//   ballast              { speed, lower, upper, responses } — each lot as
//                        { which, mass, home, up, down }; responses is every
//                        ballast.js response either lot has
//   total, tetherMass    kg
export function hangingFigures(params, phobos, elevator) {
	var p = Object.assign({}, HANGING_DEFAULTS, params || {}), vals = { footAlt: p.footAlt, comAlt: p.comAlt, topAlt: p.topAlt };
	var nums = [p.footAlt, p.comAlt, p.topAlt, p.relAlt, p.tilt, p.anchorMass, p.ballastMass, p.ballastHome,
	            p.upperBallastMass, p.upperBallastHome, p.ballastSpeed];
	if (!nums.every(isFinite)) { return fail("bad-params", "The hanging skyhook needs a number in every field.", vals); }
	if (!(p.footAlt >= FLOOR)) {
		return fail("foot-range", "The foot must be at least " + kmText(FLOOR) + " up, clear of the air.", vals);
	}
	if (!(p.comAlt > p.footAlt + 1e3 && p.comAlt < p.topAlt - 1e3)) {
		return fail("com-range", "The balance point must lie between the foot and the top.", vals);
	}
	if (!(p.topAlt <= TOP_MAX)) {
		return fail("top-range", "The top must be no higher than " + kmText(TOP_MAX) + ", below Phobos at its nearest.", vals);
	}
	if (!(p.relAlt >= p.footAlt && p.relAlt <= p.topAlt)) {
		return fail("release-off-tether", "The release point must lie on the tether, between the foot and the top.", vals);
	}
	if (!(p.anchorMass > 0)) { return fail("anchor-range", "The anchor station needs a mass above zero.", vals); }
	if (!(p.ballastMass >= 0 && p.upperBallastMass >= 0 && p.ballastSpeed > 0)) {
		return fail("ballast-range", "The ballast needs a mass of zero or more and a speed above zero.", vals);
	}
	if (!(p.ballastHome >= p.footAlt && p.ballastHome <= p.topAlt)) {
		return fail("ballast-home", "The ballast's home must lie on the tether, between the foot and the top.", vals);
	}
	if (!(p.upperBallastHome >= p.comAlt && p.upperBallastHome <= p.topAlt)) {
		return fail("upper-ballast-home", "The upper ballast's home must lie between the balance point and the top.", vals);
	}
	var st = structure(p);
	if (!st.balanced) {
		return fail("unbalanced", "These altitudes do not balance: no place for the anchor station puts the balance point there. Make the anchor station heavier or the upper ballast lighter, or move the balance point or a ballast's home.", vals);
	}
	var rCom = R + p.comAlt, omega = Math.sqrt(GM / Math.pow(rCom, 3));
	var all = st.fixed.concat([{ r: R + p.ballastHome, m: p.ballastMass }, { r: R + p.upperBallastHome, m: p.upperBallastMass }]);
	var k = O.j2NodeCoefficient(GM, J2.value, J2.radius, omega, all);
	var kPoint = O.j2NodeCoefficient(GM, J2.value, J2.radius, omega);
	var sunSyncTilt = O.inclinationForNodeRate(k, N_SUN);
	if (p.sunSync && !isFinite(sunSyncTilt)) {
		return fail("no-sun-sync", "No tilt keeps this skyhook's plane turning with the Sun: the bulge turns it too slowly at this height.", vals);
	}
	var tilt = p.sunSync ? sunSyncTilt : p.tilt * DEG;
	if (!(tilt >= 0 && tilt <= Math.PI)) { return fail("tilt-range", "The tilt must be between 0° and 180°.", vals); }

	// The altitudes the two tethers share: Phobos's foot comes down by its swing.
	var share = null;
	if (phobos && phobos.ok) {
		var lo = Math.max(p.footAlt, phobos.footAlt - phobos.limits.swing), hi = Math.min(p.topAlt, phobos.topAlt + phobos.limits.swing);
		if (hi > lo) { share = { lo: lo, hi: hi }; }
	}
	if (share && (tilt < MIN_TILT || tilt > Math.PI - MIN_TILT)) {
		return fail("tilt-low", "This tether shares the altitudes " + kmText(share.lo) + " to " + kmText(share.hi)
			+ " with the Phobos skyhook's, so its tilt must be between " + Math.round(MIN_TILT / DEG) + "° and "
			+ Math.round(180 - MIN_TILT / DEG) + "°. Nearer the equator it stays beside the plane of Phobos's orbit for too much of each orbit for timing to keep the tethers apart. "
			+ "Raise the tilt, or shorten a tether until they share no altitude.", vals);
	}
	// The space elevator's tether climbs through every height this one has,
	// at latitudes that fall as it rises. A tilt that never takes this tether
	// to those latitudes keeps the two apart for good.
	var shareElevator = null;
	if (elevator && elevator.ok) {
		var c = elevator.curve, latLo = Infinity, latHi = -Infinity;
		for (var j = 0; j < c.r.length; j++) {
			if (c.r[j] < R + p.footAlt || c.r[j] > R + p.topAlt) { continue; }
			var lat = Math.atan2(c.z[j], c.x[j]);
			latLo = Math.min(latLo, lat); latHi = Math.max(latHi, lat);
		}
		var reach = Math.min(tilt, Math.PI - tilt);
		if (latHi >= latLo && reach > latLo - ELEVATOR_BELOW) {
			if (reach < latHi + ELEVATOR_ABOVE) {
				var least = Math.ceil((latHi + ELEVATOR_ABOVE) / DEG), under = (latLo - ELEVATOR_BELOW) / DEG;
				return fail("tilt-elevator", "At these heights the space elevator's tether stands between " + (latLo / DEG).toFixed(1) + "° and "
					+ (latHi / DEG).toFixed(1) + "° from the equator. A tilt this near those latitudes keeps this tether beside it for too much of each orbit for timing to keep them apart: set the tilt between "
					+ least + "° and " + (180 - least) + "°" + (under >= 0.1 ? ", or under " + (Math.floor(under * 10) / 10) + "° so that it never comes that far from the equator" : "") + ".", vals);
			}
			shareElevator = { lo: p.footAlt, hi: p.topAlt, latLo: latLo, latHi: latHi };
		}
	}
	var nodeRate = -k * Math.cos(tilt);
	// The node's rate at another turning rate, the masses spread as they are now.
	function nodeRateAt(w) { return -(k / kPoint) * O.j2NodeCoefficient(GM, J2.value, J2.radius, w) * Math.cos(tilt); }
	var resonances = RATIOS.map(function (x) {
		return Object.assign({ comAlt: resonantRadius(x.ratio, nodeRateAt) - R }, x);
	}).filter(function (x) { return x.comAlt > p.footAlt + 1e3 && x.comAlt < p.topAlt - 1e3; });
	var dayResonances = DAY_RATIOS.map(function (x) {
		return Object.assign({ comAlt: resonantRadius(x.ratio, nodeRateAt, N_MARS) - R }, x);
	}).filter(function (x) { return x.comAlt > p.footAlt + 1e3 && x.comAlt < p.topAlt - 1e3; });

	// Where the plane starts: face-on to the Sun at CLOCK_EPOCH.
	var e1 = ME.equinox, e2 = O.vCross(ME.pole, e1), sun = ME.sunVector(CLOCK_EPOCH);
	var node0 = Math.atan2(O.vDot(sun, e1), -O.vDot(sun, e2));

	return {
		ok: true, id: "hangingSkyhook", kind: "hangingSkyhook", GM: GM, R: R,
		footAlt: p.footAlt, comAlt: p.comAlt, topAlt: p.topAlt, relAlt: p.relAlt,
		rCom: rCom, omega: omega, period: TWO_PI / omega,
		sFoot: p.footAlt - p.comAlt, sTop: p.topAlt - p.comAlt, sRel: p.relAlt - p.comAlt,
		vFoot: omega * (R + p.footAlt), vCom: omega * rCom, vTop: omega * (R + p.topAlt), vRel: omega * (R + p.relAlt),
		tilt: tilt, sunSync: !!p.sunSync, sunSyncTilt: sunSyncTilt, nodeRate: nodeRate, node0: node0,
		ratio: omega / (N_PHOBOS - nodeRate), resonances: resonances, share: share, shareElevator: shareElevator,
		dayRatio: omega / (N_MARS - nodeRate), dayResonances: dayResonances,
		ballast: { speed: p.ballastSpeed, lower: st.lower, upper: st.upper,
		           responses: [st.lower.up, st.lower.down, st.upper.up, st.upper.down].filter(Boolean) },
		total: st.total, tetherMass: st.tetherMass, floor: FLOOR, topMax: TOP_MAX,
		timing: p.timing || { a0: 0, sidesteps: [] }
	};
}

// The BP altitude (m) that puts the skyhook of `params` exactly on the
// resonance `ratio`, its own masses and tilt settling the node's rate. Null
// when the search leaves the tether. opts: { elevator (the space elevator's
// figures, when one is in the design), mars (true: `ratio` is orbits per
// turn of Mars, not of Phobos) }.
export function resonantComAlt(params, phobos, ratio, opts) {
	var o = opts || {}, n = o.mars ? N_MARS : N_PHOBOS;
	var p = Object.assign({}, HANGING_DEFAULTS, params || {}), alt = null;
	var fig = hangingFigures(p, phobos, o.elevator);
	// Where the balance point is now may not balance; start from the
	// resonance's own height, the node's turning left out at first.
	if (!fig.ok) { fig = hangingFigures(Object.assign({}, p, { comAlt: Math.cbrt(GM / (ratio * ratio * n * n)) - R }), phobos, o.elevator); }
	if (!fig.ok) { return null; }
	for (var k = 0; k < 6; k++) {
		// Aim the turning rate at ratio * (the other's rate against the node line as it is now).
		var w = ratio * (n - fig.nodeRate);
		alt = Math.cbrt(GM / (w * w)) - R;
		fig = hangingFigures(Object.assign({}, p, { comAlt: alt }), phobos, o.elevator);
		if (!fig.ok) { return null; }
	}
	return alt;
}

// ---- where it is on the clock ---------------------------------------------------

// The sidestep under way at jd, or the last one finished, as
// { step, psi (rad slipped by all of them so far), rate, shift, travel }.
export function timingAt(timing, jd) {
	var list = timing.sidesteps, lo = 0, hi = list.length - 1, at = -1;
	while (lo <= hi) {
		var mid = (lo + hi) >> 1;
		if (list[mid].jdStart <= jd) { at = mid; lo = mid + 1; } else { hi = mid - 1; }
	}
	if (at < 0) { return { step: null, psi: 0, rate: 0, shift: 0, travel: 0 }; }
	var s = sidestepState(list[at], (jd - list[at].jdStart) * DAY);
	return { step: list[at], psi: list[at].psiBefore + s.psi, rate: s.rate, shift: s.shift, travel: s.travel,
	         active: (jd - list[at].jdStart) * DAY < list[at].duration };
}

// The orbit's axes at jd: { node N, quarter M, normal } unit vectors.
export function planeAt(fig, jd) {
	var e1 = ME.equinox, e2 = O.vCross(ME.pole, e1);
	var Om = fig.node0 + fig.nodeRate * (jd - CLOCK_EPOCH) * DAY, c = Math.cos(Om), s = Math.sin(Om);
	var N = O.vAdd(O.vScale(e1, c), O.vScale(e2, s));
	var inEq = O.vAdd(O.vScale(e1, s), O.vScale(e2, -c));
	var normal = O.vAdd(O.vScale(inEq, Math.sin(fig.tilt)), O.vScale(ME.pole, Math.cos(fig.tilt)));
	return { node: N, quarter: O.vCross(normal, N), normal: normal };
}

// Where the hanging skyhook is at jd:
//   angle       round its orbit from the rising node, rad
//   u, uDot     the tether's direction and its rate of turning (1/s)
//   rCom        the BP's distance from Mars's centre then, m (a sidestep under way shifts it)
//   plane       planeAt's axes
//   slip        timingAt's result
export function hangingAt(fig, jd, timing) {
	var tm = timing || fig.timing, slip = timingAt(tm, jd), pl = planeAt(fig, jd);
	var a = tm.a0 + fig.omega * (jd - CLOCK_EPOCH) * DAY + slip.psi, c = Math.cos(a), s = Math.sin(a);
	var u = O.vAdd(O.vScale(pl.node, c), O.vScale(pl.quarter, s));
	var along = O.vAdd(O.vScale(pl.node, -s), O.vScale(pl.quarter, c));
	var uDot = O.vAdd(O.vScale(along, fig.omega * (1 + slip.rate)), O.vScale(O.vCross(ME.pole, u), fig.nodeRate));
	return { angle: a, u: u, uDot: uDot, rCom: fig.rCom + slip.shift, plane: pl, slip: slip };
}

// State { r, v } of the point of the tether at distance s from the BP
export function hangingPointState(at, s) {
	return { r: O.vScale(at.u, at.rCom + s), v: O.vScale(at.uDot, at.rCom + s) };
}
