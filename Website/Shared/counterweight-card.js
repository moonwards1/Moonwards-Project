// The Counterweight & stations card of the space elevator calculators on the
// calculator shell. ES module:
//   import { addCounterweightCard } from "../../Shared/counterweight-card.js";
//
// One card, top to bottom: the counterweight's position (the calculator's own
// field and note), its mass, the multiple, and up to three optional stations
// on the tether. The physics is Shared/radial-tether.js.
//
//   var cw = addCounterweightCard(shell, {
//       id: "cw", tab: "arch", feeds: ["prop"],
//       position: { label: "Counterweight distance", hint: "from the Moon's centre", unit: "km", value: 222100, min: 1 },
//       balance: "L1",                                         // the balance point's name
//       names: { in: "Moon side", out: "Earth side" },         // the two sides of it
//       pull: { in: "toward the Moon", out: "toward Earth" }   // which way a station there is pulled
//   });
//   cw.posIn, cw.posNote                    the position field and its note, for the calculator
//   var st = cw.resolve({ field, rCW });    the stations as [{ r, m }] (m), ranges and rows brought up to date
//   var ctx = tetherContext(field, { ..., stations: st });
//   var s = cw.settle(ctx);                 { M, mult, req, raised }: the counterweight used
//   cw.settle(ctx, { M, why })              the same, with a further least mass the calculator sets
//                                           ("Raised to 2.1 Mt " + why)
//   cw.blank();                             when the geometry can't hold a tether
//
// The multiple is everything holding the structure up ÷ everything hanging on
// it, each as its pull at the surface anchor (radial-tether.js pullBalance).
// Below MULT_FLOOR the counterweight is raised to reach it, and the card says
// so; below MULT_ADVISED a small warning stays. An empty mass field takes
// MULT_ADVISED's counterweight.
//
// Stations: one on the inward side of the balance point, up to two on the
// outward side, one at the balance point itself; three at most. "Create
// station" opens a small form: a side, then an altitude or a felt force (the
// net acceleration there, in the direction that side is pulled), each with its
// range. Once created, a station takes a mass. A station at the balance point
// feels no force and changes nothing on this card. The stations are saved
// together as one JSON string under "<id>/Stations".

import { ShellColors } from "./calc-shell.js";
import { radiusAtForce, counterweightFor, pullBalance, MULT_FLOOR, MULT_ADVISED } from "./radial-tether.js";

export { MULT_FLOOR, MULT_ADVISED };
var LIMIT = { in: 1, bal: 1, out: 2 };
var MAX_STATIONS = 3;
var SIDES = ["in", "bal", "out"];

function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }
function acc(a) { return !isFinite(a) ? "—" : a >= 0.1 ? num(a, 3) : Number(a.toPrecision(3)).toString(); }
function mass(kg) {
	if (!isFinite(kg)) return "—";
	var u = kg >= 1e9 ? [1e9, "Mt"] : kg >= 1e6 ? [1e6, "kt"] : kg >= 1e3 ? [1e3, "t"] : [1, "kg"];
	return num(kg / u[0], 1) + " " + u[1];
}
// Up to three significant figures, rounded up.
function roundUp3(x) {
	if (!(x > 0)) return 0;
	var p = Math.pow(10, Math.floor(Math.log10(x)) - 2);
	return Number((Math.ceil(x / p - 1e-9) * p).toPrecision(3));
}
function el(tag, cls, text, parent) {
	var e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text) e.textContent = text;
	if (parent) parent.appendChild(e);
	return e;
}

export function addCounterweightCard(shell, opts) {
	var o = opts || {};
	var names = o.names || { in: "Inward", out: "Outward" };
	var pull = o.pull || { in: "inward", out: "outward" };
	var sideName = { in: names.in, bal: "At " + o.balance, out: names.out };
	var card = shell.addCard({ id: o.id || "cw", tab: o.tab, side: "in", title: "Counterweight & stations", short: "Counterweight",
		color: o.color || ShellColors.ochre, feeds: o.feeds || [], focus: o.focus });

	var posIn = shell.numberField(card, Object.assign({ min: 0 }, o.position));
	var posNote = shell.note(card, "");
	var massIn = shell.numberField(card, { label: "Counterweight mass", unit: "kt", value: "", min: 0, step: "any" });
	var raisedNote = shell.note(card, "");
	var lMult = shell.line(card, { label: "Multiple", unit: "×", sub: "Outward ÷ inward pull at the anchor; " + MULT_FLOOR + "× at least." });
	var advNote = shell.note(card, "");
	raisedNote.style.color = advNote.style.color = ShellColors.rust.card;
	raisedNote.hidden = advNote.hidden = true;

	// ---------- stations ----------
	// "Inward" → "inward side"; "Moon side" stays; "Far side" → "far side".
	function sideOf(n) { var t = n.replace(/^(Inward|Outward|Far)\b/, function (w) { return w.toLowerCase(); }); return /side$/.test(t) ? t : t + " side"; }
	shell.note(card, "Stations, optional: one on the " + sideOf(names.in) + ", two on the " + sideOf(names.out) + ", one at " + o.balance + ".");
	var list = el("div", false, false, card.body);
	var addBtn = shell.button(card, { label: "Create station" });
	var form = el("div", false, false, card.body);
	form.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 0 2px;";
	form.hidden = true;
	var host = { id: card.id, body: form };
	var sideRow = shell.buttonRow(host);
	var byRow = shell.buttonRow(host);
	var altIn = shell.numberField(card, { label: "Altitude", hint: " ", unit: "km", value: "", min: 0, step: "any", parent: form, save: false });
	var accIn = shell.numberField(card, { label: "Felt force", hint: " ", unit: "m/s²", value: "", min: 0, step: "any", parent: form, save: false });
	var altRow = altIn.closest(".cs-row"), accRow = accIn.closest(".cs-row");
	var altHint = altRow.querySelector(".cs-hint"), accHint = accRow.querySelector(".cs-hint");
	var formNote = shell.note(card, "", form);
	formNote.style.color = ShellColors.rust.card;
	var formBtns = shell.buttonRow(host);

	var store = { value: "[]" };            // the saved stations (JSON)
	shell.control(card, store, { key: "Stations" });
	var stations = [], built = null, rows = [];
	var draft = { side: "out", by: "alt" };
	var geo = null;                          // { field, rCW, ranges } from the last resolve()

	function count(side) { return stations.filter(function (s) { return s.side === side; }).length; }
	function open(side) { return stations.length < MAX_STATIONS && count(side) < LIMIT[side]; }
	function save() { built = store.value = JSON.stringify(stations); }
	function parseNum(v) { var x = parseFloat(v); return isFinite(x) ? x : null; }

	function load() {
		var raw;
		try { raw = JSON.parse(store.value); } catch (e) { raw = []; }
		stations = [];
		(Array.isArray(raw) ? raw : []).forEach(function (s) {
			if (!s || SIDES.indexOf(s.side) < 0 || !open(s.side)) return;
			stations.push({ side: s.side, by: s.by === "acc" ? "acc" : "alt", v: parseNum(s.v), m: parseNum(s.m) });
		});
		save();
		build();
	}

	function build() {
		list.textContent = "";
		rows = stations.map(function (s, i) {
			var box = el("div", "cs-opt", false, list);
			var head = el("div", "cs-opt-h", false, box);
			head.style.cursor = "default";
			el("span", "cs-opt-t", sideName[s.side] + " station", head);
			var desc = el("span", "cs-opt-d", "", head);
			var rm = el("button", "cs-btn", "Remove", head);
			rm.type = "button";
			rm.style.cssText = "height:22px;padding:0 7px;margin-left:auto;font-size:11.5px;font-weight:500;";
			rm.onclick = function () { stations.splice(i, 1); save(); build(); shell.changed(); };
			var f = el("div", "cs-opt-f", false, box);
			function field(label, unit, value, set) {
				var lab = el("label", "cs-opt-fl", false, f);
				el("span", "cs-opt-l", label, lab);
				var fld = el("span", "cs-fld", false, lab);
				var input = el("input", false, false, fld);
				input.type = "number"; input.step = "any"; input.min = 0;
				input.value = value == null ? "" : value;
				el("span", "cs-u", unit, fld);
				input.addEventListener("input", function () { set(parseNum(input.value)); save(); shell.changed(); });
				return input;
			}
			if (s.side !== "bal") {
				field(s.by === "acc" ? "Felt force" : "Altitude", s.by === "acc" ? "m/s²" : "km", s.v, function (v) { s.v = v; });
			}
			var mIn = field("Mass", "kt", s.m, function (v) { s.m = v; });
			if (s.m == null) mIn.placeholder = "enter";
			box.addEventListener("focusin", function () { if (shell.focusId !== card.id) shell.focusCard(card.id, false); });
			return { desc: desc };
		});
		addBtn.disabled = !SIDES.some(open);
		if (form.hidden === false && !open(draft.side)) closeForm();
	}

	// ---------- the creation form ----------
	function rangeText(side, by) {
		var rg = geo && geo.ranges[side];
		if (!rg) return "";
		return by === "acc" ? "up to " + acc(rg.a[1]) + ", " + pull[side] : num(rg.h[0], 0) + " – " + num(rg.h[1], 0) + " km";
	}
	function renderForm() {
		sideRow.set("Side", SIDES.filter(open).map(function (sd) {
			return { label: sideName[sd], pressed: sd === draft.side, onClick: function () { draft.side = sd; formNote.textContent = ""; renderForm(); } };
		}));
		var bal = draft.side === "bal";
		byRow.el.hidden = bal;
		byRow.set("By", [["alt", "Altitude"], ["acc", "Felt force"]].map(function (b) {
			return { label: b[1], pressed: draft.by === b[0], onClick: function () { draft.by = b[0]; formNote.textContent = ""; renderForm(); } };
		}));
		altRow.hidden = bal || draft.by !== "alt";
		accRow.hidden = bal || draft.by !== "acc";
		altHint.textContent = rangeText(draft.side, "alt");
		accHint.textContent = rangeText(draft.side, "acc");
		formBtns.set("", [{ label: "Create", onClick: create }, { label: "Cancel", onClick: closeForm }]);
	}
	function openForm() {
		draft.side = SIDES.filter(open).indexOf(draft.side) >= 0 ? draft.side : SIDES.filter(open)[0];
		if (!draft.side) return;
		formNote.textContent = "";
		form.hidden = false; addBtn.hidden = true;
		renderForm();
	}
	function closeForm() { form.hidden = true; addBtn.hidden = false; altIn.value = accIn.value = ""; formNote.textContent = ""; }
	function create() {
		var s = { side: draft.side, by: draft.by, v: null, m: null };
		if (s.side !== "bal") {
			var rg = geo && geo.ranges[s.side];
			var v = parseNum((s.by === "acc" ? accIn : altIn).value);
			var lim = rg ? (s.by === "acc" ? rg.a : rg.h) : null;
			if (v == null || !lim || !(v > lim[0] && v < lim[1])) {
				formNote.textContent = "Enter " + (s.by === "acc" ? "a felt force " : "an altitude ") + rangeText(s.side, s.by) + ", not at either end.";
				return;
			}
			s.v = v;
		} else s.by = "alt";
		stations.push(s);
		stations.sort(function (a, b) { return SIDES.indexOf(a.side) - SIDES.indexOf(b.side); });
		save(); closeForm(); build(); shell.changed();
	}
	addBtn.onclick = openForm;

	// ---------- each recalculation ----------
	// g: { field, rCW }. Returns the stations that count, as [{ r, m }] in m and kg.
	function resolve(g) {
		if (store.value !== built) load();
		var f = g.field, R = f.R, rB = f.rBalance;
		var hB = (rB - R) / 1e3, hCW = (g.rCW - R) / 1e3;
		geo = { field: f, rCW: g.rCW, ranges: {
			in: { h: [0, hB], a: [0, Math.abs(f.g(R))] },
			out: { h: [hB, hCW], a: [0, f.g(g.rCW)] }
		} };
		if (!form.hidden) renderForm();
		var out = [];
		stations.forEach(function (s, i) {
			var d = rows[i].desc, r = NaN;
			if (s.side === "bal") r = rB;
			else if (s.v != null) {
				var rg = geo.ranges[s.side], lim = s.by === "acc" ? rg.a : rg.h;
				if (s.v > lim[0] && s.v < lim[1]) {
					r = s.by === "acc"
						? radiusAtForce(f, s.side === "in" ? -s.v : s.v, s.side === "in" ? R : rB, s.side === "in" ? rB : g.rCW)
						: R + s.v * 1e3;
				}
			}
			if (!isFinite(r)) {
				d.textContent = s.v == null ? "enter " + (s.by === "acc" ? "a felt force" : "an altitude")
					: "outside " + rangeText(s.side, s.by) + ": left out";
				return;
			}
			d.textContent = s.side === "bal" ? num((r - R) / 1e3, 0) + " km, no pull"
				: s.by === "acc" ? num((r - R) / 1e3, 0) + " km"
				: acc(Math.abs(f.g(r))) + " m/s², " + pull[s.side];
			if (s.m > 0) out.push({ r: r, m: s.m * 1e6 });
		});
		return out;
	}

	// floor (optional): { M (kg), why } — a further least counterweight the
	// calculator's own geometry sets; the card raises to it as to the multiple.
	function settle(ctx, floor) {
		var req = counterweightFor(ctx, MULT_FLOOR), byFloor = !!(floor && floor.M > req);
		if (byFloor) req = floor.M;
		var typed = parseNum(massIn.value);
		if (typed == null) {
			typed = roundUp3(counterweightFor(ctx, MULT_ADVISED) / 1e6);
			massIn.value = typed;
		}
		typed *= 1e6;
		var raised = typed < req * (1 - 1e-9);
		var M = raised ? req : typed;
		raisedNote.hidden = !raised;
		raisedNote.textContent = raised ? "Raised to " + mass(M) + (byFloor ? " " + floor.why : " to reach " + MULT_FLOOR + "×.") : "";
		var b = pullBalance(ctx, M);
		lMult.set(isFinite(b.mult) ? num(b.mult, 2) : "—");
		advNote.hidden = !(b.mult < MULT_ADVISED - 0.005);   // as shown to two decimals
		advNote.textContent = advNote.hidden ? "" : "Under " + MULT_ADVISED + "×: little margin for cargo.";
		var n = ctx.stations.length;
		card.setSummary(mass(M) + " · " + (isFinite(b.mult) ? num(b.mult, 2) + "×" : "—") + (n ? " · " + n + " station" + (n > 1 ? "s" : "") : ""));
		return { M: M, mult: b.mult, req: req, raised: raised };
	}

	function blank() {
		if (store.value !== built) load();
		lMult.set("—");
		raisedNote.hidden = advNote.hidden = true;
		rows.forEach(function (r) { r.desc.textContent = "—"; });
		card.setSummary("—");
	}

	load();
	return { card: card, posIn: posIn, posNote: posNote, massIn: massIn, resolve: resolve, settle: settle, blank: blank };
}
