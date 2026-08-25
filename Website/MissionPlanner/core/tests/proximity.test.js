// Node tests for core/proximity.js — the shared "close enough to call this an
// arrival" standard. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/proximity.test.js
//
// The cases are built from real body states rather than hand-picked vectors,
// so a change to the ephemeris or the orbit model shows up here as a failure
// rather than passing against numbers that were only ever true on paper.

import test from "node:test";
import assert from "node:assert/strict";

import { checkProximity, proximityReason, checkAdoptable, adoptableReason,
	APPROACH_FAR, TEMP_FAR, MAX_ADOPT_MISS } from "../proximity.js";
import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";

var GM_SUN = systems.get("Sun").GM;
var MARS = systems.get("Mars");
var JD = O.julianDate(2033, 9, 29, 0, 0, 0);
var AU = 149597870700;

// Mars' own position at JD is by definition on its orbit ring, and Mars is by
// definition there then — the ideal arrival.
function marsAt(jd) { return O.bodyStateAtJD(GM_SUN, MARS.orbit, jd).r; }

test("a point at the body itself passes both tests", () => {
	var res = checkProximity(GM_SUN, MARS.orbit, marsAt(JD), JD);
	assert.equal(res.ok, true);
	assert.equal(res.spaceOk, true);
	assert.equal(res.timeOk, true);
	assert.ok(res.distToOrbit < 1e-3, "on the ring, got " + res.distToOrbit);
	assert.ok(Math.abs(res.dtDays) < 1e-6, "no phasing gap, got " + res.dtDays);
});

test("SPACE: pushed off the orbit ring, it fails and times nothing", () => {
	var r = marsAt(JD);
	// straight out from the Sun by 1.5x the threshold — radially outward is
	// (near enough) perpendicular to the ring, so the offset IS the distance
	var out = O.vScale(O.vUnit(r), 1.5 * APPROACH_FAR);
	var res = checkProximity(GM_SUN, MARS.orbit, O.vAdd(r, out), JD);
	assert.equal(res.spaceOk, false);
	assert.equal(res.ok, false);
	assert.ok(res.distToOrbit > APPROACH_FAR);
	// timing is not a coherent question when the path never reaches the ring
	assert.equal(res.dtDays, null);
	assert.equal(res.timeOk, false);
});

test("SPACE: just inside the threshold still passes", () => {
	var r = marsAt(JD);
	var out = O.vScale(O.vUnit(r), 0.5 * APPROACH_FAR);
	var res = checkProximity(GM_SUN, MARS.orbit, O.vAdd(r, out), JD);
	assert.equal(res.spaceOk, true);
	assert.equal(res.ok, true);
});

test("TIME: right place, wrong epoch — space passes, time fails", () => {
	// The ship is where Mars WILL be at JD, but claims to arrive 200 d earlier.
	var res = checkProximity(GM_SUN, MARS.orbit, marsAt(JD), JD - 200);
	assert.equal(res.spaceOk, true, "still on the ring");
	assert.equal(res.timeOk, false);
	assert.equal(res.ok, false);
	assert.ok(Math.abs(res.dtDays) > TEMP_FAR);
});

test("TIME: a gap inside TEMP_FAR still passes, and is signed", () => {
	var early = checkProximity(GM_SUN, MARS.orbit, marsAt(JD), JD - 10);
	assert.equal(early.ok, true);
	assert.ok(Math.abs(early.dtDays) < TEMP_FAR);
	var late = checkProximity(GM_SUN, MARS.orbit, marsAt(JD), JD + 10);
	assert.equal(late.ok, true);
	// arriving early vs late puts the body on opposite sides of the ship
	assert.ok(early.dtDays * late.dtDays < 0, "the sign should flip");
});

test("a hyperbolic or missing destination has no ring to measure against", () => {
	var r = marsAt(JD);
	assert.equal(checkProximity(GM_SUN, { a: 1e11, e: 1.4 }, r, JD).ok, false);
	assert.equal(checkProximity(GM_SUN, null, r, JD).ok, false);
	assert.equal(checkProximity(GM_SUN, MARS.orbit, r, NaN).ok, false);
});

test("proximityReason names the failing test, and the subject it was given", () => {
	var pass = checkProximity(GM_SUN, MARS.orbit, marsAt(JD), JD);
	assert.match(proximityReason(pass, "Marker", "Mars"), /^Marker reaches Mars inside both/);

	var r = marsAt(JD);
	var far = checkProximity(GM_SUN, MARS.orbit,
		O.vAdd(r, O.vScale(O.vUnit(r), 3 * APPROACH_FAR)), JD);
	var msg = proximityReason(far, "The ship", "Mars");
	assert.match(msg, /AU from Mars's orbit/);
	assert.match(msg, new RegExp((APPROACH_FAR / AU).toFixed(3)));

	var late = checkProximity(GM_SUN, MARS.orbit, marsAt(JD), JD - 200);
	assert.match(proximityReason(late, "The ship", "Mars"), /timing is off by .* d/);
});

// ---- adoption's standard: the flight has to actually REACH the body --------

test("checkAdoptable: inside MAX_ADOPT_MISS passes, outside fails", () => {
	assert.equal(checkAdoptable(0.5 * MAX_ADOPT_MISS).ok, true);
	assert.equal(checkAdoptable(MAX_ADOPT_MISS - 1).ok, true);
	assert.equal(checkAdoptable(MAX_ADOPT_MISS).ok, false, "the threshold itself is out");
	assert.equal(checkAdoptable(2 * MAX_ADOPT_MISS).ok, false);
});

test("checkAdoptable: an interception (miss 0) counts as reaching it", () => {
	assert.equal(checkAdoptable(0).ok, true);
});

test("checkAdoptable: no encounter at all is not adoptable", () => {
	assert.equal(checkAdoptable(Infinity).ok, false);
	assert.equal(checkAdoptable(NaN).ok, false);
	assert.equal(checkAdoptable(-1).ok, false);   // nonsense in, refusal out
});

test("adoption's standard is far stricter than the rings' — that is the point", () => {
	// A pass that clears the ring test comfortably can still be nowhere near
	// the body: 0.004 AU from the ORBIT is twenty times MAX_ADOPT_MISS.
	assert.ok(MAX_ADOPT_MISS < APPROACH_FAR / 10,
		"adoption should be at least an order tighter than the ring gate");
	assert.equal(checkAdoptable(0.5 * APPROACH_FAR).ok, false);
});

test("adoptableReason states the figure, the limit, and where to go instead", () => {
	var ok = checkAdoptable(0.5 * MAX_ADOPT_MISS);
	assert.match(adoptableReason(ok, "Ceres"), /still reaches Ceres, passing within [\d,]+ km/);

	var bad = checkAdoptable(50 * MAX_ADOPT_MISS);
	var msg = adoptableReason(bad, "Ceres");
	assert.match(msg, /passes [\d,]+ km from Ceres/);
	assert.match(msg, /needs to be within [\d,]+ km/);
	assert.match(msg, /Ephemeris tab/);

	assert.match(adoptableReason(checkAdoptable(Infinity), "Ceres"), /never comes near Ceres/);
});
