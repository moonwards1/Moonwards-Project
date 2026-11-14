// The Moon's Lagrange elevators, as cards for the home page's workbench: a
// tether from the Moon's near side through Earth–Moon L1 to a counterweight
// beyond it, or from the far side through L2. Built on the calculator shell;
// the tether is Shared/radial-tether.js in the Earth–Moon field.
//
// ES module. mountMoonLagrangeElevator(root, opts) builds one calculator inside
// `root`, with the options and return value of the other workbench
// calculators (Shared/README.md, "Mounting in the home workbench"):
//   opts.side      "L1" (default) or "L2"
//   opts.embedded  true: fill `root` rather than the window (CalcShell)
//   opts.overline  the small line above the title
//   opts.state     settings from an earlier getState(), restored on mount
// The body is always the Moon. Returns { shell, getState() }.
//
// Every card is on the Architecture tab. The cable is sized for its structure
// — the cable, its track and any stations, with no cargo aboard: cargo traffic
// is still to be modelled on the Logistics and Engineering tabs. The track
// keeps the standalone L1 calculator's default gauges. The orbit after release
// is the natural two-body orbit about Earth of a vessel let go at the
// counterweight, with no burn.

import { systems } from "../../Shared/orbit.js";
import { Const } from "../../Shared/constants.js";
import { CalcShell, ShellColors as C } from "../../Shared/calc-shell.js";
import { addMaterialCard } from "../../Shared/material-card.js";
import { addCounterweightCard } from "../../Shared/counterweight-card.js";
import { earthMoonField, tetherContext, tetherMetrics } from "../../Shared/radial-tether.js";
import { L1Elevator } from "./l1ElevatorModel.js";

var TRACK_MIN = 0.4;        // kg/m, track minimum gauge everywhere
var TRACK_GRAV = 1.2;       // kg/m at the surface, traction reinforcement ∝ local gravity
var ENTRY_INTERFACE = 122e3;   // m above Earth's surface
var DEFAULT_CW = { L1: 222100, L2: 100000 };   // km from the Moon's centre

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

export function mountMoonLagrangeElevator(root, opts) {
	var o = opts || {};
	var side = o.side === "L2" ? "L2" : "L1", near = side === "L1";
	ensureStylesheet("../../Shared/calc-shell.css");
	var shell = new CalcShell(root, { title: "Moon–" + side + " Elevator", stageLabel: "Drawing (to come)", overline: o.overline, embedded: !!o.embedded });

	// The Earth–Moon system, from Shared/orbit.js.
	var moon = systems.get("Moon"), earth = systems.get("Earth");
	var D = moon.orbit.a;
	var sys = { Rmoon: moon.radius.equator, D: D, baryE: D * moon.GM / (earth.GM + moon.GM), GMm: moon.GM, GMe: earth.GM, omegaSrc: "kepler" };
	var omega = L1Elevator.omega(sys);
	var field = earthMoonField(side, { GMm: sys.GMm, GMe: sys.GMe, D: D, xb: D - sys.baryE, omega: omega, Rmoon: sys.Rmoon });
	var Rearth = Number(earth.radius);
	var rBkm = field.rBalance / 1e3, hBkm = (field.rBalance - sys.Rmoon) / 1e3;

	// ---------- input cards ----------
	var mat = addMaterialCard(shell, { id: "mat", tab: "arch", feeds: ["prop", "frc"], value: "mwcnt", safety: 3 });
	var lTaperS = mat.addTaperLine("Taper ratio (" + side + " / surface anchor)");
	var lTaperC = mat.addTaperLine("Taper ratio (" + side + " / counterweight)");

	var cw = addCounterweightCard(shell, { id: "cw", tab: "arch", feeds: ["prop", "frc", "orb"],
		position: { label: "Counterweight distance", hint: "from the Moon's centre", unit: "km", value: DEFAULT_CW[side], min: 1 },
		balance: side,
		names: near ? { in: "Moon side", out: "Earth side" } : { in: "Moon side", out: "Far side" },
		pull: near ? { in: "toward the Moon", out: "toward Earth" } : { in: "toward the Moon", out: "away from the Moon" } });
	cw.posNote.textContent = "Must sit beyond " + side + ", " + num(rBkm, 0) + " km from the Moon's centre (" + num(hBkm, 0) + " km altitude), so it pulls the structure up.";

	// ---------- result cards ----------
	var propCard = shell.addCard({ id: "prop", tab: "arch", side: "out", title: "Cable properties", short: "Cable", color: C.core });
	var lCable = shell.line(propCard, { label: "Tether (cable) mass", unit: "kt" });
	var lTotal = shell.line(propCard, { label: "Initial total cable structures mass estimate", unit: "kt" });

	var frcCard = shell.addCard({ id: "frc", tab: "arch", side: "out", title: "Forces", short: "Forces", color: C.rust });
	var lTpk = shell.line(frcCard, { label: "Tension at " + side + " (peak)", unit: "MN" });
	var lTsurf = shell.line(frcCard, { label: "Hold-down tension at surface", unit: "MN" });
	var lAnet = shell.line(frcCard, { label: "Net acceleration at counterweight", unit: "m/s²" });

	var orbCard = shell.addCard({ id: "orb", tab: "arch", side: "out", title: "Orbit after release", short: "Release", color: C.violet });
	var lRrel = shell.line(orbCard, { label: "Release radius from Earth (" + (near ? "apogee" : "perigee") + ")", unit: "km" });
	var lVrel = shell.line(orbCard, { label: "Tangential speed at release", unit: "m/s" });
	var lPer, lFpa, lPeakG, lApo;
	if (near) {
		lPer = shell.line(orbCard, { label: "Perigee of released vessel", unit: "km" });
		lFpa = shell.line(orbCard, { label: "Entry flight-path angle (at interface)", unit: "°" });
		lPeakG = shell.line(orbCard, { label: "Estimated peak deceleration", unit: "g" });
		shell.note(orbCard, "A vessel let go at the counterweight keeps the system's rotation speed, far below circular speed about Earth, so release is the apogee of its Earth orbit. No burn: the counterweight's position alone sets the perigee. Entry interface " + num(ENTRY_INTERFACE / 1e3, 0) + " km. Peak g is a ballistic Allen–Eggers estimate calibrated to Stardust flight data (±~20%); lift and guidance reduce it.");
	} else {
		lApo = shell.line(orbCard, { label: "Apogee of released vessel", unit: "km" });
		shell.note(orbCard, "A vessel let go at the counterweight keeps the system's rotation speed, above circular speed about Earth there, so release is the perigee of its Earth orbit, or it escapes Earth. No burn. Two-body orbit about Earth: the Moon's pull near release is left out.");
	}

	function field_(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }
	function setScaled(line, x, units, d) { var s = scaled(x, units, d); line.set(s[0], null, s[1]); return s; }
	function blank(lines) { lines.forEach(function (l) { l.set("—"); }); }

	function releaseCard(rCW) {
		var ro = L1Elevator.releaseOrbit({ GMe: sys.GMe, D: D, rCW: rCW, rRel: near ? NaN : D + rCW, omega: omega,
			Rearth: Rearth, ifaceAlt: ENTRY_INTERFACE });
		lRrel.set(num(ro.rRel / 1e3, 0));
		lVrel.set(num(ro.vRel, 1));
		if (!near) {
			if (!ro.bound) {
				var vInf = Math.sqrt(ro.vRel * ro.vRel - 2 * sys.GMe / ro.rRel);
				lApo.set("unbound", "Escapes Earth at " + num(vInf, 0) + " m/s hyperbolic excess.", "");
				orbCard.setSummary("escapes Earth");
			} else {
				lApo.set(num(ro.rApo / 1e3, 0), "from Earth's centre", "km");
				orbCard.setSummary("apogee " + num(ro.rApo / 1e3, 0) + " km");
			}
			return;
		}
		if (!ro.bound) {
			lPer.set("unbound", "Escapes Earth: no perigee.", ""); lFpa.set("—", ""); lPeakG.set("—", "");
			orbCard.setSummary("escapes Earth");
		} else {
			lPer.set(num((ro.rPer - Rearth) / 1e3, 0), "altitude; " + num(ro.rPer / 1e3, 0) + " km from Earth's centre", "km");
			if (ro.entry) {
				lFpa.set("−" + num(ro.entry.gamma * 180 / Math.PI, 1), "entry speed " + num(ro.entry.vI / 1e3, 2) + " km/s");
				lPeakG.set("~" + num(ro.entry.peakG, 0), "ballistic estimate");
				orbCard.setSummary("perigee " + num((ro.rPer - Rearth) / 1e3, 0) + " km · ~" + num(ro.entry.peakG, 0) + " g");
			} else {
				lFpa.set("—", "Perigee above the entry interface: no entry."); lPeakG.set("—", "");
				orbCard.setSummary("perigee " + num((ro.rPer - Rearth) / 1e3, 0) + " km");
			}
		}
	}

	function calc() {
		var m = mat.read(moon.GM / (Number(moon.radius.equator) * Number(moon.radius.equator)));
		var rCW = field_(cw.posIn, DEFAULT_CW[side]) * 1e3;

		// Orbit after release depends on the position alone.
		releaseCard(rCW);

		var cableLines = [lTaperS, lTaperC, lCable, lTotal, lTpk, lTsurf, lAnet];
		var ok = rCW > field.rBalance && (!near || rCW < D - Rearth) && field.g(rCW) > 0;
		if (!ok) {
			shell.warn(rCW > field.rBalance
				? "The counterweight must sit between L1 and Earth, where the net force on it points toward Earth."
				: "The counterweight must sit beyond " + side + ", " + num(rBkm, 0) + " km from the Moon's centre, to pull the structure up.");
			cw.blank(); blank(cableLines);
			propCard.setSummary("—"); frcCard.setSummary("—");
			return;
		}
		shell.warn("");

		var stations = cw.resolve({ field: field, rCW: rCW });
		var ctx = tetherContext(field, { rCW: rCW, rho: m.density, sigEff: m.sigmaEff, lamMin: TRACK_MIN, lamGrav: TRACK_GRAV, stations: stations });
		var Mcw = cw.settle(ctx).M;

		var r = tetherMetrics(ctx, Mcw);
		lTaperS.set(ratio(r.Apeak / r.Asurf));
		lTaperC.set(ratio(r.Apeak / r.Acw));
		var cab = setScaled(lCable, r.mass, MASS);
		var tot = scaled(r.mass + r.trackMass, MASS);
		lTotal.set(tot[0], "Cable plus its track (" + num(TRACK_MIN + TRACK_GRAV, 1) + " kg/m at the surface, thinning to " + num(TRACK_MIN, 1) + " kg/m at " + side + "); counterweight and stations not included.", tot[1]);
		var tpk = setScaled(lTpk, r.Tpeak, FORCE, 2);
		setScaled(lTsurf, r.TsurfHold, FORCE, 2);
		var a = ctx.gCW;
		lAnet.set(Math.abs(a).toExponential(3), (near ? "Outward, toward Earth" : "Outward, away from the Moon") + " (" + (Math.abs(a) / Const.g0).toExponential(2) + " × Earth g).");
		propCard.setSummary("taper " + ratio(r.Apeak / r.Asurf) + " · " + cab.join(" "));
		frcCard.setSummary(tpk.join(" ") + " at " + side);
	}

	shell.onInput(calc);
	if (o.state) shell.setState(o.state);   // runs calc() through onInput
	else calc();

	return { shell: shell, getState: function () { return shell.getState(); } };
}
