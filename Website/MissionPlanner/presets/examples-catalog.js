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
import { earthMars2035UnbuiltMission, earthMars2035UnbuiltWorkspace } from "./earth-mars-2035-unbuilt.js";
import { moonVenus2039UnbuiltMission, moonVenus2039UnbuiltWorkspace } from "./moon-venus-2039-unbuilt.js";
import { earthVenus2039UnbuiltMission, earthVenus2039UnbuiltWorkspace } from "./earth-venus-2039-unbuilt.js";
import { moonCeres2031UnbuiltMission, moonCeres2031UnbuiltWorkspace } from "./moon-ceres-2031-unbuilt.js";
import { ceresMars2041UnbuiltMission, ceresMars2041UnbuiltWorkspace } from "./ceres-mars-2041-unbuilt.js";
import { ceresEarth2040UnbuiltMission, ceresEarth2040UnbuiltWorkspace } from "./ceres-earth-2040-unbuilt.js";
import { marsJupiter2037UnbuiltMission, marsJupiter2037UnbuiltWorkspace } from "./mars-jupiter-2037-unbuilt.js";
import { venusMercury2037UnbuiltMission, venusMercury2037UnbuiltWorkspace } from "./venus-mercury-2037-unbuilt.js";

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
			},
			{
				id: "unbuilt-earth-mars-2035",
				label: "Earth → Mars 2035",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: earthMars2035UnbuiltMission,
				workspace: earthMars2035UnbuiltWorkspace
			},
			{
				id: "unbuilt-moon-venus-2039",
				label: "Moon → Venus 2039",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: moonVenus2039UnbuiltMission,
				workspace: moonVenus2039UnbuiltWorkspace
			},
			{
				id: "unbuilt-earth-venus-2039",
				label: "Earth → Venus 2039",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: earthVenus2039UnbuiltMission,
				workspace: earthVenus2039UnbuiltWorkspace
			},
			{
				id: "unbuilt-moon-ceres-2031",
				label: "Moon → Ceres 2031",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: moonCeres2031UnbuiltMission,
				workspace: moonCeres2031UnbuiltWorkspace
			},
			{
				id: "unbuilt-ceres-mars-2041",
				label: "Ceres → Mars 2041",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: ceresMars2041UnbuiltMission,
				workspace: ceresMars2041UnbuiltWorkspace
			},
			{
				id: "unbuilt-ceres-earth-2040",
				label: "Ceres → Earth 2040",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: ceresEarth2040UnbuiltMission,
				workspace: ceresEarth2040UnbuiltWorkspace
			},
			{
				id: "unbuilt-mars-jupiter-2037",
				label: "Mars → Jupiter 2037",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: marsJupiter2037UnbuiltMission,
				workspace: marsJupiter2037UnbuiltWorkspace
			},
			{
				id: "unbuilt-venus-mercury-2037",
				label: "Venus → Mercury 2037",
				blurb: "As it arrives from the Ephemeris tab — no departure or arrival technology set up.",
				mission: venusMercury2037UnbuiltMission,
				workspace: venusMercury2037UnbuiltWorkspace
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
