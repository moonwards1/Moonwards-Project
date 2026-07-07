/* Shared/sim/body-renderer.js
 *
 * Per-body view logic shared by every plotter's Three.js scene: a sphere that
 * collapses to a constant-size bright pixel once it projects smaller than a
 * pixel or two, an optional translucent sphere-of-influence shell with the
 * same collapse behaviour, and a floating HTML name label tracking the body's
 * screen position.
 *
 * Extracted from three near-duplicate copies (see Website/ARCHITECTURE.md,
 * "Step 1: scene kit"). Unlike camera-controller.js and date-bar.js, this
 * duplication came in TWO genuinely different shapes, and only one of them
 * unifies cleanly:
 *
 * - The "Kepler body" pattern — every planet drawn at true AU scale, either in
 *   the Solar-System-Trajectory-Plotter's main scene, or in the Moon-Skyhook
 *   / Mars-Phobos plotters' heliocentric "Helio" overlay (which exists
 *   *specifically* to reproduce that plotter's view, per its own file
 *   header). All three copies of this were byte-identical modulo variable
 *   names and the label CSS class — Sun special-cased (no SOI, a plain
 *   MeshBasicMaterial disc), every other body sharing one construction
 *   (MeshStandardMaterial core + a front-face-shaded 24x16 SOI shell +
 *   constant-pixel point), one screen-size threshold pass (`updateScales`)
 *   and one label-projection pass (`updateLabels`). That's `createBody` /
 *   `createSunBody` / `updateScales` below — a straight lift, safe to
 *   reuse anywhere a Kepler-scale multi-body view is needed (including the
 *   eventual MissionPlanner heliocentric view, migration-path step 4).
 *
 * - The "hero body" pattern — Earth+Moon (Moon-Skyhook) or Mars+Phobos
 *   (Mars-Phobos), drawn close-up with real textures, toon shading, and (for
 *   the Moon/Phobos) a tidal-lock spin group. These stay calculator-specific
 *   and are NOT folded into `createBody`: forcing texture loading and
 *   tidal-lock wiring into a generic factory would trade a real duplication
 *   (a few identical helper functions) for a fake unification (a factory
 *   with a pile of options nobody but these two call sites uses). What WAS
 *   genuinely identical between them, and is extracted here: the constant-
 *   pixel point (`makePoint` — also the one the Kepler pattern uses), the
 *   back-face SOI shell (`makeSOIShell`, distinct from the Kepler pattern's
 *   front-face one — see its own comment below for why), and the pixel-scale
 *   math (`pixelScaleFactor` / `worldSizeAtPointForPx`, the shared root of
 *   both patterns' size logic — the hero pattern's `screenScaleAt` and the
 *   Kepler pattern's `screenPxRadius` were literally inverses of the same
 *   formula).
 *
 * One thing WAS unified across both patterns without any behavioural change:
 * floating labels. The Kepler pattern tracked `{ el, group }` and projected
 * `group.position` directly (always a top-level scene child, so `.position`
 * IS its world position); the hero pattern tracked `{ el, obj }` and called
 * `obj.getWorldPosition(...)` (needed because the Moon/Phobos mesh is nested
 * under a moving parent group). `getWorldPosition` gives an identical result
 * to reading `.position` on a parentless object, so `addLabel`/`updateLabels`
 * below standardise on the hero pattern's approach (track any Object3D, call
 * `getWorldPosition`) — one label implementation instead of two.
 */
/* global THREE */

import { OrbitalMath } from "../math-utils.js";

// ---- pixel-scale math ---------------------------------------------------
// The root formula behind every "how big is this on screen" question here:
// px per world-unit at a given distance, for the CURRENT camera fov/viewport.

export function pixelScaleFactor(camera, holderEl) {
	var h = holderEl.clientHeight || 1;
	return (h / 2) / Math.tan(camera.fov * Math.PI / 360);
}

// Projected radius, in CSS pixels, of a sphere of world radius `worldR` seen
// from distance `dist`. (The Kepler pattern's per-frame loop already has
// `dist` in hand from placing the body, so this takes it directly rather
// than a position, to avoid recomputing `distanceTo` per candidate radius.)
export function projectedRadiusPx(camera, holderEl, worldR, dist) {
	return worldR / dist * pixelScaleFactor(camera, holderEl);
}

// The world-space size that projects to `px` CSS pixels at world position
// `pos` (e.g. "how big must this dot be to look like a 1px dot from here").
// Matches the hero pattern's original `screenScaleAt`, including its
// zero-distance guard.
export function worldSizeAtPointForPx(camera, holderEl, pos, px) {
	var dist = camera.position.distanceTo(pos) || 1e-9;
	return px * dist / pixelScaleFactor(camera, holderEl);
}

// ---- pure mesh helpers ---------------------------------------------------

// A constant-size bright pixel at a group's origin (so a far body is still
// visible once its sphere has shrunk below a pixel or two).
export function makePoint(colorHex, sizePx) {
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
	return new THREE.Points(g, new THREE.PointsMaterial({
		color: colorHex, size: sizePx, sizeAttenuation: false,
		transparent: true, depthTest: false }));
}

// A translucent SOI shell viewed from its BACK face, so it still reads as a
// shell when the camera is deep inside it — the normal case at "hero body"
// scale (Earth/Moon, Mars/Phobos), where the SOI is drawn large enough to
// fly through. The Kepler pattern's SOI shells (`createBody` below) are
// viewed from outside almost always at that scale, so they use a plain
// front-face material built inline instead of this.
export function makeSOIShell(radiusU, colorHex, opacity) {
	return new THREE.Mesh(
		new THREE.SphereGeometry(radiusU, 32, 24),
		new THREE.MeshBasicMaterial({
			color: colorHex, transparent: true, opacity: opacity,
			depthWrite: false, side: THREE.BackSide }));
}

// True sphere-of-influence radius in AU (0 for a body with no orbit, e.g.
// the Sun). `primaryMassKg` is the mass being orbited (the Sun, for every
// current caller).
export function soiRadiusAU(sys, primaryMassKg, AU) {
	if (!sys.orbit) { return 0; }
	var m = sys.mass || (sys.GM / 6.6743e-11);
	return OrbitalMath.sphereOfInfluence(sys.orbit.a, m, primaryMassKg) / AU;
}

// ---- floating labels ------------------------------------------------------

// Create a floating HTML label tied to an Object3D's world position. `obj`
// can be a top-level group (its world position is just its local position)
// or something nested under a moving parent (e.g. a body positioned inside a
// spin/position group) — `updateLabels` below tracks either the same way.
export function addLabel(labelLayer, labelList, name, obj, className) {
	var el = document.createElement("span");
	el.className = className;
	el.textContent = name;
	labelLayer.appendChild(el);
	labelList.push({ el: el, obj: obj });
}

var _lp = new THREE.Vector3();

// Per-frame: place each name label beside its tracked object in screen space.
export function updateLabels(camera, holderEl, labelList) {
	var w = holderEl.clientWidth, h = holderEl.clientHeight;
	for (var i = 0; i < labelList.length; i++) {
		var L = labelList[i];
		L.obj.getWorldPosition(_lp).project(camera);
		if (_lp.z < 1 && _lp.x > -1.06 && _lp.x < 1.06 && _lp.y > -1.06 && _lp.y < 1.06) {
			L.el.style.display = "block";
			L.el.style.left = ((_lp.x * 0.5 + 0.5) * w + 7) + "px";
			L.el.style.top  = ((-_lp.y * 0.5 + 0.5) * h) + "px";
		} else {
			L.el.style.display = "none";
		}
	}
}

// ---- Kepler-body creation (the SST / Helio-overlay pattern) --------------

// One orbiting body at true AU scale: a shaded core sphere, a translucent
// front-face SOI shell (sized via soiRadiusAU), and a constant-pixel point
// for when both have collapsed below a pixel. Adds the group to `scene`,
// pushes { name, group, core, soi, point, radiusAU, soiAU } onto `scaleList`
// (consumed by `updateScales` below) and returns that same descriptor, so a
// caller can also key its own name->group lookup off it.
//
// opts: sys (required, the Shared/orbit.js system record), AU (required,
//   metres per scene unit), primaryMass (required, kg, passed to
//   soiRadiusAU), coreSegments/soiSegments (optional [W, H] pairs, default
//   [16,12]/[24,16]), soiOpacity (optional, default 0.10), pointSize
//   (optional, default 2.5).
export function createBody(scene, scaleList, name, opts) {
	var sys = opts.sys, AU = opts.AU;
	var col = new THREE.Color(sys.color || "#bcc3d0");
	var radAU = Number(sys.radius) / AU;
	var coreSeg = opts.coreSegments || [16, 12];
	var soiSeg = opts.soiSegments || [24, 16];
	var soiOpacity = opts.soiOpacity == null ? 0.10 : opts.soiOpacity;
	var pointSize = opts.pointSize == null ? 2.5 : opts.pointSize;

	var core = new THREE.Mesh(
		new THREE.SphereGeometry(radAU, coreSeg[0], coreSeg[1]),
		new THREE.MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.3), roughness: 0.85 }));

	var soiAU = soiRadiusAU(sys, opts.primaryMass, AU);
	var soi = new THREE.Mesh(
		new THREE.SphereGeometry(soiAU, soiSeg[0], soiSeg[1]),
		new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: soiOpacity, depthWrite: false }));

	var point = makePoint(col.clone().lerp(new THREE.Color(0xffffff), 0.45).getHex(), pointSize);

	var g = new THREE.Group();
	g.add(core); g.add(soi); g.add(point);
	scene.add(g);

	var descriptor = { name: name, group: g, core: core, soi: soi, point: point, radiusAU: radAU, soiAU: soiAU };
	scaleList.push(descriptor);
	return descriptor;
}

// The Sun: real radius, no SOI, collapses to a bright pixel when far.
// opts: sys (required), AU (required), color (optional, default 0xffe066),
//   pointColor (optional, default 0xfff2a0), coreSegments (optional [W,H],
//   default [24,18]), pointSize (optional, default 3), name (optional,
//   default "Sun").
export function createSunBody(scene, scaleList, opts) {
	var sys = opts.sys, AU = opts.AU;
	var radAU = Number(sys.radius) / AU;
	var seg = opts.coreSegments || [24, 18];

	var core = new THREE.Mesh(
		new THREE.SphereGeometry(radAU, seg[0], seg[1]),
		new THREE.MeshBasicMaterial({ color: opts.color == null ? 0xffe066 : opts.color }));
	var point = makePoint(opts.pointColor == null ? 0xfff2a0 : opts.pointColor, opts.pointSize == null ? 3 : opts.pointSize);

	var g = new THREE.Group();
	g.add(core); g.add(point);
	scene.add(g);

	var descriptor = { name: opts.name || "Sun", group: g, core: core, soi: null, point: point, radiusAU: radAU, soiAU: 0 };
	scaleList.push(descriptor);
	return descriptor;
}

// Per-frame: show each Kepler body / SOI as a real sphere when big enough on
// screen, otherwise collapse it to its bright pixel. `scaleList` entries are
// the descriptors `createBody`/`createSunBody` push (or an equivalent shape).
// opts: wantSOI (bool, whether SOI shells should show at all), pxBody
//   (optional, default 1.4 — px threshold for the core sphere), pxSoi
//   (optional, default 2.0 — px threshold for the SOI shell).
export function updateScales(camera, holderEl, scaleList, opts) {
	opts = opts || {};
	var pxBody = opts.pxBody == null ? 1.4 : opts.pxBody;
	var pxSoi = opts.pxSoi == null ? 2.0 : opts.pxSoi;
	var wantSOI = !!opts.wantSOI;
	var f = pixelScaleFactor(camera, holderEl);
	for (var i = 0; i < scaleList.length; i++) {
		var b = scaleList[i];
		var dist = camera.position.distanceTo(b.group.position) || 1e-9;
		var showCore = (b.radiusAU / dist * f) >= pxBody;
		b.core.visible = showCore;
		b.point.visible = !showCore;
		if (b.soi) {
			b.soi.visible = wantSOI && (b.soiAU / dist * f) >= pxSoi;
		}
	}
}
