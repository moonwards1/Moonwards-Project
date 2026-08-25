/* MissionPlanner/core/departure-estimate.js — how long the departure leg
 * lasts, estimated from the plan alone.
 *
 * The frozen plan pins the Departure→Coast hand-off; the release happens
 * flight-time EARLIER. Nothing about the eventual tech or course is known
 * when the plan is frozen, so this estimate comes from the plan's own
 * numbers: the required hyperbolic excess (v∞ = hand-off velocity minus the
 * origin body's), the hand-off epoch, and — for Earth — where the Moon is.
 * The estimate feeds two things: the Ephemeris tab's "Moon phase at launch"
 * widget (ephemeris-view.js's buildMoonWidget/updateMoonWidgets), and the
 * read-only release anchor core/freeze.js bakes into the plan as
 * frozen-plan's releaseAnchorJd. The ±1 d hand-off window absorbs the
 * estimate's error.
 *
 * That anchor is read back through frozen-plan.js's releaseAnchorFor(), and
 * consumed by frozen-plan.js's own epoch-compliance row, and — for every
 * origin, not just Earth — moon-platform.js, departure-leg.js and
 * body-departure-leg.js, which stamp
 * their Release flight event at exactly this epoch. mission-view.js's
 * departureSpan reads it directly too: for a satellite-carrier origin
 * (Earth/Moon), it is the Departure slider's pinned LEFT edge outright, even
 * before any departure tech resolves a real flight; other origins anchor the
 * RIGHT edge at the plan's committed hand-off instead and derive the LEFT edge
 * from it, so this anchor there only sets the pre-resolution floating edge's
 * starting guess (departureDefaultSpanSeconds re-derives its own estimate
 * rather than reading it, so that edge can sit slightly away from where a
 * resolved flight's own Release/SOI-exit events will land).
 *
 * Earth departures (this project's carriers all start near the Moon) use an
 * exact two-body SOI-exit time from the Moon's mean distance, choosing
 * between two course profiles by the Moon-wedge rule: DIVE-IN — the course
 * first drops to a low-perigee Oberth pass — when the Moon sits within ±37.5°
 * of the direction OPPOSITE the exit heading (the geometry that forces the
 * ship to cross Earth's vicinity: around first quarter for a prograde launch,
 * last quarter for retrograde); DIRECT-OUT otherwise. The wedge is narrower
 * than the geometric quarter because near its edges the dive's benefit
 * diminishes — there the flyby only pays when a cheap plane change justifies
 * its cost in departure prograde/retrograde speed, and a planner who wants
 * that can force the profile (spec.profile below). The check is the sign test
 * dot(moonHat, exitHat) < −cos 37.5°, evaluated in TWO bounded passes: a
 * tentative direct-out launch date locates the Moon, the profile is chosen,
 * the estimate is final. Never an iteration — a derived release date that
 * keeps moving would slide the Moon under the user. Measured against the
 * shipped skyhook chain (v∞ 5.50 km/s): direct-out 1.75 d, dive-in 2.58 d vs
 * the chain's real 2.56 d, and that release genuinely dives (geocentric
 * perigee 24,200 km).
 *
 * Non-Earth origins have no Moon model and use the naive estimate
 * (SOI radius / v∞).
 *
 * Also exports the Moon readouts the widget shows beside the estimate:
 * elongation (phase) and the Moon's speed along EARTH'S OWN heliocentric
 * prograde — the same prograde axis the waypoint gizmo uses, so the sign
 * visibly adds to or subtracts from a launch.
 *
 * Pure (no DOM, no THREE) — Node-testable. Frames note: LunarEphemeris
 * works geocentric ecliptic-of-date in km; the plan's vectors are ecliptic
 * J2000-ish from orbit.js elements. The ~0.4°/30 yr precession between the
 * two is far below this file's needs (a wedge test and a phase glyph).
 */

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { LunarEphemeris } from "../../Shared/lunar-ephemeris.js";

var O = OrbitalMath;
var LE = LunarEphemeris;
var EARTH = systems.get("Earth");
var SUN = systems.get("Sun");
var GM_SUN = SUN.GM;
var DAY = 86400;

export var MOON_DIST = 3.844e8;                  // m — mean lunar distance (the carriers' start radius)
export var DIVE_PERIGEE = EARTH.radius + 200e3;  // m — the dive-in profile's Oberth perigee
export var MIN_VINF = 10;                        // m/s — below this there is no departure to time
export var DIVE_WEDGE_DEG = 75;                  // full width of the auto rule's dive-in wedge (see header)

// dot(moonHat, exitHat) below this dives: the Moon within ±(wedge/2) of the
// anti-exit direction.
var DIVE_DOT = -Math.cos((DIVE_WEDGE_DEG / 2) * Math.PI / 180);

function semiMajor(orbit) { return (orbit.apoapsis + orbit.periapsis) / 2; }

// SOI radius (m) of an origin body against the Sun, at its mean distance.
// (orbit.system is resolved by orbit.js to the parent System INSTANCE, so
// the "heliocentric orbit" check is an identity comparison, not a string.)
export function originSoiRadius(origin) {
	var sys = systems.get(origin);
	if (!sys || !sys.orbit || sys.orbit.system !== SUN) { return null; }
	return O.sphereOfInfluence(semiMajor(sys.orbit), sys.GM, GM_SUN);
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
//   origin,      // HELIO_BODIES name, e.g. "Earth"
//   vInfVec,     // m/s — hand-off velocity minus the origin body's (helio)
//   jdHandoff,   // the plan's nominal Departure→Coast hand-off epoch
//   profile      // optional Earth-course override: "dive-in" | "direct-out"
//                //   pins the profile (near the wedge's edge both are
//                //   genuinely viable, so the choice is the planner's);
//                //   anything else (or absent) = the auto wedge rule.
//                //   Ignored for non-Earth origins.
// }
// Returns { ok: true, seconds, days, jdLaunch, profile, vInf } with profile
// one of "dive-in" | "direct-out" | "naive", or { ok: false, reason } when
// there's no meaningful departure to time ("no-vinf") or the origin has no
// heliocentric orbit record ("unknown-origin"). A forced "dive-in" whose
// geometry degenerates (soiExitTimeDive refuses) falls back to direct-out,
// reported honestly in the returned profile.
export function estimateDeparture(spec) {
	var vInf = O.vMag(spec.vInfVec || [0, 0, 0]);
	if (!(vInf >= MIN_VINF)) { return { ok: false, reason: "no-vinf" }; }
	var rSoi = originSoiRadius(spec.origin);
	if (rSoi == null) { return { ok: false, reason: "unknown-origin" }; }

	function done(seconds, profile) {
		return { ok: true, seconds: seconds, days: seconds / DAY,
		         jdLaunch: spec.jdHandoff - seconds / DAY, profile: profile, vInf: vInf };
	}

	if (spec.origin !== "Earth") { return done(rSoi / vInf, "naive"); }

	var tDirect = O.soiExitTimeDirect(EARTH.GM, vInf, MOON_DIST, rSoi);
	if (tDirect == null) { return done(rSoi / vInf, "naive"); }   // degenerate geometry — fall back to the naive estimate

	// Pick the profile: honour a forced override; otherwise (pass 2 of the
	// auto rule) locate the Moon at the tentative launch and apply the wedge.
	var dive;
	if (spec.profile === "dive-in") { dive = true; }
	else if (spec.profile === "direct-out") { dive = false; }
	else {
		var m = LE.moonVector(spec.jdHandoff - tDirect / DAY);
		dive = O.vDot(O.vUnit(m), O.vUnit(spec.vInfVec)) < DIVE_DOT;
	}
	if (dive) {
		var tDive = O.soiExitTimeDive(EARTH.GM, vInf, DIVE_PERIGEE, MOON_DIST, rSoi);
		if (tDive != null) { return done(tDive, "dive-in"); }
	}
	return done(tDirect, "direct-out");
}

// The arrival mirror (destination Earth): time (s) to cross INBOUND from
// Earth's SOI down to the Moon's distance — where a lunar-vicinity tech
// makes its catch. Direct profile only (two-body time symmetry of
// soiExitTimeDirect; the dive question is a departure's). vInfVec is the
// ship's velocity minus Earth's at the rendezvous epoch jdRendezvous.
export function estimateArrival(vInfVec, jdRendezvous) {
	var vInf = O.vMag(vInfVec || [0, 0, 0]);
	if (!(vInf >= MIN_VINF)) { return { ok: false, reason: "no-vinf" }; }
	var t = O.soiExitTimeDirect(EARTH.GM, vInf, MOON_DIST, originSoiRadius("Earth"));
	if (t == null) { return { ok: false, reason: "degenerate" }; }
	return { ok: true, seconds: t, days: t / DAY,
	         jdSoiEntry: jdRendezvous - t / DAY, vInf: vInf };
}
