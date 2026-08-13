/* Shared/kinematic-chain.js — kinematic chain evaluator: a base body plus the
 * contributions of the departure platforms stacked on it, composed into the
 * state of the payload they release. Each departure platform in the Mission
 * Planner's carrier stack appends ONE element here (see
 * MissionPlanner/modules/platform/platform-spec.js).
 *
 * There are two element kinds, because that is what the platforms actually do:
 *
 *   - a ROTOR — uniform circular motion in a fixed plane (normal + a phase-0
 *     reference direction), with a radius, a rotation rate and a phase at an
 *     epoch. This is hardware that carries the payload around and lets go:
 *     a skyhook, a space elevator (turning at its body's own rate), a ring
 *     mass driver, a tip spin launcher.
 *   - an IMPULSE — a plain Δv, no position and no motion of its own. This is
 *     hardware that pushes: a linear mass driver's track, a tug, a rocket.
 *     A surface launcher is normally both — a rotor of the body's radius
 *     turning at its sidereal rate, plus the impulse the track imparts.
 *
 * Composition is a plain vector sum, not a rotating-frame transform: every
 * element is expressed in the same non-rotating, ecliptic-aligned axes the
 * rest of Shared/ works in (see geo-leg.js's header), so each contribution
 * adds directly onto what the chain has composed so far without any
 * Coriolis/centrifugal bookkeeping. Order within the chain therefore does not
 * affect the result. Nothing here touches gravity or escape physics: this
 * file computes WHERE the payload is and how fast it's moving relative to the
 * fixed stars, not whether it's bound or escaping — that belongs downstream,
 * where the departure legs feed this position/velocity into their integrator.
 *
 * Chain shape (plain, serializable data):
 *   { base: "Moon" | "Earth" | <any origin body>,
 *     rotors:   [ { normal: [x,y,z], ref: [x,y,z], radius, rate, phase0, epoch }, ... ],
 *     impulses: [ { dv: [x,y,z] }, ... ] }
 * All vectors plain [x,y,z]; metres, seconds, radians throughout. `normal`
 * is the rotor's plane normal (need not be pre-normalized); `ref` is any
 * vector with a nonzero component in that plane — it fixes the phase-0
 * direction, need not be a unit vector or already orthogonal to `normal`.
 * `rate` is the rotor's angular rate (rad/s; sign gives rotation sense);
 * `phase0` is its phase (rad) at Julian date `epoch` — evaluating at
 * jd = epoch reduces to exactly phase0, so a rotor whose phase is pinned at
 * a specific date (e.g. a release phase fixed at the release date) never
 * needs a drift term folded in by the caller. `impulses` is optional; a chain
 * without one is a chain of pure rotors.
 *
 * Pure (no DOM, no THREE): Node-testable. Imports LunarEphemeris only for
 * the Moon base-body lookup.
 *
 * Imports from ./ — this file breaks if moved without lunar-ephemeris.js
 * and math-utils.js.
 */

import { systems } from "./orbit.js";
import { OrbitalMath } from "./math-utils.js";
import { LunarEphemeris } from "./lunar-ephemeris.js";

var O = OrbitalMath;
var LE = LunarEphemeris;
var DAY = 86400;

// State (m, m/s) of a chain's base body in the integration frame it anchors,
// at Julian date jd. The base body is the ORIGIN of its own integration
// frame, so it sits at rest at [0,0,0] — true of Earth (the Earth–Moon
// system's geocentric frame, task I2) and of any generic departure origin
// (Mars, Ceres, … in its own body-centred frame, task J2/WP-J: the skyhook
// orbits the body directly, no satellite modelled). The Moon is the one
// exception: a lunar departure rides the Moon AROUND Earth, so base "Moon"
// carries the Moon's real geocentric ephemeris state onto which the skyhook
// rotor adds.
var BASE_STATES = {
	Moon: function (jd) {
		var ms = LE.moonState(jd);
		return { r: O.vScale(ms.r, 1e3), v: O.vScale(ms.v, 1e3) };
	}
};

export function baseState(name, jd) {
	var fn = BASE_STATES[name];
	if (fn) { return fn(jd); }
	// Any other known body is the origin of its own frame (Earth for the
	// geocentric system; a generic origin body for its body-centred one).
	if (systems.get(name)) { return { r: [0, 0, 0], v: [0, 0, 0] }; }
	throw new Error("kinematic-chain: unknown base body '" + name + "'");
}

// Orthonormal in-plane basis for a rotor: e1 is `ref` projected orthogonal
// to `normal` (neither argument needs to be pre-normalized) and normalized;
// e2 completes a right-handed pair (normal x e1), so phase 0 points along e1
// and phase advances toward e2.
export function planeBasis(normal, ref) {
	var n = O.vUnit(normal);
	var proj = O.vScale(n, O.vDot(ref, n));
	var e1 = O.vUnit(O.vSub(ref, proj));
	var e2 = O.vCross(n, e1);
	return { e1: e1, e2: e2 };
}

// Position + velocity (geocentric, m / m/s) contributed by one rotor at
// Julian date jd, added onto its parent's already-composed state.
function addRotor(parent, rotor, jd) {
	var basis = planeBasis(rotor.normal, rotor.ref);
	var phase = rotor.phase0 + rotor.rate * (jd - rotor.epoch) * DAY;
	var dir = O.vAdd(O.vScale(basis.e1, Math.cos(phase)), O.vScale(basis.e2, Math.sin(phase)));
	var tan = O.vAdd(O.vScale(basis.e1, -Math.sin(phase)), O.vScale(basis.e2, Math.cos(phase)));
	return {
		r: O.vAdd(parent.r, O.vScale(dir, rotor.radius)),
		v: O.vAdd(parent.v, O.vScale(tan, rotor.radius * rotor.rate))
	};
}

// One element's own contribution, added onto `state` (whatever precedes it —
// a real parent state from evaluateChain's walk, or a bare { r:[0,0,0],
// v:[0,0,0] } to isolate the element in ITS OWN terms, decoupled from
// whatever it rides on — see platform-roles.js's straddling readout box,
// which wants exactly that isolation rather than a "net" figure blended with
// the carrier underneath it). Exported so both evaluateChain (below) and that
// isolation case share the one rotor/impulse formula.
export function applyElement(state, element, jd) {
	if (!element) { return state; }
	if (element.kind === "impulse") { return { r: state.r, v: O.vAdd(state.v, element.dv) }; }
	return addRotor(state, element, jd);
}

// Evaluate a chain at Julian date jd: the base body's own state in the frame
// it anchors, plus every rotor's circular contribution and every impulse's
// Δv. Returns { r, v } in that frame, metres and m/s. Impulses move the
// payload's velocity only — a push has no radius of its own, so whatever
// rotor holds the launcher is what places it in space.
export function evaluateChain(chain, jd) {
	var state = baseState(chain.base, jd);
	(chain.rotors || []).forEach(function (rotor) { state = applyElement(state, rotor, jd); });
	(chain.impulses || []).forEach(function (impulse) { state = applyElement(state, impulse, jd); });
	return state;
}

// ---- building a chain ------------------------------------------------------
// The Mission Planner's carrier stages compose a chain through these rather
// than by reaching into its arrays, so the shape stays in one place as
// element kinds are added.

// A chain with a base body and nothing on it yet.
export function emptyChain(base) {
	return { base: base, rotors: [], impulses: [] };
}

// A rotor element. `phase0` is its phase (rad) at `epoch` — see the header.
export function rotorElement(normal, ref, radius, rate, phase0, epoch) {
	return { kind: "rotor", normal: normal, ref: ref, radius: radius,
	         rate: rate, phase0: phase0, epoch: epoch };
}

// An impulse element: a Δv (m/s) in the chain's own ecliptic-aligned axes.
export function impulseElement(dv) {
	return { kind: "impulse", dv: dv };
}

// `chain` with `element` appended, as a fresh object — an upstream chain is
// another stage's emitted packet and is never mutated. An element with no
// `kind` is taken for a rotor, the only kind chains originally held.
export function appendElement(chain, element) {
	var next = {
		base: chain.base,
		rotors: (chain.rotors || []).slice(),
		impulses: (chain.impulses || []).slice()
	};
	if (element && element.kind === "impulse") { next.impulses.push(element); }
	else if (element) { next.rotors.push(element); }
	return next;
}

// How many elements a chain carries, of either kind — zero means nothing on
// the chain sets the payload moving.
export function elementCount(chain) {
	if (!chain) { return 0; }
	return ((chain.rotors || []).length) + ((chain.impulses || []).length);
}
