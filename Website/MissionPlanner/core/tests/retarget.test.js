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
	// The coast's HORIZON — its own duration, which is what the solve aims
	// over now that no arrival date is committed.
	return { origin: fp.origin, dep: fp.departure, arr: fp.arrival, wps: tl.waypoints,
	         legDays: tl.legDays, horizon: fp.departure.jd + tl.legDays };
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
	         planDeparture: pl.dep, coastWaypoints: pl.wps, horizonJd: pl.horizon };
}

test("the plan's own hand-off already arrives — that is the control", () => {
	var pl = planOf();
	var alt = passAltitudeFrom(pl.dep, pl.wps, pl.horizon, pl.arr.body);
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

test("the size of the ask does not gate a requirement that arrives", () => {
	// A quarter of an AU sideways asks the departure for a 70 degree turn and
	// about 10 km/s on one axis. That is a large ask — and it is still the
	// correct requirement, because a departure meeting it lands the mission at
	// the aim. Where the flight PASSES is the only standard; what the ask costs
	// is answered by building the departure up, not by refusing to state it.
	var res = solveDepartureTarget(specFor(deliveredOffsetBy(0.25 * 149597870700)));
	assert.equal(res.ok, true, res.reason);
	assert.ok(res.passAfter < MAX_PASS_ALTITUDE,
		"the re-solved flight arrives, got " + Math.round(res.passAfter / 1000) + " km");
	assert.equal(res.withinTolerance, true);
	assert.equal(res.reason, null);
	// The ask is still reported — the mission report shows it shrinking across
	// iterations — it just decides nothing.
	assert.ok(res.askWorst > 1000, "a large ask, reported: " + Math.round(res.askWorst) + " m/s");
});

test("what Update commits follows the pass and nothing else", () => {
	// Across offsets spanning five orders of magnitude — and asks spanning
	// three, from 1 m/s to 15 km/s — the gate tracks one thing.
	var offsets = [0, 2e8, 0.25 * 149597870700, 149597870700];
	var asks = [];
	offsets.forEach(function (m) {
		var res = solveDepartureTarget(specFor(
			m === 0 ? { r: planOf().dep.r, v: planOf().dep.v, jd: planOf().dep.jd }
			        : deliveredOffsetBy(m)));
		assert.equal(res.ok, true, m + ": " + res.reason);
		assert.equal(res.withinTolerance, res.passAfter < MAX_PASS_ALTITUDE,
			"offset " + m + " m: the gate is the pass");
		assert.equal(res.reason === null, res.withinTolerance,
			"offset " + m + " m: a reason is given exactly when it is refused");
		asks.push(res.askWorst);
	});
	// The isolation: the asks really do span the range that used to decide this,
	// so the assertions above are not all testing the same easy case.
	assert.ok(Math.max.apply(null, asks) > 100 * WAS_THE_OLD_CAP,
		"asks should span past the old cap, max " + Math.round(Math.max.apply(null, asks)));
	assert.ok(Math.min.apply(null, asks) < WAS_THE_OLD_CAP,
		"and start below it, min " + Math.round(Math.min.apply(null, asks)));
});
// The per-axis course-correction limit re-targeting used to be held to. Named
// here only so the test above can show it is spanned and no longer decides.
var WAS_THE_OLD_CAP = 100;

test("a hand-off at or after the coast's own end has no coast to solve", () => {
	var pl = planOf();
	var res = solveDepartureTarget(specFor({ r: pl.dep.r, v: pl.dep.v, jd: pl.horizon + 1 }));
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
	var tDays = pl.legDays;
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
	var authored = passAltitudeFrom(pl.dep, pl.wps, pl.horizon, pl.arr.body);
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
		delivered: d, waypoints: rebaseWaypoints(pl.wps, d.jd - pl.dep.jd, pl.horizon - d.jd),
		horizonJd: pl.horizon });
	var res = solveDepartureTarget(specFor(d));
	assert.equal(res.ok, true, res.reason);
	var after = deliveredFlight({ origin: pl.origin || "Earth", destination: pl.arr.body,
		delivered: { r: res.r, v: res.v, jd: res.jd }, waypoints: res.waypoints,
		horizonJd: pl.horizon });
	// Same hemisphere of the approach: the offset is pulled in from 463,000 km
	// to 15,000 km, but not flipped to the far face of the body.
	var dot = O.vDot(O.vUnit(before.pass.rRel), O.vUnit(after.pass.rRel));
	assert.ok(dot > 0, "the pass should stay on the same side, dot " + dot.toFixed(3));
});

// ---- near-180 degree transfers, where the Lambert seed is singular ---------

// A real Earth->Ceres mission whose 551-day coast sweeps 176.5 degrees of true
// anomaly. At that geometry the transfer plane is undefined, so a Lambert conic
// answers with an arbitrary steep one; Newton started there stalls in an
// ill-conditioned out-of-plane direction 9.7 million km from the aim, and the
// stalled velocity used to be returned as the departure requirement — a 12.34
// km/s ask with an 11.8 km/s normal component, which the Departure card's
// Needed column then showed as the figure to build towards.
//
// Seeded from the delivered velocity instead, the same case converges exactly:
// the answer is a 108 m/s trim of a flight that was already going the right way.
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
	// The aim is reached: the pass lands on AIM_PASS_ALTITUDE, where before the
	// fix it came out 6.45 million km away — twice as far as flying the
	// delivered hand-off untouched.
	assert.ok(Math.abs(res.passAfter - AIM_PASS_ALTITUDE) < 0.05 * AIM_PASS_ALTITUDE,
		"should pass at the aim, got " + Math.round(res.passAfter / 1000) + " km");
	assert.ok(res.passAfter < res.passBefore,
		"re-solving must not make the approach worse: " +
		Math.round(res.passBefore / 1000) + " km -> " + Math.round(res.passAfter / 1000) + " km");
	// A small ask, in the frame the Departure card states its own vector in.
	assert.ok(res.askWorst < 200,
		"the ask should be a trim, got " + Math.round(res.askWorst) + " m/s on one axis");
	assert.ok(res.turnDeg < 5, "a small turn, got " + res.turnDeg.toFixed(2) + " degrees");
});

test("a solve that never reaches its aim is not reported as a requirement", () => {
	// A hand-off an AU off base: Newton cannot bring the flight back, so there
	// is no requirement to state. The module reports figures it cannot commit,
	// but only when they mean something.
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
