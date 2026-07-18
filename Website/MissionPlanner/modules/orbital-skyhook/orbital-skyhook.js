/* MissionPlanner/modules/orbital-skyhook — the GENERIC orbital-skyhook
 * carrier (task J2, WP-J: departure from any body on the HELIO_BODIES list).
 *
 * A gravity-gradient (radial) skyhook orbiting the mission's ORIGIN body
 * directly — the Mars-Phobos-Skyhook-Trajectory-Plotter's skyhook, generalized
 * off Mars onto any body via its own GM/radius. It is the generic sibling of
 * lunar-skyhook.js, with two structural differences that follow from WP-J's
 * "no satellite ephemeris, no other per-body modelling":
 *
 *   - It is SELF-CONTAINED: it accepts no upstream carrier chain and emits the
 *     whole chain — { base: <origin body>, rotors: [ its own rotor ] } — itself.
 *     The lunar case needs a separate moon-platform base because a lunar
 *     departure rides the Moon around Earth (the Moon has real geocentric
 *     velocity); a generic skyhook orbits its body directly in that body's own
 *     centred frame, where the body is simply the origin at rest, so there is
 *     no separate platform state to carry. (kinematic-chain.js's baseState
 *     returns [0,0,0] for any such origin body — task J2.)
 *   - It is body-PARAMETRIZED: `body` is a required param (the "body"
 *     convention — Shared/exchange-types.js header; every carrier packet names
 *     its body explicitly, never implied). GM/radius come from
 *     Shared/orbit.js's `systems`; the downstream release leg
 *     (body-departure-leg) re-checks that the chain's base matches its own body
 *     the way lunar-skyhook checks its incoming base.
 *
 * Like lunar-skyhook, what it does is purely kinematic: it validates the
 * tether geometry, then APPENDS ITS ROTOR ELEMENT (Shared/kinematic-chain.js
 * shape: ecliptic plane, radius = the release point's orbit radius, rate = the
 * CoM orbit's angular velocity, phase pinned at the mission's read-only release
 * anchor) and emits the chain. The ESCAPE physics — integrating the released
 * ship under body + Sun gravity to the body-SOI-exit hand-off — lives
 * downstream in the headless body-departure-leg module (Shared/body-leg.js),
 * not here. The AIMING control (release phase) is this card's own slider, as
 * WP-I prescribes for carriers.
 *
 * As the TOP of the generic departure chain it diagnoses a missing release
 * anchor (the role moon-platform plays for the lunar chain).
 *
 * DEFAULT GEOMETRY (defaultGeometryFor): the CoM orbit radius defaults to a
 * candidate satellite's orbit.semiMajor when the origin has one (Mars →
 * Phobos), else a fallback low orbit; the release point defaults above the
 * escape radius so a freshly-added skyhook drafts an escaping trajectory
 * straight away. A dropdown/exchange that adds this card seeds `body` + these
 * defaults (task I5); the mission then persists them explicitly.
 *
 * update() is pure (no DOM, no THREE) so the chain is Node-testable; the view
 * hooks (`init` the card, `draw` the tether ring in the origin-body frame)
 * only the browser shell calls.
 *
 * RENDER FRAME: rendersIn declares the symbolic "body:origin" token; task J3
 * builds the mission's own origin-body frame (scene-frames.js's buildBodyFrame,
 * task J1) and aliases "body:origin" to it (and FRAME_PHASE). Until J3 wires
 * that, a generic mission has no origin frame and this draws nothing (harmless).
 *
 * Imports from ../../../Shared/, ../../core/ and ../frozen-plan/ — this folder
 * breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { releaseAnchorFor } from "../frozen-plan/frozen-plan.js";

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

// The origin body's own physical numbers (GM, radius) — coercing radius the
// way body-leg does (some records store it as a {polar,equator} object).
export function bodyPhysics(body) {
	var sys = systems.get(body);
	if (!sys) { return null; }
	return { GM: sys.GM, R: +sys.radius, sys: sys };
}

// The first orbiting satellite's mean orbit radius (m), or null — the default
// CoM orbit radius when the origin has a moon (Mars → Phobos, 9376 km).
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
// Altitudes are metres above the surface. Exported for the add-carrier flow
// (I5) and Node tests.
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
// defaults, then the stage's explicit params on top. Everything reads through
// this so a stage carrying only { body } still resolves to a live skyhook.
export function resolveParams(params) {
	var body = params && params.body;
	var geo = (body && defaultGeometryFor(body)) || {};
	return Object.assign({}, defaultParams, geo, params || {});
}

// The tether's kinematics for one param set — geometry validation, rotation
// rate, release speed, and the local body-escape margin (the card's readouts;
// the real escape physics lives in body-departure-leg). Pure; returns
// { ok: true, ...figures } or { ok: false, diagnostic }.
export function tetherKinematics(params) {
	var p = resolveParams(params);
	var phys = bodyPhysics(p.body);
	if (!phys) {
		return { ok: false, diagnostic: makeDiagnostic("no-body",
			"This skyhook has no origin body set.",
			{ values: { body: p.body },
			  fix: "Set the departure body (the mission's origin)." }) };
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

	if (vInfBody <= 0) {
		// omega^2 r^2 = 2 GM/r  =>  r = cbrt(2 GM / omega^2) is where the tip
		// reaches escape.
		var rEsc = Math.cbrt(2 * GM / (omega * omega));
		return { ok: false, diagnostic: makeDiagnostic("bound-at-body",
			"Release speed " + Math.round(vRel) + " m/s is below " + p.body + " escape (" +
			Math.round(vEscBody) + " m/s at that altitude) — the payload stays bound to " + p.body + ".",
			{ values: { vRel: vRel, vEscBody: vEscBody, relAlt_km: relAlt / 1e3 },
			  fix: "Raise the release altitude to at least ~" + Math.round((rEsc - R) / 1e3) +
			       " km (or lower the CoM to spin the tether faster)." }) };
	}

	return {
		ok: true, body: p.body,
		omega: omega, period: 2 * Math.PI / omega,
		rCom: rCom, rRel: rRel, rTop: rTop,
		vRel: vRel, vEscBody: vEscBody, vInfBody: vInfBody,
		releasePhaseDeg: phaseDeg
	};
}

// This carrier's rotor element (Shared/kinematic-chain.js shape) for the given
// kinematics and release anchor: ecliptic plane (normal +z, phase 0 along +x),
// phase pinned at the anchor so evaluating the chain there lands exactly on
// releasePhaseDeg. Exported for Node tests.
export function rotorFor(kin, anchorJd) {
	return {
		normal: [0, 0, 1], ref: [1, 0, 0],
		radius: kin.rRel, rate: kin.omega,
		phase0: kin.releasePhaseDeg * Math.PI / 180,
		epoch: anchorJd
	};
}

// Last computed kinematics per (World, stage), for the sidebar card (same
// WeakMap pattern as every module: N missions coexist, Worlds reuse stage ids).
var lastByWorld = new WeakMap();
export function physicsFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberPhysics(world, stageId, phys) {
	if (!world || typeof world !== "object") { return; }
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, phys);
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

export default {
	id: "orbital-skyhook",
	title: "Orbital skyhook",
	attachesTo: null,             // rendered body-centric (the origin body is the frame origin)
	accepts: [],                  // self-contained: it originates the chain (see header)
	emits: ["carrier-chain"],
	rendersIn: ["body:origin"],   // resolved to the mission's origin frame by task J3

	update: function (ctx) {
		var params = Object.assign({}, defaultParams, ctx.params);
		if (!params.body) {
			rememberPhysics(ctx.world, ctx.stageId, null);
			return makeDiagnostic("no-body",
				"This skyhook has no origin body set.",
				{ fix: "Set the departure body (the mission's origin)." });
		}

		var phys = tetherKinematics(params);
		rememberPhysics(ctx.world, ctx.stageId, phys);
		if (!phys.ok) { return phys.diagnostic; }

		// The release epoch is the plan's read-only anchor. As the top of the
		// generic chain, this module diagnoses a missing one (moon-platform's
		// role for the lunar chain).
		var anchorJd = releaseAnchorFor(ctx.world);
		if (anchorJd === null) {
			return makeDiagnostic("no-release-anchor",
				"This mission has no release anchor — no frozen flight plan (or legacy " +
				"release date) fixes when the carrier chain releases.",
				{ fix: "Start missions from the Ephemeris tab (Start Mission Plan bakes the anchor)." });
		}

		var chain = { base: params.body, rotors: [rotorFor(phys, anchorJd)] };
		var packet = PacketTypes.make("carrier-chain", chain,
			{ tool: "mission-planner/orbital-skyhook",
			  label: params.body + " skyhook carrier chain" });
		return { packet: packet };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	// Sidebar card. ctx = { world, stageId, panelHost, onResult, exchange }.
	init: function (ctx) {
		var host = ctx.panelHost;

		function fullParams() {
			var stage = ctx.world.getStage(ctx.stageId);
			return resolveParams(stage ? stage.params : {});
		}
		function param(name) { return fullParams()[name]; }
		function setParam(name, value, setOpts) {
			var patch = {}; patch[name] = value;
			ctx.world.set({ stage: ctx.stageId, params: patch }, setOpts);
		}

		function numRow(label, unit, value, step, commit) {
			var row = document.createElement("div"); row.className = "mp-inrow";
			var lab = document.createElement("label"); lab.textContent = label; row.appendChild(lab);
			var wrap = document.createElement("span");
			var inp = document.createElement("input");
			inp.type = "number"; inp.step = step; inp.value = value;
			wrap.appendChild(inp);
			var u = document.createElement("span"); u.className = "mp-unit"; u.textContent = unit;
			wrap.appendChild(u); row.appendChild(wrap); host.appendChild(row);
			inp.addEventListener("change", function () {
				var v = parseFloat(inp.value);
				if (isFinite(v)) { commit(v); }
			});
			return inp;
		}

		var bodyNote = document.createElement("div"); bodyNote.className = "mp-muted";
		bodyNote.textContent = "Skyhook orbiting " + (param("body") || "—") + ".";
		host.appendChild(bodyNote);

		numRow("CoM altitude", "km", Math.round(param("comAlt") / 1e3), 25,
			function (v) { setParam("comAlt", v * 1e3); });
		numRow("top altitude", "km", Math.round(param("topAlt") / 1e3), 100,
			function (v) { setParam("topAlt", v * 1e3); });
		numRow("release altitude", "km", Math.round(param("relAlt") / 1e3), 25,
			function (v) { setParam("relAlt", v * 1e3); });

		// In-card release-phase slider (WP-I: aiming lives in the cards). Drag =
		// transient sets (live redraft, undo-coalescible); release commits.
		var row = document.createElement("div"); row.className = "mp-inrow";
		var lab = document.createElement("label"); lab.textContent = "release phase"; row.appendChild(lab);
		var wrap = document.createElement("span"); wrap.className = "mp-phase-wrap";
		var slider = document.createElement("input");
		slider.type = "range"; slider.min = 0; slider.max = 360; slider.step = 1;
		slider.value = param("releasePhaseDeg");
		wrap.appendChild(slider);
		var readout = document.createElement("span"); readout.className = "mp-unit";
		readout.textContent = Math.round(param("releasePhaseDeg")) + "°";
		wrap.appendChild(readout);
		row.appendChild(wrap); host.appendChild(row);
		slider.addEventListener("input", function () {
			var v = parseFloat(slider.value);
			if (!isFinite(v)) { return; }
			readout.textContent = Math.round(v) + "°";
			setParam("releasePhaseDeg", v, { transient: true });
		});
		slider.addEventListener("change", function () {
			var v = parseFloat(slider.value);
			if (isFinite(v)) { setParam("releasePhaseDeg", v); }
		});

		var out = document.createElement("div"); out.className = "mp-readouts";
		host.appendChild(out);

		ctx.onResult(function () {
			var phys = physicsFor(ctx.world, ctx.stageId);
			if (!phys || !phys.ok) { out.innerHTML = ""; return; }
			out.innerHTML = "";
			[["release speed", Math.round(phys.vRel) + " m/s"],
			 ["rotation period", (phys.period / 3600).toFixed(2) + " h"],
			 ["v∞ at " + phys.body + " SOI", Math.round(phys.vInfBody) + " m/s"]
			].forEach(function (pair) {
				var r = document.createElement("div"); r.className = "mp-row";
				var k = document.createElement("span"); k.className = "mp-k"; k.textContent = pair[0];
				var v = document.createElement("span"); v.className = "mp-v"; v.textContent = pair[1];
				r.appendChild(k); r.appendChild(v); out.appendChild(r);
			});
		});
	},

	// Tether hardware in the origin-body frame (body-centric — the body is the
	// frame origin). snap = { world, stageId, params, result }.
	draw: function (view, snap) {
		disposeChildren(view.group);
		var params = resolveParams(snap.params);
		var phys = bodyPhysics(params.body);
		if (!phys) { return; }
		var R = phys.R, GM = phys.GM;
		var U = view.metresPerUnit;
		var rCom = (R + params.comAlt) / U;
		var rTop = (R + params.topAlt) / U;
		var rRel = (R + params.relAlt) / U;
		var rBase = (R + 20e3) / U;

		view.group.add(circleLine(rTop, 0x9fb6ff, 0.8));
		view.group.add(circleLine(rCom, 0xffd24a, 0.8));

		// Tether orientation: rotating at omega, at the release phase on the
		// plan's release anchor (drawn static at the phase itself if no anchor
		// resolves). Ecliptic plane — the body's axial tilt is a visual nicety
		// the scaffold skips (as lunar-skyhook skips the Moon's).
		var omega = O.angularVelocity(GM, R + params.comAlt);
		var anchorJd = releaseAnchorFor(snap.world);
		var phase = (params.releasePhaseDeg * Math.PI / 180) +
			(anchorJd !== null ? omega * (snap.world.jd - anchorJd) * DAY : 0);
		var dir = new THREE.Vector3(Math.cos(phase), Math.sin(phase), 0);
		view.group.add(new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(
				[dir.clone().multiplyScalar(rBase), dir.clone().multiplyScalar(rTop)]),
			new THREE.LineBasicMaterial({ color: 0xeaf0ff })));

		// Release point: a constant-pixel dot, magenta when the chain computes,
		// red when this stage is the one that failed.
		var failed = snap.result && snap.result.status === "diagnostic";
		var dotGeo = new THREE.BufferGeometry();
		dotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			dir.x * rRel, dir.y * rRel, dir.z * rRel]), 3));
		view.group.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
			color: failed ? 0xe06a5a : 0xff5fd0, size: 6, sizeAttenuation: false,
			transparent: true, depthTest: false })));
	}
};
