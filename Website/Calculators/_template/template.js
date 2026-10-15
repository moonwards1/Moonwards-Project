// Calculator template — the standard way to build a Moonwards calculator on the
// shared utilities. Demonstrates: pulling body data from `systems` (orbit.js),
// computing with `OrbitalMath` (math-utils.js), formatting with `Fmt`
// (format-utils.js) and building the UI with `create` (ui-components.js).
//
// ES module (loaded with <script type="module">). Import only what you need;
// module scripts are deferred, so the DOM is ready when this runs.

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Fmt } from "../../Shared/format-utils.js";
import { create } from "../../Shared/ui-components.js";

var root = document.getElementById("insertItHere");
var moon = systems.get("Moon");   // a body from orbit.js: { GM, radius, ... }

// --- build the UI with the shared create() helper, using the frame's classes
// (Shared/calc-frame.css): a grid of sections, each a heading then rows ---
var grid = create("div", "cf-grid", false, root);
var inputs = create("div", "cf-section", false, grid);
create("h4", false, "Orbit", inputs);

// A row is label, input, then the unit after the input. The round "i" button
// at the end of the label opens a small tip beside it (text in data-cf-tip;
// wired by Shared/calc-about.js). type="button" keeps it from submitting a form.
var row = create("div", "cf-row", false, inputs);
var label = create("label", false, "Circular orbit altitude", row);
var tip = create("button", "cf-info", "i", label);
tip.type = "button";
tip.dataset.cfTip = "Height above the surface, not the centre of the Moon.";
tip.setAttribute("aria-label", "More information");
var altInput = create("input", false, false, row);
altInput.type = "number";
altInput.step = "any";
altInput.value = 100;
create("span", "cf-unit", "km", row);

var results = create("div", "cf-result", false, grid);
create("h4", false, "Result", results);
var out = create("p", ["cf-line", "cf-val"], false, results);

var actions = create("div", "cf-actions", false, root);
var button = create("button", "cf-btn", "Calculate", actions);

// --- compute with OrbitalMath, present with Fmt ---
function calc() {
	var r = moon.radius + Number(altInput.value) * 1000;        // m
	var v = OrbitalMath.circularVelocity(moon.GM, r);           // m/s
	var T = OrbitalMath.orbitalPeriod(moon.GM, r);             // s
	out.textContent =
		"Circular speed: " + Fmt.round(v, 1) + " m/s | " +
		"Period: " + Fmt.time(T / 86400);                      // Fmt.time takes days
}

button.onclick = function (e) { e.preventDefault(); calc(); };
calc();   // show a result on load
