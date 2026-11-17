// Node tests for core/ballast.js, core/hanging-skyhook.js and core/clearance.js.
// Run from the repo root:
//   node --test Website/Calculators/Mars-System-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { settle, ballastResponse, planSidestep, sidestepState } from "../ballast.js";
import { hangingFigures, resonantComAlt, resonanceGap, hangingAt, hangingPointState, timingAt, MIN_TILT }
	from "../hanging-skyhook.js";
import { tetherDistance, closestPass, firstClosePass, bestStartAngle, workOutSidesteps, timingGuidance, slantFactor }
	from "../clearance.js";
import { RATIOS } from "../hanging-skyhook.js";
import { moonSkyhookFigures, allFigures, releaseState, GM_MARS, R_MARS } from "../facilities.js";
import { computeFlight } from "../flight.js";
import { CLOCK_EPOCH } from "../clock.js";
import { MarsEphemeris as ME } from "../../../../Shared/mars-ephemeris.js";
import { OrbitalMath as O } from "../../../../Shared/math-utils.js";

var DAY = 86400, DEG = 180 / Math.PI, JD = CLOCK_EPOCH + 81.3, LIMIT = 200e3;
var PHOBOS = moonSkyhookFigures("phobosSkyhook");
function near(x, want, tol, what) {
	assert.ok(Math.abs(x - want) <= tol, (what || "value") + " " + x + " is not within " + tol + " of " + want);
}
function hanging(params) { return hangingFigures(params, PHOBOS); }
function started(params) {
	var h = hanging(params);
	h.timing = { a0: bestStartAngle(h, PHOBOS, LIMIT), sidesteps: [] };
	return h;
}

test("a lone mass settles on its circular orbit, and keeps its angular momentum when asked to", function () {
	var r = R_MARS + 400e3, s = settle(GM_MARS, [{ r: r, m: 5 }], null);
	near(s.omega, Math.sqrt(GM_MARS / (r * r * r)), 1e-15);
	// Given the angular momentum of a higher orbit, it settles there.
	var up = settle(GM_MARS, [{ r: r, m: 5 }], 5 * Math.sqrt(GM_MARS * (r + 50e3)));
	near(up.shift, 50e3, 0.01, "shift (m)");
});

test("ballast moved away from the middle makes the skyhook lower and faster; the work is the pull it moves against", function () {
	var fixed = [{ r: R_MARS + 300e3, m: 8e9 }, { r: R_MARS + 2400e3, m: 1e8 }];
	var resp = ballastResponse(GM_MARS, fixed, 4e8, R_MARS + 300e3, R_MARS + 2400e3, 200);
	var n = resp.travel.length - 1;
	assert.equal(resp.rate[0], 0); assert.equal(resp.shift[0], 0);
	assert.ok(resp.rate[n] > 0.01 && resp.shift[n] < -30e3, "rate " + resp.rate[n] + ", shift " + resp.shift[n]);
	// The drive's work, summed step by step as force x distance: it pays while
	// the ballast is pulled toward Mars and is paid once the pull is outward.
	var home = settle(GM_MARS, fixed.concat([{ r: R_MARS + 300e3, m: 4e8 }]), null), sum = 0;
	for (var j = 1; j <= n; j++) {
		var rb = R_MARS + 300e3 + 0.5 * (resp.travel[j] + resp.travel[j - 1]), d = 0.5 * (resp.shift[j] + resp.shift[j - 1]);
		var w = home.omega * (1 + 0.5 * (resp.rate[j] + resp.rate[j - 1])), r = rb + d;
		sum -= 4e8 * (w * w * r - GM_MARS / (r * r)) * (resp.travel[j] - resp.travel[j - 1]);
	}
	near(resp.work[n] / sum, 1, 0.01, "work against force x distance");
});

test("a sidestep slips the angle asked for and leaves the orbit as it was", function () {
	var h = hanging(), lower = h.ballast.lower, plan = planSidestep(lower.up, h.omega, Math.PI / 2, h.ballast.speed);
	assert.ok(plan && plan.tHold > 0, "a quarter turn needs the whole travel and a wait");
	near(plan.duration, 2 * plan.tMove + plan.tHold, 1e-6);
	var end = sidestepState(plan, plan.duration + 1), mid = sidestepState(plan, plan.tMove + plan.tHold / 2);
	near(end.psi, Math.PI / 2, 1e-9); assert.equal(end.rate, 0); assert.equal(end.shift, 0);
	assert.ok(mid.rate > 0.01 && mid.shift < 0, "faster and lower while the ballast is out");
	// Passing the centre of mass on its way out and back, the ballast slows the
	// skyhook a little; the angle stays between where it began and where it ends.
	for (var k = 1; k <= 60; k++) {
		var s = sidestepState(plan, plan.duration * k / 60);
		assert.ok(s.psi > -0.01 && s.psi < Math.PI / 2 + 0.01, "angle " + s.psi + " at step " + k);
	}
	// The lower ballast rides at the foot, beside the centre of mass: it can speed the skyhook up but hardly slow it.
	assert.equal(planSidestep(lower.up, h.omega, -Math.PI / 2, h.ballast.speed), null);
	// The upper ballast rides at the top: brought down, it slows the skyhook and lifts it.
	var back = planSidestep(h.ballast.upper.down, h.omega, -Math.PI / 2, h.ballast.speed);
	assert.ok(back && back.rate < -0.004 && back.shift > 0, "upper ballast: rate " + (back && back.rate));
	near(sidestepState(back, back.duration + 1).psi, -Math.PI / 2, 1e-9);
	assert.equal(h.ballast.upper.up, null, "at the top it has nowhere higher to go");
	assert.equal(h.ballast.responses.length, 2);
	// The foot is not taken below the air's edge.
	assert.ok(h.footAlt + plan.shift >= h.floor - 1, "foot at " + (h.footAlt + plan.shift));
});

test("the default hanging skyhook: 1.9 h orbit, sun-synchronous at about 93 degrees", function () {
	var h = hanging();
	assert.ok(h.ok, h.diagnostic && h.diagnostic.message);
	near(h.period / 3600, 1.914, 0.005, "period (h)");
	near(h.tilt * DEG, 92.8, 0.6, "tilt (deg)");
	near(h.nodeRate * DAY * DEG, 360 / 686.98, 0.001, "node rate (deg/day)");
	near(h.vCom, Math.sqrt(GM_MARS / h.rCom), 1e-9);
	assert.ok(h.vFoot < Math.sqrt(GM_MARS / (R_MARS + h.footAlt)) && h.vTop > Math.sqrt(GM_MARS / (R_MARS + h.topAlt)));
	near(h.total / 1e9, 9.3, 0.4, "total mass (Mt)");
	near(h.share.lo, 220e3, 1); near(h.share.hi, 2400e3, 1);
});

test("the resonances with Phobos and their gaps", function () {
	assert.deepEqual(resonanceGap(4, 1), { D: 8, gap: Math.PI / 8 });
	assert.equal(resonanceGap(3, 1).D, 3); assert.equal(resonanceGap(2, 1).D, 4);
	assert.equal(resonanceGap(7, 2).D, 14); assert.equal(resonanceGap(7, 3).D, 7);
	var h = hanging(), four = h.resonances.filter(function (r) { return r.p === 4 && r.q === 1; })[0];
	near(four.comAlt, 331.6e3, 1e3); near(four.gap * DEG, 22.5, 1e-9);
	var three = h.resonances.filter(function (r) { return r.p === 3 && r.q === 1; })[0];
	near(three.comAlt, 1117e3, 3e3); near(three.gap * DEG, 60, 1e-9);
	// Set exactly on a resonance, the ratio is that resonance's.
	var alt = resonantComAlt({}, PHOBOS, 4);
	near(hanging({ comAlt: alt }).ratio, 4, 2e-7);
});

test("fields out of range, and tilts too near the equator while the tethers share altitudes", function () {
	assert.equal(hanging({ footAlt: 100e3 }).diagnostic.code, "foot-range");
	assert.equal(hanging({ comAlt: 3000e3 }).diagnostic.code, "com-range");
	assert.equal(hanging({ topAlt: 6000e3 }).diagnostic.code, "top-range");
	assert.equal(hanging({ relAlt: 100e3 }).diagnostic.code, "release-off-tether");
	assert.equal(hanging({ ballastHome: 3000e3 }).diagnostic.code, "ballast-home");
	assert.equal(hanging({ upperBallastHome: 300e3 }).diagnostic.code, "upper-ballast-home");
	assert.equal(hanging({ upperBallastMass: 80e6 }).diagnostic.code, "unbalanced");
	assert.equal(hanging({ anchorMass: 100e6 }).diagnostic.code, "unbalanced");
	[0, 10, 19, 161, 180].forEach(function (t) {
		assert.equal(hanging({ sunSync: false, tilt: t }).diagnostic.code, "tilt-low", "tilt " + t);
	});
	[MIN_TILT * DEG, 45, 90, 160].forEach(function (t) { assert.ok(hanging({ sunSync: false, tilt: t }).ok, "tilt " + t); });
	// With the Phobos tether's foot above this one's top there is nothing to keep clear of.
	var high = moonSkyhookFigures("phobosSkyhook", { footAlt: 3000e3, relAlt: 3000e3 });
	var h = hangingFigures({ sunSync: false, tilt: 0 }, high);
	assert.ok(h.ok && h.share === null);
});

test("every point of the tether moves as its position changes, and the plane keeps facing the Sun", function () {
	var h = hanging(), at = hangingAt(h, JD);
	[h.sFoot, 0, h.sTop].forEach(function (s) {
		var dt = 4, a = hangingPointState(hangingAt(h, JD - dt / DAY), s), b = hangingPointState(hangingAt(h, JD + dt / DAY), s);
		var fd = O.vScale(O.vSub(b.r, a.r), 1 / (2 * dt));
		near(O.vMag(O.vSub(fd, hangingPointState(at, s).v)), 0, 0.1, "velocity error (m/s)");
	});
	near(O.vMag(hangingPointState(at, h.sFoot).r) - R_MARS, h.footAlt, 1e-3);
	near(Math.acos(O.vDot(at.plane.normal, ME.pole)) * DEG, h.tilt * DEG, 1e-9);
	// Mars's orbit is eccentric, so the Sun runs up to 11 degrees ahead of or behind its mean place.
	[0, 150, 400, 687, 1500].forEach(function (d) {
		var jd = CLOCK_EPOCH + d, sun = O.vUnit(ME.sunVector(jd));
		var off = Math.acos(O.vDot(hangingAt(h, jd).plane.normal, sun)) * DEG;
		assert.ok(off < 30, "plane normal " + off + " deg from the Sun on day " + d);
	});
});

test("on the 4:1 resonance the tethers stay far apart with no sidestep", function () {
	var h = started({ comAlt: resonantComAlt({}, PHOBOS, 4) });
	var res = workOutSidesteps(h, PHOBOS, { limit: LIMIT, days: 400 });
	assert.equal(res.sidesteps.length, 0); assert.equal(res.unavoided.length, 0); assert.ok(res.complete);
	assert.ok(res.closest.distance > 1000e3, "closest pass " + res.closest.distance);
	assert.equal(timingGuidance(h, RATIOS, LIMIT).needs, null);
	// The distance at a pass is the distance between two stretches of lines through Mars's centre.
	var d = tetherDistance(h, PHOBOS, h.timing, JD);
	assert.ok(d > 0 && d < 16000e3);
});

test("off the resonance, sidesteps keep every pass clear, about as often as the guidance says", function () {
	var h = started({ comAlt: 344e3 }), g = timingGuidance(h, RATIOS, LIMIT);
	assert.equal(g.near.p, 4); assert.equal(g.needs, "faster");
	assert.ok(g.off < 0 && g.faster > 0.02 && g.slower > 0.004);
	assert.ok(firstClosePass(h, PHOBOS, h.timing, CLOCK_EPOCH, CLOCK_EPOCH + 60, LIMIT), "left alone, a pass comes too close");
	var res = workOutSidesteps(h, PHOBOS, { limit: LIMIT, days: 60 });
	assert.ok(res.complete && res.unavoided.length === 0 && res.sidesteps.length >= 5, "sidesteps " + res.sidesteps.length);
	assert.ok(res.closest.distance >= LIMIT, "closest pass " + res.closest.distance);
	var timing = { a0: res.a0, sidesteps: res.sidesteps };
	assert.equal(firstClosePass(h, PHOBOS, timing, CLOCK_EPOCH, CLOCK_EPOCH + 60, LIMIT), null);
	var gaps = [];
	for (var k = 1; k < res.sidesteps.length; k++) {
		assert.ok(res.sidesteps[k].jdStart >= res.sidesteps[k - 1].jdEnd, "sidesteps overlap");
		gaps.push(res.sidesteps[k].jdStart - res.sidesteps[k - 1].jdStart);
	}
	var mean = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
	near(mean / (g.interval / DAY), 1, 0.25, "interval against the guidance");
	// Between sidesteps the skyhook is on its design orbit; in one it is lower and faster.
	var s = res.sidesteps[1], during = timingAt(timing, s.jdStart + s.duration / 2 / DAY), after = timingAt(timing, s.jdEnd + 0.01);
	assert.ok(during.active && during.rate > 0 && during.shift < 0);
	assert.ok(!after.active && after.rate === 0 && after.shift === 0);
	near(after.psi, res.sidesteps[0].psi + s.psi, 1e-9);
});

test("a skyhook running fast with ballast that can only speed it up: the close passes are listed, not hidden", function () {
	var h = started({ comAlt: 331e3, upperBallastMass: 0 }), g = timingGuidance(h, RATIOS, LIMIT);
	assert.equal(g.needs, "slower"); assert.ok(g.slower < 0.001);
	var res = workOutSidesteps(h, PHOBOS, { limit: LIMIT, days: 300 });
	assert.ok(res.unavoided.length >= 1 && res.unavoided[0].passes > 1);
	assert.ok(res.unavoided[0].distance < LIMIT);
});

test("the same fast skyhook with upper ballast: bringing it down slows the skyhook, and every pass stays clear", function () {
	var h = started({ comAlt: 331e3 });
	var res = workOutSidesteps(h, PHOBOS, { limit: LIMIT, days: 300 });
	assert.equal(res.unavoided.length, 0);
	assert.ok(res.sidesteps.length >= 1 && res.closest.distance >= LIMIT);
	res.sidesteps.forEach(function (s) { assert.ok(s.resp.which === "upper" && s.psi < 0 && s.rate < 0); });
});

test("a slanting pass comes closer than it is at the crossing", function () {
	near(slantFactor(hanging()), 0.958, 0.005);
	assert.ok(slantFactor(hanging({ sunSync: false, tilt: 25 })) < 0.6);
	var h = started({ sunSync: false, tilt: 30 }), c = closestPass(h, PHOBOS, h.timing, CLOCK_EPOCH, CLOCK_EPOCH + 2, 5000e3);
	assert.ok(c.exact, "measured, not estimated");
	// No instant near that pass is closer than the pass found.
	for (var k = -40; k <= 40; k++) {
		assert.ok(tetherDistance(h, PHOBOS, h.timing, c.jd + k * 20 / DAY) >= c.distance - 1, "closer at step " + k);
	}
});

test("ships let go by the hanging skyhook: the foot falls, the centre of mass orbits, the top is thrown high", function () {
	function fly(relAlt) { return computeFlight({ from: "hangingSkyhook", jd: JD, params: { hangingSkyhook: { relAlt: relAlt } } }); }
	var h = hanging(), foot = fly(h.footAlt), com = fly(h.comAlt), top = fly(h.topAlt);
	assert.equal(foot.summary.outcome, "entry");
	assert.equal(com.summary.outcome, "orbit");
	near(com.summary.period, h.period, 60, "period at the centre of mass (s)");
	near(com.summary.tilt * DEG, h.tilt * DEG, 0.2);
	assert.ok(top.summary.outcome === "escape" || top.summary.apoAlt > 20000e3, "top: " + top.summary.outcome);
	near(releaseState(h, JD).altitude, h.relAlt, 1e-3);
	// Left out of the design, it has no figures and no flights.
	assert.equal(allFigures({ hangingSkyhook: null }).hangingSkyhook, undefined);
	assert.equal(computeFlight({ from: "hangingSkyhook", jd: JD, params: { hangingSkyhook: null } }).diagnostic.code, "no-facility");
});
