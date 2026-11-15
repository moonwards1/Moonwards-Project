// Node tests for Shared/mars-ephemeris.js. Run from the repo root:
//   node --test Website/Shared/tests/mars-ephemeris.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { MarsEphemeris as ME } from "../mars-ephemeris.js";
import { OrbitalMath as O } from "../math-utils.js";
import { systems } from "../orbit.js";

var DEG = 180 / Math.PI, DAY = 86400;
var JD_2080 = O.julianDate(2080, 1, 1, 0, 0, 0);
function angle(a, b) { return Math.acos(Math.max(-1, Math.min(1, O.vDot(O.vUnit(a), O.vUnit(b))))) * DEG; }
function near(x, want, tol, what) {
	assert.ok(Math.abs(x - want) <= tol, (what || "value") + " " + x + " is not within " + tol + " of " + want);
}

test("Mars's pole, prime meridian and east are unit vectors at right angles", function () {
	[ME.J2000, JD_2080, JD_2080 + 123.456].forEach(function (jd) {
		var o = ME.orientation(jd);
		near(O.vMag(o.pole), 1, 1e-12); near(O.vMag(o.meridian), 1, 1e-12); near(O.vMag(o.east), 1, 1e-12);
		near(O.vDot(o.pole, o.meridian), 0, 1e-12); near(O.vDot(o.pole, o.east), 0, 1e-12);
		near(O.vDot(o.meridian, o.east), 0, 1e-12);
	});
});

test("Mars turns once in its sidereal day, eastward", function () {
	near(ME.SIDEREAL_DAY, 88642.66, 0.05, "sidereal day (s)");
	near(ME.SIDEREAL_DAY, systems.get("Mars").period, 0.1, "orbit.js's period (s)");
	var a = ME.orientation(JD_2080), b = ME.orientation(JD_2080 + ME.SIDEREAL_DAY / DAY);
	near(angle(a.meridian, b.meridian), 0, 1e-4, "turn after one day (deg)");
	var q = ME.orientation(JD_2080 + ME.SIDEREAL_DAY / 4 / DAY);
	near(angle(q.meridian, a.east), 0, 1e-4, "a quarter day on, the meridian is where east was");
});

test("a point on the ground moves at the ground's speed and comes back in a day", function () {
	var s = ME.surfaceState(0, 30, JD_2080);
	near(O.vMag(s.r), +systems.get("Mars").radius, 1e-3);
	near(O.vMag(s.v), 2 * Math.PI * systems.get("Mars").radius / ME.SIDEREAL_DAY, 1e-6, "equator speed (m/s)");
	var dt = 5, before = ME.surfaceState(0, 30, JD_2080 - dt / DAY), later = ME.surfaceState(0, 30, JD_2080 + dt / DAY);
	near(O.vMag(O.vSub(O.vScale(O.vSub(later.r, before.r), 1 / (2 * dt)), s.v)), 0, 0.01, "velocity against the position's change");
	var g = ME.groundPoint(ME.surfaceState(-41.5, 137.25, JD_2080 + 0.3, 5e6).r, JD_2080 + 0.3);
	near(g.lat * DEG, -41.5, 1e-9); near(g.lon * DEG, 137.25, 1e-9); near(g.radius, 5e6, 1e-3);
});

test("Mars's equator is tilted 25.19 degrees to its orbit", function () {
	near(angle(ME.pole, ME.orbitPole), 25.19, 0.05, "obliquity (deg)");
});

test("the seasons fall on their dates", function () {
	// Mars year 37: northern spring equinox 2022-12-26, summer solstice 2023-07-12,
	// autumn equinox 2024-01-12, winter solstice 2024-06-07.
	function ls(Y, M, D) { return ME.season(O.julianDate(Y, M, D, 12, 0, 0)).ls * DEG; }
	var spring = ls(2022, 12, 26);
	near(spring > 180 ? spring - 360 : spring, 0, 1.5, "Ls at the spring equinox");
	near(ls(2023, 7, 12), 90, 1.5, "Ls at the summer solstice");
	near(ls(2024, 1, 12), 180, 1.5, "Ls at the autumn equinox");
	near(ls(2024, 6, 7), 270, 1.5, "Ls at the winter solstice");
	near(ME.season(O.julianDate(2023, 7, 12, 12, 0, 0)).sunLat * DEG, 25.19, 0.1, "Sun's latitude at the solstice");
	near(ME.season(O.julianDate(2022, 12, 26, 12, 0, 0)).sunLat * DEG, 0, 0.7, "Sun's latitude at the equinox");
});

test("Phobos keeps to its orbit's size, tilt and period", function () {
	var f = ME.moonFigures("Phobos"), lo = Infinity, hi = 0;
	for (var k = 0; k < 400; k++) {
		var jd = JD_2080 + k * 0.0123, s = ME.moonState("Phobos", jd), d = O.vMag(s.r);
		lo = Math.min(lo, d); hi = Math.max(hi, d);
		near(angle(s.normal, ME.pole), 1.08, 1e-6, "tilt to Mars's equator (deg)");
	}
	near(lo, 9234.42e3, 2e3, "periapsis (m)"); near(hi, 9517.58e3, 2e3, "apoapsis (m)");
	near(f.period, 0.31891023 * DAY, 1e-3);
	near(O.vMag(ME.moonState("Phobos", JD_2080).v), 2138, 40, "speed (m/s)");
});

test("a moon's velocity is the rate its position changes at", function () {
	ME.MOON_NAMES.forEach(function (name) {
		var dt = 2, a = ME.moonState(name, JD_2080 + 5 - dt / DAY), b = ME.moonState(name, JD_2080 + 5 + dt / DAY);
		var mid = ME.moonState(name, JD_2080 + 5);
		var fd = O.vScale(O.vSub(b.r, a.r), 1 / (2 * dt));
		near(O.vMag(O.vSub(fd, mid.v)), 0, 0.05, name + " velocity error (m/s)");
	});
});

test("Phobos is back at the same place among the stars after one period, less the precession", function () {
	var P = ME.moonFigures("Phobos").period / DAY;
	var a = ME.moonState("Phobos", JD_2080), b = ME.moonState("Phobos", JD_2080 + P);
	near(angle(a.r, b.r), 0, 0.02, "angle after one period (deg)");
});

test("Phobos's orbit pole circles Mars's pole in 2.262 years", function () {
	var T = ME.moonFigures("Phobos").nodePeriod / DAY;
	near(T / 365.25, 2.262, 1e-9);
	var a = ME.moonState("Phobos", JD_2080).normal;
	near(angle(a, ME.moonState("Phobos", JD_2080 + T).normal), 0, 1e-3, "after a full turn (deg)");
	near(angle(a, ME.moonState("Phobos", JD_2080 + T / 2).normal), 2.16, 0.01, "after half a turn (deg)");
});

test("Deimos's tilt to Mars's equator swings between about 0.9 and 2.7 degrees", function () {
	var lo = Infinity, hi = 0;
	for (var y = 0; y <= 57; y += 0.5) {
		var s = ME.moonState("Deimos", JD_2080 + y * 365.25), t = angle(s.normal, ME.pole);
		lo = Math.min(lo, t); hi = Math.max(hi, t);
		near(O.vMag(s.r), 23463.2e3, 10e3, "distance (m)");
	}
	near(lo, 0.9, 0.08, "least tilt (deg)"); near(hi, 2.68, 0.08, "greatest tilt (deg)");
});

test("the Sun is as far away as Mars's orbit says", function () {
	var d = O.vMag(ME.sunVector(JD_2080));
	assert.ok(d > 206.6e9 && d < 249.3e9);
});
