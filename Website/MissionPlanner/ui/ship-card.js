/* Mission Planner — the ship card.
 *
 * A floating card in the scene pane reporting on the ship the chevron marks:
 * a small three.js gizmo comparing the heading the plan NEEDS against the one
 * the mission currently DELIVERS, a numeric summary of the same comparison,
 * and a speed bar.
 *
 * Two layers, one comparison. Every visual in the card says the same thing
 * twice: dim = needed (what the frozen plan requires at hand-off), bright =
 * current (what the configured technology and waypoints actually deliver).
 * On course is when the two coincide.
 *
 * The gizmo is a scissored viewport off the shell's single shared renderer —
 * the same mechanism the floating panes use — so the card costs no extra WebGL
 * context. Its scene holds nothing but lines in a unit-normalized space, so
 * it needs no constant-on-screen-size pass: the camera sits at a fixed radius
 * and the content is scaled into it.
 *
 * The card is phase-agnostic. A caller fills it through setComponents /
 * setSpeed / setExtra and supplies the gizmo's vectors; what those mean is the
 * phase adapter's business, not this file's.
 *
 * The pure halves (vInfComponents, gizmoScale, speedModel, speedAlong,
 * peakSpeed) take and return plain values and are Node-tested in
 * tests/ship-card.test.js.
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { createCam, updateCamera, bindCameraControls } from "../../Shared/sim/camera-controller.js";

var O = OrbitalMath;

// Bright = delivered, dim = required. The bright triad matches
// Shared/sim/burn-widget.js's axis colours, so an axis means the same colour
// here as it does on a waypoint gizmo out in the scene.
export var SHIP_COLORS = {
	bright: { pro: 0x6fd49a, rad: 0xffb45a, nrm: 0x8ab4ff, net: 0xf2f6ff },
	dim: { pro: 0x1f6b56, rad: 0x8a7a2a, nrm: 0x46608f, net: 0x55627c }
};

var AXIS_KEYS = ["pro", "rad", "nrm"];
var AXIS_LABELS = { pro: "Prograde", rad: "Radial", nrm: "Normal" };

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

// =======================================================================
//  Pure model
// =======================================================================

// A heliocentric v∞ vector (m/s) split onto the burn frame at (r, v) — the
// SAME ecliptic-anchored frame every waypoint editor's axes mean
// (OrbitalMath.burnComponents), so "prograde" reads identically wherever it
// appears. Returns km/s components plus the vector's own magnitude, or null
// when any input is missing.
export function vInfComponents(r, v, vec) {
	if (!r || !v || !vec) { return null; }
	var c = O.burnComponents(r, v, vec);
	return {
		pro: c.pro / 1000, rad: c.rad / 1000, nrm: c.nrm / 1000,
		net: O.vMag(vec) / 1000
	};
}

// The km/s that maps to one gizmo unit: the largest magnitude either layer
// shows, so the longest line always fills the box and the two layers stay
// directly comparable. 1 (harmless) when there is nothing to draw.
export function gizmoScale(needed, current) {
	var m = 0;
	[needed, current].forEach(function (s) {
		if (!s) { return; }
		m = Math.max(m, Math.abs(s.pro), Math.abs(s.rad), Math.abs(s.nrm), Math.abs(s.net));
	});
	return m > 0 ? m : 1;
}

// The speed bar's model, km/s. Peak pins the right edge and is recomputed with
// the trajectory, so the bar rescales as the flight is tuned and the fill
// always reads as a fraction of the fastest the ship ever goes this phase.
export function speedModel(current, needed, peak) {
	var p = (isFinite(peak) && peak > 0) ? peak : null;
	return {
		current: isFinite(current) ? current : null,
		needed: isFinite(needed) ? needed : null,
		peak: p,
		currentFrac: (p && isFinite(current)) ? clamp01(current / p) : 0,
		neededFrac: (p && isFinite(needed)) ? clamp01(needed / p) : null
	};
}

// |v| (m/s) at `elapsed` seconds along a sample list, linearly interpolated
// between the bracketing samples; clamped to the ends outside the range.
// samples: [{ v: [x,y,z], t: seconds }], ascending t. null when empty.
export function speedAlong(samples, elapsed) {
	if (!samples || !samples.length) { return null; }
	if (!(elapsed > samples[0].t)) { return O.vMag(samples[0].v); }
	var last = samples[samples.length - 1];
	if (elapsed >= last.t) { return O.vMag(last.v); }
	for (var i = 1; i < samples.length; i++) {
		if (samples[i].t < elapsed) { continue; }
		var a = samples[i - 1], b = samples[i];
		var span = b.t - a.t;
		var f = span > 0 ? (elapsed - a.t) / span : 0;
		return O.vMag(a.v) + (O.vMag(b.v) - O.vMag(a.v)) * f;
	}
	return O.vMag(last.v);
}

// The fastest the ship goes anywhere on the sampled flight (m/s), null when
// there is nothing sampled.
export function peakSpeed(samples) {
	if (!samples || !samples.length) { return null; }
	var m = 0;
	for (var i = 0; i < samples.length; i++) { m = Math.max(m, O.vMag(samples[i].v)); }
	return m;
}

// =======================================================================
//  The widget
// =======================================================================

function el(tag, cls, text) {
	var n = document.createElement(tag);
	if (cls) { n.className = cls; }
	if (text != null) { n.textContent = text; }
	return n;
}

function kms(x) { return (x == null || !isFinite(x)) ? "—" : x.toFixed(2); }

// Line thickness in gizmo units (radius, so the drawn width is twice this).
// Needed is drawn fat and current thin, and the current layer is drawn over it
// (see render), so neither hides the other where the two nearly coincide —
// which is exactly when the card is being read most closely.
var LINE_RADIUS = { dim: 0.032, bright: 0.014 };

// A unit cylinder (radius 1, height 1, centred on the origin, running up +Y)
// that every line scales and orients. Shared across all instances and never
// disposed: the gizmo rebuilds its lines on every recompute, and dropping a
// shared geometry would blank every rebuild after it.
var LINE_GEO = null;
function lineGeo() {
	if (!LINE_GEO) { LINE_GEO = new THREE.CylinderGeometry(1, 1, 1, 8); }
	return LINE_GEO;
}

// One line from the gizmo origin, drawn as a thin cylinder because WebGL
// ignores LineBasicMaterial.linewidth — real thickness has to be geometry.
// `len` and `radius` are in gizmo units; a negative component is drawn as a
// positive length down the opposite direction, so the sign shows as a
// direction rather than vanishing.
function makeLine(dir, len, colorHex, radius) {
	if (!(len > 1e-4)) { return null; }
	var d = new THREE.Vector3(dir[0], dir[1], dir[2]);
	if (d.lengthSq() < 1e-12) { return null; }
	d.normalize();
	var m = new THREE.Mesh(lineGeo(), new THREE.MeshBasicMaterial({ color: colorHex }));
	m.scale.set(radius, len, radius);
	m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
	m.position.copy(d).multiplyScalar(len / 2);
	return m;
}

// opts:
//   host        — element the card mounts into (the scene pane's float layer)
//   getMainCam  — () -> the main pane's cam ({theta, phi}) or null; read every
//                 render while "Align to view" is on
//   background  — gizmo clear colour; matches the card's own CSS background so
//                 the scissored render is seamless with the DOM around it
//
// Returns { el, gizmoEl, setOnCourse, setGizmo, setComponents, setSpeed,
// setExtra, render, dispose }.
export function createShipCard(opts) {
	opts = opts || {};
	var host = opts.host;
	var getMainCam = opts.getMainCam || function () { return null; };
	var bg = opts.background == null ? 0x101a2e : opts.background;

	// ---- DOM -------------------------------------------------------------
	// The card is a transparent shell with two OPAQUE bands, top and bottom, and
	// the gizmo strip left bare between them. It cannot simply be an opaque box
	// with a transparent gizmo child: the shared canvas sits behind the whole
	// card, so an opaque ancestor paints over the very region the gizmo renders
	// into. The floats avoid this by having no background at all; the card needs
	// chrome, so it gives the background to the bands instead and lets the
	// gizmo's own scene clear supply the colour across the gap.
	var root = el("div", "mp-shipcard");
	var top = el("div", "mp-ship-top");
	var head = el("div", "mp-ship-head");
	var title = el("span", "mp-ship-title", "SHIP");
	var badge = el("span", "mp-ship-oncourse", "✓");
	badge.title = "On course";
	head.appendChild(title);
	head.appendChild(badge);
	top.appendChild(head);

	var alignLabel = el("label", "mp-ship-align");
	var alignBox = document.createElement("input");
	alignBox.type = "checkbox";
	alignBox.checked = true;
	alignLabel.appendChild(alignBox);
	alignLabel.appendChild(el("span", null, "Align to view"));
	alignLabel.title = "Match the main pane's viewing angle. Off, the gizmo " +
		"rotates and zooms on its own so the gap between needed and current is easier to read.";
	top.appendChild(alignLabel);
	root.appendChild(top);

	var gizmoEl = el("div", "mp-ship-gizmo");
	root.appendChild(gizmoEl);

	var bodyEl = el("div", "mp-ship-body");
	root.appendChild(bodyEl);

	var tableEl = el("div", "mp-ship-table");
	bodyEl.appendChild(tableEl);
	var speedEl = el("div", "mp-ship-speed");
	bodyEl.appendChild(speedEl);
	var extraEl = el("div", "mp-ship-extra");
	bodyEl.appendChild(extraEl);

	if (host) { host.appendChild(root); }

	// ---- the gizmo scene --------------------------------------------------
	var scene = new THREE.Scene();
	var bgColor = new THREE.Color(bg);
	scene.background = bgColor;
	var camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
	// Radius is fixed and the content is normalized into it, so the gizmo needs
	// no per-frame rescaling; the zoom range only exists for the free-rotate
	// mode's wheel.
	var cam = createCam(3.4, Math.PI * 0.25, Math.PI * 0.42, new THREE.Vector3(0, 0, 0));
	// The two layers live in their own groups so render can draw them as
	// separate depth passes.
	var neededGroup = new THREE.Group();
	var currentGroup = new THREE.Group();
	scene.add(neededGroup);
	scene.add(currentGroup);

	var unbindCamera = bindCameraControls(gizmoEl, function () {
		return { cam: cam, camera: camera, zoomMin: 1.2, zoomMax: 12 };
	});

	// MATERIALS ONLY. Every line shares the module-level cylinder geometry, so
	// disposing geometry here would blank the next rebuild. The materials carry
	// the per-line colour and are per-instance, so they do need dropping — this
	// runs on every recompute.
	function clearGroup() {
		[neededGroup, currentGroup].forEach(function (g) {
			g.children.slice().forEach(function (child) {
				g.remove(child);
				if (child.material) { child.material.dispose(); }
			});
		});
	}

	// spec: { axes: { pro, rad, nrm } unit vectors,
	//         needed, current: { pro, rad, nrm, net } km/s (either may be null),
	//         neededDir, currentDir: unit vectors for the net lines }
	// Passing null clears the gizmo.
	function setGizmo(spec) {
		clearGroup();
		if (!spec || !spec.axes) { return; }
		var scale = gizmoScale(spec.needed, spec.current);
		[["dim", spec.needed, spec.neededDir, neededGroup],
			["bright", spec.current, spec.currentDir, currentGroup]]
			.forEach(function (layer) {
				var colors = SHIP_COLORS[layer[0]];
				var comp = layer[1];
				var netDir = layer[2];
				var g = layer[3];
				var radius = LINE_RADIUS[layer[0]];
				if (!comp) { return; }
				AXIS_KEYS.forEach(function (k) {
					var axis = spec.axes[k];
					if (!axis) { return; }
					var value = comp[k];
					if (!isFinite(value)) { return; }
					var sign = value < 0 ? -1 : 1;
					var a = makeLine([axis[0] * sign, axis[1] * sign, axis[2] * sign],
						Math.abs(value) / scale, colors[k], radius);
					if (a) { g.add(a); }
				});
				if (netDir && isFinite(comp.net)) {
					var n = makeLine(netDir, comp.net / scale, colors.net, radius);
					if (n) { g.add(n); }
				}
			});
	}

	// ---- readouts ---------------------------------------------------------

	// The Needed/Current comparison: one column per axis plus the net, needed
	// on a filled chip (the plan's demand) and current as plain text (what the
	// mission does). Either row may be null.
	function setComponents(needed, current) {
		tableEl.innerHTML = "";
		if (!needed && !current) { return; }
		var head2 = el("div", "mp-ship-row mp-ship-row-head");
		head2.appendChild(el("span", "mp-ship-rowlabel", ""));
		AXIS_KEYS.forEach(function (k) {
			head2.appendChild(el("span", "mp-ship-cell mp-ship-h-" + k, AXIS_LABELS[k]));
		});
		head2.appendChild(el("span", "mp-ship-cell mp-ship-h-net", "Net"));
		tableEl.appendChild(head2);

		[["Needed", needed, "needed"], ["Current", current, "current"]].forEach(function (r) {
			var row = el("div", "mp-ship-row mp-ship-row-" + r[2]);
			row.appendChild(el("span", "mp-ship-rowlabel", r[0]));
			AXIS_KEYS.forEach(function (k) {
				row.appendChild(el("span", "mp-ship-cell mp-ship-c-" + k, r[1] ? kms(r[1][k]) : "—"));
			});
			row.appendChild(el("span", "mp-ship-cell mp-ship-c-net", r[1] ? kms(r[1].net) : "—"));
			tableEl.appendChild(row);
		});
	}

	// The speed section: a headline, then a bar whose right edge IS the peak
	// speed of this phase's flight, with the needed speed ticked on it.
	function setSpeed(model) {
		speedEl.innerHTML = "";
		if (!model) { return; }
		var line = el("div", "mp-ship-speedhead");
		var left = el("span", "mp-ship-speednow");
		left.appendChild(el("b", null, "Speed"));
		left.appendChild(el("i", null, " at current position: "));
		left.appendChild(el("span", "mp-ship-speedval", kms(model.current)));
		line.appendChild(left);
		line.appendChild(el("span", "mp-ship-peak",
			model.peak == null ? "" : "Peak: " + kms(model.peak)));
		speedEl.appendChild(line);

		var bar = el("div", "mp-ship-bar");
		var fill = el("div", "mp-ship-bar-fill");
		fill.style.width = (model.currentFrac * 100).toFixed(2) + "%";
		bar.appendChild(fill);
		if (model.neededFrac != null) {
			var tick = el("div", "mp-ship-bar-need");
			tick.style.left = (model.neededFrac * 100).toFixed(2) + "%";
			tick.title = "Needed at hand-off: " + kms(model.needed) + " km/s";
			bar.appendChild(tick);
		}
		speedEl.appendChild(bar);

		if (model.neededFrac != null) {
			var pct = (model.neededFrac * 100).toFixed(2) + "%";
			var foot = el("div", "mp-ship-bar-foot");
			var mark = el("span", "mp-ship-bar-marker", "▲");
			mark.style.left = pct;
			foot.appendChild(mark);
			var lab = el("span", "mp-ship-bar-needlabel", "Needed");
			lab.style.left = pct;
			// The label is wider than the mark it hangs off, so near either end it
			// would overflow the card (which clips). Swing it to one side there
			// instead of centring it, keeping it attached to the mark either way.
			lab.style.transform = model.neededFrac > 0.85 ? "translateX(-100%)"
				: (model.neededFrac < 0.15 ? "translateX(0)" : "translateX(-50%)");
			foot.appendChild(lab);
			speedEl.appendChild(foot);
		}
	}

	// Free-form rows below the speed section, for a phase that reports figures
	// the table doesn't cover. rows: [[label, value], ...] or null to clear.
	function setExtra(rows) {
		extraEl.innerHTML = "";
		if (!rows || !rows.length) { return; }
		rows.forEach(function (r) {
			var line = el("div", "mp-ship-extrarow");
			line.appendChild(el("span", "mp-ship-extralabel", r[0]));
			line.appendChild(el("span", "mp-ship-extraval", r[1]));
			extraEl.appendChild(line);
		});
	}

	// On course: the check in the corner, and a tint on the gizmo's own
	// background — the design signals it twice so it reads whether the user is
	// looking at the numbers or the lines.
	function setOnCourse(on) {
		root.classList.toggle("on-course", !!on);
		bgColor.setHex(on ? 0x14301f : bg);
	}

	// Scissored render into the gizmo's rect, called by the shell's render loop
	// with the shared renderer.
	function render(renderer, canvasRect) {
		var r = gizmoEl.getBoundingClientRect();
		var w = r.width, h = r.height;
		if (w < 2 || h < 2) { return; }
		if (alignBox.checked) {
			var main = getMainCam();
			if (main) { cam.theta = main.theta; cam.phi = main.phi; }
		}
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		updateCamera(camera, cam);
		var x = r.left - canvasRect.left;
		var y = canvasRect.height - (r.top - canvasRect.top + h);   // GL origin: bottom-left
		renderer.setViewport(x, y, w, h);
		renderer.setScissor(x, y, w, h);

		// TWO PASSES, so the thin current lines are always visible over the fat
		// needed ones without either layer losing its own depth sorting. Pass one
		// draws needed (and, having a Color background, clears colour and depth
		// inside the scissor). Pass two clears depth ONLY, then draws current on
		// a clean slate, so it can never be hidden by a needed line in front.
		// scene.background must be nulled for that pass: a Color background makes
		// three.js force a full clear regardless of autoClear, which would wipe
		// pass one.
		currentGroup.visible = false;
		renderer.render(scene, camera);
		if (currentGroup.children.length) {
			currentGroup.visible = true;
			neededGroup.visible = false;
			var auto = renderer.autoClear;
			scene.background = null;
			renderer.autoClear = false;
			renderer.clearDepth();
			renderer.render(scene, camera);
			renderer.autoClear = auto;
			scene.background = bgColor;
			neededGroup.visible = true;
		} else {
			currentGroup.visible = true;
		}
	}

	function dispose() {
		unbindCamera();
		clearGroup();
		root.remove();
	}

	return {
		el: root,
		gizmoEl: gizmoEl,
		setOnCourse: setOnCourse,
		setGizmo: setGizmo,
		setComponents: setComponents,
		setSpeed: setSpeed,
		setExtra: setExtra,
		render: render,
		dispose: dispose
	};
}
