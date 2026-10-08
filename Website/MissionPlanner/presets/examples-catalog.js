/* MissionPlanner/presets/examples-catalog.js — the "example missions"
 * drop-down's catalog (design doc, Top pane / top part: "a button for
 * duplicating the currently displayed mission, and one for opening a mission
 * from a drop-down menu where users can choose from a small number of
 * example missions").
 *
 * The catalog is two sections, each a titled group in the drop-down:
 *   Unbuilt — the mission as it arrives from the Ephemeris tab: the adopted
 *             plan, no departure or arrival technology set up.
 *   Built   — the same missions, solved: technology and waypoints defined.
 * Each Built mission shares its `id` suffix and label with its Unbuilt twin.
 *
 * Each entry's `mission` is a serialized World (core/world.js's
 * deserializeWorld shape) and `workspace` is the suggested main-pane frame id
 * for a fresh spawn (mission-view.js's `defaultMain`, e.g. "body:Earth-Moon"
 * or "body:Ceres"; falls back to "helio" if the mission has no such frame).
 * planner.js's example-select handler deserializes a FRESH World from
 * `mission` on every pick — the catalog entries are stateless data, shared
 * by reference across however many tabs get spawned from them, so each
 * spawn must never hand out a live object two tabs could both mutate.
 */

import { moonMars2035UnbuiltMission, moonMars2035UnbuiltWorkspace } from "./moon-mars-2035-unbuilt.js";

export var EXAMPLE_SECTIONS = [
	{
		title: "Unbuilt",
		missions: [
			{
				id: "unbuilt-moon-mars-2035",
				label: "Moon → Mars 2035",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: moonMars2035UnbuiltMission,
				workspace: moonMars2035UnbuiltWorkspace
			}
		]
	},
	{
		title: "Built",
		missions: []
	}
];

// Every entry, flattened — for lookup by id.
export var EXAMPLE_MISSIONS = EXAMPLE_SECTIONS.reduce(function (all, s) {
	return all.concat(s.missions);
}, []);
