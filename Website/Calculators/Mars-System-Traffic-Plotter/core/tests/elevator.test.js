// Node tests for core/elevator.js, and the limit it puts on the Phobos
// skyhook (core/facilities.js). Run from the repo root:
//   node --test Website/Calculators/Mars-System-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { ELEVATOR_MATERIALS, KEEP_CLEAR, DODGE, TRAFFIC, elevatorAt, elevatorPoint,
         deimosCrossings, planDodges, spellAt } from "../elevator.js";
import { moonSkyhookLimits, skyhookAt, tetherPointState, R_MARS } from "../facilities.js";
import { CLOCK_EPOCH, SPAN_DAYS } from "../clock.js";
import { MarsEphemeris as ME } from "../../../../Shared/mars-ephemeris.js";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { ELEVATOR_STUDY, elevatorFigures, allFigures, moonSkyhookFigures } from "./studies.js";

var DAY = 86400, DEG = Math.PI / 180, KM = 1e3;
function near(x, want, tol, what) {
	assert.ok(Math.abs(x - want) <= tol, (what || "value") + " " + x + " is not within " + tol + " of " + want);
}
var E = elevatorFigures();

test("the default elevator: Olympus Mons, early nanotube, counterweight at 51,000 km", function () {
	assert.ok(E.ok);
	near(E.lat / DEG, 18.65, 1e-9); near(E.mult, 3, 0.01, "multiple");
	near(E.cwMass, 150.7e6, 1e6, "counterweight (kg)");
	near(E.Tpeak, 87.7e6, 0.5e6, "peak tension (N)"); near(E.rPeak, 20428e3, 150e3, "where it peaks (m)");
	near(E.length, 47.9e6, 0.3e6, "length (m)");
	near(E.zPhobos, 284e3, 3e3, "height at Phobos's distance (m)"); near(E.zDeimos, 220e3, 3e3, "height at Deimos's distance (m)");
	assert.ok(E.phobosClear > KEEP_CLEAR, "passes Phobos by more than the margin");
	near(E.swing.period, 24.46 * 3600, 200, "swing period (s)");
	near(E.pumping.dmOnOff, 392e3, 10e3, "load held on the stretch (kg)");
	assert.ok(!E.release.bound, "a ship let go at the counterweight escapes Mars");
});

test("a design is refused outside its ranges, or where it passes too near Phobos", function () {
	function code(p) { var f = elevatorFigures(p); return f.ok ? "ok" : f.diagnostic.code; }
	assert.equal(code({ lat: 21 }), "lat-range");
	assert.equal(code({ safety: 3.2 }), "safety-range");
	assert.equal(code({ material: "mwcnt", safety: 4 }), "ok");
	assert.equal(code({ material: "mwcnt", safety: 4.1 }), "safety-range");
	assert.equal(code({ material: "silica" }), "material");
	assert.equal(code({ rCW: 20000e3 }), "cw-range");
	assert.equal(code({ lat: 10 }), "phobos");
	assert.equal(code({ safety: 3 }), "phobos");
	assert.deepEqual(ELEVATOR_MATERIALS.ecnt.safety, [1.5, 3]);
});

test("a counterweight too light is raised; a heavier one straightens the tether", function () {
	var light = elevatorFigures({ cwMass: 20e6, safety: 2 }), heavy = elevatorFigures({ cwMass: 500e6 });
	assert.ok(light.ok, light.ok ? "" : light.diagnostic.message);
	assert.ok(light.raised && light.cwMass > 20e6, "raised from 20 kt");
	assert.equal(heavy.raised, null); near(heavy.cwMass, 500e6, 1);
	assert.ok(heavy.zPhobos > E.zPhobos + 40e3 && heavy.Tpeak > 3 * E.Tpeak);
});

test("a southern anchor is the northern one mirrored", function () {
	var S = elevatorFigures({ lat: -18.65 });
	near(S.Tpeak, E.Tpeak, 1); assert.equal(S.side, -1);
	var jd = CLOCK_EPOCH + 300.2, k = 200;
	var n = elevatorPoint(E, elevatorAt(E, jd), k), s = elevatorPoint(S, elevatorAt(S, jd), k);
	near(O.vDot(n, ME.pole) + O.vDot(s, ME.pole), 0, 2 * DODGE.swing, "heights above the plane (m)");
	assert.ok(O.vDot(n, ME.pole) > 0 && O.vDot(s, ME.pole) < 0);
});

test("the tether stands on its anchor and turns with Mars", function () {
	var jd = CLOCK_EPOCH + 123.456, at = elevatorAt(E, jd), n = E.curve.r.length;
	var foot = elevatorPoint(E, at, 0), g = ME.groundPoint(foot, jd);
	near(g.lat / DEG, 18.65, 1e-6, "anchor latitude"); near(((g.lon / DEG) + 360) % 360, 226.2, 1e-6, "anchor longitude");
	near(g.radius, E.rA, 1);
	var cw = elevatorPoint(E, at, n - 1), gc = ME.groundPoint(cw, jd);
	near(gc.radius, E.rCW, DODGE.swing, "counterweight's distance (m)");
	near(((gc.lon / DEG) + 360) % 360, 226.2 - E.lean.atCW.angle / DEG, 1e-6, "the counterweight stands west of the anchor's meridian by the lean");
	near(O.vDot(cw, ME.pole), E.zCW, DODGE.swing, "its height above the plane (m)");
	assert.ok(E.stretch[1] > E.stretch[0]);
	near(E.curve.r[E.stretch[0]] - E.rA, TRAFFIC.from, 15e3); near(E.curve.r[E.stretch[1]] - E.rA, TRAFFIC.to, 15e3);
});

test("Deimos crosses the tether's meridian every 131 hours, and its misses are measured there", function () {
	var cs = deimosCrossings(E.lon, CLOCK_EPOCH, CLOCK_EPOCH + 100);
	near((cs[cs.length - 1].jd - cs[0].jd) / (cs.length - 1) * 24, 131.3, 0.3, "hours between crossings");
	cs.forEach(function (c) {
		var g = ME.groundPoint(ME.moonState("Deimos", c.jd).r, c.jd);
		near(Math.abs(g.lon - E.lon) % (2 * Math.PI), 0, 1e-7, "Deimos's longitude at a crossing (rad)");
	});
	var p = E.dodges.passes[40];
	near(p.miss, p.z - E.zDeimos, 2e3, "a crossing's miss (m)");
});

test("every hazard crossing is dodged: the tether stands off on the far side as Deimos crosses", function () {
	var d = E.dodges, hz = d.passes.filter(function (p) { return p.hazard; });
	assert.ok(hz.length >= 8 && hz.length <= 20, hz.length + " hazard crossings in the span");
	hz.forEach(function (p) {
		assert.ok(Math.abs(p.miss) < DODGE.band / 2);
		near(p.swing, p.dir * DODGE.swing, 1e3, "the swing as Deimos crosses (m)");
		assert.ok(Math.abs(p.actual) >= DODGE.swing, "Deimos passes at least the dodge swing away");
		// The drawn tether is displaced by the same amount there.
		var at = elevatorAt(E, p.jd);
		near(at.swing.d, p.swing, 1); near(at.swing.size, DODGE.swing, 1e3);
	});
	assert.ok(Math.abs(d.closest.actual) >= DODGE.band / 2 - 1, "nothing in the span comes inside half the trigger band");
	// Each spell builds up over the pumping cycles, and the tether is at rest outside the spells.
	d.spells.forEach(function (s) {
		near((s.passes[0].jd - s.jdStart) * DAY, TRAFFIC.cycles * E.swing.period, 60, "build-up (s)");
		assert.equal(elevatorAt(E, s.jdStart - 0.5).swing.size, 0);
		assert.equal(elevatorAt(E, s.jdStart + 1).swing.trend, 1);
		assert.equal(elevatorAt(E, s.jdEnd - 1).swing.trend, -1);
	});
	assert.equal(spellAt(E, CLOCK_EPOCH - 100), d.spells[0]);
	assert.equal(spellAt(E, CLOCK_EPOCH + SPAN_DAYS + 100), d.spells[d.spells.length - 1]);
});

test("hazard crossings too close together to swing fully for each still leave Deimos well clear", function () {
	// Two crossings one pass apart, both dead on the tether, the tether wanted north for both.
	var w = E.swing.omega, gap = 131.3 / 24;
	var d = planDodges([{ jd: CLOCK_EPOCH + 50, rho: 23.46e6, z: 0, miss: -1e3 }, { jd: CLOCK_EPOCH + 50 + gap, rho: 23.46e6, z: 0, miss: -1e3 }], w);
	assert.equal(d.spells.length, 1); assert.equal(d.spells[0].passes.length, 2);
	d.passes.forEach(function (p) { assert.ok(p.swing > 30e3 && Math.abs(p.actual) > 30e3, "swing " + p.swing); });
	// Far enough apart, each gets its own spell and the full swing.
	var far = planDodges([{ jd: CLOCK_EPOCH + 50, rho: 23.46e6, z: 0, miss: 10e3 }, { jd: CLOCK_EPOCH + 90, rho: 23.46e6, z: 0, miss: -10e3 }], w);
	assert.equal(far.spells.length, 2);
	near(far.passes[0].swing, -DODGE.swing, 10); near(far.passes[1].swing, DODGE.swing, 10);
});

test("a tether that ends short of Deimos needs no dodges", function () {
	var low = elevatorFigures({ rCW: 22820e3, cwMass: 6000e6 });
	assert.ok(low.ok, low.ok ? "" : low.diagnostic.message);
	assert.equal(low.dodges, null); assert.equal(low.swing, null); assert.equal(low.zDeimos, null);
	assert.equal(elevatorAt(low, CLOCK_EPOCH + 5).swing.d, 0);
});

test("the elevator holds the Phobos skyhook's top short of its own tether", function () {
	var L = moonSkyhookLimits("phobosSkyhook"), cap = E.phobosTopCap;
	near(cap, 6838e3, 30e3, "cap on the top (m)");
	var figs = allFigures({ spaceElevator: ELEVATOR_STUDY });
	assert.equal(figs.phobosSkyhook.diagnostic.code, "top-range");       // the default top, 10,000 km, is past it
	assert.ok(allFigures({}).phobosSkyhook.ok, "with no elevator the default stands");
	var ok = moonSkyhookFigures("phobosSkyhook", { topAlt: cap - 1e3 }, E);
	assert.ok(ok.ok); near(ok.topCap, cap, 1);
	assert.equal(moonSkyhookFigures("phobosSkyhook", { topAlt: cap + 1e3 }, E).diagnostic.code, "top-range");
	// At the cap, with Phobos farthest out and highest above the plane, the two tethers are KEEP_CLEAR apart.
	var rho = R_MARS + cap + L.swing, reach = rho * Math.sin(1.08 * DEG);
	var k = 0; while (E.curve.r[k] < rho) { k++; }
	var swing = Math.abs(E.curve.eta[k]);
	near(E.curve.z[k] - swing - reach, KEEP_CLEAR, 4e3, "gap at the cap (m)");
	// A stronger cable rides higher off the plane and lets the Phobos tether reach further.
	assert.ok(elevatorFigures({ material: "mwcnt" }).phobosTopCap > 19000e3);
	// The real tether never comes nearer than that over a turn of Phobos's orbit plane.
	var P = moonSkyhookFigures("phobosSkyhook", { topAlt: cap }, E), worst = Infinity;
	for (var d = 0; d < 830; d += 0.37) {
		var top = tetherPointState(skyhookAt(P, CLOCK_EPOCH + d), P.sTop).r, r = O.vMag(top), z = Math.abs(O.vDot(top, ME.pole));
		var kk = 0; while (kk < E.curve.r.length - 1 && E.curve.r[kk] < r) { kk++; }
		worst = Math.min(worst, E.curve.z[kk] - Math.abs(E.curve.eta[kk]) - z);
	}
	assert.ok(worst > KEEP_CLEAR - 5e3 && worst < KEEP_CLEAR + 25e3, "least gap at the top over 830 days: " + worst);
});

test("cargo going up leans the tether west, held by the anchor", function () {
	var none = elevatorFigures({ cargoFlow: 0 }), ten = elevatorFigures({ cargoFlow: 10 });
	near(none.lean.angle, 0, 1e-9); near(none.lean.atCW.distance, 0, 1);
	near(none.lean.elevation, none.departure, 1e-4, "empty, it leaves the anchor as sized");
	near(none.lean.most, ten.lean.most, 1e-9, "the most flow doesn't depend on the flow shown");
	// The default is held to about 23 kg/s by Phobos: the cargo's weight draws it toward the plane.
	near(ten.lean.most, 22.7, 1, "most kg/s the default tether carries"); assert.equal(ten.lean.mostBy, "phobos");
	assert.ok(ten.phobosClear < none.phobosClear && ten.phobosTopCap < none.phobosTopCap, "loaded, it passes Phobos nearer");
	// The anchor's sideways pull carries the whole torque: sin(theta) * T0 * x_A = mdot * w * (x_c^2 - x_A^2).
	var L = ten.lean, xA = ten.curve.x[0];
	near(Math.sin(L.angle) * L.T0 * xA, L.torque, 0.002 * L.torque, "the anchor's moment");
	near(L.angle / DEG, 4.1, 0.15, "lean at the anchor at 10 kg/s");
	near(L.atCW.angle / DEG, 1.33, 0.03); near(L.atPhobos.angle / DEG, 1.23, 0.03);
	assert.ok(L.T0 < ten.T0, "the cargo's weight takes some tension off the anchor");
	assert.ok(L.elevation < none.lean.elevation, "and lowers the tether where it leaves the anchor");
	assert.ok(ten.zPhobos < none.zPhobos, "so it passes Phobos a little nearer the plane");
	// Drawn west of the meridian by that angle; Deimos is met there, so its crossings move.
	var jd = CLOCK_EPOCH + 222.2, at = elevatorAt(ten, jd), n = ten.curve.r.length;
	var g = ME.groundPoint(elevatorPoint(ten, at, n - 1), jd);
	near(((g.lon / DEG) + 360) % 360, 226.2 - L.atCW.angle / DEG, 1e-6, "counterweight's longitude");
	near(g.radius, ten.rCW, DODGE.swing, "held at its design distance");
	var f0 = ME.groundPoint(elevatorPoint(ten, at, 0), jd);
	near(f0.lat / DEG, 18.65, 1e-5, "it still stands on its anchor"); near(((f0.lon / DEG) + 360) % 360, 226.2, 1e-5);
	var c0 = none.dodges.passes[50], c1 = ten.dodges.passes.filter(function (p) { return Math.abs(p.jd - c0.jd) < 1; })[0];
	near((c1.jd - c0.jd) * 86400, L.atDeimos.angle / (2 * Math.PI / ME.SIDEREAL_DAY - 2 * Math.PI / 109123.2), 60, "a crossing comes later by the lean over the drift rate (s)");
	assert.equal(elevatorFigures({ cargoFlow: 30 }).diagnostic.code, "flow-limit");
	// A stronger cable rides far above Phobos; there it is the ground that stops it.
	var mature = elevatorFigures({ material: "mwcnt", cargoFlow: 90 });
	assert.ok(mature.ok); assert.equal(mature.lean.mostBy, "ground"); near(mature.lean.most, 102, 4);
	assert.ok(mature.lean.mostElevation < 8 * DEG, "by then it leaves the anchor low over the ground");
	assert.equal(elevatorFigures({ cargoFlow: -1 }).diagnostic.code, "flow-range");
});

test("a steep lean is solved in full, and a heavier counterweight carries more", function () {
	var heavy = elevatorFigures({ cwMass: 300e6, cargoFlow: 120 });
	assert.ok(heavy.ok, heavy.ok ? "" : heavy.diagnostic.message);
	near(heavy.lean.most, 144, 5, "most flow with 300 kt");
	assert.ok(heavy.lean.angle > 20 * DEG, "lean " + heavy.lean.angle / DEG);
	near(Math.sin(heavy.lean.angle) * heavy.lean.T0 * heavy.curve.x[0], heavy.lean.torque, 0.003 * heavy.lean.torque, "the anchor's moment, steep");
});
