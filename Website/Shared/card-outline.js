// Reads a calculator-shell card as plain rows, for the home workbench's
// design outline (Home/design-outline.js). ES module:
//   import { readCard } from "./card-outline.js";
//   readCard(card.body)   // [{ label, value, note, depth, head }, …]
//
// It reads what the card shows, not what the calculator holds, so cards built
// from the shell's parts and cards a calculator builds by hand (the hanging
// skyhook's Traffic card) both come out.
//
// A row is
//   - a labelled line (PAIRS: a field row, a result line, an optional item and
//     its fields, a key figure, or a hand-built line marked data-ol with
//     data-ol-k and data-ol-v parts) → { label, value, note };
//   - a fold's title, or a note marked data-ol-head (a group's heading) →
//     { label, head: true };
//   - any other element with nothing block-level inside → its text as `label`.
// Text is what a viewer reads: a field gives its value, a select its chosen
// option, a tick ☑ or ☐, a radio button the label it sits in only while
// chosen (a field row whose own radio is off is noted "not chosen"), a
// <details> dropdown its summary, a pressed button its label in brackets.
// Other buttons, icons and notes (paragraphs) give nothing.
//
// Anything hidden is left out (a line that doesn't apply here), except fold
// bodies — the parts a viewer opens and closes: the card's body, a shell fold,
// or an element marked data-fold — which count whether open or not. Rows
// inside a fold, under an optional item, or in an element marked data-ol-nest
// carry one more `depth`; a data-ol-head heading inside such an element stays
// at the outer depth, so its lines sit under it.
//
// Hidden is read from each element's own computed display, which holds even
// while the whole calculator is hidden (the workbench keeps the installations
// not on screen in hidden boxes).

var PAIRS = [
	{ row: ".cs-row", k: ".cs-lbl", v: ".cs-fld", n: ".cs-hint" },
	{ row: ".cs-kv", k: ".cs-k", v: ".cs-v", n: ".cs-s" },
	{ row: ".cs-opt-h", k: ".cs-opt-t", v: ".cs-chk", n: ".cs-opt-d" },
	{ row: ".cs-opt-fl", k: ".cs-opt-l", v: ".cs-fld" },
	{ row: ".cs-hero > div", k: ".cs-hl", v: ".cs-hv" },
	{ row: "[data-ol]", k: "[data-ol-k]", v: "[data-ol-v]", n: "[data-ol-n]" }
];
var HEADS = ".cs-fold-t";
var OPEN = ".cs-card-b, .cs-fold-b, [data-fold]";
var NEST = ".cs-fold-b, [data-fold], .cs-opt-f, [data-ol-nest]";
var BLOCKS = "div, section, p, ul, ol, li, table, [data-ol-head], " + HEADS + ", " + PAIRS.map(function (p) { return p.row; }).join(", ");

function hidden(el) {
	if (el.matches(OPEN)) return false;
	if (el.hidden) return true;
	var view = el.ownerDocument.defaultView;
	return !!view && view.getComputedStyle(el).display === "none";
}

function tidy(s) {
	return s.replace(/\s+/g, " ").replace(/\s+([.,:;)%])/g, "$1").replace(/\(\s+/g, "(").trim();
}

// What a viewer reads in `node`, leaving out the elements in `skip`.
function text(node, skip, row) {
	if (node.nodeType === 3) return node.nodeValue;
	if (node.nodeType !== 1 || (skip && skip.indexOf(node) >= 0)) return "";
	var tag = node.tagName.toUpperCase();
	if (tag === "SCRIPT" || tag === "STYLE" || tag === "SVG" || tag === "P" || tag === "OPTION") return "";
	if (node !== row && hidden(node)) return "";
	if (tag === "INPUT") {
		if (node.type === "checkbox") return node.checked ? "☑" : "☐";
		if (node.type === "radio") return "";
		return node.value;
	}
	if (tag === "SELECT") {
		var op = node.options[node.selectedIndex];
		return op ? op.textContent : "";
	}
	if (tag === "TEXTAREA") return node.value;
	if (tag === "DETAILS") {
		var sum = node.querySelector("summary");
		return sum ? text(sum, skip) : "";
	}
	if (tag === "BUTTON") return node.getAttribute("aria-pressed") === "true" ? "[" + tidy(node.textContent) + "]" : "";
	if (tag === "LABEL" && node !== row) {
		var radio = node.querySelector("input[type=radio]");
		if (radio && !radio.checked) return "";
	}
	var parts = [];
	node.childNodes.forEach(function (c) { parts.push(text(c, skip, row)); });
	return parts.join(" ");
}

function pairOf(el) {
	for (var i = 0; i < PAIRS.length; i++) if (el.matches(PAIRS[i].row)) return PAIRS[i];
	return null;
}

function readPair(el, p, depth) {
	var k = el.querySelector(p.k), v = el.querySelector(p.v), n = p.n ? el.querySelector(p.n) : null;
	var skip = n ? [n] : [];
	var note = n && !hidden(n) ? tidy(text(n)) : "";
	// A field row with its own radio button (one of a choice of rows).
	var own = el.querySelector("input[type=radio]");
	if (own && own.closest("label") === el && !own.checked) note = note ? note + "; not chosen" : "not chosen";
	return {
		label: k ? tidy(text(k, skip)) : "",
		value: v ? tidy(text(v, skip)) : tidy(text(el, (k ? [k] : []).concat(skip), el)),
		note: note, depth: depth, head: false
	};
}

function walk(el, depth, out) {
	Array.prototype.forEach.call(el.children, function (c) {
		if (hidden(c)) return;
		if (c.matches("[data-ol-head]")) {
			var g = tidy(c.textContent);
			if (g) out.push({ label: g, value: "", note: "", depth: Math.max(0, depth - (el.matches(NEST) ? 1 : 0)), head: true });
			return;
		}
		if (c.tagName.toUpperCase() === "P") return;
		if (c.matches(HEADS)) {
			var h = tidy(text(c, null, c));
			if (h) out.push({ label: h, value: "", note: "", depth: depth, head: true });
			return;
		}
		var p = pairOf(c);
		if (p) {
			var r = readPair(c, p, depth);
			if (r.label || r.value) out.push(r);
			return;
		}
		if (c.querySelector(BLOCKS)) { walk(c, depth + (c.matches(NEST) ? 1 : 0), out); return; }
		var t = tidy(text(c, null, c));
		if (t) out.push({ label: t, value: "", note: "", depth: depth, head: false });
	});
	return out;
}

// The rows of a card's body (or any element holding card content).
export function readCard(body) {
	return walk(body, 0, []);
}
