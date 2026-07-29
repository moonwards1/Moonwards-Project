// Node tests for core/arrival-seam.js. Run from the repo
// root:  node --test Website/MissionPlanner/core/tests/arrival-seam.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
	seamDeltaDays, findClosestApproach, computeArrivalSeam,
	SEAM_MIN_DAYS, SEAM_MAX_DAYS, ARRIVAL_TAIL_DAYS
} from "../arrival-seam.js";
import { originSoiRadius } from "../departure-estimate.js";
import { computeLeg } from "../../modules/transfer-leg/transfer-leg.js";
import { bodyConstants } from "../../../Shared/body-leg.js";
import { Frames } from "../../../Shared/frames.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";

var O = OrbitalMath;
var DAY = 86400;

// ---- seamDeltaDays: the clamp(R_SOI / v∞, 2, 5) formula --------------------

test("seamDeltaDays: clamps below SEAM_MIN_DAYS for a fast/small crossing", () => {
	// 1e6 m at 100 km/s crosses in ~0.0001 d — far under the 2 d floor.
	assert.equal(seamDeltaDays(1e6, 1e5), SEAM_MIN_DAYS);
});

test("seamDeltaDays: clamps above SEAM_MAX_DAYS for a slow/huge crossing", () => {
	// 1e12 m at 1 m/s crosses in ~11,574 d — far over the 5 d ceiling.
	assert.equal(seamDeltaDays(1e12, 1), SEAM_MAX_DAYS);
});

test("seamDeltaDays: the raw formula value in the unclamped middle", () => {
	var rSoi = 3 * DAY * 3000;   // engineered to cross in exactly 3 days at 3 km/s
	assert.ok(Math.abs(seamDeltaDays(rSoi, 3000) - 3) < 1e-9);
});

test("seamDeltaDays: null for non-finite or non-positive inputs", () => {
	assert.equal(seamDeltaDays(0, 3000), null);
	assert.equal(seamDeltaDays(1e8, 0), null);
	assert.equal(seamDeltaDays(-1e8, 3000), null);
	assert.equal(seamDeltaDays(1e8, NaN), null);
	assert.equal(seamDeltaDays(null, 3000), null);
});

// ---- findClosestApproach ----------------------------------------------------

test("findClosestApproach: picks the matching body, ignores others and other kinds", () => {
	var events = [
		{ jd: 100, kind: "closest-approach", body: "Venus", vInf: 1000, rmin: 1e7 },
		{ jd: 105, kind: "soi-entry", body: "Mars", vInf: 2000 },
		{ jd: 106, kind: "closest-approach", body: "Mars", vInf: 2500, rmin: 3e6 },
		{ jd: 110, label: "Leg ends" }
	];
	var hit = findClosestApproach(events, "Mars");
	assert.ok(hit);
	assert.equal(hit.jd, 106);
	assert.equal(hit.vInf, 2500);
});

test("findClosestApproach: null with no events, no destination, or no match", () => {
	assert.equal(findClosestApproach([], "Mars"), null);
	assert.equal(findClosestApproach(null, "Mars"), null);
	assert.equal(findClosestApproach([{ jd: 1, kind: "closest-approach", body: "Venus" }], "Mars"), null);
	assert.equal(findClosestApproach([{ jd: 1, kind: "closest-approach", body: "Mars" }], ""), null);
});

test("findClosestApproach: earliest wins when more than one somehow qualifies", () => {
	var events = [
		{ jd: 200, kind: "closest-approach", body: "Mars", vInf: 1 },
		{ jd: 150, kind: "closest-approach", body: "Mars", vInf: 2 }
	];
	assert.equal(findClosestApproach(events, "Mars").jd, 150);
});

// ---- computeArrivalSeam: no encounter -> the plan's arrival epoch, verbatim

test("computeArrivalSeam: no encounter falls back to the plan's arrival epoch, no window", () => {
	var fallbackJd = 2463500.25;
	var seam = computeArrivalSeam({ destination: "Mars", events: [], fallbackArrivalJd: fallbackJd });
	assert.equal(seam.hasEncounter, false);
	assert.equal(seam.jd, fallbackJd);
	assert.equal(seam.deltaDays, null);
	assert.equal(seam.start, fallbackJd);
	assert.equal(seam.end, fallbackJd);
	assert.equal(seam.vInf, null);
});

test("computeArrivalSeam: an encounter with a DIFFERENT body still falls back", () => {
	var fallbackJd = 2463500.25;
	var events = [{ jd: 2463480, kind: "closest-approach", body: "Venus", vInf: 3000, rmin: 5e6 }];
	var seam = computeArrivalSeam({ destination: "Mars", events: events, fallbackArrivalJd: fallbackJd });
	assert.equal(seam.hasEncounter, false);
	assert.equal(seam.jd, fallbackJd);
});

// ---- computeArrivalSeam: a real encounter, end to end ----------------------
// Mirrors modules/tests/modules.test.js's Mars-flyby fixture: a heliocentric
// coast aimed to pass inside Mars's SOI, so transfer-leg's own computeLeg
// emits a genuine structured closest-approach event.

function marsFlybyLeg() {
	var c = bodyConstants("Mars");
	var jd = 2463000;
	var b = Frames.bodyHelioState("Mars", jd);
	var start = { r: O.vAdd(b.r, [c.SOI * 1.05, c.SOI * 0.15, 0]),
	              v: O.vAdd(b.v, [-4000, 0, 0]), jd: jd, frame: "helio", dvUsed: 0 };
	return computeLeg({ waypoints: [], legDays: 30, destination: "Mars" }, start);
}

test("computeArrivalSeam: a real Mars encounter derives a window within [2, 5] days", () => {
	var leg = marsFlybyLeg();
	assert.equal(leg.ok, true);
	var closest = findClosestApproach(leg.events, "Mars");
	assert.ok(closest, "computeLeg must emit a structured Mars closest-approach event");
	assert.ok(closest.vInf > 0);

	var fallbackJd = leg.end.jd + 999;   // must be ignored — an encounter exists
	var seam = computeArrivalSeam({ destination: "Mars", events: leg.events, fallbackArrivalJd: fallbackJd });
	assert.equal(seam.hasEncounter, true);
	assert.equal(seam.jd, closest.jd);
	assert.ok(seam.deltaDays >= SEAM_MIN_DAYS && seam.deltaDays <= SEAM_MAX_DAYS,
		"got " + seam.deltaDays + " d");
	var expectedDt = seamDeltaDays(originSoiRadius("Mars"), closest.vInf);
	assert.ok(Math.abs(seam.deltaDays - (expectedDt == null ? SEAM_MIN_DAYS : expectedDt)) < 1e-9);
	assert.ok(Math.abs(seam.start - (closest.jd - seam.deltaDays)) < 1e-9);
	assert.ok(Math.abs(seam.end - (closest.jd + ARRIVAL_TAIL_DAYS)) < 1e-9);
	assert.equal(seam.vInf, closest.vInf);
	assert.equal(seam.rmin, closest.rmin);
});

test("computeArrivalSeam: Ceres' small SOI clamps to the 2-day floor at a realistic approach speed", () => {
	assert.ok(systems.get("Ceres"), "Ceres must be a known body");
	var rSoi = originSoiRadius("Ceres");
	// A representative belt-approach v∞ (a few km/s) crosses Ceres's own SOI
	// in well under two days at any realistic interplanetary speed.
	var seam = computeArrivalSeam({
		destination: "Ceres",
		events: [{ jd: 2463900, kind: "closest-approach", body: "Ceres", vInf: 3000, rmin: 5e5 }],
		fallbackArrivalJd: 0
	});
	assert.ok(rSoi / 3000 / DAY < SEAM_MIN_DAYS, "fixture sanity: Ceres crossing should be sub-floor");
	assert.equal(seam.deltaDays, SEAM_MIN_DAYS);
});

test("computeArrivalSeam: Jupiter's huge SOI clamps to the 5-day ceiling", () => {
	var rSoi = originSoiRadius("Jupiter");
	var seam = computeArrivalSeam({
		destination: "Jupiter",
		events: [{ jd: 2463900, kind: "closest-approach", body: "Jupiter", vInf: 6000, rmin: 1e8 }],
		fallbackArrivalJd: 0
	});
	assert.ok(rSoi / 6000 / DAY > SEAM_MAX_DAYS, "fixture sanity: Jupiter crossing should be over the ceiling");
	assert.equal(seam.deltaDays, SEAM_MAX_DAYS);
});
