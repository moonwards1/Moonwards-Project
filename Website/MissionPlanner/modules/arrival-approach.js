/* MissionPlanner/modules/arrival-approach — shared arrival-approach geometry.
 *
 * The "does the coast actually reach the destination, and how fast" measurement
 * the arrival-side stages need: the flyby leg (arrival-leg) and the arrival
 * technologies (arrival-skyhook). Not a stage module — a plain helper, imported
 * by those stages so the intercept check is ONE measurement, not several.
 *
 * Pure (no DOM, no THREE), Node-testable.
 */

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Frames } from "../../Shared/frames.js";
import { makeDiagnostic } from "../core/diagnostics.js";
import { MAX_PASS_ALTITUDE } from "../core/proximity.js";
import { MISS_WARN_AU } from "./transfer-leg/transfer-leg.js";

var O = OrbitalMath;
var AU = 149597870700;   // m
var DAY = 86400;

// The destination's equatorial-plane normal: its spin pole, or the ecliptic
// pole for a body with no published one.
export function equatorNormal(body) {
	var pole = systems.get(body).pole;
	return pole ? O.poleVectorEcliptic(pole.ra, pole.dec) : [0, 0, 1];
}

// THE ARRIVAL MARK — the one epoch and place the Arrival phase is measured
// from: the Arrival timeline's zero, the epoch the phase opens on, the point
// the catching skyhook's 0° aims at, and where Δθ is taken. It is the FIRST
// crossing of the destination's equatorial plane along the flown arc that
// lies within MAX_PASS_ALTITUDE of the surface — where an equatorial tether
// can meet the ship — and closest approach when no crossing does.
//
// `path` is the flown arc ({ jd0, jd1, stateAt(jd) → { r, v } }, body-centric)
// and `caJd` its closest-approach epoch. Returns { kind: "crossing" |
// "closest-approach", jd, r, v } or null with no path. Pure.
export function arrivalMark(body, path, caJd) {
	if (!path || !(path.jd1 > path.jd0)) { return null; }
	var n = equatorNormal(body);
	var R = +systems.get(body).radius;
	var from = path.jd0;
	while (from < path.jd1) {
		var x = O.pathPlaneCrossing(path.stateAt, from, path.jd1, n);
		if (!x) { break; }
		if (O.vMag(x.r) - R <= MAX_PASS_ALTITUDE) {
			return { kind: "crossing", jd: x.t, r: x.r, v: x.v };
		}
		// Past this crossing (a minute on) before looking for the next, so the
		// search does not re-find the one it is standing on.
		from = x.t + 60 / DAY;
	}
	var jd = Math.max(path.jd0, Math.min(path.jd1, caJd));
	var st = path.stateAt(jd);
	return st ? { kind: "closest-approach", jd: jd, r: st.r, v: st.v } : null;
}

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
// shape matches approachAt's. `path` is the flown arc the pass sits on — the
// ship's body-centric { r, v } at any epoch in [jd0, jd1] — which is what a
// catch has to meet (null when the pass doesn't carry one); `mark` is that
// arc's arrivalMark (above), or null without an arc.
export function approachFromPass(body, pass) {
	var sys = systems.get(body);
	if (!sys || !sys.orbit || !pass) { return null; }
	var path = pass.path || null;
	return {
		body: body,
		missAU: pass.rmin / AU,
		vInf: (typeof pass.vInf === "number" && isFinite(pass.vInf)) ? pass.vInf : pass.speed,
		vInfVec: pass.vRel || null,
		path: path,
		mark: path ? arrivalMark(body, path, pass.jd) : null,
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
	var rShip = O.vSub(data.r, bs.r);
	return {
		body: body,
		missAU: O.vMag(rShip) / AU,
		vInf: O.vMag(vInfVec),
		vInfVec: vInfVec,
		path: null,
		mark: null,
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
