/* MissionPlanner/modules/elevator/l1-elevator-departure — the L1 elevator in
 * its DEPARTURE role: a carrier that appends its release point's line element
 * to the Moon's kinematic chain and lets the ship go.
 *
 * A role adapter, deliberately thin: the elevator's geometry, parameters,
 * readouts and drawing are in elevator.js, and everything a carrier does
 * around them is in ../platform/platform-roles.js. Registered under the module
 * id `l1-elevator`, which missions carry.
 */

import { makeCarrier } from "../platform/platform-roles.js";
import { L1_ELEVATOR } from "./elevator.js";

export default makeCarrier(L1_ELEVATOR, { id: "l1-elevator", title: "L1 elevator" });
