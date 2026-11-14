/* Earth-Moon-Traffic-Plotter/core/arrival-date — the date an arrival from
 * another world is flown on here.
 *
 * A mission from the Mission Planner can arrive at Earth on any date, and this
 * plotter's clock spans one turn of the Moon's orbital plane from 2080. An
 * arrival outside that span is moved to the date inside it where the Sun and
 * the Moon stand most nearly as they did on the real date. The ship's state
 * relative to Earth is kept as it was; only the clock changes.
 *
 * What is matched, in order of weight:
 *
 *   the Sun's direction    it shapes the high loop after the aerobrake; held
 *                          within SUN_LIMIT, so only dates near the same
 *                          time of year qualify
 *   the Moon's position    the closest of those:
 *                              miss = |r_Moon(t') - r_Moon(t)|
 *                          r_Moon geocentric, t the real date, t' the candidate
 *
 * The miss cannot be brought to zero. The year and the lunar month line up
 * well (41 years is 507.10 lunar months), but the tilt of the Moon's orbit
 * turns once in 18.61 years and is somewhere else on any date in the span, so
 * the Moon is typically some 30,000 km from its place, at worst about 60,000.
 * The ship takes about five weeks round the loop after the aerobrake, so the
 * Moon's place on arrival is set again by the burns anyway.
 *
 * Pure (no DOM): Node-tested in core/tests/arrival-date.test.js.
 */

import { LunarEphemeris as LE } from "../../../Shared/lunar-ephemeris.js";

// How far the Sun's direction may be from the real date's, degrees.
export var SUN_LIMIT = 10;
var YEAR = 365.2422;          // days
var HALF = 12;                // days searched either side of the same time of year

function angle(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function miss(m0, jd) {
	var m = LE.moonVector(jd);
	return Math.hypot(m[0] - m0[0], m[1] - m0[1], m[2] - m0[2]) * 1e3;   // m
}

// The date to fly an arrival at Julian date `jd` on, inside [jd0, jd1].
// Returns { jd, moved, sunDeg, moonMiss } — moonMiss in m, sunDeg degrees,
// both 0 when the date is already inside the span.
export function arrivalDateInSpan(jd, jd0, jd1) {
	if (jd >= jd0 && jd <= jd1) { return { jd: jd, moved: false, sunDeg: 0, moonMiss: 0 }; }
	var m0 = LE.moonVector(jd), s0 = LE.sunLongitude(jd);
	var best = null;
	function consider(t) {
		if (t < jd0 || t > jd1) { return; }
		var sd = angle(LE.sunLongitude(t), s0);
		if (sd > SUN_LIMIT) { return; }
		var d = miss(m0, t);
		if (!best || d < best.moonMiss) { best = { jd: t, sunDeg: sd, moonMiss: d }; }
	}
	var k0 = Math.floor((jd0 - jd) / YEAR) - 1, k1 = Math.ceil((jd1 - jd) / YEAR) + 1;
	for (var k = k0; k <= k1; k++) {
		var c = jd + k * YEAR;
		for (var h = -HALF * 24; h <= HALF * 24; h++) { consider(c + h / 24); }
	}
	if (!best) { return null; }
	var hour = best.jd;
	for (var mn = -60; mn <= 60; mn++) { consider(hour + mn / 1440); }
	return { jd: best.jd, moved: true, sunDeg: best.sunDeg, moonMiss: best.moonMiss };
}
