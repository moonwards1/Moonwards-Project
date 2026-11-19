/* Earth-Moon-Traffic-Plotter/core/offworld — taking in a ship that arrives
 * from another world.
 *
 * The Mission Planner sends an arrival at Earth (its Send to Earth–Moon
 * Traffic, MissionPlanner/modules/arrival-leg/earth-handoff.js) as a
 * ship-state packet relative to Earth: the ship's position and velocity where
 * it enters Earth's sphere of influence, and the date. This file reads it,
 * decides whether the plotter can take it, and gives the date it is flown on
 * here (core/arrival-date.js).
 *
 * THE ARRIVAL MUST ALREADY BE AIMED AT THE ATMOSPHERE. The plotter's first
 * burn, at the SOI edge, sets the pass to the exact height the aerobrake
 * needs; it is not there to turn a ship that was going somewhere else. So the
 * pass has to come within ACCEPT_WITHIN of the aerobrake corridor already:
 *
 *     | h_p - h_corridor | <= ACCEPT_WITHIN
 *
 *     h_p          the pass's height above Earth's surface, as flown from
 *                  (r, v) under Earth + Moon + Sun on the date it is flown
 *                  here (core/flight.js's arrivalPass); negative for a path
 *                  that would hit the ground, the height its two-body path
 *                  about Earth would reach
 *     h_corridor   the corridor's height (corridorAlt; CORRIDOR_ALT unless
 *                  the caller has the ship's own)
 *     a, e         the conic's semi-major axis and eccentricity
 *
 * The flown pass, not Earth's conic: over the two or three days in from the
 * SOI edge the Sun's and the Moon's pulls move the pass by up to several
 * hundred kilometres. From the SOI edge a
 * trim of 1 m/s moves the pass by roughly 100–140 km, so an arrival at the
 * limit needs some 7–10 m/s to reach the corridor.
 *
 * Pure (no DOM): Node-tested in core/tests/offworld.test.js.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { arrivalDateInSpan } from "./arrival-date.js";
import { offworldFigures } from "./facilities.js";
import { arrivalPass } from "./flight.js";

var O = OrbitalMath;
var GM_E = systems.get("Earth").GM;
var R_E = +systems.get("Earth").radius;
var M_SUN = systems.get("Sun").GM / 6.6743e-11;
var EARTH = systems.get("Earth");
export var SOI_EARTH = O.sphereOfInfluence((EARTH.orbit.apoapsis + EARTH.orbit.periapsis) / 2, EARTH.mass, M_SUN);

// The Exchange target the Mission Planner sends arrivals to.
export var OFFWORLD_TARGET = "earth-moon-traffic";
// How far the incoming pass may be from the corridor, m.
export var ACCEPT_WITHIN = 1000e3;
// A grazing pass's nominal braking height, m.
export var CORRIDOR_ALT = 80e3;

function vec3(x) {
	return Array.isArray(x) && x.length === 3 && x.every(function (c) { return typeof c === "number" && isFinite(c); });
}
function kmText(m) { return Math.round(m / 1e3).toLocaleString("en-US") + " km"; }
function passText(h) { return h >= 0 ? kmText(h) + " above Earth" : kmText(-h) + " below Earth's surface"; }

// The incoming pass of a geocentric state on its two-body path about Earth:
// { periAlt (m), vInf (m/s, null if bound), speed (m/s), distance (m) }.
export function incomingPass(r, v) {
	var el = O.elementsFromState(GM_E, r, v);
	var speed = O.vMag(v), dist = O.vMag(r), v2 = speed * speed - 2 * GM_E / dist;
	return { periAlt: O.periapsisRadius(el.a, el.e) - R_E, vInf: v2 > 0 ? Math.sqrt(v2) : null,
	         speed: speed, distance: dist };
}

// Read a packet. jd0, jd1: the plotter's date span; corridorAlt optional (m).
// Returns { ok: true, r, v, jd, origJd, moved, sunDeg, moonMiss, label,
// periAlt, vInf, speed, distance } or { ok: false, reason }, the reason a
// sentence for the card.
export function readArrival(packet, jd0, jd1, corridorAlt) {
	var hc = corridorAlt == null ? CORRIDOR_ALT : corridorAlt;
	var d = packet && packet.data;
	if (!packet || packet.type !== "ship-state" || !d) { return { ok: false, reason: "That is not a ship's arrival." }; }
	if (d.frame !== "body:Earth") { return { ok: false, reason: "The arrival is not stated relative to Earth." }; }
	if (!vec3(d.r) || !vec3(d.v) || !(typeof d.jd === "number" && isFinite(d.jd))) {
		return { ok: false, reason: "The arrival's position, velocity or date is missing." };
	}
	var pass = incomingPass(d.r, d.v);
	if (pass.distance > SOI_EARTH * 1.01 || O.vDot(d.r, d.v) >= 0) {
		return { ok: false, reason: "The ship is not coming in across Earth's sphere of influence." };
	}
	var date = arrivalDateInSpan(d.jd, jd0, jd1);
	if (!date) { return { ok: false, reason: "There is no date in the plotter's span to fly this arrival on." }; }
	var flown = arrivalPass(offworldFigures("offworld", { r: d.r, v: d.v, jd: date.jd }), date.jd, null, []);
	if (flown) { pass.periAlt = flown.alt; }
	if (Math.abs(pass.periAlt - hc) > ACCEPT_WITHIN) {
		return { ok: false, pass: pass, reason: pass.periAlt > hc
			? "Closest approach is too far from Earth. Please adjust to be less than " + kmText(ACCEPT_WITHIN) + "."
			: "Closest approach is " + passText(pass.periAlt) + ". Please adjust to be above Earth's surface." };
	}
	return Object.assign({ ok: true, r: d.r.slice(), v: d.v.slice(), jd: date.jd, origJd: d.jd, moved: date.moved,
	                       sunDeg: date.sunDeg, moonMiss: date.moonMiss,
	                       label: (packet.source && packet.source.label) || "Offworld arrival" }, pass);
}
