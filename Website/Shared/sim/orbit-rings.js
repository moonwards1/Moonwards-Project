/* Shared/sim/orbit-rings.js
 *
 * The two-tone (bright north / dim, cool-shifted south) orbit ring, split at
 * the line of nodes so the nodes themselves are visible as the colour change.
 *
 * Extracted from four call sites (see Website/ARCHITECTURE.md, "Step 1: scene
 * kit"), which turned out to be two genuinely different patterns plus one
 * unrelated one:
 *
 * - The "Kepler body" ring — a planet's fixed orbit, drawn from its
 *   Shared/orbit.js elements. Byte-identical across the
 *   Solar-System-Trajectory-Plotter's main scene and the Moon-Skyhook /
 *   Mars-Phobos plotters' heliocentric "Helio" overlays, right down to the
 *   near-ecliptic fallback (a single uniform ring when there's no meaningful
 *   node to show, e.g. Earth). That's `createKeplerOrbitRing` below — a
 *   straight lift, safe to reuse anywhere a Kepler-scale multi-body view is
 *   needed.
 * - The Moon-Skyhook plotter's OWN "Moon orbit" ring (Earth-Moon local view)
 *   is a related but distinct case: it re-derives osculating elements from
 *   the live ephemeris state every time it's rebuilt (`elementsFromState`,
 *   not a fixed `sys.orbit`), always draws two arcs (no near-ecliptic
 *   fallback — the Moon's ~5 deg inclination is never in that regime), and
 *   uses its own colours/opacities/segment count. It is NOT folded into
 *   `createKeplerOrbitRing` — a fake "handles everything" factory would just
 *   trade a real duplication for a pile of options only one caller uses.
 *   What it DOES share with the Kepler pattern: the actual ellipse-sampling
 *   loop (`sampleEllipseArc`) and the line-from-points helper (`makeArcLine`)
 *   below, since both walk true anomaly through
 *   `OrbitalMath.stateFromElements` and turn the result into a `THREE.Line`.
 * - The Mars-Phobos plotter's "Phobos orbit" ring is NOT an ellipse at all —
 *   Phobos is modelled as circular (see that file's header), so it's a plain
 *   circle sampled directly in the skyhook's own orbital-plane basis
 *   vectors, no `OrbitalMath` involved. Only `makeArcLine` applies there; the
 *   point sampling stays local, since it isn't an orbit-ring concern.
 */
/* global THREE */

import { OrbitalMath } from "../math-utils.js";

// A single-colour, single-opacity polyline through world/scene-space points
// — the common low-level piece under every "two-tone arc" ring below.
export function makeArcLine(points, colorHex, opacity) {
	return new THREE.Line(
		new THREE.BufferGeometry().setFromPoints(points),
		new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: opacity }));
}

// Sample N+1 points of a true-anomaly arc [nu0, nu0+span] of a Kepler
// ellipse, converted to scene units via `toUnits` (e.g. divide by AU, or a
// tool's own metres-to-view-units scale). Returns THREE.Vector3[].
export function sampleEllipseArc(GM, a, e, inc, Omega, omega, nu0, span, N, toUnits) {
	var pts = [];
	for (var k = 0; k <= N; k++) {
		var nu = nu0 + span * k / N;
		var s = OrbitalMath.stateFromElements(GM, a, e, inc, Omega, omega, nu);
		pts.push(new THREE.Vector3(toUnits(s.r[0]), toUnits(s.r[1]), toUnits(s.r[2])));
	}
	return pts;
}

// The two-tone orbit ring for a body on a fixed Kepler orbit (the pattern
// shared by the Solar-System-Trajectory-Plotter's main scene and the
// Moon-Skyhook/Mars-Phobos plotters' Helio overlays). Falls back to a single
// uniform ring for near-ecliptic orbits (inc < incEps), where the ascending/
// descending nodes aren't meaningfully distinct.
//
// opts: orbit (required — a Shared/orbit.js body's `.orbit` record: a, e,
//   inclination, longitude, argument), GM (required, the primary's GM),
//   color (required, a THREE.Color — the north arc's colour; the south arc
//   is this lerped 30% toward a cool blue), AU (required, metres per scene
//   unit), segments (optional, default 180 — samples per half-arc; the
//   near-ecliptic single ring uses segments*2), incEps (optional, default
//   0.5 degrees in radians).
// Returns a THREE.Group, NOT added to any scene — the caller adds it and
// tracks it (e.g. in its own name -> Group map), matching each plotter's
// existing wiring.
export function createKeplerOrbitRing(opts) {
	var o = opts.orbit, GM = opts.GM, col = opts.color, AU = opts.AU;
	var inc = o.inclination || 0;
	var seg = opts.segments || 180;
	var incEps = opts.incEps == null ? 0.5 * Math.PI / 180 : opts.incEps;
	var toUnits = function (m) { return m / AU; };
	var grp = new THREE.Group();

	if (inc < incEps) {
		grp.add(makeArcLine(
			sampleEllipseArc(GM, o.a, o.e, inc, o.longitude || 0, o.argument || 0, 0, 2 * Math.PI, seg * 2, toUnits),
			col, 0.32));
		return grp;
	}

	// Argument of latitude u = argument + nu; z = 0 at u = 0 (ascending) and
	// u = pi (descending). So the ascending node is at nu = -argument.
	var nuAsc = -(o.argument || 0);
	var southCol = col.clone().lerp(new THREE.Color(0x4a78ff), 0.3);
	grp.add(makeArcLine(
		sampleEllipseArc(GM, o.a, o.e, inc, o.longitude || 0, o.argument || 0, nuAsc, Math.PI, seg, toUnits),
		col, 0.6));
	grp.add(makeArcLine(
		sampleEllipseArc(GM, o.a, o.e, inc, o.longitude || 0, o.argument || 0, nuAsc + Math.PI, Math.PI, seg, toUnits),
		southCol, 0.3));
	return grp;
}
