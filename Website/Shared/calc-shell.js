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
// A fold is a block inside a card that opens and closes on its own arrow, for
// detail a viewer looks at only sometimes (a breakdown under a card's totals).
// Result lines and notes go in it the same way they go in a card:
//
//   var fold = shell.fold(card, { label: "By section" });
//   var l = shell.line(fold, { label: "Top → deck", unit: "MN" });
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
//
// Tabs: a module or card may carry `tab` (e.g. "arch", "log", "eng", "eco").
// After setTab(tab), only that tab's chips and cards show; a card or module
// without `tab` belongs to the first tab set (opts.firstTab, default "arch").
// Until setTab is called every card shows, as on a standalone page. Input
// and result cards stay wired across tabs: they are one calculator.
//
// Wiring made visible: an input card's `feeds` lists result card ids; focusing
// the input card marks those (cs-fed), so a viewer sees where its numbers go.
//
// Embedding: `embedded: true` fills the root element instead of the window,
// for a calculator mounted inside another page (the home page's workbench).
// getState() returns the viewer's settings — field values, modules shown,
// collapsed cards, open folds — as a plain object; setState(state) puts them back and
// fires onInput once. Fields are keyed "<card id>/<label or aria>", so a
// calculator keeps a field's label and card stable for saved settings to
// keep finding it (or passes an explicit `key`).

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
		if (o.embedded) root.classList.add("cs-embedded");
		this.fields = {};       // key → input/select (getState / setState)
		this.modules = {};      // id → def
		this.moduleOrder = [];
		this.on = {};           // id → bool
		this.cards = {};        // id → card
		this.folds = {};        // "<card id>/<key or label>" → fold (getState / setState)
		this.cardOrder = [];
		this.focusId = null;
		this.tab = null;        // null: show every tab's cards (standalone page)
		this.firstTab = o.firstTab || "arch";
		this.listeners = { input: [], focus: [], modules: [] };

		// A page gets a header (title over the chip groups). An embedded
		// calculator has none: the columns take the full height, and the
		// chips and the one-line brand move into the column heads below.
		var top = o.embedded ? null : create("header", "cs-top", false, root);
		if (top) {
			var brand = create("div", "cs-brand", false, top);
			this.overEl = create("span", "cs-over", o.overline || "Moonwards · Calculators", brand);
			create("h1", "cs-title", o.title || "", brand);
			this.chipBox = {
				in: this._chipGroup(top, "Inputs", "Optional input modules", false),
				out: this._chipGroup(top, "Results", "Optional result modules", true)
			};
		}

		var cols = create("div", "cs-cols", false, root);
		this.columns = {
			in: this._column(cols, "Inputs", "cs-col-in"),
			out: null
		};
		this.stage = create("section", "cs-stage", false, cols);
		this.stage.setAttribute("aria-label", o.stageLabel || "Drawing");
		this.columns.out = this._column(cols, "Results", "cs-col-out");
		if (!top) {
			// Left column: brand, then the input chips, above the column head.
			var inEl = this.columns.in.el, outEl = this.columns.out.el;
			var brandEl = create("div", "cs-brand", false, inEl);
			this.overEl = create("span", "cs-over", o.overline || "Moonwards · Calculators", brandEl);
			this.chipBox = {
				in: this._chipGroup(inEl, "Inputs", "Optional input modules", false),
				out: this._chipGroup(outEl, "Results", "Optional result modules", false)
			};
			inEl.insertBefore(this.chipBox.in, inEl.firstChild);
			inEl.insertBefore(brandEl, inEl.firstChild);
			outEl.insertBefore(this.chipBox.out, outEl.firstChild);
		}
		this.warning = create("div", "cs-warn", false, false);
		this.warning.hidden = true;
		this.columns.out.list.appendChild(this.warning);
		this.columns.in.empty = create("p", "cs-empty", false, this.columns.in.list);
		this.columns.out.empty = create("p", "cs-empty", false, this.columns.out.list);
	}

	// ---- tabs ----
	setTab(tab) { this.tab = tab || null; this._refresh(); }
	setOverline(text) { this.overEl.textContent = text; }
	_tabOf(def) { return def.tab || this.firstTab; }
	_onTab(def) { return !this.tab || this._tabOf(def) === this.tab; }
	// Tabs that hold at least one card.
	cardTabs() {
		var self = this, seen = {};
		this.cardOrder.forEach(function (id) { seen[self._tabOf(self.cards[id])] = true; });
		return Object.keys(seen);
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
		var h2 = create("h2", false, false, h);
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
		d.tab = d.tab || null;
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
			tab: d.tab || null, feeds: d.feeds || [],
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
		this.cardOrder.forEach(function (k) { self.cards[k].el.classList.toggle("cs-fed", c.feeds.indexOf(k) >= 0); });
		var tgt = target === false ? null : (target || c.focus);   // false: highlight only
		if (tgt) this.listeners.focus.forEach(function (fn) { fn(tgt, id); });
	}

	_refresh() {
		var self = this;
		var chipsShown = { in: 0, out: 0 };
		this.moduleOrder.forEach(function (m) {
			var d = self.modules[m], on = !!self.on[m];
			d.chip.hidden = !self._onTab(d);
			if (!d.chip.hidden) chipsShown[d.side]++;
			d.chip.classList.toggle("cs-on", on);
			d.chip.setAttribute("aria-pressed", String(on));
			var old = d.chip.querySelector("svg");
			if (old) old.remove();
			d.chip.appendChild(icon(on ? ICON.x : ICON.plus, 12, 1.6));
		});
		this.chipBox.in.hidden = !chipsShown.in;
		this.chipBox.out.hidden = !chipsShown.out;
		var shown = { in: 0, out: 0 }, offered = { in: 0, out: 0 };
		this.cardOrder.forEach(function (id) {
			var c = self.cards[id];
			var here = self._onTab(c);
			var vis = here && (!c.module || !!self.on[c.module]);
			c.el.hidden = !vis;
			if (vis) shown[c.side]++;
			if (here) offered[c.side]++;
		});
		["in", "out"].forEach(function (side) {
			var col = self.columns[side];
			col.count.textContent = shown[side] + " cards";
			col.empty.hidden = shown[side] > 0;
			col.empty.textContent = offered[side] ? "Switch on a module above to add cards here."
				: (side === "in" ? "No inputs on this tab yet." : "No results on this tab yet.");
		});
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

	// opts: { label, hint, tip, unit, value, step, min, max, focus, parent, choice, choiceValue }.
	// Returns the <input>. `tip` is a longer explanation shown on hover over the
	// label; `parent` places the row inside an element of the card (e.g. a group
	// shown only sometimes). `choice` (a group from choice()) puts a radio button
	// at the start of the row, standing for `choiceValue`; editing the field
	// chooses it.
	numberField(card, opts) {
		var fld = this._row(card, opts.label, opts.hint, false, opts.tip, opts.parent);
		var input = create("input", false, false, fld);
		this._register(card, opts, input);
		input.type = "number";
		input.step = opts.step || "any";
		if (opts.min != null) input.min = opts.min;
		if (opts.max != null) input.max = opts.max;
		input.value = opts.value;
		if (opts.unit) create("span", "cs-u", opts.unit, fld);
		this._wire(card, input, opts.focus);
		if (opts.choice) opts.choice._add(fld.parentNode, opts.choiceValue, input);
		return input;
	}

	// A choice between alternatives, one per field row: pass the group as
	// `choice` (with `choiceValue`) to numberField. opts: { key, value } — `key`
	// names it in saved settings, `value` is the alternative chosen at first.
	// group.value reads or sets the chosen alternative; rows not chosen dim.
	choice(card, opts) {
		var self = this, rows = [], name = "cs-ch-" + card.id + "-" + opts.key;
		var chosen = opts.value;
		function mark() { rows.forEach(function (r) { r.radio.checked = r.value === chosen; r.row.classList.toggle("cs-unchosen", r.value !== chosen); }); }
		function pick(v, el) {
			if (v === chosen) return;
			chosen = v; mark();
			self.listeners.input.forEach(function (fn) { fn(el); });
		}
		var group = {
			disabled: false,
			get value() { return chosen; },
			set value(v) { if (rows.some(function (r) { return r.value === v; }) || !rows.length) { chosen = v; mark(); } },
			_add: function (row, value, input) {
				var radio = create("input", "cs-radio", false, false);
				radio.type = "radio"; radio.name = name; radio.value = value;
				row.insertBefore(radio, row.firstChild);
				row.classList.add("cs-choice");
				rows.push({ row: row, value: value, radio: radio });
				radio.addEventListener("change", function () { if (radio.checked) pick(value, radio); });
				input.addEventListener("focus", function () { pick(value, input); });
				mark();
			}
		};
		this._register(card, { key: opts.key }, group);
		return group;
	}

	// opts: { label, hint, tip, options: [{ value, label }], value, focus }. Full width without a label.
	selectField(card, opts) {
		var fld = this._row(card, opts.label, opts.hint, !opts.label, opts.tip, opts.parent);
		var sel = create("select", false, false, fld);
		if (!opts.label && opts.aria) sel.setAttribute("aria-label", opts.aria);
		opts.options.forEach(function (o) { create("option", false, o.label, sel).value = o.value; });
		this._register(card, opts, sel);
		if (opts.value != null) sel.value = opts.value;
		this._wire(card, sel, opts.focus);
		return sel;
	}

	note(card, text, parent) { return create("p", "cs-note", text, parent || card.body); }

	// A fold inside a card: { label, open, key }. Its arrow opens and closes it; it
	// starts closed unless `open`. Returns { el, body, open, setOpen(bool) }, which
	// shell.line and shell.note take in place of a card. Saved settings key it as
	// "<card id>/<key or label>".
	fold(card, opts) {
		var box = create("div", "cs-fold", false, card.body);
		var tg = button("cs-fold-t", false, box);
		tg.appendChild(icon(ICON.chev, 14, 1.6, "cs-chev"));
		create("span", false, opts.label, tg);
		var body = create("div", "cs-fold-b", false, box);
		var fold = {
			el: box, body: body, open: false,
			setOpen: function (value) {
				fold.open = !!value;
				box.classList.toggle("cs-open", fold.open);
				body.hidden = !fold.open;
				tg.setAttribute("aria-expanded", String(fold.open));
			}
		};
		tg.onclick = function () { fold.setOpen(!fold.open); };
		fold.setOpen(!!opts.open);
		this.folds[card.id + "/" + (opts.key || opts.label)] = fold;
		return fold;
	}

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

	// ---- saved settings ----
	_register(card, opts, el) {
		var name = opts.key || opts.label || opts.aria;
		if (name) this.fields[card.id + "/" + name] = el;
	}

	getState() {
		var self = this, fields = {}, collapsed = [];
		Object.keys(this.fields).forEach(function (k) { fields[k] = self.fields[k].value; });
		this.cardOrder.forEach(function (id) { if (self.cards[id].collapsed) collapsed.push(id); });
		var open = Object.keys(this.folds).filter(function (k) { return self.folds[k].open; });
		return { modules: Object.assign({}, this.on), fields: fields, collapsed: collapsed, open: open };
	}

	// Unknown keys are ignored and disabled fields keep their value, so state
	// saved by an older version of a calculator still loads.
	setState(state) {
		if (!state || typeof state !== "object") return;
		var self = this;
		var f = state.fields || {};
		Object.keys(f).forEach(function (k) {
			var el = self.fields[k];
			if (el && !el.disabled && typeof f[k] === "string") el.value = f[k];
		});
		if (state.modules && typeof state.modules === "object") {
			var on = {};
			this.moduleOrder.forEach(function (m) { on[m] = m in state.modules ? !!state.modules[m] : !!self.on[m]; });
			this.on = on;
			this._refresh();
			this.listeners.modules.forEach(function (fn) { fn(self.on); });
		}
		if (Array.isArray(state.collapsed)) {
			this.cardOrder.forEach(function (id) { self.setCollapsed(id, state.collapsed.indexOf(id) >= 0); });
		}
		if (Array.isArray(state.open)) {
			Object.keys(this.folds).forEach(function (k) { self.folds[k].setOpen(state.open.indexOf(k) >= 0); });
		}
		this.listeners.input.forEach(function (fn) { fn(null); });
	}

	// ---- events ----
	onInput(fn) { this.listeners.input.push(fn); }
	onFocus(fn) { this.listeners.focus.push(fn); }
	onModules(fn) { this.listeners.modules.push(fn); }
}
