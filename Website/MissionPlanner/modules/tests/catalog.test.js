// Node tests for presets/examples-catalog.js — every example mission the tab
// bar's dropdown can open must load, recompute and survive a share link. Run
// from the repo root:
//   node --test Website/MissionPlanner/modules/tests/catalog.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { deserializeWorld } from "../../core/world.js";
import { createRegistry } from "../../core/registry.js";
import { createEngine } from "../../core/recompute.js";
import { EXAMPLE_MISSIONS } from "../../presets/examples-catalog.js";
import { encodeFragment, decodeFragment } from "../../../Shared/exchange.js";
import moonPlatform from "../moon-platform/moon-platform.js";
import skyhookDeparture from "../skyhook/skyhook-departure.js";
import skyhookArrival from "../skyhook/skyhook-arrival.js";
import departureLeg from "../departure-leg/departure-leg.js";
import bodyDepartureLeg from "../body-departure-leg/body-departure-leg.js";
import adoptedPlan from "../adopted-plan/adopted-plan.js";
import transferLeg from "../transfer-leg/transfer-leg.js";
import arrivalLeg from "../arrival-leg/arrival-leg.js";

function makeRegistry() {
	var reg = createRegistry();
	[moonPlatform, skyhookDeparture, skyhookArrival, departureLeg, bodyDepartureLeg,
		adoptedPlan, transferLeg, arrivalLeg].forEach(function (m) { reg.register(m); });
	return reg;
}

test("the catalog has at least one example", function () {
	assert.ok(EXAMPLE_MISSIONS.length >= 1);
});

EXAMPLE_MISSIONS.forEach(function (entry) {
	test("example '" + entry.label + "': loads, recomputes the plan and coast, survives a share link", function () {
		var res = deserializeWorld(entry.mission);
		assert.equal(res.ok, true, res.reason);
		var engine = createEngine(res.world, makeRegistry());
		var stages = res.world.stages();
		var plan = stages.filter(function (s) { return s.moduleId === "adopted-plan"; })[0];
		var coast = stages.filter(function (s) { return s.moduleId === "transfer-leg"; })[0];
		assert.ok(plan && coast, "an example carries an adopted plan and a coast");
		assert.equal(engine.resultFor(plan.id).status, "ok");
		assert.equal(engine.resultFor(coast.id).status, "ok");

		var back = deserializeWorld(decodeFragment(encodeFragment(res.world.serialize())));
		assert.equal(back.ok, true);
		assert.deepEqual(back.world.serialize(), res.world.serialize());
	});
});
