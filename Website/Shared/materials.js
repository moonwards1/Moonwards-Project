// Tether materials, pure data (no DOM). ES module:
//   import { MATERIALS, breakingLength } from "../../Shared/materials.js";
//
// The presets every tether calculator on the calculator shell offers, through
// the shared Material card (material-card.js). strength in Pa, density in
// kg/m³. A calculator applies its own safety factor.

import { Const } from "./constants.js";

export const MATERIALS = {
	silica:          { name: "Lunar silica",           strength: 13e9,    density: 2300 },
	bestsilica:      { name: "Best lunar silica",      strength: 17e9,    density: 2300 },
	earlylunarglass: { name: "Early lunar glass",      strength: 3e9,     density: 2700 },
	ecnt:            { name: "Early carbon nanotube",  strength: 18e9,    density: 1450 },
	mwcnt:           { name: "Mature carbon nanotube", strength: 42e9,    density: 1400 },
	zylon:           { name: "Zylon",                  strength: 5.8e9,   density: 1540 },
	steel:           { name: "Steel",                  strength: 2.617e9, density: 8000 }
};

// Breaking length: the length of uniform cable that snaps under its own
// weight at standard gravity, L = σ / (ρ g₀). Metres, from Pa and kg/m³.
export function breakingLength(strength, density) {
	return strength > 0 && density > 0 ? strength / (density * Const.g0) : NaN;
}
