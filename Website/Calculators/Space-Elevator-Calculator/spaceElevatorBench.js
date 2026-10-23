// Space elevator cards for the home page's workbench: a cable from the
// equator of the selected body, past synchronous orbit, to a counterweight.
// Built on the calculator shell; the physics is spaceElevatorModel.js, the
// same model the standalone calculator (spaceElevatorCalc.html) runs.
//
// ES module. mountSpaceElevator(root, opts) builds one calculator inside
// `root`, with the options and return value of the other workbench
// calculators (Shared/README.md, "Mounting in the home workbench"):
//   opts.body      the body (a name from Shared/orbit.js; default Ceres)
//   opts.embedded  true: fill `root` rather than the window (CalcShell)
//   opts.overline  the small line above the title
//   opts.state     settings from an earlier getState(), restored on mount
// Returns { shell, getState() }.
//
// Every card is on the Architecture tab. The body's GM, equatorial radius,
// rotation and distance from the Sun (its semi-major axis) come from
// Shared/orbit.js.

import { systems } from "../../Shared/orbit.js";
import { Const } from "../../Shared/constants.js";
import { CalcShell, ShellColors as C } from "../../Shared/calc-shell.js";
import { addMaterialCard } from "../../Shared/material-card.js";
import { computeSpaceElevator, AUTO_TIP } from "./spaceElevatorModel.js";

// Link a stylesheet (path relative to this file) unless the document has it.
function ensureStylesheet(path) {
	var href = new URL(path, import.meta.url).href;
	var have = Array.prototype.some.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) { return l.href === href; });
	if (have) return;
	var link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = href;
	document.head.appendChild(link);
}

function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }

export function mountSpaceElevator(root, opts) {
	var o = opts || {};
	ensureStylesheet("../../Shared/calc-shell.css");
	var shell = new CalcShell(root, { title: "Space Elevator", stageLabel: "Drawing (to come)", overline: o.overline, embedded: !!o.embedded });

	var name = o.body && systems.get(o.body) ? o.body : "Ceres";
	var b = systems.get(name);
	var body = { GM: b.GM, R: b.radius.equator, omega: 2 * Math.PI / b.period, aSun: b.orbit.a };

	// ---------- input cards ----------
	var geoCard = shell.addCard({ id: "geo", tab: "arch", side: "in", title: "Tether geometry", short: "Geometry", color: C.core, feeds: ["orb", "cab", "tip", "rel"] });
	var tipIn = shell.numberField(geoCard, { label: "Counterweight altitude", hint: "tip of tether", unit: "km", value: 0, min: 0 });
	var autoNote = shell.note(geoCard, "");
	var mat = addMaterialCard(shell, { id: "mat", tab: "arch", feeds: ["cab"], value: "mwcnt", safety: 2 });

	// ---------- result cards ----------
	var orbCard = shell.addCard({ id: "orb", tab: "arch", side: "out", title: "Orbital mechanics", short: "Orbit", color: C.core });
	var lHsync = shell.line(orbCard, { label: "Synchronous orbit altitude", unit: "km", sub: "Above the surface." });
	var lVsync = shell.line(orbCard, { label: "Synchronous orbital speed", unit: "m/s" });

	var cabCard = shell.addCard({ id: "cab", tab: "arch", side: "out", title: "Cable properties", short: "Cable", color: C.core });
	var lTaper = shell.line(cabCard, { label: "Taper ratio (sync orbit / tip cross-section)" });
	var lMassR = shell.line(cabCard, { label: "Cable mass per kg of tip payload", unit: "kg" });

	var tipCard = shell.addCard({ id: "tip", tab: "arch", side: "out", title: "Tip release (payload launch)", short: "Tip", color: C.sky });
	var lVtip = shell.line(tipCard, { label: "Tip velocity (inertial)", unit: "m/s" });
	var lAtip = shell.line(tipCard, { label: "Artificial gravity at tip", unit: "m/s²" });
	var lVesc = shell.line(tipCard, { label: "Tip escape velocity", unit: "m/s" });

	var relCard = shell.addCard({ id: "rel", tab: "arch", side: "out", title: "Orbit after release", short: "Release", color: C.violet });
	var lEsc = shell.line(relCard, { label: "Released from the tip" });
	var lRetro = shell.line(relCard, { label: "Heliocentric periapsis (retrograde release)", unit: "AU" });
	var lPro = shell.line(relCard, { label: "Heliocentric apoapsis (prograde release)", unit: "AU" });
	var lApo = shell.line(relCard, { label: "Apoapsis altitude (orbit about " + name + ")", unit: "km" });

	function field(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }
	function au(r) { return isFinite(r) ? [num(r / Const.AU, 4), "AU"] : ["escapes the Sun", ""]; }

	function calc() {
		var m = mat.read();
		var tipKm = field(tipIn, 0);
		var se = computeSpaceElevator({ GM: body.GM, R: body.R, omega: body.omega, aSun: body.aSun,
			rTip: tipKm > 0 ? body.R + tipKm * 1e3 : NaN, sigmaEff: m.sigmaEff, density: m.density });
		var tipAlt = (se.rTip - body.R) / 1e3;
		autoNote.textContent = "0 = auto: " + Math.round((AUTO_TIP - 1) * 100) + "% above synchronous orbit (" + num((se.rSync * AUTO_TIP - body.R) / 1e3, 0) + " km here).";
		geoCard.setSummary(num(tipAlt, 0) + " km" + (se.autoTip ? " (auto)" : ""));

		lHsync.set(num(se.hSync / 1e3, 0));
		lVsync.set(num(se.vSync, 2));
		orbCard.setSummary("sync " + num(se.hSync / 1e3, 0) + " km");

		var lines = [lTaper, lMassR, lVtip, lAtip, lVesc, lEsc, lRetro, lPro, lApo];
		if (!(se.rTip > se.rSync)) {
			shell.warn("The counterweight must sit above synchronous orbit (" + num(se.hSync / 1e3, 0) + " km) for its outward pull to hold the cable up.");
			lines.forEach(function (l) { l.set("—"); });
			[lRetro, lPro].forEach(function (l) { l.show(false); });
			cabCard.setSummary("—"); tipCard.setSummary("—"); relCard.setSummary("—");
			return;
		}
		shell.warn("");

		lTaper.set(num(se.taper, 4));
		lMassR.set(se.massRatio >= 1e4 ? se.massRatio.toExponential(3) : se.massRatio >= 1 ? num(se.massRatio, 2) : Number(se.massRatio.toPrecision(3)).toString());
		cabCard.setSummary("taper " + num(se.taper, 3));

		lVtip.set(num(se.vTip, 2));
		lAtip.set(num(se.aTip, 2));
		lVesc.set(num(se.vEsc, 2));
		tipCard.setSummary(num(se.vTip, 0) + " m/s");

		lEsc.set(se.escapes ? "escapes " + name : "stays in orbit about " + name);
		lRetro.show(se.escapes); lPro.show(se.escapes); lApo.show(!se.escapes);
		if (se.escapes) {
			var rp = au(se.helio.retroPeri), ra = au(se.helio.proApo);
			lRetro.set(rp[0], null, rp[1]);
			lPro.set(ra[0], null, ra[1]);
			relCard.setSummary("Sun " + rp.join(" ") + " – " + ra.join(" "));
		} else {
			lApo.set(num((se.helio.bodyApo - body.R) / 1e3, 0));
			relCard.setSummary("apoapsis " + num((se.helio.bodyApo - body.R) / 1e3, 0) + " km");
		}
	}

	shell.onInput(calc);
	if (o.state) shell.setState(o.state);   // runs calc() through onInput
	else calc();

	return { shell: shell, getState: function () { return shell.getState(); } };
}
