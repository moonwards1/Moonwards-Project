/* Shared/kinematic-chain.js — kinematic chain evaluator (Mission Planner
 * task I2): a base body plus an ordered list of rigid rotors, each pivoting
 * on whatever the chain has composed so far and contributing its own
 * uniform circular motion — a fixed plane (normal + a phase-0 reference
 * direction), radius, rotation rate, and phase at an epoch. Feeds task I3's
 * departure carriers (Moon -> skyhook -> a future tip-spin-launcher): the
 * Moon is the base, the skyhook is rotor 0, a tip launcher would be rotor 1
 * riding the skyhook's own tip.
 *
 * Composition is a plain vector sum, not a rotating-frame transform: every
 * rotor's plane is fixed in the same non-rotating, ecliptic-aligned axes the
 * rest of Shared/ works in (see geo-leg.js's header), so a rotor's own
 * uniform circular motion adds directly onto its parent's state without any
 * Coriolis/centrifugal bookkeeping — exactly the assumption
 * lunar-skyhook.js's inline "tether kinematics" already made (and the
 * Moon-Skyhook plotter's hookBasis before it). Nothing here touches gravity
 * or escape physics: this file computes WHERE the payload is and how fast
 * it's moving relative to the fixed stars, not whether it's bound or
 * escaping — that belongs downstream (task I3's departure-leg feeds this
 * position/velocity into geo-leg.js's integrator).
 *
 * Chain shape (plain, serializable data):
 *   { base: "Moon" | "Earth",
 *     rotors: [ { normal: [x,y,z], ref: [x,y,z], radius, rate, phase0, epoch }, ... ] }
 * All vectors plain [x,y,z]; metres, seconds, radians throughout. `normal`
 * is the rotor's plane normal (need not be pre-normalized); `ref` is any
 * vector with a nonzero component in that plane — it fixes the phase-0
 * direction, need not be a unit vector or already orthogonal to `normal`.
 * `rate` is the rotor's angular rate (rad/s; sign gives rotation sense);
 * `phase0` is its phase (rad) at Julian date `epoch` — evaluating at
 * jd = epoch reduces to exactly phase0, so a rotor whose phase is pinned at
 * a specific date (e.g. a release phase fixed at the release date) never
 * needs a drift term folded in by the caller.
 *
 * Pure (no DOM, no THREE): Node-testable. Imports LunarEphemeris only for
 * the Moon base-body lookup.
 *
 * Imports from ./ — this file breaks if moved without lunar-ephemeris.js
 * and math-utils.js.
 */

import { OrbitalMath } from "./math-utils.js";
import { LunarEphemeris } from "./lunar-ephemeris.js";

var O = OrbitalMath;
var LE = LunarEphemeris;
var DAY = 86400;

// Geocentric state (m, m/s) of a chain's base body at Julian date jd. Only
// the bodies the departure system's chain actually starts from are known
// here; add more as chains need them.
var BASE_STATES = {
	Moon: function (jd) {
		var ms = LE.moonState(jd);
		return { r: O.vScale(ms.r, 1e3), v: O.vScale(ms.v, 1e3) };
	},
	Earth: function () {
		return { r: [0, 0, 0], v: [0, 0, 0] };
	}
};

export function baseState(name, jd) {
	var fn = BASE_STATES[name];
	if (!fn) { throw new Error("kinematic-chain: unknown base body '" + name + "'"); }
	return fn(jd);
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

// Evaluate a chain at Julian date jd: the base body's own geocentric
// ephemeris state, composed with each rotor's circular contribution in
// order (each pivots on the state accumulated so far). Returns
// { r, v } geocentric, metres and m/s.
export function evaluateChain(chain, jd) {
	var state = baseState(chain.base, jd);
	(chain.rotors || []).forEach(function (rotor) {
		state = addRotor(state, rotor, jd);
	});
	return state;
}
