/* Lunar ephemeris — low-precision geocentric Moon position.
 *
 * Implements Jean Meeus, "Astronomical Algorithms" (2nd ed.), Chapter 47
 * ("Position of the Moon"), using the full periodic-term tables 47.A and 47.B.
 * Returns the Moon's geocentric ecliptic longitude (lambda) and latitude (beta)
 * referred to the mean equinox of date, and its Earth-distance (delta).
 * Accuracy ~10" in longitude, a few arcsec in latitude, ~1 km in distance —
 * far beyond what a fixed two-body Kepler model gives, and good enough for the
 * Earth-Moon trajectory tools to place the Moon at its real position.
 *
 * Also provides the Sun's geocentric ecliptic longitude (Meeus Ch. 25,
 * low precision) for the lighting direction in the 3-D view.
 *
 * Classic script (file://-safe). Pure maths, no DOM. Node-testable via
 * module.exports. Global: `LunarEphemeris`.
 */
(function (global) {
	"use strict";

	var DEG = Math.PI / 180;
	function rev(x) { return x - 360 * Math.floor(x / 360); }   // wrap to [0,360)
	function sind(x) { return Math.sin(x * DEG); }
	function cosd(x) { return Math.cos(x * DEG); }

	// Julian centuries of 36525 days from J2000.0 (JDE 2451545.0).
	function centuries(jde) { return (jde - 2451545.0) / 36525.0; }

	// Meeus Table 47.A — longitude (Sigma l, sine, 1e-6 deg) and distance
	// (Sigma r, cosine, 1e-3 km). Columns: D, M, M', F, coeffL, coeffR.
	var TBL_A = [
		[0,0,1,0, 6288774,-20905355],[2,0,-1,0, 1274027,-3699111],
		[2,0,0,0,   658314,-2955968],[0,0,2,0,  213618,-569925],
		[0,1,0,0,  -185116,  48888],[0,0,0,2,  -114332,-3149],
		[2,0,-2,0,   58793, 246158],[2,-1,-1,0,  57066,-152138],
		[2,0,1,0,    53322,-170733],[2,-1,0,0,   45758,-204586],
		[0,1,-1,0,  -40923,-129620],[1,0,0,0,   -34720, 108743],
		[0,1,1,0,   -30383, 104755],[2,0,0,-2,   15327, 10321],
		[0,0,1,2,   -12528,      0],[0,0,1,-2,   10980, 79661],
		[4,0,-1,0,   10675,-34782],[0,0,3,0,     10034,-23210],
		[4,0,-2,0,    8548,-21636],[2,1,-1,0,    -7888, 24208],
		[2,1,0,0,    -6766, 30824],[1,0,-1,0,    -5163,-8379],
		[1,1,0,0,     4987,-16675],[2,-1,1,0,     4036,-12831],
		[2,0,2,0,     3994,-10445],[4,0,0,0,      3861,-11650],
		[2,0,-3,0,    3665, 14403],[0,1,-2,0,    -2689,-7003],
		[2,0,-1,2,   -2602,     0],[2,-1,-2,0,    2390, 10056],
		[1,0,1,0,    -2348,  6322],[2,-2,0,0,     2236,-9884],
		[0,1,2,0,    -2120,  5751],[0,2,0,0,      -2069,    0],
		[2,-2,-1,0,   2048,-4950],[2,0,1,-2,     -1773, 4130],
		[2,0,0,2,    -1595,     0],[4,-1,-1,0,     1215,-3958],
		[0,0,2,2,    -1110,     0],[3,0,-1,0,      -892, 3258],
		[2,1,1,0,     -810,  2616],[4,-1,-2,0,      759,-1897],
		[0,2,-1,0,    -713,-2117],[2,2,-1,0,       -700, 2354],
		[2,1,-2,0,     691,     0],[2,-1,0,-2,      596,    0],
		[4,0,1,0,      549,-1423],[0,0,4,0,         537,-1117],
		[4,-1,0,0,     520,-1571],[1,0,-2,0,       -487,-1739],
		[2,1,0,-2,    -399,     0],[0,0,2,-2,       -381,-4421],
		[1,1,1,0,      351,     0],[3,0,-2,0,       -340,    0],
		[4,0,-3,0,     330,     0],[2,-1,2,0,        327,    0],
		[0,2,1,0,     -323,  1165],[1,1,-1,0,        299,    0],
		[2,0,3,0,      294,     0],[2,0,-1,-2,         0, 8752]
	];

	// Meeus Table 47.B — latitude (Sigma b, sine, 1e-6 deg).
	// Columns: D, M, M', F, coeffB.
	var TBL_B = [
		[0,0,0,1, 5128122],[0,0,1,1,  280602],[0,0,1,-1, 277693],
		[2,0,0,-1, 173237],[2,0,-1,1,  55413],[2,0,-1,-1, 46271],
		[2,0,0,1,   32573],[0,0,2,1,   17198],[2,0,1,-1,   9266],
		[0,0,2,-1,   8822],[2,-1,0,-1,  8216],[2,0,-2,-1,  4324],
		[2,0,1,1,    4200],[2,1,0,-1,  -3359],[2,-1,-1,1,   2463],
		[2,-1,0,1,   2211],[2,-1,-1,-1, 2065],[0,1,-1,-1, -1870],
		[4,0,-1,-1,  1828],[0,1,0,1,   -1794],[0,0,0,3,   -1749],
		[0,1,-1,1,  -1565],[1,0,0,1,   -1491],[0,1,1,1,   -1475],
		[0,1,1,-1,  -1410],[0,1,0,-1,  -1344],[1,0,0,-1,  -1335],
		[0,0,3,1,    1107],[4,0,0,-1,   1021],[4,0,-1,1,    833],
		[0,0,1,-3,    777],[4,0,-2,1,    671],[2,0,0,-3,    607],
		[2,0,2,-1,    596],[2,-1,1,-1,   491],[2,0,-2,1,   -451],
		[0,0,3,-1,    439],[2,0,2,1,     422],[2,0,-3,-1,   421],
		[2,1,-1,1,   -366],[2,1,0,1,    -351],[4,0,0,1,     331],
		[2,-1,1,1,    315],[2,-2,0,-1,   302],[0,0,1,3,    -283],
		[2,1,1,-1,   -229],[1,1,0,-1,    223],[1,1,0,1,     223],
		[0,1,-2,-1,  -220],[2,1,-1,-1,  -220],[1,0,1,1,    -185],
		[2,-1,-2,-1,  181],[0,1,2,1,    -177],[4,0,-2,-1,   176],
		[4,-1,-1,-1,  166],[1,0,1,-1,   -164],[4,0,1,-1,    132],
		[1,0,-1,-1,  -119],[4,-1,0,-1,   115],[2,-2,0,1,    107]
	];

	// Geocentric ecliptic position of the Moon (of date). jde in TD.
	// Returns { lon, lat, dist } — degrees, degrees, km.
	function moonEcliptic(jde) {
		var T = centuries(jde);

		// Fundamental arguments (degrees).
		var Lp = rev(218.3164477 + 481267.88123421*T - 0.0015786*T*T
				+ T*T*T/538841 - T*T*T*T/65194000);          // Moon mean longitude
		var D  = rev(297.8501921 + 445267.1114034*T - 0.0018819*T*T
				+ T*T*T/545868 - T*T*T*T/113065000);          // mean elongation
		var M  = rev(357.5291092 + 35999.0502909*T - 0.0001536*T*T
				+ T*T*T/24490000);                            // Sun mean anomaly
		var Mp = rev(134.9633964 + 477198.8675055*T + 0.0087414*T*T
				+ T*T*T/69699 - T*T*T*T/14712000);            // Moon mean anomaly
		var F  = rev(93.2720950 + 483202.0175233*T - 0.0036539*T*T
				- T*T*T/3526000 + T*T*T*T/863310000);         // arg. of latitude

		var A1 = rev(119.75 + 131.849*T);
		var A2 = rev(53.09 + 479264.290*T);
		var A3 = rev(313.45 + 481266.484*T);
		var E  = 1 - 0.002516*T - 0.0000074*T*T;             // eccentricity factor

		var sumL = 0, sumR = 0, sumB = 0, i, t, arg, e;
		for (i = 0; i < TBL_A.length; i++) {
			t = TBL_A[i];
			arg = t[0]*D + t[1]*M + t[2]*Mp + t[3]*F;
			e = (Math.abs(t[1]) === 1) ? E : (Math.abs(t[1]) === 2 ? E*E : 1);
			sumL += t[4] * e * sind(arg);
			sumR += t[5] * e * cosd(arg);
		}
		for (i = 0; i < TBL_B.length; i++) {
			t = TBL_B[i];
			arg = t[0]*D + t[1]*M + t[2]*Mp + t[3]*F;
			e = (Math.abs(t[1]) === 1) ? E : (Math.abs(t[1]) === 2 ? E*E : 1);
			sumB += t[4] * e * sind(arg);
		}

		// Additive terms (planetary/figure perturbations).
		sumL += 3958*sind(A1) + 1962*sind(Lp - F) + 318*sind(A2);
		sumB += -2235*sind(Lp) + 382*sind(A3) + 175*sind(A1 - F)
				+ 175*sind(A1 + F) + 127*sind(Lp - Mp) - 115*sind(Lp + Mp);

		var lon = rev(Lp + sumL / 1e6);     // deg
		var lat = sumB / 1e6;               // deg
		var dist = 385000.56 + sumR / 1000; // km
		return { lon: lon, lat: lat, dist: dist };
	}

	// Geocentric ecliptic rectangular position of the Moon (of date), in km.
	// x toward ecliptic longitude 0, z toward the ecliptic north pole.
	function moonVector(jde) {
		var m = moonEcliptic(jde);
		var cb = cosd(m.lat);
		return [
			m.dist * cb * cosd(m.lon),
			m.dist * cb * sind(m.lon),
			m.dist * sind(m.lat)
		];
	}

	// Geocentric Moon state (position + velocity) by central finite difference,
	// in km and km/s. dtDays is the half-step (default 0.02 day).
	function moonState(jde, dtDays) {
		var h = dtDays || 0.02;
		var rp = moonVector(jde + h), rm = moonVector(jde - h);
		var sec = 2 * h * 86400;
		return {
			r: moonVector(jde),
			v: [(rp[0]-rm[0])/sec, (rp[1]-rm[1])/sec, (rp[2]-rm[2])/sec]
		};
	}

	// Sun geocentric ecliptic longitude (deg), Meeus Ch. 25 low precision.
	function sunLongitude(jde) {
		var T = centuries(jde);
		var L0 = rev(280.46646 + 36000.76983*T + 0.0003032*T*T);
		var M  = rev(357.52911 + 35999.05029*T - 0.0001537*T*T);
		var C  = (1.914602 - 0.004817*T - 0.000014*T*T) * sind(M)
				+ (0.019993 - 0.000101*T) * sind(2*M)
				+ 0.000289 * sind(3*M);
		return rev(L0 + C);
	}

	// Unit vector (ecliptic of date) pointing from Earth toward the Sun.
	function sunDirection(jde) {
		var l = sunLongitude(jde);
		return [cosd(l), sind(l), 0];
	}

	var AU_KM = 149597870.7;

	// Earth–Sun distance (km), Meeus Ch. 25.3: the radius vector of the Sun.
	function sunDistance(jde) {
		var T = centuries(jde);
		var M = rev(357.52911 + 35999.05029*T - 0.0001537*T*T);
		var C = (1.914602 - 0.004817*T - 0.000014*T*T) * sind(M)
				+ (0.019993 - 0.000101*T) * sind(2*M)
				+ 0.000289 * sind(3*M);
		var nu = M + C;                                  // true anomaly (deg)
		var e = 0.016708634 - 0.000042037*T - 0.0000001267*T*T;
		return 1.000001018 * (1 - e*e) / (1 + e*cosd(nu)) * AU_KM;
	}

	// Sun geocentric ecliptic position (km), direction × real Earth–Sun distance.
	function sunVector(jde) {
		var l = sunLongitude(jde), R = sunDistance(jde);
		return [R*cosd(l), R*sind(l), 0];
	}

	var LunarEphemeris = {
		moonEcliptic: moonEcliptic,
		moonVector: moonVector,
		moonState: moonState,
		sunLongitude: sunLongitude,
		sunDirection: sunDirection,
		sunDistance: sunDistance,
		sunVector: sunVector
	};

	global.LunarEphemeris = LunarEphemeris;
	if (typeof module !== "undefined" && module.exports) {
		module.exports = LunarEphemeris;
	}

})(typeof window !== "undefined" ? window : globalThis);
