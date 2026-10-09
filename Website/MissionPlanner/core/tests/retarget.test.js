// Node tests for core/retarget.js — re-stating the departure requirement at the
// point a technology actually leaves from. Run from the repo root:
//   node --test Website/MissionPlanner/core/tests/retarget.test.js
//
// The plan under test is the adopted plan of presets/moon-mars-2035-unbuilt.js:
// a real Moon -> Mars flight with one mid-course waypoint, whose own hand-off
// already passes Mars inside the bound.

import test from "node:test";
import assert from "node:assert/strict";

import { solveDepartureTarget, propagateWithWaypoints, solveArrivalVelocity,
	passAltitudeFrom, rebaseWaypoints } from "../retarget.js";
import { MAX_PASS_ALTITUDE, AIM_PASS_ALTITUDE } from "../proximity.js";
import { deliveredFlight } from "../delivered-flight.js";
import { moonMars2035UnbuiltMission } from "../../presets/moon-mars-2035-unbuilt.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";

var AU = 149597870700;

function planOf() {
	var st = moonMars2035UnbuiltMission.stages;
	var fp = st.filter(function (s) { return s.moduleId === "adopted-plan"; })[0].params;
	var tl = st.filter(function (s) { return s.moduleId === "transfer-leg"; })[0].params;
	return { dep: fp.departure, arr: fp.arrival, wps: tl.waypoints,
	         legDays: tl.legDays, horizon: fp.departure.jd + tl.legDays };
}

// A delivered hand-off that leaves from a DIFFERENT point on the SOI sphere,
// offset perpendicular to the flight so it is a pure aiming difference.
function deliveredOffsetBy(metres) {
	var p = planOf().dep;
	var perp = O.vUnit(O.vCross(p.r, p.v));
	return { r: O.vAdd(p.r, O.vScale(perp, metres)), v: p.v.slice(), jd: p.jd };
}

function specFor(delivered) {
	var pl = planOf();
	return { origin: "Earth", destination: pl.arr.body, delivered: delivered,
	         planDeparture: pl.dep, coastWaypoints: pl.wps, horizonJd: pl.horizon };
}

function planOwnHandoff() {
	var d = planOf().dep;
	return { r: d.r, v: d.v, jd: d.jd };
}

test("the plan's own hand-off already arrives — that is the control", () => {
	var pl = planOf();
	var alt = passAltitudeFrom(pl.dep, pl.wps, pl.horizon, pl.arr.body);
	assert.ok(alt < MAX_PASS_ALTITUDE, "should reach Mars inside the bound, got " + Math.round(alt / 1000) + " km");
});

test("a 200,000 km offset exit point wrecks the arrival, and the solve recovers it", () => {
	var res = solveDepartureTarget(specFor(deliveredOffsetBy(2e8)));   // 2e8 m = 200,000 km
	assert.equal(res.ok, true, res.reason);
	assert.ok(res.passBefore > MAX_PASS_ALTITUDE,
		"as delivered should miss the bound, got " + Math.round(res.passBefore / 1000) + " km");
	// re-solved from that same point it lands on the AIM, not merely inside the
	// bound — the margin between the two is what the next iteration's residual
	// gets to spend
	assert.ok(Math.abs(res.passAfter - AIM_PASS_ALTITUDE) < 0.05 * AIM_PASS_ALTITUDE,
		"re-solved should pass at the aim, got " + Math.round(res.passAfter / 1000) + " km");
	// a small correction is what lets the tune/re-target loop converge
	assert.ok(res.turnDeg < 5, "turn " + res.turnDeg.toFixed(3) + " deg");
	assert.ok(res.askWorst < 500, "asks " + Math.round(res.askWorst) + " m/s on an axis");
});

test("the solve keeps the exit point and epoch, and only re-states the velocity", () => {
	var d = deliveredOffsetBy(2e8);
	var res = solveDepartureTarget(specFor(d));
	assert.equal(res.ok, true, res.reason);
	assert.deepEqual(res.r, d.r, "the delivered exit point is kept, not moved");
	assert.equal(res.jd, d.jd, "and so is its epoch");
	assert.ok(O.vMag(O.vSub(res.v, d.v)) > 1, "the velocity is the thing that changes");
});

test("an unchanged hand-off needs essentially no change of velocity", () => {
	var pl = planOf();
	var res = solveDepartureTarget(specFor(planOwnHandoff()));
	assert.equal(res.ok, true, res.reason);
	// The solve aims at AIM_PASS_ALTITUDE, not at the plan's own pass, so a
	// small trim is expected; nothing near a re-aim.
	var dv = O.vMag(O.vSub(res.v, pl.dep.v));
	assert.ok(dv < 10, "solved velocity off the plan's by " + dv.toFixed(3) + " m/s");
	assert.ok(res.turnDeg < 0.5, "turn " + res.turnDeg.toFixed(3) + " deg");
});

test("the size of the ask does not gate a requirement that arrives", () => {
	// 0.05 AU sideways asks the departure for a large turn and several km/s.
	// That is still the correct requirement, because a departure meeting it
	// lands the mission at the aim; what the ask costs is answered by building
	// the departure up, not by refusing to state it.
	var res = solveDepartureTarget(specFor(deliveredOffsetBy(0.05 * AU)));
	assert.equal(res.ok, true, res.reason);
	assert.ok(res.passAfter < MAX_PASS_ALTITUDE,
		"the re-solved flight arrives, got " + Math.round(res.passAfter / 1000) + " km");
	assert.equal(res.withinTolerance, true);
	assert.equal(res.reason, null);
	// the ask is still reported, it just decides nothing
	assert.ok(res.askWorst > 1000, "a large ask, reported: " + Math.round(res.askWorst) + " m/s");
});

test("what Update commits follows the pass and nothing else", () => {
	// Across offsets whose asks span several orders of magnitude, the gate
	// tracks one thing: where the re-solved flight passes.
	var offsets = [0, 2e8, 0.02 * AU, 0.05 * AU, 0.15 * AU];
	var asks = [];
	offsets.forEach(function (m) {
		var res = solveDepartureTarget(specFor(m === 0 ? planOwnHandoff() : deliveredOffsetBy(m)));
		assert.equal(res.ok, true, m + ": " + res.reason);
		assert.equal(res.withinTolerance, res.passAfter < MAX_PASS_ALTITUDE,
			"offset " + m + " m: the gate is the pass");
		assert.equal(res.reason === null, res.withinTolerance,
			"offset " + m + " m: a reason is given exactly when it is refused");
		asks.push(res.askWorst);
	});
	// the asks really do span a wide range, so the assertions above are not
	// all testing the same easy case
	assert.ok(Math.min.apply(null, asks) < 100, "smallest ask " + Math.round(Math.min.apply(null, asks)));
	assert.ok(Math.max.apply(null, asks) > 10000, "largest ask " + Math.round(Math.max.apply(null, asks)));
});

test("a hand-off at or after the coast's own end has no coast to solve", () => {
	var pl = planOf();
	var res = solveDepartureTarget(specFor({ r: pl.dep.r, v: pl.dep.v, jd: pl.horizon + 1 }));
	assert.equal(res.ok, false);
	assert.match(res.reason, /no coast left/);
});

// ---- the pieces the solve is built from ----------------------------------

test("propagateWithWaypoints applies each burn at its own day, in order", () => {
	var pl = planOf();
	var noBurn = propagateWithWaypoints(pl.dep.r, pl.dep.v, [], pl.legDays);
	var withBurn = propagateWithWaypoints(pl.dep.r, pl.dep.v, pl.wps, pl.legDays);
	assert.ok(pl.wps[0].days < pl.legDays, "the plan's waypoint fires inside the coast");
	assert.ok(O.vMag(O.vSub(noBurn.r, withBurn.r)) > 1e8, "the burn should bend the path");
	// and before the burn they are identical
	var early = pl.wps[0].days / 2;
	assert.deepEqual(propagateWithWaypoints(pl.dep.r, pl.dep.v, pl.wps, early).r,
		propagateWithWaypoints(pl.dep.r, pl.dep.v, [], early).r);
});

test("solveArrivalVelocity hits a target it is given, across the burns", () => {
	var pl = planOf();
	var target = propagateWithWaypoints(pl.dep.r, pl.dep.v, pl.wps, pl.legDays).r;
	// start from a deliberately wrong guess and let Newton close on it
	var guess = O.vAdd(pl.dep.v, [30, -20, 10]);
	var res = solveArrivalVelocity(pl.dep.r, guess, pl.wps, pl.legDays, target);
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

// ---- the aim is a pass, on the side the flight already goes by --------------

test("re-targeting keeps the side of the body the flight already passes on", () => {
	var pl = planOf();
	var d = deliveredOffsetBy(2e8);
	var before = deliveredFlight({ origin: "Earth", destination: pl.arr.body,
		delivered: d, waypoints: rebaseWaypoints(pl.wps, d.jd - pl.dep.jd, pl.horizon - d.jd),
		horizonJd: pl.horizon });
	var res = solveDepartureTarget(specFor(d));
	assert.equal(res.ok, true, res.reason);
	var after = deliveredFlight({ origin: "Earth", destination: pl.arr.body,
		delivered: { r: res.r, v: res.v, jd: res.jd }, waypoints: res.waypoints,
		horizonJd: pl.horizon });
	// the offset is pulled in to the aim, not flipped to the far face of the body
	var dot = O.vDot(O.vUnit(before.pass.rRel), O.vUnit(after.pass.rRel));
	assert.ok(dot > 0, "the pass should stay on the same side, dot " + dot.toFixed(3));
});

// ---- near-180 degree transfers, where the Lambert seed is singular ---------

// An Earth -> Ceres coast that sweeps about 176 degrees of true anomaly. At
// that geometry the transfer plane is undefined, so a Lambert conic answers
// with an arbitrary steep one and a Newton solve seeded from it stalls far
// from the aim, returning a ~12 km/s ask. Seeded from the delivered velocity
// instead, the same case converges to a trim of a flight already going the
// right way.
var nearOppositionMission = {
	origin: "Earth",
	destination: "Ceres",
	delivered: { r: [-3239823775.384351, 147443882371.82523, 87338065.34408806],
	             v: [-36540.756751715846, 2024.3719365792563, 694.1564839959574],
	             jd: 2463223.897232968 },
	planDeparture: { r: [-2837989135.6456904, 147492497514.03708, 93373586.13984686],
	                 v: [-36546.545735811946, 2099.790327426168, 690],
	                 jd: 2463223.75 },
	coastWaypoints: [{ days: 345.43608844963944,
	                  burn: { pro: 1.1037750835542788, rad: 40.06689879098357,
	                          nrm: -677.2557345093262 } }],
	horizonJd: 2463223.897232968 + 551.4069569669664
};

test("a near-180 degree coast solves to a trim, not to a stalled two-point seed", () => {
	var res = solveDepartureTarget(nearOppositionMission);
	assert.equal(res.ok, true, res.reason);
	assert.ok(Math.abs(res.passAfter - AIM_PASS_ALTITUDE) < 0.05 * AIM_PASS_ALTITUDE,
		"should pass at the aim, got " + Math.round(res.passAfter / 1000) + " km");
	assert.ok(res.passAfter < res.passBefore,
		"re-solving must not make the approach worse: " +
		Math.round(res.passBefore / 1000) + " km -> " + Math.round(res.passAfter / 1000) + " km");
	// a trim, an order of magnitude under the stalled seed's ~12 km/s ask
	assert.ok(res.askWorst < 1000,
		"the ask should be a trim, got " + Math.round(res.askWorst) + " m/s on one axis");
	assert.ok(res.turnDeg < 10, "a small turn, got " + res.turnDeg.toFixed(2) + " degrees");
});

test("a solve that never reaches its aim is not reported as a requirement", () => {
	// A hand-off an AU off base: Newton cannot bring the flight back, so there
	// is no requirement to state.
	var pl = planOf();
	var res = solveDepartureTarget(specFor({
		r: O.vScale(pl.dep.r, 2.5), v: pl.dep.v.slice(), jd: pl.dep.jd
	}));
	if (res.ok) {
		assert.ok(res.passAfter <= res.passBefore || res.passAfter < MAX_PASS_ALTITUDE,
			"an ok solve must be an improvement or inside the bound");
	} else {
		assert.ok(/reach|come near|re-aim/.test(res.reason), "a stated reason: " + res.reason);
	}
});
