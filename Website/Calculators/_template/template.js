// Calculator template — the standard way to build a Moonwards calculator on the
// shared utilities. Demonstrates: pulling body data from `systems` (orbit.js),
// computing with `OrbitalMath` (math-utils.js), formatting with `Fmt`
// (format-utils.js) and building the UI with `create` (ui-components.js).

(function () {
	"use strict";

	var root = document.getElementById("insertItHere");
	var moon = systems.get("Moon");   // a body from orbit.js: { GM, radius, ... }

	// --- build the UI with the shared create() helper ---
	var form = create("form", false, false, root);

	var altInput = create("input", false, false, form);
	altInput.type = "number";
	altInput.step = "any";
	altInput.value = 100;
	create("span", "label", "Circular orbit altitude above the Moon (km)", form);
	create("br", false, false, form);

	var button = create("button", false, "Calculate", form, "display:block; margin-top:8px");
	var out = create("p", "#out", false, root);

	// --- compute with OrbitalMath, present with Fmt ---
	function calc() {
		var r = moon.radius + Number(altInput.value) * 1000;        // m
		var v = OrbitalMath.circularVelocity(moon.GM, r);           // m/s
		var T = OrbitalMath.orbitalPeriod(moon.GM, r);             // s
		out.textContent =
			"Circular speed: " + Fmt.round(v, 1) + " m/s | " +
			"Period: " + Fmt.time(T / 86400);                      // Fmt.time takes days
	}

	button.onclick = function (e) { e.preventDefault(); calc(); };
	calc();   // show a result on load

})();
