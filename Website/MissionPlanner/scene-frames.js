/* Mission Planner — Three.js frame factories.
 *
 * Extracted from mission-view.js by task D1 so the Ephemeris tab (its own
 * view, ephemeris-view.js) can build the exact same heliocentric frame a
 * mission view uses, rather than forking the scene-building code. A "frame"
 * here is one Three.js scene + camera + body placement for a system the
 * shell can show in a pane — "helio" (the whole solar system) or
 * "body:Earth-Moon" (geocentric).
 *
 * Not to be confused with Shared/frames.js, which is heliocentric <->
 * body-relative COORDINATE patching for ship-state packets — this file
 * builds the renderable scene; that one converts vectors.
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { systems } from "../Shared/orbit.js";
import { OrbitalMath } from "../Shared/math-utils.js";
import { LunarEphemeris } from "../Shared/lunar-ephemeris.js";
import { createCam } from "../Shared/sim/camera-controller.js";
import {
	createBody, createSunBody, makePoint, addLabel as brAddLabel
} from "../Shared/sim/body-renderer.js";
import { createKeplerOrbitRing, makeArcLine } from "../Shared/sim/orbit-rings.js";

var O = OrbitalMath;
var LE = LunarEphemeris;
export var AU = 149597870700;     // m per helio scene unit
export var U = 1e6;               // m per Earth-Moon scene unit (1000 km)
var SUN = systems.get("Sun");
var EARTH = systems.get("Earth");
var MOON = systems.get("Moon");
var GM_SUN = SUN.GM;

// Exported so callers building an origin/destination select (task D2) offer
// exactly the bodies buildHelioFrame() actually draws — a body missing from
// the frame has no bodyNode()/gizmo home to hang a leg off of.
export var HELIO_BODIES = ["Mercury", "Venus", "Earth", "Mars", "Ceres", "Vesta", "Psyche",
	"Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

export function makeStars(radius, count) {
	var g = new THREE.BufferGeometry();
	var arr = new Float32Array(count * 3);
	for (var i = 0; i < count; i++) {
		var u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
		var s = Math.sqrt(1 - u * u);
		arr[i * 3] = radius * s * Math.cos(a);
		arr[i * 3 + 1] = radius * s * Math.sin(a);
		arr[i * 3 + 2] = radius * u;
	}
	g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
	return new THREE.Points(g, new THREE.PointsMaterial({
		color: 0x666f86, size: 1.5, sizeAttenuation: false }));
}

export function makeLabelLayer() {
	var el = document.createElement("div");
	el.className = "mp-labels";
	return el;
}

// GPU cleanup for a view's dispose(): frames are owned per-caller, so their
// geometries, materials and texture maps go with them.
export function disposeScene(scene) {
	scene.traverse(function (obj) {
		if (obj.geometry) { obj.geometry.dispose(); }
		var mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
		mats.forEach(function (m) {
			if (m.map && m.map.dispose) { m.map.dispose(); }
			if (m.dispose) { m.dispose(); }
		});
	});
}

export function buildHelioFrame() {
	var scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0d111c);
	var camera = new THREE.PerspectiveCamera(45, 1, 1e-5, 5000);
	scene.add(new THREE.AmbientLight(0x556070, 0.6));
	scene.add(new THREE.PointLight(0xffffff, 1.4, 0, 0));
	scene.add(makeStars(800, 1200));

	var scaleList = [], labelList = [];
	var labelLayer = makeLabelLayer();
	var bodyGroups = {};
	var pickMeshes = [], pickSoiSpheres = [];

	var sunBody = createSunBody(scene, scaleList, { sys: SUN, AU: AU });
	brAddLabel(labelLayer, labelList, "Sun", sunBody.group, "mp-label");

	HELIO_BODIES.forEach(function (name) {
		var sys = systems.get(name);
		var b = createBody(scene, scaleList, name, { sys: sys, AU: AU, primaryMass: SUN.mass });
		bodyGroups[name] = b.group;
		brAddLabel(labelLayer, labelList, name, b.group, "mp-label");
		scene.add(createKeplerOrbitRing({
			orbit: sys.orbit, GM: GM_SUN, color: new THREE.Color(sys.color || "#bcc3d0"), AU: AU }));
	});
	scaleList.forEach(function (b) {
		pickMeshes.push(b.core);
		if (b.soiAU > 0) {
			pickSoiSpheres.push({ center: b.group.position, radius: b.soiAU, nearFaceRadius: b.radiusAU });
		}
	});

	return {
		id: "helio",
		caption: "SOLAR SYSTEM · heliocentric J2000 ecliptic",
		scene: scene, camera: camera,
		cam: createCam(6, 0.6, 1.1, new THREE.Vector3(0, 0, 0)),
		zoomMin: 1e-4, zoomMax: 500,
		metresPerUnit: AU,
		scaleList: scaleList, labelList: labelList, labelLayer: labelLayer,
		wantSOI: true,
		focusBody: null,
		pickMeshes: pickMeshes, pickSoiSpheres: pickSoiSpheres,
		bodyNode: function (name) { return bodyGroups[name] || null; },
		place: function (jd) {
			HELIO_BODIES.forEach(function (name) {
				var s = O.bodyStateAtJD(GM_SUN, systems.get(name).orbit, jd);
				bodyGroups[name].position.set(s.r[0] / AU, s.r[1] / AU, s.r[2] / AU);
			});
			if (this.focusBody && bodyGroups[this.focusBody]) {
				this.cam.target.copy(bodyGroups[this.focusBody].position);
			}
		}
	};
}

export function buildEarthMoonFrame() {
	var scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0d111c);
	var camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400000);
	scene.add(new THREE.AmbientLight(0x556070, 0.55));
	var sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
	scene.add(sunLight);
	scene.add(makeStars(120000, 900));

	var scaleList = [], labelList = [];
	var labelLayer = makeLabelLayer();

	// Hero bodies, untextured — the plotters' textured Earth/Moon stay
	// calculator-specific; the scaffold only needs recognisable spheres.
	var earthGroup = new THREE.Group();
	var earthCore = new THREE.Mesh(
		new THREE.SphereGeometry(EARTH.radius / U, 32, 24),
		new THREE.MeshStandardMaterial({ color: 0x3b6ea8, emissive: 0x0e1c30, roughness: 0.8 }));
	var earthPoint = makePoint(0x9fc4ef, 2.5);
	earthGroup.add(earthCore); earthGroup.add(earthPoint);
	scene.add(earthGroup);
	brAddLabel(labelLayer, labelList, "Earth", earthGroup, "mp-label");
	scaleList.push({ name: "Earth", group: earthGroup, core: earthCore, soi: null,
	                 point: earthPoint, radiusAU: EARTH.radius / U, soiAU: 0 });

	var moonNode = new THREE.Group();
	var moonCore = new THREE.Mesh(
		new THREE.SphereGeometry(MOON.radius / U, 24, 18),
		new THREE.MeshStandardMaterial({ color: 0x9aa3b5, emissive: 0x14161c, roughness: 0.95 }));
	var moonPoint = makePoint(0xd8dde8, 2.5);
	moonNode.add(moonCore); moonNode.add(moonPoint);
	scene.add(moonNode);
	brAddLabel(labelLayer, labelList, "Moon", moonNode, "mp-label");
	scaleList.push({ name: "Moon", group: moonNode, core: moonCore, soi: null,
	                 point: moonPoint, radiusAU: MOON.radius / U, soiAU: 0 });

	// Geocentric Moon orbit, sampled from the real ephemeris around the
	// current date; rebuilt when the clock has moved more than half a day.
	var ringLine = null, ringJd = null;
	function rebuildRing(jd) {
		if (ringLine !== null && Math.abs(jd - ringJd) < 0.5) { return; }
		if (ringLine) {
			scene.remove(ringLine);
			ringLine.geometry.dispose(); ringLine.material.dispose();
		}
		var pts = [], N = 96, T = 27.321661;
		for (var k = 0; k <= N; k++) {
			var r = LE.moonVector(jd - T / 2 + T * k / N);
			pts.push(new THREE.Vector3(r[0] * 1e3 / U, r[1] * 1e3 / U, r[2] * 1e3 / U));
		}
		ringLine = makeArcLine(pts, 0x3a4763, 0.55);
		scene.add(ringLine);
		ringJd = jd;
	}

	return {
		id: "body:Earth-Moon",
		caption: "EARTH–MOON SYSTEM · geocentric ecliptic",
		scene: scene, camera: camera,
		cam: createCam(60, 0.7, 1.05, new THREE.Vector3(0, 0, 0)),
		zoomMin: 2, zoomMax: 30000,
		metresPerUnit: U,
		scaleList: scaleList, labelList: labelList, labelLayer: labelLayer,
		wantSOI: false,
		focusBody: "Moon",   // keeps the skyhook in view as the date moves; pan releases
		pickMeshes: [earthCore, moonCore],
		pickSoiSpheres: [{ center: moonNode.position, radius: 40, nearFaceRadius: MOON.radius / U }],
		bodyNode: function (name) {
			return name === "Moon" ? moonNode : (name === "Earth" ? earthGroup : null);
		},
		place: function (jd) {
			var r = LE.moonVector(jd);
			moonNode.position.set(r[0] * 1e3 / U, r[1] * 1e3 / U, r[2] * 1e3 / U);
			var s = LE.sunDirection(jd);
			sunLight.position.set(s[0] * 50000, s[1] * 50000, s[2] * 50000);
			rebuildRing(jd);
			if (this.focusBody === "Moon") { this.cam.target.copy(moonNode.position); }
			else if (this.focusBody === "Earth") { this.cam.target.set(0, 0, 0); }
		}
	};
}
