// Node tests for the pure half of ui/phase-slider.js (task B2). The DOM
// wrapper (createSegmentedSlider/createCoastSlider) is browser-only and not
// exercised here — see mission-view.js's in-browser verification instead.
// Run from the repo root:
//   node --test Website/MissionPlanner/ui/tests/phase-slider.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { coastSliderState, departureSliderState, arrivalSliderState,
         elapsedStamp, approachStamp } from "../phase-slider.js";

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

// ---- task 1.3: the Arrival slider ------------------------------------------
// The seam window from core/arrival-seam.js: [ca - Δt, ca + 1 day]. The
// canonical case below is a 3-day Δt, so ca sits at 3/4 of a 4-day span.
var CA = 100, DT = 3, TAIL = 1;
var AW = { start: CA - DT, end: CA + TAIL };   // 97 .. 101, ca at 0.75

test("approachStamp: signed time relative to closest approach", () => {
	assert.deepEqual(approachStamp(100, 100), { days: "+0 d", time: "00:00" });
	assert.deepEqual(approachStamp(97.75, 100), { days: "-2 d", time: "06:00" });
	assert.deepEqual(approachStamp(100.5, 100), { days: "+0 d", time: "12:00" });
	// magnitude is split days + HH:MM, so the sign belongs to the pair, not
	// to each line: -2 d / 06:00 means 2 days 6 hours BEFORE, not -2 d + 6 h.
	assert.deepEqual(approachStamp(94.25, 100), { days: "-5 d", time: "18:00" });
});

test("approachStamp: minute rounding carries the same way elapsedStamp's does", () => {
	assert.deepEqual(approachStamp(100.99999, 100), { days: "+1 d", time: "00:00" });
	assert.deepEqual(approachStamp(99.00001, 100), { days: "-1 d", time: "00:00" });
});

test("approachStamp: just before closest approach is negative, never '-0 d 00:00'", () => {
	// a sub-minute lead rounds to zero magnitude — that reads as +0, not -0
	assert.deepEqual(approachStamp(100 - 1e-9, 100), { days: "+0 d", time: "00:00" });
	assert.equal(approachStamp(99.999, 100).days, "-0 d");   // 1.44 min out: still before
});

test("arrivalSliderState: empty when the window collapses (the no-encounter case)", () => {
	// 1.1's fallback puts start === end at the plan's committed arrival epoch
	assert.equal(arrivalSliderState({ start: CA, end: CA, jd: CA, ca: CA, stamp }).empty, true);
	assert.equal(arrivalSliderState({ start: NaN, end: 101, jd: 100, stamp }).empty, true);
	assert.equal(arrivalSliderState({ start: 101, end: 97, jd: 100, stamp }).empty, true);   // inverted
});

test("arrivalSliderState: linear over the window, playhead at (jd-start)/span", () => {
	var s = arrivalSliderState({ start: AW.start, end: AW.end, jd: CA, ca: CA, stamp });
	assert.equal(s.empty, false);
	assert.equal(s.playheadFrac, 0.75);            // closest approach, 3 of 4 days in
	assert.equal(arrivalSliderState({ start: AW.start, end: AW.end, jd: 99, ca: CA, stamp }).playheadFrac, 0.5);
});

test("arrivalSliderState: closest approach is marked on the track", () => {
	var s = arrivalSliderState({ start: AW.start, end: AW.end, jd: CA, ca: CA, stamp });
	var ca = s.marks.filter(function (m) { return m.cls === "mp-mark-ca"; });
	assert.equal(ca.length, 1);
	assert.equal(ca[0].frac, 0.75);
	assert.equal(ca[0].jd, CA);
});

test("arrivalSliderState: arrival events inside the window become marks, outside are dropped", () => {
	var s = arrivalSliderState({ start: AW.start, end: AW.end, jd: CA, ca: CA, stamp,
		marks: [{ jd: 98, label: "SOI entry" }, { jd: 120, label: "way past the window" },
		        { jd: 50, label: "still in the coast" }] });
	var evs = s.marks.filter(function (m) { return m.cls !== "mp-mark-ca"; });
	assert.equal(evs.length, 1);
	assert.equal(evs[0].title, "SOI entry");
	assert.equal(evs[0].frac, 0.25);
});

test("arrivalSliderState: the playhead readout is relative to closest approach", () => {
	var s = arrivalSliderState({ start: AW.start, end: AW.end, jd: 98, ca: CA, stamp });
	assert.equal(s.playheadDays, "-2 d");
	assert.equal(s.playheadTime, "00:00");
	// and past it
	assert.equal(arrivalSliderState({ start: AW.start, end: AW.end, jd: 100.5, ca: CA, stamp }).playheadDays, "+0 d");
});

test("arrivalSliderState: the clock outside the window pins the playhead, readout still true", () => {
	// the common case on entering the phase: the clock is still back in the coast
	var s = arrivalSliderState({ start: AW.start, end: AW.end, jd: 60, ca: CA, stamp });
	assert.equal(s.pinnedAt, "start");
	assert.equal(s.playheadFrac, 0);
	assert.equal(s.playheadDays, "-40 d");   // the readout reports where the clock REALLY is
	var e = arrivalSliderState({ start: AW.start, end: AW.end, jd: 200, ca: CA, stamp });
	assert.equal(e.pinnedAt, "end");
	assert.equal(e.playheadFrac, 1);
});

test("arrivalSliderState: BOTH edges move with the encounter, and the marks move with them", () => {
	// the same window shifted 8 hours later, as tuning the coast would do: every
	// fraction is unchanged, because both edges derive from ca (task 1.3's point).
	var a = arrivalSliderState({ start: AW.start, end: AW.end, jd: CA, ca: CA, stamp });
	var d = 1 / 3;
	var b = arrivalSliderState({ start: AW.start + d, end: AW.end + d, jd: CA + d, ca: CA + d, stamp });
	assert.equal(b.playheadFrac, a.playheadFrac);
	assert.equal(b.marks[0].frac, a.marks[0].frac);
	assert.equal(b.marks[0].jd, CA + d);
	// and a Δt that CHANGES (v∞ shifted) rescales the track: Δt 5 -> ca at 5/6
	var wide = arrivalSliderState({ start: CA - 5, end: CA + 1, jd: CA, ca: CA, stamp });
	assert.ok(Math.abs(wide.marks[0].frac - 5 / 6) < 1e-12);
});

test("arrivalSliderState: even time ticks across the window", () => {
	var s = arrivalSliderState({ start: AW.start, end: AW.end, jd: CA, ca: CA, ticks: 4, stamp });
	assert.equal(s.segments.length, 4);
	assert.equal(s.segments[0].frac0, 0);
	assert.equal(s.segments[3].frac1, 1);
	assert.equal(s.segments[1].label, stamp(98));   // 1/4 of a 4-day window past 97
});
