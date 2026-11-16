// Node tests for the off-equator Mars elevator. Run from the repo root:
//   node --test Website/Calculators/Mars-Elevator/marsElevatorModel.test.js
//
// Pins the two design studies the calculator was built from (README.md):
// early CNT (18 GPa, 1,450 kg/m³) at safety factor 2.5, the bare cable (no
// track, no stations) held down with 10 MN at the Olympus Mons summit
// (18.65°N, 21.9 km above the areoid), counterweight at 51,000 km (Deimos
// dodged) or 22,820 km (below Deimos). Tolerances cover the studies' rounding.

import test from "node:test";
import assert from "node:assert/strict";

import { solveMeridianTether } from "../../Shared/meridian-tether.js";
import { MarsElevator as ME } from "./marsElevatorModel.js";

var KM = 1e3, DEG = Math.PI / 180;
var sys = ME.marsSystem();
var anc = ME.anchor(sys, 18.65, 21.9 * KM);

function near(actual, expected, rel, label) {
	assert.ok(Math.abs(actual / expected - 1) < rel, label + ": " + actual + " vs " + expected);
}

// The bare cable with a 10 MN hold-down: its shape doesn't depend on the
// counterweight's mass, so solve once and scale the mass to the hold-down.
function bare(rCW) {
	var q = { latA: anc.lat, rA: anc.r, rCW: rCW, M: 1e8, rho: 1450, sigEff: 18e9 / 2.5 };
	var s = solveMeridianTether(sys.field, q);
	return solveMeridianTether(sys.field, Object.assign(q, { M: 1e8 * 1e7 / s.T0, zGuess: s.zCW }));
}
var far = bare(51000 * KM), low = bare(22820 * KM);

test("Mars figures", function () {
	near(sys.rStat, 20428.2 * KM, 1e-5, "areostationary radius with J2");
	near(anc.r, 3416.1 * KM, 1e-4, "summit's distance from the centre");
	near(ME.phobosReach(sys.phobos), 191 * KM, 0.01, "Phobos's reach from the plane");
});

test("counterweight beyond Deimos, 51,000 km", function () {
	near(far.T0, 10e6, 1e-9, "hold-down");
	near(far.departure / DEG, 38, 0.01, "departure above horizontal");
	near(far.M, 119e6, 0.01, "counterweight");
	near(far.mass, 485e6, 0.01, "tether");
	near(far.Tpeak / far.T0, 6.68, 0.002, "taper");
	near(far.Tcw, 28.4e6, 0.01, "tension at the counterweight");
	near(far.length, 47800 * KM, 0.005, "length");
	near(far.zCW, 270 * KM, 0.02, "counterweight off the plane");
	near(ME.heightAtRadius(far, sys.phobos.a), 370 * KM, 0.01, "height at Phobos's radius");
	near(ME.heightAtRadius(far, 23458 * KM), 291 * KM, 0.01, "height at Deimos's radius");
});

test("counterweight below Deimos, 22,820 km", function () {
	near(low.M, 2043e6, 0.005, "counterweight");
	near(low.mass, 206e6, 0.005, "tether");
	near(ME.heightAtRadius(low, sys.phobos.a), 305 * KM, 0.01, "height at Phobos's radius");
	assert.ok(low.zCW > 90 * KM && low.zCW < 115 * KM, "counterweight about 108 km off the plane: " + low.zCW);
});

test("Deimos hazard", function () {
	var zt = ME.heightAtRadius(far, 23458 * KM);
	var today = ME.deimosHazard({ sys: sys, zT: zt, tilt: 0.93 * DEG, band: 100 * KM });
	near(today.Z, 381 * KM, 0.005, "Deimos's reach today");
	near(today.tCross / 3600, 131.4, 0.005, "time between passes");
	near(today.vRel, 311, 0.01, "relative speed");
	near(today.P, 0.13, 0.03, "chance per pass");
	near(today.dodges, 9, 0.06, "dodges a year");
	near(today.perCluster, 4, 0.06, "passes per cluster");
	near(today.clusters, 2, 0.06, "clusters a year");
	near(Math.abs(today.drift) / DEG, 5.6, 0.02, "drift per third pass");
	near(today.spacing / 86400, 16.4, 0.01, "days between hazard passes");
	var peak = ME.deimosHazard({ sys: sys, zT: zt, tilt: 2.8 * DEG, band: 100 * KM });
	near(peak.P, 0.029, 0.02, "chance per pass at the cycle's peak");
	near(peak.dodges, 2, 0.05, "dodges a year at the peak");
	assert.equal(ME.deimosHazard({ sys: sys, zT: 400 * KM, tilt: 0.93 * DEG, band: 100 * KM }).dodges, 0);
});

test("dodge swing, pumping and the backup", function () {
	var sw = ME.swings(sys, far, { rRef: 23458 * KM, dodge: 60 * KM });
	var p = sw.modes.map(function (m) { return m.period / 3600; });
	near(p[0], 24.4, 0.002, "slowest period"); near(p[1], 10.0, 0.005, "second period"); near(p[2], 5.6, 0.01, "third period");
	var m0 = sw.modes[0];
	near(m0.atPhobos, 22 * KM, 0.02, "slowest swing at Phobos's radius");
	near(m0.atCW, 134 * KM, 0.01, "slowest swing at the counterweight");
	near(m0.energy, 12.4e9, 0.01, "slowest swing's energy");
	near(sw.modes[1].energy, 21e9, 0.01, "second swing's energy");
	near(ME.etaAt(sw.nodes, m0.eta, anc.r + 380 * KM), 3.3 * KM, 0.03, "swing at 380 km altitude");
	var pm = ME.pumping({ nodes: sw.nodes, mode: m0, rA: anc.r, from: 400 * KM, to: 800 * KM, cycles: 6, vFull: 200, vSlow: 20 });
	near(pm.perKg * 1e3, 16.7e6, 0.04, "work per cycle per tonne");
	near(pm.dmSmooth, 250e3, 0.05, "smooth load change over 6 cycles");
	near(pm.dmOnOff, 390e3, 0.05, "on/off load over 6 cycles");
	near(pm.length, 470 * KM, 0.05, "stretch length");
	var pm20 = ME.pumping({ nodes: sw.nodes, mode: m0, rA: anc.r, from: 400 * KM, to: 800 * KM, cycles: 20, vFull: 200, vSlow: 20 });
	near(pm20.dmOnOff, 120e3, 0.07, "on/off load over 20 cycles");
	near(ME.backupImpulse(sw.nodes, m0) * 4 / Math.PI, 3.3e9, 0.01, "thruster impulse, on/off");
});

test("westward lean and release", function () {
	var th = ME.westwardLean({ mdot: 1, omega: sys.omega, rCW: 51000 * KM, T0: far.T0, rA: anc.r, lat: anc.lat });
	near(th / DEG, 0.33, 0.02, "lean at 1 kg/s");
	var ro = ME.releaseOrbit(sys, 51000 * KM);
	assert.equal(ro.bound, false);
	near(ro.v, 3615, 0.001, "release speed");
	var rl = ME.releaseOrbit(sys, 22820 * KM);
	assert.equal(rl.bound, true);
	assert.ok(rl.rApo > 22820 * KM, "release is the periapsis");
});
