// Earth aerobrake reality check — the physics, pure (no DOM).
//
// Inbound Ceres-fleet manoeuvre: a hyperbolic arrival makes one grazing pass
// through Earth's upper atmosphere and exits into a barely-bound orbit with
// apoapsis near the edge of Earth's SOI. Gives the speed shed, the peak g-load
// and — through the ship's ballistic coefficient — the periapsis depth, dynamic
// pressure, convective heat flux and a first-cut heat-shield mass, so a
// proposed mass budget can be sanity-checked.
//
// The orbital maths is in Shared/math-utils.js (OrbitalMath), body data in
// orbit.js, constants in constants.js; this file puts them in order.
//
//   computeAerobrake(inp) → results (SI units unless a name says otherwise)
//   inp: vEntry km/s, hPeri km, apoFrac (apoapsis as a fraction of Earth's SOI),
//        scaleH m, cargo t, structPct %, tpsPct %, fuel t, shieldD m, cd,
//        noseR m (0 = half the shield diameter), qStar MJ/kg

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath as OM } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";

var earth = systems.get("Earth");
var GM = earth.GM;
var Re = earth.radius;
var Mearth = earth.mass;
var Msun = Const.GM_sun / Const.G;
var aEarth = (earth.orbit.apoapsis + earth.orbit.periapsis) / 2;
export var EARTH_SOI = OM.sphereOfInfluence(aEarth, Mearth, Msun);   // m
var RHO0 = 1.225;                                                    // kg/m³ sea-level reference

export function computeAerobrake(inp) {
	var vEntry = inp.vEntry * 1000;
	var hPeri = inp.hPeri * 1000;
	var apoFrac = inp.apoFrac;
	var H = inp.scaleH;
	var cargo = inp.cargo * 1000;
	var struct = inp.structPct / 100 * cargo;
	var tpsBudget = inp.tpsPct / 100 * cargo;
	var fuel = inp.fuel * 1000;
	var D = inp.shieldD;
	var Cd = inp.cd;
	var Rn = inp.noseR > 0 ? inp.noseR : D / 2;
	var Qstar = inp.qStar * 1e6;

	// orbit and speeds
	var rp = Re + hPeri;
	var rApo = apoFrac * EARTH_SOI;
	var a = (rp + rApo) / 2;
	var vExit = OM.visVivaVelocity(GM, rp, a);          // periapsis speed after the brake
	var vEsc = OM.escapeVelocity(GM, rp);
	var shed = vEntry - vExit;
	var margin = vEsc - vExit;                          // how far below escape

	// g-load (geometry only)
	var aPeak = OM.grazingPeakDecel(GM, rp, vEntry, vExit, H);
	var gPeak = aPeak / Const.g0;
	var I = OM.grazingPathScale(GM, rp, vEntry, H);
	var vRep = Math.sqrt(vEntry * vExit);
	var tau = Math.SQRT2 * I / vRep;                    // soak time, s

	// masses and ballistic coefficient
	var entryMass = cargo + struct + tpsBudget + fuel;
	var area = Math.PI * D * D / 4;
	var beta = OM.ballisticCoefficient(entryMass, Cd, area);

	// periapsis conditions that actually shed `shed`
	var rhoP = OM.grazingPeriapsisDensity(GM, rp, vEntry, vExit, H, beta);
	var hAct = OM.altitudeForDensity(RHO0, rhoP, H);
	var qDyn = OM.dynamicPressure(rhoP, vRep);          // Pa
	var qDynAtm = qDyn / 101325;
	var qConv = OM.suttonGravesHeatFlux(rhoP, vRep, Rn);   // W/m²
	var qConvCm = qConv / 1e4;                          // W/cm²
	var Qint = qConv * tau;                             // J/m²

	// first-cut heat-shield mass (convective heating only)
	var arealAblated = Qint / Qstar;                    // kg/m²
	var areal = 2.5 * arealAblated;                     // plus char, insulation and margin
	var tpsNeed = areal * area;

	// how worrying each figure is
	var flags = {
		altitude: hAct / 1000 < 35 ? "warn" : (hAct / 1000 < 45 ? "caution" : "ok"),
		dynamicPressure: qDynAtm > 3 ? "warn" : (qDynAtm > 1 ? "caution" : "ok"),
		heatFlux: qConvCm > 300 ? "warn" : (qConvCm > 150 ? "caution" : "ok"),
		shield: tpsNeed > tpsBudget ? "warn" : (tpsNeed > 0.8 * tpsBudget ? "caution" : "ok"),
		escapeMargin: margin < 60 ? "caution" : "ok"
	};

	return {
		soi: EARTH_SOI, rApo: rApo, vEsc: vEsc, vExit: vExit, shed: shed, shedFraction: shed / vEntry, margin: margin,
		aPeak: aPeak, gPeak: gPeak, tau: tau, entryMass: entryMass, beta: beta, peakForce: entryMass * aPeak,
		rhoP: rhoP, brakingAltitude: hAct, dynamicPressureAtm: qDynAtm,
		heatFluxWcm2: qConvCm, heatLoadKJcm2: Qint / 1e4 / 1000,
		arealDensity: areal, shieldMassNeeded: tpsNeed, shieldMassBudget: tpsBudget, flags: flags
	};
}
