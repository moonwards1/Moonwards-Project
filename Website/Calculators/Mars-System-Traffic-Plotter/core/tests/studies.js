// The designs the Node tests pin their figures to, kept apart from the
// page's defaults so the defaults can change without the tests following.
// Each wrapped function puts the study's values under whatever a test asks
// for; a facility a test leaves out (null) stays out.
//
//   PHOBOS_STUDY      the Phobos skyhook with its top at 10,000 km
//   HANGING_STUDY     the hanging skyhook on 4:1 with Phobos, top 2,400 km,
//                     30 kt of upper ballast at the top, its cable 17 GPa at
//                     2,300 kg/m3 and a safety factor of 3
//   ELEVATOR_STUDY    early nanotube at 2.5, counterweight at 51,000 km of
//                     the mass that holds it up three times over, 1 kg/s

import { moonSkyhookFigures as moon0, allFigures as all0 } from "../facilities.js";
import { HANGING_DEFAULTS, STRUCTURE, hangingFigures as hang0, resonantComAlt as res0 } from "../hanging-skyhook.js";
import { ELEVATOR_DEFAULTS, elevatorFigures as elev0 } from "../elevator.js";
import { computeFlight as fly0 } from "../flight.js";

// The cable is set before any figure is worked out; the page's own cable plays
// no part in these tests.
STRUCTURE.strength = 17e9 / 2300 / 3;

export var PHOBOS_STUDY = { footAlt: 260e3, topAlt: 10000e3, relAlt: 260e3 };
export var HANGING_STUDY = Object.assign({}, HANGING_DEFAULTS, { comAlt: 331e3, topAlt: 2400e3, relAlt: 2400e3,
	upperBallastMass: 30e6, upperBallastHome: 2400e3 });
export var ELEVATOR_STUDY = Object.assign({}, ELEVATOR_DEFAULTS, { safety: 2.5, rCW: 51000e3, cwMass: null, cargoFlow: 1 });

function under(study, p) { return p === null ? null : Object.assign({}, study, p || {}); }
function studyParams(params) {
	var p = params || {}, out = Object.assign({}, p);
	out.phobosSkyhook = under(PHOBOS_STUDY, p.phobosSkyhook);
	out.hangingSkyhook = under(HANGING_STUDY, p.hangingSkyhook);
	if (p.spaceElevator) { out.spaceElevator = under(ELEVATOR_STUDY, p.spaceElevator); }
	return out;
}

export function moonSkyhookFigures(id, params, elevator) { return moon0(id, under(PHOBOS_STUDY, params), elevator); }
export function hangingFigures(params, phobos, elevator) { return hang0(under(HANGING_STUDY, params), phobos, elevator); }
export function resonantComAlt(params, phobos, ratio, opts) { return res0(under(HANGING_STUDY, params), phobos, ratio, opts); }
export function elevatorFigures(params) { return elev0(under(ELEVATOR_STUDY, params)); }
export function allFigures(params) { return all0(studyParams(params)); }
export function computeFlight(input) { return fly0(Object.assign({}, input, { params: studyParams(input.params) })); }
