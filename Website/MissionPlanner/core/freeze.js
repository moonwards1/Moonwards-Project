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
 *   coast) ] — and NO tech stage: a spawned mission starts with an empty
 *   departure-tech slot (frozen-plan declares inputOptional, so that's a
 *   "no-departure-tech" warning, not a block; loading a tech is WP-F).
 *
 * THE HAND-OFF IS POST-BURN (Kim, 2026-07-13 — the freeze contract's one
 * real decision): the frozen departure state is the origin body's position
 * with the DEPARTURE BURN ALREADY APPLIED — the ship sitting on the coast
 * trajectory itself. So the plan's required v-infinity is exactly the
 * speed the authored departure burn demanded (the injection), which is the
 * thing a departure technology exists to deliver, and the aim-direction
 * comparison points along a real asymptote. The transfer-leg stage's
 * departure burn is zeroed to match — the injection is the TECH's job in
 * the frozen mission, not the ship's; the ship's own commitments are the
 * waypoint burns. (The first cut froze the pre-burn body state instead,
 * which made the requirement a degenerate "arrive co-moving with the
 * origin, v∞ 0"; Kim redirected same day.) A plan authored with NO
 * departure burn — waypoints only — still legitimately freezes to a
 * required v∞ of 0.
 *
 * spec: {
 *   origin,                       // "Earth" — HELIO_BODIES name
 *   destination,                  // "Ceres" — the marker's rendezvous body
 *   jd,                           // departure epoch (the tab's clock)
 *   departure: { r, v },          // origin body's helio state at jd (m, m/s),
 *                                 //   PRE-burn — the burn is applied here
 *   burn: { pro, rad, nrm },      // the authored departure burn (m/s)
 *   waypoints: [{ days, burn }],  // resolved days (snaps already concrete)
 *   arrivalJd,                    // the marker's rendezvous epoch
 *   arrivalVInf                   // |ship v − destination v| there (m/s)
 * }
 *
 * Waypoints are sorted chronologically and any at/after the rendezvous are
 * dropped — they never shaped the flight up to arrival, and a frozen leg
 * whose duration is the rendezvous would flag them as past its end.
 */

import { WORLD_KIND, WORLD_VERSION } from "./world.js";
import { OrbitalMath } from "../../Shared/math-utils.js";

var O = OrbitalMath;

function copyBurn(b) {
	b = b || {};
	return { pro: b.pro || 0, rad: b.rad || 0, nrm: b.nrm || 0 };
}

var ZERO_BURN = { pro: 0, rad: 0, nrm: 0 };

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

	return {
		kind: WORLD_KIND,
		version: WORLD_VERSION,
		jd: spec.jd,                       // the clock opens at departure, like the shipped preset
		nextStage: 3,
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
					burn: copyBurn(ZERO_BURN),   // reference copy of the leg's (zeroed) burn
					waypoints: waypoints.map(function (wp) {
						return { days: wp.days, burn: copyBurn(wp.burn) };
					})
				}
			},
			{
				id: "stg-2",
				moduleId: "transfer-leg",
				params: {
					burn: copyBurn(ZERO_BURN),   // injection lives in the hand-off state now
					waypoints: waypoints,
					legDays: legDays,
					destination: spec.destination
				}
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
