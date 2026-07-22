// MissionPlanner/ui/tech-options.js — the departure and arrival "technology"
// dropdowns' own small registry (tasks F1, H2), distinct from core/registry.js (the module
// registry: what's LOADED and how the recompute chain calls it). This one is
// about what's OFFERABLE in the dropdown and to which body it applies —
// UI/catalog data, not a module descriptor.
//
// Each entry:
//   { id, label, bodies, moduleId, moduleUrl }  — built: selectable, swaps
//     the departure tech stage's module (see mission-view.js's
//     swapDepartureTech). moduleUrl is dynamic-imported only if the module
//     registry doesn't already have moduleId (today every built module is
//     eager-loaded by planner.js's MODULE_URLS, so this is a fallback for
//     techs that AREN'T in that eager list).
//   { id, label, bodies, future: true }         — unbuilt: shown, disabled,
//     "(future)" in its own label suffix.
//
// `bodies` follows the project's "body" convention (see
// Shared/exchange-types.js's header, MissionPlannerTasks.md's I5/I6 notes,
// Kim 2026-07-17): a body-scoped catalog entry, not a hardcoded "the Moon is
// the only place with tech" assumption. `bodies: "*"` means any body the
// departure chain can be based at; a body-specific entry keeps an explicit
// list. The four categories below are the generic departure technologies (Kim,
// 2026-07-20): the skyhook is built (the unified orbital-skyhook, which orbits
// any body), the rest are "(future)". Per-body plausibility limits (a Venus
// skyhook is a stretch goal, a Jupiter space elevator is not) are a future
// refinement — for now the generic entries offer against every body, and the
// dropdown filters by whichever body the chain's base actually is.

export var DEPARTURE_TECH_OPTIONS = [
	{ id: "skyhook", label: "Skyhook", bodies: "*",
	  moduleId: "orbital-skyhook", moduleUrl: "../modules/orbital-skyhook/orbital-skyhook.js" },
	{ id: "space-elevator", label: "Space elevator", bodies: "*", future: true },
	{ id: "mass-driver", label: "Mass driver", bodies: "*", future: true },
	{ id: "chemical-rocket", label: "Chemical rocket", bodies: "*", future: true }
];

// Entries applicable to `body` — the generic "*" entries for any known body,
// plus any entry naming it explicitly (same shape as arrivalTechOptionsFor).
// Pure; exported for Node tests.
export function techOptionsFor(body) {
	if (typeof body !== "string" || body === "") { return []; }
	return DEPARTURE_TECH_OPTIONS.filter(function (opt) {
		return opt.bodies === "*" || opt.bodies.indexOf(body) !== -1;
	});
}

// The ARRIVAL technologies (task H2) — same catalog shape, filtered against
// the frozen plan's arrival body instead of the chain's base. The one built
// entry is generic (`bodies: "*"` — any destination the plan can commit to):
// the orbital-skyhook catch, WP-J's generic tether run in reverse
// (arrival-skyhook.js). The chemical capture burn is a "(future)" entry: the
// original capture-burn module was retired 2026-07-20 for a rethink, so it's
// listed but greyed until rebuilt. Body-specific entries keep explicit lists,
// like the departure side; the Ceres elevator catch port is migration step
// 4.5's real arrival system, also future until built.
export var ARRIVAL_TECH_OPTIONS = [
	{ id: "capture-burn", label: "Chemical capture burn", bodies: "*", future: true },
	{ id: "arrival-skyhook", label: "Orbital skyhook catch", bodies: "*",
	  moduleId: "arrival-skyhook", moduleUrl: "../modules/arrival-skyhook/arrival-skyhook.js" },
	{ id: "ceres-elevator-catch", label: "Ceres elevator catch port", bodies: ["Ceres"], future: true }
];

// Arrival entries applicable to `body`: the generic "*" entries for any known
// body, plus any entry naming it explicitly. Pure; exported for Node tests.
export function arrivalTechOptionsFor(body) {
	if (typeof body !== "string" || body === "") { return []; }
	return ARRIVAL_TECH_OPTIONS.filter(function (opt) {
		return opt.bodies === "*" || opt.bodies.indexOf(body) !== -1;
	});
}
