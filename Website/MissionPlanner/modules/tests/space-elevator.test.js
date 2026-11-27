// Node tests for modules/space-elevator — the off-equator Mars elevator as a
// departure carrier and an arrival catch.
// Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/space-elevator.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import spaceElevator from "../space-elevator/space-elevator-departure.js";
import arrivalSpaceElevator from "../space-elevator/space-elevator-arrival.js";
import bodyDepartureLeg from "../body-departure-leg/body-departure-leg.js";
import { SPACE_ELEVATOR, CATCH_REACH, geometryFor, escapeGate, elementFor, releasePointAt, tetherContact }
	from "../space-elevator/space-elevator.js";
import { techOptionsFor, arrivalTechOptionsFor } from "../../ui/tech-options.js";
import { evaluateChain, appendElement, emptyChain } from "../../../Shared/kinematic-chain.js";
import { ELEVATOR_DEFAULTS, elevatorAt } from "../../../Shared/mars-elevator.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

var JD = 2480821.875;   // the Mars → Earth 2080 example's release
var R_MARS = +systems.get("Mars").radius;
var GM_MARS = systems.get("Mars").GM;

function within(actual, expected, tol, label) {
	assert.ok(Math.abs(actual - expected) <= tol, label + ": " + actual + " not within " + tol + " of " + expected);
}

test("the space elevator is offered at Mars only, in both roles; elsewhere it is still future", function () {
	var dep = techOptionsFor("Mars").filter(function (o) { return o.label === "Space elevator"; });
	assert.deepEqual(dep.map(function (o) { return o.id; }), ["space-elevator"]);
	assert.ok(!dep[0].future);
	var ceres = techOptionsFor("Ceres").filter(function (o) { return o.label === "Space elevator"; });
	assert.equal(ceres.length, 1);
	assert.ok(ceres[0].future);
	assert.ok(arrivalTechOptionsFor("Mars").some(function (o) { return o.id === "arrival-space-elevator" && !o.future; }));
	assert.ok(!arrivalTechOptionsFor("Venus").some(function (o) { return o.id === "arrival-space-elevator"; }));
	assert.equal(geometryFor({ body: "Earth" }).diagnostic.code, "wrong-body");
});

test("its defaults are the Mars traffic plotter's design, released from the counterweight", function () {
	var g = geometryFor({ body: "Mars" });
	assert.ok(g.ok);
	assert.equal(g.fig.rCW, ELEVATOR_DEFAULTS.rCW);
	within(g.rRel, ELEVATOR_DEFAULTS.rCW, 1e-6, "release radius");
	// It moves at w x, faster than escape out there.
	within(g.vRel, g.omega * g.xRel, 1e-9, "release speed");
	assert.ok(g.vInfBody > 0);
	assert.equal(escapeGate(g), null);
	// Set beyond the counterweight, the release point is held there.
	var past = geometryFor({ body: "Mars", relAlt: 80000e3 });
	assert.ok(past.held);
	assert.equal(past.rRel, past.fig.rCW);
	// A design the tether can't take is refused with the shared model's reason.
	assert.equal(geometryFor({ body: "Mars", lat: 40 }).diagnostic.code, "lat-range");
});

test("a release below escape is refused, with the lowest altitude that escapes", function () {
	var g = geometryFor({ body: "Mars", relAlt: 20000e3 });
	assert.ok(g.ok);
	var d = escapeGate(g);
	assert.equal(d.code, "bound-at-body");
	// Escape by w x at about cbrt(2) times areostationary radius, a little more off the equator.
	assert.ok(g.rEsc > 25000e3 && g.rEsc < 27500e3, "escape radius " + g.rEsc);
	assert.ok(escapeGate(geometryFor({ body: "Mars", relAlt: g.rEsc - R_MARS + 1e3 })) === null);
});

test("the chain element is the tether point turning with Mars: position, and spin across position", function () {
	var g = geometryFor({ body: "Mars", relAlt: 40000e3 });
	[JD, JD + 0.3].forEach(function (jd) {
		var st = evaluateChain(appendElement(emptyChain("Mars"), elementFor(g, JD)), jd);
		var pt = releasePointAt(g, jd);
		assert.ok(O.vMag(O.vSub(st.r, pt.r)) < 1e-3, "position at " + jd);
		assert.ok(O.vMag(O.vSub(st.v, pt.v)) < 1e-6, "velocity at " + jd);
		within(O.vMag(st.v), g.vRel, 1e-6, "speed");
		within(O.vMag(st.r), g.rRel, 1, "distance from Mars's centre");
	});
});

test("the release time moves the epoch from its base, and half a day turns the release round", function () {
	var spec = SPACE_ELEVATOR.release;
	assert.equal(spec.epoch({ releaseBaseJd: null, releaseHours: 3 }), null);
	within(spec.epoch({ releaseBaseJd: JD, releaseHours: 6 }), JD + 0.25, 1e-12, "epoch");
	assert.deepEqual(spec.epochSeed({ releaseBaseJd: null, releaseHours: 0 }, JD), { releaseBaseJd: JD });
	assert.equal(spec.epochSeed({ releaseBaseJd: JD, releaseHours: 0 }, JD + 1), null);
	var g = geometryFor({ body: "Mars" });
	var half = Math.PI / g.omega / 86400;
	var a = releasePointAt(g, JD).v, b = releasePointAt(g, JD + half).v;
	assert.ok(O.vDot(O.vUnit(a), O.vUnit(b)) < -0.95, "released half a sidereal day apart, the ship leaves the other way");
});

function departure(params) {
	var reg = createRegistry();
	[spaceElevator, bodyDepartureLeg].forEach(function (m) { reg.register(m); });
	var world = createWorld({ jd: JD });
	var el = world.set({ addStage: { moduleId: "space-elevator", params: Object.assign({ body: "Mars" }, params) } });
	var leg = world.set({ addStage: { moduleId: "body-departure-leg", params: { releaseJd: JD, waypoints: [] } } });
	var engine = createEngine(world, reg);
	return { world: world, el: el, leg: leg, res: function (id) { return engine.resultFor(id); } };
}

test("as a carrier it lets the ship go from the tether, and the departure leg flies it out of Mars's sphere", function () {
	var m = departure({});
	assert.equal(m.res(m.el).status, "ok");
	var rLeg = m.res(m.leg);
	assert.equal(rLeg.status, "ok", JSON.stringify(rLeg.diagnostic || {}));
	assert.equal(rLeg.output.type, "ship-state");
	// Nothing can ride it, nor it another.
	assert.ok(spaceElevator.alone);
	// Released from below escape, the leg is never reached: the carrier refuses.
	var low = departure({ relAlt: 15000e3 });
	assert.equal(low.res(low.el).status, "diagnostic");
	assert.equal(low.res(low.el).diagnostic.code, "bound-at-body");
});

// A flown arc that rides with a point of the tether, `aside` m off it toward
// Mars's pole, moving at the point's own velocity plus `extra`.
function companionPath(g, R, aside, extra) {
	var at0 = elevatorAt(g.fig, JD);
	var q = releasePointAt(Object.assign({}, g, { rRel: R }), JD);
	var lx = O.vDot(q.r, at0.out), ly = O.vDot(q.r, at0.east), lz = O.vDot(q.r, at0.pole) + aside;
	return {
		jd0: JD - 0.5, jd1: JD + 0.5,
		stateAt: function (jd) {
			var at = elevatorAt(g.fig, jd);
			var r = O.vAdd(O.vAdd(O.vScale(at.out, lx), O.vScale(at.east, ly)), O.vScale(at.pole, lz));
			return { r: r, v: O.vAdd(O.vCross(at.spin, r), extra) };
		}
	};
}

test("a catch is where the arc meets the tether, at the tether point's own speed", function () {
	var g = geometryFor({ body: "Mars" });
	var c = tetherContact(g, companionPath(g, 40000e3, 0, [0, 0, 0]));
	assert.ok(c.ok, c.note);
	assert.ok(c.miss < CATCH_REACH);
	assert.ok(c.components.net < 1, "co-moving: nothing to match, " + c.components.net);
	within(c.pointSpeed, O.vMag(releasePointAt(Object.assign({}, g, { rRel: 40000e3 }), JD).v), 5, "the point's speed");
	within(c.altitude + R_MARS, 40000e3, 50e3, "where on the tether");
	// Five kilometres to one side is no catch, and the note says by how much.
	var off = tetherContact(g, companionPath(g, 40000e3, 5e3, [0, 0, 0]));
	assert.equal(off.ok, false);
	assert.equal(off.reason, "off-tether");
	within(off.miss, 5e3, 300, "miss");
	assert.match(off.note, /^No contact: the ship passes 5 km from the tether/);
	// The relative velocity is the ship's over the tether point's, on the tether's own axes.
	var fast = tetherContact(g, companionPath(g, 40000e3, 0, O.vScale(elevatorAt(g.fig, JD).pole, 120)));
	assert.ok(fast.ok);
	within(fast.components.net, 120, 1, "relative speed");
	within(fast.components.nrm, 120, 1, "along the pole");
	assert.equal(tetherContact(g, null).reason, "no-mark");
	assert.equal(GM_MARS, g.GM);
});

test("as an arrival stage it reports its contact as a catch event", function () {
	var reg = createRegistry();
	reg.register(arrivalSpaceElevator);
	assert.equal(arrivalSpaceElevator.id, "arrival-space-elevator");
	assert.deepEqual(arrivalSpaceElevator.accepts, ["ship-state"]);
	assert.deepEqual(arrivalSpaceElevator.emits, []);
	assert.deepEqual(spaceElevator.emits, ["carrier-chain"]);
});

test("the catch card's readouts read the capture's geometry", function () {
	var g = geometryFor({ body: "Mars" });
	var rows = SPACE_ELEVATOR.readouts({ ok: true, geo: g }, "catch");
	assert.equal(rows[0][0], "counterweight speed");
	assert.deepEqual(SPACE_ELEVATOR.readouts({ ok: false }, "catch"), []);
	assert.equal(SPACE_ELEVATOR.readouts(Object.assign({ anchorJd: JD }, g), "release")[0][0], "release point");
});
