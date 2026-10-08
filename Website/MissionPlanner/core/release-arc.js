/* MissionPlanner/core/release-arc.js — the escape hyperbola from a low orbit
 * out to the origin body's SOI edge, sketched for the Ephemeris tab's origin
 * view.
 *
 * The arc starts at a RELEASE POINT on the body's equatorial plane, at the
 * periapsis of a hyperbola about the body, and is traced forward to the SOI
 * edge. The exit point is where it arrives; nothing is placed by hand.
 *
 * What fixes the hyperbola:
 *   - the Departure card supplies the energy (its edge speed gives the true
 *     hyperbolic excess) and the heading (its direction is the velocity
 *     direction at the SOI edge);
 *   - the periapsis radius is the body's low orbit (Shared/orbit.js,
 *     `lowOrbit`), so periapsis speed and eccentricity follow;
 *   - the release point is the point on the body's equator, moving in the
 *     body's spin sense (prograde), whose hyperbola leaves closest to the
 *     card's heading.
 *
 * The geometry of that last choice. A hyperbola's outbound asymptote makes a
 * fixed angle with its periapsis direction, acos(-1/e), larger than 90 deg. So
 * the release point must lie on the cone of that half-angle about the heading,
 * and the equator is a circle; they meet where
 *     cos(angle) = cos(declination of heading) * cos(longitude difference).
 * Of the two meetings the prograde one is used (the ship's angular momentum has
 * a positive component along the spin pole). The orbit plane is then the plane
 * through the release point and the heading, which is generally tilted against
 * the equator, i.e. the release is at the node of an inclined parking orbit.
 *
 * A heading the equator cannot reach — a slow departure aimed steeply out of
 * the equatorial plane — has no exact solution. The release point nearest to it
 * is used and the arc leaves a little off the card's heading; the sketch does
 * not describe that, mission design does. `headingErrorDeg` reports the miss.
 *
 * Timing is independent of all of that geometry: the time from periapsis to
 * the SOI edge depends only on the excess speed, the periapsis radius and the
 * SOI radius (O.soiExitTimeDirect), which is also what core/departure-estimate.js
 * uses, so the arc and the release-epoch seed agree.
 *
 * Frame: body-centred, ecliptic J2000 axes (the planner's own), SI units.
 * Pure — no DOM, no THREE — and Node-testable.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";

var O = OrbitalMath;

// Unit vector perpendicular to n; any one will do.
function anyPerpendicular(n) {
	var seed = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	return O.vUnit(O.vCross(n, seed));
}

// The release point's direction pHat and the in-plane direction wHat that
// leads toward the heading, for an outbound asymptote along `a` (unit), spin
// pole `n` (unit) and asymptote-to-periapsis angle `theta`.
function releaseFrame(a, n, theta) {
	var aEq = O.vSub(a, O.vScale(n, O.vDot(a, n)));
	var cd = O.vMag(aEq);                                 // cosine of the heading's declination
	var uq = cd > 1e-9 ? O.vScale(aEq, 1 / cd) : anyPerpendicular(n);
	// cos(angle) = cd * cos(dLon); angle is `theta`, clamped to what the
	// equator can reach (cos in [-1, 1]) when the heading is out of range.
	var ratio = Math.max(-1, Math.min(1, Math.cos(theta) / Math.max(cd, 1e-9)));
	var dLon = Math.acos(ratio);                          // in [pi/2, pi]: the release is behind the heading
	var pHat = O.vSub(O.vScale(uq, Math.cos(dLon)), O.vScale(O.vCross(n, uq), Math.sin(dLon)));
	var w = O.vSub(a, O.vScale(pHat, O.vDot(a, pHat)));
	var wHat = O.vMag(w) > 1e-9 ? O.vUnit(w) : O.vCross(n, pHat);
	return { pHat: pHat, wHat: wHat };
}

function toBody(frame, perifocal) {
	return {
		r: O.vAdd(O.vScale(frame.pHat, perifocal.r[0]), O.vScale(frame.wHat, perifocal.r[1])),
		v: O.vAdd(O.vScale(frame.pHat, perifocal.v[0]), O.vScale(frame.wHat, perifocal.v[1]))
	};
}

// spec = {
//   GM,        // m^3/s^2 — the escape body's
//   rLow,      // m — the release (periapsis) radius, from the body's centre
//   rSoi,      // m — the SOI radius the arc is traced to
//   vEdgeVec,  // m/s — the card: velocity at the SOI edge, body-relative
//   pole       // unit vector along the body's spin axis (ecliptic frame);
//              //   the ecliptic north [0,0,1] when the body has no pole data
// }
// Returns { ok: false, reason } with reason "bad-input", "no-escape" (the
// edge speed does not escape the body's well) or "degenerate"; otherwise
// {
//   ok: true,
//   vInf, e, rLow, rSoi, GM,
//   tExit,                  // s — periapsis to the SOI edge
//   release: { r, v },      // body-relative, at periapsis
//   exit:    { r, v },      // body-relative, at the SOI edge
//   normal,                 // unit orbit-plane normal (direction of h)
//   headingErrorDeg,        // exit velocity direction vs the card's
//   frame                   // internal: periapsis basis, for stateAt
// }
export function releaseArc(spec) {
	var GM = spec.GM, rLow = spec.rLow, rSoi = spec.rSoi;
	var edge = O.vMag(spec.vEdgeVec || [0, 0, 0]);
	if (!(GM > 0) || !(rLow > 0) || !(rSoi > rLow) || !(edge > 0)) { return { ok: false, reason: "bad-input" }; }
	var vInf2 = edge * edge - 2 * GM / rSoi;
	if (!(vInf2 > 0)) { return { ok: false, reason: "no-escape" }; }
	var vInf = Math.sqrt(vInf2);
	var e = 1 + rLow * vInf2 / GM;
	var theta = Math.acos(-1 / e);
	var tExit = O.soiExitTimeDirect(GM, vInf, rLow, rSoi);
	if (tExit == null) { return { ok: false, reason: "degenerate" }; }
	var n = spec.pole ? O.vUnit(spec.pole) : [0, 0, 1];
	var want = O.vUnit(spec.vEdgeVec);

	// The card gives the velocity direction AT the SOI edge, which sits a
	// little off the asymptote the geometry above is written for. Walk the
	// asymptote until the edge velocity lands on the card's direction.
	var a = want, frame, exit, vdir;
	for (var k = 0; k < 12; k++) {
		frame = releaseFrame(a, n, theta);
		exit = toBody(frame, O.hyperbolaPerifocal(GM, rLow, e, tExit));
		vdir = O.vUnit(exit.v);
		var miss = O.vSub(want, vdir);
		if (O.vMag(miss) < 1e-10) { break; }
		a = O.vUnit(O.vAdd(a, miss));
	}
	var peri = toBody(frame, O.hyperbolaPerifocal(GM, rLow, e, 0));
	return {
		ok: true, GM: GM, e: e, vInf: vInf, rLow: rLow, rSoi: rSoi, tExit: tExit,
		release: peri, exit: exit,
		normal: O.vUnit(O.vCross(frame.pHat, frame.wHat)),
		headingErrorDeg: Math.acos(Math.max(-1, Math.min(1, O.vDot(want, vdir)))) * 180 / Math.PI,
		frame: frame
	};
}

// Body-relative { r, v } on the arc `tau` seconds after the release, for tau
// in [0, arc.tExit].
export function releaseArcStateAt(arc, tau) {
	var t = Math.max(0, Math.min(arc.tExit, tau));
	return toBody(arc.frame, O.hyperbolaPerifocal(arc.GM, arc.rLow, arc.e, t));
}

// The arc as `count`+1 states { r, v, t }, t in seconds relative to the SOI
// exit (so -tExit at the release, 0 at the exit). Spaced finest at the
// release, where the path bends hardest and the ship is moving fastest.
export function releaseArcSamples(arc, count) {
	var out = [];
	for (var i = 0; i <= count; i++) {
		var tau = arc.tExit * Math.pow(i / count, 2);
		var s = releaseArcStateAt(arc, tau);
		out.push({ r: s.r, v: s.v, t: tau - arc.tExit });
	}
	return out;
}
