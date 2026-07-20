// Node tests for Shared/body-leg.js (Mission Planner task J2 / WP-J — the
// Mars-Phobos plotter's restricted body+Sun escape core, ported generic).
// Run from the repo root:
//   node --test Website/Shared/tests/body-leg.test.js
//
// PROVENANCE OF THE PINNED NUMBERS: at port time (2026-07-17) the module was
// compared against the plotter's OWN code — marsAccel / integrateTrajectory
// sliced verbatim from marsPhobosSkyhookTrajectory.js into a scratch harness
// and run side by side on identical Mars releases — and came out BIT-IDENTICAL
// (every sample's r and v to the last bit, same branch / sample count /
// duration, and the same SOI to the metre). The figures pinned here are that
// run's outputs for body="Mars". If one drifts, either the ephemeris/orbit
// data changed (re-pin deliberately) or the integrator changed (a real
// behaviour change — re-check against the plotter).

import test from "node:test";
import assert from "node:assert/strict";

import {
	integrateTrajectory, buildIntegratedLeg, bodyConstants, bodySOI,
	sunRelPos, bodyAccel, localFrameAt, stateAtLegTime, burnEffect
} from "../body-leg.js";
import { OrbitalMath as O } from "../math-utils.js";
import { systems } from "../orbit.js";

var MARS = systems.get("Mars"), PHOBOS = systems.get("Phobos"), SUN = systems.get("Sun");
var R_M = MARS.radius, GM_M = MARS.GM, A_PH = PHOBOS.orbit.semiMajor;
var OMEGA = O.angularVelocity(GM_M, A_PH);   // the skyhook's default (Phobos-orbit) rate
var DAY = 86400;
var JD0 = 2463220.75;

// A Mars-Phobos-style release: relAlt above Mars at ecliptic phase phi, tip
// velocity = OMEGA × radius (× speedFactor, 1 = the tether's own tip speed).
function release(altM, phaseDeg, speedFactor) {
	var rr = R_M + altM, vr = OMEGA * rr * (speedFactor == null ? 1 : speedFactor);
	var p = phaseDeg * Math.PI / 180;
	return { R0: [Math.cos(p) * rr, Math.sin(p) * rr, 0],
	         V0: [-Math.sin(p) * vr, Math.cos(p) * vr, 0] };
}

test("escape release: pinned against the plotter's own code (see header)", () => {
	var s = release(25000e3, 40);
	var res = integrateTrajectory("Mars", s.R0, s.V0, JD0);
	assert.equal(res.branch, "sun");
	assert.equal(res.entry, null);
	assert.equal(res.samples.length, 211);
	assert.ok(Math.abs(res.duration / DAY - 42.825) < 0.01, "dur " + (res.duration / DAY).toFixed(4));
	assert.ok(Math.abs(res.vinfBody - 6011.29) < 0.05, "vinfBody " + res.vinfBody.toFixed(3));
	// Mars-relative escape (v∞ vs Mars > 0) but still bound to the Sun at only
	// ~6 km/s — a transfer, not a solar escape.
	assert.ok(res.vinfBody > 0, "hyperbolic vs Mars");
	assert.equal(res.vinfSun, null, "still Sun-bound heliocentrically");
	assert.ok(res.helioEl && isFinite(res.helioEl.a), "heliocentric elements reported");
});

test("escape leg: primary Sun, impact null, ecliptic inclination near Mars' axis-free plane", () => {
	var s = release(25000e3, 40);
	var leg = buildIntegratedLeg("Mars", s.R0, s.V0, JD0);
	assert.equal(leg.primary, "Sun");
	assert.equal(leg.impact, null);
	assert.equal(leg.body, "Mars");
	// The release orbit lies in the ecliptic (skyhook plane [0,0,1] here), so
	// its heliocentric inclination is small.
	assert.ok(leg.inclRad != null && leg.inclRad * 180 / Math.PI < 3, "incl deg " + (leg.inclRad * 180 / Math.PI));
});

test("bound (circular) release: capped at ~one orbit, primary the body, no impact/escape", () => {
	// Release exactly at Phobos' radius at circular speed → a bound Mars orbit
	// that neither impacts nor escapes: the "body" branch, capped near one
	// period (~0.326 d here).
	var s = release(A_PH - R_M, 0, 1.0);
	var leg = buildIntegratedLeg("Mars", s.R0, s.V0, JD0);
	assert.equal(leg.branch, "body");
	assert.equal(leg.primary, "Mars");
	assert.equal(leg.impact, null);
	assert.equal(leg.vinfBody, null);
	assert.ok(Math.abs(leg.duration / DAY - 0.325973) < 0.005, "dur " + (leg.duration / DAY).toFixed(6));
	// Very nearly circular: rmin ≈ rmax at ~5986 km altitude.
	assert.ok(Math.abs((leg.rmin - R_M) / 1e3 - 5986.49) < 1 && Math.abs((leg.rmax - R_M) / 1e3 - 5986.5) < 1);
});

test("low release: impacts Mars (entry branch)", () => {
	var s = release(150e3, 200);
	var leg = buildIntegratedLeg("Mars", s.R0, s.V0, JD0);
	assert.equal(leg.branch, "entry");
	assert.equal(leg.impact, "Mars");
	assert.ok(leg.entry && leg.entry.v > 0, "entry conditions captured");
});

test("bodySOI / bodyConstants: match the plotter's mass-based SOI to the metre", () => {
	var M_SUN = SUN.mass || (SUN.GM / 6.674e-11);
	var expected = O.sphereOfInfluence(MARS.orbit.semiMajor, MARS.mass, M_SUN);
	assert.ok(Math.abs(bodySOI("Mars") - expected) < 1, "SOI " + bodySOI("Mars").toFixed(0));
	var c = bodyConstants("Mars");
	assert.equal(c.GM, GM_M);
	assert.equal(c.R, +R_M);   // systems normalizes radius to a {polar,equator} object; body-leg coerces
	assert.ok(Math.abs(c.cutoff - 0.1 * MARS.orbit.semiMajor) < 1);
	assert.ok(Math.abs(c.entryR - (R_M + MARS.atmosphere.height)) < 1);
});

test("airless body: entryR is the bare surface (Ceres has no atmosphere record)", () => {
	var c = bodyConstants("Ceres");
	assert.equal(c.atmH, 0);
	assert.equal(c.entryR, +systems.get("Ceres").radius);   // bare surface, coerced to a number
	assert.equal(typeof c.R, "number");
});

test("unknown / non-heliocentric bodies throw loudly", () => {
	assert.throws(() => bodyConstants("Nowhere"), /unknown body/);
	assert.throws(() => bodyConstants("Phobos"), /no heliocentric orbit/);   // orbits Mars, not the Sun
});

test("sunRelPos / bodyAccel: Sun pulls the ship toward the Sun's side", () => {
	var srp = sunRelPos("Mars", JD0);
	assert.equal(srp.length, 3);
	// Acceleration at the body centre offset by a small r: dominated by −GM r/r³.
	var r = [1e7, 0, 0];
	var a = bodyAccel("Mars", r, JD0);
	assert.ok(a[0] < 0, "central pull is inward");
	assert.ok(Math.abs(a[0]) > 1e-4, "nonzero");
});

test("stateAtLegTime: endpoints and a mid-time interpolate on the escape leg", () => {
	var s = release(25000e3, 40);
	var leg = buildIntegratedLeg("Mars", s.R0, s.V0, JD0);
	var at0 = stateAtLegTime(leg, 0);
	assert.ok(Math.hypot(at0.r[0] - leg.samples[0].r[0], at0.r[1] - leg.samples[0].r[1], at0.r[2] - leg.samples[0].r[2]) < 1e-6);
	var atEnd = stateAtLegTime(leg, leg.duration);
	var lastR = leg.samples[leg.samples.length - 1].r;
	assert.ok(Math.hypot(atEnd.r[0] - lastR[0], atEnd.r[1] - lastR[1], atEnd.r[2] - lastR[2]) < 1e-3);
	var mid = stateAtLegTime(leg, leg.duration / 2);
	assert.ok(Math.hypot(mid.r[0], mid.r[1], mid.r[2]) > R_M, "mid state is off the surface");
});

test("localFrameAt: Sun-primary picks the Sun frame; body-primary picks the body at origin", () => {
	var fSun = localFrameAt("Mars", [1e8, 0, 0], JD0, "Sun");
	assert.equal(fSun.body, "Sun");
	assert.equal(fSun.GM, SUN.GM);
	assert.deepEqual(sunRelPos("Mars", JD0), fSun.originR);   // Sun sits at its body-relative position
	var fBody = localFrameAt("Mars", [1e7, 0, 0], JD0, "Mars");
	assert.equal(fBody.body, "Mars");
	assert.equal(fBody.GM, GM_M);
	assert.deepEqual(fBody.originR, [0, 0, 0]);
});

test("burnEffect (re-exported): a prograde impulse raises speed along prograde", () => {
	var r = [A_PH, 0, 0], v = [0, OMEGA * A_PH, 0];   // circular Mars orbit at Phobos radius
	var eff = burnEffect(GM_M, r, v, { pro: 100, rad: 0, nrm: 0 });
	assert.ok(Math.abs(eff.progradeDv - 0.1) < 1e-6, "progradeDv " + eff.progradeDv);
	assert.ok(Math.abs(eff.burnDv - 0.1) < 1e-6);
	assert.ok(Math.abs(eff.planeChange) < 1e-6, "in-plane burn, no plane change");
});

// ---- integrateEncounter (the arrival-side mirror: a coast through an SOI) --

import { integrateEncounter } from "../body-leg.js";
import { Frames } from "../frames.js";

function marsEncounterStart(relR, relV, jd) {
	var b = Frames.bodyHelioState("Mars", jd);
	return { r: O.vAdd(b.r, relR), v: O.vAdd(b.v, relV), jd: jd };
}

test("integrateEncounter: a hyperbolic Mars pass exits deflected, v-inf conserved", () => {
	var c = bodyConstants("Mars");
	// Enter just inside the SOI moving 4 km/s Mars-relative, aimed to pass
	// ~0.15 SOI beside the planet.
	var s = marsEncounterStart([c.SOI * 0.98, c.SOI * 0.15, 0], [-4000, 0, 0], JD0);
	var res = integrateEncounter("Mars", s.r, s.v, JD0, 60 * DAY);
	assert.equal(res.branch, "exit");
	assert.ok(res.rmin < c.SOI * 0.2, "came well inside: rmin " + res.rmin);
	assert.ok(res.rmin > c.R, "did not hit the surface");
	// Deflection: the Mars-relative velocity turned by a clearly nonzero angle.
	var bEnd = Frames.bodyHelioState("Mars", JD0 + res.duration / DAY);
	var vOut = O.vSub(res.end.v, bEnd.v);
	var cosT = O.vDot(O.vUnit([-4000, 0, 0]), O.vUnit(vOut));
	var deg = Math.acos(Math.max(-1, Math.min(1, cosT))) * 180 / Math.PI;
	assert.ok(deg > 1, "deflection " + deg.toFixed(2) + " deg");
	// Hyperbolic-excess speed in ~= out (the Sun term shifts it only slightly).
	assert.ok(res.vinf != null && Math.abs(O.vMag(vOut) - res.vinf) / res.vinf < 0.1,
		"v-inf in " + res.vinf + " out " + O.vMag(vOut));
});

test("integrateEncounter: aimed dead at the body it reports an entry (impact)", () => {
	var c = bodyConstants("Mars");
	var s = marsEncounterStart([c.SOI * 0.5, 0, 0], [-4000, 0, 0], JD0);
	var res = integrateEncounter("Mars", s.r, s.v, JD0, 60 * DAY);
	assert.equal(res.branch, "entry");
	assert.ok(res.entry && res.entry.v > 4000, "entry speed gained fall energy: " + (res.entry && res.entry.v));
});

test("integrateEncounter: maxDur elapsing inside the SOI reports branch 'time'", () => {
	var c = bodyConstants("Mars");
	var s = marsEncounterStart([c.SOI * 0.98, c.SOI * 0.15, 0], [-4000, 0, 0], JD0);
	var res = integrateEncounter("Mars", s.r, s.v, JD0, 3600);
	assert.equal(res.branch, "time");
	assert.ok(Math.abs(res.duration - 3600) < 1, "stopped at the boundary: " + res.duration);
});

test("integrateEncounter: a state already at the surface reports entry without integrating", () => {
	var c = bodyConstants("Mars");
	var s = marsEncounterStart([c.R * 0.5, 0, 0], [-1000, 0, 0], JD0);
	var res = integrateEncounter("Mars", s.r, s.v, JD0, DAY);
	assert.equal(res.branch, "entry");
	assert.equal(res.duration, 0);
});
