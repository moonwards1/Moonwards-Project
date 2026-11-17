/* Mars-System-Traffic-Plotter/core/facilities — the transport facilities of
 * the Mars system, as data plus the pure kinematics of each piece. Every one
 * follows the clock (core/clock.js): none has a free phase dial.
 *
 * THE PHOBOS SKYHOOK is a tether built on Phobos, hanging down toward Mars and
 * reaching up away from it. Phobos outweighs any tether by many orders of
 * magnitude, so Phobos's orbit is the tether's orbit (Notes/decisions.md, "A
 * moon-anchored skyhook"). Its own swinging left aside, the tether lies along
 * the line from Mars's centre through Phobos's, and a point of it at distance
 * s from Phobos's centre (positive away from Mars) is at
 *
 *     r(s) = r_P + s * u                u = r_P / D
 *     v(s) = v_P + s * du/dt            du/dt = (v_P - u (u . v_P)) / D
 *
 *     r_P, v_P  Phobos's position and velocity from Mars's centre
 *               (Shared/mars-ephemeris.js)
 *     D         Phobos's distance from Mars's centre at that instant
 *     u         unit vector from Mars to Phobos
 *     du/dt     how fast u is turning: the part of v_P across the line, over D
 *
 * Each point keeps its distance from Phobos and is carried round Mars at the
 * line's own turning rate, faster near Phobos's periapsis and slower near its
 * apoapsis. Phobos's distance changes by 283 km over each orbit, so the whole
 * tether rises and falls by that much: a point's ALTITUDE is quoted at
 * Phobos's mean distance, and is up to 142 km more or less at any instant.
 *
 * THE HANGING SKYHOOK is a tether on an orbit of its own, tilted to the
 * equator: its figures and where it is on the clock are core/hanging-skyhook.js.
 * The functions at the end of this file read either skyhook the same way.
 *
 * THE SPACE ELEVATOR is a tether from an anchor off the equator, turning with
 * Mars: core/elevator.js. With one in the design, the Phobos skyhook's top is
 * held short of where its tether would come too near the elevator's.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { MarsEphemeris as ME } from "../../../Shared/mars-ephemeris.js";
import { anchorConfig, BODY_PROFILES } from "../../../Shared/body-profiles.js";
import { HANGING_DEFAULTS, hangingFigures, hangingAt, hangingPointState } from "./hanging-skyhook.js";
import { ELEVATOR_DEFAULTS, KEEP_CLEAR, elevatorFigures } from "./elevator.js";

var O = OrbitalMath;
var MARS = systems.get("Mars");
export var GM_MARS = MARS.GM;
export var R_MARS = +MARS.radius;
// Where a falling ship is taken to have reached the atmosphere, m above the mean radius.
export var ENTRY_ALT = BODY_PROFILES.Mars.entryInterface * 1e3;

// The least length of tether either side of Phobos, m: the foot must hang
// below Phobos and the top stand above it.
var MIN_ARM = 50e3;

// Altitudes in metres above Mars's mean radius, at Phobos's mean distance.
// relAlt is where a ship is let go.
export var FACILITIES = {
	phobosSkyhook: {
		id: "phobosSkyhook", kind: "moonSkyhook", label: "Phobos skyhook", moon: "Phobos",
		defaults: { footAlt: 260e3, topAlt: 6800e3, relAlt: 260e3 }
	},
	hangingSkyhook: {
		id: "hangingSkyhook", kind: "hangingSkyhook", label: "Hanging skyhook", defaults: HANGING_DEFAULTS
	},
	spaceElevator: {
		id: "spaceElevator", kind: "spaceElevator", label: "Space elevator", defaults: ELEVATOR_DEFAULTS
	}
};
// The facilities a ship can be let go from, in the order they are listed.
export var SKYHOOKS = ["phobosSkyhook", "hangingSkyhook"];

export function facility(id) {
	var f = FACILITIES[id];
	if (!f) { throw new Error("facilities: unknown facility '" + id + "'"); }
	return f;
}

// A facility's full param set: its defaults with `params` on top.
export function resolveParams(id, params) {
	return Object.assign({}, facility(id).defaults, params || {});
}

function fail(code, message, values) {
	return { ok: false, diagnostic: { code: code, message: message, values: values || {} } };
}

// The limits a moon-anchored skyhook's altitudes must keep, m:
//   footMin   the lowest the foot may be set: Mars's floor for a tether (115 km,
//             where drag starts to matter) plus the tether's fall at periapsis
//   footMax, topMin   MIN_ARM either side of the moon
//   topMax    short of the next moon out at its nearest, less the tether's rise
//   centre    the moon's own mean altitude
//   swing     how far the tether rises and falls from its mean
export function moonSkyhookLimits(id) {
	var cfg = anchorConfig(facility(id).moon);
	var centre = cfg.centre * 1e3;
	return { footMin: cfg.footFloor * 1e3, footMax: centre - MIN_ARM, topMin: centre + MIN_ARM,
	         topMax: cfg.topCeiling * 1e3, centre: centre, swing: cfg.swing * 1e3 };
}

// A moon-anchored skyhook's fixed figures for one param set. Pure; returns
// { ok: true, ...figures } (SI) or { ok: false, diagnostic }. `elevator` is
// the space elevator's figures (core/elevator.js) when one is in the design:
// its phobosTopCap, where it has one, is then the highest the top may be set,
// and comes back as `topCap` (null where the elevator sets no limit).
//
//     omega   = 2 pi / P                  the moon's mean turning rate
//     v(alt)  = omega * (R + alt)         mean speed of the tether at an altitude
//     pull(r) = omega^2 * r - GM / r^2    what a mass on the tether feels,
//                                         outward positive (about zero at the moon)
//
//   sFoot, sTop, sRel   the foot, top and release point as distances from the
//                       moon's centre along the tether, m (negative: toward Mars)
//   vFoot, vTop, vRel   their mean speeds; the speed at an instant is skyhookAt's
//   vEscRel, vInfRel    escape speed at the release point's mean radius, and the
//                       speed a ship let go there keeps after leaving Mars (0 if bound)
export function moonSkyhookFigures(id, params, elevator) {
	var fac = facility(id), p = resolveParams(id, params), L = moonSkyhookLimits(id);
	var topCap = elevator && elevator.ok && elevator.phobosTopCap != null && elevator.phobosTopCap < L.topMax ? elevator.phobosTopCap : null;
	var vals = { footAlt: p.footAlt, topAlt: p.topAlt, relAlt: p.relAlt };
	function kmText(m) { return Math.round(m / 1e3).toLocaleString("en-US") + " km"; }
	if (!(isFinite(p.footAlt) && isFinite(p.topAlt) && isFinite(p.relAlt))) {
		return fail("bad-params", "The " + fac.label + " needs a number for every altitude.", vals);
	}
	if (!(p.footAlt >= L.footMin && p.footAlt <= L.footMax)) {
		return fail("foot-range", "The foot must be between " + kmText(L.footMin) + " and " + kmText(L.footMax)
			+ ": above the air when " + fac.moon + " is nearest Mars, and below " + fac.moon + ".", vals);
	}
	if (topCap != null && topCap < L.topMin) {
		return fail("top-range", "No tether can rise from " + fac.moon + " beside this space elevator: it would come within "
			+ kmText(KEEP_CLEAR) + " of the elevator's tether before it was " + kmText(MIN_ARM) + " long.", vals);
	}
	if (topCap != null && !(p.topAlt >= L.topMin && p.topAlt <= topCap)) {
		return fail("top-range", "The top must be between " + kmText(L.topMin) + " and " + kmText(Math.floor(topCap / 1e3) * 1e3)
			+ ": above " + fac.moon + ", and short of where the tether would come within " + kmText(KEEP_CLEAR)
			+ " of the space elevator's.", vals);
	}
	if (!(p.topAlt >= L.topMin && p.topAlt <= L.topMax)) {
		return fail("top-range", "The top must be between " + kmText(L.topMin) + " and " + kmText(L.topMax)
			+ ": above " + fac.moon + ", and short of Deimos's orbit.", vals);
	}
	if (!(p.relAlt >= p.footAlt && p.relAlt <= p.topAlt)) {
		return fail("release-off-tether", "The release point must lie on the tether, between the foot and the top.", vals);
	}
	var f = ME.moonFigures(fac.moon), omega = 2 * Math.PI / f.period;
	var rFoot = R_MARS + p.footAlt, rTop = R_MARS + p.topAlt, rRel = R_MARS + p.relAlt;
	function pull(r) { return omega * omega * r - GM_MARS / (r * r); }
	return {
		ok: true, id: id, kind: "moonSkyhook", moon: fac.moon, GM: GM_MARS, R: R_MARS,
		a: f.a, omega: omega, period: f.period, limits: L, topCap: topCap,
		footAlt: p.footAlt, topAlt: p.topAlt, relAlt: p.relAlt,
		sFoot: rFoot - f.a, sTop: rTop - f.a, sRel: rRel - f.a,
		vFoot: omega * rFoot, vTop: omega * rTop, vRel: omega * rRel,
		pullFoot: pull(rFoot), pullTop: pull(rTop),
		vEscRel: O.escapeVelocity(GM_MARS, rRel), vInfRel: O.hyperbolicExcess(omega * rRel, GM_MARS, rRel)
	};
}

// Where a moon-anchored skyhook is at Julian date jd:
//   rMoon, vMoon  the moon's state from Mars's centre
//   dist          its distance from Mars's centre, m
//   u, uDot       the tether's direction (Mars to moon), and its rate of turning (1/s)
//   normal        the pole of the moon's orbit
export function skyhookAt(fig, jd) {
	var s = ME.moonState(fig.moon, jd), dist = O.vMag(s.r), u = O.vScale(s.r, 1 / dist);
	var uDot = O.vScale(O.vSub(s.v, O.vScale(u, O.vDot(u, s.v))), 1 / dist);
	return { rMoon: s.r, vMoon: s.v, dist: dist, u: u, uDot: uDot, normal: s.normal };
}

// State { r, v } of the point of the tether at distance s from the moon's
// centre, where the tether is as skyhookAt gave it.
export function tetherPointState(at, s) {
	return { r: O.vAdd(at.rMoon, O.vScale(at.u, s)), v: O.vAdd(at.vMoon, O.vScale(at.uDot, s)) };
}

// ---- either skyhook --------------------------------------------------------------

// Every facility's figures for the plotter's params { <facility id>: params }.
// The Phobos skyhook is read against the space elevator, which limits its
// top, and the hanging skyhook against the Phobos skyhook and the space
// elevator, whose tethers it must keep clear of. A skyhook whose params are null is not in the design
// and gets no entry; nor does the space elevator unless it is given params.
export function allFigures(params) {
	var p = params || {}, out = {};
	if (p.spaceElevator) { out.spaceElevator = elevatorFigures(p.spaceElevator); }
	if (p.phobosSkyhook !== null) { out.phobosSkyhook = moonSkyhookFigures("phobosSkyhook", p.phobosSkyhook, out.spaceElevator); }
	if (p.hangingSkyhook !== null) { out.hangingSkyhook = hangingFigures(p.hangingSkyhook, out.phobosSkyhook || null, out.spaceElevator || null); }
	return out;
}

// Where the skyhook `fig` is at Julian date jd: skyhookAt's result or
// hanging-skyhook.js's hangingAt's. Both carry the tether's direction `u`.
export function facilityAt(fig, jd) {
	return fig.kind === "hangingSkyhook" ? hangingAt(fig, jd) : skyhookAt(fig, jd);
}

// State { r, v } of the point of the tether at distance s from its centre
// (Phobos, or the hanging skyhook's centre of mass), positive away from Mars.
export function pointState(fig, at, s) {
	return fig.kind === "hangingSkyhook" ? hangingPointState(at, s) : tetherPointState(at, s);
}

// The centre's distance from Mars's centre at that instant, m.
export function centreRadius(fig, at) { return fig.kind === "hangingSkyhook" ? at.rCom : at.dist; }

// The altitude the card gives for the point at distance s from the centre, m.
export function altitudeOf(fig, s) { return (fig.kind === "hangingSkyhook" ? fig.rCom : fig.a) + s - fig.R; }

// The state a ship is let go with from the skyhook `fig` at Julian date jd:
// { r, v } from Mars's centre, `radius` (m from Mars's centre) and `altitude`
// (m above the mean radius) of the release point at that instant, and `at`,
// facilityAt's result.
export function releaseState(fig, jd) {
	var at = facilityAt(fig, jd), st = pointState(fig, at, fig.sRel), radius = centreRadius(fig, at) + fig.sRel;
	return { r: st.r, v: st.v, radius: radius, altitude: radius - fig.R, at: at };
}
