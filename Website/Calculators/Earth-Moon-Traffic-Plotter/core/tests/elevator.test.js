// Node tests for the L1 elevator in the Earth-Moon-Traffic-Plotter's core.
// Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { moonGeoPos } from "../../../../Shared/geo-leg.js";
import { CLOCK_EPOCH, FACILITIES, L1_FRACTION, ELEVATOR_LIMITS, elevatorFigures, elevatorAt,
         elevatorPointState, facilityFigures, releaseState, skyhookFigures } from "../facilities.js";
import { computeFlight, flightStateAt } from "../flight.js";

function within(actual, expected, tol, label) {
	assert.ok(Math.abs(actual - expected) <= tol, label + ": " + actual + " not within " + tol + " of " + expected);
}

var JD = CLOCK_EPOCH + 81;   // 2080-03-22
var DAY = 86400, DEG = 180 / Math.PI;

test("the elevator's defaults: counterweight 222,200 km up, four anchors 20 degrees out", function () {
	var g = elevatorFigures("moonElevator");
	assert.ok(g.ok);
	assert.equal(g.kind, "elevator");
	within(g.rCw - g.R, 222200e3, 1e-3, "counterweight altitude");
	assert.equal(g.relPoint, "high");
	assert.deepEqual(g.anchors.map(function (a) { return [Math.abs(a.lat), Math.abs(a.lon)]; }),
		[[20, 20], [20, 20], [20, 20], [20, 20]]);
	assert.equal(facilityFigures("moonElevator").kind, "elevator");
	assert.equal(facilityFigures("moonSkyhook").kind, "skyhook");
});

test("bad elevator geometry is a diagnostic, not a throw", function () {
	assert.equal(elevatorFigures("moonElevator", { cwAlt: 50000e3 }).diagnostic.code, "counterweight-range");
	assert.equal(elevatorFigures("moonElevator", { cwAlt: NaN }).diagnostic.code, "bad-params");
	assert.equal(elevatorFigures("moonElevator", { lowAlt: 0 }).diagnostic.code, "release-off-tether");
	assert.equal(elevatorFigures("moonElevator", { highAlt: 250000e3 }).diagnostic.code, "release-off-tether");
	assert.equal(computeFlight({ from: "moonElevator", jd: JD, params: { moonElevator: { cwAlt: 1 } } }).ok, false);
});

test("the elevator lies along the line from the Moon to Earth", function () {
	var g = elevatorFigures("moonElevator");
	[0, 5.3, 11, 19.7].forEach(function (d) {
		var jd = JD + d, at = elevatorAt(g, jd), s = elevatorPointState(g, g.rCw, jd);
		within(O.vMag(s.relR), g.rCw, 1e-3, "distance from the Moon's centre");
		// The counterweight, the Moon and Earth are in one line, the counterweight between them.
		within(O.vMag(s.r) + g.rCw, at.D, 1e-3, "Earth to counterweight to Moon");
		within(O.vDot(s.relR, s.relV), 0, 1, "it keeps its distance from the Moon");
	});
});

test("a point's velocity is the rate of change of its position", function () {
	var g = elevatorFigures("moonElevator"), h = 0.01;
	[g.R + 45000e3, g.rCw].forEach(function (s) {
		var a = elevatorPointState(g, s, JD - h).r, b = elevatorPointState(g, s, JD + h).r;
		var v = elevatorPointState(g, s, JD).v;
		within(O.vMag(O.vSub(O.vScale(O.vSub(b, a), 1 / (2 * h * DAY)), v)), 0, 0.05, "finite difference, m/s");
	});
});

test("the counterweight is carried round Earth at the line's own turning rate", function () {
	var g = elevatorFigures("moonElevator"), at = elevatorAt(g, JD), s = elevatorPointState(g, g.rCw, JD);
	// Across the line it moves at turnRate * its distance from Earth; along it, with the Moon's own in-and-out.
	var across = O.vMag(O.vSub(s.v, O.vScale(at.u, O.vDot(s.v, at.u))));
	within(across, at.turnRate * (at.D - g.rCw), 1e-6, "speed across the line");
	within(O.vDot(O.vUnit(s.v), at.travel), 1, 0.01, "it travels the way `travel` points");
	// The workbench's figure for the mean distance is 433 m/s; the month moves it a few per cent.
	within(O.vMag(s.v), 433, 25, "speed about Earth");
	within(2 * Math.PI / at.turnRate / DAY, 27.3, 2.5, "the line's turning period, days");
});

test("L1 slides along the tether as the Earth–Moon distance changes", function () {
	var g = elevatorFigures("moonElevator"), lo = Infinity, hi = 0;
	for (var d = 0; d < 60; d += 0.25) {
		var at = elevatorAt(g, JD + d);
		within(at.rL1, L1_FRACTION * O.vMag(moonGeoPos(JD + d)), 1e-3, "a fixed fraction of the distance");
		lo = Math.min(lo, at.rL1); hi = Math.max(hi, at.rL1);
	}
	assert.ok(lo > 53.5e6 && lo < 56e6, "nearest " + lo);
	assert.ok(hi > 60e6 && hi < 61.5e6, "furthest " + hi);
	assert.ok(g.R + ELEVATOR_LIMITS.cwMin > hi, "the counterweight's lower limit is beyond L1 all month");
});

test("each release point is kept on its own side of L1", function () {
	var at0 = elevatorAt(elevatorFigures("moonElevator"), JD);
	var g = elevatorFigures("moonElevator", { lowAlt: 80000e3, highAlt: 20000e3 }), at = elevatorAt(g, JD);
	assert.equal(at.rLow, at0.rL1);
	assert.equal(at.rHigh, at0.rL1);
	var plain = elevatorAt(elevatorFigures("moonElevator", { lowAlt: 45000e3, highAlt: 150000e3 }), JD);
	within(plain.rLow, 1737.4e3 + 45000e3, 1e3, "lower point as set");
	within(plain.rHigh, 1737.4e3 + 150000e3, 1e3, "upper point as set");
	assert.equal(elevatorAt(elevatorFigures("moonElevator", { relPoint: "low" }), JD).rRel, plain.rLow);
	assert.equal(plain.rRel, plain.rHigh);
});

test("the anchors sit on the ground, 28 degrees from the mean sub-Earth point", function () {
	var g = elevatorFigures("moonElevator");
	[0, 7, 14, 21].forEach(function (d) {
		var at = elevatorAt(g, JD + d);
		assert.equal(at.anchors.length, 4);
		var sum = [0, 0, 0];
		at.anchors.forEach(function (a) {
			within(O.vMag(a), g.R, 1e-3, "on the surface");
			// Earth is never more than the librations (about 10 degrees) from the middle of the four.
			var ang = Math.acos(O.vDot(O.vUnit(a), at.u)) * DEG;
			assert.ok(ang > 15 && ang < 40, "angle from the Earth direction " + ang);
			sum = O.vAdd(sum, a);
		});
		assert.ok(Math.acos(O.vDot(O.vUnit(sum), at.u)) * DEG < 10.5, "the legs straddle the line to Earth");
		// Neighbours are 40 degrees of longitude or latitude apart.
		within(Math.acos(O.vDot(O.vUnit(at.anchors[0]), O.vUnit(at.anchors[1]))) * DEG, 37.5, 0.5, "north pair");
		within(Math.acos(O.vDot(O.vUnit(at.anchors[1]), O.vUnit(at.anchors[2]))) * DEG, 40, 1e-6, "west pair");
	});
});

test("releaseState is the chosen point's state, for either kind of facility", function () {
	var g = elevatorFigures("moonElevator", { relPoint: "low" }), at = elevatorAt(g, JD);
	var s = releaseState(g, JD), p = elevatorPointState(g, at.rLow, JD);
	assert.deepEqual(s.r, p.r); assert.deepEqual(s.v, p.v);
	assert.equal(s.radius, at.rLow);
	var k = skyhookFigures("moonSkyhook"), r = releaseState(k, JD);
	assert.equal(r.radius, k.rRel);
	within(O.vMag(r.relV), k.vRel, 1e-6, "skyhook release speed");
});

test("a ship let go at the counterweight falls to a perigee close to Earth", function () {
	var f = computeFlight({ from: "moonElevator", jd: JD });
	assert.ok(f.ok);
	assert.equal(f.final.kind, "integrated");
	assert.equal(f.summary.primary, "Earth");
	// The workbench's own counterweight (221,900 km from the Moon's centre) gives a
	// perigee about 90 km up at the mean distance; over the month it moves by a
	// couple of thousand kilometres either way, below the ground included.
	assert.ok(f.summary.periAlt < 3000e3, "perigee altitude " + f.summary.periAlt);
	var s0 = flightStateAt(f, 0);
	within(O.vMag(O.vSub(s0.r, f.release.r)), 0, 1e-6, "the flight starts at the release point");
});

test("a ship let go a little above L1 still goes to Earth", function () {
	var f = computeFlight({ from: "moonElevator", jd: JD, params: { moonElevator: { highAlt: 60000e3 } } });
	assert.ok(f.ok);
	assert.equal(f.summary.primary, "Earth");
	assert.equal(f.summary.impact, null);
});

test("a ship let go below L1 falls into an orbit of the Moon, flown under all three pulls", function () {
	var f = computeFlight({ from: "moonElevator", jd: JD, params: { moonElevator: { relPoint: "low" } } });
	assert.ok(f.ok);
	assert.equal(f.final.kind, "integrated");
	assert.equal(f.summary.primary, "Moon");
	assert.equal(f.summary.impact, null);
	within(f.summary.apoAlt, 45000e3, 50e3, "it starts at its highest point");
	// From the default 45,000 km it comes down to within the Moon skyhook's reach (1 to 2,000 km).
	assert.ok(f.summary.periAlt > 500e3 && f.summary.periAlt < 2500e3, "periapsis altitude " + f.summary.periAlt);
	var low = computeFlight({ from: "moonElevator", jd: JD, params: { moonElevator: { relPoint: "low", lowAlt: 20000e3 } } });
	assert.equal(low.summary.impact, "Moon");
});

test("an elevator flight can be judged against a skyhook", function () {
	var f = computeFlight({ from: "moonElevator", to: "earthSkyhook", jd: JD });
	assert.ok(f.ok);
	assert.ok(f.arrival && f.arrival.found);
	assert.ok(isFinite(f.arrival.miss) && isFinite(f.arrival.trim));
	assert.equal(computeFlight({ from: "moonSkyhook", to: "moonElevator", jd: JD }).diagnostic.code, "no-arrival");
	assert.ok(FACILITIES.moonElevator);
});
