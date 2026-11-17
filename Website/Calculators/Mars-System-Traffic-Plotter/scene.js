/* Mars-System-Traffic-Plotter/scene — the Three.js scene of the Mars system:
 * Mars with a latitude–longitude grid and arrows showing which way it turns,
 * Phobos, Deimos, their orbits, the areostationary ring, Mars's sphere of
 * influence, the Sun, and the stretch of Mars's own orbit round the Sun that
 * it is on.
 *
 * buildMarsScene() returns the scene, its camera and place(jd, viewId), which
 * puts everything where the clock has it, drawn in one of the views of
 * core/view-frames.js. Scene units are 1,000 km (U metres); +Z is up, which
 * the views make ecliptic north (Sun view), Mars's north pole (surface view)
 * or the pole of Phobos's orbit (Phobos view).
 *
 * Nothing here computes where a thing is: positions come from
 * Shared/mars-ephemeris.js through core/view-frames.js.
 */
/* global THREE */

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { MarsEphemeris as ME } from "../../Shared/mars-ephemeris.js";
import { createCam } from "../../Shared/sim/camera-controller.js";
import { makePoint, makeSOIShell, makeSpinArrows, createSunBody, addLabel } from "../../Shared/sim/body-renderer.js";
import { makeStars } from "../../MissionPlanner/scene-frames.js";
import { viewBasis, toView } from "./core/view-frames.js";

var O = OrbitalMath;
var DAY = 86400;
export var U = 1e6;                    // metres per scene unit

var MARS = systems.get("Mars"), SUN = systems.get("Sun");
export var R_MARS = +MARS.radius;
// Where a body in a circular orbit over the equator keeps pace with the ground.
export var R_STATIONARY = O.synchronousRadius(MARS.GM, 2 * Math.PI / ME.SIDEREAL_DAY);
export var SOI_MARS = O.sphereOfInfluence(MARS.orbit.semiMajor, MARS.mass, SUN.mass || SUN.GM / 6.6743e-11);

var COLOR = { mars: 0xb5522f, marsGlow: 0x2a120a, grid: 0xf0c9a8, prime: 0xffffff,
              phobos: 0xa89f94, deimos: 0xb8b0a2, orbit: 0x5d6f96, stationary: 0x3f8f86,
              sunOrbit: 0xc9a24a };
var RING_POINTS = 160;
// The stretch of Mars's orbit round the Sun that is drawn: this fraction of a
// Mars year, half behind Mars and half ahead.
var SUN_ORBIT_SHARE = 0.08, SUN_ORBIT_POINTS = 96;
var MARS_YEAR = 2 * Math.PI * Math.sqrt(Math.pow(MARS.orbit.semiMajor, 3) / SUN.GM);

function vec(p) { return new THREE.Vector3(p[0] / U, p[1] / U, p[2] / U); }

// A line through fixed points, in the units and axes of whatever it is added to.
function lineOf(points, colorHex, opacity) {
	return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
		new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: opacity, depthWrite: false }));
}

// A line whose points are set afresh at every date (an orbit as it now stands).
function movingLine(count, colorHex, opacity) {
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
	var line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: colorHex, transparent: true,
		opacity: opacity, depthWrite: false }));
	line.frustumCulled = false;
	return line;
}

// Mars's grid: parallels every 30 degrees and meridians every 30, the equator
// and the prime meridian brighter. Local axes: x through 0 N 0 E, z the pole.
function makeGrid(radius) {
	var g = new THREE.Group(), N = 96, k, lat, lon, pts;
	for (lat = -60; lat <= 60; lat += 30) {
		pts = [];
		var c = Math.cos(lat * Math.PI / 180), s = Math.sin(lat * Math.PI / 180);
		for (k = 0; k <= N; k++) {
			var a = 2 * Math.PI * k / N;
			pts.push(new THREE.Vector3(radius * c * Math.cos(a), radius * c * Math.sin(a), radius * s));
		}
		g.add(lineOf(pts, COLOR.grid, lat === 0 ? 0.6 : 0.22));
	}
	for (lon = 0; lon < 360; lon += 30) {
		pts = [];
		var cl = Math.cos(lon * Math.PI / 180), sl = Math.sin(lon * Math.PI / 180);
		for (k = 0; k <= N / 2; k++) {
			var b = -Math.PI / 2 + Math.PI * k / (N / 2);
			pts.push(new THREE.Vector3(radius * Math.cos(b) * cl, radius * Math.cos(b) * sl, radius * Math.sin(b)));
		}
		g.add(lineOf(pts, lon === 0 ? COLOR.prime : COLOR.grid, lon === 0 ? 0.85 : 0.22));
	}
	return g;
}

// Turn an object so its local x, y, z lie along three view-axis vectors.
var _m = new THREE.Matrix4();
function orient(obj, x, y, z) {
	_m.makeBasis(new THREE.Vector3(x[0], x[1], x[2]), new THREE.Vector3(y[0], y[1], y[2]),
		new THREE.Vector3(z[0], z[1], z[2]));
	obj.quaternion.setFromRotationMatrix(_m);
}

export function buildMarsScene() {
	var scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0d111c);
	var camera = new THREE.PerspectiveCamera(45, 1, 0.0005, 900000);
	scene.add(new THREE.AmbientLight(0x556070, 0.6));
	var sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
	scene.add(sunLight);
	var stars = makeStars(600000, 900);
	scene.add(stars);

	var scaleList = [], labelList = [];
	var labelLayer = document.createElement("div");
	labelLayer.className = "mst-labels";

	// ---- Mars ----
	var marsGroup = new THREE.Group();
	var marsTurn = new THREE.Group();          // turns with the ground
	var rU = R_MARS / U;
	var marsCore = new THREE.Mesh(new THREE.SphereGeometry(rU, 64, 48),
		new THREE.MeshStandardMaterial({ color: COLOR.mars, emissive: COLOR.marsGlow, roughness: 0.9 }));
	marsCore.rotation.x = Math.PI / 2;         // the sphere's own pole onto local z
	var grid = makeGrid(rU * 1.002);
	// Arrowheads on the equator, pointing the way the ground moves (eastward).
	var spinArrows = makeSpinArrows(rU, 0xffe9d6, 0.9, 6);
	marsTurn.add(marsCore); marsTurn.add(grid); marsTurn.add(spinArrows);
	var marsPoint = makePoint(0xf0a070, 2.5);
	var soi = makeSOIShell(SOI_MARS / U, 0xf0a070, 0.05);
	marsGroup.add(marsTurn); marsGroup.add(marsPoint); marsGroup.add(soi);
	scene.add(marsGroup);
	addLabel(labelLayer, labelList, "Mars", marsGroup, "mst-label");
	scaleList.push({ name: "Mars", group: marsGroup, core: marsTurn, soi: soi, point: marsPoint,
	                 radiusAU: rU, soiAU: SOI_MARS / U });

	// The areostationary ring, in Mars's equator.
	var statPts = [];
	for (var k = 0; k <= RING_POINTS; k++) {
		var a = 2 * Math.PI * k / RING_POINTS;
		statPts.push(new THREE.Vector3(R_STATIONARY / U * Math.cos(a), R_STATIONARY / U * Math.sin(a), 0));
	}
	var stationary = lineOf(statPts, COLOR.stationary, 0.55);
	scene.add(stationary);
	var statMark = new THREE.Object3D();
	stationary.add(statMark);
	statMark.position.set(R_STATIONARY / U, 0, 0);
	addLabel(labelLayer, labelList, "areostationary", statMark, "mst-label mst-label-dim",
		function () { return stationary.visible; });

	// ---- the moons ----
	var moons = {};
	[["Phobos", COLOR.phobos, systems.get("Phobos").axis], ["Deimos", COLOR.deimos, null]].forEach(function (m) {
		var name = m[0], sys = systems.get(name), r = +sys.radius / U;
		var group = new THREE.Group();
		var core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24),
			new THREE.MeshStandardMaterial({ color: m[1], emissive: 0x15130f, roughness: 0.95 }));
		// Phobos is drawn as its ellipsoid, long axis toward Mars; orbit.js gives its three diameters.
		if (m[2]) { core.scale.set(m[2][0] / 2 / U, m[2][1] / 2 / U, m[2][2] / 2 / U); }
		else { core.scale.setScalar(r); }
		var point = makePoint(0xe6dfd2, 2.5);
		group.add(core); group.add(point);
		scene.add(group);
		addLabel(labelLayer, labelList, name, group, "mst-label");
		scaleList.push({ name: name, group: group, core: core, soi: null, point: point, radiusAU: r, soiAU: 0 });
		var ring = movingLine(RING_POINTS + 1, COLOR.orbit, 0.75);
		scene.add(ring);
		moons[name] = { group: group, core: core, ring: ring, period: ME.moonFigures(name).period };
	});

	// ---- the Sun, at its true distance ----
	var sunBody = createSunBody(scene, scaleList, { sys: SUN, AU: U });
	addLabel(labelLayer, labelList, "Sun", sunBody.group, "mst-label");

	// Mars's path round the Sun, drawn through Mars: where its centre was and
	// will be, measured from where it is now.
	var sunOrbit = movingLine(SUN_ORBIT_POINTS + 1, COLOR.sunOrbit, 0.6);
	scene.add(sunOrbit);

	var show = { orbits: true, grid: true };

	return {
		scene: scene, camera: camera,
		cam: createCam(160, 0.9, 1.0, new THREE.Vector3(0, 0, 0)),
		scaleList: scaleList, labelList: labelList, labelLayer: labelLayer,
		pickMeshes: [marsCore, moons.Phobos.core, moons.Deimos.core],
		// World position of a body the camera can follow.
		bodyPosition: function (name) {
			return name === "Mars" ? marsGroup.position : (moons[name] ? moons[name].group.position : null);
		},
		bodyRadius: function (name) { return +systems.get(name).radius / U; },
		setShown: function (what) {
			Object.assign(show, what);
			grid.visible = show.grid;
			stationary.visible = show.orbits;
			sunOrbit.visible = show.orbits;
			Object.keys(moons).forEach(function (n) { moons[n].ring.visible = show.orbits; });
		},
		// Put everything where it is at Julian date jd, in the view `viewId`.
		place: function (jd, viewId) {
			var B = viewBasis(viewId, jd);
			function view(r) { return toView(B, r); }
			var o = ME.orientation(jd);
			var pole = view(o.pole);
			orient(marsTurn, view(o.meridian), view(o.east), pole);
			orient(stationary, view(o.meridian), view(o.east), pole);
			// The stars and the Sun's own globe turn with the ecliptic axes.
			var ex = view([1, 0, 0]), ey = view([0, 1, 0]), ez = view([0, 0, 1]);
			orient(stars, ex, ey, ez);
			orient(sunBody.group, ex, ey, ez);

			Object.keys(moons).forEach(function (name) {
				var m = moons[name], s = ME.moonState(name, jd);
				m.group.position.copy(vec(view(s.r)));
				var toMars = O.vUnit(O.vScale(s.r, -1));
				orient(m.core, view(toMars), view(O.vCross(s.normal, toMars)), view(s.normal));
				// Its orbit as it stands now: one period, centred on this instant,
				// all of it drawn in this instant's axes.
				var pos = m.ring.geometry.attributes.position;
				for (var k = 0; k <= RING_POINTS; k++) {
					var p = view(ME.moonState(name, jd + (k / RING_POINTS - 0.5) * m.period / DAY).r);
					pos.setXYZ(k, p[0] / U, p[1] / U, p[2] / U);
				}
				pos.needsUpdate = true;
			});

			var here = ME.sunVector(jd), path = sunOrbit.geometry.attributes.position;
			for (var q = 0; q <= SUN_ORBIT_POINTS; q++) {
				var when = jd + (q / SUN_ORBIT_POINTS - 0.5) * SUN_ORBIT_SHARE * MARS_YEAR / DAY;
				// Mars's centre then, from its centre now: the Sun's offset now less its offset then.
				var c = view(O.vSub(here, ME.sunVector(when)));
				path.setXYZ(q, c[0] / U, c[1] / U, c[2] / U);
			}
			path.needsUpdate = true;

			var sun = view(here), d = O.vMag(sun);
			sunBody.group.position.copy(vec(sun));
			sunLight.position.set(sun[0] / d * 5e4, sun[1] / d * 5e4, sun[2] / d * 5e4);
		}
	};
}
