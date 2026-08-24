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
 * THE CATCH is the same tether run in reverse. The symmetry is exact: a tip
 * that releases a payload at v_tip can catch one arriving at v_tip, and
 * whatever speed gap remains between the approach hyperbola's periapsis speed
 * at the catch radius and the tip's own speed is a TRIM BURN the ship performs
 * at the catch point:
 *
 *   v_catch(ship) = sqrt(v∞² + 2GM/r_catch)   — hyperbolic periapsis speed
 *   v_tip         = ω_CoM · r_catch           — the tether tip, inertial
 *   trim Δv       = v_catch − v_tip           — chemistry closes the gap
 *
 * Unlike a RELEASE, a catch is legitimate with a sub-escape tip — that is the
 * whole attraction: the hook soaks up hyperbolic speed the ship never has to
 * burn off. Hence the escape gate belongs to the release half alone. NOT
 * modelled: the catch WINDOW/phasing geometry (the tip being at the right
 * place at the right time, the approach plane, the post-catch unload down the
 * tether). The figures assume the catch happens; they do not check that it can.
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
import { rotorElement } from "../../../Shared/kinematic-chain.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { resolvePlatformParams, RELEASE } from "../platform/platform-spec.js";

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
// radius (else a low fallback orbit at 3× the body radius), release/top at 1.5×
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
		topAlt: rRel - R,
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
	var comAlt = p.comAlt, topAlt = p.topAlt, relAlt = p.relAlt;
	var phaseDeg = (p.releasePhaseDeg === undefined || p.releasePhaseDeg === null) ? 0 : p.releasePhaseDeg;

	if (!(isFinite(comAlt) && comAlt > 0 && isFinite(topAlt) && isFinite(relAlt) && isFinite(phaseDeg))) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The skyhook needs finite CoM / top / release altitudes and a release phase.",
			{ values: { comAlt: comAlt, topAlt: topAlt, relAlt: relAlt, releasePhaseDeg: p.releasePhaseDeg } }) };
	}
	if (topAlt <= comAlt) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The tether top must be above the centre of mass.",
			{ values: { comAlt_km: comAlt / 1e3, topAlt_km: topAlt / 1e3 } }) };
	}
	if (relAlt <= 0 || relAlt > topAlt) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The release point must lie on the tether (between the surface and the top).",
			{ values: { relAlt_km: relAlt / 1e3, topAlt_km: topAlt / 1e3 } }) };
	}

	var rCom = R + comAlt, rRel = R + relAlt, rTop = R + topAlt;
	var omega = O.angularVelocity(GM, rCom);           // rad/s — tether rotation rate
	var vRel = omega * rRel;                            // m/s — inertial release speed
	var vEscBody = O.escapeVelocity(GM, rRel);
	var vInfBody = O.hyperbolicExcess(vRel, GM, rRel); // 0 if bound

	return {
		ok: true, body: p.body, GM: GM, R: R,
		omega: omega, period: 2 * Math.PI / omega,
		rCom: rCom, rRel: rRel, rTop: rTop,
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

// This carrier's rotor element for the given kinematics and release anchor:
// ecliptic plane (normal +z, phase 0 along +x), phase pinned at the anchor so
// evaluating the chain there lands exactly on releasePhaseDeg.
export function rotorFor(kin, anchorJd) {
	return rotorElement([0, 0, 1], [1, 0, 0], kin.rRel, kin.omega,
		kin.releasePhaseDeg * Math.PI / 180, anchorJd);
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

function circleLine(radiusU, colorHex, opacity) {
	var pts = [], N = 96;
	for (var k = 0; k <= N; k++) {
		var a = 2 * Math.PI * k / N;
		pts.push(new THREE.Vector3(radiusU * Math.cos(a), radiusU * Math.sin(a), 0));
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
		{ name: "relAlt", label: "release altitude", labelFor: { catch: "catch altitude" },
		  unit: "km", scale: 1e3, step: 25 },
		// The carrier's aiming control. The catch's own phasing is set at the
		// capture point instead, so this control is the release role's alone.
		{ name: "releasePhaseDeg", label: "release phase", unit: "°", kind: "slider",
		  min: 0, max: 360, step: 0.1, decimals: 1, roles: [RELEASE] }
	],

	geometry: tetherGeometry,

	release: {
		gate: escapeGate,
		element: rotorFor
	},

	capture: {
		kind: "rendezvous",
		figures: function (geo, approach) {
			var vCatch = Math.sqrt(approach.vInf * approach.vInf + 2 * geo.GM / geo.rRel);
			return { vCatch: vCatch, trimDv: vCatch - geo.vRel };
		},
		eventLabel: function (cap) {
			return "Skyhook catch at " + cap.body + " — trim Δv " +
				(cap.trimDv / 1000).toFixed(2) + " km/s";
		}
	},

	// Tether hardware in the role's own body-centric frame: the CoM and top
	// circles, the arm at its phase, and a constant-pixel dot at the release or
	// catch point. The arm sits at the platform's chosen phase on `pinJd` (the
	// release anchor, or the committed arrival) and turns at ω away from it, so
	// scrubbing the clock winds the hook toward — or away from — its moment.
	draw: function (view, snap, ctx) {
		disposeChildren(view.group);
		var params = ctx.params;
		var phys = bodyPhysics(params.body);
		if (!phys) { return; }
		var R = phys.R, GM = phys.GM;
		var U = view.metresPerUnit;
		var rCom = (R + params.comAlt) / U;
		var rTop = (R + params.topAlt) / U;
		var rPoint = (R + params.relAlt) / U;
		var rBase = (R + 20e3) / U;

		view.group.add(circleLine(rTop, 0x9fb6ff, 0.8));
		view.group.add(circleLine(rCom, 0xffd24a, 0.8));

		// Ecliptic plane — the body's axial tilt is a visual nicety the shell
		// skips. Drawn static at the chosen phase if no epoch resolves.
		var omega = O.angularVelocity(GM, R + params.comAlt);
		var phase = (params.releasePhaseDeg * Math.PI / 180) +
			(ctx.pinJd !== null ? omega * (snap.world.jd - ctx.pinJd) * DAY : 0);
		var dir = new THREE.Vector3(Math.cos(phase), Math.sin(phase), 0);
		view.group.add(new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(
				[dir.clone().multiplyScalar(rBase), dir.clone().multiplyScalar(rTop)]),
			new THREE.LineBasicMaterial({ color: 0xeaf0ff })));

		// Release/catch point: magenta when the chain computes, red when this
		// stage is the one that failed.
		var dotGeo = new THREE.BufferGeometry();
		dotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			dir.x * rPoint, dir.y * rPoint, dir.z * rPoint]), 3));
		view.group.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
			color: ctx.failed ? 0xe06a5a : 0xff5fd0, size: 6, sizeAttenuation: false,
			transparent: true, depthTest: false })));
	}
};
