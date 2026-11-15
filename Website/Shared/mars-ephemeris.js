/* Shared/mars-ephemeris.js — the Mars system on a clock: which way Mars is
 * turned, where Phobos and Deimos are, and where the Sun is.
 *
 * Everything is MARS-CENTRED, in the non-rotating ecliptic-J2000 axes the
 * rest of Shared/ works in (X to the equinox, Z ecliptic north — the frame
 * Shared/body-leg.js integrates a ship in), SI units: m, m/s, rad.
 *
 * MARS ITSELF. The spin pole is orbit.js's (right ascension 317.68 deg,
 * declination 52.89 deg). The prime meridian is turned about it by the IAU
 * angle
 *
 *     W = 176.630 deg + 350.89198226 deg/day * d
 *
 *     W   angle along Mars's equator from Q to the prime meridian
 *     Q   the point where Mars's equator rises through Earth's (ICRF)
 *         equator: right ascension of the pole + 90 deg, declination 0
 *     d   days from J2000.0 (JD 2451545.0)
 *
 * which is one turn in 88,642.66 s, the sidereal day. The pole's own slow
 * drift (0.1 deg a century) is left out.
 *
 * THE MOONS are precessing ellipses: an ellipse of fixed size, shape and tilt
 * whose node line and apse line turn steadily, the form JPL's mean elements
 * take (ssd.jpl.nasa.gov/sats/elem, MAR099, epoch J2000.0). Each is referred
 * to its own LAPLACE PLANE, the plane its orbit's pole circles: Mars's
 * equator for Phobos, a plane 0.9 deg off it for Deimos.
 *
 *     Omega(t)  = Omega0 - 2 pi t / P_node          the node line, regressing
 *     varpi(t)  = varpi0 + 2 pi t / P_apse          the apse line, advancing
 *     lambda(t) = lambda0 + 2 pi t / P              the moon's mean longitude
 *     M = lambda - varpi,   omega = varpi - Omega
 *
 *     t        time from J2000.0
 *     P        the moon's sidereal period (orbit.js)
 *     P_node   2.262 years for Phobos, 56.2 for Deimos
 *     P_apse   1.1316 years for Phobos. Deimos's orbit is so nearly round
 *              (e = 0.00033) that its apse line is left riding the node.
 *     Omega    measured in the Laplace plane from the point where that plane
 *              rises through Earth's (ICRF) equator
 *
 * The size and shape (a, e) are orbit.js's; Phobos's tilt is
 * body-profiles.js's ANCHORS figure, the one its skyhook hangs by. The speed
 * round the ellipse uses GM_eff = (dM/dt)^2 a^3 instead of Mars's GM, and the
 * turning of the node and apse lines is added on, so the velocity returned is
 * the rate the position actually changes at: Mars's oblateness makes both
 * moons run about 0.04% faster than a Kepler orbit of the same size.
 *
 * These are mean elements, good for the geometry of the system — tilts,
 * distances, periods, how the planes turn. They are not a prediction of where
 * along its orbit Phobos will be on a date in the 2080s: its tidal speeding-up
 * alone moves it tens of degrees over a century.
 *
 * THE SUN is at minus Mars's own heliocentric position (orbit.js's Kepler
 * elements, OrbitalMath.bodyStateAtJD).
 *
 * ES module: import { MarsEphemeris } from "../../Shared/mars-ephemeris.js";
 * Pure (no DOM, no THREE): Node-tested in Shared/tests/mars-ephemeris.test.js.
 * Imports from ./ — breaks if moved without orbit.js, math-utils.js and
 * body-profiles.js.
 */

import { systems } from "./orbit.js";
import { OrbitalMath } from "./math-utils.js";
import { ANCHORS } from "./body-profiles.js";

var O = OrbitalMath;
var DEG = Math.PI / 180, TWO_PI = 2 * Math.PI;
var DAY = 86400, YEAR = 365.25 * DAY, J2000 = 2451545.0;
var MARS = systems.get("Mars"), SUN = systems.get("Sun");

// ---- Mars's own axes ---------------------------------------------------------

// A direction given by right ascension and declination (rad), in ecliptic axes.
function fromRaDec(ra, dec) { return O.vUnit(O.poleVectorEcliptic(ra, dec)); }

// A plane's pole, and the two directions in the plane that longitudes are
// counted from: `node`, where the plane rises through Earth's equator, and
// `ahead`, a quarter turn on.
function planeAxes(ra, dec) {
	var pole = fromRaDec(ra, dec), node = fromRaDec(ra + Math.PI / 2, 0);
	return { pole: pole, node: node, ahead: O.vCross(pole, node) };
}

var EQUATOR = planeAxes(MARS.pole.ra, MARS.pole.dec);
var W0 = 176.630 * DEG;
var SPIN_RATE = 350.89198226 * DEG / DAY;              // rad/s

// The pole of Mars's orbit round the Sun, and the direction of the Sun at the
// northern spring equinox (where its path crosses Mars's equator going north).
var ORBIT_POLE = (function () {
	var s = O.bodyStateAtJD(SUN.GM, MARS.orbit, J2000);
	return O.vUnit(O.vCross(s.r, s.v));
})();
var EQUINOX = O.vUnit(O.vCross(EQUATOR.pole, ORBIT_POLE));

function combine(a, ka, b, kb) { return O.vAdd(O.vScale(a, ka), O.vScale(b, kb)); }

// Which way Mars is turned at Julian date jd:
//   pole      unit vector along the spin axis (north)
//   meridian  unit vector from the centre through 0 deg latitude, 0 deg longitude
//   east      pole x meridian: through 0 deg latitude, 90 deg east
//   angle     W, rad
//   rate      the spin rate, rad/s
function orientation(jd) {
	var W = W0 + SPIN_RATE * (jd - J2000) * DAY;
	var meridian = combine(EQUATOR.node, Math.cos(W), EQUATOR.ahead, Math.sin(W));
	return { pole: EQUATOR.pole, meridian: meridian, east: O.vCross(EQUATOR.pole, meridian),
	         angle: W, rate: SPIN_RATE };
}

// State of a point fixed to Mars at jd: { r, v }.
//   latDeg, lonDeg  planetocentric latitude and EAST longitude, degrees
//   radius          its distance from Mars's centre, m (default: the mean radius)
// The velocity is the ground's own, spin x r.
function surfaceState(latDeg, lonDeg, jd, radius) {
	var o = orientation(jd), lat = latDeg * DEG, lon = lonDeg * DEG;
	var R = radius == null ? +MARS.radius : radius;
	var inPlane = combine(o.meridian, Math.cos(lon), o.east, Math.sin(lon));
	var r = O.vScale(combine(inPlane, Math.cos(lat), o.pole, Math.sin(lat)), R);
	return { r: r, v: O.vScale(O.vCross(o.pole, r), o.rate) };
}

// Where a Mars-centred position r is over the ground at jd:
// { lat, lon } planetocentric, rad, lon east in (-pi, pi]; `radius` in m.
function groundPoint(r, jd) {
	var o = orientation(jd), d = O.vMag(r);
	return { lat: Math.asin(Math.max(-1, Math.min(1, O.vDot(r, o.pole) / d))),
	         lon: Math.atan2(O.vDot(r, o.east), O.vDot(r, o.meridian)), radius: d };
}

// ---- the Sun -----------------------------------------------------------------

// The Sun's position relative to Mars at jd, m.
function sunVector(jd) { return O.vScale(O.bodyStateAtJD(SUN.GM, MARS.orbit, jd).r, -1); }

// The season at jd:
//   ls        the Sun's longitude along its path, rad in [0, 2 pi): 0 at the
//             northern spring equinox, pi/2 at the northern summer solstice
//   sunLat    the latitude the Sun is overhead at, rad
//   distance  Mars's distance from the Sun, m
function season(jd) {
	var s = sunVector(jd), d = O.vMag(s), u = O.vScale(s, 1 / d);
	var ls = Math.atan2(O.vDot(u, O.vCross(ORBIT_POLE, EQUINOX)), O.vDot(u, EQUINOX));
	return { ls: ls < 0 ? ls + TWO_PI : ls, sunLat: Math.asin(O.vDot(u, EQUATOR.pole)), distance: d };
}

// ---- the moons -----------------------------------------------------------------

// Mean elements at J2000.0, degrees and years; see the header.
var MOON_ELEMENTS = {
	Phobos: { plane: EQUATOR, tilt: ANCHORS.Phobos.inclination,
	          node0: 169.2, peri0: 216.3, anomaly0: 189.7, nodeYears: 2.262, apseYears: 1.1316 },
	Deimos: { plane: planeAxes(316.6 * DEG, 53.5 * DEG), tilt: 1.79,
	          node0: 54.3, peri0: 0, anomaly0: 205.0, nodeYears: 56.2, apseYears: null }
};

var MOONS = {};
Object.keys(MOON_ELEMENTS).forEach(function (name) {
	var m = MOON_ELEMENTS[name], sys = systems.get(name);
	var nodeRate = -TWO_PI / (m.nodeYears * YEAR);
	var apseRate = m.apseYears ? TWO_PI / (m.apseYears * YEAR) : nodeRate;
	var longRate = TWO_PI / sys.period;
	MOONS[name] = {
		plane: m.plane, a: sys.orbit.semiMajor, e: sys.orbit.eccentricity, tilt: m.tilt * DEG,
		node0: m.node0 * DEG, apse0: (m.node0 + m.peri0) * DEG,
		long0: (m.node0 + m.peri0 + m.anomaly0) * DEG,
		nodeRate: nodeRate, apseRate: apseRate, longRate: longRate,
		GMeff: Math.pow(longRate - apseRate, 2) * Math.pow(sys.orbit.semiMajor, 3),
		period: sys.period, radius: +sys.radius
	};
});

function moon(name) {
	var m = MOONS[name];
	if (!m) { throw new Error("MarsEphemeris: unknown moon '" + name + "'"); }
	return m;
}

// A moon's elements at jd, in its own Laplace plane (rad, m):
// { a, e, tilt, node, peri (argument of periapsis), anomaly (mean), nu (true) }.
function moonElements(name, jd) {
	var m = moon(name), t = (jd - J2000) * DAY;
	var node = m.node0 + m.nodeRate * t, apse = m.apse0 + m.apseRate * t;
	var anomaly = (m.long0 + m.longRate * t - apse) % TWO_PI;
	return { a: m.a, e: m.e, tilt: m.tilt, node: node % TWO_PI, peri: (apse - node) % TWO_PI,
	         anomaly: anomaly, nu: O.trueAnomalyFromMean(anomaly, m.e) };
}

// A moon's state relative to Mars at jd: { r, v } (m, m/s), and `normal`, the
// unit pole of its orbit as it stands then.
function moonState(name, jd) {
	var m = moon(name), el = moonElements(name, jd), p = m.plane;
	var s = O.stateFromElements(m.GMeff, el.a, el.e, el.tilt, el.node, el.peri, el.nu);
	function out(q) { return O.vAdd(combine(p.node, q[0], p.ahead, q[1]), O.vScale(p.pole, q[2])); }
	var r = out(s.r), normal = O.vUnit(O.vCross(r, out(s.v)));
	// The ellipse itself is turning: its node line about the Laplace pole, its
	// apse line about its own pole. Both carry the moon along.
	var v = O.vAdd(out(s.v), O.vAdd(O.vScale(O.vCross(p.pole, r), m.nodeRate),
		O.vScale(O.vCross(normal, r), m.apseRate - m.nodeRate)));
	return { r: r, v: v, normal: normal };
}

// The fixed figures of a moon: { a, e, period (s), radius (m), nodePeriod (s,
// how long its orbit's pole takes to circle its Laplace plane's) }.
function moonFigures(name) {
	var m = moon(name);
	return { a: m.a, e: m.e, period: m.period, radius: m.radius, nodePeriod: TWO_PI / Math.abs(m.nodeRate) };
}

export var MarsEphemeris = {
	J2000: J2000,
	SIDEREAL_DAY: TWO_PI / SPIN_RATE,
	MOON_NAMES: Object.keys(MOONS),
	pole: EQUATOR.pole,
	orbitPole: ORBIT_POLE,
	equinox: EQUINOX,
	orientation: orientation,
	surfaceState: surfaceState,
	groundPoint: groundPoint,
	sunVector: sunVector,
	season: season,
	moonElements: moonElements,
	moonState: moonState,
	moonFigures: moonFigures
};
