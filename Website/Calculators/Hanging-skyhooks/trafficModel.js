// Traffic on a hanging skyhook — the pure arithmetic behind the Traffic card
// (trafficCard.js): flights, the hauls along the tether, and the energy and
// orbit balance they add up to. ES module, no DOM, so it runs in Node:
//   import { Traffic } from "./trafficModel.js";
//
// Ships dock and are released at the tether's own speed, so a docking or a
// release passes no impulse to the skyhook. The skyhook's orbit and its power
// supply feel the traffic only through mass moved along the tether: cargo
// hauled from where it arrives to the anchor station and from there to where
// it leaves, and empty ships hauled from their docking point to their release
// point. For a mass flow ṁ hauled from r₁ to r₂:
//
//   P = ṁ · [φ(r₂) − φ(r₁)],  φ(r) = −GM/r − ½ω²r²
//   τ = ṁ · ω · (r₂² − r₁²),  F = τ / r_mount
//
//   P        power the hauling equipment delivers (W); negative: it can regenerate
//   φ        effective potential in the frame turning with the tether (J/kg)
//   τ        torque the hauling takes from the orbit (N·m); negative: it gives some back
//   F        the steady thrust at the reboost engines' mount (the top) that cancels τ (N)
//   GM, ω    the body's gravitational parameter, the tether's angular velocity
//   r        distance from the body's centre (m)
//
// Units are SI: kg, s, m, W, N.

import { OrbitalMath } from "../../Shared/math-utils.js";

export const YEAR = 365.25 * 86400;

export const Traffic = {
	// Flights per second for the bulk direction of a route. The ships chosen
	// fly an equal number of flights each, every one full:
	//   N = k · ṁ / ΣP   (k ships chosen, P each one's payload, kg)
	flights: function (rate, payloads) {
		var sum = payloads.reduce(function (a, p) { return a + p; }, 0);
		return sum > 0 ? payloads.length * rate / sum : NaN;
	},

	// Cargo per flight for the return direction, which rides the bulk direction's flights.
	loadPerFlight: function (rate, flights) {
		return flights > 0 ? rate / flights : NaN;
	},

	// Power, torque and equivalent thrust of a haul (see the header). env: { GM, omega, rMount }.
	haul: function (env, rFrom, rTo, rate) {
		var w = env.omega;
		var power = rate * (OrbitalMath.specificPotential(env.GM, w, rTo) - OrbitalMath.specificPotential(env.GM, w, rFrom));
		var torque = rate * w * (rTo * rTo - rFrom * rFrom);
		return { power: power, torque: torque, force: torque / env.rMount };
	},

	// Empty ships moved from where they docked to where they are released: `flights`
	// ships a second of `empty` kg, spread over the docking points and over the release
	// points in the same shares as the cargo. docks, releases: [{ at, share }], shares
	// summing to 1. Returns [{ from, to, rate }], leaving out ships released where they docked.
	shipMoves: function (flights, empty, docks, releases) {
		var out = [];
		if (!(flights > 0) || !(empty > 0)) return out;
		docks.forEach(function (d) {
			releases.forEach(function (r) {
				var rate = flights * empty * d.share * r.share;
				if (d.at !== r.at && rate > 0) out.push({ from: d.at, to: r.at, rate: rate });
			});
		});
		return out;
	},

	// A total shared among several parts, one of which takes what the others leave.
	// values: each part's amount (the remainder's own is ignored); rem: the index of
	// the remainder. Returns { values, over }: `over` is how far the other parts exceed
	// the total (0 when they fit), and the remainder is then 0.
	split: function (total, values, rem) {
		var others = values.reduce(function (a, v, i) { return i === rem ? a : a + (isFinite(v) ? Math.max(0, v) : 0); }, 0);
		var left = total - others;
		var out = values.map(function (v, i) { return i === rem ? Math.max(0, left) : (isFinite(v) ? Math.max(0, v) : 0); });
		return { values: out, over: left < 0 ? -left : 0 };
	},

	// What all the hauls add up to. hauls: [{ power, force }]. env: { period, climberEff,
	// thrusterEff, vExhaust } — an efficiency left null gives null for what needs it.
	//   Energy at the equipment: losses cost P / η, gains return |P| · η.
	//   Reboost: the net thrust F at exhaust speed v_e, electrical power ½ · |F| · v_e / η,
	//   propellant |F| / v_e.
	balance: function (hauls, env) {
		var b = { power: 0, loss: 0, gain: 0, force: 0 };
		hauls.forEach(function (h) {
			b.power += h.power;
			if (h.power > 0) b.loss += h.power; else b.gain -= h.power;
			b.force += h.force;
		});
		b.energyOrbit = b.power * env.period;
		b.energyYear = b.power * YEAR;
		b.impulseOrbit = b.force * env.period;
		b.impulseYear = b.force * YEAR;
		var ce = env.climberEff;
		b.supplied = ce > 0 ? b.loss / ce - b.gain * ce : null;
		var te = env.thrusterEff, ve = env.vExhaust;
		b.reboostPower = te > 0 && ve > 0 ? 0.5 * Math.abs(b.force) * ve / te : null;
		b.propFlow = ve > 0 ? Math.abs(b.force) / ve : null;
		b.propYear = b.propFlow != null ? b.propFlow * YEAR : null;
		return b;
	}
};
