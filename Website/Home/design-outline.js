// The design outline: the whole design as one Markdown document of lists and
// tables, for reading or handing on (Export → Outline). ES module:
//   import { designOutline } from "./design-outline.js";
//   var md = designOutline(design, outlines, { date: "2026-11-09 10:30",
//                                              only: [instId, …], placeholders: false });
//
// Pure (no DOM), so it imports directly in Node for testing.
//
// `outlines` maps installation id → that installation's calculator outline,
// as CalcShell.outline() returns it ({ warning, cards: [{ tab, side, title,
// tag, rows }] }), or null when its calculator didn't load. The document has
// a table of the bodies and their installations (the whole design, always),
// then each installation in design order — only those in `only`, when given —
// tab by tab, inputs then results, each card a table of its rows.
// `placeholders: false` leaves out the skeleton cards (isPlaceholder), and
// with them any tab they alone filled. A row inside a fold or under an optional item is led by "›" once per
// level; a fold's title is bold.

import { FAMILIES, FAMILY_ORDER, TABS, instLabel } from "./design-model.js";

// A skeleton card: a stand-in until a calculator covers that part
// (skeleton.js gives every one an id starting "sk-").
export function isPlaceholder(card) {
	return typeof card.id === "string" && card.id.indexOf("sk-") === 0;
}

// A table cell: one line, pipes escaped.
function cell(s) {
	return String(s == null ? "" : s).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
}

function rowLabel(r) {
	var t = cell(r.label);
	if (r.head && t) t = "**" + t + "**";
	return "› ".repeat(r.depth || 0) + t;
}

function cardTable(card) {
	var title = card.title + (card.tag ? " (" + card.tag + ")" : "");
	var out = ["##### " + cell(title), ""];
	var rows = card.rows || [];
	if (!rows.length) return out.concat(["_Nothing to show yet._", ""]);
	var notes = rows.some(function (r) { return r.note; });
	out.push(notes ? "| Item | Value | Note |" : "| Item | Value |");
	out.push(notes ? "|---|---|---|" : "|---|---|");
	rows.forEach(function (r) {
		out.push("| " + rowLabel(r) + " | " + cell(r.value) + (notes ? " | " + cell(r.note) : "") + " |");
	});
	out.push("");
	return out;
}

function installationSection(body, inst, outline, placeholders) {
	var out = ["## " + body + " · " + instLabel(inst), ""];
	if (!outline) return out.concat(["_The calculator for this installation didn't load, so its settings aren't listed._", ""]);
	if (outline.warning) out.push("> ⚠ " + cell(outline.warning), "");
	var all = outline.cards.filter(function (c) { return placeholders || !isPlaceholder(c); });
	if (!all.length) return out.concat(["_Only placeholder cards so far._", ""]);
	TABS.forEach(function (t) {
		var cards = all.filter(function (c) { return c.tab === t.id; });
		if (!cards.length) return;
		out.push("### " + t.label, "");
		[["in", "Inputs"], ["out", "Results"]].forEach(function (side) {
			var these = cards.filter(function (c) { return c.side === side[0]; });
			if (!these.length) return;
			out.push("#### " + side[1], "");
			these.forEach(function (c) { out = out.concat(cardTable(c)); });
		});
	});
	return out;
}

export function designOutline(design, outlines, opts) {
	var o = opts || {};
	var placeholders = o.placeholders !== false;
	var picked = function (i) { return !o.only || o.only.indexOf(i.id) >= 0; };
	var total = 0, shown = 0;
	design.bodies.forEach(function (b) { b.inst.forEach(function (i) { total++; if (picked(i)) shown++; }); });
	var out = ["# " + (design.name || "Design") + " — outline", ""];
	out.push("Exported from the Moonwards home workbench" + (o.date ? " on " + o.date : "") + ". " +
		"Each installation lists its calculator's cards tab by tab, inputs then results. " +
		"\"—\" is a figure with no model behind it yet; ☑ / ☐ is a part in use or not; [x] is the option chosen among buttons; " +
		"\"›\" marks a line inside a folded section or under an optional part.", "");
	var scope = [];
	if (shown < total) scope.push("Detailed below: " + shown + " of the design's " + total + " installations.");
	if (!placeholders) scope.push("Placeholder cards (parts no calculator covers yet) are left out.");
	if (scope.length) out.push(scope.join(" "), "");

	out.push("## Bodies and installations", "");
	if (!design.bodies.length) out.push("_No bodies in the design._", "");
	else {
		out.push("| Body | " + FAMILY_ORDER.map(function (f) { return FAMILIES[f].label; }).join(" | ") + " |");
		out.push("|---|" + FAMILY_ORDER.map(function () { return "---|"; }).join(""));
		design.bodies.forEach(function (b) {
			out.push("| " + b.body + " | " + FAMILY_ORDER.map(function (f) {
				return b.inst.filter(function (i) { return i.fam === f; })
					.map(function (i) { return cell(FAMILIES[f].vars[i.v].label); }).join(", ") || "—";
			}).join(" | ") + " |");
		});
		out.push("");
	}

	design.bodies.forEach(function (b) {
		b.inst.filter(picked).forEach(function (i) { out = out.concat(installationSection(b.body, i, outlines[i.id] || null, placeholders)); });
	});
	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
