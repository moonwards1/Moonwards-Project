//number & unit formatting helpers
//
// Shared, pure formatting helpers for the Moonwards calculators. Loaded as a
// classic <script> (file:// friendly) and require()-able in Node for testing.
//
// Primary API is the `Fmt` namespace (Fmt.force, Fmt.mass, ...). For backward
// compatibility with the inline style the calculators grew up with, the same
// functions are also exposed under their legacy bare-global names (fmtForce,
// fmtMass, myRound, ...). New calculators should prefer `Fmt.*`.

(function (global) {
	"use strict";

	// Truncate (not round) to `digits` decimal places — matches the calculators'
	// long-standing myRound behaviour.
	function round(num, digits) {
		return Math.floor(num * Math.pow(10, digits)) / Math.pow(10, digits);
	}

	// Round to `n` significant figures, returned as a Number.
	function sig(x, n) {
		if (!isFinite(x) || x === 0) return x;
		return Number(x.toPrecision(n));
	}

	function force(n) {
		if (!isFinite(n)) return "—";
		if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(3) + " GN";
		if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(3) + " MN";
		if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(3) + " kN";
		return n.toFixed(2) + " N";
	}

	function torque(n) {
		if (!isFinite(n)) return "—";
		if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(3) + " TN·m";
		if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(3) + " GN·m";
		if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(3) + " MN·m";
		if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(3) + " kN·m";
		return n.toFixed(2) + " N·m";
	}

	function mass(kg) {
		if (!isFinite(kg)) return "—";
		if (kg >= 1e9) return (kg / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 }) + " kt";
		if (kg >= 1e3) return (kg / 1e3).toLocaleString(undefined, { maximumFractionDigits: 3 }) + " t";
		return kg.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " kg";
	}

	function power(w) {
		if (!isFinite(w)) return "—";
		if (Math.abs(w) >= 1e9) return (w / 1e9).toFixed(3) + " GW";
		if (Math.abs(w) >= 1e6) return (w / 1e6).toFixed(2) + " MW";
		if (Math.abs(w) >= 1e3) return (w / 1e3).toFixed(2) + " kW";
		return w.toFixed(1) + " W";
	}

	function time(days) {
		return days >= 1 ? days.toFixed(2) + " days" : (days * 24).toFixed(2) + " hours";
	}

	var Fmt = {
		round: round, sig: sig, force: force, torque: torque,
		mass: mass, power: power, time: time
	};

	global.Fmt = Fmt;

	// Legacy bare-name aliases (so existing calculators can drop their local
	// copies and just use these). Prefer Fmt.* in new code.
	global.myRound = round;
	global.fmtForce = force;
	global.fmtTorque = torque;
	global.fmtMass = mass;
	global.fmtPower = power;
	global.fmtTime = time;

	if (typeof module !== "undefined" && module.exports) {
		module.exports = Fmt;
	}

})(typeof window !== "undefined" ? window : globalThis);
