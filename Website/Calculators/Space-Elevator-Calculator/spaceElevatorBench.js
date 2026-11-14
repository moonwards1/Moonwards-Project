// Space elevator cards for the home page's workbench: a cable from the
// equator of the selected body, past synchronous orbit, to a counterweight.
// Built on the calculator shell; the orbital figures are spaceElevatorModel.js
// (the model its Node test pins), the tether is Shared/radial-tether.js.
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
// Shared/orbit.js. The cable is sized for its structure — the cable, its
// track and any stations, with no cargo aboard: cargo traffic is still to be
// modelled on the Logistics and Engineering tabs. The track has the Moon–L1
// elevator's default gauges.

import { systems } from "../../Shared/orbit.js";
import { Const } from "../../Shared/constants.js";
import { CalcShell, ShellColors as C } from "../../Shared/calc-shell.js";
import { addMaterialCard } from "../../Shared/material-card.js";
import { addCounterweightCard } from "../../Shared/counterweight-card.js";
import { standardField, tetherContext, tetherMetrics } from "../../Shared/radial-tether.js";
import { computeSpaceElevator, AUTO_TIP } from "./spaceElevatorModel.js";

var TRACK_MIN = 0.4;        // kg/m, track minimum gauge everywhere
var TRACK_GRAV = 1.2;       // kg/m at the surface, traction reinforcement ∝ local gravity

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
// [value, unit] at the largest unit the magnitude reaches; units largest first.
function scaled(x, units, d) {
	if (!isFinite(x)) return ["—", ""];
	for (var i = 0; i < units.length; i++) {
		if (Math.abs(x) >= units[i][0] || i === units.length - 1) return [num(x / units[i][1], d == null ? 1 : d), units[i][2]];
	}
}
var MASS = [[1e9, 1e9, "Mt"], [1e6, 1e6, "kt"], [1e3, 1e3, "t"], [0, 1, "kg"]];
var FORCE = [[1e6, 1e6, "MN"], [1e3, 1e3, "kN"], [0, 1, "N"]];
function ratio(x) { return !isFinite(x) ? "—" : x >= 1e4 ? x.toExponential(3) : num(x, 4); }

export function mountSpaceElevator(root, opts) {
	var o = opts || {};
	ensureStylesheet("../../Shared/calc-shell.css");
	var shell = new CalcShell(root, { title: "Space Elevator", stageLabel: "Drawing (to come)", overline: o.overline, embedded: !!o.embedded });

	var name = o.body && systems.get(o.body) ? o.body : "Ceres";
	var b = systems.get(name);
	var body = { GM: b.GM, R: b.radius.equator, omega: 2 * Math.PI / b.period, aSun: b.orbit.a };
	var field = standardField(body.GM, body.R, body.omega);

	// ---------- input cards ----------
	var cw = addCounterweightCard(shell, { id: "cw", tab: "arch", feeds: ["orb", "cab", "frc", "tip", "rel"],
		position: { label: "Counterweight altitude", hint: "tip of tether", unit: "km", value: 0, min: 0 },
		balance: "synchronous orbit",
		names: { in: "Inward", out: "Outward" },
		pull: { in: "toward " + name, out: "away from " + name } });
	var mat = addMaterialCard(shell, { id: "mat", tab: "arch", feeds: ["cab", "frc"], value: "mwcnt", safety: 2 });
	var lTaperS = mat.addTaperLine("Taper ratio (sync orbit / surface anchor)");
	var lTaperC = mat.addTaperLine("Taper ratio (sync orbit / counterweight)");

	// ---------- result cards ----------
	var orbCard = shell.addCard({ id: "orb", tab: "arch", side: "out", title: "Orbital mechanics", short: "Orbit", color: C.core });
	var lHsync = shell.line(orbCard, { label: "Synchronous orbit altitude", unit: "km", sub: "Above the surface." });
	var lVsync = shell.line(orbCard, { label: "Synchronous orbital speed", unit: "m/s" });

	var cabCard = shell.addCard({ id: "cab", tab: "arch", side: "out", title: "Cable properties", short: "Cable", color: C.core });
	var lCable = shell.line(cabCard, { label: "Tether (cable) mass", unit: "kt" });
	var lTotal = shell.line(cabCard, { label: "Initial total cable structures mass estimate", unit: "kt" });

	var frcCard = shell.addCard({ id: "frc", tab: "arch", side: "out", title: "Forces", short: "Forces", color: C.rust });
	var lTpk = shell.line(frcCard, { label: "Tension at synchronous orbit (peak)", unit: "MN" });
	var lTsurf = shell.line(frcCard, { label: "Hold-down tension at surface", unit: "MN" });

	var tipCard = shell.addCard({ id: "tip", tab: "arch", side: "out", title: "Tip release (payload)", short: "Tip", color: C.sky });
	var lVtip = shell.line(tipCard, { label: "Tip velocity (inertial)", unit: "m/s" });
	var lAtip = shell.line(tipCard, { label: "Artificial gravity at tip", unit: "m/s²" });
	var lVesc = shell.line(tipCard, { label: "Tip escape velocity", unit: "m/s" });

	var relCard = shell.addCard({ id: "rel", tab: "arch", side: "out", title: "Orbit after release", short: "Release", color: C.violet });
	var lEsc = shell.line(relCard, { label: "Released from the tip" });
	var lRetro = shell.line(relCard, { label: "Heliocentric periapsis (retrograde release)", unit: "AU" });
	var lPro = shell.line(relCard, { label: "Heliocentric apoapsis (prograde release)", unit: "AU" });
	var lApo = shell.line(relCard, { label: "Apoapsis altitude (orbit about " + name + ")", unit: "km" });

	function field_(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }
	function setScaled(line, x, units, d) { var s = scaled(x, units, d); line.set(s[0], null, s[1]); return s; }
	function au(r) { return isFinite(r) ? [num(r / Const.AU, 4), "AU"] : ["escapes the Sun", ""]; }

	function calc() {
		var m = mat.read(body.GM / (body.R * body.R));
		var tipKm = field_(cw.posIn, 0);
		var se = computeSpaceElevator({ GM: body.GM, R: body.R, omega: body.omega, aSun: body.aSun,
			rTip: tipKm > 0 ? body.R + tipKm * 1e3 : NaN });
		cw.posNote.textContent = "0 = auto: " + Math.round((AUTO_TIP - 1) * 100) + "% above synchronous orbit (" + num((se.rSync * AUTO_TIP - body.R) / 1e3, 0) + " km here)." + (se.autoTip ? "" : " Must sit above synchronous orbit.");

		lHsync.set(num(se.hSync / 1e3, 0));
		lVsync.set(num(se.vSync, 2));
		orbCard.setSummary("sync " + num(se.hSync / 1e3, 0) + " km");

		var lines = [lTaperS, lTaperC, lCable, lTotal, lTpk, lTsurf, lVtip, lAtip, lVesc, lEsc, lRetro, lPro, lApo];
		if (!(se.rTip > se.rSync)) {
			shell.warn("The counterweight must sit above synchronous orbit (" + num(se.hSync / 1e3, 0) + " km) for its outward pull to hold the cable up.");
			lines.forEach(function (l) { l.set("—"); });
			[lRetro, lPro].forEach(function (l) { l.show(false); });
			cw.blank();
			cabCard.setSummary("—"); frcCard.setSummary("—"); tipCard.setSummary("—"); relCard.setSummary("—");
			return;
		}
		shell.warn("");

		var stations = cw.resolve({ field: field, rCW: se.rTip });
		var ctx = tetherContext(field, { rCW: se.rTip, rho: m.density, sigEff: m.sigmaEff, lamMin: TRACK_MIN, lamGrav: TRACK_GRAV, stations: stations });
		var Mcw = cw.settle(ctx).M;
		var r = tetherMetrics(ctx, Mcw);
		lTaperS.set(ratio(r.Apeak / r.Asurf));
		lTaperC.set(ratio(r.Apeak / r.Acw));
		var cab = setScaled(lCable, r.mass, MASS);
		var tot = scaled(r.mass + r.trackMass, MASS);
		lTotal.set(tot[0], "Cable plus its track (" + num(TRACK_MIN + TRACK_GRAV, 1) + " kg/m at the surface, thinning to " + num(TRACK_MIN, 1) + " kg/m at synchronous orbit); counterweight and stations not included.", tot[1]);
		cabCard.setSummary("taper " + ratio(r.Apeak / r.Asurf) + " · " + cab.join(" "));
		var tpk = setScaled(lTpk, r.Tpeak, FORCE, 2);
		setScaled(lTsurf, r.TsurfHold, FORCE, 2);
		frcCard.setSummary(tpk.join(" ") + " at sync");

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
