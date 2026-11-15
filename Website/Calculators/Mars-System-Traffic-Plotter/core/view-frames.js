/* Mars-System-Traffic-Plotter/core/view-frames — the axes the 3-D view is
 * drawn in.
 *
 * Everything is computed in Mars-centred ecliptic axes (Shared/mars-ephemeris.js,
 * Shared/body-leg.js). Nearly all of the Mars system lies close to Mars's
 * equator, which is tilted 26.7 degrees to the ecliptic, so the view is drawn
 * with Mars's north pole up instead. There are three ways of holding the view
 * still, each a set of three unit axes { x, y, z } at a Julian date:
 *
 *   "stars"    fixed to the stars. z is Mars's pole, x the direction of the
 *              Sun at Mars's northern spring equinox. Orbits keep their shape
 *              and Mars turns under them.
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
	{ id: "stars", label: "Fixed stars", caption: "fixed to the stars" },
	{ id: "surface", label: "Mars surface", caption: "turning with Mars" },
	{ id: "phobos", label: "Phobos", caption: "turning with Phobos" }
];

var STARS = { x: ME.equinox, y: O.vCross(ME.pole, ME.equinox), z: ME.pole };

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
	return STARS;
}

// A vector r (ecliptic axes) in the view's axes.
export function toView(basis, r) {
	return [O.vDot(r, basis.x), O.vDot(r, basis.y), O.vDot(r, basis.z)];
}
