// Hanging skyhook model — the pure physics of a vertical (non-rotating)
// gravity-gradient tether. ES module, no DOM, so it runs in Node:
//   import { computeSkyhook, PROPELLANT_MAX } from "./skyhookModel.js";
//
// Tether materials are Shared/materials.js.
//
// computeSkyhook(body, inp) takes a body from Shared/orbit.js (`systems`) and
// plain inputs, and returns every figure the page shows. Units are SI unless a
// name says otherwise.
//
// inp:
//   foot, centre, top          altitudes, m
//   receivingDeck, outerDocks, launchDeck   altitudes, m; null when the stations
//                              are not modelled (deck = foot, docks and launch
//                              deck = top)
//   strength                   specific strength already divided by the safety
//                              factor: (σ / S) / ρ, J/kg
//   loadTop, loadFoot          masses held at the top and foot tips, kg
//   distUpper, distLower       masses spread evenly along the upper / lower tether, kg
//   comMass                    the centre-of-mass station (ballast), kg
//   rate                       delivery rate to the launch deck, t/day
//   perClimber                 t;  vClimb m/s;  effDrive 0–1
//   propellant                 "oxygen" | "hydrogen";  vExhaust km/s
//   effThruster, effSupply     0–1
//   targetPerigee, ifaceAlt    km above the parent body

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";

// Viable mature-engine exhaust-speed ceilings, km/s.
export const PROPELLANT_MAX = { oxygen: 20, hydrogen: 80 };

// Share of the ascending rate that descends from the outer docks to the foot.
export const DESCENT_SHARE = 0.01;

// Tension and tether mass of a constant-stress tether, built up from one tip inward
// to rEnd. All radii are from the body's centre, m.
//   GM, omega   the body's gravitational parameter and the tether's angular rate
//   s           specific strength with safety factor applied, J/kg
//   tipLoad     kg held at the tip
//   distLoad    kg spread evenly over the stretch from the tip to rEnd
// Net outward pull is a(r) = ω²r − GM/r², zero at the nominal centre, outward above
// it and inward below. Sweeping down from the top, tension grows by exp(∫a dr / s)
// across a step and gains the weight of the load added within it (lumps at the tip, a
// steady λ·a·dr along the way); sweeping up from the foot it is the same with the
// signs reversed. Past the nominal centre the pull reverses, so tension then falls
// again. The tether's own mass is dm = T/s · dr, which the taper already accounts for.
// rec, if given ({ r: [], T: [] }), is filled with the tension at every step from the
// tip to rEnd, for drawing the taper.
// Returns { tension (N at rEnd, from everything outboard), mass (tether, kg),
//           slack (true if the tension would have gone negative: the stretch cannot hold) }.
export function sweepTether(GM, omega, s, rTip, rEnd, tipLoad, distLoad, steps, rec) {
	var n = steps || 1000, dr = (rEnd - rTip) / n, len = Math.abs(rEnd - rTip);
	var sg = rTip >= rEnd ? 1 : -1;   // +1 sweeping down from the top, −1 sweeping up from the foot
	var lambda = len > 0 ? distLoad / len : 0;
	var pull = function (r) { return omega * omega * r - GM / (r * r); };
	var phi = function (r) { return 0.5 * omega * omega * r * r + GM / r; };   // dφ/dr = a
	var T = tipLoad * sg * pull(rTip), mass = 0, slack = false;
	if (T < 0) { T = 0; slack = true; }
	if (rec) { rec.r.push(rTip); rec.T.push(T); }
	for (var i = 0; i < n; i++) {
		var r1 = rTip + i * dr, r2 = r1 + dr;
		var grow = Math.exp(-(phi(r2) - phi(r1)) / s);
		var Tn = T * grow + sg * lambda * Math.abs(dr) * pull((r1 + r2) / 2) * Math.sqrt(grow);
		mass += (T + Tn) / 2 / s * Math.abs(dr);
		if (Tn < 0) { Tn = 0; slack = true; }
		T = Tn;
		if (rec) { rec.r.push(r2); rec.T.push(T); }
	}
	return { tension: T, mass: mass, slack: slack };
}

export function computeSkyhook(moon, inp) {
	var R = Number(moon.radius), GM = moon.GM;
	var t = {};
	var warnings = [];
	var integral = function (a, b) { return OrbitalMath.taperIntegral(GM, t.angularVelocity, a, b); };

	t.foot = inp.foot; t.top = inp.top; t.centre = inp.centre;
	t.receivingDeck = inp.receivingDeck == null ? t.foot : inp.receivingDeck;   // where ascending cargo joins the cable
	t.outerDocks    = inp.outerDocks    == null ? t.top  : inp.outerDocks;      // where descending cargo joins the cable
	t.launchDeck    = inp.launchDeck    == null ? t.top  : inp.launchDeck;      // where cargo is released
	t.Length = t.top - t.foot;
	t.surfaceGravity = GM / (R * R);

	if (t.foot < 0) warnings.push("The tether foot is inside the body.");
	if (t.foot > t.top) warnings.push("The tether foot can not be higher than the top.");
	else if (t.centre < t.foot || t.centre > t.top) warnings.push("The centre of mass must be between the foot and the top.");
	if (inp.receivingDeck != null && (t.receivingDeck < t.foot || t.receivingDeck > t.top)) warnings.push("The receiving deck must be between the foot and the top.");
	if (inp.outerDocks != null && (t.outerDocks < t.foot || t.outerDocks > t.top)) warnings.push("The outer docks must be between the foot and the top.");
	if (inp.launchDeck != null && (t.launchDeck < t.foot || t.launchDeck > t.top)) warnings.push("The main launch deck must be between the foot and the top.");

	// ---- orbit and speeds ----
	t.time = 2 * Math.PI * Math.sqrt(Math.pow(t.centre + R, 3) / GM);
	t.centreVel = OrbitalMath.circularVelocity(GM, R + t.centre);
	t.angularVelocity = t.centreVel / (t.centre + R);
	t.footVel = (t.foot + R) * t.angularVelocity;
	t.topVel = (t.top + R) * t.angularVelocity;
	t.launchDeckVel = (t.launchDeck + R) * t.angularVelocity;
	t.topOrbit = OrbitalMath.circularVelocity(GM, t.top + R);
	t.launchDeckOrbit = OrbitalMath.circularVelocity(GM, t.launchDeck + R);
	t.footOrbit = OrbitalMath.circularVelocity(GM, t.foot + R);
	t.escapeFromTop = Math.sqrt(t.launchDeckVel * t.launchDeckVel - t.launchDeckOrbit * t.launchDeckOrbit * 2);

	// ---- dropped from the foot: apoapsis at the foot, other apsis newPeriapsis (radius) ----
	t.hitTheGround = Math.sqrt(t.footVel * t.footVel + 2 * GM / R - t.footOrbit * t.footOrbit * 2);
	t.newPeriapsis = Math.pow((t.foot + R) * t.footVel, 2) / (2 * GM - (t.foot + R) * t.footVel * t.footVel);
	t.collisionAngle = Math.acos(t.angularVelocity * (t.foot + R) * (t.foot / R + 1) / t.hitTheGround);
	t.hitsSurface = t.newPeriapsis < R;
	t.impactFromVertical = Math.PI / 2 - t.collisionAngle;
	// Angle around the body from the foot to the impact point.
	t.impactAround = t.hitsSurface ? Math.asin(
		(2 * (t.foot + R) * t.newPeriapsis - R * (t.foot + R + t.newPeriapsis)) /
		(R * (t.foot + R - t.newPeriapsis))
	) + Math.PI / 2 : NaN;

	// ---- tether properties ----
	t.strength = inp.strength;
	t.lowAcceleration = GM / Math.pow(R + t.foot, 2) - t.footVel * t.footVel / (R + t.foot);
	t.highAcceleration = -GM / Math.pow(R + t.top, 2) + t.topVel * t.topVel / (R + t.top);
	t.lowIntegral = integral(t.foot + R, t.centre + R);
	t.highIntegral = integral(t.centre + R, t.top + R);
	t.lowRatio = Math.exp(t.lowIntegral / t.strength);
	t.highRatio = Math.exp(t.highIntegral / t.strength);
	var lowSum = 0, highSum = 0, N = 1000;
	for (var i = 0; i < N; i++) {
		lowSum += Math.exp(integral(t.foot + R, t.foot + i * (t.centre - t.foot) / N + R) / t.strength);
		highSum += Math.exp(integral(t.centre + i * (t.top - t.centre) / N + R, t.top + R) / t.strength);
	}
	t.lowMass = t.lowAcceleration * (t.centre - t.foot) * (lowSum / N) / t.strength;     // × load
	t.highMass = t.highAcceleration * (t.top - t.centre) * (highSum / N) / t.strength;   // × load

	// ---- loads and forces ----
	// Constant-stress cable: T(r) = σ·A(r). Each half is swept from its tip inward
	// (sweepTether), picking up its tip load and its evenly spread load on the way.
	// The centre-of-mass station is ballast sitting a little off the nominal centre,
	// at the radius where the upper pull, the lower pull and its own net pull cancel:
	// T_lower − T_upper = m_com·a(r). That puts the installation's true centre of mass
	// on the nominal centre, which is what fixes the orbit.
	var rFoot = t.foot + R, rTop = t.top + R, rCentre = t.centre + R, w = t.angularVelocity;
	var netPull = function (r) { return w * w * r - GM / (r * r); };   // outward positive
	t.loads = { top: inp.loadTop, foot: inp.loadFoot, distUpper: inp.distUpper, distLower: inp.distLower, com: inp.comMass };
	t.loads.upperTotal = t.loads.top + t.loads.distUpper;
	t.loads.lowerTotal = t.loads.foot + t.loads.distLower;
	var halves = function (rs, steps, rec) {
		return {
			up: sweepTether(GM, w, t.strength, rTop, rs, t.loads.top, t.loads.distUpper, steps, rec && rec.up),
			low: sweepTether(GM, w, t.strength, rFoot, rs, t.loads.foot, t.loads.distLower, steps, rec && rec.low)
		};
	};
	var STEPS = 600;
	var surplus = function (rs) {
		var h = halves(rs, STEPS);
		return h.up.slack || h.low.slack ? NaN : h.low.tension - h.up.tension - t.loads.com * netPull(rs);
	};
	// The station may sit anywhere on the tether. The balance can have more than one
	// solution, so the tether is scanned from end to end and the sign change nearest the
	// nominal centre is refined. If the loads cannot be balanced anywhere, the station is
	// left at the nominal centre and the leftover force is reported (t.unbalance): the
	// installation's true centre of mass is then not where the nominal centre says.
	var rs = rCentre;
	t.balanced = false;
	if (t.foot < t.top) {
		var SCAN = 100, best = null, prevR = rFoot + 1, prevS = surplus(prevR);
		for (var q = 1; q <= SCAN; q++) {
			var rq = rFoot + 1 + (rTop - rFoot - 2) * q / SCAN, sq = surplus(rq);
			if (prevS * sq <= 0) {
				var dist = Math.abs((prevR + rq) / 2 - rCentre);
				if (!best || dist < best.dist) best = { lo: prevR, hi: rq, sLo: prevS, dist: dist };
			}
			prevR = rq; prevS = sq;
		}
		if (best) {
			var lo = best.lo, hi = best.hi;
			for (var k = 0; k < 50; k++) {
				var mid = (lo + hi) / 2;
				if (best.sLo * surplus(mid) <= 0) hi = mid; else lo = mid;
			}
			rs = (lo + hi) / 2;
			t.balanced = true;
		}
	}
	t.profile = { up: { r: [], T: [] }, low: { r: [], T: [] } };
	var fin = halves(rs, STEPS, t.profile);
	t.comOffset = rs - rCentre;
	t.tensionUpper = fin.up.tension;
	t.tensionLower = fin.low.tension;
	t.tensionPeak = Math.max(t.tensionUpper, t.tensionLower);
	t.unbalance = fin.low.tension - fin.up.tension - t.loads.com * netPull(rs);   // N; 0 when balanced
	t.tetherMassUpper = fin.up.mass;
	t.tetherMassLower = fin.low.mass;
	t.tetherMass = t.tetherMassUpper + t.tetherMassLower;
	// The station mass that would hold it within 1 km of the nominal centre: the
	// same balance solved for m_com at that position, on the side it already sits.
	var r1 = rCentre + (t.comOffset < 0 ? -1000 : 1000), h1 = halves(r1, STEPS);
	t.comMassAt1km = t.balanced ? (h1.low.tension - h1.up.tension) / netPull(r1) : NaN;
	if (!(t.comMassAt1km >= 0)) t.comMassAt1km = NaN;
	if (t.foot < t.top && !t.balanced) {
		var gap = Math.abs(t.unbalance), gapText = gap >= 1e12 ? (gap / 1e12).toFixed(gap >= 1e13 ? 0 : 1) + " TN" : gap >= 1e9 ? (gap / 1e9).toFixed(1) + " GN" : (gap / 1e6).toFixed(0) + " MN";
		warnings.push("Out of balance: no position for the centre-of-mass station balances these loads. At the nominal centre the " +
			(t.unbalance < 0 ? "upper tether outweighs the lower" : "lower tether outweighs the upper") + " by " + gapText +
			", so the true centre of mass is not where you set it. Add ballast, or load to the lighter side.");
	}

	// ---- release points: altitude where a release reaches each neighbour ----
	t.targets = releaseTargets(moon, t);

	// ---- throughput: receiving deck → launch deck up, outer docks → foot down ----
	var rateTpd = inp.rate, mC = inp.perClimber, vC = inp.vClimb, eff = inp.effDrive;
	var L_up = t.launchDeck - t.receivingDeck, L_down = t.outerDocks - t.foot;
	var th = {};
	th.tripUpDays = (L_up / vC) / 86400;
	th.tripDownDays = (L_down / vC) / 86400;
	th.perDay = rateTpd / mC;
	th.intervalH = 24 / th.perDay;
	th.onCable = th.perDay * th.tripUpDays;
	th.cargoUpT = rateTpd * th.tripUpDays;
	th.descRate = rateTpd * DESCENT_SHARE;
	th.cargoDownT = th.descRate * th.tripDownDays;
	th.spacingKm = (L_up / 1e3) / Math.max(th.onCable, 1e-9);
	// The centre of mass is the potential maximum: climbing deck → centre costs,
	// centre → launch deck regenerates.
	var liftIntegral = t.receivingDeck < t.centre ? integral(t.receivingDeck + R, t.centre + R) : 0;
	var upAboveCoM = integral(t.centre + R, t.launchDeck + R);
	var downAboveCoM = integral(t.centre + R, t.outerDocks + R);
	var lambdaUp = L_up > 0 ? (th.cargoUpT * 1e3) / L_up : 0;
	var lambdaDown = L_down > 0 ? (th.cargoDownT * 1e3) / L_down : 0;
	th.addedTension = lambdaUp * (liftIntegral + upAboveCoM) + lambdaDown * (t.lowIntegral + downAboveCoM);
	th.addedTensionPct = 100 * th.addedTension / t.tensionPeak;
	th.massFlow = rateTpd * 1e3 / 86400;
	var netLift = liftIntegral - upAboveCoM;
	th.liftPower = netLift * th.massFlow / eff;
	th.energyPerT = netLift / eff / 1e6;   // GJ/t
	t.throughput = th;

	// ---- station-keeping: reboost thrust at the top cancels the climbers' drag ----
	// Climbers carry cargo outward, taking angular momentum from the orbit: the drain is
	// mdot·ω·(r_launch² − r_deck²), less the descending stream's credit mdot_down·ω·(r_docks² − r_foot²).
	var w = t.angularVelocity;
	var r_f = t.foot + R, r_mount = t.top + R, r_deck = t.receivingDeck + R, r_docks = t.outerDocks + R, r_launch = t.launchDeck + R;
	var sk = {};
	sk.vMount = w * r_mount;
	sk.torque = th.massFlow * w * (r_launch * r_launch - r_deck * r_deck) - th.massFlow * DESCENT_SHARE * w * (r_docks * r_docks - r_f * r_f);
	sk.thrust = sk.torque / r_mount;
	sk.orbitPower = sk.thrust * sk.vMount;
	sk.vExhaust = Math.min(inp.vExhaust, PROPELLANT_MAX[inp.propellant]) * 1000;
	sk.propFlow = sk.thrust / sk.vExhaust;
	sk.jetPower = 0.5 * sk.thrust * sk.vExhaust;
	sk.elecPower = sk.jetPower / inp.effThruster;
	sk.genPower = sk.elecPower / inp.effSupply;
	sk.propPerCargo = sk.propFlow / Math.max(th.massFlow, 1e-12);
	sk.energyPerT = sk.genPower / Math.max(th.massFlow, 1e-12) / 1e6;   // GJ/t
	t.keeping = sk;

	// ---- Earth reentry of cargo released from the launch deck (patched conic) ----
	t.reentry = reentry(moon, t, inp);

	t.warnings = warnings;
	return t;
}

function releaseTargets(moon, t) {
	var R = Number(moon.radius), GM = moon.GM;
	var pt = { siblings: [], aunts: [] };
	if (moon.orbit) {
		pt.parent = moon.orbit.system;
		pt.siblings = moon.orbit.system.satellites.filter(function (s) { return s.properties.name !== moon.properties.name; }) || [];
		if (moon.orbit.system.orbit) {
			pt.aunts = moon.orbit.system.orbit.system.satellites.filter(function (s) { return s.properties.name !== pt.parent.properties.name; });
		}
	}
	var targets = [];
	if (pt.parent) {
		targets.push({ name: pt.parent.properties.name,
			vinf: moon.orbit.vela - Math.sqrt(moon.orbit.system.GM * (2 / moon.orbit.a - 2 / (moon.orbit.a + moon.orbit.system.radius))) });
	}
	pt.siblings.forEach(function (s) {
		targets.push({ name: s.properties.name,
			vinf: Math.abs(moon.orbit.vela - Math.sqrt(moon.orbit.system.GM * (2 / moon.orbit.a - 2 / (moon.orbit.a + s.orbit.a)))) });
	});
	pt.aunts.forEach(function (s) {
		var o = moon.orbit.system.orbit;
		targets.push({ name: s.properties.name,
			vinf: Math.sqrt(Math.pow(o.vela - Math.sqrt(o.system.GM * (2 / o.a - 2 / (o.a + s.orbit.a))), 2) + moon.orbit.vela * moon.orbit.vela * 2) - moon.orbit.vela });
	});
	var w2 = t.angularVelocity * t.angularVelocity;
	targets.forEach(function (tg) {
		if (Number.isNaN(tg.vinf)) { tg.location = NaN; return; }
		var v2 = tg.vinf * tg.vinf, val = R + t.centre, step = (R + t.centre) / 2;
		while (w2 * val * val - 2 * GM / val < v2) { val += step; step *= 2; }
		for (var i = 0; i < 50; i++) { step /= 2; if (w2 * val * val - 2 * GM / val < v2) val += step; else val -= step; }
		tg.location = val;           // radius, m
		tg.altitude = val - R;
	});
	return targets;
}

function reentry(moon, t, inp) {
	var out = { applies: !!(moon.properties && moon.properties.name === "Moon") };
	var parent = moon.orbit ? moon.orbit.system : null;
	if (!parent || !isFinite(t.escapeFromTop)) { out.escapes = false; return out; }
	out.escapes = true;
	var GMe = parent.GM, Re = Number(parent.radius), D = moon.orbit.a;
	var vinf = t.escapeFromTop, Vmoon = Math.sqrt(GMe / D);
	var Varr = Vmoon - vinf;                          // parent-relative speed at lunar distance
	var eps = Varr * Varr / 2 - GMe / D;
	var aNat = -GMe / (2 * eps);
	var rpNat = 2 * aNat - D;                         // natural transfer perigee radius
	var rpt = Re + inp.targetPerigee * 1000, rI = Re + inp.ifaceAlt * 1000;
	var aT = (D + rpt) / 2;
	var vT = Math.sqrt(GMe * (2 / D - 1 / aT));
	out.vinf = vinf;
	out.arrivalSpeed = Math.abs(Varr);
	out.naturalPerigeeAlt = rpNat - Re;
	out.burn = vT - Varr;                             // + prograde raises perigee, − retrograde lowers
	out.entry = rpt < rI && rI < D;
	if (out.entry) {
		var eT = (D - rpt) / (D + rpt);
		var hT = Math.sqrt(GMe * aT * (1 - eT * eT));
		var vI = Math.sqrt(GMe * (2 / rI - 1 / aT));
		out.entryAngle = Math.acos(Math.min(1, hT / (rI * vI)));
		out.entrySpeed = vI;
		out.atmosphere = !!parent.atmosphere;
		if (parent.atmosphere) out.peakG = OrbitalMath.allenEggersPeakDecel(vI, out.entryAngle, Const.scaleHeight.earth) / Const.g0;
	}
	return out;
}
