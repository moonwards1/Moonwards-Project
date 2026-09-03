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
import { asymptoticVInf } from "./departure-estimate.js";

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
