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

var row = create("div", ["cf-row", "cf-flush"], false, inputs);
create("label", false, "Circular orbit altitude above the Moon (km)", row);
var altInput = create("input", false, false, row);
altInput.type = "number";
altInput.step = "any";
altInput.value = 100;

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
