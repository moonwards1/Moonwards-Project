/* Mars-System-Traffic-Plotter/core/flight — one flight through the Mars
 * system, computed from the plotter's state. The page draws what this returns
 * and computes nothing of its own.
 *
 * A flight starts at a facility (core/facilities.js) at a release date. The
 * release state is not chosen: it is where the release point IS at that
 * instant, moving as it moves. The ship then coasts under
 *
 *     a = -GM r / |r|^3  +  a_bulge(r)  +  a_Sun(r, t)
 *
 *     GM       Mars's gravitational parameter
 *     a_bulge  the pull of Mars's equatorial bulge (OrbitalMath.j2Acceleration,
 *              J2 = 1.96e-3) — the thing that speeds Phobos round and turns
 *              tilted orbits, so a ship let go beside Phobos stays beside it
 *     a_Sun    the Sun's pull on the ship less its pull on Mars
 *
 * integrated by Shared/body-leg.js (RK4), until one of three things happens:
 *
 *   "entry"   it comes down to the entry interface, ENTRY_ALT above the mean radius
 *   "escape"  it leaves Mars's sphere of influence, unbound
 *   "orbit"   neither: it is flown once round its orbit
 *
 * A flight bound for the other skyhook is flown the same way, and is then
 * judged against that skyhook's tether (core/arrival.js): its closest pass,
 * and whether the ship can be caught there.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { MarsEphemeris as ME } from "../../../Shared/mars-ephemeris.js";
import { buildIntegratedLeg, bodySOI, stateAtLegTime } from "../../../Shared/body-leg.js";
import { allFigures, releaseState, GM_MARS, R_MARS, ENTRY_ALT } from "./facilities.js";
import { evaluateArrival } from "./arrival.js";

// The destination that is not a facility: the ground.
export var SURFACE = "surface";

var O = OrbitalMath;
var DAY = 86400;
var J2 = systems.get("Mars").J2;
export var SOI_MARS = bodySOI("Mars");

function bulge(r) { return O.j2Acceleration(GM_MARS, J2.value, J2.radius, r, ME.pole); }
var LEG_OPTS = { extraAccel: bulge, entryRadius: R_MARS + ENTRY_ALT, exitRadius: SOI_MARS };

// The tilt (rad) of the orbit through (r, v) to Mars's equator.
function tiltToEquator(r, v) {
	var h = O.vCross(r, v), m = O.vMag(h);
	return m > 0 ? Math.acos(Math.max(-1, Math.min(1, O.vDot(h, ME.pole) / m))) : 0;
}

// A velocity v at position r (from Mars's centre) as the ground sees it at
// jd: less the velocity of a point there that turns with Mars,
//
//     v_ground = v - w * (p x r)
//
//     w   Mars's spin rate, rad/s
//     p   unit vector along Mars's spin axis
//
// Near the ground this is the speed against the air. Far out it is large even
// for a ship standing still against the stars, since the ground's turning
// sweeps past it.
export function groundRelative(r, v, jd) {
	var o = ME.orientation(jd);
	return O.vSub(v, O.vScale(O.vCross(o.pole, r), o.rate));
}

// What the page reads off a flight, SI:
//   outcome       "entry" | "escape" | "orbit"
//   duration      how long the flight is flown, s
//   tilt          of its orbit to Mars's equator at release, rad
//   periAlt, apoAlt  of the two-body orbit through the release state, m above
//                 the mean radius (apoAlt null when unbound); for an "orbit"
//                 they are the lowest and highest the flown path went
//   period        of that orbit, s (null when unbound)
// and for an "entry":
//   entrySpeed    speed at the interface, against the stars, m/s
//   entryAirSpeed speed there against the air, which turns with the ground, m/s
//   entryAngle    how steeply it is descending, rad below the horizontal
//   entryAirAngle the same, of its motion against the air
// and for an "escape":
//   vInf          the speed it keeps after leaving Mars, m/s
function summarize(leg, rel, jd) {
	var el = O.elementsFromState(GM_MARS, rel.r, rel.v), bound = el.e < 1;
	var s = { outcome: leg.branch === "entry" ? "entry" : (leg.branch === "sun" ? "escape" : "orbit"),
	          duration: leg.duration, tilt: tiltToEquator(rel.r, rel.v),
	          periAlt: O.periapsisRadius(el.a, el.e) - R_MARS,
	          apoAlt: bound ? O.apoapsisRadius(el.a, el.e) - R_MARS : null,
	          period: bound ? 2 * Math.PI * Math.sqrt(Math.pow(el.a, 3) / GM_MARS) : null };
	if (s.outcome === "orbit") { s.periAlt = leg.rmin - R_MARS; s.apoAlt = leg.rmax - R_MARS; }
	if (s.outcome === "entry") {
		var last = leg.samples[leg.samples.length - 1], jdEnd = jd + leg.duration / DAY;
		var vAir = groundRelative(last.r, last.v, jdEnd);
		s.entrySpeed = leg.entry.v; s.entryAngle = leg.entry.fpaRad;
		s.entryAirSpeed = O.vMag(vAir);
		s.entryAirAngle = Math.asin(Math.max(-1, Math.min(1, -O.vDot(last.r, vAir) / (O.vMag(last.r) * s.entryAirSpeed))));
	}
	if (s.outcome === "escape") { s.vInf = leg.vinfBody; }
	return s;
}

// Compute a flight.
//   input: { from, to, jd, params }
//     from     facility id (core/facilities.js) the ship is released from
//     to       SURFACE (the default), or the id of the skyhook it is bound for
//     jd       release Julian date
//     params   optional { <facility id>: its params; null for one not in the design }
// Returns { ok: true, from, to, jd, fig, release, leg, summary, toFig, arrival } or { ok: false, diagnostic }.
//   toFig, arrival   the destination skyhook's figures and arrival.js's
//                    evaluateArrival result; both null for a flight to the surface
//   fig      the origin's figures (facilities.js's allFigures)
//   release  facilities.js's releaseState at jd
//   leg      the Shared/body-leg.js leg flown: Mars-centred { r, v, t } samples
export function computeFlight(input) {
	var figs = allFigures(input.params), fig = figs[input.from], to = input.to || SURFACE;
	var toFig = to === SURFACE ? null : figs[to];
	if (to !== SURFACE && (!toFig || to === input.from)) {
		return { ok: false, diagnostic: { code: "no-destination", message: "That destination is not in the design.", values: {} } };
	}
	if (toFig && !toFig.ok) { return toFig; }
	if (!fig) { return { ok: false, diagnostic: { code: "no-facility", message: "That facility is not in the design.", values: {} } }; }
	if (!fig.ok) { return fig; }
	var rel = releaseState(fig, input.jd);
	var leg = buildIntegratedLeg("Mars", rel.r, rel.v, input.jd, LEG_OPTS);
	return { ok: true, from: input.from, to: to, jd: input.jd, fig: fig, release: rel, leg: leg,
	         summary: summarize(leg, rel, input.jd), toFig: toFig, arrival: toFig ? evaluateArrival(leg, toFig) : null };
}

// Mars-centred state { r, v, jde } of the ship t seconds after release,
// clamped to the flight's span.
export function flightStateAt(flight, t) {
	return stateAtLegTime(flight.leg, Math.max(0, Math.min(flight.leg.duration, t)));
}
