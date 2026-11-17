// Node tests for core/facilities.js and core/flight.js. Run from the repo root:
//   node --test Website/Calculators/Mars-System-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { FACILITIES, moonSkyhookLimits, skyhookAt, tetherPointState, releaseState,
         GM_MARS, R_MARS, ENTRY_ALT } from "../facilities.js";
import { flightStateAt, groundRelative, SOI_MARS } from "../flight.js";
import { CLOCK_EPOCH } from "../clock.js";
import { MarsEphemeris as ME } from "../../../../Shared/mars-ephemeris.js";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { moonSkyhookFigures, computeFlight } from "./studies.js";

var DAY = 86400, DEG = 180 / Math.PI, JD = CLOCK_EPOCH + 81.3;
function near(x, want, tol, what) {
	assert.ok(Math.abs(x - want) <= tol, (what || "value") + " " + x + " is not within " + tol + " of " + want);
}
function fly(params, jd) { return computeFlight({ from: "phobosSkyhook", jd: jd || JD, params: { phobosSkyhook: params } }); }

test("the Phobos skyhook's limits come from the air below and Deimos above", function () {
	var L = moonSkyhookLimits("phobosSkyhook");
	near(L.centre, 9376e3 - R_MARS, 1); near(L.swing, 141.58e3, 10);
	near(L.footMin, 257e3, 1); near(L.topMax, 19924e3, 1e3);
	assert.equal(moonSkyhookFigures("phobosSkyhook", { footAlt: 200e3 }).diagnostic.code, "foot-range");
	assert.equal(moonSkyhookFigures("phobosSkyhook", { topAlt: 21000e3 }).diagnostic.code, "top-range");
	assert.equal(moonSkyhookFigures("phobosSkyhook", { relAlt: 100e3 }).diagnostic.code, "release-off-tether");
	assert.ok(moonSkyhookFigures("phobosSkyhook").ok);
});

test("the tether's mean speeds are the turning rate times the radius", function () {
	var f = moonSkyhookFigures("phobosSkyhook"), d = FACILITIES.phobosSkyhook.defaults;
	near(f.period, 0.31891023 * DAY, 1e-3);
	near(f.vFoot, 2 * Math.PI / f.period * (R_MARS + d.footAlt), 1e-9);
	near(f.vFoot, 832, 2, "foot speed (m/s)"); near(f.vTop, 3053, 3, "top speed (m/s)");
	assert.ok(f.pullFoot < 0 && f.pullTop > 0, "weight hangs down below Phobos and outward above it");
});

test("the point of the tether at Phobos is Phobos, and every point moves as its position changes", function () {
	var f = moonSkyhookFigures("phobosSkyhook"), at = skyhookAt(f, JD), p = tetherPointState(at, 0);
	near(O.vMag(O.vSub(p.r, ME.moonState("Phobos", JD).r)), 0, 1e-6);
	[f.sFoot, f.sTop].forEach(function (s) {
		var dt = 2, a = tetherPointState(skyhookAt(f, JD - dt / DAY), s), b = tetherPointState(skyhookAt(f, JD + dt / DAY), s);
		var fd = O.vScale(O.vSub(b.r, a.r), 1 / (2 * dt));
		near(O.vMag(O.vSub(fd, tetherPointState(at, s).v)), 0, 0.05, "velocity error (m/s)");
	});
});

test("the release point rises and falls with Phobos, 142 km either way", function () {
	var f = moonSkyhookFigures("phobosSkyhook"), lo = Infinity, hi = -Infinity;
	for (var k = 0; k < 200; k++) {
		var alt = releaseState(f, JD + k * f.period / DAY / 200).altitude;
		lo = Math.min(lo, alt); hi = Math.max(hi, alt);
	}
	near(lo, 260e3 - 141.6e3, 1.5e3); near(hi, 260e3 + 141.6e3, 1.5e3);
	assert.ok(lo > ENTRY_ALT - 10e3, "the foot stays out of the air");
});

test("a ship let go at Phobos stays with Phobos for an orbit", function () {
	var centre = moonSkyhookLimits("phobosSkyhook").centre;
	var fl = fly({ relAlt: centre });
	assert.equal(fl.summary.outcome, "orbit");
	var T = fl.fig.period, s = flightStateAt(fl, T), ph = ME.moonState("Phobos", JD + T / DAY);
	// Phobos's place comes from mean elements and the ship's from the flown
	// path; the two differ by the bulge's once-an-orbit wobble, a few km in
	// radius, which is some tens of km along a 58,900 km orbit.
	near(O.vMag(O.vSub(s.r, ph.r)), 0, 60e3, "distance from Phobos after one orbit (m)");
	near(fl.summary.tilt * DEG, 1.08, 0.02, "tilt to the equator (deg)");
});

test("a ship let go at the foot comes down to the air, slowly", function () {
	var fl = fly({});
	assert.equal(fl.summary.outcome, "entry");
	var last = fl.leg.samples[fl.leg.samples.length - 1];
	near(O.vMag(last.r), R_MARS + ENTRY_ALT, 1, "entry radius (m)");
	// Energy is kept, but for the bulge's small share.
	var e0 = Math.pow(O.vMag(fl.release.v), 2) / 2 - GM_MARS / fl.release.radius;
	var e1 = Math.pow(fl.summary.entrySpeed, 2) / 2 - GM_MARS / O.vMag(last.r);
	near(e1 / e0, 1, 2e-3, "energy ratio");
	assert.ok(fl.summary.entrySpeed > 1200 && fl.summary.entrySpeed < 1800, "entry speed " + fl.summary.entrySpeed);
	assert.ok(fl.summary.entryAirSpeed < fl.summary.entrySpeed, "the air is moving the same way");
	assert.ok(fl.summary.entryAngle > 0);
	assert.ok(fl.summary.entryAirAngle > fl.summary.entryAngle, "slower against the air, falling as fast: steeper");
});

test("the ground sees a point that turns with it as standing still", function () {
	var s = ME.surfaceState(10, 40, JD, R_MARS + 30e3);
	near(O.vMag(groundRelative(s.r, s.v, JD)), 0, 1e-9);
	near(O.vMag(groundRelative(s.r, [0, 0, 0], JD)), O.vMag(s.v), 1e-9, "a point at rest against the stars");
});

test("a ship let go at the top leaves Mars with about the speed the formula gives", function () {
	var fl = fly({ relAlt: 10000e3 });
	assert.equal(fl.summary.outcome, "escape");
	near(fl.summary.vInf, fl.fig.vInfRel, 0.06 * fl.fig.vInfRel, "v-infinity (m/s)");
	near(fl.fig.vInfRel, 1710, 15);
	var last = fl.leg.samples[fl.leg.samples.length - 1];
	assert.ok(O.vMag(last.r) >= SOI_MARS, "flown to the sphere of influence");
	assert.equal(fl.summary.apoAlt, null);
});

test("a ship let go a little above Phobos is in a higher orbit", function () {
	var fl = fly({ relAlt: 7000e3 });
	assert.equal(fl.summary.outcome, "orbit");
	assert.ok(fl.summary.apoAlt > 7000e3 && fl.summary.periAlt > 6000e3 && fl.summary.periAlt < 7200e3);
});
