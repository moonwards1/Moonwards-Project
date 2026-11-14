// Node tests for the hand-off from an Earth arrival to the Earth–Moon Traffic
// Plotter (modules/arrival-leg/earth-handoff.js). Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/earth-handoff.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { computeArrivalLeg, stateAtElapsed } from "../arrival-leg/arrival-leg.js";
import { earthHandoff, handoffPacket } from "../arrival-leg/earth-handoff.js";
import { ARRIVAL_TAIL_DAYS } from "../../core/arrival-seam.js";
import { bodyConstants } from "../../../Shared/body-leg.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";
import { systems } from "../../../Shared/orbit.js";

var GM_SUN = systems.get("Sun").GM;
var JD = O.julianDate(2034, 1, 8, 0, 0, 0);
var SOI = bodyConstants("Earth").SOI;

// An approach to `body` that would pass `offsetM` off it at JD with `vInf` m/s
// along +x, wound back `days` days on a Sun-only arc (as in arrival.test.js).
function approachSpec(body, vInf, offsetM, days) {
	var bs = Frames.bodyHelioState(body, JD);
	var back = O.propagateState(GM_SUN, O.vAdd(bs.r, [0, offsetM, 0]), O.vAdd(bs.v, [vInf, 0, 0]), -days * 86400);
	return { r: back.r, v: back.v, jd0: JD - days, jdEnd: JD + ARRIVAL_TAIL_DAYS };
}
function leg(wps, days, offset, body) {
	return computeArrivalLeg({ body: body || "Earth", waypoints: wps || [] },
		approachSpec(body || "Earth", 4000, offset || 2e7, days || 5));
}

test("hands over where the flown arrival first crosses into Earth's SOI", function () {
	var L = leg();
	assert.equal(L.ok, true);
	assert.ok(L.rStart > SOI, "the window opens outside the SOI");
	var h = earthHandoff(L);
	assert.equal(h.ok, true, h.reason);
	assert.ok(Math.abs(O.vMag(h.r) - SOI) < 10, "on the SOI sphere: " + (O.vMag(h.r) - SOI));
	assert.ok(h.t > 0 && h.t < L.ca.t, "before closest approach");
	assert.ok(O.vDot(h.r, h.v) < 0, "inbound");
	assert.ok(Math.abs(h.jd - (L.jd0 + h.t / 86400)) < 1e-9);
	var s = stateAtElapsed(L, h.t);
	assert.deepEqual(h.v, s.v);
});

test("an arrival already inside the SOI hands over at its start", function () {
	var L = leg([], 1);
	assert.ok(L.rStart < SOI);
	var h = earthHandoff(L);
	assert.equal(h.ok, true, h.reason);
	assert.equal(h.t, 0);
});

test("a waypoint before the crossing is carried in the state; one after it is refused", function () {
	var free = leg(), h0 = earthHandoff(free);
	var early = leg([{ t: 3600, burn: { pro: 0, rad: 5, nrm: 0 } }]), he = earthHandoff(early);
	assert.equal(he.ok, true, he.reason);
	assert.ok(O.vMag(O.vSub(he.r, h0.r)) > 1e3, "the burn moved the ship");
	var late = leg([{ t: h0.t + 6 * 3600, burn: { pro: 0, rad: 5, nrm: 0 } }]), hl = earthHandoff(late);
	assert.equal(hl.ok, false);
	assert.match(hl.reason, /Arrival waypoint 1 fires inside Earth's sphere of influence/);
});

test("refuses another body, and an arrival that never comes inside the SOI", function () {
	assert.equal(earthHandoff(leg([], 5, 2e7, "Mars")).ok, false);
	var far = earthHandoff(leg([], 5, 3e9));
	assert.equal(far.ok, false);
	assert.match(far.reason, /never comes inside/);
});

test("the packet is a valid Earth-relative ship-state", function () {
	var h = earthHandoff(leg());
	var p = handoffPacket(h, "Ceres → Earth");
	assert.equal(PacketTypes.validate(p).ok, true);
	assert.equal(p.data.frame, "body:Earth");
	assert.equal(p.data.jd, h.jd);
	assert.equal(p.source.label, "Ceres → Earth");
});
