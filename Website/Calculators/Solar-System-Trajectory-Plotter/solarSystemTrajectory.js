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
import { createCam, updateCamera, bindCameraControls, raycastPickPoint } from "../../Shared/sim/camera-controller.js";
import { createDateBar } from "../../Shared/sim/date-bar.js";
import {
	createBody, createSunBody,
	addLabel as brAddLabel, updateLabels as brUpdateLabels, updateScales as brUpdateScales,
	worldSizeAtPointForPx
} from "../../Shared/sim/body-renderer.js";
import { createKeplerOrbitRing } from "../../Shared/sim/orbit-rings.js";
import {
	makeRingSprite, applyTierToSprite, scaleApproachMark, pickProximityTier
} from "../../Shared/sim/approach-markers.js";
import { createWaypointGizmo, makeBurnArrow as burnWidgetArrow } from "../../Shared/sim/burn-widget.js";
import { renderReadoutBoxes as readoutRender, positionReadoutBoxes as readoutPosition } from "../../Shared/sim/readout-panes.js";
import {
	makeShipSprite, makeXMarkSprite, orientMarkerSprite,
	markerFraction as mcMarkerFraction, sweepAngleFrom, phasingDays as mcPhasingDays,
	refineApproach as mcRefineApproach, followCrossing as mcFollowCrossing,
	buildMarkerCard as mcBuildMarkerCard, updateMarkerModeButtons as mcUpdateMarkerModeButtons,
	fmtKm, fmtTof, fmtDate
} from "../../Shared/sim/marker-card.js";

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

	// camera spherical state around `target` (Shared/sim/camera-controller.js)
	var cam = createCam(6, 0.6, 1.1, new THREE.Vector3(0, 0, 0));
	var pickMeshes = [], pickSoiSpheres = [];   // built once in initScene, for cursor-centred zoom

	// A body/SOI sphere is drawn only while its projected radius is at least a
	// pixel or two; below that it collapses to a single bright on-orbit pixel
	// (thresholds and the per-frame pass live in Shared/sim/body-renderer.js).

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
		var sunBody = createSunBody(scene, scaleList, { sys: sunSys, AU: AU });
		sunGroup = sunBody.group;
		addLabel("Sun", sunGroup);

		// bodies + orbits — everything at true scale
		BODIES.forEach(function (name) {
			var sys = systems.get(name);
			var b = createBody(scene, scaleList, name, { sys: sys, AU: AU, primaryMass: SUN_MASS });
			bodyGroups[name] = { group: b.group, core: b.core, soi: b.soi, point: b.point };
			addLabel(name, b.group);

			var line = createKeplerOrbitRing({
				orbit: sys.orbit, GM: GM_SUN, color: new THREE.Color(sys.color || "#bcc3d0"), AU: AU });
			scene.add(line);
			orbitLines[name] = line;
		});

		// Cursor-centred zoom targets: every body's core mesh (direct hit), plus
		// its SOI as a fallback "head toward this body" zone (the Sun has none —
		// soiAU 0 — so it's raycastable but has no fallback zone). scaleList
		// entries hold live references, so these lists stay correct as bodies move.
		for (var pi = 0; pi < scaleList.length; pi++) {
			var pb = scaleList[pi];
			pickMeshes.push(pb.core);
			if (pb.soiAU > 0) {
				pickSoiSpheres.push({ center: pb.group.position, radius: pb.soiAU, nearFaceRadius: pb.radiusAU });
			}
		}

		resize();
		window.addEventListener("resize", resize);
		bindCameraControls(renderer.domElement, getCameraView);
		animate();
	}

	// ---- camera controls (Shared/sim/camera-controller.js) -----------------
	// Single view, so the config object never changes; bindCameraControls()
	// still calls getCameraView() fresh on every event (dual-view plotters
	// rely on that to switch between local/Helio configs).
	var cameraView = {
		cam: null, camera: null,     // filled in below once `cam`/`camera` exist
		zoomMin: 1e-4, zoomMax: 500,
		pickPoint: function (e) {
			return raycastPickPoint(camera, renderer.domElement, e, { meshes: pickMeshes, soiSpheres: pickSoiSpheres });
		},
		lockedZoomTarget: function () {
			return (state.markerFocused && markerSprite && markerSprite.visible) ? markerSprite.position : null;
		},
		onFreeZoom: function () { state.focus = null; },   // scrolling always releases a body lock
		onPan: function () { state.focus = null; state.markerFocused = false; },
		onPick: function (e) { handlePick(e); },
		onDoubleClick: function (e) { focusNearest(e); }
	};
	function getCameraView() {
		cameraView.cam = cam;
		cameraView.camera = camera;
		return cameraView;
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

	// Create a floating HTML label tied to an object's world position
	// (Shared/sim/body-renderer.js).
	function addLabel(name, group) {
		brAddLabel(labelLayer, labelList, name, group, "sst-label");
	}

	function groupOf(name) {
		return name === "Sun" ? sunGroup : (bodyGroups[name] && bodyGroups[name].group);
	}

	// A prograde / radial / normal gizmo at a waypoint (Shared/sim/burn-widget.js).
	function makeWaypointGizmo(point) {
		return createWaypointGizmo(point.r, point.v,
			new THREE.Vector3(point.r[0]/AU, point.r[1]/AU, point.r[2]/AU));
	}

	// Keep each waypoint gizmo ~42 px long regardless of zoom.
	function updateGizmos() {
		for (var i = 0; i < wpMarkers.length; i++) {
			var g = wpMarkers[i];
			g.scale.setScalar(worldSizeAtPointForPx(camera, holder, g.position, 42));
		}
		if (markerSprite && markerSprite.visible) {
			markerSprite.scale.setScalar(worldSizeAtPointForPx(camera, holder, markerSprite.position, 26));
			// point the ship along its screen-space heading (Shared/sim/marker-card.js)
			if (markerVelDir) { orientMarkerSprite(camera, markerSprite, markerVelDir); }
		}
		if (destSprite && destSprite.visible) {
			destSprite.scale.setScalar(worldSizeAtPointForPx(camera, holder, destSprite.position, 22));
		}
		// Shared/sim/approach-markers.js.
		if (tempRing && tempRing.visible) { scaleApproachMark(camera, holder, tempRing); }
		for (var j = 0; j < orbitApproachMarks.length; j++) { scaleApproachMark(camera, holder, orbitApproachMarks[j]); }
	}

	// Per-frame: show each body / SOI as a real sphere when big enough on
	// screen, otherwise collapse it to its bright pixel (Shared/sim/body-renderer.js).
	function updateScales() {
		brUpdateScales(camera, holder, scaleList, { wantSOI: soiToggle.checked });
	}

	// Per-frame: place each name label beside its body in screen space
	// (Shared/sim/body-renderer.js).
	function updateLabels() {
		brUpdateLabels(camera, holder, labelList);
	}

	// ---- camera controls: Shared/sim/camera-controller.js (see `cameraView`
	// / `getCameraView` above, wired up in initScene) -------------------------

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
		updateCamera(camera, cam);
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

	// One arrow for a velocity-like vector (m/s) anchored at world point r (m)
	// (Shared/sim/burn-widget.js). Length is BURN_VEC_SCALE AU per km/s.
	function makeBurnArrow(r, vec, colorHex) {
		var origin = new THREE.Vector3(r[0] / AU, r[1] / AU, r[2] / AU);
		return burnWidgetArrow(origin, vec, colorHex, BURN_VEC_SCALE);
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

	// Rebuild the readout boxes from a list of { host, data } (data may be null).
	function renderBurnReadouts(entries) {
		readoutBoxes = readoutRender(readoutLayer, readoutBoxes, entries,
			{ classPrefix: "sst", dvHex: dvHex, spdHex: spdHex });
		positionBurnReadouts();
	}

	// Place each readout box straddling the panel's left edge, vertically centred
	// on its burn widget. Hidden when its widget is scrolled out of the panel.
	function positionBurnReadouts() {
		readoutPosition(readoutBoxes, mainEl, panelEl);
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
	// Shared/sim/approach-markers.js.
	function makeApproachRing(tier) {
		var st = APPROACH_TIERS[tier] || APPROACH_TIERS[0];
		return makeRingSprite({ lineWidth: st.lw, color: st.color, opacity: st.opacity,
			px: st.px, worldR: st.worldR, renderOrder: 14 });
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
	// by the polyline spacing (Shared/sim/marker-card.js's refineApproach, also
	// used by followCrossing() below).
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
					var r = mcRefineApproach(orbit, stateAtGlobalTime, trajSamples[m-1].t, trajSamples[m+1].t);
					var tier = r ? pickProximityTier(r.dist, APPROACH_FAR, APPROACH_NEAR, APPROACH_CLOSE) : -1;
					if (tier >= 0) {
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
	// Sprite factories (the ship chevron, the destination 'x') live in
	// Shared/sim/marker-card.js as makeShipSprite/makeXMarkSprite.

	// A temporal-proximity ring around the ship (one blue texture; tier sets
	// colour/opacity/size). Held at constant on-screen size by updateGizmos().
	function makeTempRing() { return makeRingSprite({ lineWidth: 7, px: 30, renderOrder: 13 }); }

	// markerFraction, fmtKm/fmtTof/fmtDate: Shared/sim/marker-card.js.

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

	// Heliocentric angle (deg, 0–360) swept around the Sun from the departure point
	// (the trajectory start = origin body at the departure date) to a point r (m).
	// Shared/sim/marker-card.js's sweepAngleFrom, given the departure r0/v0.
	function sweptFromOrigin(r) {
		if (!trajSegs.length) { return 0; }
		return sweepAngleFrom(trajSegs[0].r0, trajSegs[0].v0, r);
	}

	// Keep the marker glued to the destination-orbit crossing while it is inside an
	// encounter ring; freeze (do nothing) when out of range (Shared/sim/marker-card.js's
	// followCrossing). Drives state.marker.f0/angle. Used by Track mode and by released
	// Target mode.
	function followCrossing() {
		if (!state.marker || !trajSegs.length) { return; }
		var dn = state.destination;
		if (!dn || dn === "(none)" || dn === state.origin) { return; }
		var orbit = systems.get(dn).orbit;
		mcFollowCrossing(state.marker, orbit, trajTotalT, trajSamples.length, stateAtGlobalTime, APPROACH_FAR);
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
			var tof = mcMarkerFraction(m.f0, m.angle) * trajTotalT;
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
		if (!destSprite) { destSprite = makeXMarkSprite(); destSprite.renderOrder = 13; scene.add(destSprite); }
		destSprite.visible = true;
		destSprite.material.color.set(systems.get(dn).color || "#ffffff");
		destSprite.position.set(b.r[0] / AU, b.r[1] / AU, b.r[2] / AU);

		var nearOrbit = orbit.e < 1 && O.distanceToOrbit(orbit, markerR) < APPROACH_FAR;
		if (nearOrbit) {
			var dt = mcPhasingDays(GM_SUN, orbit, markerR, arrJd);
			markerValPhase.textContent = (dt >= 0 ? "+" : "−") + Math.abs(dt).toFixed(1) + " d";
			var ad = Math.abs(dt);
			var tier = pickProximityTier(ad, TEMP_FAR, TEMP_NEAR, TEMP_CLOSE);
			if (tier >= 0) {
				if (!tempRing) { tempRing = makeTempRing(); scene.add(tempRing); }
				applyTierToSprite(tempRing, TEMPORAL_TIERS[tier]);
				tempRing.visible = true;
				if (markerSprite) { tempRing.position.copy(markerSprite.position); }
			} else if (tempRing) { tempRing.visible = false; }
		} else {
			markerValPhase.textContent = "—";
			if (tempRing) { tempRing.visible = false; }
		}
	}

	function updateMarkerModeButtons() {
		mcUpdateMarkerModeButtons(markerModeBtns, "sst", state.marker && state.marker.mode);
	}

	// Build the top-left marker card (once), via Shared/sim/marker-card.js.
	// Holds the slider, the Free/Track/Target selector, and the readouts.
	function buildMarkerCard() {
		var built = mcBuildMarkerCard({
			classPrefix: "sst",
			hostEl: viewEl || document.body,
			sliderTitle: "drag to slide the marker along the whole path (0° = where you clicked); "
				+ "~10× more mouse travel than the track for fine control, ×4 finer again with Shift. "
				+ "Arrow keys nudge by ⅓° (¹⁄₁₂° with Shift) when focused.",
			modeTitles: {
				free: "slide the marker freely",
				track: "follow the destination orbit crossing while within an encounter ring (burns fixed)",
				target: "re-solve the terminal burn (Lambert) to hold the encounter as the date scrubs; releases above the Δv budget"
			},
			rows: [
				{ key: "rad", label: "radius" },
				{ key: "spd", label: "prograde velocity" },
				{ key: "lat", label: "ecliptic latitude" },
				{ key: "deg", label: "radial from origin" },
				{ key: "tof", label: "time of flight" },
				{ key: "arr", label: "arrival date" },
				{ key: "phase", label: "phasing" }
			],
			getAngle: function () { return state.marker ? state.marker.angle : 0; },
			onSliderChange: function (a) { if (state.marker) { state.marker.angle = a; updateMarker(); } },
			onRemove: function () { removeMarker(); },
			onModeClick: function (mode) { setMarkerMode(mode); },
			onBudgetChange: function (dvBudget) { if (state.marker) { state.marker.dvBudget = dvBudget; refresh(); } }
		});
		markerCard = built.el;
		markerSlider = built.slider;
		markerModeBtns = built.modeBtns;
		markerValRad = built.vals.rad; markerValRadKm = built.vals.radKm;
		markerValSpd = built.vals.spd; markerValLat = built.vals.lat; markerValDeg = built.vals.deg;
		markerValTof = built.vals.tof; markerValArr = built.vals.arr; markerValPhase = built.vals.phase;
		markerBudgetRow = built.budgetRow; markerBudgetInput = built.budgetInput;
		markerTdvRow = built.tdvRow; markerValTdv = built.valTdv;
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

		var f = mcMarkerFraction(state.marker.f0, state.marker.angle);
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

	// ---- date model: Shared/sim/date-bar.js (see `dateBar` below, bound in init) ----
	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
	              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	function shortDate(jd) { var d = O.dateFromJulian(jd); return MONTHS[d.Mo - 1] + " " + d.Y; }
	var dateBar = createDateBar(state, {
		coarseSlider: coarseSlider, fineSlider: fineSlider,
		fineLoLabel: fineLo, fineHiLabel: fineHi,
		dateField: dateField, jdLabel: jdLabel,
		jd0: JD0, spanDays: SPAN_DAYS, shortDate: shortDate
	});

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

		dateBar.bind(refresh);

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

		dateBar.setBaseDays(0);
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
