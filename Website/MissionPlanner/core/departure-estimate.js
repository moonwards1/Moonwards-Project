/* MissionPlanner/core/departure-estimate.js — how long the departure leg
 * lasts, estimated from the plan alone.
 *
 * The frozen plan pins the Departure→Coast hand-off; the release happens
 * flight-time EARLIER. Nothing about the eventual tech or course is known
 * when the plan is frozen, so this estimate comes from the plan's own
 * numbers: the required hyperbolic excess (v∞ = hand-off velocity minus the
 * escape body's), and the hand-off epoch.
 * The estimate feeds two things: the Ephemeris tab's "Moon phase at launch"
 * widget (ephemeris-view.js's buildMoonWidget/updateMoonWidgets), and the
 * SEED for the departure leg's own releaseJd, which core/freeze.js writes at
 * mission creation. The ±1 d hand-off window absorbs the estimate's error.
 *
 * It is only a seed. The epoch belongs to the DEPARTURE PHASE from then on
 * (core/release-epoch.js) — the frozen plan neither stores it nor imposes it.
 * It is read back through releaseEpochFor() by moon-platform.js and the
 * platform roles, stamped as the Release flight event by departure-leg.js and
 * body-departure-leg.js, and used by mission-view.js's departureSpan as the
 * Departure slider's pinned LEFT edge, for every origin alike. The slider's
 * floating right edge uses departureDefaultSpanSeconds, which re-derives its
 * own estimate rather than reading this one, so before a tech resolves a real
 * flight that edge can sit slightly away from where the SOI-exit event will
 * actually land.
 *
 * A MOON origin is not estimated at all: core/lunar-departure.js solves that
 * flight exactly, integrating Earth + Moon + Sun from the release to Earth's
 * SOI edge, and this file delegates to it rather than keeping a cheaper,
 * wronger second answer. The three terms that decide a lunar departure — the
 * Moon's orbital velocity, the Moon's own well, Earth's remaining well — are
 * each worth 0.9 to 2.2 km/s at the hand-off, so there is no honest closed
 * form to fall back on.
 *
 * Every other origin, Earth included, uses the naive estimate (SOI radius /
 * v∞). Earth is not special here: a departure from Earth leaves from Earth,
 * the same as one from Mars leaves from Mars. It is a departure from the MOON
 * that starts a quarter of the way out and rides 1 km/s of the Moon's motion,
 * and that case is solved rather than approximated.
 *
 * v∞ IS ASYMPTOTIC HERE. The hand-off vector is the ship's velocity AT the SOI
 * edge, where the primary's potential is not yet spent — 929 m/s worth for
 * Earth. The two-body helpers below take the true hyperbolic excess, so the
 * edge speed is converted before it reaches them (`asymptoticVInf`). Feeding
 * the edge speed in directly overstates the energy and shortens the estimate
 * by 8% for a fast departure and 24% for a slow one.
 *
 * Also exports the Moon readouts the widget shows beside the estimate:
 * elongation (phase) and the Moon's speed along EARTH'S OWN heliocentric
 * prograde — the same prograde axis the waypoint gizmo uses, so the sign
 * visibly adds to or subtracts from a launch.
 *
 * Pure (no DOM, no THREE) — Node-testable. Frames note: LunarEphemeris
 * works geocentric ecliptic-of-date in km; the plan's vectors are ecliptic
 * J2000-ish from orbit.js elements. The ~0.4°/30 yr precession between the
 * two is far below this file's needs (a phase glyph and a speed readout).
 */

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { LunarEphemeris } from "../../Shared/lunar-ephemeris.js";
import { Frames } from "../../Shared/frames.js";
import { solveLunarDeparture } from "./lunar-departure.js";

var O = OrbitalMath;
var LE = LunarEphemeris;
var EARTH = systems.get("Earth");
var SUN = systems.get("Sun");
var GM_SUN = SUN.GM;
var DAY = 86400;

export var MOON_DIST = 3.844e8;   // m — mean lunar distance, where an arrival's lunar-vicinity catch happens
export var MIN_VINF = 10;         // m/s — below this there is no departure to time

function semiMajor(orbit) { return (orbit.apoapsis + orbit.periapsis) / 2; }

// The SOI a departure from `origin` actually has to leave, in metres — which
// for a satellite origin is its PRIMARY's, not its own (Frames.escapeReference
// For): a ship leaving the Moon is still deep inside Earth's SOI, and its
// departure phase does not end until it crosses Earth's. Measured against the
// Sun at the escape body's mean distance. (orbit.system is resolved by orbit.js
// to the parent System INSTANCE, so the "heliocentric orbit" check is an
// identity comparison, not a string.)
export function originSoiRadius(origin) {
	var sys = systems.get(Frames.escapeReferenceFor(origin));
	if (!sys || !sys.orbit || sys.orbit.system !== SUN) { return null; }
	return O.sphereOfInfluence(semiMajor(sys.orbit), sys.GM, GM_SUN);
}

// The true hyperbolic excess behind a speed measured AT the SOI edge, where
// the primary still has a grip. Returns 0 for an edge speed that is not
// actually escaping, so a caller sees "no departure" rather than a NaN.
export function asymptoticVInf(vAtSoiEdge, origin) {
	var sys = systems.get(Frames.escapeReferenceFor(origin));
	var rSoi = originSoiRadius(origin);
	if (!sys || rSoi == null) { return null; }
	return Math.sqrt(Math.max(0, vAtSoiEdge * vAtSoiEdge - 2 * sys.GM / rSoi));
}

// Moon–Sun elongation (deg, 0..360; 0 new, 90 first quarter, 180 full,
// 270 last quarter) — the phase the Ephemeris tab's Moon glyph draws.
export function moonElongationDeg(jd) {
	var m = LE.moonVector(jd);
	var lonMoon = Math.atan2(m[1], m[0]) * 180 / Math.PI;
	var e = (lonMoon - LE.sunLongitude(jd)) % 360;
	return e < 0 ? e + 360 : e;
}

// The Moon's geocentric speed (m/s) along Earth's own heliocentric prograde
// direction — the Moon widget's "Relative speed" bar, and the free speed
// ephemeris-view.js's assistedBurn folds into an authored departure burn.
// earthHelioV is Earth's heliocentric velocity (m/s) at the same date.
export function moonProgradeSpeed(jd, earthHelioV) {
	var v = LE.moonState(jd).v;                      // km/s
	return O.vDot([v[0] * 1e3, v[1] * 1e3, v[2] * 1e3], O.vUnit(earthHelioV));
}

// The estimate. spec = {
//   origin,      // origin-body name, e.g. "Earth" or "Moon"
//   vInfVec,     // m/s — hand-off velocity minus the ESCAPE body's (helio);
//                //   for a Moon origin that reference is Earth, not the Moon
//   jdHandoff,   // the plan's nominal Departure→Coast hand-off epoch
//   warm         // optional previous lunar solve, passed through to
//                //   core/lunar-departure.js for a Moon origin
// }
// Returns { ok: true, seconds, days, jdLaunch, profile, vInf } with profile
// "naive" or "lunar-integrated" (the latter also carrying the `solve` itself),
// or { ok: false, reason } when there's no meaningful departure to time
// ("no-vinf"), the origin has no heliocentric orbit record to escape from
// ("unknown-origin"), or a lunar solve did not converge (the solver's own
// reason). `vInf` is the TRUE hyperbolic excess, not the hand-off's edge speed.
export function estimateDeparture(spec) {
	var vEdge = O.vMag(spec.vInfVec || [0, 0, 0]);
	if (!(vEdge >= MIN_VINF)) { return { ok: false, reason: "no-vinf" }; }
	var rSoi = originSoiRadius(spec.origin);
	if (rSoi == null) { return { ok: false, reason: "unknown-origin" }; }
	var vInf = asymptoticVInf(vEdge, spec.origin);
	if (!(vInf >= MIN_VINF)) { return { ok: false, reason: "no-vinf" }; }

	function done(seconds, profile) {
		return { ok: true, seconds: seconds, days: seconds / DAY,
		         jdLaunch: spec.jdHandoff - seconds / DAY, profile: profile, vInf: vInf };
	}

	// A lunar departure is solved, not estimated — see the header.
	if (spec.origin === "Moon") {
		var s = solveLunarDeparture({ vInfVec: spec.vInfVec, jdHandoff: spec.jdHandoff,
		                              warm: spec.warm });
		if (!s.ok) { return { ok: false, reason: s.reason }; }
		return { ok: true, seconds: s.lead * DAY, days: s.lead, jdLaunch: s.jdRelease,
		         profile: "lunar-integrated", vInf: vInf, solve: s };
	}

	return done(rSoi / vInf, "naive");
}

// The arrival mirror (destination Earth): time (s) to cross INBOUND from
// Earth's SOI down to the Moon's distance — where a lunar-vicinity tech
// makes its catch. Direct profile only (two-body time symmetry of
// soiExitTimeDirect; the dive question is a departure's). vInfVec is the
// ship's velocity minus Earth's at the rendezvous epoch jdRendezvous, measured
// AT the SOI edge, so it is converted to the true excess the same way a
// departure's is.
export function estimateArrival(vInfVec, jdRendezvous) {
	var vEdge = O.vMag(vInfVec || [0, 0, 0]);
	if (!(vEdge >= MIN_VINF)) { return { ok: false, reason: "no-vinf" }; }
	var vInf = asymptoticVInf(vEdge, "Earth");
	if (!(vInf >= MIN_VINF)) { return { ok: false, reason: "no-vinf" }; }
	var t = O.soiExitTimeDirect(EARTH.GM, vInf, MOON_DIST, originSoiRadius("Earth"));
	if (t == null) { return { ok: false, reason: "degenerate" }; }
	return { ok: true, seconds: t, days: t / DAY,
	         jdSoiEntry: jdRendezvous - t / DAY, vInf: vInf };
}
