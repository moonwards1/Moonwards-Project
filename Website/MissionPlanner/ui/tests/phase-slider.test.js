// Node tests for the pure half of ui/phase-slider.js (task B2). The DOM
// wrapper (createSegmentedSlider/createCoastSlider) is browser-only and not
// exercised here — see mission-view.js's in-browser verification instead.
// Run from the repo root:
//   node --test Website/MissionPlanner/ui/tests/phase-slider.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { coastSliderState, eventSliderState, eventSliderJd } from "../phase-slider.js";

function shortDate(jd) { return "jd" + Math.round(jd); }
function stamp(jd) { return "t" + jd; }

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

// ---- B3: the event-scaled slider ------------------------------------------

var EV3 = [{ jd: 0, label: "release" }, { jd: 2, label: "Moon SOI" }, { jd: 12, label: "Earth SOI" }];

test("eventSliderState: fewer than two events has no gap to scale (empty)", () => {
	assert.equal(eventSliderState({ events: [], jd: 0, stamp }).empty, true);
	assert.equal(eventSliderState({ events: [{ jd: 5, label: "x" }], jd: 5, stamp }).empty, true);
});

test("eventSliderState: N events give N-1 equal-width gaps, labelled by the reached milestone", () => {
	var s = eventSliderState({ events: EV3, jd: 0, stamp });
	assert.equal(s.empty, false);
	assert.equal(s.segments.length, 2);
	// equal track width regardless of the 2-day vs 10-day real durations
	assert.equal(s.segments[0].frac0, 0);
	assert.equal(s.segments[0].frac1, 0.5);
	assert.equal(s.segments[1].frac1, 1);
	assert.equal(s.segments[0].label, "Moon SOI");
	assert.equal(s.segments[1].label, "Earth SOI");
	assert.equal(s.segments[1].sub, stamp(12));
});

test("eventSliderState: the fraction<->jd map is nonlinear across gaps but continuous", () => {
	// jd=1 is halfway through the first (2-day) gap -> a quarter of the track.
	assert.equal(eventSliderState({ events: EV3, jd: 1, stamp }).playheadFrac, 0.25);
	// jd=7 is halfway through the second (10-day) gap -> three-quarters.
	assert.equal(eventSliderState({ events: EV3, jd: 7, stamp }).playheadFrac, 0.75);
	// a breakpoint maps exactly to a gap boundary
	assert.equal(eventSliderState({ events: EV3, jd: 2, stamp }).playheadFrac, 0.5);
});

test("eventSliderState: the clock outside the flight span pins the playhead", () => {
	assert.equal(eventSliderState({ events: EV3, jd: -5, stamp }).pinnedAt, "start");
	assert.equal(eventSliderState({ events: EV3, jd: -5, stamp }).playheadFrac, 0);
	assert.equal(eventSliderState({ events: EV3, jd: 99, stamp }).pinnedAt, "end");
	assert.equal(eventSliderState({ events: EV3, jd: 99, stamp }).playheadFrac, 1);
	// exactly on an edge is not pinned (inclusive span, matching Coast)
	assert.equal(eventSliderState({ events: EV3, jd: 0, stamp }).pinnedAt, null);
	assert.equal(eventSliderState({ events: EV3, jd: 12, stamp }).pinnedAt, null);
});

test("eventSliderState: sorts unordered events before scaling", () => {
	var shuffled = [EV3[2], EV3[0], EV3[1]];
	var s = eventSliderState({ events: shuffled, jd: 1, stamp });
	assert.equal(s.segments[0].label, "Moon SOI");
	assert.equal(s.playheadFrac, 0.25);
});

test("eventSliderJd: inverts fractionOfJd (a scrub round-trips to the same jd)", () => {
	[0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
		var jd = eventSliderJd(EV3, frac);
		assert.ok(Math.abs(eventSliderState({ events: EV3, jd: jd, stamp }).playheadFrac - frac) < 1e-9,
			"frac " + frac + " -> jd " + jd + " -> back");
	});
	// endpoints land on the first/last events
	assert.equal(eventSliderJd(EV3, 0), 0);
	assert.equal(eventSliderJd(EV3, 1), 12);
});
