//physical & astronomical constants
//
// Shared constants for the Moonwards calculators. Loaded as a classic <script>
// (file:// friendly) and require()-able in Node. Exposes the global `Const`.
//
// These are the values the calculators have been using inline; centralizing
// them keeps every tool consistent and gives one place to refine a figure.
// Body-specific data (GM, radius, rotation, …) lives in orbit.js, not here.

(function (global) {
	"use strict";

	var Const = {
		G:        6.674e-11,    // gravitational constant, m^3 kg^-1 s^-2
		g0:       9.80665,      // standard gravity (defined), m/s^2 — breaking length, peak-g in "Earth g"
		AU:       1.496e11,     // astronomical unit, m
		GM_sun:   1.327124e20,  // Sun's standard gravitational parameter, m^3/s^2

		// Representative exponential-atmosphere scale heights (m), for entry
		// (Allen–Eggers) estimates — approximate, near the altitudes where peak
		// deceleration occurs; refine per mission as needed.
		scaleHeight: {
			earth: 7160,
			venus: 15900,
			titan: 20000,
			mars:  11100
		}
	};

	global.Const = Const;

	if (typeof module !== "undefined" && module.exports) {
		module.exports = Const;
	}

})(typeof window !== "undefined" ? window : globalThis);
