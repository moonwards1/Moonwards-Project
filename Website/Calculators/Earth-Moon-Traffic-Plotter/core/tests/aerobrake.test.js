// Node tests for the aerobrake pass (core/aerobrake.js). Run from the repo root:
//   node --test Website/Calculators/Earth-Moon-Traffic-Plotter/core/tests/aerobrake.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { systems } from "../../../../Shared/orbit.js";
import { brakingNeeds, passAt, defaultFreighter, EXIT_APO_DEFAULT, SCALE_H, CORRIDOR_HALF } from "../aerobrake.js";

var GM = systems.get("Earth").GM, RE = +systems.get("Earth").radius;
var ship = Object.assign({ shield: "advanced" }, defaultFreighter());
function vpFor(vInf, h) { return Math.sqrt(vInf * vInf + 2 * GM / (RE + h)); }

test("the standard freighter brakes high and gently, and its shield is enough", function () {
	var n = brakingNeeds(ship, vpFor(4000, 70e3), EXIT_APO_DEFAULT);
	assert.ok(Math.abs(n.beta - 408) < 1, "beta " + n.beta);
	assert.ok(n.hBrake > 55e3 && n.hBrake < 80e3, "braking altitude " + n.hBrake);
	assert.ok(n.shed > 500 && n.shed < 1500, "shed " + n.shed);
	assert.ok(n.gPeak < 3, "peak g " + n.gPeak);
	assert.ok(n.shieldNeeded < n.shieldCarried, n.shieldNeeded + " t needed of " + n.shieldCarried);
});

test("a pass at the braking altitude leaves for the chosen apoapsis", function () {
	var vp = vpFor(4000, 70e3), n = brakingNeeds(ship, vp, EXIT_APO_DEFAULT);
	var p = passAt(n, n.hBrake, vpFor(4000, n.hBrake));
	assert.equal(p.inCorridor, true);
	assert.ok(Math.abs(p.rApo - EXIT_APO_DEFAULT) / EXIT_APO_DEFAULT < 0.01, "apoapsis " + p.rApo);
});

test("higher sheds less, deeper sheds more, and too deep falls", function () {
	var n = brakingNeeds(ship, vpFor(4000, 70e3), EXIT_APO_DEFAULT);
	var edge = passAt(n, n.hBrake + 2e3, vpFor(4000, n.hBrake + 2e3));
	assert.equal(edge.inCorridor, true);
	assert.ok(Math.abs(edge.rApo - EXIT_APO_DEFAULT) / EXIT_APO_DEFAULT < 1e-9, "lift holds the exit across the corridor");
	var hi = passAt(n, n.hBrake + 4e3, vpFor(4000, n.hBrake + 4e3));
	assert.equal(hi.inCorridor, false);
	assert.ok(hi.rApo === null, "skips out unbound");
	var deep = passAt(n, n.hBrake - 20e3, vpFor(4000, n.hBrake - 20e3));
	assert.equal(deep.falls, true);
	assert.ok(deep.gPeak > n.gPeak * 10);
	assert.equal(CORRIDOR_HALF, 2e3);
});

// ---- the arrival flown through its pass ----------------------------------------

import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { facilityFigures, CLOCK_EPOCH } from "../facilities.js";
import { computeFlight, arrivalPass, TRIM_MAX } from "../flight.js";
import { solveEntryTrim } from "../entry-trim.js";
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

test("Aim brings the pass to the braking altitude with a small trim, and the ship leaves on its long orbit", function () {
	var st = inboundState(4000, 400e3, 0.5);
	var fig = facilityFigures("offworld", arrivalParams(st).offworld);
	var s = solveEntryTrim(fig, JD, []);
	assert.equal(s.ok, true, s.reason);
	var size = Math.hypot(s.trim.pro, s.trim.rad, s.trim.nrm);
	assert.ok(size > 0.5 && size < 10, "trim " + size);
	assert.ok(Math.abs(s.alt - s.target) < 100);
	var f = computeFlight({ from: "offworld", jd: JD, params: arrivalParams(st, { trim: s.trim }) });
	assert.equal(f.ok, true);
	assert.ok(f.aerobrake && f.aerobrake.pass.inCorridor, "in the corridor");
	assert.ok(Math.abs(f.aerobrake.pass.rApo - f.aerobrake.exitApo) / f.aerobrake.exitApo < 0.02);
	assert.equal(f.summary.primary, "Earth", "bound to Earth after the pass");
	assert.ok(f.summary.apoAlt > 500e6, "a long orbit: apogee " + f.summary.apoAlt);
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
