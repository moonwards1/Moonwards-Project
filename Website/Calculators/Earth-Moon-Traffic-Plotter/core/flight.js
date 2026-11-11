/* Earth-Moon-Traffic-Plotter/core/flight — one flight through the Earth–Moon
 * system, computed from the plotter's state. The page draws what this returns
 * and computes nothing of its own.
 *
 * A flight starts at a facility (core/facilities.js) at a release date. The
 * facility's position and velocity at that instant come from the clock, so
 * the release state is not chosen — it is where the release point IS then.
 * The ship then coasts under Earth + Moon + Sun gravity (Shared/geo-leg.js,
 * RK4, real ephemerides, no sphere-of-influence hand-off).
 *
 * Two leg shapes come back, both Shared/geo-leg.js's own:
 *   - "integrated": geocentric { r, v, t } samples;
 *   - "moonEllipse": the exact two-body ellipse of a release that stays bound
 *     inside the Moon's sphere of influence, as MOON-RELATIVE samples (the
 *     same split the Moon-Skyhook-Trajectory-Plotter makes). Unlike that
 *     plotter, a release from below the centre of mass is allowed here, so
 *     the ellipse can meet the ground: such a leg is cut at the impact and
 *     carries impact "Moon".
 *
 * A flight may name a destination facility. The path is then flown with a
 * finer step (the tether it has to meet is a few metres wide at the scale of
 * the trip) and judged where it meets the destination: core/arrival.js.
 * core/target.js adjusts the release until it does.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { buildIntegratedLeg, buildMoonEllipseLeg, stateAtLegTime, moonGeoPos, moonGeoVel,
         SOI_MOON } from "../../../Shared/geo-leg.js";
import { skyhookFigures, tetherPointState, phaseAt } from "./facilities.js";
import { evaluateArrival } from "./arrival.js";

var O = OrbitalMath;
var DAY = 86400;
var R_E = +systems.get("Earth").radius;
var R_M = +systems.get("Moon").radius;
var GM_M = systems.get("Moon").GM;
var A_EARTH = (systems.get("Earth").orbit.apoapsis + systems.get("Earth").orbit.periapsis) / 2;

// Time (s) at which a two-body path from (r0, v0) first comes down to radius
// R, searched up to tMax; null if it never does. Coarse walk, then bisection.
function timeToRadius(GM, r0, v0, R, tMax) {
	var N = 720, prev = 0;
	for (var k = 1; k <= N; k++) {
		var t = tMax * k / N;
		if (O.vMag(O.propagateState(GM, r0, v0, t).r) < R) {
			var lo = prev, hi = t;
			for (var i = 0; i < 50; i++) {
				var mid = (lo + hi) / 2;
				if (O.vMag(O.propagateState(GM, r0, v0, mid).r) < R) { hi = mid; } else { lo = mid; }
			}
			return hi;
		}
		prev = t;
	}
	return null;
}

// The Moon-bound ellipse leg, cut at the ground when its periapsis is below it.
function moonBoundLeg(relR, relV, jd, elM) {
	var leg = buildMoonEllipseLeg(relR, relV, jd, elM);
	if (leg.periAlt >= 0) { return leg; }
	var tHit = timeToRadius(GM_M, relR, relV, R_M, leg.duration);
	if (tHit === null) { return leg; }
	var hit = O.propagateState(GM_M, relR, relV, tHit);
	leg.samples = O.sampleArc(GM_M, relR, relV, tHit, 180);
	leg.duration = tHit;
	leg.impact = "Moon";
	leg.impactSpeed = O.vMag(hit.v);
	return leg;
}

// What the page reads off the flight's last leg, in display-ready units.
function summarize(leg) {
	var s = { primary: leg.primary, impact: leg.impact || null, impactSpeed: leg.impactSpeed || null,
	          duration: leg.duration, periAlt: null, apoAlt: null, periAU: null, apoAU: null,
	          vInfEarth: null, inclRad: leg.inclRad == null ? null : leg.inclRad, inclRef: null };
	if (leg.primary === "Moon") {
		s.periAlt = leg.periAlt * 1e3; s.apoAlt = leg.apoAlt * 1e3;
		s.inclRef = "skyhook plane";
	} else if (leg.primary === "Earth") {
		s.periAlt = leg.rmin - R_E;
		s.apoAlt = leg.rmax > 0 ? leg.rmax - R_E : null;
		s.inclRef = "ecliptic";
	} else {
		var h = leg.helioEl;
		if (h) {
			s.periAU = O.periapsisRadius(h.a, h.e) / A_EARTH;
			s.apoAU = h.e < 1 ? O.apoapsisRadius(h.a, h.e) / A_EARTH : null;
		}
		s.vInfEarth = leg.vinfEarth;
		s.inclRef = "ecliptic, heliocentric";
	}
	return s;
}

// Compute a flight.
//   input: { from, to, jd, params, maxTime }
//     from     facility id (core/facilities.js) the ship is released from
//     to       optional facility id it is meant to arrive at
//     jd       release Julian date
//     params   optional { <facility id>: { footAlt, comAlt, topAlt, relAlt, catchAlt } }
//     maxTime  optional: fly no longer than this (s) — core/target.js's trial flights
//     skipArrival  optional: leave `arrival` null (a trial flight judged otherwise)
// Returns { ok: true, from, to, jd, fig, toFig, release, legs, final, summary,
// arrival } or { ok: false, diagnostic }.
//   fig       the origin's skyhookFigures
//   release   { r, v, relR, relV, phase } — geocentric and body-relative state
//             of the release point at jd, and the tether's clock angle (rad)
//   legs      Shared/geo-leg.js legs in flight order (one, until burns exist)
//   toFig     the destination's skyhookFigures, or null
//   arrival   core/arrival.js's evaluateArrival result, or null with no destination
export var FINE_STEP = { turnStep: 0.005, maxSteps: 40000 };
export function computeFlight(input) {
	var fig = skyhookFigures(input.from, input.params && input.params[input.from]);
	if (!fig.ok) { return fig; }
	var toFig = null;
	if (input.to) {
		toFig = skyhookFigures(input.to, input.params && input.params[input.to]);
		if (!toFig.ok) { return toFig; }
	}
	var jd = input.jd;
	var rel = tetherPointState(fig, fig.rRel, jd);
	rel.phase = phaseAt(fig, jd);

	var leg = null;
	if (fig.body === "Moon") {
		var elM = O.elementsFromState(GM_M, rel.relR, rel.relV);
		if (elM.e < 1 && O.apoapsisRadius(elM.a, elM.e) < SOI_MOON) {
			leg = moonBoundLeg(rel.relR, rel.relV, jd, elM);
		}
	}
	if (!leg) {
		var opts = { moonPlaneNormal: fig.normal };
		if (toFig) { Object.assign(opts, FINE_STEP); }
		if (input.maxTime) { opts.maxTime = input.maxTime; }
		leg = buildIntegratedLeg(rel.r, rel.v, jd, opts);
	}

	return { ok: true, from: input.from, to: input.to || null, jd: jd, fig: fig, toFig: toFig, release: rel,
	         legs: [leg], final: leg, summary: summarize(leg),
	         arrival: toFig && !input.skipArrival ? evaluateArrival(leg, toFig) : null };
}

// Geocentric state { r, v, jde } of the ship t seconds after release, clamped
// to the flight's span. A Moon-bound ellipse is carried along with the Moon.
export function flightStateAt(flight, t) {
	var leg = flight.final;
	t = Math.max(0, Math.min(leg.duration, t));
	if (leg.kind !== "moonEllipse") { return stateAtLegTime(leg, t); }
	var jde = leg.jde0 + t / DAY;
	var s = O.propagateState(GM_M, leg.relR, leg.relV, t);
	return { r: O.vAdd(moonGeoPos(jde), s.r), v: O.vAdd(moonGeoVel(jde), s.v), jde: jde };
}
