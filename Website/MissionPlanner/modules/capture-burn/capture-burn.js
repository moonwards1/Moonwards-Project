/* MissionPlanner/modules/capture-burn — the minimal chemical arrival module
 * (task H2, option (a)): an intercept check + capture burn at the destination.
 *
 * The Arrival phase's first real technology, deliberately small: it consumes
 * the coast's delivered ship-state (transfer-leg's leg end), measures the
 * approach against the destination body — miss distance and v∞ — and prices
 * the one thing chemistry always offers: an impulsive capture burn at
 * periapsis of the approach hyperbola, into a parking orbit the user sizes
 * (periapsis/apoapsis altitudes; equal = circular). No packet flows out —
 * this is the chain's terminal stage; the mission ends captured (or
 * diagnosed).
 *
 *   v_peri(hyperbolic) = sqrt(v∞² + 2GM/rp)          — energy at periapsis
 *   v_peri(target)     = vis-viva at rp on the a = (rp+ra)/2 ellipse
 *   capture Δv         = the difference
 *
 * THE INTERCEPT CHECK mirrors transfer-leg's own miss warning (same
 * MISS_WARN_AU threshold, imported so the two can never disagree): a leg that
 * ends far from the destination still gets its capture figures — computed for
 * the v∞ the delivered state implies — but carries a warning that they assume
 * an encounter that isn't happening yet. Non-blocking, per the comply-mode
 * refinement: a mission that misses is a diagnosed mission, not a blank
 * screen.
 *
 * The `body` param is EXPLICIT, never implied (the "body" convention —
 * Shared/exchange-types.js's header): the freeze contract and the shipped
 * preset seed it from the plan's arrival body, and the arrival-technology
 * dropdown re-seeds it on swap.
 *
 * RENDER FRAME: rendersIn declares the symbolic "body:destination" token;
 * mission-view.js (task H2's shell half) builds the mission's own destination
 * frame (scene-frames.js's buildBodyFrame, task J1) and aliases the token to
 * it — the same treatment WP-J's "body:origin" gets from task J3.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; `init` (sidebar
 * card) and `draw` (the capture orbit in the destination frame) are the
 * browser-only view hooks.
 *
 * Imports from ../../../Shared/, ../../core/ and sibling modules — this
 * folder breaks if moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { Frames } from "../../../Shared/frames.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { MISS_WARN_AU } from "../transfer-leg/transfer-leg.js";
import { bodyPhysics } from "../orbital-skyhook/orbital-skyhook.js";

var O = OrbitalMath;
var AU = 149597870700;   // m

export var defaultParams = {
	body: null,          // destination body name — explicit, never implied
	periapsisAlt: null,  // m above the surface; null → half the body radius
	apoapsisAlt: null    // m above the surface; null → periapsisAlt (circular)
};

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

// Full param set for a stage: the periapsis default scales with the body
// (half its radius — sensible from Ceres to Jupiter), apoapsis defaults to
// circular. Everything reads through this, like orbital-skyhook's own
// resolveParams. Exported for the tech-swap seeding and Node tests.
export function resolveCaptureParams(params) {
	var p = Object.assign({}, defaultParams, params || {});
	var phys = p.body ? bodyPhysics(p.body) : null;
	// Number.isFinite, not the global: the null placeholder must NOT count as
	// finite (global isFinite coerces null to 0 and says yes).
	if (phys && !Number.isFinite(p.periapsisAlt)) { p.periapsisAlt = 0.5 * phys.R; }
	if (!Number.isFinite(p.apoapsisAlt)) { p.apoapsisAlt = p.periapsisAlt; }
	return p;
}

// The delivered approach at `body`: miss distance (AU) and v∞ (m/s, with
// vector) measured against the body's own heliocentric state at the ship's
// epoch. `data` is a helio-frame ship-state payload. Shared by both arrival
// technologies (arrival-skyhook imports it), so the intercept check is one
// measurement, not two. Returns null for an unknown body.
export function approachAt(body, data) {
	var sys = systems.get(body);
	if (!sys || !sys.orbit) { return null; }
	var bs = Frames.bodyHelioState(body, data.jd);
	var vInfVec = O.vSub(data.v, bs.v);
	return {
		body: body,
		missAU: O.vMag(O.vSub(data.r, bs.r)) / AU,
		vInf: O.vMag(vInfVec),
		vInfVec: vInfVec,
		jd: data.jd
	};
}

// The intercept-check warning both arrival technologies raise — same
// threshold as transfer-leg's own miss warning, phrased for the arrival end.
export function interceptWarning(approach) {
	if (!(approach.missAU > MISS_WARN_AU)) { return null; }
	return makeDiagnostic("intercept-miss",
		"The delivered coast ends " + approach.missAU.toFixed(3) + " AU from " + approach.body +
		" (within " + MISS_WARN_AU + " AU counts as an encounter) — the capture figures assume " +
		"an approach that isn't being delivered yet.",
		{ values: { missAU: approach.missAU, body: approach.body },
		  fix: "Adjust the coast's waypoint impulses (or the departure) until the leg actually reaches " +
		       approach.body + "." });
}

// The whole capture, pure. `data` is a helio-frame ship-state payload.
// Returns { ok: true, body, approach, rp, ra, vPeriHyp, vPeriOrbit, dv,
// period, jd, warnings } or { ok: false, diagnostic }. Exported for Node
// tests, the card readouts, and the draw hook.
export function computeCapture(params, data) {
	var p = resolveCaptureParams(params);
	if (!p.body) {
		return { ok: false, diagnostic: makeDiagnostic("no-body",
			"This capture burn has no destination body set.",
			{ fix: "Set the arrival body (the mission's destination)." }) };
	}
	var phys = bodyPhysics(p.body);
	if (!phys || !phys.sys.orbit) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The capture body '" + p.body + "' is not a body with a heliocentric orbit.",
			{ values: { body: p.body } }) };
	}
	if (!(isFinite(p.periapsisAlt) && p.periapsisAlt > 0 && isFinite(p.apoapsisAlt))) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The capture orbit needs a positive periapsis altitude (and a finite apoapsis).",
			{ values: { periapsisAlt: p.periapsisAlt, apoapsisAlt: p.apoapsisAlt } }) };
	}
	if (p.apoapsisAlt < p.periapsisAlt) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The capture orbit's apoapsis must not be below its periapsis.",
			{ values: { periapsisAlt_km: p.periapsisAlt / 1e3, apoapsisAlt_km: p.apoapsisAlt / 1e3 },
			  fix: "Raise the apoapsis altitude (equal altitudes make the orbit circular)." }) };
	}

	var approach = approachAt(p.body, data);
	var GM = phys.GM, R = phys.R;
	var rp = R + p.periapsisAlt, ra = R + p.apoapsisAlt;
	var a = (rp + ra) / 2;
	var vPeriHyp = Math.sqrt(approach.vInf * approach.vInf + 2 * GM / rp);
	var vPeriOrbit = O.visVivaVelocity(GM, rp, a);
	var dv = vPeriHyp - vPeriOrbit;

	var warnings = [];
	var missW = interceptWarning(approach);
	if (missW) { warnings.push(missW); }

	return {
		ok: true, body: p.body, approach: approach,
		rp: rp, ra: ra, a: a,
		vPeriHyp: vPeriHyp, vPeriOrbit: vPeriOrbit, dv: dv,
		period: 2 * Math.PI * Math.sqrt(a * a * a / GM),
		jd: data.jd,
		warnings: warnings
	};
}

// Last computed capture per (World, stage), for the card readouts and the
// draw hook (same WeakMap pattern as every module: N missions coexist,
// Worlds reuse stage ids).
var lastByWorld = new WeakMap();
export function captureFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberCapture(world, stageId, cap) {
	if (!world || typeof world !== "object") { return; }
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, cap);
}

export default {
	id: "capture-burn",
	title: "Chemical capture burn",
	attachesTo: null,             // rendered body-centric (the destination is the frame origin)
	accepts: ["ship-state"],
	emits: [],                    // the chain's terminal stage: the mission ends captured
	rendersIn: ["body:destination"],   // aliased to the mission's destination frame (task H2)

	update: function (ctx, input) {
		var data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");
		var cap = computeCapture(ctx.params, data);
		rememberCapture(ctx.world, ctx.stageId, cap);
		if (!cap.ok) { return cap.diagnostic; }

		return {
			packet: null,
			warnings: cap.warnings,
			events: [{ jd: cap.jd, flight: false,
			           label: "Capture burn at " + cap.body + " — Δv " + (cap.dv / 1000).toFixed(2) + " km/s" }]
		};
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	init: function (ctx) {
		var host = ctx.panelHost;

		function fullParams() {
			var stage = ctx.world.getStage(ctx.stageId);
			return resolveCaptureParams(stage ? stage.params : {});
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
		bodyNote.textContent = "Capture at " + (fullParams().body || "—") + ".";
		host.appendChild(bodyNote);

		numRow("periapsis altitude", "km", Math.round(fullParams().periapsisAlt / 1e3), 25,
			function (v) { setParam("periapsisAlt", v * 1e3); });
		numRow("apoapsis altitude", "km", Math.round(fullParams().apoapsisAlt / 1e3), 25,
			function (v) { setParam("apoapsisAlt", v * 1e3); });

		var out = document.createElement("div"); out.className = "mp-readouts";
		host.appendChild(out);

		ctx.onResult(function () {
			var cap = captureFor(ctx.world, ctx.stageId);
			out.innerHTML = "";
			if (!cap || !cap.ok) { return; }
			[["approach v∞", (cap.approach.vInf / 1000).toFixed(2) + " km/s"],
			 ["periapsis speed", (cap.vPeriHyp / 1000).toFixed(2) + " km/s"],
			 ["capture Δv", (cap.dv / 1000).toFixed(2) + " km/s"],
			 ["orbit period", (cap.period / 3600).toFixed(2) + " h"],
			 ["capture date", isoOf(cap.jd)]
			].forEach(function (pair) {
				var r = document.createElement("div"); r.className = "mp-row";
				var k = document.createElement("span"); k.className = "mp-k"; k.textContent = pair[0];
				var v = document.createElement("span"); v.className = "mp-v"; v.textContent = pair[1];
				r.appendChild(k); r.appendChild(v); out.appendChild(r);
			});
		});
	},

	// The capture orbit in the destination frame (body-centric — the body is
	// the frame origin). Drawn in the ecliptic plane with periapsis along +x:
	// the approach's true plane/orientation isn't modelled body-centrically
	// yet (that's the real catch-planning work H2 defers), so this shows the
	// SIZE and shape of the parking orbit, not its final orientation.
	// snap = { world, stageId, params, result }.
	draw: function (view, snap) {
		while (view.group.children.length) {
			var c = view.group.children[0];
			view.group.remove(c);
			if (c.geometry) { c.geometry.dispose(); }
			if (c.material) { c.material.dispose(); }
		}
		var cap = captureFor(snap.world, snap.stageId);
		if (!cap || !cap.ok || snap.result.status !== "ok") { return; }
		var U = view.metresPerUnit;

		// The parking ellipse, focus at the body: r(θ) = a(1−e²)/(1+e·cosθ).
		var e = (cap.ra - cap.rp) / (cap.ra + cap.rp);
		var pSemiLatus = cap.a * (1 - e * e);
		var pts = [], N = 128;
		for (var k = 0; k <= N; k++) {
			var th = 2 * Math.PI * k / N;
			var r = pSemiLatus / (1 + e * Math.cos(th));
			pts.push(new THREE.Vector3(r * Math.cos(th) / U, r * Math.sin(th) / U, 0));
		}
		view.group.add(new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.8 })));

		// The capture burn point (periapsis), constant-pixel.
		var dotGeo = new THREE.BufferGeometry();
		dotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			cap.rp / U, 0, 0]), 3));
		view.group.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
			color: 0xff5fd0, size: 6, sizeAttenuation: false,
			transparent: true, depthTest: false })));
	}
};
