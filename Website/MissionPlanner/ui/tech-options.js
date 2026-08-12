// MissionPlanner/ui/tech-options.js — the departure and arrival "technology"
// dropdowns' own small catalog, distinct from core/registry.js (the module
// registry: what's LOADED and how the recompute chain calls it). This one is
// about what's OFFERABLE in a dropdown and to which body it applies — UI data,
// not a module descriptor. Consumed by mission-view.js's departure-technology
// card (addCarrier) and arrival-technology card (swapTechStage).
//
// Each entry:
//   { id, label, bodies, moduleId, moduleUrl }  — built: selectable, and adds
//     or swaps a stage carrying that module. moduleUrl is dynamic-imported only
//     if the registry doesn't already have moduleId — every built module is
//     eager-loaded by planner.js's MODULE_URLS, so this is the fallback for
//     techs that are NOT in that eager list.
//   { id, label, bodies, future: true }         — unbuilt: shown, disabled,
//     with a "(future)" label suffix.
//
// `bodies` follows the project's "body" convention (Shared/exchange-types.js's
// header): a body-scoped catalog entry, never a hardcoded "the Moon is the only
// place with tech" assumption. `bodies: "*"` means any body the chain can be
// based at; a body-specific entry keeps an explicit list.
//
// A BUILT entry states no `bodies` of its own — its `platform` is the platform
// spec (modules/platform/platform-spec.js), which declares its own
// applicability, so where a technology can be used is decided once, beside its
// physics. Only `future` entries carry a hand-written list, having no platform
// to ask yet.

import { platformAppliesTo } from "../modules/platform/platform-spec.js";
import { SKYHOOK } from "../modules/skyhook/skyhook.js";

// Does `opt` apply at `body`? Built entries ask their platform; future entries
// use their own list.
function optionAppliesTo(opt, body) {
	if (opt.platform) { return platformAppliesTo(opt.platform, body); }
	return opt.bodies === "*" || opt.bodies.indexOf(body) !== -1;
}

export var DEPARTURE_TECH_OPTIONS = [
	// The one built departure technology: the generic skyhook, which orbits
	// any body (modules/skyhook).
	{ id: "skyhook", label: "Skyhook", platform: SKYHOOK,
	  moduleId: "orbital-skyhook", moduleUrl: "../modules/skyhook/skyhook-departure.js" },
	{ id: "space-elevator", label: "Space elevator", bodies: "*", future: true },
	{ id: "mass-driver", label: "Mass driver", bodies: "*", future: true },
	{ id: "chemical-rocket", label: "Chemical rocket", bodies: "*", future: true }
];

// Departure entries applicable to `body` — the generic "*" entries for any
// known body, plus any entry naming it explicitly (same shape as
// arrivalTechOptionsFor). Pure; exported for Node tests.
export function techOptionsFor(body) {
	if (typeof body !== "string" || body === "") { return []; }
	return DEPARTURE_TECH_OPTIONS.filter(function (opt) {
		return optionAppliesTo(opt, body);
	});
}

// The ARRIVAL technologies — same catalog shape, filtered against the frozen
// plan's arrival body instead of the chain's base. The one built entry is the
// same skyhook platform in its arrival role: the tether run in reverse.
export var ARRIVAL_TECH_OPTIONS = [
	{ id: "capture-burn", label: "Chemical capture burn", bodies: "*", future: true },
	{ id: "arrival-skyhook", label: "Orbital skyhook catch", platform: SKYHOOK,
	  moduleId: "arrival-skyhook", moduleUrl: "../modules/skyhook/skyhook-arrival.js" },
	{ id: "ceres-elevator-catch", label: "Ceres elevator catch port", bodies: ["Ceres"], future: true }
];

// Arrival entries applicable to `body`: the generic "*" entries for any known
// body, plus any entry naming it explicitly. Pure; exported for Node tests.
export function arrivalTechOptionsFor(body) {
	if (typeof body !== "string" || body === "") { return []; }
	return ARRIVAL_TECH_OPTIONS.filter(function (opt) {
		return optionAppliesTo(opt, body);
	});
}
