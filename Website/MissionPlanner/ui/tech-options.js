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
// the only place with tech" assumption. `Shared/orbit.js`'s `systems` map is
// the one master body list this should ever draw body names from — no
// second list. Today every entry is Moon-only because the only real base
// carrier (moon-platform.js) only ever emits `base: "Moon"`; the dropdown
// filters against whichever body the current chain's base actually is, so a
// future Earth or Venus base platform makes the matching entries appear
// without any code here changing.

export var DEPARTURE_TECH_OPTIONS = [
	{ id: "lunar-skyhook", label: "Lunar skyhook", bodies: ["Moon"],
	  moduleId: "lunar-skyhook", moduleUrl: "../modules/lunar-skyhook/lunar-skyhook.js" },
	{ id: "moon-l1-elevator", label: "Moon-L1 space elevator", bodies: ["Moon"], future: true },
	{ id: "lunar-mass-driver", label: "Lunar mass driver", bodies: ["Moon"], future: true },
	{ id: "chemical-direct", label: "Chemical rocket, direct", bodies: ["Moon"], future: true }
];

// Entries whose `bodies` includes `body` — what the dropdown actually shows
// for the chain's current base. Pure; exported for Node tests.
export function techOptionsFor(body) {
	return DEPARTURE_TECH_OPTIONS.filter(function (opt) {
		return opt.bodies.indexOf(body) !== -1;
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
