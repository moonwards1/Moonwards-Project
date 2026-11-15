/* Mars-System-Traffic-Plotter/core/clock — the one clock everything in the
 * plotter follows.
 *
 * Mars's turning, the moons, the Sun and every facility are placed from a
 * Julian date, so any two things shown at the same instant are where they
 * would be relative to each other. A facility's own angle is stated at
 * CLOCK_EPOCH and runs on from there at its own rate.
 *
 * Pure (no DOM, no THREE).
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";

// 2080-01-01 00:00, the start of the date span (the Earth–Moon Traffic
// Plotter's epoch too).
export var CLOCK_EPOCH = OrbitalMath.julianDate(2080, 1, 1, 0, 0, 0);

// The date span, days: three Mars years (3 x 686.98 d), to 2085-08-23. Long
// enough for two turns of Phobos's orbit plane (2.262 years each) and for the
// slow drift of a tilted skyhook's plane to come round many times.
export var SPAN_DAYS = 2061;
