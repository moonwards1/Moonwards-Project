// Node tests for materials.js. Run from the repo root:
//   node --test Website/Shared/tests/materials.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { MATERIALS, breakingLength } from "../materials.js";

test("breaking length L = σ / (ρ g₀)", function () {
	assert.equal(Math.round(breakingLength(MATERIALS.mwcnt.strength, MATERIALS.mwcnt.density) / 1e3), 3059);
	assert.equal(Math.round(breakingLength(MATERIALS.silica.strength, MATERIALS.silica.density) / 1e3), 576);
	assert.ok(isNaN(breakingLength(0, 1400)));
});

test("breaking length at a given gravity L = σ / (ρ g)", function () {
	// g₀ and the explicit equivalent agree; the Moon's 1.62 m/s² gives g₀/1.62 times the length
	assert.equal(breakingLength(13e9, 2300, 9.80665), breakingLength(13e9, 2300));
	assert.equal(Math.round(breakingLength(13e9, 2300, 1.62) / 1e3), 3489);
	assert.ok(isNaN(breakingLength(13e9, 2300, 0)));
});

test("every preset has a name, strength and density", function () {
	Object.keys(MATERIALS).forEach(function (k) {
		var m = MATERIALS[k];
		assert.ok(m.name && m.strength > 0 && m.density > 0, k);
	});
});
