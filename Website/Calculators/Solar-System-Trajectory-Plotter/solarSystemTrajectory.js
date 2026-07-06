/* Solar System Trajectory Plotter
 *
 * Top pane: Ephemeris date slider from 2030 to 2130, and a slider covering 
 * 30 days around the date on the top slider.
 * Left pane: a navigable 3D heliocentric view (Three.js) of the Sun and the
 * bodies, each marked by a semi-transparent sphere-of-influence shell, with
 * their orbits drawn. 
 * Right pane: pick a date and an origin body, set a
 * departure burn (prograde / radial / normal, km/s), and the resulting
 * heliocentric two-body arc is drawn in the left pane. 
 * Add up to two waypoints (each can carry
 * its own burn; downstream arcs recompute), and click the arc to drop a
 * slidable chevron marker that reads off radius, prograde speed and ecliptic
 * latitude at any point along the path. Once placed, an 'x' marker is placed on 
 * the orbit of the destination, showing how far the destination body will have 
 * moved during the time of flight of the ship represented by the chevron marker.
 *
 * ES module (loaded with <script type="module">); imports `systems` and
 * `OrbitalMath` from Shared/. Three.js is the one classic-script exception:
 * Shared/three.min.js is loaded before this module and provides the global
 * `THREE`.
 */
/* global THREE */

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";

(function () {
	"use strict";

	var O = OrbitalMath;
	var AU = 149597870700;                 // m
	var SUN = systems.get("Sun");
	var GM_SUN = SUN.GM;
	var SUN_MASS = SUN.mass;
	var DAY = 86400;

	// Bodies shown / selectable.
	var BODIES = ["Mercury", "Venus", "Earth", "Mars", "Ceres", "Vesta",
	              "Psyche", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

	// Slider epoch (day 0) and span.
	var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);     // 2030-01-01
	var SPAN_DAYS = 36525;                            // 100 Julian years

	// ---- application state -------------------------------------------------
	var state = {
		jd: JD0,
		baseDays: 0,                                   // coarse-slider position (days from JD0)
		origin: "Earth",
		destination: "Mars",                           // body whose orbit we plan to reach ("(none)" to disable)
		departure: { pro: 0, rad: 0, nrm: 0 },        // m/s
		waypoints: [],                                 // {tau (s), burn:{pro,rad,nrm}}
		focus: null,                                   // body the camera is locked onto
		marker: null,                                  // {f0, angle (deg), mode:"free"|"track"}
		markerFocused: false                           // camera locked onto the marker
	};

	// ---- DOM refs ----------------------------------------------------------
	var holder       = document.getElementById("sst-canvas-holder");
	var coarseSlider = document.getElementById("sst-date-coarse");
	var fineSlider   = document.getElementById("sst-date-fine");
	var fineLo       = document.getElementById("sst-fine-lo");
	var fineHi       = document.getElementById("sst-fine-hi");
	var dateField    = document.getElementById("sst-date-field");
	var jdLabel      = document.getElementById("sst-jd");
	var originSel   = document.getElementById("sst-origin");
	var originInfo  = document.getElementById("sst-origin-info");
	var destSel     = document.getElementById("sst-destination");
	var destInfo    = document.getElementById("sst-dest-info");
	var depVecHost  = document.getElementById("sst-departure-vectors");
	var depReadout  = document.getElementById("sst-departure-readout");
	var wpEmpty     = document.getElementById("sst-waypoints-empty");
	var wpList      = document.getElementById("sst-waypoint-list");
	var createWp1   = document.getElementById("sst-create-wp1");
	var createWp2   = document.getElementById("sst-create-wp2");
	var hudStatus   = document.getElementById("sst-hud-status");
	var resetBtn    = document.getElementById("sst-reset");
	var soiToggle   = document.getElementById("sst-show-soi");
	var orbitToggle = document.getElementById("sst-show-orbits");
	var burnVecToggle = document.getElementById("sst-show-burnvecs");
	var mainEl      = document.getElementById("sst-main");
	var panelEl     = document.getElementById("sst-panel");
	var readoutLayer = null;      // overlay holding the straddling burn readouts
	var readoutBoxes = [];        // { el, host } currently shown

	// =======================================================================
	//  THREE.js scene
	// =======================================================================
	var scene, camera, renderer, raycaster;
	var bodyGroups = {};          // name -> {group, core, soi, point}
	var orbitLines = {};          // name -> THREE.Group (two-tone arcs + node dots)
	var trajLine = null;          // current trajectory polyline
	var wpMarkers = [];           // THREE.Mesh for waypoints
	var burnArrows = [];          // THREE.ArrowHelper for dV / post-burn velocity
	var markerSprite = null;      // the slidable 'x' probe marker (THREE.Sprite)
	var markerCard = null;        // its top-left readout card (HTML)
	var orbitApproachMarks = [];  // hollow-ring sprites where the path nears a body's orbit
	var _ringTex = {};            // ring textures, keyed by outline width
	var APPROACH_FAR   = 0.004  * AU;   // m: a faint ring appears within this of a body's orbit
	var APPROACH_NEAR  = 0.001  * AU;   // m: brighter ring within this
	var APPROACH_CLOSE = 0.0002 * AU;   // m: brightest ring within this
	var markerSlider = null, markerValRad = null, markerValRadKm = null,
	    markerValSpd = null, markerValLat = null, markerValDeg = null,
	    markerValTof = null, markerValArr = null, markerValPhase = null;
	var markerModeBtns = {};      // "free"/"track"/"target" -> button el
	var markerBudgetInput = null, markerBudgetRow = null;   // Δv budget control (Target mode)
	var markerTdvRow = null, markerValTdv = null;           // target Δv readout row
	var markerVelDir = null;      // THREE.Vector3, marker's world velocity dir (ship heading)
	var destSprite = null;        // 'x' at the destination body's position at arrival
	var tempRing = null;          // temporal-proximity ring around the ship marker
	var trajSegs = [];            // per-segment start states { r0, v0, dur, tStart } (m, m/s, s)
	var trajTotalT = 0;           // total trajectory duration (s)
	var viewEl = null;            // the #sst-view pane (host for the marker card)

	// Temporal-proximity tiers: how close (in days) the destination body is to the
	// meeting point at the ship's arrival time. Distinct blue, brighter when closer.
	var TEMP_FAR = 30, TEMP_NEAR = 10, TEMP_CLOSE = 3;     // days
	var TEMPORAL_TIERS = [
		{ color: 0x3a6fd0, opacity: 0.50, px: 30 },   // 0: <30 d — faint blue
		{ color: 0x5aa9ff, opacity: 0.80, px: 34 },   // 1: <10 d — brighter
		{ color: 0x9fe0ff, opacity: 1.00, px: 40 }    // 2: <3 d  — bright cyan, largest
	];

	// Burn-vector arrows: a fixed physical scale (AU drawn per km/s) so the dV
	// arrow and the prograde-speed-change arrow are directly comparable in length.
	var BURN_VEC_SCALE = 0.03;
	var DV_COLOR = 0xff5fd0;      // delta-v (the burn itself)
	var DSPEED_COLOR = 0xffd24a;  // change in prograde (orbital) speed vs pre-burn
	var dvHex = "#ff5fd0";        // CSS form of DV_COLOR (pink) for the readouts
	var spdHex = "#ffd24a";       // CSS form of DSPEED_COLOR (amber) for the readouts
	var trajSamples = [];         // {pos: THREE.Vector3 (AU), t: seconds}
	var scaleList = [];           // bodies (incl. Sun) for per-frame size logic
	var labelList = [];           // {el, group} floating name labels
	var labelLayer = null;        // HTML overlay holding the labels
	var sunGroup = null;          // the Sun's group (not in bodyGroups)

	// camera spherical state around `target`
	var cam = { radius: 6, theta: 0.6, phi: 1.1, target: new THREE.Vector3(0, 0, 0) };

	// A body/SOI sphere is drawn only while its projected radius is at least a
	// pixel or two; below that it collapses to a single bright on-orbit pixel.
	var PX_BODY = 1.4;            // px: show the body sphere at/above this radius
	var PX_SOI  = 2.0;            // px: show the SOI shell at/above this radius

	function initScene() {
		scene = new THREE.Scene();

		camera = new THREE.PerspectiveCamera(45, 1, 1e-5, 5000);

		renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
		renderer.setPixelRatio(window.devicePixelRatio || 1);
		holder.appendChild(renderer.domElement);

		// HTML overlay carrying the floating name labels
		labelLayer = document.createElement("div");
		labelLayer.id = "sst-labels";
		holder.appendChild(labelLayer);

		raycaster = new THREE.Raycaster();

		scene.add(new THREE.AmbientLight(0x556070, 0.6));
		var sunLight = new THREE.PointLight(0xffffff, 1.4, 0, 0);
		scene.add(sunLight);

		// starfield backdrop
		scene.add(makeStars());

		// Sun (real radius; collapses to a bright pixel when far)
		var sunSys = systems.get("Sun");
		var sunRadAU = Number(sunSys.radius) / AU;
		var sunCore = new THREE.Mesh(
			new THREE.SphereGeometry(sunRadAU, 24, 18),
			new THREE.MeshBasicMaterial({ color: 0xffe066 }));
		var sunPoint = makePoint(0xfff2a0, 3);
		sunGroup = new THREE.Group();
		sunGroup.add(sunCore); sunGroup.add(sunPoint);
		scene.add(sunGroup);
		scaleList.push({ name: "Sun", group: sunGroup, core: sunCore, point: sunPoint,
		                 soi: null, radiusAU: sunRadAU, soiAU: 0 });
		addLabel("Sun", sunGroup);

		// bodies + orbits — everything at true scale
		BODIES.forEach(function (name) {
			var sys = systems.get(name);
			var col = new THREE.Color(sys.color || "#bcc3d0");
			var radAU = Number(sys.radius) / AU;

			var core = new THREE.Mesh(
				new THREE.SphereGeometry(radAU, 16, 12),
				new THREE.MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.3), roughness: 0.85 }));

			var soiAU = soiRadiusAU(sys);
			var soi = new THREE.Mesh(
				new THREE.SphereGeometry(soiAU, 24, 16),
				new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.10, depthWrite: false }));

			var point = makePoint(col.clone().lerp(new THREE.Color(0xffffff), 0.45).getHex(), 2.5);

			var g = new THREE.Group();
			g.add(core); g.add(soi); g.add(point);
			scene.add(g);
			bodyGroups[name] = { group: g, core: core, soi: soi, point: point };
			scaleList.push({ name: name, group: g, core: core, point: point,
			                 soi: soi, radiusAU: radAU, soiAU: soiAU });
			addLabel(name, g);

			var line = makeOrbitLine(sys, col);
			scene.add(line);
			orbitLines[name] = line;
		});

		resize();
		window.addEventListener("resize", resize);
		bindControls();
		animate();
	}

	function makeStars() {
		var g = new THREE.BufferGeometry();
		var n = 1200, arr = new Float32Array(n * 3);
		for (var i = 0; i < n; i++) {
			// random point on a large sphere
			var u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
			var s = Math.sqrt(1 - u * u);
			arr[i*3] = 800 * s * Math.cos(a);
			arr[i*3+1] = 800 * s * Math.sin(a);
			arr[i*3+2] = 800 * u;
		}
		g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
		return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x666f86, size: 1.5, sizeAttenuation: false }));
	}

	// True sphere-of-influence radius in AU (0 for the Sun).
	function soiRadiusAU(sys) {
		if (!sys.orbit) { return 0; }
		var m = sys.mass || (sys.GM / 6.6743e-11);
		return O.sphereOfInfluence(sys.orbit.a, m, SUN_MASS) / AU;
	}

	// A one-vertex Points object: a constant-size bright pixel at the group origin.
	function makePoint(colorHex, sizePx) {
		var g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
		return new THREE.Points(g, new THREE.PointsMaterial({
			color: colorHex, size: sizePx, sizeAttenuation: false,
			transparent: true, depthTest: false }));
	}

	// Create a floating HTML label tied to an object's world position.
	function addLabel(name, group) {
		var el = document.createElement("span");
		el.className = "sst-label";
		el.textContent = name;
		labelLayer.appendChild(el);
		labelList.push({ el: el, group: group });
	}

	function groupOf(name) {
		return name === "Sun" ? sunGroup : (bodyGroups[name] && bodyGroups[name].group);
	}

	// One axis of a waypoint gizmo: a line from the origin out along a unit
	// direction, drawn on top of everything else.
	function makeAxisLine(dir, colorHex) {
		var g = new THREE.BufferGeometry().setFromPoints(
			[new THREE.Vector3(0, 0, 0), new THREE.Vector3(dir[0], dir[1], dir[2])]);
		return new THREE.Line(g, new THREE.LineBasicMaterial({
			color: colorHex, depthTest: false, transparent: true }));
	}

	// A prograde / radial / normal gizmo at a waypoint, aligned to that point's
	// coast frame (the same frame the burn sliders act in — the ecliptic-anchored
	// frame from OrbitalMath.burnFrame, so the normal is a plane change vs the
	// ecliptic and holds steady through a flyby instead of swinging sunward).
	// Colours match the panel: prograde green, radial orange, normal blue. Held at
	// constant on-screen size by updateGizmos().
	function makeWaypointGizmo(point) {
		var f = O.burnFrame(point.r, point.v);
		var vhat = f.pro, nhat = f.nrm, rhat = f.rad;
		var g = new THREE.Group();
		g.add(makeAxisLine(vhat, 0x6fd49a));   // prograde
		g.add(makeAxisLine(rhat, 0xffb45a));   // radial
		g.add(makeAxisLine(nhat, 0x8ab4ff));   // normal
		g.position.set(point.r[0]/AU, point.r[1]/AU, point.r[2]/AU);
		g.renderOrder = 10;
		return g;
	}

	// Keep each waypoint gizmo ~42 px long regardless of zoom.
	function updateGizmos() {
		var h = holder.clientHeight || 1;
		var f = (h / 2) / Math.tan(camera.fov * Math.PI / 360);
		for (var i = 0; i < wpMarkers.length; i++) {
			var g = wpMarkers[i];
			var dist = camera.position.distanceTo(g.position) || 1e-9;
			g.scale.setScalar(42 * dist / f);
		}
		if (markerSprite && markerSprite.visible) {
			var md = camera.position.distanceTo(markerSprite.position) || 1e-9;
			markerSprite.scale.setScalar(26 * md / f);
			// point the ship along its screen-space heading
			if (markerVelDir) {
				var a3 = markerSprite.position.clone().project(camera);
				var b3 = markerSprite.position.clone().addScaledVector(markerVelDir, md * 0.01).project(camera);
				markerSprite.material.rotation = Math.atan2(b3.y - a3.y, b3.x - a3.x);
			}
		}
		if (destSprite && destSprite.visible) {
			var dd = camera.position.distanceTo(destSprite.position) || 1e-9;
			destSprite.scale.setScalar(22 * dd / f);
		}
		if (tempRing && tempRing.visible) {
			var td = camera.position.distanceTo(tempRing.position) || 1e-9;
			tempRing.scale.setScalar((tempRing.userData.px || 30) * td / f);
		}
		for (var j = 0; j < orbitApproachMarks.length; j++) {
			var rm = orbitApproachMarks[j];
			var rd = camera.position.distanceTo(rm.position) || 1e-9;
			// Hold a fixed on-screen size when far away; but once the view is close
			// enough that the tier's true distance projects larger than that fixed
			// size, grow the ring to its physical size (ring centre-line radius =
			// worldR AU, which is 0.375 of the sprite-quad width).
			var sFixed = (rm.userData.px || 16) * rd / f;
			var sPhys  = (rm.userData.worldR || 0) / 0.375;
			rm.scale.setScalar(Math.max(sFixed, sPhys));
		}
	}

	// Projected radius, in CSS pixels, of a sphere of world radius `worldR` seen
	// from distance `dist`.
	function screenPxRadius(worldR, dist) {
		var h = holder.clientHeight || 1;
		var f = (h / 2) / Math.tan(camera.fov * Math.PI / 360);   // px per radian
		return worldR / dist * f;
	}

	// Per-frame: show each body / SOI as a real sphere when big enough on screen,
	// otherwise collapse it to its bright pixel.
	function updateScales() {
		var wantSOI = soiToggle.checked;
		for (var i = 0; i < scaleList.length; i++) {
			var b = scaleList[i];
			var dist = camera.position.distanceTo(b.group.position) || 1e-9;
			var showCore = screenPxRadius(b.radiusAU, dist) >= PX_BODY;
			b.core.visible = showCore;
			b.point.visible = !showCore;
			if (b.soi) {
				b.soi.visible = wantSOI && screenPxRadius(b.soiAU, dist) >= PX_SOI;
			}
		}
	}

	// Per-frame: place each name label beside its body in screen space.
	var _lp = new THREE.Vector3();
	function updateLabels() {
		var w = holder.clientWidth, h = holder.clientHeight;
		for (var i = 0; i < labelList.length; i++) {
			var L = labelList[i];
			_lp.copy(L.group.position).project(camera);
			if (_lp.z < 1 && _lp.x > -1.06 && _lp.x < 1.06 && _lp.y > -1.06 && _lp.y < 1.06) {
				L.el.style.display = "block";
				L.el.style.left = ((_lp.x * 0.5 + 0.5) * w + 7) + "px";
				L.el.style.top  = ((-_lp.y * 0.5 + 0.5) * h) + "px";
			} else {
				L.el.style.display = "none";
			}
		}
	}

	// One full orbit of a body, drawn as two arcs split at the line of nodes
	// so the nodes are visible: the arc above the ecliptic (north, z >= 0) is
	// drawn bright, the arc below (south) dim. Small markers sit on each node.
	// (J2000 ecliptic, AU units.) Returns a Group; orbitLines[name].visible
	// toggles the whole thing.
	function makeOrbitLine(sys, col) {
		var o = sys.orbit;
		var inc = o.inclination || 0;
		var grp = new THREE.Group();

		// Sample an arc of true anomaly [nu0, nu0 + span] into Vector3 points.
		function arc(nu0, span, N) {
			var pts = [];
			for (var k = 0; k <= N; k++) {
				var nu = nu0 + span * k / N;
				var s = O.stateFromElements(GM_SUN, o.a, o.e, inc,
					o.longitude || 0, o.argument || 0, nu);
				pts.push(new THREE.Vector3(s.r[0] / AU, s.r[1] / AU, s.r[2] / AU));
			}
			return pts;
		}
		function lineFrom(pts, lineCol, opacity) {
			var g = new THREE.BufferGeometry().setFromPoints(pts);
			return new THREE.Line(g, new THREE.LineBasicMaterial({
				color: lineCol, transparent: true, opacity: opacity }));
		}

		// Orbits sensibly coplanar with the ecliptic (e.g. Earth) have no
		// meaningful nodes — draw a single uniform ring.
		if (inc < 0.5 * Math.PI / 180) {
			grp.add(lineFrom(arc(0, 2 * Math.PI, 360), col, 0.32));
			return grp;
		}

		// Argument of latitude u = argument + nu; z = 0 at u = 0 (ascending)
		// and u = pi (descending). So the ascending node is at nu = -argument.
		// The arcs swap brightness at the nodes, so the colour change marks them.
		var nuAsc = -(o.argument || 0);
		// South arc colour: the body colour nudged toward a cool blue so the
		// two halves read as distinct even at a glance.
		var southCol = col.clone().lerp(new THREE.Color(0x4a78ff), 0.3);
		// North arc (z >= 0): ascending -> descending. Drawn brighter.
		grp.add(lineFrom(arc(nuAsc, Math.PI, 180), col, 0.6));
		// South arc (z <= 0): descending -> ascending. Dimmer + colour-shifted.
		grp.add(lineFrom(arc(nuAsc + Math.PI, Math.PI, 180), southCol, 0.3));

		return grp;
	}

	// ---- camera controls (custom; OrbitControls isn't file://-safe) --------
	function updateCamera() {
		var r = cam.radius;
		var sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
		camera.position.set(
			cam.target.x + r * sp * Math.cos(cam.theta),
			cam.target.y + r * sp * Math.sin(cam.theta),
			cam.target.z + r * cp);
		camera.up.set(0, 0, 1);
		camera.lookAt(cam.target);
	}

	function bindControls() {
		var el = renderer.domElement;
		var dragging = null, lx = 0, ly = 0, moved = false, clickTimer = null;

		el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
		el.addEventListener("mousedown", function (e) {
			// A second press cancels a pending single-click pick, so a double-click
			// (which focuses a body) never also drops a waypoint.
			if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
			dragging = (e.button === 2 || e.shiftKey) ? "pan" : "rotate";
			lx = e.clientX; ly = e.clientY; moved = false;
		});
		window.addEventListener("mousemove", function (e) {
			if (!dragging) return;
			var dx = e.clientX - lx, dy = e.clientY - ly;
			lx = e.clientX; ly = e.clientY;
			if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
			if (dragging === "rotate") {
				cam.theta -= dx * 0.005;
				cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi - dy * 0.005));
			} else {
				var panScale = cam.radius * 0.0018;
				// pan in the camera's screen plane
				var right = new THREE.Vector3().crossVectors(
					new THREE.Vector3().subVectors(cam.target, camera.position), camera.up).normalize();
				var up = camera.up.clone();
				cam.target.addScaledVector(right, -dx * panScale);
				cam.target.addScaledVector(up,  dy * panScale);
				state.focus = null;        // free navigation releases a body lock
				state.markerFocused = false;
			}
		});
		window.addEventListener("mouseup", function (e) {
			if (dragging === "rotate" && !moved) {
				// defer the pick so a double-click (focus) can cancel it — the next
				// mousedown clears this timer, so a double-click adds no waypoint
				var ev = e;
				if (clickTimer) { clearTimeout(clickTimer); }
				clickTimer = setTimeout(function () { clickTimer = null; handlePick(ev); }, 350);
			}
			dragging = null;
		});
		el.addEventListener("dblclick", function (e) {
			if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
			focusNearest(e);
		});
		el.addEventListener("wheel", function (e) {
			e.preventDefault();
			var f = Math.exp(e.deltaY * 0.001);
			// while the marker is the focus, zoom straight toward it (stay centred)
			if (state.markerFocused && markerSprite && markerSprite.visible) {
				cam.radius = Math.max(1e-4, Math.min(500, cam.radius * f));
				cam.target.copy(markerSprite.position);
				return;
			}
			var P = cursorWorldAtTargetDepth(e);
			// scale the world about the point under the cursor, so that point
			// stays fixed on screen while the camera dollies in/out
			cam.target.set(
				P.x + (cam.target.x - P.x) * f,
				P.y + (cam.target.y - P.y) * f,
				P.z + (cam.target.z - P.z) * f);
			cam.radius = Math.max(1e-4, Math.min(500, cam.radius * f));
			state.focus = null;            // free navigation releases a body lock
		}, { passive: false });
	}

	// World point under the cursor, on the plane through the camera target that
	// faces the camera — the focus point for cursor-centred zoom.
	function cursorWorldAtTargetDepth(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		var ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
		var dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera)
			.sub(camera.position).normalize();
		var view = new THREE.Vector3().subVectors(cam.target, camera.position);
		var viewDir = view.clone().normalize();
		var denom = dir.dot(viewDir);
		if (Math.abs(denom) < 1e-6) { return cam.target.clone(); }
		return camera.position.clone().addScaledVector(dir, view.dot(viewDir) / denom);
	}

	// Double-click a body (or its pixel/label area) to lock the camera onto it.
	// The Sun recenters heliocentric; empty space just releases a lock (no jump).
	function focusNearest(e) {
		state.markerFocused = false;        // switching focus releases the marker lock
		var rect = renderer.domElement.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		var best = null, bestD = 24;
		for (var i = 0; i < scaleList.length; i++) {
			var v = scaleList[i].group.position.clone().project(camera);
			if (v.z > 1) { continue; }
			var sx = (v.x * 0.5 + 0.5) * rect.width, sy = (-v.y * 0.5 + 0.5) * rect.height;
			var d = Math.hypot(sx - px, sy - py);
			if (d < bestD) { bestD = d; best = scaleList[i]; }
		}
		if (!best) {
			// Empty space: don't snap or zoom anywhere. Only release an existing
			// body lock (which has no visual effect unless the date is animating).
			if (state.focus) { state.focus = null; setHud("Released — free navigation."); }
			return;
		}
		if (best.name === "Sun") {
			// Recenter heliocentric, keeping the current zoom (no jump).
			state.focus = null;
			cam.target.set(0, 0, 0);
			setHud("Centred on the Sun.");
			return;
		}
		state.focus = best.name;
		cam.target.copy(best.group.position);
		cam.radius = Math.max(best.soiAU * 4, best.radiusAU * 150, 5e-4);
		setHud("Focused on " + best.name + " — wheel to zoom; double-click the Sun or empty space to release.");
	}

	function resize() {
		var w = holder.clientWidth || 600, h = holder.clientHeight || 400;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}

	function animate() {
		requestAnimationFrame(animate);
		updateCamera();
		updateScales();
		updateGizmos();
		updateLabels();
		positionBurnReadouts();
		renderer.render(scene, camera);
	}

	// =======================================================================
	//  Body placement + trajectory
	// =======================================================================
	function placeBodies() {
		BODIES.forEach(function (name) {
			var s = O.bodyStateAtJD(GM_SUN, systems.get(name).orbit, state.jd);
			bodyGroups[name].group.position.set(s.r[0]/AU, s.r[1]/AU, s.r[2]/AU);
		});
		if (state.focus) {                          // keep a locked body centred as the date moves
			var g = groupOf(state.focus);
			if (g) { cam.target.copy(g.position); }
		}
	}

	// ---- waypoint "snap to" helpers ------------------------------------------
	// The apsis a leg's *burn* creates opposite the launch point: a net prograde
	// burn raises the far side to an apoapsis; a net retrograde burn lowers it to
	// a periapsis. With no prograde/retrograde element there is no such apsis
	// (available = false), so the apsis option is offered only when a burn made
	// one. `burn` is the burn that started this leg (departure, or the previous
	// waypoint's burn).
	function apsisFromBurn(burn) {
		var pro = burn ? burn.pro : 0;
		if (pro > 0) { return { label: "apoapsis",  nu: Math.PI, available: true }; }
		if (pro < 0) { return { label: "periapsis", nu: 0,       available: true }; }
		return { label: "apoapsis", nu: Math.PI, available: false };
	}
	// Node-like options for a leg's arc. For an inclined orbit these are the true
	// ascending/descending nodes; for a near-ecliptic leg (e.g. an Earth
	// departure with no plane change) nodes are meaningless, so substitute the
	// points 90 deg and 270 deg of true anomaly ahead of the launch point.
	var NODE_INCL_MIN = 0.1 * Math.PI / 180;
	function nodeInfo(r, v) {
		var el = O.elementsFromState(GM_SUN, r, v);
		if (el.i < NODE_INCL_MIN) {
			return { earthLike: true,
			         asc: el.nu + Math.PI / 2,  ascLabel: "90°",
			         desc: el.nu - Math.PI / 2, descLabel: "270°" };
		}
		return { earthLike: false,
		         asc: -el.omega,           ascLabel: "ascending node",
		         desc: Math.PI - el.omega, descLabel: "descending node" };
	}
	// Target true anomaly on the leg's arc for a snap key, or null if not
	// applicable. The apsis sense comes from the leg-creating `burn`.
	function snapTargetNu(r, v, burn, snap) {
		if (snap === "apsis") {
			var ap = apsisFromBurn(burn);
			if (!ap.available) { return null; }
			if (ap.label === "apoapsis" && O.elementsFromState(GM_SUN, r, v).e >= 1) {
				return null;                                       // hyperbola: no apoapsis
			}
			return ap.nu;
		}
		var ni = nodeInfo(r, v);
		if (snap === "asc")  { return ni.asc; }
		if (snap === "desc") { return ni.desc; }
		return null;
	}
	// Forward time (s) from (r,v) to a target true anomaly, or null if unreachable.
	function timeToTrueAnomaly(r, v, nuTarget) {
		if (nuTarget == null || !isFinite(nuTarget)) { return null; }
		var el = O.elementsFromState(GM_SUN, r, v);
		var M0 = O.meanAnomalyFromTrue(el.nu, el.e);
		var Mt = O.meanAnomalyFromTrue(nuTarget, el.e);
		if (!isFinite(M0) || !isFinite(Mt)) { return null; }
		var dM = Mt - M0;
		if (el.e < 1) { dM = ((dM % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI); }  // next forward pass
		else if (dM <= 0) { return null; }                             // hyperbola: already past
		return dM / O.meanMotion(GM_SUN, el.a);
	}
	// Leg time (s) to a snapped feature, plus a slider offset of `off` radians of
	// true anomaly applied symmetrically about the feature (so -off lands earlier
	// on the arc, +off later), or null if not applicable. A feature essentially
	// at the leg start (t ~ 0) is pushed to its next pass a period later, so a
	// node/apsis that coincides with the launch point doesn't collapse the
	// waypoint onto the burn.
	function snapTau(r, v, burn, snap, off) {
		var base = snapTargetNu(r, v, burn, snap);
		if (base == null) { return null; }
		var el = O.elementsFromState(GM_SUN, r, v);
		var n = O.meanMotion(GM_SUN, el.a);
		var bound = el.e < 1;
		var tau = timeToTrueAnomaly(r, v, base);
		if (tau == null) { return null; }
		if (off) {
			var dM = O.meanAnomalyFromTrue(base + off, el.e) - O.meanAnomalyFromTrue(base, el.e);
			if (bound) { while (dM > Math.PI) { dM -= 2*Math.PI; } while (dM < -Math.PI) { dM += 2*Math.PI; } }
			tau += dM / n;
		}
		if (bound) { var period = 2*Math.PI / n; while (tau < DAY) { tau += period; } }
		return (isFinite(tau) && tau > DAY) ? tau : null;
	}

	// Build the full multi-segment trajectory. Returns {samples, points} where
	// `points` are the waypoint world-states (r,v before the waypoint burn).
	function computeTrajectory() {
		var originOrbit = systems.get(state.origin).orbit;
		var dep = O.bodyStateAtJD(GM_SUN, originOrbit, state.jd);
		var r = dep.r.slice();
		var v = O.applyBurn(dep.r, dep.v, state.departure.pro, state.departure.nrm, state.departure.rad);

		var samples = [];           // {pos:Vector3 AU, t:s} cumulative
		var points = [];            // resolved waypoint states
		var segs = [];              // per-segment start states for marker lookup
		var tGlobal = 0;
		var segStartR = r, segStartV = v;
		var segStartBurn = state.departure;     // the burn that opened this leg

		var nSeg = state.waypoints.length + 1;
		for (var seg = 0; seg < nSeg; seg++) {
			var isFinal = (seg === state.waypoints.length);
			var dur;
			if (isFinal) {
				dur = finalCoast(segStartR, segStartV);
			} else {
				var wpd = state.waypoints[seg];
				// apsis option follows the leg-opening burn's prograde sign
				var ap = apsisFromBurn(segStartBurn);
				var apsisOK = ap.available
					&& !(ap.label === "apoapsis" && O.elementsFromState(GM_SUN, segStartR, segStartV).e >= 1);
				wpd._apsisLabel = ap.label;
				wpd._apsisAvailable = apsisOK;
				// node labels (real nodes, or the 90/270 substitute for flat legs)
				var ni = nodeInfo(segStartR, segStartV);
				wpd._nodeLabel = { asc: ni.ascLabel, desc: ni.descLabel };
				// resolve a "nearest node" request to a concrete side, once
				if (wpd.snap === "nodeNearest") {
					var ta = snapTau(segStartR, segStartV, segStartBurn, "asc", 0);
					var td = snapTau(segStartR, segStartV, segStartBurn, "desc", 0);
					wpd.snap = (td == null || (ta != null && ta <= td)) ? "asc" : "desc";
				}
				if (wpd.snap === "apsis" && !apsisOK) { wpd.snap = null; }
				// snapped waypoints recompute tau to land on the feature (+ offset)
				if (wpd.snap) {
					var t = snapTau(segStartR, segStartV, segStartBurn, wpd.snap, wpd.snapOffset || 0);
					if (t != null) { wpd.tau = t; }
				}
				dur = wpd.tau;
			}
			// record this segment's opening state so the marker can be located at
			// any global time along the whole path
			segs.push({ r0: segStartR, v0: segStartV, dur: dur, tStart: tGlobal });
			var steps = isFinal ? 256 : 160;
			var arc = O.sampleArc(GM_SUN, segStartR, segStartV, dur, steps);
			for (var k = 0; k < arc.length; k++) {
				if (seg > 0 && k === 0) continue;        // avoid duplicate joint
				samples.push({ pos: new THREE.Vector3(arc[k].r[0]/AU, arc[k].r[1]/AU, arc[k].r[2]/AU),
				               t: tGlobal + arc[k].t });
			}
			// advance to the joint (waypoint) and apply its burn
			var endState = O.propagateState(GM_SUN, segStartR, segStartV, dur);
			if (!isFinal) {
				var wp = state.waypoints[seg];
				points.push({ r: endState.r, v: endState.v, tGlobal: tGlobal + dur, burn: wp.burn });
				var v2 = O.applyBurn(endState.r, endState.v, wp.burn.pro, wp.burn.nrm, wp.burn.rad);
				segStartR = endState.r; segStartV = v2;
				segStartBurn = wp.burn;       // this waypoint's burn opens the next leg
				tGlobal += dur;
			}
		}
		return { samples: samples, points: points, segs: segs,
		         departure: { r: dep.r, v: dep.v, burn: state.departure } };
	}

	// How long to draw the final coast: one period if bound (capped), else a
	// few years of escape.
	function finalCoast(r, v) {
		var el = O.elementsFromState(GM_SUN, r, v);
		if (el.e < 1 && el.a > 0) {
			var T = 2 * Math.PI * Math.sqrt(Math.pow(el.a, 3) / GM_SUN);
			return Math.min(T, 60 * 365.25 * DAY);
		}
		return 12 * 365.25 * DAY;
	}

	// One arrow for a velocity-like vector (m/s) anchored at world point r (m).
	// Length is BURN_VEC_SCALE AU per km/s; drawn on top so it's always visible.
	// Returns null for a negligible vector.
	function makeBurnArrow(r, vec, colorHex) {
		var kms = O.vMag(vec) / 1000;
		if (kms < 0.05) { return null; }
		var len = kms * BURN_VEC_SCALE;
		var dir = new THREE.Vector3(vec[0], vec[1], vec[2]).normalize();
		var origin = new THREE.Vector3(r[0] / AU, r[1] / AU, r[2] / AU);
		var arrow = new THREE.ArrowHelper(dir, origin, len, colorHex, len * 0.22, len * 0.12);
		[arrow.line, arrow.cone].forEach(function (o) {
			o.material.depthTest = false; o.material.depthWrite = false;
			o.material.transparent = true; o.renderOrder = 12;
		});
		return arrow;
	}

	// At a burn point: a magenta dV arrow (the burn = v_after - v_before) and an
	// amber arrow showing the change in PROGRADE (orbital) speed, |v_after| -
	// |v_before|. The reference |v_before| is the origin body's speed at
	// departure, or the coast speed just before the burn at a waypoint. The amber
	// arrow lies along the resulting prograde direction and flips to point
	// retrograde when the resulting orbit is slower than the reference.
	function addBurnArrowsAt(r, vBefore, burn) {
		var vAfter = O.applyBurn(r, vBefore, burn.pro, burn.nrm, burn.rad);
		var dSpeed = O.vMag(vAfter) - O.vMag(vBefore);          // m/s, signed
		var dSpeedVec = O.vScale(O.vUnit(vAfter), dSpeed);      // along prograde; reversed if < 0
		var spdArrow = makeBurnArrow(r, dSpeedVec, DSPEED_COLOR);
		var dvArrow  = makeBurnArrow(r, O.vSub(vAfter, vBefore), DV_COLOR);
		[spdArrow, dvArrow].forEach(function (a) {   // dV last => on top where they overlap
			if (a) { scene.add(a); burnArrows.push(a); }
		});
	}

	// ---- burn readouts: a small pane straddling the panel edge, per burn ------
	// Values for one burn: its |Δv|, the inclination-to-ecliptic change it makes
	// (a plane change, about the radial axis), and the change in prograde
	// (orbital) speed. Returns null for a negligible burn.
	function burnReadoutData(r, vBefore, burn) {
		var mag = Math.hypot(burn.pro, burn.nrm, burn.rad);   // m/s
		if (mag < 1) { return null; }
		var vAfter = O.applyBurn(r, vBefore, burn.pro, burn.nrm, burn.rad);
		var iBefore = O.elementsFromState(GM_SUN, r, vBefore).i;
		var iAfter  = O.elementsFromState(GM_SUN, r, vAfter).i;
		return {
			burnDv: mag / 1000,
			planeChange: (iAfter - iBefore) * 180 / Math.PI,
			progradeDv: (O.vMag(vAfter) - O.vMag(vBefore)) / 1000
		};
	}

	function fmtSigned(x, digits, unit) {
		return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(digits) + unit;
	}

	// Rebuild the readout boxes from a list of { host, data } (data may be null).
	function renderBurnReadouts(entries) {
		if (!readoutLayer) { return; }
		readoutBoxes.forEach(function (b) { readoutLayer.removeChild(b.el); });
		readoutBoxes = [];
		entries.forEach(function (en) {
			if (!en.data || !en.host) { return; }
			var box = document.createElement("div");
			box.className = "sst-readout";
			box.innerHTML =
				'<div class="sst-readout-row"><span class="sst-readout-label">burn Δv</span>'
				+ '<span class="sst-readout-val" style="color:' + dvHex + '">' + en.data.burnDv.toFixed(2) + ' km/s</span></div>'
				+ '<div class="sst-readout-row"><span class="sst-readout-label">plane change</span>'
				+ '<span class="sst-readout-val" style="color:' + dvHex + '">' + fmtSigned(en.data.planeChange, 1, '°') + '</span></div>'
				+ '<div class="sst-readout-row"><span class="sst-readout-label">prograde Δv</span>'
				+ '<span class="sst-readout-val" style="color:' + spdHex + '">' + fmtSigned(en.data.progradeDv, 2, ' km/s') + '</span></div>';
			readoutLayer.appendChild(box);
			readoutBoxes.push({ el: box, host: en.host });
		});
		positionBurnReadouts();
	}

	// Place each readout box straddling the panel's left edge, vertically centred
	// on its burn widget. Hidden when its widget is scrolled out of the panel.
	function positionBurnReadouts() {
		if (!readoutBoxes.length || !mainEl || !panelEl) { return; }
		var mr = mainEl.getBoundingClientRect();
		var pr = panelEl.getBoundingClientRect();
		var boundary = pr.left - mr.left;            // panel's left edge in main coords
		readoutBoxes.forEach(function (b) {
			var hr = b.host.getBoundingClientRect();
			var visible = hr.bottom > pr.top + 4 && hr.top < pr.bottom - 4;
			b.el.style.display = visible ? "" : "none";
			if (!visible) { return; }
			var w = b.el.offsetWidth, h = b.el.offsetHeight;
			var left = boundary - w / 2;
			if (left < 4) { left = 4; }              // stacked layout: keep on-screen
			b.el.style.left = left + "px";
			b.el.style.top  = (hr.top - mr.top + hr.height / 2 - h / 2) + "px";
		});
	}

	function drawTrajectory() {
		var res = computeTrajectory();
		trajSamples = res.samples;
		trajSegs = res.segs;
		trajTotalT = 0;
		res.segs.forEach(function (s) { trajTotalT += s.dur; });

		if (trajLine) { scene.remove(trajLine); trajLine.geometry.dispose(); }
		var pts = trajSamples.map(function (s) { return s.pos; });
		var g = new THREE.BufferGeometry().setFromPoints(pts);
		trajLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x66f0ff }));
		scene.add(trajLine);

		// waypoint markers: a prograde/radial/normal axis gizmo at each point
		wpMarkers.forEach(function (m) { scene.remove(m); });
		wpMarkers = [];
		res.points.forEach(function (p) {
			var giz = makeWaypointGizmo(p);
			scene.add(giz); wpMarkers.push(giz);
		});

		// burn vectors: dV + post-burn velocity at the departure and each waypoint
		burnArrows.forEach(function (a) { scene.remove(a); });
		burnArrows = [];
		if (!burnVecToggle || burnVecToggle.checked) {
			addBurnArrowsAt(res.departure.r, res.departure.v, res.departure.burn);
			res.points.forEach(function (p) { addBurnArrowsAt(p.r, p.v, p.burn); });
		}

		// hollow-ring markers where the path grazes another body's orbit
		rebuildApproachMarks();
		return res;
	}

	// =======================================================================
	//  Orbit-approach markers: where the path nears a body's orbit *ring*
	// =======================================================================
	// A hollow ring sprite (camera-facing, constant on-screen size). Three tiers by
	// proximity to a body's orbit: faint/small within APPROACH_FAR, brighter within
	// APPROACH_NEAR, brightest/largest within APPROACH_CLOSE. The ring marks
	// proximity to the orbital *path*, regardless of where the body actually is
	// then (no timing/SOI check).
	// Size/thickness DECREASE with proximity (far ring is the big, bold one);
	// colour/opacity unchanged. worldR is the physical distance the tier marks, in
	// AU, used to grow the ring to true size when zoomed in close.
	var APPROACH_TIERS = [
		{ color: 0xb9842a, opacity: 0.42, px: 26, lw: 10, worldR: 0.004  },  // 0: far   — faint, largest, thickest
		{ color: 0xd6a02f, opacity: 0.70, px: 17, lw: 7,  worldR: 0.001  },  // 1: near  — brighter, medium
		{ color: 0xfff1b0, opacity: 1.00, px: 11, lw: 5,  worldR: 0.0002 }   // 2: close — brightest, smallest, thinnest
	];
	function ringTexture(lw) {
		if (_ringTex[lw]) { return _ringTex[lw]; }
		var cv = document.createElement("canvas");
		cv.width = cv.height = 64;
		var ctx = cv.getContext("2d");
		ctx.strokeStyle = "#ffffff"; ctx.lineWidth = lw;
		ctx.beginPath(); ctx.arc(32, 32, 24, 0, 2 * Math.PI); ctx.stroke();
		var t = new THREE.CanvasTexture(cv);
		t.minFilter = THREE.LinearFilter;
		_ringTex[lw] = t;
		return t;
	}
	function makeApproachRing(tier) {
		var st = APPROACH_TIERS[tier] || APPROACH_TIERS[0];
		var mat = new THREE.SpriteMaterial({ map: ringTexture(st.lw), transparent: true,
			depthTest: false, depthWrite: false });
		mat.color.setHex(st.color);
		mat.opacity = st.opacity;
		var sp = new THREE.Sprite(mat);
		sp.renderOrder = 14;
		sp.userData.px = st.px;                          // fixed on-screen size (when zoomed out)
		sp.userData.worldR = st.worldR;                  // physical radius it marks (AU)
		sp.scale.setScalar(0.01);
		return sp;
	}
	function rebuildApproachMarks() {
		orbitApproachMarks.forEach(function (m) { scene.remove(m); if (m.material) { m.material.dispose(); } });
		orbitApproachMarks = [];
		computeOrbitApproaches().forEach(function (c) {
			var sp = makeApproachRing(c.tier);
			sp.position.copy(c.pos);
			scene.add(sp); orbitApproachMarks.push(sp);
		});
	}
	// Golden-section refine of the closest approach over a time bracket, using the
	// *true* Kepler arc (stateAtGlobalTime) so sub-sample resolution isn't limited
	// by the polyline spacing. Returns {r (m), dist (m)} at the minimum.
	function refineApproach(orbit, tA, tB) {
		var gr = (Math.sqrt(5) - 1) / 2, a = tA, b = tB;
		function f(t) { var s = stateAtGlobalTime(t); return s ? O.distanceToOrbit(orbit, s.r) : Infinity; }
		var c = b - gr * (b - a), d = a + gr * (b - a), fc = f(c), fd = f(d);
		for (var k = 0; k < 48 && (b - a) > 1; k++) {
			if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); }
			else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
		}
		var tm = (a + b) / 2, s = stateAtGlobalTime(tm);
		return s ? { r: s.r, dist: O.distanceToOrbit(orbit, s.r), t: tm } : null;
	}
	// Scan the path for local minima of distance-to-each-orbit, then refine each.
	// A cheap per-sample pre-filter (out-of-plane gap + in-plane radial band) keeps
	// the exact point-to-ellipse solve to the few samples that are actually near.
	function computeOrbitApproaches() {
		var out = [];
		if (trajSamples.length < 3 || !trajSegs.length) { return out; }
		var GATE = 0.012 * AU;         // pre-filter half-width (m)
		var CAND = 0.006 * AU;         // refine candidates whose sample dist is below this (m)
		for (var bi = 0; bi < BODIES.length; bi++) {
			var name = BODIES[bi];
			if (name === state.origin) { continue; }
			var orbit = systems.get(name).orbit;
			if (!orbit || orbit.e >= 1) { continue; }
			// orbit frame (matches stateFromElements' rotation)
			var a = orbit.a, e = orbit.e;
			var iI = orbit.inclination || 0, Om = orbit.longitude || 0, w = orbit.argument || 0;
			var cO = Math.cos(Om), sO = Math.sin(Om), ci = Math.cos(iI), si = Math.sin(iI),
			    cw = Math.cos(w), sw = Math.sin(w);
			var ux = cO*cw - sO*sw*ci, uy = sO*cw + cO*sw*ci, uz = sw*si;
			var vx = -cO*sw - sO*cw*ci, vy = -sO*sw + cO*cw*ci, vz = cw*si;
			var A = Math.abs(a), B = A * Math.sqrt(Math.max(0, 1 - e * e));
			var ae = a * e, Cx = -ae*ux, Cy = -ae*uy, Cz = -ae*uz;
			var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
			var n = trajSamples.length, dists = new Array(n);
			for (var k = 0; k < n; k++) {
				var p = trajSamples[k].pos;
				var wx = p.x*AU - Cx, wy = p.y*AU - Cy, wz = p.z*AU - Cz;
				var z = wx*nx + wy*ny + wz*nz;
				if (Math.abs(z) > GATE) { dists[k] = Infinity; continue; }
				var x = wx*ux + wy*uy + wz*uz, yy = wx*vx + wy*vy + wz*vz;
				var rho = Math.hypot(x, yy);
				if (rho < B - GATE || rho > A + GATE) { dists[k] = Infinity; continue; }
				dists[k] = Math.hypot(O.distancePointEllipse(A, B, x, yy), z);
			}
			for (var m = 1; m < n - 1; m++) {
				if (dists[m] < CAND && dists[m] < dists[m-1] && dists[m] <= dists[m+1]) {
					var r = refineApproach(orbit, trajSamples[m-1].t, trajSamples[m+1].t);
					if (r && r.dist < APPROACH_FAR) {
						var tier = r.dist < APPROACH_CLOSE ? 2 : (r.dist < APPROACH_NEAR ? 1 : 0);
						out.push({ pos: new THREE.Vector3(r.r[0]/AU, r.r[1]/AU, r.r[2]/AU),
						           dist: r.dist, tier: tier, body: name });
					}
				}
			}
		}
		return out;
	}

	// =======================================================================
	//  Marker: a slidable 'x' probe on the trajectory
	// =======================================================================
	// A camera-facing 'x' sprite (white stroke on a dark halo so it reads on any
	// background), drawn on top of everything and held at constant on-screen size
	// by updateGizmos(). Now used for the DESTINATION body's arrival position.
	function makeMarkerSprite() {
		var cv = document.createElement("canvas");
		cv.width = cv.height = 64;
		var ctx = cv.getContext("2d");
		ctx.lineCap = "round";
		function strokeX() {
			ctx.beginPath();
			ctx.moveTo(16, 16); ctx.lineTo(48, 48);
			ctx.moveTo(48, 16); ctx.lineTo(16, 48);
			ctx.stroke();
		}
		ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 13; strokeX();   // halo
		ctx.strokeStyle = "#ffffff";          ctx.lineWidth = 7;  strokeX();   // mark
		var tex = new THREE.CanvasTexture(cv);
		tex.minFilter = THREE.LinearFilter;
		var sp = new THREE.Sprite(new THREE.SpriteMaterial({
			map: tex, depthTest: false, depthWrite: false, transparent: true }));
		sp.renderOrder = 15;
		sp.scale.setScalar(0.01);
		return sp;
	}

	// The TRAJECTORY marker: an elongated chevron (ship) drawn pointing +x; its
	// material.rotation is set each frame (updateGizmos) to the screen-space
	// heading so the nose points along the direction of travel.
	function makeShipSprite() {
		var cv = document.createElement("canvas");
		cv.width = cv.height = 64;
		var ctx = cv.getContext("2d");
		ctx.lineJoin = "round";
		ctx.beginPath();
		ctx.moveTo(58, 32);     // nose (+x)
		ctx.lineTo(13, 15);     // back-left
		ctx.lineTo(25, 32);     // concave notch
		ctx.lineTo(13, 49);     // back-right
		ctx.closePath();
		ctx.fillStyle = "#ffffff";
		ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.lineWidth = 4;
		ctx.fill(); ctx.stroke();
		var tex = new THREE.CanvasTexture(cv);
		tex.minFilter = THREE.LinearFilter;
		var sp = new THREE.Sprite(new THREE.SpriteMaterial({
			map: tex, depthTest: false, depthWrite: false, transparent: true }));
		sp.renderOrder = 15;
		sp.scale.setScalar(0.01);
		return sp;
	}

	// A temporal-proximity ring around the ship (one blue texture; tier sets
	// colour/opacity/size). Held at constant on-screen size by updateGizmos().
	function makeTempRing() {
		var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(7),
			transparent: true, depthTest: false, depthWrite: false }));
		sp.renderOrder = 13;
		sp.scale.setScalar(0.01);
		return sp;
	}

	// Slider angle (deg, -180..180) -> fraction of the whole path (0..1). The
	// clicked point is f0 at 0°; -180° maps to the path start, +180° to the end
	// (each side scaled linearly, so resolution is densest near the click).
	function markerFraction(f0, angleDeg) {
		var a = Math.max(-180, Math.min(180, angleDeg));
		return a <= 0 ? f0 * (a + 180) / 180 : f0 + (1 - f0) * (a / 180);
	}

	// Heliocentric state (r,v in m, m/s) at a global time along the path.
	function stateAtGlobalTime(t) {
		if (!trajSegs.length) { return null; }
		var seg = trajSegs[trajSegs.length - 1];
		for (var i = 0; i < trajSegs.length; i++) {
			if (t <= trajSegs[i].tStart + trajSegs[i].dur + 1e-6) { seg = trajSegs[i]; break; }
		}
		var dt = Math.max(0, Math.min(seg.dur, t - seg.tStart));
		return O.propagateState(GM_SUN, seg.r0, seg.v0, dt);
	}

	function fmtKm(m) {
		return (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " km";
	}

	// Heliocentric angle (deg, 0–360) swept around the Sun from the departure point
	// (the trajectory start = origin body at the departure date) to a point r (m),
	// measured in the direction of travel. The rotation axis is the departure
	// angular-momentum direction, so prograde motion increases the angle.
	function sweptFromOrigin(r) {
		if (!trajSegs.length) { return 0; }
		var r0 = trajSegs[0].r0, v0 = trajSegs[0].v0;
		var hx = r0[1]*v0[2] - r0[2]*v0[1], hy = r0[2]*v0[0] - r0[0]*v0[2], hz = r0[0]*v0[1] - r0[1]*v0[0];
		var hm = Math.hypot(hx, hy, hz) || 1; hx /= hm; hy /= hm; hz /= hm;
		var cx = r0[1]*r[2] - r0[2]*r[1], cy = r0[2]*r[0] - r0[0]*r[2], cz = r0[0]*r[1] - r0[1]*r[0];
		var ang = Math.atan2(cx*hx + cy*hy + cz*hz, r0[0]*r[0] + r0[1]*r[1] + r0[2]*r[2]) * 180 / Math.PI;
		return ang < 0 ? ang + 360 : ang;
	}

	function fmtTof(sec) {
		var d = sec / DAY;
		return d.toFixed(0) + " d (" + (d / 365.25).toFixed(2) + " yr)";
	}
	function fmtDate(jd) {
		var d = O.dateFromJulian(jd);
		return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
	}

	// Phasing (days) at meeting point P (m) reached at time-of-flight tofSec: the
	// signed gap between when the destination body passes through P and when the
	// ship arrives. + => the body gets there AFTER the ship (ship early); − => the
	// body has already gone by (ship late). Uses the nearest pass (mod one period).
	function phasingDays(orbit, P, tofSec) {
		var n = O.meanMotion(GM_SUN, orbit.a);
		var arrJd = state.jd + tofSec / DAY;
		var Mb = (orbit.meanAnomaly || 0) + n * (arrJd - (orbit.epoch || 2451545.0)) * DAY;
		var i = orbit.inclination || 0, Om = orbit.longitude || 0, w = orbit.argument || 0;
		var cO = Math.cos(Om), sO = Math.sin(Om), ci = Math.cos(i), si = Math.sin(i),
		    cw = Math.cos(w), sw = Math.sin(w);
		var ux = cO*cw - sO*sw*ci, uy = sO*cw + cO*sw*ci, uz = sw*si;
		var vx = -cO*sw - sO*cw*ci, vy = -sO*sw + cO*cw*ci, vz = cw*si;
		var nuP = Math.atan2(P[0]*vx + P[1]*vy + P[2]*vz, P[0]*ux + P[1]*uy + P[2]*uz);
		var Mp = O.meanAnomalyFromTrue(nuP, orbit.e);
		var dM = Mp - Mb;
		dM -= 2 * Math.PI * Math.round(dM / (2 * Math.PI));   // nearest pass, (-π,π]
		return (dM / n) / DAY;
	}

	// Keep the marker glued to the destination-orbit crossing while it is inside an
	// encounter ring; freeze (do nothing) when out of range, so it never skips to a
	// far crossing — it re-engages only when a ring sweeps back over its own spot.
	// Drives state.marker.f0/angle. Used by Track mode and by released Target mode.
	function followCrossing() {
		if (!state.marker) { return; }
		var dn = state.destination;
		if (!dn || dn === "(none)" || dn === state.origin) { return; }
		var orbit = systems.get(dn).orbit;
		if (!orbit || orbit.e >= 1 || !trajSegs.length || trajTotalT <= 0) { return; }
		var tCur = markerFraction(state.marker.f0, state.marker.angle) * trajTotalT;
		var sCur = stateAtGlobalTime(tCur);
		if (!sCur || O.distanceToOrbit(orbit, sCur.r) >= APPROACH_FAR) { return; }  // freeze
		var avgdt = trajTotalT / Math.max(1, trajSamples.length - 1);
		var win = 6 * avgdt;
		var r = refineApproach(orbit, Math.max(0, tCur - win), Math.min(trajTotalT, tCur + win));
		if (r && r.dist < APPROACH_FAR) {
			state.marker.f0 = Math.max(0, Math.min(1, r.t / trajTotalT));
			state.marker.angle = 0;
		}
	}

	// Target mode (Stage 2): hold the arrival date fixed and re-solve the TERMINAL
	// burn (departure if no waypoints, else the last waypoint's burn) via Lambert so
	// the ship still reaches the destination body at that arrival time as the
	// departure date scrubs. If the required Δv exceeds the budget it "releases":
	// the terminal burn reverts to its captured baseline and the marker falls back
	// to geometric tracking. Runs at the start of refresh(), before the trajectory
	// is drawn, so the drawn arc reflects the solved burn.
	function applyTargeting() {
		var m = state.marker;
		if (!m || m.mode !== "target") { return; }
		var term = (state.waypoints.length === 0) ? state.departure
		         : state.waypoints[state.waypoints.length - 1].burn;
		function restoreBase() {
			if (m._baseBurn) { term.pro = m._baseBurn.pro; term.rad = m._baseBurn.rad; term.nrm = m._baseBurn.nrm; }
		}
		function hardFail(msg) { restoreBase(); m._encT = null; m._targetDv = null; m._released = true; m._targetMsg = msg; }

		var dn = state.destination;
		if (!dn || dn === "(none)" || dn === state.origin || m.targetArrJd == null) { hardFail("no target"); return; }
		var destOrbit = systems.get(dn).orbit;
		if (!destOrbit || destOrbit.e >= 1) { hardFail("no target"); return; }

		var res = computeTrajectory();              // frozen upstream burns
		var nW = state.waypoints.length, r1, v1, t1g;
		if (nW === 0) { r1 = res.departure.r; v1 = res.departure.v; t1g = 0; }
		else { var p = res.points[nW - 1]; if (!p) { hardFail("no leg"); return; } r1 = p.r; v1 = p.v; t1g = p.tGlobal; }

		var tof = (m.targetArrJd - state.jd) * DAY - t1g;
		if (!(tof > DAY)) { hardFail("arrival ≤ burn"); return; }
		var target = O.bodyStateAtJD(GM_SUN, destOrbit, m.targetArrJd).r;
		var sol = O.lambert(GM_SUN, r1, target, tof, true);
		if (!sol) { hardFail("no solution"); return; }

		var dv = O.vSub(sol.v1, v1), dvMag = O.vMag(dv);
		m._targetDv = dvMag; m._targetMsg = null;
		if (dvMag > (m.dvBudget || 0)) { restoreBase(); m._encT = null; m._released = true; return; }  // over budget

		var vhat = O.vUnit(v1), nhat = O.vUnit(O.vCross(r1, v1)), rhat = O.vUnit(O.vCross(nhat, vhat));
		term.pro = O.vDot(dv, vhat); term.nrm = O.vDot(dv, nhat); term.rad = O.vDot(dv, rhat);
		m._encT = t1g + tof; m._released = false;
	}

	// Host element of the terminal burn's vector editor (for live redraw when Target
	// drives that burn).
	function terminalBurnHost() {
		var nW = state.waypoints.length;
		if (nW === 0) { return depVecHost; }
		var wp = state.waypoints[nW - 1];
		return wp && wp._host;
	}

	// Switch the marker behaviour. Entering Target freezes the current arrival date
	// and snapshots BOTH the terminal burn and the marker's own position (so each can
	// be restored); leaving Target restores that manual burn and puts the marker back
	// where it was. Then a full refresh runs the solver and redraws.
	//
	// Restoring the marker position is what keeps repeated Free<->Target toggles
	// stable: the held arrival date is derived from the marker's path-fraction, and
	// the fraction means different absolute times under the solved arc vs the manual
	// arc (their total durations differ). Without restoring it, every round trip fed
	// a drifted fraction back in, walking the arrival date — and the required Δv —
	// further each time until it blew the budget and released.
	function setMarkerMode(mode) {
		var m = state.marker;
		if (!m) { return; }
		function termBurn() {
			return (state.waypoints.length === 0) ? state.departure
			     : (state.waypoints[state.waypoints.length - 1] || {}).burn;
		}
		if (m.mode === "target" && mode !== "target" && m._baseBurn) {
			var tb = termBurn();
			if (tb) { tb.pro = m._baseBurn.pro; tb.rad = m._baseBurn.rad; tb.nrm = m._baseBurn.nrm; }
			m._baseBurn = null;
			// put the marker back where it was when Target was entered (Target drove
			// f0/angle to the solved encounter; that position is meaningless on the
			// restored manual arc and must not persist or feed the next solve)
			if (m._savedF0 != null) { m.f0 = m._savedF0; m.angle = m._savedAngle; m._savedF0 = null; }
		}
		if (mode === "target") {
			m._savedF0 = m.f0; m._savedAngle = m.angle;      // restore the marker here on leaving Target
			var tof = markerFraction(m.f0, m.angle) * trajTotalT;
			m.targetArrJd = state.jd + tof / DAY;            // hold this arrival date
			var tb2 = termBurn();
			m._baseBurn = tb2 ? { pro: tb2.pro, rad: tb2.rad, nrm: tb2.nrm } : { pro: 0, rad: 0, nrm: 0 };
			if (m.dvBudget == null) { m.dvBudget = 10000; }
			m._released = false;
		}
		m.mode = mode;
		updateMarkerModeButtons();
		refresh();
	}

	// Position the destination "×" (body at arrival), the temporal ring and the
	// phasing readout, given the ship's meeting point markerR (m) and TOF (s).
	function updateDestinationMarker(markerR, tofSec) {
		var dn = state.destination, active = dn && dn !== "(none)";
		if (!active) {
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			if (markerValPhase) { markerValPhase.textContent = "—"; }
			return;
		}
		var orbit = systems.get(dn).orbit;
		var arrJd = state.jd + tofSec / DAY;
		var b = O.bodyStateAtJD(GM_SUN, orbit, arrJd);
		if (!destSprite) { destSprite = makeMarkerSprite(); destSprite.renderOrder = 13; scene.add(destSprite); }
		destSprite.visible = true;
		destSprite.material.color.set(systems.get(dn).color || "#ffffff");
		destSprite.position.set(b.r[0] / AU, b.r[1] / AU, b.r[2] / AU);

		var nearOrbit = orbit.e < 1 && O.distanceToOrbit(orbit, markerR) < APPROACH_FAR;
		if (nearOrbit) {
			var dt = phasingDays(orbit, markerR, tofSec);
			markerValPhase.textContent = (dt >= 0 ? "+" : "−") + Math.abs(dt).toFixed(1) + " d";
			var ad = Math.abs(dt);
			var tier = ad < TEMP_CLOSE ? 2 : (ad < TEMP_NEAR ? 1 : (ad < TEMP_FAR ? 0 : -1));
			if (tier >= 0) {
				if (!tempRing) { tempRing = makeTempRing(); scene.add(tempRing); }
				var st = TEMPORAL_TIERS[tier];
				tempRing.material.color.setHex(st.color);
				tempRing.material.opacity = st.opacity;
				tempRing.userData.px = st.px;
				tempRing.visible = true;
				if (markerSprite) { tempRing.position.copy(markerSprite.position); }
			} else if (tempRing) { tempRing.visible = false; }
		} else {
			markerValPhase.textContent = "—";
			if (tempRing) { tempRing.visible = false; }
		}
	}

	function updateMarkerModeButtons() {
		Object.keys(markerModeBtns).forEach(function (k) {
			var on = state.marker && state.marker.mode === k;
			markerModeBtns[k].className = "sst-mode-btn" + (on ? " active" : "");
		});
	}

	// Build the top-left marker card (once). Holds the slider, a Free/Track mode
	// selector, and the readouts.
	function buildMarkerCard() {
		markerCard = document.createElement("div");
		markerCard.id = "sst-marker-card";

		var head = document.createElement("div"); head.className = "sst-marker-head";
		var title = document.createElement("span"); title.className = "sst-marker-title";
		title.textContent = "Marker";
		var rm = document.createElement("button"); rm.className = "sst-marker-x";
		rm.textContent = "✕"; rm.title = "remove marker";
		rm.addEventListener("click", function () { removeMarker(); });
		head.appendChild(title); head.appendChild(rm);
		markerCard.appendChild(head);

		markerSlider = document.createElement("input");
		markerSlider.type = "range"; markerSlider.className = "sst-marker-slider";
		var MARK_STEP = 1 / 3;                 // keyboard step: 3× finer than 1°/step
		markerSlider.min = -180; markerSlider.max = 180; markerSlider.step = MARK_STEP; markerSlider.value = 0;
		markerSlider.title = "drag to slide the marker along the whole path (0° = where you clicked); "
			+ "~10× more mouse travel than the track for fine control, ×4 finer again with Shift. "
			+ "Arrow keys nudge by ⅓° (¹⁄₁₂° with Shift) when focused.";

		// Keyboard: the native input drives the angle directly, with a 3×-finer
		// step (×4 again while Shift is held).
		markerSlider.addEventListener("input", function () {
			if (state.marker) { state.marker.angle = parseFloat(markerSlider.value); updateMarker(); }
		});
		function markerStep(e) { markerSlider.step = e.shiftKey ? MARK_STEP / 4 : MARK_STEP; }
		window.addEventListener("keydown", markerStep);
		window.addEventListener("keyup", markerStep);

		// Mouse: custom RELATIVE drag, so fineness is decoupled from the track's
		// pixel width. A native range maps ~(360° / trackPx) per pixel; we move at
		// 1/10 of that (≈10× more hand travel per degree), and 1/4 of THAT while
		// Shift is held. Accumulating relatively (rather than from an absolute thumb
		// position) lets you lift and re-grab to "ratchet" across the full range,
		// and keeps the precise, unsnapped angle in state.marker.angle.
		var mdrag = false, mLastX = 0, mNativeDegPerPx = 2;
		markerSlider.addEventListener("pointerdown", function (e) {
			if (!state.marker) { return; }
			e.preventDefault();                       // suppress the native jump-to-click
			mdrag = true; mLastX = e.clientX;
			mNativeDegPerPx = 360 / (markerSlider.clientWidth || 174);
			try { markerSlider.setPointerCapture(e.pointerId); } catch (_) {}
			markerSlider.focus();
		});
		markerSlider.addEventListener("pointermove", function (e) {
			if (!mdrag || !state.marker) { return; }
			var dx = e.clientX - mLastX; mLastX = e.clientX;
			var sens = (mNativeDegPerPx / 10) * (e.shiftKey ? 0.25 : 1);
			var a = Math.max(-180, Math.min(180, state.marker.angle + dx * sens));
			state.marker.angle = a;
			markerSlider.value = a;                   // thumb (snaps to step; cosmetic only)
			updateMarker();
		});
		function endMarkerDrag(e) {
			if (!mdrag) { return; }
			mdrag = false;
			try { markerSlider.releasePointerCapture(e.pointerId); } catch (_) {}
		}
		markerSlider.addEventListener("pointerup", endMarkerDrag);
		markerSlider.addEventListener("pointercancel", endMarkerDrag);

		markerCard.appendChild(markerSlider);

		// Free / Track / Target mode selector
		var modeRow = document.createElement("div"); modeRow.className = "sst-marker-mode";
		markerModeBtns = {};
		var modeTitles = {
			free: "slide the marker freely",
			track: "follow the destination orbit crossing while within an encounter ring (burns fixed)",
			target: "re-solve the terminal burn (Lambert) to hold the encounter as the date scrubs; releases above the Δv budget"
		};
		[["free", "Free"], ["track", "Track"], ["target", "Target"]].forEach(function (m) {
			var b = document.createElement("button");
			b.type = "button"; b.className = "sst-mode-btn"; b.textContent = m[1];
			b.title = modeTitles[m[0]];
			b.addEventListener("click", function () { setMarkerMode(m[0]); });
			markerModeBtns[m[0]] = b; modeRow.appendChild(b);
		});
		markerCard.appendChild(modeRow);

		function row(label) {
			var r = document.createElement("div"); r.className = "sst-marker-row";
			var l = document.createElement("span"); l.className = "sst-marker-label"; l.textContent = label;
			var v = document.createElement("span"); v.className = "sst-marker-val";
			r.appendChild(l); r.appendChild(v); markerCard.appendChild(r); return v;
		}
		markerValRad = row("radius");
		markerValRadKm = document.createElement("div"); markerValRadKm.className = "sst-marker-km";
		markerCard.appendChild(markerValRadKm);
		markerValSpd = row("prograde velocity");
		markerValLat = row("ecliptic latitude");
		markerValDeg = row("radial from origin");
		markerValTof = row("time of flight");
		markerValArr = row("arrival date");
		markerValPhase = row("phasing");

		// Target-mode controls (shown only in Target mode)
		markerBudgetRow = document.createElement("label"); markerBudgetRow.className = "sst-marker-budget";
		var blab = document.createElement("span"); blab.textContent = "Δv budget (km/s)";
		markerBudgetInput = document.createElement("input");
		markerBudgetInput.type = "number"; markerBudgetInput.min = 0; markerBudgetInput.step = 0.5; markerBudgetInput.value = "10";
		markerBudgetInput.addEventListener("change", function () {
			var v = parseFloat(markerBudgetInput.value); if (!isFinite(v) || v < 0) { v = 0; }
			if (state.marker) { state.marker.dvBudget = v * 1000; refresh(); }
		});
		markerBudgetRow.appendChild(blab); markerBudgetRow.appendChild(markerBudgetInput);
		markerCard.appendChild(markerBudgetRow);

		markerTdvRow = document.createElement("div"); markerTdvRow.className = "sst-marker-row";
		var tlab = document.createElement("span"); tlab.className = "sst-marker-label"; tlab.textContent = "target Δv";
		markerValTdv = document.createElement("span"); markerValTdv.className = "sst-marker-val";
		markerTdvRow.appendChild(tlab); markerTdvRow.appendChild(markerValTdv);
		markerCard.appendChild(markerTdvRow);

		(viewEl || document.body).appendChild(markerCard);
	}

	// Recompute the marker's world position and card readouts from its slider
	// angle and the current trajectory. A no-op (hides the visuals) when unset.
	function updateMarker() {
		if (!state.marker) {
			if (markerSprite) { markerSprite.visible = false; }
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			if (markerCard) { markerCard.style.display = "none"; }
			return;
		}
		if (!state.marker.mode) { state.marker.mode = "free"; }
		if (!markerSprite) { markerSprite = makeShipSprite(); scene.add(markerSprite); }
		if (!markerCard) { buildMarkerCard(); }
		if (state.marker.mode === "track") { followCrossing(); }
		else if (state.marker.mode === "target") {
			if (!state.marker._released && state.marker._encT != null && trajTotalT > 0) {
				state.marker.f0 = Math.max(0, Math.min(1, state.marker._encT / trajTotalT));
				state.marker.angle = 0;                          // sit at the solved encounter
			} else { followCrossing(); }                         // released -> behave like Track
		}

		var f = markerFraction(state.marker.f0, state.marker.angle);
		var tof = f * trajTotalT;
		var s = stateAtGlobalTime(tof);
		if (!s) {
			markerSprite.visible = false; markerCard.style.display = "none";
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			return;
		}

		markerSprite.visible = true;
		markerSprite.position.set(s.r[0] / AU, s.r[1] / AU, s.r[2] / AU);
		markerVelDir = new THREE.Vector3(s.v[0], s.v[1], s.v[2]).normalize();

		var rmag = O.vMag(s.r);                                   // m
		var lat  = Math.asin(Math.max(-1, Math.min(1, s.r[2] / rmag))) * 180 / Math.PI;
		markerCard.style.display = "";
		markerValRad.textContent = (rmag / AU).toFixed(3) + " AU";
		markerValRadKm.textContent = fmtKm(rmag);
		markerValSpd.textContent = (O.vMag(s.v) / 1000).toFixed(2) + " km/s";
		markerValLat.textContent = (lat >= 0 ? "+" : "−") + Math.abs(lat).toFixed(1) + "°";
		markerValDeg.textContent = sweptFromOrigin(s.r).toFixed(1) + "°";
		markerValTof.textContent = fmtTof(tof);
		markerValArr.textContent = fmtDate(state.jd + tof / DAY);

		updateDestinationMarker(s.r, tof);

		if (markerSlider) {
			markerSlider.disabled = (state.marker.mode !== "free");   // position driven in Track/Target
			if (document.activeElement !== markerSlider) { markerSlider.value = state.marker.angle; }
		}

		// Target-mode controls/readouts (budget input + solved Δv); hidden otherwise
		var isTarget = state.marker.mode === "target";
		if (markerBudgetRow) { markerBudgetRow.style.display = isTarget ? "" : "none"; }
		if (markerTdvRow) { markerTdvRow.style.display = isTarget ? "" : "none"; }
		if (isTarget) {
			if (markerBudgetInput && document.activeElement !== markerBudgetInput) {
				markerBudgetInput.value = ((state.marker.dvBudget || 0) / 1000).toFixed(1);
			}
			if (markerValTdv) {
				if (state.marker._targetDv != null) {
					markerValTdv.textContent = (state.marker._targetDv / 1000).toFixed(2) + " km/s"
						+ (state.marker._released ? " — released" : "");
					markerValTdv.style.color = state.marker._released ? "#ff8a8a" : "#9fe0ff";
				} else {
					markerValTdv.textContent = state.marker._targetMsg || "—";
					markerValTdv.style.color = "#ff8a8a";
				}
			}
		}
		updateMarkerModeButtons();
		if (state.markerFocused) { cam.target.copy(markerSprite.position); }
	}

	// Make the marker the camera's pivot — the view then rotates and zooms about
	// it. Triggered when the marker is created or its 'x' is clicked.
	function focusMarker() {
		if (!state.marker || !markerSprite) { return; }
		state.markerFocused = true;
		state.focus = null;
		cam.target.copy(markerSprite.position);
		setHud("Focused on marker — drag to rotate around it, wheel to zoom in.");
	}

	function removeMarker() {
		state.marker = null;
		state.markerFocused = false;
		if (markerSprite) { markerSprite.visible = false; }
		if (destSprite) { destSprite.visible = false; }
		if (tempRing) { tempRing.visible = false; }
		if (markerCard) { markerCard.style.display = "none"; }
		setHud("Marker removed. Click the trajectory to place a new one.");
	}

	// Place (or move) the marker at a global time along the path; that point
	// becomes 0° on the slider and the camera focus.
	function placeMarkerAtGlobalTime(t) {
		var f0 = trajTotalT > 0 ? Math.max(0, Math.min(1, t / trajTotalT)) : 0;
		var budget = (state.marker && state.marker.dvBudget != null) ? state.marker.dvBudget : 10000;
		// if we were targeting, restore the manual terminal burn before re-placing
		if (state.marker && state.marker.mode === "target" && state.marker._baseBurn) {
			var tb = (state.waypoints.length === 0) ? state.departure
			       : (state.waypoints[state.waypoints.length - 1] || {}).burn;
			if (tb) { tb.pro = state.marker._baseBurn.pro; tb.rad = state.marker._baseBurn.rad; tb.nrm = state.marker._baseBurn.nrm; }
		}
		state.marker = { f0: f0, angle: 0, mode: "free", dvBudget: budget };
		updateMarker();
		focusMarker();
	}

	// =======================================================================
	//  Picking a point on the trajectory (screen-space nearest sample)
	// =======================================================================
	// A plain click places/moves the marker on the nearest trajectory point;
	// clicking the marker's own 'x' just refocuses the camera on it. (Waypoints
	// are created from the "Create waypoint 1/2" checkboxes, not by clicking.)
	function handlePick(e) {
		if (!trajSamples.length) return;
		var rect = renderer.domElement.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;

		// click on the existing marker -> refocus only (don't move it)
		if (state.marker && markerSprite && markerSprite.visible) {
			var mv = markerSprite.position.clone().project(camera);
			if (mv.z <= 1) {
				var mx = (mv.x * 0.5 + 0.5) * rect.width, my = (-mv.y * 0.5 + 0.5) * rect.height;
				if (Math.hypot(mx - px, my - py) < 16) { focusMarker(); return; }
			}
		}

		// otherwise place/move the marker at the nearest trajectory sample
		var best = -1, bestD = 14;        // pixel threshold
		for (var i = 0; i < trajSamples.length; i++) {
			var v = trajSamples[i].pos.clone().project(camera);
			if (v.z > 1) continue;
			var sx = (v.x * 0.5 + 0.5) * rect.width;
			var sy = (-v.y * 0.5 + 0.5) * rect.height;
			var d = Math.hypot(sx - px, sy - py);
			if (d < bestD) { bestD = d; best = i; }
		}
		if (best < 0) {
			// clicked empty space in the view: release the marker focus (the marker
			// stays put) so dragging resumes free navigation. Click it to refocus.
			if (state.markerFocused) {
				state.markerFocused = false;
				setHud("Marker unfocused — drag to navigate freely; click the marker to refocus.");
			}
			return;
		}
		placeMarkerAtGlobalTime(trajSamples[best].t);
	}

	// =======================================================================
	//  UI building
	// =======================================================================
	function fmtKmS(mps) { return (mps / 1000).toFixed(2); }

	function buildOriginOptions() {
		BODIES.forEach(function (name) {
			var opt = document.createElement("option");
			opt.value = name; opt.textContent = name;
			if (name === state.origin) opt.selected = true;
			originSel.appendChild(opt);
		});
	}

	function buildDestinationOptions() {
		if (!destSel) { return; }
		var none = document.createElement("option");
		none.value = "(none)"; none.textContent = "(none)";
		if (state.destination === "(none)") { none.selected = true; }
		destSel.appendChild(none);
		BODIES.forEach(function (name) {
			var opt = document.createElement("option");
			opt.value = name; opt.textContent = name;
			if (name === state.destination) opt.selected = true;
			destSel.appendChild(opt);
		});
	}

	// A 3-axis burn editor drawn as an isometric set of draggable arrows around a
	// little ship (an elongated pyramid): prograde up-right, radial down-right,
	// normal vertical. Drag along an axis to set km/s; pull through the origin to
	// the far side for negative. values:{pro,rad,nrm} in m/s; onChange(key,mps).
	var SVGNS = "http://www.w3.org/2000/svg";
	function svgEl(tag, attrs) {
		var e = document.createElementNS(SVGNS, tag);
		for (var k in attrs) { e.setAttribute(k, attrs[k]); }
		return e;
	}
	function buildVectorEditor(host, values, onChange) {
		host.innerHTML = "";
		// Sized so the drawing (axes + value labels) sits ~15px from every edge.
		var W = 278, H = 300, OX = 139, OY = 150, SCALE = 7.5, MAXV = 15, LEN = MAXV * SCALE;
		var axes = [
			{ key: "pro", name: "prograde", col: "#6fd49a", dx:  Math.cos(-Math.PI/6), dy: Math.sin(-Math.PI/6) },
			{ key: "rad", name: "radial",   col: "#ffb45a", dx:  Math.cos( Math.PI/6), dy: Math.sin( Math.PI/6) },
			{ key: "nrm", name: "normal",   col: "#8ab4ff", dx: 0, dy: -1 }
		];

		var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "sst-vecwidget" });

		// the ship — a small elongated pyramid (a wedge): a square base "cap" at
		// the back and a long nose pointing up the PROGRADE axis. Drawn first so
		// it sits BEHIND the axes and arrows. Solid look: three grey faces with
		// their edges stroked in the background colour, reading as clean seams.
		(function () {
			var ux = Math.cos(-Math.PI/6), uy = Math.sin(-Math.PI/6);  // prograde dir
			var vx = -uy, vy = ux;                                      // perpendicular
			// local coords (x = along nose, y = across); rotated onto prograde.
			function P(lx, ly) { return [OX + lx*ux + ly*vx, OY + lx*uy + ly*vy]; }
			var A1 = P(-20, -6), A2 = P(-9, -12), A3 = P(-9, 10), A4 = P(-20, 16), E = P(28, -1);
			function poly(pts, fill) {
				return svgEl("polygon", {
					points: pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "),
					fill: fill, stroke: "#0c0f17", "stroke-width": 1.2, "stroke-linejoin": "round" });
			}
			svg.appendChild(poly([A1, A2, A3, A4], "#595d66"));   // base cap (mid grey)
			svg.appendChild(poly([A1, A2, E],      "#7e828c"));   // top face (lit)
			svg.appendChild(poly([A2, A3, E],      "#3b3e46"));   // front face (shadow)
		})();

		// faint full-length guide lines through the origin, with axis letters
		axes.forEach(function (a) {
			svg.appendChild(svgEl("line", {
				x1: OX - a.dx*LEN, y1: OY - a.dy*LEN, x2: OX + a.dx*LEN, y2: OY + a.dy*LEN,
				stroke: a.col, "stroke-opacity": 0.22, "stroke-width": 1 }));
			var t = svgEl("text", { x: OX + a.dx*(LEN+11), y: OY + a.dy*(LEN+11),
				fill: a.col, "fill-opacity": 0.7, "font-size": 11,
				"text-anchor": "middle", "dominant-baseline": "central" });
			t.textContent = a.name.charAt(0).toUpperCase();
			svg.appendChild(t);
		});

		// per-axis arrow parts (built once, repositioned in redraw)
		axes.forEach(function (a) {
			a.line = svgEl("line", { stroke: a.col, "stroke-width": 2.5, "stroke-linecap": "round" });
			a.head = svgEl("polygon", { fill: a.col });
			a.val  = svgEl("text", { fill: a.col, "font-size": 11, "font-weight": 600,
				"text-anchor": "middle", "dominant-baseline": "central" });
			svg.appendChild(a.line); svg.appendChild(a.head); svg.appendChild(a.val);
		});
		host.appendChild(svg);

		// numeric entry row beneath the widget
		var nums = {};
		var row = document.createElement("div"); row.className = "sst-vec-nums";
		axes.forEach(function (a) {
			var cell = document.createElement("label"); cell.className = "sst-vec-num";
			var tag = document.createElement("span");
			tag.textContent = a.name.charAt(0).toUpperCase() + a.name.slice(1);
			tag.style.color = a.col;
			var inp = document.createElement("input");
			inp.type = "number"; inp.step = 0.01; inp.value = (values[a.key]/1000).toFixed(2);
			inp.addEventListener("change", function () {
				var v = parseFloat(inp.value); if (!isFinite(v)) { v = 0; }
				values[a.key] = v * 1000; redraw(); onChange(a.key, v * 1000);
			});
			nums[a.key] = inp;
			cell.appendChild(tag); cell.appendChild(inp); row.appendChild(cell);
		});
		host.appendChild(row);

		function redraw() {
			axes.forEach(function (a) {
				var v = values[a.key] / 1000;
				var vis = Math.max(-MAXV, Math.min(MAXV, v));
				var tx = OX + a.dx*vis*SCALE, ty = OY + a.dy*vis*SCALE;
				var show = Math.abs(vis) > 0.12;
				[a.line, a.head].forEach(function (n) { n.style.display = show ? "" : "none"; });
				if (show) {
					a.line.setAttribute("x1", OX); a.line.setAttribute("y1", OY);
					a.line.setAttribute("x2", tx); a.line.setAttribute("y2", ty);
					var s = vis < 0 ? -1 : 1, hx = s*a.dx, hy = s*a.dy, px = -hy, py = hx;
					var bx = tx - hx*9, by = ty - hy*9;
					a.head.setAttribute("points",
						tx + "," + ty + " " + (bx+px*5) + "," + (by+py*5) + " " + (bx-px*5) + "," + (by-py*5));
				}
				if (Math.abs(v) > 0.005) {
					a.val.style.display = "";
					a.val.setAttribute("x", tx + (vis<0?-1:1)*a.dx*15);
					a.val.setAttribute("y", ty + (vis<0?-1:1)*a.dy*15);
					a.val.textContent = v.toFixed(2);
				} else { a.val.style.display = "none"; }
				if (document.activeElement !== nums[a.key]) { nums[a.key].value = v.toFixed(2); }
			});
		}

		// --- dragging ---
		function toVB(e) {
			var r = svg.getBoundingClientRect();
			return [ (e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H ];
		}
		function pickAxis(px, py) {
			var best = -1, bestPerp = 18, rx = px - OX, ry = py - OY;
			for (var i = 0; i < axes.length; i++) {
				var a = axes[i];
				var proj = rx*a.dx + ry*a.dy, perp = Math.abs(rx*a.dy - ry*a.dx);
				if (Math.abs(proj) > 6 && perp < bestPerp) { bestPerp = perp; best = i; }
			}
			return best;
		}
		// Two layered behaviours: pressing on an axis JUMPS the arrow straight to
		// that point (coarse, absolute — the old click-to-set), and then DRAGGING
		// fine-tunes RELATIVELY from there (like the marker slider) — movement
		// projected onto the axis, accumulated at 1/10 the old sensitivity (≈10×
		// more hand travel per km/s), and 1/4 of THAT while Shift is held. So: click
		// to place roughly, drag to nudge precisely; lift and re-grab to push past
		// the widget edge or through the origin into a negative component. The
		// numeric fields remain for exact or out-of-range values.
		var dragIdx = -1, lastVB = null;
		var BURN_SENS = 1 / (SCALE * 10);      // km/s per viewBox-unit along the axis
		function setAxisAbsolute(p, a) {       // coarse jump to the clicked position
			var proj = (p[0] - OX) * a.dx + (p[1] - OY) * a.dy;
			var v = Math.max(-MAXV, Math.min(MAXV, proj / SCALE));
			values[a.key] = v * 1000;
			redraw();
			onChange(a.key, v * 1000);
		}
		svg.addEventListener("pointerdown", function (e) {
			var p = toVB(e), idx = pickAxis(p[0], p[1]);
			if (idx < 0) { return; }
			dragIdx = idx; lastVB = p;
			setAxisAbsolute(p, axes[idx]);     // coarse: jump to where you pressed
			try { svg.setPointerCapture(e.pointerId); } catch (err) {}
			e.preventDefault();
		});
		svg.addEventListener("pointermove", function (e) {
			if (dragIdx < 0) { return; }
			var p = toVB(e), a = axes[dragIdx];
			var dproj = (p[0] - lastVB[0]) * a.dx + (p[1] - lastVB[1]) * a.dy;
			lastVB = p;
			var sens = BURN_SENS * (e.shiftKey ? 0.25 : 1);
			var v = Math.max(-MAXV, Math.min(MAXV, values[a.key] / 1000 + dproj * sens));
			values[a.key] = v * 1000;
			redraw();
			onChange(a.key, v * 1000);
		});
		function endDrag() { dragIdx = -1; lastVB = null; }
		svg.addEventListener("pointerup", endDrag);
		svg.addEventListener("pointercancel", endDrag);

		host._sstRedraw = redraw;     // let Target mode refresh the arrows it drives
		redraw();
	}

	function buildWaypointList() {
		wpList.innerHTML = "";
		wpEmpty.style.display = state.waypoints.length ? "none" : "block";
		state.waypoints.forEach(function (wp, idx) {
			var card = document.createElement("div"); card.className = "sst-waypoint";
			var head = document.createElement("div"); head.className = "sst-waypoint-head";
			var title = document.createElement("span"); title.className = "sst-wp-title";
			title.textContent = "WP " + (idx + 1);
			var rm = document.createElement("button"); rm.className = "sst-wp-x";
			rm.textContent = "✕"; rm.title = "remove waypoint";
			rm.addEventListener("click", function () {
				state.waypoints.splice(idx, 1); refresh();
			});
			head.appendChild(title); head.appendChild(rm);
			card.appendChild(head);

			// snap-to controls: place the waypoint on a chosen orbital feature.
			// Mutually exclusive — selecting one clears the others; clicking the
			// active one again clears it (back to the manually-clicked position).
			var snapRow = document.createElement("div"); snapRow.className = "sst-wp-snaps";
			var snapBoxes = {};
			var nodeLab = wp._nodeLabel || {};
			[["apsis", wp._apsisLabel || "apoapsis"], ["asc", nodeLab.asc || "ascending node"],
			 ["desc", nodeLab.desc || "descending node"]].forEach(function (d) {
				var lab = document.createElement("label"); lab.className = "sst-wp-snap";
				var cb = document.createElement("input"); cb.type = "checkbox";
				cb.checked = (wp.snap === d[0]);
				if (d[0] === "apsis" && wp._apsisAvailable === false) { cb.disabled = true; }
				var txt = document.createElement("span"); txt.textContent = d[1];
				cb.addEventListener("change", function () {
					wp.snap = cb.checked ? d[0] : null;
					Object.keys(snapBoxes).forEach(function (k) {
						snapBoxes[k].cb.checked = (wp.snap === k);
					});
					refresh();
				});
				snapBoxes[d[0]] = { cb: cb, txt: txt, lab: lab };
				lab.appendChild(cb); lab.appendChild(txt); snapRow.appendChild(lab);
			});
			wp._snapBoxes = snapBoxes;
			card.appendChild(snapRow);

			// fine-tune slider: slides the waypoint +/-90deg along the leg's arc,
			// centred on the snapped feature. Active only while a snap is chosen.
			var slider = document.createElement("input");
			slider.type = "range"; slider.className = "sst-wp-slider";
			slider.min = -90; slider.max = 90; slider.step = 1;
			slider.value = Math.round((wp.snapOffset || 0) * 180 / Math.PI);
			slider.disabled = !wp.snap;
			slider.title = "slide ±90° along the arc, around the snapped point";
			slider.addEventListener("input", function () {
				wp.snapOffset = parseFloat(slider.value) * Math.PI / 180;
				refresh();
			});
			wp._slider = slider;
			card.appendChild(slider);

			var info = document.createElement("div"); info.className = "sst-muted";
			info.id = "sst-wp-info-" + idx;
			card.appendChild(info);

			var vecHost = document.createElement("div");
			card.appendChild(vecHost);
			wp._host = vecHost;          // for positioning this waypoint's readout pane
			buildVectorEditor(vecHost, wp.burn, function (axis, mps) {
				wp.burn[axis] = mps; refresh();
			});
			wpList.appendChild(card);
		});
	}

	function setHud(msg) { hudStatus.textContent = msg; }

	// =======================================================================
	//  Refresh: recompute everything that depends on state
	// =======================================================================
	function refresh() {
		placeBodies();

		// Target mode: re-solve the terminal burn before anything is drawn/read out
		applyTargeting();

		// origin info
		var o = systems.get(state.origin).orbit;
		var dep = O.bodyStateAtJD(GM_SUN, o, state.jd);
		originInfo.textContent = "Heliocentric speed " + fmtKmS(O.vMag(dep.v)) + " km/s, distance "
			+ (O.vMag(dep.r) / AU).toFixed(3) + " AU.";

		// destination info (its position right now, at the departure date)
		if (destInfo) {
			if (state.destination && state.destination !== "(none)") {
				var dnow = O.bodyStateAtJD(GM_SUN, systems.get(state.destination).orbit, state.jd);
				destInfo.textContent = "Now at " + (O.vMag(dnow.r) / AU).toFixed(3) + " AU, "
					+ fmtKmS(O.vMag(dnow.v)) + " km/s. The × marks where it will be at arrival.";
			} else {
				destInfo.textContent = "No destination selected.";
			}
		}

		// departure readout: resulting heliocentric speed & C3
		var v = O.applyBurn(dep.r, dep.v, state.departure.pro, state.departure.nrm, state.departure.rad);
		var el = O.elementsFromState(GM_SUN, dep.r, v);
		var kind = el.e < 1 ? ("ellipse, a = " + (el.a / AU).toFixed(2) + " AU")
		                    : ("hyperbola, e = " + el.e.toFixed(2));
		var depDv = Math.hypot(state.departure.pro, state.departure.nrm, state.departure.rad);
		depReadout.textContent = "Resulting arc: " + kind + ", speed " + fmtKmS(O.vMag(v))
			+ " km/s. Δv = " + fmtKmS(depDv) + " km/s.";

		var res = drawTrajectory();

		// Keep the terminal burn's on-panel widget showing the burn ACTUALLY in force.
		// Target overwrites that burn with the Lambert solution, and leaving Target
		// restores the manual burn — both are programmatic changes the editor's own
		// handlers never saw, so redraw it here regardless of mode (a no-op when the
		// editor already matches, e.g. during manual edits).
		var th = terminalBurnHost();
		if (th && th._sstRedraw) { th._sstRedraw(); }

		// keep the "Create waypoint" checkboxes in step with the waypoint count
		if (createWp1) { createWp1.checked = state.waypoints.length >= 1; }
		if (createWp2) {
			createWp2.checked = state.waypoints.length >= 2;
			createWp2.disabled = state.waypoints.length < 1;
		}

		// fill waypoint readouts (speed at each point before its burn)
		res.points.forEach(function (p, idx) {
			var wpRef = state.waypoints[idx];
			if (wpRef && wpRef._snapBoxes) {
				var ab = wpRef._snapBoxes.apsis;
				if (ab) {
					if (wpRef._apsisLabel) { ab.txt.textContent = wpRef._apsisLabel; }
					var avail = wpRef._apsisAvailable !== false;
					ab.cb.disabled = !avail;
					ab.lab.style.opacity = avail ? "" : "0.4";
					ab.lab.title = avail ? "" : "needs a prograde or retrograde burn on this leg";
				}
				if (wpRef._nodeLabel) {               // real nodes, or 90/270 substitute
					if (wpRef._snapBoxes.asc)  { wpRef._snapBoxes.asc.txt.textContent  = wpRef._nodeLabel.asc; }
					if (wpRef._snapBoxes.desc) { wpRef._snapBoxes.desc.txt.textContent = wpRef._nodeLabel.desc; }
				}
				["apsis", "asc", "desc"].forEach(function (k) {     // keep checks in sync
					if (wpRef._snapBoxes[k]) { wpRef._snapBoxes[k].cb.checked = (wpRef.snap === k); }
				});
				if (wpRef._slider) { wpRef._slider.disabled = !wpRef.snap; }   // slider needs a snap
			}
			var info = document.getElementById("sst-wp-info-" + idx);
			if (info) {
				var days = (p.tGlobal / DAY).toFixed(0);
				var wpDv = Math.hypot(p.burn.pro, p.burn.nrm, p.burn.rad);
				info.textContent = "+" + days + " d, " + (O.vMag(p.r) / AU).toFixed(3)
					+ " AU from Sun, coast speed " + fmtKmS(O.vMag(p.v)) + " km/s. Δv = "
					+ fmtKmS(wpDv) + " km/s.";
			}
		});

		// straddling burn-readout panes (one per burn that has a value)
		var entries = [{ host: depVecHost, data: burnReadoutData(dep.r, dep.v, state.departure) }];
		res.points.forEach(function (p, idx) {
			var wp = state.waypoints[idx];
			entries.push({ host: wp && wp._host, data: burnReadoutData(p.r, p.v, p.burn) });
		});
		renderBurnReadouts(entries);

		// keep the marker on the (possibly reshaped) path and refresh its readouts
		updateMarker();
	}

	// ---- date model: a coarse 100-year base + a fine +/- 6-month offset ----
	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
	              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	function shortDate(jd) { var d = O.dateFromJulian(jd); return MONTHS[d.Mo - 1] + " " + d.Y; }

	// Recompute state.jd from the coarse base + fine offset, and sync the labels.
	function applyDate() {
		var eff = Math.max(0, Math.min(SPAN_DAYS, state.baseDays + parseFloat(fineSlider.value)));
		state.jd = JD0 + eff;
		var d = O.dateFromJulian(state.jd);
		dateField.value = d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
		jdLabel.textContent = "JD " + state.jd.toFixed(1);
		fineLo.textContent = shortDate(JD0 + Math.max(0, state.baseDays - 182.625));
		fineHi.textContent = shortDate(JD0 + Math.min(SPAN_DAYS, state.baseDays + 182.625));
	}

	// Move the coarse base to a day-from-epoch and recenter the fine slider on it.
	function setBaseDays(days) {
		state.baseDays = Math.max(0, Math.min(SPAN_DAYS, Math.round(days)));
		coarseSlider.value = state.baseDays;
		fineSlider.value = 0;
		applyDate();
	}

	// =======================================================================
	//  Wiring
	// =======================================================================
	function init() {
		initScene();
		buildOriginOptions();
		buildDestinationOptions();
		viewEl = document.getElementById("sst-view");

		// overlay that holds the straddling burn readouts (escapes panel clipping)
		readoutLayer = document.createElement("div");
		readoutLayer.id = "sst-burn-readouts";
		if (mainEl) { mainEl.appendChild(readoutLayer); }
		if (panelEl) { panelEl.addEventListener("scroll", positionBurnReadouts); }

		buildVectorEditor(depVecHost, state.departure, function (axis, mps) {
			state.departure[axis] = mps; refresh();
		});

		coarseSlider.addEventListener("input", function () {
			setBaseDays(parseInt(coarseSlider.value, 10));
			refresh();
		});
		fineSlider.addEventListener("input", function () {
			applyDate();
			refresh();
		});

		// Marker-style fine dragging for the date sliders. A plain press jumps the date
		// to the clicked position (native feel), then dragging fine-tunes RELATIVELY;
		// holding Shift makes the drag 4× slower (×0.25), exactly like the marker
		// slider. A Shift-press fine-tunes from the current date without jumping.
		// (The native `input` listeners above still handle keyboard arrows.)
		function enableShiftDrag(slider, apply, onOverflow) {
			var drag = false, lastX = 0, perPx = 1;
			var lo = parseFloat(slider.min), hi = parseFloat(slider.max);
			function setVal(v) {
				// past an end, an overflow handler (the fine slider's wrap) may advance
				// the period and return a residual value back inside the track
				if (onOverflow && (v > hi || v < lo)) { v = onOverflow(v); }
				slider.value = Math.max(lo, Math.min(hi, v)); apply();
			}
			slider.addEventListener("pointerdown", function (e) {
				e.preventDefault();                       // take over from the native thumb
				drag = true; lastX = e.clientX;
				perPx = (hi - lo) / (slider.clientWidth || 1);   // native units per pixel
				if (!e.shiftKey) {                        // plain press: jump to the click
					var rect = slider.getBoundingClientRect();
					var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
					setVal(lo + frac * (hi - lo));
				}
				try { slider.setPointerCapture(e.pointerId); } catch (_) {}
				slider.focus();
			});
			slider.addEventListener("pointermove", function (e) {
				if (!drag) { return; }
				var dx = e.clientX - lastX; lastX = e.clientX;
				setVal(parseFloat(slider.value) + dx * perPx * (e.shiftKey ? 0.25 : 1));
			});
			function end(e) {
				if (!drag) { return; }
				drag = false;
				try { slider.releasePointerCapture(e.pointerId); } catch (_) {}
			}
			slider.addEventListener("pointerup", end);
			slider.addEventListener("pointercancel", end);
		}
		enableShiftDrag(coarseSlider, function () { setBaseDays(parseInt(coarseSlider.value, 10)); refresh(); });

		// Fine-slider wrap: when dragged past an end, advance the coarse base by half the
		// fine span so the point that was at the end becomes the new centre, and carry
		// the overshoot as the new (near-centred) fine value. The absolute date stays
		// continuous (base+fine is unchanged by a wrap); the dot snaps back near the
		// middle. Stops wrapping at the global 2030–2130 limits (then just clamps).
		var FINE_HALF = parseFloat(fineSlider.max);     // 182.625 days = half the fine span
		function wrapFine(v) {
			while (v > FINE_HALF && state.baseDays + FINE_HALF <= SPAN_DAYS) {
				state.baseDays += FINE_HALF; v -= FINE_HALF;
			}
			while (v < -FINE_HALF && state.baseDays - FINE_HALF >= 0) {
				state.baseDays -= FINE_HALF; v += FINE_HALF;
			}
			coarseSlider.value = Math.round(state.baseDays);
			return v;
		}
		enableShiftDrag(fineSlider, function () { applyDate(); refresh(); }, wrapFine);

		dateField.addEventListener("change", function () {
			var parts = dateField.value.split("-");
			if (parts.length === 3) {
				var jd = O.julianDate(+parts[0], +parts[1], +parts[2], 0, 0, 0);
				setBaseDays(jd - JD0);
				refresh();
			}
		});
		originSel.addEventListener("change", function () {
			state.origin = originSel.value;
			// retarget the camera to keep the origin neighbourhood in view
			refresh();
		});
		if (destSel) {
			destSel.addEventListener("change", function () {
				state.destination = destSel.value;
				refresh();
			});
		}
		resetBtn.addEventListener("click", function () {
			state.departure = { pro: 0, rad: 0, nrm: 0 };
			state.waypoints = [];
			state.marker = null;
			state.markerFocused = false;
			buildVectorEditor(depVecHost, state.departure, function (axis, mps) {
				state.departure[axis] = mps; refresh();
			});
			setHud("Click the trajectory to place a marker; tick 1/2 to add waypoints.");
			refresh();
		});
		soiToggle.addEventListener("change", function () {
			BODIES.forEach(function (n) { bodyGroups[n].soi.visible = soiToggle.checked; });
		});
		orbitToggle.addEventListener("change", function () {
			BODIES.forEach(function (n) { orbitLines[n].visible = orbitToggle.checked; });
		});
		if (burnVecToggle) { burnVecToggle.addEventListener("change", function () { refresh(); }); }

		// "Create waypoint" shortcuts: 1 -> nearest node, 2 -> burn-made apsis.
		// A placeholder tau is overridden by the snap on the next compute.
		function newWaypoint(snap) {
			return { tau: 120 * DAY, burn: { pro: 0, rad: 0, nrm: 0 }, snap: snap, snapOffset: 0 };
		}
		if (createWp1) {
			createWp1.addEventListener("change", function () {
				if (createWp1.checked) {
					if (state.waypoints.length === 0) { state.waypoints.push(newWaypoint("nodeNearest")); }
				} else {
					state.waypoints = [];        // removing the first drops the second too
				}
				refresh();
			});
		}
		if (createWp2) {
			createWp2.addEventListener("change", function () {
				if (createWp2.checked) {
					if (state.waypoints.length === 1) { state.waypoints.push(newWaypoint("apsis")); }
				} else if (state.waypoints.length >= 2) {
					state.waypoints.length = 1;
				}
				refresh();
			});
		}

		setBaseDays(0);
		refresh();
	}

	// state.waypoints changes need the list rebuilt; hook into refresh via a
	// wrapper that also rebuilds the waypoint cards when their count changes.
	var _refresh = refresh;
	var lastWpCount = -1;
	refresh = function () {
		if (state.waypoints.length !== lastWpCount) {
			lastWpCount = state.waypoints.length;
			buildWaypointList();
		}
		_refresh();
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else { init(); }

})();
