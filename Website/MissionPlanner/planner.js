/* Mission Planner — the shell (post-A1: the multi-mission host).
 *
 * A deliberately plain UI over the headless core (core/world.js +
 * core/registry.js + core/recompute.js). Since task A1 the per-mission
 * pipeline — World + engine + frames + panes + cards + date bar — lives in
 * mission-view.js as createMissionView(); N instances can coexist, one per
 * future mission tab. What stays here is exactly what must be shared:
 *
 *   - the module registry (descriptors are stateless; one registry serves
 *     every mission),
 *   - the ONE renderer/canvas (browsers cap live WebGL contexts — that is
 *     why the views scissor panes instead of owning canvases). show() hands
 *     the canvas to a view; only the active view renders,
 *   - the initial mission load — persisted missions (task A3) if any exist,
 *     merged with a share-link fragment if the URL carries one, else the
 *     shipped preset — and the failure banner for a bad fragment or an
 *     unreadable saved mission,
 *   - the tab bar (task A2) — Ephemeris tab (a stub until WP-D) + one tab
 *     per mission, active highlight, confirm-then-dispose close — and the
 *     render loop, which only drives the currently active mission's view.
 *
 * Layout/camera view state ("workspace") lives in the views and
 * localStorage, never in World; see mission-view.js for the per-mission
 * keying. Mission CONTENT (title + World) is a separate localStorage key
 * this file owns directly — see "mission persistence" below.
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { deserializeWorld } from "./core/world.js";
import { createRegistry } from "./core/registry.js";
import { defaultMission, defaultWorkspaceMain } from "./presets/default-mission.js";
import { decodeFragment } from "../Shared/exchange.js";
import { createMissionView, deleteWorkspaceSlot } from "./mission-view.js";

// ---- modules (dynamic import per the architecture: a technology's code is
// fetched when activated; the scaffold's default mission activates both) ----
var MODULE_URLS = [
	"./modules/lunar-skyhook/lunar-skyhook.js",
	"./modules/frozen-plan/frozen-plan.js",
	"./modules/transfer-leg/transfer-leg.js"
];
var registry = createRegistry();
var loaded = await Promise.all(MODULE_URLS.map(function (u) { return import(u); }));
loaded.forEach(function (m) { registry.register(m.default); });

// ---- mission persistence (task A3): every mission (shell-level title +
// World.serialize() — the World has no name field of its own) lives in one
// versioned localStorage key, restored on load. Saved at pagehide (mirrors
// mission-view.js's workspace-slot pattern) and immediately after any
// structural change (a mission added or closed), so a reload never loses
// more than in-flight edits since the last save.
var MISSIONS_KEY = "mw-missionplanner-missions";

function readMissionsStore() {
	try {
		var saved = JSON.parse(localStorage.getItem(MISSIONS_KEY));
		if (!saved || saved.version !== 1 || !Array.isArray(saved.missions)) { return null; }
		return saved;
	} catch (e) { return null; }
}

function saveMissionsStore() {
	var store = {
		version: 1,
		activeId: activeTabId === "eph" ? null : activeTabId,
		missions: missions.map(function (m) {
			return { id: m.id, title: m.title, world: m.view.world.serialize() };
		})
	};
	try { localStorage.setItem(MISSIONS_KEY, JSON.stringify(store)); }
	catch (e) { /* storage full/blocked: missions just won't persist */ }
}
window.addEventListener("pagehide", saveMissionsStore);

// Deserializes a raw stored-mission list, dropping (and counting) any entry
// that fails — corrupt localStorage is data loss, not a crash.
function deserializeStoredList(list) {
	var restored = [], failures = 0;
	(list || []).forEach(function (m) {
		if (!m || typeof m !== "object" || typeof m.id !== "string") { failures++; return; }
		var res = deserializeWorld(m.world);
		if (res.ok) { restored.push({ id: m.id, title: typeof m.title === "string" ? m.title : m.id, world: res.world }); }
		else { failures++; }
	});
	return { restored: restored, failures: failures };
}

function nextMissionId(existing) {
	var n = 1;
	while (existing.some(function (m) { return m.id === "m" + n; })) { n++; }
	return "m" + n;
}

// ---- initial missions: persisted missions (if any) merged with a
// share-link fragment (if the URL carries one — README: "a share link
// opens in a new tab", so it's added alongside saved work, never replacing
// it), else the shipped worked-example preset. A bad fragment or an
// unreadable saved mission falls back gracefully WITH a banner, never a
// blank page (missions are user data; refusals are polite).
var loadNotice = null;

function initialMissions() {
	var hashMatch = /[#&]mission=([^&]+)/.exec(location.hash || "");
	var hashFailReason = null;

	if (hashMatch) {
		var saved = null;
		try { saved = decodeFragment(hashMatch[1]); } catch (e) { /* not base64url JSON */ }
		var res = saved ? deserializeWorld(saved) : { ok: false, reason: "the link's mission data is unreadable" };
		if (res.ok) {
			var stored0 = readMissionsStore();
			var d0 = deserializeStoredList(stored0 && stored0.missions);
			var id0 = nextMissionId(d0.restored);
			return {
				missions: d0.restored.concat([{ id: id0, title: "Imported mission", world: res.world }]),
				activeId: id0
			};
		}
		hashFailReason = res.reason;
	}

	var stored = readMissionsStore();
	var d = deserializeStoredList(stored && stored.missions);

	if (d.restored.length) {
		if (hashFailReason) {
			loadNotice = "Couldn't load the linked mission (" + hashFailReason + ") — opened your saved missions instead.";
		} else if (d.failures) {
			loadNotice = d.failures + " saved mission" + (d.failures > 1 ? "s" : "") +
				" could not be restored and " + (d.failures > 1 ? "were" : "was") + " dropped.";
		}
		var activeId = stored && stored.activeId && d.restored.some(function (m) { return m.id === stored.activeId; })
			? stored.activeId : d.restored[0].id;
		return { missions: d.restored, activeId: activeId };
	}

	var preset = deserializeWorld(defaultMission);
	if (!preset.ok) {   // an authoring error in the preset file; fail loud
		throw new Error("presets/default-mission.js does not deserialize: " + preset.reason);
	}
	if (hashFailReason) {
		loadNotice = "Couldn't load the linked mission (" + hashFailReason + ") — opened the default mission instead.";
	}
	return { missions: [{ id: "m1", title: "Moon → Ceres 2031", world: preset.world }], activeId: "m1" };
}

// ---- the one renderer; views borrow its canvas while active ---------------
var renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setScissorTest(true);

// ---- mission views ----------------------------------------------------
var viewsEl = document.getElementById("mp-views");
var missionTemplate = document.getElementById("mp-mission-template");

// ---- tab bar: Ephemeris tab (stub — see mp-eph-view in planner.html; real
// content is WP-D) + one tab per mission (task A2). Only one tab is shown
// at a time; missions[] tracks the mission tabs (the Ephemeris tab isn't a
// mission and has no World, so it stays out of this list). -----------------
var ephTabEl = document.getElementById("mp-tab-eph");
var ephViewEl = document.getElementById("mp-eph-view");
var missionTabsEl = document.getElementById("mp-mission-tabs");

var missions = [];        // [{ id, title, view, tabEl }]
var activeTabId = null;   // "eph" or a missionId

function activeMission() {
	return missions.find(function (m) { return m.id === activeTabId; }) || null;
}

function selectTab(tabId) {
	if (tabId === activeTabId) { return; }
	if (activeTabId === "eph") { ephViewEl.classList.remove("on"); }
	else { var prev = activeMission(); if (prev) { prev.view.hide(); } }

	activeTabId = tabId;
	ephTabEl.classList.toggle("active", tabId === "eph");
	if (tabId === "eph") {
		viewsEl.style.display = "none";
		ephViewEl.classList.add("on");
	} else {
		viewsEl.style.display = "flex";
		var next = activeMission();
		if (next) { next.view.show(); }
	}
	missions.forEach(function (m) { m.tabEl.classList.toggle("active", m.id === tabId); });
}

// Closing asks for confirmation — missions persist (task A3), but there's
// no undo yet, so closing is permanent. Disposing before removing the
// workspace slot keeps saveWorkspace() (called by dispose) from re-writing
// a slot deleteWorkspaceSlot is about to remove; saveMissionsStore() last so
// the closed mission drops out of the persisted list immediately, not just
// at the next pagehide.
function closeMissionTab(missionId) {
	var idx = missions.findIndex(function (m) { return m.id === missionId; });
	if (idx === -1) { return; }
	var entry = missions[idx];
	var ok = window.confirm(
		"Close mission “" + entry.title + "”? It will be removed for good " +
		"and can't be recovered.");
	if (!ok) { return; }

	if (activeTabId === missionId) {
		var fallback = missions[idx - 1] || missions[idx + 1];
		selectTab(fallback ? fallback.id : "eph");
	}

	missions.splice(idx, 1);
	entry.tabEl.remove();
	entry.view.dispose();
	deleteWorkspaceSlot(missionId);
	saveMissionsStore();
}

function addMissionTab(view, title) {
	var tabEl = document.createElement("div");
	tabEl.className = "mp-tab";
	var label = document.createElement("span");
	label.textContent = title;
	var x = document.createElement("span");
	x.className = "mp-tab-x";
	x.textContent = "×";
	x.title = "Close this mission";
	tabEl.appendChild(label);
	tabEl.appendChild(x);
	missionTabsEl.appendChild(tabEl);

	var entry = { id: view.missionId, title: title, view: view, tabEl: tabEl };
	missions.push(entry);

	tabEl.addEventListener("click", function () { selectTab(entry.id); });
	x.addEventListener("click", function (e) {
		e.stopPropagation();
		closeMissionTab(entry.id);
	});
	saveMissionsStore();
	return entry;
}

ephTabEl.addEventListener("click", function () { selectTab("eph"); });

var initial = initialMissions();
initial.missions.forEach(function (m) {
	var view = createMissionView({
		world: m.world,
		registry: registry,
		renderer: renderer,
		container: viewsEl,
		template: missionTemplate,
		missionId: m.id,
		defaultMain: defaultWorkspaceMain
	});
	addMissionTab(view, m.title);
});
selectTab(initial.activeId);
saveMissionsStore();   // normalizes the store right away (accurate activeId,
                        // any corrupt entries dropped) rather than waiting
                        // for the next pagehide.

// Load-failure banner (bad/foreign share link, or an unreadable saved mission).
if (loadNotice) {
	var banner = document.getElementById("mp-banner");
	banner.textContent = loadNotice;
	banner.hidden = false;
	banner.addEventListener("click", function () { banner.hidden = true; });
}

// ---- render loop: one renderer, the active mission's view scissors its
// own panes; the Ephemeris tab is plain DOM and needs neither. -------------
window.addEventListener("resize", function () {
	var m = activeMission();
	if (m) { m.view.resize(); }
});

function animate() {
	requestAnimationFrame(animate);
	var m = activeMission();
	if (m) { m.view.render(); }
}
animate();
