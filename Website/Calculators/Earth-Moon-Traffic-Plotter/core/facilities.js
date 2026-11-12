/* Earth-Moon-Traffic-Plotter/core/facilities — the infrastructure of the
 * Earth–Moon system, as data plus the pure kinematics of each piece.
 *
 * EVERYTHING FOLLOWS ONE CLOCK. A facility has no free phase dial: its
 * orientation at any Julian date follows from a fixed angle at CLOCK_EPOCH and
 * its own rotation rate, so two facilities shown at the same instant are where
 * they would really be relative to each other — which is what lets a flight
 * from one be caught by another.
 *
 *     phase(jd) = phase0 + omega * (jd - CLOCK_EPOCH) * 86400
 *
 *     phase0   the tether's angle at CLOCK_EPOCH, rad (per facility, fixed)
 *     omega    its rotation rate, rad/s — the CoM's circular orbital rate
 *     jd       Julian date
 *
 * A skyhook here is the design's HANGING skyhook: a gravity-gradient tether
 * lying along the local vertical, turning once per orbit, so a point at radius
 * r from the body's centre moves at omega * r. It orbits in its body's
 * equatorial plane (MissionPlanner/modules/skyhook/skyhook.js's equatorPlane),
 * with phase 0 along the equinox direction projected into that plane.
 *
 * The table holds the two skyhooks. The L1 elevator and the lunar mass driver
 * join it as their own kinds.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 *
 * Imports from ../../../Shared/ and ../../../MissionPlanner/modules/skyhook/ —
 * this folder breaks if moved without them coming along.
 */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { emptyChain, appendElement, evaluateChain, rotorElement, planeBasis, baseState }
	from "../../../Shared/kinematic-chain.js";
import { equatorPlane } from "../../../MissionPlanner/modules/skyhook/skyhook.js";

var O = OrbitalMath;
var DAY = 86400;
var TWO_PI = 2 * Math.PI;

// The instant every facility's phase0 is stated at: 2080-01-01 00:00, the
// start of the plotter's date span.
export var CLOCK_EPOCH = O.julianDate(2080, 1, 1, 0, 0, 0);

// Phase 0's direction before projection into a facility's plane: the equinox
// (+X of the ecliptic axes every frame here shares). Fixed, so a plane's
// basis never depends on the date.
var CLOCK_REF = [1, 0, 0];

// Altitudes in metres above the body's mean radius. Defaults are the example
// design exported from the home workbench (2026-11-10). relAlt is where a ship
// is let go when the facility is a flight's origin with no destination: the
// Moon skyhook's release deck (its Earth release point), the Earth skyhook's
// top. catchAlt is where the mobile catcher is when the facility is a flight's
// destination: the page moves it to wherever the ship passes, and
// core/target.js's solveCatch aims a ship at it.
//
// Each skyhook has one point where traffic to and from the other one is at the
// tether's own speed (omega * r = the ship's speed there), so a ship can be
// let go onto the slowest path across, or taken hold of off it, with little
// relative motion: the Moon skyhook's release deck at 949.4 km, and near 5,200 km
// on the Earth skyhook. That point is both the catch point and, in releaseFor,
// where a flight to the other skyhook starts from.
//
// releaseFor: { <destination id>: altitude } — the release point a flight to
// that destination starts from (routeReleaseAlt).
export var FACILITIES = {
	moonSkyhook: {
		id: "moonSkyhook", kind: "skyhook", label: "Moon skyhook", body: "Moon",
		phase0: 0,
		defaults: { footAlt: 1e3, comAlt: 275e3, topAlt: 2000e3, relAlt: 949.4e3, catchAlt: 949.4e3 },
		releaseFor: { earthSkyhook: 949.4e3 }
	},
	earthSkyhook: {
		id: "earthSkyhook", kind: "skyhook", label: "Earth skyhook", body: "Earth",
		phase0: 0,
		defaults: { footAlt: 120e3, comAlt: 2900e3, topAlt: 6200e3, relAlt: 6200e3, catchAlt: 5200e3 },
		releaseFor: { moonSkyhook: 5200e3 }
	}
};

// Which facilities a flight from each origin may be aimed at. A flight may
// also have no destination at all (an open path).
export var DESTINATIONS = { moonSkyhook: ["earthSkyhook"], earthSkyhook: ["moonSkyhook"] };

export function facility(id) {
	var f = FACILITIES[id];
	if (!f) { throw new Error("facilities: unknown facility '" + id + "'"); }
	return f;
}

// A facility's full param set: its defaults with `params` on top.
export function resolveParams(id, params) {
	return Object.assign({}, facility(id).defaults, params || {});
}

// The release altitude (m) a flight from `from` to `to` starts at, kept on the
// tether as `params` has it; null when the route names no release point.
export function routeReleaseAlt(from, to, params) {
	var alt = (facility(from).releaseFor || {})[to];
	if (alt == null) { return null; }
	var p = resolveParams(from, params);
	return Math.max(p.footAlt, Math.min(p.topAlt, alt));
}

function fail(code, message, values) {
	return { ok: false, diagnostic: { code: code, message: message, values: values || {} } };
}

// A skyhook's geometry and rotation figures for one param set. Pure; returns
// { ok: true, ...figures } (SI: m, m/s, rad/s, s) or { ok: false, diagnostic }.
//
//     omega = sqrt(GM / rCom^3)          the CoM's circular orbital rate
//     v(r)  = omega * r                  speed of the tether at radius r
//     pull(r) = omega^2 * r - GM / r^2   what a mass on the tether feels,
//                                        outward positive (zero at the CoM)
export function skyhookFigures(id, params) {
	var fac = facility(id);
	var p = resolveParams(id, params);
	var sys = systems.get(fac.body);
	var GM = sys.GM, R = +sys.radius;
	var vals = { footAlt: p.footAlt, comAlt: p.comAlt, topAlt: p.topAlt, relAlt: p.relAlt };
	if (!(isFinite(p.footAlt) && isFinite(p.comAlt) && isFinite(p.topAlt) && isFinite(p.relAlt))) {
		return fail("bad-params", "The " + fac.label + " needs a number for every altitude.", vals);
	}
	if (!(p.footAlt > 0 && p.footAlt < p.comAlt && p.comAlt < p.topAlt)) {
		return fail("bad-order", "The " + fac.label + "'s foot must be above the ground and below its centre of mass, and its top above that.", vals);
	}
	if (!(p.relAlt >= p.footAlt && p.relAlt <= p.topAlt)) {
		return fail("release-off-tether", "The release point must lie on the tether, between the foot and the top.", vals);
	}
	if (!(p.catchAlt >= p.footAlt && p.catchAlt <= p.topAlt)) {
		return fail("catch-off-tether", "The catch point must lie on the tether, between the foot and the top.",
			Object.assign(vals, { catchAlt: p.catchAlt }));
	}
	var rFoot = R + p.footAlt, rCom = R + p.comAlt, rTop = R + p.topAlt, rRel = R + p.relAlt;
	var omega = O.angularVelocity(GM, rCom);
	var plane = equatorPlane(fac.body, null, CLOCK_REF);
	return {
		ok: true, id: id, body: fac.body, GM: GM, R: R,
		omega: omega, period: TWO_PI / omega,
		rFoot: rFoot, rCom: rCom, rTop: rTop, rRel: rRel, rCatch: R + p.catchAlt,
		vFoot: omega * rFoot, vCom: omega * rCom, vTop: omega * rTop, vRel: omega * rRel,
		pullTop: omega * omega * rTop - GM / (rTop * rTop),
		vEscRel: O.escapeVelocity(GM, rRel),
		vInfBody: O.hyperbolicExcess(omega * rRel, GM, rRel),   // 0 when bound
		normal: O.vUnit(plane.normal), ref: plane.ref, phase0: fac.phase0
	};
}

// The tether's angle (rad, 0..2pi) at Julian date jd, from the clock.
export function phaseAt(fig, jd) {
	var ph = (fig.phase0 + fig.omega * (jd - CLOCK_EPOCH) * DAY) % TWO_PI;
	return ph < 0 ? ph + TWO_PI : ph;
}

// The tether's angle (rad, 0..2pi) measured from the direction of its body's
// PARTNER — Earth for a skyhook at the Moon, the Moon for one at Earth — as
// that direction falls in the tether's plane. Zero is the tether pointing at
// the partner; it grows the way the tether turns. This is the "phase" a user
// holds steady while searching dates: the same value means the ship is let go
// the same way relative to the Earth–Moon line.
export function relativePhase(fig, jd) {
	var m = baseState("Moon", jd).r;
	var d = fig.body === "Moon" ? O.vScale(m, -1) : m;
	var b = planeBasis(fig.normal, fig.ref);
	var a = (phaseAt(fig, jd) - Math.atan2(O.vDot(d, b.e2), O.vDot(d, b.e1))) % TWO_PI;
	return a < 0 ? a + TWO_PI : a;
}

// The first Julian date at or after jd at which relativePhase equals `held`.
// The tether gains on the partner's direction at very nearly omega, so one
// estimate and a few corrections land on it; it is always within a little
// over one tether period.
export function nextPhaseMatch(fig, jd, held) {
	function err(t) {
		var e = (held - relativePhase(fig, t)) % TWO_PI;
		return e > Math.PI ? e - TWO_PI : (e <= -Math.PI ? e + TWO_PI : e);
	}
	var first = err(jd);
	if (first < -1e-9) { first += TWO_PI; }
	var t = jd + first / fig.omega / DAY;
	for (var i = 0; i < 4; i++) { t += err(t) / fig.omega / DAY; }
	return t < jd ? jd : t;
}

// How far the centre of `body` lies from the plane the skyhook `fig` turns in,
// at Julian date jd: metres, positive on the side of the skyhook's pole. A ship
// let go by the tether starts out moving in that plane, and near Earth it
// stays close to it — so a flight from the Earth skyhook can only meet the
// Moon while the Moon is passing through Earth's equatorial plane.
export function bodyOffPlane(fig, body, jd) {
	return O.vDot(O.vSub(baseState(body, jd).r, baseState(fig.body, jd).r), fig.normal);
}

// The kinematic chain (Shared/kinematic-chain.js) of the point on the tether
// at radius r from the body's centre: the body, plus one rotor on the clock.
export function tetherChain(fig, r) {
	return appendElement(emptyChain(fig.body),
		rotorElement(fig.normal, fig.ref, r, fig.omega, fig.phase0, CLOCK_EPOCH));
}

// State of the point on the tether at radius r, at Julian date jd:
// { r, v } geocentric (m, m/s — the frame Shared/geo-leg.js integrates in)
// and { relR, relV } relative to the facility's own body.
export function tetherPointState(fig, r, jd) {
	var geo = evaluateChain(tetherChain(fig, r), jd);
	var base = baseState(fig.body, jd);
	return { r: geo.r, v: geo.v, relR: O.vSub(geo.r, base.r), relV: O.vSub(geo.v, base.v) };
}

// The tether's unit directions at jd, in the shared ecliptic axes: `along`
// from the body's centre out along the tether, `prograde` the way it moves,
// `normal` its orbit's pole.
export function tetherAxes(fig, jd) {
	var b = planeBasis(fig.normal, fig.ref), ph = phaseAt(fig, jd);
	return {
		along: O.vAdd(O.vScale(b.e1, Math.cos(ph)), O.vScale(b.e2, Math.sin(ph))),
		prograde: O.vAdd(O.vScale(b.e1, -Math.sin(ph)), O.vScale(b.e2, Math.cos(ph))),
		normal: fig.normal
	};
}
