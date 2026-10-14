// Sizing model for a sled mass driver on a tension-loaded track.
//
// Pure: plain numbers in, plain object out, no DOM, so it runs in Node.
// SI units throughout (kg, m, s, N, W, J, K).
//
// Track layout. The launch section runs from its free far end (x = 0, sled
// at rest) to the hub (x = L), where the ship leaves the sled. The braking
// section continues past the hub for the empty sled. In both sections the
// drive reaction drags the windings toward or away from the hub such that
// the track between the sled and the hub is always in tension, so the axial
// load path is a CNT spine anchored at the hub.
//
// Guideway cross-section. A central blade of height h, the sled's
// superconducting magnets straddling it, aluminium windings on both faces.
// The thrust shear on the windings reaches the spine at the blade root
// through a truss web: CNT diagonals in tension, cordierite posts in
// compression, behind a thin cordierite skin that backs the windings.

const MU0 = 4e-7 * Math.PI;

// High-purity aluminium (RRR ~1000), approximate handbook values.
// T in K, specific heat cp in J/(kg·K), resistivity rhoE in Ω·m.
export const ALUMINIUM = {
	density: 2700,
	T:    [  40,     50,     60,     77,     100,    125,    150,    200,    250,    300   ],
	cp:   [  77,     142,    214,    336,    481,    590,    684,    797,    859,    902   ],
	rhoE: [  0.20e-9, 0.48e-9, 0.97e-9, 2.2e-9, 4.4e-9, 7.2e-9, 10.0e-9, 15.8e-9, 21.2e-9, 26.5e-9 ],
};

function interp(xs, ys, x) {
	if (x <= xs[0]) return ys[0];
	for (let i = 1; i < xs.length; i++) {
		if (x <= xs[i]) {
			const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
			return ys[i - 1] + f * (ys[i] - ys[i - 1]);
		}
	}
	return ys[ys.length - 1];
}

// Adiabatic pulse limits for a conductor heated from T0 to T1:
//   G  = ∫ ρm·cp/ρe dT   (A²·s/m⁴) — the allowed ∫J² dt
//   dH = ∫ cp dT         (J/kg)    — heat absorbed per kg
export function aluminiumPulseLimits(T0, T1) {
	const al = ALUMINIUM;
	const n = Math.max(1, Math.ceil((T1 - T0) / 0.25));
	const dT = (T1 - T0) / n;
	let G = 0, dH = 0;
	for (let i = 0; i < n; i++) {
		const T = T0 + (i + 0.5) * dT;
		const cp = interp(al.T, al.cp, T);
		G  += al.density * cp / interp(al.T, al.rhoE, T) * dT;
		dH += cp * dT;
	}
	return { G, dH };
}

// Launch kinematics for total moving mass m (ship + sled). Constant
// acceleration aMax; if pCap (W) is below the constant-acceleration peak,
// acceleration holds at aMax only until the power reaches pCap, then the
// run continues at constant power pCap.
export function launchProfile(m, aMax, vFinal, pCap) {
	const pFull = m * aMax * vFinal;
	const P = (pCap > 0 && pCap < pFull) ? pCap : 0;
	const vc = P ? P / (m * aMax) : vFinal;          // end of constant-acceleration phase
	const t1 = vc / aMax;
	const x1 = vc * vc / (2 * aMax);
	const L = P ? x1 + m * (vFinal ** 3 - vc ** 3) / (3 * P) : x1;
	const T = P ? t1 + m * (vFinal ** 2 - vc ** 2) / (2 * P) : t1;
	const speedAt = x => x <= x1 ? Math.sqrt(2 * aMax * Math.max(x, 0))
	                             : Math.cbrt(vc ** 3 + 3 * P * (x - x1) / m);
	const timeAt = x => x <= x1 ? Math.sqrt(2 * Math.max(x, 0) / aMax)
	                            : t1 + m * (speedAt(x) ** 2 - vc ** 2) / (2 * P);
	const forceAt = x => x <= x1 ? m * aMax : P / speedAt(x);
	return {
		capped: P > 0, vc, t1, x1, L, T,
		Fmax: m * aMax, Frelease: forceAt(L), Ppeak: P || pFull,
		speedAt, timeAt, forceAt,
	};
}

// Sled braking past the hub: constant deceleration aBrake from vFinal to rest.
export function brakingProfile(mSled, aBrake, vFinal) {
	const L = vFinal * vFinal / (2 * aBrake);
	const T = vFinal / aBrake;
	const timeAt = y => (vFinal - Math.sqrt(Math.max(vFinal * vFinal - 2 * aBrake * y, 0))) / aBrake;
	const speedAt = y => Math.sqrt(Math.max(vFinal * vFinal - 2 * aBrake * y, 0));
	const F = mSled * aBrake;
	return { L, T, Fmax: F, timeAt, speedAt, forceAt: () => F };
}

// Windings and guideway web along one section, integrated in N steps.
// Each block is as long as the sled and is energised while the sled
// overlaps it, i.e. while the sled travels two sled-lengths.
function sizeSection(prof, d, G, N) {
	const { sledLength: ell, magnetHeight: h, faces, B } = d;
	const area = faces * h * ell;                    // magnet area facing the windings
	const dx = prof.L / N;
	let windingMass = 0, diagMass = 0, postMass = 0;
	let peakShear = 0, peakSheet = 0, peakJ = 0, maxThick = 0, minThick = Infinity;
	const samples = [];
	for (let i = 0; i < N; i++) {
		const x = (i + 0.5) * dx;
		const F = prof.forceAt(x);
		const tOn = prof.timeAt(Math.min(x + ell, prof.L)) - prof.timeAt(Math.max(x - ell, 0));
		const shear = F / area;                      // τs
		const K = 2 * shear / B;                     // sheet current, A/m
		const J = Math.sqrt(G / tOn);                // allowed current density
		const tc = K / J;                            // conductor thickness
		const lamW = faces * h * tc * d.al.density * d.endFactor;
		const q = F / ell;                           // shear flow into the blade, N/m
		const lamDiag = d.cnt.sf * d.cnt.density * q * h / d.cnt.strength;
		const lamPost = d.cer.sf * d.cer.density * q * h * d.cer.postFactor / (2 * d.cer.strength);
		windingMass += lamW * dx;
		diagMass += lamDiag * dx;
		postMass += lamPost * dx;
		peakShear = Math.max(peakShear, shear);
		peakSheet = Math.max(peakSheet, K);
		peakJ = Math.max(peakJ, J);
		maxThick = Math.max(maxThick, tc);
		minThick = Math.min(minThick, tc);
		if (i % Math.max(1, Math.floor(N / 200)) === 0) {
			samples.push({ x, v: prof.speedAt(x), F, tOn, J, tc, lamW });
		}
	}
	const skinMass = faces * h * d.cer.skin * d.cer.density * prof.L;
	return { windingMass, diagMass, postMass, skinMass, peakShear, peakSheet, peakJ, maxThick, minThick, samples };
}

// ── Power delivery ──────────────────────────────────────────────────────
// One flywheel bank at the hub drives generators; converters turn their
// output into the track's sled-synchronous frequency; feeders carry it out
// to the active block. The launch section ends at the hub and the braking
// section starts there, so the same machines serve both in turn.
//
// On an N-cell grid, S is the running integral of P² dt, written in
// position as ∫ F²·v dx (since P = F·v and dt = dx/v).
function sectionGrid(prof, N) {
	const dx = prof.L / N;
	const P = new Float64Array(N);
	const S = new Float64Array(N + 1);
	for (let i = 0; i < N; i++) {
		const x = (i + 0.5) * dx;
		const F = prof.forceAt(x), v = prof.speedAt(x);
		P[i] = F * v;
		S[i + 1] = S[i] + F * F * v * dx;
	}
	return { N, dx, P, S };
}

// Feeder volume along a section, the hub at grid edge ic (0 or N). The
// feeder at a cell carries current whenever the sled is farther from the
// hub than that cell, so its adiabatic area is √(∫I² dt / G).
function feederVolume(grid, ic, V, G) {
	const { N, dx, S } = grid;
	let vol = 0;
	for (let i = 0; i < N; i++) {
		const Sc = 0.5 * (S[i] + S[i + 1]);
		const s2 = i < ic ? Sc : S[N] - Sc;
		vol += Math.sqrt(Math.max(s2, 0) / G) / V * dx;
	}
	return vol;
}

// pd: { voltage, conductors, genField, genSpeed, genStructure, convSpecific (W/kg) }
function sizePowerDelivery(launch, brake, pd, endFactor, G, N) {
	const lg = sectionGrid(launch, N);
	const bg = sectionGrid(brake, N);
	const V = pd.voltage;
	const rho = ALUMINIUM.density;
	// Generator stator conductor, sized like the track windings but loaded
	// for the whole launch-and-brake duty: M = 2·ρ·k_e·√(∫P² dt) / (B·v_s·√G).
	const E2 = lg.S[N] + bg.S[N];
	const genConductor = 2 * rho * endFactor * Math.sqrt(E2) / (pd.genField * pd.genSpeed * Math.sqrt(G));
	const rating = Math.max(...lg.P, ...bg.P);
	const generators = genConductor * pd.genStructure;
	const converters = rating / pd.convSpecific;
	const feeders = pd.conductors * rho * (feederVolume(lg, N, V, G) + feederVolume(bg, 0, V, G));
	return {
		rating, genConductor, generators, converters, feeders,
		total: generators + converters + feeders,
		peakCurrent: Math.max(launch.Ppeak, brake.Fmax * brake.speedAt(0)) / V,
	};
}

// Full sizing. Inputs (SI):
//   shipMass, accel (max), vFinal, B, sledMassFrac, sledLengthPerKg,
//   brakeAccel, powerCapFrac (0 or absent = constant acceleration; else
//   the cap as a fraction of the constant-acceleration peak power),
//   magnetHeight, faces, endFactor, T0, T1, etaConv,
//   cnt {strength, density, sf}, cer {strength, density, sf, postFactor, skin},
//   flywheel {speedRatio},
//   power {voltage, conductors, genField, genSpeed, genStructure, convSpecific}
export function sizeTipDriver(p, N = 4000) {
	const mShip = p.shipMass;
	const mSled = p.sledMassFrac * mShip;
	const ell = p.sledLengthPerKg * mShip;
	const m = mShip + mSled;
	const pCap = p.powerCapFrac > 0 ? p.powerCapFrac * m * p.accel * p.vFinal : 0;

	const launch = launchProfile(m, p.accel, p.vFinal, pCap);
	const brake = brakingProfile(mSled, p.brakeAccel, p.vFinal);
	const { G, dH } = aluminiumPulseLimits(p.T0, p.T1);

	const d = {
		sledLength: ell, magnetHeight: p.magnetHeight, faces: p.faces, B: p.B,
		endFactor: p.endFactor, al: ALUMINIUM, cnt: p.cnt, cer: p.cer,
	};
	const ls = sizeSection(launch, d, G, N);
	const bs = sizeSection(brake, d, G, N);

	// Spine: the section at x carries the largest force applied anywhere
	// between x and the free end, which is the force at the start of the run.
	const cntSpecific = p.cnt.strength / p.cnt.density;
	const spineLaunch = p.cnt.sf * launch.Fmax * launch.L / cntSpecific;
	const spineBrake = p.cnt.sf * brake.Fmax * brake.L / cntSpecific;

	const power = sizePowerDelivery(launch, brake, p.power, p.endFactor, G, N);
	// Every conductor is sized to reach T1, so its heat is its mass × ΔH.
	power.heat = (power.genConductor + power.feeders) * dH;

	// Energy
	const eKin = 0.5 * m * p.vFinal ** 2;
	const eSled = 0.5 * mSled * p.vFinal ** 2;
	const heatLaunch = ls.windingMass * dH;
	const heatBrake = bs.windingMass * dH;
	const eStore = (eKin + heatLaunch + power.heat) / p.etaConv;
	const eRecovered = Math.max(eSled - heatBrake, 0) * p.etaConv;

	// Thin-rim CNT flywheel: hoop stress ρ·v² at working stress σ/SF.
	const eRim = p.cnt.strength / (2 * p.cnt.density * p.cnt.sf);
	const dod = 1 - p.flywheel.speedRatio ** 2;
	const flywheelMass = eStore / (eRim * dod);

	const structure = {
		spineLaunch, spineBrake,
		diag: ls.diagMass + bs.diagMass,
		posts: ls.postMass + bs.postMass,
		skin: ls.skinMass + bs.skinMass,
	};
	structure.total = structure.spineLaunch + structure.spineBrake
		+ structure.diag + structure.posts + structure.skin;

	const windings = {
		launch: ls.windingMass, brake: bs.windingMass,
		total: ls.windingMass + bs.windingMass,
		heatLaunch, heatBrake,
		peakShear: Math.max(ls.peakShear, bs.peakShear),
		peakSheet: Math.max(ls.peakSheet, bs.peakSheet),
		statorField: MU0 * Math.max(ls.peakSheet, bs.peakSheet),
		launchThickMax: ls.maxThick, launchThickMin: ls.minThick,
		G, dH,
	};

	return {
		mShip, mSled, sledLength: ell, mMoving: m, B: p.B, vFinal: p.vFinal, magnetHeight: p.magnetHeight,
		launch: {
			L: launch.L, T: launch.T, Fmax: launch.Fmax, Frelease: launch.Frelease,
			Ppeak: launch.Ppeak, capped: launch.capped, vc: launch.vc, x1: launch.x1, t1: launch.t1,
			samples: ls.samples,
		},
		brake: { L: brake.L, T: brake.T, F: brake.Fmax, samples: bs.samples },
		energy: { eKin, eSled, eStore, eRecovered, eRim, dod, flywheelMass },
		windings,
		structure,
		power,
		total: structure.total + windings.total + flywheelMass + power.total,
	};
}
