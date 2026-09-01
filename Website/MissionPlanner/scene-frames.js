/* Mission Planner — Three.js frame factories.
 *
 * A "frame" here is one Three.js scene + camera + body placement for a system
 * the shell can show in a pane: "helio" (the whole solar system),
 * "body:Earth-Moon" (geocentric), or a generic "body:<name>" for any
 * HELIO_BODIES entry. Both mission-view.js and ephemeris-view.js build their
 * frames from here, so the Ephemeris tab and a mission tab show the identical
 * heliocentric scene rather than two forks of it.
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
	createBody, createSunBody, makePoint, makeSOIShell, soiRadiusAU, tiltBody,
	addLabel as brAddLabel
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

// The bodies drawn from a Sun-centred Kepler ellipse, each with its own orbit
// ring. Also the bodies a leg may be aimed AT: an arrival is judged against
// the destination's orbit ellipse (core/proximity.js), which is a thing only a
// body on this list has.
export var HELIO_BODIES = ["Mercury", "Venus", "Earth", "Mars", "Ceres", "Vesta", "Psyche",
	"Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

export var DESTINATION_BODIES = HELIO_BODIES;

// The bodies a mission may depart FROM. The Moon is one, and is not on the
// list above: it has no heliocentric ellipse, it is drawn from the lunar
// ephemeris, and it carries no orbit ring at solar-system scale because its
// true heliocentric path is a wobble narrower than Earth's own ring is wide.
// Departing it is still ordinary — Shared/frames.js's `escapeReferenceFor`
// says the SOI such a departure leaves is Earth's.
export var ORIGIN_BODIES = HELIO_BODIES.concat(["Moon"]);

// How far, in screen pixels, the Moon must be from Earth before it is drawn at
// all in the heliocentric frame. Below this it is not a body the camera can
// resolve, only a second dot on top of the first.
export var MOON_MIN_SEPARATION_PX = 15;

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

	// The Moon: a real body here because a mission can depart from it, but no
	// orbit ring and nothing on screen until the camera is close enough to
	// separate it from Earth. Its SOI is measured against Earth, the body it
	// actually orbits, not the Sun.
	var moonBody = createBody(scene, scaleList, "Moon", {
		sys: MOON, AU: AU, primaryMass: EARTH.mass });
	moonBody.nearOnly = { relativeTo: bodyGroups.Earth, minPx: MOON_MIN_SEPARATION_PX };
	bodyGroups.Moon = moonBody.group;
	brAddLabel(labelLayer, labelList, "Moon", moonBody.group, "mp-label", function () {
		return moonBody.core.visible || moonBody.point.visible;
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
		shortCaption: "Solar System",
		scene: scene, camera: camera,
		cam: createCam(6, 0.6, 1.1, new THREE.Vector3(0, 0, 0)),
		zoomMin: 1e-4, zoomMax: 500,
		metresPerUnit: AU,
		scaleList: scaleList, labelList: labelList, labelLayer: labelLayer,
		wantSOI: true,
		focusBody: null,
		focusChevron: null,
		pickMeshes: pickMeshes, pickSoiSpheres: pickSoiSpheres,
		bodyNode: function (name) { return name === "Sun" ? sunBody.group : (bodyGroups[name] || null); },
		place: function (jd) {
			HELIO_BODIES.forEach(function (name) {
				var s = O.bodyStateAtJD(GM_SUN, systems.get(name).orbit, jd);
				bodyGroups[name].position.set(s.r[0] / AU, s.r[1] / AU, s.r[2] / AU);
			});
			// The Moon rides Earth: its real geocentric offset, in scene units.
			var mg = LE.moonVector(jd);                       // km, geocentric
			bodyGroups.Moon.position.copy(bodyGroups.Earth.position)
				.add(new THREE.Vector3(mg[0] * 1e3 / AU, mg[1] * 1e3 / AU, mg[2] * 1e3 / AU));
			if (this.focusBody && bodyGroups[this.focusBody]) {
				this.cam.target.copy(bodyGroups[this.focusBody].position);
			}
		}
	};
}

// Generic body-local frame: one hero sphere for `name` (a HELIO_BODIES entry)
// at the scene origin, lit by a directional light pointed at the true Sun
// direction for that body/date. Serves both ends of a mission — the origin
// frame for a non-Earth departure and the destination frame for any arrival.
// Deliberately thinner than buildEarthMoonFrame: there is no real satellite to
// place (Phobos and friends are orbit-radius sources only, never true ephemeris
// bodies here). A skyhook module draws its own orbit ring, standing in for the
// "moon" ring the Earth-Moon frame draws itself.
//
// Orientation context, so the body never sits isolated in space: a visible Sun
// marker + label along the true Sun direction, and the local stretch of the
// body's OWN heliocentric orbit drawn through the origin (its position at
// nearby dates relative to its position now, rebuilt as the clock moves) — so
// the pane always shows which way the Sun lies and which way the body is
// travelling.
export function buildBodyFrame(name) {
	var sys = systems.get(name);
	var scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0d111c);
	// Far plane must reach the Sun's true distance (up to ~49 AU out, for a
	// Pluto aphelion) now that the Sun marker sits at its real position rather
	// than a compressed stand-in. planner.js's renderer runs a logarithmic
	// depth buffer, which is what keeps that huge near/far ratio from
	// z-fighting the close-in body geometry.
	var camFar = Math.max(400000, sys.orbit.apoapsis / U * 1.2);
	var camera = new THREE.PerspectiveCamera(45, 1, 0.05, camFar);
	scene.add(new THREE.AmbientLight(0x556070, 0.55));
	var sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
	scene.add(sunLight);

	// Scaled off the body's own radius, not hardcoded, since HELIO_BODIES
	// spans Ceres (radiusU ~0.5) to Jupiter (radiusU ~70) — the same ratios
	// Earth-Moon (radiusU 6.4, cam 60, zoomMin 2, zoomMax 30000) and the
	// Mars-Phobos plotter (radiusU 3.4, cam 35) already use, generalized.
	var radiusU = sys.radius / U;
	var camDist = Math.max(20, radiusU * 15);
	var zoomMin = Math.max(0.5, radiusU * 0.3);
	var zoomMax = Math.max(20000, radiusU * 3000);

	// The star sphere must sit well outside zoomMax, or fully zooming out (a
	// Jupiter/Saturn-sized zoomMax exceeds the 120000 floor) puts the
	// camera past the near side of the star shell, which then renders in
	// front of the body it's supposed to be a backdrop for.
	scene.add(makeStars(Math.max(120000, zoomMax * 1.5), 900));

	var scaleList = [], labelList = [];
	var labelLayer = makeLabelLayer();

	var heroGroup = new THREE.Group();
	var col = new THREE.Color(sys.color || "#9aa3b5");
	var heroCore = new THREE.Mesh(
		new THREE.SphereGeometry(radiusU, 32, 24),
		new THREE.MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.3), roughness: 0.85 }));
	tiltBody(heroCore, radiusU, sys, col.clone().lerp(new THREE.Color(0xffffff), 0.6).getHex());
	var heroPoint = makePoint(col.clone().lerp(new THREE.Color(0xffffff), 0.45).getHex(), 2.5);
	// The body's own SOI (relative to the Sun, same formula the heliocentric
	// frame uses) — a back-face shell since the camera routinely sits well
	// inside it at this "hero body" scale (see body-renderer.js's makeSOIShell).
	var heroSoiAU = soiRadiusAU(sys, SUN.mass, U);
	var heroSoi = makeSOIShell(heroSoiAU, col.getHex(), 0.08);
	heroGroup.add(heroCore); heroGroup.add(heroPoint); heroGroup.add(heroSoi);
	scene.add(heroGroup);
	brAddLabel(labelLayer, labelList, name, heroGroup, "mp-label");
	scaleList.push({ name: name, group: heroGroup, core: heroCore, soi: heroSoi,
	                 point: heroPoint, radiusAU: radiusU, soiAU: heroSoiAU });

	// The Sun itself, at true scale and true position — this body's own
	// heliocentric state gives both direction and distance, so it reads as
	// the real Sun rather than a compressed stand-in. Pushed onto the same
	// scaleList as the hero body, so updateScales collapses it to a bright
	// point once its true angular size drops below a pixel or two, exactly
	// like every other body here (and like buildHelioFrame's own Sun).
	var sunBody = createSunBody(scene, scaleList, { sys: SUN, AU: U });
	var sunMark = sunBody.group;
	brAddLabel(labelLayer, labelList, "Sun", sunMark, "mp-label");

	// The local stretch of the body's own heliocentric orbit, drawn relative
	// to its position at the current date (so it passes through the origin);
	// rebuilt when the clock has moved more than half a day — the same
	// pattern as the Earth-Moon frame's Moon ring.
	var aHelio = isFinite(sys.orbit.semiMajor) ? sys.orbit.semiMajor
		: (sys.orbit.apoapsis + sys.orbit.periapsis) / 2;
	var periodDays = 2 * Math.PI * Math.sqrt(Math.pow(aHelio, 3) / GM_SUN) / 86400;
	var spanDays = periodDays * 0.08;   // ±4% of the orbit, plenty to read curvature
	var arcLine = null, arcJd = null;
	function rebuildOrbitArc(jd) {
		if (arcLine !== null && Math.abs(jd - arcJd) < 0.5) { return; }
		if (arcLine) {
			scene.remove(arcLine);
			arcLine.geometry.dispose(); arcLine.material.dispose();
		}
		var here = O.bodyStateAtJD(GM_SUN, sys.orbit, jd).r;
		var pts = [], N = 96;
		for (var k = 0; k <= N; k++) {
			var r = O.bodyStateAtJD(GM_SUN, sys.orbit, jd - spanDays / 2 + spanDays * k / N).r;
			pts.push(new THREE.Vector3((r[0] - here[0]) / U, (r[1] - here[1]) / U, (r[2] - here[2]) / U));
		}
		arcLine = makeArcLine(pts, 0x3a4763, 0.55);
		scene.add(arcLine);
		arcJd = jd;
	}

	return {
		id: "body:" + name,
		caption: name.toUpperCase() + " SYSTEM · " + name + "-centric ecliptic",
		shortCaption: name + " System",
		scene: scene, camera: camera,
		cam: createCam(camDist, 0.7, 1.05, new THREE.Vector3(0, 0, 0)),
		zoomMin: zoomMin, zoomMax: zoomMax,
		metresPerUnit: U,
		scaleList: scaleList, labelList: labelList, labelLayer: labelLayer,
		wantSOI: true,
		focusBody: name,
		focusChevron: null,
		pickMeshes: [heroCore],
		pickSoiSpheres: [],
		bodyNode: function (bodyName) { return bodyName === name ? heroGroup : null; },
		place: function (jd) {
			var s = O.bodyStateAtJD(GM_SUN, sys.orbit, jd);
			var mag = Math.sqrt(s.r[0] * s.r[0] + s.r[1] * s.r[1] + s.r[2] * s.r[2]) || 1;
			sunLight.position.set(-s.r[0] / mag * 50000, -s.r[1] / mag * 50000, -s.r[2] / mag * 50000);
			sunMark.position.set(-s.r[0] / U, -s.r[1] / U, -s.r[2] / U);
			rebuildOrbitArc(jd);
			if (this.focusBody === name) { this.cam.target.set(0, 0, 0); }
		}
	};
}

export function buildEarthMoonFrame() {
	var scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0d111c);
	// Same true-distance-Sun-marker rationale as buildBodyFrame; Earth's own
	// aphelion sets the floor (see that function's comment for the
	// logarithmic-depth-buffer note).
	var camFar = Math.max(400000, EARTH.orbit.apoapsis / U * 1.2);
	var camera = new THREE.PerspectiveCamera(45, 1, 0.05, camFar);
	scene.add(new THREE.AmbientLight(0x556070, 0.55));
	var sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
	scene.add(sunLight);
	scene.add(makeStars(120000, 900));

	var scaleList = [], labelList = [];
	var labelLayer = makeLabelLayer();

	// Hero bodies, untextured — the standalone plotters' textured Earth/Moon
	// stay calculator-specific; the planner only needs recognisable spheres.
	var earthGroup = new THREE.Group();
	var earthCore = new THREE.Mesh(
		new THREE.SphereGeometry(EARTH.radius / U, 32, 24),
		new THREE.MeshStandardMaterial({ color: 0x3b6ea8, emissive: 0x0e1c30, roughness: 0.8 }));
	tiltBody(earthCore, EARTH.radius / U, EARTH, 0x9fc4ef);
	var earthPoint = makePoint(0x9fc4ef, 2.5);
	// Earth's own SOI relative to the Sun — same back-face-shell treatment as
	// buildBodyFrame's hero body, since the Moon's orbit sits well inside it.
	var earthSoiAU = soiRadiusAU(EARTH, SUN.mass, U);
	var earthSoi = makeSOIShell(earthSoiAU, 0x9fc4ef, 0.06);
	earthGroup.add(earthCore); earthGroup.add(earthPoint); earthGroup.add(earthSoi);
	scene.add(earthGroup);
	brAddLabel(labelLayer, labelList, "Earth", earthGroup, "mp-label");
	scaleList.push({ name: "Earth", group: earthGroup, core: earthCore, soi: earthSoi,
	                 point: earthPoint, radiusAU: EARTH.radius / U, soiAU: earthSoiAU });

	// The Sun itself, at true scale and true position (same treatment as
	// buildBodyFrame's) — on the same scaleList as Earth and the Moon, so it
	// collapses to a bright point once too small to read as a disc.
	var sunBody = createSunBody(scene, scaleList, { sys: SUN, AU: U });
	var sunMark = sunBody.group;
	brAddLabel(labelLayer, labelList, "Sun", sunMark, "mp-label");

	var moonNode = new THREE.Group();
	var moonCore = new THREE.Mesh(
		new THREE.SphereGeometry(MOON.radius / U, 24, 18),
		new THREE.MeshStandardMaterial({ color: 0x9aa3b5, emissive: 0x14161c, roughness: 0.95 }));
	tiltBody(moonCore, MOON.radius / U, MOON, 0xd8dde8);
	var moonPoint = makePoint(0xd8dde8, 2.5);
	// The Moon's own SOI, but relative to EARTH (its orbit.system), not the
	// Sun — the boundary a departing/arriving ship actually crosses near it.
	var moonSoiAU = soiRadiusAU(MOON, EARTH.mass, U);
	var moonSoi = makeSOIShell(moonSoiAU, 0xd8dde8, 0.1);
	moonNode.add(moonCore); moonNode.add(moonPoint); moonNode.add(moonSoi);
	scene.add(moonNode);
	brAddLabel(labelLayer, labelList, "Moon", moonNode, "mp-label");
	scaleList.push({ name: "Moon", group: moonNode, core: moonCore, soi: moonSoi,
	                 point: moonPoint, radiusAU: MOON.radius / U, soiAU: moonSoiAU });

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

	// The local stretch of Earth's own heliocentric orbit, drawn relative to
	// Earth's current position — the same technique buildBodyFrame's
	// rebuildOrbitArc uses for every other origin/destination body, missing
	// here until now because Earth's frame otherwise only draws the
	// geocentric Moon ring.
	var aHelioEarth = isFinite(EARTH.orbit.semiMajor) ? EARTH.orbit.semiMajor
		: (EARTH.orbit.apoapsis + EARTH.orbit.periapsis) / 2;
	var periodDaysEarth = 2 * Math.PI * Math.sqrt(Math.pow(aHelioEarth, 3) / GM_SUN) / 86400;
	var spanDaysEarth = periodDaysEarth * 0.08;
	var helioArcLine = null, helioArcJd = null;
	function rebuildHelioArc(jd) {
		if (helioArcLine !== null && Math.abs(jd - helioArcJd) < 0.5) { return; }
		if (helioArcLine) {
			scene.remove(helioArcLine);
			helioArcLine.geometry.dispose(); helioArcLine.material.dispose();
		}
		var here = O.bodyStateAtJD(GM_SUN, EARTH.orbit, jd).r;
		var pts = [], N = 96;
		for (var k = 0; k <= N; k++) {
			var r = O.bodyStateAtJD(GM_SUN, EARTH.orbit, jd - spanDaysEarth / 2 + spanDaysEarth * k / N).r;
			pts.push(new THREE.Vector3((r[0] - here[0]) / U, (r[1] - here[1]) / U, (r[2] - here[2]) / U));
		}
		helioArcLine = makeArcLine(pts, 0x3a4763, 0.55);
		scene.add(helioArcLine);
		helioArcJd = jd;
	}

	return {
		id: "body:Earth-Moon",
		caption: "EARTH–MOON SYSTEM · geocentric ecliptic",
		shortCaption: "Earth–Moon System",
		scene: scene, camera: camera,
		cam: createCam(60, 0.7, 1.05, new THREE.Vector3(0, 0, 0)),
		zoomMin: 2, zoomMax: 30000,
		metresPerUnit: U,
		scaleList: scaleList, labelList: labelList, labelLayer: labelLayer,
		wantSOI: true,
		focusBody: "Moon",   // keeps the skyhook in view as the date moves; pan releases
		focusChevron: null,
		pickMeshes: [earthCore, moonCore],
		pickSoiSpheres: [{ center: moonNode.position, radius: 40, nearFaceRadius: MOON.radius / U }],
		bodyNode: function (name) {
			return name === "Moon" ? moonNode : (name === "Earth" ? earthGroup : null);
		},
		place: function (jd) {
			var r = LE.moonVector(jd);
			moonNode.position.set(r[0] * 1e3 / U, r[1] * 1e3 / U, r[2] * 1e3 / U);
			var s = LE.sunDirection(jd);
			var sv = LE.sunVector(jd);   // km, Earth -> Sun, true direction AND distance
			sunLight.position.set(s[0] * 50000, s[1] * 50000, s[2] * 50000);
			sunMark.position.set(sv[0] * 1e3 / U, sv[1] * 1e3 / U, sv[2] * 1e3 / U);
			rebuildRing(jd);
			rebuildHelioArc(jd);
			if (this.focusBody === "Moon") { this.cam.target.copy(moonNode.position); }
			else if (this.focusBody === "Earth") { this.cam.target.set(0, 0, 0); }
		}
	};
}
