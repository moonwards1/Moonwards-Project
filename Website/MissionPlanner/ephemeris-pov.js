/* Mission Planner — the Ephemeris tab's point-of-view scenes.
 *
 * A POV shows the drawn flight from one end — the origin or the destination —
 * in that body's own non-rotating frame (scene-frames.js's buildBodyFrame, or
 * buildEarthMoonFrame for Earth and the Moon), so the planet itself stands at
 * the centre where the heliocentric view shows only a dot or the "×". This
 * file owns the scene objects laid over such a frame: the stretch of path the
 * POV window covers, the Moon-origin escape out to Earth's SOI, the hand-off
 * dot, the ship chevron, and at a destination the equatorial catch disc and
 * the arrival mark. ephemeris-view.js does the physics — every point handed in
 * here is already a body-relative position in metres — and decides the window
 * (core/pov-window.js).
 *
 * One scene per body, built on first use and kept for the page's life, like
 * the Ephemeris tab itself.
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { systems } from "../Shared/orbit.js";
import { OrbitalMath } from "../Shared/math-utils.js";
import { buildBodyFrame, buildEarthMoonFrame, U } from "./scene-frames.js";
import { makeShipSprite, orientMarkerSprite } from "../Shared/sim/marker-card.js";
import { worldSizeAtPointForPx } from "../Shared/sim/body-renderer.js";
import { equatorNormal } from "./modules/arrival-approach.js";
import { MAX_PASS_ALTITUDE } from "./core/proximity.js";

var O = OrbitalMath;

var PATH_COLOR = 0x66f0ff;      // the helio view's own trajectory colour
var ESCAPE_COLOR = 0x66f0ff;    // the Moon-origin escape, before the hand-off — drawn dashed
var START_COLOR = 0xff5fd0;     // the hand-off dot, as in the helio view
// The arrival mark in the mission tab's own colours (arrival-leg.js's draw()):
// green for an equatorial crossing, white for closest approach.
var CROSSING_COLOR = 0x3ddc84;
var CA_COLOR = 0xe8ecf5;
var CHEVRON_PX = 26;

// Earth and the Moon share one scene, centred on Earth; every other body gets
// its own, centred on itself. `centre` is the body at the scene's origin —
// what every position handed to this file is measured from.
export function povSceneFor(body) {
	if (body === "Earth" || body === "Moon") { return { key: "Earth-Moon", centre: "Earth" }; }
	return { key: body, centre: body };
}

function toScene(r) { return new THREE.Vector3(r[0] / U, r[1] / U, r[2] / U); }

function dotAt(colorHex, sizePx) {
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
	var p = new THREE.Points(g, new THREE.PointsMaterial({
		color: colorHex, size: sizePx, sizeAttenuation: false, transparent: true, depthTest: false }));
	p.renderOrder = 13;
	p.visible = false;
	return p;
}

// The equatorial plane out to MAX_PASS_ALTITUDE above the surface: where an
// equatorial catching technology can meet a ship (modules/arrival-approach.js's
// arrival mark is the first crossing of this disc). Faint, double-sided, and
// non-occluding, so the path is never hidden behind it.
function makeCatchDisc(body) {
	var R = systems.get(body).radius;
	var disc = new THREE.Mesh(
		new THREE.RingGeometry(R / U, (R + MAX_PASS_ALTITUDE) / U, 96, 1),
		new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.07,
			side: THREE.DoubleSide, depthWrite: false }));
	var n = equatorNormal(body);
	disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
		new THREE.Vector3(n[0], n[1], n[2]).normalize());
	disc.renderOrder = 11;
	return disc;
}

export function createPovScenes() {
	var cache = {};

	// The scene for a POV on `body`, built once.
	function get(body) {
		var id = povSceneFor(body);
		if (cache[id.key]) { return cache[id.key]; }
		var frame = id.key === "Earth-Moon" ? buildEarthMoonFrame() : buildBodyFrame(id.key);
		var pov = {
			frame: frame, centre: id.centre,
			path: null, escape: null,
			startDot: dotAt(START_COLOR, 6),
			markDot: dotAt(CROSSING_COLOR, 7),
			catchDisc: makeCatchDisc(id.centre),
			chevron: makeShipSprite(),
			chevronDir: null
		};
		pov.chevron.visible = false;
		pov.chevron.renderOrder = 14;
		pov.catchDisc.visible = false;
		[pov.startDot, pov.markDot, pov.catchDisc, pov.chevron].forEach(function (o) { frame.scene.add(o); });
		cache[id.key] = pov;
		return pov;
	}
	return { get: get };
}

// dash: dash length in SCENE units for a dashed line, or null for solid.
function replaceLine(pov, key, pts, colorHex, dash) {
	var old = pov[key];
	if (old) { pov.frame.scene.remove(old); old.geometry.dispose(); old.material.dispose(); pov[key] = null; }
	if (!pts || pts.length < 2) { return; }
	var line = new THREE.Line(
		new THREE.BufferGeometry().setFromPoints(pts.map(toScene)),
		dash ? new THREE.LineDashedMaterial({ color: colorHex, dashSize: dash, gapSize: dash, transparent: true, opacity: 0.8 })
		     : new THREE.LineBasicMaterial({ color: colorHex }));
	if (dash) { line.computeLineDistances(); }
	pov.frame.scene.add(line);
	pov[key] = line;
}

function placeDot(dot, r) {
	dot.visible = !!r;
	if (!r) { return; }
	var a = dot.geometry.attributes.position;
	a.setXYZ(0, r[0] / U, r[1] / U, r[2] / U);
	a.needsUpdate = true;
	dot.geometry.computeBoundingSphere();
}

// Redraw everything but the chevron. d: { path, escape, start, mark,
// catchDisc } — point lists and single points in metres relative to the
// scene's centre body, any of them null to hide it. `mark` is
// arrival-approach.js's arrivalMark result ({ kind, r }) or null.
export function drawPov(pov, d) {
	replaceLine(pov, "path", d.path, PATH_COLOR);
	// The escape's dashes scale with its own size, about 60 along it.
	replaceLine(pov, "escape", d.escape, ESCAPE_COLOR, d.escape ? povExtent(d.escape) / 1e6 / 60 : null);
	placeDot(pov.startDot, d.start);
	placeDot(pov.markDot, d.mark ? d.mark.r : null);
	if (d.mark) { pov.markDot.material.color.setHex(d.mark.kind === "crossing" ? CROSSING_COLOR : CA_COLOR); }
	pov.catchDisc.visible = !!d.catchDisc;
}

// The ship chevron at a body-relative state (m, m/s); null hides it.
export function setPovChevron(pov, r, v) {
	pov.chevron.visible = !!r;
	if (!r) { return; }
	pov.chevron.position.copy(toScene(r));
	pov.chevronDir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
}

// Per-frame: hold the chevron at a constant on-screen size, nose along its
// body-relative heading.
export function scalePovOverlays(pov, paneEl) {
	var cam = pov.frame.camera;
	if (pov.chevron.visible) {
		pov.chevron.scale.setScalar(worldSizeAtPointForPx(cam, paneEl, pov.chevron.position, CHEVRON_PX));
		if (pov.chevronDir) { orientMarkerSprite(cam, pov.chevron, pov.chevronDir); }
	}
}

// Largest distance from the centre over a point list (m) — what the camera
// frames on entering a POV.
export function povExtent(pts) {
	var m = 0;
	(pts || []).forEach(function (r) { m = Math.max(m, O.vMag(r)); });
	return m;
}
