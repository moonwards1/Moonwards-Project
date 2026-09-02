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
import { flyLunarDeparture, releaseVelocity, releaseImpulse, releaseSpeedFor, RELEASE_ALTITUDE }
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
	assert.ok(spread > 0.2, "aphelion spans a lunar month, spread " + spread.toFixed(3) + " AU");

	// It is a heliocentric SPEED difference, not a geocentric one. The card's
	// own direction is fixed on Earth's axes, so what swings is the Moon's
	// 1,022 m/s riding underneath it — worth a couple of km/s of heliocentric
	// speed by the time the ship is out of Earth's SOI.
	var vSpread = Math.max.apply(null, helioSpeed) - Math.min.apply(null, helioSpeed);
	assert.ok(vSpread > 2000, "heliocentric speed spans " + Math.round(vSpread) + " m/s");
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

	// Thrown, but far too slowly to leave Earth from lunar distance: 60 m/s on
	// top of the Moon's 1,022 m/s, against the 1,440 m/s Earth escape needs
	// out here. It stays in orbit and never reaches Earth's SOI.
	var weak = flyLunarDeparture({ jd: JD, burn: { pro: 60, rad: 0, nrm: 0 } });
	assert.equal(weak.ok, false, "60 m/s should not escape Earth");
	assert.equal(weak.reason, "no-escape");
	assert.ok(weak.leg && weak.leg.samples.length > 1, "the flight is still there to draw");

	// Thrown out of the Moon's orbital plane too slowly to clear the Moon
	// itself (385 m/s at its SOI edge), so it falls back onto it.
	var back = flyLunarDeparture({ jd: JD, burn: { pro: 0, rad: 0, nrm: 60 } });
	assert.equal(back.ok, false);
	assert.equal(back.reason, "impact-Moon");
	assert.ok(back.leg.samples.length > 1, "and that flight is drawable too");
});

test("a marginal release still reports the flight it really makes", function () {
	// Barely faster than the Moon, a release does not fail outright: it wanders
	// out on a weakly bound orbit that solar and lunar perturbation eventually
	// carry across Earth's SOI, weeks later. That is what the integration says,
	// so it is reported as a real (if useless) departure rather than rejected —
	// the flight time on the card is what marks it as one to avoid.
	var drift = flyLunarDeparture({ jd: JD, burn: { pro: 0, rad: 60, nrm: 0 } });
	assert.equal(drift.ok, true, drift.reason);
	assert.ok(drift.flightDays > 20,
		"a drift-out takes weeks, not days: " + drift.flightDays.toFixed(1) + " d");
});

test("the card's components are read on EARTH's heliocentric axes", function () {
	// The departure card means the same thing here as at every other origin:
	// prograde is along Earth's heliocentric motion, not the Moon's geocentric
	// motion — which would rotate a full turn a month and make "prograde"
	// mean something different every week.
	var e = Frames.bodyHelioState("Earth", JD);
	var pro = releaseImpulse(JD, { pro: 500, rad: 0, nrm: 0 });
	assert.ok(Math.abs(O.vMag(pro) - 500) < 1e-9, "magnitude is the entry");
	var cos = O.vDot(O.vUnit(pro), O.vUnit(e.v));
	assert.ok(cos > 1 - 1e-9, "and it points along Earth's heliocentric velocity");

	// Explicitly NOT the Moon's frame: at a date where the Moon's geocentric
	// motion is well away from Earth's heliocentric heading, the two readings
	// of "prograde" differ, and the card follows Earth.
	var moonPro = O.vUnit(moonGeoVel(JD));
	assert.ok(O.vDot(O.vUnit(pro), moonPro) < 0.9,
		"the Moon's own prograde is a different direction here");

	// The impulse rides the Moon's velocity: that is what releaseVelocity adds.
	var mV = moonGeoVel(JD);
	assert.deepEqual(releaseVelocity(JD, { pro: 500, rad: 0, nrm: 0 }).map(round3),
		O.vAdd(mV, pro).map(round3));
	assert.deepEqual(releaseVelocity(JD, { pro: 0, rad: 0, nrm: 0 }).map(round3),
		mV.map(round3), "no impulse means the Moon's own motion");
});

test("a prograde release outruns a retrograde one, whatever the lunar phase", function () {
	// The payoff of Earth-frame axes: a positive prograde entry always adds to
	// the ship's heliocentric speed, on every day of the month. On the Moon's
	// own axes the same entry would add at one phase and subtract at another.
	for (var k = 0; k < 6; k++) {
		var jd = JD + k * LUNAR_MONTH / 6;
		var fwd = flyLunarDeparture({ jd: jd, burn: { pro: 2600, rad: 0, nrm: 0 } });
		var back = flyLunarDeparture({ jd: jd, burn: { pro: -2600, rad: 0, nrm: 0 } });
		assert.equal(fwd.ok, true, "prograde day " + k + ": " + fwd.reason);
		assert.equal(back.ok, true, "retrograde day " + k + ": " + back.reason);
		assert.ok(helioSpeedAtExit(fwd) > helioSpeedAtExit(back) + 3000,
			"day " + k + ": prograde " + Math.round(helioSpeedAtExit(fwd)) +
			" vs retrograde " + Math.round(helioSpeedAtExit(back)) + " m/s");
	}
});

function helioSpeedAtExit(f) {
	var eh = Frames.bodyHelioState("Earth", f.exit.jd);
	return O.vMag(O.vAdd(eh.v, f.exit.v));
}

function round3(x) { return Math.round(x * 1e3) / 1e3; }
