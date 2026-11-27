/* MissionPlanner/modules/space-elevator/space-elevator-departure — the Mars
 * space elevator in its DEPARTURE role: the carrier that lets the ship go
 * from a point of the tether.
 *
 * A role adapter, deliberately thin: the tether, its parameters, readouts,
 * release-time aiming and drawing are in space-elevator.js, and everything a
 * carrier does around them is in ../platform/platform-roles.js. Registered
 * under the module id `space-elevator`, which missions carry.
 */

import { makeCarrier } from "../platform/platform-roles.js";
import { SPACE_ELEVATOR } from "./space-elevator.js";

export default makeCarrier(SPACE_ELEVATOR, { id: "space-elevator", title: "Space elevator" });
