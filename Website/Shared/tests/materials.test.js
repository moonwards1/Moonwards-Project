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

test("every preset has a name, strength and density", function () {
	Object.keys(MATERIALS).forEach(function (k) {
		var m = MATERIALS[k];
		assert.ok(m.name && m.strength > 0 && m.density > 0, k);
	});
});
