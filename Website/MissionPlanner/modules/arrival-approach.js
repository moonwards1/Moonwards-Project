/* MissionPlanner/modules/arrival-approach — shared arrival-approach geometry.
 *
 * The "does the coast actually reach the destination, and how fast" measurement
 * that every arrival stage needs — the flyby leg (arrival-leg) and the arrival
 * technologies (arrival-skyhook today; the chemical capture when it's rebuilt).
 * Relocated here 2026-07-20: it had lived in capture-burn.js only because that
 * was the first arrival module built, but it is not capture-specific, and
 * capture-burn is being retired. Not a stage module — a plain helper, imported
 * by the arrival stages so the intercept check is ONE measurement, not several.
 *
 * Pure (no DOM, no THREE), Node-testable.
 */

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Frames } from "../../Shared/frames.js";
import { makeDiagnostic } from "../core/diagnostics.js";
import { MISS_WARN_AU } from "./transfer-leg/transfer-leg.js";

var O = OrbitalMath;
var AU = 149597870700;   // m

// The delivered approach at `body`: miss distance (AU) and v∞ (m/s, with
// vector) measured against the body's own heliocentric state at the ship's
// epoch. `data` is a helio-frame ship-state payload. Returns null for an
// unknown body.
export function approachAt(body, data) {
	var sys = systems.get(body);
	if (!sys || !sys.orbit) { return null; }
	var bs = Frames.bodyHelioState(body, data.jd);
	var vInfVec = O.vSub(data.v, bs.v);
	return {
		body: body,
		missAU: O.vMag(O.vSub(data.r, bs.r)) / AU,
		vInf: O.vMag(vInfVec),
		vInfVec: vInfVec,
		jd: data.jd
	};
}

// The intercept-check warning the arrival stages raise — same threshold as
// transfer-leg's own miss warning, so the two ends of the flight agree on what
// counts as an encounter. Non-blocking (comply mode): a mission that misses is
// a diagnosed mission, not a blank screen.
export function interceptWarning(approach) {
	if (!(approach.missAU > MISS_WARN_AU)) { return null; }
	return makeDiagnostic("intercept-miss",
		"The delivered coast ends " + approach.missAU.toFixed(3) + " AU from " + approach.body +
		" (within " + MISS_WARN_AU + " AU counts as an encounter) — the arrival figures assume " +
		"an approach that isn't being delivered yet.",
		{ values: { missAU: approach.missAU, body: approach.body },
		  fix: "Adjust the coast's waypoint impulses (or the departure) until the leg actually reaches " +
		       approach.body + "." });
}
