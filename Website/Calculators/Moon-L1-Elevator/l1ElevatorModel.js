// Moon–L1 elevator physics, pure (no DOM). ES module:
//   import { L1Elevator } from "./l1ElevatorModel.js";
//
// The standalone example design's model: its cargo traffic and climb speed,
// on top of the tether sizing every workbench elevator shares
// (Shared/radial-tether.js). README.md derives the model.
//
// r = distance from the Moon's centre, measured toward Earth; Earth at r = D.
// The Earth–Moon system rotates about the barycentre (r = x_b) with angular
// velocity ω; the tidally-locked Moon holds the tether fixed in that frame.
//
// Inputs p (SI): Rmoon, D, baryE (barycentre from Earth's centre), GMm, GMe,
// rL1, omegaSrc ("kepler" | "vorb"), Vorb, sig (Pa), rho, safety, rCW, rate
// (t/day), vClimb (m/s), infraPct (% climber tare), trackMin, trackGrav (kg/m).

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";
import { earthMoonField, tetherContext, tetherMetrics } from "../../Shared/radial-tether.js";

// Rotation rate of the Earth–Moon frame: Kepler's law, or the Moon's orbital
// speed about the barycentre.
function omegaOf(p, xb) {
	return p.omegaSrc === "vorb" ? p.Vorb / xb : OrbitalMath.angularVelocity(p.GMe + p.GMm, p.D);
}

// The Earth–Moon force field on the L1 (or, with side "L2", the far) side.
function fieldOf(p, side) {
	var xb = p.D - p.baryE;
	return earthMoonField(side || "L1", { GMm: p.GMm, GMe: p.GMe, D: p.D, xb: xb, omega: omegaOf(p, xb), Rmoon: p.Rmoon });
}

// L1 in this force field: where g(r) = 0 between the Moon and Earth.
function findL1(p) { return fieldOf(p).rBalance; }

// The load-aware solution, independent of the counterweight mass.
function buildContext(p) {
	var xb = p.D - p.baryE;
	var L = p.rCW - p.Rmoon;
	var tTrip_s = L / p.vClimb;
	var oncable_kg = (isFinite(p.rate) ? p.rate : 0) * 1e3 * (tTrip_s / 86400);   // payload on the cable
	var infraF = 1 + (isFinite(p.infraPct) ? p.infraPct : 0) / 100;                // + climber tare
	var live_kg = oncable_kg * infraF;             // moving mass (cargo + climbers), only when loaded
	var ctx = tetherContext(fieldOf(p), {
		rCW: p.rCW, rho: p.rho, sigEff: p.sig / p.safety, rPeak: p.rL1,
		lamMin: p.trackMin, lamGrav: p.trackGrav, lamCargo: live_kg / L
	});
	return Object.assign(ctx, { xb: xb, omega: omegaOf(p, xb), tTrip_s: tTrip_s,
		oncable_kg: oncable_kg, infraF: infraF, live_kg: live_kg,
		EL1: ctx.Epeak, C_L1: ctx.Cpeak, Cg_L1: ctx.Cgpeak });
}

// Metrics for a given counterweight mass (Shared/radial-tether.js
// tetherMetrics, with the peak read at L1).
function loadedMetrics(p, ctx, Mcw) {
	var m = tetherMetrics(ctx, Mcw);
	m.TL1 = m.Tpeak; m.AL1 = m.Apeak;
	return m;
}

// Structure mass against climb speed: re-sizes the structure at climb speeds
// around the chosen one, holding throughput, material and the counterweight's
// headroom (chosen ÷ minimum) fixed. The live load on the cable ∝ 1/v.
function sweepSpeeds(pBase, ctxCur, curMcw) {
	var headroom = curMcw / ctxCur.McwMin;
	return [0.5, 0.75, 1, 1.5, 2, 3, 4].map(function (mu) {
		var p = Object.assign({}, pBase, { vClimb: pBase.vClimb * mu });
		var ctx = buildContext(p);
		var Mcw = headroom * ctx.McwMin;
		var m = loadedMetrics(p, ctx, Mcw);
		return { v: p.vClimb, isCur: Math.abs(mu - 1) < 1e-9, trip: ctx.tTrip_s / 86400,
			live: ctx.live_kg, Mcw: Mcw, tether: m.mass, total: m.mass + m.trackMass + Mcw };
	});
}

// A vessel let go at the counterweight. It keeps the frame's rotation speed,
// tangential to Earth, so the release point is an apsis of its Earth orbit.
// q: { GMe, D, rCW, omega, Rearth, ifaceAlt, targetAlt?, rRel? }. rRel, the
// release point's distance from Earth's centre, defaults to D − rCW (the L1
// side); the L2 side passes D + rCW. Without targetAlt, everything describes
// the natural orbit: its perigee and, if that perigee lies below the entry
// interface, the entry flight-path angle and peak deceleration it arrives
// with. With targetAlt, `burn` adds the retrograde burn at release that lowers
// perigee to that altitude, and `entry` describes that lowered orbit instead.
function releaseOrbit(q) {
	var rRel = isFinite(q.rRel) ? q.rRel : q.D - q.rCW, vRel = q.omega * rRel;
	var out = { rRel: rRel, vRel: vRel, bound: false, rApo: NaN, rPer: NaN, burn: null, entry: null, entryNote: "" };
	var eps = OrbitalMath.specificEnergy(vRel, q.GMe, rRel);
	if (!(eps < 0)) { out.entryNote = "unbound"; return out; }
	out.bound = true;
	var a = -q.GMe / (2 * eps), rOther = 2 * a - rRel;
	out.rPer = Math.min(rRel, rOther); out.rApo = Math.max(rRel, rOther);

	var rPer = out.rPer, rApo = out.rApo;
	if (q.targetAlt != null && isFinite(q.targetAlt)) {
		var rEntry = q.Rearth + q.targetAlt;
		if (rEntry < rRel) {
			var a2 = OrbitalMath.semiMajorAxisFromApsis(rEntry, rRel);
			var vBurn = OrbitalMath.visVivaVelocity(q.GMe, rRel, a2);
			out.burn = { dv: vRel - vBurn, vAfter: vBurn };
			rPer = rEntry; rApo = rRel;
		} else {
			out.burn = { dv: 0, vAfter: vRel, noBurn: true };
		}
	}
	var rI = q.Rearth + q.ifaceAlt;
	if (rPer < rI && rI < rApo) {
		var aE = OrbitalMath.semiMajorAxisFromApsis(rPer, rApo);
		var eE = OrbitalMath.eccentricityFromApsis(rPer, rApo);
		var h = Math.sqrt(q.GMe * aE * (1 - eE * eE));
		var vI = OrbitalMath.visVivaVelocity(q.GMe, rI, aE);
		var gamma = Math.acos(Math.min(1, h / (rI * vI)));
		out.entry = { vI: vI, gamma: gamma, peakG: OrbitalMath.allenEggersPeakDecel(vI, gamma, Const.scaleHeight.earth) / Const.g0 };
	} else {
		out.entryNote = "perigee above interface";
	}
	return out;
}

// Rotation rate of the Earth–Moon frame for these inputs, rad/s.
function omega(p) { return omegaOf(p, p.D - p.baryE); }

export const L1Elevator = { omega: omega, findL1: findL1, buildContext: buildContext, loadedMetrics: loadedMetrics, sweepSpeeds: sweepSpeeds, releaseOrbit: releaseOrbit };
