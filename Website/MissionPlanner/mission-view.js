/* Mission Planner — the per-mission view factory (task A1).
 *
 * Everything that belongs to ONE mission lives here: its World + recompute
 * engine, its Three.js frames, its panes, its sidebar cards, its date bar,
 * its stage strip and events bar, and its slice of workspace persistence.
 * The shell (planner.js) creates one instance per mission tab and switches
 * between them with show()/hide(); N instances coexist.
 *
 * Architecture decisions recorded here (see MissionPlannerTasks.md, A1):
 *
 * - ONE RENDERER, SHARED. Browsers cap live WebGL contexts, so the shell
 *   owns the single renderer/canvas and passes it in; show() re-parents the
 *   canvas into this view's scene element, and only the active view's
 *   render() is called. Everything else GPU-side (scenes, cameras, label
 *   layers) is cheap enough to keep per mission.
 *
 * - FRAMES ARE PER-MISSION, not shared-with-per-mission-state. Each view
 *   builds its own helio and Earth-Moon frames (own THREE.Scene, camera,
 *   labels). Sharing scenes would mean swapping each mission's stage view
 *   groups and camera poses in and out on every tab switch, and the module
 *   contract's viewAdded()/draw() hooks assume a group that persists for the
 *   stage's lifetime. A frame's scene is a few spheres, rings and a star
 *   field — duplication is the cheap side of that trade.
 *
 * - WORKSPACE IS KEYED PER MISSION. One localStorage key
 *   (mw-missionplanner-workspace, version 2) holds a { missions: { id ->
 *   { main, cams } } } map; each view reads/writes only its own slot
 *   (read-modify-write, so slots survive each other). A version-1 save from
 *   the single-mission scaffold is adopted as mission "m1"'s slot.
 *
 * The module contract (init/draw/viewAdded, ctx.onResult) is unchanged from
 * the scaffold — see README.md, "Module-contract refinements".
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { createEngine } from "./core/recompute.js";
import { systems } from "../Shared/orbit.js";
import { OrbitalMath } from "../Shared/math-utils.js";
import { LunarEphemeris } from "../Shared/lunar-ephemeris.js";
import { Exchange, encodeFragment } from "../Shared/exchange.js";
import { createCam, updateCamera, bindCameraControls, raycastPickPoint } from "../Shared/sim/camera-controller.js";
import { createDateBar } from "../Shared/sim/date-bar.js";
import {
	createBody, createSunBody, makePoint,
	addLabel as brAddLabel, updateLabels as brUpdateLabels, updateScales as brUpdateScales
} from "../Shared/sim/body-renderer.js";
import { createKeplerOrbitRing, makeArcLine } from "../Shared/sim/orbit-rings.js";
import { createCoastSlider, createEventSlider } from "./ui/phase-slider.js";

var O = OrbitalMath;
var LE = LunarEphemeris;
var AU = 149597870700;            // m per helio scene unit
var U = 1e6;                      // m per Earth-Moon scene unit (1000 km)
var SUN = systems.get("Sun");
var EARTH = systems.get("Earth");
var MOON = systems.get("Moon");
var GM_SUN = SUN.GM;

var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
var SPAN_DAYS = 36525;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

var HELIO_BODIES = ["Mercury", "Venus", "Earth", "Mars", "Ceres", "Vesta", "Psyche", "Jupiter"];

// ---- phase <-> frame mapping (task B1). "departure" is the Earth-Moon
// system, where the departure tech lives; "coast" is the heliocentric leg.
// "arrival" has no frame yet — that's H1 (a generic body-frame factory) +
// H2 (a first arrival module) — so it's absent from PHASE_FRAME and its
// phase button stays disabled until then; PHASES still lists it so the
// rest of the phase machinery (dots, card filtering, workspace save/load)
// is already correct the day H2 lands.
var PHASES = ["departure", "coast", "arrival"];
var PHASE_FRAME = { departure: "body:Earth-Moon", coast: "helio" };
var FRAME_PHASE = { "body:Earth-Moon": "departure", "helio": "coast" };
var PHASE_DOT_RANK = { err: 0, blocked: 1, warn: 2, ok: 3 };   // lower = worse

function dotClassFor(res) {
	return res.status === "ok"
		? (res.warnings.length ? "warn" : "ok")
		: (res.status === "diagnostic" ? "err" : "blocked");
}

// =======================================================================
//  Workspace store: one localStorage key, one slot per mission.
// =======================================================================
var WS_KEY = "mw-missionplanner-workspace";
var LEGACY_MISSION_ID = "m1";   // version-1 saves predate tabs: exactly one
                                // mission existed, and the shell names it "m1"

// The whole file, normalized to version 2. Corrupt/foreign content just
// yields an empty store — the layout falls back to defaults, never throws.
function readWorkspaceStore() {
	var empty = { version: 2, missions: {} };
	try {
		var saved = JSON.parse(localStorage.getItem(WS_KEY));
		if (!saved || typeof saved !== "object") { return empty; }
		if (saved.version === 1) {
			var missions = {};
			missions[LEGACY_MISSION_ID] = { main: saved.main, cams: saved.cams || {} };
			return { version: 2, missions: missions };
		}
		if (saved.version !== 2 || !saved.missions || typeof saved.missions !== "object") {
			return empty;
		}
		return saved;
	} catch (e) { return empty; }
}

function loadWorkspaceSlot(missionId) {
	return readWorkspaceStore().missions[missionId] || null;
}

// Read-modify-write, so one mission saving never clobbers another's slot.
function saveWorkspaceSlot(missionId, slot) {
	var store = readWorkspaceStore();
	store.missions[missionId] = slot;
	try {
		localStorage.setItem(WS_KEY, JSON.stringify(store));
	} catch (e) { /* storage full/blocked: the layout just won't persist */ }
}

// For closing a mission tab (A2): forget its layout along with it.
export function deleteWorkspaceSlot(missionId) {
	var store = readWorkspaceStore();
	delete store.missions[missionId];
	try {
		localStorage.setItem(WS_KEY, JSON.stringify(store));
	} catch (e) { /* ignore */ }
}

// =======================================================================
//  Frames: one THREE.Scene per frame, one camera each; views are panes.
// =======================================================================
function makeStars(radius, count) {
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

function makeLabelLayer() {
	var el = document.createElement("div");
	el.className = "mp-labels";
	return el;
}

// GPU cleanup for dispose(): frames are per-mission, so their geometries,
// materials and texture maps go with them.
function disposeScene(scene) {
	scene.traverse(function (obj) {
		if (obj.geometry) { obj.geometry.dispose(); }
		var mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
		mats.forEach(function (m) {
			if (m.map && m.map.dispose) { m.map.dispose(); }
			if (m.dispose) { m.dispose(); }
		});
	});
}

function buildHelioFrame() {
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

function buildEarthMoonFrame() {
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

// =======================================================================
//  The factory. opts:
//    world      — the mission's World (created/deserialized by the caller)
//    registry   — the shared module registry
//    renderer   — the shell's single THREE.WebGLRenderer
//    container  — element the view's DOM mounts into
//    template   — the <template> holding one mission's chrome (planner.html)
//    missionId  — stable id for workspace keying ("m1", ...)
//    defaultMain — frame id for the main pane when no workspace slot exists
//
//  Returns { world, engine, root, missionId, show, hide, render, resize,
//  dispose }. Only the active (shown) view should have render()/resize()
//  called; the shell must show() another view (or park the canvas) before
//  disposing the one that holds it.
// =======================================================================
export function createMissionView(opts) {
	var world = opts.world;
	var registry = opts.registry;
	var renderer = opts.renderer;
	var missionId = opts.missionId;
	var active = false;

	// ---- DOM: clone the per-mission chrome from the template ----------------
	var root = opts.template.content.firstElementChild.cloneNode(true);
	opts.container.appendChild(root);
	function q(sel) { return root.querySelector(sel); }

	var sceneEl = q(".mp-scene");
	var paneMainEl = q(".mp-pane-main");
	var floatsEl = q(".mp-floats");
	var panelEl = q(".mp-panel");
	var stageStripEl = q(".mp-stage-strip");
	var eventsBarEl = q(".mp-eventsbar");
	var dateBarEl = q(".mp-datebar");
	var coastSliderEl = q(".mp-coast-slider");
	var depSliderEl = q(".mp-dep-slider");
	var phaseBtns = {
		departure: q(".mp-phase-dep"),
		coast: q(".mp-phase-coast"),
		arrival: q(".mp-phase-arr")
	};
	var phaseDotEls = {
		departure: phaseBtns.departure.querySelector(".mp-dot"),
		coast: phaseBtns.coast.querySelector(".mp-dot"),
		arrival: phaseBtns.arrival.querySelector(".mp-dot")
	};

	var engine = createEngine(world, registry);

	var frames = {};   // frameId -> frame record
	frames["helio"] = buildHelioFrame();
	frames["body:Earth-Moon"] = buildEarthMoonFrame();

	// ---- workspace: which frame is main, which phase is active (task B1),
	// camera poses. This mission's slot of the shared localStorage store,
	// never World. phase and main are kept in lockstep (see setPhase) — main
	// is just "the frame the active phase points at" via PHASE_FRAME, except
	// for "arrival", which has no frame yet. -----------------------------------
	var workspace = { main: opts.defaultMain, phase: FRAME_PHASE[opts.defaultMain] || "departure", cams: {} };
	(function loadWorkspace() {
		var saved = loadWorkspaceSlot(missionId);
		if (!saved) { return; }
		if (saved.main && frames[saved.main]) { workspace.main = saved.main; }
		workspace.phase = (typeof saved.phase === "string" && PHASES.indexOf(saved.phase) !== -1)
			? saved.phase : (FRAME_PHASE[workspace.main] || workspace.phase);
		Object.keys(saved.cams || {}).forEach(function (id) {
			var f = frames[id], c = saved.cams[id];
			if (!f || !c) { return; }
			f.cam.radius = c.radius; f.cam.theta = c.theta; f.cam.phi = c.phi;
			f.cam.target.fromArray(c.target);
			f.focusBody = c.focusBody || null;
		});
	})();

	function saveWorkspace() {
		var cams = {};
		Object.keys(frames).forEach(function (id) {
			var f = frames[id];
			cams[id] = { radius: f.cam.radius, theta: f.cam.theta, phi: f.cam.phi,
			             target: f.cam.target.toArray(), focusBody: f.focusBody };
		});
		saveWorkspaceSlot(missionId, { main: workspace.main, phase: workspace.phase, cams: cams });
	}
	window.addEventListener("pagehide", saveWorkspace);

	// ---- panes: the main pane + one float per remaining frame ---------------
	var panes = [];   // [{ el, capEl, frameId, isMain }]

	function setPaneFrame(pane, frameId) {
		pane.frameId = frameId;
		pane.capEl.textContent = frames[frameId].caption;
		pane.el.appendChild(frames[frameId].labelLayer);   // appendChild re-parents
	}

	var mainPane = { el: paneMainEl, capEl: paneMainEl.querySelector(".mp-pane-cap"), frameId: null, isMain: true };
	panes.push(mainPane);

	Object.keys(frames).forEach(function (frameId) {
		if (frameId === workspace.main) { return; }
		var el = document.createElement("div");
		el.className = "mp-pane mp-float";
		var cap = document.createElement("span");
		cap.className = "mp-pane-cap";
		el.appendChild(cap);
		el.title = "Make main view";
		floatsEl.appendChild(el);
		var pane = { el: el, capEl: cap, frameId: null, isMain: false };
		el.addEventListener("click", function () { swapMain(pane.frameId); });
		panes.push(pane);
		setPaneFrame(pane, frameId);
	});
	setPaneFrame(mainPane, workspace.main);

	function syncPhaseButtons() {
		PHASES.forEach(function (p) { phaseBtns[p].classList.toggle("active", workspace.phase === p); });
	}

	// Layout-only: promote a frame to the main pane, demote the current main to
	// the pane the promoted frame came from. No World change, no recompute,
	// no phase change (callers that mean "switch phase" go through setPhase).
	function promoteFrame(frameId) {
		if (frameId === workspace.main || !frames[frameId]) { return; }
		var from = null;
		for (var i = 0; i < panes.length; i++) {
			if (!panes[i].isMain && panes[i].frameId === frameId) { from = panes[i]; }
		}
		var old = workspace.main;
		workspace.main = frameId;
		setPaneFrame(mainPane, frameId);
		if (from) { setPaneFrame(from, old); }
	}

	// Which slider shows: Coast gets the date-scaled coast slider (B2),
	// Departure gets the event-scaled flight slider (B3); each phase's slider
	// IS its clock control, so the raw Ephemeris date bar only shows for
	// Arrival, which has no slider yet (until H2).
	function syncSliderVisibility() {
		var phase = workspace.phase;
		depSliderEl.style.display = phase === "departure" ? "" : "none";
		coastSliderEl.style.display = phase === "coast" ? "" : "none";
		dateBarEl.style.display = (phase === "departure" || phase === "coast") ? "none" : "";
	}

	// The phase selectors (task B1): drives the main-pane frame (via
	// PHASE_FRAME — "arrival" has none yet, so it's a no-op there until H2),
	// which sidebar cards show (applyPhaseToCards), which slider shows
	// (syncSliderVisibility, task B2), and the active highlight.
	function setPhase(phase) {
		if (PHASES.indexOf(phase) === -1 || phase === workspace.phase) { return; }
		workspace.phase = phase;
		var frameId = PHASE_FRAME[phase];
		if (frameId) { promoteFrame(frameId); }
		syncPhaseButtons();
		applyPhaseToCards();
		syncSliderVisibility();
		saveWorkspace();
	}

	// A float pane's click promotes it to main; per the mockup, that's also
	// how the mockup treats floats — an alternate way to switch phase, not
	// just layout. If the frame maps to a phase (all of them do today),
	// switching to that phase does the promotion too.
	function swapMain(frameId) {
		var phase = FRAME_PHASE[frameId];
		if (phase) { setPhase(phase); return; }
		promoteFrame(frameId);
		saveWorkspace();
	}

	PHASES.forEach(function (p) {
		phaseBtns[p].addEventListener("click", function () { setPhase(p); });
	});
	syncPhaseButtons();
	syncSliderVisibility();

	// ---- share link: THIS mission's World, through the same fragment encoding
	// the load path reads. Copying, not navigating — the URL is the artifact.
	var shareBtn = q(".mp-share");
	shareBtn.addEventListener("click", function () {
		var url = location.origin + location.pathname + "#mission=" + encodeFragment(world.serialize());
		navigator.clipboard.writeText(url).then(function () {
			shareBtn.textContent = "Copied!";
			setTimeout(function () { shareBtn.textContent = "Copy mission link"; }, 1600);
		}, function () {
			// clipboard blocked: show the link so it can be copied by hand
			window.prompt("Copy the mission link:", url);
		});
	});

	// ---- camera controls: bound once, on this view's main pane; the config
	// follows whichever frame is main (floats are click-to-swap only) ----------
	var unbindCamera = bindCameraControls(paneMainEl, function () {
		var f = frames[workspace.main];
		return {
			cam: f.cam, camera: f.camera,
			zoomMin: f.zoomMin, zoomMax: f.zoomMax,
			pickPoint: function (e) {
				return raycastPickPoint(f.camera, paneMainEl, e,
					{ meshes: f.pickMeshes, soiSpheres: f.pickSoiSpheres });
			},
			onPan: function () { f.focusBody = null; }
		};
	});

	// ---- module views: a scoped THREE.Group per (stage, matching frame),
	// parented at the attachesTo body's node when the frame has it. ------------
	var stageViews = {};   // stageId -> [{ frame, group, stageId, metresPerUnit }]

	world.stages().forEach(function (stage) {
		var desc = registry.get(stage.moduleId);
		if (!desc || !Array.isArray(desc.rendersIn)) { return; }
		stageViews[stage.id] = [];
		desc.rendersIn.forEach(function (frameId) {
			var frame = frames[frameId];
			if (!frame) { return; }
			var group = new THREE.Group();
			var parent = (desc.attachesTo && frame.bodyNode(desc.attachesTo)) || frame.scene;
			parent.add(group);
			var view = { frame: frameId, group: group, stageId: stage.id, metresPerUnit: frame.metresPerUnit };
			if (typeof desc.viewAdded === "function") { desc.viewAdded(view); }
			stageViews[stage.id].push(view);
		});
	});

	function drawStage(res) {
		var desc = registry.get(res.moduleId);
		if (!desc || typeof desc.draw !== "function") { return; }
		var stage = world.getStage(res.stageId);
		if (!stage) { return; }
		(stageViews[res.stageId] || []).forEach(function (view) {
			desc.draw(view, { world: world, stageId: res.stageId, params: stage.params, result: res });
		});
	}

	// ---- sidebar: one card per stage; the module builds its own controls in
	// the card body, the shell renders status chips and diagnostics uniformly.
	var cards = {};   // stageId -> { cardEl, chipEl, diagEl, phase, callbacks: [fn] }

	function stageTitle(stage) {
		var desc = registry.get(stage.moduleId);
		return desc ? desc.title : stage.moduleId;
	}

	// Which phase "owns" a stage's card (task B1): whichever phase's frame is
	// among the stage's rendersIn (a stage attached to the Earth-Moon frame is
	// departure tech, one attached to helio is the coast leg). A stage that
	// doesn't map to a known phase's frame always shows, rather than vanishing
	// from the sidebar.
	function stagePhaseOf(stage) {
		var desc = registry.get(stage.moduleId);
		if (!desc || !Array.isArray(desc.rendersIn)) { return null; }
		for (var i = 0; i < desc.rendersIn.length; i++) {
			var p = FRAME_PHASE[desc.rendersIn[i]];
			if (p) { return p; }
		}
		return null;
	}

	function applyPhaseToCards() {
		Object.keys(cards).forEach(function (stageId) {
			var entry = cards[stageId];
			var show = entry.phase === null || entry.phase === workspace.phase;
			entry.cardEl.style.display = show ? "" : "none";
		});
	}

	world.stages().forEach(function (stage) {
		var desc = registry.get(stage.moduleId);
		var card = document.createElement("div");
		card.className = "mp-card";

		var h = document.createElement("h3");
		var titleSpan = document.createElement("span");
		titleSpan.textContent = stageTitle(stage);
		var chip = document.createElement("span");
		chip.className = "mp-chip";
		h.appendChild(titleSpan); h.appendChild(chip);
		card.appendChild(h);

		var host = document.createElement("div");
		card.appendChild(host);
		var diag = document.createElement("div");
		card.appendChild(diag);
		panelEl.appendChild(card);

		var entry = { cardEl: card, chipEl: chip, diagEl: diag, phase: stagePhaseOf(stage), callbacks: [] };
		cards[stage.id] = entry;

		if (desc && typeof desc.init === "function") {
			desc.init({
				world: world,
				stageId: stage.id,
				panelHost: host,
				exchange: Exchange,
				onResult: function (cb) { entry.callbacks.push(cb); }
			});
		}
	});
	applyPhaseToCards();

	function renderDiagBox(parent, d, cssClass) {
		var box = document.createElement("div");
		box.className = "mp-diag" + (cssClass ? " " + cssClass : "");
		var msg = document.createElement("b");
		msg.textContent = d.message;
		box.appendChild(msg);
		if (d.fix) {
			var fix = document.createElement("div");
			fix.className = "mp-fix";
			fix.textContent = d.fix;
			box.appendChild(fix);
		}
		parent.appendChild(box);
	}

	function updateCard(res) {
		var entry = cards[res.stageId];
		if (!entry) { return; }
		var chip = entry.chipEl, diag = entry.diagEl;
		diag.innerHTML = "";

		if (res.status === "ok" && res.warnings.length === 0) {
			chip.className = "mp-chip ok"; chip.textContent = "ok";
		} else if (res.status === "ok") {
			chip.className = "mp-chip warn";
			chip.textContent = res.warnings.length + " warning" + (res.warnings.length > 1 ? "s" : "");
		} else if (res.status === "diagnostic") {
			chip.className = "mp-chip err"; chip.textContent = "problem";
		} else {
			chip.className = "mp-chip blocked"; chip.textContent = "blocked";
		}

		if (res.status === "diagnostic") {
			renderDiagBox(diag, res.diagnostic, "");
		} else if (res.status === "blocked") {
			var up = world.getStage(res.blockedOn);
			renderDiagBox(diag, {
				message: "Blocked — waiting on " + (up ? stageTitle(up) : res.blockedOn) + ".",
				fix: "Parameters are kept; fix the upstream stage and this one recomputes."
			}, "blocked");
		}
		res.warnings.forEach(function (w) { renderDiagBox(diag, w, "warn"); });

		entry.callbacks.forEach(function (cb) { cb(res); });
	}

	// ---- stage strip + events bar (fed by the envelope's events channel) ----
	function renderStageStrip(results) {
		stageStripEl.innerHTML = "";
		results.forEach(function (res) {
			var chip = document.createElement("button");
			chip.type = "button";
			chip.className = "mp-stage-chip";
			var dot = document.createElement("span");
			dot.className = "mp-dot " + dotClassFor(res);
			chip.appendChild(dot);
			var stage = world.getStage(res.stageId);
			chip.appendChild(document.createTextNode(stage ? stageTitle(stage) : res.moduleId));
			chip.addEventListener("click", function () {
				var entry = cards[res.stageId];
				if (entry) { entry.cardEl.scrollIntoView({ behavior: "smooth", block: "start" }); }
			});
			stageStripEl.appendChild(chip);
		});
	}

	// Phase-button dots (task B1): the worst status among a phase's stages
	// (err worse than blocked worse than warn worse than ok); a phase with no
	// stages mapped to it (arrival, today) keeps the neutral default dot.
	function renderPhaseDots(results) {
		var worst = {};
		results.forEach(function (res) {
			var stage = world.getStage(res.stageId);
			var phase = stage && stagePhaseOf(stage);
			if (!phase) { return; }
			var cls = dotClassFor(res);
			if (!worst[phase] || PHASE_DOT_RANK[cls] < PHASE_DOT_RANK[worst[phase]]) { worst[phase] = cls; }
		});
		PHASES.forEach(function (p) {
			phaseDotEls[p].className = "mp-dot" + (worst[p] ? " " + worst[p] : "");
		});
	}

	function renderEventsBar(results) {
		eventsBarEl.innerHTML = "";
		var events = [];
		results.forEach(function (res) { res.events.forEach(function (e) { events.push(e); }); });
		events.sort(function (a, b) { return a.jd - b.jd; });
		if (events.length === 0) {
			var none = document.createElement("span");
			none.className = "mp-muted";
			none.textContent = "No mission events — stage outputs are blocked or empty.";
			eventsBarEl.appendChild(none);
			return;
		}
		events.forEach(function (e) {
			var d = O.dateFromJulian(e.jd);
			var span = document.createElement("span");
			span.className = "mp-event" + (e.jd <= world.jd ? " past" : "");
			span.title = "Set the clock to this event";
			var b = document.createElement("b");
			b.textContent = d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
			span.appendChild(b);
			span.appendChild(document.createTextNode(e.label));
			span.addEventListener("click", function () { setClock(e.jd); });
			eventsBarEl.appendChild(span);
		});
	}

	// ---- the mission's clock: Shared/sim/date-bar.js writing world.set({jd})
	function shortDate(jd) { var d = O.dateFromJulian(jd); return MONTHS[d.Mo - 1] + " " + d.Y; }
	// A finer stamp for the departure slider — its flight milestones can sit
	// hours apart, which a month-year label would collapse.
	function pad2(n) { return String(n).padStart(2, "0"); }
	function shortStamp(jd) {
		var d = O.dateFromJulian(jd);
		return MONTHS[d.Mo - 1] + " " + d.D + " " + pad2(d.h) + ":" + pad2(d.m);
	}

	var dateState = { jd: world.jd, baseDays: 0 };
	var dateBar = createDateBar(dateState, {
		coarseSlider: q(".mp-date-coarse"),
		fineSlider: q(".mp-date-fine"),
		fineLoLabel: q(".mp-fine-lo"),
		fineHiLabel: q(".mp-fine-hi"),
		dateField: q(".mp-date-field"),
		jdLabel: q(".mp-jd"),
		jd0: JD0,
		spanDays: SPAN_DAYS,
		shortDate: shortDate
	});
	dateBar.bind(function () { world.set({ jd: dateState.jd }); });

	function setClock(jd) {
		dateBar.setBaseDays(jd - JD0);
		world.set({ jd: dateState.jd });
	}

	// ---- the Coast slider (task B2): date-scaled, spanning the departure
	// and coast phases' own events (coastSpan) — see ui/phase-slider.js.
	var coastSlider = createCoastSlider(coastSliderEl, { onSetJd: setClock, shortDate: shortDate });

	// The coast span: earliest-to-latest jd among events emitted by
	// departure/coast-phase stages this recompute pass (release, departure
	// burn, waypoint burns, leg-ends — whatever's live today). Deliberately
	// NOT the frozen plan (C1 doesn't exist yet) — it tracks the current
	// params, same as everything else pre-comply-mode.
	function coastSpan(results) {
		var jds = [];
		results.forEach(function (res) {
			var stage = world.getStage(res.stageId);
			var phase = stage && stagePhaseOf(stage);
			if (phase !== "departure" && phase !== "coast") { return; }
			res.events.forEach(function (e) { jds.push(e.jd); });
		});
		if (!jds.length) { return null; }
		return { start: Math.min.apply(null, jds), end: Math.max.apply(null, jds) };
	}

	// ---- the Departure slider (task B3): event-scaled, spanning the ship's
	// flight from release to the heliocentric hand-off. Its segments are the
	// gaps between the departure-phase stages' flight events.
	var depSlider = createEventSlider(depSliderEl, {
		onSetJd: setClock, stamp: shortStamp,
		caption: "DEPARTURE — event-scaled (not linear time)"
	});

	// The departure phase's flight events (release, Moon-SOI exit, Earth-SOI
	// exit today). Flight-only: an event flagged flight:false (pre-launch or
	// post-catch — none emitted yet) is kept off the flight scrubber.
	function departureEvents(results) {
		var evs = [];
		results.forEach(function (res) {
			var stage = world.getStage(res.stageId);
			if (!stage || stagePhaseOf(stage) !== "departure") { return; }
			res.events.forEach(function (e) { if (e.flight !== false) { evs.push(e); } });
		});
		return evs;
	}

	// ---- wiring: World changes place bodies; engine passes redraw the rest --
	function placeAll(jd) {
		Object.keys(frames).forEach(function (id) { frames[id].place(jd); });
	}

	var unWorld = world.onChange(function (info) {
		if (info.change.jd !== undefined) { placeAll(world.jd); }
	});

	var unRecompute = engine.onRecompute(function (results) {
		results.forEach(function (res) {
			drawStage(res);
			updateCard(res);
		});
		renderStageStrip(results);
		renderPhaseDots(results);
		renderEventsBar(results);
		var span = coastSpan(results);
		coastSlider.update({ start: span ? span.start : NaN, end: span ? span.end : NaN, jd: world.jd });
		depSlider.update(departureEvents(results), world.jd);
	});

	// ---- rendering: the shared renderer, scissored per pane, only while this
	// view is the active tab (main first, floats above). ----------------------
	function renderPane(pane, canvasRect) {
		var frame = frames[pane.frameId];
		var r = pane.el.getBoundingClientRect();
		var w = r.width, h = r.height;
		if (w < 2 || h < 2) { return; }
		var x = r.left - canvasRect.left;
		var y = canvasRect.height - (r.top - canvasRect.top + h);   // GL origin: bottom-left

		frame.camera.aspect = w / h;
		frame.camera.updateProjectionMatrix();
		updateCamera(frame.camera, frame.cam);
		brUpdateScales(frame.camera, pane.el, frame.scaleList, { wantSOI: frame.wantSOI });
		brUpdateLabels(frame.camera, pane.el, frame.labelList);

		renderer.setViewport(x, y, w, h);
		renderer.setScissor(x, y, w, h);
		renderer.render(frame.scene, frame.camera);
	}

	function render() {
		if (!active) { return; }
		var canvasRect = renderer.domElement.getBoundingClientRect();
		renderPane(mainPane, canvasRect);
		for (var i = 0; i < panes.length; i++) {
			if (!panes[i].isMain) { renderPane(panes[i], canvasRect); }
		}
	}

	function resize() {
		var w = sceneEl.clientWidth || 600, h = sceneEl.clientHeight || 400;
		renderer.setSize(w, h, false);
	}

	function show() {
		root.classList.add("on");
		// appendChild re-parents: the canvas simply leaves the previous tab
		sceneEl.insertBefore(renderer.domElement, sceneEl.firstChild);
		active = true;
		resize();
	}

	function hide() {
		root.classList.remove("on");
		active = false;
	}

	function dispose() {
		saveWorkspace();
		window.removeEventListener("pagehide", saveWorkspace);
		unWorld();
		unRecompute();
		engine.dispose();
		unbindCamera();
		coastSlider.dispose();
		depSlider.dispose();
		active = false;
		// The canvas is the shell's; hand it back rather than letting root
		// removal orphan it (the caller normally show()s another view first).
		if (renderer.domElement.parentNode === sceneEl) {
			sceneEl.removeChild(renderer.domElement);
		}
		Object.keys(frames).forEach(function (id) { disposeScene(frames[id].scene); });
		root.remove();
	}

	// ---- go: one initial set aligns the clock to the slider's day grid and
	// fires the first recompute/draw pass through normal wiring. --------------
	dateBar.setBaseDays(world.jd - JD0);
	world.set({ jd: dateState.jd });
	placeAll(world.jd);

	return {
		world: world,
		engine: engine,
		root: root,
		missionId: missionId,
		show: show,
		hide: hide,
		render: render,
		resize: resize,
		dispose: dispose
	};
}
