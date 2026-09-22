/* Mission Planner — the ship card.
 *
 * A floating card in the scene pane reporting on the ship the chevron marks:
 * a small three.js gizmo, a numeric summary, and a speed bar — plus, for a
 * phase that asks for it, a B-plane square.
 *
 * Departure's gizmo is a comparison: dim = the v∞ the adopted plan requires at
 * hand-off, bright = what the technology delivers, each split onto the burn
 * frame's three axes plus a net line, and "on course" is when the two coincide.
 * Coast has no gizmo and no on-course state: many passes arrive successfully,
 * so the card shows the speed along the coast and where around the
 * destination the pass goes and how high, and grades nothing.
 *
 * OPTIONAL PARTS. Every section is filled by a setter and renders nothing until
 * one is called, so a phase takes only the parts it needs and the card stays
 * phase-agnostic: the gizmo, setComponents and setOnCourse are Departure's,
 * setBPlane is Coast's, and the speed bar serves both.
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
 * speedRange, peakSpeed, bearingPoint, altitudeRadius, bPlaneLayout,
 * approachRows) take and
 * return plain
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
		// A missing component is skipped rather than folded in as NaN, which
		// would poison the running maximum and collapse the scale to its
		// fallback.
		["pro", "rad", "nrm", "net"].forEach(function (k) {
			if (isFinite(s[k])) { m = Math.max(m, Math.abs(s[k])); }
		});
	});
	return m > 0 ? m : 1;
}

// The speed bar's model, km/s. Peak pins the right edge and is recomputed with
// the trajectory, so the bar rescales as the flight is tuned and the fill
// always reads as a fraction of the bar's own span.
//
// `floor` pins the LEFT edge. Omitted (the Departure card) the bar starts at
// zero, as it always has. Given (the Coast card) the bar spans the flight's own
// [min, max] instead: an interplanetary coast never goes anywhere near zero, so
// a zero-based bar would spend four fifths of its length saying nothing and the
// variation the reader is scrubbing for would be invisible.
//
// `max` is the fastest the ship goes on the whole phase, which is ABOVE the
// bar's top when a close pass was left out of the bar's span (see speedRange's
// `skip`). Reported as `max` only then, so a caller with nothing excluded is
// unaffected; `over` says the ship is currently up in that excursion, where the
// fill pins full and the headline speed is the only honest readout.
export function speedModel(current, needed, peak, floor, max) {
	var p = (isFinite(peak) && peak > 0) ? peak : null;
	var f = (isFinite(floor) && floor >= 0 && p && floor < p) ? floor : 0;
	var span = p ? p - f : 0;
	function frac(x) { return (span > 0 && isFinite(x)) ? clamp01((x - f) / span) : 0; }
	return {
		current: isFinite(current) ? current : null,
		needed: isFinite(needed) ? needed : null,
		peak: p,
		max: (p && isFinite(max) && max > p) ? max : null,
		over: !!(p && isFinite(current) && current > p),
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

// The slowest and fastest the ship goes over a sampled flight (m/s), null when
// there is nothing sampled or no sample carries a velocity. With no options
// this is the plain whole-flight scan.
//
// Both options exist for the same reason: a speed bar scaled to a figure the
// reader cannot reach by scrubbing reads as broken, because the flight on
// screen never shows it.
//
// `opts.tMax` (seconds since the leg's start) bounds the scan to the part of
// the flight the card can show at all. A leg's samples routinely run past the
// end of the phase reading them — the coast's continue past the arrival seam,
// through the destination's SOI, where periapsis speed dwarfs the cruise. The
// bound itself is included at its interpolated value, so the range never stops
// just short of the fastest point still in view.
//
// `opts.skip` is a list of { t0, t1 } second windows left out of the scan: the
// close passes of bodies met on the way. Those are inside the span the chevron
// can reach, but a periapsis lasting hours sits within a slider spanning years,
// so no scrub lands on it while the bar scaled to it flattens the entire
// cruise. Left out, the excursion overflows the bar instead of setting it.
export function speedRange(samples, opts) {
	if (!samples || !samples.length) { return null; }
	var o = opts || {};
	var bounded = isFinite(o.tMax);
	var skip = (Array.isArray(o.skip) && o.skip.length) ? o.skip : null;
	function skipped(t) {
		for (var j = 0; j < skip.length; j++) {
			if (t >= skip[j].t0 && t <= skip[j].t1) { return true; }
		}
		return false;
	}
	var lo = Infinity, hi = 0, seen = false, gap = false;
	for (var i = 0; i < samples.length; i++) {
		// Interpolating the boundary below needs every sample to carry a
		// velocity; a polyline that only carries position gets the plain scan.
		if (!samples[i].v) { gap = true; continue; }
		if (bounded && samples[i].t > o.tMax) { continue; }
		if (skip && skipped(samples[i].t)) { continue; }
		var s = O.vMag(samples[i].v);
		if (s < lo) { lo = s; }
		if (s > hi) { hi = s; }
		seen = true;
	}
	if (bounded && !gap && !(skip && skipped(o.tMax))) {
		var edge = speedAlong(samples, o.tMax);
		if (edge != null && isFinite(edge)) {
			if (edge < lo) { lo = edge; }
			if (edge > hi) { hi = edge; }
			seen = true;
		}
	}
	return seen ? { min: lo, max: hi } : null;
}

// The fastest the ship goes anywhere on the sampled flight (m/s), null when
// there is nothing sampled.
export function peakSpeed(samples) {
	var r = speedRange(samples);
	return r ? r.max : null;
}

// A point `radius` from the square's centre at `angleDeg` clockwise from
// straight up (ecliptic north). Returns { x, y } relative to the centre, y
// growing downward as SVG's does.
export function bearingPoint(angleDeg, radius) {
	var a = (angleDeg - 90) * Math.PI / 180;
	return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
}

// The B-plane square's fixed scale, in CSS px: the body is a disc of bodyR,
// and the altitude rings start at ring0 and step outward by ringStep, each
// step ringKm of altitude above the surface. The body's true size plays no
// part — the disc is the same for Ceres as for Jupiter, and only the
// altitude is to scale.
export var BPLANE_SCALE = { bodyR: 18, ring0: 30, ringStep: 12, ringKm: 10000, shipR: 4 };

// Radius in px at which a pass `altitudeKm` above the surface is drawn. Below
// the surface (an impact) it falls inside the disc, floored at the centre.
export function altitudeRadius(altitudeKm, scale) {
	scale = scale || BPLANE_SCALE;
	var perPx = scale.ringKm / scale.ringStep;
	return Math.max(0, scale.ring0 - scale.ringStep + altitudeKm / perPx);
}

// The readouts beside the square. model: { altitudeKm, speedKms, impacts } or
// null. Returns [{ label, value, warn }]. An impact has no closest approach
// above the surface, so the first row says so and the speed is the speed at
// impact.
export function approachRows(model) {
	if (!model) { return []; }
	var alt = model.impacts ? "Impact"
		: (!isFinite(model.altitudeKm) ? "—"
			: (Math.abs(model.altitudeKm) >= 1e6
				? (model.altitudeKm / 1e6).toFixed(2) + " M km"
				: Math.round(model.altitudeKm).toLocaleString("en-US") + " km"));
	return [
		{ label: "Closest approach", value: alt, warn: !!model.impacts },
		{ label: model.impacts ? "Speed at impact" : "Speed there",
			value: isFinite(model.speedKms) ? model.speedKms.toFixed(2) + " km/s" : "—",
			warn: false }
	];
}

// Everything the square draws, in px about its centre, for a square of
// half-width `half`:
//   rings — radii of the altitude rings that fit whole inside the square
//   ship  — { x, y, r } the ship's dot, or null when it would not fit
//   arrow — when the dot is off the square: a triangle at the edge on the
//           ship's bearing, pointing away from the body, as three points
//           [{x, y}, ...] (tip first); otherwise null
export function bPlaneLayout(angleDeg, altitudeKm, half, scale) {
	scale = scale || BPLANE_SCALE;
	var rings = [];
	for (var r = scale.ring0; r <= half - 1; r += scale.ringStep) { rings.push(r); }
	var rr = altitudeRadius(altitudeKm, scale);
	// The dot fits if all of it does. The square's corners reach further than
	// its half-width, but the rings stop at the inscribed circle and so does
	// the dot, so a ship beyond the last drawn ring's reach always reads as off.
	if (rr + scale.shipR <= half - 1) {
		var p = bearingPoint(angleDeg, rr);
		return { rings: rings, ship: { x: p.x, y: p.y, r: scale.shipR }, arrow: null };
	}
	var len = 9, halfBase = 5;
	var tipR = half - 2, baseR = tipR - len;
	var tip = bearingPoint(angleDeg, tipR);
	var mid = bearingPoint(angleDeg, baseR);
	var side = bearingPoint(angleDeg + 90, halfBase);
	return { rings: rings, ship: null, arrow: [
		tip,
		{ x: mid.x + side.x, y: mid.y + side.y },
		{ x: mid.x - side.x, y: mid.y - side.y }
	] };
}

// The destination's spin as the square shows it, on a disc of radius
// `bodyR` px. `pole` is the body's spin-pole unit vector (ecliptic, the
// frame bPlane works in); `bp` is bPlane's result, whose S, north and east
// give the view: looking along S with north up and east right.
//   equator — the near half of the equator (the half facing the incoming
//             ship), as screen points {x, y} about the centre, y down
//   light   — unit screen vector pointing into the prograde half of the disc,
//             or null when the ship comes in close to along the pole
// The two halves are split by the spin axis as seen. On the light half the
// surface turns away from the viewer, the way the ship is travelling, and a
// pass there goes round the body with its rotation: a surface point r moves
// along S in proportion to r·(S×p), and a pass at B has angular momentum
// along the pole in proportion to B·(S×p) — the same sign on the same side.
export function spinLayout(pole, bp, bodyR) {
	var O = OrbitalMath;
	var S = bp.S, N = bp.north, E = bp.east;
	function scr(v) { return { x: O.vDot(v, E) * bodyR, y: -O.vDot(v, N) * bodyR }; }
	var sxp = O.vCross(S, pole);
	var m = O.vMag(sxp);
	// u: the equator's in-view diameter. Along S×p when that exists; for a
	// pole-on approach any direction in the equator will do.
	var u = m > 1e-6 ? O.vScale(sxp, 1 / m)
		: O.vUnit(O.vSub(E, O.vScale(pole, O.vDot(pole, E))));
	var w = O.vCross(pole, u);
	// r(t) = u cos t + w sin t; r·S = A cos(t - t0), so the near half
	// (r·S < 0) is t0 + 90° .. t0 + 270°.
	var t0 = Math.atan2(O.vDot(w, S), O.vDot(u, S));
	var equator = [];
	var n = 32;
	for (var k = 0; k <= n; k++) {
		var t = t0 + Math.PI / 2 + Math.PI * k / n;
		equator.push(scr(O.vAdd(O.vScale(u, Math.cos(t)), O.vScale(w, Math.sin(t)))));
	}
	var light = null;
	if (m > 0.05) {
		var d = scr(u);
		var dl = Math.hypot(d.x, d.y);
		light = { x: d.x / dl, y: d.y / dl };
	}
	return { equator: equator, light: light };
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
// Returns { el, gizmoEl, refineBtn, setOnCourse, setGizmo, showGizmo,
// showRefine, setComponents, setSpeed, setSubtitle, setBPlane, setApproach,
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
	var title = el("span", "mp-ship-title", "Ship");
	var subtitle = el("span", "mp-ship-subtitle", "");
	titleWrap.appendChild(title);
	titleWrap.appendChild(subtitle);
	var badge = el("span", "mp-ship-oncourse", "✓");
	badge.title = "On course";
	// Departure's own control: a three-way split with the title-and-readouts
	// column on the left, the button centred, and the on-course checkmark's
	// spot held on the right. Hidden for Coast, which has no re-solve.
	var refineBtn = document.createElement("button");
	refineBtn.type = "button";
	refineBtn.className = "mp-btn mp-ship-refine";
	refineBtn.textContent = "Refine";
	refineBtn.style.display = "none";
	// The approach square is Coast's; it stays out of the layout until a
	// caller fills it (setBPlane). Shown, it takes all the head's width beside
	// the title as a square, making the band above the speed bar two columns:
	// title (and whatever goes under it) on the left, the square on the right.
	var bPlaneEl = el("div", "mp-ship-bplane");
	bPlaneEl.style.display = "none";
	// The left column: the title, and under it the approach readouts
	// (setApproach), which sit beside the square.
	var leftCol = el("div", "mp-ship-left");
	var approachEl = el("div", "mp-ship-approach");
	leftCol.appendChild(titleWrap);
	leftCol.appendChild(approachEl);
	head.appendChild(leftCol);
	head.appendChild(refineBtn);
	head.appendChild(badge);
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
	// comparison: each layer's three components plus its net.
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

	// Whether the phase uses the gizmo at all. Hidden, the strip and its
	// "Align to view" toggle leave the layout, and render draws nothing there.
	function showGizmo(on) {
		gizmoEl.style.display = on ? "" : "none";
		alignLabel.style.display = on ? "" : "none";
	}

	// Whether Departure's Refine control shows at all — Coast has nothing to
	// re-solve. The caller (mission-view.js) owns the button's click, disabled
	// state and title, same as it owns every other reading behind this card.
	function showRefine(on) {
		refineBtn.style.display = on ? "" : "none";
		root.classList.toggle("has-refine", !!on);
	}
	// The head doubles as a drag handle (see bindCardDrag); without this a
	// press on the button starts dragging the card instead of clicking it.
	refineBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });

	// ---- readouts---------------------------------------------------------

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

	// The speed section: a headline, then a bar whose right edge is the top of
	// this phase's flight, with the needed speed ticked on it. With a floor (the
	// Coast card) the left edge is the flight's slowest instead of zero, and both
	// ends are printed under the bar so the span is readable.
	//
	// Peak states the fastest the ship actually goes, which is off the top of the
	// bar when a close pass of a body on the way was left out of the bar's span
	// — the bar shows the cruise, and the pass overflows it rather than
	// flattening it. The two agree whenever nothing was left out.
	function setSpeed(model) {
		speedEl.innerHTML = "";
		if (!model) { return; }
		var line = el("div", "mp-ship-speedhead");
		var left = el("span", "mp-ship-speednow");
		left.appendChild(el("b", null, "Speed"));
		left.appendChild(el("i", null, " at current position: "));
		left.appendChild(el("span", "mp-ship-speedval", kms(model.current)));
		line.appendChild(left);
		var top = model.max != null ? model.max : model.peak;
		var chip = el("span", "mp-ship-peak" + (model.max != null ? " mp-ship-peak-over" : ""),
			top == null ? "" : "Peak: " + kms(top));
		if (model.max != null) {
			chip.title = "The bar spans the cruise, " + kms(model.floor) + " to " +
				kms(model.peak) + " km/s. The peak is reached in a close pass of a " +
				"body on the way — a few hours out of the whole coast, too brief to " +
				"scrub to — so it runs off the top of the bar instead of setting it.";
		}
		line.appendChild(chip);
		speedEl.appendChild(line);

		var bar = el("div", "mp-ship-bar");
		var fill = el("div", "mp-ship-bar-fill" + (model.over ? " mp-ship-bar-over" : ""));
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

		// The span's two ends, printed only when the left one isn't zero. A "+"
		// on the right end marks a bar the flight goes off the top of, so the
		// reader isn't left to reconcile it against a higher Peak unprompted.
		if (model.floor != null && model.peak != null) {
			var ends = el("div", "mp-ship-barends");
			ends.appendChild(el("span", null, kms(model.floor)));
			ends.appendChild(el("span", null, kms(model.peak) + (model.max != null ? "+" : "")));
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

	// A phase qualifier after the title ("Ship: coast"). "" clears it.
	function setSubtitle(text) {
		title.textContent = text ? "Ship:" : "Ship";
		subtitle.textContent = text ? text.toLowerCase() : "";
	}

	// The approach square: where around the destination the ship passes, and
	// how high. model: { angleDeg, altitudeKm, spin, label } or null. `spin`
	// (optional) is spinLayout's result, drawn on the body disc: the near half
	// of the equator, and the prograde half of the disc lighter. angleDeg is the
	// bearing in the B-plane (Shared/math-utils.js's bPlane), clockwise from
	// ecliptic north; altitudeKm is the closest approach above the surface,
	// drawn on the altitude-ring scale (BPLANE_SCALE). A pass too high for the
	// square shows as an arrow at its edge on the same bearing.
	function setBPlane(model) {
		bPlaneEl.innerHTML = "";
		var on = !!model && isFinite(model.angleDeg);
		root.classList.toggle("has-bplane", on);
		if (!on) { bPlaneEl.style.display = "none"; return; }
		bPlaneEl.style.display = "";
		// The viewBox is the square's own inner size, so one unit is one CSS
		// px and BPLANE_SCALE's figures are the drawn sizes. The card is shown
		// whenever this runs, so the size is known; 144 is its usual value.
		var C = (bPlaneEl.clientWidth || 144) / 2;
		var lay = bPlaneLayout(model.angleDeg, model.altitudeKm, C);
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
		// North tick at the top edge, so "up is ecliptic north" is stated by
		// the square itself.
		node("line", { x1: C, y1: 0, x2: C, y2: 5,
			stroke: "#7fd4f0", "stroke-width": 1.4 });
		lay.rings.forEach(function (r) {
			node("circle", { cx: C, cy: C, r: r, fill: "none",
				stroke: "#2e3b57", "stroke-width": 1 });
		});
		var bR = BPLANE_SCALE.bodyR;
		var spin = model.spin || null;
		node("circle", { cx: C, cy: C, r: bR, fill: spin && spin.light ? "#4d586c" : "#6f7c93" });
		if (spin) {
			if (spin.light) {
				// The prograde half: a half-disc bulging toward `light`, its
				// straight edge the spin axis as seen.
				var L = spin.light;
				var p1 = { x: C - L.y * bR, y: C + L.x * bR };
				var p2 = { x: C + L.y * bR, y: C - L.x * bR };
				node("path", { fill: "#a9b4c8", d: "M" + p1.x.toFixed(2) + "," + p1.y.toFixed(2) +
					" A" + bR + "," + bR + " 0 0 0 " + p2.x.toFixed(2) + "," + p2.y.toFixed(2) + " Z" });
			}
			node("polyline", { fill: "none", stroke: "#ffd27f", "stroke-width": 1.3,
				points: spin.equator.map(function (q) {
					return (C + q.x).toFixed(2) + "," + (C + q.y).toFixed(2);
				}).join(" ") });
		}
		if (lay.ship) {
			node("circle", { cx: C + lay.ship.x, cy: C + lay.ship.y, r: lay.ship.r, fill: "#f2f6ff" });
		} else {
			node("polygon", { fill: "#f2f6ff", points: lay.arrow.map(function (q) {
				return (C + q.x).toFixed(2) + "," + (C + q.y).toFixed(2);
			}).join(" ") });
		}
		bPlaneEl.appendChild(svg);
		bPlaneEl.title = model.label || "";
	}

	// The closest-approach readouts under the title, beside the square.
	// model as approachRows takes it, or null to clear.
	function setApproach(model) {
		approachEl.innerHTML = "";
		approachRows(model).forEach(function (r) {
			var row = el("div", "mp-ship-approw");
			row.appendChild(el("div", "mp-ship-aplabel", r.label));
			row.appendChild(el("div", "mp-ship-apval" + (r.warn ? " mp-ship-apwarn" : ""), r.value));
			approachEl.appendChild(row);
		});
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
		refineBtn: refineBtn,
		setOnCourse: setOnCourse,
		setGizmo: setGizmo,
		showGizmo: showGizmo,
		showRefine: showRefine,
		setComponents: setComponents,
		setSpeed: setSpeed,
		setSubtitle: setSubtitle,
		setBPlane: setBPlane,
		setApproach: setApproach,
		setExtra: setExtra,
		render: render,
		dispose: dispose
	};
}
