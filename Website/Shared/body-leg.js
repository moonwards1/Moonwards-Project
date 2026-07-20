/* Shared/body-leg.js — restricted two-body-plus-Sun escape flight legs from
 * ANY origin body (Mission Planner task J2, WP-J: departure from any body on
 * the HELIO_BODIES list via a skyhook orbiting it).
 *
 * The physics: a massless ship in the BODY-centred inertial frame (the origin
 * body B at rest at the origin, non-rotating, ecliptic-aligned axes) under
 * B + Sun gravity, with the Sun's real position from B's Keplerian
 * heliocentric ephemeris (Frames.bodyHelioState) and the third-body INDIRECT
 * term (the Sun's pull on the ship minus its pull on B) — the term a patched
 * conic drops. Gravity is continuous: no SOI hand-off, no kink. Everything is
 * parametrized by the origin body's own GM/radius/SOI (from Shared/orbit.js's
 * `systems`), so one integrator serves Mars, Ceres, Vesta, … alike.
 *
 * This is the GENERIC sibling of geo-leg.js. geo-leg is the Earth–Moon
 * special case (three bodies: Earth + Moon + Sun, because a lunar departure
 * genuinely rides the Moon around Earth); every OTHER origin is a single-body
 * escape (the skyhook orbits B directly — no satellite is modelled, per WP-J),
 * which is exactly what the Mars-Phobos-Skyhook-Trajectory-Plotter already
 * does. This module is that plotter's Mars+Sun integrator, generalized off
 * `GM_MARS`/`R_MARS`/`A_MARS` onto any body name.
 *
 * Source: Calculators/Mars-Phobos-Skyhook-Trajectory-Plotter/
 * marsPhobosSkyhookTrajectory.js (~712-864 as of 2026-07-17), ported as close
 * to verbatim as purity + genericity allow; the standalone plotter keeps its
 * own copy, untouched. Deliberate differences:
 *   - THREE-free. The plotter's integrator built a parallel THREE.Vector3
 *     polyline (`pts`); here a leg carries only plain `{ r, v, t }` sample
 *     arrays (SI: m, m/s, s; body-centred) and callers build render points.
 *   - Body-parametrized. Every `GM_MARS`/`R_MARS`/`A_MARS`/`SOI_MARS` becomes
 *     a lookup on the origin body name; `marsAccel` → `bodyAccel(name, …)`,
 *     `Frames.localToHelio("Mars", …)` → `Frames.localToHelio(name, …)`.
 *   - The atmosphere-interface radius is `radius + (atmosphere.height || 0)`,
 *     so an airless body (Ceres, Vesta) simply reports "entry" at its own
 *     surface — a straight impact — with no atmosphere record needed.
 *   - Waypoint burns use in-leg local dynamical frames (localFrameAt below,
 *     Body-or-Sun) exactly like geo-leg / departure-leg, NOT the plotter's
 *     separate post-escape heliocentric-Kepler chain — the Mission Planner's
 *     departure model does its impulses inside the integrated leg.
 *   - The generic pieces that are already body-agnostic in geo-leg
 *     (`stateAtLegTime`, `burnEffect`, the distance/time helpers) are imported
 *     and re-exported from there rather than re-typed.
 *
 * Everything here is pure (no DOM, no THREE) and Node-testable:
 * Shared/tests/body-leg.test.js pins the port against the plotter's own code
 * (a sliced snapshot run side by side — see the test header) plus physical
 * invariants.
 *
 * Imports from ./ — this file breaks if moved without the rest of Shared/.
 */

import { systems } from "./orbit.js";
import { OrbitalMath } from "./math-utils.js";
import { Frames } from "./frames.js";
import { stateAtLegTime, burnEffect,
         distanceAlongLegToTime, timeToDistanceAlongLeg } from "./geo-leg.js";

var O = OrbitalMath;
var SUN = systems.get("Sun");
var GM_S = SUN.GM;
var M_SUN = SUN.mass || (SUN.GM / 6.674e-11);

// The generic body-agnostic helpers geo-leg already exports — re-exported so a
// caller (body-departure-leg) imports its whole toolkit from one place.
export { stateAtLegTime, burnEffect, distanceAlongLegToTime, timeToDistanceAlongLeg };

// ---- per-body constants (SI), cached ------------------------------------

var CONSTS = {};
export function bodyConstants(name) {
	if (CONSTS[name]) { return CONSTS[name]; }
	var sys = systems.get(name);
	if (!sys) { throw new Error("body-leg: unknown body '" + name + "'"); }
	if (!sys.orbit || sys.orbit.system !== SUN) {
		throw new Error("body-leg: '" + name + "' has no heliocentric orbit — cannot escape it to the Sun");
	}
	// Heliocentric semi-major axis — the stored `semiMajor` (what the
	// Mars-Phobos plotter uses, so SOI/cutoff stay bit-identical to the port
	// source), falling back to the apsis mean for any record lacking it.
	var aHelio = isFinite(sys.orbit.semiMajor) ? sys.orbit.semiMajor
		: (sys.orbit.apoapsis + sys.orbit.periapsis) / 2;
	var atmH = +((sys.atmosphere && sys.atmosphere.height) || 0);   // m — 0 for an airless body
	// Some records store `radius` as a {equator, polar} object (with a numeric
	// valueOf); +coerce it to a plain mean-ish number so downstream code never
	// carries an object through arithmetic.
	var R = +sys.radius;
	var c = {
		name: name,
		GM: sys.GM, R: R, mass: sys.mass,
		aHelio: aHelio,
		SOI: O.sphereOfInfluence(aHelio, sys.mass, M_SUN),
		cutoff: 0.1 * aHelio,          // heliocentric escape check radius (the plotter's 0.1 * A_body)
		entryR: R + atmH,              // atmosphere interface, or the surface if airless
		atmH: atmH
	};
	CONSTS[name] = c;
	return c;
}

// SOI radius (m) of the origin body against the Sun — the departure leg's
// hand-off radius (body-SOI exit = Departure→Coast hand-off).
export function bodySOI(name) { return bodyConstants(name).SOI; }

// ---- ephemeris plumbing (m, m/s, body-centred ecliptic) -----------------

// The Sun's position (m) relative to the origin body at Julian date jde —
// minus the body's own heliocentric position vector (the "R_B(jd)" half of
// the local<->helio shift, Shared/frames.js).
export function sunRelPos(name, jde) { var s = Frames.bodyHelioState(name, jde).r; return [-s[0], -s[1], -s[2]]; }

// Add a third body's perturbation to acceleration `a`: the body's direct pull
// on the ship minus its pull on the origin body (the indirect term), keeping
// the body-centred frame consistent (a patched conic would drop this term).
function addThirdBody(a, r, rB, GM) {
	var dx = rB[0] - r[0], dy = rB[1] - r[1], dz = rB[2] - r[2];
	var d = Math.hypot(dx, dy, dz), d3 = d * d * d;
	var b = Math.hypot(rB[0], rB[1], rB[2]), b3 = b * b * b;
	a[0] += GM * (dx / d3 - rB[0] / b3);
	a[1] += GM * (dy / d3 - rB[1] / b3);
	a[2] += GM * (dz / d3 - rB[2] / b3);
}

// Body-centred acceleration (m/s^2) on the ship from the origin body + Sun
// gravity. Any satellite (Phobos etc.) is treated as massless — WP-J models
// the skyhook orbiting the body directly, never a real satellite.
export function bodyAccel(name, r, jde) {
	var c = bodyConstants(name);
	var rm = Math.hypot(r[0], r[1], r[2]), rm3 = rm * rm * rm;
	var a = [-c.GM * r[0] / rm3, -c.GM * r[1] / rm3, -c.GM * r[2] / rm3];
	addThirdBody(a, r, sunRelPos(name, jde), GM_S);
	return a;
}

// Speed and flight-path angle (rad, positive while descending) at a
// body-centred state, read where the trajectory crosses the atmosphere/surface
// interface (see integrateTrajectory's "entry" branch).
function entryConditionsFromState(r, v) {
	var rmag = Math.hypot(r[0], r[1], r[2]), vmag = Math.hypot(v[0], v[1], v[2]);
	var vr = (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / rmag;
	var fpaRad = Math.asin(Math.max(-1, Math.min(1, -vr / vmag)));
	return { r: rmag, v: vmag, fpaRad: fpaRad };
}

// ---- the integrator -------------------------------------------------------

// Integrate the body-centred trajectory (RK4, body + Sun gravity) from a given
// state until it: crosses the atmosphere/surface interface ("entry" — includes
// a direct-impact fallback); completes ~one bound orbit of the body ("body",
// never reaching the surface or escaping); or clears to a heliocentric orbit
// past 0.1× the body's own heliocentric semi-major axis ("sun"). Because
// gravity is continuous there is no SOI hand-off and no kink. Records a full
// (r,v,t) sample trail (turn-angle-capped step, ~1° per step, tighter inside
// the SOI) so a waypoint dropped anywhere on this leg can recover its state
// (interpolated — see stateAtLegTime) without re-integrating.
export function integrateTrajectory(name, R0, V0, jd0) {
	var c = bodyConstants(name);
	var r = R0.slice(), v = V0.slice(), t = 0;
	var samples = [{ r: r.slice(), v: v.slice(), t: 0 }];
	var entryR = c.entryR, cutoff = c.cutoff;
	var rmin = Infinity, rmax = 0, helioEl = null, vinfSun = null, vinfBody = null, entry = null, branch = null;
	// Absolute heliocentric escape state (m, m/s) + the Julian date it was
	// captured at, for the caller that wants the interplanetary hand-off. Null
	// unless branch ends up "sun".
	var escR = null, escV = null, escJde = null;

	var r0mag = Math.hypot(r[0], r[1], r[2]);
	if (r0mag <= entryR) {
		// Started already at/inside the surface interface — report entry now.
		return { samples: samples, branch: "entry", entry: entryConditionsFromState(r, v),
		         rmin: r0mag, rmax: r0mag, helioEl: null, vinfSun: null, vinfBody: null,
		         duration: 0, escR: null, escV: null, escJde: null };
	}

	// If this release is already bound to the body (specific energy < 0), cap
	// the integration at ~one orbital period so a "body"-primary leg that never
	// reaches the surface or escapes doesn't run to the step limit.
	var v0mag = Math.hypot(v[0], v[1], v[2]);
	var E0 = v0mag * v0mag / 2 - c.GM / r0mag;
	var boundCap = null;
	if (E0 < 0) {
		var el0 = O.elementsFromState(c.GM, r, v);
		if (el0.e < 1 && isFinite(el0.a)) { boundCap = 2 * Math.PI * Math.sqrt(Math.pow(el0.a, 3) / c.GM) * 1.02; }
	}

	for (var step = 0; step < 8000; step++) {
		var jde = jd0 + t / 86400;
		var a1 = bodyAccel(name, r, jde);
		var amag = Math.max(1e-12, Math.hypot(a1[0], a1[1], a1[2]));
		var vmag = Math.max(1, Math.hypot(v[0], v[1], v[2]));
		var rNow = Math.hypot(r[0], r[1], r[2]);
		var dtMax = rNow < c.SOI ? 2160 : 21600;
		var dt = Math.max(0.05, Math.min(dtMax, 0.02 * vmag / amag));   // ~1 deg of turn, capped
		var hd = dt / 2 / 86400;
		var r2 = O.vAdd(r, O.vScale(v, dt / 2)), v2 = O.vAdd(v, O.vScale(a1, dt / 2)), a2 = bodyAccel(name, r2, jde + hd);
		var r3 = O.vAdd(r, O.vScale(v2, dt / 2)), v3 = O.vAdd(v, O.vScale(a2, dt / 2)), a3 = bodyAccel(name, r3, jde + hd);
		var r4 = O.vAdd(r, O.vScale(v3, dt)), v4 = O.vAdd(v, O.vScale(a3, dt)), a4 = bodyAccel(name, r4, jde + dt / 86400);
		r = O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2, 2)), O.vAdd(O.vScale(v3, 2), v4)), dt / 6));
		v = O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2, 2)), O.vAdd(O.vScale(a3, 2), a4)), dt / 6));
		t += dt;
		samples.push({ r: r.slice(), v: v.slice(), t: t });
		var rmag = Math.hypot(r[0], r[1], r[2]);
		if (rmag < rmin) { rmin = rmag; }
		if (rmag > rmax) { rmax = rmag; }
		if (rmag <= entryR) { entry = entryConditionsFromState(r, v); branch = "entry"; break; }
		if (boundCap != null && t > boundCap) { branch = "body"; break; }
		var vmagNow = Math.hypot(v[0], v[1], v[2]);
		var E = vmagNow * vmagNow / 2 - c.GM / rmag;
		if (boundCap == null && E >= 0 && rmag > cutoff) {
			// Lift the body-relative escape state into heliocentric coordinates
			// (Shared/frames.js, the shift r_helio = r_local + R_B(jd)).
			var lifted = Frames.localToHelio(name, jde, r, v);
			escR = lifted.r; escV = lifted.v; escJde = jde;
			helioEl = O.elementsFromState(GM_S, escR, escV);
			vinfBody = E > 0 ? Math.sqrt(2 * E) : null;
			branch = "sun";
			break;
		}
	}
	if (!branch) { branch = boundCap != null ? "body" : "sun"; }
	if (branch === "sun" && !helioEl) {
		var jf = jd0 + t / 86400;
		var liftedFinal = Frames.localToHelio(name, jf, r, v);
		escR = liftedFinal.r; escV = liftedFinal.v; escJde = jf;
		helioEl = O.elementsFromState(GM_S, escR, escV);
		var rf = Math.hypot(r[0], r[1], r[2]), vf = Math.hypot(v[0], v[1], v[2]);
		var Ef = vf * vf / 2 - c.GM / rf;
		vinfBody = Ef > 0 ? Math.sqrt(2 * Ef) : null;
	}
	if (branch === "sun" && helioEl) {
		vinfSun = helioEl.energy > 0 ? Math.sqrt(2 * helioEl.energy) : null;
	}
	return { samples: samples, branch: branch, entry: entry,
	         rmin: rmin, rmax: rmax, helioEl: helioEl, vinfSun: vinfSun, vinfBody: vinfBody,
	         duration: t, escR: escR, escV: escV, escJde: escJde };
}

// ---- local frames + legs ---------------------------------------------------

// Local dynamical frame at a body-centred position rLocal (m) and Julian date
// jde, for a leg with the given primary (the body name, or "Sun"): which
// body's velocity a burn is measured against, so "prograde" means prograde
// around whichever body is actually locally relevant. The Body frame is used
// only when the leg's own primary IS the origin body (an actual orbit of it);
// the Sun frame is used for the WHOLE of any escaping (Sun-primary) leg. Every
// frame shares the same non-rotating, ecliptic-aligned axes, so an inclination
// measured in any of them is already ecliptic-relative — this only picks the
// gravitationally relevant origin.
export function localFrameAt(name, rLocal, jde, primary) {
	var c = bodyConstants(name);
	if (primary === "Sun") {
		var srp = sunRelPos(name, jde);                        // Sun's position in body-centred coords
		var bh = Frames.bodyHelioState(name, jde);
		return { GM: GM_S, originR: srp, originV: [-bh.v[0], -bh.v[1], -bh.v[2]], body: "Sun" };
	}
	return { GM: c.GM, originR: [0, 0, 0], originV: [0, 0, 0], body: name };
}

// A leg integrated with real body + Sun gravity (RK4) from a body-centred
// state, run to its natural end (entry / one bound orbit / heliocentric
// escape) — see integrateTrajectory. Samples are body-centred (m); the body
// itself is the fixed origin, so no "as if the satellite stood still" render
// hack is needed (unlike geo-leg's Moon).
export function buildIntegratedLeg(name, R0, V0, jde0) {
	var res = integrateTrajectory(name, R0, V0, jde0);
	var primary = res.branch === "sun" ? "Sun" : name;   // "entry"/"body" are both body-primary
	var s0 = res.samples[0];
	var leg = {
		kind: "integrated", body: name, primary: primary, branch: res.branch,
		samples: res.samples, jde0: jde0, duration: res.duration,
		impact: res.branch === "entry" ? name : null,
		entry: res.entry, rmin: res.rmin, rmax: res.rmax,
		helioEl: res.helioEl, vinfSun: res.vinfSun, vinfBody: res.vinfBody,
		escR: res.escR, escV: res.escV, escJde: res.escJde,
		inclRad: res.branch === "sun" ? (res.helioEl ? res.helioEl.i : null)
			: O.elementsFromState(bodyConstants(name).GM, s0.r, s0.v).i
	};
	return leg;
}

// ---- SOI encounters on a heliocentric coast --------------------------------

// Integrate a ship THROUGH a body's sphere of influence: the arrival-side
// mirror of integrateTrajectory (which flies outbound from a release). A
// heliocentric coast (transfer-leg) that dips inside a body's SOI hands its
// state here; the flight continues in the BODY-centred frame under body + Sun
// gravity (bodyAccel — same indirect term, no patched-conic kink) until it
// leaves the SOI again, hits the surface/atmosphere interface, or `maxDurS`
// runs out (the leg's own boundary — a leg may END mid-encounter, and the
// caller keeps the honest inside-SOI state).
//
// rHelio/vHelio: heliocentric state (m, m/s) at jde0 — normally at (or just
// inside) the SOI boundary. Returns:
//   samples  body-centred { r, v, t } trail (stateAtLegTime-compatible with
//            { samples, jde0 }), turn-angle-capped like integrateTrajectory
//   branch   "exit" (left the SOI), "entry" (surface/atmosphere impact),
//            or "time" (maxDurS elapsed still inside)
//   rmin     closest approach to the body centre (m)
//   vinf     hyperbolic excess speed vs the body (m/s) at the start state,
//            or null if the state is bound to the body
//   duration integrated time (s)
//   end      heliocentric { r, v } lifted at jde0 + duration/86400
//   entry    entry conditions record when branch === "entry" (else null)
export function integrateEncounter(name, rHelio, vHelio, jde0, maxDurS) {
	var c = bodyConstants(name);
	var dropped = Frames.helioToLocal(name, jde0, rHelio, vHelio);
	var r = dropped.r.slice(), v = dropped.v.slice(), t = 0;
	var samples = [{ r: r.slice(), v: v.slice(), t: 0 }];
	var rmin = Math.hypot(r[0], r[1], r[2]);
	if (rmin <= c.entryR) {
		// Handed a state already at/inside the surface interface — report it
		// as an immediate entry rather than integrating from a singularity.
		return { samples: samples, branch: "entry", rmin: rmin, vinf: null,
		         duration: 0, end: { r: rHelio.slice(), v: vHelio.slice() },
		         entry: entryConditionsFromState(r, v) };
	}
	var v0mag = Math.hypot(v[0], v[1], v[2]);
	var E0 = v0mag * v0mag / 2 - c.GM / rmin;
	var vinf = E0 > 0 ? Math.sqrt(2 * E0) : null;
	var branch = "time", entry = null;

	for (var step = 0; step < 8000 && t < maxDurS; step++) {
		var jde = jde0 + t / 86400;
		var a1 = bodyAccel(name, r, jde);
		var amag = Math.max(1e-12, Math.hypot(a1[0], a1[1], a1[2]));
		var vmag = Math.max(1, Math.hypot(v[0], v[1], v[2]));
		var dt = Math.max(0.05, Math.min(2160, 0.02 * vmag / amag));   // ~1 deg of turn; SOI-interior cap
		dt = Math.min(dt, maxDurS - t);
		var hd = dt / 2 / 86400;
		var r2 = O.vAdd(r, O.vScale(v, dt / 2)), v2 = O.vAdd(v, O.vScale(a1, dt / 2)), a2 = bodyAccel(name, r2, jde + hd);
		var r3 = O.vAdd(r, O.vScale(v2, dt / 2)), v3 = O.vAdd(v, O.vScale(a2, dt / 2)), a3 = bodyAccel(name, r3, jde + hd);
		var r4 = O.vAdd(r, O.vScale(v3, dt)), v4 = O.vAdd(v, O.vScale(a3, dt)), a4 = bodyAccel(name, r4, jde + dt / 86400);
		r = O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2, 2)), O.vAdd(O.vScale(v3, 2), v4)), dt / 6));
		v = O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2, 2)), O.vAdd(O.vScale(a3, 2), a4)), dt / 6));
		t += dt;
		samples.push({ r: r.slice(), v: v.slice(), t: t });
		var rmag = Math.hypot(r[0], r[1], r[2]);
		if (rmag < rmin) { rmin = rmag; }
		if (rmag <= c.entryR) { entry = entryConditionsFromState(r, v); branch = "entry"; break; }
		if (rmag > c.SOI) { branch = "exit"; break; }
	}

	var jdeEnd = jde0 + t / 86400;
	var lifted = Frames.localToHelio(name, jdeEnd, r, v);
	return { samples: samples, branch: branch, rmin: rmin, vinf: vinf,
	         duration: t, end: { r: lifted.r, v: lifted.v }, entry: entry };
}
