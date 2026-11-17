// A tether in the meridian plane of a spinning, oblate body: anchored off the
// equator, it bows toward the equatorial plane and runs out to a counterweight
// beyond stationary orbit. Sized so its stress is the working strength
// everywhere. Pure (no DOM). ES module:
//   import { oblateField, areoidRadius, stationaryRadius, solveMeridianTether,
//            trackPull, heightAtRadius, northSouthModes, eastWestLean, leanedTether, mostFlow }
//            from "../../Shared/meridian-tether.js";
//
// The workbench's off-equator Mars elevator stands on this; the derivation is
// in Calculators/Mars-Elevator/README.md. Shared/radial-tether.js is the
// one-dimensional case (a tether on the equator, or through a Lagrange
// point); the pull bookkeeping is the same, so pullBalance and
// counterweightFor from that module work on this module's solutions.
//
// Coordinates: x is distance from the spin axis, z height above the
// equatorial plane, both in m; the plane they span turns with the body.
//
// Loads, all along the tether:
//   cable          its own mass, k·T per metre (k = ρ/σ_eff), since the
//                  cross-section is T/σ_eff everywhere
//   track          λ_min + λ_grav·|f|/|f(anchor)| kg/m, always on
//   stations       point masses { r, m }, placed where the tether is r from
//                  the body's centre
//   counterweight  M at the tip
//
// Equilibrium of a piece of tether: d(T t̂)/ds + λ f = 0, with t̂ the unit
// tangent pointing out along the tether and f the net force per kg in the
// turning frame. Solved downward from the counterweight, where the tension
// vector is M·f (the counterweight hangs on the tether's line, so f there
// must lie along it): with u = −s,
//   dp/du = −t̂,   d(T t̂)/du = λ f,   λ = k·T + λ_track.
// The counterweight's height above the plane is the one unknown; it is
// shot for so the tether meets the surface at the anchor's latitude.

// ---------------------------------------------------------------------------
// The force field

// Gravity of a body with an equatorial bulge (J2), plus the centrifugal term
// of the frame turning with it. GM m³/s², Re m (J2's reference radius),
// omega rad/s. f(x, z) → [fx, fz] m/s²; Phi(x, z) J/kg, f = −∇Φ.
export function oblateField(GM, J2, Re, omega) {
	var w2 = omega * omega, c = GM * J2 * Re * Re / 2;
	return {
		GM: GM, J2: J2, Re: Re, omega: omega,
		f: function (x, z) {
			var r2 = x * x + z * z, r = Math.sqrt(r2), r3 = r2 * r, r5 = r3 * r2, r7 = r5 * r2;
			// Φ₂ = c·(3z²/r⁵ − 1/r³)
			var dPx = c * (3 * x / r5 - 15 * z * z * x / r7);
			var dPz = c * (9 * z / r5 - 15 * z * z * z / r7);
			return [-GM * x / r3 - dPx + w2 * x, -GM * z / r3 - dPz];
		},
		Phi: function (x, z) {
			var r2 = x * x + z * z, r = Math.sqrt(r2);
			return -GM / r + c * (3 * z * z / (r2 * r2 * r) - 1 / (r2 * r)) - 0.5 * w2 * x * x;
		}
	};
}

// Distance from the centre to the reference ellipsoid at latitude lat (rad).
export function areoidRadius(Req, Rpol, lat) {
	var c = Math.cos(lat), s = Math.sin(lat);
	return Req * Rpol / Math.sqrt(Rpol * Rpol * c * c + Req * Req * s * s);
}

// Stationary orbit in the equatorial plane, where the outward pull vanishes.
export function stationaryRadius(field) {
	var lo = field.Re, hi = 100 * field.Re;
	for (var i = 0; i < 200; i++) {
		var mid = 0.5 * (lo + hi);
		if (field.f(mid, 0)[0] < 0) lo = mid; else hi = mid;
	}
	return 0.5 * (lo + hi);
}

// ---------------------------------------------------------------------------
// Sizing

var MAX_STEPS = 400000;

// One downward pass from a counterweight at height zc. Returns where it meets
// the anchor's sphere and, with keep, the whole path (anchor last).
function descend(field, q, zc, keep) {
	var F = field.f, rA = q.rA, rCW = q.rCW, k = q.k, lamMin = q.lamMin, lamGrav = q.lamGrav, gS = q.gS;
	var x = Math.sqrt(rCW * rCW - zc * zc), z = zc;
	var f0 = F(x, z), Fx = q.M * f0[0], Fz = q.M * f0[1], m = 0, mt = 0, u = 0;
	var st = q.stations, si = 0;
	var P = keep ? { x: [x], z: [z], Fx: [Fx], Fz: [Fz], u: [0] } : null, jumps = [];

	function deriv(X, Z, FX, FZ) {
		var T = Math.sqrt(FX * FX + FZ * FZ), f = F(X, Z), fm = Math.sqrt(f[0] * f[0] + f[1] * f[1]);
		var lt = lamMin + lamGrav * fm / gS, lam = k * T + lt;
		return [-FX / T, -FZ / T, lam * f[0], lam * f[1], k * T, lt];
	}
	var r = rCW;
	for (var n = 0; n < MAX_STEPS; n++) {
		var du = Math.min(20e3, 200 + 0.002 * (r - rA));
		var a = deriv(x, z, Fx, Fz);
		var b = deriv(x + du / 2 * a[0], z + du / 2 * a[1], Fx + du / 2 * a[2], Fz + du / 2 * a[3]);
		var c = deriv(x + du / 2 * b[0], z + du / 2 * b[1], Fx + du / 2 * b[2], Fz + du / 2 * b[3]);
		var d = deriv(x + du * c[0], z + du * c[1], Fx + du * c[2], Fz + du * c[3]);
		var xn = x + du / 6 * (a[0] + 2 * b[0] + 2 * c[0] + d[0]);
		var zn = z + du / 6 * (a[1] + 2 * b[1] + 2 * c[1] + d[1]);
		var Fxn = Fx + du / 6 * (a[2] + 2 * b[2] + 2 * c[2] + d[2]);
		var Fzn = Fz + du / 6 * (a[3] + 2 * b[3] + 2 * c[3] + d[3]);
		var mn = m + du / 6 * (a[4] + 2 * b[4] + 2 * c[4] + d[4]);
		var mtn = mt + du / 6 * (a[5] + 2 * b[5] + 2 * c[5] + d[5]);
		var rn = Math.sqrt(xn * xn + zn * zn);
		// Tension gone: the counterweight can't hold up what hangs below it.
		if (!(Fxn * Fxn + Fzn * Fzn > 0) || (Fxn * xn + Fzn * zn) <= 0) return { ok: false, lat: NaN, slack: true };
		if (rn <= rA) {
			// Stop on the anchor's sphere, interpolating within the step.
			var t = (r - rA) / (r - rn);
			x += t * (xn - x); z += t * (zn - z); Fx += t * (Fxn - Fx); Fz += t * (Fzn - Fz);
			m += t * (mn - m); mt += t * (mtn - mt); u += t * du;
			if (keep) { P.x.push(x); P.z.push(z); P.Fx.push(Fx); P.Fz.push(Fz); P.u.push(u); }
			return { ok: true, lat: Math.atan2(z, x), x: x, z: z, Fx: Fx, Fz: Fz, mass: m, trackMass: mt, length: u, path: P, jumps: jumps };
		}
		x = xn; z = zn; Fx = Fxn; Fz = Fzn; m = mn; mt = mtn; u += du;
		// A station passed in this step: its weight joins the tension vector.
		while (si < st.length && st[si].r >= rn) {
			if (st[si].r < r) {
				var fs = F(x, z), Tb = Math.sqrt(Fx * Fx + Fz * Fz);
				var ft = (fs[0] * Fx + fs[1] * Fz) / Tb;
				Fx += st[si].m * fs[0]; Fz += st[si].m * fs[1];
				jumps.push({ r: st[si].r, m: st[si].m, x: x, z: z, ft: ft, g: ft, u: u });
			}
			si++;
		}
		r = rn;
		if (keep) { P.x.push(x); P.z.push(z); P.Fx.push(Fx); P.Fz.push(Fz); P.u.push(u); }
		if (rn > rCW * 1.5) break;
	}
	return { ok: false, lat: NaN };
}

// Solve the tether. field from oblateField; q:
//   latA, rA     the anchor's latitude (rad) and distance from the centre (m)
//   rCW          the counterweight's distance from the centre (m)
//   M            counterweight mass (kg)
//   rho, sigEff  cable density (kg/m³) and working strength (Pa)
//   lamMin, lamGrav   track gauges (kg/m)
//   stations     [{ r, m }] (m, kg); those outside the anchor–counterweight span are ignored
//   zGuess       optional starting guess for the counterweight's height (m)
// Returns { ok: false, why } or the solution: geometry, tensions, masses,
// the path (anchor first), and the pull bookkeeping radial-tether.js's
// pullBalance / counterweightFor read (gCW, Esurf, Ptrack, stations[].P).
export function solveMeridianTether(field, q) {
	var rA = q.rA, latA = q.latA, xA = rA * Math.cos(latA), zA = rA * Math.sin(latA);
	var fA = field.f(xA, zA);
	var gS = Math.sqrt(fA[0] * fA[0] + fA[1] * fA[1]);
	var k = q.rho / q.sigEff;
	var stations = (q.stations || []).filter(function (s) { return s.r > rA && s.r < q.rCW && s.m > 0; })
		.slice().sort(function (a, b) { return b.r - a.r; });
	var Q = { rA: rA, rCW: q.rCW, M: q.M, k: k, lamMin: q.lamMin || 0, lamGrav: q.lamGrav || 0, gS: gS, stations: stations };

	if (!(q.M > 0)) return { ok: false, why: "mass" };
	// The counterweight must be pulled outward, or it can't hold the tether up.
	var fz0 = field.f(q.rCW, 0);
	if (!(fz0[0] > 0)) return { ok: false, why: "inside" };

	function miss(z) { var d = descend(field, Q, z, false); return d.ok ? d.lat - latA : NaN; }

	// Bracket the counterweight's height, stepping from the guess toward the
	// anchor's latitude. Too far off the plane and the tether swings past the
	// pole instead of landing; a step that does so is halved and retried.
	var z0 = isFinite(q.zGuess) ? q.zGuess : 0, g0 = miss(z0);
	if (!isFinite(g0)) { z0 = 0; g0 = miss(0); }
	if (!isFinite(g0)) return { ok: false, why: "reach" };
	var dir = g0 < 0 ? 1 : -1, step = 20e3, prev = z0, gprev = g0, lo, hi, glo, ghi, found = g0 === 0;
	if (found) { lo = hi = z0; glo = ghi = 0; }
	for (var i = 0; i < 300 && !found; i++) {
		var zn = prev + dir * step, gn = Math.abs(zn) < q.rCW * 0.5 ? miss(zn) : NaN;
		if (!isFinite(gn)) { step /= 2; if (step < 1) break; continue; }
		if (gn * gprev <= 0) {
			found = true;
			if (dir > 0) { lo = prev; glo = gprev; hi = zn; ghi = gn; } else { lo = zn; glo = gn; hi = prev; ghi = gprev; }
		} else { prev = zn; gprev = gn; step *= 1.6; }
	}
	if (!found) return { ok: false, why: "reach" };
	if (lo === hi) { var d0 = descend(field, Q, lo, true); return d0.ok ? finish(field, Q, d0, lo, latA) : { ok: false, why: "reach" }; }

	// Illinois false position.
	var side = 0, zc = lo, gc = glo;
	for (var it = 0; it < 80; it++) {
		zc = (lo * ghi - hi * glo) / (ghi - glo);
		gc = miss(zc);
		if (!isFinite(gc)) { zc = 0.5 * (lo + hi); gc = miss(zc); }
		if (Math.abs(gc) < 1e-11 || hi - lo < 0.01) break;
		if (gc * ghi > 0) { hi = zc; ghi = gc; if (side === -1) glo /= 2; side = -1; }
		else { lo = zc; glo = gc; if (side === 1) ghi /= 2; side = 1; }
	}
	var d = descend(field, Q, zc, true);
	if (!d.ok) return { ok: false, why: "reach" };
	return finish(field, Q, d, zc, latA);
}

// Tensions, masses, path and pulls from the converged downward pass.
function finish(field, Q, d, zc, latA) {
	var P = d.path, n = P.x.length, Phi = field.Phi, F = field.f, k = Q.k;
	var PhiA = Phi(d.x, d.z);
	// Reverse to anchor-first order.
	var x = new Float64Array(n), z = new Float64Array(n), T = new Float64Array(n), s = new Float64Array(n);
	var tx = new Float64Array(n), tz = new Float64Array(n), ft = new Float64Array(n), fn = new Float64Array(n);
	var lam = new Float64Array(n), w = new Float64Array(n), r = new Float64Array(n);
	var L = d.length, Tpeak = 0, iPeak = 0, Ptrack = 0;
	for (var j = 0; j < n; j++) {
		var i = n - 1 - j;
		x[j] = P.x[i]; z[j] = P.z[i]; r[j] = Math.sqrt(x[j] * x[j] + z[j] * z[j]);
		var Fx = P.Fx[i], Fz = P.Fz[i], Tj = Math.sqrt(Fx * Fx + Fz * Fz);
		T[j] = Tj; tx[j] = Fx / Tj; tz[j] = Fz / Tj; s[j] = L - P.u[i];
		var f = F(x[j], z[j]), fm = Math.sqrt(f[0] * f[0] + f[1] * f[1]);
		ft[j] = f[0] * tx[j] + f[1] * tz[j];
		fn[j] = -f[0] * tz[j] + f[1] * tx[j];          // across the tether, toward its north side (n̂ = t̂ turned +90°)
		var lt = Q.lamMin + Q.lamGrav * fm / Q.gS;
		lam[j] = k * Tj + lt;
		w[j] = Math.exp(k * (PhiA - Phi(x[j], z[j])));
		if (Tj > Tpeak) { Tpeak = Tj; iPeak = j; }
		if (j > 0) {
			var ltp = Q.lamMin + Q.lamGrav * Math.sqrt(sqr(F(x[j - 1], z[j - 1]))) / Q.gS;
			Ptrack += 0.5 * (lt * ft[j] * w[j] + ltp * ft[j - 1] * w[j - 1]) * (s[j] - s[j - 1]);
		}
	}
	var xc = x[n - 1], fc = F(xc, zc), gCW = Math.sqrt(sqr(fc)), Esurf = w[n - 1];
	var stations = d.jumps.map(function (jp) {
		var E = Math.exp(k * (PhiA - Phi(jp.x, jp.z)));
		return { r: jp.r, m: jp.m, g: jp.ft, P: jp.m * jp.ft * E };
	});
	var stP = stations.reduce(function (a, st) { return a + st.P; }, 0);
	var McwMin = Math.max(0, -(Ptrack + stP) / (gCW * Esurf));
	var elev = Math.asin((tx[0] * x[0] + tz[0] * z[0]) / r[0]);
	return {
		ok: true, latA: latA, rA: Q.rA, rCW: Q.rCW, M: Q.M, k: k, zCW: zc, xCW: xc,
		departure: elev, length: L,
		T0: T[0], Tcw: Q.M * gCW, Tpeak: Tpeak, rPeak: r[iPeak], zPeak: z[iPeak],
		mass: d.mass, trackMass: d.trackMass,
		gCW: gCW, Esurf: Esurf, Ptrack: Ptrack, stations: stations, McwMin: McwMin,
		path: { x: x, z: z, r: r, s: s, T: T, tx: tx, tz: tz, ft: ft, fn: fn, lam: lam, w: w }
	};
}

function sqr(v) { return v[0] * v[0] + v[1] * v[1]; }

// The track's pull at the anchor along a solved path, for gauges other than
// the ones it was solved with (positive holds the structure up, negative
// hangs on it): ∫ λ_track (f·t̂) w ds. A first estimate of the counterweight
// comes from it on the bare cable's shape, which doesn't depend on the mass.
export function trackPull(sol, lamMin, lamGrav) {
	var p = sol.path, n = p.s.length, gS = Math.sqrt(p.ft[0] * p.ft[0] + p.fn[0] * p.fn[0]), P = 0, prev = 0;
	for (var i = 0; i < n; i++) {
		var fm = Math.sqrt(p.ft[i] * p.ft[i] + p.fn[i] * p.fn[i]);
		var v = (lamMin + lamGrav * fm / gS) * p.ft[i] * p.w[i];
		if (i > 0) P += 0.5 * (v + prev) * (p.s[i] - p.s[i - 1]);
		prev = v;
	}
	return P;
}

// Height above the equatorial plane (m) where the tether is r from the
// centre, or NaN beyond its ends.
export function heightAtRadius(sol, R) {
	var p = sol.path;
	for (var i = 1; i < p.r.length; i++) {
		if (p.r[i] >= R && p.r[i - 1] < R) {
			var t = (R - p.r[i - 1]) / (p.r[i] - p.r[i - 1]);
			return p.z[i - 1] + t * (p.z[i] - p.z[i - 1]);
		}
	}
	return NaN;
}

// ---------------------------------------------------------------------------
// The westward lean of steady upward traffic

// Cargo climbing the tether has to be brought up to the speed of the ground
// beneath it, ω·x, and it is the tether that does that, pushing it east. The
// cargo pushes back: on each metre of distance from the spin axis that it
// climbs, the tether feels a push west of
//
//     q = 2 ṁ ω    N per m of x
//
//     ṁ   net cargo flow up the tether, kg/s
//     ω   the body's spin rate
//
// whatever the climbers' speed (it is the Coriolis force on the cargo, ṁ/v
// kg on each metre moving out at v). The tether leans west under it, held by
// its tension and by the field: a point moved y west, at distance x from the
// axis, is pulled on west by f_x·y/x per kg (f_x the field's part directed
// away from the axis, inward below stationary orbit and outward beyond). So
//
//     d/ds( T dy/ds ) + λ (f_x / x) y + q dx/ds = 0
//
// with y = 0 at the anchor and the counterweight a point mass. A turn of the
// whole tether about the axis, y = θ·x, costs nothing in this (it is the same
// tether, turned), so the anchor alone holds the lean: its tension's sideways
// part, times its distance from the axis, carries the whole torque
//
//     ṁ ω ( x_c² − x_A² )
//
// and the tether stands nearly as a straight turn about the axis, west of its
// anchor's meridian.
//
// The cargo on the tether is ṁ/v kg on each metre, a live load the cable was
// not sized for. Below stationary orbit its weight pulls down, so the
// tension at the anchor falls; beyond, it pulls out. T here is the tension
// with it aboard. The cargo's small effect on the tether's shape in its own
// meridian plane is left out, and the deflections are taken as small: past
// about 20° of lean at the anchor the result understates it.
//
// q: { mdot (kg/s, net upward), v (the climbers' speed, m/s), minSpacing (m,
// default 5 km) }. Returns
//   ok           false when the cargo's weight takes the tension at the anchor
//                to zero (`why: "slack"`); mdotMax is then the flow at which
//                that happens (Infinity when it never does)
//   nodes        { r, s, x, y }: points along the tether, anchor first, with
//                y the westward displacement there (m)
//   lean         the angle west of the anchor's meridian at the anchor, rad
//   side         the sideways force on the anchor, N
//   torque       ṁ ω ( x_c² − x_A² ), N·m
//   T0, dT0      the tension at the anchor with the cargo aboard, and the
//                cargo's share of it (N)
//   Tpeak        the peak tension with the cargo aboard, N
//   cargo        the cargo on the tether at once, kg
//   mdotMax      the flow that would take the tension at the anchor to zero
export function eastWestLean(field, sol, q) {
	var mdot = q.mdot || 0, v = q.v, minDs = q.minSpacing || 5e3, om = field.omega;
	var p = sol.path, n = p.s.length, lc = mdot / v;
	// The cargo's share of the tension, from the counterweight down: per kg/s of flow, then scaled.
	var dT = new Float64Array(n), Tpk = 0;
	for (var i = n - 2; i >= 0; i--) { dT[i] = dT[i + 1] + 0.5 * (p.ft[i] + p.ft[i + 1]) * (p.s[i + 1] - p.s[i]) / v; }
	var perFlow = dT[0], mdotMax = perFlow < 0 ? -p.T[0] / perFlow : Infinity;
	for (var i = 0; i < n; i++) { dT[i] *= mdot; Tpk = Math.max(Tpk, p.T[i] + dT[i]); }
	var base = { torque: mdot * om * (p.x[n - 1] * p.x[n - 1] - p.x[0] * p.x[0]), T0: p.T[0] + dT[0], dT0: dT[0],
		Tpeak: Tpk, cargo: lc * p.s[n - 1], mdotMax: mdotMax };
	if (!(base.T0 > 0)) { return Object.assign({ ok: false, why: "slack" }, base); }

	var idx = [0];
	for (var i = 1; i < n - 1; i++) if (p.s[i] - p.s[idx[idx.length - 1]] >= minDs) idx.push(i);
	if (p.s[n - 1] - p.s[idx[idx.length - 1]] < minDs * 0.5 && idx.length > 1) idx.pop();
	idx.push(n - 1);
	var N = idx.length, k = new Float64Array(N - 1), mass = new Float64Array(N), load = new Float64Array(N), K = new Float64Array(N);
	for (var j = 0; j < N - 1; j++) {
		var a = idx[j], b = idx[j + 1], ds = p.s[b] - p.s[a];
		k[j] = 0.5 * (p.T[a] + dT[a] + p.T[b] + dT[b]) / ds;
		var mseg = 0;
		for (var r = a; r < b; r++) mseg += (0.5 * (p.lam[r] + p.lam[r + 1]) + lc) * (p.s[r + 1] - p.s[r]);
		mass[j] += mseg / 2; mass[j + 1] += mseg / 2;
		var push = 2 * mdot * om * (p.x[b] - p.x[a]);
		load[j] += push / 2; load[j + 1] += push / 2;
	}
	mass[N - 1] += sol.M;
	for (var j = 0; j < N; j++) { var ii = idx[j]; K[j] = field.f(p.x[ii], p.z[ii])[0] / p.x[ii]; }
	// Free nodes 1..N−1: (k_{j−1} + k_j − m_j K_j) y_j − k_{j−1} y_{j−1} − k_j y_{j+1} = load_j.
	var dim = N - 1, cp = new Float64Array(dim), dp = new Float64Array(dim), y = new Float64Array(N);
	for (var j = 1; j < N; j++) {
		var lo = -k[j - 1], up = j < N - 1 ? -k[j] : 0, dg = k[j - 1] + (j < N - 1 ? k[j] : 0) - mass[j] * K[j];
		var t = j - 1, den = dg - (t > 0 ? lo * cp[t - 1] : 0);
		cp[t] = up / den;
		dp[t] = (load[j] - (t > 0 ? lo * dp[t - 1] : 0)) / den;
	}
	y[N - 1] = dp[dim - 1];
	for (var t = dim - 2; t >= 0; t--) y[t + 1] = dp[t] - cp[t] * y[t + 2];
	var nodes = { r: new Float64Array(N), s: new Float64Array(N), x: new Float64Array(N), y: y };
	for (var j = 0; j < N; j++) { var ii = idx[j]; nodes.r[j] = p.r[ii]; nodes.s[j] = p.s[ii]; nodes.x[j] = p.x[ii]; }
	var ds0 = nodes.s[1] - nodes.s[0];
	return Object.assign({ ok: true, nodes: nodes, lean: Math.atan2(y[1], ds0), side: k[0] * y[1] }, base);
}

// The same lean without the small-deflection approximation: the tether's
// equilibrium in three dimensions, in the frame turning with the body, with
// the cargo aboard. x points from the spin axis toward the anchor's meridian,
// y east, z north. On each metre of tether
//
//     d(T t̂)/ds + (λ + ṁ/v) f − 2 ṁ ω (ẑ × t̂) = 0
//
//     λ        the cable and its track, kg/m, as sized with no cargo: the
//              cable at each distance from the body's centre keeps its
//              cross-section
//     ṁ/v      the cargo on that metre
//     f        gravity and spin, per kg, at the point (oblate field)
//     ẑ × t̂    east, for a tether pointing out; the term is the cargo's
//              push west, 2ṁω per metre of distance from the axis it climbs
//
// The counterweight is held at its design distance from the body's centre,
// as in the sizing, the tether taking up or paying out what length it needs
// there; where on that sphere it hangs is what is solved for. From a guess
// at its latitude and longitude the tether is integrated down from it,
// starting from the tension M·f there, to the anchor's distance from the
// centre, and the guess is moved (Newton's method, differences for the
// slopes) until the tether ends at the anchor. The small-deflection lean
// (eastWestLean) gives the first guess; a flow that defeats it is reached in
// steps up from a small one. The cargo's own turning along the curved tether
// (ṁ·v·dt̂/ds) is left out: under half a percent of the tension.
//
// q: { mdot (kg/s), v (the climbers' speed, m/s), guess (optional: the
// counterweight's [lat, lon] from a nearby flow, rad), noRamp (true: try
// only the guesses, not the steps up from a small flow) }. Returns
//   ok         false with why: "ground" (the tether would leave the anchor
//              below level) or "reach" (no tether from the counterweight's
//              sphere lands at the anchor under this load)
//   path       { s, x, y, z, r, T } anchor first
//   cw         the counterweight's position [x, y, z] (m), and cwAngles
//              [lat, lon] (rad) to start a nearby flow from
//   T0, Tpeak  the tension at the anchor and the peak, N
//   lean       the angle west of the anchor's meridian at which the tether
//              leaves the anchor, rad: asin of the westward part of t̂ there
//   side       the sideways pull on the anchor, T0·sin(lean), N
//   elevation  how far above level the tether leaves the anchor, rad
//   torque     ṁ ω ( x_c² − x_A² ), N·m
//   length, cargo   the tether's length, and the kg of cargo on it at once
export function leanedTether(field, sol, q) {
	var mdot = q.mdot || 0, v = q.v, om = field.omega, M = sol.M, rCW = sol.rCW;
	var p = sol.path, n = p.s.length, lc = mdot / v, rA = p.r[0];
	var latA = Math.atan2(p.z[0], p.x[0]);
	function f3(X) {
		var rho = Math.sqrt(X[0] * X[0] + X[1] * X[1]), g = field.f(rho, X[2]);
		return [g[0] * X[0] / rho, g[0] * X[1] / rho, g[1]];
	}
	// The cable and track per metre at distance R from the centre, as sized.
	function lamAt(R) {
		if (R <= p.r[0]) { return p.lam[0]; }
		if (R >= p.r[n - 1]) { return p.lam[n - 1]; }
		var lo = 0, hi = n - 1;
		while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (p.r[mid] < R) { lo = mid; } else { hi = mid; } }
		return p.lam[lo] + (R - p.r[lo]) / (p.r[hi] - p.r[lo]) * (p.lam[hi] - p.lam[lo]);
	}
	function d(X, F) {
		var T = Math.sqrt(F[0] * F[0] + F[1] * F[1] + F[2] * F[2]), t = [F[0] / T, F[1] / T, F[2] / T];
		var f = f3(X), lam = lamAt(Math.sqrt(X[0] * X[0] + X[1] * X[1] + X[2] * X[2])) + lc, c = 2 * mdot * om;
		return [-t[0], -t[1], -t[2], lam * f[0] + c * t[1], lam * f[1] - c * t[0], lam * f[2]];
	}
	function at(ang) { var cl = Math.cos(ang[0]); return [rCW * cl * Math.cos(ang[1]), rCW * cl * Math.sin(ang[1]), rCW * Math.sin(ang[0])]; }
	// Down the tether from the counterweight at angles ang to the anchor's
	// distance from the centre. keep: record the path (counterweight first).
	function shoot(ang, keep) {
		var X = at(ang), fc = f3(X), F = [M * fc[0], M * fc[1], M * fc[2]], u = 0, r = rCW;
		var P = keep ? { x: [X[0]], y: [X[1]], z: [X[2]], T: [Math.sqrt(F[0] * F[0] + F[1] * F[1] + F[2] * F[2])], u: [0] } : null;
		for (var it = 0; it < MAX_STEPS; it++) {
			var h = Math.min(20e3, 200 + 0.002 * (r - rA));
			var a = d(X, F);
			var b = d([X[0] + h / 2 * a[0], X[1] + h / 2 * a[1], X[2] + h / 2 * a[2]], [F[0] + h / 2 * a[3], F[1] + h / 2 * a[4], F[2] + h / 2 * a[5]]);
			var c = d([X[0] + h / 2 * b[0], X[1] + h / 2 * b[1], X[2] + h / 2 * b[2]], [F[0] + h / 2 * b[3], F[1] + h / 2 * b[4], F[2] + h / 2 * b[5]]);
			var e = d([X[0] + h * c[0], X[1] + h * c[1], X[2] + h * c[2]], [F[0] + h * c[3], F[1] + h * c[4], F[2] + h * c[5]]);
			var Xn = [], Fn = [];
			for (var j = 0; j < 3; j++) {
				Xn.push(X[j] + h / 6 * (a[j] + 2 * b[j] + 2 * c[j] + e[j]));
				Fn.push(F[j] + h / 6 * (a[j + 3] + 2 * b[j + 3] + 2 * c[j + 3] + e[j + 3]));
			}
			var rn = Math.sqrt(Xn[0] * Xn[0] + Xn[1] * Xn[1] + Xn[2] * Xn[2]);
			// Slack: the tension has turned to push rather than pull.
			if (!(Fn[0] * Xn[0] + Fn[1] * Xn[1] + Fn[2] * Xn[2] > 0)) { return null; }
			if (rn <= rA) {
				var t = (r - rA) / (r - rn);
				for (var j = 0; j < 3; j++) { X[j] += t * (Xn[j] - X[j]); F[j] += t * (Fn[j] - F[j]); }
				u += t * h;
				if (keep) { P.x.push(X[0]); P.y.push(X[1]); P.z.push(X[2]); P.T.push(Math.sqrt(F[0] * F[0] + F[1] * F[1] + F[2] * F[2])); P.u.push(u); }
				return { X: X, F: F, length: u, path: P };
			}
			X = Xn; F = Fn; r = rn; u += h;
			if (keep) { P.x.push(X[0]); P.y.push(X[1]); P.z.push(X[2]); P.T.push(Math.sqrt(F[0] * F[0] + F[1] * F[1] + F[2] * F[2])); P.u.push(u); }
			if (rn > rCW * 1.5) { return null; }
		}
		return null;
	}
	// Where the tether ends against the anchor: latitude and longitude missed.
	function miss(ang) {
		var r = shoot(ang, false);
		return r ? [Math.atan2(r.X[2], Math.hypot(r.X[0], r.X[1])) - latA, Math.atan2(r.X[1], r.X[0])] : null;
	}
	function size(m) { return Math.hypot(m[0], m[1]); }
	var TOL = 1e-9;                                          // rad: a few metres on the ground
	function settle(ang) {
		var res = miss(ang);
		for (var it = 0; it < 30 && res; it++) {
			if (size(res) < TOL) { return ang; }
			var hd = 1e-6, J = [];
			for (var k = 0; k < 2; k++) {
				var ak = ang.slice(); ak[k] += hd;
				var rk = miss(ak);
				if (!rk) { return null; }
				J.push([(rk[0] - res[0]) / hd, (rk[1] - res[1]) / hd]);   // column k
			}
			var det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
			if (!(Math.abs(det) > 0)) { return null; }
			var dA = [(res[0] * J[1][1] - J[1][0] * res[1]) / det, (J[0][0] * res[1] - res[0] * J[0][1]) / det];
			var step = 1, next = null, rn = null;
			for (var tries = 0; tries < 14; tries++) {
				next = [ang[0] - step * dA[0], ang[1] - step * dA[1]];
				rn = miss(next);
				if (rn && size(rn) < size(res)) { break; }
				step /= 2; rn = null;
			}
			if (!rn) { return null; }
			ang = next; res = rn;
		}
		return res && size(res) < TOL ? ang : null;
	}
	// The first guess, from the small-deflection lean at this flow.
	function guess(flow) {
		var ew = eastWestLean(field, sol, { mdot: flow, v: v }), nd = ew.nodes, k = nd ? nd.x.length - 1 : 0;
		return [Math.asin(sol.zCW / rCW), nd ? -nd.y[k] / nd.x[k] : 0];
	}
	var ang = q.guess ? settle(q.guess.slice()) : null;
	if (!ang) { ang = settle(guess(mdot)); }
	if (!ang && mdot > 0 && !q.noRamp) {
		// In steps up from a small flow, each from the last, the step
		// shrinking where one fails.
		var target = mdot, flow = target / 64, as = null, step = 0.5;
		mdot = flow; lc = mdot / v; as = settle(guess(flow));
		while (as && flow < target && step > 1e-3) {
			var next = Math.min(target, flow * (1 + step));
			mdot = next; lc = mdot / v;
			var tried = settle(as.slice());
			if (tried) { flow = next; as = tried; } else { step /= 2; }
		}
		mdot = target; lc = mdot / v; ang = as && flow >= target ? as : null;
	}
	if (!ang) { return { ok: false, why: "reach" }; }
	var r = shoot(ang, true), P = r.path, m = P.x.length, L = r.length;
	var out = { s: new Float64Array(m), x: new Float64Array(m), y: new Float64Array(m), z: new Float64Array(m), r: new Float64Array(m), T: new Float64Array(m) };
	var Tpk = 0;
	for (var i = 0; i < m; i++) {
		var j = m - 1 - i;
		out.s[i] = L - P.u[j]; out.x[i] = P.x[j]; out.y[i] = P.y[j]; out.z[i] = P.z[j]; out.T[i] = P.T[j];
		out.r[i] = Math.sqrt(P.x[j] * P.x[j] + P.y[j] * P.y[j] + P.z[j] * P.z[j]);
		Tpk = Math.max(Tpk, P.T[j]);
	}
	var T0 = out.T[0], t0 = [r.F[0] / T0, r.F[1] / T0, r.F[2] / T0];   // along the tether, at the anchor
	var X0 = r.X, up = [X0[0] / rA, X0[1] / rA, X0[2] / rA];
	// The anchor's own east: the turning tether is solved in the anchor's meridian.
	var east = [-Math.sin(Math.atan2(X0[1], X0[0])), Math.cos(Math.atan2(X0[1], X0[0])), 0];
	var westPart = -(t0[0] * east[0] + t0[1] * east[1]);
	var C = at(ang), xA = Math.hypot(X0[0], X0[1]);
	var res = { ok: true, path: out, cw: C, cwAngles: ang, T0: T0, Tpeak: Tpk,
		lean: Math.asin(Math.max(-1, Math.min(1, westPart))), side: westPart * T0,
		elevation: Math.asin(t0[0] * up[0] + t0[1] * up[1] + t0[2] * up[2]),
		torque: mdot * om * (C[0] * C[0] + C[1] * C[1] - xA * xA), length: L, cargo: lc * L };
	if (!(res.elevation > 0)) { return Object.assign(res, { ok: false, why: "ground" }); }
	return res;
}

// The most net flow up the tether that leanedTether finds an equilibrium for,
// kg/s, to within `tol` (default 0.5%) as the search sees it; near the
// limit, where the tether leaves the anchor nearly level, an equilibrium can
// still be found a few percent further on by creeping up on it more finely,
// so the figure is a little on the safe side. As the flow rises, the cargo's weight
// and push together draw the bottom of the tether down toward the ground; by
// this flow it leaves the anchor only a few degrees above level (`at`'s
// elevation says how much), and past it no equilibrium holds it up. q.accept(result), when given, can stop it sooner: a flow
// whose equilibrium it turns down counts as one past the most. Found by
// stepping the flow up from `from` (default 1 kg/s), each step starting from
// the last equilibrium, the step shrinking at each failure.
// q: { v, from, tol, max (kg/s, default 1e4), accept }. Returns { flow, at:
// leanedTether's result there, by: "ground" | "accept" (what stopped it) }.
export function mostFlow(field, sol, q) {
	var v = q.v, tol = q.tol || 0.005, max = q.max || 1e4, flow = q.from || 1, last = null, guess = null, by = "ground";
	function ok(L) {
		if (!L.ok) { return false; }
		if (q.accept && !q.accept(L)) { by = "accept"; return false; }
		return true;
	}
	var first = leanedTether(field, sol, { mdot: flow, v: v });
	while (!ok(first) && flow > 0.01) { flow /= 4; first = leanedTether(field, sol, { mdot: flow, v: v }); }
	if (!ok(first)) { return { flow: 0, at: null, by: by }; }
	last = first; guess = first.cwAngles;
	var step = 0.5;                                    // as a fraction of the flow
	while (step > tol && flow < max) {
		var next = Math.min(max, flow * (1 + step)), L = leanedTether(field, sol, { mdot: next, v: v, guess: guess, noRamp: true });
		if (L.ok && (!q.accept || q.accept(L))) { flow = next; last = L; guess = L.cwAngles; }
		else { by = L.ok ? "accept" : "ground"; step /= 2; }
	}
	return { flow: flow, at: last, by: by };
}

// x solving the 3 × 3 system whose columns are J[0], J[1], J[2]: J x = b.
function solve3(J, b) {
	var a = J[0], c = J[1], e = J[2];
	var det = a[0] * (c[1] * e[2] - c[2] * e[1]) - c[0] * (a[1] * e[2] - a[2] * e[1]) + e[0] * (a[1] * c[2] - a[2] * c[1]);
	if (!(Math.abs(det) > 0)) { return null; }
	function d3(u, w, z) { return u[0] * (w[1] * z[2] - w[2] * z[1]) - w[0] * (u[1] * z[2] - u[2] * z[1]) + z[0] * (u[1] * w[2] - u[2] * w[1]); }
	return [d3(b, c, e) / det, d3(a, b, e) / det, d3(a, c, b) / det];
}

// ---------------------------------------------------------------------------
// North–south swings

// The tether's slowest swings in its own plane, across its line: the
// displacement η(s) along n̂ (toward its north side) obeys
//   λ η̈ = ∂s(T ∂s η) + λ K η,   K = n̂·(∂f/∂n̂),
// fixed at the anchor; the counterweight and stations are point masses with
// the same field stiffness, the counterweight also taking −T ∂s η. Where the
// tether runs near the plane, n̂ is north–south and K ≈ −GM/r³: a swing there
// is close to tilting an orbit, which is why the slowest period sits near one
// turn of the body. Coriolis forces are left out; they act only on motion
// with a component across the spin axis.
// opts: { count (default 3), minSpacing (m, default 5 km) }. Returns
// { nodes: { r, z, s, alt?, fn, m }, modes: [{ omega, period, eta }] };
// each eta is scaled to 1 m at the counterweight, sign included.
export function northSouthModes(field, sol, opts) {
	var o = opts || {}, count = o.count || 3, minDs = o.minSpacing || 5e3;
	var p = sol.path, n = p.s.length;
	// Nodes: the anchor, then points at least minDs apart, ending at the counterweight.
	var idx = [0];
	for (var i = 1; i < n - 1; i++) if (p.s[i] - p.s[idx[idx.length - 1]] >= minDs) idx.push(i);
	if (p.s[n - 1] - p.s[idx[idx.length - 1]] < minDs * 0.5 && idx.length > 1) idx.pop();
	idx.push(n - 1);
	var N = idx.length;
	var mass = new Float64Array(N), Kf = new Float64Array(N), kSeg = new Float64Array(N - 1);
	for (var j = 0; j < N - 1; j++) {
		var a = idx[j], b = idx[j + 1], ds = p.s[b] - p.s[a];
		kSeg[j] = 0.5 * (p.T[a] + p.T[b]) / ds;
		// Mass of the piece, split between its two ends.
		var mseg = 0;
		for (var q = a; q < b; q++) mseg += 0.5 * (p.lam[q] + p.lam[q + 1]) * (p.s[q + 1] - p.s[q]);
		mass[j] += mseg / 2; mass[j + 1] += mseg / 2;
	}
	mass[N - 1] += sol.M;
	(sol.stations || []).forEach(function (st) {
		var best = 1, bd = Infinity;
		for (var j = 1; j < N; j++) { var dd = Math.abs(p.r[idx[j]] - st.r); if (dd < bd) { bd = dd; best = j; } }
		mass[best] += st.m;
	});
	var h = 1e3;
	for (var j = 0; j < N; j++) {
		var ii = idx[j], nx = -p.tz[ii], nz = p.tx[ii];
		var fp = field.f(p.x[ii] + h * nx, p.z[ii] + h * nz), fm = field.f(p.x[ii] - h * nx, p.z[ii] - h * nz);
		Kf[j] = ((fp[0] - fm[0]) * nx + (fp[1] - fm[1]) * nz) / (2 * h);
	}
	// Free nodes 1..N−1; stiffness Kmat η = ω² M η, made symmetric by M^(−1/2).
	var dim = N - 1, di = new Float64Array(dim), off = new Float64Array(Math.max(0, dim - 1));
	for (var j = 1; j < N; j++) {
		var kd = kSeg[j - 1] + (j < N - 1 ? kSeg[j] : 0) - mass[j] * Kf[j];
		di[j - 1] = kd / mass[j];
		if (j < N - 1) off[j - 1] = -kSeg[j] / Math.sqrt(mass[j] * mass[j + 1]);
	}
	var lams = lowestEigen(di, off, count);
	var modes = lams.map(function (lam) {
		var y = inverseIterate(di, off, lam), eta = new Float64Array(N);
		for (var j = 1; j < N; j++) eta[j] = y[j - 1] / Math.sqrt(mass[j]);
		var sc = eta[N - 1] !== 0 ? 1 / eta[N - 1] : 1;
		for (var j = 0; j < N; j++) eta[j] *= sc;
		var om = Math.sqrt(Math.max(lam, 0));
		return { omega: om, period: 2 * Math.PI / om, eta: eta };
	});
	var nodes = { r: new Float64Array(N), z: new Float64Array(N), s: new Float64Array(N), fn: new Float64Array(N), m: mass, K: Kf };
	for (var j = 0; j < N; j++) {
		var ii = idx[j];
		nodes.r[j] = p.r[ii]; nodes.z[j] = p.z[ii]; nodes.s[j] = p.s[ii]; nodes.fn[j] = p.fn[ii];
	}
	return { nodes: nodes, modes: modes };
}

// Lowest `count` eigenvalues of a symmetric tridiagonal matrix (Sturm bisection).
function lowestEigen(d, e, count) {
	var n = d.length, lo = Infinity, hi = -Infinity;
	for (var i = 0; i < n; i++) {
		var rad = (i > 0 ? Math.abs(e[i - 1]) : 0) + (i < n - 1 ? Math.abs(e[i]) : 0);
		lo = Math.min(lo, d[i] - rad); hi = Math.max(hi, d[i] + rad);
	}
	function below(x) {
		var c = 0, qv = d[0] - x;
		if (qv < 0) c++;
		for (var i = 1; i < n; i++) {
			if (qv === 0) qv = 1e-300;
			qv = d[i] - x - e[i - 1] * e[i - 1] / qv;
			if (qv < 0) c++;
		}
		return c;
	}
	var out = [];
	for (var kk = 0; kk < Math.min(count, n); kk++) {
		var a = lo, b = hi;
		for (var it = 0; it < 200; it++) {
			var mid = 0.5 * (a + b);
			if (below(mid) > kk) b = mid; else a = mid;
			if (b - a <= Math.abs(mid) * 1e-14) break;
		}
		out.push(0.5 * (a + b));
	}
	return out;
}

// The eigenvector for eigenvalue lam (inverse iteration, Thomas solves).
function inverseIterate(d, e, lam) {
	var n = d.length, sh = lam + Math.max(Math.abs(lam) * 1e-9, 1e-30);
	var y = new Float64Array(n).fill(1), cp = new Float64Array(n), dp = new Float64Array(n);
	for (var it = 0; it < 4; it++) {
		// Solve (A − sh) x = y.
		var bb = d[0] - sh;
		cp[0] = n > 1 ? e[0] / bb : 0; dp[0] = y[0] / bb;
		for (var i = 1; i < n; i++) {
			var den = d[i] - sh - e[i - 1] * cp[i - 1];
			if (den === 0) den = 1e-300;
			cp[i] = i < n - 1 ? e[i] / den : 0;
			dp[i] = (y[i] - e[i - 1] * dp[i - 1]) / den;
		}
		var xv = new Float64Array(n);
		xv[n - 1] = dp[n - 1];
		for (var i = n - 2; i >= 0; i--) xv[i] = dp[i] - cp[i] * xv[i + 1];
		var nrm = 0;
		for (var i = 0; i < n; i++) nrm += xv[i] * xv[i];
		nrm = Math.sqrt(nrm);
		for (var i = 0; i < n; i++) y[i] = xv[i] / nrm;
	}
	return y;
}
