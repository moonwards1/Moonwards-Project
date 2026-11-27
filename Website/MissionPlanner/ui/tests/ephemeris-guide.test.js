// Node tests for ui/ephemeris-guide.js's pure parts: which step the page is
// on, and the step-3 trajectory pulse. Run from the repo root:
//   node --test Website/MissionPlanner/ui/tests/ephemeris-guide.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { guideStep, trajectoryGlow, GUIDE_MESSAGES, PULSE_MS, PULSE_COUNT, STEADY_GLOW }
	from "../ephemeris-guide.js";

var allSlid = { coarse: true, fine: true, marker: true };

test("guideStep: the first step not yet done", () => {
	assert.equal(guideStep({ destination: "" }), 1);
	assert.equal(guideStep({ destination: "Mars", burnSet: false }), 2);
	assert.equal(guideStep({ destination: "Mars", burnSet: true, marker: false }), 3);
	assert.equal(guideStep({ destination: "Mars", burnSet: true, marker: true, slid: {} }), 4);
	assert.equal(guideStep({ destination: "Mars", burnSet: true, marker: true,
		slid: { coarse: true, fine: true, marker: false } }), 4);
	assert.equal(guideStep({ destination: "Mars", burnSet: true, marker: true, slid: allSlid }), 5);
	assert.equal(guideStep({ destination: "Mars", burnSet: true, marker: true, slid: allSlid,
		targetUsed: true }), 6);
	assert.equal(GUIDE_MESSAGES.length, 6);
});

test("guideStep: an undone earlier step wins over later progress", () => {
	// e.g. Reset clears the destination after the sliders and Target were used
	assert.equal(guideStep({ destination: "", burnSet: true, marker: true, slid: allSlid,
		targetUsed: true }), 1);
	assert.equal(guideStep({ destination: "Mars", burnSet: true, marker: false, slid: allSlid,
		targetUsed: true }), 3);
});

test("trajectoryGlow: pulses, then holds a steady glow", () => {
	assert.equal(trajectoryGlow(0, false), 0);
	assert.ok(Math.abs(trajectoryGlow(PULSE_MS / 2, false) - 1) < 1e-12);
	assert.equal(trajectoryGlow(PULSE_MS * PULSE_COUNT, false), STEADY_GLOW);
	assert.equal(trajectoryGlow(1e9, false), STEADY_GLOW);
	assert.equal(trajectoryGlow(PULSE_MS / 2, true), STEADY_GLOW);   // reduced motion
});
