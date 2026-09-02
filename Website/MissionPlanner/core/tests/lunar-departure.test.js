// node --test MissionPlanner/core/tests/lunar-departure.test.js
//
// The forward lunar departure: a release at the Moon's SOI edge, integrated
// out to Earth's SOI. The properties worth pinning are that the flight is
// real (energy adds up across the crossing), that the LAUNCH DATE moves the
// resulting heliocentric arc — the whole reason the calculation runs this
// direction — and that a release which cannot escape says so instead of
// returning a flight.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { systems } from "../../../Shared/orbit.js";
import { Frames } from "../../../Shared/frames.js";
import { SOI_EARTH, SOI_MOON, moonGeoPos, moonGeoVel } from "../../../Shared/geo-leg.js";
import { flyLunarDeparture, releaseVelocity, releaseSpeedFor, RELEASE_ALTITUDE }
	from "../lunar-departure.js";

var O = OrbitalMath;
var GM_EARTH = systems.get("Earth").GM;
var GM_MOON = systems.get("Moon").GM;
var GM_SUN = systems.get("Sun").GM;
var R_MOON = Number(systems.get("Moon").radius);
var AU = 1.495978707e11;
var JD = 2464329.5;                       // 2035-01-01
var LUNAR_MONTH = 29.53;

// A release that comfortably escapes: 3 km/s straight out from the Moon.
var OUTWARD = { pro: 0, rad: 3000, nrm: 0 };

test("the release starts at the Moon's SOI edge, carrying the Moon's motion", function () {
	var f = flyLunarDeparture({ jd: JD, burn: OUTWARD });
	assert.equal(f.ok, true, f.reason);

	// One Moon-SOI radius from the Moon, along the way it was thrown.
	var fromMoon = O.vSub(f.r0, moonGeoPos(JD));
	assert.ok(Math.abs(O.vMag(fromMoon) - SOI_MOON) < 1, "release is on the Moon's SOI sphere");
	var cos = O.vDot(O.vUnit(fromMoon), O.vUnit(f.u));
	assert.ok(cos > 1 - 1e-9, "release point lies along the impulse direction");

	// The velocity is the Moon's plus the card's impulse, and `u` is that
	// impulse — so deleting the Moon's motion would change the flight.
	assert.deepEqual(f.v0.map(round3), O.vAdd(moonGeoVel(JD), f.u).map(round3));
	assert.ok(Math.abs(f.uMag - 3000) < 1, "|u| is the impulse magnitude, " + f.uMag);
	assert.ok(O.vMag(moonGeoVel(JD)) > 900, "the Moon really is moving ~1 km/s");
});

test("the flight reaches Earth's SOI with the energy it left with", function () {
	var f = flyLunarDeparture({ jd: JD, burn: OUTWARD });
	assert.equal(f.ok, true, f.reason);

	assert.ok(Math.abs(O.vMag(f.exit.r) - SOI_EARTH) < 2e3, "exit is on Earth's SOI sphere");
	assert.ok(f.flightDays > 0.2 && f.flightDays < 30, "plausible flight time: " + f.flightDays);
	assert.ok(Math.abs(f.exit.jd - (JD + f.flightDays)) < 1e-6, "exit epoch follows the release");

	// Geocentric specific energy at release vs at the crossing. They differ
	// only by the Moon's own well (still gripping at its SOI edge) and the
	// Sun's third-body pull over the flight — small against the total.
	function energy(r, v) { return O.vDot(v, v) / 2 - GM_EARTH / O.vMag(r); }
	var e0 = energy(f.r0, f.v0), e1 = energy(f.exit.r, f.exit.v);
	var moonWell = GM_MOON / SOI_MOON;
	assert.ok(Math.abs(e1 - e0) < 3 * moonWell,
		"energy is conserved to within the Moon's residual well: " + (e1 - e0));
	assert.ok(e1 > 0, "the flight is escaping Earth");
});

test("the launch date moves the resulting heliocentric arc", function () {
	// The point of flying this forward: an UNCHANGED release, launched on
	// different days of the lunar month, produces materially different
	// trajectories, because the Moon's ~1 km/s points a different way and
	// that lands in the heliocentric velocity at Earth's SOI.
	var apo = [], helioSpeed = [];
	for (var k = 0; k < 8; k++) {
		var f = flyLunarDeparture({ jd: JD + k * LUNAR_MONTH / 8, burn: OUTWARD });
		assert.equal(f.ok, true, "day " + k + ": " + f.reason);
		var eh = Frames.bodyHelioState("Earth", f.exit.jd);
		var vh = O.vAdd(eh.v, f.exit.v);
		var el = O.elementsFromState(GM_SUN, O.vAdd(eh.r, f.exit.r), vh);
		apo.push(el.a * (1 + el.e) / AU);
		helioSpeed.push(O.vMag(vh));
	}
	var spread = Math.max.apply(null, apo) - Math.min.apply(null, apo);
	assert.ok(spread > 0.3, "aphelion spans a lunar month, spread " + spread.toFixed(3) + " AU");

	// It is a heliocentric SPEED difference, not a geocentric one: the same
	// throw adds to Earth's motion at one phase and subtracts at another.
	var vSpread = Math.max.apply(null, helioSpeed) - Math.min.apply(null, helioSpeed);
	assert.ok(vSpread > 3000, "heliocentric speed spans " + Math.round(vSpread) + " m/s");
});

test("release speed at altitude is the impulse plus the Moon's well", function () {
	var f = flyLunarDeparture({ jd: JD, burn: OUTWARD });
	var r = R_MOON + RELEASE_ALTITUDE;
	// vis-viva through the Moon's well, and it must exceed the excess it buys.
	var expect = Math.sqrt(f.uMag * f.uMag + 2 * GM_MOON * (1 / r - 1 / SOI_MOON));
	assert.ok(Math.abs(f.releaseSpeed - expect) < 1e-6);
	assert.ok(f.releaseSpeed > f.uMag + 500, "the Moon's well costs real speed");
	// Climbing to the SOI EDGE with nothing left over, which is a little less
	// than escaping to infinity (2,380 m/s at this altitude).
	var toEdge = releaseSpeedFor(0, r);
	assert.ok(toEdge > 2200 && toEdge < 2380, "reaching the SOI edge costs " + Math.round(toEdge));
});

test("a release that cannot escape reports it, with the flight attached", function () {
	// Nothing thrown at all.
	var none = flyLunarDeparture({ jd: JD, burn: { pro: 0, rad: 0, nrm: 0 } });
	assert.equal(none.ok, false);
	assert.equal(none.reason, "no-impulse");

	// Thrown, but far too slowly to leave Earth from lunar distance.
	var weak = flyLunarDeparture({ jd: JD, burn: { pro: 0, rad: 60, nrm: 0 } });
	assert.equal(weak.ok, false, "60 m/s should not escape Earth");
	assert.ok(weak.reason === "no-escape" || weak.reason.indexOf("impact-") === 0, weak.reason);
	assert.ok(weak.leg && weak.leg.samples.length > 1, "the flight is still there to draw");
});

test("the card's components are read in the Moon's own frame", function () {
	// releaseVelocity is what the Ephemeris tab's departure card means: the
	// Moon's velocity plus an impulse in the Moon's geocentric orbital frame.
	// A pure prograde entry must therefore speed the Moon's own motion up.
	var mV = moonGeoVel(JD);
	var pro = releaseVelocity(JD, { pro: 500, rad: 0, nrm: 0 });
	assert.ok(O.vMag(pro) > O.vMag(mV), "prograde adds to the Moon's speed");
	assert.ok(Math.abs(O.vMag(O.vSub(pro, mV)) - 500) < 1e-6, "and by exactly the entry");

	var zero = releaseVelocity(JD, { pro: 0, rad: 0, nrm: 0 });
	assert.deepEqual(zero.map(round3), mV.map(round3), "no impulse means the Moon's own motion");
});

function round3(x) { return Math.round(x * 1e3) / 1e3; }
