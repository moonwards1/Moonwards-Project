// A tether in the meridian plane of a spinning, oblate body: anchored off the
// equator, it bows toward the equatorial plane and runs out to a counterweight
// beyond stationary orbit. Sized so its stress is the working strength
// everywhere. Pure (no DOM). ES module:
//   import { oblateField, areoidRadius, stationaryRadius, solveMeridianTether,
//            trackPull, heightAtRadius, northSouthModes } from "../../Shared/meridian-tether.js";
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
