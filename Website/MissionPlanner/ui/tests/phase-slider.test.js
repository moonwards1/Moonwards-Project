// Node tests for the pure half of ui/phase-slider.js (task B2). The DOM
// wrapper (createSegmentedSlider/createCoastSlider) is browser-only and not
// exercised here — see mission-view.js's in-browser verification instead.
// Run from the repo root:
//   node --test Website/MissionPlanner/ui/tests/phase-slider.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { coastSliderState, departureSliderState, elapsedStamp } from "../phase-slider.js";

function shortDate(jd) { return "jd" + Math.round(jd); }
function stamp(jd) { return "t" + jd; }

// ---- elapsedStamp (the "T+" playhead readout) ------------------------------

test("elapsedStamp: whole days at exactly midnight-of-start", () => {
	assert.deepEqual(elapsedStamp(100, 100), { days: "0 d", time: "00:00" });
	assert.deepEqual(elapsedStamp(267, 100), { days: "167 d", time: "00:00" });
});

test("elapsedStamp: the fractional day becomes elapsed HH:MM, not calendar time", () => {
	// 0.5 d elapsed since start -> 12:00, regardless of what time start itself was
	assert.deepEqual(elapsedStamp(100.5, 100), { days: "0 d", time: "12:00" });
	// start at a non-midnight time: still reads as elapsed-since-start
	assert.deepEqual(elapsedStamp(100.75, 100.25), { days: "0 d", time: "12:00" });
});

test("elapsedStamp: days and time stay consistent just before a day boundary", () => {
	// 0.999 d elapsed: still day 0, not rounded up to day 1
	var s = elapsedStamp(100.999, 100);
	assert.equal(s.days, "0 d");
	assert.equal(s.time, "23:59" /* 0.999*1440 = 1438.56 -> rounds to 1439min = 23:59 */);
});

test("elapsedStamp: minute rounding that overflows into the next day carries correctly", () => {
	// elapsed = 0.99999 d -> 1439.986 min, rounds to 1440 -> carries to day 1, 00:00
	var s = elapsedStamp(100.99999, 100);
	assert.equal(s.days, "1 d");
	assert.equal(s.time, "00:00");
});

test("elapsedStamp: before the start reads as a negative day count", () => {
	var s = elapsedStamp(97, 100);
	assert.equal(s.days, "-3 d");
});

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

// ---- B3: the linear-time Departure slider ---------------------------------

// launch at 0, on-course/SOI-exit at 12; one interior mark (Moon SOI) at 2.
var MARKS = [{ jd: 0, label: "release" }, { jd: 2, label: "Moon SOI" }, { jd: 12, label: "Earth SOI" }];

test("departureSliderState: empty when the span isn't resolvable", () => {
	assert.equal(departureSliderState({ start: NaN, end: 12, jd: 0, stamp }).empty, true);
	assert.equal(departureSliderState({ start: 0, end: 0, jd: 0, stamp }).empty, true);   // zero-length
	assert.equal(departureSliderState({ start: 12, end: 0, jd: 6, stamp }).empty, true);  // inverted
});

test("departureSliderState: time is LINEAR — the playhead fraction is (jd-start)/span", () => {
	// jd=2 (the Moon-SOI mark) is 2/12 of the way — a sliver, NOT half. That's
	// the whole point of dropping event-scaling: short milestones stay short.
	assert.ok(Math.abs(departureSliderState({ start: 0, end: 12, jd: 2, stamp }).playheadFrac - 2 / 12) < 1e-12);
	assert.equal(departureSliderState({ start: 0, end: 12, jd: 6, stamp }).playheadFrac, 0.5);
});

test("departureSliderState: even time ticks give the linear scale", () => {
	var s = departureSliderState({ start: 0, end: 10, jd: 0, ticks: 5, stamp });
	assert.equal(s.segments.length, 5);
	assert.equal(s.segments[0].frac0, 0);
	assert.equal(s.segments[4].frac1, 1);
	assert.equal(s.segments[1].label, stamp(2));   // tick at 1/5 of the span
});

test("departureSliderState: interior event marks sit at their true time fractions", () => {
	var s = departureSliderState({ start: 0, end: 12, jd: 0, marks: MARKS, stamp });
	// release (frac 0) and Earth SOI (frac 1) are the edges — dropped; only the
	// interior Moon-SOI mark survives, at 2/12.
	assert.equal(s.marks.length, 1);
	assert.equal(s.marks[0].title, "Moon SOI");
	assert.ok(Math.abs(s.marks[0].frac - 2 / 12) < 1e-12);
});

test("departureSliderState: the clock outside the span pins the playhead", () => {
	assert.equal(departureSliderState({ start: 0, end: 12, jd: -5, stamp }).pinnedAt, "start");
	assert.equal(departureSliderState({ start: 0, end: 12, jd: -5, stamp }).playheadFrac, 0);
	assert.equal(departureSliderState({ start: 0, end: 12, jd: 99, stamp }).pinnedAt, "end");
	assert.equal(departureSliderState({ start: 0, end: 12, jd: 99, stamp }).playheadFrac, 1);
	// exactly on an edge is not pinned (inclusive span, matching Coast)
	assert.equal(departureSliderState({ start: 0, end: 12, jd: 0, stamp }).pinnedAt, null);
	assert.equal(departureSliderState({ start: 0, end: 12, jd: 12, stamp }).pinnedAt, null);
});
