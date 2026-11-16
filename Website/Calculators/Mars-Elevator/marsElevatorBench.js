// The off-equator Mars elevator, as cards for the home page's workbench: one
// tether from an anchor well off the equator (Olympus Mons by default),
// bowing toward the equatorial plane and running out past areostationary
// orbit to a counterweight. Its height above the plane clears Phobos; Deimos
// is kept below the counterweight's orbit or dodged by swinging the tether
// north–south. Built on the calculator shell; the tether is
// Shared/meridian-tether.js in Mars's field, the rest marsElevatorModel.js.
//
// ES module. mountMarsElevator(root, opts) builds one calculator inside
// `root`, with the options and return value of the other workbench
// calculators (Shared/README.md, "Mounting in the home workbench"):
//   opts.embedded  true: fill `root` rather than the window (CalcShell)
//   opts.overline  the small line above the title
//   opts.state     settings from an earlier getState(), restored on mount
// The body is always Mars. Returns { shell, getState() }.
//
// Every card is on the Architecture tab. The cable is sized for its structure
// — the cable, its track and any stations, with no cargo aboard, like the
// other workbench elevators; the track has their default gauges. Climber
// traffic enters only where it moves the tether: pumping the dodge swing, and
// the westward lean of one-way traffic.

import { Const } from "../../Shared/constants.js";
import { CalcShell, ShellColors as C } from "../../Shared/calc-shell.js";
import { addMaterialCard } from "../../Shared/material-card.js";
import { addCounterweightCard } from "../../Shared/counterweight-card.js";
import { solveMeridianTether, trackPull } from "../../Shared/meridian-tether.js";
import { MarsElevator as ME } from "./marsElevatorModel.js";

var TRACK_MIN = 0.4;        // kg/m, track minimum gauge everywhere
var TRACK_GRAV = 1.2;       // kg/m at the anchor, traction reinforcement ∝ local gravity
var DEFAULT = { lat: 18.65, height: 21.9, rCW: 51000, tilt: 0.93, band: 100, dodge: 60,
	from: 400, to: 800, cycles: 6, vFull: 200, vSlow: 20, mdot: 1 };
var VE_CHEM = 8000, VE_ION = 50000;   // m/s, backup thrusters' exhaust speeds
var DEG = Math.PI / 180, YEAR = 365.25 * 86400;
// The tether must leave the anchor at least this far above horizontal. A
// lighter counterweight means less tension at the bottom, where the track's
// weight then bends the tether down toward the ground.
var MIN_DEPARTURE = 10 * DEG;

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
var ENERGY = [[1e12, 1e12, "TJ"], [1e9, 1e9, "GJ"], [1e6, 1e6, "MJ"], [0, 1, "J"]];
function ratio(x) { return !isFinite(x) ? "—" : x >= 1e4 ? x.toExponential(3) : num(x, 3); }
function km(m, d) { return num(m / 1e3, d == null ? 0 : d); }
function sci(x, d) {
	if (!isFinite(x)) return "—";
	var e = Math.floor(Math.log10(Math.abs(x))), mnt = x / Math.pow(10, e);
	return num(mnt, d == null ? 2 : d) + "×10" + String(e).replace(/-/, "⁻").replace(/\d/g, function (c) { return "⁰¹²³⁴⁵⁶⁷⁸⁹"[c]; });
}
function northSouth(z) { return z >= 0 ? "north" : "south"; }

// The tether's felt force against distance from the centre, for the stations
// on the Counterweight & stations card: |f| along the solved path, negative
// (toward Mars) up to the balance point and positive beyond it.
function stationField(sol) {
	var p = sol.path, n = p.r.length, iB = n - 1;
	for (var i = 1; i < n; i++) if (p.ft[i - 1] < 0 && p.ft[i] >= 0) { iB = i; break; }
	var signed = new Float64Array(n);
	for (var i = 0; i < n; i++) {
		var f = Math.sqrt(p.ft[i] * p.ft[i] + p.fn[i] * p.fn[i]);
		signed[i] = i < iB ? -f : f;
	}
	function g(r) {
		if (r <= p.r[0]) return signed[0];
		if (r >= p.r[n - 1]) return signed[n - 1];
		var lo = 0, hi = n - 1;
		while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (p.r[mid] < r) lo = mid; else hi = mid; }
		var t = (r - p.r[lo]) / (p.r[hi] - p.r[lo]);
		return signed[lo] + t * (signed[hi] - signed[lo]);
	}
	return { R: p.r[0], rBalance: p.r[iB], g: g };
}

export function mountMarsElevator(root, opts) {
	var o = opts || {};
	ensureStylesheet("../../Shared/calc-shell.css");
	var shell = new CalcShell(root, { title: "Off-equator Mars Elevator", stageLabel: "Drawing (to come)", overline: o.overline, embedded: !!o.embedded });

	var sys = ME.marsSystem(), de = sys.deimos, ph = sys.phobos;
	var phReach = ME.phobosReach(ph);
	var deimosFloor = de.peri - de.radius;          // a counterweight inside this, Deimos never meets the tether

	// ---------- input cards ----------
	var ancCard = shell.addCard({ id: "anc", tab: "arch", side: "in", title: "Anchor", short: "Anchor", color: C.umber, feeds: ["prop", "frc", "geo", "lean"] });
	var latIn = shell.numberField(ancCard, { label: "Latitude", hint: "north positive", unit: "°", value: DEFAULT.lat, step: "0.01", min: -60, max: 60 });
	var hIn = shell.numberField(ancCard, { label: "Height", hint: "above the areoid", unit: "km", value: DEFAULT.height, step: "0.1", min: -8, max: 30 });
	var lAncR = shell.line(ancCard, { label: "Distance from Mars's centre", unit: "km" });
	shell.note(ancCard, "Default: the Olympus Mons summit. Far enough off the equator, the tether rides above Phobos's orbit all the way out; the summit's height trims the taper only slightly, and its thin air is the main gain.");

	var mat = addMaterialCard(shell, { id: "mat", tab: "arch", feeds: ["prop", "frc", "geo"], value: "ecnt", safety: 2.5 });
	var lTaperS = mat.addTaperLine("Taper ratio (peak / anchor)");
	var lTaperC = mat.addTaperLine("Taper ratio (peak / counterweight)");

	var cw = addCounterweightCard(shell, { id: "cw", tab: "arch", feeds: ["prop", "frc", "geo", "orb", "haz", "swg", "pmp", "lean"],
		position: { label: "Counterweight distance", hint: "from Mars's centre", unit: "km", value: DEFAULT.rCW, min: 1 },
		balance: "areostationary orbit",
		names: { in: "Mars side", out: "Outward" },
		pull: { in: "toward Mars", out: "away from Mars" } });
	cw.posNote.textContent = "Beyond areostationary orbit (" + num(sys.rStat / 1e3, 0) + " km from Mars's centre). Inside " + num(deimosFloor / 1e3, 0) +
		" km Deimos never meets the tether; beyond Deimos's orbit it crosses the tether's line and some passes need a dodge. Station altitudes are above the anchor's distance from Mars's centre.";

	var dodCard = shell.addCard({ id: "dod", tab: "arch", side: "in", title: "Deimos dodge", short: "Dodge", color: C.rust, feeds: ["haz", "swg", "pmp"] });
	var tiltIn = shell.numberField(dodCard, { label: "Deimos's tilt", hint: "to Mars's equator", unit: "°", value: DEFAULT.tilt, step: "0.01", min: 0, max: 10 });
	shell.note(dodCard, "About 0.93° today; it swings between about 0.9° and 2.7° over its orbit's 56-year turn about its Laplace plane, which lies 0.9° off Mars's equator.");
	var bandIn = shell.numberField(dodCard, { label: "Trigger band", hint: "dodge when the predicted miss is under half this", unit: "km", value: DEFAULT.band, min: 1 });
	var dodgeIn = shell.numberField(dodCard, { label: "Dodge swing", hint: "at Deimos's radius", unit: "km", value: DEFAULT.dodge, min: 1 });

	var trfCard = shell.addCard({ id: "trf", tab: "arch", side: "in", title: "Climber traffic", short: "Traffic", color: C.cobalt, feeds: ["pmp", "lean"] });
	var fromIn = shell.numberField(trfCard, { label: "Pumping stretch from", hint: "above the anchor", unit: "km", value: DEFAULT.from, min: 0 });
	var toIn = shell.numberField(trfCard, { label: "Pumping stretch to", hint: "above the anchor", unit: "km", value: DEFAULT.to, min: 1 });
	var cyclesIn = shell.numberField(trfCard, { label: "Build-up", hint: "swing cycles to full size", unit: "cycles", value: DEFAULT.cycles, step: "1", min: 1 });
	var vFullIn = shell.numberField(trfCard, { label: "Climber speed", unit: "m/s", value: DEFAULT.vFull, min: 0.1 });
	var vSlowIn = shell.numberField(trfCard, { label: "Slowed speed", hint: "through the stretch, \"on\" half", unit: "m/s", value: DEFAULT.vSlow, min: 0.01 });
	var mdotIn = shell.numberField(trfCard, { label: "Cargo flow up", hint: "released from the counterweight", unit: "kg/s", value: DEFAULT.mdot, step: "any", min: 0 });
	var lMdotYr = shell.line(trfCard, { label: "Cargo a year", unit: "kt" });

	// ---------- result cards ----------
	var propCard = shell.addCard({ id: "prop", tab: "arch", side: "out", title: "Cable properties", short: "Cable", color: C.core });
	var lCable = shell.line(propCard, { label: "Tether (cable) mass", unit: "kt" });
	var lTotal = shell.line(propCard, { label: "Initial total cable structures mass estimate", unit: "kt" });
	var lLength = shell.line(propCard, { label: "Tether length", unit: "km" });

	var frcCard = shell.addCard({ id: "frc", tab: "arch", side: "out", title: "Forces", short: "Forces", color: C.rust });
	var lTpk = shell.line(frcCard, { label: "Peak tension (near areostationary)", unit: "MN" });
	var lT0 = shell.line(frcCard, { label: "Hold-down tension at the anchor", unit: "MN" });
	var lTcw = shell.line(frcCard, { label: "Tension at the counterweight", unit: "MN" });
	var lAnet = shell.line(frcCard, { label: "Net acceleration at counterweight", unit: "m/s²" });

	var geoCard = shell.addCard({ id: "geo", tab: "arch", side: "out", title: "Path and the moons", short: "Path", color: C.teal });
	var lDep = shell.line(geoCard, { label: "Departure above horizontal", unit: "°" });
	var lZcw = shell.line(geoCard, { label: "Counterweight off the plane", unit: "km" });
	var lZph = shell.line(geoCard, { label: "Height above the plane at Phobos's radius", unit: "km" });
	var lZde = shell.line(geoCard, { label: "Height above the plane at Deimos's radius", unit: "km" });
	shell.note(geoCard, "The tether rises from the anchor, bows toward the equatorial plane, then runs almost straight out, a few hundred km off it. The counterweight's tilt off the plane is what balances a tether anchored off the equator: its net pull, outward and slightly toward the plane, lies along the tether. Phobos reaches " +
		num(phReach / 1e3, 0) + " km from the plane (at apoapsis, plus its radius).");

	var orbCard = shell.addCard({ id: "orb", tab: "arch", side: "out", title: "Orbit after release", short: "Release", color: C.violet });
	var lVrel = shell.line(orbCard, { label: "Eastward speed at release", unit: "m/s" });
	var lVesc = shell.line(orbCard, { label: "Mars escape speed there", unit: "m/s" });
	var lOut = shell.line(orbCard, { label: "Apoapsis", unit: "km" });
	shell.note(orbCard, "A vessel let go at the counterweight keeps its eastward speed, above circular speed there, so release is the periapsis of its orbit about Mars, or it escapes. No burn; the counterweight's small height off the plane is left out.");

	var hazCard = shell.addCard({ id: "haz", tab: "arch", side: "out", title: "Deimos passes", short: "Deimos", color: C.rust });
	var lZ = shell.line(hazCard, { label: "Deimos's reach from the plane", unit: "km" });
	var lPasses = shell.line(hazCard, { label: "Passes across the tether's line", unit: "a year" });
	var lP = shell.line(hazCard, { label: "Chance a pass needs a dodge", unit: "%" });
	var lDodges = shell.line(hazCard, { label: "Dodges a year", unit: "" });
	var lCluster = shell.line(hazCard, { label: "Hazard passes per cluster", unit: "" });
	var lClusters = shell.line(hazCard, { label: "Clusters a year", unit: "" });
	shell.note(hazCard, "Each pass Deimos is a different way along its tilted orbit, so its height at the crossing changes from pass to pass; the chance is the share of its heights within the trigger band around the tether. Every third pass it is back near the same point, a few degrees on, so hazard passes come in clusters a third-pass apart. Crossing times and heights are predictable years ahead.");

	var swgCard = shell.addCard({ id: "swg", tab: "arch", side: "out", title: "North–south swing", short: "Swing", color: C.sky });
	var lModes = [0, 1, 2].map(function (i) {
		return shell.line(swgCard, { label: ["Whole tether, one direction", "Next one up", "Third"][i], unit: "h" });
	});
	shell.note(swgCard, "Periods, then each swing scaled to the dodge size at Deimos's radius: how far it moves the tether at Phobos's radius and at the counterweight, and the energy it holds. The slowest swing tilts the whole tether, nearly as a tilted orbit would, so Mars's spin sets its period rather than the tension; reeling the tether in and out can't pump it. North–south motion feels no Coriolis force, so it stays apart from the east–west sway traffic causes.");

	var pmpCard = shell.addCard({ id: "pmp", tab: "arch", side: "out", title: "Pumping with climber traffic", short: "Pumping", color: C.cobalt });
	var lStretch = shell.line(pmpCard, { label: "Tether length in the stretch", unit: "km" });
	var lFn = shell.line(pmpCard, { label: "Pull across the tether there", unit: "m/s²" });
	var lEta = shell.line(pmpCard, { label: "Slowest swing there, at dodge size", unit: "km" });
	var lWork = shell.line(pmpCard, { label: "Work per cycle per tonne of load change", unit: "MJ" });
	var lDmS = shell.line(pmpCard, { label: "Load change, smoothly varied", unit: "t" });
	var lDmO = shell.line(pmpCard, { label: "Load on the stretch, on/off", unit: "t" });
	var lFlowF = shell.line(pmpCard, { label: "Flow to hold it at full speed", unit: "t/h" });
	var lFlowS = shell.line(pmpCard, { label: "Flow to hold it at the slowed speed", unit: "t/h" });
	var lBackup = shell.line(pmpCard, { label: "Backup: counterweight thrusters, per start or stop", unit: "N·s" });
	shell.note(pmpCard, "Cargo on the slanted stretch pulls partly across the tether. Raising and lowering that load once per swing, in step with it, pumps the swing the way shifting weight pumps a playground swing; the climbers' electric motors supply the energy, with no propellant. Direction doesn't matter, only how much cargo sits on the stretch, so slowing or pausing climbers there in the \"on\" half of each swing does it. Reversed, the same timing damps the swing; anything on a 24–25 h rhythm drives it.");

	var leanCard = shell.addCard({ id: "lean", tab: "arch", side: "out", title: "Westward lean", short: "Lean", color: C.ochre });
	var lLean = shell.line(leanCard, { label: "Lean where the tether leaves the anchor", unit: "°" });
	shell.note(leanCard, "Cargo going up is spun up to the tether's speed, taking that angular momentum from Mars through the anchor, so the tether trails west until the sideways part of the anchor tension supplies it. The lean grows with traffic and is east–west, along the moons' orbits, so it leaves Phobos's clearance and the Deimos dodge unchanged. Keep the flow steady: surges and gaps make the tether sway east–west.");

	function field_(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }
	function setScaled(line, x, units, d, sub) { var s = scaled(x, units, d); line.set(s[0], sub == null ? null : sub, s[1]); return s; }
	function blank(lines) { lines.forEach(function (l) { l.set("—", ""); }); }

	var lastZ = NaN, lastM = NaN;   // warm starts between recalculations

	function solve(a, m, rCW, M, stations, bare) {
		return solveMeridianTether(sys.field, { latA: a.lat, rA: a.r, rCW: rCW, M: M, rho: m.density, sigEff: m.sigmaEff,
			lamMin: bare ? 0 : TRACK_MIN, lamGrav: bare ? 0 : TRACK_GRAV, stations: stations || [], zGuess: lastZ });
	}

	var tetherLines = [lTaperS, lTaperC, lCable, lTotal, lLength, lTpk, lT0, lTcw, lAnet, lDep, lZcw, lZph, lZde];
	var dodgeLines = [lZ, lPasses, lP, lDodges, lCluster, lClusters];
	var pumpLines = [lStretch, lFn, lEta, lWork, lDmS, lDmO, lFlowF, lFlowS, lBackup];

	function calc() {
		var a = ME.anchor(sys, field_(latIn, DEFAULT.lat), field_(hIn, DEFAULT.height) * 1e3);
		lAncR.set(num(a.r / 1e3, 1));
		ancCard.setSummary(num(Math.abs(a.lat / DEG), 2) + "°" + (a.lat >= 0 ? "N" : "S") + " · " + num(field_(hIn, DEFAULT.height), 1) + " km up");
		var m = mat.read(sys.GM / (a.r * a.r));
		var rCW = field_(cw.posIn, DEFAULT.rCW) * 1e3;
		var mdot = field_(mdotIn, DEFAULT.mdot);
		lMdotYr.set(num(mdot * YEAR / 1e6, 1));
		trfCard.setSummary(num(field_(fromIn, DEFAULT.from), 0) + "–" + num(field_(toIn, DEFAULT.to), 0) + " km · " + num(mdot, 1) + " kg/s");
		dodCard.setSummary(num(field_(tiltIn, DEFAULT.tilt), 2) + "° · " + num(field_(dodgeIn, DEFAULT.dodge), 0) + " km swing");

		// Orbit after release depends on the position alone.
		var ro = ME.releaseOrbit(sys, rCW);
		lVrel.set(num(ro.v, 0)); lVesc.set(num(ro.vEsc, 0));
		if (ro.bound) { lOut.set(num(ro.rApo / 1e3, 0), "from Mars's centre; period " + num(ro.period / 3600, 1) + " h", "km"); orbCard.setSummary("apoapsis " + num(ro.rApo / 1e3, 0) + " km"); }
		else { lOut.set(num(ro.vInf, 0), "Escapes Mars: hyperbolic excess speed.", "m/s"); orbCard.setSummary("escapes · " + num(ro.vInf / 1e3, 2) + " km/s"); }

		function fail(text) {
			shell.warn(text); cw.blank(); blank(tetherLines.concat(dodgeLines, pumpLines, lModes, [lLean]));
			[propCard, frcCard, geoCard, hazCard, swgCard, pmpCard, leanCard].forEach(function (c) { c.setSummary("—"); });
		}
		if (!(rCW > sys.rStat)) { fail("The counterweight must sit beyond areostationary orbit, " + num(sys.rStat / 1e3, 0) + " km from Mars's centre, to pull the structure up."); return; }

		// The bare cable's shape doesn't depend on the counterweight: solve it,
		// estimate the counterweight from the track's pull along it, then
		// solve with the track, place the stations, and settle the
		// counterweight; the track's share of the shape depends on the
		// counterweight, so repeat until the mass holds still.
		var sol = solve(a, m, rCW, 1e8, null, true), M;
		if (sol.ok) {
			lastZ = sol.zCW;
			M = Math.max(isFinite(lastM) ? lastM : 0, 3 * Math.abs(trackPull(sol, TRACK_MIN, TRACK_GRAV)) / (sol.gCW * sol.Esurf));
			sol = solve(a, m, rCW, M);
		}
		if (!sol.ok) {
			fail("No tether from this counterweight lands at " + num(Math.abs(a.lat / DEG), 2) + "° " + (a.lat >= 0 ? "N" : "S") + ": it swings past the pole instead. Move the anchor nearer the equator or the counterweight farther out.");
			return;
		}
		lastZ = sol.zCW;
		var stations = cw.resolve({ field: stationField(sol), rCW: rCW });
		function lands(s) { return s.ok && s.departure >= MIN_DEPARTURE; }
		// The least counterweight that still leaves the anchor at MIN_DEPARTURE,
		// from a mass that doesn't: grow until one does, then halve the gap.
		function landingFloor(Mbad) {
			var lo = Mbad, hi = Mbad * 1.5, s = null;
			for (var i = 0; i < 14; i++) { s = solve(a, m, rCW, hi, stations); if (lands(s)) break; lo = hi; hi *= 1.6; }
			if (!s || !lands(s)) return null;
			for (var j = 0; j < 16 && hi - lo > 0.002 * hi; j++) {
				var mid = 0.5 * (lo + hi);
				if (lands(solve(a, m, rCW, mid, stations))) hi = mid; else lo = mid;
			}
			return hi;
		}
		var settled = null, floor = null;
		for (var it = 0; it < 8; it++) {
			if (stations.length || it > 0) sol = solve(a, m, rCW, M, stations);
			if (!lands(sol)) {
				var Mf = landingFloor(M);
				if (Mf == null) { sol = { ok: false }; break; }
				floor = { M: Mf, why: "so the tether leaves the anchor at least " + num(MIN_DEPARTURE / DEG, 0) + "° above horizontal; lighter, the track's weight bends it down toward the ground." };
				sol = solve(a, m, rCW, Mf, stations);
				if (!sol.ok) break;
			}
			lastZ = sol.zCW;
			settled = cw.settle(sol, floor);
			var done = Math.abs(settled.M - sol.M) <= 1e-5 * sol.M;
			M = settled.M;
			if (done) break;
		}
		if (!sol.ok || !settled) { lastM = NaN; fail("No counterweight at this distance makes the tether land at the anchor."); return; }
		if (Math.abs(sol.M - M) > 1e-5 * M) sol = solve(a, m, rCW, M, stations);
		lastM = M; lastZ = sol.zCW;

		// ---------- the tether ----------
		lTaperS.set(ratio(sol.Tpeak / sol.T0));
		lTaperC.set(ratio(sol.Tpeak / sol.Tcw));
		var cab = setScaled(lCable, sol.mass, MASS);
		var tot = scaled(sol.mass + sol.trackMass, MASS);
		lTotal.set(tot[0], "Cable plus its track (" + num(TRACK_MIN + TRACK_GRAV, 1) + " kg/m at the anchor, thinning to " + num(TRACK_MIN, 1) + " kg/m near areostationary); counterweight and stations not included.", tot[1]);
		lLength.set(num(sol.length / 1e3, 0));
		propCard.setSummary("taper " + ratio(sol.Tpeak / sol.T0) + " · " + cab.join(" "));

		var tpk = setScaled(lTpk, sol.Tpeak, FORCE, 2, num(sol.rPeak / 1e3, 0) + " km from Mars's centre");
		setScaled(lT0, sol.T0, FORCE, 2);
		setScaled(lTcw, sol.Tcw, FORCE, 2);
		lAnet.set(num(sol.gCW, 4), "Outward, along the tether (" + (sol.gCW / Const.g0).toExponential(2) + " × Earth g).");
		frcCard.setSummary(tpk.join(" ") + " peak · " + scaled(sol.T0, FORCE, 1).join(" ") + " hold-down");

		// ---------- path and the moons ----------
		var zPh = ME.heightAtRadius(sol, ph.a), below = rCW < deimosFloor;
		var zDe = below ? NaN : rCW < de.a ? sol.zCW : ME.heightAtRadius(sol, de.a);
		var phClear = Math.abs(zPh) - phReach;
		lDep.set(num(sol.departure / DEG, 1));
		lZcw.set(num(Math.abs(sol.zCW) / 1e3, 0), northSouth(sol.zCW) + " of the plane");
		lZph.set(num(Math.abs(zPh) / 1e3, 0), (phClear >= 0 ? num(phClear / 1e3, 0) + " km clear of" : num(-phClear / 1e3, 0) + " km inside") + " Phobos's reach (" + num(phReach / 1e3, 0) + " km)");
		if (below) lZde.set("—", "The tether ends " + num((de.a - rCW) / 1e3, 0) + " km inside Deimos's orbit: Deimos never meets it.");
		else lZde.set(num(Math.abs(zDe) / 1e3, 0), "Deimos crosses the tether's line; some passes need a dodge.");
		geoCard.setSummary("Phobos " + (phClear >= 0 ? "+" : "−") + num(Math.abs(phClear) / 1e3, 0) + " km · " + (below ? "below Deimos" : "dodges Deimos"));
		shell.warn(phClear < 0 ? "The tether passes within Phobos's reach: " + num(Math.abs(zPh) / 1e3, 0) + " km from the plane at Phobos's orbit, " + num(phReach / 1e3, 0) + " km needed. Move the anchor farther from the equator." : "");

		// ---------- Deimos ----------
		var tilt = field_(tiltIn, DEFAULT.tilt) * DEG, band = field_(bandIn, DEFAULT.band) * 1e3, dodge = field_(dodgeIn, DEFAULT.dodge) * 1e3;
		var hz = ME.deimosHazard({ sys: sys, zT: below ? 0 : zDe, tilt: tilt, band: band });
		lZ.set(num(hz.Z / 1e3, 0), "Its radius × sin of its tilt.");
		lPasses.set(num(hz.perYear, 1), "One every " + num(hz.tCross / 3600, 1) + " h, at " + num(hz.vRel, 0) + " m/s; Deimos takes about " + num(hz.crossTime, 0) + " s to cross the line.");
		if (below) {
			blank([lP, lDodges, lCluster, lClusters]);
			lP.set("—", "No dodges: the counterweight sits inside Deimos's orbit.");
			hazCard.setSummary("never meets the tether");
		} else if (!hz.reaches) {
			blank([lP, lDodges, lCluster, lClusters]);
			lP.set("0", "At this tilt Deimos never gets as far from the plane as the tether.");
			hazCard.setSummary("no dodges at this tilt");
		} else {
			lP.set(num(hz.P * 100, 1), "Band " + num(band / 1e3, 0) + " km wide around the tether's height.");
			lDodges.set("~" + num(hz.dodges, 1));
			lCluster.set("~" + num(hz.perCluster, 1), num(hz.spacing / 86400, 1) + " days apart, every third pass (Deimos " + num(Math.abs(hz.drift) / DEG, 1) + "° further on each time).");
			lClusters.set("~" + num(hz.clusters, 1));
			hazCard.setSummary("~" + num(hz.dodges, 1) + " dodges a year");
		}

		// ---------- swing ----------
		var sw = ME.swings(sys, sol, { rRef: below ? NaN : Math.min(de.a, rCW), dodge: dodge });
		sw.modes.forEach(function (md, i) {
			var sub = below ? "Sizes only matter for a dodge; this tether ends below Deimos's orbit."
				: num(md.atPhobos / 1e3, 0) + " km at Phobos's radius · " + num(md.atCW / 1e3, 0) + " km at the counterweight · " + scaled(md.energy, ENERGY, 1).join(" ");
			lModes[i].set(num(md.period / 3600, 2), sub);
		});
		var slow = sw.modes[0];
		swgCard.setSummary(num(slow.period / 3600, 1) + " h" + (below ? "" : " · " + scaled(slow.energy, ENERGY, 1).join(" ")));

		// ---------- pumping ----------
		var from = field_(fromIn, DEFAULT.from) * 1e3, to = field_(toIn, DEFAULT.to) * 1e3;
		var pm = !below && to > from ? ME.pumping({ nodes: sw.nodes, mode: slow, rA: a.r, from: from, to: to,
			cycles: Math.max(1, Math.round(field_(cyclesIn, DEFAULT.cycles))), vFull: field_(vFullIn, DEFAULT.vFull), vSlow: field_(vSlowIn, DEFAULT.vSlow) }) : null;
		if (!pm) {
			blank(pumpLines);
			lStretch.set("—", below ? "No dodges to pump for: the tether ends below Deimos's orbit." : "Set a stretch on the tether, its bottom below its top.");
			pmpCard.setSummary("—");
		} else {
			var cyc = Math.max(1, Math.round(field_(cyclesIn, DEFAULT.cycles)));
			lStretch.set(num(pm.length / 1e3, 0));
			lFn.set(num(pm.fn, 2), "Average over the stretch.");
			lEta.set(num(pm.eta / 1e3, 1), "Average over the stretch.");
			lWork.set(num(pm.perKg * 1e3 / 1e6, 1), "π × pull across × swing there.");
			lDmS.set(num(pm.dmSmooth / 1e3, 0), "To build the swing in " + cyc + " cycle" + (cyc > 1 ? "s" : "") + " (" + num(cyc * slow.period / 86400, 1) + " days).");
			lDmO.set(num(pm.dmOnOff / 1e3, 0), "Cargo present for half of each cycle, absent the other half: π/2 × the smooth figure.");
			lFlowF.set(num(pm.flowFull * 3600 / 1e3, 0), "By bunching departures alone; climbers cross in " + num(pm.tFull / 60, 0) + " min.");
			lFlowS.set(num(pm.flowSlow * 3600 / 1e3, 0), "Climbers take " + num(pm.tSlow / 3600, 1) + " h through the stretch during the \"on\" half; pausing them there needs less.");
			var J = ME.backupImpulse(sw.nodes, slow) * 4 / Math.PI;
			lBackup.set(sci(J, 1), "Thrusting steadily in step with the swing (4/π of the ideal impulse): " + num(J / VE_CHEM / 1e3, 0) + " t of propellant at " + num(VE_CHEM / 1e3, 0) + " km/s exhaust, or " + num(J / VE_ION / 1e3, 0) + " t at " + num(VE_ION / 1e3, 0) + " km/s.");
			pmpCard.setSummary(num(pm.dmOnOff / 1e3, 0) + " t on/off · " + cyc + " cycles");
		}

		// ---------- lean ----------
		var th = ME.westwardLean({ mdot: mdot, omega: sys.omega, rCW: rCW, T0: sol.T0, rA: a.r, lat: a.lat });
		lLean.set(num(th / DEG, 2), "For " + num(mdot, 1) + " kg/s released from the counterweight; it scales directly with the flow, and inversely with the hold-down.");
		leanCard.setSummary(num(th / DEG, 2) + "° at " + num(mdot, 1) + " kg/s");
	}

	shell.onInput(calc);
	if (o.state) shell.setState(o.state);   // runs calc() through onInput
	else calc();

	return { shell: shell, getState: function () { return shell.getState(); } };
}
