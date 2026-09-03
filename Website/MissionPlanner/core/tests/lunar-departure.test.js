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

import test from "node:test";
import assert from "node:assert";

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { SOI_EARTH, moonGeoPos, moonGeoVel } from "../../../Shared/geo-leg.js";
import { flyLunarDeparture, cardVInf, cardFromVector, vInfFromState, solveShipVelocity,
         solveLunarCard, hyperbolicCoastTime, releaseSpeedFor, RELEASE_ALTITUDE }
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

test("half the lunar month is refused, and that is the stated limit", function () {
	// A card fixed on Earth's heliocentric axes points the same way all month
	// while the Moon goes round it. When the Moon is on the far side, the only
	// trajectory that would deliver that card has to pass Earth — out of scope
	// here, and refused by name rather than drawn wrong.
	var ok = 0, pass = 0;
	for (var k = 0; k < 32; k++) {
		var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 32,
		                            card: { pro: 3000, rad: 0, nrm: 0 } });
		if (f.ok) { ok++; } else if (f.reason === "card-needs-earth-pass") { pass++; }
	}
	assert.ok(ok > 0 && pass > 0, "expected both supported and refused phases");
	assert.equal(ok + pass, 32, "every phase is either supported or named");
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
	             "card-needs-earth-pass", "heads-into-Earth", "no-escape"];
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
