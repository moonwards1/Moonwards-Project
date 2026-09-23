/* MissionPlanner/modules/skyhook — the skyhook platform's substance.
 *
 * A gravity-gradient (radial) tether whose centre of mass rides a circular
 * orbit around its `body`, rotating at that orbit's rate. Ported from the
 * Mars-Phobos-Skyhook-Trajectory-Plotter's skyhook and generalized onto any
 * body via its own GM/radius. ONE skyhook serves every body and both ends of a
 * mission: the Moon uses it like any other body, and a tether that can release
 * a payload at its tip can catch one arriving there.
 *
 * This file is the platform SPEC (see ../platform/platform-spec.js for the
 * contract). The two role adapters beside it are thin:
 *
 *   skyhook-departure.js  the carrier — appends its rotor to the kinematic
 *                         chain and releases.
 *   skyhook-arrival.js    the terminal — catches the delivered approach.
 *
 * Two properties let one platform serve both the Moon (a satellite of Earth)
 * and a planet at rest:
 *
 *   - It is body-PARAMETRIZED: `body` is a required param (the "body"
 *     convention — Shared/exchange-types.js header; every carrier packet names
 *     its body explicitly, never implied). GM/radius come from
 *     Shared/orbit.js's `systems`, and it RENDERS parented at that body's node
 *     — the Moon's moving node in the Earth-Moon frame, or a planet at its own
 *     frame's centre (the shell resolves attachesTo per stage from `body`).
 *   - As a carrier it OPTIONALLY RIDES an upstream base platform (`ridesOn`
 *     "*"). For the Moon it rides moon-platform, so the Moon keeps its fixed
 *     read-only platform card AND its real geocentric base state (the Moon's
 *     ~1 km/s around Earth, which kinematic-chain.js's baseState supplies for
 *     base "Moon"); the released ship then escapes EARTH, via the geocentric
 *     departure-leg (Earth+Moon+Sun). For a planet there is no separate
 *     platform — the body is simply the origin at rest (baseState returns
 *     [0,0,0]) — so the skyhook self-originates the chain and the ship escapes
 *     that body, via body-departure-leg (body+Sun).
 *
 * The ESCAPE physics lives downstream in the headless departure legs, never
 * here. The AIMING control (release phase) is this platform's own slider.
 *
 * THE PLANE: every skyhook orbits in its body's EQUATORIAL plane, turning the
 * way the body spins — the rotor's normal is the body's spin pole
 * (Shared/orbit.js `pole`, the right-hand-rule spin pole, so a retrograde
 * rotator's hook turns retrograde with no special case). Phase 0 is the
 * RETROGRADE direction of the body's heliocentric orbit (the Moon takes
 * Earth's), taken on the pin date and projected into that plane — the
 * direction opposite the body's motion around the Sun. A body with no
 * published pole falls back to the ecliptic plane; with no orbit or no date,
 * phase 0 falls back to the ecliptic +X (equinox) direction.
 *
 * THE CATCH is the same tether run in reverse, with the same three controls:
 * CoM altitude, catch altitude (the release altitude's role) and catch phase
 * (the release phase's). The phase is pinned at the mission's start (the
 * release epoch): it states where the tip is when the mission opens, 0° being
 * the retrograde direction, and the tip turns at ω from there. Two
 * figures describe the rendezvous:
 *
 *   catch speed   v_tip = ω_CoM · r_catch — the tip's inertial speed
 *   Δθ            the angle the ship's drawn arc meets the tether's plane at:
 *                 the plane (the body's equator, extended past the tether)
 *                 is crossed by the arc, and Δθ is the angle between the
 *                 arc's direction there — the ship's velocity relative to the
 *                 body — and the plane. 0 skimming along it, 90 piercing it
 *                 square. It is the arc's FIRST crossing. It states the
 *                 approach alone: the tether's phase and altitude do not move it.
 *
 * plus the TRIM the ship would need to match the tip's speed, taking its own
 * speed at the catch radius off the approach hyperbola:
 *
 *   v_ship(r_catch) = sqrt(v∞² + 2GM/r_catch)
 *   trim Δv         = v_ship − v_tip
 *
 * Unlike a RELEASE, a catch is legitimate with a sub-escape tip — that is the
 * whole attraction: the hook soaks up hyperbolic speed the ship never has to
 * burn off. Hence the escape gate belongs to the release half alone. NOT
 * modelled: the post-catch unload down the tether.
 *
 * DEFAULT GEOMETRY (defaultGeometryFor): the CoM orbit radius defaults to a
 * candidate satellite's orbit.semiMajor when the body has one (Mars → Phobos),
 * else a fallback low orbit; the release point defaults above the escape radius
 * so a freshly-added skyhook drafts an escaping trajectory straight away. The
 * mission view seeds `body` when it adds the stage (mission-view.js's
 * addCarrier); the mission then persists the geometry explicitly.
 *
 * Everything here is pure (no DOM) except `draw`, which the browser shell alone
 * calls. Imports from ../../../Shared/ and ../../core/ — this folder breaks if
 * moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { rotorElement, planeBasis } from "../../../Shared/kinematic-chain.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { resolvePlatformParams } from "../platform/platform-spec.js";

var O = OrbitalMath;
var DAY = 86400;

// Minimal static defaults — the body-specific geometry is computed at runtime
// by defaultGeometryFor(body), since it depends on the origin's GM/radius/
// satellites (a static object can't hold Mars-vs-Ceres values). A stage always
// carries `body` + explicit altitudes once created; these fill any gap.
export var defaultParams = {
	body: null,
	releasePhaseDeg: 0
};

// The body's own physical numbers (GM, radius) — coercing radius the way
// body-leg does (some records store it as a {polar,equator} object).
export function bodyPhysics(body) {
	var sys = systems.get(body);
	if (!sys) { return null; }
	return { GM: sys.GM, R: +sys.radius, sys: sys };
}

// The first orbiting satellite's mean orbit radius (m), or null — the default
// CoM orbit radius when the body has a moon (Mars → Phobos, 9376 km).
export function satelliteOrbitRadius(body) {
	var sys = systems.get(body);
	var sats = (sys && sys.satellites) || [];
	for (var i = 0; i < sats.length; i++) {
		// `satellites` entries may be names (strings) or already-resolved System
		// objects, depending on how the record was built — accept either.
		var sat = typeof sats[i] === "string" ? systems.get(sats[i]) : sats[i];
		if (sat && sat.orbit && isFinite(sat.orbit.semiMajor)) { return sat.orbit.semiMajor; }
	}
	return null;
}

// Sensible default geometry for a body: CoM at a candidate satellite's orbit
// radius (else a low fallback orbit at 3× the body radius), release at 1.5×
// the CoM radius — comfortably above the tether's own escape radius
// (cbrt(2)·rCom ≈ 1.26·rCom), so the default trajectory escapes with margin.
// Altitudes are metres above the surface. Exported for the shell's add-carrier
// flow and Node tests.
export function defaultGeometryFor(body) {
	var phys = bodyPhysics(body);
	if (!phys) { return null; }
	var R = phys.R;
	var rCom = satelliteOrbitRadius(body) || (3 * R);
	var rRel = 1.5 * rCom;
	return {
		comAlt: rCom - R,
		relAlt: rRel - R,
		releasePhaseDeg: 0
	};
}

// Full param set for a stage: static defaults, then this body's geometry
// defaults, then the stage's explicit params on top.
export function resolveParams(params) { return resolvePlatformParams(SKYHOOK, params); }

// The tether's geometry + rotation figures for one param set — validation,
// rotation rate, tip speed, and the local body-escape margin — WITHOUT the
// "must escape" gate. Pure; returns { ok: true, ...figures } (vInfBody is 0
// for a sub-escape tip) or { ok: false, diagnostic }.
export function tetherGeometry(params) {
	var p = resolveParams(params);
	var phys = bodyPhysics(p.body);
	if (!phys) {
		return { ok: false, diagnostic: makeDiagnostic("no-body",
			"This skyhook has no body set.",
			{ values: { body: p.body },
			  fix: "Set the body this skyhook orbits." }) };
	}
	var GM = phys.GM, R = phys.R;
	var comAlt = p.comAlt, relAlt = p.relAlt;
	var phaseDeg = (p.releasePhaseDeg === undefined || p.releasePhaseDeg === null) ? 0 : p.releasePhaseDeg;

	if (!(isFinite(comAlt) && comAlt > 0 && isFinite(relAlt) && relAlt > 0 && isFinite(phaseDeg))) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The skyhook needs finite CoM / release altitudes and a release phase.",
			{ values: { comAlt: comAlt, relAlt: relAlt, releasePhaseDeg: p.releasePhaseDeg } }) };
	}

	// The release point is assumed to lie within the tether's reach — the
	// tether itself is not modelled as a separate structural length.
	var rCom = R + comAlt, rRel = R + relAlt;
	var omega = O.angularVelocity(GM, rCom);           // rad/s — tether rotation rate
	var vRel = omega * rRel;                            // m/s — inertial release speed
	var vEscBody = O.escapeVelocity(GM, rRel);
	var vInfBody = O.hyperbolicExcess(vRel, GM, rRel); // 0 if bound

	return {
		ok: true, body: p.body, GM: GM, R: R,
		omega: omega, period: 2 * Math.PI / omega,
		rCom: rCom, rRel: rRel,
		vRel: vRel, vEscBody: vEscBody, vInfBody: vInfBody,
		releasePhaseDeg: phaseDeg
	};
}

// The RELEASE gate: a departure skyhook whose tip never reaches escape speed
// has no interplanetary release to offer, so a bound tip is a hard diagnostic.
// Returns a diagnostic, or null when the tip escapes.
export function escapeGate(geo) {
	if (geo.vInfBody > 0) { return null; }
	// omega^2 r^2 = 2 GM/r  =>  r = cbrt(2 GM / omega^2) is where the tip
	// reaches escape.
	var rEsc = Math.cbrt(2 * geo.GM / (geo.omega * geo.omega));
	return makeDiagnostic("bound-at-body",
		"Release speed " + Math.round(geo.vRel) + " m/s is below " + geo.body + " escape (" +
		Math.round(geo.vEscBody) + " m/s at that altitude) — the payload stays bound to " + geo.body + ".",
		{ values: { vRel: geo.vRel, vEscBody: geo.vEscBody, relAlt_km: (geo.rRel - geo.R) / 1e3 },
		  fix: "Raise the release altitude to at least ~" + Math.round((rEsc - geo.R) / 1e3) +
		       " km (or lower the CoM to spin the tether faster)." });
}

// tetherGeometry plus the release gate, in one call — the departure side's
// whole physical check. Same signature and returns as tetherGeometry.
export function tetherKinematics(params) {
	var geo = tetherGeometry(params);
	if (!geo.ok) { return geo; }
	var gated = escapeGate(geo);
	return gated ? { ok: false, diagnostic: gated } : geo;
}

// The direction phase 0 points along, before projection into the plane: the
// retrograde of the body's heliocentric velocity at `jd` (the Moon rides
// Earth's orbit). The equinox direction when there is no orbit or no date.
var EQUINOX = [1, 0, 0];
var GM_SUN = systems.get("Sun").GM;
export function retrogradeDirection(body, jd) {
	var sys = systems.get(body === "Moon" ? "Earth" : body);
	if (jd === null || jd === undefined || !sys || !sys.orbit) { return EQUINOX; }
	return O.vScale(O.bodyStateAtJD(GM_SUN, sys.orbit, jd).v, -1);
}

// The skyhook's orbital plane at `body`, as a rotor's { normal, ref } in
// heliocentric-ecliptic axes: the equator, normal along the spin pole, phase 0
// along retrogradeDirection(body, jd) projected into it (kinematic-chain.js's
// planeBasis does the projection). No published pole: the ecliptic. `jd` is
// the date phase 0 is pinned at; the normal does not depend on it.
export function equatorPlane(body, jd) {
	var sys = systems.get(body);
	var pole = sys && sys.pole;
	var ref = retrogradeDirection(body, jd);
	if (!pole) { return { normal: [0, 0, 1], ref: ref }; }
	var n = O.poleVectorEcliptic(pole.ra, pole.dec);
	// A pole along the reference would leave nothing to project; take +Y.
	var along = Math.abs(O.vDot(n, O.vUnit(ref))) > 0.999;
	return { normal: n, ref: along ? [0, 1, 0] : ref };
}

// The skyhook's rotor element for the given kinematics, pinned at `pinJd`
// (the release anchor, or for a catch the mission's start) so evaluating it
// there lands exactly on releasePhaseDeg — the release or catch phase.
export function rotorFor(kin, pinJd) {
	var plane = equatorPlane(kin.body, pinJd);
	return rotorElement(plane.normal, plane.ref, kin.rRel, kin.omega,
		kin.releasePhaseDeg * Math.PI / 180, pinJd);
}

// The catch's rendezvous figures, pure: the tip's speed, the angle the ship's
// arc meets the tether's plane at, and the trim. `approach` carries the flown
// arc (`path`, body-centric); without one, or with an arc that never reaches
// the plane, Δθ is null.
export function catchFigures(geo, approach) {
	var vShip = Math.sqrt(approach.vInf * approach.vInf + 2 * geo.GM / geo.rRel);
	var dTheta = null;
	var path = approach.path;
	if (path) {
		var x = O.pathPlaneCrossing(path.stateAt, path.jd0, path.jd1, equatorPlane(geo.body).normal);
		if (x) { dTheta = x.angleDeg; }
	}
	return { catchSpeed: geo.vRel, dThetaDeg: dTheta, vShip: vShip, trimDv: vShip - geo.vRel };
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

// The unit vector at angle `a` in a planeBasis { e1, e2 }, as a THREE vector.
function inPlane(basis, a) {
	var c = Math.cos(a), s = Math.sin(a);
	return new THREE.Vector3(
		basis.e1[0] * c + basis.e2[0] * s,
		basis.e1[1] * c + basis.e2[1] * s,
		basis.e1[2] * c + basis.e2[2] * s);
}

function circleLine(radiusU, basis, colorHex, opacity) {
	var pts = [], N = 96;
	for (var k = 0; k <= N; k++) {
		pts.push(inPlane(basis, 2 * Math.PI * k / N).multiplyScalar(radiusU));
	}
	return new THREE.Line(
		new THREE.BufferGeometry().setFromPoints(pts),
		new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: opacity }));
}

// ---- the platform spec ----------------------------------------------------

export var SKYHOOK = {
	id: "skyhook",
	label: "Skyhook",
	bodies: "*",
	ridesOn: "*",            // rides a base platform (the Moon's), or self-originates

	defaultParams: defaultParams,
	defaultsFor: defaultGeometryFor,

	params: [
		{ name: "comAlt", label: "CoM altitude", unit: "km", scale: 1e3, step: 25 },
		// Release/catch altitude is stored in metres but shown in km like every
		// other altitude here. The nudge control (platform-roles.js) works
		// directly on the stored SI value regardless of display scale, so the
		// sub-metre drag precision a close destination pass needs is unaffected
		// by the km display — only decimals needs to be wide enough to show it.
		{ name: "relAlt", label: "release altitude", labelFor: { catch: "catch altitude" },
		  unit: "km", scale: 1e3, decimals: 3, step: 0.001, spinStep: 1, kind: "nudge" },
		// The aiming control: where the tip is at the release anchor, or at the
		// mission's start for a catch.
		{ name: "releasePhaseDeg", label: "release phase", labelFor: { catch: "catch phase" },
		  unit: "°", kind: "slider", min: 0, max: 360, step: 0.1, spinStep: 1, decimals: 1 }
	],

	geometry: tetherGeometry,

	release: {
		gate: escapeGate,
		element: rotorFor
	},

	capture: {
		kind: "rendezvous",
		figures: catchFigures,
		// The straddling box: the tip's speed, and the angle the ship's arc
		// meets the tether's plane at. burnDv (the trim, km/s) is not shown — it
		// rides along for the mission report's arrival tech Δv.
		readout: function (cap) {
			return {
				title: "Catch",
				rows: [
					{ label: "catch speed", value: (cap.catchSpeed / 1000).toFixed(2) + " km/s", tone: "spd" },
					{ label: "Δθ", value: cap.dThetaDeg === null ? "—" : cap.dThetaDeg.toFixed(1) + "°", tone: "dv" }
				],
				burnDv: Math.abs(cap.trimDv) / 1000
			};
		},
		eventLabel: function (cap) {
			return "Skyhook catch at " + cap.body + " — trim Δv " +
				(cap.trimDv / 1000).toFixed(2) + " km/s";
		}
	},

	// Tether hardware in the role's own body-centric frame, in the body's
	// equatorial plane: the CoM and release circles, the arm at its phase, and
	// a constant-pixel dot at the release or catch point. The arm sits at the
	// platform's chosen phase on `pinJd` (the release anchor, or for a catch the
	// mission's start) and turns at ω away from it, so scrubbing the clock
	// winds the hook toward — or away from — its moment.
	draw: function (view, snap, ctx) {
		disposeChildren(view.group);
		view.focusPoints = [];   // click-to-focus targets (Vector3, group space) — the release/catch dot, below
		var params = ctx.params;
		var phys = bodyPhysics(params.body);
		if (!phys) { return; }
		var R = phys.R, GM = phys.GM;
		var U = view.metresPerUnit;
		var rCom = (R + params.comAlt) / U;
		var rPoint = (R + params.relAlt) / U;
		var rBase = (R + 20e3) / U;

		var plane = equatorPlane(params.body, ctx.pinJd !== null ? ctx.pinJd : snap.jd);
		var basis = planeBasis(plane.normal, plane.ref);
		view.group.add(circleLine(rPoint, basis, 0x9fb6ff, 0.8));
		view.group.add(circleLine(rCom, basis, 0xffd24a, 0.8));

		// Drawn static at the chosen phase if no epoch resolves.
		var omega = O.angularVelocity(GM, R + params.comAlt);
		var phase = (params.releasePhaseDeg * Math.PI / 180) +
			(ctx.pinJd !== null ? omega * (snap.jd - ctx.pinJd) * DAY : 0);
		var dir = inPlane(basis, phase);
		view.group.add(new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(
				[dir.clone().multiplyScalar(rBase), dir.clone().multiplyScalar(rPoint)]),
			new THREE.LineBasicMaterial({ color: 0xeaf0ff })));

		// Release/catch point: magenta when the chain computes, red when this
		// stage is the one that failed. Focusable like a leg's chevron (see
		// view.focusPoints, above) — mission-view.js reads it generically, so the
		// camera can lock onto it, track it as the clock turns the arm, and be
		// rotated/zoomed around it the same way as any other focus target.
		var point = dir.clone().multiplyScalar(rPoint);
		var dotGeo = new THREE.BufferGeometry();
		dotGeo.setAttribute("position", new THREE.BufferAttribute(
			new Float32Array([point.x, point.y, point.z]), 3));
		view.group.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
			color: ctx.failed ? 0xe06a5a : 0xff5fd0, size: 6, sizeAttenuation: false,
			transparent: true, depthTest: false })));
		view.focusPoints.push(point);
	}
};
