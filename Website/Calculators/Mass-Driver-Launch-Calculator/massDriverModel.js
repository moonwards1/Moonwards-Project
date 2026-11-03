// Lunar mass-driver launch — the physics, pure (no DOM).
//
// A track on the Moon's surface accelerates a payload (carried on a sled that
// is 7 % of the payload's mass) to release speed over its length; the sled is
// braked over a deceleration length and the payload flies on. The release is
// horizontal at the top of the track, so the orbit it gives decides the
// outcome: sub-orbital (lands downrange), an orbit (periapsis at the release),
// or escape. Also gives the energy drawn, the acceleration and force on the
// track, and the power.
//
//   computeMassDriver(inp) → results, or { error } when an input is out of range
//   inp: length m (accelerating track), payload t, declen m (sled braking
//        track), height m (release height above the ground), effPct %,
//        useApo (true: the release speed follows from apoalt), apoalt km
//        (apoapsis altitude), speed m/s (release speed against the ground)
//
// Speeds are against the ground unless called inertial; the ground moves east
// at V_SURF at the equator, and the launch is taken eastward.

export var MOON = {
	GM: 4.9028695e12,                     // m³/s²
	R: 1.7374e6,                          // m, mean radius
	gE: 9.80665,
	T_SID: 27.321661 * 86400              // s, sidereal rotation
};
MOON.V_SURF = 2 * Math.PI * MOON.R / MOON.T_SID;     // eastward surface speed at the equator
MOON.V_CIRC = Math.sqrt(MOON.GM / MOON.R);
MOON.V_ESC = Math.sqrt(2 * MOON.GM / MOON.R);
MOON.G_SURF = MOON.GM / (MOON.R * MOON.R);

var SLED_FRACTION = 0.07;
var BURN_PERIAPSIS = 10e3;                // m above the surface that the apoapsis burn raises periapsis to

export function computeMassDriver(inp) {
	var GM = MOON.GM, R = MOON.R, V_SURF = MOON.V_SURF, V_CIRC = MOON.V_CIRC;
	var L = inp.length, mpT = inp.payload, Ldec = inp.declen, hTrack = inp.height, effPct = inp.effPct;

	if (!(L > 0) || !(mpT > 0) || !(Ldec > 0)) return { error: "Length, payload mass and deceleration length must be positive." };
	if (!(hTrack >= 0)) return { error: "Release height must be zero or positive." };
	if (!(effPct > 0 && effPct <= 100)) return { error: "Energy efficiency must be between 0 and 100%." };
	var eff = effPct / 100;

	var mp = mpT * 1000;                  // kg
	var ms = SLED_FRACTION * mp;          // sled, kg
	var mtot = mp + ms;
	var r0 = R + hTrack;                  // release radius

	// release speed against the ground (vg) and inertial (vi)
	var vg, vi;
	if (inp.useApo) {
		var hApo = inp.apoalt;
		if (!(hApo > 0)) return { error: "Apoapsis altitude must be a positive number." };
		var rApoIn = R + hApo * 1e3;
		if (rApoIn <= r0) return { error: "Apoapsis altitude must be above the release height." };
		var aIn = (rApoIn + r0) / 2;                      // release at periapsis = top of the track
		vi = Math.sqrt(GM * (2 / r0 - 1 / aIn));
		vg = vi - V_SURF;
	} else {
		vg = inp.speed;
		if (!(vg > 0)) return { error: "Release speed must be positive." };
		vi = vg + V_SURF;
	}

	var out = { vg: vg, vi: vi, mp: mp, ms: ms, mtot: mtot, eff: eff, r0: r0 };

	// Regime from the release state (horizontal release at r0):
	//   unbound (eps >= 0)          → escape
	//   periapsis below the surface → sub-orbital, lands downrange
	//   periapsis at or above it    → orbit
	var eps = vi * vi / 2 - GM / r0;      // specific orbital energy at release
	var hAng = r0 * vi;                   // specific angular momentum (tangential release)

	if (eps >= 0) {
		var vInf = Math.sqrt(2 * eps);
		out.regime = "escape";
		out.escape = { vInf: vInf, C3: vInf * vInf / 1e6 };           // C3 in km²/s²
	} else {
		var a = -GM / (2 * eps);
		var e = Math.sqrt(Math.max(0, 1 + 2 * eps * hAng * hAng / (GM * GM)));
		var p = hAng * hAng / GM;
		var rApo = a * (1 + e);
		var rPeri = a * (1 - e);

		if (rPeri < R) {
			// The release is the apoapsis; the payload descends to r = R.
			// cos(nu_impact) = (p/R − 1)/e, measured forward from apoapsis (nu = π).
			var C = Math.max(-1, Math.min(1, (p / R - 1) / e));
			var nuImp = 2 * Math.PI - Math.acos(C);
			var phi = nuImp - Math.PI;                                // ground angle, release → impact
			var vImp = Math.sqrt(GM * (2 / R - 1 / a));
			var n = Math.sqrt(GM / (a * a * a));
			var Eimp = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nuImp / 2), Math.sqrt(1 + e) * Math.cos(nuImp / 2));
			var EimpW = Eimp < 0 ? Eimp + 2 * Math.PI : Eimp;
			var Mimp = EimpW - e * Math.sin(EimpW);
			out.regime = "suborbital";
			out.sub = { a: a, e: e, p: p, phi: phi, distance: R * phi, impactSpeed: vImp,
				flightTime: (Mimp - Math.PI) / n,                    // apoapsis has mean anomaly π
				extraSpeedForOrbit: V_CIRC - vi };                   // inertial m/s still needed for a grazing orbit
		} else {
			// The release is periapsis; the burn at apoapsis raises periapsis to 10 km.
			var vApo = hAng / rApo;
			var rP2 = R + BURN_PERIAPSIS;
			var dv = NaN, vApo2 = NaN, vPeri2 = NaN;
			if (rApo > rP2) {
				var a2 = (rApo + rP2) / 2;
				vApo2 = Math.sqrt(GM * (2 / rApo - 1 / a2));
				dv = vApo2 - vApo;
				vPeri2 = Math.sqrt(GM * (2 / rP2 - 1 / a2));
			}
			var rP2eff = rApo > rP2 ? rP2 : rPeri;
			var a2eff = (rApo + rP2eff) / 2;
			out.regime = "orbit";
			out.orbit = { a: a, e: e, rApo: rApo, rPeri: rPeri, rP2: rP2, apoapsisAltitude: rApo - R,
				vApo: vApo, coast: Math.PI * Math.sqrt(a * a * a / GM),
				period: 2 * Math.PI * Math.sqrt(a2eff * a2eff * a2eff / GM),
				burn: dv, vApo2: vApo2, vPeri2: vPeri2 };
		}
	}

	// energy: ideal is the kinetic energy delivered; the draw is ideal / efficiency
	var half = 0.5 * vg * vg;
	out.energy = { idealPerKg: half, drawPerKg: half / eff,
		idealPayload: half * mp, drawPayload: half * mp / eff,
		idealSled: half * ms, idealTotal: half * mtot, drawTotal: half * mtot / eff };

	// acceleration phase: payload and sled to vg over L
	var aAcc = vg * vg / (2 * L), tAcc = 2 * L / vg;
	out.acceleration = { a: aAcc, time: tAcc, forcePayload: mp * aAcc, forceTotal: mtot * aAcc };

	// sled braking over Ldec
	var aDec = vg * vg / (2 * Ldec);
	out.deceleration = { a: aDec, time: 2 * Ldec / vg, forceSled: ms * aDec };

	// power drawn by the track
	out.power = { average: half * mtot / tAcc / eff,                 // over the launch, whole driver
		peak: mtot * aAcc * vg / eff,                                // at the release end
		per10m: mtot * aAcc * 10 / tAcc / eff };                     // a 10 m segment of track
	return out;
}
