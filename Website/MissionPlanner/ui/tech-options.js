// MissionPlanner/ui/tech-options.js — the departure "technology" dropdown's
// own small registry (task F1), distinct from core/registry.js (the module
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
