/* MissionPlanner/modules/lunar-skyhook — the first technology module.
 *
 * A gravity-gradient (radial) lunar skyhook: a tether whose centre of mass
 * rides a circular lunar orbit, rotating at that orbit's rate, releasing a
 * payload from a point along the tether. The release physics is the
 * Moon-Skyhook-Trajectory-Plotter's `releaseState()`/`computeReadouts()`
 * math, reduced to the patched-conic chain the mission profile needs:
 *
 *   1. Tether kinematics: the CoM's circular rate omega = sqrt(GM_M/rCom^3);
 *      the release point at radius rRel moves at vRel = omega * rRel.
 *   2. Moon escape: v-infinity leaving the Moon's SOI is the hyperbolic
 *      excess of vRel at rRel (a diagnostic if bound). Its DIRECTION is the
 *      tether-tangential direction at the release phase — the plotter's
 *      hookDir/prograde convention, phase 0 pointing the tether at ecliptic
 *      longitude 0, release velocity 90 deg ahead of it — with the Moon's
 *      ~1.5 deg equatorial tilt and the hyperbola's asymptote deflection
 *      both ignored. The phase is therefore the AIMING control: it chooses
 *      where the lunar v-infinity points in the ecliptic plane, exactly as
 *      it does (with more fidelity) in the Moon-Skyhook plotter.
 *   3. Earth escape: the geocentric velocity is the vector sum of the
 *      Moon's geocentric velocity and the lunar v-infinity; the Earth-escape
 *      v-infinity is the hyperbolic excess of its magnitude at the Moon's
 *      distance (a diagnostic if bound), along the geocentric velocity
 *      direction (asymptote deflection again ignored).
 *   4. The emitted ship-state is the standard "v-infinity at the planet"
 *      idealization the transfer-leg compute core itself uses: Earth's
 *      heliocentric state at the release date, plus the Earth-escape
 *      v-infinity along that direction.
 *
 * What this still cannot capture from the real plotter: the geocentric leg
 * itself — in particular an Oberth burn at a low-Earth perigee, which is how
 * a plotted mission cheaply amplifies v-infinity. A departure burn here
 * applies at the patched heliocentric state, with no Oberth gain, so burn
 * numbers tuned in the plotters land near, but not on, this model.
 *
 * update() is pure (no DOM, no THREE) so the whole chain is Node-testable;
 * the view layer lives in the optional hooks below it (`init` builds the
 * sidebar card, `draw` renders the tether in the "body:Earth-Moon" frame),
 * which only the browser shell calls.
 *
 * Imports from ../../../Shared/ and ../../core/ — this folder breaks if
 * moved without them coming along.
 */
/* global THREE */

import { systems } from "../../../Shared/orbit.js";
import { OrbitalMath } from "../../../Shared/math-utils.js";
import { LunarEphemeris } from "../../../Shared/lunar-ephemeris.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { makeDiagnostic } from "../../core/diagnostics.js";

var O = OrbitalMath;
var LE = LunarEphemeris;
var MOON = systems.get("Moon");
var EARTH = systems.get("Earth");
var GM_M = MOON.GM, R_M = MOON.radius;
var GM_E = EARTH.GM;
var DAY = 86400;

// Defaults are the worked-example mission's values (Kim's Moon->Ceres 2031
// design): release from the tether top, phase aimed so the lunar v-infinity
// leaves near Earth's heliocentric prograde on the release date.
export var defaultParams = {
	comAlt: 275e3,       // m — centre-of-mass altitude (sets the orbit + rotation rate)
	topAlt: 6000e3,      // m — tether top altitude
	relAlt: 6000e3,      // m — release-point altitude along the tether
	releasePhaseDeg: 92, // deg — tether phase at release (the aiming control; see header)
	releaseJd: 2463220.75   // 2031-12-20 06:00 UT
};

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

// The full release chain for one set of params. Pure; returns
// { ok: true, ...figures } or { ok: false, diagnostic }. Exported for Node
// tests and for the sidebar card's readouts.
export function computeRelease(params) {
	var p = params || {};
	var comAlt = p.comAlt, topAlt = p.topAlt, relAlt = p.relAlt, releaseJd = p.releaseJd;
	var phaseDeg = (p.releasePhaseDeg === undefined || p.releasePhaseDeg === null) ? 0 : p.releasePhaseDeg;

	if (!(isFinite(comAlt) && comAlt > 0 && isFinite(topAlt) && isFinite(relAlt) &&
	      isFinite(releaseJd) && isFinite(phaseDeg))) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The skyhook needs finite CoM / top / release altitudes, a release phase, and a release date.",
			{ values: { comAlt: comAlt, topAlt: topAlt, relAlt: relAlt,
			            releasePhaseDeg: p.releasePhaseDeg, releaseJd: releaseJd } }) };
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

	// Moon's geocentric state at release (LunarEphemeris works in km, km/s).
	var ms = LE.moonState(releaseJd);
	var rMoon = O.vScale(ms.r, 1e3), vMoon = O.vScale(ms.v, 1e3);
	var moonDist = O.vMag(rMoon);

	// The lunar v-infinity leaves along the tether-tangential direction at
	// the release phase (the plotter's hookDir prograde convention, tilt
	// ignored): tether points at (cos phi, sin phi, 0), tip moves 90 deg
	// ahead at (-sin phi, cos phi, 0). The geocentric velocity is the
	// VECTOR sum — this is the aiming that phase controls.
	var phi = phaseDeg * Math.PI / 180;
	var tHat = [-Math.sin(phi), Math.cos(phi), 0];
	var vGeoVec = O.vAdd(vMoon, O.vScale(tHat, vInfMoon));
	var vGeo = O.vMag(vGeoVec);
	var vEscEarth = O.escapeVelocity(GM_E, moonDist);
	var vInfEarth = O.hyperbolicExcess(vGeo, GM_E, moonDist);

	if (vInfEarth <= 0) {
		return { ok: false, diagnostic: makeDiagnostic("bound-at-earth",
			"Geocentric speed at the Moon's distance is " + Math.round(vGeo) +
			" m/s, below Earth escape there (" + Math.round(vEscEarth) +
			" m/s) — the payload stays bound to Earth.",
			{ values: { vGeo: vGeo, vEscEarth: vEscEarth, vInfMoon: vInfMoon,
			            releasePhaseDeg: phaseDeg },
			  fix: "Aim closer to the Moon's own direction of motion (release phase), " +
			       "raise the release altitude, or lower the CoM to spin the tether faster." }) };
	}

	// Heliocentric departure state: Earth's state plus the escape v-infinity
	// along the geocentric velocity direction (asymptote deflection ignored
	// — see the header comment).
	var earth = Frames.bodyHelioState("Earth", releaseJd);
	var vHelio = O.vAdd(earth.v, O.vScale(O.vUnit(vGeoVec), vInfEarth));

	return {
		ok: true,
		omega: omega, period: 2 * Math.PI / omega,
		rCom: rCom, rRel: rRel, rTop: rTop,
		vRel: vRel, vEscMoon: vEscMoon, vInfMoon: vInfMoon,
		vGeo: vGeo, vInfEarth: vInfEarth,
		releasePhaseDeg: phaseDeg, releaseJd: releaseJd,
		r: earth.r.slice(), v: vHelio
	};
}

// Last computed figures per stage, for the sidebar card and the tether
// drawing (populated by update(); plain data, so Node sees it too).
var lastByStage = new Map();
export function physicsFor(stageId) { return lastByStage.get(stageId) || null; }

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
	accepts: [],
	emits: ["ship-state"],
	rendersIn: ["body:Earth-Moon"],

	update: function (ctx) {
		var params = Object.assign({}, defaultParams, ctx.params);
		var phys = computeRelease(params);
		lastByStage.set(ctx.stageId, phys);
		if (!phys.ok) { return phys.diagnostic; }

		var packet = PacketTypes.make("ship-state",
			{ r: phys.r, v: phys.v, jd: phys.releaseJd, frame: "helio", dvUsed: 0 },
			{ tool: "mission-planner/lunar-skyhook", label: "skyhook release", iso: isoOf(phys.releaseJd) });

		return {
			packet: packet,
			events: [{ jd: phys.releaseJd,
			           label: "Skyhook release — v∞ " + (phys.vInfEarth / 1000).toFixed(2) + " km/s" }]
		};
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	// Sidebar card. ctx = { world, stageId, panelHost, onResult, exchange }.
	init: function (ctx) {
		var host = ctx.panelHost;
		var self = this;

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

		function param(name) {
			var stage = ctx.world.getStage(ctx.stageId);
			var merged = Object.assign({}, defaultParams, stage ? stage.params : {});
			return merged[name];
		}
		function setParam(name, value) {
			var patch = {}; patch[name] = value;
			ctx.world.set({ stage: ctx.stageId, params: patch });
		}

		numRow("CoM altitude", "km", param("comAlt") / 1e3, 25,
			function (v) { setParam("comAlt", v * 1e3); });
		numRow("top altitude", "km", param("topAlt") / 1e3, 100,
			function (v) { setParam("topAlt", v * 1e3); });
		numRow("release altitude", "km", param("relAlt") / 1e3, 25,
			function (v) { setParam("relAlt", v * 1e3); });
		numRow("release phase", "deg", param("releasePhaseDeg"), 1,
			function (v) { setParam("releasePhaseDeg", v); });

		// Release date (whole days; finer timing waits for comply mode).
		var row = document.createElement("div"); row.className = "mp-inrow";
		var lab = document.createElement("label"); lab.textContent = "release date"; row.appendChild(lab);
		var dateInp = document.createElement("input"); dateInp.type = "date";
		var d0 = O.dateFromJulian(param("releaseJd"));
		dateInp.value = d0.Y + "-" + String(d0.Mo).padStart(2, "0") + "-" + String(d0.D).padStart(2, "0");
		row.appendChild(dateInp); host.appendChild(row);
		dateInp.addEventListener("change", function () {
			var parts = dateInp.value.split("-");
			if (parts.length === 3) {
				setParam("releaseJd", O.julianDate(+parts[0], +parts[1], +parts[2], 6, 0, 0));
			}
		});

		var out = document.createElement("div"); out.className = "mp-readouts";
		host.appendChild(out);

		ctx.onResult(function () {
			var phys = physicsFor(ctx.stageId);
			if (!phys || !phys.ok) { out.innerHTML = ""; return; }
			out.innerHTML = "";
			[["release speed", Math.round(phys.vRel) + " m/s"],
			 ["rotation period", (phys.period / 3600).toFixed(2) + " h"],
			 ["v∞ at Moon SOI", Math.round(phys.vInfMoon) + " m/s"],
			 ["v∞ at Earth SOI", (phys.vInfEarth / 1000).toFixed(2) + " km/s"]
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
		// release date. Drawn in the ecliptic plane — the Moon's ~1.5 deg
		// equatorial tilt is a visual nicety the scaffold skips.
		var omega = O.angularVelocity(GM_M, R_M + params.comAlt);
		var phase = (params.releasePhaseDeg * Math.PI / 180) +
			omega * (snap.world.jd - params.releaseJd) * DAY;
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
