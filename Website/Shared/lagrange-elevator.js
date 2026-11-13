/* Shared/lagrange-elevator.js — the kinematics of a lunar elevator hanging
 * through an Earth–Moon Lagrange point: L1, on the near side toward Earth, or
 * L2, on the far side away from it.
 *
 * Leaving its own swinging aside, such an elevator lies along the line through
 * the Moon's centre and Earth's, and turns with that line, so the Moon's
 * ephemeris is its clock. A point of it at distance s from the Moon's centre,
 * on the elevator's own side, is at
 *
 *     r(s) = r_M + s * u                    u = sign * (r_E - r_M) / D
 *     v(s) = v_M + s * du/dt
 *
 *     r_M, v_M   the Moon's geocentric position and velocity (the ephemeris)
 *     r_E        Earth's position: the origin
 *     D          the Earth–Moon distance at that instant
 *     sign       +1 for L1 (u points at Earth), -1 for L2 (u points away)
 *     u          unit vector from the Moon's centre out along the elevator
 *     du/dt      how fast u turns (Shared/kinematic-chain.js's lineFrame)
 *
 * so each point keeps its distance from the Moon and is carried round Earth at
 * the line's own turning rate — faster near perigee, slower near apogee. A
 * point on the L2 side is further from Earth than the Moon and so moves round
 * it faster than the Moon does; far enough out it is beyond Earth's escape
 * speed. A point on the L1 side moves slower.
 *
 * The Lagrange point is not a point of the tether: it is the place on the line
 * where the pulls balance, a fixed fraction of the Earth–Moon distance from
 * the Moon (Shared/math-utils.js's lagrangeL1Fraction, lagrangeL2Fraction),
 * so it slides along the tether as that distance changes over the month:
 *
 *     s_L = gamma * D                       gamma = 0.1509 (L1), 0.1679 (L2)
 *
 * The legs' anchors are fixed to the Moon's body, which turns at a steady rate
 * about its own pole (Shared/lunar-ephemeris.js's moonOrientation), so they
 * nod about the line with the Moon's librations.
 *
 * The same point, as an element of a departure chain, is lineElementFor's
 * kinematic-chain line element: one formula serves a plotter drawing the
 * elevator and a chain releasing a ship from it.
 *
 * Pure (no DOM, no THREE): Node-tested in Shared/tests/lagrange-elevator.test.js.
 *
 * Imports from ./ — this file breaks if moved without orbit.js, math-utils.js,
 * lunar-ephemeris.js and kinematic-chain.js.
 */

import { systems } from "./orbit.js";
import { OrbitalMath } from "./math-utils.js";
import { LunarEphemeris } from "./lunar-ephemeris.js";
import { lineFrame, lineElement } from "./kinematic-chain.js";

var O = OrbitalMath;
var GM_EARTH = systems.get("Earth").GM, GM_MOON = systems.get("Moon").GM;
var DEG = Math.PI / 180;

// The two sides an elevator can hang on. `sign` is the direction of u along
// the Moon-to-Earth line; `fraction` is gamma, the Lagrange point's distance
// from the Moon's centre as a fraction of the Earth–Moon distance.
export var LAGRANGE_SIDES = {
	L1: { side: "L1", sign: 1, fraction: O.lagrangeL1Fraction(GM_EARTH, GM_MOON) },
	L2: { side: "L2", sign: -1, fraction: O.lagrangeL2Fraction(GM_EARTH, GM_MOON) }
};

export function lagrangeSide(side) {
	var S = LAGRANGE_SIDES[side];
	if (!S) { throw new Error("lagrange-elevator: unknown side '" + side + "'"); }
	return S;
}

// The elevator's line at Julian date jd, for side "L1" or "L2".
//   side       the side asked for
//   moon       the Moon's geocentric { r, v }
//   D, dDot    the Earth–Moon distance and its rate, m and m/s
//   u, uDot    unit vector from the Moon's centre out along the elevator, and
//              its rate (1/s)
//   travel     unit vector the way the line is carried round Earth (the Moon's
//              own sense of motion, whichever side)
//   turnRate   how fast the line turns, rad/s
//   rLagrange  the Lagrange point's distance from the Moon's centre, m
export function lagrangeLineAt(side, jd) {
	var S = lagrangeSide(side), f = lineFrame("Moon", "Earth", jd);
	return {
		side: S.side, moon: f.body, D: f.D, dDot: f.dDot,
		u: O.vScale(f.u, S.sign), uDot: O.vScale(f.uDot, S.sign),
		travel: O.vScale(f.uDot, -1 / f.turnRate), turnRate: f.turnRate,
		rLagrange: S.fraction * f.D
	};
}

// State of the elevator's point at distance s from the Moon's centre, given
// lagrangeLineAt's result `at` for the instant wanted: { r, v } geocentric
// (m, m/s) and { relR, relV } relative to the Moon.
export function linePointState(at, s) {
	var relR = O.vScale(at.u, s), relV = O.vScale(at.uDot, s);
	return { r: O.vAdd(at.moon.r, relR), v: O.vAdd(at.moon.v, relV), relR: relR, relV: relV };
}

// The kinematic-chain element (Shared/kinematic-chain.js) of the elevator's
// point at distance s from the Moon's centre, for a chain based on the Moon.
export function lineElementFor(side, s) {
	return lineElement("Moon", "Earth", lagrangeSide(side).sign * s);
}

// Where anchors at selenographic { lat, lon } (degrees) are at Julian date jd:
// positions relative to the Moon's centre, m, on a sphere of radius R.
export function anchorPositions(anchors, R, jd) {
	var o = LunarEphemeris.moonOrientation(jd), east = O.vCross(o.pole, o.meridian);
	return anchors.map(function (a) {
		var cb = Math.cos(a.lat * DEG);
		return O.vScale(O.vAdd(O.vAdd(O.vScale(o.meridian, cb * Math.cos(a.lon * DEG)),
			O.vScale(east, cb * Math.sin(a.lon * DEG))), O.vScale(o.pole, Math.sin(a.lat * DEG))), R);
	});
}
