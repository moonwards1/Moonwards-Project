// Calculator shell — builds the three-column calculator page. ES module:
//   import { CalcShell, ShellColors } from "../../Shared/calc-shell.js";
//
// Styling is Shared/calc-shell.css (class list in its header); the drawing
// panel in the middle column is Shared/zoom-view.js. Calculators/_template/
// shows the whole wiring.
//
//   var shell = new CalcShell(document.getElementById("app"), { title: "Circular Orbit" });
//
// Each column is headed by its name, the number of cards it shows, and buttons
// that fold and unfold them all. Cards appear in their column in the order
// added, and every card is always there: a viewer folds one away (or, where
// cards have ticks, unticks it to leave its marks out of the drawing), but
// never removes it. A part of a
// design that may or may not exist (a station on a tether) is a ticked line
// inside its card (optionalFields), not a card that comes and goes. `focus`
// names the drawing view the card's title asks for (see onFocus); `short` is
// the title shown when collapsed, beside the card's summary (card.setSummary).
//
// A fold is a block inside a card that opens and closes on its own arrow, for
// detail a viewer looks at only sometimes (a breakdown under a card's totals).
// Result lines and notes go in it the same way they go in a card:
//
//   var fold = shell.fold(card, { label: "By section" });
//   var l = shell.line(fold, { label: "Top → deck", unit: "MN" });
//
// A section groups result lines (and a fold) inside a card; a rule divides one
// section from the next, with none between the lines of a section:
//
//   var a = shell.section(card), b = shell.section(card);
//   var total = shell.line(a, { label: "Total", unit: "kt" });
//   var part = shell.line(a, { label: "Part", unit: "kt" });
//   var other = shell.line(b, { label: "Other", unit: "kN" });
//
//   var card = shell.addCard({ id: "orbit", side: "in", title: "Orbit", short: "Orbit",
//                              color: ShellColors.core, focus: "orbit" });
//   var alt = shell.numberField(card, { label: "Altitude", unit: "km", value: 100 });
//   var speed = shell.line(card, { label: "Circular speed", unit: "m/s" });  speed.set("1,633.2");
//
// An optional item is a ticked line (title and short description) with a row of
// compact fields under it, shown only while it is ticked:
//
//   var deck = shell.optionalFields(card, { key: "Deck", label: "Deck", hint: "where ships dock",
//                                           fields: [{ label: "altitude", unit: "km", value: 950, key: "Deck altitude" },
//                                                    { label: "peak mass", unit: "kt", value: 10, min: 0 }] });
//   deck.check.checked        is it in use?       deck.inputs[0].value   its first field
//
// Events: onInput(fn) after any field changes; onFocus(fn(target, cardId)) when a
// card title is clicked.
// Working in a field highlights its card without moving the drawing, so the
// view a viewer has set stays put while they edit. focusCard(id, false) does
// the same from code (use it while a marker is dragged).
//
// Tabs: a card may carry `tab` (e.g. "arch", "log", "eng", "eco").
// After setTab(tab), only that tab's cards show; a card without `tab`
// belongs to the first tab set (opts.firstTab, default "arch").
// Until setTab is called every card shows, as on a standalone page. Input
// and result cards stay wired across tabs: they are one calculator.
//
// Body-specific parts: a card may carry `where`, the name of a condition
// (Shared/body-profiles.js, e.g. "parentEntry"). After setConditions(fn), it
// shows only while fn(where) is true. card.setTitle(title, short) renames a
// card, for parts whose name depends on the body; card.setTag(text) puts a
// small tag beside the title ("" removes it).
//
// Wiring made visible: an input card's `feeds` lists result card ids; focusing
// the input card marks those (cs-fed), so a viewer sees where its numbers go.
//
// Card ticks: an embedded calculator gives each card a checkbox, in its accent
// colour, in place of the colour square; `cardToggles` overrides that either
// way. The tick says whether the card's marks are drawn. The calculator asks
// shell.isShown(cardId) (ticked, and it applies here) for each mark it draws and
// redraws on onShown(fn). Clicking the title still focuses the card. A card
// that is not ticked is listed in getState().hidden.
// Beside the tick, an eye button shows that card alone (setSolo): while a card
// is solo, isShown is false for every other card, so the drawing keeps only
// that card's marks. Marks the drawing always keeps as context (the structure
// itself) ask isShown(id, true), which ignores solo. Solo is not saved, and it
// lapses while the solo card does not apply.
//
// Embedding: `embedded: true` fills the root element instead of the window,
// for a calculator mounted inside another page (the home page's workbench).
// getState() returns the viewer's settings — field values, collapsed cards,
// unticked cards, open folds — as a plain object; setState(state) puts them back and
// fires onInput once. Fields are keyed "<card id>/<label or aria>", so a
// calculator keeps a field's label and card stable for saved settings to
// keep finding it (or passes an explicit `key`). A field given `save: false`
// is left out: its value is kept somewhere else (the design's ship classes).
// changed() runs the onInput listeners, for when something outside the
// calculator that it reads has changed.

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

// ---- DOM ------------------------------------------------------------------
var svgNS = "http://www.w3.org/2000/svg";

// Sets a number input's step, min and max. Firefox measures the spinner-arrow
// grid from `min`, so a minimum that is not a whole number of steps (min 0.001
// at the default step of 1) puts the grid off the field's values: the first
// click snaps onto it by a sliver, and later clicks step by the full amount. For
// such a field the minimum is held back from the attribute and enforced when the
// value is committed instead, which keeps the grid anchored at zero.
// A unit that is the multiplication sign gets the bold, slightly larger "×" of a multiple (cs-times).
function timesMark(el) {
	el.classList.toggle("cs-times", el.textContent === "×");
	return el;
}

function limitNumber(input, step, min, max) {
	var st = step ? parseFloat(step) : 1;
	var q = min != null ? min / st : 0;
	var aligned = Math.abs(q - Math.round(q)) < 1e-9;
	input.step = step || "any";
	if (min != null && aligned) input.min = min;
	if (max != null) input.max = max;
	if (min != null && !aligned) {
		input.addEventListener("change", function () {
			var v = parseFloat(input.value);
			if (v < min) input.value = min;
		});
	}
}
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
	x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
	chev: '<path d="M4 6l4 4 4-4"/>',
	tick: '<path d="M3 8.5l3.2 3L13 4.5"/>',
	solo: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2.2"/>',
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
		this.cards = {};        // id → card
		this.folds = {};        // "<card id>/<key or label>" → fold (getState / setState)
		this.cardOrder = [];
		this.focusId = null;
		this.soloId = null;     // the card shown alone in the drawing, or null
		this.conditions = null;   // fn(where) → bool, or null: everything applies
		this.tab = null;        // null: show every tab's cards (standalone page)
		this.firstTab = o.firstTab || "arch";
		this.listeners = { input: [], focus: [], shown: [] };
		this.toggles = o.cardToggles != null ? !!o.cardToggles : !!o.embedded;

		// A page gets a header (overline over the title). An embedded
		// calculator has none: the overline alone is a row of the column grid,
		// spanning the side columns so their heads line up beneath it.
		var brand = create("div", "cs-brand", false, o.embedded ? false : create("header", "cs-top", false, root));
		this.overEl = create("span", "cs-over", o.overline || "Moonwards · Calculators", brand);
		if (!o.embedded) create("h1", "cs-title", o.title || "", brand);

		var cols = create("div", "cs-cols", false, root);
		this.columns = {
			in: this._column(cols, "Inputs", "cs-col-in"),
			out: null
		};
		this.stage = create("section", "cs-stage", false, cols);
		this.stage.setAttribute("aria-label", o.stageLabel || "Drawing");
		this.columns.out = this._column(cols, "Results", "cs-col-out");
		if (o.embedded) cols.insertBefore(brand, cols.firstChild);
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
	// Tabs that hold at least one card that applies here.
	cardTabs() {
		var self = this, seen = {};
		this.cardOrder.forEach(function (id) { if (self._cardApplies(self.cards[id])) seen[self._tabOf(self.cards[id])] = true; });
		return Object.keys(seen);
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

	// ---- body-specific parts ----
	setConditions(fn) {
		this.conditions = fn || null;
		this._refresh();
	}
	_cardApplies(c) { return !c.where || !this.conditions || !!this.conditions(c.where); }

	// ---- cards ----
	addCard(def) {
		var self = this;
		var d = Object.assign({ side: "in" }, def);
		var color = d.color && d.color.card ? d.color.card : (d.color || "var(--cs-core)");
		var el = create("div", "cs-card", false, this.columns[d.side].list);
		el.style.setProperty("--mc", color);
		var h = create("div", "cs-card-h", false, el);
		var chk = null;
		if (this.toggles) {
			var lab = create("label", "cs-chk", false, h);
			lab.title = "Show in the drawing";
			chk = create("input", false, false, lab);
			chk.type = "checkbox";
			chk.checked = true;
			chk.setAttribute("aria-label", "Show " + d.title + " in the drawing");
			create("span", "cs-chk-box", false, lab).appendChild(icon(ICON.tick, 10, 2.4));
			chk.onchange = function () { self.setShown(d.id, chk.checked); };
		}
		var t = button("cs-card-t", false, h);
		if (!chk) create("span", "cs-dot", false, t);
		create("span", "cs-nm", d.title, t);
		create("span", "cs-nm-s", d.short || d.title, t);
		var tag = create("span", "cs-tag", false, t);
		var sum = create("span", "cs-sum", false, t);
		if (!chk) t.appendChild(icon(ICON.loc, 16, 1.5, "cs-loc"));
		t.onclick = function () { self.focusCard(d.id); };
		var solo = null;
		if (this.toggles) {
			solo = button(["cs-ib", "cs-solo"], "Show only this card in the drawing", h);
			solo.setAttribute("aria-pressed", "false");
			solo.appendChild(icon(ICON.solo, 16, 1.5));
			solo.onclick = function () { self.setSolo(self.soloId === d.id ? null : d.id); };
		}
		var chev = button("cs-ib", "Collapse card", h);
		chev.appendChild(icon(ICON.chev, 16, 1.6, "cs-chev"));
		chev.onclick = function () { self.setCollapsed(d.id, !card.collapsed); };
		var body = create("div", "cs-card-b", false, el);
		var nm = t.querySelector(".cs-nm"), nmS = t.querySelector(".cs-nm-s");
		var card = {
			id: d.id, side: d.side, focus: d.focus || null,
			tab: d.tab || null, feeds: d.feeds || [], where: d.where || null,
			el: el, body: body, collapsed: false, chev: chev, chk: chk, solo: solo, shown: true,
			setSummary: function (text) { sum.textContent = text; },
			setTitle: function (title, short) {
				nm.textContent = title; nmS.textContent = short || title;
				if (chk) chk.setAttribute("aria-label", "Show " + title + " in the drawing");
			},
			setTag: function (text) { tag.textContent = text || ""; }
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

	// Whether the card's marks are drawn: it is ticked and applies at this body.
	// A card with no tick is always ticked. While another card is solo, false,
	// unless `ignoreSolo` (marks kept as context).
	isShown(id, ignoreSolo) {
		var c = this.cards[id];
		if (!c || !c.shown || !this._cardApplies(c)) return false;
		return ignoreSolo || !this.soloId || this.soloId === id || !this.isShown(this.soloId, true);
	}

	// Show one card alone in the drawing (null: all ticked cards again). A solo
	// card is ticked if it was not.
	setSolo(id) {
		var self = this, next = id && this.cards[id] ? id : null;
		if (next === this.soloId) return;
		this.soloId = next;
		if (next && !this.cards[next].shown) { this.cards[next].shown = true; if (this.cards[next].chk) this.cards[next].chk.checked = true; }
		this.root.classList.toggle("cs-soloing", !!next);
		this.cardOrder.forEach(function (cid) {
			var c = self.cards[cid], on = cid === next;
			c.el.classList.toggle("cs-solo-on", on);
			if (c.solo) c.solo.setAttribute("aria-pressed", String(on));
		});
		this.listeners.shown.forEach(function (fn) { fn(next, true); });
	}

	setShown(id, value) {
		var c = this.cards[id];
		if (!c || c.shown === !!value) return;
		c.shown = !!value;
		if (c.chk) c.chk.checked = c.shown;
		this.listeners.shown.forEach(function (fn) { fn(id, c.shown); });
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
		var shown = { in: 0, out: 0 };
		this.cardOrder.forEach(function (id) {
			var c = self.cards[id];
			var vis = self._onTab(c) && self._cardApplies(c);
			c.el.hidden = !vis;
			if (vis) shown[c.side]++;
		});
		["in", "out"].forEach(function (side) {
			var col = self.columns[side];
			col.count.textContent = shown[side] === 1 ? "1 card" : shown[side] + " cards";
			col.empty.hidden = shown[side] > 0;
			col.empty.textContent = side === "in" ? "No inputs on this tab yet." : "No results on this tab yet.";
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
	_wire(card, el) {
		var self = this;
		el.addEventListener("input", function () { self.listeners.input.forEach(function (fn) { fn(el); }); });
		el.addEventListener("change", function () { self.listeners.input.forEach(function (fn) { fn(el); }); });
		el.addEventListener("focus", function () { if (self.focusId !== card.id) self.focusCard(card.id, false); });
	}

	// opts: { label, hint, tip, unit, value, step, min, max, parent, choice, choiceValue }.
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
		limitNumber(input, opts.step, opts.min, opts.max);
		input.value = opts.value;
		if (opts.unit) timesMark(create("span", "cs-u", opts.unit, fld));
		this._wire(card, input);
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

	// opts: { label, hint, tip, options: [{ value, label }], value }. Full width without a label.
	selectField(card, opts) {
		var fld = this._row(card, opts.label, opts.hint, !opts.label, opts.tip, opts.parent);
		var sel = create("select", false, false, fld);
		if (!opts.label && opts.aria) sel.setAttribute("aria-label", opts.aria);
		opts.options.forEach(function (o) { create("option", false, o.label, sel).value = o.value; });
		this._register(card, opts, sel);
		if (opts.value != null) sel.value = opts.value;
		this._wire(card, sel);
		return sel;
	}

	// opts: { label, hint, tip, value, placeholder, parent, key, save }. Returns the <input>.
	textField(card, opts) {
		var fld = this._row(card, opts.label, opts.hint, false, opts.tip, opts.parent);
		var input = create("input", "cs-text", false, fld);
		this._register(card, opts, input);
		input.type = "text";
		input.value = opts.value || "";
		if (opts.placeholder) input.placeholder = opts.placeholder;
		this._wire(card, input);
		return input;
	}

	note(card, text, parent) { return create("p", "cs-note", text, parent || card.body); }

	// An optional item: a tick, a title and a short description on the first line;
	// on the second, a row of compact number fields, hidden while it is unticked.
	// opts: { key, label, hint, tip, checked, parent, fields: [{ label, unit,
	// value, step, min, max, key, narrow }] }; `narrow` makes that field 10 px narrower. The tick is saved as "<card id>/<key>" ("1" or
	// "0"); a field is saved under its own `key`, or "<key> <field label>".
	// Returns { el, check, inputs }.
	optionalFields(card, opts) {
		var self = this, el = create("div", "cs-opt", false, opts.parent || card.body);
		var head = create("label", "cs-opt-h", false, el);
		var tick = create("span", "cs-chk", false, head);
		var chk = create("input", false, false, tick);
		chk.type = "checkbox";
		chk.checked = opts.checked !== false;
		chk.setAttribute("aria-label", "Use " + opts.label);
		create("span", "cs-chk-box", false, tick).appendChild(icon(ICON.tick, 10, 2.4));
		var ttl = create("span", "cs-opt-t", opts.label, head);
		if (opts.tip) { head.title = opts.tip; ttl.classList.add("cs-tipped"); }
		if (opts.hint) create("span", "cs-opt-d", opts.hint, head);
		var row = create("div", "cs-opt-f", false, el);
		var inputs = opts.fields.map(function (f) {
			var lab = create("label", "cs-opt-fl" + (f.narrow ? " cs-opt-narrow" : ""), false, row);
			create("span", "cs-opt-l", f.label, lab);
			var fld = create("span", "cs-fld", false, lab);
			var input = create("input", false, false, fld);
			self._register(card, { key: f.key || (opts.key + " " + f.label) }, input);
			input.type = "number";
			limitNumber(input, f.step, f.min, f.max);
			input.value = f.value;
			if (f.unit) timesMark(create("span", "cs-u", f.unit, fld));
			self._wire(card, input);
			return input;
		});
		function sync() { row.hidden = !chk.checked; el.classList.toggle("cs-opt-off", !chk.checked); }
		chk._sync = sync;
		this._register(card, { key: opts.key }, chk);
		chk.addEventListener("change", function () {
			sync();
			self.listeners.input.forEach(function (fn) { fn(chk); });
			if (self.focusId !== card.id) self.focusCard(card.id, false);
		});
		sync();
		return { el: el, check: chk, inputs: inputs };
	}

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

	// A row of buttons in a card, rebuilt whole by set(label, items): an
	// optional leading label, then one button per item { label, onClick,
	// pressed, onRemove, removeTip }. A pressed button is the current choice:
	// primary, not clickable. An item with onRemove carries an × beside it,
	// with removeTip as its hover tip. Returns { el, set }.
	buttonRow(card) {
		var row = create("div", "cs-btns", false, card.body);
		return {
			el: row,
			set: function (label, items) {
				row.textContent = "";
				if (label) create("span", "cs-btns-l", label, row);
				items.forEach(function (it) {
					var host = it.onRemove ? create("span", "cs-split", false, row) : row;
					var b = create("button", it.pressed ? ["cs-btn", "cs-btn-pri"] : "cs-btn", it.label, host);
					b.type = "button";
					if (it.pressed) b.setAttribute("aria-pressed", "true");
					else b.onclick = it.onClick;
					if (it.onRemove) {
						var x = button(["cs-btn", "cs-btn-x"], it.removeTip || "Remove", host);
						x.appendChild(icon(ICON.x, 12, 1.8));
						x.onclick = it.onRemove;
					}
				});
			}
		};
	}

	// ---- results ----
	// A section: a run of result lines that belong together inside a card (or fold). Add
	// lines and folds to it as to a card; consecutive sections are divided by a rule and
	// carry no rule between their own lines. Returns { id, body }.
	section(card) {
		return { id: card.id, body: create("div", "cs-sec", false, card.body) };
	}

	// A line: label, value + unit, optional sub-note. Returns { el, set(value, sub, unit), show(bool) }.
	line(card, opts) {
		var box = card._kvs || (card._kvs = create("div", "cs-kvs", false, card.body));
		var row = create("div", "cs-kv", false, box);
		create("span", "cs-k", opts.label, row);
		var v = create("span", "cs-v", false, row);
		var vn = create("span", "cs-vn", false, v);
		var vu = opts.unit ? timesMark(create("small", "cs-vu", opts.unit, v)) : null;
		var s = create("span", "cs-s", opts.sub || "", row);
		return {
			el: row,
			set: function (value, sub, unit) {
				vn.textContent = value;
				if (sub != null) s.textContent = sub;
				if (unit != null && vu) { vu.textContent = unit; timesMark(vu); }
			},
			show: function (on) { row.hidden = !on; }
		};
	}

	// The key-figure bar: items [{ label, unit }]. Returns one { set(value) } per item.
	// A bar of key figures: items [{ label, unit }]; opts { compact } makes smaller figures.
	// Returns the cells, each { el, set(value, label, unit), show(on) }, with the bar as `.bar`.
	// `card` may be anything with a `body`, such as a group inside a card.
	hero(card, items, opts) {
		var bar = create("div", (opts && opts.compact) ? ["cs-hero", "cs-hero-s"] : "cs-hero", false, card.body);
		var cells = items.map(function (it) {
			var cell = create("div", false, false, bar);
			var lab = create("span", "cs-hl", it.label, cell);
			var v = create("strong", "cs-hv", false, cell);
			var n = create("span", "cs-hn", false, v);
			var un = timesMark(create("small", "cs-hu", it.unit || "", v));
			return {
				el: cell,
				set: function (value, label, unit) {
					n.textContent = value;
					if (label != null) lab.textContent = label;
					if (unit != null) { un.textContent = unit; timesMark(un); }
				},
				show: function (on) { cell.hidden = !on; }
			};
		});
		cells.bar = bar;
		return cells;
	}

	// Warning text at the top of the results column; empty hides it.
	warn(text) {
		this.warning.textContent = text || "";
		this.warning.hidden = !text;
	}

	// ---- saved settings ----
	_register(card, opts, el) {
		var name = opts.key || opts.label || opts.aria;
		if (name && opts.save !== false) this.fields[card.id + "/" + name] = el;
	}

	getState() {
		var self = this, fields = {}, collapsed = [];
		Object.keys(this.fields).forEach(function (k) { var el = self.fields[k]; fields[k] = el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value; });
		this.cardOrder.forEach(function (id) { if (self.cards[id].collapsed) collapsed.push(id); });
		var open = Object.keys(this.folds).filter(function (k) { return self.folds[k].open; });
		var hidden = this.cardOrder.filter(function (id) { return !self.cards[id].shown; });
		return { fields: fields, collapsed: collapsed, open: open, hidden: hidden };
	}

	// Unknown keys are ignored and disabled fields keep their value, so state
	// saved by an older version of a calculator still loads.
	setState(state) {
		if (!state || typeof state !== "object") return;
		var self = this;
		var f = state.fields || {};
		Object.keys(f).forEach(function (k) {
			var el = self.fields[k];
			if (!el || el.disabled || typeof f[k] !== "string") return;
			if (el.type === "checkbox") { el.checked = f[k] === "1"; if (el._sync) el._sync(); }
			else el.value = f[k];
		});
		if (Array.isArray(state.collapsed)) {
			this.cardOrder.forEach(function (id) { self.setCollapsed(id, state.collapsed.indexOf(id) >= 0); });
		}
		if (Array.isArray(state.hidden)) {
			this.cardOrder.forEach(function (id) {
				var c = self.cards[id];
				c.shown = state.hidden.indexOf(id) < 0;
				if (c.chk) c.chk.checked = c.shown;
			});
		}
		if (Array.isArray(state.open)) {
			Object.keys(this.folds).forEach(function (k) { self.folds[k].setOpen(state.open.indexOf(k) >= 0); });
		}
		this.listeners.input.forEach(function (fn) { fn(null); });
	}

	// ---- events ----
	onInput(fn) { this.listeners.input.push(fn); }
	changed() { this.listeners.input.forEach(function (fn) { fn(null); }); }
	onFocus(fn) { this.listeners.focus.push(fn); }
	onShown(fn) { this.listeners.shown.push(fn); }
}
