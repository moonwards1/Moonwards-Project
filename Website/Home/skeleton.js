// Skeleton cards for the home page's workbench: the first layout of each tab
// (Architecture, Logistics, Engineering, Economy) for installations, or tabs,
// that don't have a calculator of their own yet. ES module:
//   import { addSkeletonCards, mountSkeleton } from "./skeleton.js";
//
// Input cards are wired to result cards (`feeds`, and one recalculation on
// every edit). Results that are plain arithmetic on the inputs and the body's
// data are computed (workbench-math.js); results that need a real model show
// "—" until one is written. The drawing panel is left empty: what it shows on
// each tab is still to be designed.
//
//   addSkeletonCards(shell, ctx, tabs)  adds the cards for `tabs` to an
//       existing CalcShell — used to fill the tabs a calculator has no cards on.
//   mountSkeleton(root, opts)  builds a calculator made only of skeleton
//       cards, for installations with no calculator yet. Same options and
//       return value as a calculator's mount function.
//
// ctx / opts: { body, inst, partners } — the body name, the installation
// { fam, v }, and the other bodies in the design (default trading partners).

import { systems } from "../Shared/orbit.js";
import { CalcShell, ShellColors as C } from "../Shared/calc-shell.js";
import { WM, G0 } from "./workbench-math.js";
import { BODY_FACTS } from "./body-facts.js";
import { BODY_ORDER, instLabel } from "./design-model.js";

var MATERIALS = [
	{ value: "silica", label: "Lunar silica fibre · 13 GPa, 2.3 g/cm³" },
	{ value: "zylon", label: "Zylon PBO · 5.8 GPa, 1.56 g/cm³" },
	{ value: "cnt", label: "Carbon nanotube yarn · 30 GPa, 1.3 g/cm³" },
	{ value: "graphene", label: "Graphene ribbon · 50 GPa, 1.8 g/cm³" }
];
var FUELS = [
	{ value: "360", label: "LOX / methane · 360 s" },
	{ value: "450", label: "LOX / hydrogen · 450 s" },
	{ value: "190", label: "Water, solar-thermal · 190 s" },
	{ value: "900", label: "Hydrogen, nuclear-thermal · 900 s" },
	{ value: "3000", label: "Xenon, ion drive · 3000 s" }
];
var PENDING = "—";

function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : PENDING; }
function val(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }
function days(d) { return !isFinite(d) ? [PENDING, ""] : d >= 400 ? [num(d / 365.256, 2), "yr"] : [num(d, 0), "d"]; }

// Body numbers: GM and radius from Shared/orbit.js; rotation and heliocentric
// orbit from body-facts.js.
function bodyData(name) {
	var s = systems.get(name), f = BODY_FACTS[name];
	return { name: name, GM: s.GM, R: Number(s.radius), rot: f.rotH * 3600, aAU: f.aAU, periodD: f.periodD, system: f.system || name, sys: s };
}

// ---------------------------------------------------------------------------
export function addSkeletonCards(shell, ctx, tabs) {
	var body = bodyData(ctx.body), inst = ctx.inst;
	var partners = (ctx.partners || []).filter(function (n) { return n !== ctx.body; });
	var others = BODY_ORDER.filter(function (n) { return n !== ctx.body; });
	var partnerDefault = partners[0] || others[0];
	var want = {};
	(tabs || []).forEach(function (t) { want[t] = true; });
	var calcs = [];
	var F = {};   // fields and lines, by name

	// ---------- Architecture (only for installations without a calculator) ----------
	if (want.arch) buildArch();

	function buildArch() {
		var fam = inst.fam, v = inst.v;
		if (fam === "skyhook") {
			var geo = shell.addCard({ id: "sk-geo", tab: "arch", side: "in", title: "Tether geometry", short: "Geometry", color: C.core, feeds: ["sk-orb", "sk-teth"] });
			if (v === "phobos") {
				F.low = shell.numberField(geo, { label: "Lower tip altitude", hint: "above Mars", unit: "km", value: 50, min: 0 });
				F.up = shell.numberField(geo, { label: "Upper tip beyond Phobos", unit: "km", value: 6000, min: 0 });
			} else {
				F.cm = shell.numberField(geo, { label: "Centre of mass altitude", hint: "sets the orbit", unit: "km", value: 500, min: 1 });
				F.arm = shell.numberField(geo, { label: "Arm length", hint: "centre to tip", unit: "km", value: 200, min: 1 });
				F.spin = shell.numberField(geo, { label: "Rotation period", unit: "min", value: 40, min: 0.1 });
			}
			materialCard();
			var cap = shell.addCard({ id: "sk-cap", tab: "arch", side: "in", title: "Maximum capacity", short: "Capacity", color: C.ochre, feeds: ["sk-teth"] });
			F.catchT = shell.numberField(cap, { label: "Payload per catch", unit: "t", value: 40, min: 0 });
			F.catches = shell.numberField(cap, { label: "Catches per day", value: 6, min: 0 });

			var orb = shell.addCard({ id: "sk-orb", tab: "arch", side: "out", title: "Orbits & speeds", short: "Speeds", color: C.core });
			if (v === "phobos") {
				var hp = shell.hero(orb, [{ label: "Phobos orbit speed", unit: "km/s" }, { label: "Lower tip speed", unit: "km/s" }]);
				var lLowOrb = shell.line(orb, { label: "Free-orbit speed at the lower tip", unit: "km/s" });
				var lUp = shell.line(orb, { label: "Upper tip speed", unit: "km/s" });
				var lUpEsc = shell.line(orb, { label: "Escape speed at the upper tip", unit: "km/s" });
				calcs.push(function () {
					var a = systems.get("Phobos").orbit.a;
					var w = 2 * Math.PI / WM.orbitalPeriod(body.GM, a);
					var rLow = body.R + val(F.low, 50) * 1e3, rUp = a + val(F.up, 6000) * 1e3;
					hp[0].set(num(w * a / 1e3, 2)); hp[1].set(num(w * rLow / 1e3, 2));
					lLowOrb.set(num(WM.circularSpeed(body.GM, rLow) / 1e3, 2), "The tip moves slower than a free orbit there, so a ship meets it with less speed to match.");
					lUp.set(num(w * rUp / 1e3, 2));
					lUpEsc.set(num(WM.escapeSpeed(body.GM, rUp) / 1e3, 2));
					orb.setSummary("Phobos " + num(w * a / 1e3, 2) + " km/s");
				});
			} else {
				var hr = shell.hero(orb, [{ label: "Orbital period", unit: "h" }, { label: "Tip speed", unit: "km/s" }]);
				var lOrb = shell.line(orb, { label: "Orbital speed of the centre", unit: "km/s" });
				var lLow = shell.line(orb, { label: "Lower tip speed, ground-relative", unit: "km/s", sub: "Orbital speed minus tip speed, before the ground's own rotation." });
				var lAcc = shell.line(orb, { label: "Tip acceleration", unit: "g" });
				calcs.push(function () {
					var r = body.R + val(F.cm, 500) * 1e3, L = val(F.arm, 200) * 1e3, P = val(F.spin, 40) * 60;
					var vt = 2 * Math.PI * L / P, vo = WM.circularSpeed(body.GM, r);
					hr[0].set(num(WM.orbitalPeriod(body.GM, r) / 3600, 2)); hr[1].set(num(vt / 1e3, 2));
					lOrb.set(num(vo / 1e3, 2)); lLow.set(num((vo - vt) / 1e3, 2)); lAcc.set(num(vt * vt / L / G0, 2));
					orb.setSummary("tip " + num(vt / 1e3, 2) + " km/s");
				});
			}
			tetherCard();
		} else if (fam === "elevator") {
			var eg = shell.addCard({ id: "sk-geo", tab: "arch", side: "in", title: "Tether geometry", short: "Geometry", color: C.core, feeds: ["sk-orb", "sk-teth"] });
			if (v === "l1") {
				F.len = shell.numberField(eg, { label: "Length toward Earth", hint: "from the near-side surface", unit: "km", value: 100000, min: 1 });
			} else {
				var stat = (WM.stationaryRadius(body.GM, body.rot) - body.R) / 1e3;
				F.top = shell.numberField(eg, { label: "Top altitude", hint: "beyond stationary orbit", unit: "km", value: Math.round(stat * 1.5 / 10) * 10, min: 1 });
			}
			materialCard();
			var ec = shell.addCard({ id: "sk-cap", tab: "arch", side: "in", title: "Maximum capacity", short: "Capacity", color: C.ochre, feeds: ["sk-teth"] });
			F.climbT = shell.numberField(ec, { label: "Climber payload", unit: "t", value: 20, min: 0 });
			F.climbers = shell.numberField(ec, { label: "Climbers on the cable", value: 8, min: 0 });

			var eo = shell.addCard({ id: "sk-orb", tab: "arch", side: "out", title: v === "l1" ? "Balance & speeds" : "Orbits & speeds", short: "Speeds", color: C.core });
			if (v === "l1") {
				var hl = shell.hero(eo, [{ label: "L1 from the Moon's centre", unit: "km" }, { label: "Far end past L1", unit: "km" }]);
				var lRel = shell.line(eo, { label: "Far-end speed, Moon-relative", unit: "km/s" });
				calcs.push(function () {
					var L1 = body.sys.L1, end = body.R + val(F.len, 100000) * 1e3;
					var w = 2 * Math.PI / Math.abs(body.rot);
					hl[0].set(num(L1 / 1e3, 0)); hl[1].set(num((end - L1) / 1e3, 0));
					lRel.set(num(w * end / 1e3, 3), end > L1 ? "Past L1, Earth's pull holds the far end out." : "The far end hasn't reached L1: the tether can't stay up.");
					eo.setSummary("L1 " + num(L1 / 1e3, 0) + " km");
				});
			} else {
				var he = shell.hero(eo, [{ label: "Stationary altitude", unit: "km" }, { label: "Release speed at top", unit: "km/s" }]);
				var lEsc = shell.line(eo, { label: "Escape speed at the top", unit: "km/s" });
				calcs.push(function () {
					var rs = WM.stationaryRadius(body.GM, body.rot), rt = body.R + val(F.top, 1000) * 1e3;
					var vr = 2 * Math.PI * rt / body.rot, ve = WM.escapeSpeed(body.GM, rt);
					he[0].set(num((rs - body.R) / 1e3, 0)); he[1].set(num(vr / 1e3, 3));
					lEsc.set(num(ve / 1e3, 3), vr >= ve ? "A release from the top escapes " + body.name + "." : "A release from the top stays in orbit around " + body.name + ".");
					eo.setSummary("stationary " + num((rs - body.R) / 1e3, 0) + " km");
				});
			}
			tetherCard();
		} else {
			var spin = inst.v === "spin";
			var tr = shell.addCard({ id: "sk-track", tab: "arch", side: "in", title: spin ? "Arm" : "Track", short: spin ? "Arm" : "Track", color: C.core, feeds: ["sk-launch", "sk-pow"] });
			if (spin) {
				F.armR = shell.numberField(tr, { label: "Arm radius", unit: "m", value: 50, min: 0.1 });
				F.tipV = shell.numberField(tr, { label: "Tip speed", unit: "km/s", value: 2, min: 0 });
			} else {
				F.trackL = shell.numberField(tr, { label: "Track length", unit: "km", value: inst.v === "tip" ? 2 : 20, min: 0 });
				F.accel = shell.numberField(tr, { label: "Acceleration", unit: "g", value: inst.v === "tip" ? 50 : 100, min: 0 });
			}
			var py = shell.addCard({ id: "sk-pay", tab: "arch", side: "in", title: "Payload", short: "Payload", color: C.ochre, feeds: ["sk-pow"] });
			F.shotT = shell.numberField(py, { label: "Mass per launch", unit: "t", value: 5, min: 0 });
			F.shots = shell.numberField(py, { label: "Launches per day", value: 20, min: 0 });

			var la = shell.addCard({ id: "sk-launch", tab: "arch", side: "out", title: "Launch", short: "Launch", color: C.core });
			var hla = shell.hero(la, spin ? [{ label: "Release speed", unit: "km/s" }, { label: "Tip acceleration", unit: "g" }] : [{ label: "Exit speed", unit: "km/s" }, { label: "Time on track", unit: "s" }]);
			var lCirc = shell.line(la, { label: "Low-orbit speed at the surface", unit: "km/s" });
			var lEsc2 = shell.line(la, { label: "Escape speed at the surface", unit: "km/s" });
			if (inst.v === "elevator" || inst.v === "tip") shell.note(la, "Added to the speed of the platform the track rides on.");
			var pw = shell.addCard({ id: "sk-pow", tab: "arch", side: "out", title: "Power", short: "Power", color: C.cobalt });
			var hpw = shell.hero(pw, [{ label: "Energy per launch", unit: "GJ" }, { label: "Average power", unit: "MW" }]);
			var lPeak = spin ? shell.line(pw, { label: "Spin rate", unit: "rpm" }) : shell.line(pw, { label: "Peak power at exit", unit: "GW" });
			calcs.push(function () {
				var m = val(F.shotT, 5) * 1e3, n = val(F.shots, 20), v2, extra;
				if (spin) {
					var r = val(F.armR, 50); v2 = val(F.tipV, 2) * 1e3;
					hla[0].set(num(v2 / 1e3, 2)); hla[1].set(num(v2 * v2 / r / G0, 0));
					extra = v2 / (2 * Math.PI * r) * 60;
					lPeak.set(num(extra, 0));
				} else {
					var a = val(F.accel, 100) * G0, L = val(F.trackL, 20) * 1e3;
					v2 = WM.trackExitSpeed(a, L);
					hla[0].set(num(v2 / 1e3, 2)); hla[1].set(num(a > 0 ? v2 / a : NaN, 1));
					lPeak.set(num(m * a * v2 / 1e9, 2));
				}
				var E = WM.kineticEnergy(m, v2);
				lCirc.set(num(WM.circularSpeed(body.GM, body.R) / 1e3, 2));
				lEsc2.set(num(WM.escapeSpeed(body.GM, body.R) / 1e3, 2));
				hpw[0].set(num(E / 1e9, 2)); hpw[1].set(num(E * n / 86400 / 1e6, 1));
				la.setSummary(num(v2 / 1e3, 2) + " km/s");
				pw.setSummary(num(E / 1e9, 2) + " GJ per launch");
			});
		}
	}

	function materialCard() {
		var mc = shell.addCard({ id: "sk-mat", tab: "arch", side: "in", title: "Material", short: "Material", color: C.core, feeds: ["sk-teth"] });
		F.mat = shell.selectField(mc, { aria: "Tether material", options: MATERIALS, value: "silica" });
		F.sf = shell.numberField(mc, { label: "Safety factor", unit: "×", value: 3, step: "0.1", min: 1 });
		calcs.push(function () { mc.setSummary(F.mat.options[F.mat.selectedIndex].text.split(" · ")[0] + " · SF " + num(val(F.sf, 3), 1)); });
	}
	function tetherCard() {
		var t = shell.addCard({ id: "sk-teth", tab: "arch", side: "out", title: "Tether properties", short: "Tether", color: C.core });
		shell.hero(t, [{ label: "Taper ratio" }, { label: "Tether mass", unit: "t" }]).forEach(function (h) { h.set(PENDING); });
		shell.note(t, "Needs this installation's tether model.");
		t.setSummary("awaiting model");
	}

	// ---------- Logistics ----------
	if (want.log) {
		var ship = shell.addCard({ id: "sk-ship", tab: "log", side: "in", title: "Ship class", short: "Ship", color: C.sky, feeds: ["sk-perf", "sk-win", "sk-ev", "sk-sup"] });
		F.dry = shell.numberField(ship, { label: "Dry mass", unit: "t", value: 40, min: 0.001 });
		F.pay = shell.numberField(ship, { label: "Payload", unit: "t", value: 100, min: 0 });
		F.prop = shell.numberField(ship, { label: "Propellant", unit: "t", value: 150, min: 0 });
		F.fuel = shell.selectField(ship, { label: "Fuel", options: FUELS, value: "360" });
		F.isp = shell.numberField(ship, { label: "Specific impulse", unit: "s", value: 360, min: 1 });
		F.fuel.addEventListener("change", function () { F.isp.value = F.fuel.value; });

		var route = shell.addCard({ id: "sk-route", tab: "log", side: "in", title: "Route", short: "Route", color: C.sky, feeds: ["sk-win", "sk-ev"] });
		F.dest = shell.selectField(route, { label: "Destination", options: others.map(function (n) { return { value: n, label: n }; }), value: partnerDefault });

		var link = shell.addCard({ id: "sk-link", tab: "log", side: "in", title: "Surface ↔ installation", short: "Surface link", color: C.ochre, feeds: ["sk-linkO"] });
		F.trips = shell.numberField(link, { label: "Trips per day", value: 4, min: 0 });
		F.tripT = shell.numberField(link, { label: "Cargo per trip", unit: "t", value: 20, min: 0 });

		var perf = shell.addCard({ id: "sk-perf", tab: "log", side: "out", title: "Ship performance", short: "Ship", color: C.sky });
		var hpf = shell.hero(perf, [{ label: "Δv, loaded", unit: "km/s" }, { label: "Δv, empty", unit: "km/s" }]);
		var lMR = shell.line(perf, { label: "Mass ratio, loaded" });
		var lPF = shell.line(perf, { label: "Payload fraction", unit: "%" });
		shell.note(perf, "Δv = Isp · g₀ · ln(m₀ / m_f): m₀ full, m_f with tanks empty.");

		var win = shell.addCard({ id: "sk-win", tab: "log", side: "out", title: "Launch windows", short: "Windows", color: C.sky });
		var hw = shell.hero(win, [{ label: "Window every" }, { label: "Transfer time" }]);
		var lWin = shell.line(win, { label: "Route" });
		shell.note(win, "Window spacing S = 1 / |1/T₁ − 1/T₂| from the two orbital periods; transfer time t = π √(a³ / μ☉), a minimum-energy ellipse.");

		var linkO = shell.addCard({ id: "sk-linkO", tab: "log", side: "out", title: "Surface link", short: "Surface", color: C.ochre });
		var lDay = shell.line(linkO, { label: "Cargo to the installation", unit: "t/day" });

		calcs.push(function () {
			var dry = val(F.dry, 40), pay = val(F.pay, 100), prop = val(F.prop, 150), isp = val(F.isp, 360);
			var dvL = WM.rocketDv(isp, dry + pay + prop, dry + pay), dvE = WM.rocketDv(isp, dry + prop, dry);
			hpf[0].set(num(dvL / 1e3, 2)); hpf[1].set(num(dvE / 1e3, 2));
			lMR.set(num((dry + pay + prop) / (dry + pay), 2));
			lPF.set(num(100 * pay / (dry + pay + prop), 1));
			ship.setSummary(num(pay, 0) + " t payload · " + num(dvL / 1e3, 2) + " km/s");
			perf.setSummary(num(dvL / 1e3, 2) + " km/s loaded");
			var d = bodyData(F.dest.value), w = windowFor(body, d);
			var S = days(w.synodic), T = days(w.transfer);
			hw[0].set(w.same ? "any time" : S[0] + " " + S[1]); hw[1].set(w.same ? PENDING : T[0] + " " + T[1]);
			lWin.set(body.name + " → " + d.name, w.same ? "Same planetary system: no planetary window applies." : "");
			route.setSummary(body.name + " → " + d.name);
			win.setSummary(w.same ? "any time" : "every " + S[0] + " " + S[1]);
			var perDay = val(F.trips, 4) * val(F.tripT, 20);
			lDay.set(num(perDay, 0));
			link.setSummary(num(perDay, 0) + " t/day");
		});
	}

	// ---------- Engineering ----------
	if (want.eng) {
		var pwr = shell.addCard({ id: "sk-power", tab: "eng", side: "in", title: "Power systems", short: "Power", color: C.cobalt, feeds: ["sk-pb"] });
		F.src = shell.selectField(pwr, { label: "Source", options: [{ value: "solar", label: "Solar arrays" }, { value: "fission", label: "Fission reactors" }, { value: "beamed", label: "Beamed power" }], value: "solar" });
		F.cap = shell.numberField(pwr, { label: "Generating capacity", unit: "MW", value: 200, min: 0 });
		F.store = shell.numberField(pwr, { label: "Storage", unit: "MWh", value: 800, min: 0 });
		var dem = shell.addCard({ id: "sk-demand", tab: "eng", side: "in", title: "Power demand", short: "Demand", color: C.cobalt, feeds: ["sk-pb"] });
		F.avg = shell.numberField(dem, { label: "Average demand", unit: "MW", value: 120, min: 0 });
		F.peak = shell.numberField(dem, { label: "Peak demand", unit: "MW", value: 300, min: 0 });
		var fac = shell.addCard({ id: "sk-fac", tab: "eng", side: "in", title: "Facilities", short: "Facilities", color: C.ochre, feeds: ["sk-facO"] });
		F.docks = shell.numberField(fac, { label: "Docks", value: 4, min: 0 });
		F.fuelStore = shell.numberField(fac, { label: "Fuel storage", unit: "t", value: 5000, min: 0 });
		F.fuelUse = shell.numberField(fac, { label: "Fuel use", unit: "t/day", value: 60, min: 0 });
		var mnt = shell.addCard({ id: "sk-maint", tab: "eng", side: "in", title: "Maintenance systems", short: "Maintenance", color: C.umber });
		F.crawl = shell.numberField(mnt, { label: "Inspection crawlers", value: 6, min: 0 });
		F.repair = shell.numberField(mnt, { label: "Repair interval", unit: "d", value: 90, min: 1 });
		mnt.setSummary("results to come");

		var pb = shell.addCard({ id: "sk-pb", tab: "eng", side: "out", title: "Power budget", short: "Power", color: C.cobalt });
		var hpb = shell.hero(pb, [{ label: "Margin at average", unit: "%" }, { label: "Shortfall at peak", unit: "MW" }]);
		var lCover = shell.line(pb, { label: "Storage covers the peak for", unit: "h" });
		var facO = shell.addCard({ id: "sk-facO", tab: "eng", side: "out", title: "Facilities", short: "Facilities", color: C.ochre });
		var lRes = shell.line(facO, { label: "Fuel reserve", unit: "days" });
		var lDocks = shell.line(facO, { label: "Ships handled per day", sub: "Needs dock turnaround times." });
		lDocks.set(PENDING);

		calcs.push(function () {
			var cap = val(F.cap, 200), avg = val(F.avg, 120), peak = val(F.peak, 300), store = val(F.store, 800);
			var short = Math.max(0, peak - cap);
			hpb[0].set(num(avg > 0 ? 100 * (cap - avg) / avg : NaN, 0)); hpb[1].set(num(short, 0));
			lCover.set(short > 0 ? num(store / short, 1) : "no shortfall", null, short > 0 ? "h" : "");
			pwr.setSummary(num(cap, 0) + " MW · " + F.src.options[F.src.selectedIndex].text);
			dem.setSummary(num(avg, 0) + " MW average");
			pb.setSummary(short > 0 ? num(short, 0) + " MW short at peak" : "covers peak");
			var use = val(F.fuelUse, 60);
			lRes.set(use > 0 ? num(val(F.fuelStore, 5000) / use, 1) : "unlimited", null, use > 0 ? "days" : "");
			fac.setSummary(num(val(F.docks, 4), 0) + " docks");
		});
	}

	// ---------- Economy ----------
	if (want.eco) {
		var vol = shell.addCard({ id: "sk-vol", tab: "eco", side: "in", title: "Annual trade volume", short: "Volume", color: C.teal, feeds: ["sk-ev", "sk-sup"] });
		F.out = shell.numberField(vol, { label: "Outbound", unit: "t/yr", value: 50000, min: 0 });
		F.in = shell.numberField(vol, { label: "Inbound", unit: "t/yr", value: 8000, min: 0 });
		var fleet = shell.addCard({ id: "sk-fleet", tab: "eco", side: "in", title: "Fleet", short: "Fleet", color: C.teal, feeds: ["sk-ev"] });
		if (!F.pay) F.payE = shell.numberField(fleet, { label: "Payload per flight", unit: "t", value: 100, min: 0.001 });
		else shell.note(fleet, "Payload per flight comes from the ship class on the Logistics tab.");
		F.ships = shell.numberField(fleet, { label: "Ships in service", value: 12, min: 0 });
		F.cycles = shell.numberField(fleet, { label: "Round trips per ship per year", value: 1, min: 0.01, step: "0.1" });
		var tt = shell.addCard({ id: "sk-tt", tab: "eco", side: "in", title: "Timetable", short: "Timetable", color: C.teal, feeds: ["sk-ev"] });
		if (!F.dest) F.partner = shell.selectField(tt, { label: "Trading partner", options: others.map(function (n) { return { value: n, label: n }; }), value: partnerDefault });
		else shell.note(tt, "The route is set on the Logistics tab.");

		var ev = shell.addCard({ id: "sk-ev", tab: "eco", side: "out", title: "Launch events", short: "Launches", color: C.teal });
		var hev = shell.hero(ev, [{ label: "Flights per year" }, { label: "Per window" }]);
		var lShips = shell.line(ev, { label: "Ships needed" });
		var lPerWin = shell.line(ev, { label: "Window spacing" });
		var sup = shell.addCard({ id: "sk-sup", tab: "eco", side: "out", title: "Fuel & supplies", short: "Supplies", color: C.ochre });
		var lProp = shell.line(sup, { label: "Propellant per year", unit: "t" });
		var lSpare = shell.line(sup, { label: "Spares & consumables per year", unit: "t" });
		lSpare.set(PENDING);
		shell.note(sup, "How fuel and power needs vary through each window comes with the Logistics models.");

		calcs.push(function () {
			var pay = F.pay ? val(F.pay, 100) : val(F.payE, 100);
			var flights = Math.max(val(F.out, 50000), val(F.in, 8000)) / Math.max(pay, 1e-3);
			var partner = bodyData((F.dest || F.partner).value), w = windowFor(body, partner);
			hev[0].set(num(Math.ceil(flights), 0));
			hev[1].set(w.same ? "continuous" : num(Math.ceil(flights * w.synodic / 365.256), 0));
			var cyc = Math.min(val(F.cycles, 1), w.same ? Infinity : 365.256 / w.synodic);
			lShips.set(num(Math.ceil(flights / Math.max(cyc, 1e-3)), 0), "Round trips per ship are capped at one per window on an interplanetary route.");
			var S = days(w.synodic);
			lPerWin.set(w.same ? "same system" : S[0] + " " + S[1]);
			lProp.set(F.prop ? num(flights * val(F.prop, 150), 0) : PENDING);
			vol.setSummary(num(val(F.out, 50000), 0) + " t/yr out");
			ev.setSummary(num(Math.ceil(flights), 0) + " flights/yr");
			fleet.setSummary(num(val(F.ships, 12), 0) + " ships");
			tt.setSummary(body.name + " ↔ " + partner.name);
		});
	}

	function update() { calcs.forEach(function (fn) { fn(); }); }
	shell.onInput(update);
	update();
	return { update: update };
}

function windowFor(a, b) {
	var same = a.system === b.system || a.system === b.name || b.system === a.name;
	return { same: same, synodic: same ? NaN : WM.synodicDays(a.periodD, b.periodD), transfer: same ? NaN : WM.hohmannDays(a.aAU, b.aAU) };
}

// ---------------------------------------------------------------------------
export function mountSkeleton(root, opts) {
	var o = opts || {};
	var label = instLabel(o.inst);
	var shell = new CalcShell(root, {
		title: label.charAt(0).toUpperCase() + label.slice(1),
		overline: o.overline, embedded: !!o.embedded, stageLabel: "Drawing (to come)"
	});
	addSkeletonCards(shell, o, ["arch", "log", "eng", "eco"]);
	if (o.state) shell.setState(o.state);
	return { shell: shell, getState: function () { return shell.getState(); } };
}
