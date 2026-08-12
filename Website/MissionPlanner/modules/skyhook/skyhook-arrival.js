/* MissionPlanner/modules/skyhook/skyhook-arrival — the skyhook in its ARRIVAL
 * role: the terminal stage that catches the delivered approach at the tip.
 *
 * A role adapter, deliberately thin: the tether physics (the same geometry the
 * departure role uses, without the escape gate — a catch is legitimate with a
 * sub-escape tip) and the trim-Δv figures are in skyhook.js, and everything a
 * terminal stage does around them (the approach measurement, the intercept
 * check, the card) is in ../platform/platform-roles.js. Registered under the
 * module id `arrival-skyhook`, which missions and the shipped presets carry.
 */

import { makeTerminal, computeCapture } from "../platform/platform-roles.js";
import { SKYHOOK } from "./skyhook.js";

// The catch for one param set, pure — exported for Node tests and any caller
// wanting the figures without a stage.
export function computeCatch(params, data, pass) {
	return computeCapture(SKYHOOK, params, data, pass);
}

export default makeTerminal(SKYHOOK, { id: "arrival-skyhook", title: "Orbital skyhook catch" });
