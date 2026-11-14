/* MissionPlanner/modules/arrival-leg/earth-handoff — the hand-off from a
 * mission arriving at Earth to the Earth–Moon Traffic Plotter.
 *
 * The plotter takes over at EARTH'S SPHERE OF INFLUENCE: from there on the
 * ship's flight is its business (the entry trim, the aerobrake, the burns that
 * take it to the Moon's infrastructure). What it is handed is the ship's
 * geocentric state where the flown arrival leg crosses into the SOI:
 *
 *     |r(t_h)| = R_SOI          the first inward crossing
 *
 *     r, v    the ship's position and velocity relative to Earth (m, m/s),
 *             on the planner's ecliptic axes, arrival waypoints included
 *     R_SOI   Earth's sphere of influence against the Sun (body-leg.js)
 *
 * An arrival leg that already starts inside the SOI hands over at its start.
 *
 * A burn inside the SOI is refused, not carried: everything the ship does
 * there belongs to the plotter, and an arrival waypoint fired close in is a
 * turn the high orbit makes cheaper. So the hand-off fails, with the reason,
 * if any arrival waypoint fires after the crossing.
 *
 * Whether the pass is close enough to aerobrake is the plotter's to judge, on
 * its own Earth + Moon + Sun flight from this state.
 *
 * Pure (no DOM, no THREE): Node-tested in modules/tests/earth-handoff.test.js.
 */

import { PacketTypes } from "../../../Shared/exchange-types.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { bodyConstants } from "../../../Shared/body-leg.js";
import { stateAtElapsed } from "./arrival-leg.js";

var O = OrbitalMath;
var DAY = 86400;

// The Exchange target the plotter listens on.
export var EARTH_MOON_TRAFFIC = "earth-moon-traffic";

// The hand-off for a computed arrival leg (arrival-leg's computeArrivalLeg).
// Returns { ok: true, r, v, jd, t } — t seconds after the leg's own start —
// or { ok: false, reason } with a sentence for the card.
export function earthHandoff(leg) {
	if (!leg || !leg.ok) { return { ok: false, reason: "The arrival has not been computed." }; }
	if (leg.body !== "Earth") { return { ok: false, reason: "Only an arrival at Earth can be sent." }; }
	var soi = bodyConstants("Earth").SOI;

	var t = null;
	if (O.vMag(stateAtElapsed(leg, 0).r) <= soi) {
		t = 0;
	} else {
		var s = leg.samples;
		for (var k = 1; k < s.length; k++) {
			if (O.vMag(s[k].r) <= soi) {
				var a = s[k - 1].t, b = s[k].t;
				for (var i = 0; i < 60 && b - a > 1e-3; i++) {
					var mid = (a + b) / 2;
					if (O.vMag(stateAtElapsed(leg, mid).r) > soi) { a = mid; } else { b = mid; }
				}
				t = b;
				break;
			}
		}
	}
	if (t === null) {
		return { ok: false, reason: "The arrival never comes inside Earth's sphere of influence (" +
			Math.round(soi / 1e3).toLocaleString("en-US") + " km)." };
	}

	var late = (leg.events || []).filter(function (e) { return e.kind === "waypoint" && e.t > t + 1; });
	if (late.length) {
		return { ok: false, reason: "Arrival waypoint " + (late[0].index + 1) + " fires inside Earth's " +
			"sphere of influence, " + ((late[0].t - t) / 3600).toFixed(1) + " h after the ship crosses into it. " +
			"Burns from there on belong to the Earth–Moon Traffic Plotter: move it earlier, or remove it." };
	}

	var st = stateAtElapsed(leg, t);
	return { ok: true, r: st.r, v: st.v, jd: leg.jd0 + t / DAY, t: t };
}

// The packet the plotter receives: a ship-state relative to Earth. `label`
// names the mission it came from.
export function handoffPacket(h, label) {
	var d = O.dateFromJulian(h.jd);
	return PacketTypes.make("ship-state",
		{ r: h.r.slice(), v: h.v.slice(), jd: h.jd, frame: "body:Earth" },
		{ tool: "mission-planner/arrival-leg", label: label || "Mission Planner arrival",
		  iso: d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0") });
}
