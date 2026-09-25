/* Mission Planner — the Ephemeris tab's point-of-view window.
 *
 * A POV view (ephemeris-view.js) shows the flight from one end, in that body's
 * own frame, and its marker slider spans only the stretch of flight that
 * matters there. This file decides that stretch, as global times along the
 * drawn leg (seconds from the hand-off, the same clock every "t" in the
 * Ephemeris tab reads).
 *
 *   ORIGIN      — the first POV_MIN_DAYS of the flight.
 *   DESTINATION — from where the ship enters the destination's SOI to
 *                 POV_AFTER_CA_DAYS past closest approach, and never less than
 *                 POV_MIN_DAYS long. At Mars that is the SOI plus a few days of
 *                 approach; at Jupiter the SOI alone is months, and the window
 *                 is sized to it rather than cutting it off. A pass that never
 *                 enters the SOI gets the plain POV_MIN_DAYS ending a day after
 *                 closest approach.
 *
 * Pure: the caller hands in the distance function, so this is Node-testable
 * with a synthetic flight.
 */

var DAY = 86400;

export var POV_MIN_DAYS = 10;
export var POV_AFTER_CA_DAYS = 1;

// { t0, t1 } (s) for the origin view, or null with no flight.
export function originWindow(totalT) {
	if (!(totalT > 0)) { return null; }
	return { t0: 0, t1: Math.min(totalT, POV_MIN_DAYS * DAY) };
}

// The global time the ship last crosses INTO a sphere of radius soiR before
// tCA, given distAt(t) → metres from the body's centre. null when the ship is
// not inside the sphere at tCA; 0 when it is inside all the way back to the
// flight's start. A backward walk finds the step the crossing falls in, then
// bisection pins it — the approach can take months at a giant planet, so the
// step scales with how far back there is to look.
export function soiEntryBefore(distAt, tCA, soiR) {
	if (!(distAt(tCA) < soiR)) { return null; }
	var step = Math.max(0.05 * DAY, tCA / 4000);
	var hi = tCA, lo = tCA - step;
	while (lo > 0 && distAt(lo) < soiR) { hi = lo; lo -= step; }
	if (lo <= 0) {
		if (distAt(0) < soiR) { return 0; }
		lo = 0;
	}
	for (var k = 0; k < 60 && hi - lo > 1; k++) {
		var mid = (lo + hi) / 2;
		if (distAt(mid) < soiR) { hi = mid; } else { lo = mid; }
	}
	return hi;
}

// { t0, t1, soiEntry } (s) for the destination view, or null with no flight or
// no closest approach. soiEntry is null for a pass that stays outside the SOI.
export function destinationWindow(distAt, tCA, soiR, totalT) {
	if (!(totalT > 0) || !isFinite(tCA)) { return null; }
	var t1 = Math.min(totalT, tCA + POV_AFTER_CA_DAYS * DAY);
	var entry = soiEntryBefore(distAt, tCA, soiR);
	var t0 = t1 - POV_MIN_DAYS * DAY;
	if (entry != null) { t0 = Math.min(t0, entry); }
	return { t0: Math.max(0, t0), t1: t1, soiEntry: entry };
}
