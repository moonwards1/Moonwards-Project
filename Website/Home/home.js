// Home page: the design band (bodies × giant infrastructure, plus the
// selected body's facts) drives the workbench below it. The workbench shows
// the selected installation's calculator — one three-column shell serving all
// four tabs, whose cards each belong to a tab (CalcShell.setTab).
//
// An installation with its own calculator (calcFor) mounts it, and skeleton
// cards (skeleton.js) fill the tabs it has no cards on; one without gets a
// calculator made only of skeleton cards. Each installation's calculator is
// created the first time it is shown and kept (hidden) while the viewer looks
// elsewhere, so its settings survive moving around the design. Save and
// Export collect every calculator's settings into its installation's
// `state`, handed back when the calculator next mounts.
//
// The design itself and its rules live in design-model.js (pure, Node-tested);
// this file is the page: rendering, menus, selection, save / export / import.
//
// ES module (loaded with <script type="module">); deferred, so the DOM is ready.

import {
	BODY_ORDER, FAMILIES, FAMILY_ORDER, MARKS, TABS,
	calcFor, instLabel, findBody, variantBlock, sampleDesign,
	addBody, removeBody, addInstallation, removeInstallation,
	parseDesign, serializeDesign
} from "./design-model.js";
import { BODY_FACTS, FACT_ROWS } from "./body-facts.js";
import { addSkeletonCards, mountSkeleton } from "./skeleton.js";

var STORE_KEY = "mw-design";

// Calculators the workbench can mount, by the keys calcFor() returns. `load`
// resolves to the calculator's mount(root, opts) function (see
// Calculators/Hanging-skyhooks/skyhookCalc.js for the options).
var CALCULATORS = {
	"hanging-skyhook": {
		load: function () {
			return import("../Calculators/Hanging-skyhooks/skyhookCalc.js").then(function (m) { return m.mountHangingSkyhook; });
		}
	}
};
var mounted = {};   // installation id → { el, handle, instId, body }

var design = sampleDesign();
var ui = { body: "Moon", inst: design.bodies[0].inst[0].id, tab: "arch" };

var el = {
	vision: document.getElementById("vision"),
	matrix: document.getElementById("matrix"),
	facts: document.getElementById("facts"),
	bench: document.getElementById("bench"),
	tabs: document.getElementById("tabs"),
	work: document.getElementById("work"),
	empty: document.getElementById("empty")
};

var ICON_DOWN = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
var ICON_X = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

function esc(s) {
	return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
}
function currentInst() {
	var b = findBody(design, ui.body);
	return b ? b.inst.find(function (i) { return i.id === ui.inst; }) || null : null;
}
function selectBody(name) {
	ui.body = name;
	var b = findBody(design, name);
	if (!b) { ui.inst = null; return; }
	if (!b.inst.some(function (i) { return i.id === ui.inst; })) ui.inst = b.inst[0] ? b.inst[0].id : null;
}

// ---------- design band ----------
function renderMatrix() {
	var h = '<div class="hm-row hm-head"><button class="hm-hbtn" type="button" data-menu="body">Body ' + ICON_DOWN + '</button>';
	FAMILY_ORDER.forEach(function (f) {
		h += '<button class="hm-hbtn" type="button" data-menu="fam" data-fam="' + f + '">' + FAMILIES[f].label + ' ' + ICON_DOWN + '</button>';
	});
	h += '</div><div class="hm-rows" id="rows">';
	design.bodies.forEach(function (b) {
		h += '<div class="hm-row' + (b.body === ui.body ? " hm-sel" : "") + '"><div class="hm-bname">' +
			'<button class="hm-bbtn" type="button" data-body="' + b.body + '">' + b.body + '</button>' +
			'<button class="hm-x" type="button" data-rmbody="' + b.body + '" aria-label="Remove ' + b.body + '" title="Remove ' + b.body + '">' + ICON_X + '</button></div>';
		FAMILY_ORDER.forEach(function (f) {
			h += '<div class="hm-cell">';
			var m = MARKS[b.body + "|" + f];
			if (m) h += '<button class="hm-mark' + (m.k === "x" ? " hm-no" : "") + '" type="button" data-mark="' + b.body + "|" + f + '" aria-label="' + esc(m.title) + '" title="' + esc(m.title) + '">' + (m.k === "x" ? "×" : "*") + '</button>';
			b.inst.filter(function (i) { return i.fam === f; }).forEach(function (i) {
				h += '<span class="hm-chip' + (i.id === ui.inst ? " hm-sel-i" : "") + '"><button type="button" data-inst="' + i.id + '" data-ib="' + b.body + '">' + FAMILIES[f].vars[i.v].label + '</button>' +
					'<button class="hm-x" type="button" data-rminst="' + i.id + '" data-ib="' + b.body + '" aria-label="Remove ' + esc(instLabel(i)) + '">' + ICON_X + '</button></span>';
			});
			var canAdd = Object.keys(FAMILIES[f].vars).some(function (v) { return !variantBlock(design, b.body, f, v); });
			if (canAdd) h += '<button class="hm-add" type="button" data-menu="fam" data-fam="' + f + '" data-forbody="' + b.body + '">+ add</button>';
			h += '</div>';
		});
		h += '</div>';
	});
	h += '</div><div class="hm-more">' + (design.bodies.length > 3 ? design.bodies.length + " bodies · scroll for more" : (design.bodies.length ? "" : "Add a body from the Body menu to start.")) + '</div>';
	el.matrix.innerHTML = h;
	var rows = document.getElementById("rows"), sel = rows.querySelector(".hm-sel");
	if (sel && (sel.offsetTop < rows.scrollTop || sel.offsetTop + sel.offsetHeight > rows.scrollTop + rows.clientHeight)) rows.scrollTop = sel.offsetTop;
}

function renderFacts() {
	var f = BODY_FACTS[ui.body];
	if (!f || !findBody(design, ui.body)) { el.facts.innerHTML = '<h3>No body selected</h3>'; return; }
	el.facts.innerHTML = '<h3>' + ui.body + '<small>' + esc(f.note) + '</small></h3><dl>' + FACT_ROWS.map(function (r) {
		var v = esc(f[r[1]]);
		if (r[1] === "rotation" && f.rotationNote) v += '<small>' + esc(f.rotationNote) + '</small>';
		return '<dt>' + r[0] + '</dt><dd>' + v + '</dd>';
	}).join("") + '</dl>';
}

// ---------- menus ----------
var pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }
function openPop(anchor, html) {
	closePop();
	pop = document.createElement("div");
	pop.className = "hm-pop";
	pop.innerHTML = html;
	el.vision.appendChild(pop);
	var a = anchor.getBoundingClientRect(), r = el.vision.getBoundingClientRect();
	var left = Math.max(8, Math.min(a.left - r.left, r.width - pop.offsetWidth - 8));
	pop.style.left = left + "px";
	pop.style.top = (a.bottom - r.top + 6) + "px";
	var first = pop.querySelector("button:not(:disabled)");
	if (first) first.focus();
}
function bodyMenu(anchor) {
	var free = BODY_ORDER.filter(function (n) { return !findBody(design, n); });
	var h = '<h4>Add a body</h4>';
	if (!free.length) h += '<p>Every available body is already in the design.</p>';
	free.forEach(function (n) { h += '<button class="hm-mi" type="button" data-addbody="' + n + '"><b>' + n + '</b><span>' + esc(BODY_FACTS[n].note) + '</span></button>'; });
	openPop(anchor, h);
}
function famMenu(anchor, fam, body) {
	body = body || ui.body;
	if (!findBody(design, body)) { openPop(anchor, '<p>Add a body first, then choose its ' + FAMILIES[fam].label.toLowerCase() + '.</p>'); return; }
	var h = '<h4>' + FAMILIES[fam].label + ' at ' + body + '</h4>';
	var m = MARKS[body + "|" + fam];
	if (m) h += '<p><b>' + (m.k === "x" ? "× " : "* ") + esc(m.title) + '.</b></p>';
	Object.keys(FAMILIES[fam].vars).forEach(function (v) {
		var def = FAMILIES[fam].vars[v], why = variantBlock(design, body, fam, v);
		h += '<button class="hm-mi" type="button" data-addinst="' + fam + "|" + v + "|" + body + '"' + (why ? " disabled" : "") + '><b>' + def.label + '</b><span>' + esc(why || def.desc) + '</span></button>';
	});
	openPop(anchor, h);
}
function markNote(anchor, key) {
	var m = MARKS[key];
	openPop(anchor, '<h4>' + (m.k === "x" ? "× Can't be built here" : "* Possible, in a special form") + '</h4><p><b>' + esc(m.title) + '.</b></p><p>' + esc(m.text) + '</p>');
}

// ---------- workbench ----------
function renderBench() {
	el.tabs.innerHTML = TABS.map(function (t, n) {
		return '<button class="hm-tab" type="button" role="tab" data-tab="' + t.id + '" aria-selected="' + (ui.tab === t.id) + '"' +
			(n ? ' title="Builds on ' + TABS[n - 1].label + '"' : "") + '><i>' + (n + 1) + '</i>' + t.label + '</button>';
	}).join("");
	var inst = findBody(design, ui.body) ? currentInst() : null;
	Object.keys(mounted).forEach(function (k) { mounted[k].el.hidden = !inst || k !== inst.id; });
	if (inst) {
		el.empty.hidden = true;
		if (!mounted[inst.id]) mountCalculator(inst, ui.body);
		showTab(mounted[inst.id]);
		return;
	}
	el.empty.hidden = false;
	var tab = TABS.find(function (t) { return t.id === ui.tab; }).label;
	var what = !findBody(design, ui.body) ? "Add a body to begin"
		: !inst ? "Choose an installation at " + ui.body
		: ui.body + " · " + instLabel(inst) + " · " + tab;
	var why = "Click one of its chips in the table above, or add one from a column menu.";
	el.empty.innerHTML = '<div><b>' + esc(what) + '</b>' + esc(why) + '</div>';
}

function tabLabel(id) { return TABS.find(function (t) { return t.id === id; }).label; }

function showTab(entry) {
	if (!entry.handle) return;   // still loading; applied once mounted
	entry.handle.shell.setTab(ui.tab);
	entry.handle.shell.setOverline(entry.body + " · " + tabLabel(ui.tab));
}

function mountCalculator(inst, body) {
	var box = document.createElement("div");
	box.className = "hm-calc";
	el.work.appendChild(box);
	var entry = { el: box, handle: null, instId: inst.id, body: body };
	mounted[inst.id] = entry;
	var ctx = {
		body: body, inst: inst, lockBody: true, embedded: true,
		overline: body + " · " + tabLabel(ui.tab),
		partners: design.bodies.map(function (b) { return b.body; })
	};
	var key = calcFor(inst);
	var ready = key
		? CALCULATORS[key].load().then(function (mount) {
			var h = mount(box, ctx);
			var have = h.shell.cardTabs();
			addSkeletonCards(h.shell, ctx, TABS.map(function (t) { return t.id; }).filter(function (t) { return have.indexOf(t) < 0; }));
			return h;
		})
		: Promise.resolve(mountSkeleton(box, ctx));
	ready.then(function (h) {
		if (mounted[inst.id] !== entry) return;   // removed while loading
		if (inst.state) h.shell.setState(inst.state);
		entry.handle = h;
		if (!box.hidden) showTab(entry);
	}).catch(function (err) {
		box.innerHTML = '<div class="hm-empty"><div><b>The calculator didn\'t load</b>' + esc(err.message || String(err)) + '</div></div>';
	});
}

// Drop mounted calculators whose installation is gone (all of them when `all`).
function pruneMounted(all) {
	var live = {};
	design.bodies.forEach(function (b) { b.inst.forEach(function (i) { live[i.id] = true; }); });
	Object.keys(mounted).forEach(function (k) {
		if (all || !live[mounted[k].instId]) { mounted[k].el.remove(); delete mounted[k]; }
	});
}

// Copy each mounted calculator's settings into its installation.
function collectStates() {
	Object.keys(mounted).forEach(function (k) {
		var m = mounted[k];
		if (!m.handle) return;
		design.bodies.forEach(function (b) {
			b.inst.forEach(function (i) { if (i.id === m.instId) i.state = m.handle.getState(); });
		});
	});
}

function render() { pruneMounted(false); renderMatrix(); renderFacts(); renderBench(); }

// ---------- events ----------
document.addEventListener("click", function (e) {
	var t = e.target.closest("button");
	if (pop && !e.target.closest(".hm-pop") && !(t && (t.dataset.menu || t.dataset.mark))) closePop();
	if (!t) return;
	var d = t.dataset;
	if (d.menu === "body") { bodyMenu(t); return; }
	if (d.menu === "fam") { famMenu(t, d.fam, d.forbody); return; }
	if (d.mark) { markNote(t, d.mark); return; }
	if (d.addbody) { design = addBody(design, d.addbody); ui.body = d.addbody; ui.inst = null; closePop(); render(); return; }
	if (d.addinst) {
		var p = d.addinst.split("|"), res = addInstallation(design, p[2], p[0], p[1]);
		if (res.inst) { design = res.design; ui.body = p[2]; ui.inst = res.inst.id; }
		closePop(); render(); return;
	}
	if (d.rmbody) {
		design = removeBody(design, d.rmbody);
		if (ui.body === d.rmbody) selectBody(design.bodies[0] ? design.bodies[0].body : null);
		render(); return;
	}
	if (d.rminst) { design = removeInstallation(design, d.ib, d.rminst); selectBody(ui.body); render(); return; }
	if (d.body) { selectBody(d.body); render(); return; }
	if (d.inst) { ui.body = d.ib; ui.inst = d.inst; render(); return; }
	if (d.tab) { ui.tab = d.tab; renderBench(); return; }
});
document.addEventListener("keydown", function (e) {
	if (e.key === "Escape") { closePop(); closeSheet(); }
});

// ---------- save / export / import ----------
function toast(msg) {
	var old = el.bench.querySelector(".hm-toast");
	if (old) old.remove();
	var t = document.createElement("div");
	t.className = "hm-toast";
	t.setAttribute("role", "status");
	t.textContent = msg;
	el.bench.appendChild(t);
	setTimeout(function () { t.remove(); }, 2800);
}
function snapshot() {
	collectStates();
	return serializeDesign(design, { body: ui.body, inst: ui.inst, tab: ui.tab });
}
function loadDesign(parsed) {
	pruneMounted(true);
	design = { kind: parsed.kind, version: parsed.version, name: parsed.name, savedAt: parsed.savedAt, bodies: parsed.bodies };
	var s = parsed.selected || {};
	selectBody(findBody(design, s.body) ? s.body : (design.bodies[0] ? design.bodies[0].body : null));
	var b = findBody(design, ui.body);
	if (b && b.inst.some(function (i) { return i.id === s.inst; })) ui.inst = s.inst;
	ui.tab = TABS.some(function (t) { return t.id === s.tab; }) ? s.tab : "arch";
	render();
}

document.getElementById("btnSave").addEventListener("click", function () {
	design.savedAt = new Date().toISOString();
	try {
		localStorage.setItem(STORE_KEY, snapshot());
		toast("Saved in this browser at " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
	} catch (err) {
		toast("This browser won't store the design. Use Export to keep a copy.");
	}
});

document.getElementById("btnExport").addEventListener("click", function () {
	var blob = new Blob([snapshot()], { type: "application/json" });
	var a = document.createElement("a");
	var slug = (design.name || "design").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design";
	a.href = URL.createObjectURL(blob);
	a.download = slug + ".moonwards.json";
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
	toast("Downloaded " + a.download);
});

var sheet = null;
function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
document.getElementById("btnImport").addEventListener("click", function () {
	closeSheet();
	sheet = document.createElement("div");
	sheet.className = "hm-sheet-bg";
	sheet.innerHTML = '<div class="hm-sheet" role="dialog" aria-modal="true" aria-labelledby="imH">' +
		'<h3 id="imH">Import a design</h3><p>Choose a design file you exported, or paste its text. It replaces the design that\'s open now.</p>' +
		'<input type="file" id="imFile" accept=".json,application/json">' +
		'<textarea id="imText" aria-label="Design text" placeholder="…or paste the design text here"></textarea>' +
		'<div class="hm-sheet-row"><span class="hm-msg" id="imMsg"></span><button class="hm-btn" type="button" data-close>Cancel</button><button class="hm-btn hm-pri" type="button" id="imGo">Import</button></div></div>';
	el.bench.appendChild(sheet);
	sheet.addEventListener("click", function (e) { if (e.target === sheet || e.target.closest("[data-close]")) closeSheet(); });
	document.getElementById("imFile").addEventListener("change", function (e) {
		var f = e.target.files[0];
		if (!f) return;
		var r = new FileReader();
		r.onload = function () { document.getElementById("imText").value = r.result; };
		r.readAsText(f);
	});
	document.getElementById("imGo").addEventListener("click", function () {
		try {
			loadDesign(parseDesign(JSON.parse(document.getElementById("imText").value)));
			closeSheet();
			toast("Design imported");
		} catch (err) {
			document.getElementById("imMsg").textContent = err instanceof SyntaxError ? "That text isn't design data." : err.message;
		}
	});
	document.getElementById("imFile").focus();
});

// ---------- start ----------
try {
	var saved = localStorage.getItem(STORE_KEY);
	if (saved) loadDesign(parseDesign(JSON.parse(saved)));
} catch (err) {
	// No usable saved design (or storage is blocked): open on the example.
}
render();
