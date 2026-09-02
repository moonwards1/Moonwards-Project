/* MissionPlanner/core/lunar-departure — the departure flight from the Moon,
 * flown FORWARD from the release to Earth's SOI edge.
 *
 * A Moon origin is the one origin where the body a ship leaves and the body
 * whose sphere of influence its departure phase exits are different bodies
 * (Shared/frames.js's `escapeReferenceFor`). Leaving the Moon puts a ship
 * 66,168 km from the Moon and still 850,000 km inside Earth's SOI; the
 * departure is not over until it crosses THAT boundary.
 *
 * WHAT IS GIVEN, AND WHAT COMES OUT. The release is the input: an epoch, and
 * an impulse in the Moon's own geocentric frame. The ship starts at the edge
 * of the Moon's sphere of influence, carrying the Moon's velocity at that
 * epoch plus that impulse, and is integrated with Earth + Moon + Sun gravity
 * (Shared/geo-leg.js) until it crosses Earth's SOI. Where and when it crosses,
 * and how fast, are OUTPUTS. Nothing here solves backwards, and there is no
 * hand-off to converge on.
 *
 * That direction is the whole point. The Moon's ~1,022 m/s of orbital velocity
 * points a different way every day of the month, and at Earth's SOI edge that
 * shows up as a heading — a 3 km/s release that leaves along Earth's prograde
 * at one lunar phase leaves nearly retrograde a fortnight later. Since the
 * departure's heliocentric speed is Earth's 30 km/s plus that rotating vector,
 * the resulting arc's aphelion swings from under 1 AU to past 1.5 AU across
 * one lunar month for an unchanged release. Fixing a velocity at Earth's SOI
 * and asking what release delivers it inverts that: it pins the one quantity
 * the Moon's phase controls, and the trajectory stops responding to the launch
 * date at all.
 *
 * THE RELEASE POINT is one Moon-SOI radius along the impulse direction — the
 * ship went out the way it was thrown. The impulse is therefore the ship's
 * velocity relative to the Moon with the Moon's well already spent (its
 * hyperbolic excess there), not the speed a release mechanism has to supply
 * down at the surface. `releaseSpeedFor` converts between the two for a given
 * release radius; only the RADIUS enters that step, never a direction, so the
 * conversion is one line of vis-viva and the flight above does not depend on
 * it.
 *
 * IMPACTS AND CAPTURES ARE REPORTED, NOT REJECTED. A release that falls back
 * on the Moon, hits Earth, or simply fails to escape returns ok: false with
 * the integrated flight attached, so a caller can still draw what happened.
 *
 * Pure (no DOM, no THREE) and Node-testable, like the rest of core/.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { systems } from "../../Shared/orbit.js";
import { SOI_EARTH, SOI_MOON, moonGeoPos, moonGeoVel, integrateTrajectory }
	from "../../Shared/geo-leg.js";

var O = OrbitalMath;
var GM_MOON = systems.get("Moon").GM;
var R_MOON = Number(systems.get("Moon").radius);
var DAY = 86400;

// The altitude the reported release speed is quoted at — a nominal skyhook
// release, not a commitment.
export var RELEASE_ALTITUDE = 100e3;

// The speed a release at radius rRelease must have to reach the Moon's SOI
// edge with excess speed uMag. An exact two-body step through the Moon's well,
// and exact is not an overstatement: against the full Earth+Moon+Sun
// integration it reproduces the release speed to 0.1%.
export function releaseSpeedFor(uMag, rRelease) {
	var r = rRelease == null ? R_MOON + RELEASE_ALTITUDE : rRelease;
	return Math.sqrt(uMag * uMag + 2 * GM_MOON * (1 / r - 1 / SOI_MOON));
}

// The Moon's velocity at `jd` plus an impulse stated in the Moon's own
// geocentric orbital frame — prograde along the Moon's motion, normal
// ecliptic-up, radial completing the set. Exported because the Ephemeris tab's
// departure card holds exactly these three components and needs to read them
// back as a vector (and the readout boxes need the frame's axes).
export function releaseVelocity(jd, burn) {
	var b = burn || {};
	return O.applyBurn(moonGeoPos(jd), moonGeoVel(jd),
	                   b.pro || 0, b.nrm || 0, b.rad || 0);
}

// Where the flight crosses Earth's SOI, interpolated between the two samples
// that straddle it. Null if it never gets there.
function soiCrossing(samples, jd0) {
	for (var i = 1; i < samples.length; i++) {
		var a = O.vMag(samples[i - 1].r), b = O.vMag(samples[i].r);
		if (a < SOI_EARTH && b >= SOI_EARTH) {
			var f = (SOI_EARTH - a) / (b - a), s0 = samples[i - 1], s1 = samples[i];
			var t = s0.t + f * (s1.t - s0.t);
			return {
				t: t, jd: jd0 + t / DAY,
				r: O.vAdd(s0.r, O.vScale(O.vSub(s1.r, s0.r), f)),
				v: O.vAdd(s0.v, O.vScale(O.vSub(s1.v, s0.v), f))
			};
		}
	}
	return null;
}

// The flight. spec = {
//   jd,            // the release epoch — the Departure phase's own start
//   burn,          // { pro, rad, nrm } m/s, in the Moon's geocentric frame
//   releaseRadius  // optional, for the quoted release speed only (default 100 km)
// }
//
// Returns, on success:
//   { ok: true, jdRelease, u, uMag, releaseSpeed, r0, v0, leg,
//     exit: { jd, t, r, v },        // geocentric, on Earth's SOI sphere
//     flightDays }
// and on failure { ok: false, reason, leg, r0, v0 } with reason one of
// "no-impulse" (nothing was thrown), "impact-Moon", "impact-Earth", or
// "no-escape" (never reaches Earth's SOI within the integration).
export function flyLunarDeparture(spec) {
	var jd = spec.jd;
	var vRel = releaseVelocity(jd, spec.burn);
	var mV = moonGeoVel(jd);
	var u = O.vSub(vRel, mV), uMag = O.vMag(u);
	if (!(uMag > 1e-6)) { return { ok: false, reason: "no-impulse" }; }

	// One Moon-SOI radius along the way it was thrown.
	var r0 = O.vAdd(moonGeoPos(jd), O.vScale(O.vUnit(u), SOI_MOON));
	var v0 = O.vAdd(mV, u);

	var leg = integrateTrajectory(r0, v0, jd, {});
	var base = { leg: leg, r0: r0, v0: v0, u: u, uMag: uMag, jdRelease: jd,
	             releaseSpeed: releaseSpeedFor(uMag, spec.releaseRadius) };
	if (leg.impact) {
		return Object.assign({ ok: false, reason: "impact-" + leg.impact }, base);
	}
	var exit = soiCrossing(leg.samples, jd);
	if (!exit) { return Object.assign({ ok: false, reason: "no-escape" }, base); }
	return Object.assign({ ok: true, exit: exit, flightDays: exit.t / DAY }, base);
}
