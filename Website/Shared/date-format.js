/* Shared/date-format.js — how the plotters write and read an ephemeris date.
 *
 * One order everywhere: year, month, day, then the hour of the day as "h0"
 * to "h23" — "2080/03/14 h7". Year-first reads the same in every locale and
 * sorts as text. Hour resolution is enough for the date bar; readouts that
 * need minutes add a clock time after the day ("2080/03/14 07:30").
 *
 * Pure (no DOM), Node-testable. Times are the clock OrbitalMath.julianDate /
 * dateFromJulian use (UT).
 */

import { OrbitalMath } from "./math-utils.js";

// Half a second, added before splitting a JD into calendar parts, so a JD
// built for an exact hour (7:00:00) never comes back as 6:59:59.99 from
// floating-point rounding and shows one hour early.
var NUDGE = 0.5 / 86400;

function two(n) { return String(n).padStart(2, "0"); }
function parts(jd) { return OrbitalMath.dateFromJulian(jd + NUDGE); }

// "2080/03"
export function dateYM(jd) { var d = parts(jd); return d.Y + "/" + two(d.Mo); }
// "2080/03/14"
export function dateYMD(jd) { var d = parts(jd); return d.Y + "/" + two(d.Mo) + "/" + two(d.D); }
// "2080/03/14 h7"
export function dateYMDH(jd) { var d = parts(jd); return dateYMD(jd) + " h" + d.h; }
// "2080/03/14 07:30"
export function dateYMDHM(jd) { var d = parts(jd); return dateYMD(jd) + " " + two(d.h) + ":" + two(d.m); }
// "2080-03-14" — the form an <input type="date"> takes as its value.
export function dateISO(jd) { var d = parts(jd); return d.Y + "-" + two(d.Mo) + "-" + two(d.D); }

function daysInMonth(Y, Mo) { return new Date(Date.UTC(Y, Mo, 0)).getUTCDate(); }

// A typed date -> JD, or NaN when it isn't a real date. Year, month and day
// in that order, separated by "/", "-", "." or spaces; then optionally the
// hour, 0–23, with or without its "h" ("h7", "7h", "7"). No hour means h0.
//   "2080/03/14 h7"  "2080/3/14"  "2080-03-14 13"  "2080.03.14h23"
export function parseDateYMDH(text) {
	var m = /^\s*(\d{4})\s*[\/\-. ]\s*(\d{1,2})\s*[\/\-. ]\s*(\d{1,2})(?:\s*(?:h\s*(\d{1,2})|(\d{1,2})\s*h?))?\s*$/i
		.exec(String(text));
	if (!m) { return NaN; }
	var Y = +m[1], Mo = +m[2], D = +m[3];
	var h = m[4] != null ? +m[4] : (m[5] != null ? +m[5] : 0);
	if (Mo < 1 || Mo > 12 || D < 1 || D > daysInMonth(Y, Mo) || h > 23) { return NaN; }
	return OrbitalMath.julianDate(Y, Mo, D, h, 0, 0);
}
