/* MissionPlanner/modules/elevator/l2-elevator-departure — the L2 elevator in
 * its DEPARTURE role: a carrier that appends its release point's line element
 * to the Moon's kinematic chain and lets the ship go.
 *
 * A role adapter, deliberately thin: the elevator's geometry, parameters,
 * readouts and drawing are in elevator.js, and everything a carrier does
 * around them (the body checks, the chain plumbing, the release anchor, the
 * card) is in ../platform/platform-roles.js. Registered under the module id
 * `l2-elevator`, which missions carry.
 */

import { makeCarrier } from "../platform/platform-roles.js";
import { L2_ELEVATOR } from "./elevator.js";

export default makeCarrier(L2_ELEVATOR, { id: "l2-elevator", title: "L2 elevator" });
