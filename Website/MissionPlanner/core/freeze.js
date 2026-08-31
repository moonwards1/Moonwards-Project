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
 *   (recompute.js): an empty or half-built departure never blanks the coast —
 *   with nothing delivered the plan's own frozen state is what the coast
 *   flies from, so the mission still flies and arrives while its departure
 *   slot is filled in. The arrival phase has no such boundary —
 *   the coast's own live readouts (the ship card) are what tell the user
 *   whether the flight actually reaches the destination.
 *
 * THE HAND-OFF IS AT THE ORIGIN'S SOI EDGE, AND IS HANDED IN, NOT DERIVED. A
 * departure technology does not hand a ship over at the origin body's centre:
 * a departure leg flies until it exits the origin's SOI and delivers the ship
 * THERE (departure-leg.js step 4, body-departure-leg.js the same). The
 * Ephemeris tab authors that same hand-off directly — its clock IS the hand-off
 * epoch and its departure card IS the v-infinity there (ephemeris-view.js's
 * departureState) — so freeze COMMITS spec.handoff verbatim. It re-derives
 * nothing across this seam, which is what makes a plan frozen here and pasted
 * back into the tab exact, whatever geometry produced the hand-off: an
 * authored heading, or a real carrier chain's delivered state adopted into
 * the plan.
 *
 * Waypoint days, and the coast's own duration, are measured from that hand-off
 * epoch — which is already the zero the tab counts them in, so nothing is
 * re-based here either.
 *
 * The plan's required v-infinity is the ship's velocity against the origin
 * body's at the hand-off (frozen-plan.js derives it from the frozen state), so
 * it is the same measurement the departure tech's own delivered hand-off is
 * judged by. A plan authored with NO departure burn — waypoints only — never
 * leaves the SOI at all: it keeps the burn epoch as its hand-off and freezes
 * to a required v∞ of 0.
 *
 * Neither output stage carries a `burn` field: the frozen departure state
 * above already IS the coast's starting point, full stop. There is no burn to
 * record at that seam, only the ship's own waypoint burns during Coast (see
 * transfer-leg.js's and frozen-plan.js's headers).
 *
 * spec: {
 *   origin,                       // "Earth" — HELIO_BODIES name
 *   destination,                  // "Ceres" — the marker's rendezvous body
 *   jd,                           // the HAND-OFF epoch — the coast's own start,
 *                                 //   and the Ephemeris tab's clock
 *   handoff: { r, v },            // the heliocentric hand-off state at jd
 *                                 //   (m, m/s), at the origin's SOI edge —
 *                                 //   committed verbatim, never re-solved
 *   waypoints: [{ days, burn }],  // resolved days (snaps already concrete),
 *                                 //   measured from spec.jd, which is already
 *                                 //   the hand-off — nothing is re-based
 *   arrivalJd,                    // the marker's rendezvous epoch — this
 *                                 //   SEEDS THE COAST'S HORIZON (transfer-
 *                                 //   leg's legDays) and is not committed as
 *                                 //   an arrival date: the mission arrives at
 *                                 //   whatever closest approach it measures
 *   arrivalVInf,                  // |ship v − destination v| there (m/s)
 *   windowDays,                   // optional — hand-off window half-width
 *   depProfile                    // optional — the tab's Earth-course
 *                                 //   override ("dive-in"/"direct-out";
 *                                 //   absent/"auto" = the wedge rule), passed
 *                                 //   through to estimateDeparture so the
 *                                 //   seeded release epoch matches the course
 *                                 //   the planner was shown
 * }
 *
 * Waypoints are sorted chronologically and any at/after the rendezvous are
 * dropped — they never shaped the flight up to arrival, and a frozen leg
 * whose duration is the rendezvous would flag them as past its end.
 *
 * TWO TIMING FIELDS, ON TWO DIFFERENT STAGES, because they answer to two
 * different owners:
 *   handoffWindowDays, on the PLAN — half-width (d) of the hand-off WINDOW
 *     around departure.jd (default ±1). This is a requirement: the compliance
 *     epoch row checks the integrated departure leg's delivered hand-off
 *     against it.
 *   releaseJd, on the DEPARTURE LEG — when the carrier chain lets go, seeded
 *     here at departure.jd minus core/departure-estimate.js's flight-time
 *     estimate (the same figure the Ephemeris tab's Moon widget presented
 *     while planning, so the Moon a user planned around is the Moon the
 *     mission shows). The plan does NOT own this: it states where the ship
 *     must be when the departure phase ends, never when that phase started.
 *     A plan with no meaningful v∞ (waypoints-only) seeds at departure.jd
 *     itself — there is no flight to lead it. See core/release-epoch.js.
 */

import { WORLD_KIND, WORLD_VERSION } from "./world.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Frames } from "../../Shared/frames.js";
import { estimateDeparture } from "./departure-estimate.js";

var O = OrbitalMath;

export var DEFAULT_WINDOW_DAYS = 1;

// The origin body's heliocentric velocity at an epoch — the reference the
// plan's v∞ is measured against, read the same way frozen-plan.js reads it.
function bodyHelioV(origin, jd) { return Frames.bodyHelioState(origin, jd).v; }

function copyBurn(b) {
	b = b || {};
	return { pro: b.pro || 0, rad: b.rad || 0, nrm: b.nrm || 0 };
}

export function freezeMissionWorld(spec) {
	// The hand-off, verbatim (see header): the tab authored this state at this
	// epoch, and it is the coast's own starting point. Nothing is applied,
	// followed or re-solved here.
	var handoff = { r: spec.handoff.r.slice(), v: spec.handoff.v.slice(), jd: spec.jd };

	// Waypoint days are already counted from the hand-off. Any at/after the
	// rendezvous drop out — they never shaped the flight up to arrival.
	var legDays = spec.arrivalJd - handoff.jd;
	var waypoints = (spec.waypoints || [])
		.map(function (wp) { return { days: wp.days, burn: wp.burn }; })
		.filter(function (wp) { return isFinite(wp.days) && wp.days > 0 && wp.days < legDays; })
		.sort(function (a, b2) { return a.days - b2.days; })
		.map(function (wp) { return { days: wp.days, burn: copyBurn(wp.burn) }; });

	// Timing fields (see header): the departure leg's seeded release epoch
	// leads the hand-off by the departure-duration estimate — both epochs name
	// the SOI exit, so the crossing is counted once. The plan's own window
	// half-width defaults to ±1 d.
	var est = estimateDeparture({
		origin: spec.origin,
		vInfVec: O.vSub(handoff.v, bodyHelioV(spec.origin, handoff.jd)),
		jdHandoff: handoff.jd,
		profile: spec.depProfile
	});
	var windowDays = (isFinite(spec.windowDays) && spec.windowDays > 0)
		? spec.windowDays : DEFAULT_WINDOW_DAYS;
	var releaseJd = est.ok ? est.jdLaunch : handoff.jd;

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
		add("departure-leg", { waypoints: [], releaseJd: releaseJd });
	} else {
		add("body-departure-leg", { waypoints: [], releaseJd: releaseJd });
	}
	add("frozen-plan", {
		origin: spec.origin,
		departure: { r: handoff.r.slice(), v: handoff.v.slice(), jd: handoff.jd },
		arrival: { body: spec.destination, vInf: spec.arrivalVInf },
		handoffWindowDays: windowDays,
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
		// spawned mission opens on the coast phase, and a mission with no
		// departure technology yet coasts from the plan's own frozen state.
		//
		// ONE CLOCK, ONE SEAM EPOCH. Once a technology delivers, the coast
		// starts from what it really delivered (frozen-plan.js), so the
		// Departure timeline's end and the Coast timeline's start are the same
		// instant, not two that a window has to reconcile. The plan's committed
		// hand-off becomes a mark on those timelines and the epoch the
		// compliance row grades against — a requirement, never a second clock.
		jd: handoff.jd,
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
