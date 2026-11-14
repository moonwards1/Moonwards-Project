// Space elevator physics, pure (no DOM). ES module:
//   import { computeSpaceElevator } from "./spaceElevatorModel.js";
//
// A cable from the equator of a rotating body, up past synchronous orbit to a
// counterweight at its tip: where synchronous orbit and the tip lie, and the
// orbit of a payload let go at the tip. Used by the home workbench's cards
// (spaceElevatorBench.js); the cable itself is sized by Shared/radial-tether.js.
//
// computeSpaceElevator(q), SI units:
//   q.GM, q.R            the body's gravitational parameter and radius
//   q.omega              its rotation rate, rad/s
//   q.rTip               tip (counterweight) radius; omitted, NaN or ≤ 0 →
//                        AUTO_TIP × synchronous radius
//   q.aSun               the body's distance from the Sun, m
// Returns { rSync, hSync, vSync, rTip, autoTip, vTip, aTip, vEsc, escapes, helio }:
//   helio      when the tip release escapes the body: { retroPeri, proApo }
//              (heliocentric periapsis of a release against the body's orbital
//              motion, apoapsis of one along it; m, NaN when the release
//              escapes the Sun); otherwise { bodyApo }, the apoapsis radius of
//              the orbit about the body. Each treats the tip speed as the
//              speed added to (or taken from) the body's circular orbital speed.

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";

export const AUTO_TIP = 1.2;

// Orbit of a release at radius r, tangential speed v, about a body of
// gravitational parameter GM: the far apsis radius, or NaN when unbound.
function farApsis(GM, r, v) {
	var E = 0.5 * v * v - GM / r;
	if (E >= 0) return NaN;
	var a = -GM / (2 * E), h = r * v;
	var e = Math.sqrt(Math.max(0, 1 + 2 * E * h * h / (GM * GM)));
	return a * (1 + e);
}
function nearApsis(GM, r, v) {
	var E = 0.5 * v * v - GM / r;
	if (E >= 0) return NaN;
	var a = -GM / (2 * E), h = r * v;
	var e = Math.sqrt(Math.max(0, 1 - h * h / (GM * a)));
	return a * (1 - e);
}

export function computeSpaceElevator(q) {
	var rSync = OrbitalMath.synchronousRadius(q.GM, q.omega);
	var autoTip = !(q.rTip > 0);
	var rTip = autoTip ? rSync * AUTO_TIP : q.rTip;
	var vTip = q.omega * rTip;
	var vEsc = OrbitalMath.escapeVelocity(q.GM, rTip);
	var out = {
		rSync: rSync, hSync: rSync - q.R, vSync: q.omega * rSync,
		rTip: rTip, autoTip: autoTip, vTip: vTip,
		aTip: q.omega * q.omega * rTip - q.GM / (rTip * rTip),   // net outward, rotating frame
		vEsc: vEsc, escapes: vTip >= vEsc
	};
	if (out.escapes) {
		var vBody = OrbitalMath.circularVelocity(Const.GM_sun, q.aSun);
		out.helio = {
			retroPeri: nearApsis(Const.GM_sun, q.aSun, Math.abs(vBody - vTip)),
			proApo: farApsis(Const.GM_sun, q.aSun, vBody + vTip)
		};
	} else {
		out.helio = { bodyApo: farApsis(q.GM, rTip, vTip) };
	}
	return out;
}
