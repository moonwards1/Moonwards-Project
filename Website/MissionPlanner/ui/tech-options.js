// MissionPlanner/ui/tech-options.js — the departure and arrival "technology"
// dropdowns' own small catalog, distinct from core/registry.js (the module
// registry: what's LOADED and how the recompute chain calls it). This one is
// about what's OFFERABLE in a dropdown and to which body it applies — UI data,
// not a module descriptor. Consumed by mission-view.js's departure-technology
// card (addCarrier) and arrival-technology card (addArrivalTech).
//
// Each entry:
//   { id, label, bodies, moduleId, moduleUrl }  — built: selectable, and adds
//     a stage carrying that module. moduleUrl is dynamic-imported only
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
// to ask yet. A technology built for some bodies and not yet for others has a
// future entry too, naming the built one in `untilBuilt`: it shows only where
// the built entry does not apply.

import { platformAppliesTo } from "../modules/platform/platform-spec.js";
import { SKYHOOK } from "../modules/skyhook/skyhook.js";
import { L1_ELEVATOR, L2_ELEVATOR } from "../modules/elevator/elevator.js";
import { SPACE_ELEVATOR } from "../modules/space-elevator/space-elevator.js";

// Does `opt` apply at `body`, in `list`? Built entries ask their platform;
// future entries use their own list, and stand aside where the entry they
// wait on (`untilBuilt`) is built.
function optionAppliesTo(opt, body, list) {
	if (opt.platform) { return platformAppliesTo(opt.platform, body); }
	if (opt.untilBuilt) {
		var built = list.find(function (o) { return o.id === opt.untilBuilt; });
		if (built && optionAppliesTo(built, body, list)) { return false; }
	}
	return opt.bodies === "*" || opt.bodies.indexOf(body) !== -1;
}

export var DEPARTURE_TECH_OPTIONS = [
	// The generic skyhook, which orbits any body (modules/skyhook).
	{ id: "skyhook", label: "Skyhook", platform: SKYHOOK,
	  moduleId: "orbital-skyhook", moduleUrl: "../modules/skyhook/skyhook-departure.js" },
	// The elevators through Earth–Moon L1, from the Moon's near side, and L2,
	// from its far side (modules/elevator). Moon only: their platforms say so.
	{ id: "l1-elevator", label: "L1 elevator", platform: L1_ELEVATOR,
	  moduleId: "l1-elevator", moduleUrl: "../modules/elevator/l1-elevator-departure.js" },
	{ id: "l2-elevator", label: "L2 elevator", platform: L2_ELEVATOR,
	  moduleId: "l2-elevator", moduleUrl: "../modules/elevator/l2-elevator-departure.js" },
	// The off-equator Mars elevator (modules/space-elevator); elsewhere, future.
	{ id: "space-elevator", label: "Space elevator", platform: SPACE_ELEVATOR,
	  moduleId: "space-elevator", moduleUrl: "../modules/space-elevator/space-elevator-departure.js" },
	{ id: "space-elevator-future", label: "Space elevator", bodies: "*", future: true, untilBuilt: "space-elevator" },
	{ id: "mass-driver", label: "Mass driver", bodies: "*", future: true },
	{ id: "chemical-rocket", label: "Chemical rocket", bodies: "*", future: true }
];

// Departure entries applicable to `body` — the generic "*" entries for any
// known body, plus any entry naming it explicitly (same shape as
// arrivalTechOptionsFor). Pure; exported for Node tests.
export function techOptionsFor(body) {
	if (typeof body !== "string" || body === "") { return []; }
	return DEPARTURE_TECH_OPTIONS.filter(function (opt) {
		return optionAppliesTo(opt, body, DEPARTURE_TECH_OPTIONS);
	});
}

// The ARRIVAL technologies — same catalog shape, filtered against the adopted
// plan's arrival body instead of the chain's base. The built entries are the
// departure platforms in their arrival role: the skyhook's tether run in
// reverse, and the Mars elevator catching on its tether.
export var ARRIVAL_TECH_OPTIONS = [
	{ id: "arrival-skyhook", label: "Skyhook", platform: SKYHOOK,
	  moduleId: "arrival-skyhook", moduleUrl: "../modules/skyhook/skyhook-arrival.js" },
	{ id: "arrival-space-elevator", label: "Space elevator", platform: SPACE_ELEVATOR,
	  moduleId: "arrival-space-elevator", moduleUrl: "../modules/space-elevator/space-elevator-arrival.js" },
	{ id: "space-elevator-catch", label: "Space elevator", bodies: "*", future: true, untilBuilt: "arrival-space-elevator" },
	{ id: "ring-mass-driver", label: "Ring mass driver", bodies: "*", future: true },
	{ id: "tugs", label: "Tugs", bodies: "*", future: true }
];

// Arrival entries applicable to `body`: the generic "*" entries for any known
// body, plus any entry naming it explicitly. Pure; exported for Node tests.
export function arrivalTechOptionsFor(body) {
	if (typeof body !== "string" || body === "") { return []; }
	return ARRIVAL_TECH_OPTIONS.filter(function (opt) {
		return optionAppliesTo(opt, body, ARRIVAL_TECH_OPTIONS);
	});
}
