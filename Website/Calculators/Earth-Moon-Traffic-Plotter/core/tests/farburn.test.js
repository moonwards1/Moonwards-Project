// Node tests for the Earth-Moon-Traffic-Plotter's far-burn solve. Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { CLOCK_EPOCH, skyhookFigures } from "../facilities.js";
import { computeFlight } from "../flight.js";
import { CATCH_SPEED_LIMIT } from "../arrival.js";
import { MAX_AXIS_MPS, burnSize } from "../waypoints.js";
import { solveFarBurn, FAR_MIN, TRIM_LEAD } from "../farburn.js";

var M = skyhookFigures("moonSkyhook"), E = skyhookFigures("earthSkyhook");
// 2081-06-27 20:06:54, from 811.2 km on the Moon skyhook: a release that loops
// out to 1.18 million km and comes back after ten weeks.
var LOOP = { from: "moonSkyhook", to: "earthSkyhook",
	jd: CLOCK_EPOCH + 548 - 4.205 + 0.46011673151751 * M.period / 86400,
	params: { moonSkyhook: { relAlt: 811.2e3 } } };

test("a far burn and a trim turn a long loop from the Moon into a catch at the tether's speed", function () {
	// Thrown straight in, the same release misses by tens of thousands of km at several km/s.
	var coast = computeFlight(LOOP);
	assert.ok(coast.arrival.miss > 1e7 && coast.arrival.trim > 3000);

	var s = solveFarBurn(LOOP);
	assert.ok(s.ok, s.message);
	assert.equal(s.waypoints.length, 2);
	var far = s.waypoints[0], trim = s.waypoints[1], a = s.flight.arrival;
	assert.equal(s.caught, true, "miss " + a.miss + " m, relative motion " + a.trim + " m/s");
	assert.ok(a.miss < 100, "miss " + a.miss);
	assert.ok(s.speed < 20 && s.speed < CATCH_SPEED_LIMIT, "relative motion " + s.speed);
	// The catch is at perigee, where the ship's speed is the tether's.
	assert.ok(Math.abs(a.altitude - 5267e3) < 20e3, "catch altitude " + a.altitude);
	assert.ok(Math.abs(a.shipSpeed - a.pointSpeed) < 20);
	// The far burn: far out, close to Earth's equatorial plane, within the waypoint limit.
	var w = s.flight.waypoints[0];
	assert.equal(w.reached, true);
	assert.ok(O.vMag(w.r) > FAR_MIN, "far burn at " + O.vMag(w.r));
	assert.ok(Math.abs(O.vDot(w.r, E.normal)) / O.vMag(w.r) < Math.sin(5 * Math.PI / 180), "within 5 degrees of the plane");
	["pro", "rad", "nrm"].forEach(function (k) { assert.ok(Math.abs(far.burn[k]) <= MAX_AXIS_MPS, k + " " + far.burn[k]); });
	assert.ok(burnSize(far.burn) > 50 && burnSize(far.burn) < 300, "far burn " + burnSize(far.burn));
	// The trim: a day before the catch, and small.
	assert.ok(Math.abs(a.t - trim.t - TRIM_LEAD) < 600, "trim lead " + (a.t - trim.t));
	assert.ok(burnSize(trim.burn) < 2, "trim " + burnSize(trim.burn));
	// The result is exactly what flying the release through those two burns gives.
	var again = computeFlight(Object.assign({}, LOOP, { waypoints: s.waypoints }));
	assert.equal(again.arrival.caught, true);
	assert.ok(Math.abs(again.arrival.trim - s.speed) < 1e-6);
	// Rounded to the 0.1 m/s a hand could set, the far burn alone no longer makes the catch.
	var rounded = { t: far.t, burn: { pro: Math.round(far.burn.pro * 10) / 10, rad: Math.round(far.burn.rad * 10) / 10, nrm: Math.round(far.burn.nrm * 10) / 10 } };
	assert.equal(computeFlight(Object.assign({}, LOOP, { waypoints: [rounded] })).arrival.caught, false);
});

test("a release that allows no far burn is told why", function () {
	// The Moon skyhook's ordinary release to Earth never goes far out.
	var direct = { from: "moonSkyhook", to: "earthSkyhook", jd: CLOCK_EPOCH + 81 };
	assert.equal(solveFarBurn(direct).reason, "no-crossing");
	// A release that stays in lunar orbit.
	assert.equal(solveFarBurn(Object.assign({}, direct, { params: { moonSkyhook: { relAlt: 400e3 } } })).reason, "no-crossing");
	// Only flights to the Earth skyhook.
	assert.equal(solveFarBurn({ from: "earthSkyhook", to: "moonSkyhook", jd: CLOCK_EPOCH + 81 }).reason, "not-earth");
	assert.equal(solveFarBurn(Object.assign({}, direct, { params: { moonSkyhook: { relAlt: 0 } } })).reason, "no-flight");
});
