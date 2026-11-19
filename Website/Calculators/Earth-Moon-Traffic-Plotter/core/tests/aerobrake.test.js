// Node tests for the aerobrake pass (core/aerobrake.js). Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/aerobrake.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { systems } from "../../../../Shared/orbit.js";
import { brakingNeeds, passAt, defaultFreighter, REF_APO, SCALE_H, CORRIDOR_APO } from "../aerobrake.js";

var GM = systems.get("Earth").GM, RE = +systems.get("Earth").radius;
var ship = Object.assign({ shield: "advanced" }, defaultFreighter());
function vpFor(vInf, h) { return Math.sqrt(vInf * vInf + 2 * GM / (RE + h)); }

test("the standard freighter brakes high and gently, and its shield is enough", function () {
	var n = brakingNeeds(ship, vpFor(4000, 70e3), 70e3);
	// Arriving with its tanks 20% full: 4,000 + 2,960 + 50,000 + 0.2 × 20,000 = 60,960 t.
	assert.ok(Math.abs(n.beta - 60960e3 / (1.5 * Math.PI * 400 * 400 / 4)) < 1e-6, "beta " + n.beta);
	assert.ok(brakingNeeds(ship, vpFor(4000, 70e3), 70e3, null, 1).beta > n.beta, "fuller tanks, heavier ship, higher beta");
	assert.ok(n.hBrake > 55e3 && n.hBrake < 80e3, "braking altitude " + n.hBrake);
	assert.ok(n.shed > 500 && n.shed < 1500, "shed " + n.shed);
	assert.ok(n.gPeak < 3, "peak g " + n.gPeak);
	assert.ok(n.shieldNeeded < n.shieldCarried, n.shieldNeeded + " t needed of " + n.shieldCarried);
});

test("a pass at the reference height leaves for the reference apoapsis, within the corridor", function () {
	var vp = vpFor(4000, 70e3), n = brakingNeeds(ship, vp, 70e3);
	var p = passAt(n, n.hBrake, vpFor(4000, n.hBrake));
	assert.equal(p.inCorridor, true);
	assert.ok(Math.abs(p.rApo - REF_APO) / REF_APO < 0.01, "apoapsis " + p.rApo);
	assert.ok(p.corridor[0] < n.hBrake && n.hBrake < p.corridor[1]);
	// The corridor's edges leave for its two apoapses.
	var lo = passAt(n, p.corridor[0], vpFor(4000, p.corridor[0])), hi = passAt(n, p.corridor[1], vpFor(4000, p.corridor[1]));
	assert.ok(Math.abs(lo.rApo - CORRIDOR_APO[0]) / CORRIDOR_APO[0] < 0.02, "low edge " + lo.rApo);
	assert.ok(Math.abs(hi.rApo - CORRIDOR_APO[1]) / CORRIDOR_APO[1] < 0.02, "high edge " + hi.rApo);
	assert.ok(p.corridor[1] - p.corridor[0] < 1000, "a narrow band: " + (p.corridor[1] - p.corridor[0]) + " m");
});

test("higher sheds less, deeper sheds more, and too deep falls", function () {
	var n = brakingNeeds(ship, vpFor(4000, 70e3), 70e3);
	var hi = passAt(n, n.hBrake + 2e3, vpFor(4000, n.hBrake + 2e3));
	assert.ok(Math.abs(hi.shed / n.shed - Math.exp(-2e3 / SCALE_H)) < 1e-12);
	assert.equal(hi.inCorridor, false);
	assert.ok(hi.rApo === null, "skips out unbound");
	var deep = passAt(n, n.hBrake - 20e3, vpFor(4000, n.hBrake - 20e3));
	assert.equal(deep.falls, true);
	assert.ok(deep.gPeak > n.gPeak * 10);
});

// ---- the arrival flown through its pass ----------------------------------------

import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { facilityFigures, CLOCK_EPOCH } from "../facilities.js";
import { computeFlight, arrivalPass, TRIM_MAX } from "../flight.js";
import { solveEntryTrim, APO_TOLERANCE } from "../entry-trim.js";
import { AIM_APO } from "../aerobrake.js";
import { SOI_EARTH } from "../offworld.js";

var JD = CLOCK_EPOCH + 6000.3;
function inboundState(vInf, h, tilt) {
	var rp = RE + h, vp = Math.sqrt(vInf * vInf + 2 * GM / rp), c = Math.cos(tilt || 0), s = Math.sin(tilt || 0);
	var lo = 0, hi = 30 * 86400;
	for (var i = 0; i < 80; i++) {
		var mid = (lo + hi) / 2;
		if (O.vMag(O.propagateState(GM, [rp, 0, 0], [0, vp * c, vp * s], -mid).r) < SOI_EARTH * 0.999) { lo = mid; } else { hi = mid; }
	}
	return O.propagateState(GM, [rp, 0, 0], [0, vp * c, vp * s], -lo);
}
// The same, with its pass as flown (Earth + Moon + Sun) at height h.
function inboundFlown(vInf, h, tilt) {
	var hc = h, st;
	for (var i = 0; i < 4; i++) {
		st = inboundState(vInf, hc, tilt);
		var p = arrivalPass(facilityFigures("offworld", { r: st.r, v: st.v, jd: JD }), JD, null, []);
		hc += h - p.alt;
	}
	return st;
}
function arrivalParams(st, extra) { return { offworld: Object.assign({ r: st.r, v: st.v, jd: JD }, extra || {}) }; }

test("Aim sets a small trim that leaves the ship on a loop out to its apogee as flown", function () {
	var st = inboundState(4000, 400e3, 0.5);
	var fig = facilityFigures("offworld", arrivalParams(st).offworld);
	var s = solveEntryTrim(fig, JD, []);
	assert.equal(s.ok, true, s.reason);
	var size = Math.hypot(s.trim.pro, s.trim.rad, s.trim.nrm);
	assert.ok(size > 0.5 && size < 10, "trim " + size);
	assert.ok(Math.abs(s.alt - s.target) < 500, "within a few hundred metres of the two-body height: " + (s.alt - s.target));
	var f = computeFlight({ from: "offworld", jd: JD, params: arrivalParams(st, { trim: s.trim }) });
	assert.equal(f.ok, true);
	assert.ok(f.aerobrake && f.aerobrake.inCorridor, "in the corridor");
	var lp = f.aerobrake.loop;
	assert.ok(Math.abs(lp.apo - AIM_APO) <= APO_TOLERANCE * AIM_APO, "apogee as flown " + lp.apo);
	assert.ok(Math.abs(lp.apo - s.apo) < 1, "Aim reports the loop the flight flies");
	assert.ok(lp.peri !== null && lp.peri > RE, "the loop comes back to a perigee above the ground");
	assert.equal(f.summary.primary, "Earth", "bound to Earth after the pass");
});

test("a pass well below the corridor falls into the air; one far above it goes on by", function () {
	var low = computeFlight({ from: "offworld", jd: JD, params: arrivalParams(inboundFlown(4000, 30e3)) });
	assert.equal(low.summary.falls, true);
	var high = computeFlight({ from: "offworld", jd: JD, params: arrivalParams(inboundFlown(4000, 500e3)) });
	assert.equal(high.aerobrake, null);
	assert.equal(high.summary.primary, "Sun");
});

test("Aim refuses a trim bigger than the limit", function () {
	var fig = facilityFigures("offworld", arrivalParams(inboundState(4000, 20000e3)).offworld);
	var s = solveEntryTrim(fig, JD, []);
	assert.equal(s.ok, false);
	assert.match(s.reason, /more than the 50 m\/s allowed/);
	assert.equal(TRIM_MAX, 50);
});
