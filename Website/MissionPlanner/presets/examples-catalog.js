/* MissionPlanner/presets/examples-catalog.js — the "example missions"
 * drop-down's catalog (design doc, Top pane / top part: "a button for
 * duplicating the currently displayed mission, and one for opening a mission
 * from a drop-down menu where users can choose from a small number of
 * example missions").
 *
 * Each entry's `mission` is a serialized World (core/world.js's
 * deserializeWorld shape — the same shape default-mission.js's shipped
 * preset carries) and `workspace` is the suggested main-pane frame id for a
 * fresh spawn (mission-view.js's `defaultMain`, e.g. "body:Earth-Moon" or
 * "body:Jupiter"; falls back to "helio" if the mission has no such frame).
 * planner.js's example-select handler deserializes a FRESH World from
 * `mission` on every pick — the catalog entries are stateless data, shared
 * by reference across however many tabs get spawned from them, so each
 * spawn must never hand out a live object two tabs could both mutate.
 *
 * Purpose: a small set of worked examples spanning the
 * geometry extremes the app has to render correctly, so a future change can
 * be checked against a realistic mission in one click — open the tab, or
 * copy its mission link into the Ephemeris tab's "Paste mission link…" to
 * see it in that context instead. Each is a genuine integrated flight (real
 * skyhook geometry + waypoint burns run through the actual departure/coast/
 * arrival modules, verified in Node — see each preset file's own header),
 * not a hand-waved placeholder, and — the shipped default excepted, which
 * deliberately teaches the departure gap it ships with (see its own header)
 * — each is compliant BY CONSTRUCTION: the frozen plan's departure/arrival
 * commitment is exactly what the configured technology actually delivers,
 * so opening one shows a clean flight with no comply-boundary warnings
 * unless a future change breaks something.
 */

import { defaultMission, defaultWorkspaceMain } from "./default-mission.js";
import { earthMarsReferenceMission, earthMarsReferenceWorkspace } from "./earth-mars-reference.js";
import { jupiterMercuryMission, jupiterMercuryWorkspace } from "./jupiter-mercury.js";
import { venusSaturnMission, venusSaturnWorkspace } from "./venus-saturn.js";
import { earthVenusOvershootMission, earthVenusOvershootWorkspace } from "./earth-venus-overshoot.js";
import { marsMercuryMission, marsMercuryWorkspace } from "./mars-mercury.js";

export var EXAMPLE_MISSIONS = [
	{
		id: "moon-ceres",
		label: "Moon → Ceres 2031",
		blurb: "The shipped worked example — a lunar skyhook departure with a " +
			"deliberate v∞/aim gap left for the mission-planning exercise.",
		mission: defaultMission,
		workspace: defaultWorkspaceMain
	},
	{
		id: "earth-mars-reference",
		label: "Moon → Mars 2033 (clean reference)",
		blurb: "Compliant by construction — zero comply-boundary warnings at " +
			"either end, plus a configured arrival-skyhook catch.",
		mission: earthMarsReferenceMission,
		workspace: earthMarsReferenceWorkspace
	},
	{
		id: "jupiter-mercury",
		label: "Jupiter → Mercury 2035",
		blurb: "Outer → inner: the largest origin SOI and longest transfer in " +
			"the set, arriving at an honestly extreme v∞ from the fall.",
		mission: jupiterMercuryMission,
		workspace: jupiterMercuryWorkspace
	},
	{
		id: "venus-saturn",
		label: "Venus → Saturn 2034",
		blurb: "Inner → outer: the mirror case — the largest arrival SOI in " +
			"the set and a multi-year coast.",
		mission: venusSaturnMission,
		workspace: venusSaturnWorkspace
	},
	{
		id: "earth-venus-overshoot",
		label: "Moon → Venus 2036 (overshoot)",
		blurb: "The most demanding waypoint-tuning case — swings out past " +
			"Mars' orbit before falling back to catch Venus, using both " +
			"waypoint slots for genuinely different jobs.",
		mission: earthVenusOvershootMission,
		workspace: earthVenusOvershootWorkspace
	},
	{
		id: "mars-mercury",
		label: "Mars → Mercury 2032",
		blurb: "Departure and arrival Δv both pushed up together — a real " +
			"mid-course correction burn and a large arrival v∞ from Mercury's " +
			"deep well.",
		mission: marsMercuryMission,
		workspace: marsMercuryWorkspace
	}
];
