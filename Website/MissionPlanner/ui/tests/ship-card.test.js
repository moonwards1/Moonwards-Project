/* Node tests for ui/ship-card.js's pure halves — the DOM/three.js widget
 * itself is browser-only and not exercised here. */
import test from "node:test";
import assert from "node:assert/strict";

import { vInfComponents, gizmoScale, speedModel, speedAlong, peakSpeed, speedRange,
	bearingPoint, altitudeRadius, bPlaneLayout, BPLANE_SCALE, approachRows, spinLayout } from "../ship-card.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";

var O = OrbitalMath;

// A state with velocity along +X and position along +Y, so the burn frame's
// axes are unambiguous: prograde +X, normal +Z (ecliptic up), radial = n x p.
var R = [0, 1.5e11, 0];
var V = [3e4, 0, 0];

test("vInfComponents splits a vector onto the burn frame, in km/s", function () {
	var f = O.burnFrame(R, V);
	// 2 km/s prograde + 1 km/s normal, built from the frame's own axes.
	var vec = O.vAdd(O.vScale(f.pro, 2000), O.vScale(f.nrm, 1000));
	var c = vInfComponents(R, V, vec);
	assert.ok(Math.abs(c.pro - 2) < 1e-9);
	assert.ok(Math.abs(c.nrm - 1) < 1e-9);
	assert.ok(Math.abs(c.rad) < 1e-9);
	assert.ok(Math.abs(c.net - Math.hypot(2, 1)) < 1e-9);
});

test("vInfComponents keeps the sign of a retrograde component", function () {
	var f = O.burnFrame(R, V);
	var c = vInfComponents(R, V, O.vScale(f.pro, -1500));
	assert.ok(c.pro < 0);
	assert.ok(Math.abs(c.pro + 1.5) < 1e-9);
	assert.ok(Math.abs(c.net - 1.5) < 1e-9, "net is a magnitude, always positive");
});

test("vInfComponents returns null on missing inputs", function () {
	assert.equal(vInfComponents(null, V, [1, 0, 0]), null);
	assert.equal(vInfComponents(R, V, null), null);
});

test("gizmoScale takes the largest magnitude across both layers", function () {
	var needed = { pro: -5.46, rad: 2.43, nrm: -1.73, net: 6.24 };
	var current = { pro: 4.48, rad: 3.13, nrm: -0.91, net: 5.54 };
	assert.equal(gizmoScale(needed, current), 6.24);
	assert.equal(gizmoScale(null, current), 5.54);
	assert.equal(gizmoScale(needed, null), 6.24);
});

test("gizmoScale never returns zero, so no line divides by it", function () {
	assert.equal(gizmoScale(null, null), 1);
	assert.equal(gizmoScale({ pro: 0, rad: 0, nrm: 0, net: 0 }, null), 1);
});

test("speedModel pins the bar's right edge at the peak", function () {
	var m = speedModel(4, 3, 8);
	assert.equal(m.currentFrac, 0.5);
	assert.equal(m.neededFrac, 0.375);
	assert.equal(m.peak, 8);
});

test("speedModel clamps a speed that exceeds the peak", function () {
	// A needed hand-off speed above anything the flight reaches still has to
	// land somewhere on the track rather than off the end of it.
	var m = speedModel(9, 12, 8);
	assert.equal(m.currentFrac, 1);
	assert.equal(m.neededFrac, 1);
});

test("speedModel degrades to a zero fill with no usable peak", function () {
	var m = speedModel(4, 3, 0);
	assert.equal(m.peak, null);
	assert.equal(m.currentFrac, 0);
	assert.equal(m.neededFrac, null);
});

var SAMPLES = [
	{ v: [1000, 0, 0], t: 0 },
	{ v: [3000, 0, 0], t: 100 },
	{ v: [2000, 0, 0], t: 200 }
];

test("speedAlong interpolates between the bracketing samples", function () {
	assert.equal(speedAlong(SAMPLES, 0), 1000);
	assert.equal(speedAlong(SAMPLES, 50), 2000);
	assert.equal(speedAlong(SAMPLES, 100), 3000);
	assert.equal(speedAlong(SAMPLES, 150), 2500);
});

test("speedAlong clamps outside the sampled span", function () {
	assert.equal(speedAlong(SAMPLES, -10), 1000);
	assert.equal(speedAlong(SAMPLES, 9999), 2000);
	assert.equal(speedAlong([], 5), null);
	assert.equal(speedAlong(null, 5), null);
});

test("peakSpeed is the fastest anywhere on the flight, not the last point", function () {
	assert.equal(peakSpeed(SAMPLES), 3000);
	assert.equal(peakSpeed([]), null);
	assert.equal(peakSpeed(null), null);
});

// ---- the Coast card's pure model -------------------------------------------

test("speedModel: a floor spans the bar min..max instead of 0..max", () => {
	var m = speedModel(25, NaN, 30, 20);
	assert.equal(m.floor, 20);
	assert.ok(Math.abs(m.currentFrac - 0.5) < 1e-12, "got " + m.currentFrac);
	assert.equal(speedModel(20, NaN, 30, 20).currentFrac, 0);
	assert.equal(speedModel(30, NaN, 30, 20).currentFrac, 1);
});

test("speedModel: omitting the floor keeps the zero-based bar", () => {
	var m = speedModel(15, NaN, 30);
	assert.equal(m.floor, null);
	assert.ok(Math.abs(m.currentFrac - 0.5) < 1e-12);
});

test("speedModel: a floor at or above the peak is ignored, not divided by", () => {
	[speedModel(25, NaN, 30, 30), speedModel(25, NaN, 30, 45)].forEach(function (m) {
		assert.equal(m.floor, null);
		assert.ok(isFinite(m.currentFrac));
	});
});

test("speedRange: min and max across the sampled flight", () => {
	var s = [{ v: [3000, 0, 0] }, { v: [5000, 0, 0] }, { v: [4000, 0, 0] }];
	assert.deepEqual(speedRange(s), { min: 3000, max: 5000 });
	assert.equal(peakSpeed(s), 5000);
	assert.equal(speedRange([]), null);
	// Position-only samples (a polyline that carries no velocity) yield nothing
	// rather than a bar pinned at zero.
	assert.equal(speedRange([{ r: [1, 2, 3] }]), null);
});

test("speedRange: a time bound excludes the flight past the seam", () => {
	// A cruise around 2-3 km/s, then a periapsis spike the Coast card's chevron
	// can never reach — the bar must not scale to the spike.
	var s = [{ t: 0, v: [3000, 0, 0] }, { t: 100, v: [2000, 0, 0] },
	         { t: 200, v: [2500, 0, 0] }, { t: 300, v: [40000, 0, 0] }];
	assert.deepEqual(speedRange(s), { min: 2000, max: 40000 });
	assert.deepEqual(speedRange(s, { tMax: 200 }), { min: 2000, max: 3000 });
	// The bound itself counts, interpolated, so the range never stops short of
	// the fastest point still in view.
	assert.deepEqual(speedRange(s, { tMax: 250 }), { min: 2000, max: 21250 });
	// No bound given, or an unusable one, is the plain whole-flight scan.
	assert.deepEqual(speedRange(s, { tMax: NaN }), { min: 2000, max: 40000 });
});

test("speedRange: a skip window leaves an en-route close pass out", () => {
	// Cruise 2-3 km/s with a flyby spike at t=200 that IS inside the scrubbable
	// span — excluded by window, not by the bound.
	var s = [{ t: 0, v: [3000, 0, 0] }, { t: 100, v: [2000, 0, 0] },
	         { t: 200, v: [40000, 0, 0] }, { t: 300, v: [2500, 0, 0] }];
	assert.deepEqual(speedRange(s), { min: 2000, max: 40000 });
	assert.deepEqual(speedRange(s, { skip: [{ t0: 150, t1: 250 }] }),
		{ min: 2000, max: 3000 });
	// An empty or absent list is the plain scan, not an excluded everything.
	assert.deepEqual(speedRange(s, { skip: [] }), { min: 2000, max: 40000 });
	// A bound landing inside a skipped window doesn't smuggle the excursion back
	// in as the interpolated edge.
	assert.deepEqual(speedRange(s, { tMax: 200, skip: [{ t0: 150, t1: 250 }] }),
		{ min: 2000, max: 3000 });
});

test("speedModel: an excursion above the bar reports max and over", () => {
	// Bar spans the cruise 2..3; the flight's true peak is 40.
	var m = speedModel(2.5, NaN, 3, 2, 40);
	assert.equal(m.peak, 3);
	assert.equal(m.max, 40);
	assert.equal(m.over, false);
	// Scrubbed into the pass: the fill pins full and the card is told why.
	var inPass = speedModel(40, NaN, 3, 2, 40);
	assert.equal(inPass.over, true);
	assert.equal(inPass.currentFrac, 1);
	// Nothing excluded — max matches the bar's top, so the card shows one figure.
	var plain = speedModel(2.5, NaN, 3, 2, 3);
	assert.equal(plain.max, null);
	assert.equal(plain.over, false);
	// A caller that passes no max at all is unaffected.
	assert.equal(speedModel(2.5, NaN, 3, 2).max, null);
});

test("bearingPoint: 0 degrees is straight up, 90 is to the right", () => {
	var up = bearingPoint(0, 10);
	assert.ok(Math.abs(up.x) < 1e-9 && Math.abs(up.y + 10) < 1e-9, JSON.stringify(up));
	var right = bearingPoint(90, 10);
	assert.ok(Math.abs(right.x - 10) < 1e-9 && Math.abs(right.y) < 1e-9, JSON.stringify(right));
	var down = bearingPoint(180, 10);
	assert.ok(Math.abs(down.y - 10) < 1e-9, JSON.stringify(down));
});


test("gizmoScale: a net-only layer scales on its net, not on NaN components", () => {
	// The Coast card's layers carry only `net`; the absent components must be
	// skipped rather than poisoning the maximum.
	assert.equal(gizmoScale({ net: 24 }, { net: 26 }), 26);
	assert.equal(gizmoScale({ net: 24 }, null), 24);
});

test("altitudeRadius: surface at the disc edge, each 10,000 km one ring out", () => {
	assert.equal(altitudeRadius(0), BPLANE_SCALE.bodyR);
	assert.equal(altitudeRadius(10000), 30);
	assert.equal(altitudeRadius(20000), 42);
	// An impact falls inside the disc, floored at the centre.
	assert.ok(altitudeRadius(-5000) < BPLANE_SCALE.bodyR);
	assert.equal(altitudeRadius(-1e9), 0);
});

test("bPlaneLayout: rings stop inside the square; the dot sits on its bearing", () => {
	var lay = bPlaneLayout(90, 10000, 72);
	assert.deepEqual(lay.rings, [30, 42, 54, 66]);
	assert.equal(lay.arrow, null);
	assert.ok(Math.abs(lay.ship.x - 30) < 1e-9 && Math.abs(lay.ship.y) < 1e-9, JSON.stringify(lay.ship));
	assert.equal(lay.ship.r, BPLANE_SCALE.shipR);
});

test("bPlaneLayout: a pass beyond the square becomes an outward edge arrow", () => {
	var lay = bPlaneLayout(0, 1e6, 72);
	assert.equal(lay.ship, null);
	var tip = lay.arrow[0], b1 = lay.arrow[1], b2 = lay.arrow[2];
	// Straight up: tip nearest the top edge, base below it, symmetric about x = 0.
	assert.ok(tip.y < b1.y && tip.y < b2.y);
	assert.ok(Math.abs(tip.y + 70) < 1e-9);
	assert.ok(Math.abs(b1.x + b2.x) < 1e-9 && Math.abs(b1.x) > 1);
});

test("approachRows: a pass states its altitude and the speed there", () => {
	var rows = approachRows({ altitudeKm: 14416.4, speedKms: 7.523, impacts: false });
	assert.deepEqual(rows.map(r => [r.label, r.value, r.warn]), [
		["Closest approach", "14,416 km", false],
		["Speed there", "7.52 km/s", false]]);
	assert.equal(approachRows({ altitudeKm: 2.5e6, speedKms: 1 })[0].value, "2.50 M km");
	assert.deepEqual(approachRows(null), []);
});

test("approachRows: an impact says so, with the speed at impact", () => {
	var rows = approachRows({ altitudeKm: 100, speedKms: 7.1, impacts: true });
	assert.equal(rows[0].value, "Impact");
	assert.equal(rows[0].warn, true);
	assert.equal(rows[1].label, "Speed at impact");
	assert.equal(rows[1].value, "7.10 km/s");
});

test("spinLayout: equator edge-on, prograde half on the side a prograde pass takes", () => {
	// Coming in along +X with the pole at ecliptic north: north is up, east
	// is -Y. The Earth-like spin carries the east limb away along +X.
	var bp = O.bPlane(3.986e14, [-1e9, -1e7, 0], [5000, 0, 0]);
	var lay = spinLayout([0, 0, 1], bp, 18);
	assert.ok(Math.abs(lay.light.x - 1) < 1e-6 && Math.abs(lay.light.y) < 1e-6, JSON.stringify(lay.light));
	lay.equator.forEach(q => assert.ok(Math.abs(q.y) < 1e-6));
	// This pass's B is on the -Y (east) side and its angular momentum is +Z,
	// along the pole: prograde, so the ship's bearing is into the light half.
	var shipDir = bearingPoint(bp.angleDeg, 1);
	assert.ok(shipDir.x * lay.light.x + shipDir.y * lay.light.y > 0.99);
});

test("spinLayout: a retrograde pole puts the light half on the other side", () => {
	var bp = O.bPlane(3.986e14, [-1e9, -1e7, 0], [5000, 0, 0]);
	var lay = spinLayout([0, 0, -1], bp, 18);
	assert.ok(Math.abs(lay.light.x + 1) < 1e-6);
});

test("spinLayout: seen from above the pole, the equator is the near-limb half circle and there is no split", () => {
	// Coming straight down onto the north pole.
	var bp = O.bPlane(3.986e14, [1e7, 0, 1e9], [0, 0, -5000]);
	var lay = spinLayout([0, 0, 1], bp, 18);
	assert.equal(lay.light, null);
	lay.equator.forEach(q => assert.ok(Math.abs(Math.hypot(q.x, q.y) - 18) < 1e-6));
});

test("spinLayout: a tilted pole tilts the equator; its ends are on the disc edge, across the split", () => {
	var s = Math.SQRT1_2;
	var bp = O.bPlane(3.986e14, [-1e9, -1e7, 0], [5000, 0, 0]);
	var lay = spinLayout([s, 0, s], bp, 18);   // pole leaning toward the ship's travel
	var a = lay.equator[0], b = lay.equator[lay.equator.length - 1];
	assert.ok(Math.abs(Math.hypot(a.x, a.y) - 18) < 1e-6 && Math.abs(Math.hypot(b.x, b.y) - 18) < 1e-6);
	// Pole leaning away from the viewer: we see the southern hemisphere's
	// side, so the near half of the equator bows upward (toward north).
	var mid = lay.equator[16];
	assert.ok(mid.y < -1, JSON.stringify(mid));
});
