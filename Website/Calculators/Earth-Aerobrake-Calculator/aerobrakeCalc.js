// Earth Aerobrake Reality-Check Calculator
//
// Inbound Ceres-fleet manoeuvre: a hyperbolic arrival makes one grazing pass
// through Earth's upper atmosphere and exits into a barely-bound orbit with
// apoapsis near the edge of Earth's SOI. Computes the speed shed, the peak
// g-load, and — via the ship's ballistic coefficient — the periapsis depth,
// dynamic pressure, convective heat flux and a first-cut heat-shield mass, so
// the proposed mass budget can be sanity-checked.
//
// Pure maths live in Shared/math-utils.js (OrbitalMath); body data in orbit.js;
// constants in constants.js. This file only reads the form and presents results.
//
// ES module (loaded with <script type="module">).

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";

(function () {
	"use strict";

	var OM = OrbitalMath;
	var earth = systems.get("Earth");
	var GM = earth.GM;                       // m^3/s^2
	var Re = earth.radius;                    // m (mean)
	var Mearth = earth.mass;                  // kg
	var Msun = Const.GM_sun / Const.G;        // kg
	var aEarth = (earth.orbit.apoapsis + earth.orbit.periapsis) / 2; // m
	var rSOI = OM.sphereOfInfluence(aEarth, Mearth, Msun);           // m
	var RHO0 = 1.225;                         // kg/m^3 sea-level reference

	function val(id) { return Number(document.getElementById(id).value); }

	function row(label, value, cls) {
		return "<div class='result-row'>" + label + ": <span" +
			(cls ? " class='" + cls + "'" : "") + ">" + value + "</span></div>";
	}

	function calc() {
		// ---- inputs ----
		var vEntry  = val("vEntry") * 1000;            // m/s
		var hPeri   = val("hPeri") * 1000;             // m
		var apoFrac = val("apoFrac");
		var H       = val("scaleH");                   // m
		var cargo   = val("cargo") * 1000;             // kg
		var struct  = val("structPct") / 100 * cargo;  // kg
		var tpsBudg = val("tpsPct") / 100 * cargo;     // kg
		var fuel    = val("fuel") * 1000;              // kg
		var D       = val("shieldD");                  // m
		var Cd      = val("cd");
		var noseIn  = val("noseR");
		var Rn      = noseIn > 0 ? noseIn : D / 2;      // m
		var Qstar   = val("qStar") * 1e6;              // J/kg

		// ---- orbit / speeds ----
		var rp   = Re + hPeri;                          // m
		var rApo = apoFrac * rSOI;                       // m
		var a    = (rp + rApo) / 2;
		var vExit = OM.visVivaVelocity(GM, rp, a);       // m/s at periapsis, post-brake
		var vEsc  = OM.escapeVelocity(GM, rp);
		var shed  = vEntry - vExit;
		var margin = vEsc - vExit;                       // how far below escape

		// ---- g-load (geometry only) ----
		var aPeak = OM.grazingPeakDecel(GM, rp, vEntry, vExit, H);   // m/s^2
		var gPeak = aPeak / Const.g0;
		var I    = OM.grazingPathScale(GM, rp, vEntry, H);           // m
		var vRep = Math.sqrt(vEntry * vExit);
		var tau  = Math.SQRT2 * I / vRep;                            // s, soak time

		// ---- masses & ballistic coefficient ----
		var entryMass = cargo + struct + tpsBudg + fuel;            // kg
		var area = Math.PI * D * D / 4;
		var beta = OM.ballisticCoefficient(entryMass, Cd, area);    // kg/m^2

		// ---- periapsis conditions to actually shed 'shed' ----
		var rhoP = OM.grazingPeriapsisDensity(GM, rp, vEntry, vExit, H, beta);
		var hAct = OM.altitudeForDensity(RHO0, rhoP, H);            // m
		var qDyn = OM.dynamicPressure(rhoP, vRep);                  // Pa
		var qDynAtm = qDyn / 101325;
		var qConv = OM.suttonGravesHeatFlux(rhoP, vRep, Rn);        // W/m^2
		var qConvCm = qConv / 1e4;                                  // W/cm^2
		var Qint = qConv * tau;                                     // J/m^2
		var QintCm = Qint / 1e4 / 1000;                            // kJ/cm^2

		// ---- first-cut heat-shield mass (convective only) ----
		var arealAbl = Qint / Qstar;                               // kg/m^2 ablated
		var areal = 2.5 * arealAbl;                                // + char/insul/margin
		var tpsNeed = areal * area;                                // kg
		var peakForce = entryMass * aPeak;                         // N

		// ---- classify ----
		var hCls = hAct / 1000 < 35 ? "warn" : (hAct / 1000 < 45 ? "caution" : "ok");
		var qCls = qDynAtm > 3 ? "warn" : (qDynAtm > 1 ? "caution" : "ok");
		var fCls = qConvCm > 300 ? "warn" : (qConvCm > 150 ? "caution" : "ok");
		var tpsCls = tpsNeed > tpsBudg ? "warn" : (tpsNeed > 0.8 * tpsBudg ? "caution" : "ok");

		// ---- render ----
		var html = "";

		html += "<div class='result-block orbit'><h4>Orbit &amp; speed shed</h4>";
		html += row("Earth SOI radius", (rSOI / 1e3).toFixed(0) + " km");
		html += row("Target apoapsis", (rApo / 1e3).toFixed(0) + " km (" + apoFrac.toFixed(2) + "×SOI)");
		html += row("Escape speed at periapsis", (vEsc / 1000).toFixed(3) + " km/s");
		html += row("Post-brake periapsis speed", (vExit / 1000).toFixed(3) + " km/s");
		html += row("Margin below escape", (margin).toFixed(0) + " m/s",
			margin < 60 ? "caution" : "ok");
		html += row("<strong>Speed to shed</strong>", "<strong>" + (shed / 1000).toFixed(3) + " km/s</strong>");
		html += "<div class='note'>" + (shed / vEntry * 100).toFixed(0) +
			"% of the entry speed. The thin margin below escape is why real capture trims at apoapsis.</div>";
		html += "</div>";

		html += "<div class='result-block loads'><h4>Deceleration &amp; loads</h4>";
		html += row("<strong>Peak deceleration</strong>", "<strong>" + gPeak.toFixed(2) + " g</strong> (" + aPeak.toFixed(0) + " m/s²)");
		html += row("High-g soak time (≈)", tau.toFixed(0) + " s");
		html += row("Entry mass", (entryMass / 1e6).toFixed(2) + " kt");
		html += row("Ballistic coefficient β", beta.toFixed(0) + " kg/m²");
		html += row("Peak force on ship", (peakForce / 1e6).toFixed(0) + " MN");
		html += "</div>";

		html += "<div class='result-block loads'><h4>Atmospheric pass</h4>";
		html += row("Required periapsis density", rhoP.toExponential(2) + " kg/m³");
		html += row("Actual braking altitude", (hAct / 1000).toFixed(0) + " km", hCls);
		html += row("Peak dynamic pressure", qDynAtm.toFixed(2) + " atm", qCls);
		html += "<div class='note'>Set by β. Lower the ballistic coefficient (bigger shield) to brake higher and gentler.</div>";
		html += "</div>";

		html += "<div class='result-block shield'><h4>Heating &amp; heat shield</h4>";
		html += row("Peak convective flux (Sutton–Graves)", qConvCm.toFixed(0) + " W/cm²", fCls);
		html += row("Integrated convective load", QintCm.toFixed(0) + " kJ/cm²");
		html += row("PICA areal density (est.)", areal.toFixed(0) + " kg/m²");
		html += row("Heat-shield mass needed (conv. only)", (tpsNeed / 1000).toFixed(0) + " t", tpsCls);
		html += row("Heat-shield mass budget", (tpsBudg / 1000).toFixed(0) + " t");
		html += "<div class='note'>Convective only — radiative heating (significant &gt;11 km/s, grows with nose radius) is NOT included. Lower bound.</div>";
		html += "</div>";

		document.getElementById("out").innerHTML = html;
	}

	document.getElementById("calcBtn").addEventListener("click", calc);
	calc();   // show a result on load
})();
