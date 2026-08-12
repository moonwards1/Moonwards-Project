/* Mission Planner — the ship card.
 *
 * A floating card in the scene pane reporting on the ship the chevron marks:
 * a small three.js gizmo, a numeric summary, and a speed bar — plus, for
 * phases that ask for them, an approach readout, a timing bar, a B-plane
 * square and a commit button.
 *
 * Departure's gizmo is a comparison: dim = the v∞ the frozen plan requires at
 * hand-off, bright = what the technology delivers, each split onto the burn
 * frame's three axes plus a net line, and "on course" is when the two coincide.
 * Coast's gizmo shows a single vector instead — the speed change pending
 * waypoint edits make at leg end, split onto the committed leg end's own burn
 * frame the same way, with the net line drawn in the bright/white net colour.
 * Coast has no on-course state at all: many passes arrive successfully, so the
 * card reports the approach and offers Update rather than grading it.
 *
 * OPTIONAL PARTS. Every section is filled by a setter and renders nothing until
 * one is called, so a phase takes only the parts it needs and the card stays
 * phase-agnostic: setComponents/setOnCourse are Departure's, setApproach/
 * setTiming/setBPlane/setUpdate are Coast's, and the gizmo and speed bar serve
 * both.
 *
 * The gizmo is a scissored viewport off the shell's single shared renderer —
 * the same mechanism the floating panes use — so the card costs no extra WebGL
 * context. Its scene holds nothing but lines in a unit-normalized space, and
 * the camera sits at a fixed radius with the content scaled into it.
 *
 * The card is phase-agnostic. A caller fills it through the setters and
 * supplies the gizmo's vectors; what those mean is the phase adapter's
 * business, not this file's.
 *
 * The pure halves (vInfComponents, gizmoScale, speedModel, speedAlong,
 * speedRange, peakSpeed, bearingPoint, timingModel) take and return plain
 * values and are Node-tested in tests/ship-card.test.js.
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
function isNum(x) { return typeof x === "number" && isFinite(x); }

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
		// A net-only layer (the Coast card) carries no components at all, so
		// each is skipped rather than folded in as NaN — which would poison the
		// running maximum and collapse the scale to its fallback.
		["pro", "rad", "nrm", "net"].forEach(function (k) {
			if (isFinite(s[k])) { m = Math.max(m, Math.abs(s[k])); }
		});
	});
	return m > 0 ? m : 1;
}

// The speed bar's model, km/s. Peak pins the right edge and is recomputed with
// the trajectory, so the bar rescales as the flight is tuned and the fill
// always reads as a fraction of the fastest the ship goes this phase.
//
// `floor` pins the LEFT edge. Omitted (the Departure card) the bar starts at
// zero, as it always has. Given (the Coast card) the bar spans the flight's own
// [min, max] instead: an interplanetary coast never goes anywhere near zero, so
// a zero-based bar would spend four fifths of its length saying nothing and the
// variation the reader is scrubbing for would be invisible.
export function speedModel(current, needed, peak, floor) {
	var p = (isFinite(peak) && peak > 0) ? peak : null;
	var f = (isFinite(floor) && floor >= 0 && p && floor < p) ? floor : 0;
	var span = p ? p - f : 0;
	function frac(x) { return (span > 0 && isFinite(x)) ? clamp01((x - f) / span) : 0; }
	return {
		current: isFinite(current) ? current : null,
		needed: isFinite(needed) ? needed : null,
		peak: p,
		floor: f > 0 ? f : null,
		currentFrac: (p && isFinite(current)) ? frac(current) : 0,
		neededFrac: (p && isFinite(needed)) ? frac(needed) : null
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

// The slowest and fastest the ship goes anywhere on the sampled flight (m/s),
// null when there is nothing sampled or no sample carries a velocity.
export function speedRange(samples) {
	if (!samples || !samples.length) { return null; }
	var lo = Infinity, hi = 0, seen = false;
	for (var i = 0; i < samples.length; i++) {
		if (!samples[i].v) { continue; }
		var s = O.vMag(samples[i].v);
		if (s < lo) { lo = s; }
		if (s > hi) { hi = s; }
		seen = true;
	}
	return seen ? { min: lo, max: hi } : null;
}

// The fastest the ship goes anywhere on the sampled flight (m/s), null when
// there is nothing sampled.
export function peakSpeed(samples) {
	var r = speedRange(samples);
	return r ? r.max : null;
}

// Where the approach dot sits in the B-plane square: a point on a FIXED-radius
// circle at `angleDeg` clockwise from straight up (ecliptic north). Distance to
// the body is deliberately not conveyed — only which side the ship passes — so
// the radius is a constant and the bearing is the only thing that moves.
// Returns { x, y } in the square's own coordinates, y growing downward as SVG's
// does.
export function bearingPoint(angleDeg, radius) {
	var a = (angleDeg - 90) * Math.PI / 180;
	return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
}

// How far the live arrival sits from the coast's own last-committed arrival —
// a plain delta, not a comparison to the frozen plan. Positive hours = later.
//
// Returns { hours }, or null when either epoch is missing.
export function timingModel(deliveredJd, refJd) {
	// isFinite(null) is true — null coerces to 0 — so "is there an epoch at all?"
	// needs the type check, not just finiteness. Nothing pending (or nothing
	// reachable) hands a null through here, and treating it as JD 0 would
	// measure the delivered epoch against the year -4712.
	if (!isNum(deliveredJd) || !isNum(refJd)) { return null; }
	return { hours: (deliveredJd - refJd) * 24 };
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
// A change figure: one decimal, and small enough values read as a plain zero
// rather than as "-0.0", which looks like a measurement when it is a rounding.
function chg(x) {
	if (x == null || !isFinite(x)) { return "—"; }
	return Math.abs(x) < 0.05 ? "0" : x.toFixed(1);
}

// Line thickness in gizmo units (radius, so the drawn width is twice this).
// Needed is drawn fat and current thin, and the current layer is drawn over it
// (see render), so neither hides the other where the two nearly coincide —
// which is exactly when the card is being read most closely.
var LINE_RADIUS = { dim: 0.032, bright: 0.014 };

// The gizmo camera's resting distance.
var GIZMO_REF_RADIUS = 3.4;

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
	if (!(len > 1e-9)) { return null; }
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
	var titleWrap = el("span", "mp-ship-titlewrap");
	var title = el("span", "mp-ship-title", "SHIP");
	var subtitle = el("span", "mp-ship-subtitle", "");
	titleWrap.appendChild(title);
	titleWrap.appendChild(subtitle);
	var badge = el("span", "mp-ship-oncourse", "✓");
	badge.title = "On course";
	// The commit control and the approach square are Coast's; both stay empty
	// and out of the layout until a caller fills them (setUpdate / setBPlane).
	var commitWrap = el("span", "mp-ship-commit");
	var updateBtn = document.createElement("button");
	updateBtn.className = "mp-btn mp-ship-update";
	updateBtn.textContent = "Update";
	updateBtn.style.display = "none";
	commitWrap.appendChild(badge);
	commitWrap.appendChild(updateBtn);
	var bPlaneEl = el("div", "mp-ship-bplane");
	bPlaneEl.style.display = "none";
	head.appendChild(titleWrap);
	head.appendChild(commitWrap);
	head.appendChild(bPlaneEl);
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
	var approachEl = el("div", "mp-ship-approach");
	bodyEl.appendChild(approachEl);
	var timingEl = el("div", "mp-ship-timing");
	bodyEl.appendChild(timingEl);
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
	var cam = createCam(GIZMO_REF_RADIUS, Math.PI * 0.25, Math.PI * 0.42, new THREE.Vector3(0, 0, 0));
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
	function clearGroups(groups) {
		groups.forEach(function (g) {
			g.children.slice().forEach(function (child) {
				g.remove(child);
				if (child.material) { child.material.dispose(); }
			});
		});
	}
	function clearGroup() { clearGroups([neededGroup, currentGroup]); }

	// spec: { axes: { pro, rad, nrm } unit vectors — OMIT for a net-only gizmo,
	//         needed, current: { pro, rad, nrm, net } (either may be null),
	//         neededDir, currentDir: unit vectors for the net lines }
	// Passing null clears the gizmo.
	//
	// Departure passes both layers with `axes`, drawing the needed/current
	// comparison: each layer's three components plus its net. Coast passes only
	// `current` with `axes` set to the leg end's own burn frame — the speed
	// change pending waypoint edits make, split onto that frame, with no
	// "needed" layer to compare against.
	function setGizmo(spec) {
		clearGroup();
		if (!spec) { return; }
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
				if (spec.axes) {
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
				}
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

	// A SINGLE labelled row of axis figures, for a phase reporting one vector
	// rather than a comparison — the Coast card's net speed change from its
	// waypoints. Shares tableEl (and so the axis colours and column widths) with
	// setComponents; a phase uses one or the other, never both.
	function setChange(label, comps, unit) {
		tableEl.innerHTML = "";
		if (!comps) { return; }
		var head2 = el("div", "mp-ship-row mp-ship-row-head");
		head2.appendChild(el("span", "mp-ship-rowlabel", ""));
		AXIS_KEYS.forEach(function (k) {
			head2.appendChild(el("span", "mp-ship-cell mp-ship-h-" + k, AXIS_LABELS[k]));
		});
		head2.appendChild(el("span", "mp-ship-cell mp-ship-h-net", "Net"));
		tableEl.appendChild(head2);

		var row = el("div", "mp-ship-row mp-ship-row-current");
		row.appendChild(el("span", "mp-ship-rowlabel mp-ship-changelabel",
			label + (unit ? " " + unit : "")));
		AXIS_KEYS.forEach(function (k) {
			row.appendChild(el("span", "mp-ship-cell mp-ship-c-" + k, chg(comps[k])));
		});
		row.appendChild(el("span", "mp-ship-cell mp-ship-c-net", chg(comps.net)));
		tableEl.appendChild(row);
	}

	// The speed section: a headline, then a bar whose right edge IS the peak
	// speed of this phase's flight, with the needed speed ticked on it. With a
	// floor (the Coast card) the left edge is the flight's slowest instead of
	// zero, and both ends are printed under the bar so the span is readable.
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
		// A floor-based bar reads at its minimum as an empty tube, which looks
		// broken rather than slow; keep a sliver so the fill is always a fill.
		fill.style.width = Math.max(model.floor != null ? 1.5 : 0,
			model.currentFrac * 100).toFixed(2) + "%";
		bar.appendChild(fill);
		if (model.neededFrac != null) {
			var tick = el("div", "mp-ship-bar-need");
			tick.style.left = (model.neededFrac * 100).toFixed(2) + "%";
			tick.title = "Needed at hand-off: " + kms(model.needed) + " km/s";
			bar.appendChild(tick);
		}
		speedEl.appendChild(bar);

		// The span's two ends, printed only when the left one isn't zero.
		if (model.floor != null && model.peak != null) {
			var ends = el("div", "mp-ship-barends");
			ends.appendChild(el("span", null, kms(model.floor)));
			ends.appendChild(el("span", null, kms(model.peak)));
			speedEl.appendChild(ends);
		}

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

	// A phase qualifier beside the title ("- Coast"). "" clears it.
	function setSubtitle(text) {
		subtitle.textContent = text ? " - " + text : "";
	}

	// The commit control. spec: { show, enabled, title, onClick } — null hides
	// it. The button is NEVER disabled merely because the pass got worse: which
	// way is better is the user's call (raising a closest approach to clear an
	// impact is an improvement, and the plan commits no periapsis to judge it
	// against), so the chips say which way each figure moved and the button
	// stays live.
	function setUpdate(spec) {
		if (!spec || !spec.show) { updateBtn.style.display = "none"; return; }
		updateBtn.style.display = "";
		updateBtn.disabled = spec.enabled === false;
		updateBtn.title = spec.title || "";
		updateBtn.onclick = spec.onClick || null;
	}

	// The approach chips: the figures the reader is actually steering — how
	// close the pass comes and how fast it arrives. Each is a big value on a
	// chip, with the committed figure underneath when it differs, so a pending
	// edit reads as a move from one number to another.
	//
	// rows: [{ label, value, unit, ref, better }] — `ref` is the committed
	// figure's text (omitted when nothing is pending), `better` is true/false/
	// null for the direction of the move. null clears.
	function setApproach(rows) {
		approachEl.innerHTML = "";
		if (!rows || !rows.length) { return; }
		rows.forEach(function (r) {
			var cell = el("div", "mp-ship-appcell");
			cell.appendChild(el("div", "mp-ship-applabel", r.label));
			var chip = el("div", "mp-ship-appchip");
			if (r.better === true) { chip.classList.add("better"); }
			if (r.better === false) { chip.classList.add("worse"); }
			chip.appendChild(el("span", "mp-ship-appval", r.value));
			if (r.unit) { chip.appendChild(el("span", "mp-ship-appunit", r.unit)); }
			cell.appendChild(chip);
			if (r.ref) { cell.appendChild(el("div", "mp-ship-appref", r.ref)); }
			approachEl.appendChild(cell);
		});
	}

	// A plain readout (matching setChange's style, not a bar): how far the live
	// arrival has moved from the coast's own last-committed arrival. model
	// comes from timingModel; null clears.
	function setTiming(model) {
		timingEl.innerHTML = "";
		if (!model) { return; }
		var mag = Math.abs(model.hours);
		var text = mag < 0.05 ? "unchanged"
			: (mag >= 48 ? (model.hours / 24).toFixed(1) + " d" : model.hours.toFixed(1) + " h") +
			  (model.hours > 0 ? " later" : " earlier");
		var line = el("div", "mp-ship-timinghead");
		line.appendChild(el("b", null, "Timing:"));
		line.appendChild(el("span", "mp-ship-timingval", text));
		timingEl.appendChild(line);
	}

	// The approach square: which side of the destination the ship passes on,
	// read off the B-plane (Shared/math-utils.js's bPlane). model:
	// { angleDeg, label } or null. Only the BEARING is shown — the dot sits at a
	// fixed radius and says nothing about distance, which the chips above carry.
	function setBPlane(model) {
		bPlaneEl.innerHTML = "";
		if (!model || !isFinite(model.angleDeg)) { bPlaneEl.style.display = "none"; return; }
		bPlaneEl.style.display = "";
		var R = 25, C = 32, ring = 19;
		var p = bearingPoint(model.angleDeg, ring);
		var ns = "http://www.w3.org/2000/svg";
		var svg = document.createElementNS(ns, "svg");
		svg.setAttribute("viewBox", "0 0 " + (C * 2) + " " + (C * 2));
		svg.setAttribute("class", "mp-ship-bsvg");
		function node(name, attrs) {
			var n = document.createElementNS(ns, name);
			Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
			svg.appendChild(n);
			return n;
		}
		// North tick, so "up is ecliptic north" is stated by the square itself.
		node("line", { x1: C, y1: C - R - 3, x2: C, y2: C - R + 3,
			stroke: "#7fd4f0", "stroke-width": 1.4 });
		node("circle", { cx: C, cy: C, r: ring, fill: "none",
			stroke: "#5a6b8c", "stroke-width": 1, "stroke-dasharray": "2 3" });
		node("circle", { cx: C, cy: C, r: 8.5, fill: "#6f7c93" });
		node("circle", { cx: C + p.x, cy: C + p.y, r: 4.2, fill: "#f2f6ff" });
		bPlaneEl.appendChild(svg);
		bPlaneEl.title = model.label || "";
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
		// inside the scissor). Pass two clears depth ONLY, then draws current on a
		// clean slate, so it can never be hidden by a needed line in front.
		// scene.background must be nulled for pass two: a Color background makes
		// three.js force a full clear regardless of autoClear, which would wipe
		// pass one.
		var auto = renderer.autoClear;
		function overlayPass(cameraToUse) {
			scene.background = null;
			renderer.autoClear = false;
			renderer.clearDepth();
			renderer.render(scene, cameraToUse);
			renderer.autoClear = auto;
			scene.background = bgColor;
		}

		currentGroup.visible = false;
		renderer.render(scene, camera);
		if (currentGroup.children.length) {
			currentGroup.visible = true;
			neededGroup.visible = false;
			overlayPass(camera);
			neededGroup.visible = true;
		} else {
			currentGroup.visible = true;
		}
	}

	function dispose() {
		unbindCamera();
		clearGroups([neededGroup, currentGroup]);
		root.remove();
	}

	return {
		el: root,
		gizmoEl: gizmoEl,
		setOnCourse: setOnCourse,
		setGizmo: setGizmo,
		setComponents: setComponents,
		setChange: setChange,
		setSpeed: setSpeed,
		setSubtitle: setSubtitle,
		setUpdate: setUpdate,
		setApproach: setApproach,
		setTiming: setTiming,
		setBPlane: setBPlane,
		setExtra: setExtra,
		render: render,
		dispose: dispose
	};
}
