// node --test MissionPlanner/core/tests/ephemeris-lunar-departure.test.js
//
// The departure from a Moon origin. What is being pinned down here:
//
//   - the card's direction is the heading flown, on every day of the month:
//     the lunar phase moves the speed and never the heading.
//   - the residual is not the Moon's speed. It is what that speed is WORTH
//     out at Earth's SOI, which is a different and usually larger number.
//   - the asteroid backtrace inverts a coast exactly, the release is the
//     speed the card's length fixes, and the flight lands on Earth's SOI when
//     it says it does.
//   - refusals are named, not thrown or zeroed.

import test from "node:test";
import assert from "node:assert";

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { SOI_EARTH, moonGeoPos, moonGeoVel } from "../../../Shared/geo-leg.js";
import { flyLunarDeparture, cardVInf, cardFromVector, vInfFromState,
         solveLunarCard, hyperbolicCoastTime, releaseSpeedFor, RELEASE_ALTITUDE,
         passiveReleaseFor, flyEarthPassDeparture, MIN_PERIGEE }
	from "../ephemeris-lunar-departure.js";
import { edgeVInf } from "../departure-phase-estimate.js";

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

test("the card's direction is the heading flown, on every day of the month", function () {
	// A card fixed on Earth's heliocentric axes points the same way all month
	// while the Moon goes round it. The ship leaves along that heading whatever
	// the phase; the Moon only changes how fast.
	var cards = [{ pro: 3000, rad: 0, nrm: 0 }, { pro: -2548, rad: -313, nrm: 0 },
	             { pro: 0, rad: 2500, nrm: 800 }, { pro: -1500, rad: -2500, nrm: -500 }];
	cards.forEach(function (card) {
		var speeds = [];
		for (var k = 0; k < 64; k++) {
			var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 64, card: card });
			assert.ok(f.ok, JSON.stringify(card) + " day " + k + ": " + f.reason);
			assert.ok(angleBetween(f.vInf.vec, f.cardVec) < 1e-4,
				"day " + k + " heading off by " + angleBetween(f.vInf.vec, f.cardVec) + " deg");
			speeds.push(f.vInf.mag);
		}
		assert.ok(Math.max.apply(null, speeds) - Math.min.apply(null, speeds) > 300,
			"the Moon's phase must still move the speed");
	});
});

test("the residual lies along the card's heading", function () {
	var f = flyLunarDeparture({ jd: JD + 5, card: { pro: 2800, rad: 300, nrm: -200 } });
	assert.ok(f.ok, f.reason);
	var along = O.vDot(f.residual.vec, O.vUnit(f.cardVec));
	assert.ok(Math.abs(Math.abs(along) - f.residual.mag) < 1e-6);
});

// ---------------------------------------------------------------------------
// The supported region is enforced
// ---------------------------------------------------------------------------

test("no card is a named refusal, not a throw or a zero", function () {
	var f = flyLunarDeparture({ jd: JD, card: { pro: 0, rad: 0, nrm: 0 } });
	assert.equal(f.ok, false);
	assert.equal(f.reason, "no-card");
});

test("every refusal carries a reason a caller can show", function () {
	var known = ["no-card", "card-below-escape", "card-toward-Earth",
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

// A month of flights on a fixed card, some falling toward Earth first.
function passFlights() {
	var out = [];
	for (var k = 0; k < 32; k++) {
		var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 32,
		                            card: { pro: 3000, rad: 0, nrm: 0 } });
		if (f.ok) { out.push(f); }
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

test("target mode finds the card for every flight of the month", function () {
	// Aim for the asymptote each flight actually leaves on; the solve must hand
	// back a card that flies it, from any phase.
	passFlights().forEach(function (f) {
		var s = solveLunarCard({ jd: f.jd, vInfVec: f.vInf.vec });
		assert.ok(s.ok, s.reason);
		assert.ok(O.vMag(O.vSub(s.flight.vInf.vec, f.vInf.vec)) < 0.05);
	});
});
