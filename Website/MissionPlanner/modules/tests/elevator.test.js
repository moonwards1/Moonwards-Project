// Node tests for modules/elevator — the L2 elevator as a Moon-origin carrier.
// Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/elevator.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import moonPlatform from "../moon-platform/moon-platform.js";
import skyhook from "../skyhook/skyhook-departure.js";
import l2Elevator from "../elevator/l2-elevator-departure.js";
import departureLeg from "../departure-leg/departure-leg.js";
import { L2_ELEVATOR, ELEVATOR_LIMITS, releaseRadius, releaseFigures } from "../elevator/elevator.js";
import { techOptionsFor } from "../../ui/tech-options.js";
import { lagrangeLineAt, linePointState } from "../../../Shared/lagrange-elevator.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

var JD = 2464526.125;   // the Moon → Mars 2035 example's release
var R_MOON = +systems.get("Moon").radius;

function within(actual, expected, tol, label) {
	assert.ok(Math.abs(actual - expected) <= tol, label + ": " + actual + " not within " + tol + " of " + expected);
}

// moon-platform, then the given carriers, then the departure leg released at JD.
function run(carriers) {
	var reg = createRegistry();
	[moonPlatform, skyhook, l2Elevator, departureLeg].forEach(function (m) { reg.register(m); });
	var world = createWorld({ jd: JD }), ids = { carriers: [] };
	ids.moon = world.set({ addStage: { moduleId: "moon-platform", params: {} } });
	carriers.forEach(function (c) {
		ids.carriers.push(world.set({ addStage: { moduleId: c[0], params: Object.assign({ body: "Moon" }, c[1]) } }));
	});
	ids.dep = world.set({ addStage: { moduleId: "departure-leg", params: { releaseJd: JD } } });
	var engine = createEngine(world, reg);
	return { world: world, reg: reg, ids: ids, res: function (id) { return engine.resultFor(id); } };
}

test("the L2 elevator is offered at the Moon only", function () {
	assert.ok(techOptionsFor("Moon").some(function (o) { return o.id === "l2-elevator" && !o.future; }));
	assert.ok(!techOptionsFor("Mars").some(function (o) { return o.id === "l2-elevator"; }));
	assert.equal(L2_ELEVATOR.geometry({ body: "Mars" }).diagnostic.code, "wrong-body");
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
