// Node tests for Shared/sim/screen-line.js's vertex layout. Run from the repo
// root:  node --test Website/Shared/tests/screen-line.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { screenLineAttributes } from "../sim/screen-line.js";

test("two vertices per point, two triangles per segment", () => {
	var at = screenLineAttributes([[0, 0, 0], [1, 0, 0], [2, 1, 0]]);
	assert.equal(at.position.length, 3 * 2 * 3);
	assert.deepEqual(Array.from(at.side), [-1, 1, -1, 1, -1, 1]);
	assert.deepEqual(at.index, [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
});

test("each vertex carries its neighbours; the ends repeat themselves", () => {
	var at = screenLineAttributes([[0, 0, 0], [1, 0, 0], [2, 1, 0]]);
	assert.deepEqual(Array.from(at.prev.slice(0, 3)), [0, 0, 0]);      // first: prev = itself
	assert.deepEqual(Array.from(at.next.slice(0, 3)), [1, 0, 0]);
	assert.deepEqual(Array.from(at.prev.slice(6, 9)), [0, 0, 0]);      // middle
	assert.deepEqual(Array.from(at.next.slice(6, 9)), [2, 1, 0]);
	assert.deepEqual(Array.from(at.next.slice(15, 18)), [2, 1, 0]);    // last: next = itself
});

test("a single point gives no triangles", () => {
	assert.deepEqual(screenLineAttributes([[1, 2, 3]]).index, []);
});
