/* MissionPlanner/modules/skyhook/skyhook-departure — the skyhook in its
 * DEPARTURE role: a carrier that appends its rotor to the kinematic chain and
 * releases the payload from the tether tip.
 *
 * A role adapter, deliberately thin: the tether physics, the parameters, the
 * defaults and the drawing are all in skyhook.js, and everything a carrier
 * does around them (the body checks, the chain plumbing, the release anchor,
 * the card) is in ../platform/platform-roles.js. Registered under the module
 * id `orbital-skyhook`, which missions and the shipped presets carry.
 */

import { makeCarrier } from "../platform/platform-roles.js";
import { SKYHOOK } from "./skyhook.js";

export default makeCarrier(SKYHOOK, { id: "orbital-skyhook", title: "Skyhook" });
