/* MissionPlanner/modules/arrival-approach — shared arrival-approach geometry.
 *
 * The "does the coast actually reach the destination, and how fast" measurement
 * every arrival stage needs: the compliance boundary (arrival-boundary), the
 * flyby leg (arrival-leg) and the arrival technologies (arrival-skyhook). Not a
 * stage module — a plain helper, imported by those stages so the intercept
 * check is ONE measurement, not several.
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

// The delivered approach, built from a MEASURED PASS rather than from a single
// instant — transfer-leg's nearestApproach (or arrival-leg's own equivalent).
// This is the form every arrival stage should use when a trajectory is
// reachable.
//
// Why it exists: approachAt below measures at whatever epoch the packet
// carries, which is the emitting leg's END. A leg routinely ends before its own
// closest approach, so that instant is neither the closest the ship gets nor
// the speed it gets there at — on the shipped Ceres mission a pass 1,649 km
// from the body reads as 182,000 km away, and the epoch never moves at all when
// waypoints are tuned, because a leg's end is `jd0 + legDays` by construction.
// The pass is the physical event those figures are meant to describe.
//
// `vInfVec` is the relative velocity AT closest approach, not the asymptote —
// its magnitude is deliberately not used for `vInf`, which takes the pass's own
// asymptotic figure. Nothing currently reads the vector; it is kept so the
// shape matches approachAt's.
export function approachFromPass(body, pass) {
	var sys = systems.get(body);
	if (!sys || !sys.orbit || !pass) { return null; }
	return {
		body: body,
		missAU: pass.rmin / AU,
		vInf: (typeof pass.vInf === "number" && isFinite(pass.vInf)) ? pass.vInf : pass.speed,
		vInfVec: pass.vRel || null,
		jd: pass.jd
	};
}

// The delivered approach at `body`: miss distance (AU) and v∞ (m/s, with
// vector) measured against the body's own heliocentric state at the ship's
// epoch. `data` is a helio-frame ship-state payload. Returns null for an
// unknown body.
//
// THE FALLBACK, not the default — see approachFromPass above. Correct only when
// no trajectory is reachable to measure a pass on (a bare Node call, or a chain
// whose coast has not computed), where the delivered instant is all there is.
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
// transfer-leg's own MISS_WARN_AU, so the two ends of the flight agree on what
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
