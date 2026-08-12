/* MissionPlanner/core/freeze.js — "Start Mission Plan"'s freeze contract:
 * turn a plan authored on the Ephemeris tab into a serialized World, ready for
 * core/world.js's deserializeWorld() and a new mission tab.
 *
 * Pure (no DOM, no THREE), Node-testable. The caller (ephemeris-view.js)
 * resolves everything view-side first — snapped waypoint days, the marker's
 * rendezvous time, the arrival v-infinity — and hands plain numbers in; this
 * file only assembles the profile:
 *
 *   [ departure scaffold ] -> [ frozen-plan (the commitment) ] ->
 *   [ transfer-leg (the working coast) ] -> [ arrival-leg (the flyby
 *   hand-off) ].
 *
 *   THE DEPARTURE SCAFFOLD is a base + an integrated leg with an EMPTY carrier
 *   slot, which mission-view.js's "Departure technology" card fills:
 *   moon-platform + departure-leg for an Earth origin — the Moon is always the
 *   lunar-departure platform — or just body-departure-leg for any other origin,
 *   where the skyhook self-originates and there is no separate platform. Empty,
 *   the leg reports "no carrier".
 *
 *   THE ARRIVAL-TECH SLOT is empty too: arrival-leg is simply the terminal
 *   stage until an arrival technology is loaded. The departure slot being
 *   empty is safe because frozen-plan is a compliance BOUNDARY
 *   (recompute.js): an empty or half-built departure never blanks the
 *   committed coast — the mission still flies and arrives while its
 *   departure slot is filled in. The arrival phase has no such boundary —
 *   the coast's own live readouts (the ship card) are what tell the user
 *   whether the flight actually reaches the destination.
 *
 * THE HAND-OFF IS POST-BURN: the frozen departure state is the origin body's
 * position with the DEPARTURE BURN ALREADY APPLIED — the ship sitting on the
 * coast trajectory itself. So the plan's required v-infinity is exactly the
 * speed the authored departure burn demanded (the injection), which is the
 * thing a departure technology exists to deliver, and the aim-direction
 * comparison points along a real asymptote. A plan authored with NO departure
 * burn — waypoints only — legitimately freezes to a required v∞ of 0.
 *
 * Neither output stage carries a `burn` field: the frozen departure state
 * above already IS the coast's starting point, full stop. There is no burn to
 * record at that seam, only the ship's own waypoint burns during Coast (see
 * transfer-leg.js's and frozen-plan.js's headers).
 *
 * spec: {
 *   origin,                       // "Earth" — HELIO_BODIES name
 *   destination,                  // "Ceres" — the marker's rendezvous body
 *   jd,                           // departure epoch (the tab's clock)
 *   departure: { r, v },          // origin body's helio state at jd (m, m/s),
 *                                 //   PRE-burn — spec.burn is applied here to
 *                                 //   get the frozen POST-burn hand-off state
 *   burn: { pro, rad, nrm },      // the authored departure burn (m/s)
 *   waypoints: [{ days, burn }],  // resolved days (snaps already concrete)
 *   arrivalJd,                    // the marker's rendezvous epoch
 *   arrivalVInf,                  // |ship v − destination v| there (m/s)
 *   windowDays,                   // optional — hand-off window half-width
 *   depProfile                    // optional — the tab's Earth-course
 *                                 //   override ("dive-in"/"direct-out";
 *                                 //   absent/"auto" = the wedge rule), passed
 *                                 //   through to estimateDeparture so the
 *                                 //   baked release anchor matches the course
 *                                 //   the planner was shown
 * }
 *
 * Waypoints are sorted chronologically and any at/after the rendezvous are
 * dropped — they never shaped the flight up to arrival, and a frozen leg
 * whose duration is the rendezvous would flag them as past its end.
 *
 * TIMING FIELDS on the frozen-plan stage:
 *   handoffWindowDays — half-width (d) of the hand-off WINDOW around
 *     departure.jd (default ±1); the compliance epoch row checks the
 *     integrated departure leg's delivered hand-off against it.
 *   releaseAnchorJd — the READ-ONLY release epoch: departure.jd minus the
 *     departure-duration estimate (core/departure-estimate.js — the same
 *     figure the Ephemeris tab's Moon widget presented while planning), so
 *     the Moon a user planned around is the Moon the mission shows. A plan
 *     with no meaningful v∞ (waypoints-only) anchors at departure.jd
 *     itself — there is no flight to lead it.
 * Older saves may lack both fields; consumers default them (window 1, anchor
 * departure.jd — see frozen-plan.js's windowDaysOf/releaseAnchorFor).
 */

import { WORLD_KIND, WORLD_VERSION } from "./world.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { estimateDeparture } from "./departure-estimate.js";

var O = OrbitalMath;

export var DEFAULT_WINDOW_DAYS = 1;

function copyBurn(b) {
	b = b || {};
	return { pro: b.pro || 0, rad: b.rad || 0, nrm: b.nrm || 0 };
}

export function freezeMissionWorld(spec) {
	var legDays = spec.arrivalJd - spec.jd;
	var waypoints = (spec.waypoints || [])
		.filter(function (wp) { return isFinite(wp.days) && wp.days > 0 && wp.days < legDays; })
		.sort(function (a, b) { return a.days - b.days; })
		.map(function (wp) { return { days: wp.days, burn: copyBurn(wp.burn) }; });

	// The hand-off state: departure burn applied to the origin body's state
	// (same call, same argument order, as computeLeg's own injection), so
	// the frozen requirement IS the coast trajectory's starting state.
	var b = copyBurn(spec.burn);
	var vHandoff = O.applyBurn(spec.departure.r, spec.departure.v, b.pro, b.nrm, b.rad);

	// Timing fields (see header): the release anchor leads the hand-off by the
	// departure-duration estimate; the window half-width defaults to ±1 d.
	var est = estimateDeparture({
		origin: spec.origin,
		vInfVec: O.vSub(vHandoff, spec.departure.v),
		jdHandoff: spec.jd,
		profile: spec.depProfile
	});
	var windowDays = (isFinite(spec.windowDays) && spec.windowDays > 0)
		? spec.windowDays : DEFAULT_WINDOW_DAYS;
	var releaseAnchorJd = est.ok ? est.jdLaunch : spec.jd;

	// Assemble the profile with sequential stage ids. The DEPARTURE SCAFFOLD
	// comes first, with an EMPTY carrier slot the mission view's departure-
	// technology card fills: Earth departs from the Moon, so its fixed base is
	// moon-platform + the geocentric departure-leg; any other origin departs its
	// body directly, so just the generic body-departure-leg (a skyhook there
	// self-originates — no separate platform). Empty, the leg reports
	// "no carrier"; frozen-plan is a compliance boundary (recompute.js), so that
	// never blanks the coast.
	var stages = [];
	var n = 1;
	function add(moduleId, params) { stages.push({ id: "stg-" + (n++), moduleId: moduleId, params: params }); }

	if (spec.origin === "Earth") {
		add("moon-platform", {});
		add("departure-leg", { waypoints: [] });
	} else {
		add("body-departure-leg", { waypoints: [] });
	}
	add("frozen-plan", {
		origin: spec.origin,
		departure: { r: spec.departure.r.slice(), v: vHandoff.slice(), jd: spec.jd },
		arrival: { body: spec.destination, jd: spec.arrivalJd, vInf: spec.arrivalVInf },
		handoffWindowDays: windowDays,
		releaseAnchorJd: releaseAnchorJd,
		waypoints: waypoints.map(function (wp) { return { days: wp.days, burn: copyBurn(wp.burn) }; })
	});
	add("transfer-leg", { waypoints: waypoints, legDays: legDays, destination: spec.destination });
	// The arrival flyby leg: the visible Coast→Arrival hand-off, no burns, and
	// the terminal stage — the arrival-tech slot is empty by default.
	add("arrival-leg", { body: spec.destination, waypoints: [] });

	return {
		kind: WORLD_KIND,
		version: WORLD_VERSION,
		// The clock opens at the HAND-OFF — the coast's own start — because a
		// spawned mission opens on the coast phase.
		//
		// PHASE CLOCKS ARE ONLY CONSISTENT WITHIN A PHASE. Departure and arrival
		// span a user-designed series of events whose duration can only be
		// ESTIMATED, so the clock jumps a little at each hand-off seam rather
		// than lining up exactly with the plan's committed epoch. Being up to a
		// day out is deliberately allowed: that tolerance is what makes
		// estimating a departure's duration tractable at all, and a few hours is
		// nothing on interplanetary timeframes. The arrival seam has the same
		// looseness (frozen-plan.js's handoffWindowFor also backs the ship
		// card's Coast-phase timing bar).
		jd: spec.jd,
		nextStage: n,
		stages: stages
	};
}

// "Earth → Ceres 2031" — the name dialog's suggested title. The year is the
// DEPARTURE year, matching the shipped preset's own "Moon → Ceres 2031".
export function defaultMissionTitle(origin, destination, depJd) {
	var y = OrbitalMath.dateFromJulian(depJd).Y;
	return origin + " → " + destination + " " + y;
}
