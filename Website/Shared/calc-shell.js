// Calculator shell — builds the three-column calculator page. ES module:
//   import { CalcShell, ShellColors } from "../../Shared/calc-shell.js";
//
// Styling is Shared/calc-shell.css (class list in its header); the drawing
// panel in the middle column is Shared/zoom-view.js. Calculators/_template/
// shows the whole wiring.
//
//   var shell = new CalcShell(document.getElementById("app"), { title: "Circular Orbit" });
//
// Modules are the optional parts a viewer switches on from the header chips.
// An input module (side "in") adds input cards; a result module (side "out")
// adds result cards. A module switches on what it `needs` (recursively) and an
// input module also switches on the result modules it `brings`; switching a
// module off switches off everything that needs it.
//
//   shell.addModule({ id: "tgt", side: "in", label: "Target orbit", color: ShellColors.teal, brings: ["xfer"] });
//   shell.addModule({ id: "xfer", side: "out", label: "Transfer", color: ShellColors.teal, needs: ["tgt"] });
//
// Cards appear in their column in the order added. A card with `module` shows
// only while that module is on. `focus` names the drawing view the card's title
// asks for (see onFocus); `short` is the title shown when collapsed, beside the
// card's summary (card.setSummary).
//
//   var card = shell.addCard({ id: "orbit", side: "in", title: "Orbit", short: "Orbit",
//                              color: ShellColors.core, focus: "orbit" });
//   var alt = shell.numberField(card, { label: "Altitude", unit: "km", value: 100, focus: "orbit" });
//   var speed = shell.line(card, { label: "Circular speed", unit: "m/s" });  speed.set("1,633.2");
//
// Events: onInput(fn) after any field changes; onFocus(fn(target, cardId)) when a
// card title is clicked or a field with `focus` gains focus; onModules(fn) after
// the set of shown modules changes. focusCard(id, false) highlights a card
// without asking the drawing to move (use it while a marker is dragged).

import { create } from "./ui-components.js";

// Accent pairs: `card` reads on the paper columns, `draw` on the dark drawing panel.
export const ShellColors = {
	core:   { card: "#D9471F", draw: "#FF6E40" },
	ochre:  { card: "#B97A0F", draw: "#F5B83D" },
	rust:   { card: "#A33A2A", draw: "#FF8A6B" },
	teal:   { card: "#0E8F80", draw: "#34CDBB" },
	cobalt: { card: "#3E5BD8", draw: "#7C95FF" },
	violet: { card: "#8A4FD6", draw: "#BE8CFF" },
	sky:    { card: "#2F7FA8", draw: "#6CC4F0" },
	umber:  { card: "#6B5A4B", draw: "#EADFCF" }
};

// ---- pure: module dependency resolution ------------------------------------
// defs: { id: { needs: [ids], brings: [ids] } }; on: { id: bool }. Return a new
// on-map with `id` switched (on → with everything it needs and brings; off →
// with everything that, directly or not, needs it).
export function switchModule(defs, on, id, value) {
	var next = Object.assign({}, on);
	function enable(m) {
		if (next[m]) return;
		next[m] = true;
		var d = defs[m] || {};
		(d.needs || []).forEach(enable);
		(d.brings || []).forEach(enable);
	}
	if (value) {
		enable(id);
	} else {
		next[id] = false;
		var changed = true;
		while (changed) {
			changed = false;
			Object.keys(defs).forEach(function (m) {
				if (next[m] && (defs[m].needs || []).some(function (n) { return !next[n]; })) {
					next[m] = false;
					changed = true;
				}
			});
		}
	}
	return next;
}

// ---- DOM ------------------------------------------------------------------
var svgNS = "http://www.w3.org/2000/svg";
function icon(path, size, sw, cls) {
	var s = document.createElementNS(svgNS, "svg");
	s.setAttribute("width", size); s.setAttribute("height", size);
	s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("fill", "none");
	s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", sw || 1.5);
	s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
	s.setAttribute("aria-hidden", "true");
	if (cls) s.setAttribute("class", cls);
	s.innerHTML = path;
	return s;
}
var ICON = {
	plus: '<path d="M8 3.5v9M3.5 8h9"/>',
	x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
	chev: '<path d="M4 6l4 4 4-4"/>',
	loc: '<circle cx="8" cy="8" r="4.5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/>',
	collapse: '<path d="M4 3l4 3 4-3M4 13l4-3 4 3"/>',
	expand: '<path d="M4 6l4-3 4 3M4 10l4 3 4-3"/>'
};
function button(cls, label, parent) {
	var b = create("button", cls, false, parent);
	b.type = "button";
	if (label) { b.setAttribute("aria-label", label); b.title = label; }
	return b;
}

export class CalcShell {
	constructor(root, opts) {
		var o = opts || {};
		this.root = root;
		root.classList.add("cs-app");
		this.modules = {};      // id → def
		this.moduleOrder = [];
		this.on = {};           // id → bool
		this.cards = {};        // id → card
		this.cardOrder = [];
		this.focusId = null;
		this.listeners = { input: [], focus: [], modules: [] };

		var top = create("header", "cs-top", false, root);
		var brand = create("div", "cs-brand", false, top);
		create("span", "cs-over", o.overline || "Moonwards · Calculators", brand);
		create("h1", "cs-title", o.title || "", brand);
		this.chipBox = {
			in: this._chipGroup(top, "Inputs", "Optional input modules", false),
			out: this._chipGroup(top, "Results", "Optional result modules", true)
		};

		var cols = create("div", "cs-cols", false, root);
		this.columns = {
			in: this._column(cols, "Inputs", "cs-col-in"),
			out: null
		};
		this.stage = create("section", "cs-stage", false, cols);
		this.stage.setAttribute("aria-label", o.stageLabel || "Drawing");
		this.columns.out = this._column(cols, "Results", "cs-col-out");
		this.warning = create("div", "cs-warn", false, false);
		this.warning.hidden = true;
		this.columns.out.list.appendChild(this.warning);
	}

	_chipGroup(parent, name, aria, out) {
		var g = create("div", out ? ["cs-mods", "cs-mods-out"] : "cs-mods", false, parent);
		g.setAttribute("role", "group");
		g.setAttribute("aria-label", aria);
		create("span", "cs-mods-l", name, g);
		g.hidden = true;
		return g;
	}

	_column(parent, name, cls) {
		var col = create("section", ["cs-col", cls], false, parent);
		col.setAttribute("aria-label", name);
		var h = create("div", "cs-col-h", false, col);
		var h2 = create("h2", false, name, h);
		var cnt = create("span", "cs-cnt", false, h2);
		var self = this, side = cls === "cs-col-in" ? "in" : "out";
		button("cs-ib", "Collapse all", h).appendChild(icon(ICON.collapse, 16));
		h.lastChild.onclick = function () { self.collapseAll(side, true); };
		button("cs-ib", "Expand all", h).appendChild(icon(ICON.expand, 16));
		h.lastChild.onclick = function () { self.collapseAll(side, false); };
		var list = create("div", "cs-scroller", false, col);
		return { el: col, list: list, count: cnt };
	}

	// ---- modules ----
	addModule(def) {
		var d = Object.assign({ needs: [], brings: [], side: "in" }, def);
		this.modules[d.id] = d;
		this.moduleOrder.push(d.id);
		this.on[d.id] = !!d.on;
		var color = d.color && d.color.card ? d.color.card : (d.color || "#6B5A4B");
		var chip = button("cs-chip", false, this.chipBox[d.side]);
		chip.style.setProperty("--mc", color);
		chip.title = d.tip || "";
		create("span", "cs-chip-dot", false, chip);
		create("span", false, d.label, chip);
		var self = this;
		chip.onclick = function () { self.setModule(d.id, !self.on[d.id]); };
		d.chip = chip;
		this.chipBox[d.side].hidden = false;
		this._refresh();
		return d;
	}

	isOn(id) { return !!this.on[id]; }

	setModule(id, value) {
		var defs = {};
		var self = this;
		this.moduleOrder.forEach(function (m) { defs[m] = self.modules[m]; });
		var before = this.on;
		this.on = switchModule(defs, this.on, id, value);
		// open and focus the first card of a module just switched on by the viewer
		if (value) {
			var first = this.cardOrder.find(function (c) { return self.cards[c].module === id; });
			if (first) { this.setCollapsed(first, false); this.focusCard(first); }
		}
		this._refresh();
		var changed = Object.keys(this.on).some(function (m) { return !!before[m] !== !!self.on[m]; });
		if (changed) this.listeners.modules.forEach(function (fn) { fn(self.on); });
	}

	// ---- cards ----
	addCard(def) {
		var self = this;
		var d = Object.assign({ side: "in" }, def);
		var color = d.color && d.color.card ? d.color.card : (d.color || "var(--cs-core)");
		var el = create("div", "cs-card", false, this.columns[d.side].list);
		el.style.setProperty("--mc", color);
		var h = create("div", "cs-card-h", false, el);
		var t = button("cs-card-t", false, h);
		create("span", "cs-dot", false, t);
		create("span", "cs-nm", d.title, t);
		create("span", "cs-nm-s", d.short || d.title, t);
		if (d.module) create("span", "cs-tag", "module", t);
		var sum = create("span", "cs-sum", false, t);
		t.appendChild(icon(ICON.loc, 16, 1.5, "cs-loc"));
		t.onclick = function () { self.focusCard(d.id); };
		var chev = button("cs-ib", "Collapse card", h);
		chev.appendChild(icon(ICON.chev, 16, 1.6, "cs-chev"));
		chev.onclick = function () { self.setCollapsed(d.id, !card.collapsed); };
		if (d.module) {
			var rm = button(["cs-ib", "cs-rm"], "Remove module", h);
			rm.appendChild(icon(ICON.x, 14));
			rm.onclick = function () { self.setModule(d.module, false); };
		}
		var body = create("div", "cs-card-b", false, el);
		var card = {
			id: d.id, side: d.side, module: d.module || null, focus: d.focus || null,
			el: el, body: body, collapsed: false, chev: chev,
			setSummary: function (text) { sum.textContent = text; }
		};
		this.cards[d.id] = card;
		this.cardOrder.push(d.id);
		if (d.collapsed) this.setCollapsed(d.id, true);
		this._refresh();
		return card;
	}

	setCollapsed(id, value) {
		var c = this.cards[id];
		if (!c) return;
		c.collapsed = !!value;
		c.el.classList.toggle("cs-collapsed", c.collapsed);
		c.body.hidden = c.collapsed;
		c.chev.setAttribute("aria-expanded", String(!c.collapsed));
	}

	collapseAll(side, value) {
		var self = this;
		this.cardOrder.forEach(function (id) { if (self.cards[id].side === side) self.setCollapsed(id, value); });
	}

	focusCard(id, target) {
		var self = this;
		var c = this.cards[id];
		if (!c) return;
		if (this.focusId && this.cards[this.focusId]) this.cards[this.focusId].el.classList.remove("cs-focus");
		this.focusId = id;
		c.el.classList.add("cs-focus");
		var tgt = target === false ? null : (target || c.focus);   // false: highlight only
		if (tgt) this.listeners.focus.forEach(function (fn) { fn(tgt, id); });
	}

	_refresh() {
		var self = this;
		this.moduleOrder.forEach(function (m) {
			var d = self.modules[m], on = !!self.on[m];
			d.chip.classList.toggle("cs-on", on);
			d.chip.setAttribute("aria-pressed", String(on));
			var old = d.chip.querySelector("svg");
			if (old) old.remove();
			d.chip.appendChild(icon(on ? ICON.x : ICON.plus, 12, 1.6));
		});
		var shown = { in: 0, out: 0 };
		this.cardOrder.forEach(function (id) {
			var c = self.cards[id];
			var vis = !c.module || !!self.on[c.module];
			c.el.hidden = !vis;
			if (vis) shown[c.side]++;
		});
		this.columns.in.count.textContent = shown.in + " cards";
		this.columns.out.count.textContent = shown.out + " cards";
	}

	// ---- fields (inputs) ----
	_row(card, label, hint, full, tip, parent) {
		var row = create("label", full ? ["cs-row", "cs-full"] : "cs-row", false, parent || card.body);
		if (label) {
			var l = create("span", "cs-lbl", label, row);
			if (hint) create("span", "cs-hint", hint, l);
		}
		if (tip) { row.title = tip; row.classList.add("cs-tipped"); }
		return create("span", "cs-fld", false, row);
	}
	_wire(card, el, focus) {
		var self = this;
		el.addEventListener("input", function () { self.listeners.input.forEach(function (fn) { fn(el); }); });
		el.addEventListener("change", function () { self.listeners.input.forEach(function (fn) { fn(el); }); });
		if (focus) el.addEventListener("focus", function () { self.focusCard(card.id, focus); });
	}

	// opts: { label, hint, tip, unit, value, step, min, max, focus, parent }. Returns the <input>.
	// `tip` is a longer explanation shown on hover over the label; `parent` places
	// the row inside an element of the card (e.g. a group shown only sometimes).
	numberField(card, opts) {
		var fld = this._row(card, opts.label, opts.hint, false, opts.tip, opts.parent);
		var input = create("input", false, false, fld);
		input.type = "number";
		input.step = opts.step || "any";
		if (opts.min != null) input.min = opts.min;
		if (opts.max != null) input.max = opts.max;
		input.value = opts.value;
		if (opts.unit) create("span", "cs-u", opts.unit, fld);
		this._wire(card, input, opts.focus);
		return input;
	}

	// opts: { label, hint, tip, options: [{ value, label }], value, focus }. Full width without a label.
	selectField(card, opts) {
		var fld = this._row(card, opts.label, opts.hint, !opts.label, opts.tip, opts.parent);
		var sel = create("select", false, false, fld);
		if (!opts.label && opts.aria) sel.setAttribute("aria-label", opts.aria);
		opts.options.forEach(function (o) { create("option", false, o.label, sel).value = o.value; });
		if (opts.value != null) sel.value = opts.value;
		this._wire(card, sel, opts.focus);
		return sel;
	}

	note(card, text, parent) { return create("p", "cs-note", text, parent || card.body); }

	// A button in a card: { label, primary }. Returns the <button>.
	button(card, opts) {
		var b = create("button", opts.primary ? ["cs-btn", "cs-btn-pri"] : "cs-btn", opts.label, card.body);
		b.type = "button";
		return b;
	}

	// ---- results ----
	// A line: label, value + unit, optional sub-note. Returns { el, set(value, sub, unit), show(bool) }.
	line(card, opts) {
		var box = card._kvs || (card._kvs = create("div", "cs-kvs", false, card.body));
		var row = create("div", "cs-kv", false, box);
		create("span", "cs-k", opts.label, row);
		var v = create("span", "cs-v", false, row);
		var vn = create("span", "cs-vn", false, v);
		var vu = opts.unit ? create("small", "cs-vu", opts.unit, v) : null;
		var s = create("span", "cs-s", opts.sub || "", row);
		return {
			el: row,
			set: function (value, sub, unit) {
				vn.textContent = value;
				if (sub != null) s.textContent = sub;
				if (unit != null && vu) vu.textContent = unit;
			},
			show: function (on) { row.hidden = !on; }
		};
	}

	// The key-figure bar: items [{ label, unit }]. Returns one { set(value) } per item.
	hero(card, items) {
		var bar = create("div", "cs-hero", false, card.body);
		return items.map(function (it) {
			var cell = create("div", false, false, bar);
			create("span", "cs-hl", it.label, cell);
			var v = create("strong", "cs-hv", false, cell);
			var n = create("span", "cs-hn", false, v);
			if (it.unit) create("small", "cs-hu", it.unit, v);
			return { set: function (value) { n.textContent = value; } };
		});
	}

	// Warning text at the top of the results column; empty hides it.
	warn(text) {
		this.warning.textContent = text || "";
		this.warning.hidden = !text;
	}

	// ---- events ----
	onInput(fn) { this.listeners.input.push(fn); }
	onFocus(fn) { this.listeners.focus.push(fn); }
	onModules(fn) { this.listeners.modules.push(fn); }
}
