// Node test that the page's default design holds together: each facility
// valid with the others in place, the hanging skyhook on its 3:1 resonance.
// Run from the repo root:
//   node --test Website/Calculators/Mars-System-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { allFigures, FACILITIES } from "../facilities.js";
import { ELEVATOR_DEFAULTS } from "../elevator.js";
import { HANGING_DEFAULTS, resonantComAlt } from "../hanging-skyhook.js";

var DEG = Math.PI / 180;

test("the default design: a heavy-traffic elevator, the Phobos skyhook under its cap, the hanging skyhook on 3:1", function () {
	var d = ELEVATOR_DEFAULTS, h = HANGING_DEFAULTS;
	assert.deepEqual([d.material, d.safety, d.rCW, d.cwMass, d.cargoFlow], ["ecnt", 2.4, 55000e3, 700e6, 150]);
	assert.deepEqual([h.topAlt, h.upperBallastMass, h.upperBallastHome], [5000e3, 200e6, 4000e3]);
	assert.equal(FACILITIES.phobosSkyhook.defaults.topAlt, 6800e3);

	var base = { spaceElevator: d, phobosSkyhook: FACILITIES.phobosSkyhook.defaults }, f = allFigures(base);
	var e = f.spaceElevator;
	assert.ok(e.ok, e.ok ? "" : e.diagnostic.message);
	assert.ok(e.lean.most > 2 * d.cargoFlow, "carries well over 150 kg/s: " + e.lean.most);
	assert.ok(e.lean.elevation > e.lean.floor, "loaded, it still leaves the anchor above the sized 10°");
	assert.ok(e.phobosClear > 100e3 && e.phobosTopCap > 6800e3);
	assert.ok(f.phobosSkyhook.ok, f.phobosSkyhook.ok ? "" : f.phobosSkyhook.diagnostic.message);

	var com = resonantComAlt(h, f.phobosSkyhook, 3, { elevator: e });
	assert.ok(com > 1000e3 && com < 1250e3, "3:1 centre of mass: " + com);
	var g = allFigures(Object.assign({}, base, { hangingSkyhook: Object.assign({}, h, { comAlt: com }) })).hangingSkyhook;
	assert.ok(g.ok, g.ok ? "" : g.diagnostic.message);
	assert.ok(Math.abs(g.ratio - 3) < 1e-5, "orbits per turn of Phobos: " + g.ratio);
	assert.ok(g.share && g.shareElevator, "it shares heights with both other tethers");
	assert.ok(Math.abs(Math.abs(g.comAlt - h.comAlt)) < 30e3, "the default centre of mass is near the resonance");
	assert.ok(g.tilt > 90 * DEG && g.tilt < 100 * DEG, "sun-synchronous");
});
