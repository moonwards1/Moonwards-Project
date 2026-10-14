// Node tests for tipDriverModel.js. Run from the repo root:
//   node --test Website/Calculators/Tip-Mass-Driver-Calculator/tipDriverModel.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { launchProfile, brakingProfile, aluminiumPulseLimits, sizeTipDriver } from "./tipDriverModel.js";

const g0 = 9.80665;

const BASE = {
	shipMass: 2e6, accel: 10 * g0, vFinal: 2000, B: 2,
	sledMassFrac: 0.15, sledLengthPerKg: 0.05e-3, brakeAccel: 50 * g0, powerCapFrac: 0,
	magnetHeight: 4, faces: 2, endFactor: 1.5, T0: 77, T1: 150, etaConv: 0.95,
	cnt: { strength: 42e9, density: 1400, sf: 2 },
	cer: { strength: 400e6, density: 2600, sf: 2, postFactor: 2, skin: 0.005 },
	flywheel: { speedRatio: 0.5 },
	power: { voltage: 1e5, conductors: 2, genField: 2, genSpeed: 1500, genStructure: 2, convSpecific: 1e5 },
};

function close(a, b, rel, msg) {
	assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);
}

test("constant acceleration matches the textbook kinematics", () => {
	const m = 2.3e6, a = 10 * g0, v = 2000;
	const p = launchProfile(m, a, v, 0);
	assert.equal(p.capped, false);
	close(p.L, v * v / (2 * a), 1e-12, "length");
	close(p.T, v / a, 1e-12, "duration");
	close(p.Ppeak, m * a * v, 1e-12, "peak power");
	close(p.timeAt(p.L), p.T, 1e-12, "time at end");
});

test("power-capped profile: continuous, delivers the same energy, halves peak", () => {
	const m = 2.3e6, a = 10 * g0, v = 2000;
	const p = launchProfile(m, a, v, 0.5 * m * a * v);
	assert.equal(p.capped, true);
	close(p.vc, v / 2, 1e-12, "cap speed");
	close(p.speedAt(p.L), v, 1e-9, "final speed");
	close(p.timeAt(p.L), p.T, 1e-9, "time at end");
	// ∫F dx over the track equals the kinetic energy
	const N = 200000; let W = 0;
	for (let i = 0; i < N; i++) W += p.forceAt((i + 0.5) * p.L / N) * p.L / N;
	close(W, 0.5 * m * v * v, 1e-6, "work");
	// continuity at the phase boundary
	close(p.speedAt(p.x1 * (1 + 1e-9)), p.vc, 1e-6, "speed continuity");
	close(p.forceAt(p.x1 * (1 + 1e-9)), m * a, 1e-6, "force continuity");
	assert.ok(p.L > v * v / (2 * a), "capped track is longer");
});

test("braking profile stops the sled at the end", () => {
	const b = brakingProfile(3e5, 50 * g0, 2000);
	close(b.L, 2000 ** 2 / (2 * 50 * g0), 1e-12, "length");
	close(b.timeAt(b.L), b.T, 1e-12, "time");
});

test("aluminium pulse limits are in the expected range for 77→150 K", () => {
	const { G, dH } = aluminiumPulseLimits(77, 150);
	assert.ok(G > 1.7e16 && G < 2.3e16, `G ${G}`);
	assert.ok(dH > 3.5e4 && dH < 4.2e4, `dH ${dH}`);
});

test("full sizing: spine equals SF·E/(σ/ρ) at constant acceleration; heat = mass·ΔH", () => {
	const r = sizeTipDriver(BASE);
	const E = 0.5 * r.mMoving * 2000 ** 2;
	close(r.structure.spineLaunch, 2 * E / (42e9 / 1400), 1e-9, "launch spine");
	close(r.launch.Fmax, 2.3e6 * 10 * g0, 1e-12, "force");
	const { dH } = aluminiumPulseLimits(77, 150);
	close(r.windings.heatLaunch, r.windings.launch * dH, 1e-12, "heat");
	// windings in the ~0.5 kt range worked out by hand
	assert.ok(r.windings.launch > 4e5 && r.windings.launch < 7e5, `windings ${r.windings.launch}`);
	close(r.energy.eRim, 7.5e6, 1e-12, "rim energy density");
	assert.ok(Number.isFinite(r.total) && r.total > 0);
});

test("capping power raises spine mass and track length, lowers peak power", () => {
	const a = sizeTipDriver(BASE);
	const b = sizeTipDriver({ ...BASE, powerCapFrac: 0.5 });
	assert.ok(b.launch.L > a.launch.L);
	assert.ok(b.structure.spineLaunch > a.structure.spineLaunch);
	close(b.launch.Ppeak, 0.5 * a.launch.Ppeak, 1e-12, "peak");
});

test("winding mass matches the closed form and ignores acceleration and power cap", () => {
	const { G } = aluminiumPulseLimits(77, 150);
	const r = sizeTipDriver(BASE);
	const ell = r.sledLength, m = r.mMoving, v = 2000;
	const closed = (4 * Math.SQRT2 / 3) * 2700 * 1.5 * m * v ** 1.5 / (2 * Math.sqrt(G * ell));
	close(r.windings.launch, closed, 0.03, "closed form");
	close(sizeTipDriver({ ...BASE, accel: 20 * g0 }).windings.launch, r.windings.launch, 0.03, "acceleration");
	close(sizeTipDriver({ ...BASE, powerCapFrac: 0.5 }).windings.launch, r.windings.launch, 0.03, "power cap");
});

const POWER = BASE.power;

test("hub power delivery matches the closed forms", () => {
	const r = sizeTipDriver({ ...BASE, power: POWER });
	const { G } = aluminiumPulseLimits(77, 150);
	const m = r.mMoving, a = 10 * g0, v = 2000, F = m * a, L = r.launch.L;
	const Fb = r.brake.F, ab = 50 * g0, V = 1e5;
	// feeders: launch toward the hub, braking away from it
	const volL = F * (2 * a) ** 0.25 * Math.sqrt(2 / 3) / (V * Math.sqrt(G)) * (4 / 7) * L ** 1.75;
	const volB = Fb * v ** 3.5 / (3.5 * ab * V * Math.sqrt(3 * ab * G));
	close(r.power.feeders, 2 * 2700 * (volL + volB), 0.01, "feeders");
	// generators: one bank serving launch then braking
	const E2 = F * F * v ** 3 / (3 * a) + Fb * Fb * v ** 3 / (3 * ab);
	close(r.power.generators, 2 * 2 * 2700 * 1.5 * Math.sqrt(E2) / (2 * 1500 * Math.sqrt(G)), 0.01, "generators");
	// converters rated for the larger of launch and braking peaks
	close(r.power.converters, Math.max(F * v, Fb * v) / 1e5, 0.01, "converters");
});
