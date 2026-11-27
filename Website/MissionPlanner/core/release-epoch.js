/* MissionPlanner/core/release-epoch.js — when the departure chain lets go.
 *
 * The release epoch belongs to the DEPARTURE PHASE, not to the adopted plan.
 * The plan states a requirement at the Departure→Coast boundary — be at this
 * heliocentric state, with this v∞, within this window — and says nothing
 * about how or when the ship got there. Release is one of the things the
 * departure phase decides in order to meet that requirement, so it is a param
 * on the departure leg stage (`releaseJd` on departure-leg /
 * body-departure-leg), seeded at adopt from core/departure-phase-estimate.js and
 * owned by the phase thereafter.
 *
 * Everything upstream of the leg needs the same epoch to evaluate itself at —
 * moon-platform's Moon figures, the skyhook's rotor phase, the platform
 * readouts — so they all read it through this one lookup rather than each
 * groping through the stages. Returns null when the mission has no departure
 * leg or its leg records no epoch; each caller reports that as its own
 * diagnostic.
 *
 * One control moves it after adopt: the card of a carrier aimed by WHEN it
 * lets go — one fixed to a spinning body's ground, whose release direction
 * turns with the body (a platform's release.epoch,
 * modules/platform/platform-spec.js). It writes the leg's `releaseJd`
 * through releaseLegFor.
 *
 * Pure, no DOM — Node-testable.
 */

var LEG_MODULES = ["departure-leg", "body-departure-leg"];

export function releaseEpochFor(world) {
	var leg = releaseLegFor(world);
	return leg ? leg.params.releaseJd : null;
}

// The departure leg stage that holds the release epoch, or null — for the
// one control that moves the epoch: a carrier aimed by WHEN it lets go
// (a platform's release.epoch, modules/platform/platform-spec.js).
export function releaseLegFor(world) {
	if (!world || typeof world.stages !== "function") { return null; }
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (LEG_MODULES.indexOf(stages[i].moduleId) < 0) { continue; }
		if (isFinite((stages[i].params || {}).releaseJd)) { return stages[i]; }
	}
	return null;
}
