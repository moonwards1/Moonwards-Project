/* MissionPlanner/core/lunar-departure — what a departure from the Moon is
 * worth at Earth's sphere of influence.
 *
 * A Moon origin is the one origin where the body a ship leaves and the body
 * whose sphere of influence its departure exits are different bodies
 * (Shared/frames.js's `escapeReferenceFor`). Leaving the Moon puts a ship
 * 66,168 km from the Moon and still deep inside Earth's well, so a lunar
 * departure is not over until it crosses EARTH's boundary.
 *
 * A SKETCHING MODEL. This file serves the Ephemeris tab, which sketches a
 * trajectory to judge whether a mission is viable; it is not the flight. It
 * is two-body throughout: Earth's gravity alone from the Moon's CENTRE out to
 * Earth's SOI, the Sun ignored, and the Moon's own well paid once, by radius
 * only, in releaseSpeedFor. A mission tab's Departure phase flies the real
 * thing — modules/departure-leg integrates Earth + Moon + Sun from the
 * carrier's actual release point, with the user's own waypoint impulses — and
 * that trajectory differs from this one in its details, noticeably over a long
 * coast. The difference is expected, not an error to reconcile here.
 *
 * WHAT THE DEPARTURE CARD HOLDS. The card is the speed the RELEASE delivers
 * AT Earth's SOI edge — the technology's share: a skyhook or elevator lets go
 * and the ship coasts from there, with no burns of its own in this sketch —
 * stated on Earth's heliocentric prograde/normal/radial axes,
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
 * TWO PIPELINES, ONE SEAM. The chain above is the OUTWARD pipeline: it flies
 * the departures that head away from Earth. When the Moon is on the wrong
 * side of its orbit for the card — the ship would have to swing past Earth to
 * leave that way — the outward pipeline refuses, and every refusal hands the
 * card to flyEarthPassDeparture, the EARTH-PASS pipeline, which reads the
 * card differently:
 *
 *   outward     card = the share's own vector: its length is the technology's
 *               share, its direction the one that share alone would leave on.
 *               The flown heading is card + residual.
 *   Earth-pass  card = the share's LENGTH along the flown HEADING. Where the
 *               ship bends past Earth, the direction the share alone would
 *               take points somewhere the ship never goes, so the card's
 *               direction is the heading actually flown instead; the Moon's
 *               contribution is then a gain or loss of speed along it.
 *
 * The length means the same in both: the technology's share, and so the
 * release speed. The same card on either side of the seam is a different
 * flight, so a scrub across it moves the arc abruptly.
 *
 * TWO WAYS ROUND EARTH. For a given release speed and heading there are two
 * coasting routes: the SHORT way (`way: "short"`, the two pipelines above),
 * bending less than half a turn and never nearer Earth than ~21,000 km
 * altitude, and the LONG way (`way: "long"`), bending more than half a turn,
 * which is where every close pass lives. They leave the same Moon on the same
 * heading at different speeds and take different times to reach Earth's SOI,
 * so which one the Moon helps more changes through the month; on some dates
 * only one exists. The long way always reads the card as the Earth-pass
 * pipeline does.
 *
 * THE CLOCK IS THE HAND-OFF. The Ephemeris tab's date is the Earth-SOI
 * crossing, as at every other origin. releaseForHandoff solves the release
 * backwards from it along the chosen way — the date whose flight reaches the
 * SOI exactly then — and that release is where the Moon is and when the
 * mission's Departure phase begins.
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
 * spec = { jd, vInfVec, seedCard, at, way } — seedCard is the card in force,
 * which is usually close, `way` which way round Earth the answer flies, and
 * `at` says WHERE vInfVec is measured:
 *
 *   "asymptote" (default) — the wanted TOTAL hyperbolic excess, geocentric,
 *                           what flyLunarDeparture reports as vInf.vec.
 *   "exit"                — the wanted geocentric velocity AT the Earth-SOI
 *                           crossing, i.e. soiExit.v. This is what a caller
 *                           holding a hand-off wants, and it is NOT the
 *                           asymptote rescaled: out at the SOI the velocity
 *                           has not finished turning onto the asymptote, so
 *                           the two differ in DIRECTION as well as magnitude
 *                           — worth ~23 m/s on a 4.3 km/s departure, which is
 *                           most of a million kilometres of arrival error
 *                           over a long coast.
 *
 * Either way the ITERATION runs in asymptotic terms, because that is where the
 * card-minus-residual algebra lives; an "exit" ask is converted to an
 * asymptotic proxy to seed with, and the damped Newton then closes on the real
 * quantity.
 *
 * Returns { ok: true, card, flight, err } — `flight` is the departure that
 * card flies, so a caller needs no second call — or { ok: false, reason },
 * with reason either a flyLunarDeparture refusal or "no-card-solution" when
 * the ask is escaping but no card reaches it.
 */
export function solveLunarCard(spec) {
	var jd = spec.jd, want = spec.vInfVec;
	if (!want || !(O.vMag(want) > 1e-6)) { return { ok: false, reason: "no-card" }; }

	// The quantity the answer is graded on, and the asymptotic proxy the
	// iteration steers by. They are the same vector for an asymptote ask.
	var atExit = spec.at === "exit";
	var wantIter = want;
	if (atExit) {
		var wm0 = O.vMag(want), a0 = asymptoticVInf(wm0, "Moon");
		if (!(a0 > 1e-6)) { return { ok: false, reason: "card-below-escape" }; }
		wantIter = O.vScale(want, a0 / wm0);
	}

	function fly(card) {
		var f = flyLunarDeparture({ jd: jd, card: card, way: spec.way });
		return (f.ok && (!atExit || f.soiExit)) ? f : null;
	}
	function errOf(f) {
		return atExit ? O.vMag(O.vSub(f.soiExit.v, want))
		              : O.vMag(O.vSub(f.vInf.vec, want));
	}
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
	var wm = O.vMag(wantIter);
	var seeds = [];
	if (spec.seedCard) { seeds.push(spec.seedCard); }
	seeds.push(cardFromVector(jd, O.vScale(wantIter, edgeVInf(wm, "Moon") / wm)));
	// The Earth-pass reading, solved outright: trace the wanted heading back to
	// the Moon, and the release that route needs gives the card's length. It
	// is exact whenever the answer lands on the Earth-pass side of the seam.
	var passSeed = earthPassCardFor(jd, wantIter, spec.way === "long" ? -1 : 1);
	if (passSeed) { seeds.push(passSeed); }

	for (var s = 0; s < seeds.length; s++) {
		var card = seeds[s], lastGood = null;
		for (var i = 0; i < 14; i++) {
			var f = fly(card);
			if (!f) {
				// The step left the supported region. With a good card behind
				// it, halve the step and try again; with none, this seed is
				// simply not a departure and the next seed gets its turn.
				if (!lastGood) {
					if (!firstReason) { firstReason = flyLunarDeparture({ jd: jd, card: card, way: spec.way }).reason; }
					break;
				}
				card = { pro: 0.5 * (lastGood.pro + card.pro), rad: 0.5 * (lastGood.rad + card.rad),
				         nrm: 0.5 * (lastGood.nrm + card.nrm) };
				continue;
			}
			if (keep(card, f) < CARD_SOLVE_TOL) { return { ok: true, card: best.card, flight: best.flight, err: best.err }; }
			lastGood = card;
			var next = O.vSub(wantIter, f.residual.vec), nm = O.vMag(next);
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
		if (!f) { return null; }
		return { vec: atExit ? O.vSub(f.soiExit.v, want) : O.vSub(f.vInf.vec, want), flight: f };
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

// The card the Earth-pass pipeline reads as leaving on exactly the TOTAL
// hyperbolic excess `want`: its direction, at the length of the share the
// traced-back release supplies. Null when there is no route or no escaping
// share. Whether this card is actually flown by the Earth-pass pipeline
// depends on which side of the seam it falls.
function earthPassCardFor(jd, want, sense) {
	var rMoon = moonGeoPos(jd);
	var v = passiveReleaseFor(rMoon, want, sense);
	if (!v) { return null; }
	var uMag = O.vMag(O.vSub(v, moonGeoVel(jd)));
	var share2 = uMag * uMag - 2 * GM_EARTH / O.vMag(rMoon);
	if (!(share2 > 1e-6)) { return null; }
	var edge = edgeVInf(Math.sqrt(share2), "Moon");
	return cardFromVector(jd, O.vScale(O.vUnit(want), edge));
}

// How long a hyperbolic coast takes to go from r1 out to r2, in seconds.
// `inbound` says the coast starts FALLING toward Earth at r1, so it swings
// through perigee before climbing out: the time down to perigee is added
// rather than subtracted. Null for an orbit too near radial for the anomaly
// to be defined.
export function hyperbolicCoastTime(vInf, e, r1, r2, inbound) {
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
	return Math.sqrt(aAbs * aAbs * aAbs / GM_EARTH) * (inbound ? m2 + m1 : m2 - m1);
}

// THE ASTEROID BACKTRACE. Which velocity at rMoon, coasting with no burns,
// leaves Earth along exactly the hyperbolic excess w? Read it as an asteroid
// seen leaving Earth's SOI: its speed and heading fix how it must have come
// through the Earth–Moon system.
//
// Vis-viva fixes the speed at rMoon outright, and the orbital plane must hold
// both rMoon and w, which leaves one angle: theta, the velocity's swing from
// straight out along rMoon toward w. Sweeping theta from 0 to PI turns the
// outbound asymptote steadily from rMoon's own direction right round through
// a full turn — first outward releases, then releases falling toward Earth
// that swing past it — so every heading in the plane is met exactly once.
// That is the SHORT way round Earth (sense +1). The LONG way (sense -1) turns
// the other way about Earth, so it must bend by more than half a turn to meet
// the same heading and swings far closer past perigee to do it: the same
// sweep, with the turning direction reversed.
//
// Returns the velocity at rMoon, or null for a heading straight back down
// rMoon (no plane to bend in), a radial heading taken the long way, or no
// excess at all.
export function passiveReleaseFor(rMoon, w, sense) {
	var dir = sense === -1 ? -1 : 1;
	var rm = O.vMag(rMoon), wm = O.vMag(w);
	if (!(wm > 1e-6)) { return null; }
	var speed = Math.sqrt(wm * wm + 2 * GM_EARTH / rm);
	var rHat = O.vUnit(rMoon);
	var n = O.vCross(rMoon, w);
	if (O.vMag(n) < 1e-9 * rm * wm) {
		return (dir === 1 && O.vDot(rMoon, w) > 0) ? O.vScale(rHat, speed) : null;
	}
	var nHat = O.vUnit(n), tHat = O.vScale(O.vCross(nHat, rHat), dir);
	// The heading's angle from rMoon, turning toward tHat: in (0, PI) the
	// short way, in (PI, 2 PI) the long.
	var psi = Math.atan2(O.vDot(w, tHat), O.vDot(w, rHat));
	if (psi < 0) { psi += 2 * Math.PI; }
	function velocity(theta) {
		return O.vScale(O.vAdd(O.vScale(rHat, Math.cos(theta)),
		                       O.vScale(tHat, Math.sin(theta))), speed);
	}
	// The asymptote's angle from rMoon, unwrapped onto [0, 2 PI) so it rises
	// monotonically with theta.
	function heading(theta) {
		var out = vInfFromState(rMoon, velocity(theta));
		var a = Math.atan2(O.vDot(out.vec, tHat), O.vDot(out.vec, rHat));
		return a < 0 ? a + 2 * Math.PI : a;
	}
	// 48 halvings of PI: under 1e-14 rad.
	var lo = 1e-9, hi = Math.PI - 1e-9;
	for (var i = 0; i < 48; i++) {
		var mid = 0.5 * (lo + hi);
		if (heading(mid) < psi) { lo = mid; } else { hi = mid; }
	}
	return velocity(0.5 * (lo + hi));
}

// Perigee a falling release may not go below: Earth's radius plus 100 km of
// atmosphere. The short way never comes near it; the long way is refused
// below it on the dates where its pass would graze or hit Earth.
var R_EARTH = Number(systems.get("Earth").radius);
export var MIN_PERIGEE = R_EARTH + 100e3;

// THE EARTH-PASS PIPELINE — the departures the outward pipeline refuses, and
// every departure taken the long way (spec.way "long"). Called by
// flyLunarDeparture with the same spec; returns a flight in the same shape,
// plus `route: "earth-pass"` and `perigee` (m, or null when the release
// already heads outward and the perigee lies behind it, never flown).
//
// The card's LENGTH is the technology's share, which fixes the release speed:
//   |u| = sqrt(share^2 + 2 GM / r_Moon)
// and its DIRECTION is the heading the flight leaves Earth on. What is left
// to find is the flown hyperbolic excess S along that heading: the passive
// route that leaves with S (passiveReleaseFor) needs some velocity at the
// Moon, and the release must supply exactly that velocity minus the Moon's
// own. So S is the root of
//   | passiveReleaseFor(rMoon, S * heading) - vMoon | = |u|
// which across a lunar month has exactly one; should a date offer more, the
// slowest is taken.
//
// Refuses, by name, with "no-pass-route" (no S meets the release), or
// "pass-hits-Earth" (the route found would dip below MIN_PERIGEE). With
// spec.allowImpact that last one is flown instead, marked `hitsEarth`: the
// conic through Earth's centre point, which a view can draw up to the
// surface and must not treat as a departure.
export function flyEarthPassDeparture(spec) {
	var jd = spec.jd;
	var way = spec.way === "long" ? "long" : "short", sense = way === "long" ? -1 : 1;
	var cardVec = cardVInf(jd, spec.card);
	var cardMag = O.vMag(cardVec);
	var share = asymptoticVInf(cardMag, "Moon");
	if (!(cardMag > 1e-6) || !(share > 1e-6)) { return null; }
	var heading = O.vUnit(cardVec);
	var rMoon = moonGeoPos(jd), vMoon = moonGeoVel(jd), rm = O.vMag(rMoon);
	var uWant = Math.sqrt(share * share + 2 * GM_EARTH / rm);

	function mismatch(S) {
		var v = passiveReleaseFor(rMoon, O.vScale(heading, S), sense);
		return v ? O.vMag(O.vSub(v, vMoon)) - uWant : null;
	}
	// Bracket on a geometric scan from 10 m/s to 50 km/s, then bisect: each
	// bracket spans under a quarter of its speed, and 40 halvings take that
	// below a micrometre per second.
	var S_LO = 10, S_HI = 5e4, STEPS = 40;
	var sPrev = null, gPrev = null, bracket = null;
	for (var k = 0; k <= STEPS && !bracket; k++) {
		var S = S_LO * Math.pow(S_HI / S_LO, k / STEPS), g = mismatch(S);
		if (g === null) { return { ok: false, reason: "card-toward-Earth" }; }
		if (gPrev !== null && (g > 0) !== (gPrev > 0)) { bracket = [sPrev, S]; }
		sPrev = S; gPrev = g;
	}
	if (!bracket) { return { ok: false, reason: "no-pass-route" }; }
	var lo = bracket[0], hi = bracket[1], gLo = mismatch(lo);
	for (var i = 0; i < 40; i++) {
		var mid = 0.5 * (lo + hi), gm = mismatch(mid);
		if ((gm > 0) === (gLo > 0)) { lo = mid; gLo = gm; } else { hi = mid; }
	}
	var vTotal = passiveReleaseFor(rMoon, O.vScale(heading, 0.5 * (lo + hi)), sense);
	var total = vInfFromState(rMoon, vTotal);
	var inbound = O.vDot(rMoon, vTotal) < 0;
	var hitsEarth = inbound && total.rp < MIN_PERIGEE;
	if (hitsEarth && !spec.allowImpact) { return { ok: false, reason: "pass-hits-Earth" }; }

	var u = O.vSub(vTotal, vMoon);
	var w = O.vScale(heading, share);
	var coast = hyperbolicCoastTime(total.mag, total.e, rm, SOI_EARTH, inbound);
	var exitState = coast == null ? null : O.propagateState(GM_EARTH, rMoon, vTotal, coast);
	var turn = Math.acos(Math.max(-1, Math.min(1, O.vDot(O.vUnit(vTotal), O.vUnit(total.vec)))));
	var residual = O.vSub(total.vec, w);
	return {
		ok: true, route: "earth-pass", way: way, hitsEarth: hitsEarth,
		jd: jd, cardVec: cardVec, cardAsym: w,
		u: u, uMag: O.vMag(u),
		releaseSpeed: releaseSpeedFor(O.vMag(u), spec.releaseRadius),
		vInf: total,
		residual: { vec: residual, mag: O.vMag(residual) },
		rMoon: rMoon, vMoon: vMoon,
		turnDeg: turn * 180 / Math.PI,
		perigee: inbound ? total.rp : null,
		coastDays: coast == null ? null : coast / DAY,
		soiExit: exitState ? { r: exitState.r, v: exitState.v, dt: coast } : null
	};
}

// The departure. spec = {
//   jd,    // the release epoch — the Departure phase's own start
//   card,  // { pro, rad, nrm } m/s, the technology's share at Earth's SOI
//   way    // "short" (default) or "long" — which way round Earth
// }
//
// Returns, on success:
//   { ok: true, route, jd, u, uMag, releaseSpeed,
//     route,       // "outward", or "earth-pass" from flyEarthPassDeparture
//     way,         // "short" or "long"
//     hitsEarth,   // true only under spec.allowImpact: a pass below
//                  //   MIN_PERIGEE, flown for drawing, not a departure
//     perigee,     // m — a pass's flown perigee; null when none is flown
//     cardVec,     // the card as typed — the ship's speed AT Earth's SOI edge
//     cardAsym,    // the same, as the hyperbolic excess behind it
//     vInf,        // { vec, mag, e, rp } — the TOTAL excess, ship plus Moon
//     residual,    // vec + mag: what the Moon's motion is worth at Earth's SOI
//     soiExit,     // { r, v, dt } — the hand-off: the outward Earth-SOI
//                  //   crossing in Earth's frame, dt seconds after release.
//                  //   `v` is the EDGE speed there, not the asymptote.
//                  //   Null when coastDays is (no crossing to state).
//     rMoon, vMoon, turnDeg, coastDays }
// with vInf.vec === cardAsym + residual.vec, all three hyperbolic excesses.
// On failure { ok: false, reason } with reason one of "no-card",
// "card-below-escape", "card-toward-Earth", "no-pass-route" or
// "pass-hits-Earth" — the outward pipeline's own refusals
// ("card-needs-earth-pass", "heads-into-Earth", "no-escape") surface only if
// the Earth-pass pipeline declines to answer at all.
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
	if (spec.way === "long") {
		return flyEarthPassDeparture(spec) || { ok: false, reason: "no-pass-route" };
	}
	var w = O.vScale(cardVec, cardAsym / cardMag);
	var rMoon = moonGeoPos(jd), vMoon = moonGeoVel(jd);

	// Every departure refused here is one that would pass Earth on the way
	// out, so each refusal is the seam: the card goes to the Earth-pass
	// pipeline, which reads it as a heading (see the header).
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

	// WHERE THE DEPARTURE ENDS: the outward crossing of Earth's SOI, in
	// Earth's frame. The state at the Moon fixes the escape hyperbola exactly
	// and `coast` is that same hyperbola's time from the Moon out to the
	// boundary, so propagating by it lands ON SOI_EARTH rather than near it.
	//
	// `v` here is the EDGE speed, not the asymptote: Earth still holds ~98 m/s
	// of a 4.3 km/s departure at this radius. That is what a hand-off velocity
	// means everywhere in core/, and it is the quantity the compliance
	// boundary measures the delivered hand-off in.
	//
	// Null when the coast time is undefined (a departure too near radial for
	// the anomaly), which is a departure with no hand-off to state.
	var exitState = coast == null ? null : O.propagateState(GM_EARTH, rMoon, vTotal, coast);
	return {
		ok: true, route: "outward", way: "short", hitsEarth: false, perigee: null, jd: jd, cardVec: cardVec, cardAsym: w,
		u: solved.u, uMag: O.vMag(solved.u),
		releaseSpeed: releaseSpeedFor(O.vMag(solved.u), spec.releaseRadius),
		vInf: total,
		residual: { vec: residual, mag: O.vMag(residual) },
		rMoon: rMoon, vMoon: vMoon,
		turnDeg: solved.turnDeg,
		coastDays: coast == null ? null : coast / DAY,
		soiExit: exitState ? { r: exitState.r, v: exitState.v, dt: coast } : null
	};
}

// How near the solved release's flight has to land on the hand-off epoch:
// 1e-7 d is under a hundredth of a second.
var RELEASE_TOL_DAYS = 1e-7;
// The span searched for a release when the quick solve does not settle:
// every route out takes between these many days to reach Earth's SOI.
var LEAD_MIN_DAYS = 0.3, LEAD_MAX_DAYS = 12;

/* THE RELEASE FROM THE HAND-OFF. The Ephemeris tab's clock is the Earth-SOI
 * crossing; this finds the release that crosses exactly then, along the
 * chosen way round Earth:
 *
 *   release + T(release) = hand-off
 *
 * where T is the flight's own time from the Moon to Earth's SOI, flown from
 * that release (the Moon, and so the route, depend on the date). It is the
 * route's exact time in this sketch's model, not an estimate. Across the
 * lunar month each hand-off date has exactly one release per way.
 *
 * A secant solve from `seedJd` (the last answer, usually close) settles in a
 * few flights. If it does not, the whole span of possible leads is scanned
 * and the crossing bracketed, taking the one nearest the seed.
 *
 * spec = { jdHandoff, card, way, seedJd, releaseRadius, allowImpact } —
 * allowImpact passes through to flyEarthPassDeparture. Returns the flight
 * (flyLunarDeparture's shape, its `jd` the release) with `jdHandoff` added, or
 * { ok: false, reason } — the refusal most of the searched dates met, or
 * "no-release-date" when every date flies but none reaches the SOI then.
 */
export function releaseForHandoff(spec) {
	var H = spec.jdHandoff;
	function flyAt(rel) {
		return flyLunarDeparture({ jd: rel, card: spec.card, way: spec.way,
		                           releaseRadius: spec.releaseRadius,
		                           allowImpact: spec.allowImpact });
	}
	// Signed miss (days) of the flight released at `rel`; null if it has no
	// crossing to time, with the refusal tallied for the report below.
	var refusals = {};
	function miss(rel) {
		var f = flyAt(rel);
		if (f.ok && f.soiExit) { return { f: f, F: rel + f.soiExit.dt / DAY - H }; }
		var why = f.reason || "no-coast";
		refusals[why] = (refusals[why] || 0) + 1;
		return null;
	}
	function done(m) {
		var f = m.f;
		f.jdHandoff = H;
		return f;
	}
	var lead0 = spec.way === "long" ? 4.6 : 2.5;
	var seed = isFinite(spec.seedJd) ? spec.seedJd : H - lead0;
	if (!(seed < H - LEAD_MIN_DAYS && seed > H - LEAD_MAX_DAYS)) { seed = H - lead0; }

	// Quick solve: secant on the miss, steps capped at a day.
	var a = seed, ma = miss(a);
	if (ma) {
		var b = H - ma.f.soiExit.dt / DAY, mb = miss(b);
		for (var i = 0; mb && i < 12; i++) {
			if (Math.abs(mb.F) < RELEASE_TOL_DAYS) { return done(mb); }
			var slope = (mb.F - ma.F) / (b - a);
			var step = (isFinite(slope) && Math.abs(slope) > 1e-6) ? -mb.F / slope : -mb.F;
			step = Math.max(-1, Math.min(1, step));
			a = b; ma = mb;
			b = b + step;
			if (!(b < H - LEAD_MIN_DAYS && b > H - LEAD_MAX_DAYS)) { break; }
			mb = miss(b);
		}
	}

	// Fallback: scan every possible lead for a sign change, bisect each, and
	// keep the root nearest the seed. A half-day pass first finds which leads
	// fly at all — on a date where this way has no route, usually none do, and
	// that settles it cheaply — then tenth-of-a-day steps search only within
	// half a day of a lead that flew (coarser steps step over crossings that
	// sit close to a seam between routes). A jump in the miss larger than a
	// day is such a seam, not a crossing, and is stepped over.
	var COARSE = 0.5, FINE = 0.1, flies = [];
	for (var rc = H - LEAD_MAX_DAYS; rc <= H - LEAD_MIN_DAYS + 1e-9; rc += COARSE) {
		if (miss(rc)) { flies.push(rc); }
	}
	function nearFlying(rel) {
		for (var j = 0; j < flies.length; j++) { if (Math.abs(flies[j] - rel) <= COARSE + 1e-9) { return true; } }
		return false;
	}
	var best = null, prev = null;
	for (var rel = H - LEAD_MAX_DAYS; flies.length && rel <= H - LEAD_MIN_DAYS + 1e-9; rel += FINE) {
		if (!nearFlying(rel)) { prev = null; continue; }
		var m = miss(rel);
		if (m && prev && (m.F > 0) !== (prev.m.F > 0) && Math.abs(m.F - prev.m.F) < 1) {
			var lo = prev.rel, hi = rel, flo = prev.m.F, mid = null;
			for (var k = 0; k < 50; k++) {
				var c = 0.5 * (lo + hi), mc = miss(c);
				if (!mc) { break; }
				mid = mc;
				if (Math.abs(mc.F) < RELEASE_TOL_DAYS) { break; }
				if ((mc.F > 0) === (flo > 0)) { lo = c; flo = mc.F; } else { hi = c; }
			}
			if (mid && Math.abs(mid.F) < 1e-5 &&
				(!best || Math.abs(mid.f.jd - seed) < Math.abs(best.f.jd - seed))) { best = mid; }
		}
		prev = m ? { rel: rel, m: m } : null;
	}
	if (best) { return done(best); }
	// No release crosses then. The refusal met most often over the span says
	// why better than a bare "no date" — typically that the pass the timing
	// needs would hit Earth.
	var worst = null;
	Object.keys(refusals).forEach(function (k) { if (!worst || refusals[k] > refusals[worst]) { worst = k; } });
	return { ok: false, reason: worst || "no-release-date" };
}

/* TARGET MODE AT A FIXED HAND-OFF: which card, released when, leaves Earth's
 * SOI at the hand-off epoch on the wanted v∞? The card depends on the release
 * date (the Moon does) and the flight time on the card, so the solve runs on
 * the release date alone: at each trial date solveLunarCard finds the card
 * that gives the wanted v∞ from there, and the date moves by the miss between
 * that card's crossing and the hand-off — a secant, as releaseForHandoff's,
 * with the same fallback scan over every possible lead when it does not
 * settle.
 *
 * spec = { jdHandoff, vInfVec, seedCard, at, way, seedJd }, the same meanings
 * as solveLunarCard's and releaseForHandoff's. Returns { ok: true, card,
 * flight, err } with `flight` released at the solved date, or { ok: false,
 * reason }.
 */
export function solveLunarCardAtHandoff(spec) {
	var H = spec.jdHandoff, card = spec.seedCard, firstReason = null;
	function at(rel) {
		var s = solveLunarCard({ jd: rel, vInfVec: spec.vInfVec, seedCard: card,
		                         at: spec.at, way: spec.way });
		if (!s.ok || !s.flight.soiExit) {
			if (!firstReason) { firstReason = s.reason || "no-coast"; }
			return null;
		}
		card = s.card;
		return { s: s, F: rel + s.flight.soiExit.dt / DAY - H };
	}
	function done(m) {
		m.s.flight.jdHandoff = H;
		return { ok: true, card: m.s.card, flight: m.s.flight, err: m.s.err };
	}
	var lead0 = spec.way === "long" ? 4.6 : 2.5;
	var seed = isFinite(spec.seedJd) ? spec.seedJd : H - lead0;
	if (!(seed < H - LEAD_MIN_DAYS && seed > H - LEAD_MAX_DAYS)) { seed = H - lead0; }

	var a = seed, ma = at(a);
	if (ma) {
		var b = H - ma.s.flight.soiExit.dt / DAY, mb = at(b);
		for (var i = 0; mb && i < 12; i++) {
			if (Math.abs(mb.F) < RELEASE_TOL_DAYS) { return done(mb); }
			var slope = (mb.F - ma.F) / (b - a);
			var step = (isFinite(slope) && Math.abs(slope) > 1e-6) ? -mb.F / slope : -mb.F;
			step = Math.max(-1, Math.min(1, step));
			a = b; ma = mb;
			b = b + step;
			if (!(b < H - LEAD_MIN_DAYS && b > H - LEAD_MAX_DAYS)) { break; }
			mb = at(b);
		}
	}

	var best = null, prev = null;
	for (var rel = H - LEAD_MAX_DAYS; rel <= H - LEAD_MIN_DAYS + 1e-9; rel += 0.5) {
		var m = at(rel);
		if (m && prev && (m.F > 0) !== (prev.m.F > 0) && Math.abs(m.F - prev.m.F) < 2) {
			var lo = prev.rel, hi = rel, flo = prev.m.F, mid = null;
			for (var k = 0; k < 50; k++) {
				var c = 0.5 * (lo + hi), mc = at(c);
				if (!mc) { break; }
				mid = mc;
				if (Math.abs(mc.F) < RELEASE_TOL_DAYS) { break; }
				if ((mc.F > 0) === (flo > 0)) { lo = c; flo = mc.F; } else { hi = c; }
			}
			if (mid && Math.abs(mid.F) < 1e-5 &&
				(!best || Math.abs(mid.s.flight.jd - seed) < Math.abs(best.s.flight.jd - seed))) { best = mid; }
		}
		prev = m ? { rel: rel, m: m } : null;
	}
	if (best) { return done(best); }
	return { ok: false, reason: firstReason || "no-card-solution" };
}

/* THE DEPARTURE LEG AS POINTS, for drawing: geocentric positions (m) along
 * the flight from the release at the Moon to Earth's SOI, stepped by distance
 * over speed so the pass past perigee is as smooth as the slow climb out
 * (~100 steps per e-fold of distance, never coarser than 1/400 of the leg).
 * A flight marked `hitsEarth` stops where it meets Earth's surface.
 *
 * Returns { points, hitsEarth, tEnd } (tEnd in seconds after release), or
 * null for a flight with no crossing to run to.
 */
export function departurePath(flight) {
	if (!flight || !flight.ok || !flight.soiExit) { return null; }
	var r0 = flight.rMoon, v0 = O.vAdd(flight.u, flight.vMoon);
	var T = flight.soiExit.dt, maxStep = T / 400;
	function at(t) { return t > 0 ? O.propagateState(GM_EARTH, r0, v0, t) : { r: r0, v: v0 }; }
	var pts = [], t = 0, prevT = 0;
	for (var guard = 0; guard < 20000; guard++) {
		var st = at(t);
		if (O.vMag(st.r) <= R_EARTH) {
			// Into the surface between the last point and this one: bisect.
			var lo = prevT, hi = t;
			for (var k = 0; k < 40; k++) {
				var mid = 0.5 * (lo + hi);
				if (O.vMag(at(mid).r) > R_EARTH) { lo = mid; } else { hi = mid; }
			}
			pts.push(at(hi).r);
			return { points: pts, hitsEarth: true, tEnd: hi };
		}
		pts.push(st.r);
		if (t >= T) { break; }
		var dt = Math.min(maxStep, Math.max(10, 0.01 * O.vMag(st.r) / O.vMag(st.v)));
		prevT = t;
		t = Math.min(T, t + dt);
	}
	return { points: pts, hitsEarth: false, tEnd: T };
}
