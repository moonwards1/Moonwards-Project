// Display facts for the bodies panel on the home page. ES module:
//   import { BODY_FACTS } from "./body-facts.js";
//
// Strings ready to show, rounded for reading rather than calculation; the
// calculators take their physics from Shared/orbit.js. `note` is the line
// beside the body's name: its primary when it is a moon, otherwise one
// identifying fact. `rotationNote` is shown in small type after `rotation`.
//
// Numbers for the workbench's skeleton arithmetic: `rotH` sidereal rotation
// period in hours (negative = retrograde), `aAU` the heliocentric orbit's
// semi-major axis (a moon takes its planet's), `periodD` the heliocentric
// orbital period in days, `system` the planet a moon belongs to.

export const BODY_FACTS = {
	Mercury: { rotH: 1407.6, aAU: 0.387, periodD: 87.969, note: "1st planet from the Sun", dist: "0.387 AU", speed: "47.4 km/s", diam: "4,879 km", mass: "3.30 × 10²³ kg", dens: "5,427 kg/m³", g: "3.70 m/s²", esc: "4.25 km/s", rotation: "58.6 d", temp: "≈ 440 K", atm: "None", color: "#8A8178" },
	Venus: { rotH: -5832.5, aAU: 0.723, periodD: 224.701, note: "2nd planet from the Sun", dist: "0.723 AU", speed: "35.0 km/s", diam: "12,104 km", mass: "4.87 × 10²⁴ kg", dens: "5,243 kg/m³", g: "8.87 m/s²", esc: "10.36 km/s", rotation: "243 d", rotationNote: "retrograde", temp: "≈ 737 K", atm: "9.2 MPa, CO₂", color: "#D9C27A" },
	Earth: { rotH: 23.9345, aAU: 1.0, periodD: 365.256, note: "3rd planet from the Sun", dist: "1.000 AU", speed: "29.8 km/s", diam: "12,742 km", mass: "5.97 × 10²⁴ kg", dens: "5,514 kg/m³", g: "9.81 m/s²", esc: "11.19 km/s", rotation: "23.9 h", temp: "≈ 288 K", atm: "101 kPa, N₂ / O₂", color: "#3F9C8A" },
	Moon: { rotH: 655.72, aAU: 1.0, periodD: 365.256, system: "Earth", note: "moon of Earth", dist: "384,400 km", speed: "1.02 km/s", diam: "3,474 km", mass: "7.34 × 10²² kg", dens: "3,344 kg/m³", g: "1.62 m/s²", esc: "2.38 km/s", rotation: "27.3 d", rotationNote: "tidally locked", temp: "≈ 250 K", atm: "None", color: "#A39A90" },
	Mars: { rotH: 24.6229, aAU: 1.524, periodD: 686.98, note: "4th planet from the Sun", dist: "1.524 AU", speed: "24.1 km/s", diam: "6,779 km", mass: "6.42 × 10²³ kg", dens: "3,934 kg/m³", g: "3.72 m/s²", esc: "5.03 km/s", rotation: "24.6 h", temp: "≈ 210 K", atm: "0.6 kPa, CO₂", color: "#D4623A" },
	Vesta: { rotH: 5.342, aAU: 2.362, periodD: 1325.6, note: "main-belt asteroid", dist: "2.362 AU", speed: "19.3 km/s", diam: "525 km", mass: "2.59 × 10²⁰ kg", dens: "3,456 kg/m³", g: "0.25 m/s²", esc: "0.36 km/s", rotation: "5.34 h", temp: "≈ 180 K", atm: "None", color: "#C48AA4" },
	Ceres: { rotH: 9.074, aAU: 2.767, periodD: 1681.6, note: "dwarf planet", dist: "2.767 AU", speed: "17.9 km/s", diam: "939 km", mass: "9.38 × 10²⁰ kg", dens: "2,162 kg/m³", g: "0.28 m/s²", esc: "0.51 km/s", rotation: "9.07 h", temp: "≈ 165 K", atm: "None", color: "#9B78C9" },
	Psyche: { rotH: 4.196, aAU: 2.923, periodD: 1825.0, note: "metal-rich asteroid", dist: "2.923 AU", speed: "17.3 km/s", diam: "≈ 222 km", mass: "2.29 × 10¹⁹ kg", dens: "≈ 3,900 kg/m³", g: "≈ 0.06 m/s²", esc: "≈ 0.17 km/s", rotation: "4.20 h", temp: "≈ 160 K", atm: "None", color: "#9AA36A" }
};

// Rows of the panel, in display order: [label, key].
export const FACT_ROWS = [
	["Orbital distance", "dist"], ["Orbital speed", "speed"], ["Diameter", "diam"],
	["Mass", "mass"], ["Density", "dens"], ["Surface gravity", "g"],
	["Escape velocity", "esc"], ["Rotation", "rotation"], ["Avg temperature", "temp"],
	["Atmosphere", "atm"]
];
