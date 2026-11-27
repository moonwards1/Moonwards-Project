/* Shared/sim/flight-clock.js — the Flight timeline of the traffic plotters:
 * where on its flight the ship is shown, and what holds it there while the
 * flight changes under it.
 *
 * The timeline runs on one of two AXES, chosen by the viewer:
 *
 *   "time"    linear time since release. However it was set — the slider, a
 *             drag or a double-click in the view — the ship keeps that time
 *             when the flight changes, so the scene's clock stands still under
 *             an edit and the slider's thumb moves instead. Holding a place in
 *             the slider's span would not do: the span follows the closest
 *             pass, so every edit would move the scene's time.
 *   "radial"  the angle the ship has swept around the flight's centre since
 *             release (OrbitalMath.sweepTable). The ship keeps that ANGLE when
 *             the flight changes, so it stays on the same ray from the centre
 *             and only the time it gets there moves: an edit to a waypoint, the
 *             release or the date shows up as the destination arriving early
 *             or late against a ship that holds still.
 *
 * The slider itself is linear in time on both axes: the axis decides what the
 * ship holds when the flight changes, not how the slider is laid out. Laid out
 * by angle, a fast pass close to a planet would take up most of the slider.
 *
 * PIN puts the ship at the flight's closest pass to its destination, wherever
 * that falls as the flight changes; any move of the ship by hand lets go.
 * With no pass to pin to, the axis's held place stands.
 *
 * Every function takes the clock (flightClock()) and the flight's SHAPE as it
 * now stands:
 *   span      s, the slider's end (the flight may be drawn further)
 *   duration  s, the drawn path's end
 *   table     OrbitalMath.sweepTable of the path about its centre, or null
 *             (radial then reads as time)
 *   pinT      s, the closest pass to the destination, or null
 *
 * Pure (no DOM): Node-tested in Shared/tests/flight-clock.test.js.
 */

import { OrbitalMath as O } from "../math-utils.js";

export function flightClock() {
	return { axis: "time", t: 0, deg: 0, pin: false };
}

function radial(c, f) { return c.axis === "radial" && !!f.table; }

// Seconds since release at which the ship is shown.
export function clockSeconds(c, f) {
	if (!(f.duration > 0)) { return 0; }
	var t;
	if (c.pin && f.pinT != null) { t = f.pinT; }
	else if (radial(c, f)) { t = O.sweepTimeAt(f.table, c.deg); }
	else { t = c.t; }
	return Math.max(0, Math.min(f.duration, t));
}

// Degrees swept at the ship's place (null with no table).
export function clockDegrees(c, f) {
	return f.table ? O.sweepDegAt(f.table, clockSeconds(c, f)) : null;
}

// The slider's thumb, 0..1 of the span in time.
export function clockSliderFrac(c, f) {
	return f.span > 0 ? Math.min(1, clockSeconds(c, f) / f.span) : 0;
}

// The slider moved to frac (0..1 of the span in time). The ship then holds
// the time, or on the radial axis the angle, it has reached there.
export function clockSetFrac(c, f, frac) {
	c.pin = false;
	hold(c, f, frac * f.span);
}

// The ship set to t seconds since release in the view.
export function clockSetTime(c, f, t) {
	c.pin = false;
	hold(c, f, t);
}

function hold(c, f, t) {
	if (radial(c, f)) { c.deg = O.sweepDegAt(f.table, t); return; }
	c.t = t;
}

// Switch axis, keeping the ship where it is.
export function clockSetAxis(c, f, axis) {
	var t = clockSeconds(c, f);
	c.axis = axis;
	if (c.pin) { return; }
	hold(c, f, t);
}

// Pin on or off. Let go, the ship stays at the pass it was pinned to.
export function clockSetPin(c, f, on) {
	if (!on && c.pin && f.pinT != null) { hold(c, f, Math.max(0, Math.min(f.duration, f.pinT))); }
	c.pin = !!on;
}

// Back to the release (a new route). The axis and the pin stay as chosen.
export function clockReset(c) {
	c.t = 0; c.deg = 0;
}
