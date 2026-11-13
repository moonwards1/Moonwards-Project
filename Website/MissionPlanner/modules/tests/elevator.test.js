// Node tests for modules/elevator — the L1 and L2 elevators as Moon-origin carriers.
// Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/elevator.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import moonPlatform from "../moon-platform/moon-platform.js";
import skyhook from "../skyhook/skyhook-departure.js";
import l1Elevator from "../elevator/l1-elevator-departure.js";
import l2Elevator from "../elevator/l2-elevator-departure.js";
import departureLeg from "../departure-leg/departure-leg.js";
import { L1_ELEVATOR, L2_ELEVATOR, ELEVATOR_LIMITS, releaseRadius, releaseFigures } from "../elevator/elevator.js";
import { techOptionsFor } from "../../ui/tech-options.js";
import { lagrangeLineAt, linePointState } from "../../../Shared/lagrange-elevator.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

var JD = 2464526.125;   // the Moon → Mars 2035 example's release
var R_MOON = +systems.get("Moon").radius;

function within(actual, expected, tol, label) {
	assert.ok(Math.abs(actual - expected) <= tol, label + ": " + actual + " not within " + tol + " of " + expected);
}

// moon-platform, then the given carriers, then the departure leg released at JD
// with the given waypoints.
function run(carriers, waypoints) {
	var reg = createRegistry();
	[moonPlatform, skyhook, l1Elevator, l2Elevator, departureLeg].forEach(function (m) { reg.register(m); });
	var world = createWorld({ jd: JD }), ids = { carriers: [] };
	ids.moon = world.set({ addStage: { moduleId: "moon-platform", params: {} } });
	carriers.forEach(function (c) {
		ids.carriers.push(world.set({ addStage: { moduleId: c[0], params: Object.assign({ body: "Moon" }, c[1]) } }));
	});
	ids.dep = world.set({ addStage: { moduleId: "departure-leg", params: { releaseJd: JD, waypoints: waypoints || [] } } });
	var engine = createEngine(world, reg);
	return { world: world, reg: reg, ids: ids, res: function (id) { return engine.resultFor(id); } };
}

test("both elevators are offered at the Moon only", function () {
	["l1-elevator", "l2-elevator"].forEach(function (id) {
		assert.ok(techOptionsFor("Moon").some(function (o) { return o.id === id && !o.future; }), id);
		assert.ok(!techOptionsFor("Mars").some(function (o) { return o.id === id; }), id);
	});
	assert.equal(L2_ELEVATOR.geometry({ body: "Mars" }).diagnostic.code, "wrong-body");
	assert.equal(L1_ELEVATOR.geometry({ body: "Earth" }).diagnostic.code, "wrong-body");
});

test("its defaults: counterweight 250,000 km above the far side, released from the counterweight", function () {
	var g = L2_ELEVATOR.geometry({ body: "Moon" });
	assert.ok(g.ok);
	within(g.rCw - R_MOON, 250000e3, 1e-3, "counterweight altitude");
	assert.equal(g.rRelSet, g.rCw);
	g.anchors.forEach(function (a) { assert.ok(Math.abs(Math.abs(a.lon) - 180) === 20 && Math.abs(a.lat) === 20); });
});

test("bad geometry is a diagnostic", function () {
	assert.equal(L2_ELEVATOR.geometry({ body: "Moon", cwAlt: 50000e3 }).diagnostic.code, "counterweight-range");
	assert.equal(L2_ELEVATOR.geometry({ body: "Moon", cwAlt: ELEVATOR_LIMITS.cwMax + 1 }).diagnostic.code, "counterweight-range");
	assert.equal(L2_ELEVATOR.geometry({ body: "Moon", relAlt: 260000e3 }).diagnostic.code, "release-off-tether");
	assert.equal(L2_ELEVATOR.geometry({ body: "Moon", relAlt: NaN }).diagnostic.code, "bad-params");
});

test("a release point set nearer the Moon than L2 is let go from L2", function () {
	var g = L2_ELEVATOR.geometry({ body: "Moon", relAlt: 20000e3 }), at = lagrangeLineAt("L2", JD);
	assert.equal(releaseRadius(g, JD), at.rLagrange);
	assert.equal(releaseFigures(g, JD).held, true);
	assert.equal(releaseFigures(L2_ELEVATOR.geometry({ body: "Moon" }), JD).held, false);
});

test("in the chain: the Moon, then the elevator's point, released beyond the Moon away from Earth", function () {
	var c = run([["l2-elevator", {}]]), el = c.res(c.ids.carriers[0]);
	assert.equal(el.status, "ok");
	var chain = el.output.data;
	assert.equal(chain.base, "Moon");
	assert.equal(chain.rotors.length, 1);
	assert.equal(chain.rotors[0].kind, "line");
	assert.equal(chain.alone, "L2 elevator");
	// The released state is the elevator's own point at the release.
	var g = L2_ELEVATOR.geometry({ body: "Moon" });
	var p = linePointState(lagrangeLineAt("L2", JD), g.rCw);
	var rd = c.reg.get("l2-elevator").readoutFor(c.world, c.ids.carriers[0]);
	// The card's impulse is the elevator's own share, s * |du/dt|: some 600 m/s at 250,000 km.
	within(rd.burnDv * 1000, O.vMag(p.relV), 1e-6, "own share, m/s");
	within(rd.burnDv * 1000, 600, 40, "own share near 600 m/s");
	within(rd.speedAfter * 1000, O.vMag(p.v), 1e-6, "speed round Earth on release");
});

test("released from the counterweight, the ship leaves Earth's sphere of influence by itself", function () {
	var c = run([["l2-elevator", {}]]), dep = c.res(c.ids.dep);
	assert.equal(dep.status, "ok");
	assert.equal(dep.output.type, "ship-state");
	assert.equal(dep.output.data.frame, "helio");
	// It crosses the edge a few days out, about 1.1 km/s beyond Earth's escape.
	assert.ok(dep.output.data.jd > JD + 3 && dep.output.data.jd < JD + 10, "hand-off " + (dep.output.data.jd - JD) + " d");
	assert.ok(releaseFigures(L2_ELEVATOR.geometry({ body: "Moon" }), JD).escapes);
});

test("released just past L2, the ship stays bound to Earth: no hand-off, no error", function () {
	var c = run([["l2-elevator", { relAlt: 80000e3 }]]), dep = c.res(c.ids.dep);
	assert.equal(releaseFigures(L2_ELEVATOR.geometry({ body: "Moon", relAlt: 80000e3 }), JD).escapes, false);
	assert.equal(dep.status, "ok");
	assert.equal(dep.output, null);
});

test("the elevator shares its chain with nothing, whichever way round", function () {
	var under = run([["orbital-skyhook", {}], ["l2-elevator", {}]]);
	assert.equal(under.res(under.ids.carriers[1]).diagnostic.code, "alone");
	var over = run([["l2-elevator", {}], ["orbital-skyhook", {}]]);
	assert.equal(over.res(over.ids.carriers[1]).diagnostic.code, "rides-alone");
	assert.equal(l2Elevator.alone, true);
	assert.equal(skyhook.alone, false);
});

test("the card's readouts state the release, on the release date", function () {
	var rows = L2_ELEVATOR.readouts(Object.assign({}, L2_ELEVATOR.geometry({ body: "Moon" }), { anchorJd: JD }));
	assert.equal(rows.length, 6);
	assert.equal(rows[5][1], "leaves Earth by itself");
	assert.deepEqual(L2_ELEVATOR.readouts(L2_ELEVATOR.geometry({ body: "Moon" })), [], "nothing before there is a release date");
});

// ---- the L1 elevator ------------------------------------------------------------

test("the L1 elevator's defaults: counterweight 222,200 km above the near side, released from it", function () {
	var g = L1_ELEVATOR.geometry({ body: "Moon" });
	assert.ok(g.ok);
	assert.equal(g.side, "L1");
	within(g.rCw - R_MOON, 222200e3, 1e-3, "counterweight altitude");
	assert.equal(g.rRelSet, g.rCw);
	g.anchors.forEach(function (a) { assert.ok(Math.abs(a.lon) === 20 && Math.abs(a.lat) === 20); });
});

test("released from L1's counterweight, the ship stays bound and falls to a perigee near Earth", function () {
	var f = releaseFigures(L1_ELEVATOR.geometry({ body: "Moon" }), JD);
	assert.equal(f.escapes, false);
	assert.ok(f.rEarth < 384400e3, "between the Moon and Earth: " + f.rEarth);
	var c = run([["l1-elevator", {}]]), dep = c.res(c.ids.dep);
	assert.equal(dep.status, "ok");
	assert.equal(dep.output, null, "no hand-off: the flight stays with Earth");
	var leg = c.reg.get("departure-leg").legFor(c.world, c.ids.dep), peri = null;
	leg.samples.forEach(function (s) { var m = O.vMag(s.r); if (!peri || m < peri.r) { peri = { r: m, t: s.t }; } });
	// A day and a half later it passes 1,000 to 3,000 km above Earth (this date: about 1,860).
	assert.ok(peri.r - 6378e3 > 1000e3 && peri.r - 6378e3 < 3000e3, "perigee altitude " + (peri.r - 6378e3));
	assert.ok(peri.t > 30 * 3600 && peri.t < 50 * 3600, "perigee after " + peri.t / 3600 + " h");
});

test("a prograde burn at that perigee turns the L1 release into a departure: the Oberth effect", function () {
	var c0 = run([["l1-elevator", {}]]), leg = c0.reg.get("departure-leg").legFor(c0.world, c0.ids.dep), tPeri = 0, rMin = Infinity;
	leg.samples.forEach(function (s) { var m = O.vMag(s.r); if (m < rMin) { rMin = m; tPeri = s.t; } });
	var c = run([["l1-elevator", {}]], [{ t: tPeri, burn: { pro: 300, rad: 0, nrm: 0 } }]), dep = c.res(c.ids.dep);
	assert.equal(dep.status, "ok");
	assert.equal(dep.output.type, "ship-state");
	// 300 m/s added at ~9.6 km/s, just short of the ~9.8 km/s escape speed there:
	// v_inf = sqrt((v_p + dv)^2 - v_esc^2), about 1.3 km/s.
	var vinf = c.reg.get("departure-leg").legFor(c.world, c.ids.dep).vinfEarth;
	within(vinf, 1290, 60, "v-infinity, m/s");
});

test("the two elevators don't share a chain either", function () {
	var c = run([["l1-elevator", {}], ["l2-elevator", {}]]);
	assert.equal(c.res(c.ids.carriers[1]).diagnostic.code, "rides-alone");
	assert.equal(l1Elevator.alone, true);
});
