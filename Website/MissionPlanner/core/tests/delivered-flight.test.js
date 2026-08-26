// Node tests for core/delivered-flight.js — the flight the ship is ACTUALLY
// on, as opposed to the plan's. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/delivered-flight.test.js
//
// Built on the SHIPPED missions rather than synthetic ones, so the figures
// asserted here are the ones the compliance bar really shows.

import test from "node:test";
import assert from "node:assert/strict";

import { deliveredFlight, waypointDv, vInfOf, signatureOf, rebaseWaypoints }
	from "../delivered-flight.js";
import { defaultMission } from "../../presets/default-mission.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

function planOf(mission) {
	var st = (mission || defaultMission).stages;
	var fp = st.filter(function (s) { return s.moduleId === "frozen-plan"; })[0].params;
	var tl = st.filter(function (s) { return s.moduleId === "transfer-leg"; })[0].params;
	return { origin: fp.origin, dep: fp.departure, arr: fp.arrival, wps: tl.waypoints };
}

function specFor(delivered, mission) {
	var pl = planOf(mission);
	return { origin: pl.origin, destination: pl.arr.body, delivered: delivered,
	         waypoints: pl.wps, arrivalJd: pl.arr.jd };
}

test("the shipped plan's own hand-off flies its own mission", function () {
	var pl = planOf();
	var f = deliveredFlight(specFor(pl.dep));
	assert.equal(f.ok, true, f.reason);
	assert.ok(f.pass, "the shipped plan should reach Ceres");
	// the figures the bar quotes, all off this one flight
	assert.ok(Math.abs(f.pass.altitude - 17.185e6) < 0.5e6,
		"pass altitude " + Math.round(f.pass.altitude / 1000) + " km");
	assert.ok(Math.abs(f.vInfOut - 6550) < 50, "v-inf out " + Math.round(f.vInfOut) + " m/s");
	assert.ok(f.pass.vInf > 0 && f.pass.vInf < f.pass.speed,
		"v-inf in sits below the speed at the pass");
	assert.ok(f.coastDv > 0, "the shipped plan spends something on its waypoint");
});

// The whole reason this module exists: the plan's hand-off and the technology's
// are different points, and they arrive in different places.
test("an offset exit point flies somewhere else entirely", function () {
	var pl = planOf();
	var perp = O.vUnit(O.vCross(pl.dep.r, pl.dep.v));
	var moved = { r: O.vAdd(pl.dep.r, O.vScale(perp, 2e8)), v: pl.dep.v.slice(), jd: pl.dep.jd };
	var f = deliveredFlight(specFor(moved));
	assert.equal(f.ok, true, f.reason);
	assert.ok(f.pass.altitude > 100e6,
		"200,000 km off the assumed exit point should wreck the arrival, got " +
		Math.round(f.pass.altitude / 1000) + " km");
});

test("v-inf out needs no flight, and survives a coast that will not compute", function () {
	var pl = planOf();
	// a hand-off after the arrival: there is no coast to fly at all
	var f = deliveredFlight(specFor({ r: pl.dep.r, v: pl.dep.v, jd: pl.arr.jd + 1 }));
	assert.equal(f.ok, false);
	assert.match(f.reason, /no coast left/);
	// Still a real figure: v-inf out is the hand-off measured against the
	// origin's velocity at that epoch, and needs no flight to exist. (Not the
	// plan's 6.55 km/s — this hand-off sits two years later, with Earth
	// somewhere else on its orbit.)
	assert.ok(isFinite(f.vInfOut) && f.vInfOut > 0,
		"v-inf out is still reported, got " + f.vInfOut);
	assert.equal(f.pass, null);
});

test("a mission with no destination flies, and simply has no pass", function () {
	var pl = planOf();
	var f = deliveredFlight({ origin: pl.origin, destination: "", delivered: pl.dep,
		waypoints: pl.wps, arrivalJd: pl.arr.jd });
	assert.equal(f.ok, true, f.reason);
	assert.equal(f.pass, null);
	assert.ok(isFinite(f.vInfOut) && isFinite(f.coastDv));
});

test("no hand-off delivered is a reason, not a crash", function () {
	var f = deliveredFlight({ origin: "Earth", destination: "Ceres", delivered: null });
	assert.equal(f.ok, false);
	assert.equal(f.pass, null);
	assert.match(f.reason, /No hand-off/);
});

// ---- the pieces --------------------------------------------------------------

test("waypointDv adds magnitudes — trims cost propellant, they do not cancel", function () {
	assert.equal(waypointDv([]), 0);
	assert.equal(waypointDv(null), 0);
	// two opposite burns cost twice, not nothing
	assert.equal(waypointDv([{ burn: { pro: 100 } }, { burn: { pro: -100 } }]), 200);
	assert.equal(waypointDv([{ burn: { pro: 3, rad: 4 } }]), 5);
});

test("vInfOf is the excess left once the body is done, never negative", function () {
	var GM = systems.get("Ceres").GM;
	var r = [1e9, 0, 0];
	// far out and fast: v-infinity is barely below the relative speed
	var fast = vInfOf(GM, r, [0, 5000, 0]);
	assert.ok(fast > 4990 && fast < 5000, "got " + fast);
	// bound to the body: no excess at all, rather than a NaN from a negative root
	assert.equal(vInfOf(GM, [1e6, 0, 0], [0, 1, 0]), 0);
});

test("the signature keys on what the answer depends on, and not on the clock", function () {
	var pl = planOf();
	var a = specFor(pl.dep);
	var b = specFor({ r: pl.dep.r.slice(), v: pl.dep.v.slice(), jd: pl.dep.jd });
	assert.equal(signatureOf(a), signatureOf(b), "the same flight keys the same");

	// a waypoint edit changes it...
	var edited = Object.assign({}, a, {
		waypoints: [{ days: 100, burn: { pro: 7, rad: 0, nrm: 0 } }] });
	assert.notEqual(signatureOf(a), signatureOf(edited));

	// ...and so does a moved hand-off
	var moved = specFor({ r: pl.dep.r, v: pl.dep.v, jd: pl.dep.jd + 1 });
	assert.notEqual(signatureOf(a), signatureOf(moved));

	// There is no clock in the spec at all — that is the point. Memoizing on
	// this is what makes the bar's figures affordable to keep live.
	assert.equal(Object.keys(a).indexOf("jd"), -1);
});

test("rebaseWaypoints holds absolute epochs and drops what falls outside", function () {
	var wps = [{ days: 10, burn: { pro: 1 } }, { days: 100, burn: { pro: 2 } },
	           { days: 300, burn: { pro: 3 } }];
	var out = rebaseWaypoints(wps, 20, 250);
	assert.deepEqual(out.map(function (w) { return w.days; }), [80]);
	assert.notEqual(out[0].burn, wps[1].burn, "burns are copies, not shared references");
});
