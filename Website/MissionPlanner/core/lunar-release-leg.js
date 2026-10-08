/* MissionPlanner/core/lunar-release-leg.js — the stretch of a lunar departure
 * BEFORE the Earth-SOI crossing, for the Ephemeris tab's Origin view.
 *
 * core/lunar-departure.js flies a departure from the release to Earth's SOI and
 * reports only the crossing; this file lays out what lies before it, as one
 * geocentric path in time since the release (tau = 0 at the release epoch, the
 * tab's date; tau = coast at the crossing):
 *
 *   tau in [0, tMoon]   the escape hyperbola about the MOON, from a low lunar
 *                       orbit (periapsis, at the release epoch) out to the
 *                       Moon's SOI edge, translating with the Moon
 *                       (core/release-arc.js, Moon-centred);
 *   tau in [tMoon, coast]   the Earth-frame coast core/lunar-departure.js flies:
 *                       two-body about Earth from the Moon's CENTRE at the
 *                       release epoch, velocity the Moon's plus the card's
 *                       release share `u`.
 *
 * THE TWO PIECES ARE NOT A PATCHED CONIC, and the join shows it. The Earth
 * coast is the sketch's own model: it starts at the Moon's centre at the
 * release and takes the Moon's well as paid once, by radius, in the release
 * speed. The hyperbola is the Moon-centred picture of that same release. They
 * agree on the energy (the periapsis speed is `releaseSpeedFor` at the low
 * orbit) and the departure direction (the hyperbola leaves the Moon's SOI along
 * `u`), and they disagree on where the ship is once it is out: the Earth coast
 * has it a little short of the SOI edge, because it ignores that the ship is
 * fastest near the Moon. `lunarSeamGap` and `lunarPatchedExit` measure both,
 * for anyone judging the sketch; neither bends the drawn flight.
 *
 * Timing is therefore the flight's own: the release is the tab's epoch and the
 * crossing is `coast` later, exactly what core/departure-estimate.js and the
 * Moon widget report. The hyperbola adds no time before the release.
 *
 * Pure (no DOM, no THREE) and Node-testable.
 */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { systems } from "../../Shared/orbit.js";
import { SOI_MOON, SOI_EARTH, moonGeoPos, moonGeoVel } from "../../Shared/geo-leg.js";
import { releaseArc, releaseArcStateAt } from "./release-arc.js";

var O = OrbitalMath;
var MOON = systems.get("Moon");
var GM_EARTH = systems.get("Earth").GM;
var DAY = 86400;

// flight — a successful core/lunar-departure.js flyLunarDeparture result.
// Returns null when it has no Earth-SOI crossing to end on; otherwise
// { jd0, coast, rMoon, vMoon, vTotal, moonArc, tMoon, release }
// where moonArc is null when the release share does not escape the Moon's
// well on its own (the leg then starts at the Moon's centre), tMoon the
// hyperbola's duration (0 without one), and release the geocentric
// { r, v } at tau = 0.
export function lunarReleaseLeg(flight) {
	if (!flight || !flight.ok || !flight.soiExit || !(flight.soiExit.dt > 0)) { return null; }
	var rMoon = flight.rMoon, vMoon = flight.vMoon;
	var vTotal = O.vAdd(vMoon, flight.u);
	var pole = MOON.pole ? O.poleVectorEcliptic(MOON.pole.ra, MOON.pole.dec) : null;
	var arc = releaseArc({ GM: MOON.GM, rLow: MOON.lowOrbit.periapsis, rSoi: SOI_MOON,
		vEdgeVec: flight.u, pole: pole });
	var moonArc = arc.ok ? arc : null;
	var release = moonArc
		? { r: O.vAdd(rMoon, moonArc.release.r), v: O.vAdd(vMoon, moonArc.release.v) }
		: { r: rMoon.slice(), v: vTotal.slice() };
	return { jd0: flight.jd, coast: flight.soiExit.dt, rMoon: rMoon, vMoon: vMoon, vTotal: vTotal,
	         moonArc: moonArc, tMoon: moonArc ? moonArc.tExit : 0, release: release };
}

// Geocentric { r, v } at tau seconds after the release, tau in [0, leg.coast].
export function lunarReleaseLegStateAt(leg, tau) {
	var t = Math.max(0, Math.min(leg.coast, tau));
	if (leg.moonArc && t <= leg.tMoon) {
		var jd = leg.jd0 + t / DAY;
		var rel = releaseArcStateAt(leg.moonArc, t);
		return { r: O.vAdd(moonGeoPos(jd), rel.r), v: O.vAdd(moonGeoVel(jd), rel.v) };
	}
	var s = O.propagateState(GM_EARTH, leg.rMoon, leg.vTotal, t);
	return { r: s.r, v: s.v };
}

// The hyperbola about the Moon as `count`+1 geocentric samples { r, v, tau },
// densest at the release. Empty when there is no hyperbola.
export function lunarMoonLegSamples(leg, count) {
	var out = [];
	if (!leg.moonArc) { return out; }
	for (var i = 0; i <= count; i++) {
		var tau = leg.tMoon * Math.pow(i / count, 2);
		var s = lunarReleaseLegStateAt(leg, tau);
		out.push({ r: s.r, v: s.v, tau: tau });
	}
	return out;
}

// How far apart the two pieces are where they join (tau = tMoon): the end of
// the Moon hyperbola against the Earth coast, in metres, and the same for the
// velocities. null with no hyperbola.
export function lunarSeamGap(leg) {
	if (!leg.moonArc) { return null; }
	var a = lunarReleaseLegStateAt(leg, leg.tMoon);
	var jd = leg.jd0 + leg.tMoon / DAY;
	var b = O.propagateState(GM_EARTH, leg.rMoon, leg.vTotal, leg.tMoon);
	return { position: O.vMag(O.vSub(a.r, b.r)), velocity: O.vMag(O.vSub(a.v, b.v)),
	         moonDistance: O.vMag(O.vSub(a.r, moonGeoPos(jd))) };
}

// What the crossing time would be if the flight WERE patched at the Moon's SOI:
// the Earth coast starting from where the hyperbola leaves the Moon's sphere,
// in the state it leaves with. Seconds from the release to Earth's SOI, or null
// with no hyperbola or no crossing. Compare with leg.coast.
export function lunarPatchedExit(leg) {
	if (!leg.moonArc) { return null; }
	var a = lunarReleaseLegStateAt(leg, leg.tMoon);
	var t2 = O.coastTimeToRadius(GM_EARTH, a.r, a.v, SOI_EARTH);
	return t2 == null ? null : leg.tMoon + t2;
}
