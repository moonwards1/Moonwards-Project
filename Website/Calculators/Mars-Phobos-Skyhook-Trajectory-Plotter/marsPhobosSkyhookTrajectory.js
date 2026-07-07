/* Mars-Phobos Skyhook Trajectory Plotter
 *
 * A navigable, to-scale 3-D view of the Mars-Phobos system (Three.js), lit by
 * the off-screen Sun, with Mars placed from its Keplerian heliocentric
 * elements (Shared/orbit.js). A gravity-gradient skyhook rides on Phobos
 * itself: Phobos IS the tether's centre of mass (not a separate synthetic
 * altitude), so the whole rigid, co-rotating structure -- lower tether end,
 * Phobos, upper tether end -- traces concentric circles around MARS, not
 * around Phobos. This collapses the two-tier hierarchy the sister tool
 * (Moon-Skyhook-Trajectory-Plotter) needs (hook-around-Moon, Moon-around-
 * Earth) into one tier, since Phobos' own orbit around Mars already IS the
 * hook's CoM orbit.
 *
 * Release points are chosen above Phobos (outbound: boosted past local
 * circular speed, can escape Mars' SOI onto a heliocentric transfer) or below
 * Phobos (inbound: the tether's fixed angular rate is sub-circular at any
 * radius under Phobos, so these releases are sub-orbital by construction and
 * dive toward Mars). Where a descending trajectory crosses Mars' ~100 km
 * atmosphere interface, ballistic-entry read-outs (entry speed, flight-path
 * angle, Allen-Eggers peak deceleration, Sutton-Graves peak heat flux) are
 * reported -- no descent/landing-site simulation.
 *
 * Phobos is treated as massless in the trajectory integration (its GM is
 * ~6e-9 of Mars', and its own sphere of influence works out smaller than
 * Phobos itself) -- only Mars and the Sun's gravity act on a released
 * vessel. Phobos' small real eccentricity (~1.5%) and inclination to Mars'
 * equator (~1 deg) are neglected: it is modelled as circular and exactly
 * equatorial, same style of stated simplification the Moon tool uses for the
 * skyhook's own orbital plane.
 *
 * ES module (loaded with <script type="module">); imports `systems`, `Const`
 * and `OrbitalMath` from Shared/. Three.js is the one classic-script
 * exception: Shared/three.min.js is loaded before this module and provides
 * the global `THREE`.
 */
/* global THREE */

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";
import { createCam, updateCamera, bindCameraControls, raycastPickPoint } from "../../Shared/sim/camera-controller.js";
import { createDateBar } from "../../Shared/sim/date-bar.js";
import {
	makePoint as brMakePoint, makeSOIShell as brMakeSOIShell,
	createBody, createSunBody,
	addLabel as brAddLabel, updateLabels as brUpdateLabels, updateScales as brUpdateScales,
	worldSizeAtPointForPx
} from "../../Shared/sim/body-renderer.js";
import { makeArcLine, createKeplerOrbitRing } from "../../Shared/sim/orbit-rings.js";
import {
	makeRingSprite, applyTierToSprite, scaleApproachMark, pickProximityTier
} from "../../Shared/sim/approach-markers.js";
import { createWaypointGizmo, makeBurnArrow as burnWidgetArrow } from "../../Shared/sim/burn-widget.js";
import { renderReadoutBoxes as readoutRender, positionReadoutBoxes as readoutPosition } from "../../Shared/sim/readout-panes.js";
import {
	makeShipSprite, makeXMarkSprite, orientMarkerSprite,
	markerFraction as mcMarkerFraction, sweepAngleFrom, phasingDays as mcPhasingDays,
	refineApproach as mcRefineApproach, followCrossing as mcFollowCrossing,
	buildMarkerCard as mcBuildMarkerCard, updateMarkerModeButtons as mcUpdateMarkerModeButtons,
	fmtKm, fmtTof, fmtDate
} from "../../Shared/sim/marker-card.js";

(function () {
	"use strict";

	var O = OrbitalMath;

	// ---- physical constants (SI) ------------------------------------------
	var MARS   = systems.get("Mars");
	var PHOBOS = systems.get("Phobos");
	var SUN    = systems.get("Sun");
	var GM_MARS = MARS.GM, R_MARS = MARS.radius;
	var GM_S    = SUN.GM;
	var M_MARS  = MARS.mass;
	var M_SUN   = SUN.mass || (SUN.GM / 6.674e-11);
	var R_PHOBOS = PHOBOS.radius;
	var A_PHOBOS = PHOBOS.orbit.semiMajor;                // m, areocentric (mean; treated as circular)
	var A_MARS   = MARS.orbit.semiMajor;                  // m, heliocentric
	// The shared System class (Shared/orbit.js) does not expose an axialTilt
	// getter for any body (confirmed by inspection -- only orbit, atmosphere,
	// geology, GM, mass, radius, diameter, volume, area, density, gravity,
	// period, and a few others are proxied through it), so this is a fallback
	// constant -- the exact pattern the sister tool uses for the Moon's own
	// axial tilt (MOON.axialTiltEcliptic || 1.5424 deg).
	var MARS_AXIAL_TILT = 25.19 * Math.PI / 180;          // rad
	var ATM_HEIGHT = MARS.atmosphere.height;               // m, ~100 km
	var SCALE_H_MARS = Const.scaleHeight.mars;             // m, ~11100
	var AU_M = Const.AU;                                   // m per AU (NOT A_MARS -- Mars' own semi-major axis is ~1.524 AU, not 1)

	// Sphere of influence (m). Phobos' own SOI works out to ~7 km -- smaller
	// than Phobos itself -- so it is not physically meaningful and is not
	// drawn; only Mars' SOI is shown.
	var SOI_MARS = O.sphereOfInfluence(A_MARS, M_MARS, M_SUN);

	// Phobos' orbital angular rate (rad/s) and period (s) -- the skyhook's
	// fixed co-rotation rate (circular approximation).
	var OMEGA_PHOBOS = O.angularVelocity(GM_MARS, A_PHOBOS);
	var PHOBOS_PERIOD = 2 * Math.PI / OMEGA_PHOBOS;         // s, ~27,560 (7.66 h)
	var PHOBOS_PERIOD_DAYS = PHOBOS_PERIOD / 86400;

	// Scene units: 1 unit = 1000 km = 1e6 m.
	var U = 1e6;
	function mToU(m) { return m / U; }
	function kmToU(km) { return km * 1e3 / U; }

	// The real Sun is far beyond the working view; drawn as a bright disk at a
	// capped distance in its true ecliptic direction (context only).
	var SUN_DRAW_DIST = 30000, SUN_DRAW_RADIUS = 900;

	// A generous (non-physical) "go to Phobos" zoom zone for localView.pickPoint
	// (Shared/sim/camera-controller.js) -- Phobos has no real SOI worth using
	// for this (see SOI_MARS note above),
	// but it is tiny (11 km) and would otherwise be nearly unpickable from afar.
	var PHOBOS_ZOOM_ZONE = kmToU(2000);

	// Slider epoch (day 0) and span: 2030-01-01 .. 2042-01-01 (midnight), 12 years.
	var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
	var SPAN_DAYS = O.julianDate(2042, 1, 1, 0, 0, 0) - JD0;
	var DAY = 86400;   // seconds -- used by the heliocentric waypoint-chain (below)

	// ---- application state ------------------------------------------------
	var state = {
		jd: JD0,
		baseDays: 0,                                       // coarse slider (days from JD0)
		botAlt: 150e3,                                     // m, lower tether end altitude above Mars' surface
		topAlt: 25000e3,                                   // m, upper tether end altitude above Mars' surface
		releaseSide: "above",                              // "above" | "below" Phobos
		relAltAbove: 25000e3,                              // m, last release altitude while "above" (remembered per side)
		relAltBelow: 150e3,                                // m, last release altitude while "below"
		relAlt: 25000e3,                                   // m, ACTIVE release altitude (mirrors relAltAbove/Below)
		vehMass: 4000,                                     // kg, entry-vehicle mass (heat-flux estimate only)
		vehDiam: 5,                                        // m, entry-vehicle aeroshell diameter
		focus: null,                                       // "Phobos" | "Mars" | null
		view: "geo",                                       // "geo" (Mars-Phobos) | "helio" (solar-system context)
		// Up to 2, chained onto the post-escape heliocentric coast only (a
		// flyby of Mars isn't a useful place for one) as pure two-body Sun-only
		// Kepler arcs -- see computeHelioChain. Each is
		// {tau (s, elapsed on its leg), burn:{pro,rad,nrm} m/s, snap, snapOffset (rad)}.
		waypoints: [],
		// "Lock Phobos phase" toggle for the year slider -- see
		// phobosSunElongation / solveFineOffsetForElongation.
		lockPhobosPhase: false,                            // year slider: keep Phobos-Sun elongation fixed
		lockedElongation: 0,                               // rad, captured when lockPhobosPhase turns on
		// Destination + marker (solar-system view only) -- see the
		// "Destination + marker" section below. Ported from the sister
		// tool's marker/destination system, keyed off the post-escape
		// heliocentric chain rather than a departure-from-a-body leg.
		destination: "Earth",                              // body to compare against ("(none)" to disable)
		marker: null,                                      // {f0, angle (deg), mode:"free"|"track"|"target"}
		markerFocused: false                               // Helio.cam locked onto the marker
	};

	// ---- DOM refs ---------------------------------------------------------
	var holder       = document.getElementById("mps-canvas-holder");
	var coarseSlider = document.getElementById("mps-date-coarse");
	var lockYearToggle = document.getElementById("mps-lock-year");
	var fineSlider   = document.getElementById("mps-date-fine");
	var fineLo       = document.getElementById("mps-fine-lo");
	var fineHi       = document.getElementById("mps-fine-hi");
	var dateField    = document.getElementById("mps-date-field");
	var jdLabel      = document.getElementById("mps-jd");
	var comAltOut    = document.getElementById("mps-com-alt");
	var topInput     = document.getElementById("mps-top");
	var botInput     = document.getElementById("mps-bot");
	var relInput     = document.getElementById("mps-rel");
	var relSlider    = document.getElementById("mps-rel-slider");
	var sideAbove    = document.getElementById("mps-side-above");
	var sideBelow    = document.getElementById("mps-side-below");
	var vcomOut      = document.getElementById("mps-vcom");
	var omegaTopOut  = document.getElementById("mps-omega-top");
	var cfTopOut     = document.getElementById("mps-cf-top");
	var omegaBotOut  = document.getElementById("mps-omega-bot");
	var cfBotOut     = document.getElementById("mps-cf-bot");
	var periodOut    = document.getElementById("mps-period");
	var vrelOut      = document.getElementById("mps-vrel");
	var vinfMarsOut  = document.getElementById("mps-vinf-mars");
	var outboundBlock = document.getElementById("mps-outbound-block");
	var inboundBlock  = document.getElementById("mps-inbound-block");
	var trajPrimOut  = document.getElementById("mps-traj-primary");
	var trajPeriOut  = document.getElementById("mps-traj-peri");
	var trajApoOut   = document.getElementById("mps-traj-apo");
	var trajInclOut  = document.getElementById("mps-traj-incl");
	var trajInclLabelOut = document.getElementById("mps-traj-incl-label");
	var sunNoteOut   = document.getElementById("mps-sun-note");
	var vinfSunOut   = document.getElementById("mps-vinf-sun");
	var entryClassifyOut = document.getElementById("mps-entry-classify");
	var entrySpeedOut = document.getElementById("mps-entry-speed");
	var entryFpaOut  = document.getElementById("mps-entry-fpa");
	var entryDecelOut = document.getElementById("mps-entry-decel");
	var entryHeatOut = document.getElementById("mps-entry-heat");
	var vehMassInput = document.getElementById("mps-veh-mass");
	var vehDiamInput = document.getElementById("mps-veh-diam");
	var resetBtn     = document.getElementById("mps-reset");
	var soiToggle    = document.getElementById("mps-show-soi");
	var orbitToggle  = document.getElementById("mps-show-orbit");
	var hookToggle   = document.getElementById("mps-show-hook");
	var trajToggle   = document.getElementById("mps-show-traj");
	var burnVecToggle = document.getElementById("mps-show-burnvecs");
	var hudStatus    = document.getElementById("mps-hud-status");
	var mainEl       = document.getElementById("mps-main");
	var panelEl      = document.getElementById("mps-panel");
	var wpEmpty      = document.getElementById("mps-waypoints-empty");
	var wpList       = document.getElementById("mps-waypoint-list");
	var createWp1    = document.getElementById("mps-create-wp1");
	var createWp2    = document.getElementById("mps-create-wp2");
	var destSel      = document.getElementById("mps-destination");
	var destInfo     = document.getElementById("mps-dest-info");
	var approachRow  = document.getElementById("mps-approach-row");
	var approachInfo = document.getElementById("mps-approach-info");
	var approachJump = document.getElementById("mps-approach-jump");
	var panelGeo     = document.getElementById("mps-panel-geo");
	var panelHelio   = document.getElementById("mps-panel-helio");
	var readoutLayer = null;      // overlay holding the straddling burn readouts
	var readoutBoxes = [];        // { el, host } currently shown

	function setHud(t) { if (hudStatus) { hudStatus.textContent = t; } }
	function fmt(x, d) { return (x).toFixed(d == null ? 0 : d); }

	// =======================================================================
	//  Phobos / hook geometry helpers
	// =======================================================================
	// In-plane orthonormal basis of Mars' equatorial plane (ascending node
	// taken at ecliptic longitude 0; tilt = Mars' axial tilt). Phobos is
	// approximated as orbiting exactly within this plane (see file header).
	function hookBasis() {
		var th = MARS_AXIAL_TILT;
		var e1 = new THREE.Vector3(1, 0, 0);
		var e2 = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
		return { e1: e1, e2: e2 };
	}
	// Unit normal of Mars' equatorial plane, as a plain [x,y,z].
	function hookPlaneNormal() {
		var b = hookBasis();
		var n = new THREE.Vector3().crossVectors(b.e1, b.e2).normalize();
		return [n.x, n.y, n.z];
	}
	// Phobos' phase angle (rad) at Julian date jd: swept at the fixed circular
	// rate OMEGA_PHOBOS since JD0 (phase 0 at JD0 -- Jan 1 2030 midnight,
	// mirroring the sister tool's "skyhook starts at 0 deg" convention).
	function phobosPhase(jd) { return OMEGA_PHOBOS * 86400 * (jd - JD0); }
	// Unit radial direction and prograde tangent at phase phi, in scene axes.
	function hookDir(phi) {
		var b = hookBasis();
		return b.e1.clone().multiplyScalar(Math.cos(phi)).add(b.e2.clone().multiplyScalar(Math.sin(phi)));
	}
	function hookPro(phi) {
		var b = hookBasis();
		return b.e1.clone().multiplyScalar(-Math.sin(phi)).add(b.e2.clone().multiplyScalar(Math.cos(phi)));
	}

	// Inclination of a Mars-centred state's orbital plane against Mars'
	// equatorial plane (hookBasis) rather than the ecliptic -- the
	// unperturbed release orbit lies exactly in that plane by construction
	// (zero, always), so this only becomes non-trivial once a waypoint burn's
	// normal component tips a still-Mars-bound orbit out of it. Mirrors the
	// sister tool's lunarInclination, renamed for the flatter hierarchy here.
	function equatorialInclination(rMars, vMars) {
		var h = O.vCross(rMars, vMars), hMag = O.vMag(h);
		if (hMag < 1e-6) { return 0; }
		var n = hookPlaneNormal();
		return Math.acos(Math.max(-1, Math.min(1, O.vDot(h, n) / hMag)));
	}

	// Mars' heliocentric state (m, m/s) at Julian date jde, from its Keplerian
	// elements (Shared/orbit.js) -- both position and velocity directly, no
	// finite-difference needed (unlike the sister tool's earthHelio, which
	// had to difference a Meeus geocentric-Sun vector).
	function marsHelioState(jde) { return O.bodyStateAtJD(GM_S, MARS.orbit, jde); }
	// Sun's position (m) relative to Mars at Julian date jde.
	function sunRelPos(jde) { var s = marsHelioState(jde); return [-s.r[0], -s.r[1], -s.r[2]]; }

	// =======================================================================
	//  "Lock Phobos phase" toggle (year slider)
	// =======================================================================
	// Wrap an angle (rad) into (-pi, pi].
	function wrapPi(a) {
		a = a % (2 * Math.PI);
		if (a <= -Math.PI) { a += 2 * Math.PI; }
		if (a > Math.PI) { a -= 2 * Math.PI; }
		return a;
	}

	// Angle (rad) of the Sun's direction from Mars, projected into the
	// skyhook/Phobos orbital plane (hookBasis) -- directly comparable to
	// phobosPhase(jd) (see hookDir), unlike the sister tool's moonSunElongation
	// this can't just compare ecliptic longitudes and ignore the out-of-plane
	// component, since Phobos' plane (Mars' equator) is tilted a full ~25 deg
	// from the ecliptic, far more than the Moon's ~5 deg inclination.
	function sunPhaseInHookPlane(jd) {
		var s = sunRelPos(jd);
		var b = hookBasis();
		return Math.atan2(s[0]*b.e2.x + s[1]*b.e2.y + s[2]*b.e2.z,
		                   s[0]*b.e1.x + s[1]*b.e1.y + s[2]*b.e1.z);
	}

	// Phobos' phase relative to the Sun, both measured in the hook plane: 0 =
	// Phobos sits between Mars and the Sun ("Phobos noon"), +-180 deg =
	// Phobos on Mars' far side from the Sun ("Phobos at Mars midnight") --
	// exactly analogous to the sister tool's Moon-Sun elongation ("moon
	// phase"), and what the year-slider "lock Phobos phase" toggle preserves.
	function phobosSunElongation(jd) {
		return wrapPi(phobosPhase(jd) - sunPhaseInHookPlane(jd));
	}

	// Phobos' angular rate relative to the Sun's (slowly drifting) direction
	// in the hook plane, rad/day. Unlike the sister tool -- where the Moon's
	// real orbital rate only approximately equals the mean synodic rate used
	// to solve for a locked phase -- Phobos' rate here is EXACTLY OMEGA_PHOBOS
	// by construction (circular-orbit model), and Mars' own heliocentric
	// motion (the other half of a true synodic rate) is a ~0.05% correction
	// to it, so using OMEGA_PHOBOS directly converges the solve below to
	// essentially machine precision.
	var PHOBOS_RATE_PER_DAY = OMEGA_PHOBOS * 86400;

	// Fine-slider offset (days, from baseDaysJD) nearest to 0 at which
	// phobosSunElongation equals targetElong. The sister tool's equivalent
	// year-slider lock nudges the WHOLE-DAY count (fine since the Moon barely
	// moves in a day); that trick would be useless here, since Phobos completes
	// over 3 orbits per Mars-calendar day, so a whole-day nudge would land on
	// an essentially arbitrary phase. Instead this solves within the fine
	// slider's own range, which by design spans exactly one full Phobos orbit
	// (see PHOBOS_PERIOD_DAYS / the mps-date-fine slider's min/max), so a
	// solution within it always exists by continuity. A few Newton steps at
	// the (essentially exact) rate above converge in a couple of iterations.
	function solveFineOffsetForElongation(baseDaysJD, targetElong) {
		var offset = 0;
		for (var k = 0; k < 8; k++) {
			var err = wrapPi(phobosSunElongation(baseDaysJD + offset) - targetElong);
			offset -= err / PHOBOS_RATE_PER_DAY;
		}
		return offset;
	}

	// =======================================================================
	//  THREE.js scene
	// =======================================================================
	var scene, camera, renderer;
	var marsMesh, marsPoint, marsSOI, sunMesh, marsOrbitLine;
	var phobosPosGroup, phobosSpinGroup, phobosMesh, phobosPoint;
	var phobosOrbitGroup = null;     // Phobos' (= the hook's CoM) orbit ring
	var hookGroup = null;            // skyhook geometry (rebuilt on change)
	var releaseMesh = null;          // draggable release-point triangle (in-plane)
	var trajectoryGroup = null;      // released-ship trajectory (child of scene)
	var sunLight;
	var labelList = [], labelLayer = null;
	var lastWpCount = -1;            // rebuild the waypoint list DOM only when the count changes
	var lastTrajRes = null;          // most recent computeTrajectory() result (for the helio overlay)
	var viewEl = null;               // the #mps-view pane (host for the floating marker card)

	// ---- Destination + marker (solar-system view only) --------------------
	// Ported from Solar-System-Trajectory-Plotter's marker/destination system
	// (GM_SUN -> GM_S). Keyed off the post-escape heliocentric CHAIN, not a
	// departure-from-a-body leg -- see computeHelioChain's header -- so the
	// "departure" reference throughout is the Mars-escape point
	// (chainJdeEscape / chainSegs[0]), not state.jd. Cached each buildTrajectory()
	// via syncChainGlobals(); empty when the trajectory hasn't escaped Mars yet.
	var chainSegs = [];              // {r0,v0,dur,tStart} per Kepler arc (m, m/s, s)
	var chainSamplesAU = [];         // {pos: THREE.Vector3 (AU), t: s} -- for picking
	var chainTotalT = 0;             // total chain duration (s)
	var chainJdeEscape = 0;          // Julian date the chain starts at (Mars-escape)
	var lastApproachT = null;        // chain-time (s) of the current destination's closest approach,
	                                  // set each buildTrajectory() -- what "Jump to closest point" uses

	var markerSprite = null;         // the ship chevron (THREE.Sprite, Helio.scene only)
	var markerCard = null;           // its floating readout card (HTML, appended to #mps-view)
	var destSprite = null;           // 'x' at the destination body's position at arrival
	var tempRing = null;             // temporal-proximity ring around the ship marker
	var markerSlider = null, markerValRad = null, markerValRadKm = null,
	    markerValSpd = null, markerValLat = null, markerValDeg = null,
	    markerValTof = null, markerValArr = null, markerValPhase = null;
	var markerModeBtns = {};         // "free"/"track"/"target" -> button el
	var markerBudgetInput = null, markerBudgetRow = null;   // Δv budget control (Target mode)
	var markerTdvRow = null, markerValTdv = null;           // target Δv readout row
	var markerVelDir = null;         // THREE.Vector3, marker's world velocity dir (ship heading)

	// Spatial gate (m): the ship marker must be at least this close to the
	// destination's orbit RING before a temporal-phasing readout is shown at
	// all (mirrors the sister tool's APPROACH_FAR, reused here for the same
	// purpose plus Track mode's freeze/re-engage threshold).
	var APPROACH_FAR = 0.004 * AU_M;
	// Temporal-proximity tiers: how close (in days) the destination body is to
	// the meeting point at the ship's arrival time. Distinct blue, brighter
	// when closer.
	var TEMP_FAR = 30, TEMP_NEAR = 10, TEMP_CLOSE = 3;     // days
	var TEMPORAL_TIERS = [
		{ color: 0x3a6fd0, opacity: 0.50, px: 30 },   // 0: <30 d -- faint blue
		{ color: 0x5aa9ff, opacity: 0.80, px: 34 },   // 1: <10 d -- brighter
		{ color: 0x9fe0ff, opacity: 1.00, px: 40 }    // 2: <3 d  -- bright cyan, largest
	];

	// Waypoint burns live entirely in the solar-system (heliocentric) view --
	// see computeTrajectory's file header -- so their gizmos/arrows are drawn
	// there (Helio.wpGizmos / Helio.updateTrajectory), not in this GEO scene.
	var DV_COLOR = 0xff5fd0;      // delta-v (the burn itself)
	var DSPEED_COLOR = 0xffd24a;  // change in prograde (orbital) speed vs pre-burn
	var dvHex = "#ff5fd0";        // CSS form of DV_COLOR (pink) for the readouts
	var spdHex = "#ffd24a";       // CSS form of DSPEED_COLOR (amber) for the readouts

	// camera spherical state around `target` (scene units; Shared/sim/camera-controller.js)
	var cam = createCam(35, 0.7, 1.05, new THREE.Vector3(0, 0, 0));

	function initScene() {
		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(45, 1, 0.001, 80000);
		renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
		renderer.setPixelRatio(window.devicePixelRatio || 1);
		holder.appendChild(renderer.domElement);

		labelLayer = document.createElement("div");
		labelLayer.id = "mps-labels";
		holder.appendChild(labelLayer);

		scene.add(new THREE.AmbientLight(0x556070, 0.35));
		sunLight = new THREE.DirectionalLight(0xfff4e6, 1.5);
		scene.add(sunLight);
		scene.add(sunLight.target);

		scene.add(makeStars());

		// ---- Sun (far, drawn at a capped distance in its true direction) ----
		sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_DRAW_RADIUS, 24, 16),
			new THREE.MeshBasicMaterial({ color: 0xffe066 }));
		scene.add(sunMesh);

		// ---- Mars' heliocentric orbit: a dim ring through Mars, centred on the
		// Sun, drawn at the Sun's capped distance -- shows the ecliptic and (via
		// its tangent at Mars) the prograde direction. Rebuilt each frame in
		// placeBodies() (see updateMarsOrbitLine) in Mars' true osculating
		// orbital plane, so it always passes through Mars regardless of date;
		// geometry is a placeholder here, filled in before first render. ----
		marsOrbitLine = new THREE.Line(new THREE.BufferGeometry(),
			new THREE.LineBasicMaterial({ color: 0xb4573f, transparent: true, opacity: 0.35 }));
		scene.add(marsOrbitLine);

		// Hard two-tone (toon) shading: a 2-texel ramp sampled with nearest
		// filtering snaps between lit and dark, giving a sharp day/night line.
		var toonGrad = new THREE.DataTexture(new Uint8Array([120, 255]), 2, 1, THREE.LuminanceFormat);
		toonGrad.minFilter = toonGrad.magFilter = THREE.NearestFilter;
		toonGrad.needsUpdate = true;

		// ---- Mars (origin) ----
		var marsGeo = new THREE.SphereGeometry(mToU(R_MARS), 48, 32);
		var marsMat = new THREE.MeshToonMaterial({ color: 0xe15a32, gradientMap: toonGrad });
		marsMesh = new THREE.Mesh(marsGeo, marsMat);
		scene.add(marsMesh);
		marsPoint = makePoint(0xffb08f, 4);
		scene.add(marsPoint);
		loadTexture("Mars-Wrap.jpg", marsMat);

		marsSOI = makeSOIShell(mToU(SOI_MARS), 0xff8a4a, 0.045);
		scene.add(marsSOI);

		// ---- Phobos (positioned each frame) ----
		phobosPosGroup = new THREE.Group();          // at Phobos position, axis-aligned (ecliptic)
		scene.add(phobosPosGroup);
		phobosSpinGroup = new THREE.Group();          // carries the tidal-locked Phobos mesh
		phobosPosGroup.add(phobosSpinGroup);

		var phobosGeo = new THREE.SphereGeometry(mToU(R_PHOBOS), 32, 24);
		var phobosMat = new THREE.MeshToonMaterial({ color: 0x6b5f52, gradientMap: toonGrad });
		phobosMesh = new THREE.Mesh(phobosGeo, phobosMat);
		phobosSpinGroup.add(phobosMesh);
		loadTexture("Phobos-Wrap.jpg", phobosMat);

		phobosPoint = makePoint(0xd8cdbe, 3.5);
		phobosPosGroup.add(phobosPoint);
		// No Phobos SOI shell -- see file header (smaller than Phobos itself).

		resize();
		window.addEventListener("resize", resize);
		bindCameraControls(renderer.domElement, getCameraView);
		animate();
	}

	// ---- camera controls (Shared/sim/camera-controller.js) -----------------
	// Two views share one binding: bindCameraControls() calls getCameraView()
	// fresh on every DOM event, so it always drives whichever camera (local
	// Mars-Phobos `cam`, or `Helio.cam`) matches the current state.view —
	// binding twice would double-register listeners on the same canvas and
	// move both cameras from one drag.
	var localView = {
		cam: null, camera: null,
		zoomMin: 0.0001, zoomMax: 40000,
		shiftZoom: true,                 // Shift held while scrolling: ~5x finer zoom
		panSpeed: 0.0016,
		pickPoint: function (e) {
			var phobosWorld = phobosPosGroup.getWorldPosition(new THREE.Vector3());
			return raycastPickPoint(camera, renderer.domElement, e, {
				meshes: [phobosMesh, marsMesh],
				soiSpheres: [{ center: phobosWorld, radius: PHOBOS_ZOOM_ZONE, nearFaceRadius: mToU(R_PHOBOS) }]
			});
		},
		isLocked: function () { return !!state.focus; },      // zoom in place while a body is focused
		onPan: function () { state.focus = null; },           // free navigation releases a body lock
		onDoubleClick: function (e) { focusNearest(e); },
		captureDrag: function (e) {
			if (e.button === 0 && releaseMesh && releaseMesh.visible && hookToggle.checked && hitRelease(e)) {
				return "release";
			}
			return false;
		},
		onCapturedMove: function (e) { dragRelease(e); }
	};
	var helioView = {
		cam: null, camera: null,
		zoomMin: 1e-4, zoomMax: 500,
		shiftZoom: true,
		lockedZoomTarget: function () {
			return (state.markerFocused && markerSprite && markerSprite.visible) ? markerSprite.position : null;
		},
		onPan: function () { state.markerFocused = false; },   // free navigation releases the marker lock
		onPick: function (e) { handleHelioPick(e); },
		onDoubleClick: function (e) { Helio.focusNearest(e); }
	};
	function getCameraView() {
		if (state.view === "helio") {
			helioView.cam = Helio.cam;
			helioView.camera = Helio.camera;
			return helioView;
		}
		localView.cam = cam;
		localView.camera = camera;
		return localView;
	}

	// Load a texture into a material, keeping the fallback colour if it fails
	// (missing file, or file:// image loads blocked -- the view still works
	// without it). No Mars-Wrap.jpg / Phobos-Wrap.jpg ship with this tool
	// (see README); drop matching files into this folder to enable them.
	function loadTexture(url, material) {
		try {
			new THREE.TextureLoader().load(url, function (tex) {
				if (tex.colorSpace !== undefined && THREE.SRGBColorSpace !== undefined) {
					tex.colorSpace = THREE.SRGBColorSpace;
				}
				material.map = tex;
				material.color.setHex(0xffffff);
				material.needsUpdate = true;
			}, undefined, function () { /* keep fallback colour */ });
		} catch (_) { /* keep fallback colour */ }
	}

	function makeStars() {
		var g = new THREE.BufferGeometry();
		var n = 1400, arr = new Float32Array(n * 3);
		for (var i = 0; i < n; i++) {
			var u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
			var s = Math.sqrt(1 - u * u), R = 40000;
			arr[i*3] = R * s * Math.cos(a);
			arr[i*3+1] = R * s * Math.sin(a);
			arr[i*3+2] = R * u;
		}
		g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
		return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x666f86, size: 1.4, sizeAttenuation: false }));
	}

	// A constant-size bright pixel at a group's origin; a back-face SOI shell;
	// a floating name label — all shared with the other plotters
	// (Shared/sim/body-renderer.js).
	function makePoint(colorHex, sizePx) { return brMakePoint(colorHex, sizePx); }
	function makeSOIShell(radiusU, colorHex, opacity) { return brMakeSOIShell(radiusU, colorHex, opacity); }
	function addLabel(name, obj) { brAddLabel(labelLayer, labelList, name, obj, "mps-label"); }

	// A dot sized in world units (sizeAttenuation), so it scales with the view
	// and shrinks to nothing as the camera pulls away.
	function makeWorldDot(colorHex, sizeU) {
		var g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
		return new THREE.Points(g, new THREE.PointsMaterial({
			color: colorHex, size: sizeU, sizeAttenuation: true,
			transparent: true, depthTest: false }));
	}

	function disposeGroup(g) {
		g.traverse(function (o) {
			if (o.geometry) { o.geometry.dispose(); }
			if (o.material) { o.material.dispose(); }
		});
	}

	// =======================================================================
	//  Phobos orbit ring (= the hook's CoM ring -- see file header)
	// =======================================================================
	function buildPhobosOrbit() {
		if (phobosOrbitGroup) { scene.remove(phobosOrbitGroup); disposeGroup(phobosOrbitGroup); }
		var b = hookBasis();
		var rU = kmToU(A_PHOBOS / 1e3);
		// Phobos is modelled as circular (see file header), so this is a plain
		// circle in the skyhook's own orbital-plane basis, not an ellipse --
		// only the line-from-points helper is shared (Shared/sim/orbit-rings.js).
		function arc(a0, span, N, col, op) {
			var pts = [];
			for (var k = 0; k <= N; k++) {
				var a = a0 + span * k / N;
				pts.push(b.e1.clone().multiplyScalar(rU * Math.cos(a)).add(b.e2.clone().multiplyScalar(rU * Math.sin(a))));
			}
			return makeArcLine(pts, col, op);
		}
		var grp = new THREE.Group();
		grp.add(arc(0, Math.PI, 160, 0xffd24a, 0.8));           // "north" half (bright)
		grp.add(arc(Math.PI, Math.PI, 160, 0x8a721f, 0.4));     // "south" half (dim)
		grp.visible = orbitToggle.checked;
		scene.add(grp);
		phobosOrbitGroup = grp;
	}

	// =======================================================================
	//  Skyhook geometry -- lower tether end, Phobos (CoM), upper tether end,
	//  all concentric circles around MARS (see file header). Everything here
	//  is drawn directly under `scene` in absolute Mars-centred coordinates --
	//  there is no nested "Phobos-local" frame the way the sister tool nests
	//  hook geometry under moonPosGroup, because the hook orbits Mars, not
	//  Phobos.
	// =======================================================================
	function activeRangeKm() {
		var comAltKm = (A_PHOBOS - R_MARS) / 1e3;
		return (state.releaseSide === "above")
			? { min: comAltKm, max: state.topAlt / 1e3 }
			: { min: state.botAlt / 1e3, max: comAltKm };
	}

	function buildHook() {
		if (hookGroup) { scene.remove(hookGroup); disposeGroup(hookGroup); }
		releaseMesh = null;
		var grp = new THREE.Group();

		var phase = phobosPhase(state.jd);
		var dir = hookDir(phase), pro = hookPro(phase);
		var rBot = kmToU((R_MARS + state.botAlt) / 1e3);
		var rTop = kmToU((R_MARS + state.topAlt) / 1e3);
		var rRel = kmToU((R_MARS + state.relAlt) / 1e3);

		function ring(rU, col, op) {
			var b = hookBasis(), pts = [], N = 128;
			for (var k = 0; k <= N; k++) {
				var a = 2 * Math.PI * k / N;
				pts.push(b.e1.clone().multiplyScalar(rU * Math.cos(a)).add(b.e2.clone().multiplyScalar(rU * Math.sin(a))));
			}
			return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
				new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }));
		}
		grp.add(ring(rTop, 0x9fb6ff, 0.85));                // upper tether end
		grp.add(ring(rBot, 0xff9a6a, 0.85));                // lower tether end
		// (Phobos/CoM ring is the same circle as buildPhobosOrbit(), toggled
		// separately by the "Phobos orbit" checkbox -- not redrawn here.)

		// radial tether line: bottom -> top, through Phobos
		var lg = new THREE.BufferGeometry().setFromPoints([
			dir.clone().multiplyScalar(rBot), dir.clone().multiplyScalar(rTop)]);
		grp.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xeaf0ff })));

		// small world-sized dots at bottom / Phobos(CoM) / top
		var dotU = kmToU(150);
		[[rBot, 0xff9a6a], [kmToU(A_PHOBOS / 1e3), 0xffd24a], [rTop, 0x9fb6ff]].forEach(function (d) {
			var dot = makeWorldDot(d[1], dotU);
			dot.position.copy(dir.clone().multiplyScalar(d[0]));
			grp.add(dot);
		});

		// Release-point marker: a small triangle lying in the orbital plane,
		// tip on the tether at the release altitude, pointing prograde. Real
		// scene geometry, so it scales with the view and disappears once the
		// hook is too small to read.
		var triLen = kmToU(450), triHw = kmToU(100);
		var bL = pro.clone().multiplyScalar(-triLen).add(dir.clone().multiplyScalar(triHw));
		var bR = pro.clone().multiplyScalar(-triLen).add(dir.clone().multiplyScalar(-triHw));
		var triGeo = new THREE.BufferGeometry();
		triGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			0, 0, 0, bL.x, bL.y, bL.z, bR.x, bR.y, bR.z]), 3));
		releaseMesh = new THREE.Mesh(triGeo, new THREE.MeshBasicMaterial({
			color: 0xff5fd0, side: THREE.DoubleSide }));
		releaseMesh.position.copy(dir.clone().multiplyScalar(rRel));
		var rng = activeRangeKm();
		releaseMesh.userData.dir = dir.clone();
		releaseMesh.userData.rMin = kmToU(R_MARS / 1e3 + rng.min);
		releaseMesh.userData.rMax = kmToU(R_MARS / 1e3 + rng.max);
		grp.add(releaseMesh);

		// "Points at Mars" marker beyond the upper tether end -- Mars sits at
		// the scene origin, so the direction back to it from anywhere on the
		// tether is simply -dir (no position offset needed, unlike the sister
		// tool where Earth wasn't the Moon-relative hook's local origin).
		var marsDir = dir.clone().multiplyScalar(-1);
		var side = pro.clone();     // pro is already perpendicular to dir (=marsDir's opposite)
		var tbL = marsDir.clone().multiplyScalar(-triLen).add(side.clone().multiplyScalar(triHw));
		var tbR = marsDir.clone().multiplyScalar(-triLen).add(side.clone().multiplyScalar(-triHw));
		var topTriGeo = new THREE.BufferGeometry();
		topTriGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			0, 0, 0, tbL.x, tbL.y, tbL.z, tbR.x, tbR.y, tbR.z]), 3));
		var topMesh = new THREE.Mesh(topTriGeo, new THREE.MeshBasicMaterial({
			color: 0x9fb6ff, side: THREE.DoubleSide }));
		var triReach = Math.sqrt(triLen * triLen + triHw * triHw);
		var topGap = triReach + kmToU(200);
		topMesh.position.copy(dir.clone().multiplyScalar(rTop + topGap));
		grp.add(topMesh);

		grp.visible = hookToggle.checked;
		scene.add(grp);
		hookGroup = grp;
	}

	// =======================================================================
	//  Released-ship trajectory (Mars + Sun gravity, colored by outcome)
	// =======================================================================
	// Inertial release state (m, m/s), directly Mars-centred -- no frame
	// addition needed (unlike the sister tool, which had to add the Moon's own
	// ephemeris position/velocity onto a Moon-relative release state).
	function releaseState() {
		var rRel = R_MARS + state.relAlt;
		var vRel = OMEGA_PHOBOS * rRel;
		var phase = phobosPhase(state.jd);
		var dir = hookDir(phase), pro = hookPro(phase);
		return { r: [dir.x * rRel, dir.y * rRel, dir.z * rRel],
		         v: [pro.x * vRel, pro.y * vRel, pro.z * vRel] };
	}

	// Add a third body's perturbation to acceleration `a`: the body's direct
	// pull on the ship minus its pull on Mars (the indirect term), keeping the
	// Mars-centred frame consistent (a patched conic would drop this term).
	function addThirdBody(a, r, rB, GM) {
		var dx = rB[0]-r[0], dy = rB[1]-r[1], dz = rB[2]-r[2];
		var d = Math.hypot(dx, dy, dz), d3 = d*d*d;
		var b = Math.hypot(rB[0], rB[1], rB[2]), b3 = b*b*b;
		a[0] += GM*(dx/d3 - rB[0]/b3);
		a[1] += GM*(dy/d3 - rB[1]/b3);
		a[2] += GM*(dz/d3 - rB[2]/b3);
	}

	// Mars-centred acceleration (m/s^2) on the ship from Mars + Sun gravity.
	// Phobos is not included -- see file header (massless approximation).
	function marsAccel(r, jde) {
		var rm = Math.hypot(r[0], r[1], r[2]), rm3 = rm*rm*rm;
		var a = [ -GM_MARS*r[0]/rm3, -GM_MARS*r[1]/rm3, -GM_MARS*r[2]/rm3 ];
		addThirdBody(a, r, sunRelPos(jde), GM_S);
		return a;
	}

	// Speed, and flight-path angle (rad, below local horizontal, positive
	// while descending) at a Mars-centred state (r,v) -- read at the instant
	// the trajectory crosses Mars' atmosphere interface (see integrateTrajectory).
	function entryConditionsFromState(r, v) {
		var rmag = Math.hypot(r[0], r[1], r[2]), vmag = Math.hypot(v[0], v[1], v[2]);
		var vr = (r[0]*v[0] + r[1]*v[1] + r[2]*v[2]) / rmag;
		var fpaRad = Math.asin(Math.max(-1, Math.min(1, -vr / vmag)));
		return { r: rmag, v: vmag, fpaRad: fpaRad };
	}

	// Integrate the Mars-centred trajectory (RK4, Mars + Sun gravity) from a
	// given state until it: crosses Mars' atmosphere interface ("entry" --
	// includes a direct-impact fallback, since the interface radius is always
	// above the surface as long as the atmosphere height is positive);
	// completes ~one bound Mars orbit ("mars", never reaching the atmosphere
	// or escaping); or clears to a heliocentric orbit past 0.1 AU-equivalent
	// of Mars' orbit ("sun"). Unlike the sister tool there is no intermediate
	// "clear the small body's SOI" stage -- Phobos has no gravitating SOI, so
	// Mars-relative energy is evaluated directly from release. Also records a
	// full (r,v,t) sample trail (turn-angle-capped step) so a waypoint dropped
	// anywhere on this leg can recover its state (interpolated) without
	// re-integrating.
	function integrateTrajectory(R0, V0, jd0) {
		var r = R0.slice(), v = V0.slice(), t = 0;
		var pts = [ new THREE.Vector3(mToU(r[0]), mToU(r[1]), mToU(r[2])) ];
		var samples = [ { r: r.slice(), v: v.slice(), t: 0 } ];
		var entryR = R_MARS + ATM_HEIGHT;
		var cutoff = 0.1 * A_MARS;
		var rmin = Infinity, rmax = 0, helioEl = null, vinfSun = null, entry = null, branch = null;
		// Absolute heliocentric escape state (m, m/s) + the Julian date it was
		// captured at -- feeds the pure-Kepler waypoint chain (computeHelioChain)
		// once this leg clears Mars' influence. Null unless branch ends up "sun".
		var escR = null, escV = null, escJde = null;

		var r0mag = Math.hypot(r[0], r[1], r[2]);
		if (r0mag <= entryR) {
			// Started already inside the atmosphere interface (e.g. the lower
			// tether end set below ~100 km alt) -- report entry immediately.
			return { pts: pts, samples: samples, branch: "entry", entry: entryConditionsFromState(r, v),
			         rmin: r0mag, rmax: r0mag, helioEl: null, vinfSun: null, duration: 0 };
		}

		// If this release is already bound to Mars (specific energy < 0), cap
		// the integration at ~one orbital period so a "mars"-primary leg that
		// never reaches the atmosphere or escapes doesn't run to the step
		// limit -- mirrors the sister tool's moonBoundCap, generalised via
		// the actual two-body elements rather than being tied to a fixed leg.
		var v0mag = Math.hypot(v[0], v[1], v[2]);
		var E0 = v0mag*v0mag/2 - GM_MARS/r0mag;
		var boundCap = null;
		if (E0 < 0) {
			var el0 = O.elementsFromState(GM_MARS, r, v);
			if (el0.e < 1 && isFinite(el0.a)) { boundCap = 2*Math.PI*Math.sqrt(Math.pow(el0.a,3)/GM_MARS) * 1.02; }
		}

		for (var step = 0; step < 8000; step++) {
			var jde = jd0 + t/86400;
			var a1 = marsAccel(r, jde);
			var amag = Math.max(1e-12, Math.hypot(a1[0], a1[1], a1[2]));
			var vmag = Math.max(1, Math.hypot(v[0], v[1], v[2]));
			var rNow = Math.hypot(r[0], r[1], r[2]);
			var dtMax = rNow < SOI_MARS ? 2160 : 21600;
			var dt = Math.max(0.05, Math.min(dtMax, 0.02 * vmag / amag));   // ~1 deg of turn, capped
			var hd = dt/2/86400;
			var r2 = O.vAdd(r, O.vScale(v, dt/2)), v2 = O.vAdd(v, O.vScale(a1, dt/2)), a2 = marsAccel(r2, jde+hd);
			var r3 = O.vAdd(r, O.vScale(v2, dt/2)), v3 = O.vAdd(v, O.vScale(a2, dt/2)), a3 = marsAccel(r3, jde+hd);
			var r4 = O.vAdd(r, O.vScale(v3, dt)), v4 = O.vAdd(v, O.vScale(a3, dt)), a4 = marsAccel(r4, jde+dt/86400);
			r = O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2,2)), O.vAdd(O.vScale(v3,2), v4)), dt/6));
			v = O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2,2)), O.vAdd(O.vScale(a3,2), a4)), dt/6));
			t += dt;
			pts.push(new THREE.Vector3(mToU(r[0]), mToU(r[1]), mToU(r[2])));
			samples.push({ r: r.slice(), v: v.slice(), t: t });
			var rmag = Math.hypot(r[0], r[1], r[2]);
			if (rmag < rmin) { rmin = rmag; }
			if (rmag > rmax) { rmax = rmag; }
			if (rmag <= entryR) { entry = entryConditionsFromState(r, v); branch = "entry"; break; }
			if (boundCap != null && t > boundCap) { branch = "mars"; break; }
			var vmagNow = Math.hypot(v[0], v[1], v[2]);
			var E = vmagNow*vmagNow/2 - GM_MARS/rmag;
			if (boundCap == null && E >= 0 && rmag > cutoff) {
				var mh = marsHelioState(jde);
				escR = O.vAdd(mh.r, r); escV = O.vAdd(mh.v, v); escJde = jde;
				helioEl = O.elementsFromState(GM_S, escR, escV);
				branch = "sun";
				break;
			}
		}
		if (!branch) { branch = boundCap != null ? "mars" : "sun"; }
		if (branch === "sun" && !helioEl) {
			var mhf = marsHelioState(jd0 + t/86400);
			escR = O.vAdd(mhf.r, r); escV = O.vAdd(mhf.v, v); escJde = jd0 + t/86400;
			helioEl = O.elementsFromState(GM_S, escR, escV);
		}
		if (branch === "sun" && helioEl) {
			vinfSun = helioEl.energy > 0 ? Math.sqrt(2*helioEl.energy) : null;
		}
		return { pts: pts, samples: samples, branch: branch, entry: entry,
		         rmin: rmin, rmax: rmax, helioEl: helioEl, vinfSun: vinfSun, duration: t,
		         escR: escR, escV: escV, escJde: escJde };
	}

	// A leg integrated with real Mars + Sun gravity (RK4) from a Mars-centred
	// state, run to its natural end (entry / one bound Mars orbit / heliocentric
	// escape) -- see integrateTrajectory. Always drawn in absolute Mars-centred
	// scene coordinates (no "as if the small body stood still" rendering hack
	// needed -- Mars, unlike the Moon, IS the fixed origin here).
	function buildIntegratedLeg(R0, V0, jde0) {
		var res = integrateTrajectory(R0, V0, jde0);
		var primary = res.branch === "sun" ? "Sun" : (res.branch === "entry" ? "Entry" : "Mars");
		var color = res.branch === "sun" ? 0xff9a3c : (res.branch === "entry" ? 0xff5050 : 0x40d27f);
		var s0 = res.samples[0];
		return {
			color: color, primary: primary, branch: res.branch,
			points: res.pts, samples: res.samples, jde0: jde0, duration: res.duration,
			rmin: res.rmin, rmax: res.rmax, entry: res.entry,
			helioEl: res.helioEl, vinfSun: res.vinfSun,
			escR: res.escR, escV: res.escV, escJde: res.escJde,
			inclRad: res.branch === "sun" ? (res.helioEl ? res.helioEl.i : null)
				: equatorialInclination(s0.r, s0.v)
		};
	}

	// Orbital period (s) of a bound conic.
	function conicPeriod(GM, el) { return 2 * Math.PI * Math.sqrt(Math.pow(el.a, 3) / GM); }

	// =======================================================================
	//  Waypoints -- pure heliocentric two-body Kepler arcs, post Mars-escape
	// =======================================================================
	// Ported verbatim (GM_SUN -> GM_S) from Solar-System-Trajectory-Plotter's
	// waypoint model: a flyby of Mars itself isn't a useful place for a
	// waypoint burn, so waypoints now live entirely in the solar-system view,
	// on the pure two-body Sun-only coast that begins where the initial
	// RK4 (Mars+Sun) leg clears Mars' influence (buildIntegratedLeg's escR/
	// escV/escJde, when its branch is "sun"). Snapping to apoapsis/periapsis
	// or an ascending/descending node is exact here (unlike a distance-along-
	// path default), because each leg of the chain is an exact Kepler conic.

	// Periapsis/apoapsis availability for a leg opened by `burn` (null for the
	// raw, un-burned Mars-escape leg; else the previous waypoint's burn).
	//
	// A tangential burn leaves the burn point itself (approximately) AT an
	// apsis of the new orbit: a net prograde burn puts it at periapsis (so
	// the OTHER apsis, apoapsis, is the new/interesting far point); a net
	// retrograde burn puts it at apoapsis (so periapsis is the new one).
	// Offering the apsis the burn point already IS would just be a full,
	// burn-free orbit later -- degenerate -- hence only one is available.
	//
	// With NO burn at all (the raw escape leg), the current point generally
	// ISN'T at either apsis of its own orbit -- it's just wherever the
	// integrated Mars+Sun leg happened to cross the escape boundary -- so
	// neither apsis is degenerate, and BOTH are independently available
	// (apoapsis still needs a bound orbit, checked separately at snap time).
	function periApsisAvailable(burn) { return burn ? (burn.pro < 0) : true; }
	function apoApsisAvailable(burn)  { return burn ? (burn.pro > 0) : true; }
	// Node-like options for a leg's arc. For an inclined orbit these are the
	// true ascending/descending nodes; for a near-ecliptic leg nodes are
	// meaningless, so substitute the points 90 deg / 270 deg of true anomaly
	// ahead of the launch point.
	var NODE_INCL_MIN = 0.1 * Math.PI / 180;
	function nodeInfo(r, v) {
		var el = O.elementsFromState(GM_S, r, v);
		if (el.i < NODE_INCL_MIN) {
			return { earthLike: true,
			         asc: el.nu + Math.PI / 2,  ascLabel: "90°",
			         desc: el.nu - Math.PI / 2, descLabel: "270°" };
		}
		return { earthLike: false,
		         asc: -el.omega,           ascLabel: "ascending node",
		         desc: Math.PI - el.omega, descLabel: "descending node" };
	}
	// Target true anomaly on the leg's arc for a snap key, or null if not
	// applicable. The apsis availability comes from the leg-creating `burn`
	// (see periApsisAvailable/apoApsisAvailable above).
	function snapTargetNu(r, v, burn, snap) {
		if (snap === "peri") {
			return periApsisAvailable(burn) ? 0 : null;
		}
		if (snap === "apo") {
			if (!apoApsisAvailable(burn)) { return null; }
			if (O.elementsFromState(GM_S, r, v).e >= 1) { return null; }   // hyperbola: no apoapsis
			return Math.PI;
		}
		var ni = nodeInfo(r, v);
		if (snap === "asc")  { return ni.asc; }
		if (snap === "desc") { return ni.desc; }
		return null;
	}
	// Forward time (s) from (r,v) to a target true anomaly, or null if unreachable.
	function timeToTrueAnomaly(r, v, nuTarget) {
		if (nuTarget == null || !isFinite(nuTarget)) { return null; }
		var el = O.elementsFromState(GM_S, r, v);
		var M0 = O.meanAnomalyFromTrue(el.nu, el.e);
		var Mt = O.meanAnomalyFromTrue(nuTarget, el.e);
		if (!isFinite(M0) || !isFinite(Mt)) { return null; }
		var dM = Mt - M0;
		if (el.e < 1) { dM = ((dM % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI); }  // next forward pass
		else if (dM <= 0) { return null; }                             // hyperbola: already past
		return dM / O.meanMotion(GM_S, el.a);
	}
	// Leg time (s) to a snapped feature, plus a slider offset of `off` radians
	// of true anomaly applied symmetrically about the feature (so -off lands
	// earlier on the arc, +off later), or null if not applicable.
	function snapTau(r, v, burn, snap, off) {
		var base = snapTargetNu(r, v, burn, snap);
		if (base == null) { return null; }
		var el = O.elementsFromState(GM_S, r, v);
		var n = O.meanMotion(GM_S, el.a);
		var bound = el.e < 1;
		var tau = timeToTrueAnomaly(r, v, base);
		if (tau == null) { return null; }
		if (off) {
			var dM = O.meanAnomalyFromTrue(base + off, el.e) - O.meanAnomalyFromTrue(base, el.e);
			if (bound) { while (dM > Math.PI) { dM -= 2*Math.PI; } while (dM < -Math.PI) { dM += 2*Math.PI; } }
			tau += dM / n;
		}
		if (bound) { var period = 2*Math.PI / n; while (tau < DAY) { tau += period; } }
		return (isFinite(tau) && tau > DAY) ? tau : null;
	}
	// How long to draw the final coast: one period if bound (capped), else a
	// few years of escape.
	function finalCoast(r, v) {
		var el = O.elementsFromState(GM_S, r, v);
		if (el.e < 1 && el.a > 0) {
			var T = 2 * Math.PI * Math.sqrt(Math.pow(el.a, 3) / GM_S);
			return Math.min(T, 60 * 365.25 * DAY);
		}
		return 12 * 365.25 * DAY;
	}

	// Build the post-escape heliocentric chain: a pure two-body Sun-only coast
	// from (rHel0, vHel0) at Julian date jdeEscape, through each defined
	// waypoint's burn, to a final indefinite coast. Mirrors the reference
	// tool's computeTrajectory() exactly, just seeded from the escape state
	// instead of a body's ephemeris + departure burn (so segStartBurn starts
	// as null -- there is no meaningful pro/rad/nrm decomposition of "how Mars
	// flung the ship out"). Returns null if there are no waypoints AND the
	// caller doesn't need the predicted-orbit overlay -- callers should still
	// call this whenever the leg's branch is "sun" (even with zero waypoints)
	// to get the final-coast arc for that overlay.
	function computeHelioChain(rHel0, vHel0, jdeEscape) {
		var samples = [], points = [], segs = [];
		var tGlobal = 0;
		var segStartR = rHel0, segStartV = vHel0;
		var segStartBurn = null;      // no controlling burn for the raw escape state
		var nSeg = state.waypoints.length + 1;
		for (var seg = 0; seg < nSeg; seg++) {
			var isFinal = (seg === state.waypoints.length);
			var dur;
			if (isFinal) {
				dur = finalCoast(segStartR, segStartV);
			} else {
				var wpd = state.waypoints[seg];
				var periOK = periApsisAvailable(segStartBurn);
				var apoOK = apoApsisAvailable(segStartBurn)
					&& O.elementsFromState(GM_S, segStartR, segStartV).e < 1;
				wpd._periAvailable = periOK;
				wpd._apoAvailable = apoOK;
				var ni = nodeInfo(segStartR, segStartV);
				wpd._nodeLabel = { asc: ni.ascLabel, desc: ni.descLabel };
				if (wpd.snap === "nodeNearest") {
					var ta = snapTau(segStartR, segStartV, segStartBurn, "asc", 0);
					var td = snapTau(segStartR, segStartV, segStartBurn, "desc", 0);
					wpd.snap = (td == null || (ta != null && ta <= td)) ? "asc" : "desc";
				}
				// "apsisNearest" (WP2's default) resolves to whichever apsis
				// this leg's burn actually opened -- for a burn-driven leg
				// peri/apo are mutually exclusive (only one is ever open), so
				// this just picks that one; for a burn-less leg (shouldn't
				// occur past seg 0, but handled for completeness) it picks the
				// temporally nearer of the two, mirroring nodeNearest above.
				if (wpd.snap === "apsisNearest") {
					if (periOK && apoOK) {
						var tp = snapTau(segStartR, segStartV, segStartBurn, "peri", 0);
						var tap = snapTau(segStartR, segStartV, segStartBurn, "apo", 0);
						wpd.snap = (tap == null || (tp != null && tp <= tap)) ? "peri" : "apo";
					} else if (periOK) { wpd.snap = "peri"; }
					else if (apoOK) { wpd.snap = "apo"; }
					else { wpd.snap = null; }
				}
				if (wpd.snap === "peri" && !periOK) { wpd.snap = null; }
				if (wpd.snap === "apo" && !apoOK) { wpd.snap = null; }
				if (wpd.snap) {
					var t = snapTau(segStartR, segStartV, segStartBurn, wpd.snap, wpd.snapOffset || 0);
					if (t != null) { wpd.tau = t; }
				}
				dur = wpd.tau;
			}
			segs.push({ r0: segStartR, v0: segStartV, dur: dur, tStart: tGlobal });
			var steps = isFinal ? 256 : 160;
			var arc = O.sampleArc(GM_S, segStartR, segStartV, dur, steps);
			for (var k = 0; k < arc.length; k++) {
				if (seg > 0 && k === 0) { continue; }        // avoid duplicate joint
				samples.push({ r: arc[k].r, t: tGlobal + arc[k].t });
			}
			var endState = O.propagateState(GM_S, segStartR, segStartV, dur);
			if (!isFinal) {
				var wp = state.waypoints[seg];
				var vBefore = endState.v;
				var vAfter = O.applyBurn(endState.r, endState.v, wp.burn.pro, wp.burn.nrm, wp.burn.rad);
				points.push({ r: endState.r, vBefore: vBefore, vAfter: vAfter,
				              tGlobal: tGlobal + dur, jde: jdeEscape + (tGlobal + dur) / DAY, burn: wp.burn });
				segStartR = endState.r; segStartV = vAfter;
				segStartBurn = wp.burn;
				tGlobal += dur;
			}
		}
		return { samples: samples, points: points, segs: segs, jdeEscape: jdeEscape };
	}

	// Decide the trajectory's outcome and produce the initial (Mars+Sun RK4)
	// leg's scene-unit polyline. If that leg escapes to a heliocentric orbit,
	// also build the post-escape waypoint chain (pure two-body Sun-only Kepler
	// arcs) -- see computeHelioChain above. Waypoints never attach to the
	// initial leg itself (a flyby of Mars isn't a useful place for one).
	function computeTrajectory() {
		var rel = releaseState();
		var leg0 = buildIntegratedLeg(rel.r, rel.v, state.jd);
		var helioChain = null;
		if (leg0.branch === "sun" && leg0.escR && leg0.escV) {
			helioChain = computeHelioChain(leg0.escR, leg0.escV, leg0.escJde);
		}
		return { legs: [leg0], helioChain: helioChain, final: leg0 };
	}

	function buildTrajectory() {
		if (trajectoryGroup) {
			scene.remove(trajectoryGroup);
			disposeGroup(trajectoryGroup);
			trajectoryGroup = null;
		}

		applyTargeting();                 // re-solve Target's burn before the trajectory below reflects it

		var res = computeTrajectory();
		syncChainGlobals(res);             // cache chainSegs/chainSamplesAU/chainTotalT/chainJdeEscape
		var t = res.final;

		if (createWp1) { createWp1.checked = state.waypoints.length >= 1; }
		if (createWp2) {
			createWp2.checked = state.waypoints.length >= 2;
			createWp2.disabled = state.waypoints.length < 1;
		}
		if (state.waypoints.length !== lastWpCount) {
			lastWpCount = state.waypoints.length;
			buildWaypointList();
		}

		// ---- read-outs ----
		trajPrimOut.textContent = t.primary === "Entry" ? "Mars (atmospheric entry)" : t.primary;
		if (t.primary === "Mars") {
			trajPeriOut.textContent = fmt((t.rmin - R_MARS)/1e3, 0) + " km";
			trajApoOut.textContent = t.rmax > 0 ? fmt((t.rmax - R_MARS)/1e3, 0) + " km" : "—";
		} else if (t.primary === "Sun") {
			var h = t.helioEl;
			trajPeriOut.textContent = h ? (O.periapsisRadius(h.a, h.e)/AU_M).toFixed(3) + " AU" : "—";
			trajApoOut.textContent = (h && h.e < 1) ? (O.apoapsisRadius(h.a, h.e)/AU_M).toFixed(3) + " AU" : "— (escape)";
		} else {   // Entry
			trajPeriOut.textContent = "entered atmosphere";
			trajApoOut.textContent = "—";
		}
		trajInclLabelOut.textContent = (t.primary === "Sun") ? "heliocentric inclination" : "equatorial inclination";
		trajInclOut.textContent = (t.inclRad != null) ? fmt(t.inclRad * 180 / Math.PI, 1) + "°" : "—";

		// destination info (solar-system view): the body's position "now", plus
		// a note about the × once the trajectory has a chain to place a marker on.
		if (destInfo) {
			if (state.destination && state.destination !== "(none)" && state.destination !== "Mars") {
				var dnow = O.bodyStateAtJD(GM_S, systems.get(state.destination).orbit, state.jd);
				destInfo.textContent = "Now at " + (O.vMag(dnow.r) / AU_M).toFixed(3) + " AU, "
					+ (O.vMag(dnow.v) / 1000).toFixed(2) + " km/s."
					+ (chainSegs.length
						? " Switch to the solar system view and click the trajectory to drop a marker — the × marks where it will be at that time of flight."
						: " Waits until the trajectory escapes Mars.");
			} else {
				destInfo.textContent = "No destination selected.";
			}
		}

		// Closest-approach readout: the proximity ring only lights up inside
		// APPROACH_FAR (0.004 AU), and a bare Mars-escape release (no waypoint
		// burn yet) rarely gets anywhere near that -- the tether only imparts a
		// fixed tangential kick, so the resulting perihelion barely moves off
		// Mars's own. Report the true closest approach over the whole coast so
		// "the ring never shows up" reads as "here's how close it actually
		// gets" instead of silence, and offer a one-click way to inspect it.
		lastApproachT = null;
		if (approachRow) {
			var appr = closestApproachToDestination(state.destination);
			if (appr) {
				var apprAU = appr.dist / AU_M, farAU = APPROACH_FAR / AU_M;
				lastApproachT = appr.t;
				approachRow.style.display = "";
				if (apprAU < farAU) {
					approachInfo.textContent = "Closest approach: " + apprAU.toFixed(3) + " AU — within ring range.";
				} else {
					approachInfo.textContent = "Closest approach: " + apprAU.toFixed(2) + " AU"
						+ " (ring needs ≤" + farAU.toFixed(3) + " AU"
						+ (state.waypoints.length === 0 ? " — try a waypoint burn to steer closer" : "") + ").";
				}
			} else {
				approachRow.style.display = "none";
			}
		}

		// outbound (heliocentric escape) / inbound (atmospheric entry) blocks,
		// shown according to the trajectory's ACTUAL outcome (not just which
		// side of Phobos it was released from -- a waypoint burn can change
		// the outcome either way).
		if (t.primary === "Sun") {
			outboundBlock.style.display = "";
			inboundBlock.style.display = "none";
			if (t.vinfSun != null) {
				vinfSunOut.textContent = fmt(t.vinfSun, 0) + " m/s";
				sunNoteOut.textContent = "Escapes Mars; heliocentric apsides are an estimate.";
			} else {
				vinfSunOut.textContent = "captured by the Sun (bound)";
				sunNoteOut.textContent = "Escapes Mars onto a bound heliocentric orbit.";
			}
		} else if (t.primary === "Entry") {
			outboundBlock.style.display = "none";
			inboundBlock.style.display = "";
			entryClassifyOut.textContent = "Crosses Mars' ~" + fmt(ATM_HEIGHT/1e3, 0) + " km atmosphere interface.";
			entrySpeedOut.textContent = fmt(t.entry.v, 0) + " m/s";
			entryFpaOut.textContent = fmt(t.entry.fpaRad * 180 / Math.PI, 1) + "° below horizontal";
			var area = Math.PI * Math.pow(state.vehDiam / 2, 2);
			var beta = O.ballisticCoefficient(state.vehMass, 1.5, area);
			var gPeak = O.allenEggersPeakDecel(t.entry.v, t.entry.fpaRad, SCALE_H_MARS) / Const.g0;
			entryDecelOut.textContent = fmt(gPeak, 2) + " g";
			var rhoPeak = O.allenEggersPeakDensity(beta, t.entry.fpaRad, SCALE_H_MARS);
			var vPeak = O.allenEggersPeakVelocity(t.entry.v);
			var q = O.suttonGravesHeatFlux(rhoPeak, vPeak, state.vehDiam / 2);
			entryHeatOut.textContent = fmt(q / 1e4, 1) + " W/cm² (convective only, lower bound)";
		} else {   // Mars (bound, never entered)
			outboundBlock.style.display = "none";
			inboundBlock.style.display = "none";
		}

		// ---- draw the initial (Mars+Sun RK4) leg, in full -- waypoints never
		// attach to it (see file header on computeTrajectory) ----
		var grp = new THREE.Group();
		var visible = trajToggle ? trajToggle.checked : true;
		grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(t.points),
			new THREE.LineBasicMaterial({ color: t.color })));
		grp.visible = visible;
		scene.add(grp);
		trajectoryGroup = grp;

		// per-waypoint info line + the straddling burn-readout cards -- driven
		// by the post-escape heliocentric chain (computeHelioChain); waypoint
		// gizmos/arrows themselves are drawn only in the solar-system view
		// (Helio.updateTrajectory), since a flyby of Mars isn't a useful place
		// for one (see file header).
		var entries = [];
		var chain = res.helioChain;
		var wpPoints = chain ? chain.points : [];
		wpPoints.forEach(function (p, idx) {
			var wp = state.waypoints[idx];
			// keep the snap-to checkboxes + fine-tune slider in step with what
			// computeHelioChain just resolved (labels, availability, active snap)
			if (wp._snapBoxes) {
				var pb = wp._snapBoxes.peri;
				if (pb) {
					var periAvail = wp._periAvailable !== false;
					pb.cb.disabled = !periAvail;
					pb.lab.style.opacity = periAvail ? "" : "0.4";
					pb.lab.title = periAvail ? "" : "this leg's opening burn (or lack of one) doesn't leave periapsis open here";
				}
				var ab = wp._snapBoxes.apo;
				if (ab) {
					var apoAvail = wp._apoAvailable !== false;
					ab.cb.disabled = !apoAvail;
					ab.lab.style.opacity = apoAvail ? "" : "0.4";
					ab.lab.title = apoAvail ? "" : "needs a bound orbit reached by a prograde burn (or no burn at all)";
				}
				if (wp._nodeLabel) {
					if (wp._snapBoxes.asc)  { wp._snapBoxes.asc.txt.textContent  = wp._nodeLabel.asc; }
					if (wp._snapBoxes.desc) { wp._snapBoxes.desc.txt.textContent = wp._nodeLabel.desc; }
				}
				["peri", "apo", "asc", "desc"].forEach(function (k) {
					if (wp._snapBoxes[k]) { wp._snapBoxes[k].cb.checked = (wp.snap === k); }
				});
				if (wp._slider) { wp._slider.disabled = !wp.snap; }
			}
			var info = document.getElementById("mps-wp-info-" + idx);
			if (info) {
				var days = (p.jde - state.jd).toFixed(2);
				info.textContent = "+" + days + " d, " + (O.vMag(p.r) / AU_M).toFixed(3)
					+ " AU from Sun, coast speed " + (O.vMag(p.vBefore) / 1000).toFixed(2) + " km/s.";
			}
			var mag = Math.hypot(wp.burn.pro, wp.burn.nrm, wp.burn.rad);
			entries.push({ host: wp._host, data: mag < 1 ? null : burnReadoutData(p.r, p.vBefore, wp.burn) });
		});
		for (var ii = wpPoints.length; ii < state.waypoints.length; ii++) {
			var wpX = state.waypoints[ii];
			var info2 = document.getElementById("mps-wp-info-" + ii);
			if (info2) {
				info2.textContent = (t.primary === "Sun")
					? "Unresolved — pick a snap-to feature above."
					: "Unreachable — the trajectory doesn't escape Mars.";
			}
			if (wpX) { entries.push({ host: wpX._host, data: null }); }
		}
		renderBurnReadouts(entries);

		// Keep the last waypoint's on-panel widget showing the burn ACTUALLY in
		// force -- Target overwrites it with the Lambert solution, and leaving
		// Target restores the manual burn, both programmatic changes the
		// editor's own handlers never saw.
		var th = terminalBurnHost();
		if (th && th._mpsRedraw) { th._mpsRedraw(); }

		lastTrajRes = res;
		if (Helio.built && state.view === "helio") { Helio.updateTrajectory(res); }

		// keep the marker on the (possibly reshaped) chain and refresh its readouts
		updateMarker();
	}

	// =======================================================================
	//  Burn-vector arrows + straddling readout cards
	//  (waypoint gizmos are drawn only in the solar-system view -- see
	//  Helio.updateTrajectory, Shared/sim/burn-widget.js)
	// =======================================================================

	// ---- burn readouts: a small pane straddling the panel edge, per burn ----
	// Values for one burn: its |Δv|, the inclination-to-ecliptic change it
	// makes (a plane change, about the radial axis), and the change in
	// prograde (orbital) speed. Returns null for a negligible burn. Ported
	// from the reference tool (GM_SUN -> GM_S); `r`/`vBefore` are absolute
	// heliocentric here rather than origin-relative.
	function burnReadoutData(r, vBefore, burn) {
		var mag = Math.hypot(burn.pro, burn.nrm, burn.rad);
		if (mag < 1) { return null; }
		var vAfter = O.applyBurn(r, vBefore, burn.pro, burn.nrm, burn.rad);
		var iBefore = O.elementsFromState(GM_S, r, vBefore).i;
		var iAfter  = O.elementsFromState(GM_S, r, vAfter).i;
		return {
			burnDv: mag / 1000,
			planeChange: (iAfter - iBefore) * 180 / Math.PI,
			progradeDv: (O.vMag(vAfter) - O.vMag(vBefore)) / 1000
		};
	}

	function renderBurnReadouts(entries) {
		readoutBoxes = readoutRender(readoutLayer, readoutBoxes, entries,
			{ classPrefix: "mps", dvHex: dvHex, spdHex: spdHex, planeChangeLabel: "plane change (to ecliptic)" });
		positionBurnReadouts();
	}

	function positionBurnReadouts() {
		readoutPosition(readoutBoxes, mainEl, panelEl);
	}

	// =======================================================================
	//  Per-frame: camera, label/point/marker sizing
	// =======================================================================
	// Shared/sim/body-renderer.js.
	function updateLabels() { brUpdateLabels(camera, holder, labelList); }
	function screenScaleAt(pos, px) { return worldSizeAtPointForPx(camera, holder, pos, px); }

	var _mkPos = new THREE.Vector3();
	function updateMarkers() {
		marsPoint.visible = mToU(R_MARS) < screenScaleAt(_mkPos.set(0, 0, 0), 1);
		phobosPosGroup.getWorldPosition(_mkPos);
		phobosPoint.visible = mToU(R_PHOBOS) < screenScaleAt(_mkPos, 1);
	}

	function resize() {
		var w = holder.clientWidth || 600, h = holder.clientHeight || 400;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		Helio.resize();
	}

	function animate() {
		requestAnimationFrame(animate);
		if (state.view === "helio" && Helio.built) { Helio.render(); return; }
		updateCamera(camera, cam);
		updateMarkers();
		updateLabels();
		positionBurnReadouts();
		renderer.render(scene, camera);
	}

	// ---- camera controls: Shared/sim/camera-controller.js (see `localView` /
	// `helioView` / `getCameraView` above, wired up in initScene) -----------

	function cursorRay(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		var ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
		var dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera)
			.sub(camera.position).normalize();
		return { o: camera.position.clone(), d: dir };
	}

	function hitRelease(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var wp = new THREE.Vector3();
		releaseMesh.getWorldPosition(wp).project(camera);
		var sx = (wp.x * 0.5 + 0.5) * rect.width;
		var sy = (-wp.y * 0.5 + 0.5) * rect.height;
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		return Math.hypot(sx - px, sy - py) < 16;
	}

	// Drag the release marker: project the cursor ray onto the tether line
	// (Mars-centred, since Mars sits at the scene origin) and set the release
	// altitude from the closest point's radius, clamped to the active side's
	// range (see activeRangeKm).
	function dragRelease(e) {
		var ray = cursorRay(e);
		var u = releaseMesh.userData.dir.clone();
		var b = ray.d.dot(u);
		var dd = ray.d.dot(ray.o);
		var ee = u.dot(ray.o);
		var denom = 1 - b * b;
		if (Math.abs(denom) < 1e-9) { return; }
		var tU = (ee - b * dd) / denom;
		var altKm = (tU * U / 1e3) - (R_MARS / 1e3);
		var rng = activeRangeKm();
		altKm = Math.max(rng.min, Math.min(rng.max, altKm));
		commitRelAlt(altKm);
	}

	// Double-click a body to focus the camera on it.
	function focusNearest(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		var targets = [
			{ name: "Phobos", obj: phobosPosGroup, dist: kmToU(130) },
			{ name: "Mars",   obj: marsMesh,       dist: kmToU(16000) }
		];
		var best = null, bestD = 40, wp = new THREE.Vector3();
		targets.forEach(function (tg) {
			tg.obj.getWorldPosition(wp).project(camera);
			if (wp.z > 1) { return; }
			var sx = (wp.x * 0.5 + 0.5) * rect.width, sy = (-wp.y * 0.5 + 0.5) * rect.height;
			var d = Math.hypot(sx - px, sy - py);
			if (d < bestD) { bestD = d; best = tg; }
		});
		if (!best) {
			if (state.focus) { state.focus = null; setHud("Released — free navigation."); }
			return;
		}
		state.focus = best.name;
		best.obj.getWorldPosition(cam.target);
		cam.radius = best.dist;
		setHud("Focused on " + best.name + " (view from " + (best.dist * 1e3).toFixed(0) + " km). Double-click empty space to release.");
	}

	// =======================================================================
	//  Body placement (date-driven) + Sun lighting
	// =======================================================================
	function placeBodies() {
		var phase = phobosPhase(state.jd);
		var dir = hookDir(phase);
		var posU = dir.clone().multiplyScalar(kmToU(A_PHOBOS / 1e3));
		phobosPosGroup.position.copy(posU);

		// Tidal lock: orient Phobos' local frame so its near face points at
		// Mars (the world origin) -- via lookAt at the parent-local target
		// (phobosPosGroup only translates, so a local point of -posU
		// corresponds to the world origin).
		phobosSpinGroup.lookAt(-posU.x, -posU.y, -posU.z);

		// Sun lighting direction (Mars -> Sun), from Mars' real heliocentric position.
		var mh = marsHelioState(state.jd);
		var sLen = Math.hypot(mh.r[0], mh.r[1], mh.r[2]) || 1;
		var sx = -mh.r[0] / sLen, sy = -mh.r[1] / sLen, sz = -mh.r[2] / sLen;
		sunLight.position.set(sx * 5000, sy * 5000, sz * 5000);
		sunLight.target.position.set(0, 0, 0);
		sunMesh.position.set(sx * SUN_DRAW_DIST, sy * SUN_DRAW_DIST, sz * SUN_DRAW_DIST);

		// Rebuild the "ecliptic-ish" ring in Mars' ACTUAL osculating orbital
		// plane (from its instantaneous r x v), not a fixed world XY-plane.
		// Previously this ring was drawn flat in XY and merely translated to
		// the Sun's rendered position each frame -- that only happens to pass
		// through Mars (the origin) when Mars' heliocentric position has zero
		// z-component, which is true by definition for the sister tool's
		// Earth (Earth's orbit defines the ecliptic z=0 plane) but is NOT
		// true for Mars (~1.85 deg real inclination), so the ring generally
		// missed Mars, appearing "off to one side". Building it from e1
		// (Mars -> Sun, unit) and e2 (perpendicular, also in-plane since it's
		// e1 crossed with the orbit normal) guarantees the ring -- centred on
		// the Sun's rendered position, radius SUN_DRAW_DIST -- passes exactly
		// through the origin at every date: point(pi) = C - R*e1 = C - C = 0,
		// where C = R*e1 is exactly the Sun's rendered position above.
		var hHat = O.vUnit(O.vCross(mh.r, mh.v));
		var e1 = [sx, sy, sz];
		var e2 = O.vUnit(O.vCross(hHat, e1));
		var moPts = [];
		for (var moi = 0; moi <= 640; moi++) {
			var moa = 2 * Math.PI * moi / 640;
			var f = SUN_DRAW_DIST * (1 + Math.cos(moa));
			var g = SUN_DRAW_DIST * Math.sin(moa);
			moPts.push(new THREE.Vector3(
				f * e1[0] + g * e2[0],
				f * e1[1] + g * e2[1],
				f * e1[2] + g * e2[2]));
		}
		marsOrbitLine.geometry.dispose();
		marsOrbitLine.geometry = new THREE.BufferGeometry().setFromPoints(moPts);

		if (state.focus === "Phobos") { cam.target.copy(phobosPosGroup.position); }
		else if (state.focus === "Mars") { cam.target.set(0, 0, 0); }

		Helio.placeBodies();
	}

	// =======================================================================
	//  Read-outs
	// =======================================================================
	function computeReadouts() {
		var rCom = A_PHOBOS, rTop = R_MARS + state.topAlt, rBot = R_MARS + state.botAlt;
		var vCom = O.circularVelocity(GM_MARS, rCom);
		var vTop = OMEGA_PHOBOS * rTop, cfTop = OMEGA_PHOBOS * OMEGA_PHOBOS * rTop;
		var vBot = OMEGA_PHOBOS * rBot, cfBot = OMEGA_PHOBOS * OMEGA_PHOBOS * rBot;

		comAltOut.textContent = fmt((rCom - R_MARS)/1e3, 0) + " km alt (fixed)";
		vcomOut.textContent = fmt(vCom, 0) + " m/s";
		omegaTopOut.textContent = fmt(vTop, 0) + " m/s";
		cfTopOut.textContent = fmt(cfTop, 3) + " m/s² · " + fmt(cfTop / 9.80665, 3) + " g";
		omegaBotOut.textContent = fmt(vBot, 0) + " m/s";
		cfBotOut.textContent = fmt(cfBot, 3) + " m/s² · " + fmt(cfBot / 9.80665, 3) + " g";
		periodOut.textContent = "Phobos orbit / tether rotation period: " + fmt(PHOBOS_PERIOD / 3600, 2)
			+ " h (" + fmt(PHOBOS_PERIOD, 0) + " s).";

		var rRel = R_MARS + state.relAlt;
		var vRel = OMEGA_PHOBOS * rRel;
		var vEsc = O.escapeVelocity(GM_MARS, rRel);
		var vInfMars = O.hyperbolicExcess(vRel, GM_MARS, rRel);
		vrelOut.textContent = fmt(vRel, 0) + " m/s";
		vinfMarsOut.textContent = vInfMars > 0 ? fmt(vInfMars, 0) + " m/s" : "bound (v < " + fmt(vEsc, 0) + " m/s escape)";

		// The v_inf at Sun's SOI, the trajectory primary/apsides/inclination and
		// the entry read-outs are set by buildTrajectory() from the integrated
		// path, so they are intentionally not computed here.
	}

	// =======================================================================
	//  Date wiring
	// =======================================================================
	function shortDate(jd) {
		var d = O.dateFromJulian(jd);
		var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
		return mo[d.Mo - 1] + " " + d.D + ", " + d.Y;
	}

	// Shared/sim/date-bar.js. `resolveFineReset` is the "lock Phobos phase"
	// (year slider) hook: when active, instead of resetting to 0 the fine
	// slider is set to whatever sub-day offset restores Phobos' locked phase
	// relative to the Sun (see solveFineOffsetForElongation) -- so e.g.
	// "Phobos at Mars midnight" stays true as you scrub across years, with
	// Phobos' displayed position jumping to wherever within its current
	// orbit satisfies that.
	var dateBar = createDateBar(state, {
		coarseSlider: coarseSlider, fineSlider: fineSlider,
		fineLoLabel: fineLo, fineHiLabel: fineHi,
		dateField: dateField, jdLabel: jdLabel,
		jd0: JD0, spanDays: SPAN_DAYS, shortDate: shortDate,
		jdDecimals: 2,
		resolveFineReset: function (baseDays) {
			if (!state.lockPhobosPhase) { return 0; }
			var off = solveFineOffsetForElongation(JD0 + baseDays, state.lockedElongation);
			var fMin = parseFloat(fineSlider.min), fMax = parseFloat(fineSlider.max);
			return Math.max(fMin, Math.min(fMax, off));
		}
	});

	// =======================================================================
	//  Refresh orchestration
	// =======================================================================
	function refreshDate() {
		placeBodies();
		buildPhobosOrbit();
		buildHook();
		buildTrajectory();
		computeReadouts();
	}

	function refreshHook() {
		buildHook();
		buildTrajectory();
		computeReadouts();
	}

	// =======================================================================
	//  Input parsing -- tether ends, release side/altitude, entry vehicle
	// =======================================================================
	// Keep the release slider/field range and the two remembered per-side
	// altitudes consistent with the current tether-end fields and side toggle.
	function applyReleaseSide() {
		var rng = activeRangeKm();
		relSlider.min = rng.min; relSlider.max = rng.max;
		state.relAlt = (state.releaseSide === "above") ? state.relAltAbove : state.relAltBelow;
		var km = state.relAlt / 1e3;
		km = Math.max(rng.min, Math.min(rng.max, km));
		state.relAlt = km * 1e3;
		if (state.releaseSide === "above") { state.relAltAbove = state.relAlt; } else { state.relAltBelow = state.relAlt; }
		relInput.value = Math.round(km);
		relSlider.value = km;
	}

	function readTetherInputs() {
		var top = parseFloat(topInput.value);
		var bot = parseFloat(botInput.value);
		var comAltKm = (A_PHOBOS - R_MARS) / 1e3;
		var ok = true;
		if (!isFinite(bot) || bot < 1) { bot = 1; ok = false; }
		if (bot > comAltKm - 1) { bot = comAltKm - 1; ok = false; }
		if (!isFinite(top) || top < comAltKm + 1) { top = comAltKm + 1; ok = false; }
		state.botAlt = bot * 1e3;
		state.topAlt = top * 1e3;
		// keep the remembered per-side release altitudes inside the new ranges
		state.relAltAbove = Math.max(comAltKm, Math.min(top, state.relAltAbove / 1e3)) * 1e3;
		state.relAltBelow = Math.max(bot, Math.min(comAltKm, state.relAltBelow / 1e3)) * 1e3;
		applyReleaseSide();
		return ok;
	}

	// Set the release altitude (km, above Mars' surface) from the number
	// field, the slider, or the draggable in-view marker -- the single path
	// all three release-altitude controls funnel through.
	function commitRelAlt(km) {
		var rng = activeRangeKm();
		km = Math.max(rng.min, Math.min(rng.max, km));
		relInput.value = Math.round(km);
		relInput.classList.remove("mps-bad");
		relSlider.value = km;
		state.relAlt = km * 1e3;
		if (state.releaseSide === "above") { state.relAltAbove = state.relAlt; } else { state.relAltBelow = state.relAlt; }
		refreshHook();
	}

	// The release-altitude slider: mousedown jumps to the clicked spot; the
	// drag that follows moves the value by the cursor's RELATIVE motion,
	// scaled 0.1x while Shift is held (checked every move) for fine control.
	function bindRelSlider() {
		var dragging = false, lx = 0;

		function valueAtClientX(clientX) {
			var rect = relSlider.getBoundingClientRect();
			var min = parseFloat(relSlider.min), max = parseFloat(relSlider.max);
			var frac = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
			frac = Math.max(0, Math.min(1, frac));
			return min + frac * (max - min);
		}

		relSlider.addEventListener("mousedown", function (e) {
			dragging = true;
			lx = e.clientX;
			commitRelAlt(valueAtClientX(e.clientX));
			e.preventDefault();
		});

		window.addEventListener("mousemove", function (e) {
			if (!dragging) { return; }
			var dx = e.clientX - lx;
			lx = e.clientX;
			var rect = relSlider.getBoundingClientRect();
			var min = parseFloat(relSlider.min), max = parseFloat(relSlider.max);
			var speed = e.shiftKey ? 0.1 : 1;
			var v = parseFloat(relSlider.value) + (rect.width > 0 ? (dx / rect.width) * (max - min) * speed : 0);
			v = Math.max(min, Math.min(max, v));
			commitRelAlt(v);
		});

		window.addEventListener("mouseup", function () { dragging = false; });

		relSlider.addEventListener("input", function () { commitRelAlt(parseFloat(relSlider.value)); });
	}

	// =======================================================================
	//  Burn-vector editor: an isometric 3-axis draggable-arrow widget
	// =======================================================================
	var SVGNS = "http://www.w3.org/2000/svg";
	function svgEl(tag, attrs) {
		var e = document.createElementNS(SVGNS, tag);
		for (var k in attrs) { e.setAttribute(k, attrs[k]); }
		return e;
	}
	function buildVectorEditor(host, values, onChange) {
		host.innerHTML = "";
		var W = 278, H = 300, OX = 139, OY = 150, SCALE = 7.5, MAXV = 15, LEN = MAXV * SCALE;
		var axes = [
			{ key: "pro", name: "prograde", col: "#6fd49a", dx:  Math.cos(-Math.PI/6), dy: Math.sin(-Math.PI/6) },
			{ key: "rad", name: "radial",   col: "#ffb45a", dx:  Math.cos( Math.PI/6), dy: Math.sin( Math.PI/6) },
			{ key: "nrm", name: "normal",   col: "#8ab4ff", dx: 0, dy: -1 }
		];

		var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "mps-vecwidget" });

		(function () {
			var ux = Math.cos(-Math.PI/6), uy = Math.sin(-Math.PI/6);
			var vx = -uy, vy = ux;
			function P(lx, ly) { return [OX + lx*ux + ly*vx, OY + lx*uy + ly*vy]; }
			var A1 = P(-20, -6), A2 = P(-9, -12), A3 = P(-9, 10), A4 = P(-20, 16), E = P(28, -1);
			function poly(pts, fill) {
				return svgEl("polygon", {
					points: pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "),
					fill: fill, stroke: "#0c0f17", "stroke-width": 1.2, "stroke-linejoin": "round" });
			}
			svg.appendChild(poly([A1, A2, A3, A4], "#595d66"));
			svg.appendChild(poly([A1, A2, E],      "#7e828c"));
			svg.appendChild(poly([A2, A3, E],      "#3b3e46"));
		})();

		axes.forEach(function (a) {
			svg.appendChild(svgEl("line", {
				x1: OX - a.dx*LEN, y1: OY - a.dy*LEN, x2: OX + a.dx*LEN, y2: OY + a.dy*LEN,
				stroke: a.col, "stroke-opacity": 0.22, "stroke-width": 1 }));
			var t = svgEl("text", { x: OX + a.dx*(LEN+11), y: OY + a.dy*(LEN+11),
				fill: a.col, "fill-opacity": 0.7, "font-size": 11,
				"text-anchor": "middle", "dominant-baseline": "central" });
			t.textContent = a.name.charAt(0).toUpperCase();
			svg.appendChild(t);
		});

		axes.forEach(function (a) {
			a.line = svgEl("line", { stroke: a.col, "stroke-width": 2.5, "stroke-linecap": "round" });
			a.head = svgEl("polygon", { fill: a.col });
			a.val  = svgEl("text", { fill: a.col, "font-size": 11, "font-weight": 600,
				"text-anchor": "middle", "dominant-baseline": "central" });
			svg.appendChild(a.line); svg.appendChild(a.head); svg.appendChild(a.val);
		});
		host.appendChild(svg);

		var nums = {};
		var row = document.createElement("div"); row.className = "mps-vec-nums";
		axes.forEach(function (a) {
			var cell = document.createElement("label"); cell.className = "mps-vec-num";
			var tag = document.createElement("span");
			tag.textContent = a.name.charAt(0).toUpperCase() + a.name.slice(1);
			tag.style.color = a.col;
			var inp = document.createElement("input");
			inp.type = "number"; inp.step = 0.01; inp.value = (values[a.key]/1000).toFixed(2);
			inp.addEventListener("change", function () {
				var v = parseFloat(inp.value); if (!isFinite(v)) { v = 0; }
				values[a.key] = v * 1000; redraw(); onChange(a.key, v * 1000);
			});
			nums[a.key] = inp;
			cell.appendChild(tag); cell.appendChild(inp); row.appendChild(cell);
		});
		host.appendChild(row);

		function redraw() {
			axes.forEach(function (a) {
				var v = values[a.key] / 1000;
				var vis = Math.max(-MAXV, Math.min(MAXV, v));
				var tx = OX + a.dx*vis*SCALE, ty = OY + a.dy*vis*SCALE;
				var show = Math.abs(vis) > 0.12;
				[a.line, a.head].forEach(function (n) { n.style.display = show ? "" : "none"; });
				if (show) {
					a.line.setAttribute("x1", OX); a.line.setAttribute("y1", OY);
					a.line.setAttribute("x2", tx); a.line.setAttribute("y2", ty);
					var s = vis < 0 ? -1 : 1, hx = s*a.dx, hy = s*a.dy, px = -hy, py = hx;
					var bx = tx - hx*9, by = ty - hy*9;
					a.head.setAttribute("points",
						tx + "," + ty + " " + (bx+px*5) + "," + (by+py*5) + " " + (bx-px*5) + "," + (by-py*5));
				}
				if (Math.abs(v) > 0.005) {
					a.val.style.display = "";
					a.val.setAttribute("x", tx + (vis<0?-1:1)*a.dx*15);
					a.val.setAttribute("y", ty + (vis<0?-1:1)*a.dy*15);
					a.val.textContent = v.toFixed(2);
				} else { a.val.style.display = "none"; }
				if (document.activeElement !== nums[a.key]) { nums[a.key].value = v.toFixed(2); }
			});
		}

		function toVB(e) {
			var r = svg.getBoundingClientRect();
			return [ (e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H ];
		}
		function pickAxis(px, py) {
			var best = -1, bestPerp = 18, rx = px - OX, ry = py - OY;
			for (var i = 0; i < axes.length; i++) {
				var a = axes[i];
				var proj = rx*a.dx + ry*a.dy, perp = Math.abs(rx*a.dy - ry*a.dx);
				if (Math.abs(proj) > 6 && perp < bestPerp) { bestPerp = perp; best = i; }
			}
			return best;
		}
		var dragIdx = -1, lastVB = null;
		var BURN_SENS = 1 / (SCALE * 10);
		function setAxisAbsolute(p, a) {
			var proj = (p[0] - OX) * a.dx + (p[1] - OY) * a.dy;
			var v = Math.max(-MAXV, Math.min(MAXV, proj / SCALE));
			values[a.key] = v * 1000;
			redraw();
			onChange(a.key, v * 1000);
		}
		svg.addEventListener("pointerdown", function (e) {
			var p = toVB(e), idx = pickAxis(p[0], p[1]);
			if (idx < 0) { return; }
			dragIdx = idx; lastVB = p;
			setAxisAbsolute(p, axes[idx]);
			try { svg.setPointerCapture(e.pointerId); } catch (err) {}
			e.preventDefault();
		});
		svg.addEventListener("pointermove", function (e) {
			if (dragIdx < 0) { return; }
			var p = toVB(e), a = axes[dragIdx];
			var dproj = (p[0] - lastVB[0]) * a.dx + (p[1] - lastVB[1]) * a.dy;
			lastVB = p;
			var sens = BURN_SENS * (e.shiftKey ? 0.25 : 1);
			var v = Math.max(-MAXV, Math.min(MAXV, values[a.key] / 1000 + dproj * sens));
			values[a.key] = v * 1000;
			redraw();
			onChange(a.key, v * 1000);
		});
		function endDrag() { dragIdx = -1; lastVB = null; }
		svg.addEventListener("pointerup", endDrag);
		svg.addEventListener("pointercancel", endDrag);

		host._mpsRedraw = redraw;
		redraw();
	}

	// =======================================================================
	//  Waypoint list (sidebar cards): title, remove, burn-vector editor.
	// =======================================================================
	function buildWaypointList() {
		wpList.innerHTML = "";
		wpEmpty.style.display = state.waypoints.length ? "none" : "block";
		state.waypoints.forEach(function (wp, idx) {
			var card = document.createElement("div"); card.className = "mps-waypoint";
			var head = document.createElement("div"); head.className = "mps-waypoint-head";
			var title = document.createElement("span"); title.className = "mps-wp-title";
			title.textContent = "WP " + (idx + 1);
			var rm = document.createElement("button"); rm.className = "mps-wp-x";
			rm.type = "button";
			rm.textContent = "✕"; rm.title = "remove waypoint";
			rm.addEventListener("click", function () {
				state.waypoints.splice(idx, 1);
				// Target mode needs a waypoint burn to solve into -- if that was
				// the last one, fall back to Free (setMarkerMode() refreshes).
				if (state.waypoints.length === 0 && state.marker && state.marker.mode === "target") {
					setMarkerMode("free");
				} else {
					refreshHook();
				}
			});
			head.appendChild(title); head.appendChild(rm);
			card.appendChild(head);

			// snap-to controls: place the waypoint on a chosen orbital feature of
			// the post-escape heliocentric chain (see computeHelioChain). Mutually
			// exclusive -- selecting one clears the others; ticking the active one
			// again clears it (ported from the Solar-System-Trajectory-Plotter's
			// waypoint model).
			var snapRow = document.createElement("div"); snapRow.className = "mps-wp-snaps";
			var snapBoxes = {};
			var nodeLab = wp._nodeLabel || {};
			[["peri", "periapsis"], ["apo", "apoapsis"], ["asc", nodeLab.asc || "ascending node"],
			 ["desc", nodeLab.desc || "descending node"]].forEach(function (d) {
				var lab = document.createElement("label"); lab.className = "mps-wp-snap";
				var cb = document.createElement("input"); cb.type = "checkbox";
				cb.checked = (wp.snap === d[0]);
				if (d[0] === "peri" && wp._periAvailable === false) { cb.disabled = true; }
				if (d[0] === "apo" && wp._apoAvailable === false) { cb.disabled = true; }
				var txt = document.createElement("span"); txt.textContent = d[1];
				cb.addEventListener("change", function () {
					wp.snap = cb.checked ? d[0] : null;
					Object.keys(snapBoxes).forEach(function (k) {
						snapBoxes[k].cb.checked = (wp.snap === k);
					});
					refreshHook();
				});
				snapBoxes[d[0]] = { cb: cb, txt: txt, lab: lab };
				lab.appendChild(cb); lab.appendChild(txt); snapRow.appendChild(lab);
			});
			wp._snapBoxes = snapBoxes;
			card.appendChild(snapRow);

			// fine-tune slider: slides the waypoint +/-90 deg along the leg's arc,
			// centred on the snapped feature. Active only while a snap is chosen.
			var slider = document.createElement("input");
			slider.type = "range"; slider.className = "mps-wp-slider";
			slider.min = -90; slider.max = 90; slider.step = 1;
			slider.value = Math.round((wp.snapOffset || 0) * 180 / Math.PI);
			slider.disabled = !wp.snap;
			slider.title = "slide ±90° along the arc, around the snapped point";
			slider.addEventListener("input", function () {
				wp.snapOffset = parseFloat(slider.value) * Math.PI / 180;
				refreshHook();
			});
			wp._slider = slider;
			card.appendChild(slider);

			var info = document.createElement("div"); info.className = "mps-muted";
			info.id = "mps-wp-info-" + idx;
			card.appendChild(info);

			var vecHost = document.createElement("div");
			card.appendChild(vecHost);
			wp._host = vecHost;
			buildVectorEditor(vecHost, wp.burn, function (axis, mps) {
				wp.burn[axis] = mps; refreshHook();
			});
			wpList.appendChild(card);
		});
	}

	// =======================================================================
	//  Destination + marker: a slidable ship probe on the post-escape
	//  heliocentric coast, with a destination body's "arrival position" X,
	//  two proximity read-outs (temporal phasing + a spatial near-orbit
	//  gate), and Free/Track/Target modes. Solar-system (Helio) view only --
	//  see the module-level comment above chainSegs for the "departure ==
	//  Mars-escape" convention this whole section uses.
	// =======================================================================

	// Cache the current post-escape chain's lookup arrays; called from
	// buildTrajectory() right after computeTrajectory(). Empties everything
	// when there is no chain (the trajectory hasn't escaped Mars yet).
	function syncChainGlobals(res) {
		var chain = res.helioChain;
		chainSegs = []; chainSamplesAU = []; chainTotalT = 0; chainJdeEscape = 0;
		if (!chain) { return; }
		chainSegs = chain.segs;
		chainJdeEscape = chain.jdeEscape;
		chain.segs.forEach(function (s) { chainTotalT += s.dur; });
		chainSamplesAU = chain.samples.map(function (s) {
			return { pos: new THREE.Vector3(s.r[0]/AU_M, s.r[1]/AU_M, s.r[2]/AU_M), t: s.t };
		});
	}

	// Heliocentric state (r,v in m, m/s) at a global time along the chain
	// (t = 0 at Mars-escape).
	function stateAtGlobalTime(t) {
		if (!chainSegs.length) { return null; }
		var seg = chainSegs[chainSegs.length - 1];
		for (var i = 0; i < chainSegs.length; i++) {
			if (t <= chainSegs[i].tStart + chainSegs[i].dur + 1e-6) { seg = chainSegs[i]; break; }
		}
		var dt = Math.max(0, Math.min(seg.dur, t - seg.tStart));
		return O.propagateState(GM_S, seg.r0, seg.v0, dt);
	}

	// markerFraction, fmtKm/fmtTof/fmtDate: Shared/sim/marker-card.js.

	// Heliocentric angle (deg, 0-360) swept around the Sun from the Mars-
	// escape point to a point r (m). Shared/sim/marker-card.js's
	// sweepAngleFrom, given the escape r0/v0.
	function sweptSinceEscape(r) {
		if (!chainSegs.length) { return 0; }
		return sweepAngleFrom(chainSegs[0].r0, chainSegs[0].v0, r);
	}

	// Golden-section refine of closest approach to `orbit` over chain-time
	// [tA,tB], using the true Kepler state (stateAtGlobalTime). Returns
	// {r (m), dist (m), t} at the minimum. (Shared/sim/marker-card.js's
	// refineApproach, kept as a thin wrapper since it's called from several
	// places below with just tA/tB.)
	function refineApproach(orbit, tA, tB) {
		return mcRefineApproach(orbit, stateAtGlobalTime, tA, tB);
	}

	// How close does the WHOLE current coast (independent of where the marker
	// happens to be) ever get to a destination's orbit? A bare Mars-escape
	// release only imparts a fixed tangential kick (see releaseState/hookPro),
	// so it barely moves the resulting heliocentric perihelion away from
	// Mars's own -- most destinations never come near APPROACH_FAR without a
	// waypoint burn reshaping the leg. Rather than let the proximity ring just
	// silently never appear, this scans the whole chain (coarse pass, then a
	// golden-section refine around the best sample) so the Destination panel
	// can report the true closest approach and offer to jump the marker there.
	// Returns {r (m), dist (m), t (chain-time, s)} or null with no chain/orbit.
	function closestApproachToDestination(dn) {
		if (!chainSegs.length || chainTotalT <= 0) { return null; }
		if (!dn || dn === "(none)" || dn === "Mars") { return null; }
		var orbit = systems.get(dn).orbit;
		if (!orbit || orbit.e >= 1) { return null; }
		var N = 120, bestD = Infinity, bestI = 0;
		for (var i = 0; i <= N; i++) {
			var t = (i / N) * chainTotalT;
			var s = stateAtGlobalTime(t);
			var d = s ? O.distanceToOrbit(orbit, s.r) : Infinity;
			if (d < bestD) { bestD = d; bestI = i; }
		}
		var lo = Math.max(0, bestI - 1) / N * chainTotalT;
		var hi = Math.min(N, bestI + 1) / N * chainTotalT;
		var r = refineApproach(orbit, lo, hi);
		if (r && r.dist <= bestD) { return r; }
		var tBest = (bestI / N) * chainTotalT, sBest = stateAtGlobalTime(tBest);
		return sBest ? { r: sBest.r, dist: bestD, t: tBest } : null;
	}

	// Keep the marker glued to the destination-orbit crossing while it is
	// inside an encounter ring; freeze (do nothing) when out of range, so it
	// never skips to a far crossing. Drives state.marker.f0/angle. Used by
	// Track mode and by a released Target mode.
	function followCrossing() {
		if (!state.marker || !chainSegs.length) { return; }
		var dn = state.destination;
		if (!dn || dn === "(none)" || dn === "Mars") { return; }
		var orbit = systems.get(dn).orbit;
		mcFollowCrossing(state.marker, orbit, chainTotalT, chainSamplesAU.length, stateAtGlobalTime, APPROACH_FAR);
	}

	// Target mode: hold the arrival date fixed and re-solve the LAST
	// waypoint's burn via Lambert so the ship still reaches the destination
	// body at that arrival time as the ephemeris date scrubs. Unlike the
	// sister tool, there is no "departure burn" at the Mars-escape point to
	// fall back on when there are no waypoints (the escape state is wherever
	// the integrated Mars+Sun leg happened to cross the boundary, not a
	// user-set burn) -- so Target mode requires at least one waypoint; see
	// setMarkerMode / updateMarker for where that's enforced in the UI. If
	// the required Δv exceeds the budget it "releases": the burn reverts to
	// its captured baseline and the marker falls back to geometric tracking.
	// Runs at the very start of buildTrajectory(), before the trajectory is
	// (re)computed for drawing, so the drawn arc reflects the solved burn.
	function applyTargeting() {
		var m = state.marker;
		if (!m || m.mode !== "target") { return; }
		if (state.waypoints.length === 0) {
			m._encT = null; m._targetDv = null; m._released = true; m._targetMsg = "add a waypoint first";
			return;
		}
		var term = state.waypoints[state.waypoints.length - 1].burn;
		function restoreBase() {
			if (m._baseBurn) { term.pro = m._baseBurn.pro; term.rad = m._baseBurn.rad; term.nrm = m._baseBurn.nrm; }
		}
		function hardFail(msg) { restoreBase(); m._encT = null; m._targetDv = null; m._released = true; m._targetMsg = msg; }

		var dn = state.destination;
		if (!dn || dn === "(none)" || dn === "Mars" || m.targetArrJd == null) { hardFail("no target"); return; }
		var destOrbit = systems.get(dn).orbit;
		if (!destOrbit || destOrbit.e >= 1) { hardFail("no target"); return; }

		var res = computeTrajectory();              // frozen upstream state (this burn not yet re-solved)
		var chain = res.helioChain;
		if (!chain) { hardFail("hasn't escaped Mars"); return; }
		var p = chain.points[state.waypoints.length - 1];
		if (!p) { hardFail("no leg"); return; }

		var tof = (m.targetArrJd - chain.jdeEscape) * DAY - p.tGlobal;
		if (!(tof > DAY)) { hardFail("arrival ≤ burn"); return; }
		var target = O.bodyStateAtJD(GM_S, destOrbit, m.targetArrJd).r;
		var sol = O.lambert(GM_S, p.r, target, tof, true);
		if (!sol) { hardFail("no solution"); return; }

		var dv = O.vSub(sol.v1, p.vBefore), dvMag = O.vMag(dv);
		m._targetDv = dvMag; m._targetMsg = null;
		if (dvMag > (m.dvBudget || 0)) { restoreBase(); m._encT = null; m._released = true; return; }  // over budget

		var vhat = O.vUnit(p.vBefore), nhat = O.vUnit(O.vCross(p.r, p.vBefore)), rhat = O.vUnit(O.vCross(nhat, vhat));
		term.pro = O.vDot(dv, vhat); term.nrm = O.vDot(dv, nhat); term.rad = O.vDot(dv, rhat);
		m._encT = p.tGlobal + tof; m._released = false;
	}

	// Host element of the last waypoint's burn-vector editor (for live
	// redraw when Target mode drives that burn), or null with no waypoints.
	function terminalBurnHost() {
		var nW = state.waypoints.length;
		return nW ? state.waypoints[nW - 1]._host : null;
	}

	// Switch the marker behaviour. Entering Target freezes the current
	// arrival date and snapshots both the terminal burn and the marker's own
	// position (so each can be restored); leaving Target restores that
	// manual burn and puts the marker back where it was -- see the sister
	// tool's identical comment for why restoring the marker position matters
	// (it keeps repeated Free<->Target round trips from drifting the solved
	// arrival date). Then a full refresh runs the solver and redraws.
	function setMarkerMode(mode) {
		var m = state.marker;
		if (!m) { return; }
		if (mode === "target" && state.waypoints.length === 0) { return; }   // nothing to solve into
		function termBurn() {
			var nW = state.waypoints.length;
			return nW ? (state.waypoints[nW - 1] || {}).burn : null;
		}
		if (m.mode === "target" && mode !== "target" && m._baseBurn) {
			var tb = termBurn();
			if (tb) { tb.pro = m._baseBurn.pro; tb.rad = m._baseBurn.rad; tb.nrm = m._baseBurn.nrm; }
			m._baseBurn = null;
			if (m._savedF0 != null) { m.f0 = m._savedF0; m.angle = m._savedAngle; m._savedF0 = null; }
		}
		if (mode === "target") {
			m._savedF0 = m.f0; m._savedAngle = m.angle;
			var tof = mcMarkerFraction(m.f0, m.angle) * chainTotalT;
			m.targetArrJd = chainJdeEscape + tof / DAY;
			var tb2 = termBurn();
			m._baseBurn = tb2 ? { pro: tb2.pro, rad: tb2.rad, nrm: tb2.nrm } : { pro: 0, rad: 0, nrm: 0 };
			if (m.dvBudget == null) { m.dvBudget = 10000; }
			m._released = false;
		}
		m.mode = mode;
		updateMarkerModeButtons();
		refreshHook();
	}

	// Position the destination "X" (body at arrival), the temporal ring and
	// the phasing readout, given the ship's meeting point markerR (m) and
	// its time-of-flight since escape, tofSec (s).
	function updateDestinationMarker(markerR, tofSec) {
		var dn = state.destination, active = dn && dn !== "(none)" && dn !== "Mars";
		if (!active) {
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			if (markerValPhase) { markerValPhase.textContent = "—"; }
			return;
		}
		var orbit = systems.get(dn).orbit;
		var arrJd = chainJdeEscape + tofSec / DAY;
		var b = O.bodyStateAtJD(GM_S, orbit, arrJd);
		if (!destSprite) { destSprite = makeXMarkSprite(); destSprite.renderOrder = 13; Helio.scene.add(destSprite); }
		destSprite.visible = true;
		destSprite.material.color.set(systems.get(dn).color || "#ffffff");
		destSprite.position.set(b.r[0] / AU_M, b.r[1] / AU_M, b.r[2] / AU_M);

		var nearOrbit = orbit.e < 1 && O.distanceToOrbit(orbit, markerR) < APPROACH_FAR;
		if (nearOrbit) {
			var dt = mcPhasingDays(GM_S, orbit, markerR, arrJd);
			markerValPhase.textContent = (dt >= 0 ? "+" : "−") + Math.abs(dt).toFixed(1) + " d";
			var ad = Math.abs(dt);
			var tier = pickProximityTier(ad, TEMP_FAR, TEMP_NEAR, TEMP_CLOSE);
			if (tier >= 0) {
				if (!tempRing) { tempRing = makeTempRing(); Helio.scene.add(tempRing); }
				applyTierToSprite(tempRing, TEMPORAL_TIERS[tier]);
				tempRing.visible = true;
				if (markerSprite) { tempRing.position.copy(markerSprite.position); }
			} else if (tempRing) { tempRing.visible = false; }
		} else {
			markerValPhase.textContent = "—";
			if (tempRing) { tempRing.visible = false; }
		}
	}

	function updateMarkerModeButtons() {
		mcUpdateMarkerModeButtons(markerModeBtns, "mps", state.marker && state.marker.mode);
	}

	// Build the floating top-left marker card (once), via Shared/sim/marker-card.js,
	// appended to #mps-view. Holds the slider, the Free/Track/Target selector,
	// and the readouts.
	function buildMarkerCard() {
		var built = mcBuildMarkerCard({
			classPrefix: "mps",
			hostEl: viewEl || document.body,
			sliderTitle: "drag to slide the marker along the whole post-escape coast (0° = where you clicked); "
				+ "~10× more mouse travel than the track for fine control, ×4 finer again with Shift. "
				+ "Arrow keys nudge by ⅓° (¹⁄₁₂° with Shift) when focused.",
			modeTitles: {
				free: "slide the marker freely",
				track: "follow the destination orbit crossing while within an encounter ring (burns fixed)",
				target: "re-solve the last waypoint's burn (Lambert) to hold the encounter as the date scrubs; needs at least one waypoint; releases above the Δv budget"
			},
			rows: [
				{ key: "rad", label: "radius" },
				{ key: "spd", label: "prograde velocity" },
				{ key: "lat", label: "ecliptic latitude" },
				{ key: "deg", label: "swept since escape" },
				{ key: "tof", label: "time of flight" },
				{ key: "arr", label: "arrival date" },
				{ key: "phase", label: "phasing" }
			],
			getAngle: function () { return state.marker ? state.marker.angle : 0; },
			onSliderChange: function (a) { if (state.marker) { state.marker.angle = a; updateMarker(); } },
			onRemove: function () { removeMarker(); },
			onModeClick: function (mode) { setMarkerMode(mode); },
			onBudgetChange: function (dvBudget) { if (state.marker) { state.marker.dvBudget = dvBudget; refreshHook(); } }
		});
		markerCard = built.el;
		markerSlider = built.slider;
		markerModeBtns = built.modeBtns;
		markerValRad = built.vals.rad; markerValRadKm = built.vals.radKm;
		markerValSpd = built.vals.spd; markerValLat = built.vals.lat; markerValDeg = built.vals.deg;
		markerValTof = built.vals.tof; markerValArr = built.vals.arr; markerValPhase = built.vals.phase;
		markerBudgetRow = built.budgetRow; markerBudgetInput = built.budgetInput;
		markerTdvRow = built.tdvRow; markerValTdv = built.valTdv;
	}

	// Recompute the marker's world position and card readouts from its
	// slider angle and the current chain. The card is only ever SHOWN in the
	// solar-system view (it's an HTML overlay on the shared #mps-view pane,
	// which both scenes share), but its underlying sprite math still runs
	// regardless of view so switching views is instantly correct.
	function updateMarker() {
		if (!state.marker || !Helio.built) {
			if (markerSprite) { markerSprite.visible = false; }
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			if (markerCard) { markerCard.style.display = "none"; }
			return;
		}
		if (!markerSprite) { markerSprite = makeShipSprite(); Helio.scene.add(markerSprite); }
		if (!markerCard) { buildMarkerCard(); }
		var showCard = state.view === "helio";

		if (!state.marker.mode) { state.marker.mode = "free"; }
		if (state.marker.mode === "track") { followCrossing(); }
		else if (state.marker.mode === "target") {
			if (!state.marker._released && state.marker._encT != null && chainTotalT > 0) {
				state.marker.f0 = Math.max(0, Math.min(1, state.marker._encT / chainTotalT));
				state.marker.angle = 0;                          // sit at the solved encounter
			} else { followCrossing(); }                         // released -> behave like Track
		}

		var f = mcMarkerFraction(state.marker.f0, state.marker.angle);
		var tof = f * chainTotalT;
		var s = stateAtGlobalTime(tof);
		if (!s) {
			markerSprite.visible = false; markerCard.style.display = "none";
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			return;
		}

		markerSprite.visible = true;
		markerSprite.position.set(s.r[0] / AU_M, s.r[1] / AU_M, s.r[2] / AU_M);
		markerVelDir = new THREE.Vector3(s.v[0], s.v[1], s.v[2]).normalize();

		var rmag = O.vMag(s.r);
		var lat  = Math.asin(Math.max(-1, Math.min(1, s.r[2] / rmag))) * 180 / Math.PI;
		markerCard.style.display = showCard ? "" : "none";
		markerValRad.textContent = (rmag / AU_M).toFixed(3) + " AU";
		markerValRadKm.textContent = fmtKm(rmag);
		markerValSpd.textContent = (O.vMag(s.v) / 1000).toFixed(2) + " km/s";
		markerValLat.textContent = (lat >= 0 ? "+" : "−") + Math.abs(lat).toFixed(1) + "°";
		markerValDeg.textContent = sweptSinceEscape(s.r).toFixed(1) + "°";
		markerValTof.textContent = fmtTof(tof);
		markerValArr.textContent = fmtDate(chainJdeEscape + tof / DAY);

		updateDestinationMarker(s.r, tof);

		if (markerSlider) {
			markerSlider.disabled = (state.marker.mode !== "free");   // position driven in Track/Target
			if (document.activeElement !== markerSlider) { markerSlider.value = state.marker.angle; }
		}

		var isTarget = state.marker.mode === "target";
		if (markerBudgetRow) { markerBudgetRow.style.display = isTarget ? "" : "none"; }
		if (markerTdvRow) { markerTdvRow.style.display = isTarget ? "" : "none"; }
		if (isTarget) {
			if (markerBudgetInput && document.activeElement !== markerBudgetInput) {
				markerBudgetInput.value = ((state.marker.dvBudget || 0) / 1000).toFixed(1);
			}
			if (markerValTdv) {
				if (state.marker._targetDv != null) {
					markerValTdv.textContent = (state.marker._targetDv / 1000).toFixed(2) + " km/s"
						+ (state.marker._released ? " — released" : "");
					markerValTdv.style.color = state.marker._released ? "#ff8a8a" : "#9fe0ff";
				} else {
					markerValTdv.textContent = state.marker._targetMsg || "—";
					markerValTdv.style.color = "#ff8a8a";
				}
			}
		}
		if (markerModeBtns.target) {
			var targetOK = state.waypoints.length > 0;
			markerModeBtns.target.disabled = !targetOK;
			markerModeBtns.target.title = targetOK
				? "re-solve the last waypoint's burn (Lambert) to hold the encounter as the date scrubs; releases above the Δv budget"
				: "add a waypoint first — Target needs a burn to solve into";
		}
		updateMarkerModeButtons();
		if (state.markerFocused) { Helio.cam.target.copy(markerSprite.position); }
	}

	// Make the marker the Helio camera's pivot. Triggered when the marker is
	// created or its ship sprite is clicked.
	function focusMarker() {
		if (!state.marker || !markerSprite) { return; }
		state.markerFocused = true;
		state.focus = null;
		Helio.cam.target.copy(markerSprite.position);
		setHud("Focused on marker — drag to rotate around it, wheel to zoom in.");
	}

	function removeMarker() {
		state.marker = null;
		state.markerFocused = false;
		if (markerSprite) { markerSprite.visible = false; }
		if (destSprite) { destSprite.visible = false; }
		if (tempRing) { tempRing.visible = false; }
		if (markerCard) { markerCard.style.display = "none"; }
		setHud("Marker removed. Click the trajectory (in the solar system view) to place a new one.");
	}

	// Place (or move) the marker at a global chain time; that point becomes
	// 0° on the slider and the Helio camera focus.
	function placeMarkerAtGlobalTime(t) {
		var f0 = chainTotalT > 0 ? Math.max(0, Math.min(1, t / chainTotalT)) : 0;
		var budget = (state.marker && state.marker.dvBudget != null) ? state.marker.dvBudget : 10000;
		if (state.marker && state.marker.mode === "target" && state.marker._baseBurn && state.waypoints.length) {
			var tb = state.waypoints[state.waypoints.length - 1].burn;
			if (tb) { tb.pro = state.marker._baseBurn.pro; tb.rad = state.marker._baseBurn.rad; tb.nrm = state.marker._baseBurn.nrm; }
		}
		state.marker = { f0: f0, angle: 0, mode: "free", dvBudget: budget };
		updateMarker();
		focusMarker();
	}

	// A plain click in the solar-system view places/moves the marker on the
	// nearest point of the post-escape heliocentric coast; clicking the
	// marker's own ship sprite just refocuses the camera on it.
	function handleHelioPick(e) {
		if (!chainSamplesAU.length) { return; }
		var rect = renderer.domElement.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		var hcam = Helio.camera;

		if (state.marker && markerSprite && markerSprite.visible) {
			var mv = markerSprite.position.clone().project(hcam);
			if (mv.z <= 1) {
				var mx = (mv.x * 0.5 + 0.5) * rect.width, my = (-mv.y * 0.5 + 0.5) * rect.height;
				if (Math.hypot(mx - px, my - py) < 16) { focusMarker(); return; }
			}
		}

		var best = -1, bestD = 14;
		for (var i = 0; i < chainSamplesAU.length; i++) {
			var v = chainSamplesAU[i].pos.clone().project(hcam);
			if (v.z > 1) { continue; }
			var sx = (v.x * 0.5 + 0.5) * rect.width;
			var sy = (-v.y * 0.5 + 0.5) * rect.height;
			var d = Math.hypot(sx - px, sy - py);
			if (d < bestD) { bestD = d; best = i; }
		}
		if (best < 0) {
			if (state.markerFocused) {
				state.markerFocused = false;
				setHud("Marker unfocused — drag to navigate freely; click the marker to refocus.");
			}
			return;
		}
		placeMarkerAtGlobalTime(chainSamplesAU[best].t);
	}

	// ---- marker/destination sprite factories -------------------------------
	// Shared/sim/marker-card.js's makeShipSprite/makeXMarkSprite.

	// A temporal-proximity ring around the ship (one blue texture; tier sets
	// colour/opacity/size). Held at constant on-screen size by Helio.updateGizmos()
	// (Shared/sim/approach-markers.js).
	function makeTempRing() { return makeRingSprite({ lineWidth: 7, px: 30, renderOrder: 13 }); }

	function buildDestinationOptions() {
		if (!destSel) { return; }
		var none = document.createElement("option");
		none.value = "(none)"; none.textContent = "(none)";
		if (state.destination === "(none)") { none.selected = true; }
		destSel.appendChild(none);
		Helio.BODIES.forEach(function (name) {
			if (name === "Mars") { return; }     // Mars is the implicit origin here
			var opt = document.createElement("option");
			opt.value = name; opt.textContent = name;
			if (name === state.destination) { opt.selected = true; }
			destSel.appendChild(opt);
		});
	}

	// =======================================================================
	//  Solar-system context view (heliocentric overlay)
	// =======================================================================
	// A second, self-contained Three.js scene sharing the single renderer: the
	// Sun, the planets and their orbits (Shared/orbit.js, AU units), plus the
	// current released trajectory in TRUE heliocentric coordinates. Mars'
	// heliocentric position/velocity comes directly from its Keplerian
	// elements (marsHelioState) -- every leg here is already absolute
	// Mars-centred (see file header), so patching to heliocentric is just one
	// vector add per sample, no "moon-relative" branch needed.
	var Helio = {
		AU: 149597870700,
		BODIES: ["Mercury", "Venus", "Earth", "Mars", "Ceres", "Vesta",
		         "Psyche", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"],
		built: false,
		scene: null, camera: null,
		cam: createCam(6, 0.6, 1.1, new THREE.Vector3(0, 0, 0)),
		bodyGroups: {}, orbitLines: {}, scaleList: [], labelList: [], labelLayer: null,
		sunGroup: null, trajGroup: null, wpGizmos: [],

		init: function () {
			if (this.built) { return; }
			var self = this, AU = this.AU, GM_SUN = GM_S, SUN_SYS = systems.get("Sun");

			var sc = new THREE.Scene();
			this.scene = sc;
			this.camera = new THREE.PerspectiveCamera(45, 1, 1e-5, 5000);

			sc.add(new THREE.AmbientLight(0x556070, 0.6));
			sc.add(new THREE.PointLight(0xffffff, 1.4, 0, 0));

			(function () {
				var g = new THREE.BufferGeometry(), n = 1200, arr = new Float32Array(n * 3);
				for (var i = 0; i < n; i++) {
					var u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
					arr[i*3] = 800 * s * Math.cos(a); arr[i*3+1] = 800 * s * Math.sin(a); arr[i*3+2] = 800 * u;
				}
				g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
				sc.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x666f86, size: 1.5, sizeAttenuation: false })));
			})();

			this.labelLayer = document.createElement("div");
			this.labelLayer.id = "mps-helio-labels";
			this.labelLayer.style.display = "none";
			holder.appendChild(this.labelLayer);

			var sunBody = createSunBody(sc, this.scaleList, { sys: SUN_SYS, AU: AU });
			this.sunGroup = sunBody.group;
			this.addLabel("Sun", this.sunGroup);

			this.BODIES.forEach(function (name) {
				var sys = systems.get(name);
				var b = createBody(sc, self.scaleList, name, { sys: sys, AU: AU, primaryMass: M_SUN });
				self.bodyGroups[name] = { group: b.group, core: b.core, soi: b.soi, point: b.point };
				self.addLabel(name, b.group);
				var line = createKeplerOrbitRing({
					orbit: sys.orbit, GM: GM_SUN, color: new THREE.Color(sys.color || "#bcc3d0"), AU: AU });
				sc.add(line);
				self.orbitLines[name] = line;
			});

			this.built = true;
			this.resize();
		},

		// Shared/sim/body-renderer.js.
		addLabel: function (name, group) { brAddLabel(this.labelLayer, this.labelList, name, group, "mps-label"); },

		placeBodies: function () {
			if (!this.built) { return; }
			var AU = this.AU;
			this.BODIES.forEach(function (name) {
				var s = O.bodyStateAtJD(GM_S, systems.get(name).orbit, state.jd);
				Helio.bodyGroups[name].group.position.set(s.r[0]/AU, s.r[1]/AU, s.r[2]/AU);
			});
		},

		// Draw the released trajectory in true heliocentric coordinates (each
		// leg coloured by its outcome), plus -- when the path escapes to a
		// heliocentric orbit -- the full predicted orbit from the computed
		// elements.
		updateTrajectory: function (res) {
			if (!this.built) { return; }
			var AU = this.AU;
			if (this.trajGroup) { this.scene.remove(this.trajGroup); disposeGroup(this.trajGroup); }
			this.wpGizmos = [];
			var grp = new THREE.Group();
			if (!res) { this.trajGroup = grp; this.scene.add(grp); return; }

			// initial (Mars+Sun RK4) leg, reprojected into true heliocentric
			// coords -- drawn in FULL (waypoints never attach to it; see
			// computeTrajectory's file header).
			var leg0 = res.legs[0];
			var pts0 = [];
			for (var k = 0; k < leg0.samples.length; k++) {
				var smp = leg0.samples[k];
				var jde = leg0.jde0 + smp.t / 86400;
				var mh = marsHelioState(jde);
				pts0.push(new THREE.Vector3((mh.r[0]+smp.r[0])/AU, (mh.r[1]+smp.r[1])/AU, (mh.r[2]+smp.r[2])/AU));
			}
			if (pts0.length > 1) {
				grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts0),
					new THREE.LineBasicMaterial({ color: leg0.color })));
			}

			// post-escape waypoint chain (computeHelioChain): a pure two-body
			// Sun-only Kepler arc-chain, already absolute heliocentric (m) -- no
			// Mars-position offset needed, unlike the initial leg above. Drawn in
			// the SAME colour as the initial leg: it's one continuous trajectory,
			// just past the point Mars' influence is dropped.
			var chain = res.helioChain;
			var self = this;
			if (chain) {
				var pts1 = chain.samples.map(function (smp) {
					return new THREE.Vector3(smp.r[0]/AU, smp.r[1]/AU, smp.r[2]/AU);
				});
				if (pts1.length > 1) {
					grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts1),
						new THREE.LineBasicMaterial({ color: leg0.color })));
				}

				chain.points.forEach(function (p) {
					var pos = new THREE.Vector3(p.r[0]/AU, p.r[1]/AU, p.r[2]/AU);
					var g = createWaypointGizmo(p.r, p.vBefore, pos);
					grp.add(g);
					self.wpGizmos.push(g);

					var dSpeed = O.vMag(p.vAfter) - O.vMag(p.vBefore);
					var dSpeedVec = O.vScale(O.vUnit(p.vAfter), dSpeed);
					var dv = O.vSub(p.vAfter, p.vBefore);
					[ { vec: dSpeedVec, col: DSPEED_COLOR },
					  { vec: dv,        col: DV_COLOR } ].forEach(function (a) {
						var arrow = burnWidgetArrow(pos, a.vec, a.col, 0.03, 0.02);
						if (arrow) { grp.add(arrow); }
					});
				});

				// predicted final orbit: the EXACT elements of the final coast
				// segment (post last burn, if any) -- always available once the
				// chain exists (even with zero waypoints), unlike the initial
				// leg's escape estimate (see the "heliocentric apsides are an
				// estimate" note next to the trajectory read-out).
				var finalSeg = chain.segs[chain.segs.length - 1];
				if (finalSeg) {
					var elF = O.elementsFromState(GM_S, finalSeg.r0, finalSeg.v0);
					var pts2 = [];
					if (elF.e < 1 && isFinite(elF.a)) {
						for (var j = 0; j <= 360; j++) {
							var nu = 2 * Math.PI * j / 360;
							var s = O.stateFromElements(GM_S, elF.a, elF.e, elF.i, elF.Omega, elF.omega, nu);
							pts2.push(new THREE.Vector3(s.r[0]/AU, s.r[1]/AU, s.r[2]/AU));
						}
					} else if (elF.e > 1) {
						var lim = Math.acos(-1 / elF.e) * 0.985;
						for (var j2 = -160; j2 <= 160; j2++) {
							var s2 = O.stateFromElements(GM_S, elF.a, elF.e, elF.i, elF.Omega, elF.omega, lim * j2 / 160);
							if (isFinite(s2.r[0])) { pts2.push(new THREE.Vector3(s2.r[0]/AU, s2.r[1]/AU, s2.r[2]/AU)); }
						}
					}
					if (pts2.length > 1) {
						grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2),
							new THREE.LineBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.5 })));
					}
				}
			}

			grp.visible = trajToggle ? trajToggle.checked : true;
			this.trajGroup = grp;
			this.scene.add(grp);
		},

		// Shared/sim/body-renderer.js.
		updateScales: function () {
			brUpdateScales(this.camera, holder, this.scaleList, { wantSOI: soiToggle.checked });
		},
		updateLabels: function () {
			brUpdateLabels(this.camera, holder, this.labelList);
		},
		resize: function () {
			if (!this.built) { return; }
			var w = holder.clientWidth || 600, h = holder.clientHeight || 400;
			this.camera.aspect = w / h;
			this.camera.updateProjectionMatrix();
		},
		updateGizmos: function () {
			for (var i = 0; i < this.wpGizmos.length; i++) {
				var g = this.wpGizmos[i];
				g.scale.setScalar(worldSizeAtPointForPx(this.camera, holder, g.position, 42));
			}
			// destination-marker sprites (ship / destination × / phasing ring) --
			// added to THIS (Helio) scene by updateMarker()/updateDestinationMarker()
			// (Shared/sim/marker-card.js).
			if (markerSprite && markerSprite.visible) {
				markerSprite.scale.setScalar(worldSizeAtPointForPx(this.camera, holder, markerSprite.position, 26));
				if (markerVelDir) { orientMarkerSprite(this.camera, markerSprite, markerVelDir); }
			}
			if (destSprite && destSprite.visible) {
				destSprite.scale.setScalar(worldSizeAtPointForPx(this.camera, holder, destSprite.position, 22));
			}
			if (tempRing && tempRing.visible) { scaleApproachMark(this.camera, holder, tempRing); }
		},
		render: function () {
			updateCamera(this.camera, this.cam);
			this.updateScales();
			this.updateGizmos();
			this.updateLabels();
			renderer.render(this.scene, this.camera);
		},

		focusNearest: function (e) {
			var rect = renderer.domElement.getBoundingClientRect();
			var px = e.clientX - rect.left, py = e.clientY - rect.top;
			var best = null, bestD = 24, v = new THREE.Vector3();
			for (var i = 0; i < this.scaleList.length; i++) {
				v.copy(this.scaleList[i].group.position).project(this.camera);
				if (v.z > 1) { continue; }
				var sx = (v.x * 0.5 + 0.5) * rect.width, sy = (-v.y * 0.5 + 0.5) * rect.height;
				var d = Math.hypot(sx - px, sy - py);
				if (d < bestD) { bestD = d; best = this.scaleList[i]; }
			}
			if (!best) { return; }
			this.cam.target.copy(best.group.position);
			this.cam.radius = Math.max(best.soiAU * 4, best.radiusAU * 150, 5e-4);
		}
	};

	// =======================================================================
	//  Init
	// =======================================================================
	function resetToDefaults() {
		state.botAlt = 150e3;
		state.topAlt = 25000e3;
		state.releaseSide = "above";
		state.relAltAbove = 25000e3;
		state.relAltBelow = 150e3;
		state.vehMass = 4000;
		state.vehDiam = 5;
		state.waypoints = [];
		state.marker = null;
		state.markerFocused = false;
		topInput.value = 25000;
		botInput.value = 150;
		vehMassInput.value = 4000;
		vehDiamInput.value = 5;
		sideAbove.checked = true; sideBelow.checked = false;
		relInput.classList.remove("mps-bad");
	}

	function init() {
		initScene();
		viewEl = document.getElementById("mps-view");
		buildDestinationOptions();
		if (destSel) {
			destSel.addEventListener("change", function () {
				state.destination = destSel.value;
				refreshHook();
			});
		}
		if (approachJump) {
			approachJump.addEventListener("click", function () {
				if (lastApproachT == null) { return; }
				placeMarkerAtGlobalTime(lastApproachT);
			});
		}

		readoutLayer = document.createElement("div");
		readoutLayer.id = "mps-burn-readouts";
		if (mainEl) { mainEl.appendChild(readoutLayer); }
		if (panelEl) { panelEl.addEventListener("scroll", positionBurnReadouts); }

		dateBar.bind(refreshDate);

		// "Lock Phobos phase" (year slider): capture the CURRENT Phobos-Sun
		// geometry the instant the toggle is switched on, so it's that
		// relationship -- whatever it happens to be, e.g. "at Mars midnight"
		// -- that's preserved afterward, not a hardcoded one. Turning it off
		// just stops snapping; it doesn't move the date.
		if (lockYearToggle) {
			lockYearToggle.addEventListener("change", function () {
				state.lockPhobosPhase = lockYearToggle.checked;
				if (state.lockPhobosPhase) { state.lockedElongation = phobosSunElongation(state.jd); }
			});
		}

		[topInput, botInput].forEach(function (inp) {
			inp.addEventListener("input", function () { readTetherInputs(); refreshHook(); });
		});
		relInput.addEventListener("input", function () { commitRelAlt(parseFloat(relInput.value)); });
		bindRelSlider();

		[sideAbove, sideBelow].forEach(function (radio) {
			radio.addEventListener("change", function () {
				state.releaseSide = sideAbove.checked ? "above" : "below";
				applyReleaseSide();
				refreshHook();
			});
		});

		vehMassInput.addEventListener("input", function () {
			var v = parseFloat(vehMassInput.value);
			state.vehMass = isFinite(v) && v > 0 ? v : state.vehMass;
			buildTrajectory();
		});
		vehDiamInput.addEventListener("input", function () {
			var v = parseFloat(vehDiamInput.value);
			state.vehDiam = isFinite(v) && v > 0 ? v : state.vehDiam;
			buildTrajectory();
		});

		resetBtn.addEventListener("click", function () {
			resetToDefaults();
			readTetherInputs();
			applyReleaseSide();
			setHud("Reset. Double-click Mars or Phobos to focus.");
			refreshHook();
		});

		soiToggle.addEventListener("change", function () {
			marsSOI.visible = soiToggle.checked;
		});
		orbitToggle.addEventListener("change", function () {
			if (phobosOrbitGroup) { phobosOrbitGroup.visible = orbitToggle.checked; }
		});
		hookToggle.addEventListener("change", function () {
			if (hookGroup) { hookGroup.visible = hookToggle.checked; }
		});
		trajToggle.addEventListener("change", function () {
			if (trajectoryGroup) { trajectoryGroup.visible = trajToggle.checked; }
			if (Helio.trajGroup) { Helio.trajGroup.visible = trajToggle.checked; }
		});

		var viewToggle = document.getElementById("mps-view-toggle");
		if (viewToggle) {
			viewToggle.addEventListener("click", function () {
				if (state.view === "geo") {
					Helio.init();
					state.view = "helio";
					Helio.placeBodies();
					Helio.updateTrajectory(lastTrajRes);
					labelLayer.style.display = "none";
					Helio.labelLayer.style.display = "";
					viewToggle.textContent = "🔴 Mars–Phobos view";
					viewToggle.classList.add("mps-view-toggle-on");
					if (panelGeo) { panelGeo.style.display = "none"; }
					if (panelHelio) { panelHelio.style.display = ""; }
					updateMarker();
					setHud("Heliocentric solar-system context. drag rotate · wheel zoom · right-drag pan · double-click a planet to focus. The trajectory is drawn in true heliocentric coordinates; the orange ellipse (when the path escapes Mars) is its predicted heliocentric orbit. Pick a Destination and click the trajectory to drop a marker -- the × marks where that body will be at the ship's time of flight. Waypoint burns (tick 1/2) live here too -- snap each to an apsis or node in the sidebar.");
				} else {
					state.view = "geo";
					if (Helio.labelLayer) { Helio.labelLayer.style.display = "none"; }
					labelLayer.style.display = "";
					viewToggle.textContent = "🌐 Solar system view";
					viewToggle.classList.remove("mps-view-toggle-on");
					if (panelGeo) { panelGeo.style.display = ""; }
					if (panelHelio) { panelHelio.style.display = "none"; }
					updateMarker();
					setHud("Mars-centred Mars–Phobos view. Double-click Mars or Phobos to focus.");
				}
			});
		}
		if (burnVecToggle) { burnVecToggle.addEventListener("change", function () { refreshHook(); }); }

		// A waypoint's tau (s, elapsed time on its leg to the burn) always has a
		// usable default so the chain never has to fall back to "unresolved" --
		// snapping (below) then overwrites it whenever a snap is active. Mirrors
		// the reference tool's newWaypoint(snap) exactly.
		function newWaypoint(snap) {
			return { tau: 120 * DAY, burn: { pro: 0, rad: 0, nrm: 0 }, snap: snap, snapOffset: 0 };
		}
		if (createWp1) {
			createWp1.addEventListener("change", function () {
				if (createWp1.checked) {
					if (state.waypoints.length === 0) { state.waypoints.push(newWaypoint("nodeNearest")); }
					refreshHook();
				} else {
					state.waypoints = [];
					// Target mode needs a waypoint burn to solve into -- removing the
					// last one falls back to Free (setMarkerMode() itself refreshes).
					if (state.marker && state.marker.mode === "target") { setMarkerMode("free"); }
					else { refreshHook(); }
				}
			});
		}
		if (createWp2) {
			createWp2.addEventListener("change", function () {
				if (createWp2.checked) {
					if (state.waypoints.length === 1) { state.waypoints.push(newWaypoint("apsisNearest")); }
				} else if (state.waypoints.length >= 2) {
					state.waypoints.length = 1;
				}
				refreshHook();
			});
		}

		readTetherInputs();
		applyReleaseSide();
		dateBar.setBaseDays(0);
		refreshDate();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else { init(); }

})();
