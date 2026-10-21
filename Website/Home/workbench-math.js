// The arithmetic behind the workbench's skeleton cards: results simple enough
// to compute before an installation has its own calculator. ES module:
//   import { WM } from "./workbench-math.js";
// Pure (no DOM); SI units throughout unless a name says otherwise.

export const G0 = 9.80665;                 // standard gravity, m/s²
export const GM_SUN = 1.32712440018e20;    // m³/s²
export const AU = 149597870700;            // m
var DAY = 86400;

export const WM = {
	// Rocket equation: Δv = Isp · g0 · ln(m0 / mf).
	rocketDv: function (isp, m0, mf) { return isp * G0 * Math.log(m0 / mf); },

	// Time between launch windows for two bodies orbiting the Sun:
	// S = 1 / |1/T1 − 1/T2| (periods in days; returns days, or Infinity if equal).
	synodicDays: function (t1, t2) { return t1 === t2 ? Infinity : 1 / Math.abs(1 / t1 - 1 / t2); },

	// Minimum-energy (Hohmann) transfer time between circular orbits of radius
	// r1, r2 (AU) around the Sun: t = π √(a³ / μ), a = (r1 + r2) / 2. Days.
	hohmannDays: function (r1AU, r2AU) {
		var a = (r1AU + r2AU) / 2 * AU;
		return Math.PI * Math.sqrt(a * a * a / GM_SUN) / DAY;
	},

	// Radius of the stationary orbit for a body turning once per `rot` seconds:
	// r = ∛(GM · T² / 4π²). Metres from the centre.
	stationaryRadius: function (GM, rot) { return Math.cbrt(GM * rot * rot / (4 * Math.PI * Math.PI)); },

	circularSpeed: function (GM, r) { return Math.sqrt(GM / r); },
	escapeSpeed: function (GM, r) { return Math.sqrt(2 * GM / r); },
	orbitalPeriod: function (GM, r) { return 2 * Math.PI * Math.sqrt(r * r * r / GM); },

	// Linear accelerator from rest: v = √(2 a L), t = v / a.
	trackExitSpeed: function (accel, length) { return Math.sqrt(2 * accel * length); },

	kineticEnergy: function (mass, v) { return 0.5 * mass * v * v; }
};
