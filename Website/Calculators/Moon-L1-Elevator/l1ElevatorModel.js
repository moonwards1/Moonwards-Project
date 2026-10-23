// Moon–L1 elevator physics, pure (no DOM). ES module:
//   import { L1Elevator } from "./l1ElevatorModel.js";
//
// Shared by the standalone calculator (MoonL1ElevatorCalc.js) and the home
// workbench's cards (l1ElevatorBench.js). README.md derives the model.
//
// r = distance from the Moon's centre, measured toward Earth; Earth at r = D.
// The Earth–Moon system rotates about the barycentre (r = x_b) with angular
// velocity ω; the tidally-locked Moon holds the tether fixed in that frame.
//
// Effective specific force (positive = outward, toward Earth):
//     g(r) =  GMe/(D−r)²  −  GMm/r²  +  ω²(r − x_b)
// Effective potential (g = −dΦ/dr):
//     Φ(r) = −GMm/r − GMe/(D−r) − ½ ω²(r − x_b)²
//
// The cable is sized so its stress is σ_eff = σ_ult / safety everywhere, for
// the worse of its two operating states (empty, full). Distributed loads ride
// on it: cargo λ_cargo (moving, only when loaded) and the track
// λ_min + λ_grav·|g(r)|/g_s (always on). Force balance on an element:
//     dT/dr = −(ρ/σ_eff)·g(r)·T − λ(r)·g(r)
// Linear, so T(r) = M_cw·g(r_cw)·E(r) + λ-weighted unit responses C₁, C_g,
// with E(r) = exp[(ρ/σ_eff)(Φ(r) − Φ(r_cw))] in closed form and C₁, C_g
// integrated (RK4) from the counterweight down to the surface.
//
// Inputs p (SI): Rmoon, D, baryE (barycentre from Earth's centre), GMm, GMe,
// rL1, omegaSrc ("kepler" | "vorb"), Vorb, sig (Pa), rho, safety, rCW, rate
// (t/day), vClimb (m/s), infraPct (% climber tare), trackMin, trackGrav (kg/m).

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";

// Rotation rate of the Earth–Moon frame: Kepler's law, or the Moon's orbital
// speed about the barycentre.
function omegaOf(p, xb) {
	return p.omegaSrc === "vorb" ? p.Vorb / xb : OrbitalMath.angularVelocity(p.GMe + p.GMm, p.D);
}

// L1 in this force field: where g(r) = 0 between the Moon and Earth.
function findL1(p) {
	var xb = p.D - p.baryE, w = omegaOf(p, xb);
	var g = function (r) { return p.GMe / ((p.D - r) * (p.D - r)) - p.GMm / (r * r) + w * w * (r - xb); };
	var lo = p.Rmoon, hi = p.D / 2;
	for (var i = 0; i < 200; i++) {
		var mid = 0.5 * (lo + hi);
		if (g(mid) < 0) lo = mid; else hi = mid;
	}
	return 0.5 * (lo + hi);
}

// The load-aware solution, independent of the counterweight mass.
function buildContext(p) {
	var xb = p.D - p.baryE;
	var sigEff = p.sig / p.safety;
	var omega = omegaOf(p, xb);
	var g = function (r) { return p.GMe / ((p.D - r) * (p.D - r)) - p.GMm / (r * r) + omega * omega * (r - xb); };
	var Phi = function (r) { return -p.GMm / r - p.GMe / (p.D - r) - 0.5 * omega * omega * (r - xb) * (r - xb); };

	// distributed loads, along surface → counterweight
	var L = p.rCW - p.Rmoon;
	var tTrip_s = L / p.vClimb;
	var oncable_kg = (isFinite(p.rate) ? p.rate : 0) * 1e3 * (tTrip_s / 86400);   // payload on the cable
	var infraF = 1 + (isFinite(p.infraPct) ? p.infraPct : 0) / 100;                // + climber tare
	var live_kg = oncable_kg * infraF;             // moving mass (cargo + climbers), only when loaded
	var lamCargo = live_kg / L;                    // kg/m, live load
	var lamMin = isFinite(p.trackMin) ? p.trackMin : 0;    // kg/m, track minimum gauge (always on)
	var lamGrav = isFinite(p.trackGrav) ? p.trackGrav : 0; // kg/m at surface, traction part ∝ |g|

	var PhiCW = Phi(p.rCW), gCW = g(p.rCW), k = p.rho / sigEff;
	var gSurf = Math.abs(g(p.Rmoon));
	var Efn = function (r) { return Math.exp(k * (Phi(r) - PhiCW)); };
	var hfn = function (r) { return Math.abs(g(r)) / gSurf; };   // gravity shape: 1 at surface → ~0 by L1

	// Two unit particular solutions integrated down from the counterweight:
	//   C₁(r):  constant unit load     dC₁/dr = −k·g·C₁ − g
	//   C_g(r): gravity-shaped load     dC_g/dr = −k·g·C_g − h(r)·g
	var N = 20000, dr = (p.Rmoon - p.rCW) / N;
	var f1 = function (r, C) { return -k * g(r) * C - g(r); };
	var fg = function (r, C) { return -k * g(r) * C - hfn(r) * g(r); };
	var r = p.rCW, C1 = 0, Cg = 0, hInt = 0;
	var rs = new Array(N + 1), Cs = new Array(N + 1), Cgs = new Array(N + 1), Es = new Array(N + 1);
	rs[0] = r; Cs[0] = 0; Cgs[0] = 0; Es[0] = 1;
	var C_L1 = null, Cg_L1 = null;
	for (var i = 0; i < N; i++) {
		var a1 = f1(r, C1), b1 = f1(r + dr / 2, C1 + dr / 2 * a1), c1 = f1(r + dr / 2, C1 + dr / 2 * b1), d1 = f1(r + dr, C1 + dr * c1);
		var ag = fg(r, Cg), bg = fg(r + dr / 2, Cg + dr / 2 * ag), cg = fg(r + dr / 2, Cg + dr / 2 * bg), dg = fg(r + dr, Cg + dr * cg);
		var C1n = C1 + dr / 6 * (a1 + 2 * b1 + 2 * c1 + d1), Cgn = Cg + dr / 6 * (ag + 2 * bg + 2 * cg + dg), rn = r + dr;
		hInt += 0.5 * (hfn(r) + hfn(rn)) * Math.abs(rn - r);
		if (C_L1 === null && r >= p.rL1 && rn <= p.rL1) { var t = (p.rL1 - r) / (rn - r); C_L1 = C1 + t * (C1n - C1); Cg_L1 = Cg + t * (Cgn - Cg); }
		r = rn; C1 = C1n; Cg = Cgn; rs[i + 1] = r; Cs[i + 1] = C1; Cgs[i + 1] = Cg; Es[i + 1] = Efn(r);
	}
	var Esurf = Es[N], Csurf = Cs[N], Cgsurf = Cgs[N];
	// Minimum counterweight: full-load surface tension = 0.
	var McwMin = -((lamMin + lamCargo) * Csurf + lamGrav * Cgsurf) / (gCW * Esurf);

	return { xb: xb, sigEff: sigEff, omega: omega, g: g, Phi: Phi, L: L, tTrip_s: tTrip_s,
		oncable_kg: oncable_kg, infraF: infraF, live_kg: live_kg,
		lamCargo: lamCargo, lamMin: lamMin, lamGrav: lamGrav, hInt: hInt, gCW: gCW, Efn: Efn, EL1: Efn(p.rL1),
		C_L1: C_L1, Cg_L1: Cg_L1, Esurf: Esurf, Csurf: Csurf, Cgsurf: Cgsurf, rs: rs, Cs: Cs, Cgs: Cgs, Es: Es, N: N, McwMin: McwMin };
}

// Metrics for a given counterweight mass. Cargo is a live load: tension is
// linear in it, so the worst case at each point is empty or full, and the
// area follows the envelope A(r) = max(T_empty, T_full)/σ_eff. Near the
// surface removing cargo raises the hold-down tension (empty governs); near
// and above L1 the full case governs. The taut check uses the full case.
function loadedMetrics(p, ctx, Mcw) {
	var sigEff = ctx.sigEff, gCW = ctx.gCW, Es = ctx.Es, Cs = ctx.Cs, Cgs = ctx.Cgs, rs = ctx.rs, N = ctx.N;
	var lamCargo = ctx.lamCargo, lamMin = ctx.lamMin, lamGrav = ctx.lamGrav;
	var track = function (i) { return lamMin * Cs[i] + lamGrav * Cgs[i]; };
	var Tempty = function (i) { return Mcw * gCW * Es[i] + track(i); };
	var Tfull = function (i) { return Mcw * gCW * Es[i] + track(i) + lamCargo * Cs[i]; };
	var Aenv = function (i) { return Math.max(Tempty(i), Tfull(i)) / sigEff; };

	var mass = 0, TminFull = Infinity, crossR = null;
	var prof = [];                                  // downsampled (r, A) for a diagram
	var stride = Math.max(1, Math.floor(N / 400));
	for (var i = 0; i <= N; i++) {
		var tf = Tfull(i);
		if (tf < TminFull) TminFull = tf;
		if (crossR === null && i > 0 && Cs[i - 1] >= 0 && Cs[i] < 0) crossR = rs[i];
		if (i % stride === 0 || i === N) prof.push({ r: rs[i], A: Aenv(i) });
		if (i < N) mass += p.rho * 0.5 * (Aenv(i) + Aenv(i + 1)) * Math.abs(rs[i + 1] - rs[i]);
	}
	var Tcw = Mcw * gCW;
	var trackSurf = lamMin * ctx.Csurf + lamGrav * ctx.Cgsurf;
	var trackL1 = lamMin * ctx.C_L1 + lamGrav * ctx.Cg_L1;
	var Tsurf_full = Mcw * gCW * ctx.Esurf + trackSurf + lamCargo * ctx.Csurf;   // smallest: drives the floor
	var Tsurf_empty = Mcw * gCW * ctx.Esurf + trackSurf;                         // what the anchor holds
	var TL1_full = Mcw * gCW * ctx.EL1 + trackL1 + lamCargo * ctx.C_L1;          // peak tension
	var trackMass = lamMin * ctx.L + lamGrav * ctx.hInt;                         // ∫(λ_min + λ_grav·h) dr
	return {
		mass: mass, TminFull: TminFull, crossR: crossR, trackMass: trackMass,
		TsurfHold: Tsurf_empty, Tsurf_full: Tsurf_full, TL1: TL1_full, Tcw: Tcw,
		Acw: Tcw / sigEff,
		Asurf: Math.max(Tsurf_empty, Tsurf_full) / sigEff,
		AL1: Math.max(TL1_full, Mcw * gCW * ctx.EL1 + trackL1) / sigEff,
		prof: prof
	};
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
// q: { GMe, D, rCW, omega, Rearth, ifaceAlt, targetAlt? }. Without targetAlt,
// everything describes the natural orbit: its perigee and, if that perigee
// lies below the entry interface, the entry flight-path angle and peak
// deceleration it arrives with. With targetAlt, `burn` adds the retrograde
// burn at release that lowers perigee to that altitude, and `entry` describes
// that lowered orbit instead.
function releaseOrbit(q) {
	var rRel = q.D - q.rCW, vRel = q.omega * rRel;
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
