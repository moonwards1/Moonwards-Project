/* Mission Planner — the per-mission view factory.
 *
 * Everything that belongs to ONE mission lives here: its World + recompute
 * engine, its Three.js frames, its panes, its sidebar cards, its date bar and
 * phase sliders, its compliance and events bars, and its slice of workspace
 * persistence. The shell (planner.js) creates one instance per mission tab and
 * switches between them with show()/hide(); N instances coexist.
 *
 * Structural rules this file rests on:
 *
 * - ONE RENDERER, SHARED. Browsers cap live WebGL contexts, so the shell
 *   owns the single renderer/canvas and passes it in; show() re-parents the
 *   canvas into this view's scene element, and only the active view's
 *   render() is called. Everything else GPU-side (scenes, cameras, label
 *   layers) is cheap enough to keep per mission.
 *
 * - FRAMES ARE PER-MISSION, not shared-with-per-mission-state. Each view
 *   builds its own frames (own THREE.Scene, camera, labels) from the shared
 *   builders in scene-frames.js, and every call returns a fresh scene. Sharing
 *   scenes would mean swapping each mission's stage view groups and camera
 *   poses in and out on every tab switch, and the module contract's
 *   viewAdded()/draw() hooks assume a group that persists for the stage's
 *   lifetime. A frame's scene is a few spheres, rings and a star field —
 *   duplication is the cheap side of that trade.
 *
 * - WORKSPACE IS KEYED PER MISSION. One localStorage key
 *   (mw-missionplanner-workspace, version 2) holds a { missions: { id ->
 *   { main, phase, cams } } } map; each view reads/writes only its own slot
 *   (read-modify-write, so slots survive each other). Mission CONTENT lives
 *   under a separate key that planner.js owns.
 *
 * The module contract (init/draw/viewAdded, ctx.onResult) is described in
 * README.md, "Module-contract refinements".
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { createEngine } from "./core/recompute.js";
import { computeArrivalSeam } from "./core/arrival-seam.js";
import { systems } from "../Shared/orbit.js";
import { OrbitalMath } from "../Shared/math-utils.js";
import { Exchange, encodeFragment } from "../Shared/exchange.js";
import { packMissionLink } from "./ui/share-link.js";
import { updateCamera, bindCameraControls, raycastPickPoint } from "../Shared/sim/camera-controller.js";
import { orientMarkerSprite } from "../Shared/sim/marker-card.js";
import { createDateBar } from "../Shared/sim/date-bar.js";
import { updateLabels as brUpdateLabels, updateScales as brUpdateScales, worldSizeAtPointForPx, pickBodyName } from "../Shared/sim/body-renderer.js";
import { createCoastSlider, createDepartureSlider, createArrivalSlider } from "./ui/phase-slider.js";
import { createShipCard, vInfComponents, speedModel, speedAlong, peakSpeed, speedRange,
	timingModel } from "./ui/ship-card.js";
import { techOptionsFor, arrivalTechOptionsFor } from "./ui/tech-options.js";
import { buildHelioFrame, buildEarthMoonFrame, buildBodyFrame, disposeScene } from "./scene-frames.js";
import { renderReadoutBoxes, positionReadoutBoxes } from "../Shared/sim/readout-panes.js";

var O = OrbitalMath;
var GM_SUN = systems.get("Sun").GM;

// Straddling burn-readout box colours (Shared/sim/readout-panes.js) — matches
// every leg module's own DV_COLOR/DSPEED_COLOR burn-arrow constants, so a
// readout row means the same colour here as the arrow it reports on.
var READOUT_DV_HEX = "#ff5fd0", READOUT_SPD_HEX = "#ffd24a";
// How far a readout box shifts toward the main pane off dead-centre on the
// panel's edge (Shared/sim/readout-panes.js's positionReadoutBoxes) — matches
// the Ephemeris tab's own call.
var READOUT_EDGE_OFFSET = 15;

var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
var SPAN_DAYS = 36525;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A float shares its frame's cam (radius/theta/phi/target) with whatever
// pane last had that frame as main, so left untouched it shows the exact same
// framing shrunk into a ~200px box — legible as a caption, not as a picture.
// Cropping the radius to a fraction of that for float-only rendering (below,
// in renderPane) keeps the same orientation and target (so the focus body
// stays centred) while showing just the area of interest around it.
var FLOAT_ZOOM = 0.5;

// ---- phase <-> frame mapping. "coast" is always the heliocentric leg.
// "departure" and "arrival" are per-mission: each view builds
// PHASE_FRAME.departure from its own frozen plan's `origin` body
// (missionOriginBody/departureFrameFor below) — "body:Earth-Moon" for an Earth
// origin, or a generic buildBodyFrame(origin) for any other HELIO_BODIES
// origin — and PHASE_FRAME.arrival from the plan's committed arrival body, if
// it commits to one. A mission with no arrival commitment (a destination-less
// plan) keeps the Arrival phase button disabled.
//
// Modules that render body-centrically therefore cannot name a literal frame
// id, since they don't know the mission's origin or destination themselves.
// They declare the symbolic "body:origin" (a platform's carrier role,
// body-departure-leg.js) or "body:destination" (arrival-leg.js, a platform's
// terminal role) rendersIn token, and resolveFrameId() below aliases it to the
// real frame id wherever rendersIn is consulted.
var PHASES = ["departure", "coast", "arrival"];
var PHASE_DOT_RANK = { err: 0, blocked: 1, warn: 2, ok: 3 };   // lower = worse

// The mission's departure-origin body: read from its frozen-plan stage's
// `origin` param — "Earth" for any mission without a frozen-plan stage,
// matching frozen-plan.js's own default.
function missionOriginBody(world) {
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId === "frozen-plan") {
			var o = stages[i].params && stages[i].params.origin;
			return (typeof o === "string" && systems.has(o)) ? o : "Earth";
		}
	}
	return "Earth";
}

// The departure phase's real frame id for a given origin body: the Earth-Moon
// frame for Earth, else "body:<origin>" (scene-frames.js's buildBodyFrame).
function departureFrameFor(origin) {
	return origin === "Earth" ? "body:Earth-Moon" : "body:" + origin;
}

// The mission's arrival body: the frozen plan's own arrival commitment, read
// directly from its stage params. Same direct-read pattern as
// missionOriginBody, because the view is built before any module resolves.
// null when the mission has no frozen plan, no committed body, or names a
// body `systems` doesn't know.
function missionArrivalBody(world) {
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId !== "frozen-plan") { continue; }
		var arr = (stages[i].params && stages[i].params.arrival) || {};
		if (typeof arr.body === "string" && systems.has(arr.body)) { return arr.body; }
	}
	return null;
}

function dotClassFor(res) {
	return res.status === "ok"
		? (res.warnings.length ? "warn" : "ok")
		: (res.status === "diagnostic" ? "err" : "blocked");
}

// =======================================================================
//  Workspace store: one localStorage key, one slot per mission.
// =======================================================================
var WS_KEY = "mw-missionplanner-workspace";
var LEGACY_MISSION_ID = "m1";   // a version-1 save holds one unnamed mission's
                                // layout; the shell's first mission is "m1"

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

// For closing a mission tab (planner.js's closeMissionTab): forget its layout
// along with it.
export function deleteWorkspaceSlot(missionId) {
	var store = readWorkspaceStore();
	delete store.missions[missionId];
	try {
		localStorage.setItem(WS_KEY, JSON.stringify(store));
	} catch (e) { /* ignore */ }
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
//    getTitle   — optional () -> the mission's current shell-level title
//                 (titles live in planner.js, not the World); the share
//                 link embeds it so imports keep the name
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
	var mainEl = q(".mp-main");
	var complianceBarEl = q(".mp-compliance-bar");

	// Straddling burn-readout boxes (Shared/sim/readout-panes.js) — the same
	// mechanism the Ephemeris tab uses for its departure/waypoint burns, poking
	// past the panel's left edge off whichever waypoint card's vector editor a
	// leg module reports through view.readoutEntries (see drawStage below).
	var readoutLayer = document.createElement("div");
	readoutLayer.className = "mp-readout-layer";
	mainEl.appendChild(readoutLayer);
	var readoutBoxes = [];
	// Mission-events readout (top-left of the main pane, not the floats — see
	// renderEventsBar below). currentReadoutEvents/eventReadoutSig let it skip
	// rebuilding its <option> list on every clock tick and only touch
	// selectedIndex, so dragging a slider doesn't thrash this select's DOM.
	var eventReadoutEl = paneMainEl.querySelector(".mp-event-readout");
	var currentReadoutEvents = [];
	var eventReadoutSig = null;
	eventReadoutEl.addEventListener("change", function () {
		var e = currentReadoutEvents[Number(eventReadoutEl.value)];
		if (e) { setClock(e.jd); }
	});
	var dateBarEl = q(".mp-datebar");
	var coastSliderEl = q(".mp-coast-slider");
	var depSliderEl = q(".mp-dep-slider");
	var arrSliderEl = q(".mp-arr-slider");
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

	// ---- departure frame: this mission's own origin body picks which frame
	// PHASE_FRAME.departure points at — the Earth-Moon frame for an Earth
	// origin, or a generic buildBodyFrame(origin) otherwise. resolveFrameId()
	// aliases a module's symbolic "body:origin" rendersIn token to the real
	// frame id wherever rendersIn is consulted.
	var originBody = missionOriginBody(world);
	var departureFrameId = departureFrameFor(originBody);
	// ---- arrival frame: the frozen plan's arrival body gets its own
	// buildBodyFrame, and the "body:destination" rendersIn token aliases to it.
	// In the degenerate case where destination and origin share a frame id (a
	// Mars→Mars mission), the one frame serves both phases and departure keeps
	// the FRAME_PHASE claim — a float click reads as departure, while the phase
	// buttons still reach arrival directly.
	var arrivalBody = missionArrivalBody(world);
	var arrivalFrameId = arrivalBody ? "body:" + arrivalBody : null;
	var PHASE_FRAME = { departure: departureFrameId, coast: "helio" };
	var FRAME_PHASE = {};
	FRAME_PHASE[departureFrameId] = "departure";
	FRAME_PHASE.helio = "coast";
	if (arrivalFrameId) {
		PHASE_FRAME.arrival = arrivalFrameId;
		if (!FRAME_PHASE[arrivalFrameId]) { FRAME_PHASE[arrivalFrameId] = "arrival"; }
	}
	function resolveFrameId(id) {
		if (id === "body:origin") { return departureFrameId; }
		if (id === "body:destination") { return arrivalFrameId || id; }
		return id;
	}

	var frames = {};   // frameId -> frame record
	frames["helio"] = buildHelioFrame();
	frames[departureFrameId] = departureFrameId === "body:Earth-Moon"
		? buildEarthMoonFrame() : buildBodyFrame(originBody);
	if (arrivalFrameId && !frames[arrivalFrameId]) {
		frames[arrivalFrameId] = buildBodyFrame(arrivalBody);
	}

	// The Arrival phase is reachable exactly when its frame exists; the button
	// ships disabled in planner.html for the no-commitment case.
	if (arrivalFrameId) {
		phaseBtns.arrival.disabled = false;
		phaseBtns.arrival.title = "Arrival at " + arrivalBody;
	}

	// ---- workspace: which frame is main, which phase is active, camera poses.
	// This mission's slot of the shared localStorage store, never World. phase
	// and main are kept in lockstep (see setPhase) — main is just "the frame the
	// active phase points at" via PHASE_FRAME, except for "arrival" on a mission
	// with no arrival commitment, which has no frame. A saved or passed-in
	// default main naming a frame this mission doesn't have (e.g. a duplicated
	// non-Earth mission falling back to the shell's Earth-Moon default) falls
	// back to "helio" rather than pointing the main pane at a frame that was
	// never built. ------------------------------------------------------------
	var initialMain = frames[opts.defaultMain] ? opts.defaultMain : "helio";
	var workspace = { main: initialMain, phase: FRAME_PHASE[initialMain] || "departure", cams: {} };
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
			f.focusChevron = c.focusChevron || null;
		});
	})();

	function saveWorkspace() {
		var cams = {};
		Object.keys(frames).forEach(function (id) {
			var f = frames[id];
			cams[id] = { radius: f.cam.radius, theta: f.cam.theta, phi: f.cam.phi,
			             target: f.cam.target.toArray(), focusBody: f.focusBody,
			             focusChevron: f.focusChevron || null };
		});
		saveWorkspaceSlot(missionId, { main: workspace.main, phase: workspace.phase, cams: cams });
	}
	window.addEventListener("pagehide", saveWorkspace);

	// ---- panes: the main pane + one float per remaining frame ---------------
	var panes = [];   // [{ el, capEl, frameId, isMain }]

	function setPaneFrame(pane, frameId) {
		pane.frameId = frameId;
		// The main pane's caption is the full descriptive one; a float's is just
		// the short name (its title bar doubles as the drag handle, so it stays
		// out of the way of everything else in the small pane).
		pane.capEl.textContent = pane.isMain ? frames[frameId].caption : frames[frameId].shortCaption;
		pane.el.appendChild(frames[frameId].labelLayer);   // appendChild re-parents
	}

	var mainPane = { el: paneMainEl, capEl: paneMainEl.querySelector(".mp-pane-cap"), frameId: null, isMain: true };
	panes.push(mainPane);

	// A float's title bar (capEl) is its drag handle, deliberately confined to
	// that top-left strip so the rest of the small pane stays free — that's
	// where panning/zooming the mini-view itself will eventually live. A
	// press on the handle is either a drag or a click-to-promote, disambiguated
	// by whether the pointer moved past a small threshold before release.
	// dragCleanup/resizeCleanup let dispose() tear down a drag or resize's
	// window-level listeners if the mission is torn down mid-gesture (the
	// pointerup handler removes them otherwise).
	var floatIndex = 0, dragCleanup = null, resizeCleanup = null, floatCameraUnbinds = [], cardDragCleanup = null;
	function bindFloatDrag(pane) {
		var el = pane.el, handle = pane.capEl;
		var startX, startY, startLeft, startTop, moved;
		function onMove(e) {
			var dx = e.clientX - startX, dy = e.clientY - startY;
			if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; }
			var maxLeft = Math.max(0, sceneEl.clientWidth - el.offsetWidth);
			var maxTop = Math.max(0, sceneEl.clientHeight - el.offsetHeight);
			el.style.left = Math.max(0, Math.min(maxLeft, startLeft + dx)) + "px";
			el.style.top = Math.max(0, Math.min(maxTop, startTop + dy)) + "px";
		}
		function onUp(e) {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			dragCleanup = null;
			if (!moved) { swapMain(pane.frameId); }
		}
		handle.addEventListener("pointerdown", function (e) {
			if (e.button !== 0) { return; }
			e.preventDefault();
			moved = false;
			startX = e.clientX; startY = e.clientY;
			// getBoundingClientRect/offsetLeft only need to be accurate NOW (the
			// pane is on screen, being pressed) — read them here rather than at
			// construction time, when the mission's scene may still be display:none
			// (a fresh tab, or a background tab) and report a bogus zero width.
			// Also flips the default right-anchored position (see
			// positionFloatDefault) over to an explicit left, since dragging can no
			// longer be expressed as a CSS offset from the right edge.
			startLeft = el.offsetLeft; startTop = el.offsetTop;
			el.style.right = "auto";
			el.style.left = startLeft + "px";
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			dragCleanup = onUp;
		});
		// The rest of the pane (outside the handle or the resize grip) keeps the
		// plain click-to-promote behaviour; the handle's own press already
		// promotes on a no-move release above, so a click landing on either
		// control is skipped here to avoid promoting twice (or promoting off the
		// back of a resize drag).
		el.addEventListener("click", function (e) {
			if (handle.contains(e.target)) { return; }
			if (pane.resizeEl && pane.resizeEl.contains(e.target)) { return; }
			swapMain(pane.frameId);
		});
	}

	// A float's bottom-right corner grip free-resizes the pane (width/height),
	// clamped to a minimum (matching the CSS min-width/min-height) and to
	// whatever room is left before the scene's own right/bottom edge from the
	// pane's current position — resizing never pushes the pane off-screen.
	// No size persistence, same as position (see positionFloatDefault above):
	// floats reset to the default size on reload.
	var MIN_FLOAT_W = 140, MIN_FLOAT_H = 100;
	function bindFloatResize(pane) {
		var el = pane.el;
		var handle = document.createElement("div");
		handle.className = "mp-float-resize";
		handle.title = "Drag to resize";
		el.appendChild(handle);
		var startX, startY, startW, startH;
		function onMove(e) {
			var dx = e.clientX - startX, dy = e.clientY - startY;
			var maxW = Math.max(MIN_FLOAT_W, sceneEl.clientWidth - el.offsetLeft);
			var maxH = Math.max(MIN_FLOAT_H, sceneEl.clientHeight - el.offsetTop);
			el.style.width = Math.max(MIN_FLOAT_W, Math.min(maxW, startW + dx)) + "px";
			el.style.height = Math.max(MIN_FLOAT_H, Math.min(maxH, startH + dy)) + "px";
		}
		function onUp() {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			resizeCleanup = null;
		}
		handle.addEventListener("pointerdown", function (e) {
			if (e.button !== 0) { return; }
			e.preventDefault();
			e.stopPropagation();
			startX = e.clientX; startY = e.clientY;
			startW = el.offsetWidth; startH = el.offsetHeight;
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			resizeCleanup = onUp;
		});
		return handle;
	}

	// Default stacking mirrors the old flex-column layout (top-right, 12px
	// margin, 10px gaps), expressed as CSS right/top offsets rather than
	// computed left pixels — the container may not be laid out yet (this runs
	// while building a background or not-yet-shown mission tab), so anything
	// depending on sceneEl.clientWidth here would see zero. right/top resolve
	// live whenever the pane is actually shown. Dragging (bindFloatDrag) later
	// converts the pane to explicit left/top.
	function positionFloatDefault(el, index) {
		el.style.right = "12px";
		el.style.top = (12 + index * (148 + 10)) + "px";
	}

	Object.keys(frames).forEach(function (frameId) {
		if (frameId === workspace.main) { return; }
		var el = document.createElement("div");
		el.className = "mp-pane mp-float";
		var cap = document.createElement("span");
		cap.className = "mp-pane-cap";
		cap.title = "Drag to move";
		el.appendChild(cap);
		el.title = "Click to make main view";
		floatsEl.appendChild(el);
		positionFloatDefault(el, floatIndex++);
		var pane = { el: el, capEl: cap, frameId: null, isMain: false };
		bindFloatDrag(pane);
		pane.resizeEl = bindFloatResize(pane);
		// Suppress click-to-promote when a mouse drag just occurred. Track the
		// mousedown position and compare with the final click position; if the
		// distance is significant, it was a drag, not a click.
		var dragStartX = 0, dragStartY = 0;
		el.addEventListener("mousedown", function (e) {
			dragStartX = e.clientX;
			dragStartY = e.clientY;
		});
		// Use stopImmediatePropagation to prevent bindFloatDrag's click handler
		// from running when a drag has occurred.
		el.addEventListener("click", function (e) {
			var dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
			var dragDistance = Math.abs(dx) + Math.abs(dy);
			// If the click came after a significant mouse movement (>3px), it was a
			// camera drag, not a promotion click.
			if (dragDistance > 3 && !cap.contains(e.target) && !pane.resizeEl.contains(e.target)) {
				e.stopImmediatePropagation();
				e.preventDefault();
			}
		}, true); // capture phase: runs before bindFloatDrag's bubble-phase handler
		panes.push(pane);
		setPaneFrame(pane, frameId);
		// Camera controls: each float gets independent control over its own frame.
		// The getView function reads pane.frameId at runtime, not captured at binding time,
		// so when frames are swapped (via promoteFrame), the camera binding updates the
		// correct frame.
		var unbindFloatCamera = bindCameraControls(el, function () {
			var f = frames[pane.frameId];
			return {
				cam: f.cam, camera: f.camera,
				zoomMin: f.zoomMin, zoomMax: f.zoomMax,
				pickPoint: function (e) {
					return raycastPickPoint(f.camera, el, e,
						{ meshes: f.pickMeshes, soiSpheres: f.pickSoiSpheres });
				},
				// Picking (onPick/onDoubleClick) is main-pane only, per 3.5: a plain
				// click on a float promotes it (see the capture-phase handler above),
				// synchronously and before onPick's deferred timer would ever fire, so
				// wiring click-to-focus here would race that promotion and land on
				// whatever frame the pane swapped to. lockedZoomTarget still applies —
				// it's read-only and keys off the frame's own focus state, which a
				// float shares with whichever pane last had this frame as main.
				lockedZoomTarget: function () { return focusTargetOf(f, pane.frameId); },
				onPan: function () { f.focusBody = null; f.focusChevron = null; }
			};
		});
		floatCameraUnbinds.push(unbindFloatCamera);
	});
	setPaneFrame(mainPane, workspace.main);

	// ---- the ship card (ui/ship-card.js): the ship's own float, reporting on
	// whatever the chevron currently marks. Not a frame view — there is no
	// click-to-promote, only a drag by its title bar — but it shares the float
	// layer, the scene-edge clamp, and the no-persistence rule. Its gizmo reads
	// the MAIN pane's cam while "Align to view" is on, so the arrows sit at the
	// same viewing angle as the scene behind it.
	var shipCard = createShipCard({
		host: floatsEl,
		getMainCam: function () {
			var f = frames[workspace.main];
			return f ? f.cam : null;
		}
	});
	shipCard.el.style.left = "12px";
	shipCard.el.style.top = "56px";   // clear of the frame caption + events readout
	bindCardDrag(shipCard.el, shipCard.el.querySelector(".mp-ship-head"));

	function bindCardDrag(cardEl, handle) {
		var startX, startY, startLeft, startTop;
		function onMove(e) {
			var dx = e.clientX - startX, dy = e.clientY - startY;
			var maxLeft = Math.max(0, sceneEl.clientWidth - cardEl.offsetWidth);
			var maxTop = Math.max(0, sceneEl.clientHeight - cardEl.offsetHeight);
			cardEl.style.left = Math.max(0, Math.min(maxLeft, startLeft + dx)) + "px";
			cardEl.style.top = Math.max(0, Math.min(maxTop, startTop + dy)) + "px";
		}
		function onUp() {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			cardDragCleanup = null;
		}
		handle.addEventListener("pointerdown", function (e) {
			if (e.button !== 0) { return; }
			e.preventDefault();
			startX = e.clientX; startY = e.clientY;
			startLeft = cardEl.offsetLeft; startTop = cardEl.offsetTop;
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			cardDragCleanup = onUp;
		});
	}

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

	// Which slider shows: one per phase, exactly one at a time — Departure gets
	// the flight slider, Coast the date-scaled one ending at the seam, Arrival
	// the seam window (all three from ui/phase-slider.js). Each phase's slider
	// IS its clock control, so the raw Ephemeris date bar is only a FALLBACK: it
	// appears in the Arrival phase while there is no arrival window to scrub (no
	// encounter, so core/arrival-seam.js collapses the window to a point),
	// because otherwise that phase would have no clock at all. Departure and
	// Coast keep it hidden unconditionally; both always resolve a span in
	// practice, and their empty states are transient.
	function syncSliderVisibility() {
		var phase = workspace.phase;
		depSliderEl.style.display = phase === "departure" ? "" : "none";
		coastSliderEl.style.display = phase === "coast" ? "" : "none";
		arrSliderEl.style.display = phase === "arrival" ? "" : "none";
		// arrSlider is built further down (it needs setClock and coastSeam), so
		// this runs once before it exists — treat that as "no window yet",
		// which is exactly the state that wants the date bar. Every arrival
		// slider update re-runs this, so it corrects itself on the first
		// recompute.
		dateBarEl.style.display = (phase === "arrival" && (!arrSlider || arrSlider.empty)) ? "" : "none";
	}

	// The phase selectors drive the main-pane frame (via PHASE_FRAME —
	// "arrival" has one only when the plan commits to an arrival body, else its
	// button stays disabled), which sidebar cards show (applyPhaseToCards),
	// which slider shows (syncSliderVisibility), and the active highlight.
	function setPhase(phase) {
		if (PHASES.indexOf(phase) === -1 || phase === workspace.phase) { return; }
		workspace.phase = phase;
		var frameId = PHASE_FRAME[phase];
		if (frameId) { promoteFrame(frameId); }
		syncPhaseButtons();
		applyPhaseToCards();
		syncSliderVisibility();
		saveWorkspace();
		// Redraw everything against the new phase immediately: transfer-leg's
		// chevron clamps at the arrival seam only while Coast is active, and
		// without this it would stay stale at its last-drawn position until the
		// next unrelated recompute.
		engine.results().forEach(drawStage);
		updateShipCard();   // the card is per-phase; show/hide and refill it now
	}

	// A float pane's click promotes it to main — an alternate way to switch
	// phase, not just layout. If the frame maps to a phase (all of them do),
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
	// ui/share-link.js's envelope carries the shell-level TITLE along with the
	// World, so an import arrives with its real name; getTitle is a live lookup
	// into planner.js's mission list, not a snapshot.
	var shareBtn = q(".mp-share");
	shareBtn.addEventListener("click", function () {
		var payload = packMissionLink(opts.getTitle ? opts.getTitle() : null, world.serialize());
		var url = location.origin + location.pathname + "#mission=" + encodeFragment(payload);
		navigator.clipboard.writeText(url).then(function () {
			shareBtn.textContent = "Copied!";
			setTimeout(function () { shareBtn.textContent = "Copy mission link"; }, 1600);
		}, function () {
			// clipboard blocked: show the link so it can be copied by hand
			window.prompt("Copy the mission link:", url);
		});
	});

	// ---- click-to-focus picking (3.5). A body or a leg's chevron becomes the
	// orbit/zoom pivot on a plain click in the main pane; a click on empty
	// space releases it, same as a pan does. onPick/onDoubleClick are wired on
	// the main pane's camera binding only (below) — a float's plain click
	// already promotes it synchronously (see bindFloatDrag above), which would
	// race onPick's deferred timer, so floats keep the lock read-only via
	// lockedZoomTarget, sharing whatever the frame's main pane last focused.
	// Chevrons are read generically off stageViews, so the departure and
	// arrival legs' own chevrons (2.5) are clickable here with no change
	// needed, same as the coast leg's. Body picking itself is
	// body-renderer.js's pickBodyName — a body far/small enough to have
	// collapsed to updateScales' bright point is a sub-pixel target for an
	// exact hit-test, so it falls back to nearest-centre-within-PICK_PX. Only
	// the origin and destination bodies are ever pickable this way — a mission
	// tab's frames carry every HELIO_BODIES entry, and locking onto an
	// irrelevant one just gets in the way (pickFocus filters the name; the
	// Arrival double-click already only ever matches the destination).
	var PICK_PX = 10;

	function chevronsInFrame(frameId) {
		var list = [];
		Object.keys(stageViews).forEach(function (stageId) {
			stageViews[stageId].forEach(function (view) {
				if (view.frame === frameId && view.chevron) { list.push({ stageId: stageId, chevron: view.chevron }); }
			});
		});
		return list;
	}

	function pickChevronAt(frame, frameId, el, e) {
		var rect = el.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		var best = null, bestD = PICK_PX;
		chevronsInFrame(frameId).forEach(function (c) {
			var p = c.chevron.sprite.position.clone().project(frame.camera);
			if (p.z > 1) { return; }
			var sx = (p.x * 0.5 + 0.5) * rect.width, sy = (-p.y * 0.5 + 0.5) * rect.height;
			var d = Math.hypot(sx - px, sy - py);
			if (d < bestD) { bestD = d; best = c; }
		});
		return best;
	}

	// The live pivot for the CURRENT focus lock, re-read every call so a
	// locked zoom (and the chevron follow in updateChevrons below) tracks a
	// moving target rather than a snapshot position.
	function focusTargetOf(frame, frameId) {
		if (frame.focusChevron) {
			var hit = null;
			chevronsInFrame(frameId).some(function (c) {
				if (c.stageId !== frame.focusChevron) { return false; }
				hit = c; return true;
			});
			return hit ? hit.chevron.sprite.position : null;
		}
		if (frame.focusBody) {
			var node = frame.bodyNode(frame.focusBody);
			return node ? node.position : null;
		}
		return null;
	}

	function pickFocus(pane) {
		return function (e) {
			var frameId = pane.frameId, f = frames[frameId];
			var chev = pickChevronAt(f, frameId, pane.el, e);
			if (chev) {
				f.focusBody = null; f.focusChevron = chev.stageId;
				f.cam.target.copy(chev.chevron.sprite.position);
				saveWorkspace();
				return;
			}
			var name = pickBodyName(f.camera, pane.el, e, f.scaleList, PICK_PX);
			// Only the origin and destination are ever worth pivoting on here — a
			// mission tab's frames (helio especially) carry every HELIO_BODIES
			// entry, and letting all of them lock/follow just gets in the way at
			// this stage. A hit on any other body is treated the same as a miss.
			if (name !== originBody && name !== arrivalBody) { name = null; }
			if (name) {
				f.focusChevron = null; f.focusBody = name;
				var node = f.bodyNode(name);
				if (node) { f.cam.target.copy(node.position); }
				saveWorkspace();
				return;
			}
			// empty space (or a body that isn't the origin/destination): release
			// the lock, same as a pan
			f.focusBody = null; f.focusChevron = null;
			saveWorkspace();
		};
	}

	// In Arrival, double-clicking the destination pulls the view in closer as
	// well as focusing it; everywhere else this is a no-op on top of the
	// single-click focus above.
	function pickArrivalDoubleClick(pane) {
		return function (e) {
			if (!pane.isMain || workspace.phase !== "arrival") { return; }
			var f = frames[pane.frameId];
			var name = pickBodyName(f.camera, pane.el, e, f.scaleList, PICK_PX);
			if (name !== arrivalBody) { return; }
			f.focusChevron = null; f.focusBody = name;
			var node = f.bodyNode(name);
			if (node) { f.cam.target.copy(node.position); }
			f.cam.radius = Math.max(f.zoomMin, f.cam.radius * 0.35);
			saveWorkspace();
		};
	}

	// ---- camera controls: bound once, on this view's main pane; the config
	// follows whichever frame is main. Floats get their own binding, on the
	// same frame-swap-aware pattern, where the panes are built above. ---------
	var unbindCamera = bindCameraControls(paneMainEl, function () {
		var f = frames[workspace.main];
		return {
			cam: f.cam, camera: f.camera,
			zoomMin: f.zoomMin, zoomMax: f.zoomMax,
			pickPoint: function (e) {
				return raycastPickPoint(f.camera, paneMainEl, e,
					{ meshes: f.pickMeshes, soiSpheres: f.pickSoiSpheres });
			},
			lockedZoomTarget: function () { return focusTargetOf(f, workspace.main); },
			onPan: function () { f.focusBody = null; f.focusChevron = null; },
			onPick: pickFocus(mainPane),
			onDoubleClick: pickArrivalDoubleClick(mainPane)
		};
	});

	// ---- module views: a scoped THREE.Group per (stage, matching frame),
	// parented at the attachesTo body's node when the frame has it. ------------
	var stageViews = {};   // stageId -> [{ frame, group, stageId, metresPerUnit }]

	// Separate from the mount-time loop so the technology add/swap paths can
	// build a single stage's views without touching the rest — see addCarrier
	// and swapTechStage below.
	function buildStageViews(stage) {
		var desc = registry.get(stage.moduleId);
		if (!desc || !Array.isArray(desc.rendersIn)) { stageViews[stage.id] = []; return; }
		stageViews[stage.id] = [];
		desc.rendersIn.forEach(function (declaredFrameId) {
			var frameId = resolveFrameId(declaredFrameId);
			var frame = frames[frameId];
			if (!frame) { return; }
			var group = new THREE.Group();
			// attachesTo may be a static body name, or a function(stage) → body
			// name resolved per stage: the one skyhook module attaches to
			// whatever body its own `body` param names — the Moon's moving node
			// in the Earth-Moon frame, or a planet at its own frame's centre.
			// null / unknown body → the frame root (body-centric modules).
			var attachBody = typeof desc.attachesTo === "function" ? desc.attachesTo(stage) : desc.attachesTo;
			var parent = (attachBody && frame.bodyNode(attachBody)) || frame.scene;
			parent.add(group);
			var view = { frame: frameId, group: group, stageId: stage.id, metresPerUnit: frame.metresPerUnit };
			if (typeof desc.viewAdded === "function") { desc.viewAdded(view); }
			stageViews[stage.id].push(view);
		});
	}

	function disposeDeepObject3D(o) {
		if (o.children) { o.children.slice().forEach(disposeDeepObject3D); }
		if (o.geometry) { o.geometry.dispose(); }
		if (o.material) { o.material.dispose(); }
	}

	// The counterpart: tear down one stage's views. A module being replaced or
	// removed must not leave its old THREE objects parented in the frame it drew
	// into. `oldDesc` is the OUTGOING module (looked up before the World's
	// moduleId changes), so its own viewRemoved hook (if any) still runs against
	// the views it created.
	function disposeStageViews(stageId, oldDesc) {
		(stageViews[stageId] || []).forEach(function (view) {
			if (oldDesc && typeof oldDesc.viewRemoved === "function") { oldDesc.viewRemoved(view); }
			if (view.group.parent) { view.group.parent.remove(view.group); }
			disposeDeepObject3D(view.group);
		});
		delete stageViews[stageId];
	}

	world.stages().forEach(buildStageViews);

	function drawStage(res) {
		var desc = registry.get(res.moduleId);
		if (!desc || typeof desc.draw !== "function") { return; }
		var stage = world.getStage(res.stageId);
		if (!stage) { return; }
		(stageViews[res.stageId] || []).forEach(function (view) {
			desc.draw(view, { world: world, stageId: res.stageId, params: stage.params, result: res,
			                   phase: workspace.phase });
		});
		refreshReadouts();
	}

	// Rebuilds the readout-box list from every current stage view's own
	// view.readoutEntries (a leg module's draw() fills this the same way it
	// fills view.pxScaled — see transfer-leg.js and friends). Cheap and
	// idempotent, so redoing it wholesale on every drawStage call (rather than
	// tracking which stage's entries changed) is simplest.
	function refreshReadouts() {
		var entries = [];
		Object.keys(stageViews).forEach(function (stageId) {
			stageViews[stageId].forEach(function (view) {
				(view.readoutEntries || []).forEach(function (en) { entries.push(en); });
			});
		});
		readoutBoxes = renderReadoutBoxes(readoutLayer, readoutBoxes, entries,
			{ classPrefix: "mp", dvHex: READOUT_DV_HEX, spdHex: READOUT_SPD_HEX, compact: true });
	}

	// ---- sidebar: one card per stage, filtered to the active phase. The module
	// builds its own controls in the card body; the shell renders status chips
	// and diagnostics uniformly, so engine- and module-authored ones look alike.
	var cards = {};   // stageId -> { cardEl, chipEl, diagEl, phase, callbacks: [fn] }

	function stageTitle(stage) {
		var desc = registry.get(stage.moduleId);
		return desc ? desc.title : stage.moduleId;
	}

	// Which phase "owns" a stage's card: whichever phase's frame is among the
	// stage's rendersIn (a stage rendering in the origin frame is departure
	// tech, one rendering in helio is the coast leg). A stage that doesn't map
	// to a known phase's frame always shows, rather than vanishing from the
	// sidebar.
	function stagePhaseOf(stage) {
		var desc = registry.get(stage.moduleId);
		if (!desc || !Array.isArray(desc.rendersIn)) { return null; }
		for (var i = 0; i < desc.rendersIn.length; i++) {
			var p = FRAME_PHASE[resolveFrameId(desc.rendersIn[i])];
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

	// Separate from the mount-time loop so the technology add/swap paths can
	// build a single stage's card without touching the rest.
	// `insertBeforeEl` places the card at a given position (null = append at the
	// end, the mount-time loop's behaviour); the swap path passes the outgoing
	// card's old position so the new card lands exactly where it was, not at the
	// bottom of the sidebar.
	function buildCard(stage, insertBeforeEl) {
		var desc = registry.get(stage.moduleId);
		if (desc && desc.sidebarCard === false) { return; }   // frozen-plan: its readouts live in the phase bar instead
		var card = document.createElement("div");
		card.className = "mp-card";

		// `plainCard` (the legs): no title/status header — the module's own
		// content IS the card. Diagnostics still render below it; there's just no
		// chip to update.
		var chip = null;
		if (!desc || !desc.plainCard) {
			var h = document.createElement("h3");
			var titleSpan = document.createElement("span");
			titleSpan.textContent = stageTitle(stage);
			chip = document.createElement("span");
			chip.className = "mp-chip";
			h.appendChild(titleSpan); h.appendChild(chip);
			card.appendChild(h);
		}

		var host = document.createElement("div");
		card.appendChild(host);
		var diag = document.createElement("div");
		card.appendChild(diag);
		panelEl.insertBefore(card, insertBeforeEl || null);

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
	}

	// The counterpart: drop one stage's card DOM + bookkeeping. Returns the
	// removed card's next sibling (or null), so the caller can re-insert a
	// replacement at the same position.
	function disposeCard(stageId) {
		var entry = cards[stageId];
		if (!entry) { return null; }
		var next = entry.cardEl.nextSibling;
		entry.cardEl.remove();
		delete cards[stageId];
		return next;
	}

	world.stages().forEach(function (stage) { buildCard(stage, null); });
	applyPhaseToCards();

	// ---- departure technology: add/remove carriers --------------------------
	// The departure stack is [ base platform (moon-platform) ] → [ 0..2 carrier
	// cards ] → [ departure leg ]. The base platform is fixed; carriers are
	// added and removed here. A stage is identified by its packet SHAPE, never
	// by name: a base platform accepts nothing and emits a carrier-chain; a
	// carrier both accepts AND emits one (the skyhook); the departure leg
	// accepts a carrier-chain and emits a ship-state, and is the insertion
	// boundary — carriers go before it. Options come from ui/tech-options.js,
	// filtered by the body the chain is actually based at (departureChainBody),
	// so this is not Moon-only. Removing the last carrier is fine: departure-leg
	// reports "no-carrier" and, because frozen-plan is a compliance boundary, the
	// coast still flies rather than blanking.
	var DEP_TECH_KEY = "__departure-tech__";
	var MAX_CARRIERS = 2;

	function isBasePlatformStage(stage) {
		var d = registry.get(stage.moduleId);
		return !!d && d.accepts.length === 0 && d.emits.indexOf("carrier-chain") !== -1;
	}
	function isCarrierStage(stage) {
		var d = registry.get(stage.moduleId);
		return !!d && d.accepts.indexOf("carrier-chain") !== -1 && d.emits.indexOf("carrier-chain") !== -1;
	}
	function isDepartureLegStage(stage) {
		var d = registry.get(stage.moduleId);
		return !!d && d.accepts.indexOf("carrier-chain") !== -1 && d.emits.indexOf("ship-state") !== -1;
	}
	function basePlatformStage() { return world.stages().filter(isBasePlatformStage)[0] || null; }
	function carrierStages() { return world.stages().filter(isCarrierStage); }
	function departureLegStage() { return world.stages().filter(isDepartureLegStage)[0] || null; }

	// The body the departure chain is based at: the base platform's own computed
	// base (moon-platform emits "Moon"), else the mission's origin body (a
	// generic planet skyhook orbits the origin directly, with no platform).
	function departureChainBody() {
		var base = basePlatformStage();
		if (base) {
			var res = engine.resultFor(base.id);
			if (res && res.output && res.output.data && typeof res.output.data.base === "string") {
				return res.output.data.base;
			}
		}
		return originBody;
	}

	// Inserts a carrier stage just before the departure leg, seeded with the
	// chain's body explicitly (the body convention; the module fills geometry
	// defaults from defaultGeometryFor(body)). Builds its card/views and replays
	// the engine's already-computed result, like swapTechStage does.
	async function addCarrier(opt) {
		var legStage = departureLegStage();
		if (!legStage || carrierStages().length >= MAX_CARRIERS) { return; }
		if (!registry.has(opt.moduleId)) {
			var mod = await import(opt.moduleUrl);
			registry.register(mod.default);
		}
		var newId = world.set({ addStage: { moduleId: opt.moduleId, params: { body: departureChainBody() } },
			before: legStage.id });
		var newStage = world.getStage(newId);
		buildStageViews(newStage);
		buildCard(newStage, cards[legStage.id] ? cards[legStage.id].cardEl : null);
		applyPhaseToCards();
		var res = engine.resultFor(newId);
		if (res) { drawStage(res); updateCard(res); }
		refreshDepartureTechControl();
	}

	// Drops a carrier stage (disposing its card/views before world.set, so its
	// viewRemoved runs against the descriptor that built them). The recompute
	// world.set triggers redraws the remaining stages — departure-leg re-drafts
	// from what's left (or reports no-carrier).
	function removeCarrier(stageId) {
		var stage = world.getStage(stageId);
		if (!stage || !isCarrierStage(stage)) { return; }
		disposeStageViews(stageId, registry.get(stage.moduleId));
		disposeCard(stageId);
		world.set({ removeStage: stageId });
		refreshDepartureTechControl();
	}

	// The control card: current carriers (each removable) + an "add technology"
	// dropdown while under the cap. Rebuilt wholesale on any add/remove. Sits
	// between the fixed base card and the first carrier (or the departure leg
	// when empty). Absent entirely when the mission has no departure scaffold.
	function refreshDepartureTechControl() {
		if (cards[DEP_TECH_KEY]) { cards[DEP_TECH_KEY].cardEl.remove(); delete cards[DEP_TECH_KEY]; }
		var legStage = departureLegStage();
		if (!legStage) { return; }

		var carriers = carrierStages();
		var card = document.createElement("div"); card.className = "mp-card";
		var h = document.createElement("h3");
		var t = document.createElement("span"); t.textContent = "Departure technology";
		h.appendChild(t); card.appendChild(h);

		if (carriers.length === 0) {
			var hint = document.createElement("div"); hint.className = "mp-muted";
			hint.textContent = "None yet — add a technology to draft the departure flight.";
			card.appendChild(hint);
		} else {
			carriers.forEach(function (stage) {
				var row = document.createElement("div"); row.className = "mp-inrow";
				var lab = document.createElement("label"); lab.textContent = stageTitle(stage); row.appendChild(lab);
				var rm = document.createElement("button"); rm.className = "mp-btn"; rm.textContent = "remove";
				rm.addEventListener("click", function () { removeCarrier(stage.id); });
				row.appendChild(rm); card.appendChild(row);
			});
		}

		if (carriers.length < MAX_CARRIERS) {
			var body = departureChainBody();
			var select = document.createElement("select"); select.className = "mp-tech-select";
			var ph = document.createElement("option");
			ph.value = ""; ph.disabled = true; ph.selected = true;
			ph.textContent = carriers.length ? "+ Add another technology…" : "+ Add technology…";
			select.appendChild(ph);
			techOptionsFor(body).forEach(function (opt) {
				// don't re-offer a built carrier already in the chain
				if (!opt.future && carriers.some(function (s) { return s.moduleId === opt.moduleId; })) { return; }
				var o = document.createElement("option");
				o.value = opt.id;
				o.textContent = opt.label + (opt.future ? " (future)" : "");
				o.disabled = !!opt.future;
				select.appendChild(o);
			});
			select.addEventListener("change", function () {
				var opt = techOptionsFor(departureChainBody()).filter(function (o) { return o.id === select.value; })[0];
				select.value = "";
				if (opt && !opt.future && opt.moduleId) { addCarrier(opt); }
			});
			card.appendChild(select);
		}

		var anchor = carriers[0] || legStage;
		panelEl.insertBefore(card, cards[anchor.id] ? cards[anchor.id].cardEl : null);
		cards[DEP_TECH_KEY] = { cardEl: card, phase: "departure", callbacks: [] };
		applyPhaseToCards();
	}

	refreshDepartureTechControl();

	// Swaps a tech stage's module — the arrival technology dropdown's change
	// handler. (The departure side adds and removes stages instead; see
	// addCarrier/removeCarrier above.) Disposes the outgoing module's card/views
	// BEFORE world.set, so its viewRemoved runs against the descriptor that
	// actually built them; commits the change, which recomputes synchronously
	// (recompute.js) with no card/view yet registered for this stage, so that
	// pass's updateCard/drawStage safely no-op; then builds the incoming
	// module's card/views against the now-committed fresh params and replays the
	// engine's already-computed result onto them by hand. Nothing here re-derives
	// physics — recompute already ran; this only catches the view layer up to
	// what the engine already decided. `seedParams` is the incoming module's
	// starting params — { body } for an arrival tech, since the body convention
	// requires every arrival tech to carry its destination explicitly.
	async function swapTechStage(stageId, opt, seedParams) {
		var stage = world.getStage(stageId);
		if (!stage || stage.moduleId === opt.moduleId) { return; }
		if (!registry.has(opt.moduleId)) {
			var mod = await import(opt.moduleUrl);
			registry.register(mod.default);
		}
		var oldDesc = registry.get(stage.moduleId);
		var insertBefore = disposeCard(stageId);
		disposeStageViews(stageId, oldDesc);

		world.set({ swapStage: stageId, moduleId: opt.moduleId, params: seedParams || {} });

		var newStage = world.getStage(stageId);
		buildStageViews(newStage);
		buildCard(newStage, insertBefore);
		applyPhaseToCards();

		var res = engine.resultFor(stageId);
		if (res) { drawStage(res); updateCard(res); }
	}

	// ---- arrival technology dropdown ----------------------------------------
	// Swaps whichever ONE stage is shaped like an arrival tech — consumes a
	// ship-state and emits nothing (the chain's terminal catch, e.g.
	// arrival-skyhook). Options are filtered by the frozen plan's arrival body
	// (arrivalTechOptionsFor), and the swap seeds the incoming module with that
	// body explicitly. A mission with no such stage simply doesn't get the card:
	// unlike the departure side, this dropdown swaps an existing stage and
	// cannot add or remove one.
	function isArrivalTechStage(stage) {
		var desc = registry.get(stage.moduleId);
		return !!desc && desc.accepts.indexOf("ship-state") !== -1 && desc.emits.length === 0;
	}
	function arrivalTechStage() {
		var stages = world.stages();
		for (var i = 0; i < stages.length; i++) { if (isArrivalTechStage(stages[i])) { return stages[i]; } }
		return null;
	}

	var ARR_TECH_KEY = "__arrival-tech__";

	function buildArrivalTechCard() {
		var techStage = arrivalTechStage();
		if (!techStage || !arrivalBody) { return; }

		var card = document.createElement("div"); card.className = "mp-card";
		var h = document.createElement("h3"); h.textContent = "Arrival technology"; card.appendChild(h);
		var select = document.createElement("select");
		select.className = "mp-tech-select";
		card.appendChild(select);
		panelEl.insertBefore(card, cards[techStage.id] ? cards[techStage.id].cardEl : null);
		cards[ARR_TECH_KEY] = { cardEl: card, phase: "arrival", callbacks: [] };

		function refreshOptions() {
			var stage = world.getStage(techStage.id);
			select.innerHTML = "";
			arrivalTechOptionsFor(arrivalBody).forEach(function (opt) {
				var o = document.createElement("option");
				o.value = opt.id;
				o.textContent = opt.label + (opt.future ? " (future)" : "");
				o.disabled = !!opt.future;
				if (opt.moduleId === stage.moduleId) { o.selected = true; }
				select.appendChild(o);
			});
		}
		refreshOptions();

		select.addEventListener("change", function () {
			var opt = arrivalTechOptionsFor(arrivalBody).filter(function (o) { return o.id === select.value; })[0];
			if (!opt || opt.future || !opt.moduleId) { refreshOptions(); return; }
			swapTechStage(techStage.id, opt, { body: arrivalBody }).then(refreshOptions);
		});
	}

	buildArrivalTechCard();
	// Re-filter now that the arrival card exists: it is built AFTER the
	// mount-time applyPhaseToCards() above, so without this a workspace
	// restored outside the arrival phase would show the arrival dropdown until
	// the first phase switch.
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

		if (!chip) {
			// plainCard stage: no status chip — diagnostics below still render
		} else if (res.status === "ok" && res.warnings.length === 0) {
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

	// ---- plan-compliance bar + events bar (fed by the envelope's events
	// channel) ------------------------------------------------------------
	// The compliance bar shows frozen-plan's comparison: a compact "PLAN
	// REQUIRES -> TECH DELIVERS" readout, always visible (not phase-gated, like
	// the shared clock below it), reached via the registry rather than a static
	// import so frozen-plan stays a dynamically-loaded module like any other.
	//
	// frozen-plan has no sidebar card (sidebarCard: false), so this bar is its
	// ONLY view surface: it also covers the hard-diagnostic and blocked statuses
	// a generic card would render, plus the plan's own facts (flight time, v∞ in,
	// plan Δv — planSummary).
	//
	// Layout: [compliance met/unmet chip] then the plan's figures in a fixed
	// order — v∞ out, v∞ in, plan Δv, Exit origin SOI, flight time, arrival. v∞
	// in/out are named from the SHIP's point of view: "out" is the ship
	// departing (leaving the origin's SOI — the required departure v∞), "in" is
	// the ship arriving (reaching the destination's SOI — the arrival
	// commitment); see planSummary. The demand figures (v∞ out, v∞ in, plan Δv)
	// are amber while compliance is unmet — they are what no technology is
	// delivering yet — and green once met; Exit origin SOI/flight time/arrival are
	// plain facts already fixed by the chosen timing, never coloured. The aim
	// deviation is not shown here; its warning still flows through the envelope
	// to the departure stage's own card.
	function cbarDate(jd) {
		var d = O.dateFromJulian(jd);
		return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
	}
	function cbarKms(v) { return (v / 1000).toFixed(2) + " km/s"; }
	function appendCbarChip(cls, text, title) {
		var chip = document.createElement("span");
		chip.className = "mp-chip " + cls;
		chip.textContent = text;
		if (title) { chip.title = title; }
		complianceBarEl.appendChild(chip);
	}
	function appendCbarMetric(label, text, cls, title) {
		var m = document.createElement("span");
		m.className = "mp-cbar-metric" + (cls ? " " + cls : "");
		var b = document.createElement("b"); b.textContent = label; m.appendChild(b);
		var v = document.createElement("span");
		v.className = "mp-cbar-value"; v.textContent = text; m.appendChild(v);
		if (title) { m.title = title; }
		complianceBarEl.appendChild(m);
	}

	function renderComplianceBar(results) {
		complianceBarEl.innerHTML = "";
		var planRes = null;
		for (var i = 0; i < results.length; i++) {
			if (results[i].moduleId === "frozen-plan") { planRes = results[i]; break; }
		}
		if (!planRes) { return; }   // this mission carries no frozen plan

		// No sidebar card exists for this stage, so its hard-diagnostic and
		// blocked statuses need a home here.
		if (planRes.status === "diagnostic") {
			appendCbarChip("err", "plan: " + planRes.diagnostic.message, planRes.diagnostic.message);
			return;
		}
		if (planRes.status === "blocked") {
			var up = world.getStage(planRes.blockedOn);
			appendCbarChip("blocked", "plan: blocked — waiting on " + (up ? stageTitle(up) : planRes.blockedOn));
			return;
		}

		var desc = registry.get("frozen-plan");
		var comp = desc && typeof desc.complianceFor === "function" ? desc.complianceFor(world, planRes.stageId) : null;
		if (!comp || !comp.ok) { return; }

		var stage = world.getStage(planRes.stageId);
		var summary = desc && typeof desc.planSummary === "function" && stage ? desc.planSummary(stage.params) : null;

		// Unmet covers both "no tech is delivering anything" and "a tech is
		// delivering the wrong thing" — either way the demands stand open.
		var rowsByKey = {};
		(comp.rows || []).forEach(function (r) { rowsByKey[r.key] = r; });
		var met = !!comp.delivered && comp.rows.every(function (r) { return r.ok; });
		var demandCls = met ? "ok" : "warn";
		appendCbarChip(met ? "ok" : "warn", met ? "on course" : "off course");

		function fixTitleFor(key) {
			var w = (planRes.warnings || []).filter(function (x) { return x.code === key + "-mismatch"; })[0];
			return w && w.fix ? w.fix : null;
		}

		// The plan's own figure, with "required → delivered" when a tech is
		// delivering something off (the warning's fix text as hover title).
		var rV = rowsByKey.vinf;
		appendCbarMetric("v∞ out",
			(rV && !rV.ok) ? cbarKms(rV.required) + " → " + cbarKms(rV.delivered) : cbarKms(comp.required.vInf),
			demandCls, (rV && !rV.ok) ? fixTitleFor("vinf") : null);

		if (summary && summary.vInfOut != null) {
			appendCbarMetric("v∞ in", cbarKms(summary.vInfOut), demandCls, null);
		}
		if (summary) {
			appendCbarMetric("plan Δv", cbarKms(summary.dv), demandCls,
				"v∞ in + v∞ out + waypoint impulses");
		}

		var rE = rowsByKey.epoch;
		appendCbarMetric("Exit origin SOI",
			(rE && !rE.ok) ? cbarDate(rE.required) + " → " + cbarDate(rE.delivered) : cbarDate(comp.required.jd),
			null, (rE && !rE.ok) ? fixTitleFor("epoch") : null);

		if (summary && summary.flightDays != null) {
			appendCbarMetric("flight time", Math.round(summary.flightDays) + " d", null, null);
		}
		if (summary && summary.arrivalJd != null) {
			appendCbarMetric("arrival", cbarDate(summary.arrivalJd), null, null);
		}
	}

	// Phase-button dots: the worst status among a phase's stages (err worse than
	// blocked worse than warn worse than ok). A phase with no stages mapped to
	// it keeps the neutral default dot.
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

	// The readout's "active" event is the latest one at or before the clock
	// (the one whose date the mission is currently living in); before the
	// first event it falls back to that first (upcoming) one so the readout
	// never shows a blank selection.
	//
	// display: false skips an event here without dropping it from the
	// envelope: some events exist only for another consumer to read structurally
	// (transfer-leg's coarse closest-approach feeds core/arrival-seam.js; its
	// "Leg ends" feeds this file's own coastSpan fallback) and would otherwise
	// duplicate or clutter the ship-events story the readout is telling.
	function renderEventsBar(results) {
		var events = [];
		results.forEach(function (res) {
			res.events.forEach(function (e) { if (e.display !== false) { events.push(e); } });
		});
		events.sort(function (a, b) { return a.jd - b.jd; });

		var sig = events.map(function (e) { return e.jd + "|" + e.label; }).join("\n");
		if (sig !== eventReadoutSig) {
			eventReadoutSig = sig;
			currentReadoutEvents = events;
			eventReadoutEl.innerHTML = "";
			if (events.length === 0) {
				var none = document.createElement("option");
				none.textContent = "No mission events — stage outputs are blocked or empty.";
				eventReadoutEl.appendChild(none);
				eventReadoutEl.disabled = true;
			} else {
				eventReadoutEl.disabled = false;
				events.forEach(function (e, i) {
					var d = O.dateFromJulian(e.jd);
					var opt = document.createElement("option");
					opt.value = String(i);
					opt.textContent = d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0") +
						"  " + e.label;
					eventReadoutEl.appendChild(opt);
				});
			}
		}

		var activeIdx = -1;
		for (var i = 0; i < currentReadoutEvents.length; i++) {
			if (currentReadoutEvents[i].jd <= world.jd) { activeIdx = i; } else { break; }
		}
		if (activeIdx === -1 && currentReadoutEvents.length) { activeIdx = 0; }
		if (activeIdx !== -1) { eventReadoutEl.selectedIndex = activeIdx; }
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
		dateBar.setJd(jd);   // exact jd (keeps sub-day precision the departure
		world.set({ jd: dateState.jd });   // slider and event clicks need)
	}

	// ---- the Coast slider: date-scaled, spanning the plan's committed dates
	// and ending at the arrival seam (coastSpan) — see ui/phase-slider.js.
	var coastSlider = createCoastSlider(coastSliderEl, { onSetJd: setClock, shortDate: shortDate });

	// The Coast->Arrival seam (core/arrival-seam.js), derived from transfer-leg's
	// own emitted events: its destination's structured closest-approach event
	// (kind/body/vInf/rmin — see transfer-leg.js's coastStretch) plus a fallback
	// epoch for a coast that never actually encounters the destination. The
	// fallback is the frozen plan's own committed arrival epoch when one exists;
	// absent that, the leg's own latest event, mirroring coastSpan's fallback
	// below. null with no transfer-leg stage, no destination, or nothing to
	// derive a fallback from either.
	function coastSeam(results) {
		var dest = coastDestination();
		if (!dest) { return null; }
		var legRes = null, legStageId = null;
		for (var i = 0; i < results.length; i++) {
			if (results[i].moduleId === "transfer-leg") {
				legRes = results[i]; legStageId = results[i].stageId; break;
			}
		}
		if (!legRes || legRes.status !== "ok") { return null; }

		var desc = registry.get("frozen-plan");
		var commit = desc && typeof desc.arrivalCommitmentFor === "function"
			? desc.arrivalCommitmentFor(world) : null;
		var fallbackJd = (commit && commit.body === dest) ? commit.jd : null;
		if (fallbackJd == null) {
			var jds = legRes.events.map(function (e) { return e.jd; });
			if (!jds.length) { return null; }
			fallbackJd = Math.max.apply(null, jds);
		}
		// The phase structure follows the COMMITTED coast — the one the Arrival
		// phase is running on — so a pending waypoint edit moves the drawn arc
		// without dragging the sliders and the arrival window with it.
		return computeArrivalSeam({ destination: dest, pass: committedCoastPass(legStageId),
			fallbackArrivalJd: fallbackJd });
	}

	// The measured pass at the destination on a coast leg, through the module's
	// own nearestApproach. `live` picks the leg being tuned rather than the one
	// handed off. null when there is no coast, no destination, or no leg yet.
	function coastPass(stageId, live) {
		var dest = coastDestination();
		var desc = registry.get("transfer-leg");
		if (!dest || !desc || !stageId) { return null; }
		var leg = live ? desc.legFor(world, stageId) : desc.handoffLegFor(world, stageId);
		return leg ? desc.nearestApproach(leg, dest) : null;
	}
	function committedCoastPass(stageId) { return coastPass(stageId, false); }

	// The coast span. When a frozen-plan stage is emitting, the coast phase IS
	// the plan's committed dates (its departure/arrival events) — the beginning
	// to end of the dates set up when the mission was created — so live edits (a
	// longer leg, a moved waypoint) do NOT stretch the slider; they show up as
	// deviations instead. Without a plan (or while it's blocked/broken), fall
	// back to the envelope of events emitted by departure/coast-phase stages this
	// recompute pass. The RIGHT edge is the arrival seam, not the raw committed
	// arrival date: it moves with closest approach as the coast is tuned, ending
	// the phase early enough to leave the Arrival phase its own window.
	function coastSpan(results) {
		var jds = [];
		results.forEach(function (res) {
			if (res.moduleId !== "frozen-plan") { return; }
			res.events.forEach(function (e) { jds.push(e.jd); });
		});
		if (!jds.length) {
			results.forEach(function (res) {
				var stage = world.getStage(res.stageId);
				var phase = stage && stagePhaseOf(stage);
				if (phase !== "departure" && phase !== "coast") { return; }
				res.events.forEach(function (e) { jds.push(e.jd); });
			});
		}
		if (!jds.length) { return null; }
		var start = Math.min.apply(null, jds);
		var end = Math.max.apply(null, jds);
		var seam = coastSeam(results);
		if (seam) { end = seam.start; }
		return { start: start, end: end };
	}

	// ---- the Departure slider: LINEAR in time over the ship's departure
	// flight — launch on the left, on-course/SOI-exit on the right. See
	// ui/phase-slider.js and departureSpan() below.
	var depSlider = createDepartureSlider(depSliderEl, {
		onSetJd: setClock, stamp: shortStamp
	});

	// The departure phase's flight events (release, waypoint impulses, SOI
	// exits). Flight-only: an event flagged flight:false is kept off the flight
	// scrubber.
	function departureEvents(results) {
		var evs = [];
		results.forEach(function (res) {
			var stage = world.getStage(res.stageId);
			if (!stage || stagePhaseOf(stage) !== "departure") { return; }
			res.events.forEach(function (e) { if (e.flight !== false) { evs.push(e); } });
		});
		return evs;
	}

	// The destination body the coast leg is aiming at — used by the arrival-seam
	// derivation and by the Hohmann default span. Read from the transfer-leg
	// stage's params; "" / missing => none.
	function coastDestination() {
		var stages = world.stages();
		for (var i = 0; i < stages.length; i++) {
			if (stages[i].moduleId === "transfer-leg") {
				var d = stages[i].params && stages[i].params.destination;
				return (d && systems.has(d)) ? d : null;
			}
		}
		return null;
	}

	// The frozen plan's own departure numbers — its required v∞ out and fixed
	// on-course deadline — known the instant a mission is created, well before
	// any departure tech resolves real flight events. null when this mission has
	// no frozen-plan stage, or it hasn't resolved yet.
	function plannedDeparture(results) {
		var planRes = null;
		for (var i = 0; i < results.length; i++) {
			if (results[i].moduleId === "frozen-plan") { planRes = results[i]; break; }
		}
		if (!planRes) { return null; }
		var desc = registry.get("frozen-plan");
		var comp = desc && typeof desc.complianceFor === "function" ? desc.complianceFor(world, planRes.stageId) : null;
		return (comp && comp.ok) ? { vInf: comp.required.vInf, jd: comp.required.jd } : null;
	}

	// The mission's read-only release anchor (frozen-plan.js's
	// releaseAnchorFor, reached the same dynamic-registry way plannedDeparture
	// reaches complianceFor) — fixed the instant the plan is baked, well before
	// any departure tech resolves a real flight. null with no frozen plan yet.
	function releaseAnchorForMission() {
		var desc = registry.get("frozen-plan");
		return desc && typeof desc.releaseAnchorFor === "function" ? desc.releaseAnchorFor(world) : null;
	}

	// The departure span for the slider, by one of two procedures
	// (Notes-and-Obsolete/decisions.md's "Departure" entry), chosen by whether
	// the origin's departure rides a satellite carrier (Earth/Moon today —
	// missionOriginBody() === "Earth", the same test departureFrameFor() uses):
	//
	//   - Earth/Moon: PINNED-START / FLOATING-END. The release anchor is fixed
	//     the moment the plan is baked (moon-platform's card shows it read-only
	//     from mission creation), so the LEFT edge is that anchor outright. The
	//     RIGHT edge is the live flight's predicted origin-SOI exit once a
	//     departure tech resolves one, else the default flight-time estimate
	//     forward from the anchor — it floats as the tech/course is tuned.
	//   - bodies without a satellite carrier: ANCHORED-END / FLOATING-START. The
	//     RIGHT edge is the plan's own committed hand-off epoch outright (fixed
	//     regardless of what any tech currently delivers). The LEFT edge floats
	//     back from it by the best known flight duration — the resolved
	//     release-to-SOI-exit span once a tech resolves one, else the default
	//     estimate.
	//
	// Either way BOTH the committed hand-off and the predicted SOI exit render
	// as marks (decisions.md: "the committed hand-off is always a fixed mark on
	// the track; the predicted SOI exit is a separate, moving mark" — on course
	// means the two fall within a day of each other). Whichever one also frames
	// an edge is simply not drawn twice: departureSliderState only marks
	// interior fractions, so a mark sitting exactly at an edge drops out on its
	// own, the same rule every other slider mark follows.
	//
	// The returned `releaseJd` is the actual release event's own jd, which the
	// ANCHORED-END/FLOATING-START procedure can leave short of `start` (the
	// track still runs its full computed length, but nothing before release
	// happened). createDepartureSlider uses it as the scrub floor — dragging
	// can't reach a time before release even if the track geometrically starts
	// earlier — and as the "0 d" zero point for the playhead readout, so T+0
	// always lands on release itself rather than on the track's left edge.
	function departureSpan(results) {
		var evs = departureEvents(results);
		var releaseJd = evs.length ? evs[0].jd : releaseAnchorForMission();
		var soiExitJd = evs.length ? evs[evs.length - 1].jd : null;
		var plan = plannedDeparture(results);
		var def = departureDefaultSpanSeconds(results);
		var defDays = (def && isFinite(def) && def > 0) ? def / 86400 : 2;

		var marks = evs.slice();
		if (plan && isFinite(plan.jd)) {
			marks.push({ jd: plan.jd, label: "Committed hand-off", cls: "mp-mark-committed" });
		}

		var start, end, useEstimate = false;
		// Try to build a span with actual data first
		if (missionOriginBody(world) === "Earth") {
			// Earth/Moon: PINNED-START. Release anchor is the left edge; float the right edge.
			if (isFinite(releaseJd)) {
				start = releaseJd;
				end = isFinite(soiExitJd) ? soiExitJd : (start + defDays);
				if (isFinite(start) && isFinite(end) && end > start) {
					useEstimate = !isFinite(soiExitJd);
				}
			}
		} else {
			// Other origins: ANCHORED-END. Committed hand-off is the right edge; float the left edge.
			if (plan && isFinite(plan.jd)) {
				end = plan.jd;
				var duration = (isFinite(releaseJd) && isFinite(soiExitJd)) ? (soiExitJd - releaseJd) : defDays;
				start = end - duration;
				if (isFinite(start) && isFinite(end) && end > start) {
					useEstimate = !(isFinite(releaseJd) && isFinite(soiExitJd));
				}
			}
		}

		// If we don't have a valid span yet, try a fallback estimate
		if (!isFinite(start) || !isFinite(end) || end <= start) {
			// Use whatever anchor we have + the estimate duration
			if (isFinite(releaseJd) && defDays > 0) {
				// Release anchor exists: use it as start, add estimate to get end
				start = releaseJd;
				end = start + defDays;
				useEstimate = true;
			} else if (plan && isFinite(plan.jd) && defDays > 0) {
				// Plan hand-off exists: use it as end, subtract estimate to get start
				end = plan.jd;
				start = end - defDays;
				useEstimate = true;
			} else {
				// Truly no data — can't make a span estimate.
				return null;
			}
		}

		if (!(isFinite(start) && isFinite(end) && end > start)) { return null; }
		return { start: start, end: end, marks: marks, defaulted: useEstimate,
		         releaseJd: isFinite(releaseJd) ? releaseJd : start };
	}

	// The default span length: SOI_radius / v∞ — the time to cross the origin
	// body's SOI at the plan's required departure v∞ out. Falls back to a
	// Hohmann-transfer dv1 estimate to the chosen destination when no frozen
	// plan has resolved, then to a conservative 3 km/s v∞ guess when no
	// destination is set. Origin is this mission's own origin body
	// (missionOriginBody()), not necessarily Earth. Always returns seconds > 0.
	function departureDefaultSpanSeconds(results) {
		var origin = systems.get(missionOriginBody(world));
		var soi = O.sphereOfInfluence(origin.orbit.a, origin.GM, GM_SUN);   // m
		var plan = plannedDeparture(results);
		if (plan && plan.vInf > 0) { return soi / plan.vInf; }
		var dest = coastDestination();
		if (dest) {
			var rDest = systems.get(dest).orbit.a;
			var dv1 = O.hohmann(GM_SUN, origin.orbit.a, rDest).dv1;   // m/s injection burn
			if (dv1 > 0) { return soi / dv1; }
		}
		// No plan data and no destination: use a conservative generic v∞ estimate
		// (3 km/s is typical for interplanetary missions from Earth/similar bodies)
		return soi / 3000;
	}

	// ---- the Arrival slider: the seam window itself --------------------------
	// The one per-phase scrubber with no anchored edge at all: its span IS
	// coastSeam()'s [start, end] — closest approach minus Δt, to closest approach
	// plus a day. Both edges are recomputed from the live closest-approach event
	// every pass, so the whole window slides bodily as the coast is tuned.
	// Nothing is stored; the slider is handed two fresh jds each update.
	var arrSlider = createArrivalSlider(arrSliderEl, {
		onSetJd: setClock, stamp: shortStamp
	});

	// The arrival phase's own flight events, as marks. Same flight-only rule
	// the departure slider uses; arrivalSliderState drops any falling outside
	// the window. Since 7.1 the arrival leg spans exactly this window, so its
	// events land inside by construction — its own closest approach is the one
	// deliberate exception, flagged flight:false so it doesn't draw a second
	// mark a few hours from the seam's .mp-mark-ca.
	function arrivalEvents(results) {
		var evs = [];
		results.forEach(function (res) {
			var stage = world.getStage(res.stageId);
			if (!stage || stagePhaseOf(stage) !== "arrival") { return; }
			res.events.forEach(function (e) { if (e.flight !== false) { evs.push(e); } });
		});
		return evs;
	}

	// null when there is no window to scrub: no transfer-leg/destination at all,
	// or a coast that never encounters the destination — core/arrival-seam.js
	// then collapses the seam to a single point at the plan's committed arrival
	// epoch, which is not a span. The slider shows its empty state and
	// syncSliderVisibility hands the clock back to the date bar.
	function arrivalSpan(results) {
		var seam = coastSeam(results);
		if (!seam || !seam.hasEncounter) { return null; }
		return { start: seam.start, end: seam.end, ca: seam.jd, marks: arrivalEvents(results) };
	}

	// ---- the ship card's phase contexts -------------------------------------
	// Departure and Coast each have one; the card hides in the others rather
	// than showing an empty shell.
	//
	// Departure reads ONE comparison, the same one frozen-plan makes: the v∞ the
	// plan requires at hand-off against the v∞ the configured technology and
	// waypoints actually deliver. Both are split onto the burn frame of the
	// plan's own committed departure state (OrbitalMath.burnComponents — the
	// same ecliptic-anchored axes every waypoint editor means), so the two rows
	// are directly comparable and "prograde" reads the same here as it does on a
	// gizmo out in the scene.
	//
	// Coast reads a DIFFERENT KIND of comparison, and deliberately does not
	// grade it. There is no single correct coast — many passes arrive
	// successfully — so instead of needed-vs-delivered it shows the leg-end
	// heading the Arrival phase is currently running on (dim) against the one
	// the live waypoints produce (bright), and reports what the reader is
	// actually steering: how close the pass comes, how fast it arrives, when,
	// and which side of the body it goes by. Update hands the live coast over.
	function shipCardShown() {
		return workspace.phase === "departure" || workspace.phase === "coast";
	}

	function frozenPlanStage() {
		var stages = world.stages();
		for (var i = 0; i < stages.length; i++) {
			if (stages[i].moduleId === "frozen-plan") { return stages[i]; }
		}
		return null;
	}

	// The plan's committed heliocentric departure state { r, v, jd }, or null
	// when this mission has no frozen plan or its state is unusable.
	function planDepartureState() {
		var stage = frozenPlanStage();
		var d = (stage && stage.params && stage.params.departure) || null;
		return (d && Array.isArray(d.r) && Array.isArray(d.v) && isFinite(d.jd)) ? d : null;
	}

	// The last computed departure flight, from whichever leg module this
	// mission's origin uses (Earth-Moon or the generic body leg) — both expose
	// legFor the same registry-reached way frozen-plan exposes complianceFor.
	function departureFlight() {
		var stage = departureLegStage();
		if (!stage) { return null; }
		var desc = registry.get(stage.moduleId);
		var leg = (desc && typeof desc.legFor === "function") ? desc.legFor(world, stage.id) : null;
		return (leg && leg.ok) ? leg : null;
	}

	function unitOf(vec) {
		return (vec && O.vMag(vec) > 1e-9) ? O.vUnit(vec) : null;
	}

	// The transfer-leg stage record, and the module's descriptor-exposed helpers
	// (see transfer-leg's default export). null when this mission has no coast.
	function coastStage() {
		var stages = world.stages();
		for (var i = 0; i < stages.length; i++) {
			if (stages[i].moduleId === "transfer-leg") { return stages[i]; }
		}
		return null;
	}

	function fmtKm(m) {
		return (m == null || !isFinite(m)) ? "—" : Math.round(m / 1000).toLocaleString("en-US");
	}

	// The Coast card. The gizmo and the change row both show the same thing —
	// the speed change pending waypoint edits make at leg end — plus the pass
	// those waypoints actually buy. Nothing here is graded: the chips say which
	// way a pending edit moved each figure and Update hands the live coast
	// over, but the card never decides that a pass is wrong.
	function updateCoastCard() {
		shipCard.setSubtitle("Coast");
		shipCard.setComponents(null, null);
		shipCard.setOnCourse(false);

		var stage = coastStage();
		var desc = registry.get("transfer-leg");
		if (!stage || !desc) { return; }
		var live = desc.legFor(world, stage.id);
		var committed = desc.handoffLegFor(world, stage.id) || live;
		var pending = desc.handoffPending(stage.params);

		shipCard.setUpdate({
			show: true, enabled: pending,
			title: pending
				? "Hand this coast to the Arrival phase"
				: "The Arrival phase is already running on this coast",
			onClick: function () { desc.commitHandoff(world, stage.id); }
		});

		if (!live || !live.ok || !committed.ok) {
			shipCard.setGizmo(null);
			shipCard.setChange(null, null);
			shipCard.setSpeed(null);
			shipCard.setApproach(null);
			shipCard.setTiming(null);
			shipCard.setBPlane(null);
			return;
		}

		// THE GIZMO IS THE SPEED CHANGE: what the pending waypoint edits do to the
		// leg-end velocity, split onto the committed leg end's own burn frame —
		// the same axes and colours Departure's comparison gizmo uses, so an axis
		// means the same thing on both cards. There is only one layer (nothing to
		// compare the change against), and the net line draws in the bright/white
		// net colour.
		//
		// Both sides are sampled at the SAME elapsed time — the earlier of the
		// two legs' own ends — rather than each leg's own `.end`. A leg's `.end`
		// is the surface-impact state when the arc hits the destination and the
		// full-duration state otherwise; diffing one of each (the moment an edit
		// crosses the impact/miss boundary) compares two unrelated points on the
		// orbit and produces a huge, meaningless velocity difference.
		// stateAtElapsed clamps outside a leg's own span to its nearest end, so
		// this still reduces to the old `.end` vs `.end` diff whenever both legs
		// share the same regime (the common case).
		var end = committed.end, liveEnd = live.end;
		var tCommon = Math.min((end.jd - committed.jd0) * 86400,
		                        (liveEnd.jd - live.jd0) * 86400);
		var endState = desc.stateAtElapsed(committed, tCommon) || end;
		var liveState = desc.stateAtElapsed(live, tCommon) || liveEnd;
		var dv = O.vSub(liveState.v, endState.v);
		var c = O.burnComponents(endState.r, endState.v, dv);
		shipCard.setGizmo({
			axes: O.burnFrame(endState.r, endState.v),
			current: { pro: c.pro, rad: c.rad, nrm: c.nrm, net: O.vMag(dv) },
			currentDir: unitOf(dv)
		});

		// The change row: the same figures the gizmo draws as lengths along the
		// burn frame's axes, restated as numbers.
		shipCard.setChange("Speed change", { pro: c.pro, rad: c.rad, nrm: c.nrm,
			net: O.vMag(dv) }, "m/s");

		// The speed bar reads the LIVE arc, spanning its own min..max — an
		// interplanetary coast never goes near zero, so a zero-based bar would
		// hide the variation the reader is scrubbing for. The position sampled is
		// the chevron's, seam clamp included (transfer-leg's draw), so the number
		// belongs to the marker on screen.
		// The chevron's own clamp, from the LIVE arc — this is the seam on the
		// trajectory being drawn, matching transfer-leg's draw(), not the
		// committed one the sliders follow.
		var dest = coastDestination();
		var seam = dest ? computeArrivalSeam({ destination: dest,
			pass: desc.nearestApproach(live, dest), fallbackArrivalJd: live.end.jd }) : null;
		var t = (world.jd - live.jd0) * 86400;
		if (seam) { t = Math.min(t, (seam.start - live.jd0) * 86400); }
		var range = speedRange(live.samples);
		var now = speedAlong(live.samples, t);
		shipCard.setSpeed(range
			? speedModel(now == null ? NaN : now / 1000, NaN, range.max / 1000, range.min / 1000)
			: null);

		// The pass itself. Both figures come off the live leg, with the committed
		// leg's own values shown underneath whenever an edit is pending, so a
		// change reads as a move from one number to another.
		// ONE measurement of the pass, whether or not the arc enters the SOI —
		// transfer-leg's nearestApproach, which scans time rather than polyline
		// samples so the figure is a continuous function of the waypoints. A
		// sample-based reading jumped by tens of thousands of km the moment a
		// nudge walked the pass out of the SOI; see that function's own note.
		var livePass = desc.nearestApproach(live, dest);
		var refPass = pending ? desc.nearestApproach(committed, dest) : null;
		if (!livePass) {
			shipCard.setApproach(null);
			shipCard.setTiming(null);
			shipCard.setBPlane(null);
			return;
		}
		function better(now2, was) {
			return (was == null || !isFinite(was) || !isFinite(now2)) ? null : now2 < was;
		}
		shipCard.setApproach([
			{ label: livePass.insideSoi ? "Closest approach" : "Closest approach (outside SOI)",
			  value: fmtKm(livePass.altitude), unit: "km",
			  ref: refPass ? "was " + fmtKm(refPass.altitude) : null,
			  better: refPass ? better(livePass.altitude, refPass.altitude) : null },
			{ label: "Arrival speed",
			  value: livePass.speed == null ? "—" : (livePass.speed / 1000).toFixed(3), unit: "km/s",
			  ref: (refPass && refPass.speed != null) ? "was " + (refPass.speed / 1000).toFixed(3) : null,
			  better: refPass ? better(livePass.speed, refPass.speed) : null }
		]);

		// Timing: how far the pending edit has moved arrival from the coast's
		// own last-committed arrival — nothing to show once nothing is pending.
		shipCard.setTiming(refPass ? timingModel(livePass.jd, refPass.jd) : null);

		// The approach geometry comes off the same measurement — nearestApproach
		// hands back the body-relative state it already found. null when the pass
		// is not hyperbolic about the body: a captured arrival has no approach
		// asymptote to take a bearing from.
		var bp = O.bPlane(systems.get(dest).GM, livePass.rRel, livePass.vRel);
		shipCard.setBPlane(bp ? { angleDeg: bp.angleDeg,
			label: "Where the ship passes " + dest + ", seen coming in with ecliptic north up"
		} : null);
	}

	function updateShipCard() {
		var show = shipCardShown();
		shipCard.el.style.display = show ? "" : "none";
		if (!show) { return; }
		// Every section the OTHER phase owns is cleared on the way in, so a card
		// switching phases can never leave a stale row behind.
		if (workspace.phase === "coast") { updateCoastCard(); return; }
		shipCard.setSubtitle("Departure");
		shipCard.setApproach(null);
		shipCard.setTiming(null);
		shipCard.setBPlane(null);
		shipCard.setUpdate(null);

		var dep = planDepartureState();
		var planStage = frozenPlanStage();
		var planDesc = registry.get("frozen-plan");
		var comp = (planStage && planDesc && typeof planDesc.complianceFor === "function")
			? planDesc.complianceFor(world, planStage.id) : null;

		if (!dep || !comp || !comp.ok) {
			shipCard.setGizmo(null);
			shipCard.setComponents(null, null);
			shipCard.setSpeed(null);
			shipCard.setOnCourse(false);
			return;
		}

		var needed = vInfComponents(dep.r, dep.v, comp.required.vInfVec);
		var current = comp.delivered ? vInfComponents(dep.r, dep.v, comp.delivered.vInfVec) : null;
		shipCard.setGizmo({
			axes: O.burnFrame(dep.r, dep.v),
			needed: needed,
			current: current,
			neededDir: unitOf(comp.required.vInfVec),
			currentDir: comp.delivered ? unitOf(comp.delivered.vInfVec) : null
		});
		shipCard.setComponents(needed, current);
		shipCard.setOnCourse(!!comp.delivered && comp.rows.every(function (r) { return r.ok; }));

		// The speed section reads the flown arc, not the hand-off packet: the
		// bar's right edge is the flight's own peak speed, so it rescales with
		// every recompute and the fill always reads against the fastest the ship
		// goes this phase. The needed mark is the body-relative speed at the
		// hand-off radius that leaves with the plan's required v∞ (v² = v∞² +
		// 2μ/r) — the same escape the plan is asking the technology for.
		var leg = departureFlight();
		if (!leg) { shipCard.setSpeed(null); return; }
		var currentSpeed = speedAlong(leg.samples, (world.jd - leg.jd0) * 86400);
		var peak = peakSpeed(leg.samples);
		var rHandoff = O.vMag(leg.handoff.r);
		var neededSpeed = rHandoff > 0
			? Math.sqrt(comp.required.vInf * comp.required.vInf +
				2 * systems.get(originBody).GM / rHandoff)
			: null;
		shipCard.setSpeed(speedModel(
			currentSpeed == null ? NaN : currentSpeed / 1000,
			neededSpeed == null ? NaN : neededSpeed / 1000,
			peak == null ? NaN : peak / 1000));
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
		renderComplianceBar(results);
		renderPhaseDots(results);
		renderEventsBar(results);
		updateShipCard();
		var span = coastSpan(results);
		coastSlider.update({ start: span ? span.start : NaN, end: span ? span.end : NaN, jd: world.jd });
		var dep = departureSpan(results);
		depSlider.update(dep
			? { start: dep.start, end: dep.end, jd: world.jd, marks: dep.marks, defaulted: dep.defaulted,
			    releaseJd: dep.releaseJd }
			: { start: NaN, end: NaN, jd: world.jd, marks: [] });
		var arr = arrivalSpan(results);
		arrSlider.update(arr
			? { start: arr.start, end: arr.end, ca: arr.ca, jd: world.jd, marks: arr.marks }
			: { start: NaN, end: NaN, jd: world.jd, marks: [] });
		// the arrival slider's empty state decides whether the date bar has to
		// stand in as the Arrival phase's clock — re-check it whenever it moves
		syncSliderVisibility();
	});

	// Scratch cam for float rendering (below) — reused every pane/tick rather
	// than allocated per call; renderPane runs synchronously and finishes with
	// it before the next pane reads it, so nothing else may hold a reference
	// across calls.
	var floatCamScratch = { radius: 0, theta: 0, phi: 0, target: null };

	// The main pane's caption/HUD/events-dropdown (and its current frame's DOM
	// label layer) are positioned absolutely across the WHOLE scene and carry
	// an explicit z-index so they paint above the shared canvas — that z-index
	// has no ancestor stacking context to stay confined to, so it's compared
	// globally against .mp-floats' z-index (still correctly below it) rather
	// than clipped to "wherever the main pane is visually uncovered". A float
	// sitting on top used to hide this by being opaque; now that a float shows
	// its own real scene through a transparent box (see the .mp-float CSS
	// comment), nothing stops the main pane's text from showing through
	// wherever a float's rect happens to overlap it. Punching float-shaped
	// holes in the main pane's clip-path hides its overlay content there
	// without touching the shared canvas (a sibling, unaffected by this
	// element's clip-path) — the float's own scissor-rendered scene comes
	// through untouched either way.
	function updateMainOcclusion() {
		var overlays = panes.filter(function (p) { return !p.isMain; }).map(function (p) { return p.el; });
		// The ship card is opaque except for its gizmo hole, and that hole is a
		// scissored render of its own scene — so it wants the same treatment a
		// float gets, or the main pane's text shows through the arrows.
		if (shipCardShown()) { overlays.push(shipCard.el); }
		if (!overlays.length) { paneMainEl.style.clipPath = ""; return; }
		var mr = paneMainEl.getBoundingClientRect();
		var d = "M0 0L" + mr.width + " 0L" + mr.width + " " + mr.height + "L0 " + mr.height + "Z";
		overlays.forEach(function (overlayEl) {
			var r = overlayEl.getBoundingClientRect();
			var x = r.left - mr.left, y = r.top - mr.top;
			d += "M" + x + " " + y + "L" + (x + r.width) + " " + y +
				"L" + (x + r.width) + " " + (y + r.height) + "L" + x + " " + (y + r.height) + "Z";
		});
		paneMainEl.style.clipPath = "path(evenodd, \"" + d + "\")";
	}

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
		if (pane.isMain) {
			updateCamera(frame.camera, frame.cam);
		} else {
			floatCamScratch.radius = frame.cam.radius * FLOAT_ZOOM;
			floatCamScratch.theta = frame.cam.theta;
			floatCamScratch.phi = frame.cam.phi;
			floatCamScratch.target = frame.cam.target;
			updateCamera(frame.camera, floatCamScratch);
		}
		brUpdateScales(frame.camera, pane.el, frame.scaleList, { wantSOI: frame.wantSOI });
		brUpdateLabels(frame.camera, pane.el, frame.labelList);

		renderer.setViewport(x, y, w, h);
		renderer.setScissor(x, y, w, h);
		renderer.render(frame.scene, frame.camera);
	}

	// The ship-marker chevron (transfer-leg's draw()) is screen-facing, so it
	// needs re-orienting toward the live camera every rendered frame, not just
	// on the recompute/jd changes that (re)position it — the user can rotate
	// the view without touching the clock. It also needs RE-SCALING every
	// frame: makeShipSprite()'s scale is a fixed WORLD-space size (0.01),
	// which the helio frame's AU-scaled, multi-order-of-magnitude zoom range
	// (6 AU default, 1e-4..500 AU min/max) shrinks to a fraction of a pixel
	// at typical zoom — invisible, not just small. worldSizeAtPointForPx pins
	// it to a constant ON-SCREEN size regardless of distance, the same way the
	// Solar-System-Trajectory-Plotter handles its own marker and gizmos.
	//
	// draw() itself never gets a camera or a DOM element (that is the module
	// contract, not shell-owned state), so the shell closes both loops here:
	// each stage's view.chevron — module-owned, set fresh every draw() — is a
	// stable slot the render loop re-reads every tick. Sized against the main
	// pane specifically (mainPane.el), the same single-holder choice camera
	// control makes, so a chevron shown as a float-pane thumbnail sizes for the
	// main pane's height.
	var CHEVRON_PX = 26;   // matches the Ephemeris marker's own on-screen size
	// view.pxScaled is the same constant-on-screen-size treatment for anything
	// else a module's draw() wants held at a fixed pixel size regardless of zoom
	// — the departure and arrival legs' waypoint gizmos, in particular. Unlike
	// the chevron these need only re-scaling, not re-orienting, so it's a plain
	// [{ obj, px }] list rebuilt fresh each draw().
	function updateChevrons() {
		Object.keys(stageViews).forEach(function (stageId) {
			stageViews[stageId].forEach(function (view) {
				var frame = frames[view.frame];
				if (!frame) { return; }
				var chevron = view.chevron;
				if (chevron) {
					chevron.sprite.scale.setScalar(
						worldSizeAtPointForPx(frame.camera, paneMainEl, chevron.sprite.position, CHEVRON_PX));
					orientMarkerSprite(frame.camera, chevron.sprite, chevron.velDir);
					// 3.5's chevron follow: recentre the lock every tick, not just on
					// jd changes, so a click-focused chevron stays the pivot while its
					// own phase's timeline is scrubbed.
					if (frame.focusChevron === stageId) { frame.cam.target.copy(chevron.sprite.position); }
				}
				if (view.pxScaled) {
					view.pxScaled.forEach(function (g) {
						g.obj.scale.setScalar(
							worldSizeAtPointForPx(frame.camera, paneMainEl, g.obj.position, g.px || 42));
					});
				}
			});
		});
	}

	function render() {
		if (!active) { return; }
		updateChevrons();
		updateMainOcclusion();
		var canvasRect = renderer.domElement.getBoundingClientRect();
		renderPane(mainPane, canvasRect);
		for (var i = 0; i < panes.length; i++) {
			if (!panes[i].isMain) { renderPane(panes[i], canvasRect); }
		}
		if (shipCardShown()) { shipCard.render(renderer, canvasRect); }
		positionReadoutBoxes(readoutBoxes, mainEl, panelEl, READOUT_EDGE_OFFSET);
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
		if (dragCleanup) { dragCleanup(); }
		if (resizeCleanup) { resizeCleanup(); }
		if (cardDragCleanup) { cardDragCleanup(); }
		floatCameraUnbinds.forEach(function (unbind) { unbind(); });
		shipCard.dispose();
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

	// ---- go: one initial set opens the clock at the world's EXACT jd (the
	// precise setJd path, not setBaseDays's whole-day snap) and fires the first
	// recompute/draw pass through normal wiring. The exactness matters: a fresh
	// mission opens at the plan's release anchor, and a skyhook tether turns
	// every ~2.25 h, so a whole-day snap can place the drawn tether tip on the
	// opposite side of the Moon from the departure trajectory's start. The
	// in-card phase slider cannot close that gap — both ends rotate together —
	// so only the exact jd gets it right.
	dateBar.setJd(world.jd);
	world.set({ jd: dateState.jd });
	placeAll(world.jd);
	updateShipCard();   // a no-op jd set skips the recompute that would fill it

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
