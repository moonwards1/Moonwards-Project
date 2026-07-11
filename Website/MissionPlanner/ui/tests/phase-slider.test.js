// Node tests for the pure half of ui/phase-slider.js (task B2). The DOM
// wrapper (createSegmentedSlider/createCoastSlider) is browser-only and not
// exercised here — see mission-view.js's in-browser verification instead.
// Run from the repo root:
//   node --test Website/MissionPlanner/ui/tests/phase-slider.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { coastSliderState } from "../phase-slider.js";

function shortDate(jd) { return "jd" + Math.round(jd); }

test("coastSliderState: empty when the span isn't resolvable", () => {
	assert.equal(coastSliderState({ start: NaN, end: 100, jd: 50, shortDate }).empty, true);
	assert.equal(coastSliderState({ start: 0, end: Infinity, jd: 50, shortDate }).empty, true);
	assert.equal(coastSliderState({ start: 100, end: 100, jd: 100, shortDate }).empty, true);   // zero-length
	assert.equal(coastSliderState({ start: 100, end: 50, jd: 60, shortDate }).empty, true);      // inverted
});

test("coastSliderState: mid-span jd is not pinned, fraction reflects position", () => {
	var s = coastSliderState({ start: 0, end: 100, jd: 25, shortDate });
	assert.equal(s.empty, false);
	assert.equal(s.pinnedAt, null);
	assert.equal(s.playheadFrac, 0.25);
});

test("coastSliderState: jd before the span pins at the start", () => {
	var s = coastSliderState({ start: 100, end: 200, jd: 50, shortDate });
	assert.equal(s.pinnedAt, "start");
	assert.equal(s.playheadFrac, 0);
});

test("coastSliderState: jd after the span pins at the end", () => {
	var s = coastSliderState({ start: 100, end: 200, jd: 250, shortDate });
	assert.equal(s.pinnedAt, "end");
	assert.equal(s.playheadFrac, 1);
});

test("coastSliderState: jd exactly on an edge is not pinned (inclusive span)", () => {
	assert.equal(coastSliderState({ start: 0, end: 100, jd: 0, shortDate }).pinnedAt, null);
	assert.equal(coastSliderState({ start: 0, end: 100, jd: 100, shortDate }).pinnedAt, null);
});

test("coastSliderState: default tick count is 5, evenly spaced, covering the full span", () => {
	var s = coastSliderState({ start: 0, end: 100, jd: 0, shortDate });
	assert.equal(s.segments.length, 5);
	assert.equal(s.segments[0].frac0, 0);
	assert.equal(s.segments[4].frac1, 1);
	s.segments.forEach((seg, i) => {
		assert.equal(seg.frac0, i / 5);
		assert.equal(seg.frac1, (i + 1) / 5);
		assert.equal(seg.tickOnly, true);
	});
});

test("coastSliderState: honors a custom tick count and labels each tick's start jd", () => {
	var s = coastSliderState({ start: 0, end: 10, jd: 0, ticks: 2, shortDate });
	assert.equal(s.segments.length, 2);
	assert.equal(s.segments[0].label, shortDate(0));
	assert.equal(s.segments[1].label, shortDate(5));
});
