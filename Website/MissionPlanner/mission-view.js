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
 *   labels) — the BUILDERS are shared (scene-frames.js, factored out by
 *   task D1 so the Ephemeris tab's view uses the identical helio frame, not
 *   a fork), but every call returns a fresh scene. Sharing scenes would mean
 *   swapping each mission's stage view groups and camera poses in and out on
 *   every tab switch, and the module contract's viewAdded()/draw() hooks
 *   assume a group that persists for the stage's lifetime. A frame's scene
 *   is a few spheres, rings and a star field — duplication is the cheap side
 *   of that trade.
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
import { Exchange, encodeFragment } from "../Shared/exchange.js";
import { packMissionLink } from "./ui/share-link.js";
import { updateCamera, bindCameraControls, raycastPickPoint } from "../Shared/sim/camera-controller.js";
import { orientMarkerSprite } from "../Shared/sim/marker-card.js";
import { createDateBar } from "../Shared/sim/date-bar.js";
import { updateLabels as brUpdateLabels, updateScales as brUpdateScales, worldSizeAtPointForPx } from "../Shared/sim/body-renderer.js";
import { createCoastSlider, createDepartureSlider } from "./ui/phase-slider.js";
import { techOptionsFor, arrivalTechOptionsFor } from "./ui/tech-options.js";
import { buildHelioFrame, buildEarthMoonFrame, buildBodyFrame, disposeScene } from "./scene-frames.js";

var O = OrbitalMath;
var EARTH = systems.get("Earth");
var GM_SUN = systems.get("Sun").GM;

var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
var SPAN_DAYS = 36525;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- phase <-> frame mapping (task B1, generalized by J3). "coast" is
// always the heliocentric leg. "departure" used to be a fixed "body:Earth-Moon"
// constant; now each mission view builds PHASE_FRAME.departure itself from its
// own frozen plan's `origin` body (missionOriginBody/departureFrameFor below)
// — "body:Earth-Moon" for the original Earth/Moon chain, or a generic
// buildBodyFrame(origin) for any other HELIO_BODIES origin (WP-J). Departure
// modules that render body-centrically declare the symbolic "body:origin"
// rendersIn token (orbital-skyhook.js, body-departure-leg.js) rather than a
// literal frame id, since they don't know the mission's origin themselves;
// resolveFrameId() below aliases that token to the real frame id wherever a
// module's rendersIn is consulted. "arrival" (task H2) works the same way in
// mirror image: when the mission's frozen plan commits to an arrival body,
// the view builds buildBodyFrame(destination), PHASE_FRAME.arrival points at
// it, the phase button un-disables, and arrival modules' symbolic
// "body:destination" rendersIn token (capture-burn.js, arrival-skyhook.js)
// aliases to it. A mission with no arrival commitment (an old save, or a
// destination-less plan) keeps the button disabled, exactly as before H2.
var PHASES = ["departure", "coast", "arrival"];
var PHASE_DOT_RANK = { err: 0, blocked: 1, warn: 2, ok: 3 };   // lower = worse

// The mission's departure-origin body (task J3): read from its frozen-plan
// stage's `origin` param (the frozen plan's own schema, C1) — "Earth" for
// pre-comply saves or any mission without a frozen-plan stage, matching
// frozen-plan.js's own default.
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

// The departure phase's real frame id for a given origin body: the original
// Earth-Moon frame for Earth, else "body:<origin>" (built by buildBodyFrame,
// task J1).
function departureFrameFor(origin) {
	return origin === "Earth" ? "body:Earth-Moon" : "body:" + origin;
}

// The mission's arrival body (task H2): the frozen plan's own arrival
// commitment, read directly from its stage params (the same direct-read
// pattern as missionOriginBody — the view builds before any module resolves).
// null when the mission has no frozen plan, no committed body, or names a
// body the master list doesn't know.
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

	var mainEl = q(".mp-main");
	var sceneEl = q(".mp-scene");
	var paneMainEl = q(".mp-pane-main");
	var floatsEl = q(".mp-floats");
	var panelEl = q(".mp-panel");

	// Straddling readout-box overlay (Shared/sim/readout-panes.js) — the same
	// mechanism the Ephemeris tab uses for its burn readouts (task D2), now
	// also available to any sidebar card via ctx.readoutLayer/mainEl/panelEl
	// (task I4: departure-leg's waypoint burn readouts + release tooltip).
	var readoutLayer = document.createElement("div");
	readoutLayer.className = "mp-readout-layer";
	mainEl.appendChild(readoutLayer);
	var complianceBarEl = q(".mp-compliance-bar");
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

	// ---- departure frame (task J3): this mission's own origin body picks
	// which frame PHASE_FRAME.departure points at — the Earth-Moon frame for
	// the original chain, or a generic buildBodyFrame(origin) for any other
	// WP-J origin. resolveFrameId() aliases a module's symbolic "body:origin"
	// rendersIn token to the real frame id wherever rendersIn is consulted.
	var originBody = missionOriginBody(world);
	var departureFrameId = departureFrameFor(originBody);
	// ---- arrival frame (task H2): the frozen plan's arrival body gets its
	// own buildBodyFrame, and the "body:destination" rendersIn token
	// (capture-burn, arrival-skyhook) aliases to it. In the degenerate case
	// where destination and origin share a frame id (a Mars→Mars mission),
	// the one frame serves both phases and departure keeps the FRAME_PHASE
	// claim (a float click reads as departure; the phase buttons still reach
	// arrival directly).
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

	// The Arrival phase is reachable exactly when its frame exists (task H2);
	// the button ships disabled in planner.html for the no-commitment case.
	if (arrivalFrameId) {
		phaseBtns.arrival.disabled = false;
		phaseBtns.arrival.title = "Arrival at " + arrivalBody;
	}

	// ---- workspace: which frame is main, which phase is active (task B1),
	// camera poses. This mission's slot of the shared localStorage store,
	// never World. phase and main are kept in lockstep (see setPhase) — main
	// is just "the frame the active phase points at" via PHASE_FRAME, except
	// for "arrival" on a mission with no arrival commitment (no frame then —
	// task H2). A saved/passed-in default main
	// naming a frame this mission doesn't have (e.g. a duplicated non-Earth
	// mission falling back to the shell's Earth-Moon default) falls back to
	// "helio" rather than pointing the main pane at a frame that was never
	// built. -----------------------------------
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
	// Arrival, which has no slider of its own yet (B3's arrival half — H2
	// enabled the phase, not its scrubber).
	function syncSliderVisibility() {
		var phase = workspace.phase;
		depSliderEl.style.display = phase === "departure" ? "" : "none";
		coastSliderEl.style.display = phase === "coast" ? "" : "none";
		dateBarEl.style.display = (phase === "departure" || phase === "coast") ? "none" : "";
	}

	// The phase selectors (task B1): drives the main-pane frame (via
	// PHASE_FRAME — "arrival" has one only when the plan commits to an
	// arrival body, else its button stays disabled — task H2),
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
	// The E2 envelope (ui/share-link.js) carries the shell-level TITLE along
	// with the World, so an import arrives with its real name; getTitle is a
	// live lookup (planner.js), not a snapshot, in case renaming ever exists.
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

	// Factored out of the mount-time loop (task F1) so the departure
	// technology dropdown's swap path can rebuild a single stage's views
	// without touching the rest — see swapDepartureTech below.
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

	// The counterpart: tear down one stage's views (F1's swap path — a
	// module being replaced must not leave its old THREE objects parented in
	// the frame it drew into). `oldDesc` is the OUTGOING module (looked up
	// before the World's moduleId changes), so its own viewRemoved hook (if
	// any) still runs against the views it created.
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

	// Factored out of the mount-time loop (task F1) so the departure
	// technology dropdown's swap path can rebuild a single stage's card
	// without touching the rest. `insertBeforeEl` places the card at a given
	// position (null = append at the end, the mount-time loop's behaviour);
	// the swap path passes the outgoing card's old position so the new card
	// lands exactly where it was, not at the bottom of the sidebar.
	function buildCard(stage, insertBeforeEl) {
		var desc = registry.get(stage.moduleId);
		if (desc && desc.sidebarCard === false) { return; }   // e.g. frozen-plan: its readouts live in the phase bar instead
		var card = document.createElement("div");
		card.className = "mp-card";

		// `plainCard` (e.g. transfer-leg since 2026-07-13): no title/status
		// header — the module's own content IS the card. Diagnostics still
		// render below it; there's just no chip to update.
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
				onResult: function (cb) { entry.callbacks.push(cb); },
				mainEl: mainEl,
				panelEl: panelEl,
				readoutLayer: readoutLayer
			});
		}
	}

	// The swap path's counterpart: drop one stage's card DOM + bookkeeping.
	// Returns the removed card's next sibling (or null), so the caller can
	// re-insert the replacement at the same position.
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

	// ---- departure technology: add/remove carriers (task I5) ----------------
	// The departure stack is [ base platform (moon-platform) ] → [ 0..2 carrier
	// cards ] → [ departure leg ]. The base platform is fixed; carriers are
	// added and removed here. A stage is identified by its packet SHAPE, never
	// by name: a base platform accepts nothing and emits a carrier-chain; a
	// carrier both accepts AND emits one (the unified skyhook, a future tip
	// launcher); the departure leg accepts a carrier-chain and emits a
	// ship-state (the insertion boundary — carriers go before it). Options come
	// from ui/tech-options.js, filtered by the body the chain is actually based
	// at (departureChainBody), so this is not Moon-only. Removing the last
	// carrier is fine — departure-leg reports "no-carrier" and, because
	// frozen-plan is a compliance boundary, the coast still flies (never blanks).
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

	// Swaps a tech stage's module (the arrival technology dropdown's change
	// handler — task H2; the departure side's swap card was removed and is
	// replaced by I5's add/remove carrier affordance). Disposes the outgoing
	// module's card/views BEFORE world.set (so its viewRemoved runs against the
	// descriptor that actually built them), commits the change (this recomputes
	// synchronously — recompute.js — with no card/view yet registered for this
	// stage, so that pass's updateCard/drawStage safely no-op), then builds the
	// incoming module's card/views against the now-committed fresh params and
	// replays the engine's already-computed result onto them by hand. Nothing
	// here re-derives physics — recompute already ran; this only catches the
	// view layer up to what the engine already decided. `seedParams` is the
	// incoming module's starting params — { body } for an arrival tech (the
	// body convention: every arrival tech carries its destination explicitly).
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

	// ---- arrival technology dropdown (task H2) -------------------------------
	// Swaps whichever ONE stage is shaped like an arrival tech — consumes a
	// ship-state and emits nothing (the chain's terminal catch: capture-burn,
	// arrival-skyhook). Options are filtered by the frozen plan's arrival body
	// (arrivalTechOptionsFor), and the swap seeds the incoming module with that
	// body explicitly. A mission with no such stage (an old save) just doesn't
	// get the card — an add/remove gap on the arrival side, mirroring the one
	// I5 closes for departure.
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
	// channel) ----
	// Task C2, redirected (2026-07-12, Kim): the old stage strip here was a
	// row of buttons that just scrolled to a sidebar card — not useful once
	// you can see the cards by switching phase. This space now shows C1's
	// frozen-plan comparison instead: a compact "PLAN REQUIRES -> TECH
	// DELIVERS" readout, always visible (not phase-gated, like the shared
	// clock below it), reached via the registry rather than a static import
	// so frozen-plan stays a dynamically-loaded module like any other.
	//
	// frozen-plan has no sidebar card (sidebarCard: false), so this bar is
	// ALSO now its only view surface: it has to cover the hard-diagnostic and
	// blocked statuses the generic card used to render, plus the plan's own
	// facts (flight time, v∞ in, plan Δv — planSummary) that used to sit in
	// that card's rows.
	// Reshaped per Kim (2026-07-13, re-reshaped 2026-07-14): [compliance
	// met/unmet chip] then the plan's figures in a fixed order — v∞ out,
	// v∞ in, plan Δv, departure, flight time, arrival. v∞ in/out are named
	// from the SHIP's point of view: "out" is the ship departing (leaving
	// the origin's SOI — the required departure v∞), "in" is the ship
	// arriving (reaching the destination's SOI — the arrival commitment);
	// see planSummary. The demand figures (v∞ out, v∞ in, plan Δv) are
	// amber while compliance is unmet — they are what no technology is
	// delivering yet — and green once met; departure/flight time/arrival
	// are plain facts already fixed by the chosen timing, never colored.
	// The aim readout was dropped from the bar (Kim: it may move to the
	// marker card later, if at all); its warning still flows through the
	// envelope.
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
		m.appendChild(document.createTextNode(text));
		if (title) { m.title = title; }
		complianceBarEl.appendChild(m);
	}

	function renderComplianceBar(results) {
		complianceBarEl.innerHTML = "";
		var planRes = null;
		for (var i = 0; i < results.length; i++) {
			if (results[i].moduleId === "frozen-plan") { planRes = results[i]; break; }
		}
		if (!planRes) { return; }   // no comply-mode stage on this mission (an old save)

		// No sidebar card exists for this stage, so these two statuses (which
		// the generic card used to render as a diag box) need a home here.
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
		appendCbarMetric("departure",
			(rE && !rE.ok) ? cbarDate(rE.required) + " → " + cbarDate(rE.delivered) : cbarDate(comp.required.jd),
			null, (rE && !rE.ok) ? fixTitleFor("epoch") : null);

		if (summary && summary.flightDays != null) {
			appendCbarMetric("flight time", Math.round(summary.flightDays) + " d", null, null);
		}
		if (summary && summary.arrivalJd != null) {
			appendCbarMetric("arrival", cbarDate(summary.arrivalJd), null, null);
		}
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
		dateBar.setJd(jd);   // exact jd (keeps sub-day precision the departure
		world.set({ jd: dateState.jd });   // slider and event clicks need)
	}

	// ---- the Coast slider (task B2): date-scaled, spanning the departure
	// and coast phases' own events (coastSpan) — see ui/phase-slider.js.
	var coastSlider = createCoastSlider(coastSliderEl, { onSetJd: setClock, shortDate: shortDate });

	// The coast span. Comply mode (task C1): when a frozen-plan stage is
	// emitting, the coast phase IS the plan's committed dates (its departure/
	// arrival events) — the design doc's "beginning to end of the dates set
	// up when the mission was created" — so live edits (a longer leg, a moved
	// waypoint) do NOT stretch the slider; they show up as deviations instead.
	// Without a plan (or while it's blocked/broken), fall back to the
	// pre-comply behaviour: the envelope of events emitted by departure/
	// coast-phase stages this recompute pass.
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
		return { start: Math.min.apply(null, jds), end: Math.max.apply(null, jds) };
	}

	// ---- the Departure slider (task B3): LINEAR in time over the ship's
	// departure flight — launch (left, floats) to on-course/SOI-exit (right,
	// the anchor). See ui/phase-slider.js and departureSpan() below.
	var depSlider = createDepartureSlider(depSliderEl, {
		onSetJd: setClock, stamp: shortStamp
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

	// The destination body the coast leg is aiming at (for the Hohmann default
	// span). Read from the transfer-leg stage's params; "" / missing => none.
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

	// The frozen plan's own departure numbers (C1) — its required v∞ out and
	// fixed on-course deadline — known the instant a mission is created, well
	// before any departure tech resolves real flight events. null when this
	// mission has no frozen-plan stage (a pre-comply save) or it hasn't
	// resolved yet.
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

	// The departure span for the slider. The RIGHT edge is the compliance time
	// (when the ship must be on course); the LEFT edge (launch) floats to fit
	// the departure duration. Today the flight events give both edges directly
	// (release .. Earth-SOI exit) once a departure tech resolves them; before
	// that — including the moment a mission is first created, with no
	// departure tech configured at all — the frozen plan's own required v∞
	// out and fixed deadline (imported with the mission at creation, C1)
	// default both edges: RIGHT anchored at the deadline, LEFT floated back by
	// departureDefaultSpanSeconds(). A lone resolved release event (tech
	// partly configured) anchors LEFT instead, floating RIGHT forward by the
	// same default, since the deadline isn't the binding edge in that case.
	function departureSpan(results) {
		var evs = departureEvents(results);
		var jds = evs.map(function (e) { return e.jd; });
		if (jds.length >= 2) {
			return { start: Math.min.apply(null, jds), end: Math.max.apply(null, jds),
			         marks: evs, defaulted: false };
		}
		if (jds.length === 1) {
			// only the release resolved: anchor there and use the default SOI-
			// crossing estimate for the (unknown) time to on-course.
			var def = departureDefaultSpanSeconds(results);
			if (!(def > 0)) { return null; }
			return { start: jds[0], end: jds[0] + def / 86400, marks: evs, defaulted: true };
		}
		// No flight events at all: the mission was just created (or its
		// departure tech is unconfigured/blocked). The frozen plan already
		// fixes the on-course deadline and required v∞ out, so anchor the
		// slider there instead of showing an empty track.
		var plan = plannedDeparture(results);
		var def0 = departureDefaultSpanSeconds(results);
		if (!plan || !(def0 > 0)) { return null; }
		return { start: plan.jd - def0 / 86400, end: plan.jd, marks: [], defaulted: true };
	}

	// Kim's default length: SOI_radius / v∞ — the time to cross the origin
	// body's SOI at the plan's required departure v∞ out, the same figure
	// imported with the mission from the frozen plan (C1). Falls back to a
	// Hohmann-transfer dv1 estimate to the chosen destination when no frozen
	// plan has resolved yet (a pre-comply save). Origin body is Earth (the
	// departure system) either way, so its heliocentric SOI. Seconds, or null.
	function departureDefaultSpanSeconds(results) {
		var soi = O.sphereOfInfluence(EARTH.orbit.a, EARTH.GM, GM_SUN);   // m
		var plan = plannedDeparture(results);
		if (plan && plan.vInf > 0) { return soi / plan.vInf; }
		var dest = coastDestination();
		if (!dest) { return null; }
		var rDest = systems.get(dest).orbit.a;
		var dv1 = O.hohmann(GM_SUN, EARTH.orbit.a, rDest).dv1;   // m/s injection burn
		return (dv1 > 0) ? soi / dv1 : null;
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
		var span = coastSpan(results);
		coastSlider.update({ start: span ? span.start : NaN, end: span ? span.end : NaN, jd: world.jd });
		var dep = departureSpan(results);
		depSlider.update(dep
			? { start: dep.start, end: dep.end, jd: world.jd, marks: dep.marks, defaulted: dep.defaulted }
			: { start: NaN, end: NaN, jd: world.jd, marks: [] });
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

	// The ship-marker chevron (transfer-leg's draw()) is screen-facing, so it
	// needs re-orienting toward the live camera every rendered frame, not just
	// on the recompute/jd changes that (re)position it — the user can rotate
	// the view without touching the clock. It also needs RE-SCALING every
	// frame: makeShipSprite()'s scale is a fixed WORLD-space size (0.01),
	// which the helio frame's AU-scaled, multi-order-of-magnitude zoom range
	// (6 AU default, 1e-4..500 AU min/max) shrinks to a fraction of a pixel
	// at typical zoom — invisible, not just small. The Solar-System-
	// Trajectory-Plotter's own marker avoids this the same way its waypoint
	// gizmos do (updateGizmos(), Calculators/Solar-System-Trajectory-Plotter/
	// solarSystemTrajectory.js): worldSizeAtPointForPx pins it to a constant
	// ON-SCREEN size regardless of distance. draw() itself never gets a
	// camera or a DOM element (module contract, not shell-owned), so the
	// shell closes both loops here: each stage's view.chevron (module-owned,
	// set fresh every draw()) is a stable slot the render loop re-reads every
	// tick. Sized against the main pane specifically (mainPane.el) — the
	// same single-holder choice camera control itself makes; a chevron
	// shown as a float-pane thumbnail elsewhere sizes for the main pane's
	// height, matching how the rest of this view treats "main" as the
	// reference pane.
	var CHEVRON_PX = 26;   // matches the Ephemeris marker's own on-screen size
	// view.pxScaled (task I4): the same constant-on-screen-size treatment,
	// generalized for anything a module's draw() wants held at a fixed pixel
	// size regardless of zoom — departure-leg's waypoint gizmos, in
	// particular (the Ephemeris tab's own updateGizmos/updateWaypointGizmos
	// pattern). Unlike the chevron, these don't need re-orienting, only
	// re-scaling, so it's a plain [{ obj, px }] list rebuilt fresh each draw().
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

	// ---- go: one initial set opens the clock at the world's EXACT jd (the
	// precise setJd path, not setBaseDays's whole-day snap) and fires the
	// first recompute/draw pass through normal wiring. Exactness matters
	// since task I3: a fresh mission opens at the plan's release anchor, and
	// the skyhook tether turns every ~2.25 h — the old day-grid snap opened
	// ~67 min early, half a rotation, drawing the tether tip on the OPPOSITE
	// side of the Moon from the departure trajectory's start (and the in-card
	// phase slider could never close that gap, since both ends rotate
	// together; only a timeline scrub — the same exact-jd path — healed it).
	dateBar.setJd(world.jd);
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
