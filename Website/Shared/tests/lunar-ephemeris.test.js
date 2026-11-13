// Node tests for Shared/lunar-ephemeris.js's moonOrientation — which way the
// Moon's body is turned. Run from the repo root:
//   node --test Website/Shared/tests/lunar-ephemeris.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { LunarEphemeris as LE } from "../lunar-ephemeris.js";
import { OrbitalMath as O } from "../math-utils.js";

var DEG = 180 / Math.PI;

// Selenographic longitude and latitude (deg) of the point Earth is over.
function subEarth(jd) {
	var o = LE.moonOrientation(jd), toEarth = O.vUnit(O.vScale(LE.moonVector(jd), -1));
	var east = O.vCross(o.pole, o.meridian);
	return { lon: Math.atan2(O.vDot(toEarth, east), O.vDot(toEarth, o.meridian)) * DEG,
	         lat: Math.asin(O.vDot(toEarth, o.pole)) * DEG };
}

test("the pole and the prime meridian are unit vectors at right angles", function () {
	[2448724.5, 2480845.5, 2481500.25].forEach(function (jd) {
		var o = LE.moonOrientation(jd);
		assert.ok(Math.abs(O.vMag(o.pole) - 1) < 1e-12);
		assert.ok(Math.abs(O.vMag(o.meridian) - 1) < 1e-12);
		assert.ok(Math.abs(O.vDot(o.pole, o.meridian)) < 1e-12);
	});
});

test("the Moon's equator is tilted 1.54 degrees to the ecliptic", function () {
	var o = LE.moonOrientation(2480845.5);
	assert.ok(Math.abs(Math.acos(o.pole[2]) * DEG - 1.54242) < 1e-9);
});

test("the sub-Earth point matches Meeus example 53.a (optical librations)", function () {
	// 1992 April 12, 0h TD: l' = -1.206 deg, b' = +4.194 deg.
	var s = subEarth(O.julianDate(1992, 4, 12));
	assert.ok(Math.abs(s.lon - (-1.206)) < 0.005, "longitude " + s.lon);
	assert.ok(Math.abs(s.lat - 4.194) < 0.005, "latitude " + s.lat);
});

test("Earth stays within the librations of the prime meridian, 2080 to 2085", function () {
	var jd0 = O.julianDate(2080, 1, 1), lon = 0, lat = 0;
	for (var d = 0; d < 1827; d += 0.5) {
		var s = subEarth(jd0 + d);
		lon = Math.max(lon, Math.abs(s.lon)); lat = Math.max(lat, Math.abs(s.lat));
	}
	assert.ok(lon > 7.5 && lon < 8.2, "longitude swing " + lon);
	assert.ok(lat > 6.5 && lat < 7.0, "latitude swing " + lat);
});
