//orbital mechanics, vectors, etc.
//
// Shared maths helpers for the Moonwards calculators. ES module:
//   import { OrbitalMath } from "../../Shared/math-utils.js";
// Everything hangs off the `OrbitalMath` namespace.
//
// Conventions: GM is the standard gravitational parameter (m^3/s^2); r / a are
// radii / semi-major axes from the body centre in metres; v is a speed in m/s;
// angles are radians. All functions are pure (no DOM), so the module imports
// directly in Node for unit testing.

export const OrbitalMath = {

		// ---- speeds on an orbit ------------------------------------------------

		// Circular-orbit speed at radius r.
		circularVelocity: function (GM, r) {
			return Math.sqrt(GM / r);
		},

		// Escape speed at radius r ( = sqrt(2)*circularVelocity ).
		escapeVelocity: function (GM, r) {
			return Math.sqrt(2 * GM / r);
		},

		// Vis-viva: speed on an orbit of semi-major axis a when at radius r.
		visVivaVelocity: function (GM, r, a) {
			return Math.sqrt(GM * (2 / r - 1 / a));
		},

		// Specific orbital energy of a body moving at speed v at radius r.
		specificEnergy: function (v, GM, r) {
			return v * v / 2 - GM / r;
		},

		// Hyperbolic excess speed (v_infinity) for a body released at radius r
		// with speed v. Returns 0 if the state is bound rather than escaping.
		hyperbolicExcess: function (v, GM, r) {
			var s = v * v - 2 * GM / r;
			return s > 0 ? Math.sqrt(s) : 0;
		},

		// ---- timing & angular rate --------------------------------------------

		// Period of a circular orbit at radius r.
		orbitalPeriod: function (GM, r) {
			return 2 * Math.PI * Math.sqrt(r * r * r / GM);
		},

		// Period of an elliptical orbit of semi-major axis a.
		ellipticalPeriod: function (GM, a) {
			return 2 * Math.PI * Math.sqrt(a * a * a / GM);
		},

		// Mean motion / angular velocity of a circular orbit at radius r (rad/s).
		angularVelocity: function (GM, r) {
			return Math.sqrt(GM / (r * r * r));
		},

		// Radius of a synchronous/stationary circular orbit for a body spinning
		// at angular velocity omega (e.g. geostationary, areostationary).
		synchronousRadius: function (GM, omega) {
			return Math.cbrt(GM / (omega * omega));
		},

		// Synodic period between two orbits of periods T1, T2 (same units out).
		synodicPeriod: function (T1, T2) {
			return 1 / Math.abs(1 / T1 - 1 / T2);
		},

		// ---- geometry / element conversions -----------------------------------

		// Gravitational acceleration at radius r.
		gravity: function (GM, r) {
			return GM / (r * r);
		},

		semiMajorAxisFromApsis: function (rPeri, rApo) {
			return (rPeri + rApo) / 2;
		},

		eccentricityFromApsis: function (rPeri, rApo) {
			return (rApo - rPeri) / (rApo + rPeri);
		},

		apoapsisRadius: function (a, e) {
			return a * (1 + e);
		},

		periapsisRadius: function (a, e) {
			return a * (1 - e);
		},

		// ---- transfers & manoeuvres -------------------------------------------

		// Two-impulse Hohmann transfer between circular orbits r1 and r2.
		// Returns the two burns, their sum, and the transfer time (half-period).
		hohmann: function (GM, r1, r2) {
			var a = (r1 + r2) / 2;
			var v1 = Math.sqrt(GM / r1);
			var v2 = Math.sqrt(GM / r2);
			var vPeri = Math.sqrt(GM * (2 / r1 - 1 / a));
			var vApo  = Math.sqrt(GM * (2 / r2 - 1 / a));
			var dv1 = vPeri - v1;
			var dv2 = v2 - vApo;
			return {
				dv1: dv1,
				dv2: dv2,
				total: Math.abs(dv1) + Math.abs(dv2),
				tof: Math.PI * Math.sqrt(a * a * a / GM)
			};
		},

		// Tsiolkovsky rocket equation: delta-v from exhaust speed and wet/dry mass.
		tsiolkovskyDeltaV: function (ve, m0, mf) {
			return ve * Math.log(m0 / mf);
		},

		// Inverse: wet/dry mass ratio needed for a given delta-v and exhaust speed.
		massRatioForDeltaV: function (deltaV, ve) {
			return Math.exp(deltaV / ve);
		},

		// ---- spheres of influence ---------------------------------------------

		// Laplace sphere of influence of a body (mass m) orbiting a primary
		// (mass M) at semi-major axis a:  a * (m/M)^(2/5).
		sphereOfInfluence: function (a, m, M) {
			return a * Math.pow(m / M, 2 / 5);
		},

		// Hill sphere radius of a body (mass m) at semi-major axis a, eccentricity
		// e, around a primary (mass M):  a*(1-e)*(m/(3M))^(1/3).
		hillRadius: function (a, e, m, M) {
			return a * (1 - e) * Math.pow(m / (3 * M), 1 / 3);
		},

		// ---- tethers -----------------------------------------------------------

		// Specific effective potential of a point co-rotating at angular velocity
		// omega at radius r: -GM/r - 0.5*omega^2*r^2. The difference of this between
		// two radii drives the constant-stress taper of a hanging/standing tether.
		specificPotential: function (GM, omega, r) {
			return -GM / r - omega * omega * r * r / 2;
		},

		// Magnitude of the specific-potential difference between two radii for a
		// tether co-rotating at omega. Dividing this by the material's specific
		// strength (sigma/rho) gives the natural log of the taper ratio.
		taperIntegral: function (GM, omega, rInner, rOuter) {
			return Math.abs(
				OrbitalMath.specificPotential(GM, omega, rOuter) -
				OrbitalMath.specificPotential(GM, omega, rInner)
			);
		},

		// Constant-stress taper ratio (cross-section ratio) across a span, given
		// the material's specific strength (sigma/rho, in m^2/s^2 = J/kg).
		taperRatio: function (GM, omega, rInner, rOuter, specificStrength) {
			return Math.exp(
				OrbitalMath.taperIntegral(GM, omega, rInner, rOuter) / specificStrength
			);
		},

		// ---- spin launchers (rotating-arm catapults) --------------------------

		// Out-of-plane velocity component that tilts an in-plane velocity of
		// magnitude vInPlane out of its plane by angle theta (radians). Adding a
		// perpendicular component vInPlane*tan(theta) rotates the resultant vector
		// by theta while leaving the in-plane part unchanged.
		planeChangeComponent: function (vInPlane, theta) {
			return vInPlane * Math.tan(theta);
		},

		// Tip speed a launch arm must reach to add a velocity built from an
		// in-plane (e.g. retrograde) component and an out-of-plane (plane-change)
		// component:  sqrt(vInPlane^2 + vOutOfPlane^2).
		spinReleaseSpeed: function (vInPlane, vOutOfPlane) {
			return Math.sqrt(vInPlane * vInPlane + vOutOfPlane * vOutOfPlane);
		},

		// Centripetal (artificial-gravity) acceleration at the tip of an arm of
		// length L whose tip moves at vTip:  vTip^2 / L.
		spinTipAccel: function (vTip, armLength) {
			return vTip * vTip / armLength;
		},

		// Arm length that holds tip acceleration to aMax at tip speed vTip:
		// vTip^2 / aMax. (Inverse of spinTipAccel.)
		spinArmLength: function (vTip, aMax) {
			return vTip * vTip / aMax;
		},

		// Angular rate (rad/s) of an arm of length L whose tip moves at vTip.
		spinRate: function (vTip, armLength) {
			return vTip / armLength;
		},

		// Tilt of the arm's spin plane out of the in-plane throw direction needed
		// to deliver the given out-of-plane component alongside the in-plane one
		// (radians):  atan2(vOutOfPlane, vInPlane).
		spinPlaneTilt: function (vInPlane, vOutOfPlane) {
			return Math.atan2(vOutOfPlane, vInPlane);
		},

		// Constant-stress taper ratio (hub/tip cross-section) of a rotating arm
		// whose tip moves at vTip, for a material of specific strength sigma/rho
		// (J/kg = m^2/s^2):  exp(vTip^2 / (2*specificStrength)). Depends only on
		// tip speed, not arm length.
		spinTaperRatio: function (vTip, specificStrength) {
			return Math.exp(vTip * vTip / (2 * specificStrength));
		},

		// ---- atmospheric entry -------------------------------------------------

		// Allen–Eggers ballistic peak deceleration (m/s^2) for a vehicle entering
		// an exponential atmosphere of scale height H (m) at speed v (m/s) and
		// flight-path angle gamma (radians, below the horizon). k is an empirical
		// correction (default 0.55 ≈ the Stardust calibration at Earth superorbital
		// speed). Divide the result by g0 (9.80665) for Earth-g units.
		allenEggersPeakDecel: function (v, gamma, scaleHeight, k) {
			if (k === undefined) { k = 0.55; }
			return k * v * v * Math.sin(gamma) / (2 * Math.E * scaleHeight);
		},

		// Classical Allen-Eggers companions to allenEggersPeakDecel: the density
		// and speed AT the point of peak deceleration (not the entry-interface
		// values). For an exponential atmosphere with a ballistic (non-lifting)
		// vehicle of ballistic coefficient beta = m/(Cd*A) entering at constant
		// flight-path angle gamma, peak deceleration occurs where the local
		// density is rho_peak = beta*sin(gamma)/H, at which point the speed has
		// fallen to v_entry/sqrt(e) (Allen & Eggers 1958). Feed these into
		// suttonGravesHeatFlux for a peak convective heat flux consistent with
		// the same ballistic-entry model allenEggersPeakDecel already uses
		// (distinct from the grazing-aerobrake regime below, which instead
		// targets a chosen periapsis via grazingPeriapsisDensity).
		allenEggersPeakDensity: function (beta, gamma, scaleHeight) {
			return beta * Math.sin(gamma) / scaleHeight;
		},
		allenEggersPeakVelocity: function (vEntry) {
			return vEntry / Math.sqrt(Math.E);
		},

		// ---- grazing aerobrake / aerocapture ----------------------------------
		// A different regime from Allen–Eggers: a near-tangential pass that sheds
		// only a small fraction of the speed and exits to a high, barely-bound
		// orbit (apoapsis near the SOI). The flight-path angle goes to zero at
		// periapsis, so the constant-gamma Allen–Eggers form does not apply; peak
		// deceleration is set by the velocity decrement and the geometry of how
		// long the ship stays within ~one scale height of periapsis.

		// Ballistic coefficient m/(Cd*A) (kg/m^2). Big values => deep, hot, high-q.
		ballisticCoefficient: function (mass, dragCoeff, area) {
			return mass / (dragCoeff * area);
		},

		// Effective path length (m) over which a grazing pass stays within the
		// dense layer, I = sqrt(2*pi*rp*H/c), c = e/(1+e) from the incoming conic.
		// Near periapsis r = rp + (c/2)*(s^2/rp), so density falls as a Gaussian in
		// downrange s; I is the 1/e half-scale of that Gaussian times sqrt(2*pi).
		grazingPathScale: function (GM, rp, vEntry, scaleHeight) {
			var eps = vEntry * vEntry / 2 - GM / rp;   // specific energy at periapsis
			var aConic = -GM / (2 * eps);              // <0 hyperbola, >0 ellipse
			var e = 1 - rp / aConic;                   // eccentricity
			var c = e / (1 + e);
			return Math.sqrt(2 * Math.PI * rp * scaleHeight / c);
		},

		// Peak deceleration (m/s^2) of a grazing aerobrake that enters at vEntry and
		// leaves periapsis at vExit. Uses the geometric-mean speed as representative
		// and the path scale above; independent of ballistic coefficient (a higher
		// beta just forces a deeper, denser periapsis for the same speed loss).
		grazingPeakDecel: function (GM, rp, vEntry, vExit, scaleHeight) {
			var dV = vEntry - vExit;
			var vRep = Math.sqrt(vEntry * vExit);
			var I = OrbitalMath.grazingPathScale(GM, rp, vEntry, scaleHeight);
			return dV * vRep / I;
		},

		// Atmospheric density (kg/m^3) the periapsis must reach to shed vEntry->vExit
		// for a vehicle of ballistic coefficient beta: rho = 2*beta*dV/(I*vRep).
		grazingPeriapsisDensity: function (GM, rp, vEntry, vExit, scaleHeight, beta) {
			var dV = vEntry - vExit;
			var vRep = Math.sqrt(vEntry * vExit);
			var I = OrbitalMath.grazingPathScale(GM, rp, vEntry, scaleHeight);
			return 2 * beta * dV / (I * vRep);
		},

		// Altitude (m) at which an exponential atmosphere of surface density rho0 and
		// scale height H reaches density rho:  h = H*ln(rho0/rho).
		altitudeForDensity: function (rho0, rho, scaleHeight) {
			return scaleHeight * Math.log(rho0 / rho);
		},

		// Stagnation dynamic pressure (Pa): 0.5*rho*v^2.
		dynamicPressure: function (rho, v) {
			return 0.5 * rho * v * v;
		},

		// Sutton–Graves stagnation-point convective heat flux (W/m^2) for Earth air:
		// q = 1.7415e-4 * sqrt(rho/Rn) * v^3, rho in kg/m^3, Rn nose radius (m),
		// v in m/s. Does NOT include radiative heating, which is significant above
		// ~11 km/s and grows with nose radius — treat the result as a lower bound.
		suttonGravesHeatFlux: function (rho, v, noseRadius) {
			return 1.7415e-4 * Math.sqrt(rho / noseRadius) * v * v * v;
		},

		// ---- 3D vectors (plain [x,y,z] arrays) --------------------------------
		vAdd:   function (a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; },
		vSub:   function (a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; },
		vScale: function (a, s) { return [a[0]*s, a[1]*s, a[2]*s]; },
		vDot:   function (a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; },
		vCross: function (a, b) {
			return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
		},
		vMag:   function (a) { return Math.hypot(a[0], a[1], a[2]); },
		vUnit:  function (a) { var m = Math.hypot(a[0],a[1],a[2]); return m ? [a[0]/m,a[1]/m,a[2]/m] : [0,0,0]; },

		// ---- Kepler's equation -------------------------------------------------

		// Eccentric anomaly E from mean anomaly M (rad) for an ellipse (e<1).
		// Newton iteration; converges in a handful of steps for all e<1.
		solveKeplerElliptic: function (M, e) {
			M = Math.atan2(Math.sin(M), Math.cos(M)); // wrap to [-pi,pi] for fast start
			var E = e < 0.8 ? M : Math.PI * (M < 0 ? -1 : 1);
			for (var k = 0; k < 100; k++) {
				var dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
				E -= dE;
				if (Math.abs(dE) < 1e-14) { break; }
			}
			return E;
		},

		// Hyperbolic anomaly H from mean anomaly M (rad) for a hyperbola (e>1):
		// solves  e*sinh(H) - H = M.
		solveKeplerHyperbolic: function (M, e) {
			var H = M;                                  // decent initial guess
			if (Math.abs(M) > 6) { H = Math.sign(M) * Math.log(2 * Math.abs(M) / e + 1.8); }
			for (var k = 0; k < 100; k++) {
				var dH = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
				H -= dH;
				if (Math.abs(dH) < 1e-14) { break; }
			}
			return H;
		},

		// True anomaly (rad) from mean anomaly, for either conic.
		trueAnomalyFromMean: function (M, e) {
			if (e < 1) {
				var E = OrbitalMath.solveKeplerElliptic(M, e);
				return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2),
				                      Math.sqrt(1 - e) * Math.cos(E / 2));
			}
			var H = OrbitalMath.solveKeplerHyperbolic(M, e);
			return 2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(H / 2),
			                      Math.sqrt(e - 1) * Math.cosh(H / 2));
		},

		// Mean anomaly (rad) from true anomaly, for either conic.
		meanAnomalyFromTrue: function (nu, e) {
			if (e < 1) {
				var E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2),
				                       Math.sqrt(1 + e) * Math.cos(nu / 2));
				return E - e * Math.sin(E);
			}
			var H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
			return e * Math.sinh(H) - H;
		},

		// ---- classical elements <-> heliocentric state ------------------------
		// Frame: J2000 ecliptic, Sun-centred. Positions in m, velocities in m/s,
		// angles in rad. Elements: a (m; <0 for hyperbola), e, i, Omega (long. of
		// ascending node), omega (arg. of periapsis), nu (true anomaly).

		stateFromElements: function (GM, a, e, i, Omega, omega, nu) {
			var p = a * (1 - e * e);                    // semi-latus rectum (>0 both conics)
			var r = p / (1 + e * Math.cos(nu));
			var xpf = r * Math.cos(nu), ypf = r * Math.sin(nu);
			var sp = Math.sqrt(GM / p);
			var vxpf = -sp * Math.sin(nu), vypf = sp * (e + Math.cos(nu));
			var cO = Math.cos(Omega), sO = Math.sin(Omega);
			var ci = Math.cos(i),     si = Math.sin(i);
			var cw = Math.cos(omega), sw = Math.sin(omega);
			var R11 = cO*cw - sO*sw*ci, R12 = -cO*sw - sO*cw*ci;
			var R21 = sO*cw + cO*sw*ci, R22 = -sO*sw + cO*cw*ci;
			var R31 = sw*si,            R32 = cw*si;
			return {
				r: [R11*xpf + R12*ypf, R21*xpf + R22*ypf, R31*xpf + R32*ypf],
				v: [R11*vxpf + R12*vypf, R21*vxpf + R22*vypf, R31*vxpf + R32*vypf]
			};
		},

		// Recover classical elements from a heliocentric state vector.
		elementsFromState: function (GM, rvec, vvec) {
			var O = OrbitalMath;
			var r = O.vMag(rvec), v = O.vMag(vvec);
			var vr = O.vDot(rvec, vvec) / r;
			var hvec = O.vCross(rvec, vvec), h = O.vMag(hvec);
			var i = Math.acos(Math.max(-1, Math.min(1, hvec[2] / h)));
			var nvec = O.vCross([0, 0, 1], hvec), n = O.vMag(nvec);
			var evec = O.vScale(
				O.vSub(O.vScale(rvec, v * v - GM / r), O.vScale(vvec, r * vr)), 1 / GM);
			var e = O.vMag(evec);
			var energy = v * v / 2 - GM / r;
			var a = Math.abs(energy) < 1e-20 ? Infinity : -GM / (2 * energy);
			var Omega = 0;
			if (n > 1e-9) {
				Omega = Math.acos(Math.max(-1, Math.min(1, nvec[0] / n)));
				if (nvec[1] < 0) { Omega = 2 * Math.PI - Omega; }
			}
			var omega = 0;
			if (n > 1e-9 && e > 1e-9) {
				omega = Math.acos(Math.max(-1, Math.min(1, O.vDot(nvec, evec) / (n * e))));
				if (evec[2] < 0) { omega = 2 * Math.PI - omega; }
			} else if (e > 1e-9) {
				// Equatorial ellipse: there is no ascending node, so the previous
				// branch would drop the apse orientation entirely. Fold it into
				// omega as the longitude of periapsis, measured from +x.
				omega = Math.atan2(evec[1], evec[0]);
				if (hvec[2] < 0) { omega = -omega; }      // retrograde orbit
			}
			var nu = 0;
			if (e > 1e-9) {
				nu = Math.acos(Math.max(-1, Math.min(1, O.vDot(evec, rvec) / (e * r))));
				if (vr < 0) { nu = 2 * Math.PI - nu; }
			} else {
				nu = Math.acos(Math.max(-1, Math.min(1, rvec[0] / r)));
				if (rvec[1] < 0) { nu = 2 * Math.PI - nu; }
			}
			return { a: a, e: e, i: i, Omega: Omega, omega: omega, nu: nu, h: h, energy: energy };
		},

		// Shortest distance from a point (y0,y1) to the axis-aligned ellipse with
		// semi-axes e0 >= e1 (Eberly's robust "distance from a point to an
		// ellipse"). Returns the distance; sign of the inputs is irrelevant.
		distancePointEllipse: function (e0, e1, y0, y1) {
			y0 = Math.abs(y0); y1 = Math.abs(y1);
			if (y1 > 0) {
				if (y0 > 0) {
					var z0 = y0 / e0, z1 = y1 / e1;
					var g = z0 * z0 + z1 * z1 - 1;
					if (g !== 0) {
						var r0 = (e0 / e1) * (e0 / e1);
						var sbar = OrbitalMath._ellipseRoot(r0, z0, z1, g);
						var x0 = r0 * y0 / (sbar + r0), x1 = y1 / (sbar + 1);
						return Math.hypot(x0 - y0, x1 - y1);
					}
					return 0;
				}
				return Math.abs(y1 - e1);
			}
			var numer0 = e0 * y0, denom0 = e0 * e0 - e1 * e1;
			if (denom0 > 0 && numer0 < denom0) {
				var xde0 = numer0 / denom0;
				return Math.hypot(e0 * xde0 - y0, e1 * Math.sqrt(Math.max(0, 1 - xde0 * xde0)));
			}
			return Math.abs(y0 - e0);
		},
		_ellipseRoot: function (r0, z0, z1, g) {
			var n0 = r0 * z0;
			var s0 = z1 - 1, s1 = (g < 0 ? 0 : Math.hypot(n0, z1) - 1), s = 0;
			for (var k = 0; k < 80; k++) {
				s = (s0 + s1) / 2;
				if (s === s0 || s === s1) { break; }
				var ratio0 = n0 / (s + r0), ratio1 = z1 / (s + 1);
				var gg = ratio0 * ratio0 + ratio1 * ratio1 - 1;
				if (gg > 0) { s0 = s; } else if (gg < 0) { s1 = s; } else { break; }
			}
			return s;
		},
		// Shortest distance (m) from a 3-D point P (m, J2000 ecliptic, Sun-centred)
		// to the ellipse a body traces — i.e. to its orbit *ring*, independent of
		// where the body is on it. `orbit` carries {a, e, inclination, longitude
		// (Omega), argument (omega)}. Bound orbits only (e < 1). Exact geometry
		// (analytic ellipse), so it is not limited by any polyline drawing density.
		distanceToOrbit: function (orbit, P) {
			var a = orbit.a, e = orbit.e;
			var i = orbit.inclination || 0, Om = orbit.longitude || 0, w = orbit.argument || 0;
			var cO = Math.cos(Om), sO = Math.sin(Om), ci = Math.cos(i), si = Math.sin(i),
			    cw = Math.cos(w), sw = Math.sin(w);
			var ux = cO*cw - sO*sw*ci, uy = sO*cw + cO*sw*ci, uz = sw*si;      // periapsis dir
			var vx = -cO*sw - sO*cw*ci, vy = -sO*sw + cO*cw*ci, vz = cw*si;    // in-plane perp
			var A = Math.abs(a), B = A * Math.sqrt(Math.max(0, 1 - e * e));    // semi-axes
			var ae = a * e, Cx = -ae*ux, Cy = -ae*uy, Cz = -ae*uz;            // ellipse centre
			var wx = P[0] - Cx, wy = P[1] - Cy, wz = P[2] - Cz;
			var x = wx*ux + wy*uy + wz*uz;                                    // along major
			var y = wx*vx + wy*vy + wz*vz;                                    // along minor
			var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;   // plane normal
			var z = wx*nx + wy*ny + wz*nz;                                    // out of plane
			return Math.hypot(OrbitalMath.distancePointEllipse(A, B, x, y), z);
		},

		// Lambert's problem (zero-revolution, universal-variable form after Vallado).
		// Given start/end position vectors (m) and a time of flight (s), return the
		// transfer's { v1, v2 } velocities (m/s) and the achieved dt. `prograde`
		// (default true) picks the prograde branch — short way when the swept angle
		// is < 180°, long way otherwise. Returns null if it fails to converge.
		lambert: function (mu, r1, r2, dt, prograde) {
			var O = OrbitalMath;
			var R1 = O.vMag(r1), R2 = O.vMag(r2);
			if (R1 === 0 || R2 === 0 || dt <= 0) { return null; }
			var cosdnu = Math.max(-1, Math.min(1, O.vDot(r1, r2) / (R1 * R2)));
			var cr = O.vCross(r1, r2);
			var dnu = Math.acos(cosdnu);
			if (prograde !== false) { if (cr[2] < 0) { dnu = 2 * Math.PI - dnu; } }
			else { if (cr[2] >= 0) { dnu = 2 * Math.PI - dnu; } }
			var A = Math.sin(dnu) * Math.sqrt(R1 * R2 / (1 - Math.cos(dnu)));
			if (A === 0 || !isFinite(A)) { return null; }
			function stumpff(psi) {
				if (psi > 1e-6) {
					var s = Math.sqrt(psi);
					return [(1 - Math.cos(s)) / psi, (s - Math.sin(s)) / (s * s * s)];
				}
				if (psi < -1e-6) {
					var s2 = Math.sqrt(-psi);
					return [(1 - Math.cosh(s2)) / psi, (Math.sinh(s2) - s2) / (s2 * s2 * s2)];
				}
				return [0.5, 1 / 6];
			}
			var psi = 0, psiUp = 4 * Math.PI * Math.PI, psiLow = -4 * Math.PI;
			var sc = stumpff(psi), c2 = sc[0], c3 = sc[1];
			var y = 0, chi, dtc = 0;
			for (var it = 0; it < 300; it++) {
				y = R1 + R2 + A * (psi * c3 - 1) / Math.sqrt(c2);
				if (A > 0 && y < 0) {
					var guard = 0;
					while (y < 0 && guard < 200) {
						psiLow += Math.PI; psi = 0.5 * (psiUp + psiLow);
						sc = stumpff(psi); c2 = sc[0]; c3 = sc[1];
						y = R1 + R2 + A * (psi * c3 - 1) / Math.sqrt(c2);
						guard++;
					}
				}
				chi = Math.sqrt(y / c2);
				dtc = (chi * chi * chi * c3 + A * Math.sqrt(y)) / Math.sqrt(mu);
				if (Math.abs(dtc - dt) < 1e-3) { break; }
				if (dtc <= dt) { psiLow = psi; } else { psiUp = psi; }
				if (psiUp - psiLow < 1e-12) { break; }
				psi = 0.5 * (psiUp + psiLow);
				sc = stumpff(psi); c2 = sc[0]; c3 = sc[1];
			}
			if (!isFinite(y) || y < 0) { return null; }
			var f = 1 - y / R1, g = A * Math.sqrt(y / mu), gdot = 1 - y / R2;
			if (g === 0 || !isFinite(g)) { return null; }
			return {
				v1: [(r2[0] - f*r1[0]) / g, (r2[1] - f*r1[1]) / g, (r2[2] - f*r1[2]) / g],
				v2: [(gdot*r2[0] - r1[0]) / g, (gdot*r2[1] - r1[1]) / g, (gdot*r2[2] - r1[2]) / g],
				dt: dtc
			};
		},

		// Mean motion (rad/s) for semi-major axis a (uses |a| so it works for
		// hyperbolae too).
		meanMotion: function (GM, a) {
			return Math.sqrt(GM / Math.pow(Math.abs(a), 3));
		},

		// Time (s) to coast OUTWARD from the current state to the first future
		// crossing of radius rTarget, along the two-body conic through
		// (rvec, vvec). Works for ellipse and hyperbola. Uses the outbound
		// (0..pi) true-anomaly branch, so a body still inbound coasts through
		// periapsis first. Returns null when rTarget doesn't lie on the orbit
		// (inside periapsis, or beyond a bound orbit's apoapsis) or the crossing
		// is already in the past. Handy for patched-conic timeline milestones
		// like "SOI exit" without a full numerical propagation.
		coastTimeToRadius: function (GM, rvec, vvec, rTarget) {
			var el = OrbitalMath.elementsFromState(GM, rvec, vvec);
			var a = el.a, e = el.e;
			var p = a * (1 - e * e);                    // semi-latus rectum (>0 both conics)
			if (!(p > 0) || !(rTarget > 0)) { return null; }
			var cosNu = (p / rTarget - 1) / e;
			if (!(cosNu >= -1 && cosNu <= 1)) { return null; }   // radius not on the orbit
			var nuTarget = Math.acos(cosNu);            // outbound crossing, 0..pi
			var M0 = OrbitalMath.meanAnomalyFromTrue(el.nu, e);
			var M1 = OrbitalMath.meanAnomalyFromTrue(nuTarget, e);
			var dt = (M1 - M0) / OrbitalMath.meanMotion(GM, a);
			return dt >= 0 ? dt : null;
		},

		// Propagate a heliocentric state forward by dt seconds (two-body, any conic).
		propagateState: function (GM, rvec, vvec, dt) {
			var el = OrbitalMath.elementsFromState(GM, rvec, vvec);
			var M0 = OrbitalMath.meanAnomalyFromTrue(el.nu, el.e);
            var M1 = M0 + OrbitalMath.meanMotion(GM, el.a) * dt;
			var nu1 = OrbitalMath.trueAnomalyFromMean(M1, el.e);
			return OrbitalMath.stateFromElements(GM, el.a, el.e, el.i, el.Omega, el.omega, nu1);
		},

		// Heliocentric state of a body at Julian date jd, given an orbit record
		// carrying {a, e, inclination, longitude, argument, epoch, meanAnomaly}.
		// gm is the central body's GM (Sun). Falls back to the orbit's own
		// semiMajor/eccentricity getters.
		bodyStateAtJD: function (gm, orbit, jd) {
			var a = orbit.a, e = orbit.e;
			var i = orbit.inclination || 0;
			var Omega = orbit.longitude || 0;
			var omega = orbit.argument || 0;
			var M0 = orbit.meanAnomaly || 0;
			var epoch = orbit.epoch || 2451545.0;
			var dt = (jd - epoch) * 86400;
			var M = M0 + OrbitalMath.meanMotion(gm, a) * dt;
			var nu = OrbitalMath.trueAnomalyFromMean(M, e);
			return OrbitalMath.stateFromElements(gm, a, e, i, Omega, omega, nu);
		},

		// Orthonormal burn frame for a heliocentric arc, anchored to the reference
		// (ecliptic) plane rather than the osculating orbit plane. This keeps the
		// axes steady through a flyby, where the osculating plane — and hence an
		// r x v normal — swings sharply toward the Sun.
		//   prograde : exactly along velocity (the direction of travel).
		//   normal   : reference-up (`up`, default ecliptic +Z) with its prograde
		//              component removed, so it is exactly perpendicular to prograde
		//              while staying as close to ecliptic-north as possible. A
		//              normal burn is therefore a plane change measured against the
		//              ecliptic, and does not tumble during a flyby.
		//   radial   : the remaining axis, normal x prograde, i.e. 90 deg to both.
		//              Points sunward when the arc is coplanar+circular; otherwise
		//              it is simply the in-frame third axis (perpendicular to v).
		// Because prograde is locked to velocity and normal to the ecliptic, the two
		// intents can only be reconciled orthonormally by letting radial be the
		// derived axis — which is the requested behaviour. Falls back to the
		// osculating normal only in the degenerate case of velocity parallel to
		// `up` (never occurs for heliocentric motion). Returns unit {pro,nrm,rad}.
		burnFrame: function (rvec, vvec, up) {
			var O = OrbitalMath;
			up = up || [0, 0, 1];                       // ecliptic north (J2000)
			var pro = O.vUnit(vvec);
			var proj = O.vSub(up, O.vScale(pro, O.vDot(up, pro)));   // up, minus its prograde part
			var nrm = (O.vMag(proj) < 1e-9)
				? O.vUnit(O.vCross(rvec, vvec))         // degenerate: fall back to osculating normal
				: O.vUnit(proj);
			var rad = O.vUnit(O.vCross(nrm, pro));      // 90 deg to both; sunward in the circular case
			return { pro: pro, nrm: nrm, rad: rad };
		},

		// Apply an impulsive burn at a state, decomposed in the ecliptic-anchored
		// frame from burnFrame(): prograde (along v), normal (ecliptic-up, plane
		// change vs the ecliptic), radial (90 deg to both). Components in m/s.
		applyBurn: function (rvec, vvec, dvPrograde, dvNormal, dvRadial) {
			var O = OrbitalMath;
			var f = O.burnFrame(rvec, vvec);
			return O.vAdd(vvec,
				O.vAdd(O.vScale(f.pro, dvPrograde),
				O.vAdd(O.vScale(f.nrm, dvNormal), O.vScale(f.rad, dvRadial))));
		},

		// Sample positions along the two-body arc starting at (rvec,vvec), over
		// `duration` seconds, into `steps`+1 points. Returns array of [x,y,z].
		sampleTrajectory: function (GM, rvec, vvec, duration, steps) {
			var pts = [];
			var el = OrbitalMath.elementsFromState(GM, rvec, vvec);
			var M0 = OrbitalMath.meanAnomalyFromTrue(el.nu, el.e);
			var n = OrbitalMath.meanMotion(GM, el.a);
			for (var k = 0; k <= steps; k++) {
				var M = M0 + n * (duration * k / steps);
				var nu = OrbitalMath.trueAnomalyFromMean(M, el.e);
				pts.push(OrbitalMath.stateFromElements(GM, el.a, el.e, el.i, el.Omega, el.omega, nu).r);
			}
			return pts;
		},

		// Non-wrapping Kepler solvers: return the anomaly in the SAME revolution
		// as M, so a continuous sweep of M gives a continuous anomaly. (The public
		// solveKepler* wrap M into [-pi,pi], which is wrong for arc sampling.)
		// For the ellipse |E - M| <= e, so E = M is always a good Newton start.
		_keplerE: function (M, e) {
			var E = M;
			for (var k = 0; k < 100; k++) {
				var dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
				E -= dE;
				if (Math.abs(dE) < 1e-13) { break; }
			}
			return E;
		},
		_keplerH: function (M, e) {
			var H = Math.abs(M) > 6 ? Math.sign(M) * Math.log(2 * Math.abs(M) / e + 1.8) : M;
			for (var k = 0; k < 200; k++) {
				var dH = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
				H -= dH;
				if (Math.abs(dH) < 1e-13) { break; }
			}
			return H;
		},

		// Like sampleTrajectory, but samples uniformly in eccentric (or
		// hyperbolic) anomaly rather than in time. Uniform-in-time crowds points
		// at apoapsis and starves periapsis, so an eccentric arc renders as long
		// straight chords through periapsis; uniform-in-anomaly puts the points
		// where the curvature is. Returns [{r:[x,y,z], t:seconds-from-start}, ...].
		sampleArc: function (GM, rvec, vvec, duration, steps) {
			var O = OrbitalMath;
			var el = O.elementsFromState(GM, rvec, vvec);
			var a = el.a, e = el.e, i = el.i, Om = el.Omega, w = el.omega, nu0 = el.nu;
			var n = O.meanMotion(GM, a);
			var pts = [], k, x, nu, s;
			if (e < 1) {
				var E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu0 / 2),
				                        Math.sqrt(1 + e) * Math.cos(nu0 / 2));
				var Me0 = E0 - e * Math.sin(E0);
				var Eend = O._keplerE(Me0 + n * duration, e);
				for (k = 0; k <= steps; k++) {
					x = E0 + (Eend - E0) * k / steps;                // eccentric anomaly
					nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(x / 2),
					                    Math.sqrt(1 - e) * Math.cos(x / 2));
					s = O.stateFromElements(GM, a, e, i, Om, w, nu);
					pts.push({ r: s.r, t: (x - e * Math.sin(x) - Me0) / n });
				}
			} else {
				var H0 = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu0 / 2));
				var Mh0 = e * Math.sinh(H0) - H0;
				var Hend = O._keplerH(Mh0 + n * duration, e);
				for (k = 0; k <= steps; k++) {
					x = H0 + (Hend - H0) * k / steps;                // hyperbolic anomaly
					nu = 2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(x / 2),
					                    Math.sqrt(e - 1) * Math.cosh(x / 2));
					s = O.stateFromElements(GM, a, e, i, Om, w, nu);
					pts.push({ r: s.r, t: (e * Math.sinh(x) - x - Mh0) / n });
				}
			}
			return pts;
		},

		// ---- calendar <-> Julian date -----------------------------------------

		// Julian date from a Gregorian UTC date/time. month is 1-12.
		julianDate: function (Y, Mo, D, h, m, s) {
			h = h || 0; m = m || 0; s = s || 0;
			var a = Math.floor((14 - Mo) / 12);
			var y = Y + 4800 - a;
			var mm = Mo + 12 * a - 3;
			var jdn = D + Math.floor((153 * mm + 2) / 5) + 365 * y
				+ Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
			return jdn + (h - 12) / 24 + m / 1440 + s / 86400;
		},

		// Gregorian UTC {Y,Mo,D,h,m,s} from a Julian date.
		dateFromJulian: function (jd) {
			var J = jd + 0.5;
			var Z = Math.floor(J), F = J - Z;
			var A = Z;
			if (Z >= 2299161) {
				var alpha = Math.floor((Z - 1867216.25) / 36524.25);
				A = Z + 1 + alpha - Math.floor(alpha / 4);
			}
			var B = A + 1524, C = Math.floor((B - 122.1) / 365.25);
			var Dd = Math.floor(365.25 * C), E = Math.floor((B - Dd) / 30.6001);
			var day = B - Dd - Math.floor(30.6001 * E) + F;
			var D = Math.floor(day);
			var Mo = E < 14 ? E - 1 : E - 13;
			var Y = Mo > 2 ? C - 4716 : C - 4715;
			var frac = day - D;
			var h = Math.floor(frac * 24);
			var m = Math.floor((frac * 24 - h) * 60);
			var s = ((frac * 24 - h) * 60 - m) * 60;
			return { Y: Y, Mo: Mo, D: D, h: h, m: m, s: s };
		}
};
