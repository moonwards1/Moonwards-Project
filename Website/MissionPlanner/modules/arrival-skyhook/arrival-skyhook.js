/* MissionPlanner/modules/arrival-skyhook — a skyhook CATCH at the destination
 * body: the generic orbital skyhook, run in reverse.
 *
 * The same gravity-gradient tether orbital-skyhook.js models for departures —
 * literally the same geometry/kinematics code, imported (tetherGeometry) —
 * orbiting the mission's DESTINATION body and catching the incoming ship at
 * the tip instead of releasing one. The symmetry is exact: a tip that
 * releases a payload at v_tip can catch one arriving at v_tip; whatever speed
 * gap remains between the approach hyperbola's periapsis speed at the catch
 * radius and the tip's own speed is a TRIM BURN the ship performs at the
 * catch point:
 *
 *   v_catch(ship) = sqrt(v∞² + 2GM/r_catch)   — hyperbolic periapsis speed
 *   v_tip         = ω_CoM · r_catch           — the tether tip, inertial
 *   trim Δv       = v_catch − v_tip           — chemistry closes the gap
 *
 * Unlike a RELEASE, a catch is legitimate with a sub-escape tip — that is the
 * whole attraction: the hook soaks up hyperbolic speed the ship never has to
 * burn off. Hence the import of tetherGeometry rather than the escape-gated
 * tetherKinematics. NOT modelled: the catch WINDOW/phasing geometry (the
 * tether tip being at the right place at the right time, the approach plane,
 * the post-catch unload down the tether). The figures below assume the catch
 * happens; they do not check that it can.
 *
 * Terminal stage: consumes the coast's delivered ship-state, emits nothing.
 * The intercept check (miss distance at the destination) comes from the shared
 * modules/arrival-approach.js — approachAt / interceptWarning, one measurement
 * across every arrival stage. `body` is explicit per the body convention.
 *
 * RENDER FRAME: "body:destination", aliased to the mission's destination frame
 * by mission-view.js's resolveFrameId.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; `init` and `draw`
 * (tether rings + catch point in the destination frame, phase pinned so the
 * tip sits at the catch point at the plan's arrival epoch) are browser-only.
 *
 * Imports from ../../../Shared/, ../../core/ and sibling modules — this
 * folder breaks if moved without them coming along.
 */
/* global THREE */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { tetherGeometry, resolveParams, bodyPhysics } from "../orbital-skyhook/orbital-skyhook.js";
import { approachAt, approachFromPass, interceptWarning } from "../arrival-approach.js";
import { passFor as arrivalPassFor } from "../arrival-leg/arrival-leg.js";
import { arrivalCommitmentFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;
var DAY = 86400;

export var defaultParams = {
	body: null   // destination body name — explicit, never implied
};

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

// The whole catch, pure. `data` is a helio-frame ship-state payload. Returns
// { ok: true, body, geo, approach, vCatch, trimDv, jd, warnings } or
// { ok: false, diagnostic }. Exported for Node tests, the card readouts, and
// the draw hook. The tether geometry params are orbital-skyhook's own
// (comAlt / topAlt / relAlt — relAlt is the CATCH altitude here), resolved
// through its resolveParams so a stage carrying only { body } gets the same
// satellite-orbit-seeded defaults a departure skyhook would.
// `pass` (optional) is the arrival leg's own measured pass — the approach this
// catcher actually has to absorb, at closest approach and with any arrival
// waypoints already in it. Without one the catch falls back to measuring at the
// delivered instant, which sits at the arrival leg's END, roughly a day PAST
// the pass and therefore neither the closest nor the fastest point.
export function computeCatch(params, data, pass) {
	var p = resolveParams(params);
	if (!p.body) {
		return { ok: false, diagnostic: makeDiagnostic("no-body",
			"This skyhook catch has no destination body set.",
			{ fix: "Set the arrival body (the mission's destination)." }) };
	}
	var approach = (pass ? approachFromPass(p.body, pass) : null) || approachAt(p.body, data);
	if (!approach) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The catch body '" + p.body + "' is not a body with a heliocentric orbit.",
			{ values: { body: p.body } }) };
	}
	var geo = tetherGeometry(p);
	if (!geo.ok) { return geo; }

	var vCatch = Math.sqrt(approach.vInf * approach.vInf + 2 * geo.GM / geo.rRel);
	var trimDv = vCatch - geo.vRel;

	var warnings = [];
	var missW = interceptWarning(approach);
	if (missW) { warnings.push(missW); }

	return {
		ok: true, body: p.body, geo: geo, approach: approach,
		vCatch: vCatch, trimDv: trimDv, jd: data.jd,
		warnings: warnings
	};
}

// The arrival leg's own measured pass, reached sideways the way every
// cross-stage trajectory read in this app works (the packet carries one
// instant; a pass needs the flight). null in a bare Node call, or with no
// arrival leg ahead of this catcher — computeCatch then falls back.
function arrivalPassOf(world) {
	if (!world || typeof world.stages !== "function") { return null; }
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId === "arrival-leg") { return arrivalPassFor(world, stages[i].id); }
	}
	return null;
}

// Last computed catch per (World, stage) — the WeakMap pattern every module
// here uses: keyed by World first, since N missions coexist and reuse stage ids.
var lastByWorld = new WeakMap();
export function catchFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberCatch(world, stageId, cat) {
	if (!world || typeof world !== "object") { return; }
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, cat);
}

export default {
	id: "arrival-skyhook",
	title: "Orbital skyhook catch",
	attachesTo: null,             // rendered body-centric (the destination is the frame origin)
	accepts: ["ship-state"],
	emits: [],                    // terminal: the mission ends on the tether
	rendersIn: ["body:destination"],   // aliased to the mission's destination frame
	                                    // by mission-view.js's resolveFrameId

	update: function (ctx, input) {
		var data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");
		var cat = computeCatch(ctx.params, data, arrivalPassOf(ctx.world));
		rememberCatch(ctx.world, ctx.stageId, cat);
		if (!cat.ok) { return cat.diagnostic; }

		return {
			packet: null,
			warnings: cat.warnings,
			events: [{ jd: cat.jd, flight: false,
			           label: "Skyhook catch at " + cat.body + " — trim Δv " +
			                  (cat.trimDv / 1000).toFixed(2) + " km/s" }]
		};
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	init: function (ctx) {
		var host = ctx.panelHost;

		function fullParams() {
			var stage = ctx.world.getStage(ctx.stageId);
			return resolveParams(stage ? stage.params : {});
		}
		function setParam(name, value) {
			var patch = {}; patch[name] = value;
			ctx.world.set({ stage: ctx.stageId, params: patch });
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
		bodyNote.textContent = "Skyhook orbiting " + (fullParams().body || "—") + ", catching at the tip.";
		host.appendChild(bodyNote);

		numRow("CoM altitude", "km", Math.round(fullParams().comAlt / 1e3), 25,
			function (v) { setParam("comAlt", v * 1e3); });
		numRow("top altitude", "km", Math.round(fullParams().topAlt / 1e3), 100,
			function (v) { setParam("topAlt", v * 1e3); });
		numRow("catch altitude", "km", Math.round(fullParams().relAlt / 1e3), 25,
			function (v) { setParam("relAlt", v * 1e3); });
	},

	// Tether hardware in the destination frame — the same draw shape
	// orbital-skyhook uses, with the phase pinned to the CATCH epoch: the tip is
	// drawn at the catch point (+x) at the plan's arrival epoch and turns at ω
	// away from it, so scrubbing the clock shows the hook winding toward its
	// catch. Falls back to the delivered ship epoch (the cached catch's own jd)
	// when the mission carries no frozen arrival commitment.
	draw: function (view, snap) {
		while (view.group.children.length) {
			var c = view.group.children[0];
			view.group.remove(c);
			if (c.geometry) { c.geometry.dispose(); }
			if (c.material) { c.material.dispose(); }
		}
		var params = resolveParams(snap.params);
		var phys = bodyPhysics(params.body);
		if (!phys) { return; }
		var R = phys.R, GM = phys.GM;
		var U = view.metresPerUnit;
		var rCom = (R + params.comAlt) / U;
		var rTop = (R + params.topAlt) / U;
		var rCatch = (R + params.relAlt) / U;
		var rBase = (R + 20e3) / U;

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
		view.group.add(circleLine(rTop, 0x9fb6ff, 0.8));
		view.group.add(circleLine(rCom, 0xffd24a, 0.8));

		var cat = catchFor(snap.world, snap.stageId);
		var commit = arrivalCommitmentFor(snap.world);
		var catchJd = commit ? commit.jd : (cat && cat.ok ? cat.jd : null);
		var omega = O.angularVelocity(GM, R + params.comAlt);
		var phase = catchJd !== null ? omega * (snap.world.jd - catchJd) * DAY : 0;
		var dir = new THREE.Vector3(Math.cos(phase), Math.sin(phase), 0);
		view.group.add(new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(
				[dir.clone().multiplyScalar(rBase), dir.clone().multiplyScalar(rTop)]),
			new THREE.LineBasicMaterial({ color: 0xeaf0ff })));

		// Catch point: constant-pixel dot, magenta when the catch computes,
		// red when this stage is the one that failed.
		var failed = snap.result && snap.result.status === "diagnostic";
		var dotGeo = new THREE.BufferGeometry();
		dotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			dir.x * rCatch, dir.y * rCatch, dir.z * rCatch]), 3));
		view.group.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
			color: failed ? 0xe06a5a : 0xff5fd0, size: 6, sizeAttenuation: false,
			transparent: true, depthTest: false })));
	}
};
