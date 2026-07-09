// chain-strip.js — Migration step 4.2 mockups.
//
// Three layout variants of the mission-profile chain strip, all rendered from
// ONE shared fake mission so edits made in any variant appear in all three.
// Deliberately disposable: no imports (not even Shared/), no real physics —
// every number is canned. The real strip gets rebuilt against
// MissionPlanner/core in step 4.3 once a direction is picked.

// ---------------------------------------------------------------- fake data

const REGISTRY = [
	{ id: "moon-skyhook",   title: "Moon skyhook",         kind: "tech", body: "Moon",   glyph: "⚓" },
	{ id: "phobos-skyhook", title: "Phobos skyhook",       kind: "tech", body: "Phobos", glyph: "⚓" },
	{ id: "ceres-elevator", title: "Ceres space elevator", kind: "tech", body: "Ceres",  glyph: "⇅" },
	{ id: "spin-launcher",  title: "Tip spin launcher",    kind: "tech", body: "Ceres",  glyph: "✦" },
	{ id: "mass-driver",    title: "Mass driver",          kind: "tech", body: "Moon",   glyph: "➤" },
	{ id: "aerobrake",      title: "Aerobrake",            kind: "tech", body: "Mars",   glyph: "◗" },
	{ id: "transfer-leg",   title: "Transfer leg",         kind: "leg",  body: null,     glyph: "↷" },
];

function moduleById(id) {
	for (const m of REGISTRY) if (m.id === id) return m;
	return { id, title: id, kind: "tech", body: null, glyph: "?" };
}

// Canned readout numbers per module type, used for freshly added/swapped stages.
const FAKE_NUMS = {
	"moon-skyhook":   [["release v∞", "1.83 km/s"], ["date", "2030-11-02"]],
	"phobos-skyhook": [["release v∞", "0.94 km/s"], ["date", "2031-01-15"]],
	"ceres-elevator": [["catch v∞", "1.21 km/s"], ["margin", "+0.69 km/s"]],
	"spin-launcher":  [["tip speed", "2.10 km/s"], ["spin-up", "4.2 d"]],
	"mass-driver":    [["exit speed", "2.40 km/s"], ["length", "38 km"]],
	"aerobrake":      [["entry v", "5.9 km/s"], ["peak g", "3.1 g"]],
	"transfer-leg":   [["Δv", "1.40 km/s"], ["TOF", "212 d"]],
};

// The worked-example mission from ARCHITECTURE.md.
function initialStages() {
	return [
		{ id: "s1", module: "moon-skyhook",   label: "Moon skyhook release", nums: [["release v∞", "1.83 km/s"], ["date", "2030-11-02"]] },
		{ id: "s2", module: "transfer-leg",   label: "Earth-escape leg",     nums: [["Δv", "0.42 km/s"], ["TOF", "9.4 d"]] },
		{ id: "s3", module: "transfer-leg",   label: "Heliocentric leg",     nums: [["Δv", "3.12 km/s"], ["burns", "2"]] },
		{ id: "s4", module: "transfer-leg",   label: "Ceres capture",        nums: [["Δv", "1.05 km/s"], ["arrive", "2032-06-19"]] },
		{ id: "s5", module: "ceres-elevator", label: "Ceres elevator catch", nums: [["catch v∞", "1.21 km/s"], ["margin", "+0.69 km/s"]] },
	];
}

const FAIL_STAGE_ID = "s4"; // the “Inject failure” toggle targets this stage
const FAIL_DIAG = {
	short: "v∞ 3.41 > max 1.90 km/s",
	msg: "Arrival v∞ of 3.41 km/s exceeds the capture budget of 1.90 km/s.",
	fix: "possible fix: a later arrival date, or a deeper capture burn",
};

const STATUS_COLORS = { ok: "#4cc38a", diagnostic: "#ff7a5c", blocked: "#6b7589" };

// ---------------------------------------------------------------- state

const state = {
	stages: initialStages(),
	selected: "s3",
	injectFailure: false,
};
let nextId = 6;
let dragId = null;
let menuEl = null;

// Status per stage: ok | diagnostic | blocked (mirrors the core engine's
// per-stage results — a diagnostic at one stage blocks everything downstream).
function statuses() {
	const map = new Map();
	let failedStage = null;
	for (const st of state.stages) {
		if (failedStage) {
			map.set(st.id, { s: "blocked", by: failedStage });
		} else if (state.injectFailure && st.id === FAIL_STAGE_ID) {
			map.set(st.id, { s: "diagnostic", short: FAIL_DIAG.short, msg: FAIL_DIAG.msg, fix: FAIL_DIAG.fix });
			failedStage = st;
		} else {
			map.set(st.id, { s: "ok" });
		}
	}
	return map;
}

// ---------------------------------------------------------------- helpers

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

function glyphEl(mod) {
	return el("span", "chs-glyph chs-glyph-" + mod.kind, mod.glyph);
}

function select(id) {
	state.selected = id;
	renderAll();
}

function removeStage(id) {
	const i = state.stages.findIndex((s) => s.id === id);
	if (i < 0) return;
	state.stages.splice(i, 1);
	if (state.selected === id) {
		const next = state.stages[Math.min(i, state.stages.length - 1)];
		state.selected = next ? next.id : null;
	}
	renderAll();
}

function swapStage(id, moduleId) {
	const st = state.stages.find((s) => s.id === id);
	if (!st) return;
	const mod = moduleById(moduleId);
	st.module = moduleId;
	st.label = mod.title;
	st.nums = (FAKE_NUMS[moduleId] || []).map((p) => p.slice());
	renderAll();
}

function addStage(index, moduleId) {
	const mod = moduleById(moduleId);
	const st = {
		id: "s" + nextId++,
		module: moduleId,
		label: mod.title,
		nums: (FAKE_NUMS[moduleId] || []).map((p) => p.slice()),
	};
	state.stages.splice(index, 0, st);
	state.selected = st.id;
	renderAll();
}

function moveStage(id, gapIndex) {
	const from = state.stages.findIndex((s) => s.id === id);
	if (from < 0) return;
	const st = state.stages.splice(from, 1)[0];
	let to = gapIndex;
	if (from < gapIndex) to -= 1;
	state.stages.splice(to, 0, st);
	renderAll();
}

// ---------------------------------------------------------------- drag & drop

function makeDraggable(elm, id) {
	elm.draggable = true;
	elm.addEventListener("dragstart", (e) => {
		dragId = id;
		e.dataTransfer.effectAllowed = "move";
		try { e.dataTransfer.setData("text/plain", id); } catch (err) { /* ignore */ }
	});
	elm.addEventListener("dragend", () => { dragId = null; });
}

function makeDropGap(elm, gapIndex) {
	elm.addEventListener("dragover", (e) => {
		if (dragId === null) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		elm.classList.add("dragover");
	});
	elm.addEventListener("dragleave", () => elm.classList.remove("dragover"));
	elm.addEventListener("drop", (e) => {
		e.preventDefault();
		elm.classList.remove("dragover");
		if (dragId !== null) moveStage(dragId, gapIndex);
	});
}

// ---------------------------------------------------------------- popup menu

function closeMenu() {
	if (menuEl) { menuEl.remove(); menuEl = null; }
	document.removeEventListener("pointerdown", onDocPointerDown);
}

function onDocPointerDown(e) {
	if (menuEl && !menuEl.contains(e.target)) closeMenu();
}

function openMenu(anchor, title, onPick, currentId) {
	closeMenu();
	const m = el("div", "chs-menu");
	m.appendChild(el("div", "chs-menu-title", title));
	for (const mod of REGISTRY) {
		const item = el("div", "chs-menu-item" + (mod.id === currentId ? " current" : ""));
		item.appendChild(glyphEl(mod));
		item.appendChild(el("span", "", mod.title));
		if (mod.body) item.appendChild(el("span", "chs-menu-body", mod.body));
		item.addEventListener("click", () => { closeMenu(); onPick(mod.id); });
		m.appendChild(item);
	}
	document.body.appendChild(m);
	const r = anchor.getBoundingClientRect();
	const left = Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - m.offsetWidth - 12);
	m.style.left = Math.max(12, left) + "px";
	m.style.top = (r.bottom + window.scrollY + 4) + "px";
	menuEl = m;
	setTimeout(() => document.addEventListener("pointerdown", onDocPointerDown), 0);
}

// small helpers for the card control buttons
function iconBtn(label, tip, onClick) {
	const b = el("button", "chs-iconbtn", label);
	b.title = tip;
	b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
	return b;
}

function plusBtn(gapIndex) {
	const b = iconBtn("+", "Insert a stage here", (e) => {
		openMenu(e.currentTarget, "Insert stage", (moduleId) => addStage(gapIndex, moduleId), null);
	});
	b.classList.add("chs-a-plus"); // hover-revealed on connectors (gaps/links)
	return b;
}

// =============================================================== variant A

function renderStripA() {
	const host = document.getElementById("chs-strip-a");
	host.textContent = "";
	const stat = statuses();

	const lead = el("div", "chs-a-endpad");
	lead.appendChild(plusBtn(0));
	makeDropGap(lead, 0);
	host.appendChild(lead);

	if (!state.stages.length) host.appendChild(el("div", "chs-empty", "Empty mission — add a first stage."));

	state.stages.forEach((st, i) => {
		host.appendChild(cardA(st, stat.get(st.id)));
		if (i < state.stages.length - 1) {
			const gap = el("div", "chs-a-gap");
			gap.appendChild(el("span", "chs-pktpill", "ship-state"));
			gap.appendChild(plusBtn(i + 1));
			makeDropGap(gap, i + 1);
			host.appendChild(gap);
		}
	});

	const tail = el("div", "chs-a-endpad");
	tail.appendChild(plusBtn(state.stages.length));
	makeDropGap(tail, state.stages.length);
	host.appendChild(tail);
}

function cardA(st, s) {
	const mod = moduleById(st.module);
	const card = el("div", "chs-a-card" +
		(st.id === state.selected ? " selected" : "") +
		(s.s === "blocked" ? " blocked" : ""));

	const stripe = el("div", "chs-a-stripe");
	stripe.style.background = STATUS_COLORS[s.s];
	card.appendChild(stripe);

	const head = el("div", "chs-a-head");
	head.appendChild(glyphEl(mod));
	head.appendChild(el("span", "chs-a-title", st.label));
	card.appendChild(head);

	if (mod.body) card.appendChild(el("span", "chs-bodychip", mod.body));

	const rows = el("div", "chs-a-rows");
	if (s.s === "diagnostic") {
		rows.appendChild(el("div", "chs-a-msg chs-diagtext", "⚠ " + s.short));
	} else if (s.s === "blocked") {
		rows.appendChild(el("div", "chs-a-msg chs-blockedtext", "⏸ waiting on “" + s.by.label + "”"));
	} else {
		for (const pair of st.nums) {
			const row = el("div", "chs-a-row");
			row.appendChild(el("span", "k", pair[0]));
			row.appendChild(el("span", "v", pair[1]));
			rows.appendChild(row);
		}
	}
	card.appendChild(rows);

	const ctrls = el("div", "chs-a-ctrls");
	ctrls.appendChild(iconBtn("⇄", "Swap module", (e) => {
		openMenu(e.currentTarget, "Swap module", (moduleId) => swapStage(st.id, moduleId), st.module);
	}));
	ctrls.appendChild(iconBtn("✕", "Remove stage", () => removeStage(st.id)));
	card.appendChild(ctrls);

	card.addEventListener("click", () => select(st.id));
	makeDraggable(card, st.id);
	return card;
}

// =============================================================== variant B

function renderStripB() {
	const host = document.getElementById("chs-strip-b");
	host.textContent = "";
	const stat = statuses();

	const lead = el("div", "chs-b-gap");
	lead.appendChild(plusBtn(0));
	makeDropGap(lead, 0);
	host.appendChild(lead);

	if (!state.stages.length) host.appendChild(el("div", "chs-empty", "Empty mission."));

	state.stages.forEach((st, i) => {
		host.appendChild(cardB(st, stat.get(st.id)));
		if (i < state.stages.length - 1) {
			const gap = el("div", "chs-b-gap");
			gap.appendChild(el("span", "chs-pktpill", "ship-state ↓"));
			gap.appendChild(plusBtn(i + 1));
			makeDropGap(gap, i + 1);
			host.appendChild(gap);
		}
	});

	const add = el("button", "chs-b-addbtn", "+ Add stage");
	add.addEventListener("click", (e) => {
		openMenu(e.currentTarget, "Add stage", (moduleId) => addStage(state.stages.length, moduleId), null);
	});
	makeDropGap(add, state.stages.length);
	host.appendChild(add);
}

function cardB(st, s) {
	const mod = moduleById(st.module);
	const card = el("div", "chs-b-card" +
		(st.id === state.selected ? " selected" : "") +
		(s.s === "blocked" ? " blocked" : ""));

	const head = el("div", "chs-b-head");
	head.appendChild(el("span", "chs-b-handle", "≡"));
	const dot = el("span", "chs-b-dot");
	dot.style.background = STATUS_COLORS[s.s];
	head.appendChild(dot);
	head.appendChild(glyphEl(mod));
	head.appendChild(el("span", "chs-b-title", st.label));
	head.appendChild(iconBtn("⇄", "Swap module", (e) => {
		openMenu(e.currentTarget, "Swap module", (moduleId) => swapStage(st.id, moduleId), st.module);
	}));
	head.appendChild(iconBtn("✕", "Remove stage", () => removeStage(st.id)));
	card.appendChild(head);

	if (s.s === "diagnostic") {
		card.appendChild(el("div", "chs-b-msg chs-diagtext", "⚠ " + s.short));
	} else if (s.s === "blocked") {
		card.appendChild(el("div", "chs-b-msg chs-blockedtext", "⏸ waiting on “" + s.by.label + "” — parameters kept"));
	} else {
		const sub = el("div", "chs-b-sub");
		if (mod.body) sub.appendChild(el("span", "chs-bodychip", mod.body));
		for (const pair of st.nums) {
			const n = el("span", "chs-b-num");
			n.appendChild(el("span", "k", pair[0]));
			n.appendChild(el("span", "v", pair[1]));
			sub.appendChild(n);
		}
		card.appendChild(sub);
	}

	card.addEventListener("click", () => select(st.id));
	makeDraggable(card, st.id);
	return card;
}

// =============================================================== variant C

function renderStripC() {
	const host = document.getElementById("chs-strip-c");
	host.textContent = "";
	const stat = statuses();

	const lead = el("div", "chs-c-leadpad");
	makeDropGap(lead, 0);
	host.appendChild(lead);

	if (!state.stages.length) host.appendChild(el("div", "chs-empty", "Empty mission — use the + node."));

	state.stages.forEach((st, i) => {
		host.appendChild(nodeC(st, stat.get(st.id)));
		if (i < state.stages.length - 1) {
			const link = el("div", "chs-c-link");
			link.appendChild(plusBtn(i + 1));
			makeDropGap(link, i + 1);
			host.appendChild(link);
		}
	});

	const tail = el("div", "chs-c-endpad");
	const plus = el("div", "chs-c-dot", "+");
	plus.title = "Add a stage at the end";
	plus.addEventListener("click", (e) => {
		openMenu(e.currentTarget, "Add stage", (moduleId) => addStage(state.stages.length, moduleId), null);
	});
	tail.appendChild(plus);
	makeDropGap(tail, state.stages.length);
	host.appendChild(tail);
}

function nodeC(st, s) {
	const mod = moduleById(st.module);
	const node = el("div", "chs-c-node" +
		(st.id === state.selected ? " selected" : "") +
		(s.s === "blocked" ? " blocked" : ""));
	const dot = el("div", "chs-c-dot", mod.glyph);
	dot.style.borderColor = STATUS_COLORS[s.s];
	node.appendChild(dot);
	let labelText = st.label;
	if (s.s === "diagnostic") labelText = "⚠ " + labelText;
	if (s.s === "blocked") labelText = "⏸ " + labelText;
	node.appendChild(el("div", "chs-c-label", labelText));
	node.title = st.label;
	node.addEventListener("click", () => select(st.id));
	makeDraggable(node, st.id);
	return node;
}

// ==================================================== stage panel (shared)

const FAKE_PARAMS = {
	tech: [["release altitude", 62], ["tip phase", 38]],
	leg:  [["departure date", 45], ["time of flight", 70]],
};

function buildPanelCard() {
	const wrap = el("div", "");
	wrap.appendChild(el("h3", "chs-panel-h", "Selected stage"));

	const st = state.stages.find((x) => x.id === state.selected);
	if (!st) {
		wrap.appendChild(el("div", "chs-muted", "No stage selected."));
		return wrap;
	}
	const s = statuses().get(st.id);
	const mod = moduleById(st.module);

	const card = el("div", "chs-panel-card");
	const head = el("div", "chs-pc-head");
	head.appendChild(glyphEl(mod));
	head.appendChild(el("span", "chs-pc-title", st.label));
	const dot = el("span", "chs-b-dot");
	dot.style.background = STATUS_COLORS[s.s];
	head.appendChild(dot);
	card.appendChild(head);

	if (mod.body) card.appendChild(el("span", "chs-bodychip", mod.body));

	const status = el("div", "chs-pc-status");
	if (s.s === "ok") {
		status.appendChild(el("span", "chs-oktext", "✓ feasible"));
	} else if (s.s === "diagnostic") {
		status.appendChild(el("div", "chs-diagtext", "⚠ " + s.msg));
		status.appendChild(el("div", "chs-pc-fix", s.fix));
	} else {
		status.appendChild(el("span", "chs-blockedtext",
			"⏸ blocked — waiting on “" + s.by.label + "”. Parameters kept."));
	}
	card.appendChild(status);

	if (s.s !== "blocked") {
		for (const pair of st.nums) {
			const row = el("div", "chs-pc-row");
			row.appendChild(el("span", "k", pair[0]));
			row.appendChild(el("span", "v", pair[1]));
			card.appendChild(row);
		}
	}

	const params = el("div", "chs-pc-params");
	for (const p of FAKE_PARAMS[mod.kind]) {
		const box = el("div", "chs-pc-param");
		box.appendChild(el("span", "k", p[0]));
		const slider = el("input", "");
		slider.type = "range";
		slider.min = "0"; slider.max = "100"; slider.value = String(p[1]);
		slider.disabled = true;
		box.appendChild(slider);
		params.appendChild(box);
	}
	card.appendChild(params);

	const btns = el("div", "chs-pc-btns");
	const swapB = el("button", "", "⇄ Swap module");
	swapB.addEventListener("click", (e) => {
		openMenu(e.currentTarget, "Swap module", (moduleId) => swapStage(st.id, moduleId), st.module);
	});
	const remB = el("button", "", "✕ Remove");
	remB.addEventListener("click", () => removeStage(st.id));
	btns.appendChild(swapB);
	btns.appendChild(remB);
	card.appendChild(btns);

	card.appendChild(el("div", "chs-pc-note",
		"Mock panel card — in the real shell the module builds this itself via ctx.panelHost; sliders here are decorative."));

	wrap.appendChild(card);
	return wrap;
}

function renderPanels() {
	for (const hostId of ["chs-panel-a", "chs-panel-b", "chs-panel-c"]) {
		const host = document.getElementById(hostId);
		host.textContent = "";
		host.appendChild(buildPanelCard());
	}
}

// ---------------------------------------------------------------- wiring

function renderAll() {
	closeMenu();
	renderStripA();
	renderStripB();
	renderStripC();
	renderPanels();
}

const injectBox = document.getElementById("chs-inject");
injectBox.addEventListener("change", () => {
	state.injectFailure = injectBox.checked;
	renderAll();
});

document.getElementById("chs-reset").addEventListener("click", () => {
	state.stages = initialStages();
	state.selected = "s3";
	state.injectFailure = false;
	injectBox.checked = false;
	renderAll();
});

renderAll();
