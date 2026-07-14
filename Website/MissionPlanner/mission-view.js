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
import { createDateBar } from "../Shared/sim/date-bar.js";
import { updateLabels as brUpdateLabels, updateScales as brUpdateScales } from "../Shared/sim/body-renderer.js";
import { createCoastSlider, createDepartureSlider } from "./ui/phase-slider.js";
import { buildHelioFrame, buildEarthMoonFrame, disposeScene } from "./scene-frames.js";

var O = OrbitalMath;
var EARTH = systems.get("Earth");
var GM_SUN = systems.get("Sun").GM;

var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
var SPAN_DAYS = 36525;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
		appendCbarChip(met ? "ok" : "warn", "compliance " + (met ? "met" : "unmet"));

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
				"v∞ in + v∞ out + waypoint burns");
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
	// The phase sliders' floating playhead readout (B4's redesign): full
	// precision (day + year + time) regardless of the slider's own tick
	// granularity — Coast's ticks only show month/year, but the handle can
	// sit anywhere within that month.
	function fullStamp(jd) {
		var d = O.dateFromJulian(jd);
		return MONTHS[d.Mo - 1] + " " + d.D + ", " + d.Y + " " + pad2(d.h) + ":" + pad2(d.m);
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
	var coastSlider = createCoastSlider(coastSliderEl, { onSetJd: setClock, shortDate: shortDate, stampPlayhead: fullStamp });

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
		onSetJd: setClock, stamp: shortStamp, stampPlayhead: fullStamp
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
