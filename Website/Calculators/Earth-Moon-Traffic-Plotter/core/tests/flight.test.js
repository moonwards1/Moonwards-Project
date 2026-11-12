// Node tests for the Earth-Moon-Traffic-Plotter's pure core. Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/*.test.js
//
// The skyhook figures are pinned to the example design exported from the home
// workbench on 2026-11-10 (the Hanging-skyhooks calculator's own results), so
// the plotter and the workbench describe the same hardware.

import test from "node:test";
import assert from "node:assert/strict";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { buildIntegratedLeg, moonGeoPos, moonGeoVel } from "../../../../Shared/geo-leg.js";
import { CLOCK_EPOCH, FACILITIES, skyhookFigures, phaseAt, tetherPointState, tetherAxes,
         resolveParams } from "../facilities.js";
import { computeFlight, flightStateAt } from "../flight.js";

function within(actual, expected, tol, label) {
	assert.ok(Math.abs(actual - expected) <= tol, label + ": " + actual + " not within " + tol + " of " + expected);
}

var JD = CLOCK_EPOCH + 81;   // 2080-03-22

test("the clock starts at 2080-01-01 00:00", function () {
	assert.equal(CLOCK_EPOCH, 2480764.5);
});

test("Moon skyhook figures match the workbench design", function () {
	var g = skyhookFigures("moonSkyhook");
	assert.ok(g.ok);
	within(g.period / 3600, 2.25, 0.005, "period, h");
	within(g.vFoot, 1350, 5, "foot speed");
	within(g.vCom, 1560, 5, "CoM speed");
	within(g.vTop, 2900, 5, "top speed");
	within(g.vInfBody, 833, 2, "v-infinity from the release deck");
	within(g.pullTop, 1.90, 0.005, "pull felt at the top");
	within(skyhookFigures("moonSkyhook", { relAlt: 2000e3 }).vInfBody, 2405, 2, "v-infinity from the top");
});

test("Earth skyhook figures match the workbench design", function () {
	var g = skyhookFigures("earthSkyhook");
	assert.ok(g.ok);
	within(g.period / 3600, 2.47, 0.005, "period, h");
	within(g.vFoot, 4590, 5, "foot speed");
	within(g.vCom, 6560, 5, "CoM speed");
	within(g.vTop, 8890, 5, "top speed");
	within(g.vInfBody, 3954, 2, "v-infinity from the top");
	within(g.pullTop, 3.77, 0.005, "pull felt at the top");
});

test("params fall back to the facility's defaults one by one", function () {
	var p = resolveParams("moonSkyhook", { relAlt: 500e3 });
	assert.equal(p.relAlt, 500e3);
	assert.equal(p.comAlt, FACILITIES.moonSkyhook.defaults.comAlt);
});

test("bad geometry is a diagnostic, not a throw", function () {
	assert.equal(skyhookFigures("moonSkyhook", { comAlt: 3000e3 }).diagnostic.code, "bad-order");
	assert.equal(skyhookFigures("moonSkyhook", { footAlt: 0 }).diagnostic.code, "bad-order");
	assert.equal(skyhookFigures("moonSkyhook", { relAlt: 2500e3 }).diagnostic.code, "release-off-tether");
	assert.equal(skyhookFigures("moonSkyhook", { topAlt: NaN }).diagnostic.code, "bad-params");
	assert.equal(computeFlight({ from: "moonSkyhook", jd: JD, params: { moonSkyhook: { relAlt: 0 } } }).ok, false);
	assert.throws(function () { skyhookFigures("nowhere"); });
});

test("the tether's angle follows the clock", function () {
	var g = skyhookFigures("moonSkyhook");
	assert.equal(phaseAt(g, CLOCK_EPOCH), g.phase0);
	var quarter = g.period / 4 / 86400;
	within(phaseAt(g, JD + quarter) - phaseAt(g, JD), Math.PI / 2, 1e-6, "a quarter period turns it 90 degrees");
	// One full period later the tether points the same way again.
	var a = tetherPointState(g, g.rRel, JD), b = tetherPointState(g, g.rRel, JD + g.period / 86400);
	within(O.vMag(O.vSub(a.relR, b.relR)), 0, 1, "body-relative position repeats, m");
});

test("the release point moves as a point on a rigid, prograde tether", function () {
	["moonSkyhook", "earthSkyhook"].forEach(function (id) {
		var g = skyhookFigures(id), s = tetherPointState(g, g.rRel, JD), ax = tetherAxes(g, JD);
		within(O.vMag(s.relR), g.rRel, 1e-3, id + " radius");
		within(O.vMag(s.relV), g.vRel, 1e-6, id + " speed");
		within(O.vDot(s.relR, s.relV), 0, 1, id + " velocity is tangential");
		within(O.vDot(s.relR, g.normal) / g.rRel, 0, 1e-12, id + " lies in the equatorial plane");
		assert.ok(O.vDot(O.vCross(s.relR, s.relV), g.normal) > 0, id + " turns prograde");
		within(O.vDot(O.vUnit(s.relR), ax.along), 1, 1e-12, id + " axes: along");
		within(O.vDot(O.vUnit(s.relV), ax.prograde), 1, 1e-12, id + " axes: prograde");
	});
	// The Moon skyhook rides the Moon around Earth; the Earth skyhook's body is the frame's origin.
	var gm = skyhookFigures("moonSkyhook"), sm = tetherPointState(gm, gm.rRel, JD);
	within(O.vMag(O.vSub(O.vSub(sm.r, sm.relR), moonGeoPos(JD))), 0, 1e-3, "Moon position carried");
	within(O.vMag(O.vSub(O.vSub(sm.v, sm.relV), moonGeoVel(JD))), 0, 1e-9, "Moon velocity carried");
	var ge = skyhookFigures("earthSkyhook"), se = tetherPointState(ge, ge.rRel, JD);
	assert.deepEqual(se.r, se.relR);
});

test("a release that escapes the Moon is flown by Shared/geo-leg.js, unchanged", function () {
	var f = computeFlight({ from: "moonSkyhook", jd: JD });
	assert.ok(f.ok);
	assert.equal(f.legs.length, 1);
	assert.equal(f.final.kind, "integrated");
	var direct = buildIntegratedLeg(f.release.r, f.release.v, JD, { moonPlaneNormal: f.fig.normal });
	assert.deepEqual(f.final.samples, direct.samples);
	assert.deepEqual(f.final.samples[0].r, f.release.r);
	var s0 = flightStateAt(f, 0);
	assert.deepEqual(s0.r, f.release.r);
	assert.equal(flightStateAt(f, 1e12).jde, JD + f.final.duration / 86400);
});

test("the release time within one tether orbit decides where the ship goes", function () {
	var g = skyhookFigures("moonSkyhook");
	var a = computeFlight({ from: "moonSkyhook", jd: JD });
	var b = computeFlight({ from: "moonSkyhook", jd: JD + g.period / 2 / 86400 });
	// Same hardware, same speed off the tether, opposite directions.
	within(O.vMag(a.release.relV), O.vMag(b.release.relV), 1e-6, "release speed");
	assert.ok(O.vDot(a.release.relV, b.release.relV) < 0);
	assert.notEqual(a.summary.primary + a.summary.periAlt, b.summary.primary + b.summary.periAlt);
});

test("a release just above the centre of mass stays in lunar orbit", function () {
	var f = computeFlight({ from: "moonSkyhook", jd: JD, params: { moonSkyhook: { relAlt: 400e3 } } });
	assert.equal(f.final.kind, "moonEllipse");
	assert.equal(f.summary.primary, "Moon");
	assert.equal(f.summary.impact, null);
	within(f.summary.periAlt, 400e3, 1, "periapsis is the release point");
	assert.ok(f.summary.apoAlt > 400e3);
	// The ship is carried along with the Moon.
	var s = flightStateAt(f, 600);
	within(O.vMag(O.vSub(s.r, moonGeoPos(s.jde))), O.vMag(O.propagateState(f.fig.GM, f.release.relR, f.release.relV, 600).r), 1e-3, "Moon-relative radius");
});

test("a release at the foot reaches the ground as the workbench says", function () {
	var f = computeFlight({ from: "moonSkyhook", jd: JD, params: { moonSkyhook: { relAlt: 1e3 } } });
	assert.equal(f.summary.impact, "Moon");
	within(f.summary.duration, 59, 1, "fall time, s");
	within(f.summary.impactSpeed, 1349.9, 0.5, "impact speed, m/s");
	var last = f.final.samples[f.final.samples.length - 1];
	within(O.vMag(last.r), f.fig.R, 1, "the drawn leg ends on the surface");
});

test("the Earth skyhook's top releases onto an escape at the workbench's v-infinity", function () {
	var f = computeFlight({ from: "earthSkyhook", jd: JD });
	assert.equal(f.summary.primary, "Sun");
	within(f.summary.vInfEarth, 3954, 40, "v-infinity leaving Earth");
	var low = computeFlight({ from: "earthSkyhook", jd: JD, params: { earthSkyhook: { relAlt: 3500e3 } } });
	assert.equal(low.summary.primary, "Earth");
	within(low.summary.periAlt, 3500e3, 2e3, "perigee is the release point");
});

// ---- arrivals ---------------------------------------------------------------

import { evaluateArrival, lineApproach, CATCH_REACH } from "../arrival.js";
import { solveCatch } from "../target.js";
import { FINE_STEP } from "../flight.js";

test("a flight with a destination is judged at its closest pass to the tether", function () {
	var f = computeFlight({ from: "moonSkyhook", to: "earthSkyhook", jd: JD });
	var a = f.arrival;
	assert.ok(a.found);
	assert.equal(a.caught, false);
	assert.ok(a.miss > CATCH_REACH);
	within(O.vMag(O.vSub(a.rGeo, a.pointGeo)), a.miss, 1e-3, "miss is the ship-to-point distance");
	within(Math.hypot(a.components.pro, a.components.out, a.components.nrm), a.trim, 1e-6, "components make up the trim");
	assert.ok(a.point >= f.toFig.rFoot && a.point <= f.toFig.rTop, "the nearest point is on the tether");
	assert.equal(a.reason, a.gap > 0 ? "above-top" : (a.gap < 0 ? "below-foot" : "off-arm"));
	assert.equal(computeFlight({ from: "moonSkyhook", jd: JD }).arrival, null);
});

test("a Moon-bound release never reaches the Earth skyhook", function () {
	var input = { from: "moonSkyhook", to: "earthSkyhook", jd: JD, params: { moonSkyhook: { relAlt: 400e3 } } };
	assert.deepEqual(computeFlight(input).arrival, { found: false, reason: "never-leaves" });
	assert.equal(solveCatch(input).reason, "no-approach");
});

test("a ship aimed through a tether point is caught there, with its extra speed as the trim", function () {
	var g = skyhookFigures("earthSkyhook"), jdC = JD + 0.3, lead = 900;
	var at = tetherPointState(g, g.rCatch, jdC), ax = tetherAxes(g, jdC);
	// Moving with the tether point but 300 m/s faster across its plane; flown
	// back a quarter of an hour as a two-body orbit, then forward for real.
	var back = O.propagateState(g.GM, at.r, O.vAdd(at.v, O.vScale(ax.normal, 300)), -lead);
	var leg = buildIntegratedLeg(back.r, back.v, jdC - lead / 86400, Object.assign({ maxTime: 2 * lead }, FINE_STEP));
	var a = evaluateArrival(leg, g);
	assert.equal(a.caught, true, "miss " + a.miss);
	within(a.t, lead, 1, "at the moment aimed for");
	within(a.altitude, 5200e3, 500, "at the catch altitude");
	within(a.trim, 300, 2, "trim");
	within(a.components.nrm, 300, 2, "all of it across the plane");
	var la = lineApproach(leg, g, lead);
	within(la.radius, g.rCatch, 500, "line approach: radius");
	within(la.miss, 0, 500, "line approach: miss");
});

test("Target brings the release to a catch at the catch altitude", function () {
	var input = { from: "moonSkyhook", to: "earthSkyhook", jd: JD };
	var s = solveCatch(input);
	assert.ok(s.ok, s.message);
	var g = skyhookFigures("moonSkyhook");
	assert.ok(s.relAlt > g.rFoot - g.R && s.relAlt < g.rTop - g.R, "release point stays on the tether");
	var f = computeFlight({ from: "moonSkyhook", to: "earthSkyhook", jd: s.jd, params: { moonSkyhook: { relAlt: s.relAlt } } });
	assert.equal(f.arrival.caught, true, "miss " + f.arrival.miss);
	within(f.arrival.altitude, 5200e3, 200, "catch altitude");
	// A different catch altitude is a different answer.
	var s2 = solveCatch({ from: "moonSkyhook", to: "earthSkyhook", jd: s.jd,
		params: { moonSkyhook: { relAlt: s.relAlt }, earthSkyhook: { catchAlt: 5400e3 } } });
	assert.ok(s2.ok, s2.message);
	var f2 = computeFlight({ from: "moonSkyhook", to: "earthSkyhook", jd: s2.jd,
		params: { moonSkyhook: { relAlt: s2.relAlt }, earthSkyhook: { catchAlt: 5400e3 } } });
	assert.equal(f2.arrival.caught, true);
	within(f2.arrival.altitude, 5400e3, 200, "moved catch altitude");
});

test("a catch point off the tether is a diagnostic", function () {
	assert.equal(skyhookFigures("earthSkyhook", { catchAlt: 7000e3 }).diagnostic.code, "catch-off-tether");
});

test("the closest pass is never measured through the body to a tether on its far side", function () {
	// Sweep the release through one turn of the Moon skyhook: the ship reaches
	// Earth with the tether pointing every which way, including straight away.
	var gm = skyhookFigures("moonSkyhook"), ge = skyhookFigures("earthSkyhook"), seen = 0;
	for (var k = 0; k < 12; k++) {
		var f = computeFlight({ from: "moonSkyhook", to: "earthSkyhook", jd: JD + k / 12 * gm.period / 86400,
			params: { moonSkyhook: { relAlt: 930e3 } }, maxTime: 8 * 86400 });
		var a = f.arrival;
		if (!a.found) { continue; }
		seen++;
		var along = tetherAxes(ge, a.jd).along;
		assert.ok(O.vDot(a.r, along) >= ge.R - 1, "release " + k + ": ship is on the tether's side at the pass");
		// The sight line from the ship to the tether point clears the body.
		var d = O.vSub(O.vScale(along, a.point), a.r), len = O.vMag(d);
		var s = Math.max(0, Math.min(len, -O.vDot(a.r, d) / len));
		assert.ok(O.vMag(O.vAdd(a.r, O.vScale(d, s / len))) >= ge.R - 1, "release " + k + ": sight line clears Earth");
	}
	assert.ok(seen >= 6, "enough flights reached Earth: " + seen);
});

// ---- holding the skyhook's phase ---------------------------------------------

import { relativePhase, nextPhaseMatch } from "../facilities.js";

test("relativePhase is the tether's angle from its partner body, and nextPhaseMatch finds it again", function () {
	var g = skyhookFigures("moonSkyhook");
	// Zero means the tether points at Earth (as nearly as its plane allows).
	var t0 = nextPhaseMatch(g, JD, 0);
	var toEarth = O.vUnit(O.vScale(moonGeoPos(t0), -1));
	assert.ok(O.vDot(tetherAxes(g, t0).along, toEarth) > 0.99, "points at Earth");
	// From any date, the next match is within a little over one period and holds the angle.
	[0, 0.37, 3.2, 11.9, 400.123].forEach(function (d) {
		var held = 2.1, t = nextPhaseMatch(g, JD + d, held);
		assert.ok(t >= JD + d && t - (JD + d) < 1.01 * g.period / 86400, "within one period from +" + d);
		within(relativePhase(g, t), held, 1e-6, "angle held at +" + d);
	});
	// An instant that already matches is its own answer.
	var t1 = nextPhaseMatch(g, JD + 5, 1.0);
	within((nextPhaseMatch(g, t1, 1.0) - t1) * 86400, 0, 0.01, "already matching");
	// The Earth skyhook's partner is the Moon.
	var ge = skyhookFigures("earthSkyhook"), te = nextPhaseMatch(ge, JD, 0);
	assert.ok(O.vDot(tetherAxes(ge, te).along, O.vUnit(moonGeoPos(te))) > 0.88, "Earth tether toward the Moon");
});

// ---- Earth skyhook to Moon skyhook --------------------------------------------

import { DESTINATIONS, routeReleaseAlt, bodyOffPlane } from "../facilities.js";

test("each skyhook can be aimed at the other, from a release point on its tether", function () {
	assert.deepEqual(DESTINATIONS, { moonSkyhook: ["earthSkyhook"], earthSkyhook: ["moonSkyhook"] });
	assert.equal(routeReleaseAlt("moonSkyhook", "earthSkyhook"), 949.4e3);
	assert.equal(routeReleaseAlt("earthSkyhook", "moonSkyhook"), 5200e3);
	// A shortened tether keeps the release point on it.
	assert.equal(routeReleaseAlt("earthSkyhook", "moonSkyhook", { topAlt: 5000e3 }), 5000e3);
	assert.equal(routeReleaseAlt("earthSkyhook", "earthSkyhook"), null);
	// Each catch point is where the other skyhook's traffic is at the tether's speed:
	// the release there is just short of escape.
	var e = skyhookFigures("earthSkyhook", { relAlt: 5200e3 });
	assert.ok(e.vRel < e.vEscRel && e.vRel > 0.98 * e.vEscRel, "Earth release is nearly escape speed");
	assert.equal(FACILITIES.moonSkyhook.defaults.catchAlt, FACILITIES.moonSkyhook.defaults.relAlt);
});

// 2080-03-31 16:37: a release that reaches the Moon as it crosses Earth's equatorial plane.
var JD_MOON = JD + 9.6927;
var TO_MOON = { from: "earthSkyhook", to: "moonSkyhook", jd: JD_MOON, params: { earthSkyhook: { relAlt: 5230e3 } } };

test("a flight from the Earth skyhook reaches the Moon only when the Moon is in its plane", function () {
	var near = computeFlight(TO_MOON);
	assert.ok(near.arrival.found);
	assert.ok(near.arrival.miss < 6000e3, "passes the Moon skyhook closely: " + near.arrival.miss);
	assert.ok(Math.abs(near.offPlane) < 6000e3, "Moon near the release plane: " + near.offPlane);
	within(near.offPlane, bodyOffPlane(near.fig, "Moon", near.arrival.jd), 1e-6, "offPlane is bodyOffPlane at the pass");
	// A week earlier the Moon is far above the equator, and no release time brings the ship near it.
	var g = skyhookFigures("earthSkyhook"), best = Infinity, off = 0;
	for (var k = 0; k < 12; k++) {
		var f = computeFlight({ from: "earthSkyhook", to: "moonSkyhook", jd: JD_MOON - 7 + k / 12 * g.period / 86400,
			params: TO_MOON.params, maxTime: 5 * 86400 });
		if (f.arrival.found && f.arrival.miss < best) { best = f.arrival.miss; off = f.offPlane; }
	}
	assert.ok(best > 50000e3, "misses by tens of thousands of km: " + best);
	assert.ok(Math.abs(off) > 50000e3, "Moon far from the release plane: " + off);
	assert.equal(computeFlight({ from: "earthSkyhook", jd: JD_MOON }).offPlane, null);
});

test("Target brings an Earth skyhook release to a catch on the Moon skyhook", function () {
	var s = solveCatch(TO_MOON);
	assert.ok(s.ok, s.message);
	var f = computeFlight({ from: "earthSkyhook", to: "moonSkyhook", jd: s.jd, params: { earthSkyhook: { relAlt: s.relAlt } } });
	assert.equal(f.arrival.caught, true, "miss " + f.arrival.miss);
	within(f.arrival.altitude, 949.4e3, 200, "caught at the release deck");
	// The ship arrives there at close to the tether's own speed.
	within(f.arrival.shipSpeed, f.arrival.pointSpeed, 200, "ship speed against tether speed");
});

test("a ship within reach of the tether's very end is caught", function () {
	var params = { earthSkyhook: { relAlt: 5230e3 }, moonSkyhook: { catchAlt: 2000e3 } };
	var s = solveCatch(Object.assign({}, TO_MOON, { params: params }));
	assert.ok(s.ok, s.message);
	var f = computeFlight({ from: "earthSkyhook", to: "moonSkyhook", jd: s.jd,
		params: { earthSkyhook: { relAlt: s.relAlt }, moonSkyhook: { catchAlt: 2000e3 } } });
	assert.ok(f.arrival.miss <= CATCH_REACH);
	assert.equal(f.arrival.caught, true);
	assert.equal(f.arrival.reason, null);
});

// ---- the closest pass to the destination's body ----------------------------

import { bodyPass } from "../flight.js";

test("a flight with a destination finds its closest pass to that body", function () {
	var f = computeFlight({ from: "moonSkyhook", to: "earthSkyhook", jd: JD });
	var p = f.bodyPass, leg = f.final;
	assert.ok(p && p.t > 0 && p.t <= leg.duration);
	leg.samples.forEach(function (s) { assert.ok(O.vMag(s.r) >= p.distance - 1e-6, "nothing nearer Earth"); });
	within(p.t, f.arrival.t, 3600, "a catchable path meets the tether near its closest pass to Earth");
	var toMoon = computeFlight({ from: "earthSkyhook", to: "moonSkyhook", jd: JD });
	if (toMoon.bodyPass) {
		var q = toMoon.bodyPass, m = stateAtMoon(toMoon.final, q.t);
		within(m, q.distance, 1, "distance is measured from the Moon's centre");
	}
	assert.equal(computeFlight({ from: "moonSkyhook", jd: JD }).bodyPass, null);
});

test("a ship that only draws away from the body has no pass", function () {
	var leg = { kind: "integrated", jde0: JD, samples: [0, 1, 2].map(function (k) {
		return { t: k * 60, r: [7e6 + k * 1e5, 0, 0] }; }) };
	assert.equal(bodyPass(leg, "Earth"), null);
});

function stateAtMoon(leg, t) {
	var s = leg.samples.find(function (x) { return x.t === t; });
	return O.vMag(O.vSub(s.r, moonGeoPos(leg.jde0 + t / 86400)));
}
