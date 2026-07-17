// Node tests for Shared/geo-leg.js (Mission Planner task I1 — the
// Moon-Skyhook plotter's restricted N-body trajectory core, ported pure).
// Run from the repo root:
//   node --test Website/Shared/tests/geo-leg.test.js
//
// PROVENANCE OF THE PINNED NUMBERS: at port time (2026-07-16) the module
// was compared against the plotter's OWN code — the relevant functions
// sliced verbatim from moonSkyhookTrajectory.js into a scratch harness and
// run side by side on identical inputs — and came out BIT-IDENTICAL on
// every scenario below (branch, impact, duration, v∞, inclinations, sample
// counts, and every sample's r and v to the last bit; likewise burnEffect,
// localFrameAt, stateAtLegTime, the distance/time helpers, apsis/waypoint
// defaults, and the SOI constants). The exact figures pinned here are that
// run's outputs. If one drifts, either the ephemeris/orbit data changed
// (re-pin deliberately) or the integrator changed (that's a real behaviour
// change — check it against the plotter again).

import test from "node:test";
import assert from "node:assert/strict";

import {
	integrateTrajectory, buildIntegratedLeg, buildMoonEllipseLeg,
	stateAtLegTime, localFrameAt, bodyLabelForGM, burnEffect,
	distanceAlongLegToTime, timeToDistanceAlongLeg,
	firstApsisTime, defaultWaypointTime, WP_DEFAULT_DIST_M,
	conicPeriod, earthHelio, moonGeoPos, moonGeoVel, shipAccel,
	lunarInclination, SOI_MOON, SOI_EARTH
} from "../geo-leg.js";
import { OrbitalMath as O } from "../math-utils.js";
import { LunarEphemeris as LE } from "../lunar-ephemeris.js";
import { systems } from "../orbit.js";

var EARTH = systems.get("Earth"), MOON = systems.get("Moon"), SUN = systems.get("Sun");
var GM_E = EARTH.GM, GM_M = MOON.GM, GM_S = SUN.GM, R_M = MOON.radius;
var DAY = 86400;
var JD0 = 2463220.75;   // the shipped preset's release date (2031-12-20 06:00)

// A tether-style release state: position relAlt above the Moon's centre at
// ecliptic phase phi, velocity = Moon's + a tangential kick. Mirrors how
// the plotter's releaseState composes, without its tilt bookkeeping.
function release(jd, phaseDeg, relAltKm, vRelMS) {
	var ms = LE.moonState(jd);
	var rM = [ms.r[0] * 1e3, ms.r[1] * 1e3, ms.r[2] * 1e3];
	var vM = [ms.v[0] * 1e3, ms.v[1] * 1e3, ms.v[2] * 1e3];
	var phi = phaseDeg * Math.PI / 180;
	var rHat = [Math.cos(phi), Math.sin(phi), 0], tHat = [-Math.sin(phi), Math.cos(phi), 0];
	return {
		R0: O.vAdd(rM, O.vScale(rHat, R_M + relAltKm * 1e3)),
		V0: O.vAdd(vM, O.vScale(tHat, vRelMS))
	};
}

// The port-comparison run's escape scenario: the preset-like release
// (phase 92°, 6000 km, 6004 m/s — the default skyhook's tip speed).
function escapeLeg() {
	var s = release(JD0, 92, 6000, 6004);
	return integrateTrajectory(s.R0, s.V0, JD0);
}

test("escape release: pinned against the plotter's own code (see header)", () => {
	var res = escapeLeg();
	assert.equal(res.branch, "orange");
	assert.equal(res.impact, null);
	assert.equal(res.samples.length, 296);
	assert.ok(Math.abs(res.duration / DAY - 31.855) < 0.01, "dur " + (res.duration / DAY).toFixed(3));
	assert.ok(Math.abs(res.vinfEarth - 5483.042) < 0.01, "vinf " + res.vinfEarth.toFixed(3));
	assert.ok(res.helioEl && res.helioEl.e >= 0, "heliocentric elements reported");
	// v∞ is genuinely hyperbolic vs Earth and less than the release's naive
	// prograde-aligned first cut would claim — the real geometry costs some
	assert.ok(res.vinfEarth > 0 && res.vinfEarth < 6004);
});

test("no SOI kink: velocity turns <= ~2 deg per step across the whole escape", () => {
	var res = escapeLeg();
	var worst = 0;
	for (var k = 1; k < res.samples.length; k++) {
		var a = res.samples[k - 1].v, b = res.samples[k].v;
		var cos = O.vDot(a, b) / (O.vMag(a) * O.vMag(b));
		worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, cos))));
	}
	assert.ok(worst < 2.5 * Math.PI / 180, "worst turn " + (worst * 180 / Math.PI).toFixed(2) + " deg");
});

test("a bound geocentric start runs ~one Earth orbit and closes (green branch)", () => {
	// Circular 100,000 km geocentric orbit, far from the Moon.
	var r0 = [1e8, 0, 0], v0 = [0, Math.sqrt(GM_E / 1e8), 0];
	var res = integrateTrajectory(r0, v0, JD0);
	assert.equal(res.branch, "green");
	assert.equal(res.impact, null);
	var period = 2 * Math.PI * Math.sqrt(1e24 / GM_E);
	// the integrator deliberately runs 2% PAST one bound orbit (the
	// plotter's own oscT * 1.02 cap), so measure closure AT one period,
	// not at the leg's end
	assert.ok(Math.abs(res.duration - period * 1.02) / period < 0.05,
		"ran " + (res.duration / period).toFixed(3) + " periods");
	var st = stateAtLegTime({ samples: res.samples, jde0: JD0 }, period);
	assert.ok(O.vMag(O.vSub(st.r, r0)) < 1e6,
		"closes within 1000 km at one period (Moon/Sun perturbation scale)");
	// and the orbit stays essentially circular under the perturbations
	assert.ok(res.rmin > 0.995e8 && res.rmax < 1.005e8);
});

test("impacts are detected and named", () => {
	// straight-down radial drop from 100,000 km -> Earth impact
	var resE = integrateTrajectory([1e8, 0, 0], [-1500, 0, 0], JD0);
	assert.equal(resE.impact, "Earth");
	// the comparison run's Moon-grazing case -> Moon impact
	var s = release(JD0, 0, 6000, 0);
	var resM = integrateTrajectory(s.R0, O.vScale(O.vUnit(s.R0), -2000), JD0);
	assert.equal(resM.impact, "Moon");
	assert.equal(resM.samples.length, 23);   // pinned from the comparison run
});

test("a Moon-bound start caps at ~one lunar orbit; buildIntegratedLeg reports lunar apsides", () => {
	var ms = LE.moonState(JD0);
	var rM = [ms.r[0] * 1e3, ms.r[1] * 1e3, ms.r[2] * 1e3];
	var vM = [ms.v[0] * 1e3, ms.v[1] * 1e3, ms.v[2] * 1e3];
	var rRel = 5000e3;
	var rHat = [Math.cos(0.7), Math.sin(0.7), 0], tHat = [-Math.sin(0.7), Math.cos(0.7), 0];
	var R0 = O.vAdd(rM, O.vScale(rHat, rRel));
	var V0 = O.vAdd(vM, O.vScale(tHat, Math.sqrt(GM_M / rRel)));
	var leg = buildIntegratedLeg(R0, V0, JD0);
	assert.equal(leg.primary, "Moon");
	assert.equal(leg.kind, "integrated");
	var period = 2 * Math.PI * Math.sqrt(Math.pow(rRel, 3) / GM_M);
	assert.ok(Math.abs(leg.duration - period * 1.02) / period < 0.05);
	// near-circular start: both apsis altitudes near 5000 km - R_M ≈ 3263 km
	// (pinned range from the comparison run: 3261.4 / 3266.8)
	assert.ok(Math.abs(leg.periAlt - 3261.4) < 5, "periAlt " + leg.periAlt.toFixed(1));
	assert.ok(Math.abs(leg.apoAlt - 3266.8) < 5, "apoAlt " + leg.apoAlt.toFixed(1));
	// in-ecliptic-plane orbit measured against the default ecliptic normal
	assert.ok(leg.inclRad < 0.02);
});

test("buildMoonEllipseLeg: one exact closed two-body loop, Moon-relative", () => {
	var relR = [3000e3, 0, 0];
	var relV = [0, Math.sqrt(GM_M / 3000e3) * 1.05, 0];
	var elM = O.elementsFromState(GM_M, relR, relV);
	var leg = buildMoonEllipseLeg(relR, relV, JD0, elM);
	assert.equal(leg.kind, "moonEllipse");
	assert.ok(Math.abs(leg.duration - conicPeriod(GM_M, elM)) < 1);
	var first = leg.samples[0].r, last = leg.samples[leg.samples.length - 1].r;
	assert.ok(O.vMag(O.vSub(last, first)) < 1e3, "loop closes");
	assert.ok(Math.abs(leg.periAlt - (O.periapsisRadius(elM.a, elM.e) - R_M) / 1e3) < 1e-6);
});

test("stateAtLegTime: edges clamp, samples reproduce, mid-times interpolate", () => {
	var res = escapeLeg();
	var leg = { samples: res.samples, jde0: JD0 };
	var s0 = stateAtLegTime(leg, -5);
	assert.deepEqual(s0.r, res.samples[0].r);
	var k = 40;
	var sk = stateAtLegTime(leg, res.samples[k].t);
	assert.deepEqual(sk.r, res.samples[k].r);
	var tMid = (res.samples[k].t + res.samples[k + 1].t) / 2;
	var sm = stateAtLegTime(leg, tMid);
	for (var i = 0; i < 3; i++) {
		var lo = Math.min(res.samples[k].r[i], res.samples[k + 1].r[i]);
		var hi = Math.max(res.samples[k].r[i], res.samples[k + 1].r[i]);
		assert.ok(sm.r[i] >= lo - 1e-6 && sm.r[i] <= hi + 1e-6);
	}
	var sEnd = stateAtLegTime(leg, res.duration + 1e6);
	assert.deepEqual(sEnd.r, res.samples[res.samples.length - 1].r);
	assert.ok(Math.abs(sm.jde - (JD0 + tMid / DAY)) < 1e-12);
});

test("localFrameAt gates by the LEG's primary, not proximity", () => {
	var res = escapeLeg();
	var st = stateAtLegTime({ samples: res.samples, jde0: JD0 }, res.duration * 0.4);
	var fM = localFrameAt(st.r, st.jde, "Moon");
	assert.equal(fM.GM, GM_M);
	assert.deepEqual(fM.originR, moonGeoPos(st.jde));
	assert.deepEqual(fM.originV, moonGeoVel(st.jde));
	var fS = localFrameAt(st.r, st.jde, "Sun");
	assert.equal(fS.GM, GM_S);
	assert.equal(fS.body, "Sun");
	// Earth primary near Earth -> Earth frame; far out -> Sun fallback
	assert.equal(localFrameAt([1e8, 0, 0], JD0, "Earth").GM, GM_E);
	assert.equal(localFrameAt([2e10, 0, 0], JD0, "Earth").GM, GM_S);
	assert.equal(bodyLabelForGM(GM_M), "Moon");
	assert.equal(bodyLabelForGM(GM_S), "Sun");
	assert.equal(bodyLabelForGM(GM_E), "Earth");
});

test("burnEffect: zero burn is identity; normal burns tilt; prograde reads as prograde Δv", () => {
	var rL = [1e8, 0, 0], vL = [0, Math.sqrt(GM_E / 1e8), 0];
	var zero = burnEffect(GM_E, rL, vL, { pro: 0, rad: 0, nrm: 0 });
	assert.deepEqual(zero.vAfter, O.applyBurn(rL, vL, 0, 0, 0));
	assert.ok(Math.abs(zero.planeChange) < 1e-9);
	assert.ok(Math.abs(zero.progradeDv) < 1e-9);
	var nrm = burnEffect(GM_E, rL, vL, { pro: 0, rad: 0, nrm: 300 });
	assert.ok(Math.abs(nrm.planeChange) > 5, "plane change " + nrm.planeChange.toFixed(2) + " deg");
	var pro = burnEffect(GM_E, rL, vL, { pro: 250, rad: 0, nrm: 0 });
	assert.ok(Math.abs(pro.progradeDv - 0.25) < 0.01);
	assert.ok(Math.abs(pro.burnDv - 0.25) < 1e-9);
});

test("distance<->time helpers invert each other; defaults follow the 100,000 km rule", () => {
	var res = escapeLeg();
	var leg = { samples: res.samples, duration: res.duration, primary: "Sun", kind: "integrated", jde0: JD0 };
	var t = distanceAlongLegToTime(leg, 2.5e8);
	assert.ok(t > 0 && t < res.duration);
	assert.ok(Math.abs(timeToDistanceAlongLeg(leg, t) - 2.5e8) < 1, "round trip");
	assert.equal(distanceAlongLegToTime(leg, 1e15), res.duration);   // beyond the leg: clamps
	// not a lunar orbit -> no apsis default; 100,000 km along the path instead
	assert.equal(firstApsisTime(leg, true), null);
	assert.equal(defaultWaypointTime(leg, 0), distanceAlongLegToTime(leg, WP_DEFAULT_DIST_M));
});

test("firstApsisTime: apoapsis then periapsis land half a period apart on a lunar ellipse", () => {
	// start at periapsis of a 2000x6000 km-ish lunar ellipse
	var rp = R_M + 500e3;
	var vPeri = Math.sqrt(GM_M * (2 / rp - 1 / (rp * 1.5)));
	var relR = [rp, 0, 0], relV = [0, vPeri, 0];
	var elM = O.elementsFromState(GM_M, relR, relV);
	assert.ok(elM.e < 1 && O.apoapsisRadius(elM.a, elM.e) < SOI_MOON, "test orbit stays in the SOI");
	var leg = buildMoonEllipseLeg(relR, relV, JD0, elM);
	var tApo = firstApsisTime(leg, true), tPeri = firstApsisTime(leg, false);
	var half = conicPeriod(GM_M, elM) / 2;
	assert.ok(Math.abs(tApo - half) < half * 0.01, "apo at half period from periapsis start");
	assert.ok(tPeri < 1e-6 || Math.abs(tPeri - 2 * half) < half * 0.02, "peri at start (or one full period)");
});

test("lunarInclination measures against the supplied plane normal", () => {
	var r = [5e6, 0, 0], v = [0, 1000, 0];              // ecliptic-plane orbit
	assert.ok(lunarInclination(r, v) < 1e-9);           // default: ecliptic pole
	var tilt = 10 * Math.PI / 180;
	var n = [0, Math.sin(tilt), Math.cos(tilt)];
	assert.ok(Math.abs(lunarInclination(r, v, n) - tilt) < 1e-9);
	assert.equal(lunarInclination([1, 0, 0], [2, 0, 0], null), 0);   // degenerate: zero h
});

test("constants and field sanity", () => {
	assert.ok(SOI_MOON > 6.0e7 && SOI_MOON < 7.0e7, "Moon SOI ~66,000 km, got " + (SOI_MOON / 1e3).toFixed(0) + " km");
	assert.ok(SOI_EARTH > 9.0e8 && SOI_EARTH < 9.5e8, "Earth SOI ~925,000 km");
	// acceleration at 100,000 km is Earth-dominated and points inward
	var a = shipAccel([1e8, 0, 0], JD0);
	assert.ok(a[0] < 0 && Math.abs(a[0] + GM_E / 1e16) / (GM_E / 1e16) < 0.05);
	// earthHelio: ~1 AU out, ~30 km/s along-track
	var eh = earthHelio(JD0);
	assert.ok(Math.abs(O.vMag(eh.r) / 1.496e11 - 1) < 0.02);
	assert.ok(Math.abs(O.vMag(eh.v) - 29780) < 500);
});
