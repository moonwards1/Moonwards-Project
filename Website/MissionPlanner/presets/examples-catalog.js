/* MissionPlanner/presets/examples-catalog.js — the "example missions"
 * drop-down's catalog (design doc, Top pane / top part: "a button for
 * duplicating the currently displayed mission, and one for opening a mission
 * from a drop-down menu where users can choose from a small number of
 * example missions").
 *
 * Each entry's `mission` is a serialized World (core/world.js's
 * deserializeWorld shape) and `workspace` is the suggested main-pane frame id
 * for a fresh spawn (mission-view.js's `defaultMain`, e.g. "body:Earth-Moon"
 * or "body:Ceres"; falls back to "helio" if the mission has no such frame).
 * planner.js's example-select handler deserializes a FRESH World from
 * `mission` on every pick — the catalog entries are stateless data, shared
 * by reference across however many tabs get spawned from them, so each
 * spawn must never hand out a live object two tabs could both mutate.
 *
 * Each entry is currently just the adopted plan a freshly created mission
 * carries once it's adopted on the Ephemeris tab — no departure or arrival
 * technology configured, no revision beyond the original adoption. More
 * examples, and ones exercising configured technology, are expected later.
 */

import { moonMars2039Mission, moonMars2039Workspace } from "./moon-mars-2039.js";
import { moonCeres2032Mission, moonCeres2032Workspace } from "./moon-ceres-2032.js";
import { ceresMercury2030Mission, ceresMercury2030Workspace } from "./ceres-mercury-2030.js";

export var EXAMPLE_MISSIONS = [
	{
		id: "moon-mars-2039",
		label: "Moon → Mars 2039",
		blurb: "Adopted plan only — no departure or arrival technology configured.",
		mission: moonMars2039Mission,
		workspace: moonMars2039Workspace
	},
	{
		id: "moon-ceres-2032",
		label: "Moon → Ceres 2032",
		blurb: "Adopted plan only — no departure or arrival technology configured.",
		mission: moonCeres2032Mission,
		workspace: moonCeres2032Workspace
	},
	{
		id: "ceres-mercury-2030",
		label: "Ceres → Mercury 2030",
		blurb: "Adopted plan only — no departure or arrival technology configured.",
		mission: ceresMercury2030Mission,
		workspace: ceresMercury2030Workspace
	}
];
