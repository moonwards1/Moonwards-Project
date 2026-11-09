// Node test for trafficModel.js:  node --test Website/Calculators/Hanging-skyhooks/trafficModel.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { Traffic, YEAR } from "./trafficModel.js";

function near(a, b, rel, msg) { assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, msg + ": " + a + " vs " + b); }

// The default workbench skyhook at the Moon: foot 1,000 km, centre of mass 2,000 km.
var GM = 4.9048695e12, R = 1737.4e3;
var rF = R + 1000e3, rC = R + 2000e3, rT = R + 3000e3;
var w = Math.sqrt(GM / Math.pow(rC, 3));
var env = { GM: GM, omega: w, rMount: rT, period: 2 * Math.PI / w };
var KT_PER_ORBIT = 1e6 / env.period;   // 1 kt each orbit, kg/s

test("hauling 1 kt per orbit from the foot to the centre of mass", function () {
	var h = Traffic.haul(env, rF, rC, KT_PER_ORBIT);
	near(h.power * env.period / 1e9, 175.25, 1e-3, "energy per orbit, GJ");
	near(h.torque * env.period, 1.9847e15, 1e-3, "angular momentum per orbit, kg·m²/s");
	near(h.force * rT, h.torque, 1e-12, "thrust at the mount times its lever arm is the torque");
	assert.ok(h.power > 0 && h.torque > 0, "climbing toward the centre of mass costs energy and orbit");
});

test("signs follow the side of the centre of mass and the direction", function () {
	var up = Traffic.haul(env, rC, rT, 1), down = Traffic.haul(env, rT, rC, 1), lowDown = Traffic.haul(env, rC, rF, 1);
	assert.ok(up.power < 0 && up.torque > 0, "outward above the centre: energy gain, orbit loss");
	assert.ok(down.power > 0 && down.torque < 0, "inward above the centre: energy loss, orbit gain");
	assert.ok(lowDown.power < 0 && lowDown.torque < 0, "inward below the centre: energy gain, orbit gain");
	near(up.power, -down.power, 1e-12, "a round trip costs nothing");
});

test("flights: equal flights per ship chosen, every bulk flight full", function () {
	near(Traffic.flights(100, [50]), 2, 1e-12, "one ship");
	var n = Traffic.flights(140, [50, 20]);
	near(n, 4, 1e-12, "two ships, 2 flights each");
	near(n / 2 * 50 + n / 2 * 20, 140, 1e-12, "they carry the whole rate");
	assert.ok(isNaN(Traffic.flights(10, [])), "no ship chosen");
	near(Traffic.loadPerFlight(30, 4), 7.5, 1e-12, "return load");
});

test("ship moves leave out ships released where they docked", function () {
	var m = Traffic.shipMoves(2, 1000, [{ at: "top", share: 0.5 }, { at: "outer", share: 0.5 }], [{ at: "top", share: 1 }]);
	assert.equal(m.length, 1);
	assert.deepEqual(m[0], { from: "outer", to: "top", rate: 1000 });
});

test("split: the remainder takes what is left", function () {
	assert.deepEqual(Traffic.split(10, [3, 0], 1), { values: [3, 7], over: 0 });
	assert.deepEqual(Traffic.split(10, [4, 9, 0], 2), { values: [4, 9, 0], over: 3 });
});

test("balance: efficiencies only where given", function () {
	var hs = [{ power: 100, force: 2 }, { power: -40, force: -0.5 }];
	var b = Traffic.balance(hs, { period: 10, climberEff: 0.8, thrusterEff: 0.5, vExhaust: 8000 });
	near(b.power, 60, 1e-12, "net power");
	near(b.supplied, 100 / 0.8 - 40 * 0.8, 1e-12, "losses divided, gains multiplied");
	near(b.energyYear, 60 * YEAR, 1e-12, "per year");
	near(b.reboostPower, 0.5 * 1.5 * 8000 / 0.5, 1e-12, "reboost electrical power");
	near(b.propFlow, 1.5 / 8000, 1e-12, "reboost propellant");
	assert.equal(Traffic.balance(hs, { period: 10, climberEff: null }).supplied, null);
});
