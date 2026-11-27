/* MissionPlanner/modules/space-elevator/space-elevator-arrival — the Mars
 * space elevator in its ARRIVAL role: the terminal stage that catches the
 * delivered approach wherever it meets the tether.
 *
 * A role adapter, deliberately thin: the tether and the contact search are in
 * space-elevator.js, and everything a terminal stage does around them (the
 * approach measurement, the intercept check, the card) is in
 * ../platform/platform-roles.js. Registered under the module id
 * `arrival-space-elevator`, which missions carry.
 */

import { makeTerminal, computeCapture } from "../platform/platform-roles.js";
import { SPACE_ELEVATOR } from "./space-elevator.js";

// The catch for one param set, pure — exported for Node tests.
export function computeCatch(params, data, pass) {
	return computeCapture(SPACE_ELEVATOR, params, data, pass);
}

export default makeTerminal(SPACE_ELEVATOR, { id: "arrival-space-elevator", title: "Space elevator" });
