// The Material card of the tether calculators on the calculator shell. ES module:
//   import { addMaterialCard } from "../../Shared/material-card.js";
//
// One card: a preset menu (Shared/materials.js) with a "Custom material…"
// entry that opens strength and density fields, the material's breaking
// length, and a safety factor. Field keys are stable ("<id>/Tether material",
// "<id>/Tensile strength", "<id>/Density", "<id>/Safety factor"), so saved
// settings keep loading.
//
//   var mat = addMaterialCard(shell, { id: "mat", tab: "arch", feeds: ["prop"],
//                                      focus: "tether", value: "silica", safety: 3 });
//   var m = mat.read();   // in the calculator's recalculation
//
// read() returns { key, name, strength (Pa), density (kg/m³), safety,
// sigmaEff (strength ÷ safety, Pa), specific (sigmaEff ÷ density, J/kg) }, and
// brings the card up to date: custom fields shown or hidden, breaking length,
// summary.

import { ShellColors } from "./calc-shell.js";
import { MATERIALS, breakingLength } from "./materials.js";

export function addMaterialCard(shell, opts) {
	var o = opts || {};
	var card = shell.addCard({ id: o.id || "mat", tab: o.tab, feeds: o.feeds || [], side: "in",
		title: "Material", short: "Material", color: o.color || ShellColors.core, focus: o.focus });
	var sel = shell.selectField(card, { aria: "Tether material", value: o.value || "silica",
		options: Object.keys(MATERIALS).map(function (k) {
			var m = MATERIALS[k];
			return { value: k, label: m.name + " · " + (m.strength / 1e9) + " GPa, " + (m.density / 1000) + " g/cm³" };
		}).concat([{ value: "custom", label: "Custom material…" }]) });
	var customBox = document.createElement("div");
	card.body.appendChild(customBox);
	var sigmaIn = shell.numberField(card, { label: "Tensile strength", unit: "GPa", value: 13, min: 0.01, parent: customBox });
	var rhoIn = shell.numberField(card, { label: "Density", unit: "kg/m³", value: 2300, min: 1, parent: customBox });
	var safetyIn = shell.numberField(card, { label: "Safety factor", unit: "×", value: o.safety || 3, step: "0.1", min: 1 });
	var blLine = shell.line(card, { label: "Breaking length at 1 g₀", unit: "km" });

	function field(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }

	function read() {
		var custom = sel.value === "custom";
		customBox.hidden = !custom;
		var preset = MATERIALS[sel.value] || MATERIALS.silica;
		var m = custom
			? { name: "Custom", strength: field(sigmaIn, 13) * 1e9, density: field(rhoIn, 2300) }
			: preset;
		var safety = Math.max(1, field(safetyIn, o.safety || 3));
		var bl = breakingLength(m.strength, m.density);
		blLine.set(isFinite(bl) ? Math.round(bl / 1e3).toLocaleString("en-US") : "—");
		card.setSummary(m.name + " · ×" + safety);
		var sigmaEff = m.strength / safety;
		return { key: custom ? "custom" : sel.value, name: m.name, strength: m.strength, density: m.density,
			safety: safety, sigmaEff: sigmaEff, specific: sigmaEff / m.density };
	}

	return { card: card, read: read };
}
