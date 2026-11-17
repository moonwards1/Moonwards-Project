// The off-equator Mars elevator, pure (no DOM). ES module:
//   import { MarsElevator } from "./marsElevatorModel.js";
//
// The tether itself is Shared/meridian-tether.js in Mars's field (point
// mass, oblateness J2 and spin). This module adds what is Mars's own: the
// Mars system's figures, Phobos's and Deimos's reach above and below the
// equatorial plane, how often Deimos needs a dodge, the dodge swing scaled
// to its working size, pumping that swing with climber load timing, the
// westward lean of one-way traffic, the orbit after release, and the sizing
// of the whole structure for a counterweight (sizeStructure), for pages that
// have no Counterweight & stations card to do it.
// README.md derives it.

import { systems } from "../../Shared/orbit.js";
import { ANCHORS } from "../../Shared/body-profiles.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { oblateField, areoidRadius, stationaryRadius, heightAtRadius, northSouthModes, solveMeridianTether, trackPull }
	from "../../Shared/meridian-tether.js";
import { counterweightFor, pullBalance, MULT_FLOOR, MULT_ADVISED } from "../../Shared/radial-tether.js";

var DEG = Math.PI / 180, YEAR = 365.25 * 86400;
// The track every workbench elevator carries, kg/m: a minimum gauge
// everywhere, plus traction reinforcement at the anchor that thins with the
// local pull.
var TRACK = { min: 0.4, grav: 1.2 };
// The tether must leave the anchor at least this far above horizontal. A
// lighter counterweight means less tension at the bottom, where the track's
// weight then bends the tether down toward the ground.
var MIN_DEPARTURE = 10 * DEG;

// The Mars system, from Shared/orbit.js and Shared/body-profiles.js.
function marsSystem() {
	var mars = systems.get("Mars"), ph = systems.get("Phobos"), de = systems.get("Deimos");
	var rotation = Number(mars.period), omega = 2 * Math.PI / rotation;
	var J2 = mars.J2;
	var field = oblateField(mars.GM, J2.value, J2.radius, omega);
	return {
		GM: mars.GM, omega: omega, rotation: rotation, field: field,
		Req: mars.radius.equator, Rpol: mars.radius.polar, rStat: stationaryRadius(field),
		phobos: { a: ph.orbit.semiMajor, apo: ph.orbit.apoapsis, tilt: ANCHORS.Phobos.inclination * DEG, radius: Number(ph.radius) },
		deimos: { a: de.orbit.semiMajor, peri: de.orbit.periapsis, apo: de.orbit.apoapsis, radius: Number(de.radius), period: Number(de.orbit.period || de.period) }
	};
}

// The anchor: latitude (deg, north positive) and height above the areoid (m).
function anchor(sys, latDeg, height) {
	var lat = latDeg * DEG, rAreoid = areoidRadius(sys.Req, sys.Rpol, lat);
	return { lat: lat, rAreoid: rAreoid, r: rAreoid + height };
}

// The farthest Phobos gets from the equatorial plane: at apoapsis, at the
// top of its tilted orbit, plus its mean radius.
function phobosReach(ph) { return ph.apo * Math.sin(ph.tilt) + ph.radius; }

// Deimos's passes across the tether's line, and how often one falls close
// enough to need a dodge. q: { sys, zT (tether's height above the plane at
// Deimos's radius, m), tilt (Deimos's tilt to the equator, rad), band
// (width of the trigger band, m) }.
//   Each pass Deimos is somewhere along its tilted orbit, at height Z·sin u;
//   over many passes u is spread evenly, so the chance its height falls in a
//   band of width w around z_t is w / (π √(Z² − z_t²)).
//   Every third pass it is back near the same u, `drift` further on, so
//   hazard passes come in clusters: one each third pass while u crosses the
//   band, w / (√(Z² − z_t²)·|drift|) of them.
function deimosHazard(q) {
	var sys = q.sys, de = sys.deimos, P_rot = sys.rotation, P_d = de.period;
	var tCross = 1 / (1 / P_rot - 1 / P_d);                        // between passes across the line
	var adv = 2 * Math.PI * ((tCross / P_d) % 1);                  // Deimos's advance along its orbit per pass
	var drift = 3 * adv - 2 * Math.PI * Math.round(3 * adv / (2 * Math.PI));
	var vRel = sys.omega * de.a - Math.sqrt(sys.GM / de.a);
	var Z = de.a * Math.sin(q.tilt), zt = Math.abs(q.zT);
	var perYear = YEAR / tCross;
	var out = { tCross: tCross, perYear: perYear, advance: adv, drift: drift, vRel: vRel,
		crossTime: 2 * de.radius / vRel, Z: Z, reaches: Z > zt };
	if (!out.reaches) return Object.assign(out, { P: 0, dodges: 0, perCluster: 0, clusters: 0 });
	var root = Math.sqrt(Z * Z - zt * zt);
	var P = Math.min(1, q.band / (Math.PI * root));
	var perCluster = q.band / (root * Math.abs(drift));
	var dodges = P * perYear;
	return Object.assign(out, { P: P, dodges: dodges, perCluster: perCluster,
		clusters: perCluster > 0 ? dodges / Math.max(perCluster, 1) : 0, spacing: 3 * tCross });
}

// The value of a swing's shape at distance R from the centre.
function etaAt(nodes, eta, R) {
	var r = nodes.r;
	for (var i = 1; i < r.length; i++) {
		if (r[i] >= R && r[i - 1] < R) {
			var t = (R - r[i - 1]) / (r[i] - r[i - 1]);
			return eta[i - 1] + t * (eta[i] - eta[i - 1]);
		}
	}
	return NaN;
}

// The north–south swings, each scaled so the tether moves `dodge` (m) at
// distance `rRef` from the centre (Deimos's orbit). Returns { nodes, modes:
// [{ period, omega, eta (scaled), atPhobos, atRef, atCW, energy (J) }] };
// without rRef on the tether the sizes are NaN and only periods stand.
function swings(sys, sol, q) {
	var ms = northSouthModes(sys.field, sol, { count: q.count || 3 });
	var nodes = ms.nodes, last = nodes.r.length - 1;
	var modes = ms.modes.map(function (m) {
		var ref = etaAt(nodes, m.eta, q.rRef), sc = q.dodge / ref;
		var eta = new Float64Array(m.eta.length), E = 0;
		for (var i = 0; i < eta.length; i++) { eta[i] = m.eta[i] * sc; E += nodes.m[i] * eta[i] * eta[i]; }
		E *= 0.5 * m.omega * m.omega;
		return { period: m.period, omega: m.omega, eta: eta, atPhobos: Math.abs(etaAt(nodes, eta, sys.phobos.a)),
			atRef: Math.abs(etaAt(nodes, eta, q.rRef)), atCW: Math.abs(eta[last]), energy: E };
	});
	return { nodes: nodes, modes: modes };
}

// Pumping the slowest swing with cargo held on a stretch of tether. The
// cargo's weight across the tether, f_n per kg, works on the swing as it
// moves: a load varying by Δm in step with a swing of size η adds
// W = π·Δm·f_n·η per cycle. Built up over N cycles from rest to energy E,
// the load needed is Δm = 2E / (N·π·⟨f_n η⟩); simply loading and unloading
// the stretch half of each cycle delivers 2/π of a smooth variation, so it
// takes π/2 times more. q: { nodes, mode (scaled), rA, from, to (m above
// the anchor's radius), cycles, vFull, vSlow (m/s) }.
function pumping(q) {
	var n = q.nodes, eta = q.mode.eta, lo = q.rA + q.from, hi = q.rA + q.to;
	var sum = 0, len = 0, fnS = 0, etaS = 0;
	for (var i = 1; i < n.r.length; i++) {
		var rm = 0.5 * (n.r[i] + n.r[i - 1]);
		if (rm < lo || rm > hi) continue;
		var ds = n.s[i] - n.s[i - 1];
		var fn = 0.5 * (Math.abs(n.fn[i]) + Math.abs(n.fn[i - 1])), e = 0.5 * (Math.abs(eta[i]) + Math.abs(eta[i - 1]));
		sum += fn * e * ds; fnS += fn * ds; etaS += e * ds; len += ds;
	}
	if (!(len > 0)) return null;
	var fnEta = sum / len;
	var perKg = Math.PI * fnEta;                          // J per cycle per kg of load change
	var dmSmooth = 2 * q.mode.energy / (q.cycles * perKg);
	var dmOnOff = dmSmooth * Math.PI / 2;
	var tFull = len / q.vFull, tSlow = len / q.vSlow;
	return { length: len, fn: fnS / len, eta: etaS / len, perKg: perKg, dmSmooth: dmSmooth, dmOnOff: dmOnOff,
		tFull: tFull, tSlow: tSlow, flowFull: dmOnOff / tFull, flowSlow: dmOnOff / tSlow };
}

// Thrusters on the counterweight as a backup: the impulse that starts (or
// stops) the swing, J = ω Σ m η² / η_cw, and the propellant at exhaust speed ve.
function backupImpulse(nodes, mode) {
	var s = 0, last = mode.eta.length - 1;
	for (var i = 0; i < mode.eta.length; i++) s += nodes.m[i] * mode.eta[i] * mode.eta[i];
	return mode.omega * s / Math.abs(mode.eta[last]);
}

// One-way traffic leans the tether west: cargo released from the
// counterweight leaves with angular momentum ω·r_c² per kg, which Mars gives
// through the anchor. θ ≈ ṁ ω r_c² / (T₀ R cos φ). q: { mdot (kg/s), omega,
// rCW, T0 (hold-down, N), rA, lat }. Radians.
function westwardLean(q) { return q.mdot * q.omega * q.rCW * q.rCW / (q.T0 * q.rA * Math.cos(q.lat)); }

// A vessel let go at the counterweight moves east at ω·r_c, above circular
// speed there (the counterweight is beyond stationary orbit), so release is
// the periapsis of its orbit about Mars, or it escapes. The counterweight's
// small height above the plane is left out.
function releaseOrbit(sys, rCW) {
	var v = sys.omega * rCW, vEsc = OrbitalMath.escapeVelocity(sys.GM, rCW), out = { v: v, vEsc: vEsc, bound: v < vEsc };
	if (out.bound) {
		var a = 1 / (2 / rCW - v * v / sys.GM);
		out.rApo = 2 * a - rCW; out.period = OrbitalMath.ellipticalPeriod(sys.GM, a);
	} else out.vInf = Math.sqrt(v * v - vEsc * vEsc);
	return out;
}

// The tether with its track, and the counterweight that holds it, with no
// stations aboard. q: { lat (rad, north positive), rA (the anchor's distance
// from the centre, m), rCW (m), density (kg/m³), sigmaEff (Pa), mass (the
// counterweight asked for, kg; null or absent for the one that gives
// MULT_ADVISED) }.
//   The bare cable's shape doesn't depend on the counterweight, so it is
//   solved first and the counterweight estimated from the track's pull along
//   it; the track's share of the shape does depend on the counterweight, so
//   the two are then settled together. A counterweight under MULT_FLOOR, or
//   too light for the tether to leave the anchor MIN_DEPARTURE above
//   horizontal, is raised.
// Returns { ok: false, why: "inside" | "reach" | "landing" } or { ok: true,
// sol (solveMeridianTether's), M (kg), mult, raised: null | "multiple" |
// "departure", asked (kg or null) }.
function sizeStructure(sys, q) {
	var zGuess = NaN, asked = q.mass > 0 ? q.mass : null;
	function solve(M, bare) {
		var s = solveMeridianTether(sys.field, { latA: q.lat, rA: q.rA, rCW: q.rCW, M: M, rho: q.density, sigEff: q.sigmaEff,
			lamMin: bare ? 0 : TRACK.min, lamGrav: bare ? 0 : TRACK.grav, stations: [], zGuess: zGuess });
		if (s.ok) zGuess = s.zCW;
		return s;
	}
	function lands(s) { return s.ok && s.departure >= MIN_DEPARTURE; }
	// The least counterweight that leaves the anchor at MIN_DEPARTURE, from
	// one that doesn't: grow until one does, then halve the gap.
	function landingFloor(Mbad) {
		var lo = Mbad, hi = Mbad * 1.5, s = null;
		for (var i = 0; i < 14; i++) { s = solve(hi); if (lands(s)) break; lo = hi; hi *= 1.6; }
		if (!s || !lands(s)) return null;
		for (var j = 0; j < 16 && hi - lo > 0.002 * hi; j++) {
			var mid = 0.5 * (lo + hi);
			if (lands(solve(mid))) hi = mid; else lo = mid;
		}
		return hi;
	}
	if (!(q.rCW > sys.rStat)) return { ok: false, why: "inside" };
	var sol = solve(1e8, true);
	if (!sol.ok) return { ok: false, why: sol.why };
	var M = asked || MULT_ADVISED * Math.abs(trackPull(sol, TRACK.min, TRACK.grav)) / (sol.gCW * sol.Esurf);
	var floor = 0, raised = null;
	for (var it = 0; it < 10; it++) {
		sol = solve(M);
		if (!lands(sol)) {
			var Mf = landingFloor(M);
			if (Mf == null) return { ok: false, why: "landing" };
			floor = Mf;
			sol = solve(Mf);
			if (!sol.ok) return { ok: false, why: "landing" };
		}
		var req = counterweightFor(sol, MULT_FLOOR), want = asked || counterweightFor(sol, MULT_ADVISED);
		var next = Math.max(want, req, floor);
		raised = next > want * (1 + 1e-9) ? (floor > req ? "departure" : "multiple") : null;
		var done = Math.abs(next - sol.M) <= 1e-5 * sol.M;
		M = next;
		if (done) break;
	}
	if (Math.abs(sol.M - M) > 1e-5 * M) sol = solve(M);
	if (!sol.ok) return { ok: false, why: "landing" };
	return { ok: true, sol: sol, M: M, mult: pullBalance(sol, M).mult, raised: raised, asked: asked };
}

export const MarsElevator = { TRACK: TRACK, MIN_DEPARTURE: MIN_DEPARTURE, sizeStructure: sizeStructure, marsSystem: marsSystem, anchor: anchor, phobosReach: phobosReach, deimosHazard: deimosHazard,
	heightAtRadius: heightAtRadius, etaAt: etaAt, swings: swings, pumping: pumping, backupImpulse: backupImpulse,
	westwardLean: westwardLean, releaseOrbit: releaseOrbit };
