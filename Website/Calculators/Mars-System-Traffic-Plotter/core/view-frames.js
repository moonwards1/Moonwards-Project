/* Mars-System-Traffic-Plotter/core/view-frames — the axes the 3-D view is
 * drawn in.
 *
 * Everything is computed in Mars-centred ecliptic axes (Shared/mars-ephemeris.js,
 * Shared/body-leg.js). There are three ways of holding the view still, each a
 * set of three unit axes { x, y, z } at a Julian date:
 *
 *   "sun"      held toward the Sun. z is ecliptic north, so the horizontal is
 *              the ecliptic; x points from Mars to the Sun as seen in that
 *              plane. The Sun stands still (Mars's orbit is tilted 1.85
 *              degrees to the ecliptic, so the Sun sits up to that far above
 *              or below the horizontal); Mars's equator, and the moons' orbits
 *              near it, lean at 26.7 degrees.
 *   "surface"  turning with Mars. z is the pole, x passes through the prime
 *              meridian. The ground, a space elevator and anything
 *              areostationary stand still; the Sun goes round once a day.
 *   "phobos"   turning with Phobos. z is the pole of Phobos's orbit, x points
 *              from Mars to Phobos. Phobos and a skyhook built on it stand
 *              still (Phobos moves in and out along x as its distance changes).
 *
 * A point r (ecliptic axes) is drawn at
 *
 *     p = ( r . x,  r . y,  r . z )
 *
 * A path seen from a turning view is each of its points put through the axes
 * of ITS OWN instant, which is why this takes a date and not a fixed matrix.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { MarsEphemeris as ME } from "../../../Shared/mars-ephemeris.js";

var O = OrbitalMath;

// The views, in the order their buttons are shown.
export var VIEW_FRAMES = [
	{ id: "sun", label: "Sun", caption: "held toward the Sun" },
	{ id: "surface", label: "Mars surface", caption: "turning with Mars" },
	{ id: "phobos", label: "Phobos", caption: "turning with Phobos" }
];

// The view's axes at Julian date jd, as unit vectors in ecliptic axes.
export function viewBasis(kind, jd) {
	if (kind === "surface") {
		var o = ME.orientation(jd);
		return { x: o.meridian, y: o.east, z: o.pole };
	}
	if (kind === "phobos") {
		var s = ME.moonState("Phobos", jd), x = O.vUnit(s.r);
		return { x: x, y: O.vCross(s.normal, x), z: s.normal };
	}
	// "sun": the Sun's direction laid flat in the ecliptic.
	var s = ME.sunVector(jd), u = O.vUnit([s[0], s[1], 0]);
	return { x: u, y: [-u[1], u[0], 0], z: [0, 0, 1] };
}

// A vector r (ecliptic axes) in the view's axes.
export function toView(basis, r) {
	return [O.vDot(r, basis.x), O.vDot(r, basis.y), O.vDot(r, basis.z)];
}
