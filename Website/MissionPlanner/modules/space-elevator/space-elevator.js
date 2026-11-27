/* MissionPlanner/modules/space-elevator — the Mars space elevator's substance:
 * one tether from an anchor off Mars's equator, bowing toward the equatorial
 * plane and running out past areostationary orbit to a counterweight.
 *
 * This file is the platform SPEC (see ../platform/platform-spec.js for the
 * contract); the role adapters beside it are thin:
 *
 *   space-elevator-departure.js  the carrier — lets the ship go from a point
 *                                of the tether.
 *   space-elevator-arrival.js    the terminal — catches it on the tether.
 *
 * THE TETHER is Shared/mars-elevator.js's, the one the Mars System Traffic
 * Plotter draws, with the same design controls: the anchor's latitude and
 * longitude, the cable and its safety factor, the counterweight's distance
 * and mass, and the cargo flowing up, which leans it west. Its shape, its
 * lean and its clearance of Phobos are worked out there; a design that
 * passes too near Phobos, or carries more than the tether can, is refused
 * with its reason. The Deimos dodges are a schedule that plotter keeps on its
 * own clock, and are left out here: the tether stands at rest.
 *
 * THE TETHER TURNS WITH MARS. A point of it at distance x from the spin axis
 * and height z off the equatorial plane is carried round at
 *
 *     v = w x r,   |v| = w * x
 *
 *     w   Mars's spin (Shared/mars-ephemeris.js), one turn a sidereal day
 *     r   the point's position from Mars's centre
 *
 * so in the departure chain it is a ROTOR about Mars's pole, of radius x,
 * turning at Mars's rate, its circle stood z off the equator (the rotor's
 * axial offset, Shared/kinematic-chain.js), phase 0 the point's own place at
 * the release epoch.
 *
 * AIMED BY THE HOUR. Fixed to the ground, the release point's direction of
 * motion turns once a sidereal day, so WHEN it lets go decides which way the
 * ship leaves. The card's release time moves the departure leg's release
 * epoch up to half a sidereal day either side of where it stood when the
 * elevator was added (`releaseBaseJd`; release.epoch below), and the whole
 * departure flight moves with it.
 *
 * ESCAPE GATE. A release point below about 25,700 km from Mars's centre moves
 * slower than Mars's escape speed there and leaves the ship in orbit about
 * Mars, which a departure cannot be; it is refused, with the lowest altitude
 * that escapes.
 *
 * THE CATCH is anywhere on the tether, anchor to counterweight. The ship's
 * flown arc is followed in the tether's own frame, turning with Mars, and the
 * contact is where it passes nearest the tether (tetherContact): within
 * CATCH_REACH that is a catch, at the tether point's own speed; further, it
 * says how far it missed, where, and how fast the ship was going past.
 *
 * IT LETS GO ON ITS OWN (`alone`): a rotor stacked on a point of the tether,
 * or the tether on another carrier, would describe no hardware (the same
 * reason as the Lagrange elevators, Notes/decisions.md).
 *
 * Everything here is pure (no DOM) except `draw`, which the browser shell
 * alone calls. Imports from ../../../Shared/ and ../../core/ — this folder
 * breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { MarsEphemeris as EPH } from "../../../Shared/mars-ephemeris.js";
import { rotorElement } from "../../../Shared/kinematic-chain.js";
import { dateYMDHM } from "../../../Shared/date-format.js";
import { ELEVATOR_DEFAULTS, ELEVATOR_MATERIALS, LAT_MAX, CW_MAX, elevatorShape, elevatorAt, elevatorPoint, alongPath }
	from "../../../Shared/mars-elevator.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { resolvePlatformParams } from "../platform/platform-spec.js";

var O = OrbitalMath;
var DAY = 86400;
var MARS = systems.get("Mars");
var GM = MARS.GM, R_MARS = +MARS.radius;
var SPIN = EPH.orientation(2451545).rate;          // rad/s
var HALF_DAY_H = Math.PI / SPIN / 3600;             // half a sidereal day, h

// How far to one side of the tether the ship may pass and still be caught, m.
export var CATCH_REACH = 1e3;
// The flown arc is searched at this step for its pass by the tether, then refined, s.
var SEARCH_STEP = 600;

// The design defaults are the Mars System Traffic Plotter's (Olympus Mons,
// early nanotube, 700 kt at 55,000 km, 150 kg/s); the release point is the
// counterweight, at the release epoch the elevator was added on.
export var defaultParams = Object.assign({ body: null }, ELEVATOR_DEFAULTS, {
	relAlt: ELEVATOR_DEFAULTS.rCW - R_MARS,
	releaseHours: 0,
	releaseBaseJd: null
});

function km(m) { return Math.round(m / 1e3).toLocaleString("en-US") + " km"; }
function ms(v) { return Math.round(v).toLocaleString("en-US") + " m/s"; }
function design(p) {
	return { lat: p.lat, lon: p.lon, material: p.material, safety: p.safety, rCW: p.rCW, cwMass: p.cwMass, cargoFlow: p.cargoFlow };
}

// The lowest distance from Mars's centre at which a point of the tether
// moves at escape speed (w x >= sqrt(2 GM / r)), or null if none does.
function escapeRadius(fig) {
	var lp = fig.path;
	for (var i = 0; i < lp.r.length; i++) {
		if (SPIN * Math.hypot(lp.x[i], lp.y[i]) >= Math.sqrt(2 * GM / lp.r[i])) { return lp.r[i]; }
	}
	return null;
}

// The elevator's figures for one param set, pure: { ok: true, ... } in SI, or
// { ok: false, diagnostic }.
//   fig        Shared/mars-elevator.js's elevatorShape
//   rRel       the release point's distance from Mars's centre (held at the
//              counterweight when set beyond it: `held`)
//   xRel, zRel its distance from the spin axis and height off the equator
//   vRel       its speed, w x;  vEscBody, vInfBody  escape speed there and
//              the excess over it (0 when bound)
//   vCW        the counterweight's speed
export function geometryFor(params) {
	var p = resolvePlatformParams(SPACE_ELEVATOR, params);
	if (p.body !== "Mars") {
		return { ok: false, diagnostic: makeDiagnostic("wrong-body",
			"This space elevator stands on Mars" + (p.body ? ", not " + p.body : "") + ".",
			{ values: { body: p.body }, fix: "Use it on a mission that leaves from or arrives at Mars." }) };
	}
	var fig = elevatorShape(design(p));
	if (!fig.ok) {
		return { ok: false, diagnostic: makeDiagnostic(fig.diagnostic.code, fig.diagnostic.message,
			{ values: design(p) }) };
	}
	if (!isFinite(p.relAlt) || !isFinite(p.releaseHours)) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The space elevator needs a number for the release altitude and the release time.",
			{ values: { relAlt: p.relAlt, releaseHours: p.releaseHours } }) };
	}
	var want = R_MARS + p.relAlt, rRel = Math.max(fig.rA, Math.min(fig.rCW, want));
	var q = alongPath(fig.path, rRel), xCW = alongPath(fig.path, fig.rCW).x;
	var vRel = SPIN * q.x;
	return {
		ok: true, body: "Mars", GM: GM, R: R_MARS, fig: fig, omega: SPIN,
		rRel: rRel, held: want > fig.rCW, xRel: q.x, zRel: q.z,
		vRel: vRel, vEscBody: O.escapeVelocity(GM, rRel), vInfBody: O.hyperbolicExcess(vRel, GM, rRel),
		vCW: SPIN * xCW, rEsc: escapeRadius(fig),
		releaseHours: p.releaseHours, releaseBaseJd: p.releaseBaseJd
	};
}

// The RELEASE gate: a point moving slower than escape leaves the ship in orbit about Mars.
export function escapeGate(geo) {
	if (geo.vInfBody > 0) { return null; }
	return makeDiagnostic("bound-at-body",
		"The release point moves at " + ms(geo.vRel) + ", below Mars's escape speed there (" + ms(geo.vEscBody) +
		") — the ship would stay in orbit about Mars.",
		{ values: { vRel: geo.vRel, vEscBody: geo.vEscBody, relAlt_km: (geo.rRel - geo.R) / 1e3 },
		  fix: geo.rEsc ? "Raise the release altitude to at least ~" + Math.ceil((geo.rEsc - geo.R) / 1e5) * 100 + " km."
			: "Set the counterweight farther out: no point of this tether moves at escape speed." });
}

// The release point at Julian date jd: { r, v } from Mars's centre (ecliptic
// axes) and the elevator's place then (elevatorAt).
export function releasePointAt(geo, jd) {
	var at = elevatorAt(geo.fig, jd);
	var q = alongPath(geo.fig.path, geo.rRel);
	var across = O.vAdd(O.vScale(at.out, Math.cos(q.west)), O.vScale(at.east, -Math.sin(q.west)));
	var r = O.vAdd(O.vScale(across, q.x), O.vScale(at.pole, geo.fig.side * q.z));
	return { r: r, v: O.vCross(at.spin, r), at: at };
}

// The chain element for a release at anchorJd: a rotor about Mars's pole
// through the release point (see the header).
export function elementFor(geo, anchorJd) {
	var pt = releasePointAt(geo, anchorJd), n = pt.at.pole;
	var off = O.vDot(pt.r, n), ref = O.vSub(pt.r, O.vScale(n, off));
	return rotorElement(n, ref, O.vMag(ref), SPIN, 0, anchorJd, off);
}

// ---- the catch ------------------------------------------------------------

// The tether's points in its own frame, which turns with Mars: along the
// anchor's meridian direction (out), east and north. Fixed for a design.
var localMemo = new WeakMap();
function tetherLocal(fig) {
	var hit = localMemo.get(fig);
	if (hit) { return hit; }
	var c = fig.curve, n = c.r.length, pts = new Array(n);
	for (var k = 0; k < n; k++) {
		pts[k] = [c.x[k] * Math.cos(c.west[k]), -c.x[k] * Math.sin(c.west[k]), fig.side * c.z[k]];
	}
	localMemo.set(fig, pts);
	return pts;
}

// The point of the polyline `pts` nearest P: { d, k, f, p } — the segment
// k..k+1, the fraction along it, the point.
function nearestOn(pts, P) {
	var best = { d: Infinity, k: 0, f: 0, p: pts[0] };
	for (var k = 0; k < pts.length - 1; k++) {
		var a = pts[k], b = pts[k + 1];
		var ab0 = b[0] - a[0], ab1 = b[1] - a[1], ab2 = b[2] - a[2];
		var L2 = ab0 * ab0 + ab1 * ab1 + ab2 * ab2;
		var f = L2 > 0 ? ((P[0] - a[0]) * ab0 + (P[1] - a[1]) * ab1 + (P[2] - a[2]) * ab2) / L2 : 0;
		f = f < 0 ? 0 : (f > 1 ? 1 : f);
		var q0 = a[0] + f * ab0 - P[0], q1 = a[1] + f * ab1 - P[1], q2 = a[2] + f * ab2 - P[2];
		var d = q0 * q0 + q1 * q1 + q2 * q2;
		if (d < best.d) { best = { d: d, k: k, f: f }; }
	}
	var a1 = pts[best.k], b1 = pts[best.k + 1];
	best.p = [a1[0] + best.f * (b1[0] - a1[0]), a1[1] + best.f * (b1[1] - a1[1]), a1[2] + best.f * (b1[2] - a1[2])];
	best.d = Math.sqrt(best.d);
	return best;
}

// Where the ship meets the tether, pure. `path` is the flown arc
// ({ jd0, jd1, stateAt(jd) → { r, v } }, Mars-centred). The arc is followed
// in the tether's own frame, every SEARCH_STEP and then refined, for its
// nearest pass by the tether; that pass is the contact when it lies within
// CATCH_REACH.
//
// The frame at the contact point is the app's burn-frame convention, as the
// skyhook's: prograde along the point's motion, normal along Mars's pole,
// radial = normal × prograde, in toward the axis.
//
// Returns { ok, jd, miss (m), altitude (the point's height above Mars's mean
// radius), pointSpeed, axes, vRel, components: { pro, rad, nrm, net }, note }
// (m, m/s); ok false with reason "no-mark" (no arc) or "off-tether" (the
// nearest pass is further than CATCH_REACH), which still carries the figures
// at the nearest pass, so the tether and the ship's motion past it can be
// shown. `note` says in a line what happened.
export function tetherContact(geo, path) {
	if (!path || !(path.jd1 > path.jd0)) {
		return { ok: false, reason: "no-mark", note: "No contact: there is no approach to meet yet." };
	}
	var fig = geo.fig, pts = tetherLocal(fig);
	function local(jd) {
		var st = path.stateAt(jd);
		if (!st) { return null; }
		var at = elevatorAt(fig, jd);
		return { st: st, at: at, P: [O.vDot(st.r, at.out), O.vDot(st.r, at.east), O.vDot(st.r, at.pole)] };
	}
	function missAt(jd) { var l = local(jd); return l ? nearestOn(pts, l.P).d : Infinity; }
	var step = SEARCH_STEP / DAY, best = null;
	for (var jd = path.jd0; jd <= path.jd1 + 1e-9; jd += step) {
		var t = Math.min(jd, path.jd1), d = missAt(t);
		if (!best || d < best.d) { best = { jd: t, d: d }; }
	}
	if (!best || !isFinite(best.d)) {
		return { ok: false, reason: "no-mark", note: "No contact: there is no approach to meet yet." };
	}
	// Golden-section refinement over the step either side.
	var lo = Math.max(path.jd0, best.jd - step), hi = Math.min(path.jd1, best.jd + step), g = (Math.sqrt(5) - 1) / 2;
	var c = hi - g * (hi - lo), e = lo + g * (hi - lo), fc = missAt(c), fe = missAt(e);
	for (var i = 0; i < 60; i++) {
		if (fc < fe) { hi = e; e = c; fe = fc; c = hi - g * (hi - lo); fc = missAt(c); }
		else { lo = c; c = e; fc = fe; e = lo + g * (hi - lo); fe = missAt(e); }
	}
	var jdC = fc < fe ? c : e;
	if (best.d < Math.min(fc, fe)) { jdC = best.jd; }
	var l = local(jdC), near = nearestOn(pts, l.P), at = l.at;
	var rPt = O.vAdd(O.vAdd(O.vScale(at.out, near.p[0]), O.vScale(at.east, near.p[1])), O.vScale(at.pole, near.p[2]));
	var vPt = O.vCross(at.spin, rPt), pointSpeed = O.vMag(vPt);
	var pro = O.vUnit(vPt), nrm = at.pole, axes = { pro: pro, rad: O.vCross(nrm, pro), nrm: nrm };
	var vRel = O.vSub(l.st.v, vPt);
	var comp = { pro: O.vDot(vRel, axes.pro), rad: O.vDot(vRel, axes.rad), nrm: O.vDot(vRel, axes.nrm), net: O.vMag(vRel) };
	var altitude = O.vMag(rPt) - geo.R, ok = near.d <= CATCH_REACH;
	return {
		ok: ok, reason: ok ? null : "off-tether",
		jd: jdC, miss: near.d, altitude: altitude, pointSpeed: pointSpeed, axes: axes, vRel: vRel, components: comp,
		r: rPt,
		note: ok ? "Meets the tether " + km(altitude) + " up, at " + dateYMDHM(jdC) + "."
			: "No contact: the ship passes " + km(near.d) + " from the tether, " + km(altitude) + " up, at " +
			  ms(comp.net) + " relative to it."
	};
}

// The catch's figures, pure: the contact, and the speed the ship must match
// (the tether point's) with the trim, the relative speed there.
export function catchFigures(geo, approach) {
	var contact = tetherContact(geo, approach.path);
	return {
		contact: contact,
		catchSpeed: isFinite(contact.pointSpeed) ? contact.pointSpeed : geo.vCW,
		trimDv: contact.ok ? contact.components.net : null
	};
}

// ---- view helpers (browser only — THREE via the global) -------------------

function disposeChildren(group) {
	while (group.children.length) {
		var c = group.children[0];
		group.remove(c);
		if (c.geometry) { c.geometry.dispose(); }
		if (c.material) { c.material.dispose(); }
	}
}

function vec(a, U) { return new THREE.Vector3(a[0] / U, a[1] / U, a[2] / U); }

function dotAt(point, colorHex, size) {
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([point.x, point.y, point.z]), 3));
	return new THREE.Points(g, new THREE.PointsMaterial({ color: colorHex, size: size,
		sizeAttenuation: false, transparent: true, depthTest: false }));
}

function hoursText(h) { return (h >= 0 ? "+" : "−") + Math.abs(h).toFixed(2) + " h"; }

// ---- the platform spec ----------------------------------------------------

var MATERIAL_OPTIONS = Object.keys(ELEVATOR_MATERIALS).map(function (k) {
	return { value: k, label: ELEVATOR_MATERIALS[k].label };
});

export var SPACE_ELEVATOR = {
	id: "space-elevator",
	label: "Space elevator",
	bodies: ["Mars"],
	ridesOn: "*",
	alone: true,             // nothing else shares its chain — see the header

	defaultParams: defaultParams,

	params: [
		{ name: "lat", label: "anchor latitude", unit: "° N", step: 0.01, decimals: 2, min: -LAT_MAX, max: LAT_MAX },
		{ name: "lon", label: "anchor longitude", unit: "° E", step: 0.1, decimals: 2 },
		{ name: "material", label: "cable", kind: "choice", options: MATERIAL_OPTIONS },
		{ name: "safety", label: "safety factor", unit: "", step: 0.1, decimals: 2 },
		{ name: "rCW", label: "counterweight distance", unit: "km from Mars's centre", scale: 1e3, step: 500,
		  max: CW_MAX / 1e3 },
		{ name: "cwMass", label: "counterweight mass", unit: "kt", scale: 1e6, step: 10, decimals: 0 },
		{ name: "cargoFlow", label: "cargo flow up", unit: "kg/s", step: 1, decimals: 0 },
		{ name: "relAlt", label: "release altitude", unit: "km", scale: 1e3, kind: "slider",
		  min: 20000, max: CW_MAX / 1e3, step: 10, spinStep: 100, roles: ["release"] },
		{ name: "releaseHours", label: "release time", unit: "h", kind: "slider",
		  min: -+HALF_DAY_H.toFixed(2), max: +HALF_DAY_H.toFixed(2), step: 0.01, spinStep: 0.1, decimals: 2, roles: ["release"] }
	],

	note: function (params, role) {
		return "One tether from an anchor off Mars's equator, bowing toward the equatorial plane and passing above " +
			"Phobos, out past areostationary orbit to a counterweight. It turns with Mars, " +
			(role === "release"
				? "so the release time sets which way the ship leaves: it moves the departure up to half a day either way."
				: "and the ship is caught wherever it meets the tether.");
	},

	// `computed` is the geometry on a carrier (with the release epoch), and the
	// capture (computeCapture, its geometry under `geo`) on a catch.
	readouts: function (computed, role) {
		var geo = computed && computed.geo ? computed.geo : computed;
		if (!geo || !geo.ok || !geo.fig) { return []; }
		var f = geo.fig, deg = 180 / Math.PI, rows = [];
		if (role === "release") {
			rows.push(["release point", km(geo.rRel - geo.R) + " up" + (geo.held ? " (held at the counterweight)" : "") +
				", " + km(geo.zRel) + " off the equator"]);
			rows.push(["speed on release", ms(geo.vRel) + " (escape there " + ms(geo.vEscBody) + ")"]);
			rows.push(["v∞ from Mars", geo.vInfBody > 0 ? ms(geo.vInfBody) : "bound"]);
			if (geo.anchorJd !== undefined) {
				rows.push(["released", dateYMDHM(geo.anchorJd) +
					(isFinite(geo.releaseBaseJd) ? " (" + hoursText(geo.releaseHours) + ")" : "")]);
			}
		} else {
			rows.push(["counterweight speed", ms(geo.vCW)]);
		}
		rows.push(["lean at the anchor", (f.lean.angle * deg).toFixed(1) + "° west, leaving " +
			(f.lean.elevation * deg).toFixed(1) + "° above level"]);
		rows.push(["carries at most", Math.floor(f.lean.most).toLocaleString("en-US") + " kg/s"]);
		rows.push(["clear of Phobos by", km(f.phobosClear)]);
		return rows;
	},

	geometry: geometryFor,

	release: {
		gate: escapeGate,
		element: elementFor,
		// Aimed by the hour (header): the release epoch is the base plus the release time.
		epoch: function (p) {
			return (typeof p.releaseBaseJd === "number" && isFinite(p.releaseBaseJd) && isFinite(p.releaseHours))
				? p.releaseBaseJd + p.releaseHours / 24 : null;
		},
		epochSeed: function (p, releaseJd) {
			if (typeof p.releaseBaseJd === "number" && isFinite(p.releaseBaseJd)) { return null; }
			if (!(typeof releaseJd === "number" && isFinite(releaseJd))) { return null; }
			return { releaseBaseJd: releaseJd - (isFinite(p.releaseHours) ? p.releaseHours : 0) / 24 };
		}
	},

	capture: {
		kind: "rendezvous",
		figures: catchFigures,
		readout: function (cap) {
			var c = cap.contact;
			return {
				title: "Catch",
				rows: [
					{ label: "tether speed", value: (cap.catchSpeed / 1000).toFixed(2) + " km/s", tone: "spd" },
					c && c.ok
						? { label: "relative", value: ms(c.components.net), tone: "dv" }
						: { label: "miss", value: c && isFinite(c.miss) ? km(c.miss) : "—", tone: "dv" }
				]
			};
		},
		eventLabel: function (cap) {
			var c = cap.contact;
			return c && c.ok
				? "Space elevator catch at Mars — " + ms(c.components.net) + " relative, " + km(c.altitude) + " up"
				: "Space elevator at Mars — no contact" + (c && isFinite(c.miss) ? ", nearest pass " + km(c.miss) : "");
		}
	},

	// The tether where Mars has turned it at the scene's time, about Mars's
	// centre: the curve from the anchor to the counterweight, a dot at each
	// end, and the release or contact point — magenta, or red when this stage
	// failed — which the camera can lock onto.
	draw: function (view, snap, ctx) {
		disposeChildren(view.group);
		view.focusPoints = [];
		var geo = geometryFor(ctx.params);
		if (!geo.ok) { return; }
		var U = view.metresPerUnit, fig = geo.fig, at = elevatorAt(fig, snap.jd), pts = [];
		for (var k = 0; k < fig.curve.r.length; k++) { pts.push(vec(elevatorPoint(fig, at, k), U)); }
		view.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineBasicMaterial({ color: 0xc8a8ff, transparent: true, opacity: 0.95 })));
		view.group.add(dotAt(pts[0], 0xe0b890, 5));
		view.group.add(dotAt(pts[pts.length - 1], 0xffd24a, 6));
		var mark = null;
		if (ctx.role === "release") {
			mark = releasePointAt(geo, snap.jd).r;
		} else if (ctx.computed && ctx.computed.ok && ctx.computed.contact && ctx.computed.contact.r) {
			// The contact point, carried round with the tether to the scene's time.
			var c = ctx.computed.contact, then = elevatorAt(fig, c.jd);
			var lx = O.vDot(c.r, then.out), ly = O.vDot(c.r, then.east), lz = O.vDot(c.r, then.pole);
			mark = O.vAdd(O.vAdd(O.vScale(at.out, lx), O.vScale(at.east, ly)), O.vScale(at.pole, lz));
		}
		if (mark) {
			var dot = vec(mark, U);
			view.group.add(dotAt(dot, ctx.failed ? 0xe06a5a : 0xff5fd0, 6));
			view.focusPoints.push(dot);
		}
	}
};
