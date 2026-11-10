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
