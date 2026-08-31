/* Mission Planner — the shell: the multi-mission host.
 *
 * A deliberately plain UI over the headless core (core/world.js +
 * core/registry.js + core/recompute.js). The per-mission pipeline — World +
 * engine + frames + panes + cards + date bar — lives in mission-view.js as
 * createMissionView(); N instances coexist, one per mission tab. What stays
 * here is exactly what must be shared:
 *
 *   - the module registry (descriptors are stateless; one registry serves
 *     every mission),
 *   - the ONE renderer/canvas (browsers cap live WebGL contexts — that is
 *     why the views scissor panes instead of owning canvases). A view's
 *     show() takes the canvas; only the active view renders,
 *   - the initial mission load — persisted missions if any exist, merged with
 *     a share-link fragment if the URL carries one, else the shipped preset —
 *     and the failure banner for a bad fragment or an unreadable saved
 *     mission,
 *   - the tab bar: the Ephemeris tab (its own view, ephemeris-view.js's
 *     createEphemerisView()) + one tab per mission, active highlight,
 *     confirm-then-dispose close, a "+" duplicate button and the example-
 *     mission dropdown (presets/examples-catalog.js),
 *   - the render loop, which drives whichever tab is currently active.
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
import { EXAMPLE_MISSIONS } from "./presets/examples-catalog.js";
import { decodeFragmentAny } from "../Shared/exchange.js";
import { unpackMissionLink } from "./ui/share-link.js";
import { readHistory, readSets } from "./core/revisions.js";
import { createMissionView, deleteWorkspaceSlot } from "./mission-view.js";
import { createEphemerisView } from "./ephemeris-view.js";

// ---- modules: dynamic-imported per the architecture (a technology's code is
// fetched rather than bundled). Every built module is eager-loaded here, so
// ui/tech-options.js's own moduleUrl fallback rarely fires. -------------------
var MODULE_URLS = [
	// The departure stack's fixed base for Earth-origin missions.
	"./modules/moon-platform/moon-platform.js",
	// The ONE skyhook platform in its departure role: serves the Moon (riding
	// moon-platform, escaping Earth via departure-leg) and any HELIO_BODIES
	// origin (self-originating, escaping that body via body-departure-leg).
	"./modules/skyhook/skyhook-departure.js",
	// The two integrated departure flights: geocentric (Earth+Moon+Sun) and
	// generic body-centric (body+Sun).
	"./modules/departure-leg/departure-leg.js",
	"./modules/body-departure-leg/body-departure-leg.js",
	// The Departure→Coast compliance boundary, and the coast itself.
	"./modules/frozen-plan/frozen-plan.js",
	"./modules/transfer-leg/transfer-leg.js",
	// The arrival flyby leg: the visible Coast→Arrival hand-off — one day out,
	// past the body at SOI/2, one day beyond — with waypoint burns on the
	// approach.
	"./modules/arrival-leg/arrival-leg.js",
	// Arrival technology: the same skyhook platform in its arrival role, the
	// tether run in reverse. Missions ship with the arrival-tech slot empty.
	"./modules/skyhook/skyhook-arrival.js"
];
var registry = createRegistry();
var loaded = await Promise.all(MODULE_URLS.map(function (u) { return import(u); }));
loaded.forEach(function (m) { registry.register(m.default); });

// ---- mission persistence: every mission (shell-level title +
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
			// `plan` is the full local run of sets (core/revisions.js) — every
			// Update, not the two a link carries. It is this user's working
			// record and costs about a kilobyte a commit, so there is no reason
			// to trim it here; the trimming happens at the link and at Finish.
			return { id: m.id, title: m.title, world: m.view.world.serialize(),
			         plan: m.view.planHistory() };
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
		// A missing or corrupt plan history is not a failed mission — the view
		// starts a fresh one from the World it opens with (readHistory returns
		// null, which createMissionView reads as "no history yet").
		if (res.ok) {
			restored.push({ id: m.id, title: typeof m.title === "string" ? m.title : m.id,
			                world: res.world, plan: readHistory(m.plan) });
		}
		else { failures++; }
	});
	return { restored: restored, failures: failures };
}

function nextMissionId(existing) {
	var n = 1;
	while (existing.some(function (m) { return m.id === "m" + n; })) { n++; }
	return "m" + n;
}

// ---- initial missions: persisted missions (if any) merged with a share-link
// fragment (if the URL carries one — a share link opens in a new browser tab,
// so its mission is added alongside saved work, never replacing it), else the
// shipped worked-example preset. A bad fragment or an unreadable saved mission
// falls back gracefully WITH a banner, never a blank page (missions are user
// data; refusals are polite).
var loadNotice = null;

// Async because a mission link is DEFLATE-compressed (Shared/exchange.js's
// decodeFragmentAny) and there is no synchronous inflate. Only the fragment
// branch actually awaits anything; a plain start-up still resolves in one
// microtask.
async function initialMissions() {
	var hashMatch = /[#&]mission=([^&]+)/.exec(location.hash || "");
	var hashFailReason = null;

	if (hashMatch) {
		var saved = null;
		try { saved = await decodeFragmentAny(hashMatch[1]); } catch (e) { /* not a readable fragment */ }
		// Links may carry the v2 envelope (title + world + plan sets), the v1
		// envelope, or a pre-E2 bare world — unpackMissionLink accepts all
		// three (ui/share-link.js).
		var unp = saved ? unpackMissionLink(saved) : { ok: false, reason: "the link's mission data is unreadable" };
		var res = unp.ok ? deserializeWorld(unp.world) : { ok: false, reason: unp.reason };
		if (res.ok) {
			var stored0 = readMissionsStore();
			var d0 = deserializeStoredList(stored0 && stored0.missions);
			var id0 = nextMissionId(d0.restored);
			return {
				missions: d0.restored.concat([{ id: id0, title: unp.title || "Imported mission",
				                               world: res.world, plan: readSets(unp.plan) }]),
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

// ---- tab bar: the Ephemeris tab (its own helio-frame view, sharing the one
// renderer like a mission view does) + one tab per mission. Only one tab is
// shown at a time; missions[] tracks the mission tabs (the Ephemeris tab isn't
// a mission and has no World, so it stays out of this list). ------------------
var ephTabEl = document.getElementById("mp-tab-eph");
var ephViewEl = document.getElementById("mp-eph-view");
var missionTabsEl = document.getElementById("mp-mission-tabs");
var tabPlusEl = document.getElementById("mp-tab-plus");

var missions = [];        // [{ id, title, view, tabEl }]
var activeTabId = null;   // "eph" or a missionId

function activeMission() {
	return missions.find(function (m) { return m.id === activeTabId; }) || null;
}

function titleFor(missionId) {
	var m = missions.find(function (x) { return x.id === missionId; });
	return m ? m.title : "Mission";
}

// The one place a mission view is built (initial load, E2 spawn, paste
// import). getTitle looks the title up live so the share link always
// carries the current name.
function makeMissionView(world, missionId, defaultMainId, plan) {
	return createMissionView({
		world: world,
		plan: plan || null,
		onPlanRecorded: saveMissionsStore,
		registry: registry,
		renderer: renderer,
		container: viewsEl,
		template: missionTemplate,
		missionId: missionId,
		defaultMain: defaultMainId || defaultWorkspaceMain,
		getTitle: function () { return titleFor(missionId); }
	});
}

// Register a freshly built World as a new mission tab and switch to it — the
// shared back half of every way a mission tab comes into being ("Start Mission
// Plan" on the Ephemeris tab's marker card, the "+" duplicate button, the
// example-mission dropdown). defaultMainId picks the pane/phase the tab opens
// on.
function spawnMissionTab(world, title, defaultMainId, plan) {
	var id = nextMissionId(missions);
	addMissionTab(makeMissionView(world, id, defaultMainId, plan), title);
	selectTab(id);
	saveMissionsStore();   // capture the new activeId, not just the new mission
	return id;
}

// ---- the Ephemeris tab's view: needs the two spawn callbacks above --------
var ephView = createEphemerisView({
	renderer: renderer,
	root: ephViewEl,

	// "Start Mission Plan": worldData is core/freeze.js's serialized World.
	// Opens on the helio pane — a spawned mission has no departure tech yet, so
	// the frozen coast is what there is to see.
	//
	onStartMission: function (worldData, title) {
		var res = deserializeWorld(worldData);
		if (!res.ok) { return { ok: false, reason: res.reason }; }
		spawnMissionTab(res.world, title, "helio");
		return { ok: true };
	},

	// "Paste mission link…" with a link that carries a LATER plan than the one
	// it was frozen with. The original goes into the Ephemeris scratchpad
	// (ephemeris-view.js does that itself); this opens the later plan as its
	// own tab, so a pasted mission arrives as both the place it started and
	// the place it got to. A link with no later set never calls this — it
	// loads into the scratchpad alone, exactly as before.
	onOpenPastedMission: function (worldData, title, planSets) {
		var res = deserializeWorld(worldData);
		if (!res.ok) { return { ok: false, reason: res.reason }; }
		spawnMissionTab(res.world, nextUniqueTitle(title || "Imported mission"),
			null, readSets(planSets));
		return { ok: true };
	}
});

function selectTab(tabId) {
	if (tabId === activeTabId) { return; }
	if (activeTabId === "eph") { ephView.hide(); }
	else { var prev = activeMission(); if (prev) { prev.view.hide(); } }

	activeTabId = tabId;
	ephTabEl.classList.toggle("active", tabId === "eph");
	if (tabId === "eph") {
		viewsEl.style.display = "none";
		ephView.show();
	} else {
		viewsEl.style.display = "flex";
		var next = activeMission();
		if (next) { next.view.show(); }
	}
	missions.forEach(function (m) { m.tabEl.classList.toggle("active", m.id === tabId); });
	updatePlusTab();
}

// The "+" tab duplicates the ACTIVE mission tab. Disabled-looking and
// title-explained while the Ephemeris tab is active, since there is no mission
// to copy there — that is where new missions are started instead.
function updatePlusTab() {
	var has = activeTabId !== "eph" && !!activeMission();
	tabPlusEl.classList.toggle("mp-disabled", !has);
	tabPlusEl.title = has
		? "Duplicate this mission tab"
		: "New missions are started from the Ephemeris tab";
}

// "<title> (copy)", bumping to "(copy 2)", "(copy 3)", … if that title is
// already taken — re-duplicating a duplicate re-stems from its own base
// title rather than stacking "(copy) (copy)".
function nextCopyTitle(title) {
	var m = /^(.*) \(copy(?: (\d+))?\)$/.exec(title);
	var stem = m ? m[1] : title;
	var n = 1, candidate = stem + " (copy)";
	while (missions.some(function (x) { return x.title === candidate; })) {
		n++;
		candidate = stem + " (copy " + n + ")";
	}
	return candidate;
}

// `title` as-is if free, else "<title> (2)", "(3)", … — unlike nextCopyTitle
// (which always wants a "(copy)" suffix, since its source is a tab that's
// definitely already open), the example dropdown's title is free the first
// time any given example is opened.
function nextUniqueTitle(title) {
	if (!missions.some(function (x) { return x.title === title; })) { return title; }
	var n = 2, candidate = title + " (" + n + ")";
	while (missions.some(function (x) { return x.title === candidate; })) {
		n++;
		candidate = title + " (" + n + ")";
	}
	return candidate;
}

// Clones the active mission's World (a serialize/deserialize round-trip, so
// the copy shares no live object with the original — editing either tab
// never touches the other) into a new tab titled with a "(copy)" suffix.
// A no-op while the Ephemeris tab is active — there's no mission to copy.
function duplicateActiveMission() {
	var src = activeMission();
	if (!src) { return; }
	var res = deserializeWorld(src.view.world.serialize());
	if (!res.ok) { return; }   // shouldn't happen: we just serialized it ourselves
	// The copy inherits the source's plan history: it is the same mission's
	// lineage, so its report still compares against the plan first frozen.
	spawnMissionTab(res.world, nextCopyTitle(src.title), null, src.view.planHistory());
}
tabPlusEl.addEventListener("click", duplicateActiveMission);

// ---- example missions: a second, independent front door next to "+"
// (duplicate). Each pick deserializes a FRESH World from the catalog's
// stateless data (presets/examples-catalog.js) into its own new tab, titled
// from the catalog label with de-duplication, so opening the same example twice
// doesn't collide.
var exampleSelectEl = document.getElementById("mp-example-select");
EXAMPLE_MISSIONS.forEach(function (ex) {
	var opt = document.createElement("option");
	opt.value = ex.id;
	opt.textContent = ex.label;
	if (ex.blurb) { opt.title = ex.blurb; }
	exampleSelectEl.appendChild(opt);
});
exampleSelectEl.addEventListener("change", function () {
	var id = exampleSelectEl.value;
	exampleSelectEl.value = "";   // always snaps back to the placeholder
	var ex = EXAMPLE_MISSIONS.find(function (x) { return x.id === id; });
	if (!ex) { return; }
	var res = deserializeWorld(ex.mission);
	if (!res.ok) { return; }   // shouldn't happen: the catalog is shipped, tested data
	spawnMissionTab(res.world, nextUniqueTitle(ex.label), ex.workspace);
});

// Closing asks for confirmation — missions persist, and there is no undo, so
// closing is permanent. Disposing before removing the
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

// Top-level await: initialMissions may have to inflate a compressed share
// link. Everything below waits on it, which is what the old synchronous call
// already guaranteed — the render loop starts after the tabs exist.
var initial = await initialMissions();
initial.missions.forEach(function (m) {
	addMissionTab(makeMissionView(m.world, m.id, null, m.plan), m.title);
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

// ---- render loop: one renderer; whichever tab is active (the Ephemeris
// view or a mission's view) scissors its own panes into it. -----------------
window.addEventListener("resize", function () {
	if (activeTabId === "eph") { ephView.resize(); return; }
	var m = activeMission();
	if (m) { m.view.resize(); }
});

function animate() {
	requestAnimationFrame(animate);
	if (activeTabId === "eph") { ephView.render(); return; }
	var m = activeMission();
	if (m) { m.view.render(); }
}
animate();
