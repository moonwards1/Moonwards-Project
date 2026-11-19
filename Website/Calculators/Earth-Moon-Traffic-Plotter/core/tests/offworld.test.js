// Node tests for taking in an offworld arrival (core/offworld.js). Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/offworld.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { systems } from "../../../../Shared/orbit.js";
import { CLOCK_EPOCH, facilityFigures } from "../facilities.js";
import { computeFlight } from "../flight.js";
import { readArrival, incomingPass, SOI_EARTH, CORRIDOR_ALT, ACCEPT_WITHIN } from "../offworld.js";

var GM = systems.get("Earth").GM, RE = +systems.get("Earth").radius;
var JD1 = CLOCK_EPOCH + 6799;
var ARRIVES = O.julianDate(2041, 6, 10, 2, 0, 0);

// An inbound hyperbola about Earth with excess vInf (m/s) and its pass at
// height h (m), wound back to just inside the SOI.
function inbound(vInf, h) {
	var rp = RE + h, vp = Math.sqrt(vInf * vInf + 2 * GM / rp);
	var lo = 0, hi = 30 * 86400;
	for (var i = 0; i < 80; i++) {
		var mid = (lo + hi) / 2;
		if (O.vMag(O.propagateState(GM, [rp, 0, 0], [0, vp, 0], -mid).r) < SOI_EARTH * 0.999) { lo = mid; } else { hi = mid; }
	}
	return O.propagateState(GM, [rp, 0, 0], [0, vp, 0], -lo);
}
function packet(s, jd) {
	return { kind: "moonwards-packet", type: "ship-state", version: 1, source: { label: "Ceres → Earth" },
	         data: { r: s.r, v: s.v, jd: jd || ARRIVES, frame: "body:Earth" } };
}

test("the incoming pass is read off the Earth conic", function () {
	var p = incomingPass(inbound(4000, 93e3).r, inbound(4000, 93e3).v);
	assert.ok(Math.abs(p.periAlt - 93e3) < 1, "pass " + p.periAlt);
	assert.ok(Math.abs(p.vInf - 4000) < 1e-6);
});

test("an arrival within 1,000 km of the corridor is taken, on a date in the span", function () {
	[CORRIDOR_ALT, CORRIDOR_ALT + 900e3, CORRIDOR_ALT - 900e3].forEach(function (h) {
		var a = readArrival(packet(inbound(10300, h)), CLOCK_EPOCH, JD1);
		assert.equal(a.ok, true, a.reason);
		assert.ok(a.jd >= CLOCK_EPOCH && a.jd <= JD1 && a.moved);
		assert.equal(a.origJd, ARRIVES);
		assert.equal(a.label, "Ceres → Earth");
	});
});

test("one further out, a wrong frame or an outbound ship is refused with the reason", function () {
	var far = readArrival(packet(inbound(4000, CORRIDOR_ALT + ACCEPT_WITHIN + 2000e3)), CLOCK_EPOCH, JD1);
	assert.equal(far.ok, false);
	assert.match(far.reason, /^Closest approach is (too far from Earth\. Please adjust to be less than 1,000 km\.|[0-9,]+ km below Earth's surface\.)/);
	var p = packet(inbound(4000, 100e3)); p.data.frame = "helio";
	assert.equal(readArrival(p, CLOCK_EPOCH, JD1).ok, false);
	var s = inbound(4000, 100e3);
	assert.equal(readArrival(packet({ r: s.r, v: O.vScale(s.v, -1) }), CLOCK_EPOCH, JD1).ok, false);
});

test("a flight starts from the arrival's own state, on its own date", function () {
	var s = inbound(10300, 93e3), a = readArrival(packet(s), CLOCK_EPOCH, JD1);
	var params = { offworld: { r: a.r, v: a.v, jd: a.jd } };
	assert.equal(facilityFigures("offworld", {}).ok, false);
	var f = computeFlight({ from: "offworld", jd: a.jd, params: params });
	assert.equal(f.ok, true, f.ok ? "" : f.diagnostic.message);
	assert.deepEqual(f.release.r, s.r);
	assert.deepEqual(f.final.samples[0].r, s.r);
	assert.ok(f.summary.periAlt < 200e3, "comes past at about the conic's height: " + f.summary.periAlt);
});
