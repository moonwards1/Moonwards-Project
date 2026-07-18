/* MissionPlanner/modules/lunar-skyhook — the lunar-skyhook CARRIER module.
 *
 * Reshaped by task I3 (WP-I): the departure tech stack is a chain of CARRIER
 * stages — moving platforms that each contribute heading and impulse without
 * yet producing a trajectory — and this module is the first rotating carrier
 * in it. A gravity-gradient (radial) lunar skyhook: a tether whose centre of
 * mass rides a circular lunar orbit, rotating at that orbit's rate. What it
 * does now is purely kinematic:
 *
 *   consume the upstream carrier-chain packet (moon-platform emits the
 *   base), APPEND ITS OWN ROTOR ELEMENT (Shared/kinematic-chain.js shape:
 *   ecliptic plane, radius = the release point's lunar-orbit radius, rate =
 *   the CoM orbit's angular velocity, phase pinned at the mission's release
 *   anchor), and emit the extended chain.
 *
 * Everything that used to be here about ESCAPING — the patched-conic release
 * chain (lunar v∞ → vector-sum geocentric velocity → Earth-escape v∞ →
 * idealized heliocentric hand-off), its SOI coast milestones, and the
 * releaseJd param that dated it — is GONE, replaced by the real thing: the
 * headless departure-leg module downstream evaluates the chain at the
 * release anchor and integrates the released ship with restricted N-body
 * gravity (Shared/geo-leg.js). The release EPOCH is no longer a knob on this
 * card at all: it is the plan's read-only release anchor, frozen at mission
 * creation (frozen-plan.js's releaseAnchorFor — WP-I's timing model), which
 * this module reads only to pin its rotor's phase (and to draw the tether at
 * the right angle).
 *
 * The AIMING control stays here, though, as WP-I prescribes: the release
 * phase is this card's own in-card slider (the plotter's third slider,
 * relocated). Phase 0 points the tether at ecliptic longitude 0; the tip
 * velocity leads it by 90°; the Moon's ~1.5° equatorial tilt is still
 * ignored (rotor plane = ecliptic).
 *
 * update() is pure (no DOM, no THREE) so the whole chain is Node-testable;
 * the view layer lives in the optional hooks below it (`init` builds the
 * sidebar card, `draw` renders the tether in the "body:Earth-Moon" frame),
 * which only the browser shell calls.
 *
 * Imports from ../../../Shared/, ../../core/ and ../frozen-plan/ — this
 * folder breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { releaseAnchorFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;
var MOON = systems.get("Moon");
var GM_M = MOON.GM, R_M = MOON.radius;
var DAY = 86400;

// Defaults are the worked-example mission's values (Kim's Moon->Ceres 2031
// design): release from the tether top, phase aimed so the released ship
// leaves near Earth's heliocentric prograde. (releaseJd is gone — the plan's
// frozen release anchor dates the release now; old saves that still carry it
// are ignored here except as releaseAnchorFor's legacy fallback.)
export var defaultParams = {
	comAlt: 275e3,       // m — centre-of-mass altitude (sets the orbit + rotation rate)
	topAlt: 6000e3,      // m — tether top altitude
	relAlt: 6000e3,      // m — release-point altitude along the tether
	releasePhaseDeg: 92  // deg — tether phase at release (the aiming control; see header)
};

// The tether's own kinematics for one set of params — geometry validation,
// rotation rate, release speed and the local lunar-escape margin (the card's
// readouts; the real escape/hand-off physics lives in departure-leg). Pure;
// returns { ok: true, ...figures } or { ok: false, diagnostic }. Exported
// for Node tests and the sidebar card.
export function tetherKinematics(params) {
	var p = params || {};
	var comAlt = p.comAlt, topAlt = p.topAlt, relAlt = p.relAlt;
	var phaseDeg = (p.releasePhaseDeg === undefined || p.releasePhaseDeg === null) ? 0 : p.releasePhaseDeg;

	if (!(isFinite(comAlt) && comAlt > 0 && isFinite(topAlt) && isFinite(relAlt) && isFinite(phaseDeg))) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The skyhook needs finite CoM / top / release altitudes and a release phase.",
			{ values: { comAlt: comAlt, topAlt: topAlt, relAlt: relAlt,
			            releasePhaseDeg: p.releasePhaseDeg } }) };
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

	var rCom = R_M + comAlt, rRel = R_M + relAlt, rTop = R_M + topAlt;
	var omega = O.angularVelocity(GM_M, rCom);       // rad/s — tether rotation rate
	var vRel = omega * rRel;                          // m/s — inertial release speed
	var vEscMoon = O.escapeVelocity(GM_M, rRel);
	var vInfMoon = O.hyperbolicExcess(vRel, GM_M, rRel);   // 0 if bound

	if (vInfMoon <= 0) {
		// Cheap fix: the release radius at which omega*r reaches lunar escape,
		// omega^2 r^2 = 2 GM/r  =>  r = cbrt(2 GM / omega^2).
		var rEsc = Math.cbrt(2 * GM_M / (omega * omega));
		return { ok: false, diagnostic: makeDiagnostic("bound-at-moon",
			"Release speed " + Math.round(vRel) + " m/s is below lunar escape (" +
			Math.round(vEscMoon) + " m/s at that altitude) — the payload stays bound to the Moon.",
			{ values: { vRel: vRel, vEscMoon: vEscMoon, relAlt_km: relAlt / 1e3 },
			  fix: "Raise the release altitude to at least ~" + Math.round((rEsc - R_M) / 1e3) +
			       " km (or lower the CoM to spin the tether faster)." }) };
	}

	return {
		ok: true,
		omega: omega, period: 2 * Math.PI / omega,
		rCom: rCom, rRel: rRel, rTop: rTop,
		vRel: vRel, vEscMoon: vEscMoon, vInfMoon: vInfMoon,
		releasePhaseDeg: phaseDeg
	};
}

// This carrier's rotor element (Shared/kinematic-chain.js shape) for the
// given kinematics and release anchor: ecliptic plane (normal +z, phase 0
// along +x — the plotter's hookDir convention), phase pinned at the anchor
// so evaluating the chain there lands exactly on releasePhaseDeg. Exported
// for Node tests.
export function rotorFor(kin, anchorJd) {
	return {
		normal: [0, 0, 1], ref: [1, 0, 0],
		radius: kin.rRel, rate: kin.omega,
		phase0: kin.releasePhaseDeg * Math.PI / 180,
		epoch: anchorJd
	};
}

// Last computed kinematics per (World, stage), for the sidebar card
// (populated by update(); plain data, so Node sees it too). Keyed by World
// first because N missions coexist (task A1) and their Worlds reuse stage
// ids like "stg-1" — a stageId-only cache would let one mission's recompute
// clobber another's readouts. WeakMap, so a closed mission's entries go with
// its World.
var lastByWorld = new WeakMap();
export function physicsFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberPhysics(world, stageId, phys) {
	if (!world || typeof world !== "object") { return; }   // a bare Node call
	                                                       // (ctx.world null) has no view to feed
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
	id: "lunar-skyhook",
	title: "Lunar skyhook",
	attachesTo: "Moon",
	accepts: ["carrier-chain"],
	emits: ["carrier-chain"],
	rendersIn: ["body:Earth-Moon"],

	update: function (ctx, input) {
		var params = Object.assign({}, defaultParams, ctx.params);
		var phys = tetherKinematics(params);
		rememberPhysics(ctx.world, ctx.stageId, phys);
		if (!phys.ok) { return phys.diagnostic; }

		// This carrier's physics (GM_M, R_M above) IS the Moon's — the same
		// body its own attachesTo declares. The upstream chain's base is data
		// (I5 will let users build chains from other bodies' platforms), so
		// check it explicitly rather than assume: a lunar skyhook silently
		// bolted onto a non-Moon base would apply the wrong GM/radius to the
		// wrong body's numbers with no error at all — exactly the mismatch
		// the calculator/module "body" convention (exchange-types.js header)
		// exists to catch.
		if (input.data.base !== "Moon") {
			return makeDiagnostic("wrong-body",
				"The lunar skyhook only works from the Moon, but this chain's base is " +
				input.data.base + ".",
				{ values: { base: input.data.base },
				  fix: "Remove this carrier, or start the chain from the Moon platform." });
		}

		// The rotor's phase is pinned at the mission's release anchor —
		// moon-platform upstream already diagnosed a missing anchor, but this
		// module may also be exercised bare (tests, future profiles), so it
		// carries the same check rather than assuming.
		var anchorJd = releaseAnchorFor(ctx.world);
		if (anchorJd === null) {
			return makeDiagnostic("no-release-anchor",
				"This mission has no release anchor — no frozen flight plan (or legacy " +
				"release date) fixes when the carrier chain releases.",
				{ fix: "Start missions from the Ephemeris tab (Start Mission Plan bakes the anchor)." });
		}

		var chain = {
			base: input.data.base,
			rotors: (input.data.rotors || []).concat([rotorFor(phys, anchorJd)])
		};
		var packet = PacketTypes.make("carrier-chain", chain,
			{ tool: "mission-planner/lunar-skyhook", label: "carrier chain + skyhook rotor" });
		return { packet: packet };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	// Sidebar card. ctx = { world, stageId, panelHost, onResult, exchange }.
	init: function (ctx) {
		var host = ctx.panelHost;

		function param(name) {
			var stage = ctx.world.getStage(ctx.stageId);
			var merged = Object.assign({}, defaultParams, stage ? stage.params : {});
			return merged[name];
		}
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

		numRow("CoM altitude", "km", param("comAlt") / 1e3, 25,
			function (v) { setParam("comAlt", v * 1e3); });
		numRow("top altitude", "km", param("topAlt") / 1e3, 100,
			function (v) { setParam("topAlt", v * 1e3); });
		numRow("release altitude", "km", param("relAlt") / 1e3, 25,
			function (v) { setParam("relAlt", v * 1e3); });

		// The in-card release-phase slider (WP-I: "aiming lives in the cards" —
		// the plotter's third slider, relocated). Drag = transient sets (live
		// trajectory redraft, undo-coalescible); release commits.
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
			 ["v∞ at Moon SOI", Math.round(phys.vInfMoon) + " m/s"]
			].forEach(function (pair) {
				var r = document.createElement("div"); r.className = "mp-row";
				var k = document.createElement("span"); k.className = "mp-k"; k.textContent = pair[0];
				var v = document.createElement("span"); v.className = "mp-v"; v.textContent = pair[1];
				r.appendChild(k); r.appendChild(v); out.appendChild(r);
			});
		});
	},

	// Tether hardware in the Earth-Moon frame. The shell parents view.group
	// at the Moon's node (attachesTo), so everything here is Moon-relative.
	// snap = { world, stageId, params, result }.
	draw: function (view, snap) {
		disposeChildren(view.group);
		var params = Object.assign({}, defaultParams, snap.params);
		var U = view.metresPerUnit;
		var rCom = (R_M + params.comAlt) / U;
		var rTop = (R_M + params.topAlt) / U;
		var rRel = (R_M + params.relAlt) / U;
		var rBase = (R_M + 20e3) / U;

		view.group.add(circleLine(rTop, 0x9fb6ff, 0.8));
		view.group.add(circleLine(rCom, 0xffd24a, 0.8));

		// Tether orientation: rotating at omega, at the release phase on the
		// plan's release anchor (drawn static at the phase itself if no anchor
		// resolves). Drawn in the ecliptic plane — the Moon's ~1.5 deg
		// equatorial tilt is a visual nicety the scaffold skips.
		var omega = O.angularVelocity(GM_M, R_M + params.comAlt);
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
