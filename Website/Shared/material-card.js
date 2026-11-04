// The Tether materials card of the tether calculators on the calculator shell. ES module:
//   import { addMaterialCard } from "../../Shared/material-card.js";
//
// One card, top to bottom: a preset menu (Shared/materials.js) with a "Custom
// material…" entry that opens strength and density fields; the material's
// breaking length at 1 g₀ and at the local gravity of the body the tether
// hangs on; a safety factor; and the calculator's taper-ratio lines. Field keys
// are stable ("<id>/Tether material", "<id>/Tensile strength", "<id>/Density",
// "<id>/Safety factor"), so saved settings keep loading.
//
//   var mat = addMaterialCard(shell, { id: "mat", tab: "arch", feeds: ["prop"],
//                                      focus: "tether", value: "silica", safety: 3 });
//   var taper = mat.addTaperLine("Taper ratio (foot → centre)");   // set(...) it in the recalculation
//   var ratio = mat.addRatioLine("Lower tether ratio");   // set({ taper, mass, massNote })
//   var m = mat.read(gLocal);   // gLocal: the body's surface gravity, m/s²
//
// read() returns { key, name, strength (Pa), density (kg/m³), safety,
// sigmaEff (strength ÷ safety, Pa), specific (sigmaEff ÷ density, J/kg) }, and
// brings the card up to date: custom fields shown or hidden, both breaking
// lengths, summary. Without gLocal the local-gravity line shows "—".

import { ShellColors } from "./calc-shell.js";
import { MATERIALS, breakingLength } from "./materials.js";

export function addMaterialCard(shell, opts) {
	var o = opts || {};
	var card = shell.addCard({ id: o.id || "mat", tab: o.tab, feeds: o.feeds || [], side: "in",
		title: "Tether materials", short: "Material", color: o.color || ShellColors.core, focus: o.focus });
	var sel = shell.selectField(card, { aria: "Tether material", value: o.value || "silica",
		options: Object.keys(MATERIALS).map(function (k) {
			var m = MATERIALS[k];
			return { value: k, label: m.name + " · " + (m.strength / 1e9) + " GPa, " + (m.density / 1000) + " g/cm³" };
		}).concat([{ value: "custom", label: "Custom material…" }]) });
	var customBox = document.createElement("div");
	card.body.appendChild(customBox);
	var sigmaIn = shell.numberField(card, { label: "Tensile strength", unit: "GPa", value: 13, min: 0.01, parent: customBox });
	var rhoIn = shell.numberField(card, { label: "Density", unit: "kg/m³", value: 2300, min: 1, parent: customBox });
	var blLine = shell.line(card, { label: "Breaking length at 1 g₀", unit: "km" });
	var blLocal = shell.line(card, { label: "Breaking length at local g", unit: "km" });
	var blLocalLabel = blLocal.el.querySelector(".cs-k");
	var safetyIn = shell.numberField(card, { label: "Safety factor", unit: "×", value: o.safety || 3, step: "0.1", min: 1 });

	function field(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }

	function km(L) { return isFinite(L) ? Math.round(L / 1e3).toLocaleString("en-US") : "—"; }

	// The taper and ratio lines form their own block under the safety factor.
	var taperStarted = false;
	function ratioBlockLine(label) {
		if (!taperStarted) { card._kvs = null; taperStarted = true; }
		return shell.line(card, { label: label });
	}
	function addTaperLine(label) { return ratioBlockLine(label); }

	// A line of three divs: the label on the left, then two figures, the second with a note
	// directly under it. set({ taper, mass, massNote }); a missing taper leaves its place empty.
	function addRatioLine(label) {
		var line = ratioBlockLine(label), row = line.el;
		row.querySelector(".cs-v").remove();
		row.querySelector(".cs-s").remove();
		row.classList.add("cs-ratio");
		function cell() {
			var c = document.createElement("div"); c.className = "cs-rc";
			var v = document.createElement("span"); v.className = "cs-rv";
			var n = document.createElement("small"); n.className = "cs-rcap";
			c.appendChild(v); c.appendChild(n); row.appendChild(c);
			return { v: v, n: n };
		}
		var t = cell(), m = cell();
		return {
			el: row,
			set: function (o) {
				t.v.textContent = o.taper || ""; m.v.textContent = o.mass || ""; m.n.textContent = o.massNote || "";
			},
			show: function (on) { row.hidden = !on; }
		};
	}

	function read(gLocal) {
		var custom = sel.value === "custom";
		customBox.hidden = !custom;
		var preset = MATERIALS[sel.value] || MATERIALS.silica;
		var m = custom
			? { name: "Custom", strength: field(sigmaIn, 13) * 1e9, density: field(rhoIn, 2300) }
			: preset;
		var safety = Math.max(1, field(safetyIn, o.safety || 3));
		blLine.set(km(breakingLength(m.strength, m.density)));
		var hasG = gLocal > 0;
		blLocalLabel.textContent = "Breaking length at local g of " + (hasG ? Number(gLocal.toPrecision(2)) : "—") + " m/s²";
		blLocal.set(hasG ? km(breakingLength(m.strength, m.density, gLocal)) : "—");
		card.setSummary(m.name + " · ×" + safety);
		var sigmaEff = m.strength / safety;
		return { key: custom ? "custom" : sel.value, name: m.name, strength: m.strength, density: m.density,
			safety: safety, sigmaEff: sigmaEff, specific: sigmaEff / m.density };
	}

	return { card: card, read: read, addTaperLine: addTaperLine, addRatioLine: addRatioLine };
}
