/* Shared/geo-leg.js — restricted N-body geocentric flight legs
 * (Mission Planner task I1: the Moon-Skyhook-Trajectory-Plotter's Phase-2
 * trajectory core, ported to a pure shared module).
 *
 * The physics: a massless ship in the geocentric inertial frame under
 * Earth + Moon + Sun gravity, with real ephemerides (LunarEphemeris — the
 * Moon's position/velocity, and the Sun's via its geocentric vector) and
 * the third-body INDIRECT term (each perturber's pull on the ship minus its
 * pull on Earth) — the term a patched conic drops, which is what produced
 * the kink at the SOI. Gravity is continuous here: no SOI hand-off, no
 * kink. This is the restricted N-body (three-body-plus-Sun) path — the
 * fidelity WP-I brings to the Mission Planner's departure phase.
 *
 * Source: Calculators/Moon-Skyhook-Trajectory-Plotter/moonSkyhookTrajectory.js
 * (~533-1012 as of 2026-07-16), ported as close to verbatim as purity
 * allows; the standalone plotter keeps its own copy, untouched. The
 * deliberate differences, all of them:
 *   - THREE-free. The plotter's integrator built a parallel THREE.Vector3
 *     polyline (`pts`) and Moon-relative render points alongside its
 *     samples; here a leg carries only plain `{ r, v, t }` sample arrays
 *     (SI: m, m/s, s) and callers build their own render points from them
 *     (moonGeoPos is exported for the "Moon stood still" render offset the
 *     plotter's draw code documents).
 *   - `lunarInclination`'s reference plane is a PARAMETER. The plotter
 *     measures a Moon-bound leg's inclination against the skyhook's own
 *     orbital plane (its `hookBasis()` — tool state this module can't
 *     know); here `integrateTrajectory` takes `opts.moonPlaneNormal`
 *     (plain [x,y,z], unit) and defaults to the ecliptic pole [0,0,1].
 *     Pass the tech's real plane normal to reproduce the plotter exactly
 *     (its default hook plane is the Moon's equatorial plane, ~1.54 deg
 *     off the ecliptic).
 *   - `legRenderPointAtDistance` (drag-gizmo render interpolation) stayed
 *     behind — it interpolates THREE render points, which no longer exist
 *     here; its pure siblings distanceAlongLegToTime / timeToDistanceAlongLeg
 *     came across, and a view can lerp its own points with them.
 *
 * Everything here is pure (no DOM, no THREE) and Node-testable:
 * Shared/tests/geo-leg.test.js pins the port against the plotter's own
 * code (a sliced snapshot run side by side — see the test header) plus
 * physical invariants.
 *
 * Imports from ./ — this file breaks if moved without the rest of Shared/.
 */

import { systems } from "./orbit.js";
import { OrbitalMath } from "./math-utils.js";
import { LunarEphemeris } from "./lunar-ephemeris.js";

var O = OrbitalMath;
var LE = LunarEphemeris;

// ---- physical constants (SI) — same records the plotter reads ------------
var EARTH = systems.get("Earth");
var MOON = systems.get("Moon");
var SUN = systems.get("Sun");
var GM_E = EARTH.GM, R_E = EARTH.radius;
var GM_M = MOON.GM, R_M = MOON.radius;
var GM_S = SUN.GM;
var M_E = EARTH.mass, M_M = MOON.mass;
var M_SUN = SUN.mass || (SUN.GM / 6.6743e-11);
var A_MOON = MOON.orbit.semiMajor || 384399e3;                      // m, geocentric
var A_EARTH = (EARTH.orbit.apoapsis + EARTH.orbit.periapsis) / 2;   // m, heliocentric

// Spheres of influence (m) — computed from MASSES, exactly as the plotter
// does (the ratio is the same either way; keeping the source expression
// keeps the port bit-identical).
export var SOI_MOON = O.sphereOfInfluence(A_MOON, M_M, M_E);
export var SOI_EARTH = O.sphereOfInfluence(A_EARTH, M_E, M_SUN);

// ---- ephemeris plumbing (m, m/s, geocentric ecliptic) --------------------

// Earth's heliocentric state: position is minus the Sun's geocentric vector
// (real ephemeris, with distance); velocity is a finite difference of that
// full vector, so both the tangential and radial parts are captured.
export function earthHelio(jd) {
	var dd = 0.01;
	var r1 = O.vScale(LE.sunVector(jd), -1e3);
	var r2 = O.vScale(LE.sunVector(jd + dd), -1e3);
	return { r: r1, v: O.vScale(O.vSub(r2, r1), 1 / (dd * 86400)) };
}

// Geocentric positions (m) of the Moon and Sun at Julian date jde.
export function moonGeoPos(jde) { var r = LE.moonVector(jde); return [r[0] * 1e3, r[1] * 1e3, r[2] * 1e3]; }
export function sunGeoPos(jde) { var s = LE.sunVector(jde); return [s[0] * 1e3, s[1] * 1e3, s[2] * 1e3]; }

// Geocentric velocity (m/s) of the Moon at Julian date jde (companion to
// moonGeoPos — both come from the same ephemeris state).
export function moonGeoVel(jde) { var st = LE.moonState(jde); return [st.v[0] * 1e3, st.v[1] * 1e3, st.v[2] * 1e3]; }

// Add a third body's perturbation to acceleration `a`: the body's direct
// pull on the ship minus its pull on Earth (the indirect term). Keeping the
// indirect term makes the geocentric frame consistent — that is exactly the
// term a patched conic drops, which is what produced the kink at the SOI.
function addThirdBody(a, r, rB, GM) {
	var dx = rB[0] - r[0], dy = rB[1] - r[1], dz = rB[2] - r[2];
	var d = Math.hypot(dx, dy, dz), d3 = d * d * d;
	var b = Math.hypot(rB[0], rB[1], rB[2]), b3 = b * b * b;
	a[0] += GM * (dx / d3 - rB[0] / b3);
	a[1] += GM * (dy / d3 - rB[1] / b3);
	a[2] += GM * (dz / d3 - rB[2] / b3);
}

// Geocentric acceleration (m/s^2) on the ship from Earth + Moon + Sun gravity.
export function shipAccel(r, jde) {
	var rm = Math.hypot(r[0], r[1], r[2]), rm3 = rm * rm * rm;
	var a = [-GM_E * r[0] / rm3, -GM_E * r[1] / rm3, -GM_E * r[2] / rm3];
	addThirdBody(a, r, moonGeoPos(jde), GM_M);
	addThirdBody(a, r, sunGeoPos(jde), GM_S);
	return a;
}

// Inclination of a Moon-relative state's orbital plane against the supplied
// plane normal (plain [x,y,z], unit). The plotter measures against its
// skyhook's own plane; the ecliptic pole is this module's default (see
// header).
export function lunarInclination(rMoonRel, vMoonRel, planeNormal) {
	var h = O.vCross(rMoonRel, vMoonRel), hMag = O.vMag(h);
	if (hMag < 1e-6) { return 0; }
	var n = planeNormal || [0, 0, 1];
	return Math.acos(Math.max(-1, Math.min(1, O.vDot(h, n) / hMag)));
}

// Orbital period (s) of a bound conic — for the bound-Moon two-body ellipse.
export function conicPeriod(GM, el) { return 2 * Math.PI * Math.sqrt(Math.pow(el.a, 3) / GM); }

// ---- the integrator -------------------------------------------------------

// Integrate the geocentric trajectory (RK4 with a step bounded by turn angle
// and, in cislunar space, by segment length — see dtMax in the loop) from a
// given state until it impacts, completes one bound Earth orbit, completes
// one bound Moon orbit (only relevant for a leg that *starts* Moon-bound,
// e.g. right after a waypoint burn that keeps the ship close to the Moon —
// without this cap such a leg would never "clear" and would run to the step
// limit), or escapes to 0.1 AU. Because gravity is continuous there is no
// SOI handoff and no kink — this is the restricted N-body path. Records a
// full (r,v,t) sample trail, dense enough (<=1 deg of turn per step, tighter
// distance caps in cislunar space) for a waypoint dropped anywhere on this
// leg to recover its state (interpolated — see stateAtLegTime) without
// re-integrating.
//
// opts (all optional): { moonPlaneNormal } — see lunarInclination.
export function integrateTrajectory(R0, V0, jd0, opts) {
	var r = R0.slice(), v = V0.slice(), t = 0;
	var samples = [{ r: r.slice(), v: v.slice(), t: 0 }];
	var cleared = false, branch = null, tClear = 0, oscT = 0, impact = null;
	var rmin = Infinity, rmax = 0, helioEl = null, vinfEarth = null, inclEarth = null;
	var moonRmin = Infinity, moonRmax = 0;
	var clearDist = 2.5 * SOI_MOON, cutoff = 0.1 * A_EARTH;

	// If this leg starts already Moon-bound (apoapsis inside the Moon's SOI),
	// cap it at ~one lunar orbit. Only ever true for a leg beginning right
	// after a burn — a release that stays bound is routed to the exact
	// two-body ellipse branch by the caller instead (see the plotter's
	// computeTrajectory), so moonBoundCap is always null there.
	var rMoonRel0 = O.vSub(r, moonGeoPos(jd0)), vMoonRel0 = O.vSub(v, moonGeoVel(jd0));
	var elM0 = O.elementsFromState(GM_M, rMoonRel0, vMoonRel0);
	var moonBoundCap = (elM0.e < 1 && O.apoapsisRadius(elM0.a, elM0.e) < SOI_MOON)
		? conicPeriod(GM_M, elM0) * 1.02 : null;
	// Lunar inclination: only relevant when this leg starts Moon-bound, i.e.
	// exactly when moonBoundCap applies. Computed once from the leg's
	// starting state — the plane of a bound ellipse doesn't change over the
	// one orbit this cap allows.
	var inclLunar = moonBoundCap != null
		? lunarInclination(rMoonRel0, vMoonRel0, opts && opts.moonPlaneNormal) : null;

	for (var step = 0; step < 8000; step++) {
		var jde = jd0 + t / 86400;
		var a1 = shipAccel(r, jde);
		var amag = Math.max(1e-12, Math.hypot(a1[0], a1[1], a1[2]));
		var vmag = Math.max(1, Math.hypot(v[0], v[1], v[2]));
		// Max step (dtMax): the ~1-deg turn rule alone leaves nearly-straight
		// stretches (weak field, high speed) sampled tens of thousands of km
		// apart — at a flat 6 h cap, a waypoint gizmo near the Moon could
		// only land on points ~40,000 km apart. Grade the cap by where the
		// ship is: ~10x denser inside Earth's SOI (where waypoints actually
		// get placed), and within 100,000 km of the Moon cap the SEGMENT
		// LENGTH at ~2,000 km so placement there is fine-grained. Beyond the
		// SOI the 6 h cap stands — nothing is placed out there, and it
		// preserves the step budget for slow escapes.
		var rNow = Math.hypot(r[0], r[1], r[2]);
		var rMnow = moonGeoPos(jde);
		var dMoonNow = Math.hypot(rMnow[0] - r[0], rMnow[1] - r[1], rMnow[2] - r[2]);
		var dtMax = rNow < SOI_EARTH ? 2160 : 21600;
		if (dMoonNow < 1e8) { dtMax = Math.min(dtMax, 2e6 / vmag); }
		var dt = Math.max(1, Math.min(dtMax, 0.02 * vmag / amag));   // ~1 deg of turn, capped
		var hd = dt / 2 / 86400;
		var r2 = O.vAdd(r, O.vScale(v, dt / 2)), v2 = O.vAdd(v, O.vScale(a1, dt / 2)), a2 = shipAccel(r2, jde + hd);
		var r3 = O.vAdd(r, O.vScale(v2, dt / 2)), v3 = O.vAdd(v, O.vScale(a2, dt / 2)), a3 = shipAccel(r3, jde + hd);
		var r4 = O.vAdd(r, O.vScale(v3, dt)), v4 = O.vAdd(v, O.vScale(a3, dt)), a4 = shipAccel(r4, jde + dt / 86400);
		r = O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2, 2)), O.vAdd(O.vScale(v3, 2), v4)), dt / 6));
		v = O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2, 2)), O.vAdd(O.vScale(a3, 2), a4)), dt / 6));
		t += dt;
		samples.push({ r: r.slice(), v: v.slice(), t: t });
		var rmag = Math.hypot(r[0], r[1], r[2]);
		var rM = moonGeoPos(jd0 + t / 86400);
		var dMoon = Math.hypot(rM[0] - r[0], rM[1] - r[1], rM[2] - r[2]);
		if (cleared) { if (rmag < rmin) { rmin = rmag; } if (rmag > rmax) { rmax = rmag; } }
		else { if (dMoon < moonRmin) { moonRmin = dMoon; } if (dMoon > moonRmax) { moonRmax = dMoon; } }
		if (rmag < R_E) { impact = "Earth"; break; }
		if (dMoon < R_M) { impact = "Moon"; break; }
		if (moonBoundCap != null && !cleared && t > moonBoundCap) { branch = "moon"; break; }
		if (!cleared && dMoon > clearDist) {
			// Clear of the Moon: read the Earth-relative orbit. Its specific
			// energy gives the true v_inf at Earth's SOI (all factors included,
			// not the prograde-aligned first cut), and its inclination is the
			// real plane of the resulting Earth orbit.
			cleared = true; tClear = t; rmin = rmag; rmax = rmag;
			var vp = Math.hypot(v[0], v[1], v[2]);
			var Eearth = vp * vp / 2 - GM_E / rmag;
			vinfEarth = Eearth > 0 ? Math.sqrt(2 * Eearth) : null;
			var el = O.elementsFromState(GM_E, r, v);
			inclEarth = el.i;
			if (Eearth >= 0) { branch = "orange"; }
			else { branch = "green"; oscT = 2 * Math.PI * Math.sqrt(el.a * el.a * el.a / GM_E); }
		}
		if (cleared && branch === "orange" && rmag > cutoff) {
			var eh = earthHelio(jde);
			helioEl = O.elementsFromState(GM_S, O.vAdd(eh.r, r), O.vAdd(eh.v, v));
			break;
		}
		if (cleared && branch === "green" && t > tClear + oscT * 1.02) { break; }
	}
	// Fallback branch when the loop ran out without any break condition
	// firing: matches the plotter's unconditional "green" default exactly
	// unless this leg genuinely started Moon-bound and never cleared.
	if (!branch) { branch = (!cleared && moonBoundCap != null) ? "moon" : "green"; }
	// Fallback: a slow escape may hit the step cap before the 0.1 AU cutoff;
	// still report its heliocentric orbit from wherever it ended (well past
	// Earth by then). The heliocentric apsides are an estimate either way,
	// since Earth's heliocentric motion here is only approximate.
	if (branch === "orange" && !helioEl) {
		var ehf = earthHelio(jd0 + t / 86400);
		helioEl = O.elementsFromState(GM_S, O.vAdd(ehf.r, r), O.vAdd(ehf.v, v));
	}
	return { samples: samples, branch: branch, impact: impact,
	         rmin: rmin, rmax: rmax, moonRmin: moonRmin, moonRmax: moonRmax,
	         helioEl: helioEl, vinfEarth: vinfEarth, inclEarth: inclEarth,
	         inclLunar: inclLunar, duration: t };
}

// ---- local frames + burns --------------------------------------------------

// Local dynamical frame at a geocentric position rGeo (m) and Julian date
// jde, for a leg with the given primary ("Moon" | "Earth" | "Sun"): which
// body's velocity a burn should be measured against, so "prograde" means
// prograde around whichever body is actually locally relevant.
//
// The Moon frame is used ONLY when the leg's own primary is the Moon —
// i.e. an actual orbit of the Moon — never merely because the ship's
// position happens to pass inside the Moon's SOI (a flyby transit would
// flip the gizmo axes mid-leg). The Sun frame is used for the WHOLE of any
// Sun-primary (escaping) leg — on a heliocentric trajectory a burn matters
// for the resulting INTERPLANETARY orbit, even minutes after release where
// the ship's heliocentric velocity is dominated by Earth's own motion. An
// Earth-primary leg keeps a proximity fallback (Earth frame inside 0.1 AU,
// Sun outside), though in practice a bound leg never reaches that far out.
//
// Every frame here shares the same non-rotating, ecliptic-aligned axes
// (the ephemeris helpers only ever translate, never rotate), so an
// inclination measured in ANY of these frames via O.elementsFromState is
// already relative to the ecliptic — this only picks the gravitationally
// relevant origin, not a different orientation.
export function localFrameAt(rGeo, jde, primary) {
	if (primary === "Moon") {
		return { GM: GM_M, originR: moonGeoPos(jde), originV: moonGeoVel(jde), body: "Moon" };
	}
	var rmag = Math.hypot(rGeo[0], rGeo[1], rGeo[2]);
	if (primary === "Sun" || rmag > 0.1 * A_EARTH) {
		var eh = earthHelio(jde);
		return { GM: GM_S, originR: O.vScale(eh.r, -1), originV: O.vScale(eh.v, -1), body: "Sun" };
	}
	return { GM: GM_E, originR: [0, 0, 0], originV: [0, 0, 0], body: "Earth" };
}

export function bodyLabelForGM(GM) {
	if (GM === GM_M) { return "Moon"; }
	if (GM === GM_S) { return "Sun"; }
	return "Earth";
}

// Core burn math in ONE consistent local frame (GM, rLocal, vBefore all
// relative to the same body). Everything a waypoint needs — the resulting
// velocity, the drawn arrows, the readout card — derives from this single
// call, so the burn, its Oberth amplification and its (ecliptic-relative)
// plane change are all evaluated at the same point with the same physics.
export function burnEffect(GM, rLocal, vBefore, burn) {
	var vAfter = O.applyBurn(rLocal, vBefore, burn.pro, burn.nrm, burn.rad);
	var dSpeed = O.vMag(vAfter) - O.vMag(vBefore);
	var iBefore = O.elementsFromState(GM, rLocal, vBefore).i;
	var iAfter = O.elementsFromState(GM, rLocal, vAfter).i;
	return {
		vAfter: vAfter,
		dv: O.vSub(vAfter, vBefore),                       // = geocentric Δv too (translation cancels)
		dSpeedVec: O.vScale(O.vUnit(vAfter), dSpeed),      // along local prograde; reversed if dSpeed<0
		burnDv: Math.hypot(burn.pro, burn.nrm, burn.rad) / 1000,
		planeChange: (iAfter - iBefore) * 180 / Math.PI,
		progradeDv: dSpeed / 1000
	};
}

// ---- legs -------------------------------------------------------------------

// State (r,v, m/m·s⁻¹, geocentric) at elapsed time t (s) into an
// "integrated" leg — linearly interpolated between the two bracketing RK4
// samples. The samples are dense (<=1° of turn per step, with tighter
// distance caps in cislunar space — see integrateTrajectory), so linear
// interpolation error is negligible against everything else here, and it
// lets a dragged waypoint glide CONTINUOUSLY along the curve instead of
// snapping to the nearest recorded sample.
export function stateAtLegTime(leg, t) {
	var arr = leg.samples;
	if (t <= arr[0].t) { return { r: arr[0].r.slice(), v: arr[0].v.slice(), jde: leg.jde0 + arr[0].t / 86400 }; }
	for (var k = 1; k < arr.length; k++) {
		if (arr[k].t >= t) {
			var a = arr[k - 1], b = arr[k];
			var f = (b.t - a.t) > 1e-9 ? (t - a.t) / (b.t - a.t) : 0;
			return {
				r: [a.r[0] + f * (b.r[0] - a.r[0]), a.r[1] + f * (b.r[1] - a.r[1]), a.r[2] + f * (b.r[2] - a.r[2])],
				v: [a.v[0] + f * (b.v[0] - a.v[0]), a.v[1] + f * (b.v[1] - a.v[1]), a.v[2] + f * (b.v[2] - a.v[2])],
				jde: leg.jde0 + t / 86400
			};
		}
	}
	var last = arr[arr.length - 1];
	return { r: last.r.slice(), v: last.v.slice(), jde: leg.jde0 + last.t / 86400 };
}

// A leg on the exact Moon-bound two-body ellipse — the case where release
// itself stays bound with apoapsis inside the Moon's SOI. Samples are
// Moon-RELATIVE (m), one closed loop ("one loop, drawn as if the Moon
// stayed put"); callers render it parented at the Moon.
export function buildMoonEllipseLeg(relR, relV, jde0, elM) {
	var period = conicPeriod(GM_M, elM);
	var arc = O.sampleArc(GM_M, relR, relV, period, 360);    // [{r (Moon-relative, m), t}]
	return {
		kind: "moonEllipse", moonFrame: true, primary: "Moon",
		samples: arc, relR: relR, relV: relV,
		jde0: jde0, duration: period,
		periAlt: (O.periapsisRadius(elM.a, elM.e) - R_M) / 1e3,
		apoAlt: (O.apoapsisRadius(elM.a, elM.e) - R_M) / 1e3,
		impact: null, vinfEarth: null, inclRad: null
	};
}

// A leg integrated with real Earth+Moon+Sun gravity (RK4) from a geocentric
// state, run to its natural end (impact / one bound orbit / 0.1 AU escape)
// — see integrateTrajectory. Samples are GEOCENTRIC (m). A Moon-bound
// branch reports lunar apsis altitudes; renderers wanting the plotter's
// "Moon stood still" offset rebuild it from samples + moonGeoPos (see
// header). opts forwards to integrateTrajectory.
export function buildIntegratedLeg(R0, V0, jde0, opts) {
	var res = integrateTrajectory(R0, V0, jde0, opts);
	var primary = res.branch === "orange" ? "Sun" : (res.branch === "moon" ? "Moon" : "Earth");
	var leg = {
		kind: "integrated", moonFrame: false, primary: primary,
		samples: res.samples, jde0: jde0, duration: res.duration,
		impact: res.impact, rmin: res.rmin, rmax: res.rmax,
		helioEl: res.helioEl, vinfEarth: res.vinfEarth,
		inclRad: res.branch === "orange" ? (res.helioEl ? res.helioEl.i : null)
			: res.branch === "moon" ? res.inclLunar : res.inclEarth
	};
	if (res.branch === "moon") {
		leg.periAlt = (res.moonRmin - R_M) / 1e3;
		leg.apoAlt = (res.moonRmax - R_M) / 1e3;
	}
	return leg;
}

// Elapsed time (s) into a leg at which its path first accumulates
// `targetDistM` metres of arc length from the leg's start — used to plant a
// freshly-created waypoint a set distance along the trajectory rather than
// at a fixed fraction of its (highly variable) duration. Clamped to the
// leg's own end if the whole leg is shorter than the target.
export function distanceAlongLegToTime(leg, targetDistM) {
	var arr = leg.samples, cum = 0;
	for (var k = 1; k < arr.length; k++) {
		var a = arr[k - 1].r, b = arr[k].r;
		var segLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		if (cum + segLen >= targetDistM) {
			var f = segLen > 1e-9 ? (targetDistM - cum) / segLen : 0;
			return arr[k - 1].t + f * (arr[k].t - arr[k - 1].t);
		}
		cum += segLen;
	}
	return leg.duration;
}

// Cumulative arc length (m) of a leg's path from its start up to elapsed
// time t (s) — the inverse of distanceAlongLegToTime. Omitting t (or
// passing leg.duration) gives the leg's total length.
export function timeToDistanceAlongLeg(leg, t) {
	if (t == null) { t = leg.duration; }
	var arr = leg.samples, cum = 0;
	for (var k = 1; k < arr.length; k++) {
		var a = arr[k - 1].r, b = arr[k].r;
		var segLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		if (arr[k].t >= t) {
			var segDur = arr[k].t - arr[k - 1].t;
			var f = segDur > 1e-9 ? (t - arr[k - 1].t) / segDur : 0;
			return cum + segLen * f;
		}
		cum += segLen;
	}
	return cum;
}

// Elapsed time (s) into a leg at which it first reaches apoapsis (wantApo
// true) or periapsis (wantApo false), or null if this leg isn't an orbit of
// the Moon (see defaultWaypointTime) — distance-along-path is the wrong
// default there, but the apsides are the natural handles on an actual lunar
// orbit. Works for both the exact two-body ellipse (kind "moonEllipse") and
// an integrated leg that stays Moon-bound (primary "Moon"), deriving
// elements from whichever start state the leg actually has.
export function firstApsisTime(leg, wantApo) {
	if (leg.primary !== "Moon") { return null; }
	var r0, v0;
	if (leg.kind === "moonEllipse") {
		r0 = leg.relR; v0 = leg.relV;
	} else {
		var s0 = leg.samples[0];
		r0 = O.vSub(s0.r, moonGeoPos(leg.jde0));
		v0 = O.vSub(s0.v, moonGeoVel(leg.jde0));
	}
	var el = O.elementsFromState(GM_M, r0, v0);
	if (!(el.e < 1) || !isFinite(el.a)) { return null; }
	var n = O.meanMotion(GM_M, el.a);
	var M0 = O.meanAnomalyFromTrue(el.nu, el.e);
	var targetM = wantApo ? Math.PI : 0;
	var TWO_PI = 2 * Math.PI;
	var dt = (((targetM - M0) % TWO_PI) + TWO_PI) % TWO_PI / n;
	return Math.min(dt, leg.duration);
}

// Default elapsed time (s) for a freshly-created waypoint on leg index
// `idx` (0 for WP 1, 1 for WP 2). Cislunar work wants a fresh waypoint
// close to the Moon, not at the leg's halfway point in TIME (days away on
// an escape): 100,000 km along its own leg. On an actual lunar (Moon-bound)
// orbit the natural handles are the apsides instead — WP 1 defaults to the
// leg's first apoapsis, WP 2 to its first periapsis (the classic
// apoapsis-raise / periapsis-lower pair).
export var WP_DEFAULT_DIST_M = 100000 * 1e3;   // 100,000 km, per leg
export function defaultWaypointTime(leg, idx) {
	var apsis = firstApsisTime(leg, idx === 0);
	return apsis != null ? apsis : distanceAlongLegToTime(leg, WP_DEFAULT_DIST_M);
}
