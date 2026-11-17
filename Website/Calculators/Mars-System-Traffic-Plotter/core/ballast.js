/* Mars-System-Traffic-Plotter/core/ballast — what moving ballast along a
 * hanging skyhook does to its orbit, and the sidestep built from it.
 *
 * A hanging skyhook turns once per orbit, every piece of it at the same rate.
 * Two things hold whatever is moved along it:
 *
 *     L = w * sum( m_i r_i^2 )                      its angular momentum
 *     w^2 = GM * sum( m_i / r_i^2 ) / sum( m_i r_i )   the rate at which it
 *                                                   neither rises nor falls
 *
 *     m_i, r_i   each piece's mass and distance from Mars's centre: stations,
 *                ballast, slices of tether
 *     w          the turning rate round Mars, rad/s
 *     GM         Mars's gravitational parameter
 *
 * Nothing pushes on the skyhook from outside while ballast moves, so L keeps
 * its value. With the ballast somewhere new the whole skyhook settles higher
 * or lower by `shift` (every r_i becomes r_i + shift) until both lines hold
 * again; the w that results is the new rate. Ballast far from the middle makes
 * the skyhook lower and faster; ballast near the middle, higher and slower.
 * Put back where it was, the ballast returns the orbit exactly: nothing is
 * owed to thrusters.
 *
 * The energy of the skyhook is
 *
 *     E = w^2 * sum( m_i r_i^2 ) / 2  -  GM * sum( m_i / r_i )
 *
 * and the work the ballast's drive does (or gets back, when negative) in a
 * move is the difference in E between the two settled states.
 *
 * A SIDESTEP uses this to slip the skyhook round its orbit: the ballast goes
 * out, is held, and comes back. While it is away the rate differs by w * rate,
 * and the angle gained is that summed over the time away.
 *
 * Pure (no DOM, no THREE): Node-tested in core/tests/.
 */

// The settled state of the pieces `points` [{ r, m }] holding angular momentum L:
// { shift (m), omega (rad/s), energy (J) }.
export function settle(GM, points, L) {
	function at(d) {
		var s1 = 0, s2 = 0, sq = 0, inv = 0;
		for (var i = 0; i < points.length; i++) {
			var m = points[i].m, r = points[i].r + d;
			s1 += m * r; s2 += m / (r * r); sq += m * r * r; inv += m / r;
		}
		var w = Math.sqrt(GM * s2 / s1);
		return { shift: d, omega: w, L: w * sq, energy: 0.5 * w * w * sq - GM * inv };
	}
	if (L == null) { return at(0); }
	var lo = -1.5e6, hi = 1.5e6;                 // L rises steadily with the shift
	for (var k = 0; k < 60; k++) {
		var mid = 0.5 * (lo + hi);
		if (at(mid).L < L) { lo = mid; } else { hi = mid; }
	}
	return at(0.5 * (lo + hi));
}

// How the skyhook answers as ballast of `mass` goes from rHome toward rFar
// (design radii, m from Mars's centre). `fixed` is every other piece. Returns
// arrays over `steps` + 1 positions, the first being home:
//   travel   how far the ballast has gone along the tether, m
//   rate     the turning rate's change as a fraction of the rate at home
//   shift    how far the whole skyhook has settled, m (negative: lower)
//   work     energy the ballast's drive has put in so far, J (negative: got back)
//   force    the pull the drive holds the ballast against there, N
//   gain     rate summed over the travel so far, m (rate x distance)
// `floorShift`, if given, is the lowest shift allowed (the foot must stay above
// the air): the arrays stop at the last position that keeps it.
export function ballastResponse(GM, fixed, mass, rHome, rFar, steps, floorShift) {
	var n = steps || 48, out = { travel: [], rate: [], shift: [], work: [], force: [], gain: [], rFar: rFar, rHome: rHome, mass: mass };
	function pieces(rb) { return fixed.concat([{ r: rb, m: mass }]); }
	var home = settle(GM, pieces(rHome), null);
	for (var j = 0; j <= n; j++) {
		var rb = rHome + (rFar - rHome) * j / n, s = j ? settle(GM, pieces(rb), home.L) : home;
		if (floorShift != null && s.shift < floorShift) { break; }
		var r = rb + s.shift, rate = s.omega / home.omega - 1, travel = Math.abs(rb - rHome);
		var last = out.travel.length - 1;
		out.gain.push(j ? out.gain[last] + 0.5 * (rate + out.rate[last]) * (travel - out.travel[last]) : 0);
		out.travel.push(travel); out.rate.push(rate); out.shift.push(s.shift);
		out.work.push(s.energy - home.energy);
		out.force.push(mass * Math.abs(s.omega * s.omega * r - GM / (r * r)));
	}
	out.reach = out.travel[out.travel.length - 1];
	return out;
}

// A response's arrays read at `travel` m along (straight-line between entries).
export function responseAt(resp, travel) {
	var t = resp.travel, n = t.length - 1, x = Math.max(0, Math.min(resp.reach, travel));
	var i = n ? Math.min(n - 1, Math.floor(x / resp.reach * n)) : 0;
	while (i > 0 && t[i] > x) { i--; }
	while (i < n - 1 && t[i + 1] < x) { i++; }
	var f = n && t[i + 1] > t[i] ? (x - t[i]) / (t[i + 1] - t[i]) : 0;
	function mix(a) { return n ? a[i] + (a[i + 1] - a[i]) * f : a[0]; }
	return { travel: x, rate: mix(resp.rate), shift: mix(resp.shift), work: mix(resp.work), gain: mix(resp.gain), force: mix(resp.force) };
}

// A sidestep that slips the skyhook `psi` rad round its orbit (positive:
// ahead), using the response `resp`, the skyhook's rate `omega` (rad/s) and
// the ballast's speed along the tether (m/s). The ballast goes only as far as
// it needs: with the whole travel still short of psi, it waits at the far end.
//
//     psi = 2 * omega * gain(x) / speed  +  omega * rate(x) * hold
//
//     x      how far the ballast goes
//     hold   how long it waits there, s
//
// Returns null when this response cannot slip that way, otherwise
//   { psi, reach (m), rTo (design radius the ballast goes to), tMove, tHold,
//     duration (s), rate, shift, work (J, out; the same comes back), peakPower (W), resp, omega, speed }.
export function planSidestep(resp, omega, psi, speed) {
	if (!(resp.reach > 0) || !psi) { return null; }
	var sign = psi > 0 ? 1 : -1, want = Math.abs(psi), k = 2 * omega / speed, n = resp.travel.length - 1;
	var reach = null, hold = 0;
	for (var i = 1; i <= n && reach == null; i++) {
		var g0 = sign * k * resp.gain[i - 1], g1 = sign * k * resp.gain[i];
		if (g1 >= want && g1 > g0) { reach = resp.travel[i - 1] + (resp.travel[i] - resp.travel[i - 1]) * (want - g0) / (g1 - g0); }
	}
	if (reach == null) {
		var endRate = sign * resp.rate[n], got = sign * k * resp.gain[n];
		if (!(endRate > 0)) { return null; }
		reach = resp.reach; hold = (want - got) / (omega * endRate);
	}
	var end = responseAt(resp, reach), peak = 0;
	for (var j = 0; j <= n && resp.travel[j] <= reach; j++) { peak = Math.max(peak, resp.force[j] * speed); }
	var tMove = reach / speed;
	return { psi: psi, reach: reach, rTo: resp.rHome + (resp.rFar > resp.rHome ? reach : -reach), tMove: tMove, tHold: hold,
	         duration: 2 * tMove + hold, rate: end.rate, shift: end.shift, work: end.work,
	         peakPower: Math.max(peak, end.force * speed), resp: resp, omega: omega, speed: speed };
}

// Where a sidestep has the skyhook t seconds after it starts:
//   psi     angle slipped so far, rad
//   rate    the turning rate's change then, as a fraction
//   shift   how far the skyhook has settled, m
//   travel  how far out the ballast is, m
export function sidestepState(step, t) {
	if (t <= 0) { return { psi: 0, rate: 0, shift: 0, travel: 0 }; }
	if (t >= step.duration) { return { psi: step.psi, rate: 0, shift: 0, travel: 0 }; }
	var k = step.omega / step.speed, out = k * responseAt(step.resp, step.reach).gain;
	var travel, psi;
	if (t < step.tMove) {
		travel = t * step.speed; psi = k * responseAt(step.resp, travel).gain;
	} else if (t <= step.tMove + step.tHold) {
		travel = step.reach; psi = out + step.omega * step.rate * (t - step.tMove);
	} else {
		travel = (step.duration - t) * step.speed;
		psi = out + step.omega * step.rate * step.tHold + (out - k * responseAt(step.resp, travel).gain);
	}
	var here = responseAt(step.resp, travel);
	return { psi: psi, rate: here.rate, shift: here.shift, travel: travel };
}
