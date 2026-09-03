/* MissionPlanner/core/lunar-departure — what a departure from the Moon is
 * worth at Earth's sphere of influence.
 *
 * A Moon origin is the one origin where the body a ship leaves and the body
 * whose sphere of influence its departure exits are different bodies
 * (Shared/frames.js's `escapeReferenceFor`). Leaving the Moon puts a ship
 * 66,168 km from the Moon and still deep inside Earth's well, so a lunar
 * departure is not over until it crosses EARTH's boundary.
 *
 * WHAT THE DEPARTURE CARD HOLDS. The card is the speed the SHIP's own actions
 * deliver AT Earth's SOI edge — the skyhook release plus any burns it makes on
 * the way out — stated on Earth's heliocentric prograde/normal/radial axes,
 * the same frame and the same meaning every other origin's card carries. It is
 * the ship's bill, and nothing the Moon contributes appears in it.
 *
 * That edge speed is NOT the hyperbolic excess: at 924,631 km Earth still holds
 * 928.5 m/s. The solve below inverts an escape hyperbola and so needs the
 * excess, and `cardAsym` is the card converted to it. A card below 928.5 m/s
 * describes a contribution that never escapes Earth on its own, which this
 * decomposition cannot express — refused as "card-below-escape".
 *
 * WHAT THE MOON ADDS. The Moon is moving, and a ship that leaves it keeps that
 * motion for free. But the Moon hands it over at 384,400 km, deep inside
 * Earth's well, so what arrives at Earth's SOI is a RESIDUAL, not the Moon's
 * own ~1,022 m/s. It can be worth more than face value — velocity added deep
 * in a well buys more than the same velocity added outside one — or less, when
 * the Moon is carrying the ship across the departure rather than along it.
 * Sampled over dates and cards it runs from about 0.9 to 1.9 times the Moon's
 * speed, and above face value only about half the time. Its DIRECTION swings
 * right round with the Moon's phase, and that is what makes the departure date
 * change where the ship ends up.
 *
 * HOW THE TWO ARE COMBINED. Squares do not split: the Moon's share and the
 * ship's share cannot be sent out through Earth's well separately and added up
 * afterwards. Taken alone the Moon's 1,022 m/s does not even escape. So the
 * chain runs through the one state where both are simply present together —
 * the ship's velocity at the Moon:
 *
 *   card  ->  the ship's velocity at the Moon that delivers it  (solveShipVelocity)
 *         ->  plus the Moon's own velocity there                (the free part)
 *         ->  out through Earth's well, exactly                 (vInfFromState)
 *         ->  total v-infinity;  residual = total - card
 *
 * WHAT IS SUPPORTED. Departures that head AWAY from Earth — outward at the
 * Moon, so the ship never passes Earth on the way out. Everything else is
 * refused by name and drawn not at all: every refusal routes through
 * flyEarthPassDeparture, the placeholder where a dive past Earth will be
 * solved once there is a rule for it.
 *
 * Pure (no DOM, no THREE) and Node-testable, like the rest of core/.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { systems } from "../../Shared/orbit.js";
import { Frames } from "../../Shared/frames.js";
import { SOI_EARTH, SOI_MOON, moonGeoPos, moonGeoVel } from "../../Shared/geo-leg.js";
import { asymptoticVInf, edgeVInf } from "./departure-estimate.js";

var O = OrbitalMath;
var GM_EARTH = systems.get("Earth").GM;
var GM_MOON = systems.get("Moon").GM;
var R_MOON = Number(systems.get("Moon").radius);
var DAY = 86400;

// The altitude the reported release speed is quoted at — a nominal skyhook
// release, not a commitment.
export var RELEASE_ALTITUDE = 100e3;

// The speed a release at radius rRelease must have to reach the Moon's SOI
// edge with excess speed uMag. An exact two-body step through the Moon's well;
// only the RADIUS enters, never a direction, so it never touches the flight.
export function releaseSpeedFor(uMag, rRelease) {
	var r = rRelease == null ? R_MOON + RELEASE_ALTITUDE : rRelease;
	return Math.sqrt(uMag * uMag + 2 * GM_MOON * (1 / r - 1 / SOI_MOON));
}

// The card as a geocentric vector. The axes are EARTH's heliocentric
// prograde/normal/radial — the same ones every other origin's card uses, so
// "prograde" means one thing across the tab. The components describe a
// velocity relative to Earth; the two frames differ only by Earth's own
// motion, which is not applied here.
export function cardVInf(jd, card) {
	var c = card || {};
	var e = Frames.bodyHelioState("Earth", jd);
	var f = O.burnFrame(e.r, e.v);
	return O.vAdd(O.vScale(f.pro, c.pro || 0),
	       O.vAdd(O.vScale(f.nrm, c.nrm || 0), O.vScale(f.rad, c.rad || 0)));
}

// The v-infinity a geocentric state escapes with: the exact outbound asymptote
// of its hyperbola, not the direction it happens to be pointing right now.
// Null if the state is bound to Earth.
export function vInfFromState(r, v) {
	var rm = O.vMag(r), vm = O.vMag(v);
	var v2 = vm * vm - 2 * GM_EARTH / rm;
	if (v2 <= 0) { return null; }
	var vInf = Math.sqrt(v2);
	var h = O.vCross(r, v), hm = O.vMag(h);
	// A radial escape has no angular momentum and never turns: it leaves along
	// the way it is already pointing.
	if (hm < 1e-6 * rm * vm) {
		return { vec: O.vScale(O.vUnit(r), vInf), mag: vInf, e: 1, rp: 0 };
	}
	var ev = O.vScale(O.vSub(O.vScale(r, vm * vm - GM_EARTH / rm),
	                         O.vScale(v, O.vDot(r, v))), 1 / GM_EARTH);
	var e = O.vMag(ev);
	var pHat = O.vUnit(ev), wHat = O.vUnit(h), qHat = O.vCross(wHat, pHat);
	// Velocity at true anomaly nu goes as (-sin nu, e + cos nu) in (pHat, qHat);
	// at the outbound asymptote cos nu = -1/e.
	var sinInf = Math.sqrt(Math.max(0, 1 - 1 / (e * e)));
	var dir = O.vUnit(O.vAdd(O.vScale(pHat, -sinInf), O.vScale(qHat, e - 1 / e)));
	return { vec: O.vScale(dir, vInf), mag: vInf, e: e, rp: (hm * hm / GM_EARTH) / (1 + e) };
}

// The inverse: what velocity at rMoon escapes Earth along exactly this
// v-infinity vector? Vis-viva fixes the SPEED outright; the orbital plane has
// to contain both rMoon and the target, which leaves one angle to solve for.
//
// Only outward-heading solutions are considered, which both matches what this
// file supports and picks a single branch out of the two that would otherwise
// deliver the same v-infinity bending opposite ways.
//
// Returns { ok: true, u, turnDeg } or { ok: false, reason }.
export function solveShipVelocity(rMoon, w) {
	var rm = O.vMag(rMoon), wm = O.vMag(w);
	if (!(wm > 1e-6)) { return { ok: false, reason: "no-card" }; }
	var need = Math.sqrt(wm * wm + 2 * GM_EARTH / rm);
	var rHat = O.vUnit(rMoon);
	var n = O.vCross(rMoon, w);

	// A card pointing straight out along the Moon's own radius needs a radial
	// escape; straight back down it cannot be met heading outward at all.
	if (O.vMag(n) < 1e-9 * rm * wm) {
		if (O.vDot(rMoon, w) > 0) {
			return { ok: true, u: O.vScale(rHat, need), turnDeg: 0 };
		}
		return { ok: false, reason: "card-toward-Earth" };
	}
	var nHat = O.vUnit(n), tHat = O.vCross(nHat, rHat);
	var psi = Math.atan2(O.vDot(w, tHat), O.vDot(w, rHat));   // in (0, PI)

	// theta measures the ship's velocity away from straight-out. Outward means
	// theta in (0, PI/2]; PI/2 puts the release exactly at periapsis.
	function asymptoteAngle(theta) {
		var u = O.vScale(O.vAdd(O.vScale(rHat, Math.cos(theta)),
		                        O.vScale(tHat, Math.sin(theta))), need);
		var out = vInfFromState(rMoon, u);
		if (!out) { return null; }
		return Math.atan2(O.vDot(out.vec, tHat), O.vDot(out.vec, rHat));
	}
	var hi = Math.PI / 2, aHi = asymptoteAngle(hi);
	if (aHi === null || psi > aHi + 1e-12) {
		// The card points further round than an outward release can reach; only
		// a trajectory that dives past Earth could deliver it.
		return { ok: false, reason: "card-needs-earth-pass" };
	}
	var lo = 1e-9;
	for (var i = 0; i < 100; i++) {
		var mid = 0.5 * (lo + hi), a = asymptoteAngle(mid);
		if (a === null || a < psi) { lo = mid; } else { hi = mid; }
	}
	var theta = 0.5 * (lo + hi);
	var u = O.vScale(O.vAdd(O.vScale(rHat, Math.cos(theta)),
	                        O.vScale(tHat, Math.sin(theta))), need);
	var check = vInfFromState(rMoon, u);
	var turn = Math.acos(Math.max(-1, Math.min(1,
		O.vDot(O.vUnit(u), O.vUnit(check.vec)))));
	return { ok: true, u: u, turnDeg: turn * 180 / Math.PI };
}

// The inverse of cardVInf: a geocentric vector back into card components, on
// the same Earth heliocentric axes. Exact — burnComponents projects onto the
// orthonormal frame cardVInf builds the vector from.
export function cardFromVector(jd, vec) {
	var e = Frames.bodyHelioState("Earth", jd);
	var c = O.burnComponents(e.r, e.v, vec);
	return { pro: c.pro, rad: c.rad, nrm: c.nrm };
}

// How close a solved card has to land on the v∞ it was asked for. Under a
// tenth of a m/s on a departure of kilometres per second: the drawn arc is
// the one that was asked for.
var CARD_SOLVE_TOL = 0.05;

/* SOLVING BACKWARDS: which card delivers a wanted TOTAL v∞?
 *
 * flyLunarDeparture runs card -> total. Target mode needs the other
 * direction: Lambert states the total v∞ the arc has to leave on, and the
 * card holds only the ship's share of it. Writing the total into the card
 * would bill the ship for the Moon's contribution as well, and the next
 * recompute would add the residual on top of it — an arc that overshoots by
 * up to ~1.4 km/s and re-overshoots on every refresh instead of settling.
 *
 * The residual cannot simply be subtracted once, because it is a function of
 * the card: change the card and the ship leaves the Moon on a different
 * hyperbola, so what the Moon's motion is worth out at Earth's SOI changes
 * too. So this iterates the subtraction — card = wanted - residual(card) —
 * which converges in a handful of passes over most of the lunar month. Near
 * the edges of the supported region it can crawl or oscillate, and a damped
 * Newton on the same function picks those up.
 *
 * spec = { jd, vInfVec, seedCard } — vInfVec is the wanted TOTAL hyperbolic
 * excess (geocentric, asymptotic: what flyLunarDeparture reports as
 * vInf.vec), seedCard the card in force, which is usually close.
 *
 * Returns { ok: true, card, flight, err } — `flight` is the departure that
 * card flies, so a caller needs no second call — or { ok: false, reason },
 * with reason either a flyLunarDeparture refusal or "no-card-solution" when
 * the ask is escaping but no card reaches it.
 */
export function solveLunarCard(spec) {
	var jd = spec.jd, want = spec.vInfVec;
	if (!want || !(O.vMag(want) > 1e-6)) { return { ok: false, reason: "no-card" }; }

	function fly(card) {
		var f = flyLunarDeparture({ jd: jd, card: card });
		return f.ok ? f : null;
	}
	function errOf(f) { return O.vMag(O.vSub(f.vInf.vec, want)); }
	var best = null, firstReason = null;
	function keep(card, f) {
		var e = errOf(f);
		if (!best || e < best.err) { best = { card: card, flight: f, err: e }; }
		return e;
	}

	// SEEDS. The card in force is the natural one — a scrub moves the answer
	// only a little. The wanted total read as if it were the card is the
	// fallback: wrong by exactly the residual, but always inside the region
	// where an escaping card is defined, which a stale seed may not be.
	var wm = O.vMag(want);
	var seeds = [];
	if (spec.seedCard) { seeds.push(spec.seedCard); }
	seeds.push(cardFromVector(jd, O.vScale(want, edgeVInf(wm, "Moon") / wm)));

	for (var s = 0; s < seeds.length; s++) {
		var card = seeds[s], lastGood = null;
		for (var i = 0; i < 14; i++) {
			var f = fly(card);
			if (!f) {
				// The step left the supported region. With a good card behind
				// it, halve the step and try again; with none, this seed is
				// simply not a departure and the next seed gets its turn.
				if (!lastGood) {
					if (!firstReason) { firstReason = flyLunarDeparture({ jd: jd, card: card }).reason; }
					break;
				}
				card = { pro: 0.5 * (lastGood.pro + card.pro), rad: 0.5 * (lastGood.rad + card.rad),
				         nrm: 0.5 * (lastGood.nrm + card.nrm) };
				continue;
			}
			if (keep(card, f) < CARD_SOLVE_TOL) { return { ok: true, card: best.card, flight: best.flight, err: best.err }; }
			lastGood = card;
			var next = O.vSub(want, f.residual.vec), nm = O.vMag(next);
			if (!(nm > 1e-6)) { break; }
			card = cardFromVector(jd, O.vScale(next, edgeVInf(nm, "Moon") / nm));
		}
		if (best && best.err < CARD_SOLVE_TOL) { break; }
	}
	if (!best) { return { ok: false, reason: firstReason || "no-card-solution" }; }

	// NEWTON on the same three unknowns, from the best card the iteration
	// found. A step out of the supported region is not a refusal here — the
	// difference is taken one-sided the other way, and a step that does not
	// improve is damped until it does.
	var x = [best.card.pro, best.card.rad, best.card.nrm];
	function F(a) {
		var f = fly({ pro: a[0], rad: a[1], nrm: a[2] });
		return f ? { vec: O.vSub(f.vInf.vec, want), flight: f } : null;
	}
	var cur = F(x);
	for (var it = 0; cur && best.err >= CARD_SOLVE_TOL && it < 20; it++) {
		var J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], d = 0.1, singular = false;
		for (var c2 = 0; c2 < 3; c2++) {
			var xp = x.slice(); xp[c2] += d;
			var Fp = F(xp), sign = 1;
			if (!Fp) { xp[c2] -= 2 * d; Fp = F(xp); sign = -1; }
			if (!Fp) { singular = true; break; }
			for (var row = 0; row < 3; row++) { J[row][c2] = sign * (Fp.vec[row] - cur.vec[row]) / d; }
		}
		if (singular) { break; }
		var step = O.solve3(J, cur.vec);
		if (!step) { break; }
		var improved = false;
		for (var damp = 1; damp > 0.02; damp *= 0.5) {
			var xt = [x[0] - damp * step[0], x[1] - damp * step[1], x[2] - damp * step[2]];
			var Ft = F(xt);
			if (!Ft || O.vMag(Ft.vec) >= best.err) { continue; }
			x = xt; cur = Ft;
			keep({ pro: x[0], rad: x[1], nrm: x[2] }, Ft.flight);
			improved = true;
			break;
		}
		if (!improved) { break; }
	}

	if (!(best.err < 1)) { return { ok: false, reason: "no-card-solution" }; }
	return { ok: true, card: best.card, flight: best.flight, err: best.err };
}

// How long a hyperbolic coast takes to climb from r1 to r2, in seconds.
// Null for an orbit too near radial for the anomaly to be defined.
export function hyperbolicCoastTime(vInf, e, r1, r2) {
	if (!(e > 1.000001) || !(vInf > 1e-6)) { return null; }
	var aAbs = GM_EARTH / (vInf * vInf);
	function meanAnom(r) {
		var coshH = (r / aAbs + 1) / e;
		if (coshH < 1) { return null; }
		var H = Math.acosh(coshH);
		return e * Math.sinh(H) - H;
	}
	var m1 = meanAnom(r1), m2 = meanAnom(r2);
	if (m1 === null || m2 === null) { return null; }
	return Math.sqrt(aAbs * aAbs * aAbs / GM_EARTH) * (m2 - m1);
}

// PLACEHOLDER — the departures this file refuses, all of which pass Earth.
//
// A release aimed so the ship falls IN toward Earth first, swings through a
// low periapsis and leaves from there, is a real departure and often a better
// one: velocity added deep in the well buys more v-infinity, and the pass can
// swing the outbound asymptote round to headings no outward release can reach
// (`card-needs-earth-pass`). It is not modelled because the card does not
// determine it — a periapsis radius and the burn made there are free choices
// the card alone cannot pin down, so there is a second unknown here that the
// outward case does not have.
//
// Returns null: "not modelled, keep the refusal you already have". When it is
// filled in it will return a flight in the same shape flyLunarDeparture does,
// and the caller below will hand that back instead.
export function flyEarthPassDeparture(spec) {
	return null;
}

// The departure. spec = {
//   jd,    // the release epoch — the Departure phase's own start
//   card   // { pro, rad, nrm } m/s, the SHIP's v-infinity at Earth's SOI
// }
//
// Returns, on success:
//   { ok: true, jd, u, uMag, releaseSpeed,
//     cardVec,     // the card as typed — the ship's speed AT Earth's SOI edge
//     cardAsym,    // the same, as the hyperbolic excess behind it
//     vInf,        // { vec, mag, e, rp } — the TOTAL excess, ship plus Moon
//     residual,    // vec + mag: what the Moon's motion is worth at Earth's SOI
//     rMoon, vMoon, turnDeg, coastDays }
// with vInf.vec === cardAsym + residual.vec, all three hyperbolic excesses.
// On failure { ok: false, reason } with reason one of "no-card",
// "card-below-escape", "card-toward-Earth", "card-needs-earth-pass",
// "heads-into-Earth" or "no-escape".
export function flyLunarDeparture(spec) {
	var jd = spec.jd;
	var cardVec = cardVInf(jd, spec.card);
	// The card states the ship's speed AT Earth's SOI edge, where Earth still
	// holds 928.5 m/s (Notes/decisions.md). Everything below works in
	// asymptotic terms — solveShipVelocity inverts an escape hyperbola, which
	// only an escaping contribution has — so convert once, here.
	var cardMag = O.vMag(cardVec);
	var cardAsym = asymptoticVInf(cardMag, "Moon");
	if (!(cardMag > 1e-6)) { return { ok: false, reason: "no-card" }; }
	if (!(cardAsym > 1e-6)) { return { ok: false, reason: "card-below-escape" }; }
	var w = O.vScale(cardVec, cardAsym / cardMag);
	var rMoon = moonGeoPos(jd), vMoon = moonGeoVel(jd);

	// Every departure refused here is one that would pass Earth on the way
	// out, so each refusal offers flyEarthPassDeparture the chance to fly it
	// before naming a reason.
	var solved = solveShipVelocity(rMoon, w);
	if (!solved.ok) {
		// No card at all is nothing to fly, by any route.
		if (solved.reason === "no-card") { return { ok: false, reason: "no-card" }; }
		return flyEarthPassDeparture(spec) || { ok: false, reason: solved.reason };
	}

	var vTotal = O.vAdd(vMoon, solved.u);
	// Supported departures leave going outward, so the ship never passes Earth.
	if (O.vDot(rMoon, vTotal) <= 0) {
		return flyEarthPassDeparture(spec) || { ok: false, reason: "heads-into-Earth" };
	}

	var total = vInfFromState(rMoon, vTotal);
	if (!total) { return flyEarthPassDeparture(spec) || { ok: false, reason: "no-escape" }; }

	// Both shares as hyperbolic excesses, so they add: the card's own worth out
	// there plus what the Moon's motion is still worth once Earth is behind.
	var residual = O.vSub(total.vec, w);
	var coast = hyperbolicCoastTime(total.mag, total.e, O.vMag(rMoon), SOI_EARTH);
	return {
		ok: true, jd: jd, cardVec: cardVec, cardAsym: w,
		u: solved.u, uMag: O.vMag(solved.u),
		releaseSpeed: releaseSpeedFor(O.vMag(solved.u), spec.releaseRadius),
		vInf: total,
		residual: { vec: residual, mag: O.vMag(residual) },
		rMoon: rMoon, vMoon: vMoon,
		turnDeg: solved.turnDeg,
		coastDays: coast == null ? null : coast / DAY
	};
}
