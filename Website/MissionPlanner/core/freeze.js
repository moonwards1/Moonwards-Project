/* MissionPlanner/core/freeze.js — "Start Mission Plan"'s freeze contract
 * (task E2): turn a plan authored on the Ephemeris tab into a serialized
 * World, ready for deserializeWorld() and a new mission tab.
 *
 * Pure (no DOM, no THREE), Node-testable. The caller (ephemeris-view.js)
 * resolves everything view-side first — snapped waypoint days, the marker's
 * rendezvous time, the arrival v-infinity — and hands plain numbers in; this
 * file only assembles the profile the design doc prescribes:
 *
 *   [ frozen-plan (the commitment, task C1) ] -> [ transfer-leg (the working
 *   coast) ] -> [ arrival-leg (the flyby hand-off, task H3) ] — and NO
 *   endpoint TECH stage on either side: a spawned mission starts with an empty
 *   departure-tech slot AND an empty arrival-tech slot. frozen-plan declares
 *   inputOptional (the departure side is a "no-departure-tech" warning, not a
 *   block), and arrival-leg is simply the terminal stage until an arrival
 *   technology is loaded. Both slots are filled through their own add/remove
 *   dropdowns (departure: I5; arrival: its sibling, still to build).
 *
 *   (Until 2026-07-20 the arrival slot was seeded with a chemical capture-burn
 *   as an asymmetric "baseline every ship carries." That module was retired —
 *   its arrival code needed rethinking — so arrival is now empty by default,
 *   symmetric with departure.)
 *
 * THE HAND-OFF IS POST-BURN (Kim, 2026-07-13 — the freeze contract's one
 * real decision): the frozen departure state is the origin body's position
 * with the DEPARTURE BURN ALREADY APPLIED — the ship sitting on the coast
 * trajectory itself. So the plan's required v-infinity is exactly the
 * speed the authored departure burn demanded (the injection), which is the
 * thing a departure technology exists to deliver, and the aim-direction
 * comparison points along a real asymptote. (The first cut froze the
 * pre-burn body state instead, which made the requirement a degenerate
 * "arrive co-moving with the origin, v∞ 0"; Kim redirected same day.) A
 * plan authored with NO departure burn — waypoints only — still
 * legitimately freezes to a required v∞ of 0.
 *
 * Neither output stage carries a `burn` field at all (removed 2026-07-14):
 * the frozen departure state above already IS the coast's starting point,
 * full stop — there is no burn left to record at that seam, only the
 * ship's own waypoint burns during Coast. (A zeroed reference-copy `burn`
 * used to live on both stages here; it invited exactly the bug this
 * removal fixes — see transfer-leg.js's and frozen-plan.js's headers.)
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
 *   windowDays                    // optional — hand-off window half-width
 * }
 *
 * Waypoints are sorted chronologically and any at/after the rendezvous are
 * dropped — they never shaped the flight up to arrival, and a frozen leg
 * whose duration is the rendezvous would flag them as past its end.
 *
 * TIMING FIELDS (task D7, 2026-07-16 — WP-I's window + anchor model): the
 * frozen-plan stage additionally carries
 *   handoffWindowDays — half-width (d) of the hand-off WINDOW around
 *     departure.jd (default ±1); the course check's epoch row becomes
 *     "inside the window" once the integrated departure leg exists (I3).
 *   releaseAnchorJd — the READ-ONLY release epoch: departure.jd minus the
 *     departure-duration estimate (core/departure-estimate.js — the same
 *     figure the Ephemeris tab's Moon widget presented while planning), so
 *     the Moon a user planned around is the Moon the mission shows. A plan
 *     with no meaningful v∞ (waypoints-only) anchors at departure.jd
 *     itself — there is no flight to lead it.
 * Pre-D7 saves simply lack both fields; consumers default them (window 1,
 * anchor departure.jd).
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

	// Timing fields (task D7 — see header): the release anchor leads the
	// hand-off by the departure-duration estimate; the window half-width
	// defaults to ±1 d.
	var est = estimateDeparture({
		origin: spec.origin,
		vInfVec: O.vSub(vHandoff, spec.departure.v),
		jdHandoff: spec.jd
	});
	var windowDays = (isFinite(spec.windowDays) && spec.windowDays > 0)
		? spec.windowDays : DEFAULT_WINDOW_DAYS;
	var releaseAnchorJd = est.ok ? est.jdLaunch : spec.jd;

	return {
		kind: WORLD_KIND,
		version: WORLD_VERSION,
		jd: spec.jd,                       // the clock opens at departure, like the shipped preset
		nextStage: 4,
		stages: [
			{
				id: "stg-1",
				moduleId: "frozen-plan",
				params: {
					origin: spec.origin,
					departure: {
						r: spec.departure.r.slice(),
						v: vHandoff.slice(),
						jd: spec.jd
					},
					arrival: { body: spec.destination, jd: spec.arrivalJd, vInf: spec.arrivalVInf },
					handoffWindowDays: windowDays,
					releaseAnchorJd: releaseAnchorJd,
					waypoints: waypoints.map(function (wp) {
						return { days: wp.days, burn: copyBurn(wp.burn) };
					})
				}
			},
			{
				id: "stg-2",
				moduleId: "transfer-leg",
				params: {
					waypoints: waypoints,
					legDays: legDays,
					destination: spec.destination
				}
			},
			{
				// The arrival flyby leg (task H3): the visible Coast→Arrival
				// hand-off, no burns programmed yet. The mission ends here until
				// an arrival technology is loaded — the arrival slot is empty by
				// default (symmetric with departure; see header).
				id: "stg-3",
				moduleId: "arrival-leg",
				params: { body: spec.destination, waypoints: [] }
			}
		]
	};
}

// "Earth → Ceres 2031" — the name dialog's suggestion (mockup:513–523 shows
// the same shape). Year is the DEPARTURE year, matching the shipped preset's
// own "Moon → Ceres 2031" (release 2031-12-20).
export function defaultMissionTitle(origin, destination, depJd) {
	var y = OrbitalMath.dateFromJulian(depJd).Y;
	return origin + " → " + destination + " " + y;
}
