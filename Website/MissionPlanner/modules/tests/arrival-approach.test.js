// Node tests for the shared arrival-approach helpers (modules/arrival-approach.js):
// approachAt (the coast's delivered v∞ / miss distance at the destination) and
// interceptWarning (the non-blocking "not arriving yet" warning). Relocated here
// 2026-07-20 from the retired capture-burn module. Run from the repo root:
//   node --test Website/MissionPlanner/modules/tests/arrival-approach.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { approachAt, interceptWarning } from "../arrival-approach.js";
import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";
import { MISS_WARN_AU } from "../transfer-leg/transfer-leg.js";

var AU = 149597870700;   // m
var JD = O.julianDate(2034, 1, 8, 0, 0, 0);

// A helio ship-state arriving AT `body` with `vInf` m/s along +x, offset `missM`
// metres from the body.
function arrivingAt(body, vInf, missM) {
	var bs = Frames.bodyHelioState(body, JD);
	var r = bs.r.slice();
	if (missM) { r[0] += missM; }
	return { r: r, v: O.vAdd(bs.v, [vInf, 0, 0]), jd: JD, frame: "helio", dvUsed: 0 };
}

test("approachAt: v∞ and miss distance measured against the body's own state", function () {
	var app = approachAt("Ceres", arrivingAt("Ceres", 3776, 0.05 * AU));
	assert.equal(app.body, "Ceres");
	assert.ok(Math.abs(app.vInf - 3776) < 1e-6, "v∞ round-trips, got " + app.vInf);
	assert.ok(Math.abs(app.missAU - 0.05) < 1e-6, "miss distance in AU");
	// a dead-on arrival has ~zero miss
	assert.ok(approachAt("Ceres", arrivingAt("Ceres", 3776, 0)).missAU < 1e-9);
	// unknown body → null
	assert.equal(approachAt("Xyzzy", arrivingAt("Ceres", 3776, 0)), null);
});

test("interceptWarning: fires only outside the encounter threshold", function () {
	var miss = approachAt("Ceres", arrivingAt("Ceres", 3776, (MISS_WARN_AU + 0.01) * AU));
	var w = interceptWarning(miss);
	assert.ok(w !== null);
	assert.equal(w.code, "intercept-miss");
	// inside the threshold → no warning
	assert.equal(interceptWarning(approachAt("Ceres", arrivingAt("Ceres", 3776, 0))), null);
});
