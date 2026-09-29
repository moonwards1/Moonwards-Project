// node --test MissionPlanner/core/tests/lunar-departure.test.js
//
// The departure from a Moon origin. What is being pinned down here:
//
//   - the round trip. A card in, a ship velocity at the Moon out, and that
//     velocity escapes along exactly the card that produced it. Everything
//     else rests on this inversion being right.
//   - the null control. Stop the Moon dead and the residual must vanish: the
//     total is then the card and nothing else. A decomposition that cannot
//     pass this is measuring its own arithmetic.
//   - the residual is not the Moon's speed. It is what that speed is WORTH
//     out at Earth's SOI, which is a different and usually larger number.
//   - the supported region is enforced, not assumed.
//   - the Earth-pass pipeline: the asteroid backtrace inverts a coast exactly,
//     a pass leaves along its card's direction on a release its card's length
//     fixes, and it lands on Earth's SOI when it says it does.

import test from "node:test";
import assert from "node:assert";

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { SOI_EARTH, moonGeoPos, moonGeoVel } from "../../../Shared/geo-leg.js";
import { flyLunarDeparture, cardVInf, cardFromVector, vInfFromState, solveShipVelocity,
         solveLunarCard, hyperbolicCoastTime, releaseSpeedFor, RELEASE_ALTITUDE,
         passiveReleaseFor, flyEarthPassDeparture, MIN_PERIGEE,
         releaseForHandoff, solveLunarCardAtHandoff }
	from "../lunar-departure.js";
import { edgeVInf } from "../departure-estimate.js";

var O = OrbitalMath;
var GM_EARTH = systems.get("Earth").GM;
var JD = 2462502.5;                 // 2030-01-01, the tab's own opening date
var LUNAR_MONTH = 27.321661;

function angleBetween(a, b) {
	return Math.acos(Math.max(-1, Math.min(1, O.vDot(O.vUnit(a), O.vUnit(b))))) * 180 / Math.PI;
}

// ---------------------------------------------------------------------------
// vInfFromState — the forward step, against cases with known answers
// ---------------------------------------------------------------------------

test("a bound state has no v-infinity", function () {
	var r = [384400e3, 0, 0];
	var vCirc = Math.sqrt(GM_EARTH / 384400e3);
	assert.equal(vInfFromState(r, [0, vCirc, 0]), null);
});

test("escape speed is the boundary", function () {
	var r = [384400e3, 0, 0], vEsc = Math.sqrt(2 * GM_EARTH / 384400e3);
	assert.equal(vInfFromState(r, [0, vEsc * 0.999, 0]), null);   // just short: bound
	var out = vInfFromState(r, [0, vEsc * 1.001, 0]);
	assert.ok(out.mag > 0 && out.mag < 100);                     // just over: barely out
});

test("vis-viva sets the magnitude", function () {
	var r = [384400e3, 0, 0], v = [0, 2500, 0];
	var out = vInfFromState(r, v);
	var expect = Math.sqrt(2500 * 2500 - 2 * GM_EARTH / 384400e3);
	assert.ok(Math.abs(out.mag - expect) < 1e-6);
});

test("a radial escape never turns", function () {
	var out = vInfFromState([384400e3, 0, 0], [2000, 0, 0]);
	assert.ok(angleBetween(out.vec, [1, 0, 0]) < 1e-9);
});

test("a tangential release puts periapsis at the release point", function () {
	var out = vInfFromState([384400e3, 0, 0], [0, 2000, 0]);
	assert.ok(Math.abs(out.rp - 384400e3) / 384400e3 < 1e-9);
});

// ---------------------------------------------------------------------------
// solveShipVelocity — the inversion, which everything downstream rests on
// ---------------------------------------------------------------------------

test("the inversion round-trips: solved velocity escapes along the card", function () {
	var rMoon = [384400e3, 0, 0];
	var cards = [[0, 3000, 0], [1000, 3000, 0], [2000, 2000, 0],
	             [500, 4000, 300], [3000, 1000, -800], [200, 1500, 0]];
	cards.forEach(function (w) {
		var s = solveShipVelocity(rMoon, w);
		assert.ok(s.ok, "should solve " + w);
		var back = vInfFromState(rMoon, s.u);
		assert.ok(angleBetween(back.vec, w) < 1e-4,
			"direction for " + w + " off by " + angleBetween(back.vec, w) + " deg");
		assert.ok(Math.abs(back.mag - O.vMag(w)) / O.vMag(w) < 1e-9,
			"magnitude for " + w);
	});
});

test("vis-viva alone fixes the solved speed", function () {
	var rMoon = [384400e3, 0, 0], w = [0, 3000, 0];
	var s = solveShipVelocity(rMoon, w);
	var expect = Math.sqrt(3000 * 3000 + 2 * GM_EARTH / 384400e3);
	assert.ok(Math.abs(O.vMag(s.u) - expect) < 1e-6);
});

test("a card aimed back at Earth is refused, not fudged", function () {
	var rMoon = [384400e3, 0, 0];
	assert.equal(solveShipVelocity(rMoon, [-3000, 0, 0]).reason, "card-toward-Earth");
	assert.equal(solveShipVelocity(rMoon, [0, 0, 0]).reason, "no-card");
});

test("a card past what an outward release can reach is refused by name", function () {
	// Straight back along the Moon's radius but tilted just off it: reachable
	// only by a trajectory that swings past Earth, which this file excludes.
	var s = solveShipVelocity([384400e3, 0, 0], [-3000, 30, 0]);
	assert.equal(s.ok, false);
	assert.equal(s.reason, "card-needs-earth-pass");
});

// ---------------------------------------------------------------------------
// THE NULL CONTROL — the test the whole decomposition stands on
// ---------------------------------------------------------------------------

test("null control: a stationary Moon contributes exactly nothing", function () {
	var rMoon = [384400e3, 0, 0];
	[[0, 2000, 0], [0, 3000, 0], [2000, 2000, 0], [800, 4000, 500]].forEach(function (w) {
		var s = solveShipVelocity(rMoon, w);
		// the Moon's velocity replaced by zero — the ship's own contribution alone
		var total = vInfFromState(rMoon, O.vAdd([0, 0, 0], s.u));
		var residual = O.vSub(total.vec, w);
		assert.ok(O.vMag(residual) < 1e-6,
			"residual for " + w + " should vanish, got " + O.vMag(residual));
	});
});

test("null control: doubling the Moon's speed grows the residual", function () {
	var rMoon = [384400e3, 0, 0], w = [0, 3000, 0];
	var s = solveShipVelocity(rMoon, w);
	var vM = [0, 1022, 0];
	var mags = [0, 0.5, 1, 2].map(function (k) {
		var total = vInfFromState(rMoon, O.vAdd(O.vScale(vM, k), s.u));
		return O.vMag(O.vSub(total.vec, w));
	});
	assert.ok(mags[0] < 1e-6);
	assert.ok(mags[1] < mags[2] && mags[2] < mags[3]);
});

// ---------------------------------------------------------------------------
// The residual — the quantity the feature exists to show
// ---------------------------------------------------------------------------

test("the residual is close to the Moon's speed but never equal to it", function () {
	// What the Moon's motion is WORTH at Earth's SOI is not what the Moon
	// handed over. Deep in the well it can buy more than face value; carried
	// across the departure rather than along it, less. Both happen.
	var above = 0, below = 0, worst = 0;
	for (var d = 0; d < 60; d += 3) {
		[2000, 3000, 4000].forEach(function (pro) {
			var f = flyLunarDeparture({ jd: JD + d, card: { pro: pro, rad: 0, nrm: 0 } });
			if (!f.ok) { return; }
			var ratio = f.residual.mag / O.vMag(moonGeoVel(JD + d));
			if (ratio > 1) { above++; } else { below++; }
			worst = Math.max(worst, Math.abs(ratio - 1));
		});
	}
	assert.ok(above > 0 && below > 0, "should land on both sides of face value");
	assert.ok(worst > 0.05, "residual should differ from face value by more than rounding");
});

test("the total is the card plus the residual, by construction", function () {
	// All three as hyperbolic excesses — the card converted from the edge
	// speed it states (cardAsym), since edge speeds do not add.
	var f = flyLunarDeparture({ jd: JD, card: { pro: 2500, rad: 300, nrm: -200 } });
	assert.ok(f.ok, f.reason);
	var sum = O.vAdd(f.cardAsym, f.residual.vec);
	assert.ok(O.vMag(O.vSub(sum, f.vInf.vec)) < 1e-6);
});

test("the card states the SOI-edge speed, not the excess behind it", function () {
	// Earth still holds 928.5 m/s at its SOI edge, so a card typed as 3000
	// is worth less than 3000 once the ship is clear (Notes/decisions.md).
	var f = flyLunarDeparture({ jd: JD, card: { pro: 3000, rad: 0, nrm: 0 } });
	assert.ok(f.ok, f.reason);
	assert.ok(Math.abs(O.vMag(f.cardVec) - 3000) < 1e-6, "card keeps what was typed");
	assert.ok(Math.abs(O.vMag(f.cardAsym) - 2852.7) < 0.5,
		"excess behind it was " + O.vMag(f.cardAsym));
});

test("a card that does not escape Earth on its own is refused by name", function () {
	// The decomposition states the ship's share as an escape in its own
	// right; below the SOI edge's 928.5 m/s there is no such trajectory to
	// invert, whatever the Moon might add on top.
	var f = flyLunarDeparture({ jd: JD, card: { pro: 800, rad: 0, nrm: 0 } });
	assert.equal(f.ok, false);
	assert.equal(f.reason, "card-below-escape");
});

test("an unchanged card buys a different departure on a different date", function () {
	// This is the whole point of letting the Moon reach the hand-off: same
	// card, same ship, different day of the lunar month, different trajectory.
	var totals = [];
	for (var k = 0; k < 16; k++) {
		var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 16,
		                            card: { pro: 3000, rad: 0, nrm: 0 } });
		if (f.ok) { totals.push(f.vInf.mag); }
	}
	assert.ok(totals.length >= 4, "some phases must be supported, got " + totals.length);
	var spread = Math.max.apply(null, totals) - Math.min.apply(null, totals);
	assert.ok(spread > 500, "phase spread only " + spread + " m/s");
});

test("the card is what the ship pays, and never contains the Moon", function () {
	// The card's own length is fixed by what the user typed and does not move
	// with the Moon; only the TOTAL does.
	var lens = [], totals = [];
	for (var k = 0; k < 16; k++) {
		var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 16,
		                            card: { pro: 3000, rad: 0, nrm: 0 } });
		if (f.ok) { lens.push(O.vMag(f.cardVec)); totals.push(f.vInf.mag); }
	}
	assert.ok(lens.length >= 4);
	lens.forEach(function (l) { assert.ok(Math.abs(l - 3000) < 1e-6); });
	assert.ok(Math.max.apply(null, totals) - Math.min.apply(null, totals) > 500);
});

test("the whole lunar month flies: the outward pipeline, then the Earth-pass one", function () {
	// A card fixed on Earth's heliocentric axes points the same way all month
	// while the Moon goes round it. When the Moon is on the far side the
	// outward pipeline cannot deliver that card, and the Earth-pass pipeline
	// takes it instead — so every phase flies, by one route or the other.
	var routes = { outward: 0, "earth-pass": 0 };
	for (var k = 0; k < 32; k++) {
		var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 32,
		                            card: { pro: 3000, rad: 0, nrm: 0 } });
		assert.ok(f.ok, "day " + k + ": " + f.reason);
		routes[f.route]++;
	}
	assert.ok(routes.outward > 0 && routes["earth-pass"] > 0, JSON.stringify(routes));
});

// ---------------------------------------------------------------------------
// The supported region is enforced
// ---------------------------------------------------------------------------

test("supported departures head outward at the Moon", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 3000, rad: 0, nrm: 0 } });
	assert.ok(f.ok, f.reason);
	var vTotal = O.vAdd(f.vMoon, f.u);
	assert.ok(O.vDot(f.rMoon, vTotal) > 0);
});

test("no card is a named refusal, not a throw or a zero", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 0, rad: 0, nrm: 0 } });
	assert.equal(f.ok, false);
	assert.equal(f.reason, "no-card");
});

test("every refusal carries a reason a caller can show", function () {
	var known = ["no-card", "card-below-escape", "card-toward-Earth",
	             "card-needs-earth-pass", "heads-into-Earth", "no-escape",
	             "no-pass-route", "pass-hits-Earth"];
	[{ pro: 0, rad: 0, nrm: 0 }, { pro: -4000, rad: 0, nrm: 0 },
	 { pro: 10, rad: 0, nrm: 0 }].forEach(function (card) {
		var f = flyLunarDeparture({ jd: JD, card: card });
		if (!f.ok) { assert.ok(known.indexOf(f.reason) >= 0, "unknown reason " + f.reason); }
	});
});

// ---------------------------------------------------------------------------
// The reported numbers
// ---------------------------------------------------------------------------

test("the coast out to Earth's SOI is days, not hours or months", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 3000, rad: 0, nrm: 0 } });
	assert.ok(f.ok, f.reason);
	assert.ok(f.coastDays > 0.5 && f.coastDays < 20,
		"coast of " + f.coastDays + " days is not plausible");
});

test("a slower departure takes longer to reach Earth's SOI", function () {
	var slow = flyLunarDeparture({ jd: JD, card: { pro: 2000, rad: 0, nrm: 0 } });
	var fast = flyLunarDeparture({ jd: JD, card: { pro: 5000, rad: 0, nrm: 0 } });
	assert.ok(slow.ok && fast.ok, (slow.reason || "") + " " + (fast.reason || ""));
	assert.ok(slow.coastDays > fast.coastDays);
});

test("hyperbolic coast time matches a straight radial estimate", function () {
	// A fast RADIAL departure runs straight out, so the closed form must land
	// near distance over average speed. (A tangential one covers more ground
	// than the radial gap and legitimately takes longer, so it is no control.)
	var r1 = 384400e3, vInf = 8000;
	var v = Math.sqrt(vInf * vInf + 2 * GM_EARTH / r1);
	var out = vInfFromState([r1, 0, 0], [v * 0.9999, v * 0.014, 0]);   // near-radial
	var t = hyperbolicCoastTime(out.mag, out.e, r1, SOI_EARTH);
	var crude = (SOI_EARTH - r1) / ((v + out.mag) / 2);
	assert.ok(Math.abs(t - crude) / crude < 0.05,
		"closed form " + t + " s vs crude " + crude + " s");
});

test("the release speed adds the Moon's own well on top of the excess", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 3000, rad: 0, nrm: 0 } });
	assert.ok(f.ok, f.reason);
	// Climbing out of the Moon costs something, so the release is always faster
	// than the excess it is left with.
	assert.ok(f.releaseSpeed > f.uMag);
	var r = Number(systems.get("Moon").radius) + RELEASE_ALTITUDE;
	assert.ok(Math.abs(f.releaseSpeed - releaseSpeedFor(f.uMag, r)) < 1e-9);
});

test("the card vector is built on Earth's axes, so its length is the card's", function () {
	var w = cardVInf(JD, { pro: 3000, rad: 400, nrm: -200 });
	assert.ok(Math.abs(O.vMag(w) - Math.hypot(3000, 400, 200)) < 1e-6);
});

test("the ship's velocity at the Moon exceeds Earth escape speed there", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 2000, rad: 0, nrm: 0 } });
	assert.ok(f.ok, f.reason);
	var vEsc = Math.sqrt(2 * GM_EARTH / O.vMag(moonGeoPos(JD)));
	assert.ok(f.uMag > vEsc, "ship alone must be able to escape to state a v-infinity");
});

// ---------------------------------------------------------------------------
// solveLunarCard — the inversion Target mode needs: a wanted TOTAL v∞ back
// into the card that delivers it
// ---------------------------------------------------------------------------

// Every card that flies on a given date, so a sweep tests what is actually
// supported rather than skipping quietly.
function flyable(jd, cards) {
	return cards.map(function (c) { return { card: c, f: flyLunarDeparture({ jd: jd, card: c }) }; })
		.filter(function (x) { return x.f.ok; });
}

test("a solved card flies to exactly the v-infinity it was asked for", function () {
	var cards = [{ pro: 2500, rad: 0, nrm: 0 }, { pro: 1500, rad: 400, nrm: 200 },
	             { pro: 3400, rad: -600, nrm: 500 }, { pro: 1100, rad: 0, nrm: -300 }];
	var tried = 0, solved = 0;
	for (var d = 0; d < LUNAR_MONTH; d += 1) {
		var jd = JD + d;
		flyable(jd, cards).forEach(function (x) {
			tried++;
			// The seed is deliberately off the answer — a scrubbed card, not the
			// one that produced the target.
			var seed = { pro: x.card.pro * 0.8, rad: x.card.rad + 100, nrm: x.card.nrm - 50 };
			var s = solveLunarCard({ jd: jd, vInfVec: x.f.vInf.vec, seedCard: seed });
			if (!s.ok) { return; }
			solved++;
			var check = flyLunarDeparture({ jd: jd, card: s.card });
			assert.ok(check.ok, "a solved card must fly: " + check.reason);
			assert.ok(O.vMag(O.vSub(check.vInf.vec, x.f.vInf.vec)) < 1,
				"solved card lands " + O.vMag(O.vSub(check.vInf.vec, x.f.vInf.vec)) + " m/s off");
		});
	}
	assert.ok(tried > 40, "the sweep must actually reach supported dates, got " + tried);
	assert.ok(solved / tried > 0.9, "solved only " + solved + " of " + tried);
});

test("the solved card is the SHIP's share, not the total it was asked for", function () {
	// The bug this solve exists for: writing the wanted total into the card
	// bills the ship for the Moon's contribution too, and the next recompute
	// adds the residual on top of it.
	var jd = JD + 21;
	var truth = flyLunarDeparture({ jd: jd, card: { pro: 2500, rad: 0, nrm: 0 } });
	assert.ok(truth.ok, truth.reason);
	var s = solveLunarCard({ jd: jd, vInfVec: truth.vInf.vec });
	assert.ok(s.ok, s.reason);
	var solvedVec = cardVInf(jd, s.card);
	assert.ok(O.vMag(O.vSub(solvedVec, truth.vInf.vec)) > 100,
		"the card must differ from the total by the residual, not equal it");
	// and it is the card that produced the ask, recovered
	assert.ok(Math.abs(s.card.pro - 2500) < 1 && Math.abs(s.card.rad) < 1 && Math.abs(s.card.nrm) < 1,
		"recovered " + JSON.stringify(s.card));
});

test("naively writing the total into the card overshoots, and keeps overshooting", function () {
	// The null control for the fix: run the OLD behaviour — card := the total
	// Lambert asked for — and watch it walk away instead of settling.
	var jd = JD + 21;
	var want = flyLunarDeparture({ jd: jd, card: { pro: 2500, rad: 0, nrm: 0 } }).vInf.vec;
	var wm = O.vMag(want);
	var naive = cardFromVector(jd, O.vScale(want, edgeVInf(wm, "Moon") / wm));
	var errs = [];
	for (var i = 0; i < 3; i++) {
		var f = flyLunarDeparture({ jd: jd, card: naive });
		if (!f.ok) { break; }
		errs.push(O.vMag(O.vSub(f.vInf.vec, want)));
		var nm = O.vMag(f.vInf.vec);
		naive = cardFromVector(jd, O.vScale(f.vInf.vec, edgeVInf(nm, "Moon") / nm));
	}
	assert.ok(errs.length >= 2, "the naive card should keep flying, not refuse immediately");
	assert.ok(errs[0] > 500, "one naive pass already misses by " + errs[0] + " m/s");
	assert.ok(errs[1] > errs[0], "and the miss grows: " + errs.join(" -> "));
});

test("an unreachable ask is refused, never answered with a wrong card", function () {
	// Straight down at Earth: no outward release delivers it, so there is no
	// card to write and the caller must be told so.
	var jd = JD;
	var down = O.vScale(O.vUnit(moonGeoPos(jd)), -4000);
	var s = solveLunarCard({ jd: jd, vInfVec: down });
	assert.ok(!s.ok, "expected a refusal, got " + JSON.stringify(s.card));
	assert.ok(typeof s.reason === "string" && s.reason.length > 0);
});

// ---------------------------------------------------------------------------
// soiExit — the hand-off the departure actually reaches
// ---------------------------------------------------------------------------

test("the hand-off lands exactly on Earth's SOI, not near it", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 2800, rad: 900, nrm: 300 } });
	assert.ok(f.ok && f.soiExit, "expected a supported departure with a crossing");
	var r = O.vMag(f.soiExit.r);
	assert.ok(Math.abs(r - SOI_EARTH) < 1, "crossing at " + r + " m, wanted " + SOI_EARTH);
});

test("the hand-off velocity is the EDGE speed, not the asymptote", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 2800, rad: 900, nrm: 300 } });
	// Vis-viva across Earth's well: the two differ by exactly the grip Earth
	// still has at the SOI radius, so the edge figure is the larger one.
	var want = Math.sqrt(f.vInf.mag * f.vInf.mag + 2 * GM_EARTH / SOI_EARTH);
	assert.ok(Math.abs(O.vMag(f.soiExit.v) - want) < 0.5,
		"edge " + O.vMag(f.soiExit.v) + " vs vis-viva " + want);
	assert.ok(O.vMag(f.soiExit.v) > f.vInf.mag + 50,
		"the edge speed must exceed the asymptotic one by Earth's remaining grip");
});

test("the crossing epoch is the coast time, so the hand-off is not the release", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 2800, rad: 900, nrm: 300 } });
	assert.ok(Math.abs(f.soiExit.dt / 86400 - f.coastDays) < 1e-9);
	assert.ok(f.coastDays > 0.5, "a lunar departure takes real time to reach the SOI");
});

test("null control: the crossing is downrange of the Moon, not at it", function () {
	// The whole point of the hand-off is that it is somewhere else. If this
	// ever reads ~0 the propagation has silently degenerated to the release.
	var f = flyLunarDeparture({ jd: JD, card: { pro: 2800, rad: 900, nrm: 300 } });
	var moved = O.vMag(O.vSub(f.soiExit.r, f.rMoon));
	assert.ok(moved > 400e6, "crossing only " + (moved / 1e3) + " km from the Moon");
});

test("a stronger card reaches the SOI sooner and faster", function () {
	var slow = flyLunarDeparture({ jd: JD, card: { pro: 2800, rad: 900, nrm: 300 } });
	var fast = flyLunarDeparture({ jd: JD, card: { pro: 3400, rad: 900, nrm: 300 } });
	assert.ok(slow.ok && fast.ok);
	assert.ok(fast.soiExit.dt < slow.soiExit.dt, "more energy should arrive earlier");
	assert.ok(O.vMag(fast.soiExit.v) > O.vMag(slow.soiExit.v));
});

// ---------------------------------------------------------------------------
// solveLunarCard at: "exit" — matching the velocity AT the SOI crossing
// ---------------------------------------------------------------------------

test("an exit ask is met at the crossing, not merely near it", function () {
	var ref = flyLunarDeparture({ jd: JD, card: { pro: 2900, rad: 1000, nrm: 400 } });
	assert.ok(ref.ok && ref.soiExit);
	// Ask for a velocity a little off the one that card delivers.
	var want = O.vAdd(ref.soiExit.v, [60, -40, 25]);
	var s = solveLunarCard({ jd: JD, vInfVec: want, at: "exit",
	                         seedCard: { pro: 2900, rad: 1000, nrm: 400 } });
	assert.ok(s.ok, "expected a card, got " + s.reason);
	assert.ok(O.vMag(O.vSub(s.flight.soiExit.v, want)) < 1,
		"missed the exit ask by " + O.vMag(O.vSub(s.flight.soiExit.v, want)) + " m/s");
});

test("null control: rescaling the ask to asymptotic magnitude does NOT solve it", function () {
	// The failure this mode exists to prevent. At the SOI the velocity has not
	// finished turning onto the asymptote, so an edge ask converted by
	// magnitude alone keeps the wrong DIRECTION — and the asymptote solve then
	// answers a question nobody asked. If this ever passes under 1 m/s the two
	// modes have collapsed into one and `at` is no longer buying anything.
	var ref = flyLunarDeparture({ jd: JD, card: { pro: 2900, rad: 1000, nrm: 400 } });
	var want = O.vAdd(ref.soiExit.v, [60, -40, 25]);
	var wm = O.vMag(want);
	var asym = Math.sqrt(wm * wm - 2 * GM_EARTH / SOI_EARTH);
	var s = solveLunarCard({ jd: JD, vInfVec: O.vScale(want, asym / wm),
	                         seedCard: { pro: 2900, rad: 1000, nrm: 400 } });
	assert.ok(s.ok);
	var miss = O.vMag(O.vSub(s.flight.soiExit.v, want));
	assert.ok(miss > 5, "expected the rescale to miss the exit ask; it missed by " + miss);
});

test("an exit solve refuses an ask below Earth's escape at the SOI", function () {
	var down = O.vScale(O.vUnit(moonGeoPos(JD)), 300);
	var s = solveLunarCard({ jd: JD, vInfVec: down, at: "exit" });
	assert.ok(!s.ok && typeof s.reason === "string");
});

// ---------------------------------------------------------------------------
// The Earth-pass pipeline
// ---------------------------------------------------------------------------

// Every day of the month the fixed card goes to the Earth-pass pipeline.
function passFlights() {
	var out = [];
	for (var k = 0; k < 32; k++) {
		var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 32,
		                            card: { pro: 3000, rad: 0, nrm: 0 } });
		if (f.ok && f.route === "earth-pass") { out.push(f); }
	}
	return out;
}

test("the asteroid backtrace recovers a coast, falling in or heading out", function () {
	// Each of these bends less than half a turn from the Moon's radius — the
	// short way round, which is the route the backtrace returns.
	var r = [384400e3, 0, 0];
	[[2000, 2600, 0], [-1500, 2600, 300], [-900, 3300, 0]].forEach(function (v) {
		var out = vInfFromState(r, v);
		var back = passiveReleaseFor(r, out.vec);
		assert.ok(O.vMag(O.vSub(back, v)) < 1e-3, "for " + v + ": got " + back);
	});
});

test("the backtrace takes the short way round, not the long", function () {
	// This coast swings more than half a turn past Earth; the backtrace finds
	// the other coast that leaves on the same heading, bending less.
	var r = [384400e3, 0, 0], v = [-2500, 1200, 0];
	var out = vInfFromState(r, v);
	var back = passiveReleaseFor(r, out.vec);
	assert.ok(O.vMag(O.vSub(back, v)) > 100);
	assert.ok(O.vMag(O.vSub(vInfFromState(r, back).vec, out.vec)) < 1e-3);
});

test("a pass leaves along its card's direction, on the release its length fixes", function () {
	var flights = passFlights();
	assert.ok(flights.length >= 4);
	flights.forEach(function (f) {
		assert.ok(angleBetween(f.vInf.vec, f.cardVec) < 1e-4);
		var share = O.vMag(f.cardAsym), rm = O.vMag(f.rMoon);
		assert.ok(Math.abs(f.uMag - Math.sqrt(share * share + 2 * GM_EARTH / rm)) < 1e-3);
		// And that release, added to the Moon's motion, is the flight.
		var flown = vInfFromState(f.rMoon, O.vAdd(f.u, f.vMoon));
		assert.ok(O.vMag(O.vSub(flown.vec, f.vInf.vec)) < 1e-3);
	});
});

test("a pass that falls toward Earth swings through perigee and still lands on the SOI", function () {
	var inbound = passFlights().filter(function (f) { return f.perigee !== null; });
	assert.ok(inbound.length >= 2, "expected passes that fall in first");
	inbound.forEach(function (f) {
		assert.ok(f.perigee >= MIN_PERIGEE);
		assert.ok(O.vDot(f.rMoon, O.vAdd(f.u, f.vMoon)) < 0);
		assert.ok(Math.abs(O.vMag(f.soiExit.r) - SOI_EARTH) < 1e3);
		assert.ok(O.vDot(f.soiExit.r, f.soiExit.v) > 0, "leaving, not arriving");
	});
});

test("an inbound coast time counts the fall to perigee", function () {
	var r1 = 384400e3, r = [r1, 0, 0], v = [-2600, 700, 0];
	var out = vInfFromState(r, v);
	var t = hyperbolicCoastTime(out.mag, out.e, r1, SOI_EARTH, true);
	assert.ok(t > hyperbolicCoastTime(out.mag, out.e, r1, SOI_EARTH));
	var at = O.propagateState(GM_EARTH, r, v, t);
	assert.ok(Math.abs(O.vMag(at.r) - SOI_EARTH) < 1e3);
});

test("the Earth-pass pipeline declines a card with nothing to fly", function () {
	assert.equal(flyEarthPassDeparture({ jd: JD, card: { pro: 0, rad: 0, nrm: 0 } }), null);
});

test("target mode finds cards on the Earth-pass side of the seam", function () {
	// Aim for the exit a pass flight actually leaves on; the solve must hand
	// back a card that flies it.
	var f = passFlights()[0];
	var s = solveLunarCard({ jd: f.jd, vInfVec: f.vInf.vec });
	assert.ok(s.ok, s.reason);
	assert.equal(s.flight.route, "earth-pass");
	assert.ok(O.vMag(O.vSub(s.flight.vInf.vec, f.vInf.vec)) < 0.05);
});

test("the seam: a card both pipelines could fly goes to the outward one", function () {
	// The stated limit. Near the seam some coasting flights are reachable only
	// by a card the OUTWARD pipeline also accepts under its own reading, so it
	// is flown outward and the pass flight has no card. Pinned so that a change
	// to how the seam is drawn is a deliberate one.
	var gaps = 0;
	for (var k = 0; k < 32; k++) {
		var jd = JD + k * LUNAR_MONTH / 32;
		var s = solveLunarCard({ jd: jd, vInfVec: [2000, 1500, 300] });
		if (!s.ok) {
			var rM = moonGeoPos(jd), v = passiveReleaseFor(rM, [2000, 1500, 300]);
			assert.ok(v, "a coasting route exists");
			gaps++;
		}
	}
	assert.ok(gaps < 8, gaps + " of 32 days unreachable");
});

// ---------------------------------------------------------------------------
// Two ways round Earth, and the release solved back from the hand-off
// ---------------------------------------------------------------------------

test("the long-way backtrace recovers a coast that bends past half a turn", function () {
	var r = [384400e3, 0, 0], v = [-2500, 1200, 0];
	var out = vInfFromState(r, v);
	var back = passiveReleaseFor(r, out.vec, -1);
	assert.ok(O.vMag(O.vSub(back, v)) < 1e-3, "got " + back);
});

test("the long way leaves on its card's heading after a close pass", function () {
	var seen = 0;
	for (var k = 0; k < 16; k++) {
		var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 16,
		                            card: { pro: 3000, rad: 0, nrm: 0 }, way: "long" });
		if (!f.ok) { assert.equal(f.reason, "pass-hits-Earth"); continue; }
		seen++;
		assert.equal(f.way, "long");
		assert.ok(f.perigee !== null && f.perigee >= MIN_PERIGEE);
		assert.ok(angleBetween(f.vInf.vec, f.cardVec) < 1e-4);
	}
	assert.ok(seen >= 6, "long way flew on " + seen + " of 16 dates");
});

test("the long way comes far closer to Earth than the short way ever does", function () {
	// The short way never nears Earth; the close passes are all the long way's.
	var nearest = { short: Infinity, long: Infinity };
	for (var k = 0; k < 32; k++) {
		["short", "long"].forEach(function (way) {
			var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 32,
			                            card: { pro: 3000, rad: 0, nrm: 0 }, way: way });
			if (f.ok && f.perigee !== null) { nearest[way] = Math.min(nearest[way], f.perigee); }
		});
	}
	assert.ok(nearest.short > 100000e3, "short way came to " + nearest.short);
	assert.ok(nearest.long < 20000e3, "long way came only to " + nearest.long);
});

test("the release solved back from a hand-off crosses Earth's SOI exactly then", function () {
	var seed = { short: null, long: null }, flown = { short: 0, long: 0 };
	for (var k = 0; k < 20; k++) {
		var H = JD + k * LUNAR_MONTH / 20;
		["short", "long"].forEach(function (way) {
			var f = releaseForHandoff({ jdHandoff: H, card: { pro: 3000, rad: 0, nrm: 0 },
			                            way: way, seedJd: seed[way] });
			if (!f.ok) { return; }
			seed[way] = f.jd; flown[way]++;
			assert.equal(f.way, way);
			assert.equal(f.jdHandoff, H);
			assert.ok(Math.abs(f.jd + f.soiExit.dt / 86400 - H) * 86400 < 1,
				way + " misses the hand-off by " + (f.jd + f.soiExit.dt / 86400 - H) * 86400 + " s");
			assert.ok(f.jd < H);
		});
	}
	assert.ok(flown.short >= 18 && flown.long >= 10, JSON.stringify(flown));
});

test("the two ways leave from different Moons for the same hand-off", function () {
	var H = JD + 12;
	var s = releaseForHandoff({ jdHandoff: H, card: { pro: 3000, rad: 0, nrm: 0 }, way: "short" });
	var l = releaseForHandoff({ jdHandoff: H, card: { pro: 3000, rad: 0, nrm: 0 }, way: "long" });
	assert.ok(s.ok && l.ok, (s.reason || "") + " " + (l.reason || ""));
	assert.ok(Math.abs(s.jd - l.jd) > 0.25, "releases " + s.jd + " and " + l.jd);
	// Same card, so the same technology share; what the Moon gives differs.
	assert.ok(Math.abs(O.vMag(s.vInf.vec) - O.vMag(l.vInf.vec)) > 100);
});

test("a release that cannot reach the hand-off is refused with the reason", function () {
	// On these dates the long way's pass would hit Earth.
	var f = releaseForHandoff({ jdHandoff: JD, card: { pro: 3000, rad: 0, nrm: 0 }, way: "long" });
	if (!f.ok) { assert.equal(f.reason, "pass-hits-Earth"); }
});

test("target mode at a fixed hand-off returns a card and release that deliver the ask", function () {
	["short", "long"].forEach(function (way) {
		var H = JD + 10;
		var ref = releaseForHandoff({ jdHandoff: H, card: { pro: 2600, rad: 500, nrm: 100 }, way: way });
		assert.ok(ref.ok, ref.reason);
		var s = solveLunarCardAtHandoff({ jdHandoff: H, vInfVec: ref.soiExit.v, at: "exit",
		                                  way: way, seedCard: { pro: 2000, rad: 0, nrm: 0 } });
		assert.ok(s.ok, way + ": " + s.reason);
		assert.ok(s.err < 0.1, way + " err " + s.err);
		assert.ok(Math.abs(s.flight.jd + s.flight.soiExit.dt / 86400 - H) * 86400 < 1);
		assert.ok(Math.abs(s.flight.jd - ref.jd) < 1e-4, way + " released at " + s.flight.jd + " not " + ref.jd);
	});
});

test("where the short way has no route, the long way usually does", function () {
	// A small technology share: on some dates the Moon works against every
	// short route; the long way swings round and still leaves.
	var gaps = 0, filled = 0;
	for (var k = 0; k < 20; k++) {
		for (var az = 0; az < 360; az += 45) {
			var a = az * Math.PI / 180;
			var card = { pro: 1500 * Math.cos(a), rad: 1500 * Math.sin(a), nrm: 0 };
			var jd = JD + k * LUNAR_MONTH / 20;
			var f = flyLunarDeparture({ jd: jd, card: card });
			if (f.ok || f.reason !== "no-pass-route") { continue; }
			gaps++;
			if (flyLunarDeparture({ jd: jd, card: card, way: "long" }).ok) { filled++; }
		}
	}
	assert.ok(gaps > 0, "expected some short-way gaps");
	assert.ok(filled >= 0.8 * gaps, filled + " of " + gaps + " gaps filled");
});
