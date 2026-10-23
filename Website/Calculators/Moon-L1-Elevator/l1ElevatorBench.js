// Moon–L1 elevator cards for the home page's workbench: a tether from the
// Moon's near side through Earth–Moon L1 to a counterweight beyond it.
// Built on the calculator shell; the physics is l1ElevatorModel.js, the same
// model the standalone calculator (MoonL1ElevatorCalc.html) runs.
//
// ES module. mountMoonL1Elevator(root, opts) builds one calculator inside
// `root`, with the options and return value of the other workbench
// calculators (Shared/README.md, "Mounting in the home workbench"):
//   opts.embedded  true: fill `root` rather than the window (CalcShell)
//   opts.overline  the small line above the title
//   opts.state     settings from an earlier getState(), restored on mount
// The body is always the Moon. Returns { shell, getState() }.
//
// Every card is on the Architecture tab. The cable is sized for its structure
// alone — the cable and its track, with no cargo aboard: cargo traffic is
// still to be modelled on the Logistics and Engineering tabs, and will raise
// the minimum counterweight when it is. The track keeps the standalone
// calculator's default gauges. Earth-entry figures describe the natural orbit
// of a vessel let go at the counterweight, with no burn.

import { systems } from "../../Shared/orbit.js";
import { Const } from "../../Shared/constants.js";
import { CalcShell, ShellColors as C } from "../../Shared/calc-shell.js";
import { addMaterialCard } from "../../Shared/material-card.js";
import { L1Elevator } from "./l1ElevatorModel.js";

var TRACK_MIN = 0.4;        // kg/m, track minimum gauge everywhere
var TRACK_GRAV = 1.2;       // kg/m at the surface, traction reinforcement ∝ local gravity
var ENTRY_INTERFACE = 122e3;   // m above Earth's surface
// The counterweight as a multiple of the structure's minimum: an estimate
// should hold at least MULT_ADVISED (room for cargo and what the structure
// doesn't count yet); below MULT_FLOOR it isn't accepted.
var MULT_ADVISED = 3;
var MULT_FLOOR = 1.5;

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
function ratio(x) { return !isFinite(x) ? "—" : x >= 1e4 ? x.toExponential(3) : num(x, 3); }

export function mountMoonL1Elevator(root, opts) {
	var o = opts || {};
	ensureStylesheet("../../Shared/calc-shell.css");
	var shell = new CalcShell(root, { title: "Moon–L1 Elevator", stageLabel: "Drawing (to come)", overline: o.overline, embedded: !!o.embedded });

	// The Earth–Moon system, from Shared/orbit.js.
	var moon = systems.get("Moon"), earth = systems.get("Earth");
	var D = moon.orbit.a;
	var sys = {
		Rmoon: moon.radius.equator, D: D, baryE: D * moon.GM / (earth.GM + moon.GM),
		GMm: moon.GM, GMe: earth.GM, omegaSrc: "kepler", Rearth: Number(earth.radius)
	};
	sys.rL1 = L1Elevator.findL1(sys);
	var L1km = Math.round(sys.rL1 / 1e6) * 1e3;

	// ---------- input cards ----------
	var mat = addMaterialCard(shell, { id: "mat", tab: "arch", feeds: ["prop", "frc"], value: "mwcnt", safety: 3 });

	var posCard = shell.addCard({ id: "cwpos", tab: "arch", side: "in", title: "Counterweight position", short: "Position", color: C.core, feeds: ["prop", "frc", "orb"] });
	var rCWIn = shell.numberField(posCard, { label: "Counterweight distance", hint: "from the Moon's centre", unit: "km", value: 222100, min: 1 });
	shell.note(posCard, "Must sit beyond L1 at " + num(L1km, 0) + " km so it pulls the structure up.");

	var cwCard = shell.addCard({ id: "cwm", tab: "arch", side: "in", title: "Counterweight mass", short: "Counterweight", color: C.ochre, feeds: ["prop", "frc"] });
	var by = shell.choice(cwCard, { key: "Defined by", value: "mult" });
	var massIn = shell.numberField(cwCard, { label: "Mass", unit: "kt", value: "", min: 0, choice: by, choiceValue: "mass" });
	var multIn = shell.numberField(cwCard, { label: "Multiple of the minimum", unit: "×", value: MULT_ADVISED, min: MULT_FLOOR, step: "0.1", choice: by, choiceValue: "mult" });
	multIn.addEventListener("change", function () { if (!(parseFloat(multIn.value) >= MULT_FLOOR)) { multIn.value = MULT_FLOOR; calc(); } });
	var minNote = shell.note(cwCard, "");

	// ---------- result cards ----------
	var propCard = shell.addCard({ id: "prop", tab: "arch", side: "out", title: "Cable properties", short: "Cable", color: C.core });
	var lTaperS = shell.line(propCard, { label: "Taper ratio (L1 / surface anchor)" });
	var lTaperC = shell.line(propCard, { label: "Taper ratio (L1 / counterweight)" });
	var lCable = shell.line(propCard, { label: "Tether (cable) mass", unit: "kt" });
	var lTotal = shell.line(propCard, { label: "Initial total cable structures mass estimate", unit: "kt" });

	var frcCard = shell.addCard({ id: "frc", tab: "arch", side: "out", title: "Forces", short: "Forces", color: C.rust });
	var lTL1 = shell.line(frcCard, { label: "Tension at L1 (peak)", unit: "MN" });
	var lTsurf = shell.line(frcCard, { label: "Hold-down tension at surface", unit: "MN" });
	var lAnet = shell.line(frcCard, { label: "Net acceleration at counterweight", unit: "m/s²" });

	var orbCard = shell.addCard({ id: "orb", tab: "arch", side: "out", title: "Orbit after release", short: "Release", color: C.violet });
	var lRrel = shell.line(orbCard, { label: "Release radius from Earth (apogee)", unit: "km" });
	var lVrel = shell.line(orbCard, { label: "Tangential speed at release", unit: "m/s" });
	var lPer = shell.line(orbCard, { label: "Perigee of released vessel", unit: "km" });
	var lFpa = shell.line(orbCard, { label: "Entry flight-path angle (at interface)", unit: "°" });
	var lPeakG = shell.line(orbCard, { label: "Estimated peak deceleration", unit: "g" });
	shell.note(orbCard, "A vessel let go at the counterweight keeps the system's rotation speed, far below circular speed about Earth, so release is the apogee of its Earth orbit. No burn: the counterweight's position alone sets the perigee. Entry interface " + num(ENTRY_INTERFACE / 1e3, 0) + " km. Peak g is a ballistic Allen–Eggers estimate calibrated to Stardust flight data (±~20%); lift and guidance reduce it.");

	function field(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }
	function setScaled(line, x, units, d) { var s = scaled(x, units, d); line.set(s[0], null, s[1]); return s; }
	function blank(lines) { lines.forEach(function (l) { l.set("—"); }); }

	function calc() {
		var m = mat.read();
		var rCW = field(rCWIn, 222100) * 1e3;
		var p = Object.assign({}, sys, {
			sig: m.strength, rho: m.density, safety: m.safety, rCW: rCW,
			rate: 0, perClimber: 1, vClimb: 200, infraPct: 0, trackMin: TRACK_MIN, trackGrav: TRACK_GRAV
		});
		posCard.setSummary(num(rCW / 1e3, 0) + " km");

		// Orbit after release depends on the position alone.
		var ro = L1Elevator.releaseOrbit({ GMe: sys.GMe, D: sys.D, rCW: rCW, omega: L1Elevator.omega(sys),
			Rearth: sys.Rearth, ifaceAlt: ENTRY_INTERFACE });
		lRrel.set(num(ro.rRel / 1e3, 0));
		lVrel.set(num(ro.vRel, 1));
		if (!ro.bound) {
			lPer.set("unbound", "Escapes Earth: no perigee.", ""); lFpa.set("—", ""); lPeakG.set("—", "");
			orbCard.setSummary("escapes Earth");
		} else {
			lPer.set(num((ro.rPer - sys.Rearth) / 1e3, 0), "altitude; " + num(ro.rPer / 1e3, 0) + " km from Earth's centre", "km");
			if (ro.entry) {
				lFpa.set("−" + num(ro.entry.gamma * 180 / Math.PI, 1), "entry speed " + num(ro.entry.vI / 1e3, 2) + " km/s");
				lPeakG.set("~" + num(ro.entry.peakG, 0), "ballistic estimate");
				orbCard.setSummary("perigee " + num((ro.rPer - sys.Rearth) / 1e3, 0) + " km · ~" + num(ro.entry.peakG, 0) + " g");
			} else {
				lFpa.set("—", "Perigee above the entry interface: no entry."); lPeakG.set("—", "");
				orbCard.setSummary("perigee " + num((ro.rPer - sys.Rearth) / 1e3, 0) + " km");
			}
		}

		var cableLines = [lTaperS, lTaperC, lCable, lTotal, lTL1, lTsurf, lAnet];
		var ctx = rCW > sys.rL1 && rCW < sys.D - sys.Rearth ? L1Elevator.buildContext(p) : null;
		if (!ctx || !(ctx.gCW > 0)) {
			shell.warn(rCW > sys.rL1
				? "The counterweight must sit between L1 and Earth, where the net force on it points toward Earth."
				: "The counterweight must sit beyond L1, " + num(L1km, 0) + " km from the Moon's centre, to pull the structure up.");
			minNote.textContent = ""; blank(cableLines);
			cwCard.setSummary("—"); propCard.setSummary("—"); frcCard.setSummary("—");
			return;
		}
		var min = ctx.McwMin;

		var Mcw;
		if (by.value === "mass") {
			Mcw = field(massIn, NaN) * 1e6;
			multIn.value = isFinite(Mcw) && min > 0 ? (Mcw / min).toFixed(2) : "";
		} else {
			Mcw = Math.max(MULT_FLOOR, field(multIn, MULT_ADVISED)) * min;
			massIn.value = Number((Mcw / 1e6).toPrecision(4));
		}
		var minS = scaled(min, MASS);
		minNote.textContent = "Minimum " + minS[0] + " " + minS[1] + ": just enough to hold up the cable and its track, without cargo. Use at least " + MULT_ADVISED + "× it, and no less than " + MULT_FLOOR + "×, to leave room for cargo and the rest of the design.";
		var cwS = scaled(Mcw, MASS);
		cwCard.setSummary(cwS[0] + " " + cwS[1] + " · " + num(Mcw / min, 2) + "× min");

		if (!(Mcw >= MULT_FLOOR * min)) {
			shell.warn(!isFinite(Mcw) ? "Enter a counterweight mass."
				: Mcw < min ? "Counterweight " + cwS.join(" ") + " is below the minimum " + minS.join(" ") + ": its outward pull can't hold the cable up, so the whole elevator would be pulled down onto the Moon."
				: "Counterweight " + cwS.join(" ") + " is under " + MULT_FLOOR + "× the minimum (" + scaled(MULT_FLOOR * min, MASS).join(" ") + "), too little to size an elevator on. Use at least " + MULT_ADVISED + "×.");
			blank(cableLines);
			propCard.setSummary("—"); frcCard.setSummary("—");
			return;
		}
		shell.warn(Mcw < MULT_ADVISED * min - 1e-6 * min
			? "Counterweight under " + MULT_ADVISED + "× the minimum (" + scaled(MULT_ADVISED * min, MASS).join(" ") + "): little margin for cargo and what the structure doesn't count yet."
			: "");

		var r = L1Elevator.loadedMetrics(p, ctx, Mcw);
		lTaperS.set(ratio(r.AL1 / r.Asurf));
		lTaperC.set(ratio(r.AL1 / r.Acw));
		var cab = setScaled(lCable, r.mass, MASS);
		var tot = scaled(r.mass + r.trackMass, MASS);
		lTotal.set(tot[0], "Cable plus its track (" + num(TRACK_MIN + TRACK_GRAV, 1) + " kg/m at the surface, thinning to " + num(TRACK_MIN, 1) + " kg/m above the gravity well); counterweight not included.", tot[1]);
		var tl1 = setScaled(lTL1, r.TL1, FORCE, 2);
		setScaled(lTsurf, r.TsurfHold, FORCE, 2);
		var a = ctx.gCW;
		lAnet.set(Math.abs(a).toExponential(3), (a >= 0 ? "Outward, toward Earth" : "Inward, toward the Moon") + " (" + (Math.abs(a) / Const.g0).toExponential(2) + " × Earth g).");
		propCard.setSummary("taper " + ratio(r.AL1 / r.Asurf) + " · " + cab.join(" "));
		frcCard.setSummary(tl1.join(" ") + " at L1");
	}

	shell.onInput(calc);
	if (o.state) shell.setState(o.state);   // runs calc() through onInput
	else calc();

	return { shell: shell, getState: function () { return shell.getState(); } };
}
