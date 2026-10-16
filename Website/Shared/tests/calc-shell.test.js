// Node tests for the pure parts of the calculator shell. Run from the repo root:
//   node --test Website/Shared/tests/calc-shell.test.js
//
// Covers module dependency resolution (calc-shell.js) and the view geometry
// helpers (zoom-view.js); the DOM parts are checked in a browser.

import test from "node:test";
import assert from "node:assert/strict";

import { switchModule } from "../calc-shell.js";
import { niceNumber, fitRect, viewBoxOf, zoomAbout } from "../zoom-view.js";

var DEFS = {
	stations: { needs: [], brings: [] },
	payload: { needs: [], brings: ["forces"] },
	cargo: { needs: ["stations"], brings: ["throughput"] },
	keeping: { needs: ["cargo"], brings: ["keepingOut"] },
	forces: { needs: ["payload"], brings: [] },
	throughput: { needs: ["cargo"], brings: [] },
	keepingOut: { needs: ["keeping"], brings: [] },
	drop: { needs: [], brings: [] }
};

test("switching a module on brings what it needs and its paired results", function () {
	var on = switchModule(DEFS, {}, "keeping", true);
	assert.deepEqual(Object.keys(on).filter(function (k) { return on[k]; }).sort(),
		["cargo", "keeping", "keepingOut", "stations", "throughput"]);
});

test("switching a result on switches on the inputs it needs", function () {
	var on = switchModule(DEFS, {}, "forces", true);
	assert.equal(on.payload, true);
	assert.equal(on.forces, true);
});

test("switching a module off drops everything that needs it, transitively", function () {
	var on = switchModule(DEFS, {}, "keeping", true);
	on.drop = true;
	on = switchModule(DEFS, on, "stations", false);
	["stations", "cargo", "keeping", "throughput", "keepingOut"].forEach(function (k) { assert.equal(on[k], false, k); });
	assert.equal(on.drop, true);
});

test("switching a result off leaves its inputs on", function () {
	var on = switchModule(DEFS, {}, "payload", true);
	on = switchModule(DEFS, on, "forces", false);
	assert.equal(on.payload, true);
	assert.equal(on.forces, false);
});

test("switchModule does not mutate its input", function () {
	var before = { stations: true };
	switchModule(DEFS, before, "stations", false);
	assert.deepEqual(before, { stations: true });
});

test("niceNumber picks 1, 2 or 5 × 10^n not above x", function () {
	assert.equal(niceNumber(110), 100);
	assert.equal(niceNumber(260), 200);
	assert.equal(niceNumber(7.3), 5);
	assert.equal(niceNumber(0.034), 0.02);
	assert.equal(niceNumber(0), 0);
});

test("fitRect keeps the whole rect in view at the panel's aspect", function () {
	// a tall rect in a wide panel: height governs
	var v = fitRect([-10, -100, 10, 100], 800, 400, 1);
	assert.deepEqual(v, { cx: 0, cy: 0, h: 200 });
	// a wide rect in a tall panel: width governs, h = w × pxH / pxW
	v = fitRect([0, 0, 400, 10], 200, 400, 1);
	assert.equal(v.h, 800);
	assert.equal(v.cx, 200);
});

test("viewBoxOf centres a box of the panel's aspect on the view", function () {
	assert.deepEqual(viewBoxOf({ cx: 0, cy: 0, h: 100 }, 400, 200), [-100, -50, 200, 100]);
});

test("zoomAbout keeps the world point under the pointer fixed", function () {
	var v = { cx: 0, cy: 0, h: 100 }, W = 400, H = 200, px = 300, py = 50;
	var u0 = v.h / H, wx0 = v.cx + (px - W / 2) * u0, wy0 = v.cy + (py - H / 2) * u0;
	var z = zoomAbout(v, 0.5, px, py, W, H);
	var u1 = z.h / H, wx1 = z.cx + (px - W / 2) * u1, wy1 = z.cy + (py - H / 2) * u1;
	assert.ok(Math.abs(wx1 - wx0) < 1e-9 && Math.abs(wy1 - wy0) < 1e-9);
	assert.equal(z.h, 50);
});
