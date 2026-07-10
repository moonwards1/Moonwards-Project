/* Mission Planner — the step-4.3 scaffold shell.
 *
 * A deliberately plain UI over the headless core (core/world.js +
 * core/registry.js + core/recompute.js): ONE renderer with scissored views
 * (a main pane plus floating, swappable panes, each rendering one frame),
 * ONE shared date bar driving world.set({jd}), and sidebar cards hosting the
 * first two modules — the lunar skyhook (technology) and the transfer leg
 * (the SST compute core). The scaffold is disposable; World is the boundary
 * that makes rebuilding it safe. See Website/ARCHITECTURE.md, "Migration
 * path" step 4.3, and MissionPlannerDesign.md (phase buttons per the chosen
 * step-4.2 mockup A).
 *
 * Layout / view state ("workspace") lives here and in localStorage, never in
 * World: which frame is in the main pane, camera poses. Swapping a floating
 * pane into the main window is layout-only — no World change, no recompute.
 *
 * Deviations from the ARCHITECTURE.md module-interface sketch, recorded in
 * MissionPlanner/README.md: update() stays pure (Node-testable) and modules
 * instead expose a draw(view, snapshot) hook the shell calls after each
 * recompute pass; ctx gains onResult(cb) so a module's card can refresh its
 * readouts from that stage's engine result.
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { createWorld } from "./core/world.js";
import { createRegistry } from "./core/registry.js";
import { createEngine } from "./core/recompute.js";
import { systems } from "../Shared/orbit.js";
import { OrbitalMath } from "../Shared/math-utils.js";
import { LunarEphemeris } from "../Shared/lunar-ephemeris.js";
import { Exchange } from "../Shared/exchange.js";
import { createCam, updateCamera, bindCameraControls, raycastPickPoint } from "../Shared/sim/camera-controller.js";
import { createDateBar } from "../Shared/sim/date-bar.js";
import {
	createBody, createSunBody, makePoint,
	addLabel as brAddLabel, updateLabels as brUpdateLabels, updateScales as brUpdateScales
} from "../Shared/sim/body-renderer.js";
import { createKeplerOrbitRing, makeArcLine } from "../Shared/sim/orbit-rings.js";

var O = OrbitalMath;
var LE = LunarEphemeris;
var AU = 149597870700;            // m per helio scene unit
var U = 1e6;                      // m per Earth-Moon scene unit (1000 km)
var DAY = 86400;
var SUN = systems.get("Sun");
var EARTH = systems.get("Earth");
var MOON = systems.get("Moon");
var GM_SUN = SUN.GM;

var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
var SPAN_DAYS = 36525;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var WS_KEY = "mw-missionplanner-workspace";

var HELIO_BODIES = ["Mercury", "Venus", "Earth", "Mars", "Ceres", "Vesta", "Psyche", "Jupiter"];

// ---- modules (dynamic import per the architecture: a technology's code is
// fetched when activated; the scaffold's default mission activates both) ----
var MODULE_URLS = [
	"./modules/lunar-skyhook/lunar-skyhook.js",
	"./modules/transfer-leg/transfer-leg.js"
];
var registry = createRegistry();
var loaded = await Promise.all(MODULE_URLS.map(function (u) { return import(u); }));
loaded.forEach(function (m) { registry.register(m.default); });

// ---- World: the default mission (the curated worked example is step 4.4;
// this is just a sensible feasible chain) -----------------------------------
var JD_RELEASE = O.julianDate(2033, 5, 14, 6, 0, 0);
var world = createWorld({ jd: JD_RELEASE });
var skyhookStageId = world.set({ addStage: { moduleId: "lunar-skyhook", params: {
	comAlt: 275e3, topAlt: 6000e3, relAlt: 950e3, releaseJd: JD_RELEASE } } });
var legStageId = world.set({ addStage: { moduleId: "transfer-leg", params: {
	burn: { pro: 3000, rad: 0, nrm: 0 }, waypoints: [], legDays: 480, destination: "Ceres" } } });
var engine = createEngine(world, registry);

// ---- DOM refs ---------------------------------------------------------------
var sceneEl = document.getElementById("mp-scene");
var paneMainEl = document.getElementById("mp-pane-main");
var floatsEl = document.getElementById("mp-floats");
var panelEl = document.getElementById("mp-panel");
var stageStripEl = document.getElementById("mp-stage-strip");
var eventsBarEl = document.getElementById("mp-eventsbar");
var phaseBtns = {
	"body:Earth-Moon": document.getElementById("mp-phase-dep"),
	"helio": document.getElementById("mp-phase-coast")
};

// =======================================================================
//  Frames: one THREE.Scene per frame, one camera each; views are panes.
// =======================================================================
var renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setScissorTest(true);
sceneEl.insertBefore(renderer.domElement, sceneEl.firstChild);

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

var frames = {};   // frameId -> frame record

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

frames["helio"] = buildHelioFrame();
frames["body:Earth-Moon"] = buildEarthMoonFrame();

// =======================================================================
//  Workspace: which frame is main, camera poses. localStorage, never World.
// =======================================================================
var workspace = { version: 1, main: "body:Earth-Moon", cams: {} };
(function loadWorkspace() {
	try {
		var saved = JSON.parse(localStorage.getItem(WS_KEY));
		if (!saved || saved.version !== 1) { return; }
		if (saved.main && frames[saved.main]) { workspace.main = saved.main; }
		Object.keys(saved.cams || {}).forEach(function (id) {
			var f = frames[id], c = saved.cams[id];
			if (!f || !c) { return; }
			f.cam.radius = c.radius; f.cam.theta = c.theta; f.cam.phi = c.phi;
			f.cam.target.fromArray(c.target);
			f.focusBody = c.focusBody || null;
		});
	} catch (e) { /* a corrupt workspace just falls back to defaults */ }
})();

function saveWorkspace() {
	var cams = {};
	Object.keys(frames).forEach(function (id) {
		var f = frames[id];
		cams[id] = { radius: f.cam.radius, theta: f.cam.theta, phi: f.cam.phi,
		             target: f.cam.target.toArray(), focusBody: f.focusBody };
	});
	try {
		localStorage.setItem(WS_KEY, JSON.stringify({ version: 1, main: workspace.main, cams: cams }));
	} catch (e) { /* storage full/blocked: the layout just won't persist */ }
}
window.addEventListener("pagehide", saveWorkspace);

// ---- panes: the main pane + one float per remaining frame -----------------
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
	Object.keys(phaseBtns).forEach(function (frameId) {
		phaseBtns[frameId].classList.toggle("active", workspace.main === frameId);
	});
}

// Layout-only: promote a frame to the main pane, demote the current main to
// the pane the promoted frame came from. No World change, no recompute.
function swapMain(frameId) {
	if (frameId === workspace.main || !frames[frameId]) { return; }
	var from = null;
	for (var i = 0; i < panes.length; i++) {
		if (!panes[i].isMain && panes[i].frameId === frameId) { from = panes[i]; }
	}
	var old = workspace.main;
	workspace.main = frameId;
	setPaneFrame(mainPane, frameId);
	if (from) { setPaneFrame(from, old); }
	syncPhaseButtons();
	saveWorkspace();
}

phaseBtns["body:Earth-Moon"].addEventListener("click", function () { swapMain("body:Earth-Moon"); });
phaseBtns["helio"].addEventListener("click", function () { swapMain("helio"); });
syncPhaseButtons();

// ---- camera controls: bound once, on the main pane; the config follows
// whichever frame is main (floats are click-to-swap only — the doc's
// "small panes can start camera-only" polish note, taken further) ----------
bindCameraControls(paneMainEl, function () {
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

// =======================================================================
//  Module views: a scoped THREE.Group per (stage, matching frame), parented
//  at the attachesTo body's node when the frame has it.
// =======================================================================
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

// =======================================================================
//  Sidebar: one card per stage; the module builds its own controls in the
//  card body, the shell renders status chips and diagnostics uniformly.
// =======================================================================
var cards = {};   // stageId -> { chipEl, diagEl, callbacks: [fn] }

function stageTitle(stage) {
	var desc = registry.get(stage.moduleId);
	return desc ? desc.title : stage.moduleId;
}

world.stages().forEach(function (stage) {
	var desc = registry.get(stage.moduleId);
	var card = document.createElement("div");
	card.className = "mp-card";
	card.id = "mp-card-" + stage.id;

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

	var entry = { chipEl: chip, diagEl: diag, callbacks: [] };
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

// =======================================================================
//  Stage strip + events bar (fed by the envelope's events channel)
// =======================================================================
function renderStageStrip(results) {
	stageStripEl.innerHTML = "";
	results.forEach(function (res) {
		var chip = document.createElement("button");
		chip.type = "button";
		chip.className = "mp-stage-chip";
		var dot = document.createElement("span");
		var cls = res.status === "ok"
			? (res.warnings.length ? "warn" : "ok")
			: (res.status === "diagnostic" ? "err" : "blocked");
		dot.className = "mp-dot " + cls;
		chip.appendChild(dot);
		var stage = world.getStage(res.stageId);
		chip.appendChild(document.createTextNode(stage ? stageTitle(stage) : res.moduleId));
		chip.addEventListener("click", function () {
			var card = document.getElementById("mp-card-" + res.stageId);
			if (card) { card.scrollIntoView({ behavior: "smooth", block: "start" }); }
		});
		stageStripEl.appendChild(chip);
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

// =======================================================================
//  The shared clock: Shared/sim/date-bar.js writing world.set({jd})
// =======================================================================
var dateState = { jd: world.jd, baseDays: 0 };
var dateBar = createDateBar(dateState, {
	coarseSlider: document.getElementById("mp-date-coarse"),
	fineSlider: document.getElementById("mp-date-fine"),
	fineLoLabel: document.getElementById("mp-fine-lo"),
	fineHiLabel: document.getElementById("mp-fine-hi"),
	dateField: document.getElementById("mp-date-field"),
	jdLabel: document.getElementById("mp-jd"),
	jd0: JD0,
	spanDays: SPAN_DAYS,
	shortDate: function (jd) { var d = O.dateFromJulian(jd); return MONTHS[d.Mo - 1] + " " + d.Y; }
});
dateBar.bind(function () { world.set({ jd: dateState.jd }); });

function setClock(jd) {
	dateBar.setBaseDays(jd - JD0);
	world.set({ jd: dateState.jd });
}

// =======================================================================
//  Wiring: World changes place bodies; engine passes redraw everything else.
// =======================================================================
function placeAll(jd) {
	Object.keys(frames).forEach(function (id) { frames[id].place(jd); });
}

world.onChange(function (info) {
	if (info.change.jd !== undefined) { placeAll(world.jd); }
});

engine.onRecompute(function (results) {
	results.forEach(function (res) {
		drawStage(res);
		updateCard(res);
	});
	renderStageStrip(results);
	renderEventsBar(results);
});

// =======================================================================
//  Render loop: one renderer, scissored per pane (main first, floats above).
// =======================================================================
function resize() {
	var w = sceneEl.clientWidth || 600, h = sceneEl.clientHeight || 400;
	renderer.setSize(w, h, false);
}
window.addEventListener("resize", resize);

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

function animate() {
	requestAnimationFrame(animate);
	var canvasRect = renderer.domElement.getBoundingClientRect();
	renderPane(mainPane, canvasRect);
	for (var i = 0; i < panes.length; i++) {
		if (!panes[i].isMain) { renderPane(panes[i], canvasRect); }
	}
}

// ---- go ---------------------------------------------------------------------
dateBar.setBaseDays(world.jd - JD0);
world.set({ jd: dateState.jd });   // one initial set: aligns the clock to the
                                   // slider's day grid and fires the first
                                   // recompute/draw pass through normal wiring
placeAll(world.jd);
resize();
animate();
