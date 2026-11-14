/* Earth-Moon-Traffic-Plotter/core/aerobrake — the single grazing pass through
 * Earth's upper air that turns an arrival from another world into a long
 * orbit reaching out towards the edge of Earth's sphere of influence.
 *
 * The pass is taken as an instant loss of speed at periapsis, straight back
 * along the ship's motion, so it changes the orbit's size and nothing else.
 *
 * WHAT THE PASS NEEDS. To leave on an orbit whose far point is r_a, the ship
 * must come out of periapsis at
 *
 *     v_out = sqrt( 2 GM r_a / ( r_p (r_a + r_p) ) )
 *     shed  = v_p - v_out
 *
 *     v_p   its speed at periapsis coming in, m/s
 *     r_p   periapsis radius, m;  r_a the exit apoapsis radius, m
 *
 * and the air has to be dense enough there to take off `shed`. How deep that
 * is depends on the ship's ballistic coefficient β (Shared/ships.js): the
 * Earth aerobrake model (Calculators/Earth-Aerobrake-Calculator) gives the
 * BRAKING ALTITUDE h_b, with the peak deceleration, dynamic pressure, heat
 * flux and the heat-shield mass the pass needs.
 *
 * THE CORRIDOR. The exit is extremely sensitive to the pass: the orbit
 * leaves only just below escape, so a few m/s of shed moves its apoapsis by
 * hundreds of thousands of km. A real ship flies the pass with its lift,
 * rolling it up or down to hold the exit, and CORRIDOR_HALF is the error in
 * pass height that lift can take up. A pass within it leaves for the chosen
 * apoapsis exactly.
 *
 * OUTSIDE IT, the lift is used up and the rest of the error shows. Drag goes
 * with the air's density, which falls off by a factor e every scale height H:
 *
 *     shed(h_p) = shed_0 · exp( -(|h_p - h_b| - CORRIDOR_HALF) / H · sign(h_p - h_b) )
 *
 *     shed_0  the shed that leaves for r_a from this periapsis
 *
 * so 2 km beyond the corridor's top sheds a quarter less (the ship skips out
 * on a much longer orbit, or escapes), 2 km below its floor a third more. A
 * pass that sheds so much that it leaves slower than the circular speed at
 * periapsis, sqrt(GM / r_p), does not come back up: the ship falls into the
 * atmosphere. The peak deceleration and dynamic pressure scale with the
 * density, exp(-(h_p - h_b) / H); the heat flux with its square root.
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
export var CORRIDOR_HALF = 2e3;            // m either side of the braking altitude
export var EXIT_APO_DEFAULT = 0.9 * EARTH_SOI;
export var EXIT_APO_RANGE = [100e6, EARTH_SOI];
export var ABOVE_AIR = 300e3;              // m: a pass higher than this does not touch the air
var Q_STAR = 15;                           // MJ/kg, the model's heat of ablation

export { EARTH_SOI };

// What the pass needs, for a ship class `ship` (Shared/ships.js) meeting the
// air at speed vp (m/s, at periapsis) and leaving for apoapsis rApo (m).
// Returns { hBrake, rApo, vOut, shed, beta, gPeak, dynPressureAtm, heatFluxWcm2,
// heatLoadKJcm2, shieldNeeded (t), shieldCarried (t), flags }.
export function brakingNeeds(ship, vp, rApo) {
	var m = entryMass(ship), hs = shieldMass(ship);
	var inp = { vEntry: vp / 1e3, hPeri: 70, apoFrac: rApo / EARTH_SOI, scaleH: SCALE_H,
	            cargo: m - hs, structPct: 0, tpsPct: 100 * hs / (m - hs), fuel: 0,
	            shieldD: ship.shieldD, cd: CAPSULE_CD, noseR: 0, qStar: Q_STAR };
	var r = computeAerobrake(inp);
	// The model's speeds are at its nominal periapsis: settle it on the braking altitude.
	for (var i = 0; i < 6; i++) { inp.hPeri = r.brakingAltitude / 1e3; r = computeAerobrake(inp); }
	return { hBrake: r.brakingAltitude, rApo: rApo, vOut: r.vExit, shed: r.shed, beta: r.beta, gPeak: r.gPeak,
	         dynPressureAtm: r.dynamicPressureAtm, heatFluxWcm2: r.heatFluxWcm2, heatLoadKJcm2: r.heatLoadKJcm2,
	         shieldNeeded: r.shieldMassNeeded / 1e3, shieldCarried: hs, flags: r.flags };
}

// The pass a ship actually makes at height hp (m above the surface), coming
// in at vp (m/s), against `needs` (brakingNeeds). Returns { shed, vAfter,
// falls, rApo (m, null if it falls or escapes), offBy (m, hp - hBrake),
// inCorridor, gPeak, dynPressureAtm, heatFluxWcm2 }.
export function passAt(needs, hp, vp) {
	var rp = R_E + hp, off = hp - needs.hBrake, k = Math.exp(-off / SCALE_H);
	var past = Math.max(0, Math.abs(off) - CORRIDOR_HALF) * (off < 0 ? -1 : 1);
	var vOut = Math.sqrt(2 * GM * needs.rApo / (rp * (needs.rApo + rp)));
	var shed = (vp - vOut) * Math.exp(-past / SCALE_H), vAfter = vp - shed;
	var falls = !(vAfter > Math.sqrt(GM / rp));
	var a = falls ? null : 1 / (2 / rp - vAfter * vAfter / GM);
	var rApo = a && a > 0 ? 2 * a - rp : null;
	return { shed: shed, vAfter: vAfter, falls: falls, rApo: rApo, offBy: off,
	         inCorridor: Math.abs(off) <= CORRIDOR_HALF,
	         gPeak: needs.gPeak * k, dynPressureAtm: needs.dynPressureAtm * k,
	         heatFluxWcm2: needs.heatFluxWcm2 * Math.sqrt(k) };
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
