/* Shared/sim/burn-widget.js
 *
 * The isometric prograde/radial/normal arrow triad marking a burn point
 * (departure or a waypoint), plus the dV / prograde-speed-change arrows
 * drawn alongside it (see Website/ARCHITECTURE.md, "Step 1: scene kit").
 *
 * Extracted from four call sites (Solar-System-Trajectory-Plotter's single
 * scene; Moon-Skyhook's and Mars-Phobos's local views AND their Helio
 * overlays), which agreed on almost everything — the axis colours
 * (prograde 0x6fd49a green, radial 0xffb45a orange, normal 0x8ab4ff blue),
 * the arrow styling (depthTest/depthWrite off, transparent, cone ratios
 * 0.22/0.12 of length), and the burn frame used to orient the gizmo
 * (`OrbitalMath.burnFrame`, the same ecliptic-anchored frame the burn
 * sliders act in — see the project's burn-frame note). Two things
 * genuinely differ per tool and stay caller-supplied:
 *
 * - Physical scale (scene units per km/s for the arrows) — a heliocentric
 *   view draws AU per km/s (0.03 in the Solar-System-Trajectory-Plotter),
 *   a local view draws its own view-units per km/s (e.g. 8 for
 *   Moon-Skyhook's "1000 km per unit" scale). `makeBurnArrow` takes this
 *   as `scale`, not a baked-in constant.
 * - Render position vs. burn-frame position. The common case is the same
 *   point (`renderPos` is just `rLocal` converted to scene units), but
 *   Moon-Skyhook/Mars-Phobos's flyby handling can put a waypoint's drawn
 *   position and its LOCAL burn frame in different reference frames — see
 *   their `localFrameAt` — so `createWaypointGizmo` takes both explicitly
 *   rather than assuming one from the other.
 *
 * The per-frame "hold this at a constant on-screen size" pass is NOT
 * duplicated here — it's the exact same formula as body-renderer.js's
 * `worldSizeAtPointForPx` (already extracted), so callers use that
 * directly: `gizmo.scale.setScalar(worldSizeAtPointForPx(camera, holderEl,
 * gizmo.position, 42))`.
 *
 * Draggable-gizmo hit-testing (Moon-Skyhook/Mars-Phobos let you grab a
 * waypoint's arms) is not this module's concern either — it stores the
 * three arms' unit endpoints on `userData.axes` (cheap, harmless for a
 * read-only display like the Solar-System-Trajectory-Plotter's), but the
 * actual raycasting/hit-testing against them stays in each calculator.
 */
/* global THREE */

import { OrbitalMath } from "../math-utils.js";

// One axis of a waypoint gizmo: a line from the origin out along a unit
// direction, drawn on top of everything else.
export function makeAxisLine(dir, colorHex) {
	var g = new THREE.BufferGeometry().setFromPoints(
		[new THREE.Vector3(0, 0, 0), new THREE.Vector3(dir[0], dir[1], dir[2])]);
	return new THREE.Line(g, new THREE.LineBasicMaterial({
		color: colorHex, depthTest: false, transparent: true }));
}

// A prograde / radial / normal gizmo at a burn point, aligned to
// OrbitalMath.burnFrame(rLocal, vLocal) — the SAME frame the burn sliders
// act in, so the drawn arms always match what a burn will actually do.
//
// rLocal, vLocal: the position/velocity (m, m/s) that DEFINE the frame.
// renderPos: THREE.Vector3 (scene units) — where to place the gizmo group.
//   Kept separate from rLocal (see module header) rather than derived from
//   it, so a flyby's frame/position split works without a special case here.
// Returns a THREE.Group, renderOrder 10, held at constant on-screen size by
// the caller (see module header) — not added to any scene.
export function createWaypointGizmo(rLocal, vLocal, renderPos) {
	var f = OrbitalMath.burnFrame(rLocal, vLocal);
	var vhat = f.pro, rhat = f.rad, nhat = f.nrm;
	var g = new THREE.Group();
	g.add(makeAxisLine(vhat, 0x6fd49a));   // prograde
	g.add(makeAxisLine(rhat, 0xffb45a));   // radial
	g.add(makeAxisLine(nhat, 0x8ab4ff));   // normal
	g.position.copy(renderPos);
	g.renderOrder = 10;
	// Local-space unit endpoints of the three drawn arms — the arms are what's
	// actually visible/grabbable on screen (they extend well past the centre
	// point), so a draggable gizmo's hit-testing needs the full arm, not just
	// the origin. Unused (harmless) for a read-only display.
	g.userData.axes = [
		new THREE.Vector3(vhat[0], vhat[1], vhat[2]),
		new THREE.Vector3(rhat[0], rhat[1], rhat[2]),
		new THREE.Vector3(nhat[0], nhat[1], nhat[2])
	];
	return g;
}

// One arrow for a velocity-like vector (m/s), anchored at a scene-unit
// position (THREE.Vector3). `scale` is scene-units per km/s — each tool
// draws at its own physical scale (AU per km/s in a heliocentric view,
// view-units per km/s in a local view). Returns null for a negligible
// vector (< minKms, default 0.05) so near-zero burns don't draw a
// degenerate arrow.
export function makeBurnArrow(originPos, vec, colorHex, scale, minKms) {
	var kms = OrbitalMath.vMag(vec) / 1000;
	if (kms < (minKms == null ? 0.05 : minKms)) { return null; }
	var len = kms * scale;
	var dir = new THREE.Vector3(vec[0], vec[1], vec[2]).normalize();
	var arrow = new THREE.ArrowHelper(dir, originPos, len, colorHex, len * 0.22, len * 0.12);
	[arrow.line, arrow.cone].forEach(function (o) {
		o.material.depthTest = false; o.material.depthWrite = false;
		o.material.transparent = true; o.renderOrder = 12;
	});
	return arrow;
}
