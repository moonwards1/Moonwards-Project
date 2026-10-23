// Hanging Skyhook Calculator — a vertical (non-rotating) gravity-gradient
// tether: geometry, speeds, taper, masses, climber energy, cargo throughput,
// station-keeping, release points and Earth reentry.
//
// Built on the calculator shell (Shared/calc-shell.js, Shared/zoom-view.js);
// the physics is skyhookModel.js, pure and Node-tested. calc() reads the
// fields, runs the model, writes results and summaries, and redraws.
//
// ES module. mountHangingSkyhook(root, opts) builds one calculator inside
// `root`; each call is independent, so a page can hold several (the home
// page's workbench keeps one per skyhook in the design). The standalone page,
// Hanging-skyhooks.html, mounts one through Hanging-skyhooks.js.
//
//   opts.body      body to open on (a name from Shared/orbit.js; default Moon)
//   opts.lockBody  true: the body selector is locked (the page chooses it)
//   opts.embedded  true: fill `root` rather than the window (CalcShell)
//   opts.overline  the small line above the title
//   opts.state     settings from an earlier getState(), restored on mount
//
// Returns { shell, getState() }. The stylesheets it needs are linked into the
// document if the page hasn't already.

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Exchange } from "../../Shared/exchange.js";
import { PacketTypes } from "../../Shared/exchange-types.js";
import { CalcShell, ShellColors as C } from "../../Shared/calc-shell.js";
import { ZoomView, svgEl } from "../../Shared/zoom-view.js";
import { addMaterialCard } from "../../Shared/material-card.js";
import { computeSkyhook, PROPELLANT_MAX } from "./skyhookModel.js";

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

export function mountHangingSkyhook(root, opts) {
	var o = opts || {};
	ensureStylesheet("../../Shared/calc-shell.css");
	ensureStylesheet("./Hanging-skyhooks.css");

	// Cards and chips carry the workbench tab they belong to (`tab`); on the
	// standalone page every tab's cards show together.
	var shell = new CalcShell(root, { title: "Hanging Skyhook", stageLabel: "Skyhook drawing", overline: o.overline, embedded: !!o.embedded });

	// ---------- modules ----------
	shell.addModule({ id: "st", tab: "eng", side: "in", label: "Stations", color: C.ochre, on: true, tip: "Receiving deck, outer docks and main launch deck" });
	shell.addModule({ id: "pay", tab: "arch", side: "in", label: "Tip load", color: C.rust, on: true, brings: ["frc"], tip: "Tip load mass; brings Forces" });
	shell.addModule({ id: "thr", tab: "eng", side: "in", label: "Cargo throughput", color: C.teal, on: true, needs: ["st"], brings: ["thrO"], tip: "Needs Stations; brings Throughput" });
	shell.addModule({ id: "kp", tab: "eng", side: "in", label: "Station-keeping", color: C.cobalt, needs: ["thr"], brings: ["kpO"], tip: "Needs Cargo throughput; brings its results" });
	shell.addModule({ id: "re", tab: "log", side: "in", label: "Earth reentry", color: C.violet, brings: ["reO"], tip: "Cargo released toward Earth (Moon only)" });

	shell.addModule({ id: "rel", tab: "arch", side: "out", label: "Dropped from foot", color: C.umber, on: true, tip: "Fall from the foot to the surface" });
	shell.addModule({ id: "clm", tab: "eng", side: "out", label: "Climber energy", color: C.core, on: true, tip: "Energy to climb each half of the tether" });
	shell.addModule({ id: "rp", tab: "log", side: "out", label: "Release points", color: C.sky, on: true, tip: "Where a release reaches each neighbouring body" });
	shell.addModule({ id: "frc", tab: "arch", side: "out", label: "Forces", color: C.rust, on: true, needs: ["pay"], tip: "Needs Tip load" });
	shell.addModule({ id: "thrO", tab: "eng", side: "out", label: "Throughput", color: C.teal, on: true, needs: ["thr"], tip: "Needs Cargo throughput" });
	shell.addModule({ id: "kpO", tab: "eng", side: "out", label: "Station-keeping", color: C.cobalt, needs: ["kp"], tip: "Needs Station-keeping inputs" });
	shell.addModule({ id: "reO", tab: "log", side: "out", label: "Earth reentry", color: C.violet, needs: ["re"], tip: "Needs Earth reentry inputs" });
	shell.addModule({ id: "send", tab: "arch", side: "out", label: "Send to calculators", color: C.umber, tip: "Send this tether to the Skyhook Spin-Launcher" });

	// ---------- input cards ----------
	var BODY_NAMES = Array.from(systems.values()).filter(function (s) {
		return s.properties.type !== "mathematical object" && s.radius && s.GM;
	}).map(String).sort();

	var bodyValue = BODY_NAMES.indexOf(o.body) >= 0 ? o.body : "Moon";
	var bodyCard = null, bodyIn, bodyNote;
	if (o.lockBody) {
		// The hosting page chooses the body and shows its facts itself, so there
		// is no card: bodyIn is an off-screen select that just holds the value.
		bodyIn = document.createElement("select");
		BODY_NAMES.forEach(function (n) { var op = document.createElement("option"); op.value = op.textContent = n; bodyIn.appendChild(op); });
		bodyIn.value = bodyValue;
		bodyNote = document.createElement("p");
	} else {
		bodyCard = shell.addCard({ id: "body", tab: "arch", feeds: ["orb", "prop", "rel"], side: "in", title: "Body", short: "Body", color: C.umber, focus: "body" });
		bodyIn = shell.selectField(bodyCard, { aria: "Body the skyhook orbits", value: bodyValue,
			options: BODY_NAMES.map(function (n) { return { value: n, label: n }; }) });
		bodyNote = shell.note(bodyCard, "");
	}

	var geoCard = shell.addCard({ id: "geo", tab: "arch", feeds: ["orb", "prop", "rel", "clm", "frc", "rp"], side: "in", title: "Tether geometry", short: "Geometry", color: C.core, focus: "tether" });
	var topIn = shell.numberField(geoCard, { label: "Top altitude", hint: "station-keeping engines", unit: "km", value: 2000, focus: "top",
		tip: "Site of the orbital station-keeping engines." });
	var centreIn = shell.numberField(geoCard, { label: "Centre of mass altitude", hint: "sets the orbit", unit: "km", value: 275, focus: "centre",
		tip: "The point that determines the orbit." });
	var footIn = shell.numberField(geoCard, { label: "Foot altitude", unit: "km", value: 10, focus: "foot" });
	shell.note(geoCard, "Or drag the markers on the drawing.");

	var matCard = addMaterialCard(shell, { id: "mat", tab: "arch", feeds: ["prop", "frc"], focus: "tether", value: "silica", safety: 3 });

	var stCard = shell.addCard({ id: "st", tab: "eng", feeds: ["thrO", "rp"], side: "in", title: "Stations", short: "Stations", color: C.ochre, module: "st", focus: "stations" });
	var launchIn = shell.numberField(stCard, { label: "Main launch deck", hint: "most ships leave here", unit: "km", value: 950, focus: "stations",
		tip: "Most ships leave from here; released cargo leaves at this deck's speed." });
	var outerIn = shell.numberField(stCard, { label: "Outer docks", hint: "ships from high orbit", unit: "km", value: 606.5, focus: "stations",
		tip: "Where incoming ships from high orbit dock." });
	var recvIn = shell.numberField(stCard, { label: "Receiving deck", hint: "shuttles from the surface", unit: "km", value: 233, focus: "stations",
		tip: "Where shuttles from the surface join the tether." });

	var payCard = shell.addCard({ id: "pay", tab: "arch", feeds: ["frc"], side: "in", title: "Tip load", short: "Load", color: C.rust, module: "pay", focus: "top" });
	var tipIn = shell.numberField(payCard, { label: "Tip load mass", hint: "sizes the absolute tension", unit: "t", value: 100, min: 0, focus: "top",
		tip: "Load held at a tether tip; it sizes the peak tension." });

	var thrCard = shell.addCard({ id: "thr", tab: "eng", feeds: ["thrO", "kpO"], side: "in", title: "Cargo throughput", short: "Cargo", color: C.teal, module: "thr", focus: "stations" });
	var rateIn = shell.numberField(thrCard, { label: "Delivery rate to launch deck", unit: "t/day", value: 1000, min: 0,
		tip: "Descending traffic to the foot is assumed to be 1% of the ascending rate." });
	var perClimberIn = shell.numberField(thrCard, { label: "Cargo per climber", unit: "t", value: 100, min: 0.001 });
	var vClimbIn = shell.numberField(thrCard, { label: "Climb speed", unit: "m/s", value: 200, min: 0.1 });
	var effDriveIn = shell.numberField(thrCard, { label: "Drive efficiency", unit: "%", value: 70, min: 1, max: 100 });

	var kpCard = shell.addCard({ id: "kp", tab: "eng", feeds: ["kpO"], side: "in", title: "Station-keeping", short: "Keeping", color: C.cobalt, module: "kp", focus: "top" });
	var propIn = shell.selectField(kpCard, { label: "Propellant", value: "oxygen",
		options: [{ value: "oxygen", label: "Oxygen" }, { value: "hydrogen", label: "Hydrogen" }],
		tip: "Oxygen: cheap, a plentiful byproduct. Hydrogen: higher exhaust speed." });
	var vExIn = shell.numberField(kpCard, { label: "Exhaust velocity", hint: "VASIMR", unit: "km/s", value: 8, min: 1, max: PROPELLANT_MAX.oxygen,
		tip: "Oxygen is capped at 20 km/s, hydrogen at 80 km/s. Engines are assumed to run continuously; spares cover engine-out and maintenance." });
	var effThrIn = shell.numberField(kpCard, { label: "Thruster efficiency", hint: "electrical → jet", unit: "%", value: 60, min: 1, max: 100,
		tip: "The reboost thruster is mounted at the tether top, the longest available lever arm." });
	var effSupIn = shell.numberField(kpCard, { label: "Power supply efficiency", hint: "generation and delivery", unit: "%", value: 90, min: 1, max: 100 });
	propIn.addEventListener("input", function () {
		var mx = PROPELLANT_MAX[propIn.value];
		vExIn.max = mx;
		if (Number(vExIn.value) > mx) vExIn.value = mx;
	});

	var reCard = shell.addCard({ id: "re", tab: "log", feeds: ["reO"], side: "in", title: "Earth reentry", short: "Reentry", color: C.violet, module: "re", focus: "reentry" });
	var perigeeIn = shell.numberField(reCard, { label: "Target perigee altitude", unit: "km", value: 50, min: -300,
		tip: "Cargo flung from the launch deck is braked retrograde so it falls to the parent body; a burn at the lunar-distance apogee trims perigee to the target." });
	var ifaceIn = shell.numberField(reCard, { label: "Entry interface altitude", unit: "km", value: 122, min: 1 });
	var reNote = shell.note(reCard, "Cargo released from the launch deck.");

	var aboutCard = shell.addCard({ id: "about", tab: "arch", side: "in", title: "About this calculator", short: "About", color: C.umber, focus: "tether", collapsed: true });
	aboutCard.setSummary("gravity-gradient skyhook");
	var about = document.createElement("div");
	about.className = "hs-about";
	about.innerHTML =
		"<p>A gravity-gradient skyhook is a long <b>vertical</b> tether whose <b>centre of mass</b> orbits a body at orbital speed. " +
		"It does not rotate: it stays aligned with the local vertical, held taut by the gravity gradient. The whole structure shares the " +
		"centre of mass's angular velocity, so the <b>top</b> moves faster than a free orbit there and is flung outward, while the " +
		"<b>foot</b> moves slower and is pulled inward. These opposing pulls put the tether in tension, greatest at the centre of mass.</p>" +
		"<p>The centre of mass is the top of the effective-potential hill, like the L1 point of a Moon–L1 elevator: climbing foot → " +
		"centre is uphill, centre → top is downhill (regenerative). The slow, low-sweeping foot suits pick-up; the fast top gives a " +
		"payload a boost on release.</p>";
	aboutCard.body.appendChild(about);

	// ---------- result cards ----------
	var orbCard = shell.addCard({ id: "orb", tab: "arch", side: "out", title: "Orbit & speeds", short: "Speeds", color: C.core, focus: "tether" });
	var hero = shell.hero(orbCard, [{ label: "Period", unit: "h" }, { label: "Top speed", unit: "km/s" }, { label: "Foot speed", unit: "km/s" }]);
	var rVc = shell.line(orbCard, { label: "Speed at centre of mass", unit: "m/s" });
	var rVcTop = shell.line(orbCard, { label: "Circular-orbit speed at top", unit: "m/s" });
	var rVcFoot = shell.line(orbCard, { label: "Circular-orbit speed at foot", unit: "m/s" });

	var relCard = shell.addCard({ id: "rel", tab: "arch", side: "out", title: "Dropped from the foot", short: "Drop", color: C.umber, module: "rel", focus: "foot" });
	var rSurf = shell.line(relCard, { label: "Speed at the surface", unit: "m/s" });
	var rAng = shell.line(relCard, { label: "Impact angle from vertical", unit: "°" });
	var rAround = shell.line(relCard, { label: "Lands downrange", unit: "km" });
	var rPeri = shell.line(relCard, { label: "Lowest point of the fall", unit: "km", sub: "above the surface: it does not land" });

	var propCard = shell.addCard({ id: "prop", tab: "arch", side: "out", title: "Tether properties", short: "Tether", color: C.core, focus: "tether" });
	var rAccF = shell.line(propCard, { label: "Net pull at foot", unit: "m/s²" });
	var rAccT = shell.line(propCard, { label: "Net pull at top", unit: "m/s²" });
	var rTrL = shell.line(propCard, { label: "Taper ratio, foot → centre" });
	var rTrH = shell.line(propCard, { label: "Taper ratio, centre → top" });
	var rMassL = shell.line(propCard, { label: "Lower tether mass", unit: "× load" });
	var rMassH = shell.line(propCard, { label: "Upper tether mass", unit: "× load", sub: "The load is everything the tether holds up that isn't the tether itself." });

	var clmCard = shell.addCard({ id: "clm", tab: "eng", side: "out", title: "Climber energy", short: "Climber", color: C.core, module: "clm", focus: "tether" });
	var rClL = shell.line(clmCard, { label: "Foot → centre (uphill)", unit: "kJ/kg" });
	var rClH = shell.line(clmCard, { label: "Centre → top (downhill)", unit: "MJ/kg", sub: "Regenerative: the climber is pulled outward and can recover energy." });

	var frcCard = shell.addCard({ id: "frc", tab: "arch", side: "out", title: "Forces", short: "Forces", color: C.rust, module: "frc", focus: "top" });
	var rTTop = shell.line(frcCard, { label: "Tension at centre, load at top", unit: "kN" });
	var rTFoot = shell.line(frcCard, { label: "Tension at centre, load at foot", unit: "kN" });
	var rMAbs = shell.line(frcCard, { label: "Tether mass", unit: "t" });

	var thrOCard = shell.addCard({ id: "thrO", tab: "eng", side: "out", title: "Throughput", short: "Throughput", color: C.teal, module: "thrO", focus: "stations" });
	var rTrip = shell.line(thrOCard, { label: "Trip, receiving → launch deck", unit: "h" });
	var rDep = shell.line(thrOCard, { label: "Departures", unit: "/day" });
	var rOn = shell.line(thrOCard, { label: "Climbers on the cable" });
	var rSpace = shell.line(thrOCard, { label: "Mean spacing", unit: "km" });
	var rCargo = shell.line(thrOCard, { label: "Cargo on the cable, up", unit: "t" });
	var rDT = shell.line(thrOCard, { label: "Added tension at centre", unit: "kN" });
	var rPow = shell.line(thrOCard, { label: "Net lift power", unit: "MW" });
	var rEpt = shell.line(thrOCard, { label: "Energy per tonne delivered", unit: "GJ/t" });

	var kpOCard = shell.addCard({ id: "kpO", tab: "eng", side: "out", title: "Station-keeping", short: "Keeping", color: C.cobalt, module: "kpO", focus: "top" });
	var rThrust = shell.line(kpOCard, { label: "Reboost thrust at top", unit: "kN" });
	var rProp = shell.line(kpOCard, { label: "Propellant", unit: "t/day" });
	var rJet = shell.line(kpOCard, { label: "Jet power", unit: "MW" });
	var rElec = shell.line(kpOCard, { label: "Electrical power at thrusters", unit: "MW" });
	var rGen = shell.line(kpOCard, { label: "Generated power required", unit: "MW" });
	var rEday = shell.line(kpOCard, { label: "Energy to hold the orbit", unit: "GWh/day" });
	var rEptK = shell.line(kpOCard, { label: "Energy per tonne delivered", unit: "GJ/t" });

	var reOCard = shell.addCard({ id: "reO", tab: "log", side: "out", title: "Earth reentry", short: "Reentry", color: C.violet, module: "reO", focus: "reentry" });
	var rVinf = shell.line(reOCard, { label: "v∞ leaving the Moon", unit: "m/s" });
	var rNatP = shell.line(reOCard, { label: "Natural perigee", unit: "km" });
	var rBurn = shell.line(reOCard, { label: "Δv at apogee for target perigee", unit: "m/s" });
	var rEntry = shell.line(reOCard, { label: "Entry angle", unit: "°" });
	var rPeakG = shell.line(reOCard, { label: "Peak deceleration", unit: "g", sub: "Ballistic estimate, calibrated to Stardust; lift and guidance reduce it." });
	var reOutNote = shell.note(reOCard, "");

	var rpCard = shell.addCard({ id: "rp", tab: "log", side: "out", title: "Release points", short: "Release", color: C.sky, module: "rp", focus: "release" });
	var rpNote = shell.note(rpCard, "Altitude on the tether where a release leaves with the v∞ for a transfer to each body.");
	var rpLines = [];

	var sendCard = shell.addCard({ id: "send", tab: "arch", side: "out", title: "Send to calculators", short: "Send", color: C.umber, module: "send", focus: "tether" });
	shell.note(sendCard, "Hand this tether to the Skyhook Spin-Launcher Calculator, a variant of this tool.");
	var sendBtn = shell.button(sendCard, { label: "Send tether → Spin-Launcher", primary: true });
	var sendStatus = shell.note(sendCard, "");

	// ---------- formatting ----------
	function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }
	function scaled(x, units) {   // units: [[threshold, divisor, label], …] largest first
		for (var i = 0; i < units.length; i++) if (Math.abs(x) >= units[i][0]) return [num(x / units[i][1], 2), units[i][2]];
		var last = units[units.length - 1];
		return [num(x / last[1], 2), last[2]];
	}
	var FORCE = [[1e9, 1e9, "GN"], [1e6, 1e6, "MN"], [1e3, 1e3, "kN"], [0, 1, "N"]];
	var TORQUE = [[1e12, 1e12, "TN·m"], [1e9, 1e9, "GN·m"], [1e6, 1e6, "MN·m"], [1e3, 1e3, "kN·m"], [0, 1, "N·m"]];
	var POWER = [[1e9, 1e9, "GW"], [1e6, 1e6, "MW"], [1e3, 1e3, "kW"], [0, 1, "W"]];
	var MASS = [[1e6, 1e6, "kt"], [1e3, 1e3, "t"], [0, 1, "kg"]];
	function kmText(a) { return num(a, a < 100 ? 1 : 0) + " km"; }
	function field(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }
	function hours(days) { return days >= 1 ? [num(days, 2), "days"] : [num(days * 24, 2), "h"]; }

	// ---------- calc ----------
	var S = null;   // the last model run, plus what the drawing needs

	function calc() {
		var body = systems.get(bodyIn.value);
		var mat = matCard.read();
		var stOn = shell.isOn("st");
		var t = computeSkyhook(body, {
			foot: field(footIn, 10) * 1e3, centre: field(centreIn, 275) * 1e3, top: field(topIn, 2000) * 1e3,
			receivingDeck: stOn ? field(recvIn, 233) * 1e3 : null,
			outerDocks: stOn ? field(outerIn, 606.5) * 1e3 : null,
			launchDeck: stOn ? field(launchIn, 950) * 1e3 : null,
			strength: mat.specific,
			tipMass: field(tipIn, 100) * 1e3,
			rate: field(rateIn, 1000), perClimber: Math.max(1e-3, field(perClimberIn, 100)),
			vClimb: Math.max(0.1, field(vClimbIn, 200)), effDrive: field(effDriveIn, 70) / 100,
			propellant: propIn.value, vExhaust: field(vExIn, 8),
			effThruster: field(effThrIn, 60) / 100, effSupply: field(effSupIn, 90) / 100,
			targetPerigee: field(perigeeIn, 50), ifaceAlt: field(ifaceIn, 122)
		});
		var R = Number(body.radius);
		S = { t: t, body: body, R: R / 1e3, GM: body.GM, foot: t.foot / 1e3, centre: t.centre / 1e3, top: t.top / 1e3,
			recv: t.receivingDeck / 1e3, outer: t.outerDocks / 1e3, launch: t.launchDeck / 1e3 };

		bodyNote.textContent = "Radius " + num(R / 1e3, 1) + " km · surface gravity " + num(t.surfaceGravity, 2) + " m/s²";
		shell.warn(t.warnings.join(" "));

		// orbit & speeds
		hero[0].set(num(t.time / 3600, 2)); hero[1].set(num(t.topVel / 1e3, 2)); hero[2].set(num(t.footVel / 1e3, 2));
		rVc.set(num(t.centreVel, 1));
		rVcTop.set(num(t.topOrbit, 0), "The top moves " + num(t.topVel / t.topOrbit, 2) + "× faster than a free orbit there, so released payloads are flung outward.");
		rVcFoot.set(num(t.footOrbit, 0));

		// dropped from the foot
		rSurf.show(t.hitsSurface); rAng.show(t.hitsSurface); rAround.show(t.hitsSurface); rPeri.show(!t.hitsSurface);
		rSurf.set(num(t.hitTheGround, 1));
		rAng.set(num(t.impactFromVertical * 180 / Math.PI, 2));
		rAround.set(num(t.impactAround * R / 1e3, 0), num(t.impactAround * 180 / Math.PI, 1) + "° around the body from the foot");
		rPeri.set(num((t.newPeriapsis - R) / 1e3, 0));

		// tether properties
		rAccF.set(num(t.lowAcceleration, 2), num(100 * t.lowAcceleration / t.surfaceGravity, 1) + "% of surface gravity, downward");
		rAccT.set(num(t.highAcceleration, 2), num(100 * t.highAcceleration / t.surfaceGravity, 1) + "% of surface gravity, outward");
		rTrL.set(num(t.lowRatio, 2)); rTrH.set(num(t.highRatio, 2));
		rMassL.set(num(t.lowMass, 2)); rMassH.set(num(t.highMass, 2));

		// climber
		rClL.set(num(t.lowIntegral / 1e3, 1)); rClH.set(num(t.highIntegral / 1e6, 2));

		// forces
		var f;
		f = scaled(t.tensionCoM_top, FORCE); rTTop.set(f[0], null, f[1]);
		f = scaled(t.tensionCoM_foot, FORCE); rTFoot.set(f[0], null, f[1]);
		f = scaled(t.massAbs, MASS); rMAbs.set(f[0], num(t.lowMass + t.highMass, 2) + " × the " + num(t.tipMass / 1e3, 0) + " t tip load", f[1]);

		// throughput
		var th = t.throughput;
		f = hours(th.tripUpDays); var fd = hours(th.tripDownDays);
		rTrip.set(f[0], "descent, outer docks → foot: " + fd[0] + " " + fd[1], f[1]);
		rDep.set(num(th.perDay, 1), "one every " + num(th.intervalH, 2) + " h");
		rOn.set(num(th.onCable, 1));
		rSpace.set(num(th.spacingKm, 0));
		var down = scaled(th.cargoDownT * 1e3, MASS);
		f = scaled(th.cargoUpT * 1e3, MASS); rCargo.set(f[0], "plus " + down[0] + " " + down[1] + " descending", f[1]);
		f = scaled(th.addedTension, FORCE);
		rDT.set(f[0], shell.isOn("pay") ? num(th.addedTensionPct, 2) + "% of the tip-load tension" : "", f[1]);
		f = scaled(th.liftPower, POWER);
		rPow.set(f[0], th.liftPower < 0 ? "Negative: regeneration above the centre of mass exceeds the climb below it." : "Receiving → launch deck, net of regeneration, at drive efficiency.", f[1]);
		rEpt.set(num(th.energyPerT, 2));

		// station-keeping
		var sk = t.keeping, tq = scaled(sk.torque, TORQUE);
		f = scaled(sk.thrust, FORCE); rThrust.set(f[0], "cancels climber drag · torque " + tq[0] + " " + tq[1], f[1]);
		rProp.set(num(sk.propFlow * 86400 / 1e3, 2), (propIn.value === "oxygen" ? "Oxygen" : "Hydrogen") + " · " + num(sk.propFlow, 2) + " kg/s · " + num(sk.propPerCargo, 2) + " t per t of cargo");
		var orbitP = scaled(sk.orbitPower, POWER);
		f = scaled(sk.jetPower, POWER); rJet.set(f[0], "at " + num(sk.vExhaust / 1e3, 0) + " km/s exhaust · useful orbit power " + orbitP[0] + " " + orbitP[1], f[1]);
		f = scaled(sk.elecPower, POWER); rElec.set(f[0], null, f[1]);
		f = scaled(sk.genPower, POWER); rGen.set(f[0], null, f[1]);
		rEday.set(num(sk.genPower * 86400 / 3.6e12, 2), num(sk.genPower * 86400 / 1e9, 0) + " GJ/day");
		rEptK.set(num(sk.energyPerT, 2));

		// reentry
		var re = t.reentry;
		reNote.textContent = re.applies ? "Cargo released from the launch deck." : "Earth reentry applies to a skyhook at the Moon only.";
		var reShow = re.applies && re.escapes;
		[rVinf, rNatP, rBurn].forEach(function (l) { l.show(reShow); });
		rEntry.show(reShow && re.entry); rPeakG.show(reShow && re.entry && re.atmosphere);
		reOutNote.textContent = !re.applies ? "Earth reentry applies to a skyhook at the Moon only."
			: !re.escapes ? "A release from the launch deck does not escape the Moon: no Earth transfer."
			: !re.entry ? "Target perigee above the entry interface: no atmospheric entry." : "";
		reOutNote.hidden = !reOutNote.textContent;
		if (reShow) {
			rVinf.set(num(re.vinf, 0), num(re.arrivalSpeed, 0) + " m/s at lunar distance after braking");
			rNatP.set(num(re.naturalPerigeeAlt / 1e3, 0), re.naturalPerigeeAlt < 0 ? "below the surface: steep, direct entry" : "");
			rBurn.set(num(Math.abs(re.burn), 1), re.burn >= 0 ? "prograde, raising perigee" : "retrograde, lowering perigee");
			if (re.entry) rEntry.set("−" + num(re.entryAngle * 180 / Math.PI, 1), "entry speed " + num(re.entrySpeed / 1e3, 2) + " km/s");
			if (re.entry && re.atmosphere) rPeakG.set("~" + num(re.peakG, 0));
		}

		// release points
		var tg = t.targets.filter(function (x) { return isFinite(x.location); }).sort(function (a, b) { return a.location - b.location; });
		while (rpLines.length < tg.length) rpLines.push(shell.line(rpCard, { label: "", unit: "km" }));
		rpLines.forEach(function (l, i) {
			var x = tg[i];
			l.show(!!x);
			if (!x) return;
			l.el.querySelector(".cs-k").textContent = x.name;
			l.set(num(x.altitude / 1e3, 0), "v∞ " + num(x.vinf, 0) + " m/s" + (x.location > R + t.top ? " · beyond the top" : ""));
		});
		rpNote.hidden = tg.length === 0;
		if (!tg.length) rpNote.textContent = "This body has no neighbours to transfer to.";

		// summaries
		if (bodyCard) bodyCard.setSummary(bodyIn.value);
		geoCard.setSummary(num(S.foot, 0) + " → " + num(S.centre, 0) + " → " + num(S.top, 0) + " km");
		stCard.setSummary(num(S.recv, 0) + " · " + num(S.outer, 1) + " · " + num(S.launch, 0) + " km");
		payCard.setSummary(num(t.tipMass / 1e3, 0) + " t");
		thrCard.setSummary(num(field(rateIn, 0), 0) + " t/day · " + num(field(perClimberIn, 0), 0) + " t");
		kpCard.setSummary((propIn.value === "oxygen" ? "O₂" : "H₂") + " · " + vExIn.value + " km/s");
		reCard.setSummary("perigee " + perigeeIn.value + " km");
		orbCard.setSummary(num(t.time / 3600, 2) + " h · top " + num(t.topVel / 1e3, 2) + " km/s");
		relCard.setSummary(t.hitsSurface ? num(t.hitTheGround, 0) + " m/s at " + num(t.impactFromVertical * 180 / Math.PI, 1) + "°" : "does not land");
		propCard.setSummary("taper " + num(t.lowRatio, 2) + " / " + num(t.highRatio, 2));
		clmCard.setSummary(num(t.lowIntegral / 1e3, 0) + " kJ/kg uphill");
		f = scaled(t.tensionCoM_top, FORCE); frcCard.setSummary(f[0] + " " + f[1] + " at centre");
		thrOCard.setSummary(num(th.perDay, 1) + "/day · " + hours(th.tripUpDays).join(" ") + " trip");
		f = scaled(sk.genPower, POWER); kpOCard.setSummary(f[0] + " " + f[1]);
		reOCard.setSummary(reShow && re.entry && re.atmosphere ? "~" + num(re.peakG, 0) + " g peak" : "—");
		rpCard.setSummary(tg.slice(0, 3).map(function (x) { return x.name + " " + num(x.altitude / 1e3, 0); }).join(" · "));
		sendCard.setSummary("Spin-Launcher");

		var span = (S.R + S.top) * 1.12;
		view.setMinimap([-span, -span, span, span]);
		view.redraw();
	}

	// ---------- exchange ----------
	// Send this design to the Skyhook + Tip Spin-Launcher Calculator as a
	// tether-spec packet (Shared/exchange.js; Website/ARCHITECTURE.md, "Exchange").
	sendBtn.onclick = function () {
		calc();
		var t = S.t;
		var m = matCard.read();
		var mat = { sigma: m.strength, rho: m.density };
		var packet = PacketTypes.make("tether-spec", {
			body: bodyIn.value,
			footAlt: t.foot, centreAlt: t.centre, topAlt: t.top,
			material: mat,
			period: t.time, tipSpeed: t.topVel,
			taperRatio: { upper: t.highRatio, lower: t.lowRatio }
		}, {
			tool: "hanging-skyhooks",
			label: bodyIn.value + " tether",
			iso: new Date().toISOString().slice(0, 10)
		});
		Exchange.send(packet, { target: "skyhook-spin-launcher" });
		sendStatus.textContent = "Sent: open the Skyhook Spin-Launcher calculator to apply it.";
	};

	// ---------- drawing ----------
	// World units are km; the body's centre is the origin and the tether points
	// straight up (−y), with orbital motion to the right (+x).
	var view = new ZoomView(shell.stage, { unit: "km", initial: "tether", hint: "Drag markers · scroll to zoom · drag to pan" });
	view.legend([
		{ swatch: '<path d="M1 5h20" stroke="#FFB199" stroke-width="1.6"/><path d="M25 5l-5-3v6z" fill="#FFB199"/>', label: "tether speed" },
		{ swatch: '<path d="M1 5h24" stroke="#FFB199" stroke-opacity=".35" stroke-width="1.6"/><path d="M13 0v10" stroke="#EADFCF" stroke-width="2"/>', label: "local circular-orbit speed" }
	]);

	var FILL = { Moon: "#4A4038", Mars: "#5E3424", Venus: "#5A4A33", Earth: "#2F3E4A", Mercury: "#4F463E", Europa: "#58524B", Phobos: "#4B4540", Deimos: "#4B4540" };
	var NS = { "vector-effect": "non-scaling-stroke" };
	var HALO = { stroke: "#1D1814", "paint-order": "stroke", "stroke-linejoin": "round" };
	var L = view.layer;
	function g(tag, attrs) { return svgEl(tag, Object.assign({}, attrs, tag === "text" ? HALO : {}), L); }
	function A(base, extra) { return Object.assign({}, base, NS, extra || {}); }

	var gAxis = g("path", A({ stroke: C.sky.draw, "stroke-opacity": 0.35, "stroke-width": 1, "stroke-dasharray": "2 5" }));
	var gCom = g("circle", A({ cx: 0, cy: 0, fill: "none", stroke: "#EADFCF", "stroke-opacity": 0.32, "stroke-width": 1, "stroke-dasharray": "2 5" }));
	var gAtm = g("circle", A({ cx: 0, cy: 0, fill: "#EADFCF", "fill-opacity": 0.05, stroke: "#EADFCF", "stroke-opacity": 0.2, "stroke-width": 1 }));
	var gBody = g("circle", A({ cx: 0, cy: 0, stroke: "#9C8A77", "stroke-width": 1.5 }));
	var gDescent = g("path", A({ fill: "none", stroke: "#EADFCF", "stroke-opacity": 0.7, "stroke-width": 1.3, "stroke-dasharray": "5 4" }));
	var gHit = g("circle", A({ fill: "#1D1814", stroke: "#EADFCF", "stroke-width": 1.5 }));
	var tHit = g("text", { fill: "#EADFCF", "font-family": "Instrument Sans, sans-serif" });
	var gRe = g("path", A({ fill: "none", stroke: C.violet.draw, "stroke-width": 1.6, "stroke-dasharray": "7 5" }));
	var tRe = g("text", { fill: C.violet.draw, "font-family": "Instrument Sans, sans-serif", "font-weight": 600 });
	var gTaper = g("path", { fill: "#EADFCF", "fill-opacity": 0.92 });
	var gStTicks = g("path", A({ stroke: C.ochre.draw, "stroke-width": 2.5 }));
	var tSt = [0, 1, 2].map(function () { return g("text", { fill: C.ochre.draw, "font-family": "Instrument Sans, sans-serif" }); });
	var gClimber = g("rect", { fill: C.teal.draw });
	var gClArrow = g("path", A({ fill: "none", stroke: "#1D1814", "stroke-width": 1.6 }));
	var tClimber = g("text", { fill: C.teal.draw, "font-family": "Instrument Sans, sans-serif" });
	var gPay = g("rect", A({ fill: C.rust.draw, stroke: "#1D1814", "stroke-width": 1 }));
	var tPay = g("text", { fill: C.rust.draw, "font-family": "Instrument Sans, sans-serif" });
	var gNozzle = g("path", { fill: C.cobalt.draw });
	var gPlume = g("path", A({ fill: "none", stroke: C.cobalt.draw, "stroke-width": 1.4, "stroke-dasharray": "3 3" }));
	var tKp = g("text", { fill: C.cobalt.draw, "font-family": "Instrument Sans, sans-serif", "text-anchor": "end" });
	var gArrows = g("path", A({ fill: "none", stroke: "#FFB199", "stroke-width": 1.6 }));
	var gHeads = g("path", { fill: "#FFB199" });
	var gNotches = g("path", A({ stroke: "#EADFCF", "stroke-width": 2 }));
	var tSpeed = [0, 1, 2].map(function () { return g("text", { fill: "#FFB199", "font-family": "JetBrains Mono, monospace" }); });
	var gRpTicks = g("path", A({ stroke: C.sky.draw, "stroke-width": 2 }));
	var tRp = [];
	var tMk = ["TOP", "CENTRE OF MASS", "FOOT"].map(function (name) {
		var t = g("text", { fill: "#EADFCF", "font-family": "Instrument Sans, sans-serif", "text-anchor": "end" });
		svgEl("tspan", { "font-weight": 700, "letter-spacing": "0.06em" }, t).textContent = name;
		t.val = svgEl("tspan", { fill: "#A99A8B", "font-family": "JetBrains Mono, monospace" }, t);
		return t;
	});
	var mTop = g("circle", A({ cx: 0, fill: C.core.draw, stroke: "#1D1814", "stroke-width": 2 }));
	var mCom = g("circle", A({ cx: 0, fill: C.core.draw, stroke: "#1D1814", "stroke-width": 2 }));
	var mFoot = g("circle", A({ cx: 0, fill: C.core.draw, stroke: "#1D1814", "stroke-width": 2 }));
	var miniBody = svgEl("circle", { cx: 0, cy: 0, stroke: "#9C8A77", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }, view.miniLayer);
	var miniTether = svgEl("path", { stroke: "#EADFCF", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }, view.miniLayer);

	function show(el, on) { el.style.display = on ? "" : "none"; }

	function draw(vw) {
		if (!S) return;
		var u = vw.u, t = S.t, R = S.R, fs = 12 * u, fsS = 11 * u;
		var on = function (m) { return shell.isOn(m); };
		var rT = R + S.top, rC = R + S.centre, rF = R + S.foot;

		gBody.setAttribute("r", R); gBody.setAttribute("fill", FILL[bodyIn.value] || "#4A4038");
		var atm = S.body.atmosphere ? Number(S.body.atmosphere.height) / 1e3 : 0;
		gAtm.setAttribute("r", R + atm); show(gAtm, atm > 0);
		gCom.setAttribute("r", rC);
		miniBody.setAttribute("r", R); miniBody.setAttribute("fill", FILL[bodyIn.value] || "#4A4038");
		miniTether.setAttribute("d", "M0 " + (-rF) + "L0 " + (-rT));

		// taper: half-width in px follows the exact constant-stress cross-section
		var right = [], left = [], n = 70, w = t.angularVelocity;
		for (var i = 0; i <= n; i++) {
			var a = S.foot + (S.top - S.foot) * i / n, r = (R + a) * 1e3;
			var I = r < t.centre + Number(S.body.radius)
				? OrbitalMath.taperIntegral(S.GM, w, r, (R + S.centre) * 1e3)
				: OrbitalMath.taperIntegral(S.GM, w, (R + S.centre) * 1e3, r);
			var hw = (1.2 + 4.2 * Math.exp(-I / t.strength)) * u, y = -(R + a);
			right.push(hw + " " + y); left.unshift((-hw) + " " + y);
		}
		gTaper.setAttribute("d", "M" + right.join("L") + "L" + left.join("L") + "Z");

		// markers and their labels (left)
		[[mTop, rT, 7], [mCom, rC, 8.5], [mFoot, rF, 7]].forEach(function (m) { m[0].setAttribute("cy", -m[1]); m[0].setAttribute("r", m[2] * u); });
		[[rT, S.top], [rC, S.centre], [rF, S.foot]].forEach(function (p, i) {
			var tx = tMk[i];
			tx.setAttribute("x", -14 * u); tx.setAttribute("y", -p[0] + 4 * u); tx.setAttribute("font-size", fs); tx.setAttribute("stroke-width", 4 * u);
			tx.val.setAttribute("dx", 6 * u); tx.val.textContent = kmText(p[1]);
		});

		// speed arrows (screen length ∝ speed) with a notch at the local circular-orbit speed
		var k = 0.042, ar = "", hd = "", nt = "";
		[[rT, t.topVel, t.topOrbit], [rC, t.centreVel, t.centreVel], [rF, t.footVel, t.footOrbit]].forEach(function (s, i) {
			var y = -s[0], xa = 12 * u, xb = xa + s[1] * k * u, xn = xa + s[2] * k * u;
			ar += "M" + xa + " " + y + "L" + (xb - 6 * u) + " " + y;
			hd += "M" + xb + " " + y + "L" + (xb - 8 * u) + " " + (y - 4 * u) + "L" + (xb - 8 * u) + " " + (y + 4 * u) + "Z";
			nt += "M" + xn + " " + (y - 6 * u) + "L" + xn + " " + (y + 6 * u);
			var tx = tSpeed[i];
			tx.setAttribute("x", xb + 6 * u); tx.setAttribute("y", y + 4 * u); tx.setAttribute("font-size", fsS); tx.setAttribute("stroke-width", 4 * u);
			tx.textContent = num(s[1] / 1e3, 2) + " km/s";
		});
		gArrows.setAttribute("d", ar); gHeads.setAttribute("d", hd); gNotches.setAttribute("d", nt);

		// dropped from the foot: an ellipse with apoapsis at the foot
		var relOn = on("rel");
		var rp = t.newPeriapsis / 1e3, e = (rF - rp) / (rF + rp), pp = rF * (1 - e);
		var end = t.hitsSurface ? t.impactAround : 2 * Math.PI, dp = "";
		for (var j = 0; j <= 60; j++) {
			var ph = end * j / 60, rr = pp / (1 - e * Math.cos(ph));
			dp += (j ? "L" : "M") + (rr * Math.sin(ph)) + " " + (-rr * Math.cos(ph));
		}
		gDescent.setAttribute("d", dp); show(gDescent, relOn);
		show(gHit, relOn && t.hitsSurface);
		show(tHit, false);
		if (t.hitsSurface) {
			var hx = R * Math.sin(t.impactAround), hy = -R * Math.cos(t.impactAround);
			gHit.setAttribute("cx", hx); gHit.setAttribute("cy", hy); gHit.setAttribute("r", 4 * u);
			// The label sits under the surface, ending at the impact point, and only
			// once the impact is far enough from the foot on screen not to crowd it.
			show(tHit, relOn && Math.hypot(hx, hy + rF) / u > 220);
			tHit.setAttribute("text-anchor", "end");
			tHit.setAttribute("x", hx); tHit.setAttribute("y", hy + 20 * u); tHit.setAttribute("font-size", fsS); tHit.setAttribute("stroke-width", 4 * u);
			tHit.textContent = "impact · " + num(t.hitTheGround, 0) + " m/s · " + num(t.impactFromVertical * 180 / Math.PI, 1) + "° from vertical";
		}

		// stations (right)
		var stOn = on("st"), decks = [[S.launch, "launch deck"], [S.outer, "outer docks"], [S.recv, "receiving deck"]];
		gStTicks.setAttribute("d", decks.map(function (d) { return "M" + (-9 * u) + " " + (-(R + d[0])) + "L" + (9 * u) + " " + (-(R + d[0])); }).join(""));
		show(gStTicks, stOn);
		decks.forEach(function (d, i) {
			var tx = tSt[i];
			tx.setAttribute("x", 14 * u); tx.setAttribute("y", -(R + d[0]) + 4 * u); tx.setAttribute("font-size", fsS); tx.setAttribute("stroke-width", 4 * u);
			tx.textContent = d[1] + " · " + kmText(d[0]); show(tx, stOn);
		});

		// climber (throughput)
		var thrOn = on("thr"), ca = R + S.recv + 0.36 * (S.launch - S.recv);
		gClimber.setAttribute("x", -5 * u); gClimber.setAttribute("y", -ca - 7.5 * u);
		gClimber.setAttribute("width", 10 * u); gClimber.setAttribute("height", 15 * u); gClimber.setAttribute("rx", 2.5 * u);
		gClArrow.setAttribute("d", "M" + (-2.5 * u) + " " + (-ca + 2 * u) + "L0 " + (-ca - 2 * u) + "L" + (2.5 * u) + " " + (-ca + 2 * u));
		tClimber.setAttribute("x", 14 * u); tClimber.setAttribute("y", -ca + 4 * u); tClimber.setAttribute("font-size", fsS); tClimber.setAttribute("stroke-width", 4 * u);
		tClimber.textContent = "climber ↑ " + num(field(vClimbIn, 200), 0) + " m/s · every " + num(t.throughput.spacingKm, 0) + " km";
		[gClimber, gClArrow, tClimber].forEach(function (el) { show(el, thrOn); });

		// tip load and reboost thruster at the top
		var py = -rT - 14 * u;
		gPay.setAttribute("x", -5.5 * u); gPay.setAttribute("y", py - 5.5 * u); gPay.setAttribute("width", 11 * u); gPay.setAttribute("height", 11 * u); gPay.setAttribute("rx", 2 * u);
		tPay.setAttribute("x", 12 * u); tPay.setAttribute("y", py + 4 * u); tPay.setAttribute("font-size", fsS); tPay.setAttribute("stroke-width", 4 * u);
		tPay.textContent = "tip load " + num(t.tipMass / 1e3, 0) + " t";
		[gPay, tPay].forEach(function (el) { show(el, on("pay")); });
		gNozzle.setAttribute("d", "M" + (-6 * u) + " " + (py - 3 * u) + "L" + (-15 * u) + " " + (py - 6 * u) + "L" + (-15 * u) + " " + (py + 6 * u) + "L" + (-6 * u) + " " + (py + 3 * u) + "Z");
		gPlume.setAttribute("d", "M" + (-18 * u) + " " + py + "L" + (-46 * u) + " " + py);
		tKp.setAttribute("x", -50 * u); tKp.setAttribute("y", py + 4 * u); tKp.setAttribute("font-size", fsS); tKp.setAttribute("stroke-width", 4 * u);
		var thr = scaled(t.keeping.thrust, FORCE); tKp.textContent = "reboost " + thr[0] + " " + thr[1];
		[gNozzle, gPlume, tKp].forEach(function (el) { show(el, on("kp")); });

		// release points on the tether axis (left)
		var rpOn = on("rp"), tg = t.targets.filter(function (x) { return isFinite(x.location); });
		var maxR = tg.reduce(function (m, x) { return Math.max(m, x.location / 1e3); }, rT);
		gAxis.setAttribute("d", "M0 " + (-rT) + "L0 " + (-maxR)); show(gAxis, rpOn && maxR > rT);
		gRpTicks.setAttribute("d", tg.map(function (x) { var y = -x.location / 1e3; return "M" + (-7 * u) + " " + y + "L" + (7 * u) + " " + y; }).join(""));
		show(gRpTicks, rpOn);
		while (tRp.length < tg.length) tRp.push(g("text", { fill: C.sky.draw, "font-family": "Instrument Sans, sans-serif", "text-anchor": "end" }));
		tRp.forEach(function (tx, i) {
			var x = tg[i];
			show(tx, rpOn && !!x);
			if (!x) return;
			tx.setAttribute("x", -14 * u); tx.setAttribute("y", -x.location / 1e3 - 6 * u); tx.setAttribute("font-size", fsS); tx.setAttribute("stroke-width", 4 * u);
			tx.textContent = x.name + " ↑ " + kmText(x.altitude / 1e3);
		});

		// reentry: schematic departure toward the parent body
		var reOn = on("re") && t.reentry.applies, ly = -(R + S.launch);
		gRe.setAttribute("d", "M0 " + ly + "C" + (R * 0.7) + " " + ly + " " + (R * 1.5) + " " + (ly - R * 0.25) + " " + (R * 2.6) + " " + (ly - R * 1.0));
		tRe.setAttribute("x", R * 0.55); tRe.setAttribute("y", ly - 10 * u); tRe.setAttribute("font-size", fs); tRe.setAttribute("stroke-width", 4 * u);
		tRe.textContent = "to Earth · v∞ " + num(t.reentry.vinf || NaN, 0) + " m/s";
		show(gRe, reOn && t.reentry.escapes); show(tRe, reOn && t.reentry.escapes);
	}

	// ---------- focus targets: world rects [x0, y0, x1, y1] ----------
	function rectAround(alt, d, x0, x1) { var y = -(S.R + alt); return [x0 * d, y - 0.5 * d, x1 * d, y + 0.5 * d]; }
	var span = function () { return S.top - S.foot; };
	view.addTarget("tether", { label: "Tether", color: C.core.draw, pad: 1.08, rect: function () {
		var s = span(); return [-0.42 * s, -(S.R + S.top) - 0.05 * s, 0.5 * s, -(S.R + S.foot) + 0.05 * s]; } });
	view.addTarget("body", { label: "Whole body", color: "#EADFCF", pad: 1.1, rect: function () {
		var s = S.R + S.top; return [-s, -s, s, S.R]; } });
	view.addTarget("foot", { label: "Foot & impact", color: "#EADFCF", pad: 1.15, rect: function () {
		var dr = S.t.hitsSurface ? S.t.impactAround * S.R : 100, drop = S.R - Math.cos(dr / S.R) * S.R;
		return [-0.35 * Math.max(dr, 60), -(S.R + S.foot) - Math.max(30, S.foot * 2.5), dr * 1.1, -S.R + drop + 8]; } });
	view.addTarget("centre", { label: "Centre of mass", color: C.core.draw, rect: function () { return rectAround(S.centre, Math.max(120, 0.22 * span()), -0.7, 0.9); } });
	view.addTarget("top", { label: "Top", color: C.rust.draw, rect: function () { var d = Math.max(140, 0.22 * span()); var r = rectAround(S.top, d, -0.85, 0.85); r[1] -= 0.1 * d; return r; } });
	view.addTarget("stations", { label: "Stations", color: C.ochre.draw, rect: function () {
		var d = Math.max(80, S.launch - S.recv); return [-0.5 * d, -(S.R + S.launch) - 0.08 * d, 0.65 * d, -(S.R + S.recv) + 0.08 * d]; } });
	view.addTarget("reentry", { label: "Departure to Earth", color: C.violet.draw, pad: 1.04, rect: function () {
		return [-S.R * 1.05, -(S.R + S.top) - S.R * 1.3, S.R * 2.6, S.R]; } });
	view.addTarget("release", { label: "Release points", color: C.sky.draw, pad: 1.08, rect: function () {
		var maxR = S.t.targets.reduce(function (m, x) { return isFinite(x.location) ? Math.max(m, x.location / 1e3) : m; }, S.R + S.top);
		var s = maxR - (S.R + S.foot); return [-0.45 * s, -maxR - 0.03 * s, 0.35 * s, -(S.R + S.foot)]; } });

	// ---------- wiring ----------
	function dragAlt(input, check) {
		return function (p) {
			var a = check(Math.max(0.1, Math.hypot(p.x, p.y) - S.R));
			input.value = a < 100 ? a.toFixed(1) : Math.round(a);
			calc();
			if (shell.focusId !== "geo") shell.focusCard("geo", false);
		};
	}
	view.draggable(mFoot, dragAlt(footIn, function (a) { return Math.min(a, S.centre - 1); }));
	view.draggable(mCom, dragAlt(centreIn, function (a) { return Math.max(S.foot + 1, Math.min(a, S.top - 1)); }));
	view.draggable(mTop, dragAlt(topIn, function (a) { return Math.max(S.centre + 1, a); }));

	shell.onInput(calc);
	shell.onModules(calc);
	shell.onFocus(function (target) { view.focus(target); });
	view.onRender(draw);
	bodyIn.addEventListener("change", function () { calc(); view.focus("tether"); });

	if (o.state) shell.setState(o.state);   // runs calc() through onInput
	else calc();   // show results on load

	return {
		shell: shell,
		getState: function () { return shell.getState(); }
	};
}
