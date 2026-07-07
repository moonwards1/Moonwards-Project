/* Shared/sim/approach-markers.js
 *
 * The two proximity-ring markers that flag "the ship's path is about to pass
 * near something" (see Website/ARCHITECTURE.md, "Step 1: scene kit"):
 *
 * - An orbit-proximity ring, dropped where a trajectory passes close to
 *   another body's orbital *path* (regardless of whether that body is
 *   actually there at the time) — currently only the Solar-System-
 *   Trajectory-Plotter builds these (`APPROACH_TIERS`/`orbitApproachMarks`),
 *   but the rendering pieces (a hollow camera-facing ring that holds a
 *   constant on-screen size until the camera is close enough for its true
 *   physical size to read larger) are pulled out here now rather than left
 *   inline, so the Mars-Phobos/Moon-Skyhook plotters (or the eventual
 *   MissionPlanner shell) can grow the same feature without reinventing it.
 * - A temporal-proximity ring around the ship marker, coloured/sized by how
 *   close (in days) the destination body is to the ship's position at
 *   arrival — byte-identical between the Solar-System-Trajectory-Plotter and
 *   the Mars-Phobos plotter's heliocentric overlay (down to the tier table's
 *   literal colour values). The Moon-Skyhook plotter doesn't have this
 *   feature at all, so it isn't touched by this module.
 *
 * Both rings are the SAME underlying sprite (a canvas-drawn ring texture,
 * cached by stroke width) with different tier tables driving colour/opacity/
 * size — the tier tables themselves (what counts as "far"/"near"/"close",
 * and what each tier looks like) stay in each calculator as plain data,
 * since they differ per tool (distance scale, colour choice). This module
 * only supplies the generic ring-sprite mechanics: build one, apply a tier
 * to it, and hold its on-screen size per frame.
 */
/* global THREE */

import { worldSizeAtPointForPx } from "./body-renderer.js";

// The ring is drawn at radius 24 on a 64x64 canvas -- 24/64 -- used to grow
// a ring sprite to its true physical size once the camera is close enough.
var RING_RADIUS_FRAC = 0.375;

var _ringTex = {};

// Canvas-drawn hollow-ring texture, cached by stroke width (pure geometry —
// one cache serves every tool/tier).
export function ringTexture(lineWidth) {
	if (_ringTex[lineWidth]) { return _ringTex[lineWidth]; }
	var cv = document.createElement("canvas");
	cv.width = cv.height = 64;
	var ctx = cv.getContext("2d");
	ctx.strokeStyle = "#ffffff"; ctx.lineWidth = lineWidth;
	ctx.beginPath(); ctx.arc(32, 32, 24, 0, 2 * Math.PI); ctx.stroke();
	var t = new THREE.CanvasTexture(cv);
	t.minFilter = THREE.LinearFilter;
	_ringTex[lineWidth] = t;
	return t;
}

// A camera-facing hollow-ring sprite.
// opts: lineWidth (required, stroke width fed to `ringTexture`), color/
//   opacity (optional — a tier can also be applied later via
//   `applyTierToSprite`, so a ring meant to be re-coloured per-frame, like a
//   temporal-proximity ring, can omit these and take the sprite-material
//   defaults), px (required — held on-screen size in CSS pixels while far),
//   worldR (optional, scene units — the true physical size this ring marks;
//   given, the ring GROWS to that size once close enough; omit for a ring
//   that should always hold constant px, like a temporal-proximity ring,
//   which doesn't mark a physical distance), renderOrder (optional,
//   default 13).
export function makeRingSprite(opts) {
	var matOpts = { map: ringTexture(opts.lineWidth), transparent: true, depthTest: false, depthWrite: false };
	var mat = new THREE.SpriteMaterial(matOpts);
	if (opts.color != null) { mat.color.setHex(opts.color); }
	if (opts.opacity != null) { mat.opacity = opts.opacity; }
	var sp = new THREE.Sprite(mat);
	sp.renderOrder = opts.renderOrder == null ? 13 : opts.renderOrder;
	sp.userData.px = opts.px;
	if (opts.worldR) { sp.userData.worldR = opts.worldR; }
	sp.scale.setScalar(0.01);
	return sp;
}

// Re-colour/resize an existing ring sprite to one tier of a tool's own tier
// table (e.g. `TEMPORAL_TIERS[tier]`, `{ color, opacity, px, worldR? }`) —
// for a persistent single ring (a temporal-proximity ring) whose tier
// changes live as the ship moves, unlike the orbit-approach rings, which are
// fully rebuilt from scratch on every recompute via fresh `makeRingSprite`
// calls instead.
export function applyTierToSprite(sprite, tier) {
	sprite.material.color.setHex(tier.color);
	sprite.material.opacity = tier.opacity;
	sprite.userData.px = tier.px;
	if (tier.worldR) { sprite.userData.worldR = tier.worldR; } else { delete sprite.userData.worldR; }
}

// Per-frame: hold a ring sprite at its `userData.px` on-screen size, growing
// to its true `userData.worldR` physical size (if set) once the camera is
// close enough for that to read larger than the fixed size would.
export function scaleApproachMark(camera, holderEl, sprite) {
	var sFixed = worldSizeAtPointForPx(camera, holderEl, sprite.position, sprite.userData.px || 16);
	var worldR = sprite.userData.worldR;
	sprite.scale.setScalar(worldR ? Math.max(sFixed, worldR / RING_RADIUS_FRAC) : sFixed);
}

// Map a proximity value (a distance or a time-to-closest-approach, any unit)
// to a 3-tier index by three ascending thresholds farThresh > nearThresh >
// closeThresh (same unit as `value`). Returns 2 (closest), 1, 0, or -1 if
// `value` is beyond `farThresh` — caller should hide/skip the marker then.
export function pickProximityTier(value, farThresh, nearThresh, closeThresh) {
	if (value >= farThresh) { return -1; }
	if (value < closeThresh) { return 2; }
	if (value < nearThresh) { return 1; }
	return 0;
}
