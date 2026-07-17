// Node tests for Shared/kinematic-chain.js (Mission Planner task I2 — the
// kinematic-chain evaluator). Run from the repo root:
//   node --test Website/Shared/tests/kinematic-chain.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateChain, baseState, planeBasis } from "../kinematic-chain.js";
import { OrbitalMath as O } from "../math-utils.js";
import { LunarEphemeris as LE } from "../lunar-ephemeris.js";
import { systems } from "../orbit.js";

test("Moon+skyhook chain reproduces the tether release kinematics exactly", () => {
	// The worked-example skyhook geometry (the lunar-skyhook module's own
	// defaults), computed inline: CoM on a circular lunar orbit sets the
	// rotation rate; the release point at rRel moves at omega * rRel. (This
	// test used to import the module's pre-I3 computeRelease for these
	// figures; since I3 the module composes exactly this rotor itself, so
	// the reference construction lives here, first-principles.)
	var MOON = systems.get("Moon");
	var releaseJd = 2463218.546734214;
	var phaseDeg = 92;
	var rCom = MOON.radius + 275e3, rRel = MOON.radius + 6000e3;
	var omega = O.angularVelocity(MOON.GM, rCom);
	var vRel = omega * rRel;

	// The tether-tangential direction at the release phase, in the ecliptic
	// plane (normal [0,0,1], phase 0 along +x) — the same convention
	// Shared/geo-leg.js's own tests use for a "release state".
	var chain = {
		base: "Moon",
		rotors: [{
			normal: [0, 0, 1], ref: [1, 0, 0],
			radius: rRel, rate: omega,
			phase0: phaseDeg * Math.PI / 180,
			epoch: releaseJd
		}]
	};
	var got = evaluateChain(chain, releaseJd);

	var ms = LE.moonState(releaseJd);
	var rMoon = O.vScale(ms.r, 1e3), vMoon = O.vScale(ms.v, 1e3);
	var phi = phaseDeg * Math.PI / 180;
	var rHat = [Math.cos(phi), Math.sin(phi), 0], tHat = [-Math.sin(phi), Math.cos(phi), 0];
	var wantR = O.vAdd(rMoon, O.vScale(rHat, rRel));
	var wantV = O.vAdd(vMoon, O.vScale(tHat, vRel));

	assert.ok(O.vMag(O.vSub(got.r, wantR)) < 1e-6, "position matches release kinematics");
	assert.ok(O.vMag(O.vSub(got.v, wantV)) < 1e-9, "velocity matches release kinematics");
});

test("evaluating at the rotor's own epoch reduces to exactly phase0 (no drift)", () => {
	var jd = 2463220.75;
	var chain = { base: "Earth", rotors: [{
		normal: [0, 0, 1], ref: [1, 0, 0], radius: 5000e3, rate: 0.001, phase0: 1.234, epoch: jd
	}] };
	var got = evaluateChain(chain, jd);
	var want = { r: [5000e3 * Math.cos(1.234), 5000e3 * Math.sin(1.234), 0],
	             v: [5000e3 * 0.001 * -Math.sin(1.234), 5000e3 * 0.001 * Math.cos(1.234), 0] };
	assert.ok(O.vMag(O.vSub(got.r, want.r)) < 1e-6);
	assert.ok(O.vMag(O.vSub(got.v, want.v)) < 1e-9);
});

test("synthetic two-rotor chain composes position and velocity as a vector sum", () => {
	var JD = 2463220.75;
	var chain = {
		base: "Earth",
		rotors: [
			// Rotor 1: ecliptic plane (normal z), phase 0 along +x — trivial basis.
			{ normal: [0, 0, 1], ref: [1, 0, 0], radius: 1000, rate: 0.01, phase0: Math.PI / 6, epoch: JD },
			// Rotor 2 (the "tip launcher"): TILTED plane (normal y), riding rotor 1's tip.
			{ normal: [0, 1, 0], ref: [1, 0, 0], radius: 200, rate: 0.05, phase0: Math.PI / 4, epoch: JD }
		]
	};
	var dt = 37;   // s after epoch
	var jd = JD + dt / 86400;
	var got = evaluateChain(chain, jd);
	// The round trip through a jd of this magnitude (~2.46e6) loses a bit of
	// dt's own precision (double epsilon ~5e-10 relative -> ~1e-6 s here),
	// which a 0.05 rad/s rate turns into a sub-micrometre position wobble —
	// negligible for the physics, but too big for a 1e-9 m tolerance below.

	// Rotor 1's contribution, independently: e1=[1,0,0], e2=[0,1,0] (normal=z).
	var phase1 = Math.PI / 6 + 0.01 * dt;
	var r1 = [1000 * Math.cos(phase1), 1000 * Math.sin(phase1), 0];
	var v1 = [1000 * 0.01 * -Math.sin(phase1), 1000 * 0.01 * Math.cos(phase1), 0];

	// Rotor 2's contribution, independently: normal=[0,1,0], ref=[1,0,0] is
	// already orthogonal to normal, so e1=[1,0,0]; e2 = normal x e1 = [0,0,-1].
	var phase2 = Math.PI / 4 + 0.05 * dt;
	var e1 = [1, 0, 0], e2 = [0, 0, -1];
	var dir2 = O.vAdd(O.vScale(e1, Math.cos(phase2)), O.vScale(e2, Math.sin(phase2)));
	var tan2 = O.vAdd(O.vScale(e1, -Math.sin(phase2)), O.vScale(e2, Math.cos(phase2)));
	var wantR = O.vAdd(r1, O.vScale(dir2, 200));
	var wantV = O.vAdd(v1, O.vScale(tan2, 200 * 0.05));

	assert.ok(O.vMag(O.vSub(got.r, wantR)) < 1e-3, "position is the vector sum of both rotors");
	assert.ok(O.vMag(O.vSub(got.v, wantV)) < 1e-6, "velocity is the vector sum of both rotors");

	// Sanity: verify planeBasis itself against the hand-derived rotor-2 basis.
	var basis2 = planeBasis([0, 1, 0], [1, 0, 0]);
	assert.ok(O.vMag(O.vSub(basis2.e1, e1)) < 1e-12);
	assert.ok(O.vMag(O.vSub(basis2.e2, e2)) < 1e-12);
});

test("baseState: Moon matches LunarEphemeris directly; Earth is the geocentric origin", () => {
	var jd = 2463220.75;
	var got = baseState("Moon", jd);
	var ms = LE.moonState(jd);
	assert.ok(O.vMag(O.vSub(got.r, O.vScale(ms.r, 1e3))) < 1e-9);
	assert.ok(O.vMag(O.vSub(got.v, O.vScale(ms.v, 1e3))) < 1e-9);

	var earth = baseState("Earth", jd);
	assert.deepEqual(earth.r, [0, 0, 0]);
	assert.deepEqual(earth.v, [0, 0, 0]);

	assert.throws(() => baseState("Mars", jd), /unknown base body/);
});

test("a chain with no rotors is just the base body's own state", () => {
	var jd = 2463220.75;
	var got = evaluateChain({ base: "Moon", rotors: [] }, jd);
	var want = baseState("Moon", jd);
	assert.deepEqual(got, want);
});
