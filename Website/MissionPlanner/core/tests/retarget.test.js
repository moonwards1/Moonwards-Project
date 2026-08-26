// Node tests for core/retarget.js — re-stating the departure requirement at the
// point a technology actually leaves from. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/retarget.test.js
//
// The cases are built on the SHIPPED Moon->Ceres plan rather than a synthetic
// one, so the solver is exercised against a real flight with a real mid-course
// waypoint. That plan passes 17,185 km above Ceres as authored; the Earth->Mars
// reference was authored around a ~44,100 km flyby offset. BOTH re-target,
// because the solve aims for a PASS (proximity.js's AIM_PASS_ALTITUDE) rather
// than preserving whatever offset a plan happened to be built with — asserted
// at the bottom, because that is a real consequence worth pinning down.

import test from "node:test";
import assert from "node:assert/strict";

import { solveDepartureTarget, propagateWithWaypoints, solveArrivalVelocity,
	passAltitudeFrom, rebaseWaypoints } from "../retarget.js";
import { MAX_PASS_ALTITUDE, AIM_PASS_ALTITUDE } from "../proximity.js";
import { deliveredFlight } from "../delivered-flight.js";
import { defaultMission } from "../../presets/default-mission.js";
import { earthMarsReferenceMission } from "../../presets/earth-mars-reference.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

var GM_SUN = systems.get("Sun").GM;

function planOf(mission) {
	var st = (mission || defaultMission).stages;
	var fp = st.filter(function (s) { return s.moduleId === "frozen-plan"; })[0].params;
	var tl = st.filter(function (s) { return s.moduleId === "transfer-leg"; })[0].params;
	return { origin: fp.origin, dep: fp.departure, arr: fp.arrival, wps: tl.waypoints };
}

// A delivered hand-off that leaves from a DIFFERENT point on the SOI sphere,
// offset perpendicular to the flight so it is a pure aiming difference.
function deliveredOffsetBy(metres, mission) {
	var p = planOf(mission).dep;
	var perp = O.vUnit(O.vCross(p.r, p.v));
	return { r: O.vAdd(p.r, O.vScale(perp, metres)), v: p.v.slice(), jd: p.jd };
}

function specFor(delivered, mission) {
	var pl = planOf(mission);
	return { origin: "Earth", destination: pl.arr.body, delivered: delivered,
	         planDeparture: pl.dep, planWaypoints: pl.wps, arrivalJd: pl.arr.jd };
}

test("the plan's own hand-off already arrives — that is the control", () => {
	var pl = planOf();
	var alt = passAltitudeFrom(pl.dep, pl.wps, pl.arr.jd, pl.arr.body);
	assert.ok(alt < MAX_PASS_ALTITUDE,
		"the shipped plan should reach Ceres inside the bound, got " + Math.round(alt / 1000) + " km");
});

// 200,000 km is the scale of a real difference: the shipped Moon->Ceres chain
// exits 209,335 km from the point its plan assumes.
test("a 200,000 km offset exit point wrecks the arrival, and the solve recovers it", () => {
	var res = solveDepartureTarget(specFor(deliveredOffsetBy(2e8)));   // 2e8 m = 200,000 km
	assert.equal(res.ok, true, res.reason);
	// flown as delivered it misses by many times the bound...
	assert.ok(res.passBefore > 10 * MAX_PASS_ALTITUDE,
		"as delivered should miss badly, got " + Math.round(res.passBefore / 1000) + " km");
	// ...and re-solved from that same point it lands on the AIM, not merely
	// inside the bound — the margin between the two is what the next
	// iteration's residual gets to spend
	assert.ok(Math.abs(res.passAfter - AIM_PASS_ALTITUDE) < 0.05 * AIM_PASS_ALTITUDE,
		"re-solved should pass at the aim, got " + Math.round(res.passAfter / 1000) + " km");
	// the correction the technology has to make is small — that is what makes
	// the tune/re-target loop converge instead of thrashing, and what keeps the
	// course-correction budget free for the drift it is meant for
	assert.ok(res.turnDeg < 1, "turn " + res.turnDeg.toFixed(3) + " deg");
	assert.ok(res.askWorst < 100, "asks " + Math.round(res.askWorst) + " m/s on an axis");
});

test("the solve keeps the exit point and epoch, and only re-states the velocity", () => {
	var d = deliveredOffsetBy(2e8);   // 2e8 m = 200,000 km
	var res = solveDepartureTarget(specFor(d));
	assert.equal(res.ok, true, res.reason);
	assert.deepEqual(res.r, d.r, "the delivered exit point is kept, not moved");
	assert.equal(res.jd, d.jd, "and so is its epoch");
	assert.ok(O.vMag(O.vSub(res.v, d.v)) > 1, "the velocity is the thing that changes");
});

test("an unchanged hand-off solves back to (essentially) the plan's own velocity", () => {
	var pl = planOf();
	var res = solveDepartureTarget(specFor({ r: pl.dep.r, v: pl.dep.v, jd: pl.dep.jd }));
	assert.equal(res.ok, true, res.reason);
	// nothing moved, so nothing should need to change
	assert.ok(O.vMag(O.vSub(res.v, pl.dep.v)) < 1,
		"solved velocity should match the plan's, off by " + O.vMag(O.vSub(res.v, pl.dep.v)).toFixed(3) + " m/s");
	assert.ok(res.turnDeg < 0.01);
});

test("a hand-off flung far enough off base is refused, and says where to go", () => {
	// A quarter of an AU sideways is not a departure to re-point. Lambert will
	// still answer — at a 70 degree turn and about 4.8 km/s — which is exactly
	// why the answer alone cannot be the test: the ASK has to stay inside normal
	// correction scale.
	var res = solveDepartureTarget(specFor(deliveredOffsetBy(0.25 * 149597870700)));
	assert.equal(res.ok, false);
	assert.match(res.reason, /correction limit/);
	assert.match(res.reason, /Ephemeris tab/);
});

test("a hand-off at or after the arrival has no coast to solve", () => {
	var pl = planOf();
	var res = solveDepartureTarget(specFor({ r: pl.dep.r, v: pl.dep.v, jd: pl.arr.jd + 1 }));
	assert.equal(res.ok, false);
	assert.match(res.reason, /no coast left/);
});

// ---- the pieces the solve is built from ----------------------------------

test("propagateWithWaypoints applies each burn at its own day, in order", () => {
	var pl = planOf();
	var noBurn = propagateWithWaypoints(pl.dep.r, pl.dep.v, [], 600);
	var withBurn = propagateWithWaypoints(pl.dep.r, pl.dep.v, pl.wps, 600);
	// the shipped plan's waypoint fires on day 473, so by day 600 the two paths
	// have genuinely diverged
	assert.ok(O.vMag(O.vSub(noBurn.r, withBurn.r)) > 1e9, "the burn should bend the path");
	// and before the burn they are identical
	var early = 100;   // before the waypoint fires
	assert.deepEqual(propagateWithWaypoints(pl.dep.r, pl.dep.v, pl.wps, early).r,
		propagateWithWaypoints(pl.dep.r, pl.dep.v, [], early).r);
});

test("solveArrivalVelocity hits a target it is given, across the burns", () => {
	var pl = planOf();
	var tDays = pl.arr.jd - pl.dep.jd;
	var target = propagateWithWaypoints(pl.dep.r, pl.dep.v, pl.wps, tDays).r;
	// start from a deliberately wrong guess and let Newton close on it
	var guess = O.vAdd(pl.dep.v, [30, -20, 10]);
	var res = solveArrivalVelocity(pl.dep.r, guess, pl.wps, tDays, target);
	assert.ok(res.err < 1e4, "should converge to the target, off by " + Math.round(res.err / 1000) + " km");
	assert.ok(O.vMag(O.vSub(res.v, pl.dep.v)) < 1, "and recover the velocity that produced it");
});

test("rebaseWaypoints holds absolute epochs and drops what falls outside", () => {
	var wps = [{ days: 10, burn: { pro: 1 } }, { days: 100, burn: { pro: 2 } },
	           { days: 300, burn: { pro: 3 } }];
	// hand-off moved 20 days later: everything shifts 20 earlier in leg-time
	var out = rebaseWaypoints(wps, 20, 250);
	assert.deepEqual(out.map(function (w) { return w.days; }), [80]);
	// day 10 fell before the new hand-off, day 300 past the new leg's end
	assert.deepEqual(out[0].burn, { pro: 2 });
	// and the burns are copies, not shared references
	assert.notEqual(out[0].burn, wps[1].burn);
});

// ---- the aim is a pass, not the plan's own arrival point -------------------

test("the solve lands on AIM_PASS_ALTITUDE, whatever offset the plan was built with", () => {
	// The Earth->Mars reference was authored around a ~44,100 km flyby offset —
	// outside MAX_PASS_ALTITUDE, so under a bound that preserved a plan's own
	// aim point this mission could never be re-targeted at all. Aiming for a
	// PASS instead standardises it, and that is the point of the change.
	var pl = planOf(earthMarsReferenceMission);
	var authored = passAltitudeFrom(pl.dep, pl.wps, pl.arr.jd, pl.arr.body);
	assert.ok(authored > MAX_PASS_ALTITUDE,
		"the reference should sit outside the bound as authored, got " +
		Math.round(authored / 1000) + " km");

	var res = solveDepartureTarget(specFor(deliveredOffsetBy(2e8, earthMarsReferenceMission),
		earthMarsReferenceMission));
	assert.equal(res.ok, true, res.reason);
	assert.ok(Math.abs(res.passAfter - AIM_PASS_ALTITUDE) < 0.05 * AIM_PASS_ALTITUDE,
		"re-solved should pass at the aim, got " + Math.round(res.passAfter / 1000) + " km");
});

test("re-targeting keeps the side of the body the flight already passes on", () => {
	var pl = planOf();
	var d = deliveredOffsetBy(2e8);
	var before = deliveredFlight({ origin: pl.origin || "Earth", destination: pl.arr.body,
		delivered: d, waypoints: rebaseWaypoints(pl.wps, d.jd - pl.dep.jd, pl.arr.jd - d.jd),
		arrivalJd: pl.arr.jd });
	var res = solveDepartureTarget(specFor(d));
	assert.equal(res.ok, true, res.reason);
	var after = deliveredFlight({ origin: pl.origin || "Earth", destination: pl.arr.body,
		delivered: { r: res.r, v: res.v, jd: res.jd }, waypoints: res.waypoints,
		arrivalJd: pl.arr.jd });
	// Same hemisphere of the approach: the offset is pulled in from 463,000 km
	// to 15,000 km, but not flipped to the far face of the body.
	var dot = O.vDot(O.vUnit(before.pass.rRel), O.vUnit(after.pass.rRel));
	assert.ok(dot > 0, "the pass should stay on the same side, dot " + dot.toFixed(3));
});
