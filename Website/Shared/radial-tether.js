// A tether along a straight radial line in a rotating frame, sized so its
// stress is the working strength everywhere. Pure (no DOM). ES module:
//   import { standardField, earthMoonField, tetherContext, tetherMetrics,
//            pullBalance, counterweightFor, radiusAtForce } from "../../Shared/radial-tether.js";
//
// Serves the workbench's radial space elevators: the standard one (a body's
// equator past synchronous orbit) and the Moon's elevators through Earth–Moon
// L1 and L2. Each is the same tether in a different one-dimensional force
// field; the derivation is in Calculators/Moon-L1-Elevator/README.md. The
// off-equator Mars elevator, which bends in two dimensions, is
// Shared/meridian-tether.js; pullBalance and counterweightFor work on its
// solutions too.
//
// A field is { g(r), Phi(r), R, rBalance }:
//   r          distance from the anchoring body's centre along the tether,
//              increasing away from the body
//   g(r)       net specific force in the rotating frame, m/s²; positive points
//              away from the body (outward), negative toward it
//   Phi(r)     the matching potential, g = −dΦ/dr
//   R          the anchoring body's radius (the surface anchor)
//   rBalance   where g = 0: synchronous orbit, or the Lagrange point. g rises
//              monotonically with r in all three fields, so each felt force
//              names one point on each side of it.
//
// Loads on the cable, all linear in tension:
//   counterweight  M at r_cw
//   track          λ_min + λ_grav·|g(r)|/|g(R)| kg/m, always on
//   cargo          λ_cargo kg/m, only while loaded (sizing takes the worse of
//                  empty and full at each point)
//   stations       point masses { r, m }, always on. A station adds
//                  m·g(r_s)·exp[k(Φ(r) − Φ(r_s))] to the tension at every r
//                  between the surface and itself, k = ρ/σ_eff.
//
// Each load's pull at the surface anchor, P = (its force)·exp[k(Φ(R) − Φ(r))],
// is positive when it holds the structure up and negative when it hangs on
// it. The tension at the surface is their sum. pullBalance reports the
// multiple: everything holding up ÷ everything hanging on, the track counted
// as one net load. Tension is lowest at the surface or at the counterweight,
// so a multiple of at least 1 means the cable is taut everywhere.

// ---------------------------------------------------------------------------
// Force fields

// Bisection for g(r) = target on [lo, hi]; g rises with r.
function solveRising(g, target, lo, hi) {
	for (var i = 0; i < 200; i++) {
		var mid = 0.5 * (lo + hi);
		if (g(mid) < target) lo = mid; else hi = mid;
	}
	return 0.5 * (lo + hi);
}

// A body turning at omega (rad/s), tether from its equator outward.
export function standardField(GM, R, omega) {
	var w2 = omega * omega;
	return {
		kind: "standard", R: R,
		g: function (r) { return w2 * r - GM / (r * r); },
		Phi: function (r) { return -GM / r - 0.5 * w2 * r * r; },
		rBalance: Math.cbrt(GM / w2)
	};
}

// The Moon's elevators, in the frame turning with the Earth–Moon system.
// p: { GMm, GMe, D (centre to centre), xb (barycentre's distance from the
// Moon's centre, toward Earth), omega, Rmoon }. side "L1": from the near side
// toward Earth; "L2": from the far side away from it.
export function earthMoonField(side, p) {
	var D = p.D, xb = p.xb, w = p.omega, GMm = p.GMm, GMe = p.GMe;
	var g, Phi;
	if (side === "L2") {
		g = function (r) { return -GMm / (r * r) - GMe / ((D + r) * (D + r)) + w * w * (r + xb); };
		Phi = function (r) { return -GMm / r - GMe / (D + r) - 0.5 * w * w * (r + xb) * (r + xb); };
	} else {
		g = function (r) { return GMe / ((D - r) * (D - r)) - GMm / (r * r) + w * w * (r - xb); };
		Phi = function (r) { return -GMm / r - GMe / (D - r) - 0.5 * w * w * (r - xb) * (r - xb); };
	}
	return { kind: side === "L2" ? "L2" : "L1", R: p.Rmoon, g: g, Phi: Phi, rBalance: solveRising(g, 0, p.Rmoon, D / 2) };
}

// The radius between lo and hi where g(r) = target (signed, m/s²).
export function radiusAtForce(field, target, lo, hi) {
	return solveRising(field.g, target, lo, hi);
}

// ---------------------------------------------------------------------------
// Sizing

// Everything that doesn't depend on the counterweight's mass.
// q: { rCW, rho (kg/m³), sigEff (Pa, strength ÷ safety factor), lamMin,
// lamGrav, lamCargo (kg/m), stations: [{ r, m }], rPeak (where the peak
// tension is read; default the balance point), N (integration steps) }.
// Stations at or beyond the counterweight, or at or below the surface, are
// the caller's to refuse; they are ignored here.
export function tetherContext(field, q) {
	var g = field.g, Phi = field.Phi, R = field.R, rCW = q.rCW;
	var sigEff = q.sigEff, k = q.rho / sigEff;
	var lamMin = isFinite(q.lamMin) ? q.lamMin : 0;
	var lamGrav = isFinite(q.lamGrav) ? q.lamGrav : 0;
	var lamCargo = isFinite(q.lamCargo) ? q.lamCargo : 0;
	var rPeak = isFinite(q.rPeak) ? q.rPeak : field.rBalance;

	var PhiCW = Phi(rCW), gCW = g(rCW);
	var gSurf = Math.abs(g(R));
	var Efn = function (r) { return Math.exp(k * (Phi(r) - PhiCW)); };
	var hfn = function (r) { return Math.abs(g(r)) / gSurf; };   // track shape: 1 at the surface → 0 at balance

	// Two unit responses integrated down from the counterweight (RK4):
	//   C₁(r):  constant unit load      dC₁/dr = −k·g·C₁ − g
	//   C_g(r): gravity-shaped load      dC_g/dr = −k·g·C_g − h(r)·g
	var N = q.N || 20000, dr = (R - rCW) / N;
	var f1 = function (r, C) { return -k * g(r) * C - g(r); };
	var fg = function (r, C) { return -k * g(r) * C - hfn(r) * g(r); };
	var r = rCW, C1 = 0, Cg = 0, hInt = 0;
	var rs = new Array(N + 1), Cs = new Array(N + 1), Cgs = new Array(N + 1), Es = new Array(N + 1);
	rs[0] = r; Cs[0] = 0; Cgs[0] = 0; Es[0] = 1;
	var Cpeak = null, Cgpeak = null;
	for (var i = 0; i < N; i++) {
		var a1 = f1(r, C1), b1 = f1(r + dr / 2, C1 + dr / 2 * a1), c1 = f1(r + dr / 2, C1 + dr / 2 * b1), d1 = f1(r + dr, C1 + dr * c1);
		var ag = fg(r, Cg), bg = fg(r + dr / 2, Cg + dr / 2 * ag), cg = fg(r + dr / 2, Cg + dr / 2 * bg), dg = fg(r + dr, Cg + dr * cg);
		var C1n = C1 + dr / 6 * (a1 + 2 * b1 + 2 * c1 + d1), Cgn = Cg + dr / 6 * (ag + 2 * bg + 2 * cg + dg), rn = r + dr;
		hInt += 0.5 * (hfn(r) + hfn(rn)) * Math.abs(rn - r);
		if (Cpeak === null && r >= rPeak && rn <= rPeak) { var t = (rPeak - r) / (rn - r); Cpeak = C1 + t * (C1n - C1); Cgpeak = Cg + t * (Cgn - Cg); }
		r = rn; C1 = C1n; Cg = Cgn; rs[i + 1] = r; Cs[i + 1] = C1; Cgs[i + 1] = Cg; Es[i + 1] = Efn(r);
	}
	var Esurf = Es[N], Csurf = Cs[N], Cgsurf = Cgs[N];

	// Stations: their force, their taper factor, and their pull at the surface.
	var stations = (q.stations || []).filter(function (s) { return s.r > R && s.r < rCW && s.m > 0; }).map(function (s) {
		var gs = g(s.r), E = Efn(s.r);
		return { r: s.r, m: s.m, g: gs, E: E, P: s.m * gs * Esurf / E };
	});
	var stP = stations.reduce(function (a, s) { return a + s.P; }, 0);

	// Surface pull of the track with cargo aboard (the full case sets the floor).
	var Ptrack = (lamMin + lamCargo) * Csurf + lamGrav * Cgsurf;
	// Minimum counterweight: full-load surface tension = 0.
	var McwMin = Math.max(0, -(Ptrack + stP) / (gCW * Esurf));

	return { field: field, R: R, rCW: rCW, rPeak: rPeak, sigEff: sigEff, rho: q.rho, k: k, g: g, Phi: Phi,
		L: rCW - R, lamMin: lamMin, lamGrav: lamGrav, lamCargo: lamCargo, hInt: hInt, gCW: gCW, Efn: Efn,
		Epeak: Efn(rPeak), Cpeak: Cpeak, Cgpeak: Cgpeak, Esurf: Esurf, Csurf: Csurf, Cgsurf: Cgsurf,
		rs: rs, Cs: Cs, Cgs: Cgs, Es: Es, N: N, stations: stations, Ptrack: Ptrack, McwMin: McwMin };
}

// Surface pulls with a counterweight of Mcw kg: { up, down, mult, Pcw }.
// up holds the structure up, down hangs on it (both ≥ 0); mult = up ÷ down,
// Infinity when nothing hangs on it.
export function pullBalance(ctx, Mcw) {
	var Pcw = Mcw * ctx.gCW * ctx.Esurf, up = Math.max(0, Pcw), down = Math.max(0, -Pcw);
	[ctx.Ptrack].concat(ctx.stations.map(function (s) { return s.P; })).forEach(function (P) {
		if (P > 0) up += P; else down -= P;
	});
	return { up: up, down: down, mult: down > 0 ? up / down : Infinity, Pcw: Pcw };
}

// The smallest counterweight that brings the multiple to `mult` (0 when the
// rest already does).
export function counterweightFor(ctx, mult) {
	var b = pullBalance(ctx, 0);
	return Math.max(0, (mult * b.down - b.up) / (ctx.gCW * ctx.Esurf));
}

// The cable for a counterweight of Mcw kg. Cargo is a live load: tension is
// linear in it, so the worst case at each point is empty or full, and the
// area follows the envelope A(r) = max(T_empty, T_full)/σ_eff. Stations are
// on in both cases.
export function tetherMetrics(ctx, Mcw) {
	var sigEff = ctx.sigEff, gCW = ctx.gCW, Es = ctx.Es, Cs = ctx.Cs, Cgs = ctx.Cgs, rs = ctx.rs, N = ctx.N;
	var lamCargo = ctx.lamCargo, lamMin = ctx.lamMin, lamGrav = ctx.lamGrav, st = ctx.stations;
	// Stations above r_i, carried down to it.
	var stAt = function (i) {
		var s = 0;
		for (var j = 0; j < st.length; j++) if (rs[i] < st[j].r) s += st[j].m * st[j].g * Es[i] / st[j].E;
		return s;
	};
	var track = function (i) { return lamMin * Cs[i] + lamGrav * Cgs[i]; };
	var Tempty = function (i) { return st.length ? Mcw * gCW * Es[i] + track(i) + stAt(i) : Mcw * gCW * Es[i] + track(i); };
	var Aenv = function (i) { var te = Tempty(i); return Math.max(te, te + lamCargo * Cs[i]) / sigEff; };

	var mass = 0, TminFull = Infinity, crossR = null;
	var prof = [];                                  // downsampled (r, A) for a diagram
	var stride = Math.max(1, Math.floor(N / 400));
	var Aprev = Aenv(0);
	for (var i = 0; i <= N; i++) {
		var tf = Tempty(i) + lamCargo * Cs[i];
		if (tf < TminFull) TminFull = tf;
		if (crossR === null && i > 0 && Cs[i - 1] >= 0 && Cs[i] < 0) crossR = rs[i];
		var A = i === 0 ? Aprev : Aenv(i);
		if (i % stride === 0 || i === N) prof.push({ r: rs[i], A: A });
		if (i > 0) mass += ctx.rho * 0.5 * (Aprev + A) * Math.abs(rs[i] - rs[i - 1]);
		Aprev = A;
	}
	var stSurf = 0, stPeak = 0;
	st.forEach(function (s) {
		stSurf += s.m * s.g * ctx.Esurf / s.E;
		if (s.r > ctx.rPeak) stPeak += s.m * s.g * ctx.Epeak / s.E;
	});
	var Tcw = Mcw * gCW;
	var trackSurf = lamMin * ctx.Csurf + lamGrav * ctx.Cgsurf + stSurf;
	var trackPeak = lamMin * ctx.Cpeak + lamGrav * ctx.Cgpeak + stPeak;
	var Tsurf_full = Mcw * gCW * ctx.Esurf + trackSurf + lamCargo * ctx.Csurf;   // smallest: drives the floor
	var Tsurf_empty = Mcw * gCW * ctx.Esurf + trackSurf;                         // what the anchor holds
	var Tpeak_full = Mcw * gCW * ctx.Epeak + trackPeak + lamCargo * ctx.Cpeak;    // peak tension
	var trackMass = lamMin * ctx.L + lamGrav * ctx.hInt;                         // ∫(λ_min + λ_grav·h) dr
	return {
		mass: mass, TminFull: TminFull, crossR: crossR, trackMass: trackMass,
		TsurfHold: Tsurf_empty, Tsurf_full: Tsurf_full, Tpeak: Tpeak_full, Tcw: Tcw,
		Acw: Tcw / sigEff,
		Asurf: Math.max(Tsurf_empty, Tsurf_full) / sigEff,
		Apeak: Math.max(Tpeak_full, Mcw * gCW * ctx.Epeak + trackPeak) / sigEff,
		prof: prof
	};
}
