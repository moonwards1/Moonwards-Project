// Hanging skyhook model — the pure physics of a vertical (non-rotating)
// gravity-gradient tether. ES module, no DOM, so it runs in Node:
//   import { computeSkyhook, PROPELLANT_MAX } from "./skyhookModel.js";
//
// Tether materials are Shared/materials.js.
//
// computeSkyhook(body, inp) takes a body from Shared/orbit.js (`systems`) and
// plain inputs, and returns every figure the page shows. Units are SI unless a
// name says otherwise.
//
// inp:
//   foot, centre, top          altitudes, m
//   receivingDeck, outerDocks, launchDeck   altitudes, m; null when the stations
//                              are not modelled (deck = foot, docks and launch
//                              deck = top)
//   stationMass                { receivingDeck, outerDocks, launchDeck }, kg: each station's
//                              facility plus its maximum load of ships, cargo and supplies,
//                              held at that point on the tether; omitted or null for none
//   strength                   specific strength already divided by the safety
//                              factor: (σ / S) / ρ, J/kg
//   loadTop, loadFoot          masses held at the top and foot tips, kg
//   distUpper, distLower       masses spread evenly along the upper / lower tether, kg
//                              (climbers, power, fuel, tracks; stations are stationMass)
//   comMass                    the anchor station, kg: the principal station, placed where the
//                              tension arriving at the centre of mass from above equals the
//                              tension arriving from below
//   anchorMass                 optional, kg: a moon at the centre of mass that the tether hangs
//                              from (Shared/body-profiles.js ANCHORS). It takes the anchor
//                              station's place: the two halves need not balance, since the moon
//                              holds the difference, and comMass is ignored
//   cargoFrom, cargoTo         altitudes, m, or "anchor" for the anchor station wherever the balance
//                              places it: the cargo route, where climbers join the cable and
//                              where they deliver; omitted for foot → top. Either direction
//   rate                       delivery rate along the route, t/day
//   perClimber                 t;  vClimb m/s;  effDrive 0–1
//   propellant                 "oxygen" | "hydrogen";  vExhaust km/s
//   effThruster, effSupply     0–1
//   targetPerigee, ifaceAlt    km above the parent body (entry at the parent planet)

import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";

// Viable mature-engine exhaust-speed ceilings, km/s.
export const PROPELLANT_MAX = { oxygen: 20, hydrogen: 80 };

// Share of the delivery rate that comes back along the route, destination → origin.
export const DESCENT_SHARE = 0.01;

// Tension and tether mass of a constant-stress tether, built up from one tip inward
// to rEnd. All radii are from the body's centre, m.
//   GM, omega   the body's gravitational parameter and the tether's angular rate
//   s           specific strength with safety factor applied, J/kg
//   tipLoad     kg held at the tip
//   distLoad    kg spread evenly over the stretch from the tip to rEnd
//   points      optional [{ r, m, name }]: stations, masses held at a point along the
//               stretch. Those outside it are ignored; one at the tip joins the tip load.
// Net outward pull is a(r) = ω²r − GM/r², zero at the nominal centre, outward above
// it and inward below. Sweeping down from the top, tension grows by exp(∫a dr / s)
// across a step and gains the weight of the load added within it (lumps at the tip
// and at each station, a steady λ·a·dr along the way); sweeping up from the foot it
// is the same with the signs reversed. A station adds m·|a(r)| as a step in tension,
// and the taper carries on from the higher value, so the cross-section steps up there.
// Past the nominal centre the pull reverses, so tension then falls again. The tether's
// own mass is dm = T/s · dr, which the taper already accounts for.
// rec, if given ({ r: [], T: [] }), is filled with the tension at every step from the
// tip to rEnd, for drawing the taper (a station appears as two entries at one radius).
// Returns { tension (N at rEnd, from everything outboard), mass (tether, kg),
//           slack (true if the tension would have gone negative: the stretch cannot hold),
//           sections: [{ from, to, rFrom, rTo, tFrom, tTo, tMax, mass }] — the stretches
//               between the tip, each station and rEnd, in sweep order; `from` is the
//               tip or station name ("tip" / the station's name), `to` the next station's
//               name or null for rEnd; tFrom is the tension just inboard of `from`, tTo the
//               tension arriving at `to` before its own load joins,
//           stations: [{ key, name, r, m, pull, tension, anchor }] — each station passed, the tension
//               it adds (pull, N) and the total tension just inboard of it (tension, N) }.
export function sweepTether(GM, omega, s, rTip, rEnd, tipLoad, distLoad, steps, rec, points) {
	var n = steps || 1000, len = Math.abs(rEnd - rTip);
	var sg = rTip >= rEnd ? 1 : -1;   // +1 sweeping down from the top, −1 sweeping up from the foot
	var lambda = len > 0 ? distLoad / len : 0;
	var pull = function (r) { return omega * omega * r - GM / (r * r); };
	var phi = function (r) { return 0.5 * omega * omega * r * r + GM / r; };   // dφ/dr = a
	var dist = function (r) { return sg * (rTip - r); };   // distance from the tip toward rEnd
	var lumps = (points || []).filter(function (p) { return p.m > 0 && dist(p.r) >= 0 && dist(p.r) < len; })
		.sort(function (a, b) { return dist(a.r) - dist(b.r); });
	var T = tipLoad * sg * pull(rTip), mass = 0, slack = false;
	var stations = [];
	while (lumps.length && dist(lumps[0].r) === 0) {   // at the tip: part of the tip load
		var p0 = lumps.shift(), add0 = p0.m * sg * pull(rTip);
		T += add0;
		stations.push({ key: p0.key, name: p0.name, r: p0.r, m: p0.m, pull: add0, tension: Math.max(T, 0), anchor: !!p0.anchor });
	}
	if (T < 0) { T = 0; slack = true; }
	if (rec) { rec.r.push(rTip); rec.T.push(T); }
	var sections = [], from = "tip", rFrom = rTip, tFrom = T, tMax = T, segMass = 0;
	var marks = lumps.concat([{ r: rEnd, end: true }]);
	marks.forEach(function (mk) {
		var seg = Math.abs(mk.r - rFrom);
		var k = len > 0 ? Math.max(4, Math.ceil(n * seg / len)) : 1, dr = (mk.r - rFrom) / k;
		for (var i = 0; i < k; i++) {
			var r1 = rFrom + i * dr, r2 = i === k - 1 ? mk.r : r1 + dr;
			var grow = Math.exp(-(phi(r2) - phi(r1)) / s);
			var Tn = T * grow + sg * lambda * Math.abs(r2 - r1) * pull((r1 + r2) / 2) * Math.sqrt(grow);
			var dm = (T + Tn) / 2 / s * Math.abs(r2 - r1);
			mass += dm; segMass += dm;
			if (Tn < 0) { Tn = 0; slack = true; }
			T = Tn;
			if (T > tMax) tMax = T;
			if (rec) { rec.r.push(r2); rec.T.push(T); }
		}
		sections.push({ from: from, to: mk.end ? null : mk.name, rFrom: rFrom, rTo: mk.r, tFrom: tFrom, tTo: T, tMax: tMax, mass: segMass });
		if (mk.end) return;
		var add = mk.m * sg * pull(mk.r);
		T += add;
		if (T < 0) { T = 0; slack = true; }
		stations.push({ key: mk.key, name: mk.name, r: mk.r, m: mk.m, pull: add, tension: T, anchor: !!mk.anchor });
		if (rec) { rec.r.push(mk.r); rec.T.push(T); }
		from = mk.name; rFrom = mk.r; tFrom = T; tMax = T; segMass = 0;
	});
	return { tension: T, mass: mass, slack: slack, sections: sections, stations: stations };
}

export function computeSkyhook(moon, inp) {
	var R = Number(moon.radius), GM = moon.GM;
	var t = {};
	var warnings = [];
	var integral = function (a, b) { return OrbitalMath.taperIntegral(GM, t.angularVelocity, a, b); };

	t.foot = inp.foot; t.top = inp.top; t.centre = inp.centre;
	t.receivingDeck = inp.receivingDeck == null ? t.foot : inp.receivingDeck;   // the foot when not modelled
	t.outerDocks    = inp.outerDocks    == null ? t.top  : inp.outerDocks;      // the top when not modelled
	t.launchDeck    = inp.launchDeck    == null ? t.top  : inp.launchDeck;      // where cargo is released
	t.Length = t.top - t.foot;
	t.surfaceGravity = GM / (R * R);

	if (t.foot < 0) warnings.push("The tether foot is inside the body.");
	if (t.foot > t.top) warnings.push("The tether foot can not be higher than the top.");
	else if (t.centre < t.foot || t.centre > t.top) warnings.push("The centre of mass must be between the foot and the top.");
	if (inp.receivingDeck != null && (t.receivingDeck < t.foot || t.receivingDeck > t.top)) warnings.push("The receiving deck must be between the foot and the top.");
	if (inp.outerDocks != null && (t.outerDocks < t.foot || t.outerDocks > t.top)) warnings.push("The outer docks must be between the foot and the top.");
	if (inp.launchDeck != null && (t.launchDeck < t.foot || t.launchDeck > t.top)) warnings.push("The main launch deck must be between the foot and the top.");

	// ---- orbit and speeds ----
	t.time = 2 * Math.PI * Math.sqrt(Math.pow(t.centre + R, 3) / GM);
	t.centreVel = OrbitalMath.circularVelocity(GM, R + t.centre);
	t.angularVelocity = t.centreVel / (t.centre + R);
	t.footVel = (t.foot + R) * t.angularVelocity;
	t.topVel = (t.top + R) * t.angularVelocity;
	t.launchDeckVel = (t.launchDeck + R) * t.angularVelocity;
	t.topOrbit = OrbitalMath.circularVelocity(GM, t.top + R);
	t.launchDeckOrbit = OrbitalMath.circularVelocity(GM, t.launchDeck + R);
	t.footOrbit = OrbitalMath.circularVelocity(GM, t.foot + R);
	t.escapeFromTop = Math.sqrt(t.launchDeckVel * t.launchDeckVel - t.launchDeckOrbit * t.launchDeckOrbit * 2);

	// ---- dropped from the foot: apoapsis at the foot, other apsis newPeriapsis (radius) ----
	t.hitTheGround = Math.sqrt(t.footVel * t.footVel + 2 * GM / R - t.footOrbit * t.footOrbit * 2);
	t.newPeriapsis = Math.pow((t.foot + R) * t.footVel, 2) / (2 * GM - (t.foot + R) * t.footVel * t.footVel);
	t.collisionAngle = Math.acos(t.angularVelocity * (t.foot + R) * (t.foot / R + 1) / t.hitTheGround);
	t.hitsSurface = t.newPeriapsis < R;
	t.impactFromVertical = Math.PI / 2 - t.collisionAngle;
	// Angle around the body from the foot to the impact point.
	t.impactAround = t.hitsSurface ? Math.asin(
		(2 * (t.foot + R) * t.newPeriapsis - R * (t.foot + R + t.newPeriapsis)) /
		(R * (t.foot + R - t.newPeriapsis))
	) + Math.PI / 2 : NaN;

	// ---- tether properties ----
	t.strength = inp.strength;
	t.lowAcceleration = GM / Math.pow(R + t.foot, 2) - t.footVel * t.footVel / (R + t.foot);
	t.highAcceleration = -GM / Math.pow(R + t.top, 2) + t.topVel * t.topVel / (R + t.top);
	t.lowIntegral = integral(t.foot + R, t.centre + R);
	t.highIntegral = integral(t.centre + R, t.top + R);
	t.lowRatio = Math.exp(t.lowIntegral / t.strength);
	t.highRatio = Math.exp(t.highIntegral / t.strength);

	// ---- loads and forces ----
	// Constant-stress cable: T(r) = σ·A(r). The centre of mass divides the upper tether
	// (top → centre of mass) from the lower (foot → centre of mass). Each half is swept
	// from its tip inward to the centre of mass (sweepTether), picking up its tip load, its
	// evenly spread load and every station on its side, the anchor station among them.
	// The cable is continuous through the centre of mass and nothing hangs there, so the
	// tension arriving from above equals the tension arriving from below. That condition
	// fixes where the anchor station sits; it puts the installation's true centre of mass
	// on the nominal one, which is what fixes the orbit.
	var rFoot = t.foot + R, rTop = t.top + R, rCentre = t.centre + R, w = t.angularVelocity;
	t.loads = { top: inp.loadTop, foot: inp.loadFoot, distUpper: inp.distUpper, distLower: inp.distLower, com: inp.comMass };
	var sm = inp.stationMass || {}, points = [];
	[["launchDeck", "Main launch deck"], ["outerDocks", "Outer docks"], ["receivingDeck", "Receiving deck"]].forEach(function (st) {
		var m = Number(sm[st[0]]) || 0;
		if (inp[st[0]] != null && m > 0) points.push({ key: st[0], name: st[1], r: inp[st[0]] + R, m: m });
	});
	// Both halves swept to the centre of mass with the anchor station (mass mAnchor) at rs.
	var halves = function (rs, mAnchor, steps, rec) {
		var pts = mAnchor > 0 ? points.concat([{ name: "Anchor station", r: rs, m: mAnchor, anchor: true }]) : points;
		return {
			up: sweepTether(GM, w, t.strength, rTop, rCentre, t.loads.top, t.loads.distUpper, steps, rec && rec.up, pts),
			low: sweepTether(GM, w, t.strength, rFoot, rCentre, t.loads.foot, t.loads.distLower, steps, rec && rec.low, pts)
		};
	};
	var STEPS = 600;
	// Tension arriving from below minus from above: zero when the anchor station balances.
	var surplus = function (rs, mAnchor) {
		var h = halves(rs, mAnchor, STEPS);
		return h.up.slack || h.low.slack ? NaN : h.low.tension - h.up.tension;
	};
	// The station may sit anywhere on the tether. The balance can have more than one
	// solution, so the tether is scanned from end to end and the sign change nearest the
	// centre of mass is refined. If the loads cannot be balanced anywhere, the station is
	// left at the centre of mass and the leftover is reported (t.unbalance): the
	// installation's true centre of mass is then not where the nominal one says.
	var rs = rCentre;
	var anchored = inp.anchorMass > 0;
	if (anchored) t.loads.com = 0;
	t.balanced = anchored;
	if (!anchored && t.foot < t.top) {
		var SCAN = 100, best = null, prevR = rFoot + 1, prevS = surplus(prevR, t.loads.com);
		for (var q = 1; q <= SCAN; q++) {
			var rq = rFoot + 1 + (rTop - rFoot - 2) * q / SCAN, sq = surplus(rq, t.loads.com);
			if (prevS * sq <= 0) {
				var dist = Math.abs((prevR + rq) / 2 - rCentre);
				if (!best || dist < best.dist) best = { lo: prevR, hi: rq, sLo: prevS, dist: dist };
			}
			prevR = rq; prevS = sq;
		}
		if (best) {
			var lo = best.lo, hi = best.hi;
			for (var k = 0; k < 50; k++) {
				var mid = (lo + hi) / 2;
				if (best.sLo * surplus(mid, t.loads.com) <= 0) hi = mid; else lo = mid;
			}
			rs = (lo + hi) / 2;
			t.balanced = true;
		}
	}
	t.profile = { up: { r: [], T: [] }, low: { r: [], T: [] } };
	var fin = halves(rs, t.loads.com, STEPS, t.profile);
	t.comOffset = rs - rCentre;   // the anchor station's altitude above (+) or below (−) the centre of mass
	t.tensionUpper = fin.up.tension;   // N, arriving at the centre of mass from above
	t.tensionLower = fin.low.tension;  // N, arriving from below; equal to the above when balanced
	t.unbalance = t.tensionLower - t.tensionUpper;   // N; 0 when balanced
	// An anchoring moon takes the difference as a net pull toward the primary (unbalance > 0)
	// or away from it. Its orbit settles where the extra gravity-gradient force balances that
	// pull: the net outward force per unit mass changes with radius at d/dr(ω²r − GM/r²) =
	// ω² + 2GM/r³ = 3ω² on a circular orbit, so the moon sits lower by F / (3ω²M).
	t.anchor = anchored ? { mass: inp.anchorMass, pull: t.unbalance, shift: -t.unbalance / (3 * w * w * inp.anchorMass) } : null;
	var peakOf = function (h) { return h.sections.reduce(function (a, x) { return Math.max(a, x.tMax, x.tTo); }, 0); };
	t.tensionPeak = Math.max(peakOf(fin.up), peakOf(fin.low));
	t.tetherMassUpper = fin.up.mass;
	t.tetherMassLower = fin.low.mass;
	t.tetherMass = t.tetherMassUpper + t.tetherMassLower;
	// Each half carries its tip load, its spread load and the stations on its side of the
	// centre of mass. The anchor station's own mass is left out of these totals; it has its own
	// line (t.tetherParts) for the stretch of cable that carries it.
	var stationSum = function (h) { return h.stations.reduce(function (a, x) { return a + (x.anchor ? 0 : x.m); }, 0); };
	t.sections = { up: fin.up.sections, low: fin.low.sections };
	t.stations = { up: fin.up.stations, low: fin.low.stations };
	// Each station's figures, from the top down: the total tension at its level (just inboard of
	// it, its own pull included), the net pull per unit mass there, and what a release along the
	// local horizontal at the tether's speed comes to (null for the anchor station, which releases
	// nothing). A station with no mass is not in the sweep; its tension is that of a sweep from
	// the tip to its level.
	var entries = fin.up.stations.concat(fin.low.stations);
	var tensionAt = function (r) {
		var up = r > rCentre, tip = up ? rTop : rFoot, span = Math.abs(rCentre - tip);
		if (r === rCentre || span === 0) return t.tensionUpper;
		var share = Math.abs(r - tip) / span;
		return sweepTether(GM, w, t.strength, tip, r, up ? t.loads.top : t.loads.foot, (up ? t.loads.distUpper : t.loads.distLower) * share, STEPS, null, listedPoints).tension;
	};
	var listedPoints = t.loads.com > 0 ? points.concat([{ name: "Anchor station", r: rs, m: t.loads.com, anchor: true }]) : points;
	var figure = function (p) {
		var e = p.tension != null ? null : entries.find(function (x) { return p.anchor ? x.anchor : x.key === p.key; });
		return { key: p.anchor ? "anchor" : p.key, name: p.name, anchor: !!p.anchor, r: p.r, m: p.m,
			tension: p.tension != null ? p.tension : e ? e.tension : tensionAt(p.r), pull: e ? e.pull : 0,
			acceleration: Math.abs(w * w * p.r - GM / (p.r * p.r)), outward: w * w * p.r - GM / (p.r * p.r) >= 0,
			release: p.anchor ? null : OrbitalMath.horizontalRelease(GM, p.r, w * p.r, R) };
	};
	var named = [["launchDeck", "Main launch deck"], ["outerDocks", "Outer docks"], ["receivingDeck", "Receiving deck"]].filter(function (st) { return inp[st[0]] != null; })
		.map(function (st) { return { key: st[0], name: st[1], r: inp[st[0]] + R, m: Number(sm[st[0]]) || 0 }; });
	// The top and foot stations are the tips: the tension there is what the tip load and anything at
	// the tip hang on, the first point of each half's profile.
	var tips = [{ key: "top", name: "Top station", r: rTop, m: t.loads.top, tension: t.profile.up.T[0] }, { key: "foot", name: "Foot station", r: rFoot, m: t.loads.foot, tension: t.profile.low.T[0] }];
	t.stationFigures = tips.concat(named, t.loads.com > 0 ? [{ name: "Anchor station", r: rs, m: t.loads.com, anchor: true }] : []).map(figure).sort(function (a, b) { return b.r - a.r; });
	t.loads.stationsUpper = stationSum(fin.up);
	t.loads.stationsLower = stationSum(fin.low);
	t.loads.upperTotal = t.loads.top + t.loads.distUpper + t.loads.stationsUpper;
	t.loads.lowerTotal = t.loads.foot + t.loads.distLower + t.loads.stationsLower;
	// Tether mass as a multiple of everything each half holds up.
	t.massMultipleUpper = t.loads.upperTotal > 0 ? t.tetherMassUpper / t.loads.upperTotal : NaN;
	t.massMultipleLower = t.loads.lowerTotal > 0 ? t.tetherMassLower / t.loads.lowerTotal : NaN;
	var carried = t.loads.upperTotal + t.loads.lowerTotal;
	t.massMultiple = carried > 0 ? t.tetherMass / carried : NaN;
	// The tether's mass in parts, each with the load it holds up. The anchor station splits its
	// own tether into the stretch out to the tip (holding up what lies beyond the station) and
	// the stretch between the station and the centre of mass (holding up everything on that
	// tether, the station included). The other tether is a single part.
	var part = function (mass, held) { return { mass: mass, held: held, multiple: held > 0 ? mass / held : NaN }; };
	t.tetherParts = { up: part(t.tetherMassUpper, t.loads.upperTotal), low: part(t.tetherMassLower, t.loads.lowerTotal), anchorSegment: null, anchorHalf: null };
	["up", "low"].forEach(function (key) {
		var h = fin[key], at = h.stations.findIndex(function (x) { return x.anchor; });
		if (at < 0) return;
		var rTip = key === "up" ? rTop : rFoot, tip = key === "up" ? t.loads.top : t.loads.foot, spread = key === "up" ? t.loads.distUpper : t.loads.distLower;
		var sum = function (list) { return list.reduce(function (a, x) { return a + x.mass; }, 0); };
		var inner = sum(h.sections.slice(at + 1)), outer = sum(h.sections.slice(0, at + 1));
		var share = Math.abs(h.stations[at].r - rTip) / Math.abs(rCentre - rTip);
		var beyond = h.stations.slice(0, at).reduce(function (a, x) { return a + x.m; }, 0);
		t.tetherParts[key] = part(outer, tip + spread * share + beyond);
		t.tetherParts.anchorSegment = part(inner, key === "up" ? t.loads.upperTotal + t.loads.com : t.loads.lowerTotal + t.loads.com);
		t.tetherParts.anchorHalf = key;
	});
	if (t.foot < t.top && !t.balanced) {
		var gap = Math.abs(t.unbalance), gapText = gap >= 1e12 ? (gap / 1e12).toFixed(gap >= 1e13 ? 0 : 1) + " TN" : gap >= 1e9 ? (gap / 1e9).toFixed(1) + " GN" : (gap / 1e6).toFixed(0) + " MN";
		warnings.push("Out of balance: no position for the anchor station balances these loads. At the centre of mass the " +
			(t.unbalance < 0 ? "upper tether outweighs the lower" : "lower tether outweighs the upper") + " by " + gapText +
			", so the true centre of mass is not where you set it. Add mass to the anchor station, or load to the lighter side.");
	}

	// ---- release points: altitude where a release reaches each neighbour ----
	t.targets = releaseTargets(moon, t);

	// ---- throughput along the cargo route, origin → destination, with a return stream ----
	var rateTpd = inp.rate, mC = inp.perClimber, vC = inp.vClimb, eff = inp.effDrive;
	var end = function (v, dflt) { return v == null ? dflt : v === "anchor" ? t.centre + t.comOffset : v; };
	var rFrom = end(inp.cargoFrom, t.foot) + R, rTo = end(inp.cargoTo, t.top) + R;
	if (rFrom === rTo) warnings.push("The cargo route starts and ends at the same place.");
	if (Math.min(rFrom, rTo) < t.foot + R || Math.max(rFrom, rTo) > t.top + R) warnings.push("The cargo route must lie between the foot and the top.");
	var L = Math.abs(rTo - rFrom), rLo = Math.min(rFrom, rTo), rHi = Math.max(rFrom, rTo), rC = t.centre + R;
	var th = { from: rFrom - R, to: rTo - R, up: rTo >= rFrom };
	th.tripDays = (L / vC) / 86400;   // one way; the return stream takes as long
	th.perDay = rateTpd / mC;
	th.intervalH = 24 / th.perDay;
	th.onCable = th.perDay * th.tripDays;
	th.cargoT = rateTpd * th.tripDays;
	th.returnRate = rateTpd * DESCENT_SHARE;
	th.returnT = th.returnRate * th.tripDays;
	th.spacingKm = (L / 1e3) / Math.max(th.onCable, 1e-9);
	// Cargo on the cable adds its weight to the tension at the centre of mass: the
	// part of the route below the centre pulls inward, the part above pulls outward.
	var below = rLo < rC ? integral(rLo, Math.min(rHi, rC)) : 0;
	var above = rHi > rC ? integral(Math.max(rLo, rC), rHi) : 0;
	var lambda = L > 0 ? (th.cargoT + th.returnT) * 1e3 / L : 0;
	th.addedTension = lambda * (below + above);
	th.addedTensionPct = 100 * th.addedTension / t.tensionPeak;
	th.massFlow = rateTpd * 1e3 / 86400;
	// Energy per kg is the change in effective potential, highest at the centre of mass:
	// climbing toward it costs, moving away from it regenerates.
	var netLift = OrbitalMath.specificPotential(GM, t.angularVelocity, rTo) - OrbitalMath.specificPotential(GM, t.angularVelocity, rFrom);
	th.liftPower = netLift * th.massFlow / eff;
	th.energyPerT = netLift / eff / 1e6;   // GJ/t
	t.throughput = th;

	// ---- station-keeping: reboost thrust at the top cancels the climbers' drag ----
	// Cargo carried outward takes angular momentum from the orbit: the drain is
	// mdot·ω·(r_to² − r_from²), less the return stream's share. Cargo carried inward
	// adds angular momentum, so the thrust is negative: the engines brake instead.
	var w = t.angularVelocity, r_mount = t.top + R;
	var sk = {};
	sk.vMount = w * r_mount;
	sk.torque = th.massFlow * (1 - DESCENT_SHARE) * w * (rTo * rTo - rFrom * rFrom);
	sk.thrust = sk.torque / r_mount;
	sk.orbitPower = Math.abs(sk.thrust) * sk.vMount;   // the engines work as hard to brake as to boost
	sk.vExhaust = Math.min(inp.vExhaust, PROPELLANT_MAX[inp.propellant]) * 1000;
	sk.propFlow = Math.abs(sk.thrust) / sk.vExhaust;
	sk.jetPower = 0.5 * Math.abs(sk.thrust) * sk.vExhaust;
	sk.elecPower = sk.jetPower / inp.effThruster;
	sk.genPower = sk.elecPower / inp.effSupply;
	sk.propPerCargo = sk.propFlow / Math.max(th.massFlow, 1e-12);
	sk.energyPerT = sk.genPower / Math.max(th.massFlow, 1e-12) / 1e6;   // GJ/t
	t.keeping = sk;

	// ---- Earth reentry of cargo released from the launch deck (patched conic) ----
	t.reentry = reentry(moon, t, inp);

	t.warnings = warnings;
	return t;
}

function releaseTargets(moon, t) {
	var R = Number(moon.radius), GM = moon.GM;
	var pt = { siblings: [], aunts: [] };
	if (moon.orbit) {
		pt.parent = moon.orbit.system;
		pt.siblings = moon.orbit.system.satellites.filter(function (s) { return s.properties.name !== moon.properties.name; }) || [];
		if (moon.orbit.system.orbit) {
			pt.aunts = moon.orbit.system.orbit.system.satellites.filter(function (s) { return s.properties.name !== pt.parent.properties.name; });
		}
	}
	var targets = [];
	if (pt.parent) {
		targets.push({ name: pt.parent.properties.name,
			vinf: moon.orbit.vela - Math.sqrt(moon.orbit.system.GM * (2 / moon.orbit.a - 2 / (moon.orbit.a + moon.orbit.system.radius))) });
	}
	pt.siblings.forEach(function (s) {
		targets.push({ name: s.properties.name,
			vinf: Math.abs(moon.orbit.vela - Math.sqrt(moon.orbit.system.GM * (2 / moon.orbit.a - 2 / (moon.orbit.a + s.orbit.a)))) });
	});
	pt.aunts.forEach(function (s) {
		var o = moon.orbit.system.orbit;
		targets.push({ name: s.properties.name,
			vinf: Math.sqrt(Math.pow(o.vela - Math.sqrt(o.system.GM * (2 / o.a - 2 / (o.a + s.orbit.a))), 2) + moon.orbit.vela * moon.orbit.vela * 2) - moon.orbit.vela });
	});
	var w2 = t.angularVelocity * t.angularVelocity;
	targets.forEach(function (tg) {
		if (Number.isNaN(tg.vinf)) { tg.location = NaN; return; }
		var v2 = tg.vinf * tg.vinf, val = R + t.centre, step = (R + t.centre) / 2;
		while (w2 * val * val - 2 * GM / val < v2) { val += step; step *= 2; }
		for (var i = 0; i < 50; i++) { step /= 2; if (w2 * val * val - 2 * GM / val < v2) val += step; else val -= step; }
		tg.location = val;           // radius, m
		tg.altitude = val - R;
	});
	return targets;
}

// Cargo released from the launch deck toward the planet the body orbits, entering its
// atmosphere. Applies where that planet has one (body-profiles.js, "parentEntry"); the
// figures are computed for any body with a parent, and `parent` names it.
function reentry(moon, t, inp) {
	var parent = moon.orbit && String(moon.orbit.system) !== "Sun" ? moon.orbit.system : null;
	var out = { parent: parent ? String(parent) : null };
	if (!parent || !isFinite(t.escapeFromTop)) { out.escapes = false; return out; }
	out.escapes = true;
	var GMe = parent.GM, Re = Number(parent.radius), D = moon.orbit.a;
	var vinf = t.escapeFromTop, Vmoon = Math.sqrt(GMe / D);
	var Varr = Vmoon - vinf;                          // parent-relative speed at lunar distance
	var eps = Varr * Varr / 2 - GMe / D;
	var aNat = -GMe / (2 * eps);
	var rpNat = 2 * aNat - D;                         // natural transfer perigee radius
	var rpt = Re + inp.targetPerigee * 1000, rI = Re + inp.ifaceAlt * 1000;
	var aT = (D + rpt) / 2;
	var vT = Math.sqrt(GMe * (2 / D - 1 / aT));
	out.vinf = vinf;
	out.arrivalSpeed = Math.abs(Varr);
	out.naturalPerigeeAlt = rpNat - Re;
	out.burn = vT - Varr;                             // + prograde raises perigee, − retrograde lowers
	out.entry = rpt < rI && rI < D;
	if (out.entry) {
		var eT = (D - rpt) / (D + rpt);
		var hT = Math.sqrt(GMe * aT * (1 - eT * eT));
		var vI = Math.sqrt(GMe * (2 / rI - 1 / aT));
		out.entryAngle = Math.acos(Math.min(1, hT / (rI * vI)));
		out.entrySpeed = vI;
		var H = Const.scaleHeight[out.parent.toLowerCase()];
		out.atmosphere = !!parent.atmosphere && H > 0;
		if (out.atmosphere) out.peakG = OrbitalMath.allenEggersPeakDecel(vI, out.entryAngle, H) / Const.g0;
	}
	return out;
}
