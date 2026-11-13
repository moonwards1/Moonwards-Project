/* MissionPlanner/modules/elevator — the Lagrange elevators' substance: a
 * tether from the Moon's surface through an Earth–Moon Lagrange point to a
 * counterweight beyond it.
 *
 * This file holds the two platform SPECS, L1_ELEVATOR and L2_ELEVATOR (see
 * ../platform/platform-spec.js for the contract), built from one factory; the
 * role adapters beside it are thin:
 *
 *   l1-elevator-departure.js,  the carriers — each appends its release
 *   l2-elevator-departure.js   point's line element to the kinematic chain
 *                              and lets go.
 *
 * The kinematics are Shared/lagrange-elevator.js's: leaving its own swinging
 * aside, the elevator lies along the line through the Moon's centre and
 * Earth's, and turns with that line, so the Moon's ephemeris is its clock. A
 * point of it at distance s from the Moon's centre is at
 *
 *     r(s) = r_M + s * u          v(s) = v_M + s * du/dt
 *
 *     r_M, v_M   the Moon's geocentric position and velocity
 *     u          unit vector from the Moon's centre out along the elevator:
 *                toward Earth for L1, away from it for L2
 *     du/dt      how fast that line turns
 *
 * so in the departure chain it rides the Moon (moon-platform's base) as a
 * kinematic-chain LINE element, and its own share of the release — what the
 * card's straddling box reports as impulse — is s * |du/dt|: the motion the
 * elevator adds to the Moon's own, which is the free part.
 *
 * THE RELEASE POINT is on the single tether, anywhere from the Lagrange point
 * out to the counterweight. The Lagrange point is a fixed fraction of the
 * Earth–Moon distance from the Moon, so it slides along the tether over the
 * month; a release point set nearer the Moon than it is at the release is let
 * go from the Lagrange point itself. The release point's position is fixed at
 * the release epoch (core/release-epoch.js), like every carrier's.
 *
 * NO ESCAPE GATE. Whether a release leaves Earth depends on the date as well
 * as the geometry — the line turns faster near perigee — and an elevator that
 * leaves the ship bound to Earth is still a departure a waypoint burn can
 * finish. The card says which it is at the release; the departure leg flies
 * it either way. From the L2 side, far enough out, the release leaves Earth by
 * itself. From the L1 side it never does: the point moves round Earth slower
 * than the Moon, and the ship falls toward Earth, to a perigee where a burn
 * buys the most.
 *
 * IT LETS GO ON ITS OWN (`alone`): it rides only the Moon, and nothing rides
 * it. A rotor composed onto a point of the elevator would be a skyhook turning
 * about that point at a rate set by the Moon's gravity, which describes no
 * hardware (Notes/decisions.md, "A Lagrange elevator is the only carrier in
 * its chain").
 *
 * Everything here is pure (no DOM) except `draw`, which the browser shell
 * alone calls. Imports from ../../../Shared/ and ../../core/ — this folder
 * breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { lagrangeLineAt, linePointState, lineElementFor, anchorPositions }
	from "../../../Shared/lagrange-elevator.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { resolvePlatformParams } from "../platform/platform-spec.js";

var O = OrbitalMath;
var GM_EARTH = systems.get("Earth").GM, GM_MOON = systems.get("Moon").GM;
var R_MOON = +systems.get("Moon").radius;

// The counterweight's limits, metres above the Moon's mean radius: beyond the
// Lagrange point wherever it is in the month, and no further out than the
// design range the traffic plotter allows.
export var ELEVATOR_LIMITS = { cwMin: 70000e3, cwMax: 300000e3 };

// Each side's design: where the four legs meet the ground (selenographic
// degrees, 20° either side of the sub-Earth or far-side point), the default
// counterweight, and the low end of the release slider, km (a little inside
// where the Lagrange point comes nearest in the month). The release point
// defaults to the counterweight.
var SIDES = {
	L1: {
		id: "l1-elevator", label: "L1 elevator", where: "near side",
		cwAlt: 222200e3, relMinKm: 50000,
		anchors: [{ lat: 20, lon: 20 }, { lat: 20, lon: -20 }, { lat: -20, lon: -20 }, { lat: -20, lon: 20 }]
	},
	L2: {
		id: "l2-elevator", label: "L2 elevator", where: "far side",
		cwAlt: 250000e3, relMinKm: 60000,
		anchors: [{ lat: 20, lon: 160 }, { lat: 20, lon: -160 }, { lat: -20, lon: -160 }, { lat: -20, lon: 160 }]
	}
};

function km(m) { return Math.round(m / 1000).toLocaleString("en-US") + " km"; }
function ms(v) { return Math.round(v).toLocaleString("en-US") + " m/s"; }

// The elevator's fixed figures for one param set. Pure; returns
// { ok: true, ...figures } (SI) or { ok: false, diagnostic }. Where the
// Lagrange point and the release point are depends on the date: releaseRadius.
//   side          "L1" | "L2"
//   GM, R         the Moon's
//   rCw           the counterweight's distance from the Moon's centre, m
//   rRelSet       the release point as set, m from the Moon's centre
//   anchors       the legs' ground points, selenographic degrees
function geometryFor(side, params) {
	var S = SIDES[side], L = ELEVATOR_LIMITS;
	var p = resolvePlatformParams(SPECS[side], params);
	if (p.body !== "Moon") {
		return { ok: false, diagnostic: makeDiagnostic("wrong-body",
			"The " + S.label + " hangs from the Moon" + (p.body ? ", not " + p.body : "") + ".",
			{ values: { body: p.body }, fix: "Use it on a mission that departs from the Moon." }) };
	}
	var vals = { cwAlt: p.cwAlt, relAlt: p.relAlt };
	if (!(isFinite(p.cwAlt) && isFinite(p.relAlt))) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The " + S.label + " needs a number for the counterweight and the release altitude.", { values: vals }) };
	}
	if (!(p.cwAlt >= L.cwMin && p.cwAlt <= L.cwMax)) {
		return { ok: false, diagnostic: makeDiagnostic("counterweight-range",
			"The counterweight must be between " + km(L.cwMin) + " and " + km(L.cwMax) + " above the Moon.",
			{ values: vals, fix: "Set the counterweight altitude within that range." }) };
	}
	if (!(p.relAlt > 0 && p.relAlt <= p.cwAlt)) {
		return { ok: false, diagnostic: makeDiagnostic("release-off-tether",
			"The release point must lie on the tether, no further out than the counterweight.",
			{ values: vals, fix: "Set the release altitude at or below the counterweight's (" + km(p.cwAlt) + ")." }) };
	}
	return {
		ok: true, side: side, label: S.label, body: "Moon", GM: GM_MOON, R: R_MOON,
		rCw: R_MOON + p.cwAlt, rRelSet: R_MOON + p.relAlt, anchors: S.anchors
	};
}

// The release point's distance from the Moon's centre at Julian date jd: as
// set, or the Lagrange point when that is further out then. `at` is
// lagrangeLineAt's result for jd, when the caller has it.
export function releaseRadius(geo, jd, at) {
	at = at || lagrangeLineAt(geo.side, jd);
	return Math.min(geo.rCw, Math.max(geo.rRelSet, at.rLagrange));
}

// The chain element for a release at anchorJd.
function elementFor(geo, anchorJd) {
	return lineElementFor(geo.side, releaseRadius(geo, anchorJd));
}

// What a release at jd amounts to, pure: where the Lagrange point and the
// release point are, how fast the point is carried round Earth, and whether
// that is faster than Earth's escape speed there. Two-body about Earth, with
// the Moon's own pull at that distance:
//
//     E      = v^2 / 2 - GM_E / r_E - GM_M / s     energy per kg
//     v_esc  = sqrt(2 GM_E / r_E)                  Earth's escape speed there
//
//     v      the point's geocentric speed;  r_E its distance from Earth's centre
//     s      its distance from the Moon's centre
//
// E > 0 is a release that leaves Earth by itself. The Sun is left out, so near
// zero the departure leg's integrated flight is the one to believe.
export function releaseFigures(geo, jd) {
	var at = lagrangeLineAt(geo.side, jd);
	var s = releaseRadius(geo, jd, at);
	var pt = linePointState(at, s);
	var rE = O.vMag(pt.r), v = O.vMag(pt.v);
	var energy = v * v / 2 - GM_EARTH / rE - GM_MOON / s;
	return {
		jd: jd, rLagrange: at.rLagrange, rRel: s, held: s > geo.rRelSet,
		rEarth: rE, speed: v, vEscEarth: Math.sqrt(2 * GM_EARTH / rE),
		ownSpeed: O.vMag(pt.relV), escapes: energy > 0
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

function lineOf(points, colorHex, opacity) {
	return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
		new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: opacity }));
}

function dotAt(point, colorHex, size) {
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([point.x, point.y, point.z]), 3));
	return new THREE.Points(g, new THREE.PointsMaterial({ color: colorHex, size: size,
		sizeAttenuation: false, transparent: true, depthTest: false }));
}

// ---- the platform specs -----------------------------------------------------

function makeSpec(side) {
	var S = SIDES[side];
	return {
		id: S.id,
		label: S.label,
		bodies: ["Moon"],
		ridesOn: "*",            // the Moon's base platform
		alone: true,             // nothing else shares its chain — see the header

		defaultParams: { body: null, cwAlt: S.cwAlt, relAlt: S.cwAlt },

		params: [
			{ name: "cwAlt", label: "counterweight altitude", unit: "km", scale: 1e3, step: 1000, roles: ["release"] },
			{ name: "relAlt", label: "release altitude", unit: "km", scale: 1e3, kind: "slider",
			  min: S.relMinKm, max: ELEVATOR_LIMITS.cwMax / 1e3, step: 100, spinStep: 1000, roles: ["release"] }
		],

		note: function () {
			return "A tether from the Moon's " + S.where + " through Earth–Moon " + side +
				" to a counterweight. It lies along the Earth–Moon line and is carried round Earth with it; " +
				"the release point is on the tether between " + side + " and the counterweight.";
		},

		// `computed` is geometry's result with the release epoch (`anchorJd`)
		// added once the chain has one.
		readouts: function (computed) {
			if (!computed || !computed.ok || computed.anchorJd === undefined) { return []; }
			var f = releaseFigures(computed, computed.anchorJd);
			return [
				[side + " at the release, above the Moon", km(f.rLagrange - computed.R)],
				["release point, above the Moon", km(f.rRel - computed.R) + (f.held ? " (held at " + side + ")" : "")],
				["its distance from Earth's centre", km(f.rEarth)],
				["speed round Earth on release", ms(f.speed)],
				["Earth's escape speed there", ms(f.vEscEarth)],
				["on release", f.escapes ? "leaves Earth by itself" : "stays bound to Earth"]
			];
		},

		geometry: function (params) { return geometryFor(side, params); },

		release: { element: elementFor },

		// The elevator where the Moon has carried it at the scene's time, drawn
		// about the Moon's centre (the role's frame parents it at the Moon's
		// node): the four legs from their anchors to the Lagrange point, the
		// single tether out to the counterweight, a dot at each of those two,
		// and the release point — magenta, or red when this stage failed —
		// which the camera can lock onto.
		draw: function (view, snap, ctx) {
			disposeChildren(view.group);
			view.focusPoints = [];
			var geo = geometryFor(side, ctx.params);
			if (!geo.ok) { return; }
			var U = view.metresPerUnit, at = lagrangeLineAt(side, snap.jd);
			function on(s) { return vec(O.vScale(at.u, s), U); }
			var lPoint = on(at.rLagrange), cw = on(geo.rCw);
			anchorPositions(geo.anchors, geo.R, snap.jd).forEach(function (a) {
				view.group.add(lineOf([vec(a, U), lPoint], 0xeaf0ff, 0.85));
			});
			view.group.add(lineOf([lPoint, cw], 0xeaf0ff, 0.95));
			view.group.add(dotAt(lPoint, 0x9fb6ff, 5));
			view.group.add(dotAt(cw, 0xffd24a, 6));
			var rel = on(releaseRadius(geo, snap.jd, at));
			view.group.add(dotAt(rel, ctx.failed ? 0xe06a5a : 0xff5fd0, 6));
			view.focusPoints.push(rel);
		}
	};
}

var SPECS = {};
export var L1_ELEVATOR = SPECS.L1 = makeSpec("L1");
export var L2_ELEVATOR = SPECS.L2 = makeSpec("L2");
