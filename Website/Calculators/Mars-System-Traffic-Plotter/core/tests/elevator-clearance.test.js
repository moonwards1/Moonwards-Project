// Node tests for the hanging skyhook's timing against the space elevator's
// tether (core/clearance.js, core/hanging-skyhook.js). Run from the repo root:
//   node --test Website/Calculators/Mars-System-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { allFigures } from "../facilities.js";
import { ELEVATOR_DEFAULTS } from "../elevator.js";
import { HANGING_DEFAULTS, DAY_RATIOS, resonantComAlt } from "../hanging-skyhook.js";
import { elevatorDistance, walkElevatorPasses, needsTiming, firstClosePass, closestPass, bestStartAngle,
         workOutSidesteps, elevatorGuidance } from "../clearance.js";
import { CLOCK_EPOCH } from "../clock.js";

var DAY = 86400, DEG = Math.PI / 180, LIMIT = 200e3;
function near(x, want, tol, what) {
	assert.ok(Math.abs(x - want) <= tol, (what || "value") + " " + x + " is not within " + tol + " of " + want);
}
// A design: the default elevator, the Phobos skyhook (null to leave it out),
// and a hanging skyhook, optionally put on a resonance first.
function design(phobos, hang, res) {
	var base = { spaceElevator: ELEVATOR_DEFAULTS, phobosSkyhook: phobos }, hp = Object.assign({}, HANGING_DEFAULTS, hang || {});
	var f = allFigures(base);
	if (res) { hp.comAlt = resonantComAlt(hp, f.phobosSkyhook || null, res.ratio, { elevator: f.spaceElevator, mars: res.mars }); }
	f = allFigures(Object.assign({}, base, { hangingSkyhook: hp }));
	var out = { h: f.hangingSkyhook, others: { phobos: f.phobosSkyhook || null, elevator: f.spaceElevator } };
	if (out.h.ok) { out.h.timing = { a0: bestStartAngle(out.h, out.others, LIMIT), sidesteps: [] }; }
	return out;
}
var PHOBOS_LOW = { topAlt: 6800e3 };

test("the hanging tether meets the elevator's unless its tilt keeps it nearer the equator", function () {
	var d = design(null), sh = d.h.shareElevator;
	near(sh.latLo / DEG, 3.9, 0.3, "least latitude of the elevator's tether at these heights");
	near(sh.latHi / DEG, 13.2, 0.3, "greatest latitude");
	assert.ok(needsTiming(d.h, d.others));
	var flat = design(null, { sunSync: false, tilt: 0.5 });
	assert.ok(flat.h.ok); assert.equal(flat.h.shareElevator, null); assert.ok(!needsTiming(flat.h, flat.others));
	assert.equal(design(null, { sunSync: false, tilt: 15 }).h.diagnostic.code, "tilt-elevator");
	assert.ok(design(null, { sunSync: false, tilt: 30 }).h.ok);
	// With no elevator in the design there is nothing to share.
	assert.equal(allFigures({ hangingSkyhook: HANGING_DEFAULTS }).hangingSkyhook.shareElevator, null);
});

test("the passes found are the close approaches a plain search of every few seconds finds", function () {
	var d = design(null), h = d.h, e = d.others.elevator, days = 16;
	// Every dip of the distance under the limit, searched 6 s at a time.
	var dips = [], prev = Infinity, falling = false, step = 6 / DAY;
	for (var jd = CLOCK_EPOCH; jd < CLOCK_EPOCH + days; jd += step) {
		var dist = elevatorDistance(h, e, h.timing, jd);
		if (dist > prev && falling && prev < LIMIT) { dips.push({ jd: jd - step, distance: prev }); }
		falling = dist < prev; prev = dist;
	}
	var close = [];
	walkElevatorPasses(h, e, h.timing, CLOCK_EPOCH, CLOCK_EPOCH + days, LIMIT, function (p) { if (p.distance < LIMIT) { close.push(p); } });
	assert.ok(dips.length >= 2, dips.length + " dips in " + days + " days");
	assert.equal(close.length, dips.length, "close passes found");
	dips.forEach(function (dip, i) {
		near(close[i].jd, dip.jd, 30 / DAY, "when");
		near(close[i].distance, dip.distance, 3e3, "how near (m)");
		assert.equal(close[i].against, "elevator");
	});
});

test("in step with Mars's day, a skyhook that starts clear of the elevator stays clear", function () {
	var d = design(null, {}, { ratio: 13, mars: true }), h = d.h;
	near(h.dayRatio, 13, 2e-5, "orbits a Mars day"); near(h.comAlt, 309e3, 2e3, "centre of mass (m)");
	var g = elevatorGuidance(h, d.others.elevator, DAY_RATIOS, LIMIT);
	assert.ok(g.held); assert.equal(g.near.p, 13);
	var res = workOutSidesteps(h, d.others, { limit: LIMIT, days: 300 });
	assert.equal(res.sidesteps.length, 0); assert.equal(res.unavoided.length, 0);
	assert.ok(res.closest.distance > 500e3, "closest pass in 300 days: " + res.closest.distance);
	// So does one whose Phobos skyhook hangs no lower than its own top.
	var high = design({ footAlt: 2700e3, relAlt: 2700e3, topAlt: 6800e3 }, {}, { ratio: 13, mars: true });
	assert.equal(high.h.share, null);
	assert.equal(workOutSidesteps(high.h, high.others, { limit: LIMIT, days: 200 }).sidesteps.length, 0);
});

test("out of step, about a quarter of the elevator's passes come too near, and sidesteps put them off", function () {
	var d = design(null), h = d.h, g = elevatorGuidance(h, d.others.elevator, DAY_RATIOS, LIMIT);
	assert.ok(!g.held); assert.equal(g.near.p, 13);
	assert.ok(g.chance > 0.15 && g.chance < 0.35, "chance of a close pass: " + g.chance);
	near(g.creep / DEG, 360 * (h.dayRatio - 13), 1e-9);
	var n = 0, close = 0;
	walkElevatorPasses(h, d.others.elevator, h.timing, CLOCK_EPOCH, CLOCK_EPOCH + 200, LIMIT, function (p) { n++; if (p.distance < LIMIT) { close++; } });
	near(n, 2 * 200 / 1.0275, 4, "passes in 200 days: two a Mars day");
	near(close / n, g.chance, 0.08, "share of them too near");
	// With a narrower clearance the ballast keeps up with both tethers.
	var all = design(PHOBOS_LOW, {}, { ratio: 4 }), lim = 50e3;
	all.h.timing = { a0: bestStartAngle(all.h, all.others, lim), sidesteps: [] };
	assert.ok(firstClosePass(all.h, all.others, all.h.timing, CLOCK_EPOCH, CLOCK_EPOCH + 120, lim), "left alone, a pass comes too close");
	var res = workOutSidesteps(all.h, all.others, { limit: lim, days: 120 });
	assert.ok(res.sidesteps.length >= 3 && res.unavoided.length === 0, res.sidesteps.length + " sidesteps, " + res.unavoided.length + " unavoided");
	assert.ok(res.sidesteps.every(function (s) { return s.avoids.against === "elevator"; }), "on 4:1 with Phobos, only the elevator needs them");
	var timing = { a0: res.a0, sidesteps: res.sidesteps };
	assert.equal(firstClosePass(all.h, all.others, timing, CLOCK_EPOCH, CLOCK_EPOCH + 120, lim), null);
	assert.ok(closestPass(all.h, all.others, timing, CLOCK_EPOCH, CLOCK_EPOCH + 120, lim).distance >= lim);
});

test("the working stops when its time runs out, and says how far it got", function () {
	var d = design(PHOBOS_LOW, {}, { ratio: 4 });
	var res = workOutSidesteps(d.h, d.others, { limit: LIMIT, budgetMs: 1 });
	assert.equal(res.complete, false); assert.equal(res.stopped, "time");
	assert.ok(res.jdReached < CLOCK_EPOCH + 400);
});
