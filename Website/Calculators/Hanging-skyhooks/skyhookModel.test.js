// Node tests for skyhookModel.js. Run from the repo root:
//   node --test Website/Calculators/Hanging-skyhooks/skyhookModel.test.js
//
// Pins a reference design (Moon; foot 10, centre 275, top 2000 km;
// decks 233 / 606.5 / 950 km; lunar silica ×3; loads 40 / 60 / 5000 / 300 / 200 kt (top tip, upper
// tether, anchor station, lower tether, foot tip); 1000 t/day
// in 100 t climbers at 200 m/s, 70 %; oxygen at 8 km/s, 60 % / 90 %; entry
// interface 122 km; the stations carry no mass), then checks what station
// masses do to it.

import test from "node:test";
import assert from "node:assert/strict";

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { computeSkyhook, sweepTether, stationKeeping, exhaustSpeed, nodalPrecession, massPoints } from "./skyhookModel.js";
import { anchorConfig } from "../../Shared/body-profiles.js";
import { Traffic, YEAR } from "./trafficModel.js";
import { MATERIALS } from "../../Shared/materials.js";

var moon = systems.get("Moon");
var m = MATERIALS.silica;
var R0 = Number(moon.radius);
function base() {
	return {
		foot: 10e3, centre: 275e3, top: 2000e3,
		receivingDeck: 233e3, outerDocks: 606.5e3, releaseDeck: 950e3,
		strength: (m.strength / 3) / m.density, loadTop: 40e6, distUpper: 60e6, comMass: 5000e6, distLower: 300e6, loadFoot: 200e6,
		ifaceAlt: 122
	};
}
var t = computeSkyhook(moon, base());

function close(actual, expected, label) {
	assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.abs(expected), label + ": " + actual + " vs " + expected);
}

function near(actual, expected, dp, label) {
	assert.equal(Number(actual.toFixed(dp)), expected, label + ": " + actual);
}

test("orbit and speeds", function () {
	near(t.time / 3600, 2.25, 2, "period h");
	near(t.footVel, 1355.68, 2, "foot speed");
	near(t.centreVel, 1561.31, 2, "centre speed");
	near(t.topVel, 2899.84, 2, "top speed");
});

test("dropped from the foot", function () {
	assert.ok(t.hitsSurface);
	near(t.hitTheGround, 1367.55, 2, "surface speed");
	near(t.impactFromVertical * 180 / Math.PI, 85.58, 2, "angle from vertical");
	near(t.collisionAngle * 180 / Math.PI, 4.42, 2, "angle to the ground");
});

test("the drop's speed at the surface is the foot's speed plus what the fall adds", function () {
	// Energy: v² / 2 − GM / R = vFoot² / 2 − GM / rFoot, so v² = vFoot² + 2·GM·(1/R − 1/rFoot).
	var R = Number(moon.radius), rF = R + t.foot;
	var v = Math.sqrt(t.footVel * t.footVel + 2 * moon.GM * (1 / R - 1 / rF));
	close(t.hitTheGround, v, "energy balance");
	assert.ok(t.hitTheGround > t.footVel, "faster than at the foot");
	// a higher foot falls further, and gains more
	var high = computeSkyhook(moon, Object.assign({}, base(), { foot: 150e3 }));
	assert.ok(high.hitTheGround - high.footVel > t.hitTheGround - t.footVel);
});

test("the impact velocity splits into the foot's sideways speed carried inward and a vertical remainder", function () {
	var R = Number(moon.radius);
	close(t.impactHorizontal, t.footVel * (R + t.foot) / R, "angular momentum");
	close(t.impactHorizontal * t.impactHorizontal + t.impactVertical * t.impactVertical, t.hitTheGround * t.hitTheGround, "components make the speed");
	// the impact angle from vertical is that of the sideways part
	close(Math.cos(t.impactFromVertical), t.impactVertical / t.hitTheGround, "angle from vertical");
	assert.ok(t.impactVertical < Math.sqrt(2 * moon.GM / (R * R) * t.foot), "slower than a drop from rest: the ground curves away");
});

test("the drop's time is the fall from apoapsis to the surface, about the ground track over the horizontal speed", function () {
	near(t.dropTime, 189.8, 1, "seconds from the foot to the surface");
	var R = Number(moon.radius), track = t.impactAround * R;
	assert.ok(Math.abs(t.dropTime - track / t.footVel) < 0.02 * t.dropTime, "close to distance over speed when the fall is shallow");
});

test("the arc drawn through the foot ends where the drop lands", function () {
	var R = Number(moon.radius), a = OrbitalMath.conicArc(moon.GM, R + t.foot, t.footVel, R, 7 * R, 60);
	assert.ok(Math.abs(a.halfAngle - t.impactAround) < 1e-9, a.halfAngle + " vs " + t.impactAround);
});

test("tether properties and climbers", function () {
	near(t.lowAcceleration, 0.55, 2, "foot accel");
	near(100 * t.lowAcceleration / t.surfaceGravity, 34.14, 2, "foot % g");
	near(t.highAcceleration, 1.9, 2, "top accel");
	near(100 * t.highAcceleration / t.surfaceGravity, 116.83, 2, "top % g");
	near(t.lowRatio, 1.04, 2, "lower taper");
	near(t.highRatio, 2.68, 2, "upper taper");
	near(t.lowIntegral, 69839, 0, "lower climb J/kg");
	near(t.highIntegral, 1860487, 0, "upper climb J/kg");
});

test("a tip load alone: tension and tether mass", function () {
	var R = Number(moon.radius), w = t.angularVelocity, s = (m.strength / 3) / m.density;
	var up = sweepTether(moon.GM, w, s, 2000e3 + R, 275e3 + R, 100e3, 0, 1000);
	var low = sweepTether(moon.GM, w, s, 10e3 + R, 275e3 + R, 100e3, 0, 1000);
	near(up.tension / 1e3, 509.77, 2, "tension at centre, 100 t at the top, kN");
	near(low.tension / 1e3, 57.59, 2, "tension at centre, 100 t at the foot, kN");
	near(up.mass / 1e3, 341.7, 1, "upper tether mass for 100 t at the top, t");
	near(low.mass / 1e3, 8.0, 1, "lower tether mass for 100 t at the foot, t");
});

test("loads, balance and the anchor station", function () {
	var R = Number(moon.radius), w = t.angularVelocity;
	assert.ok(t.balanced);
	near(t.loads.upperTotal / 1e6, 100, 2, "upper total kt");
	near(t.loads.lowerTotal / 1e6, 500, 2, "lower total kt, anchor station left out");
	// the cable is continuous through the centre of mass: the tension arriving from above
	// equals the tension arriving from below
	var gap = t.tensionLower - t.tensionUpper;
	assert.ok(Math.abs(gap) / t.tensionPeak < 1e-6, "tensions match at the centre of mass: " + gap);
	near(t.comOffset / 1e3, -13, 1, "station offset km (below the centre of mass)");
	// the station sits on the lower half and adds its net pull there, as a station does
	var rs = R + t.centre + t.comOffset;
	var pull = w * w * rs - moon.GM / (rs * rs);
	var anchor = t.stations.low.find(function (x) { return x.anchor; });
	assert.ok(anchor && !t.stations.up.some(function (x) { return x.anchor; }), "the anchor station is on the lower half only");
	assert.ok(Math.abs(anchor.pull - t.loads.com * Math.abs(pull)) < 1e-6 * anchor.pull, "it adds its mass times its net pull");
	assert.equal(t.tensionPeak, t.tensionUpper, "the peak tension is the tension at the centre of mass");
	// below the centre of mass the upper tether never sees the anchor station
	var lighter = computeSkyhook(moon, Object.assign({}, base(), { comMass: 500e6 }));
	assert.ok(Math.abs(lighter.tensionUpper - t.tensionUpper) < 1e-9 * t.tensionUpper, "upper tension does not depend on a lower anchor station's mass");
	assert.equal(lighter.tetherMassUpper, t.tetherMassUpper);
	assert.ok(t.tensionPeak > 1e8, "peak tension is now set by the real loads");
	assert.ok(Math.abs(t.tetherMass - (t.tetherMassUpper + t.tetherMassLower)) < 1, "tether mass is the two halves");
	close(t.massMultipleUpper, t.tetherMassUpper / 100e6, "upper multiple is tether mass over all its loads");
	close(t.massMultipleLower, t.tetherMassLower / 500e6, "lower multiple");
	close(t.massMultiple, t.tetherMass / 600e6, "whole-tether multiple leaves out the anchor station");
});

test("the anchor station splits its tether into two parts, each with its own ratio", function () {
	var p = t.tetherParts, seg = p.anchorSegment;
	assert.equal(p.anchorHalf, "low", "the default anchor station hangs below the centre of mass");
	assert.ok(seg && seg.mass > 0);
	// the parts add up to the whole tether
	assert.ok(Math.abs(p.up.mass + p.low.mass + seg.mass - t.tetherMass) < 1e-6 * t.tetherMass);
	// the stretch between the station and the centre of mass holds up the whole lower tether and the station
	close(seg.held, t.loads.lowerTotal + t.loads.com, "stretch holds up everything on its tether");
	close(seg.multiple, seg.mass / seg.held, "stretch ratio");
	// the outer part holds up what lies beyond the station: tip, the spread load's share, no station here
	assert.ok(p.low.held < t.loads.lowerTotal && p.low.held > t.loads.foot, "outer part holds less than the tether's loads");
	assert.equal(p.up.mass, t.tetherMassUpper, "the other tether is a single part");
	// no station mass, nothing to split
	var none = computeSkyhook(moon, Object.assign({}, base(), { comMass: 0 }));
	assert.equal(none.tetherParts.anchorSegment, null);
});

test("the tension profile for the drawing", function () {
	var P = t.profile;
	assert.equal(P.up.r.length, P.up.T.length);
	assert.ok(P.up.r.length > 100 && P.low.r.length > 100);
	assert.ok(Math.abs(P.up.T[0] - 40e6 * t.highAcceleration) < 1e-6 * P.up.T[0], "top tip tension is the tip load's weight");
	assert.equal(P.up.T[P.up.T.length - 1], t.tensionUpper, "the upper sweep ends at the centre of mass with the upper tension");
	assert.equal(P.low.T[P.low.T.length - 1], t.tensionLower, "...and the lower sweep with the lower tension");
	var rCentre = Number(moon.radius) + 275e3;
	for (var i = 1; i < P.up.T.length && P.up.r[i] >= rCentre; i++) assert.ok(P.up.T[i] >= P.up.T[i - 1], "tension never falls toward the centre until past it");
});

test("the station may sit anywhere the tether can carry it", function () {
	var weak = MATERIALS.earlylunarglass;
	var base = {
		foot: 10e3, centre: 275e3, top: 2000e3,
		receivingDeck: 233e3, outerDocks: 606.5e3, releaseDeck: 950e3,
		strength: (weak.strength / 3) / weak.density,
		loadTop: 40e6, distUpper: 60e6, comMass: 5000e6, distLower: 300e6, loadFoot: 200e6,
		ifaceAlt: 122
	};
	// too light an anchor: no position balances, and that is reported
	var u = computeSkyhook(moon, base);
	assert.equal(u.balanced, false);
	assert.equal(u.comOffset, 0);
	assert.ok(u.unbalance < 0, "the upper tether outweighs the lower");
	assert.ok(u.warnings.some(function (w) { return /Out of balance/.test(w); }));
	// a heavy enough anchor: it balances far below the centre, near the foot, with no limit on the offset
	var v = computeSkyhook(moon, Object.assign({}, base, { comMass: 20000e6 }));
	assert.ok(v.balanced);
	assert.ok(v.comOffset < -200e3, "station sits well below the centre: " + v.comOffset);
	assert.ok(Math.abs(v.unbalance) / v.tensionPeak < 1e-6);
	assert.ok(t.warnings.every(function (w) { return !/balance/.test(w); }), "the default design balances");
});

test("no load at all gives no tension", function () {
	var R = Number(moon.radius), s = (m.strength / 3) / m.density;
	var none = sweepTether(moon.GM, t.angularVelocity, s, 2000e3 + R, 275e3 + R, 0, 0, 500);
	assert.equal(none.tension, 0);
	assert.equal(none.mass, 0);
});

test("a heavier load along the tether raises tension and mass", function () {
	var R = Number(moon.radius), w = t.angularVelocity, s = (m.strength / 3) / m.density;
	var a = sweepTether(moon.GM, w, s, 2000e3 + R, 275e3 + R, 40e6, 0, 1000);
	var b = sweepTether(moon.GM, w, s, 2000e3 + R, 275e3 + R, 40e6, 60e6, 1000);
	assert.ok(b.tension > a.tension && b.mass > a.mass);
	// spread load carries less than the same mass at the tip: the tip is the worst case
	var c = sweepTether(moon.GM, w, s, 2000e3 + R, 275e3 + R, 100e6, 0, 1000);
	assert.ok(c.tension > b.tension);
});

// agreement to a relative tolerance
function rel(actual, expected, tol, label) {
	assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * tol, label + ": " + actual + " vs " + expected);
}

test("station-keeping follows the Traffic balance", function () {
	// 1 kt a year hauled from the foot to the top: the engines cancel the drag
	var kgs = 1e6 / YEAR, rF = R0 + t.foot, rT = R0 + t.top;
	var env = { GM: moon.GM, omega: t.angularVelocity, rMount: rT, period: t.time };
	var h = Traffic.haul(env, rF, rT, kgs);
	var ve = exhaustSpeed("oxygen", 8), ethr = 0.6, esup = 0.9;
	var b = Traffic.balance([h], { period: t.time, climberEff: null, thrusterEff: ethr, vExhaust: ve });
	var sk = stationKeeping(b, { omega: t.angularVelocity, rMount: rT, releasedFlow: kgs, vExhaust: ve, effThruster: ethr, effSupply: esup });
	rel(sk.thrust, h.torque / rT, 1e-12, "F = τ / r_mount");
	rel(sk.torque, h.torque, 1e-12, "τ = F · r_mount");
	rel(sk.jetPower, 0.5 * Math.abs(sk.thrust) * ve, 1e-12, "P_jet = ½ |F| vₑ");
	rel(sk.elecPower, sk.jetPower / ethr, 1e-12, "P_elec = P_jet / η_th");
	rel(sk.genPower, sk.elecPower / esup, 1e-12, "P_gen = P_elec / η_sup");
	rel(sk.propFlow, Math.abs(sk.thrust) / ve, 1e-12, "ṁ_prop = |F| / vₑ");
	rel(sk.orbitPower, Math.abs(sk.thrust) * t.angularVelocity * rT, 1e-12, "P_orbit = |F| ω r_mount");
	rel(sk.energyPerT, sk.genPower / kgs / 1e6, 1e-12, "GJ per tonne released");
	rel(sk.propPerCargo, sk.propFlow / kgs, 1e-12, "t of propellant per t released");
	// the reverse haul brakes the engines instead, at the same power
	var back = Traffic.balance([Traffic.haul(env, rT, rF, kgs)], { period: t.time, climberEff: null, thrusterEff: ethr, vExhaust: ve });
	var sb = stationKeeping(back, { omega: t.angularVelocity, rMount: rT, releasedFlow: kgs, vExhaust: ve, effThruster: ethr, effSupply: esup });
	rel(sb.thrust / sk.thrust, -1, 1e-9, "reversed: the engines brake");
	rel(sb.genPower / sk.genPower, 1, 1e-9, "braking costs the same power as boosting");
	// nothing released: no per-tonne figures
	var none = stationKeeping(b, { omega: t.angularVelocity, rMount: rT, releasedFlow: 0, vExhaust: ve, effThruster: ethr, effSupply: esup });
	assert.ok(isNaN(none.energyPerT) && isNaN(none.propPerCargo));
	assert.equal(exhaustSpeed("oxygen", 50), 20000, "oxygen is capped at 20 km/s");
});

test("entry at the parent planet: Earth, from the Moon", function () {
	var re = t.reentry;
	assert.equal(re.parent, "Earth");
	assert.ok(re.escapes && re.entry && re.atmosphere);
	near(re.vinf, 835, 0, "v∞");
	near(re.arrivalSpeed, 184, 0, "arrival");
	near(re.perigeeAlt / 1e3, -26, 0, "perigee km (below the surface: a direct hit)");
	near(re.entryAngle * 180 / Math.PI, 8.6, 1, "entry angle");
	near(re.entrySpeed / 1e3, 10.99, 2, "entry speed");
	near(re.peakG, 26, 0, "peak g");
	near(re.eccentricity, 1.38, 2, "departure eccentricity");
	near(re.turn * 180 / Math.PI, 46.4, 1, "turn: release this far before longitude 0");
});

test("release points include Earth", function () {
	var earth = t.targets.find(function (x) { return x.name === "Earth"; });
	assert.ok(earth && isFinite(earth.altitude));
});

test("stations: masses held at a point step the tension up", function () {
	var R = Number(moon.radius), w = t.angularVelocity;
	var masses = { receivingDeck: 50e6, outerDocks: 500e6, releaseDeck: 200e6 };
	var u = computeSkyhook(moon, Object.assign({}, base(), { stationMass: masses }));
	assert.ok(u.balanced);
	var pull = function (r) { return w * w * r - moon.GM / (r * r); };
	// every station appears once, on one half, adding m·|a| on the side it hangs from
	var all = u.stations.up.concat(u.stations.low).filter(function (x) { return !x.anchor; });
	assert.equal(all.length, 3);
	all.forEach(function (x) { assert.ok(Math.abs(Math.abs(x.pull) - x.m * Math.abs(pull(x.r))) < 1e-6 * Math.abs(x.pull), x.name); });
	near(u.loads.stationsUpper + u.loads.stationsLower, 750e6, 0, "station mass is all counted");
	// the receiving deck is below the centre of mass, so it hangs on the lower half and adds to it
	var recv = u.stations.low.find(function (x) { return x.name === "Receiving deck"; });
	assert.ok(recv && recv.pull > 0);
	assert.ok(u.stations.low.concat(u.stations.up).every(function (x) { return x.pull > 0; }), "every station adds to its half");
	["up", "low"].forEach(function (h) {
		var secs = u.sections[h], st = u.stations[h];
		assert.equal(secs.length, st.length + 1, h + ": one more section than stations");
		var sum = secs.reduce(function (a, x) { return a + x.mass; }, 0);
		assert.ok(Math.abs(sum - (h === "up" ? u.tetherMassUpper : u.tetherMassLower)) < 1, h + ": sections sum to the half");
		for (var i = 0; i < st.length; i++) {
			assert.equal(secs[i].to, st[i].name);
			assert.equal(secs[i + 1].from, st[i].name);
			assert.ok(Math.abs(secs[i].tTo + st[i].pull - secs[i + 1].tFrom) < 1e-6 * secs[i + 1].tFrom, h + ": the step is the station's pull");
		}
		assert.equal(secs[secs.length - 1].to, null);
	});
	// more held up means more tether, and the multiples count every load
	assert.ok(u.tetherMassUpper > t.tetherMassUpper);
	close(u.massMultipleUpper, u.tetherMassUpper / u.loads.upperTotal, "upper multiple");
	near(u.loads.upperTotal / 1e6, 100 + 700, 2, "upper total: its loads plus the two stations above the centre of mass, kt");
	// the drawn profile carries the step: two entries at the release deck's radius
	var rL = 950e3 + R, P = u.profile.up, at = [];
	P.r.forEach(function (r, i) { if (r === rL) at.push(P.T[i]); });
	assert.equal(at.length, 2);
	assert.ok(at[1] > at[0]);
});

test("stations: no mass, or stations not modelled, changes nothing", function () {
	var a = computeSkyhook(moon, Object.assign({}, base(), { stationMass: { receivingDeck: 0, outerDocks: 0, releaseDeck: 0 } }));
	assert.equal(a.tensionPeak, t.tensionPeak);
	var b = computeSkyhook(moon, Object.assign({}, base(), { receivingDeck: null, outerDocks: null, releaseDeck: null,
		stationMass: { receivingDeck: 50e6, outerDocks: 500e6, releaseDeck: 200e6 } }));
	assert.equal(b.tensionPeak, t.tensionPeak);
	assert.equal(b.sections.up.length, 1);
});

test("station figures: tension at each level, pull, and the outcome of a release", function () {
	var withMass = Object.assign({}, base(), { stationMass: { receivingDeck: 100e6, outerDocks: 200e6, releaseDeck: 10e6 } });
	var u = computeSkyhook(moon, withMass), F = u.stationFigures;
	assert.deepEqual(F.map(function (x) { return x.key; }), ["top", "releaseDeck", "outerDocks", "anchor", "receivingDeck", "foot"], "top down: the tips, the stations, the anchor station");
	// the tips carry the tip load's weight
	close(F[0].tension, 40e6 * u.highAcceleration, "top station tension");
	close(F[5].tension, 200e6 * u.lowAcceleration, "foot station tension");
	assert.equal(F[0].release.outcome, "escape");
	assert.ok(F[0].outward && !F[5].outward, "pulled outward at the top, inward at the foot");
	// the release deck's total tension is the tension just inboard of it: where the next stretch of tether starts
	var up = u.sections.up, i = up.findIndex(function (x) { return x.from === "Release deck"; });
	close(F[1].tension, up[i].tFrom, "release deck tension");
	close(F[1].tension, up[i - 1].tTo + F[1].pull, "arriving tension plus its own pull");
	close(F[1].acceleration, Math.abs(u.angularVelocity * u.angularVelocity * (950e3 + moon.radius) - moon.GM / Math.pow(950e3 + moon.radius, 2)), "net pull per kg");
	// a release at the release deck escapes; at the receiving deck, just below the centre of mass, it
	// is bound with its lowest point a few km above the surface; a lower deck would drop to the surface
	assert.equal(F[1].release.outcome, "escape");
	near(F[1].release.vInf, 835, 0, "v_inf at the release deck");
	assert.equal(F[4].release.outcome, "orbit");
	assert.equal(F[4].release.apsis, "periapsis");
	var low = computeSkyhook(moon, Object.assign({}, withMass, { receivingDeck: 100e3 })).stationFigures;
	assert.equal(low[4].release.outcome, "impact");
	assert.equal(F[3].release, null, "the anchor station releases nothing");
	assert.equal(F[5].release.outcome, "impact", "dropped from the foot");
	close(F[5].release.impactSpeed, u.hitTheGround, "the foot's impact speed is the drop from the foot");
	// a station with no mass has the tension its level would have with a vanishing mass
	var z = computeSkyhook(moon, Object.assign({}, base(), { stationMass: { receivingDeck: 0, outerDocks: 0, releaseDeck: 0 } })).stationFigures;
	var tiny = computeSkyhook(moon, Object.assign({}, base(), { stationMass: { receivingDeck: 1, outerDocks: 1, releaseDeck: 1 } })).stationFigures;
	z.forEach(function (x, k) { assert.ok(Math.abs(x.tension - tiny[k].tension) <= 1e-6 * tiny[k].tension, x.key + " tension without mass"); });
});

test("a tether anchored on Phobos needs no anchor station and nudges Phobos's orbit by metres", function () {
	var mars = systems.get("Mars"), phobos = systems.get("Phobos");
	var inp = Object.assign({}, base(), {
		foot: 300e3, centre: phobos.orbit.a - Number(mars.radius), top: 12000e3,
		receivingDeck: null, outerDocks: null, releaseDeck: null, anchorMass: phobos.mass
	});
	var p = computeSkyhook(mars, inp);
	assert.ok(p.balanced);
	assert.equal(p.loads.com, 0, "Phobos takes the anchor station's place");
	assert.ok(!p.warnings.some(function (w) { return /Out of balance/.test(w); }));
	assert.equal(p.tetherParts.anchorSegment, null);
	// Δ = −F / (3ω²M): the pull and the shift have opposite signs, and the shift is tiny
	var w = p.angularVelocity;
	close(p.anchor.shift, -p.unbalance / (3 * w * w * phobos.mass), "orbit shift");
	assert.ok(Math.abs(p.anchor.shift) < 1000, "under a km: " + p.anchor.shift);
	assert.equal(p.reentry.parent, null, "Mars orbits the Sun: no parent planet");
});

// ---- nodal precession -------------------------------------------------------------
// The Earth workbench design: foot 120, centre 2900, top 6200 km; best lunar silica ×3;
// loads 60 / 20 / 8000 / 50 / 20 kt; no optional stations.
function earthDesign() {
	var b = MATERIALS.bestsilica;
	return computeSkyhook(systems.get("Earth"), { foot: 120e3, centre: 2900e3, top: 6200e3, receivingDeck: null, outerDocks: null, releaseDeck: null,
		strength: (b.strength / 3) / b.density, loadTop: 60e6, distUpper: 20e6, comMass: 8000e6, distLower: 50e6, loadFoot: 20e6, ifaceAlt: 122 });
}

test("massPoints holds every kilogram: tether, spread loads, stations", function () {
	var e = earthDesign(), sum = massPoints(systems.get("Earth"), e).reduce(function (a, p) { return a + p.m; }, 0);
	var expect = e.tetherMass + 60e6 + 20e6 + 8000e6 + 50e6 + 20e6;
	assert.ok(Math.abs(sum - expect) / expect < 1e-9, sum + " vs " + expect);
});

test("nodal precession: Earth design tilted to the ecliptic turns its plane in about 146 days", function () {
	var np = nodalPrecession(systems.get("Earth"), earthDesign(), { inclination: 23.4392811 * Math.PI / 180 });
	near(np.period / 86400, 145.8, 1, "period, days");
	assert.ok(np.rate < 0, "prograde tilt regresses westward");
	assert.equal(np.perturbers[0].name, "the Moon");
	assert.ok(np.perturbers[0].ratio < 1e-3);
});

test("nodal precession: the Earth design's sun-synchronous tilt is retrograde, with a one-year period", function () {
	var np = nodalPrecession(systems.get("Earth"), earthDesign(), { sunSync: true });
	near(np.inclination * 180 / Math.PI, 111.5, 1, "tilt, degrees");
	assert.ok(Math.abs(np.period - np.year) < 1);
	assert.ok(np.sunSyncReach);
});

test("nodal precession: the Moon's bulge cannot make the default lunar skyhook sun-synchronous", function () {
	var np = nodalPrecession(moon, t, { sunSync: true });
	assert.equal(np.sunSyncReach, false);
	assert.ok(isNaN(np.inclination) && isNaN(np.period));
	assert.equal(np.perturbers[0].name, "Earth");
});

test("nodal precession: a Phobos-anchored skyhook turns with Phobos, about 2.26 years", function () {
	var a = anchorConfig("Phobos"), mars = systems.get("Mars");
	var tp = computeSkyhook(mars, Object.assign(base(), { foot: 300e3, centre: a.centre * 1e3, top: 12000e3, receivingDeck: null, outerDocks: null, releaseDeck: null, anchorMass: a.mass }));
	var np = nodalPrecession(mars, tp, { inclination: a.inclination * Math.PI / 180, exclude: "Phobos" });
	near(np.period / 86400 / 365.25, 2.26, 2, "period, years");
});

test("nodal precession: no measured gravity field, no figure", function () {
	assert.equal(nodalPrecession(systems.get("Psyche"), t, { inclination: 0.1 }), null);
});
