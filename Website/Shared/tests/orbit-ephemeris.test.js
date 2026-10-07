// Node test: Sun-orbiting bodies in Shared/orbit.js stay on JPL Horizons.
// Run from the repo root:
//   node --test Website/Shared/tests/orbit-ephemeris.test.js
//
// CHECKPOINTS are Horizons heliocentric ecliptic-J2000 positions (km) at the
// start, middle and end of the fitted window (2030-01-01, 2080-01-01,
// 2130-01-01). Earth is the Earth-Moon barycentre; Jupiter..Pluto are system
// barycentres (Shared/tools/fit-mean-elements.mjs). Each body's tolerance is
// its fitted worst-case error over the window, as a percentage of its
// distance from the Sun, with 30% headroom. Re-fitting the elements should
// tighten these, not loosen them; a body failing here has had its orbit data
// edited away from the fit.

import test from "node:test";
import assert from "node:assert/strict";

import { systems } from "../orbit.js";
import { OrbitalMath as O } from "../math-utils.js";

var GM_SUN = systems.get("Sun").GM;

var CHECKPOINTS = {
	Mercury: { tolPct: 0.101, pts: [
		[2462502.5, -10215892, 45403462, 4647645],
		[2480764.5, 25539742, -61126897, -7338613],
		[2499026.5, -58749861, -6382599, 4850205]
	] },
	Venus: { tolPct: 0.025, pts: [
		[2462502.5, -12841486, 106814951, 2209454],
		[2480764.5, -103483749, -30006819, 5549738],
		[2499026.5, 43784916, -99636721, -3920021]
	] },
	Earth: { tolPct: 0.043, pts: [
		[2462502.5, -26010824, 144786297, -9718],
		[2480764.5, -23881223, 145150794, -25746],
		[2499026.5, -21747287, 145504071, -42333]
	] },
	Mars: { tolPct: 0.136, pts: [
		[2462502.5, 191279142, -77980589, -6323761],
		[2480764.5, -246375489, -10472786, 5793140],
		[2499026.5, 148934377, 160707452, -244979]
	] },
	Ceres: { tolPct: 1.568, pts: [
		[2462502.5, 422723437, -115818030, -81522023],
		[2480764.5, 222424588, -375613020, -53720713],
		[2499026.5, -110337939, -401713686, 5394848]
	] },
	Vesta: { tolPct: 0.938, pts: [
		[2462502.5, 325058249, -118590143, -36071792],
		[2480764.5, -118646389, -298084444, 23020399],
		[2499026.5, -327150361, 130803023, 36350421]
	] },
	Psyche: { tolPct: 2.377, pts: [
		[2462502.5, 376210812, -72403994, -6811847],
		[2480764.5, 380613392, -43342010, -8592238],
		[2499026.5, 379181356, -30840842, -9367495]
	] },
	Jupiter: { tolPct: 0.250, pts: [
		[2462502.5, -601076044, -544362784, 15710969],
		[2480764.5, 345502407, -686299249, -4840162],
		[2499026.5, 695941116, 251977793, -16593018]
	] },
	Saturn: { tolPct: 0.392, pts: [
		[2462502.5, 823421768, 1087255771, -51703867],
		[2480764.5, 847008550, -1229822421, -12529364],
		[2499026.5, -1313547630, -620102974, 63180124]
	] },
	Uranus: { tolPct: 0.123, pts: [
		[2462502.5, 677503412, 2794319638, 1592741],
		[2480764.5, 1492414675, -2549183468, -28756264],
		[2499026.5, -2335063529, 1440908132, 35538191]
	] },
	Neptune: { tolPct: 0.073, pts: [
		[2462502.5, 4399119171, 763187016, -117107462],
		[2480764.5, -2284635859, 3862928823, -26914713],
		[2499026.5, -2989038589, -3411257466, 139154724]
	] },
	Pluto: { tolPct: 0.058, pts: [
		[2462502.5, 3449493437, -4186112703, -549892872],
		[2480764.5, 6575571737, 1433502681, -2055354737],
		[2499026.5, 3542327005, 6155640954, -1683181583]
	] },
	Eris: { tolPct: 0.017, pts: [
		[2462502.5, 12639697881, 6088055618, -2412118854],
		[2480764.5, 10502014880, 7959146096, 263182439],
		[2499026.5, 6849147766, 8655401632, 2877983471]
	] }
};

Object.keys(CHECKPOINTS).forEach(function (name) {
	test(name + ": within " + CHECKPOINTS[name].tolPct + "% of Horizons at the window's start, middle and end", function () {
		var orbit = systems.get(name).orbit;
		CHECKPOINTS[name].pts.forEach(function (p) {
			var r = O.bodyStateAtJD(GM_SUN, orbit, p[0]).r;
			var dx = r[0] / 1e3 - p[1], dy = r[1] / 1e3 - p[2], dz = r[2] / 1e3 - p[3];
			var errKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
			var pct = 100 * errKm / Math.sqrt(p[1] * p[1] + p[2] * p[2] + p[3] * p[3]);
			assert.ok(pct < CHECKPOINTS[name].tolPct,
				name + " jd " + p[0] + ": " + Math.round(errKm) + " km = " + pct.toFixed(4) + "%");
		});
	});
});

test("every Sun-orbiting body carries the fitted epoch, and mean motion follows semiMajor", function () {
	Object.keys(CHECKPOINTS).forEach(function (name) {
		var orbit = systems.get(name).orbit;
		assert.equal(orbit.epoch, 2480764.5, name + " epoch");
		var P = 2 * Math.PI * Math.sqrt(Math.pow(orbit.a, 3) / GM_SUN);
		assert.ok(Math.abs(orbit.period.valueOf() / P - 1) < 1e-12, name + " period is derived from semiMajor");
	});
});
