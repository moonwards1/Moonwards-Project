/* Earth-Moon-Traffic-Plotter/core/aerobrake — the single grazing pass through
 * Earth's upper air that turns an arrival from another world into a long
 * orbit reaching out towards the edge of Earth's sphere of influence.
 *
 * The pass is taken as an instant loss of speed at periapsis, straight back
 * along the ship's motion, so it changes the orbit's size and nothing else.
 *
 * HOW MUCH THE AIR TAKES OFF. The Earth aerobrake model (Calculators/
 * Earth-Aerobrake-Calculator) gives, for the ship's ballistic coefficient β
 * (Shared/ships.js), the height h_0 at which the air takes off shed_0, the
 * speed that leaves for the reference apoapsis REF_APO:
 *
 *     v_out = sqrt( 2 GM r_a / ( r_p (r_a + r_p) ) )
 *     shed_0 = v_p - v_out(REF_APO)
 *
 *     v_p   the ship's speed at periapsis coming in, m/s
 *     r_p   periapsis radius, m;  r_a an apoapsis radius, m
 *
 * with the peak deceleration, dynamic pressure, heat flux and the heat-shield
 * mass that pass needs. Drag goes with the air's density, which falls off by
 * a factor e every scale height H, so a pass at any other height h_p takes off
 *
 *     shed(h_p) = shed_0 · exp( -(h_p - h_0) / H )
 *
 * and the ship leaves on whatever orbit that speed gives. Nothing holds the
 * exit: the pass's height, set by the entry trim, decides it. It is very
 * sensitive, since the orbit leaves only just below escape: a pass 100 m
 * higher can leave on an orbit hundreds of thousands of km longer. A pass that
 * leaves slower than the circular speed at periapsis, sqrt(GM / r_p), does
 * not come back up: the ship falls into the atmosphere. The peak deceleration
 * and dynamic pressure scale with the density, exp(-(h_p - h_0) / H); the heat
 * flux with its square root.
 *
 * THE CORRIDOR is the band of loops worth flying: apogee between
 * CORRIDOR_APO[0] and CORRIDOR_APO[1]. Whether a pass is in it is judged on
 * the loop as flown (core/flight.js), since far out the Sun moves the apogee
 * by hundreds of thousands of km. Its edges as pass heights are the two-body
 * estimate, the heights whose shed gives those apoapses on Earth's conic:
 *
 *     h(r_a) = h_0 - H ln( shed(r_a) / shed_0 ),   shed(r_a) = v_p - v_out(r_a)
 *
 * Pure (no DOM): Node-tested in core/tests/aerobrake.test.js.
 */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { CAPSULE_CD, entryMass, shieldMass, START_CLASSES } from "../../../Shared/ships.js";
import { computeAerobrake, EARTH_SOI } from "../../Earth-Aerobrake-Calculator/aerobrakeModel.js";

var O = OrbitalMath;
var GM = systems.get("Earth").GM;
var R_E = +systems.get("Earth").radius;

export var SCALE_H = 7160;                 // m, the aerobrake model's scale height
// The apoapsis the model's reference pass leaves for: it anchors the density
// law, and Aim brings the pass to its height.
export var REF_APO = 0.9 * EARTH_SOI;
// The loops worth flying: out past the Moon's orbit, and no further than
// just inside Earth's Hill sphere (about 1.5 million km), past which the ship
// leaves Earth. That far out the Sun's pull can lift the next perigee.
export var CORRIDOR_APO = [450e6, 1.45e9];
// The apogee Aim flies the loop out to, as flown (Earth + Moon + Sun): far
// enough out for the Sun to lift the next perigee well clear, and still inside
// the corridor. The Sun shortens or stretches a loop this long by a fifth or
// more against its two-body apoapsis, so Aim solves on the flight itself.
export var AIM_APO = 1.4e9;
export var ABOVE_AIR = 300e3;
// How full a freighter's tanks are when it arrives from another world: tanks
// are sized for the worst route, and an arrival keeps only a reserve.
export var TANK_FILL = 0.2;              // m: a pass higher than this does not touch the air
var Q_STAR = 15;                           // MJ/kg, the model's heat of ablation

export { EARTH_SOI };

// The reference pass, for a ship class `ship` (Shared/ships.js) on a path
// that moves at speed0 (m/s) at height alt0 (m): the one leaving for apoapsis
// rApo (m, REF_APO when not given), its entry speed taken at its own height,
// with its tanks `fill` full (a fraction; TANK_FILL when not given). Returns { hBrake (h_0), rApo, vOut, shed (shed_0), beta, gPeak, dynPressureAtm, heatFluxWcm2,
// heatLoadKJcm2, shieldNeeded (t), shieldCarried (t), flags }.
export function brakingNeeds(ship, speed0, alt0, rApo, fill) {
	rApo = rApo || REF_APO;
	var m = entryMass(ship, fill == null ? TANK_FILL : fill), hs = shieldMass(ship);
	var inp = { vEntry: speedAt(NOMINAL_ALT, speed0, alt0) / 1e3, hPeri: NOMINAL_ALT / 1e3, apoFrac: rApo / EARTH_SOI, scaleH: SCALE_H,
	            cargo: m - hs, structPct: 0, tpsPct: 100 * hs / (m - hs), fuel: 0,
	            shieldD: ship.shieldD, cd: CAPSULE_CD, noseR: 0, qStar: Q_STAR };
	var r = computeAerobrake(inp);
	// The model's speeds are at its nominal periapsis: settle it on the braking altitude.
	for (var i = 0; i < 8; i++) {
		inp.hPeri = r.brakingAltitude / 1e3;
		inp.vEntry = speedAt(r.brakingAltitude, speed0, alt0) / 1e3;
		r = computeAerobrake(inp);
	}
	return { hBrake: r.brakingAltitude, rApo: rApo, vOut: r.vExit, shed: r.shed, beta: r.beta, gPeak: r.gPeak,
	         dynPressureAtm: r.dynamicPressureAtm, heatFluxWcm2: r.heatFluxWcm2, heatLoadKJcm2: r.heatLoadKJcm2,
	         shieldNeeded: r.shieldMassNeeded / 1e3, shieldCarried: hs, flags: r.flags };
}

// The pass a ship makes at height hp (m above the surface), coming in at vp
// (m/s), against the reference pass `needs` (brakingNeeds). Returns { shed,
// vAfter, falls, rApo (m, null if it falls or escapes), offBy (m, hp - h_0),
// corridor: [low, high] (m), inCorridor, gPeak, dynPressureAtm, heatFluxWcm2 }.
export function passAt(needs, hp, vp) {
	var rp = R_E + hp, off = hp - needs.hBrake, k = Math.exp(-off / SCALE_H);
	var shed = needs.shed * k, vAfter = vp - shed;
	var falls = !(vAfter > Math.sqrt(GM / rp));
	var a = falls ? null : 1 / (2 / rp - vAfter * vAfter / GM);
	var rApo = a && a > 0 ? 2 * a - rp : null;
	function heightFor(ra) { return heightAt(needs, ra, rp, vp); }
	var corridor = [heightFor(CORRIDOR_APO[0]), heightFor(CORRIDOR_APO[1])];
	return { shed: shed, vAfter: vAfter, falls: falls, rApo: rApo, offBy: off, corridor: corridor,
	         inCorridor: hp >= corridor[0] && hp <= corridor[1],
	         gPeak: needs.gPeak * k, dynPressureAtm: needs.dynPressureAtm * k,
	         heatFluxWcm2: needs.heatFluxWcm2 * Math.sqrt(k) };
}

// The pass height (m) whose shed leaves for apoapsis ra, for a pass at
// radius rp coming in at vp (the corridor's edge formula in the header).
function heightAt(needs, ra, rp, vp) {
	var v = Math.sqrt(2 * GM * ra / (rp * (ra + rp)));
	return needs.hBrake - SCALE_H * Math.log((vp - v) / needs.shed);
}

// The pass height (m) that leaves on a two-body loop out to apoapsis ra (m),
// for a ship whose path moves at speed0 (m/s) at height alt0 (m): the pass's
// own speed is taken at that height (speedAt), so the answer is settled by
// repeating the step a few times — the height moves by metres, the speed by
// millimetres a second.
export function heightForApo(needs, ra, speed0, alt0) {
	var h = needs.hBrake;
	for (var i = 0; i < 4; i++) { h = heightAt(needs, ra, R_E + h, speedAt(h, speed0, alt0)); }
	return h;
}

// The speed (m/s) the ship would have at height h (m) on the path through a
// point at height alt0 where it moves at speed0: energy is kept,
//     v(h) = sqrt( speed0^2 + 2 GM (1 / (R_E + h) - 1 / (R_E + alt0)) )
// so the pass's needs can be taken at the corridor whatever the pass is now.
export var NOMINAL_ALT = 70e3;
export function speedAt(h, speed0, alt0) {
	return Math.sqrt(speed0 * speed0 + 2 * GM * (1 / (R_E + h) - 1 / (R_E + alt0)));
}

// The standard freighter as the workbench starts it, for when no design is saved.
export function defaultFreighter() { return Object.assign({}, START_CLASSES.freighter); }
