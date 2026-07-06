/* Moon Skyhook Trajectory Plotter — Phase 1
 *
 * A navigable, to-scale 3-D view of the Earth-Moon system (Three.js), lit by
 * the off-screen Sun, with the Moon placed from a low-precision lunar ephemeris
 * (Shared/lunar-ephemeris.js). A gravity-gradient (radial) skyhook is drawn at
 * the Moon: the circle traced by its top, the circle traced by its centre of
 * mass, a radial line marking its current orientation, and a draggable arrow
 * at the release point. The sidebar sets the skyhook geometry and reads off the
 * release physics (orbital/angular velocity, tip centrifugal load, release
 * speed, and the hyperbolic-excess speeds at the Moon's and Earth's SOIs).
 *
 * Phase 1 builds the scene, the controls and the scalar read-outs. Drawing the
 * actual escape / Earth-flyby trajectories is deferred to Phase 2.
 *
 * Depends on Shared/three.min.js, Shared/orbit.js (global `systems`),
 * Shared/math-utils.js (global `OrbitalMath`) and
 * Shared/lunar-ephemeris.js (global `LunarEphemeris`). Classic scripts,
 * file://-safe.
 */
(function () {
	"use strict";

	var O  = OrbitalMath;
	var LE = LunarEphemeris;

	// ---- physical constants (SI) ------------------------------------------
	var EARTH = systems.get("Earth");
	var MOON  = systems.get("Moon");
	var SUN   = systems.get("Sun");
	var GM_E  = EARTH.GM, R_E = EARTH.radius;
	var GM_M  = MOON.GM,  R_M = MOON.radius;
	var GM_S  = SUN.GM;
	var M_E   = EARTH.mass, M_M = MOON.mass;
	var M_SUN = SUN.mass || (SUN.GM / 6.6743e-11);
	var A_MOON = MOON.orbit.semiMajor || 384399e3;        // m, geocentric
	var A_EARTH = (EARTH.orbit.apoapsis + EARTH.orbit.periapsis) / 2;   // m, heliocentric
	var MOON_AXIAL_TILT = MOON.axialTiltEcliptic || (1.5424 * Math.PI / 180);

	// Spheres of influence (m).
	var SOI_MOON  = O.sphereOfInfluence(A_MOON, M_M, M_E);
	var SOI_EARTH = O.sphereOfInfluence(A_EARTH, M_E, M_SUN);

	// Scene units: 1 unit = 1000 km = 1e6 m.
	var U = 1e6;
	function mToU(m) { return m / U; }
	function kmToU(km) { return km * 1e3 / U; }

	// The real Sun is ~150,000 scene units away — beyond the working view. We draw
	// it as a bright disk at a capped distance in its true ecliptic direction, so
	// it reads as "the Sun, over there" while the camera stays near Earth-Moon.
	var SUN_DRAW_DIST = 30000, SUN_DRAW_RADIUS = 900;

	// Slider epoch (day 0) and span: 2030-01-01 .. 2033-12-31 (midnight).
	var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
	var SPAN_DAYS = 1460;
	var SIDEREAL_MONTH = 27.321661;                       // days (Moon 360 deg)

	// ---- application state ------------------------------------------------
	var state = {
		jd: JD0,
		baseDays: 0,                                       // coarse slider (days from JD0)
		hookPhase: 0,                                      // skyhook phase, radians
		comAlt: 275e3,                                     // m
		topAlt: 6000e3,                                    // m
		relAlt: 950e3,                                     // m
		focus: null,                                       // "Moon" | "Earth" | null
		view: "geo",                                       // "geo" (Earth-Moon) | "helio" (solar-system context)
		waypoints: [],                                     // up to 2: {t (s, leg-relative), burn:{pro,rad,nrm} m/s}
		// "Lock relationship" toggles for the two date sliders — see
		// solveDateForElongation / applySkyhookMoonLock.
		lockMoonPhase: false,                               // year slider: keep Moon-Sun elongation fixed
		lockedElongation: 0,                                // rad, captured when lockMoonPhase turns on
		lockSkyhookToMoon: false,                           // month slider: keep hookPhase locked to the Moon's motion
		lockedHookOffset: 0                                 // rad, captured when lockSkyhookToMoon turns on
	};

	// ---- DOM refs ---------------------------------------------------------
	var holder       = document.getElementById("msk-canvas-holder");
	var coarseSlider = document.getElementById("msk-date-coarse");
	var fineSlider   = document.getElementById("msk-date-fine");
	var fineLo       = document.getElementById("msk-fine-lo");
	var fineHi       = document.getElementById("msk-fine-hi");
	var phaseSlider  = document.getElementById("msk-hook-phase");
	var phaseVal     = document.getElementById("msk-hook-phase-val");
	var lockYearToggle  = document.getElementById("msk-lock-year");
	var lockMonthToggle = document.getElementById("msk-lock-month");
	var dateField    = document.getElementById("msk-date-field");
	var jdLabel      = document.getElementById("msk-jd");
	var comInput     = document.getElementById("msk-com");
	var topInput     = document.getElementById("msk-top");
	var relInput     = document.getElementById("msk-rel");
	var relSlider    = document.getElementById("msk-rel-slider");
	var vcomOut      = document.getElementById("msk-vcom");
	var omegaOut     = document.getElementById("msk-omega");
	var cfOut        = document.getElementById("msk-cf");
	var periodOut    = document.getElementById("msk-period");
	var vrelOut      = document.getElementById("msk-vrel");
	var vinfMoonOut  = document.getElementById("msk-vinf-moon");
	var vinfEarthOut = document.getElementById("msk-vinf-earth");
	var earthNote    = document.getElementById("msk-earth-note");
	var trajPrimOut  = document.getElementById("msk-traj-primary");
	var trajPeriOut  = document.getElementById("msk-traj-peri");
	var trajApoOut   = document.getElementById("msk-traj-apo");
	var trajInclOut  = document.getElementById("msk-traj-incl");
	var trajInclLabelOut = document.getElementById("msk-traj-incl-label");
	var resetBtn     = document.getElementById("msk-reset");
	var soiToggle    = document.getElementById("msk-show-soi");
	var orbitToggle  = document.getElementById("msk-show-orbit");
	var hookToggle   = document.getElementById("msk-show-hook");
	var trajToggle   = document.getElementById("msk-show-traj");
	var burnVecToggle = document.getElementById("msk-show-burnvecs");
	var hudStatus    = document.getElementById("msk-hud-status");
	var mainEl       = document.getElementById("msk-main");
	var panelEl      = document.getElementById("msk-panel");
	var wpEmpty      = document.getElementById("msk-waypoints-empty");
	var wpList       = document.getElementById("msk-waypoint-list");
	var createWp1    = document.getElementById("msk-create-wp1");
	var createWp2    = document.getElementById("msk-create-wp2");
	var readoutLayer = null;      // overlay holding the straddling burn readouts
	var readoutBoxes = [];        // { el, host } currently shown

	function setHud(t) { if (hudStatus) { hudStatus.textContent = t; } }

	// =======================================================================
	//  THREE.js scene
	// =======================================================================
	var scene, camera, renderer, raycaster;
	var earthMesh, earthPoint, earthSOI, sunMesh;
	var moonPosGroup, moonSpinGroup, moonMesh, moonPoint, moonSOI;
	var hookGroup = null;            // skyhook geometry (rebuilt on change)
	var releaseMesh = null;          // draggable release-point triangle (in-plane)
	var moonOrbitGroup = null;       // geocentric Moon orbit (two-tone arcs)
	var earthOrbitLine = null;       // Earth's heliocentric orbit (dim reference ring)
	var trajectoryGroup = null;      // released-ship trajectory: geocentric legs (child of scene)
	var trajectoryMoonGroup = null;  // released-ship trajectory: the Moon-ellipse leg 0 (child of moonPosGroup)
	var sunLight;
	var labelList = [], labelLayer = null;
	var wpMarkers = [];              // [{ mesh: THREE.Group (gizmo), leg }] — draggable waypoint gizmos
	var burnArrows = [];             // [{ obj: THREE.ArrowHelper, parent }] — dV / prograde-speed-change arrows
	var lastWpCount = -1;            // rebuild the waypoint list DOM only when the count changes
	var lastTrajRes = null;         // most recent computeTrajectory() result (for the helio overlay)

	// Burn-vector arrows: a fixed physical scale (scene units, i.e. 1000 km, per
	// km/s) so the dV arrow and the prograde-speed-change arrow are directly
	// comparable in length.
	var BURN_VEC_SCALE = 8;
	var DV_COLOR = 0xff5fd0;      // delta-v (the burn itself)
	var DSPEED_COLOR = 0xffd24a;  // change in prograde (orbital) speed vs pre-burn
	var dvHex = "#ff5fd0";        // CSS form of DV_COLOR (pink) for the readouts
	var spdHex = "#ffd24a";       // CSS form of DSPEED_COLOR (amber) for the readouts

	// camera spherical state around `target` (scene units)
	var cam = { radius: 1500, theta: 0.7, phi: 1.05, target: new THREE.Vector3(0, 0, 0) };

	function initScene() {
		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(45, 1, 0.01, 80000);
		renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
		renderer.setPixelRatio(window.devicePixelRatio || 1);
		holder.appendChild(renderer.domElement);

		labelLayer = document.createElement("div");
		labelLayer.id = "msk-labels";
		holder.appendChild(labelLayer);

		raycaster = new THREE.Raycaster();

		scene.add(new THREE.AmbientLight(0x556070, 0.35));
		sunLight = new THREE.DirectionalLight(0xfff4e6, 1.5);
		scene.add(sunLight);
		scene.add(sunLight.target);

		scene.add(makeStars());

		// ---- Sun (far, drawn at a capped distance in its true direction) ----
		sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_DRAW_RADIUS, 24, 16),
			new THREE.MeshBasicMaterial({ color: 0xffe066 }));
		scene.add(sunMesh);

		// ---- Earth's heliocentric orbit: a dim ring through Earth, centred on the
		// Sun. Drawn at the Sun's capped distance, it shows the ecliptic and (via
		// its tangent at Earth) the prograde direction. Positioned each frame in
		// placeBodies() to follow the Sun. ----
		var eoPts = [];
		for (var eoi = 0; eoi <= 640; eoi++) {
			var eoa = 2 * Math.PI * eoi / 640;
			eoPts.push(new THREE.Vector3(SUN_DRAW_DIST * Math.cos(eoa), SUN_DRAW_DIST * Math.sin(eoa), 0));
		}
		earthOrbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(eoPts),
			new THREE.LineBasicMaterial({ color: 0x4f8f8f, transparent: true, opacity: 0.35 }));
		scene.add(earthOrbitLine);

		// Hard two-tone (toon) shading: a 2-texel ramp sampled with nearest
		// filtering snaps between lit and dark, giving a sharp day/night line
		// instead of a smooth terminator. The dark texel (120/255) keeps the night
		// side visible; the day side (255) is much brighter. LuminanceFormat maps
		// to a grey ramp (so it doesn't tint the material's colour).
		var toonGrad = new THREE.DataTexture(new Uint8Array([120, 255]), 2, 1, THREE.LuminanceFormat);
		toonGrad.minFilter = toonGrad.magFilter = THREE.NearestFilter;
		toonGrad.needsUpdate = true;

		// ---- Earth (origin) ----
		var earthGeo = new THREE.SphereGeometry(mToU(R_E), 48, 32);
		var earthMat = new THREE.MeshToonMaterial({ color: 0x3a7bd5, gradientMap: toonGrad });
		earthMesh = new THREE.Mesh(earthGeo, earthMat);
		scene.add(earthMesh);
		earthPoint = makePoint(0x8fbfff, 4);
		scene.add(earthPoint);
		loadTexture("Earth-Wrap.jpg", earthMat);

		earthSOI = makeSOIShell(mToU(SOI_EARTH), 0x4a78ff, 0.045);
		scene.add(earthSOI);

		// ---- Moon (positioned each frame) ----
		moonPosGroup = new THREE.Group();           // at Moon position, axis-aligned (ecliptic)
		scene.add(moonPosGroup);
		moonSpinGroup = new THREE.Group();           // carries the tidal-locked Moon mesh
		moonPosGroup.add(moonSpinGroup);

		var moonGeo = new THREE.SphereGeometry(mToU(R_M), 48, 32);
		var moonMat = new THREE.MeshToonMaterial({ color: 0x9a9a9a, gradientMap: toonGrad });
		moonMesh = new THREE.Mesh(moonGeo, moonMat);
		moonSpinGroup.add(moonMesh);
		loadTexture("Moon-Wrap.jpg", moonMat);

		moonPoint = makePoint(0xcfc8bd, 3.5);
		moonPosGroup.add(moonPoint);

		moonSOI = makeSOIShell(mToU(SOI_MOON), 0x9a8cff, 0.10);
		moonPosGroup.add(moonSOI);


		resize();
		window.addEventListener("resize", resize);
		bindControls();
		animate();
	}

	// Load a texture into a material, keeping the fallback colour if it fails
	// (file:// image loads can be blocked; the view still works without it).
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

	// A constant-size bright pixel at a group's origin (so a far body is visible).
	function makePoint(colorHex, sizePx) {
		var g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
		return new THREE.Points(g, new THREE.PointsMaterial({
			color: colorHex, size: sizePx, sizeAttenuation: false,
			transparent: true, depthTest: false }));
	}

	// A dot sized in world units (sizeAttenuation), so it scales with the view
	// and shrinks to nothing as the camera pulls away — like the in-plane
	// skyhook markers, unlike makePoint's constant-pixel body points.
	function makeWorldDot(colorHex, sizeU) {
		var g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
		return new THREE.Points(g, new THREE.PointsMaterial({
			color: colorHex, size: sizeU, sizeAttenuation: true,
			transparent: true, depthTest: false }));
	}

	function makeSOIShell(radiusU, colorHex, opacity) {
		var m = new THREE.Mesh(
			new THREE.SphereGeometry(radiusU, 32, 24),
			new THREE.MeshBasicMaterial({ color: colorHex, transparent: true,
				opacity: opacity, depthWrite: false, side: THREE.BackSide }));
		return m;
	}

	function addLabel(name, obj) {
		var el = document.createElement("span");
		el.className = "msk-label";
		el.textContent = name;
		labelLayer.appendChild(el);
		labelList.push({ el: el, obj: obj });
	}

	// =======================================================================
	//  Moon orbit (geocentric) — two arcs split at the line of nodes
	// =======================================================================
	function buildMoonOrbit() {
		if (moonOrbitGroup) { scene.remove(moonOrbitGroup); disposeGroup(moonOrbitGroup); }
		var st = LE.moonState(state.jd);                    // km, km/s
		var r = [st.r[0]*1e3, st.r[1]*1e3, st.r[2]*1e3];    // m
		var v = [st.v[0]*1e3, st.v[1]*1e3, st.v[2]*1e3];    // m/s
		var el = O.elementsFromState(GM_E, r, v);
		if (!isFinite(el.a) || el.e >= 1) { moonOrbitGroup = null; return; }

		var grp = new THREE.Group();
		function arc(nu0, span, N) {
			var pts = [];
			for (var k = 0; k <= N; k++) {
				var nu = nu0 + span * k / N;
				var s = O.stateFromElements(GM_E, el.a, el.e, el.i, el.Omega, el.omega, nu);
				pts.push(new THREE.Vector3(mToU(s.r[0]), mToU(s.r[1]), mToU(s.r[2])));
			}
			return pts;
		}
		function lineFrom(pts, col, op) {
			var g = new THREE.BufferGeometry().setFromPoints(pts);
			return new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }));
		}
		var nuAsc = -el.omega;                              // z = 0 at u = 0 (ascending)
		var northCol = 0xc9d4ff, southCol = 0x5570c0;
		grp.add(lineFrom(arc(nuAsc, Math.PI, 160), northCol, 0.75));         // north (bright)
		grp.add(lineFrom(arc(nuAsc + Math.PI, Math.PI, 160), southCol, 0.4)); // south (dim)

		grp.visible = orbitToggle.checked;
		scene.add(grp);
		moonOrbitGroup = grp;
	}

	function disposeGroup(g) {
		g.traverse(function (o) {
			if (o.geometry) { o.geometry.dispose(); }
			if (o.material) { o.material.dispose(); }
		});
	}

	// =======================================================================
	//  Skyhook geometry
	// =======================================================================
	// In-plane orthonormal basis of the Moon's equatorial plane (ascending node
	// of the equator taken at ecliptic longitude 0; tilt = Moon axial tilt to
	// the ecliptic). Phase 0 points the tether toward ecliptic longitude 0.
	function hookBasis() {
		var th = MOON_AXIAL_TILT;
		var e1 = new THREE.Vector3(1, 0, 0);
		var e2 = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
		return { e1: e1, e2: e2 };
	}
	// Unit direction of the tether at phase phi.
	function hookDir(phi) {
		var b = hookBasis();
		return b.e1.clone().multiplyScalar(Math.cos(phi))
			.add(b.e2.clone().multiplyScalar(Math.sin(phi)));
	}

	// Unit normal of the skyhook's orbital plane (the Moon's equatorial plane,
	// per hookBasis), as a plain [x,y,z] for use with OrbitalMath's vector
	// helpers. Derived from hookBasis's actual e1/e2 (rather than re-deriving
	// the tilt trig) so it can't drift out of sync with the drawn geometry.
	function hookPlaneNormal() {
		var b = hookBasis();
		var n = new THREE.Vector3().crossVectors(b.e1, b.e2).normalize();
		return [n.x, n.y, n.z];
	}

	// Inclination of a Moon-relative state's orbital plane against the
	// skyhook's own orbital plane, rather than the ecliptic. The unperturbed
	// release orbit lies exactly in that plane by construction (zero, always),
	// so this only ever becomes non-trivial once a waypoint burn's normal
	// component tips a still-Moon-bound orbit out of it.
	function lunarInclination(rMoonRel, vMoonRel) {
		var h = O.vCross(rMoonRel, vMoonRel), hMag = O.vMag(h);
		if (hMag < 1e-6) { return 0; }
		var n = hookPlaneNormal();
		return Math.acos(Math.max(-1, Math.min(1, O.vDot(h, n) / hMag)));
	}

	function buildHook() {
		if (hookGroup) { moonPosGroup.remove(hookGroup); disposeGroup(hookGroup); }
		releaseMesh = null;
		var grp = new THREE.Group();

		var rBase = kmToU((R_M + 20e3) / 1e3);              // 20 km above surface
		var rCom  = kmToU((R_M + state.comAlt) / 1e3);
		var rTop  = kmToU((R_M + state.topAlt) / 1e3);
		var rRel  = kmToU((R_M + state.relAlt) / 1e3);
		var b = hookBasis();

		// circle of radius rU in the equatorial plane
		function circle(rU, col, op) {
			var pts = [], N = 128;
			for (var k = 0; k <= N; k++) {
				var a = 2 * Math.PI * k / N;
				var p = b.e1.clone().multiplyScalar(rU * Math.cos(a))
					.add(b.e2.clone().multiplyScalar(rU * Math.sin(a)));
				pts.push(p);
			}
			var g = new THREE.BufferGeometry().setFromPoints(pts);
			return new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }));
		}
		grp.add(circle(rTop, 0x9fb6ff, 0.85));              // top orbit
		grp.add(circle(rCom, 0xffd24a, 0.85));              // CoM orbit

		// radial line (tether): from base out to top, along the phase direction
		var dir = hookDir(state.hookPhase);
		var lg = new THREE.BufferGeometry().setFromPoints([
			dir.clone().multiplyScalar(rBase), dir.clone().multiplyScalar(rTop)]);
		grp.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xeaf0ff })));

		// small dots at CoM and top along the tether — sized in world units so
		// they shrink to nothing as the view zooms away (like the markers).
		var dotU = 0.10 * mToU(R_M);
		[[rCom, 0xffd24a], [rTop, 0x9fb6ff]].forEach(function (d) {
			var dot = makeWorldDot(d[1], dotU);
			dot.position.copy(dir.clone().multiplyScalar(d[0]));
			grp.add(dot);
		});

		// Release-point marker: a small triangle lying in the orbital plane, with
		// its tip on the tether at the release altitude and pointing prograde
		// (so its axis is perpendicular to the radial tether line). It is real
		// scene geometry — part of the skyhook — so it scales with the view and
		// disappears once the skyhook is too small to read.
		var pro = b.e1.clone().multiplyScalar(-Math.sin(state.hookPhase))
			.add(b.e2.clone().multiplyScalar(Math.cos(state.hookPhase)));   // prograde unit
		var triLen = 0.24 * mToU(R_M);                     // tip -> base length
		var triHw  = 0.05 * mToU(R_M);                     // half-width of the base (narrow -> clear tip)
		var bL = pro.clone().multiplyScalar(-triLen).add(dir.clone().multiplyScalar(triHw));
		var bR = pro.clone().multiplyScalar(-triLen).add(dir.clone().multiplyScalar(-triHw));
		var triGeo = new THREE.BufferGeometry();
		triGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			0, 0, 0,  bL.x, bL.y, bL.z,  bR.x, bR.y, bR.z]), 3));   // tip at local origin
		releaseMesh = new THREE.Mesh(triGeo, new THREE.MeshBasicMaterial({
			color: 0xff5fd0, side: THREE.DoubleSide }));
		releaseMesh.position.copy(dir.clone().multiplyScalar(rRel));   // tip at release altitude
		releaseMesh.userData.dir = dir.clone();
		releaseMesh.userData.rBase = rBase;
		releaseMesh.userData.rTop = rTop;
		grp.add(releaseMesh);

		// Top-of-skyhook marker: a triangle sitting just outside the top circle
		// whose tip always points at Earth. Same size as the release triangle and
		// drawn the same way (real scene geometry), so it shrinks to nothing as
		// the view pulls away. moonPosGroup is unrotated, so a local direction is
		// also a world direction; Earth sits at the world origin.
		var topLocal = dir.clone().multiplyScalar(rTop);
		var earthDir = moonPosGroup.position.clone().add(topLocal).multiplyScalar(-1).normalize();
		// Width axis: the radial direction's component perpendicular to earthDir,
		// so the triangle stands upright relative to the tether. Fall back to an
		// in-plane axis if the tether happens to point straight at/from Earth.
		var side = dir.clone().sub(earthDir.clone().multiplyScalar(dir.dot(earthDir)));
		if (side.lengthSq() < 1e-9) {
			side = b.e1.clone().sub(earthDir.clone().multiplyScalar(b.e1.dot(earthDir)));
		}
		side.normalize();
		var tbL = earthDir.clone().multiplyScalar(-triLen).add(side.clone().multiplyScalar(triHw));
		var tbR = earthDir.clone().multiplyScalar(-triLen).add(side.clone().multiplyScalar(-triHw));
		var topTriGeo = new THREE.BufferGeometry();
		topTriGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			0, 0, 0,  tbL.x, tbL.y, tbL.z,  tbR.x, tbR.y, tbR.z]), 3));   // tip at local origin
		var topMesh = new THREE.Mesh(topTriGeo, new THREE.MeshBasicMaterial({
			color: 0x9fb6ff, side: THREE.DoubleSide }));
		// Push the whole triangle onto its own larger circle so it never overlaps
		// the top-orbit circle, whichever way Earth lies. Every vertex is at most
		// triReach from the tip, so anchoring the tip triReach + a gap beyond rTop
		// keeps the closest vertex at radius >= rTop + gap.
		var triReach = Math.sqrt(triLen * triLen + triHw * triHw);
		var topGap = triReach + 0.15 * mToU(R_M);
		topMesh.position.copy(topLocal.clone().add(dir.clone().multiplyScalar(topGap)));
		grp.add(topMesh);

		grp.visible = hookToggle.checked;
		moonPosGroup.add(grp);
		hookGroup = grp;
	}

	// =======================================================================
	//  Released-ship trajectory (restricted N-body integration, colored by primary)
	// =======================================================================
	// Earth's heliocentric state (m, m/s): position is minus the Sun's geocentric
	// vector (real ephemeris, with distance); velocity is a finite difference of
	// that full vector, so both the tangential and radial parts are captured.
	function earthHelio(jd) {
		var dd = 0.01;
		var r1 = O.vScale(LE.sunVector(jd), -1e3);
		var r2 = O.vScale(LE.sunVector(jd + dd), -1e3);
		return { r: r1, v: O.vScale(O.vSub(r2, r1), 1/(dd*86400)) };
	}

	// Inertial release state in the Moon-centred, ecliptic-aligned frame (m, m/s):
	// the tether tip's position at the release altitude/phase and its rotation
	// velocity (prograde, tangential, in the Moon's equatorial plane).
	function releaseState() {
		var rRel = R_M + state.relAlt, rCom = R_M + state.comAlt;
		var vRel = O.angularVelocity(GM_M, rCom) * rRel;
		var b = hookBasis(), phi = state.hookPhase;
		var dir = b.e1.clone().multiplyScalar(Math.cos(phi)).add(b.e2.clone().multiplyScalar(Math.sin(phi)));
		var pro = b.e1.clone().multiplyScalar(-Math.sin(phi)).add(b.e2.clone().multiplyScalar(Math.cos(phi)));
		return { r: [dir.x*rRel, dir.y*rRel, dir.z*rRel],
		         v: [pro.x*vRel, pro.y*vRel, pro.z*vRel] };
	}

	// Geocentric positions (m) of the Moon and Sun at Julian date jde.
	function moonGeoPos(jde) { var r = LE.moonVector(jde); return [r[0]*1e3, r[1]*1e3, r[2]*1e3]; }
	function sunGeoPos(jde) { var s = LE.sunVector(jde); return [s[0]*1e3, s[1]*1e3, s[2]*1e3]; }

	// Add a third body's perturbation to acceleration `a`: the body's direct pull
	// on the ship minus its pull on Earth (the indirect term). Keeping the
	// indirect term makes the geocentric frame consistent — that is exactly the
	// term a patched conic drops, which is what produced the kink at the SOI.
	function addThirdBody(a, r, rB, GM) {
		var dx = rB[0]-r[0], dy = rB[1]-r[1], dz = rB[2]-r[2];
		var d = Math.hypot(dx, dy, dz), d3 = d*d*d;
		var b = Math.hypot(rB[0], rB[1], rB[2]), b3 = b*b*b;
		a[0] += GM*(dx/d3 - rB[0]/b3);
		a[1] += GM*(dy/d3 - rB[1]/b3);
		a[2] += GM*(dz/d3 - rB[2]/b3);
	}

	// Geocentric acceleration (m/s^2) on the ship from Earth + Moon + Sun gravity.
	function shipAccel(r, jde) {
		var rm = Math.hypot(r[0], r[1], r[2]), rm3 = rm*rm*rm;
		var a = [ -GM_E*r[0]/rm3, -GM_E*r[1]/rm3, -GM_E*r[2]/rm3 ];
		addThirdBody(a, r, moonGeoPos(jde), GM_M);
		addThirdBody(a, r, sunGeoPos(jde), GM_S);
		return a;
	}

	// Geocentric velocity (m/s) of the Moon at Julian date jde (companion to
	// moonGeoPos — both come from the same ephemeris state).
	function moonGeoVel(jde) { var st = LE.moonState(jde); return [st.v[0]*1e3, st.v[1]*1e3, st.v[2]*1e3]; }

	// Integrate the geocentric trajectory (RK4 with a step bounded by turn angle
	// and, in cislunar space, by segment length — see dtMax in the loop) from a
	// given state until it impacts, completes one bound
	// Earth orbit, completes one bound Moon orbit (only relevant for a leg that
	// *starts* Moon-bound, e.g. right after a waypoint burn that keeps the ship
	// close to the Moon — without this cap such a leg would never "clear" and
	// would run to the step limit), or escapes to 0.1 AU. Because gravity is
	// continuous there is no SOI handoff and no kink — this is the restricted
	// N-body path. Also records a full (r,v,t) sample trail, dense enough (≤1 deg
	// of turn per step, tighter distance caps in cislunar space) for a waypoint
	// dropped anywhere on this leg to recover its state (interpolated — see
	// stateAtLegTime) without re-integrating.
	function integrateTrajectory(R0, V0, jd0) {
		var r = R0.slice(), v = V0.slice(), t = 0;
		var pts = [ new THREE.Vector3(mToU(r[0]), mToU(r[1]), mToU(r[2])) ];
		var samples = [ { r: r.slice(), v: v.slice(), t: 0 } ];
		var cleared = false, branch = null, tClear = 0, oscT = 0, impact = null;
		var rmin = Infinity, rmax = 0, helioEl = null, vinfEarth = null, inclEarth = null;
		var moonRmin = Infinity, moonRmax = 0;
		var clearDist = 2.5 * SOI_MOON, cutoff = 0.1 * A_EARTH;

		// If this leg starts already Moon-bound (apoapsis inside the Moon's SOI),
		// cap it at ~one lunar orbit. Only ever true for a leg beginning right
		// after a burn — the very first (release) call is routed to the exact
		// two-body ellipse branch in computeTrajectory instead, so moonBoundCap is
		// always null there and this fallback path is never taken for it (zero
		// behaviour change for the original single-leg case).
		var rMoonRel0 = O.vSub(r, moonGeoPos(jd0)), vMoonRel0 = O.vSub(v, moonGeoVel(jd0));
		var elM0 = O.elementsFromState(GM_M, rMoonRel0, vMoonRel0);
		var moonBoundCap = (elM0.e < 1 && O.apoapsisRadius(elM0.a, elM0.e) < SOI_MOON)
			? conicPeriod(GM_M, elM0) * 1.02 : null;
		// Lunar inclination (see lunarInclination): only relevant when this leg
		// starts Moon-bound, i.e. exactly when moonBoundCap applies. Computed
		// once from the leg's starting state — the plane of a bound ellipse
		// doesn't change over the one orbit this cap allows.
		var inclLunar = moonBoundCap != null ? lunarInclination(rMoonRel0, vMoonRel0) : null;

		for (var step = 0; step < 8000; step++) {
			var jde = jd0 + t/86400;
			var a1 = shipAccel(r, jde);
			var amag = Math.max(1e-12, Math.hypot(a1[0], a1[1], a1[2]));
			var vmag = Math.max(1, Math.hypot(v[0], v[1], v[2]));
			// Max step (dtMax): the ~1-deg turn rule alone leaves nearly-straight
			// stretches (weak field, high speed) sampled tens of thousands of km
			// apart — at the old flat 6 h cap, a waypoint gizmo near the Moon
			// could only land on points ~40,000 km apart. Grade the cap by where
			// the ship is: ~10x denser inside Earth's SOI (where waypoints
			// actually get placed), and within 100,000 km of the Moon cap the
			// SEGMENT LENGTH at ~2,000 km so placement there is fine-grained.
			// Beyond the SOI the old 6 h cap stands — nothing is placed out
			// there, and it preserves the step budget for slow escapes.
			var rNow = Math.hypot(r[0], r[1], r[2]);
			var rMnow = moonGeoPos(jde);
			var dMoonNow = Math.hypot(rMnow[0]-r[0], rMnow[1]-r[1], rMnow[2]-r[2]);
			var dtMax = rNow < SOI_EARTH ? 2160 : 21600;
			if (dMoonNow < 1e8) { dtMax = Math.min(dtMax, 2e6 / vmag); }
			var dt = Math.max(1, Math.min(dtMax, 0.02 * vmag / amag));   // ~1 deg of turn, capped
			var hd = dt/2/86400;
			var r2 = O.vAdd(r, O.vScale(v, dt/2)), v2 = O.vAdd(v, O.vScale(a1, dt/2)), a2 = shipAccel(r2, jde+hd);
			var r3 = O.vAdd(r, O.vScale(v2, dt/2)), v3 = O.vAdd(v, O.vScale(a2, dt/2)), a3 = shipAccel(r3, jde+hd);
			var r4 = O.vAdd(r, O.vScale(v3, dt)), v4 = O.vAdd(v, O.vScale(a3, dt)), a4 = shipAccel(r4, jde+dt/86400);
			r = O.vAdd(r, O.vScale(O.vAdd(O.vAdd(v, O.vScale(v2,2)), O.vAdd(O.vScale(v3,2), v4)), dt/6));
			v = O.vAdd(v, O.vScale(O.vAdd(O.vAdd(a1, O.vScale(a2,2)), O.vAdd(O.vScale(a3,2), a4)), dt/6));
			t += dt;
			pts.push(new THREE.Vector3(mToU(r[0]), mToU(r[1]), mToU(r[2])));
			samples.push({ r: r.slice(), v: v.slice(), t: t });
			var rmag = Math.hypot(r[0], r[1], r[2]);
			var rM = moonGeoPos(jd0 + t/86400);
			var dMoon = Math.hypot(rM[0]-r[0], rM[1]-r[1], rM[2]-r[2]);
			if (cleared) { if (rmag < rmin) { rmin = rmag; } if (rmag > rmax) { rmax = rmag; } }
			else { if (dMoon < moonRmin) { moonRmin = dMoon; } if (dMoon > moonRmax) { moonRmax = dMoon; } }
			if (rmag < R_E) { impact = "Earth"; break; }
			if (dMoon < R_M) { impact = "Moon"; break; }
			if (moonBoundCap != null && !cleared && t > moonBoundCap) { branch = "moon"; break; }
			if (!cleared && dMoon > clearDist) {
				// Clear of the Moon: read the Earth-relative orbit. Its specific
				// energy gives the true v_inf at Earth's SOI (all factors included,
				// not the prograde-aligned first cut), and its inclination is the
				// real plane of the resulting Earth orbit.
				cleared = true; tClear = t; rmin = rmag; rmax = rmag;
				var vp = Math.hypot(v[0], v[1], v[2]);
				var Eearth = vp*vp/2 - GM_E/rmag;
				vinfEarth = Eearth > 0 ? Math.sqrt(2*Eearth) : null;
				var el = O.elementsFromState(GM_E, r, v);
				inclEarth = el.i;
				if (Eearth >= 0) { branch = "orange"; }
				else { branch = "green"; oscT = 2*Math.PI*Math.sqrt(el.a*el.a*el.a / GM_E); }
			}
			if (cleared && branch === "orange" && rmag > cutoff) {
				var eh = earthHelio(jde);
				helioEl = O.elementsFromState(GM_S, O.vAdd(eh.r, r), O.vAdd(eh.v, v));
				break;
			}
			if (cleared && branch === "green" && t > tClear + oscT*1.02) { break; }
		}
		// Fallback branch when the loop ran out without any break condition
		// firing: matches the ORIGINAL unconditional "green" default exactly
		// unless this leg genuinely started Moon-bound and never cleared.
		if (!branch) { branch = (!cleared && moonBoundCap != null) ? "moon" : "green"; }
		// Fallback: a slow escape may hit the step cap before the 0.1 AU cutoff;
		// still report its heliocentric orbit from wherever it ended (well past
		// Earth by then). The heliocentric apsides are an estimate either way,
		// since Earth's heliocentric motion here is only approximate.
		if (branch === "orange" && !helioEl) {
			var ehf = earthHelio(jd0 + t/86400);
			helioEl = O.elementsFromState(GM_S, O.vAdd(ehf.r, r), O.vAdd(ehf.v, v));
		}
		return { pts: pts, samples: samples, branch: branch, impact: impact,
		         rmin: rmin, rmax: rmax, moonRmin: moonRmin, moonRmax: moonRmax,
		         helioEl: helioEl, vinfEarth: vinfEarth, inclEarth: inclEarth,
		         inclLunar: inclLunar, duration: t };
	}

	// Orbital period (s) of a bound conic — for the bound-Moon two-body ellipse.
	function conicPeriod(GM, el) { return 2 * Math.PI * Math.sqrt(Math.pow(el.a, 3) / GM); }

	// =======================================================================
	//  Waypoint burns
	// =======================================================================
	// Local dynamical frame at a geocentric position rGeo (m) and Julian date
	// jde, for a leg with the given primary ("Moon" | "Earth" | "Sun"): which
	// body's velocity a burn should be measured against, so "prograde" means
	// prograde around whichever body is actually locally relevant.
	//
	// The Moon frame is used ONLY when the leg's own primary is the Moon —
	// i.e. an actual orbit of the Moon — never merely because the ship's
	// position happens to pass inside the Moon's SOI. A Moon-SOI transit can
	// happen more than once, or briefly, on an Earth- or Sun-primary leg (a
	// flyby), so picking the frame by proximity there used to flip it to the
	// Moon and back mid-leg, jumping the gizmo axes/burn readouts. Gating on
	// leg.primary fixes that.
	//
	// The Sun frame is used for the WHOLE of any Sun-primary (escaping) leg —
	// gated on leg.primary, like the Moon — no matter how close to the Earth
	// or Moon the waypoint sits. On a heliocentric trajectory what a burn
	// matters for is the resulting INTERPLANETARY orbit, so its prograde /
	// radial / normal axes should be heliocentric at every point of the leg,
	// even minutes after release where the ship's ~30 km/s heliocentric
	// velocity is dominated by Earth's own motion. (This replaces the old
	// proximity pick, which read "prograde" as Earth-relative until 0.1 AU
	// out and only flipped heliocentric there.) Note this keys off the
	// waypoint's OWN leg being heliocentric — it can't key off the FINAL
	// trajectory, because the frame defines how the burn components are
	// applied, and the final trajectory isn't known until after the burn:
	// that would be circular.
	//
	// An Earth-primary leg keeps the proximity pick as a fallback (Earth
	// frame inside 0.1 AU of Earth, Sun outside), though in practice a
	// bound leg never reaches that far out.
	//
	// Every frame in this app shares the same non-rotating, ecliptic-aligned
	// axes (moonGeoPos/sunGeoPos/hookBasis only ever translate, never
	// rotate), so an inclination measured in ANY of these frames via
	// O.elementsFromState is already relative to the ecliptic — this only
	// picks the gravitationally-relevant origin, not a different orientation.
	function localFrameAt(rGeo, jde, primary) {
		if (primary === "Moon") {
			return { GM: GM_M, originR: moonGeoPos(jde), originV: moonGeoVel(jde), body: "Moon" };
		}
		var rmag = Math.hypot(rGeo[0], rGeo[1], rGeo[2]);
		if (primary === "Sun" || rmag > 0.1 * A_EARTH) {
			var eh = earthHelio(jde);
			return { GM: GM_S, originR: O.vScale(eh.r, -1), originV: O.vScale(eh.v, -1), body: "Sun" };
		}
		return { GM: GM_E, originR: [0, 0, 0], originV: [0, 0, 0], body: "Earth" };
	}

	function bodyLabelForGM(GM) {
		if (GM === GM_M) { return "Moon"; }
		if (GM === GM_S) { return "Sun"; }
		return "Earth";
	}

	// Core burn math in ONE consistent local frame (GM, rLocal, vBefore all
	// relative to the same body). Everything a waypoint needs — the resulting
	// velocity, the drawn arrows, the readout card — derives from this single
	// call, so the burn, its Oberth amplification and its (ecliptic-relative)
	// plane change are all evaluated at the same point with the same physics.
	function burnEffect(GM, rLocal, vBefore, burn) {
		var vAfter = O.applyBurn(rLocal, vBefore, burn.pro, burn.nrm, burn.rad);
		var dSpeed = O.vMag(vAfter) - O.vMag(vBefore);
		var iBefore = O.elementsFromState(GM, rLocal, vBefore).i;
		var iAfter  = O.elementsFromState(GM, rLocal, vAfter).i;
		return {
			vAfter: vAfter,
			dv: O.vSub(vAfter, vBefore),                       // = geocentric Δv too (translation cancels)
			dSpeedVec: O.vScale(O.vUnit(vAfter), dSpeed),       // along local prograde; reversed if dSpeed<0
			burnDv: Math.hypot(burn.pro, burn.nrm, burn.rad) / 1000,
			planeChange: (iAfter - iBefore) * 180 / Math.PI,
			progradeDv: dSpeed / 1000
		};
	}

	// State (r,v, m/m·s⁻¹, geocentric) at elapsed time t (s) into an
	// "integrated" leg — linearly interpolated between the two bracketing RK4
	// samples. The samples are dense (≤1° of turn per step, with tighter
	// distance caps in cislunar space — see integrateTrajectory), so linear
	// interpolation error is negligible against everything else here, and it
	// lets a dragged waypoint glide CONTINUOUSLY along the curve instead of
	// snapping to the nearest recorded sample.
	function stateAtLegTime(leg, t) {
		var arr = leg.samples;
		if (t <= arr[0].t) { return { r: arr[0].r.slice(), v: arr[0].v.slice(), jde: leg.jde0 + arr[0].t/86400 }; }
		for (var k = 1; k < arr.length; k++) {
			if (arr[k].t >= t) {
				var a = arr[k - 1], b = arr[k];
				var f = (b.t - a.t) > 1e-9 ? (t - a.t) / (b.t - a.t) : 0;
				return {
					r: [ a.r[0] + f*(b.r[0]-a.r[0]), a.r[1] + f*(b.r[1]-a.r[1]), a.r[2] + f*(b.r[2]-a.r[2]) ],
					v: [ a.v[0] + f*(b.v[0]-a.v[0]), a.v[1] + f*(b.v[1]-a.v[1]), a.v[2] + f*(b.v[2]-a.v[2]) ],
					jde: leg.jde0 + t/86400
				};
			}
		}
		var last = arr[arr.length - 1];
		return { r: last.r.slice(), v: last.v.slice(), jde: leg.jde0 + last.t/86400 };
	}

	// A leg on the exact Moon-bound two-body ellipse (only ever leg 0 — the
	// case where release itself stays bound with apoapsis inside the Moon's
	// SOI). Rendered Moon-relative (added as a child of moonPosGroup, which
	// itself sits at the Moon's current position) — the same "one loop, drawn
	// as if the Moon stayed put" approximation the pre-waypoint code already
	// made.
	function buildMoonEllipseLeg(relR, relV, jde0, elM) {
		var period = conicPeriod(GM_M, elM);
		var arc = O.sampleArc(GM_M, relR, relV, period, 360);    // [{r (Moon-relative, m), t}]
		var pts = arc.map(function (p) { return new THREE.Vector3(mToU(p.r[0]), mToU(p.r[1]), mToU(p.r[2])); });
		return {
			kind: "moonEllipse", moonFrame: true, color: 0xb060ff, primary: "Moon",
			points: pts, samples: arc, relR: relR, relV: relV,
			jde0: jde0, duration: period,
			periAlt: (O.periapsisRadius(elM.a, elM.e) - R_M) / 1e3,
			apoAlt:  (O.apoapsisRadius(elM.a, elM.e)  - R_M) / 1e3,
			impact: null, vinfEarth: null, inclRad: null
		};
	}

	// A leg integrated with real Earth+Moon+Sun gravity (RK4) from a
	// geocentric state, run to its natural end (impact / one bound orbit /
	// 0.1 AU escape) — see integrateTrajectory.
	function buildIntegratedLeg(R0, V0, jde0) {
		var res = integrateTrajectory(R0, V0, jde0);
		var primary = res.branch === "orange" ? "Sun" : (res.branch === "moon" ? "Moon" : "Earth");
		var color = res.branch === "orange" ? 0xff9a3c : (res.branch === "moon" ? 0xb060ff : 0x40d27f);
		var leg = {
			kind: "integrated", moonFrame: false, color: color, primary: primary,
			points: res.pts, samples: res.samples, jde0: jde0, duration: res.duration,
			impact: res.impact, rmin: res.rmin, rmax: res.rmax,
			helioEl: res.helioEl, vinfEarth: res.vinfEarth,
			inclRad: res.branch === "orange" ? (res.helioEl ? res.helioEl.i : null)
				: res.branch === "moon" ? res.inclLunar : res.inclEarth
		};
		if (res.branch === "moon") {
			leg.periAlt = (res.moonRmin - R_M) / 1e3;
			leg.apoAlt  = (res.moonRmax - R_M) / 1e3;
			// Render (and hit-test) this leg the same Moon-relative, "Moon stood
			// still at the current date" way buildMoonEllipseLeg renders leg 0,
			// instead of the true absolute geocentric points (leg.points) used
			// for physics. Using the true points here would draw a curve that
			// jumps by however far the real Moon moved since the leg started —
			// moonPosGroup, which this gets parented under, sits frozen at the
			// Moon's CURRENT (state.jd) position — which is exactly what made a
			// waypoint on a lunar orbit look like it cut apart into a
			// disconnected second piece. Each point uses the Moon's REAL
			// position at that SAMPLE's own time (not the frozen one), so the
			// shape is correct; only its anchor is the frozen "moon stood still"
			// one, matching leg 0.
			leg.moonRelPoints = res.samples.map(function (s) {
				var mr = moonGeoPos(jde0 + s.t / 86400);
				return new THREE.Vector3(mToU(s.r[0] - mr[0]), mToU(s.r[1] - mr[1]), mToU(s.r[2] - mr[2]));
			});
		}
		return leg;
	}

	// Drawn polyline for a leg, truncated at `uptoT` seconds (the waypoint
	// that opens the next leg) — or the full leg when uptoT is null (no
	// waypoint there, or a drag search, which always spans the full leg).
	// Uses moonRelPoints (Moon-relative, "Moon stood still" render points —
	// see buildIntegratedLeg/buildMoonEllipseLeg) in place of the true
	// absolute points whenever the leg has them, so the drawn cut lands in
	// the same space the rest of the leg is drawn in.
	function legDrawPoints(leg, uptoT) {
		var renderPts = leg.moonRelPoints || leg.points;
		if (uptoT == null || uptoT >= leg.duration) { return renderPts; }
		if (leg.kind === "moonEllipse") {
			var arc = O.sampleArc(GM_M, leg.relR, leg.relV, Math.max(uptoT, 1), 360);
			return arc.map(function (p) { return new THREE.Vector3(mToU(p.r[0]), mToU(p.r[1]), mToU(p.r[2])); });
		}
		var pts = [];
		for (var k = 0; k < leg.samples.length; k++) {
			if (leg.samples[k].t > uptoT) { break; }
			pts.push(renderPts[k]);
		}
		var st = stateAtLegTime(leg, uptoT);
		if (leg.moonRelPoints) {
			var mr = moonGeoPos(st.jde);
			pts.push(new THREE.Vector3(mToU(st.r[0] - mr[0]), mToU(st.r[1] - mr[1]), mToU(st.r[2] - mr[2])));
		} else {
			pts.push(new THREE.Vector3(mToU(st.r[0]), mToU(st.r[1]), mToU(st.r[2])));
		}
		return pts;
	}

	// Elapsed time (s) into a leg at which its drawn path first accumulates
	// `targetDistM` metres of arc length from the leg's start — used to plant
	// a freshly-created waypoint a set distance along the trajectory rather
	// than at a fixed fraction of its (highly variable) duration. Clamped to
	// the leg's own end if the whole leg is shorter than the target.
	function distanceAlongLegToTime(leg, targetDistM) {
		var arr = leg.samples, cum = 0;
		for (var k = 1; k < arr.length; k++) {
			var a = arr[k - 1].r, b = arr[k].r;
			var segLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
			if (cum + segLen >= targetDistM) {
				var f = segLen > 1e-9 ? (targetDistM - cum) / segLen : 0;
				return arr[k - 1].t + f * (arr[k].t - arr[k - 1].t);
			}
			cum += segLen;
		}
		return leg.duration;
	}

	// Cumulative arc length (m) of a leg's drawn path from its start up to
	// elapsed time t (s) — the inverse of distanceAlongLegToTime. Omitting t
	// (or passing leg.duration) gives the leg's total length. Used by the
	// waypoint-gizmo drag (dragWaypoint) to convert a waypoint's current time
	// into a distance, and to find how far a leg runs in total.
	function timeToDistanceAlongLeg(leg, t) {
		if (t == null) { t = leg.duration; }
		var arr = leg.samples, cum = 0;
		for (var k = 1; k < arr.length; k++) {
			var a = arr[k - 1].r, b = arr[k].r;
			var segLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
			if (arr[k].t >= t) {
				var segDur = arr[k].t - arr[k - 1].t;
				var f = segDur > 1e-9 ? (t - arr[k - 1].t) / segDur : 0;
				return cum + segLen * f;
			}
			cum += segLen;
		}
		return cum;
	}

	// World-space render point (THREE.Vector3, scene units, LOCAL — i.e. not
	// yet transformed by moonPosGroup) on a leg's drawn path at arc length s
	// (m) from its start, interpolated between the two bracketing samples —
	// in the SAME render space the leg is actually drawn in (moonRelPoints
	// when the leg is Moon-bound, else the true absolute points; see
	// buildIntegratedLeg/legDrawPoints). Used only by dragWaypoint, which
	// needs the curve's position (and, via two nearby calls, its local
	// tangent) at an arbitrary distance, not just at a recorded sample.
	function legRenderPointAtDistance(leg, s) {
		var renderPts = leg.moonRelPoints || leg.points;
		var arr = leg.samples, cum = 0;
		for (var k = 1; k < arr.length; k++) {
			var a = arr[k - 1].r, b = arr[k].r;
			var segLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
			if (cum + segLen >= s || k === arr.length - 1) {
				var f = segLen > 1e-9 ? (s - cum) / segLen : 0;
				f = Math.max(0, Math.min(1, f));
				return renderPts[k - 1].clone().lerp(renderPts[k], f);
			}
			cum += segLen;
		}
		return renderPts[renderPts.length - 1].clone();
	}

	// Elapsed time (s) into a leg at which it first reaches apoapsis
	// (wantApo true) or periapsis (wantApo false), or null if this leg isn't
	// an orbit of the Moon (see defaultWaypointTime) — distance-along-path is
	// the wrong default there, but the apsides are the natural handles on an
	// actual lunar orbit. Works for both the exact two-body ellipse (leg 0,
	// kind "moonEllipse") and an integrated leg that stays Moon-bound (any
	// later leg with primary "Moon"), deriving elements from whichever start
	// state the leg actually has.
	function firstApsisTime(leg, wantApo) {
		if (leg.primary !== "Moon") { return null; }
		var r0, v0;
		if (leg.kind === "moonEllipse") {
			r0 = leg.relR; v0 = leg.relV;
		} else {
			var s0 = leg.samples[0];
			r0 = O.vSub(s0.r, moonGeoPos(leg.jde0));
			v0 = O.vSub(s0.v, moonGeoVel(leg.jde0));
		}
		var el = O.elementsFromState(GM_M, r0, v0);
		if (!(el.e < 1) || !isFinite(el.a)) { return null; }
		var n = O.meanMotion(GM_M, el.a);
		var M0 = O.meanAnomalyFromTrue(el.nu, el.e);
		var targetM = wantApo ? Math.PI : 0;
		var TWO_PI = 2 * Math.PI;
		var dt = (((targetM - M0) % TWO_PI) + TWO_PI) % TWO_PI / n;
		return Math.min(dt, leg.duration);
	}

	// Default elapsed time (s) for a freshly-created waypoint (before it's
	// ever been dragged) on leg index `idx` (0 for WP 1, 1 for WP 2). This
	// calculator is built around cislunar work — nudging a trajectory that's
	// still close to the Moon, or setting up an Earth flyby — so a fresh
	// waypoint should land close to the Moon, not at the leg's halfway point
	// in TIME (which for an escaping trajectory could be days away). WP 1
	// defaults to 100,000 km along its leg; WP 2 to 100,000 km along ITS OWN
	// leg — which, since leg 2 begins exactly where WP 1 sits, works out to
	// 200,000 km along the overall trajectory as long as WP 1 hasn't been
	// moved and its burn is still zero. On an actual lunar (Moon-bound) orbit,
	// distance-along-the-path is a poor default — the natural handles are the
	// apsides — so WP 1 defaults to that leg's first apoapsis and WP 2 to its
	// first periapsis (the classic apoapsis-raise / periapsis-lower pair);
	// this applies per-leg, so it still triggers for WP 2 if WP 1's burn (or
	// leg 0 not being lunar) leaves leg 2 as the one that's Moon-bound.
	var WP_DEFAULT_DIST_M = 100000 * 1e3;   // 100,000 km, per leg
	function defaultWaypointTime(leg, idx) {
		var apsis = firstApsisTime(leg, idx === 0);
		return apsis != null ? apsis : distanceAlongLegToTime(leg, WP_DEFAULT_DIST_M);
	}

	// Decide the trajectory's primary and produce its scene-unit polyline. A
	// release that stays bound inside the Moon's SOI is a simple two-body Moon
	// ellipse (purple); otherwise the path is integrated and colored by where it
	// ends up — bound to Earth (green) or escaping to a heliocentric orbit
	// (orange). Then, for each defined waypoint, apply its burn (in the local
	// frame of whichever body dominates there) and integrate a fresh leg from
	// the result — chaining up to two extra legs onto the drawn path.
	function computeTrajectory() {
		var rel = releaseState();
		var elM = O.elementsFromState(GM_M, rel.r, rel.v);
		var apoM = elM.e < 1 ? O.apoapsisRadius(elM.a, elM.e) : Infinity;
		var legs = [];
		if (elM.e < 1 && apoM < SOI_MOON) {
			legs.push(buildMoonEllipseLeg(rel.r, rel.v, state.jd, elM));
		} else {
			var st = LE.moonState(state.jd);
			var moonR = [st.r[0]*1e3, st.r[1]*1e3, st.r[2]*1e3];
			var moonV = [st.v[0]*1e3, st.v[1]*1e3, st.v[2]*1e3];
			legs.push(buildIntegratedLeg(O.vAdd(moonR, rel.r), O.vAdd(moonV, rel.v), state.jd));
		}

		var wpResults = [];   // per resolved waypoint: burn effect + render/handoff data
		for (var i = 0; i < state.waypoints.length; i++) {
			var wp = state.waypoints[i];
			var leg = legs[i];
			if (!leg || leg.impact) { break; }     // the trajectory ends before this waypoint
			var tAt = (wp.t == null) ? defaultWaypointTime(leg, i) : Math.max(0, Math.min(leg.duration, wp.t));
			wp.t = tAt;

			var GM, rLocal, vLocal, jde, renderPosM, space, rGeoAt, vGeoAt, frame;
			if (leg.kind === "moonEllipse") {
				var s = O.propagateState(GM_M, leg.relR, leg.relV, tAt);
				GM = GM_M; rLocal = s.r; vLocal = s.v; jde = leg.jde0 + tAt/86400;
				renderPosM = s.r; space = "moon";
			} else {
				var st2 = stateAtLegTime(leg, tAt);
				jde = st2.jde; rGeoAt = st2.r; vGeoAt = st2.v;
				frame = localFrameAt(st2.r, jde, leg.primary);
				GM = frame.GM; rLocal = O.vSub(st2.r, frame.originR); vLocal = O.vSub(st2.v, frame.originV);
				// Render (and hit-test) a Moon-bound leg the same Moon-relative,
				// "Moon stood still at the current date" way buildMoonEllipseLeg
				// renders leg 0 (rLocal already IS that offset, from frame.originR
				// = moonGeoPos(jde) above) — not the true absolute position, which
				// would jump by however far the real Moon moved since the leg
				// started, since moonPosGroup itself sits frozen at the Moon's
				// CURRENT (state.jd) position. See buildIntegratedLeg/legDrawPoints
				// for the matching choice on the drawn polyline.
				if (frame.body === "Moon") { renderPosM = rLocal; space = "moon"; }
				else { renderPosM = st2.r; space = "geo"; }
			}
			var eff = burnEffect(GM, rLocal, vLocal, wp.burn);
			wpResults.push({ eff: eff, renderPosM: renderPosM, rLocal: rLocal, vLocal: vLocal,
			                  GM: GM, space: space, jde: jde, legIdx: i, bodyLabel: bodyLabelForGM(GM) });

			// Geocentric handoff state for the next leg — reuses `frame` (the
			// same local frame the burn itself was computed in), so the origin
			// velocity added back is exactly the one that was subtracted out.
			var rGeoNext, vGeoNext;
			if (leg.kind === "moonEllipse") {
				rGeoNext = O.vAdd(moonGeoPos(jde), rLocal);
				vGeoNext = O.vAdd(moonGeoVel(jde), eff.vAfter);
			} else {
				rGeoNext = rGeoAt;
				vGeoNext = O.vAdd(eff.vAfter, frame.originV);
			}
			legs.push(buildIntegratedLeg(rGeoNext, vGeoNext, jde));
		}

		return { legs: legs, wpResults: wpResults, final: legs[legs.length - 1] };
	}

	function buildTrajectory() {
		if (trajectoryGroup) {
			if (trajectoryGroup.parent) { trajectoryGroup.parent.remove(trajectoryGroup); }
			disposeGroup(trajectoryGroup);
			trajectoryGroup = null;
		}
		if (trajectoryMoonGroup) {
			if (trajectoryMoonGroup.parent) { trajectoryMoonGroup.parent.remove(trajectoryMoonGroup); }
			disposeGroup(trajectoryMoonGroup);
			trajectoryMoonGroup = null;
		}

		var res = computeTrajectory();
		var t = res.final;

		// keep the "Create waypoint" checkboxes in step with the waypoint count
		if (createWp1) { createWp1.checked = state.waypoints.length >= 1; }
		if (createWp2) {
			createWp2.checked = state.waypoints.length >= 2;
			createWp2.disabled = state.waypoints.length < 1;
		}
		// rebuild the waypoint list DOM only when the count changes — rebuilding
		// on every refresh would tear down a burn-vector-editor SVG mid-drag
		if (state.waypoints.length !== lastWpCount) {
			lastWpCount = state.waypoints.length;
			buildWaypointList();
		}

		// Read-outs: primary, then periapsis / apoapsis above the primary's surface
		// (Moon/Earth, km) or heliocentric distance (Sun, AU). An impact is named.
		trajPrimOut.textContent = t.primary;
		if (t.primary === "Moon") {
			if (t.impact) {
				trajPeriOut.textContent = "impacts " + t.impact;
				trajApoOut.textContent = "—";
			} else {
				trajPeriOut.textContent = fmt(t.periAlt, 0) + " km";
				trajApoOut.textContent = fmt(t.apoAlt, 0) + " km";
			}
		} else if (t.primary === "Earth") {
			trajPeriOut.textContent = t.impact ? "impacts " + t.impact : fmt((t.rmin - R_E)/1e3, 0) + " km";
			trajApoOut.textContent = t.rmax > 0 ? fmt((t.rmax - R_E)/1e3, 0) + " km" : "—";
		} else {
			var h = t.helioEl;
			trajPeriOut.textContent = h ? (O.periapsisRadius(h.a, h.e)/A_EARTH).toFixed(3) + " AU" : "—";
			trajApoOut.textContent = (h && h.e < 1) ? (O.apoapsisRadius(h.a, h.e)/A_EARTH).toFixed(3) + " AU" : "— (escape)";
		}

		// Orbital inclination for the final leg's orbit — label and reference
		// plane both depend on the primary. Moon: against the skyhook's own
		// orbital plane (0 by construction until a waypoint burn's normal
		// component tips it, so "—" is correct pre-waypoint — see
		// lunarInclination). Earth: against the ecliptic. Sun: heliocentric,
		// also against the ecliptic (every frame here shares the same
		// non-rotating, ecliptic-aligned axes — see the note above localFrameAt).
		if (t.primary === "Moon") { trajInclLabelOut.textContent = "lunar inclination"; }
		else if (t.primary === "Earth") { trajInclLabelOut.textContent = "inclination to ecliptic"; }
		else { trajInclLabelOut.textContent = "heliocentric inclination"; }
		trajInclOut.textContent = (t.inclRad != null) ? fmt(t.inclRad * 180 / Math.PI, 1) + "°" : "—";

		// v_inf at Earth's SOI — the actual hyperbolic excess relative to Earth
		// from the integrated trajectory (replaces the prograde-aligned first cut).
		if (t.primary === "Moon") {
			vinfEarthOut.textContent = "—";
			earthNote.textContent = "Bound to the Moon (never reaches Earth's SOI).";
		} else if (t.vinfEarth != null) {
			vinfEarthOut.textContent = fmt(t.vinfEarth, 0) + " m/s";
			earthNote.textContent = "Escapes Earth; heliocentric apsides are an estimate.";
		} else {
			vinfEarthOut.textContent = "captured by Earth";
			earthNote.textContent = "Bound to Earth after the Moon escape.";
		}

		// Draw each leg, truncated where a waypoint burn opens the next one.
		var moonGrp = new THREE.Group(), geoGrp = new THREE.Group();
		var visible = trajToggle ? trajToggle.checked : true;
		var anyMoon = false, anyGeo = false;
		res.legs.forEach(function (leg, i) {
			var uptoT = (i < res.wpResults.length) ? state.waypoints[i].t : null;
			var pts = legDrawPoints(leg, uptoT);
			var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
				new THREE.LineBasicMaterial({ color: leg.color }));
			// Route by moonRelPoints (present exactly when the leg is rendered
			// Moon-relative — leg 0's exact ellipse, or a later leg that's still
			// Moon-bound), not by kind alone, so a post-waypoint lunar leg
			// parents under moonPosGroup too instead of drawing in absolute
			// geocentric space (which used to draw it in a totally different,
			// disconnected place — see legDrawPoints/buildIntegratedLeg).
			if (leg.kind === "moonEllipse" || leg.moonRelPoints) { moonGrp.add(line); anyMoon = true; }
			else { geoGrp.add(line); anyGeo = true; }
		});
		moonGrp.visible = visible; geoGrp.visible = visible;
		if (anyMoon) { moonPosGroup.add(moonGrp); trajectoryMoonGroup = moonGrp; }
		if (anyGeo) { scene.add(geoGrp); trajectoryGroup = geoGrp; }

		placeWaypointVisuals(res.wpResults, res.legs);

		// per-waypoint info line + the straddling burn-readout cards
		var entries = [];
		res.wpResults.forEach(function (wr, idx) {
			var wp = state.waypoints[idx];
			var info = document.getElementById("msk-wp-info-" + idx);
			if (info) {
				var days = (wr.jde - state.jd).toFixed(1);
				// "<body> frame", not "near <body>" — on a Sun-primary leg the
				// burn frame is heliocentric even right next to the Moon.
				info.textContent = "+" + days + " d, " + wr.bodyLabel + " frame, coast speed "
					+ (O.vMag(wr.vLocal)/1000).toFixed(2) + " km/s (" + wr.bodyLabel + "-relative).";
			}
			var mag = Math.hypot(wp.burn.pro, wp.burn.nrm, wp.burn.rad);
			entries.push({ host: wp._host, data: mag < 1 ? null :
				{ burnDv: wr.eff.burnDv, planeChange: wr.eff.planeChange, progradeDv: wr.eff.progradeDv } });
		});
		for (var ii = res.wpResults.length; ii < state.waypoints.length; ii++) {
			var info2 = document.getElementById("msk-wp-info-" + ii);
			if (info2) { info2.textContent = "Unreachable — the trajectory ends before this point."; }
		}
		renderBurnReadouts(entries);

		// feed the solar-system context view (only recomputes its overlay when shown)
		lastTrajRes = res;
		if (Helio.built && state.view === "helio") { Helio.updateTrajectory(res); }
	}

	// =======================================================================
	//  Waypoint gizmos + burn-vector arrows + straddling readout cards
	// =======================================================================
	// One axis of a waypoint gizmo: a line from the origin out along a unit
	// direction, drawn on top of everything else.
	function makeAxisLine(dir, colorHex) {
		var g = new THREE.BufferGeometry().setFromPoints(
			[new THREE.Vector3(0, 0, 0), new THREE.Vector3(dir[0], dir[1], dir[2])]);
		return new THREE.Line(g, new THREE.LineBasicMaterial({
			color: colorHex, depthTest: false, transparent: true }));
	}

	// A prograde / radial / normal gizmo at a waypoint, aligned via the SAME
	// OrbitalMath.burnFrame the burn is applied in (applyBurn/burnEffect):
	// prograde along the local velocity, normal = ecliptic north with its
	// prograde part removed, radial = the leftover axis — matching the
	// Solar-System-Trajectory-Plotter's gizmo exactly. (It previously drew
	// the osculating orbit frame, n = r×v, which is NOT the frame the burn
	// sliders act in — the drawn normal/radial arms were tilted away from
	// the real burn axes whenever the orbit plane wasn't the ecliptic.)
	// Colours match the vector-editor widget: prograde green, radial orange,
	// normal blue. Positioned at renderPosM (Moon-relative or geocentric
	// metres, matching the leg it sits on) but oriented from the LOCAL burn
	// frame, which can differ from the render frame during a flyby — that's
	// intentional (see localFrameAt).
	function makeWaypointGizmo(renderPosM, rLocalM, vLocalMS) {
		var f = O.burnFrame(rLocalM, vLocalMS);
		var vhat = f.pro, nhat = f.nrm, rhat = f.rad;
		var g = new THREE.Group();
		g.add(makeAxisLine(vhat, 0x6fd49a));   // prograde
		g.add(makeAxisLine(rhat, 0xffb45a));   // radial
		g.add(makeAxisLine(nhat, 0x8ab4ff));   // normal
		g.position.set(mToU(renderPosM[0]), mToU(renderPosM[1]), mToU(renderPosM[2]));
		g.renderOrder = 10;
		// Local-space unit endpoints of the three drawn arms, kept for hit
		// testing (hitWaypoint) — the arms are what's actually visible on
		// screen (they extend well past the centre point), so grabbing needs
		// to test against their full length, not just the gizmo's origin.
		g.userData.axes = [
			new THREE.Vector3(vhat[0], vhat[1], vhat[2]),
			new THREE.Vector3(rhat[0], rhat[1], rhat[2]),
			new THREE.Vector3(nhat[0], nhat[1], nhat[2])
		];
		return g;
	}

	// One arrow for a velocity-like vector (m/s), anchored at renderPosM
	// (metres, in whichever space the caller's group lives in). Length is
	// BURN_VEC_SCALE scene-units (i.e. 1000 km) per km/s; drawn on top so it's
	// always visible. Returns null for a negligible vector.
	function makeBurnArrow(renderPosM, vecMS, colorHex) {
		var kms = O.vMag(vecMS) / 1000;
		if (kms < 0.02) { return null; }
		var len = kms * BURN_VEC_SCALE;
		var dir = new THREE.Vector3(vecMS[0], vecMS[1], vecMS[2]).normalize();
		var origin = new THREE.Vector3(mToU(renderPosM[0]), mToU(renderPosM[1]), mToU(renderPosM[2]));
		var arrow = new THREE.ArrowHelper(dir, origin, len, colorHex, len * 0.22, len * 0.12);
		[arrow.line, arrow.cone].forEach(function (o) {
			o.material.depthTest = false; o.material.depthWrite = false;
			o.material.transparent = true; o.renderOrder = 12;
		});
		return arrow;
	}

	// Rebuild the draggable gizmos and dV / prograde-speed-change arrows for
	// every resolved waypoint. Each waypoint lives in its own space (Moon-
	// relative for a waypoint on the Moon-ellipse leg 0, geocentric for any
	// other) — parented accordingly so it visually sits exactly on its leg's
	// drawn curve.
	function placeWaypointVisuals(wpResults, legs) {
		wpMarkers.forEach(function (m) {
			if (m.mesh.parent) { m.mesh.parent.remove(m.mesh); }
			disposeGroup(m.mesh);
		});
		wpMarkers = [];
		burnArrows.forEach(function (a) { a.parent.remove(a.obj); });
		burnArrows = [];

		var showVecs = !burnVecToggle || burnVecToggle.checked;
		wpResults.forEach(function (wr, i) {
			var parent = (wr.space === "moon") ? moonPosGroup : scene;
			var giz = makeWaypointGizmo(wr.renderPosM, wr.rLocal, wr.vLocal);
			parent.add(giz);
			wpMarkers.push({ mesh: giz, leg: legs[i] });
			if (showVecs) {
				var spdArrow = makeBurnArrow(wr.renderPosM, wr.eff.dSpeedVec, DSPEED_COLOR);
				var dvArrow  = makeBurnArrow(wr.renderPosM, wr.eff.dv, DV_COLOR);
				[spdArrow, dvArrow].forEach(function (a) {   // dV last => on top where they overlap
					if (a) { parent.add(a); burnArrows.push({ obj: a, parent: parent }); }
				});
			}
		});
	}

	// Keep each waypoint gizmo a constant on-screen size regardless of zoom.
	var _wpGizPos = new THREE.Vector3();
	function updateWaypointGizmos() {
		for (var i = 0; i < wpMarkers.length; i++) {
			var g = wpMarkers[i].mesh;
			g.getWorldPosition(_wpGizPos);
			g.scale.setScalar(screenScaleAt(_wpGizPos, 42));
		}
	}

	// ---- burn readouts: a small pane straddling the panel edge, per burn ----
	function fmtSigned(x, digits, unit) {
		return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(digits) + unit;
	}

	// Rebuild the readout boxes from a list of { host, data } (data may be null).
	function renderBurnReadouts(entries) {
		if (!readoutLayer) { return; }
		readoutBoxes.forEach(function (b) { readoutLayer.removeChild(b.el); });
		readoutBoxes = [];
		entries.forEach(function (en) {
			if (!en.data || !en.host) { return; }
			var box = document.createElement("div");
			box.className = "msk-readout";
			box.innerHTML =
				'<div class="msk-readout-row"><span class="msk-readout-label">burn Δv</span>'
				+ '<span class="msk-readout-val" style="color:' + dvHex + '">' + en.data.burnDv.toFixed(2) + ' km/s</span></div>'
				+ '<div class="msk-readout-row"><span class="msk-readout-label">plane change (to ecliptic)</span>'
				+ '<span class="msk-readout-val" style="color:' + dvHex + '">' + fmtSigned(en.data.planeChange, 1, '°') + '</span></div>'
				+ '<div class="msk-readout-row"><span class="msk-readout-label">prograde Δv</span>'
				+ '<span class="msk-readout-val" style="color:' + spdHex + '">' + fmtSigned(en.data.progradeDv, 2, ' km/s') + '</span></div>';
			readoutLayer.appendChild(box);
			readoutBoxes.push({ el: box, host: en.host });
		});
		positionBurnReadouts();
	}

	// Place each readout box straddling the panel's left edge, vertically
	// centred on its burn widget. Hidden when its widget is scrolled out of
	// the panel.
	function positionBurnReadouts() {
		if (!readoutBoxes.length || !mainEl || !panelEl) { return; }
		var mr = mainEl.getBoundingClientRect();
		var pr = panelEl.getBoundingClientRect();
		var boundary = pr.left - mr.left;            // panel's left edge in main coords
		readoutBoxes.forEach(function (b) {
			var hr = b.host.getBoundingClientRect();
			var visible = hr.bottom > pr.top + 4 && hr.top < pr.bottom - 4;
			b.el.style.display = visible ? "" : "none";
			if (!visible) { return; }
			var w = b.el.offsetWidth, h = b.el.offsetHeight;
			var left = boundary - w / 2;
			if (left < 4) { left = 4; }              // stacked layout: keep on-screen
			b.el.style.left = left + "px";
			b.el.style.top  = (hr.top - mr.top + hr.height / 2 - h / 2) + "px";
		});
	}

	// =======================================================================
	//  Per-frame: camera, label/point/marker sizing
	// =======================================================================
	function updateCamera() {
		var r = cam.radius;
		var sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
		camera.position.set(
			cam.target.x + r * sp * Math.cos(cam.theta),
			cam.target.y + r * sp * Math.sin(cam.theta),
			cam.target.z + r * cp);
		camera.up.set(0, 0, 1);
		camera.lookAt(cam.target);
	}

	var _lp = new THREE.Vector3();
	function updateLabels() {
		var w = holder.clientWidth, h = holder.clientHeight;
		for (var i = 0; i < labelList.length; i++) {
			var L = labelList[i];
			L.obj.getWorldPosition(_lp).project(camera);
			if (_lp.z < 1 && _lp.x > -1.06 && _lp.x < 1.06 && _lp.y > -1.06 && _lp.y < 1.06) {
				L.el.style.display = "block";
				L.el.style.left = ((_lp.x * 0.5 + 0.5) * w + 7) + "px";
				L.el.style.top  = ((-_lp.y * 0.5 + 0.5) * h) + "px";
			} else {
				L.el.style.display = "none";
			}
		}
	}

	function screenScaleAt(pos, px) {
		var h = holder.clientHeight || 1;
		var f = (h / 2) / Math.tan(camera.fov * Math.PI / 360);
		var dist = camera.position.distanceTo(pos) || 1e-9;
		return px * dist / f;
	}

	var _mkPos = new THREE.Vector3();
	function updateMarkers() {
		// Show a body's dot only when its drawn sphere is smaller than ~1 pixel,
		// i.e. when the camera is far enough that the sphere would vanish.
		earthPoint.visible = mToU(R_E) < screenScaleAt(_mkPos.set(0, 0, 0), 1);
		moonPosGroup.getWorldPosition(_mkPos);
		moonPoint.visible = mToU(R_M) < screenScaleAt(_mkPos, 1);
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
		updateCamera();
		updateMarkers();
		updateLabels();
		updateWaypointGizmos();
		positionBurnReadouts();
		renderer.render(scene, camera);
	}

	// =======================================================================
	//  Camera controls (custom; OrbitControls isn't file://-safe)
	// =======================================================================
	function bindControls() {
		var el = renderer.domElement;
		var dragging = null, lx = 0, ly = 0, draggingRelease = false, draggingWp = -1;
		// Waypoint-drag state (see dragWaypoint) — an object so it can be
		// passed by reference and mutated across mousemove calls without
		// nesting dragWaypoint inside this closure.
		var wpDrag = { x: 0, y: 0, s: 0 };
		var hDragging = null, hlx = 0, hly = 0;   // solar-system-view drag state

		el.addEventListener("contextmenu", function (e) { e.preventDefault(); });

		el.addEventListener("mousedown", function (e) {
			if (state.view === "helio") {
				hDragging = (e.button === 2 || e.shiftKey) ? "pan" : "rotate";
				hlx = e.clientX; hly = e.clientY;
				return;
			}
			// start a release-marker drag if the press lands on it
			if (e.button === 0 && releaseMesh && releaseMesh.visible && hookToggle.checked && hitRelease(e)) {
				draggingRelease = true;
				return;
			}
			// start a waypoint-gizmo drag if the press lands on one — seed the
			// drag's arc-length position from the waypoint's CURRENT time, so
			// the very first mousemove nudges it from there rather than jumping.
			if (e.button === 0) {
				var wpHit = hitWaypoint(e);
				if (wpHit >= 0) {
					draggingWp = wpHit;
					var wpLeg = wpMarkers[wpHit].leg, wpVal = state.waypoints[wpHit];
					wpDrag.s = wpVal ? timeToDistanceAlongLeg(wpLeg, wpVal.t) : 0;
					wpDrag.x = e.clientX; wpDrag.y = e.clientY;
					return;
				}
			}
			dragging = (e.button === 2 || e.shiftKey) ? "pan" : "rotate";
			lx = e.clientX; ly = e.clientY;
		});

		window.addEventListener("mousemove", function (e) {
			if (state.view === "helio") {
				if (!hDragging) { return; }
				var hdx = e.clientX - hlx, hdy = e.clientY - hly;
				hlx = e.clientX; hly = e.clientY;
				var hc = Helio.cam;
				if (hDragging === "rotate") {
					hc.theta -= hdx * 0.005;
					hc.phi = Math.max(0.05, Math.min(Math.PI - 0.05, hc.phi - hdy * 0.005));
				} else {
					var hp = hc.radius * 0.0018;
					var hright = new THREE.Vector3().crossVectors(
						new THREE.Vector3().subVectors(hc.target, Helio.camera.position), Helio.camera.up).normalize();
					hc.target.addScaledVector(hright, -hdx * hp);
					hc.target.addScaledVector(Helio.camera.up.clone(), hdy * hp);
				}
				return;
			}
			if (draggingRelease) { dragRelease(e); return; }
			if (draggingWp >= 0) { dragWaypoint(e, draggingWp, wpDrag); return; }
			if (!dragging) { return; }
			var dx = e.clientX - lx, dy = e.clientY - ly;
			lx = e.clientX; ly = e.clientY;
			if (dragging === "rotate") {
				cam.theta -= dx * 0.005;
				cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi - dy * 0.005));
			} else {
				var panScale = cam.radius * 0.0016;
				var right = new THREE.Vector3().crossVectors(
					new THREE.Vector3().subVectors(cam.target, camera.position), camera.up).normalize();
				cam.target.addScaledVector(right, -dx * panScale);
				cam.target.addScaledVector(camera.up.clone(), dy * panScale);
				state.focus = null;
			}
		});

		window.addEventListener("mouseup", function () { dragging = null; draggingRelease = false; draggingWp = -1; hDragging = null; });

		el.addEventListener("dblclick", function (e) {
			if (state.view === "helio") { Helio.focusNearest(e); return; }
			focusNearest(e);
		});

		el.addEventListener("wheel", function (e) {
			e.preventDefault();
			if (state.view === "helio") {
				var hf = Math.exp(e.deltaY * (e.shiftKey ? 0.0002 : 0.001));
				Helio.cam.radius = Math.max(1e-4, Math.min(500, Helio.cam.radius * hf));
				return;
			}
			// Hold Shift to zoom ~5x slower (finer control near the surface).
			var rate = e.shiftKey ? 0.0002 : 0.001;
			var f = Math.exp(e.deltaY * rate);
			if (state.focus) {
				cam.radius = Math.max(0.01, Math.min(40000, cam.radius * f));
				return;
			}
			// Zoom toward the real 3D point under the cursor when it lands on a
			// body, so pointing at the Moon zooms smoothly all the way in. (The
			// old target-depth-plane math converged on a near point in empty
			// space and stuck.) Over empty space, dolly about the current target.
			if (f < 1) {
				var hit = pickPoint(e);
				if (hit) { cam.target.lerp(hit, 1 - f); }
			}
			cam.radius = Math.max(0.01, Math.min(40000, cam.radius * f));
		}, { passive: false });
	}

	// World-space point to zoom toward for the cursor, or null to leave the
	// target alone. A direct hit on a body returns that surface point (so you can
	// aim at a spot on the Moon). Failing that, if the cursor lies within the
	// Moon's sphere of influence we head for the Moon's near face — the Moon's
	// pickable disk is a pinprick from far out, so the SOI gives a generous
	// "go to the Moon" zone. Outside the SOI we return null, so zoom simply
	// dollies about the current target (e.g. to study a point on the orbit).
	function pickPoint(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var ndc = new THREE.Vector2(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-(((e.clientY - rect.top) / rect.height) * 2 - 1));
		raycaster.setFromCamera(ndc, camera);
		var hits = raycaster.intersectObjects([moonMesh, earthMesh], true);
		if (hits.length) { return hits[0].point.clone(); }
		var moonWorld = new THREE.Vector3();
		moonPosGroup.getWorldPosition(moonWorld);
		if (raycaster.ray.intersectsSphere(new THREE.Sphere(moonWorld, mToU(SOI_MOON)))) {
			var toCam = camera.position.clone().sub(moonWorld);
			var d = toCam.length() || 1;
			return moonWorld.addScaledVector(toCam, mToU(R_M) / d);   // Moon near face
		}
		return null;
	}

	// Ray (origin + dir) through the cursor, in world (scene) coordinates.
	function cursorRay(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		var ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
		var dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera)
			.sub(camera.position).normalize();
		return { o: camera.position.clone(), d: dir };
	}

	// Is the cursor within a few px of the release sprite (screen space)?
	function hitRelease(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var wp = new THREE.Vector3();
		releaseMesh.getWorldPosition(wp).project(camera);
		var sx = (wp.x * 0.5 + 0.5) * rect.width;
		var sy = (-wp.y * 0.5 + 0.5) * rect.height;
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		return Math.hypot(sx - px, sy - py) < 16;
	}

	// Drag the release marker: project the cursor ray onto the tether line and
	// set the release altitude from the closest point's radius.
	function dragRelease(e) {
		var ray = cursorRay(e);
		var A = new THREE.Vector3();
		moonPosGroup.getWorldPosition(A);                  // tether origin = Moon centre
		var u = releaseMesh.userData.dir.clone();           // unit tether direction (world)
		var w0 = ray.o.clone().sub(A);
		var b = ray.d.dot(u);
		var dd = ray.d.dot(w0);
		var ee = u.dot(w0);
		var denom = 1 - b * b;
		if (Math.abs(denom) < 1e-9) { return; }
		var t = (ee - b * dd) / denom;                     // scene units along tether
		// clamp to [CoM, top] in altitude
		var altKm = (t * U / 1e3) - (R_M / 1e3);
		var comKm = state.comAlt / 1e3, topKm = state.topAlt / 1e3;
		altKm = Math.max(comKm, Math.min(topKm, altKm));
		commitRelAlt(altKm);
	}

	// Perpendicular screen-space distance from (px,py) to the segment
	// (ax,ay)-(bx,by), clamped to the segment (not the infinite line).
	function segDist(px, py, ax, ay, bx, by) {
		var vx = bx - ax, vy = by - ay;
		var len2 = vx * vx + vy * vy;
		var t = len2 > 1e-9 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
		t = Math.max(0, Math.min(1, t));
		var cx = ax + t * vx, cy = ay + t * vy;
		return Math.hypot(px - cx, py - cy);
	}

	// Is the cursor within a few px of a waypoint gizmo (screen space)? Tested
	// against each of the gizmo's three drawn arms (prograde/radial/normal),
	// not just its centre point — the arms extend ~42 px on screen (see
	// updateWaypointGizmos) and are what's actually visible to grab, so a
	// centre-only hit test made most of the visible gizmo ungrabbable. Returns
	// the waypoint's index, or -1.
	var _wpHitOrigin = new THREE.Vector3(), _wpHitTip = new THREE.Vector3();
	function hitWaypoint(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		var best = -1, bestD = 14;
		for (var i = 0; i < wpMarkers.length; i++) {
			var giz = wpMarkers[i].mesh;
			giz.getWorldPosition(_wpHitOrigin);
			var o = _wpHitOrigin.clone().project(camera);
			if (o.z > 1) { continue; }
			var ox = (o.x * 0.5 + 0.5) * rect.width, oy = (-o.y * 0.5 + 0.5) * rect.height;
			var axes = giz.userData.axes || [];
			for (var k = 0; k < axes.length; k++) {
				_wpHitTip.copy(axes[k]);
				giz.localToWorld(_wpHitTip);
				var t = _wpHitTip.clone().project(camera);
				if (t.z > 1) { continue; }
				var tx = (t.x * 0.5 + 0.5) * rect.width, ty = (-t.y * 0.5 + 0.5) * rect.height;
				var d = segDist(px, py, ox, oy, tx, ty);
				if (d < bestD) { bestD = d; best = i; }
			}
		}
		return best;
	}

	// Drag waypoint `idx` along its own leg's full drawn curve: nearest
	// on-screen sample wins, and its elapsed time becomes the waypoint's new
	// position. Free-drag only (no snap-to) — the search always spans the
	// leg's full natural duration, not just the currently-drawn (possibly
	// truncated-by-a-later-waypoint) portion.
	// Screen-space {x,y} (px, relative to the canvas) for a leg-local render
	// point (see legRenderPointAtDistance), or null if it projects behind the
	// camera. Shared scratch vector — only valid until the next call.
	var _wpDragPos = new THREE.Vector3();
	function projectLegLocalPoint(leg, localPt, rect) {
		_wpDragPos.copy(localPt);
		if (leg.kind === "moonEllipse" || leg.moonRelPoints) { moonPosGroup.localToWorld(_wpDragPos); }
		_wpDragPos.project(camera);
		if (_wpDragPos.z > 1) { return null; }
		return { x: (_wpDragPos.x * 0.5 + 0.5) * rect.width, y: (-_wpDragPos.y * 0.5 + 0.5) * rect.height };
	}

	// Drag waypoint `idx` smoothly along its own leg, by DISTANCE rather than
	// by re-picking whichever sample happens to be nearest the cursor on
	// screen. That on-screen-nearest approach broke down wherever the curve
	// bent back near itself (or simply had a stretch of sparse samples,
	// since RK4 spaces samples by turn angle, not distance): a small mouse
	// move could jump the waypoint a long way along the curve, to whatever
	// far-off point happened to project closest to the cursor. Distance-based
	// dragging is purely LOCAL and incremental instead: `drag.s` (metres from
	// the leg's start, seeded from the waypoint's position at mousedown — see
	// bindControls) only ever changes by however far along the curve the
	// cursor's own on-screen motion projects, measured against the curve's
	// local direction and pixel scale right where the waypoint currently is.
	// It can't "see" the rest of the curve, so a bend elsewhere can't steal
	// it — dragging is always smooth and monotonic in distance.
	var _wpDragA = new THREE.Vector3(), _wpDragB = new THREE.Vector3();
	function dragWaypoint(e, idx, drag) {
		var m = wpMarkers[idx];
		if (!m || !state.waypoints[idx]) { return; }
		var leg = m.leg;
		var total = timeToDistanceAlongLeg(leg);   // leg's total length, m
		if (total < 1) { drag.x = e.clientX; drag.y = e.clientY; return; }   // degenerate leg

		// A short local bracket [sA, sB] (sB always > sA) straddling the
		// drag's current position, used to read off both the on-screen
		// direction of increasing distance and the local pixels-per-metre
		// scale — both vary along the curve and with camera distance, so
		// they're re-measured fresh every move, right where the point is.
		var probe = Math.max(total * 0.001, 1);
		var sA, sB;
		if (drag.s + probe <= total) { sA = drag.s; sB = drag.s + probe; }
		else { sA = Math.max(0, total - probe); sB = total; }

		var rect = renderer.domElement.getBoundingClientRect();
		_wpDragA.copy(legRenderPointAtDistance(leg, sA));
		_wpDragB.copy(legRenderPointAtDistance(leg, sB));
		var pA = projectLegLocalPoint(leg, _wpDragA, rect);
		var pB = projectLegLocalPoint(leg, _wpDragB, rect);
		var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
		drag.x = e.clientX; drag.y = e.clientY;
		if (!pA || !pB) { return; }   // curve not currently on-screen here

		var tx = pB.x - pA.x, ty = pB.y - pA.y;
		var tlen = Math.hypot(tx, ty);
		if (tlen < 1e-6) { return; }   // curve is edge-on to the camera here
		tx /= tlen; ty /= tlen;
		var pxPerM = tlen / (sB - sA);
		var alongPx = dx * tx + dy * ty;          // cursor motion projected onto the curve's own direction
		var deltaM = alongPx / pxPerM;

		drag.s = Math.max(0, Math.min(total, drag.s + deltaM));
		state.waypoints[idx].t = distanceAlongLegToTime(leg, drag.s);
		refreshHook();
	}

	// Double-click a body to focus the camera on it.
	function focusNearest(e) {
		var rect = renderer.domElement.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		var targets = [
			{ name: "Moon",  obj: moonPosGroup, dist: 20 },
			{ name: "Earth", obj: earthMesh,    dist: 30 }
		];
		var best = null, bestD = 40, wp = new THREE.Vector3();
		targets.forEach(function (t) {
			t.obj.getWorldPosition(wp).project(camera);
			if (wp.z > 1) { return; }
			var sx = (wp.x * 0.5 + 0.5) * rect.width, sy = (-wp.y * 0.5 + 0.5) * rect.height;
			var d = Math.hypot(sx - px, sy - py);
			if (d < bestD) { bestD = d; best = t; }
		});
		if (!best) {
			if (state.focus) { state.focus = null; setHud("Released — free navigation."); }
			return;
		}
		state.focus = best.name;
		best.obj.getWorldPosition(cam.target);
		cam.radius = best.dist;                            // 20 000 km / 30 000 km out
		setHud("Focused on " + best.name + " (view from " + (best.dist * 1e3) + " km). Double-click empty space to release.");
	}

	// =======================================================================
	//  Body placement (date-driven) + Sun lighting
	// =======================================================================
	function placeBodies() {
		var r = LE.moonVector(state.jd);                   // km, geocentric ecliptic
		moonPosGroup.position.set(kmToU(r[0]), kmToU(r[1]), kmToU(r[2]));

		// Tidal lock: rotate the Moon mesh so its near face points at Earth.
		var dir = moonPosGroup.position.clone().normalize();
		var lon = Math.atan2(dir.y, dir.x);
		moonSpinGroup.rotation.set(0, 0, lon + Math.PI);   // prime meridian toward Earth

		// Sun lighting direction (Earth -> Sun) and its drawn disk in that direction.
		var s = LE.sunDirection(state.jd);
		sunLight.position.set(s[0] * 5000, s[1] * 5000, s[2] * 5000);
		sunLight.target.position.set(0, 0, 0);
		sunMesh.position.set(s[0] * SUN_DRAW_DIST, s[1] * SUN_DRAW_DIST, s[2] * SUN_DRAW_DIST);
		earthOrbitLine.position.copy(sunMesh.position);   // ring centred on the Sun, through Earth

		if (state.focus === "Moon") { cam.target.copy(moonPosGroup.position); }
		else if (state.focus === "Earth") { cam.target.set(0, 0, 0); }

		Helio.placeBodies();   // keep the solar-system context in step with the date
	}

	// =======================================================================
	//  Read-outs (the Phase-1 physics)
	// =======================================================================
	function fmt(x, d) { return (x).toFixed(d == null ? 0 : d); }

	function computeReadouts() {
		var rCom = R_M + state.comAlt;
		var rTop = R_M + state.topAlt;
		var rRel = R_M + state.relAlt;

		// Gravity-gradient tether: rotates at the CoM's circular orbital rate.
		var omega = O.angularVelocity(GM_M, rCom);         // rad/s
		var vCom  = O.circularVelocity(GM_M, rCom);        // m/s
		var period = 2 * Math.PI / omega;                  // s
		var cfTop = omega * omega * rTop;                  // centrifugal accel at top, m/s^2
		var vTop  = omega * rTop;                          // inertial speed of tether top, m/s
		var vRel  = omega * rRel;                          // inertial release speed, m/s
		var vEsc  = O.escapeVelocity(GM_M, rRel);
		var vInfMoon = O.hyperbolicExcess(vRel, GM_M, rRel);   // 0 if bound

		vcomOut.textContent  = fmt(vCom, 0) + " m/s";
		omegaOut.textContent = fmt(vTop, 0) + " m/s";
		cfOut.textContent    = fmt(cfTop, 2) + " m/s² · " + fmt(cfTop / 9.80665, 2) + " g";
		periodOut.textContent = "Orbit / rotation period: " + fmt(period / 3600, 2) + " h ("
			+ fmt(period, 0) + " s). Tether base 20 km altitude.";

		vrelOut.textContent = fmt(vRel, 0) + " m/s";
		if (vInfMoon > 0) {
			vinfMoonOut.textContent = fmt(vInfMoon, 0) + " m/s";
		} else {
			vinfMoonOut.textContent = "bound (v < " + fmt(vEsc, 0) + " m/s escape)";
		}

		// The v_inf at Earth's SOI, the trajectory primary, apsides and inclination
		// are set by buildTrajectory() from the integrated path (all factors), so
		// they are intentionally not computed here.
	}

	// =======================================================================
	//  Date wiring
	// =======================================================================
	function shortDate(jd) {
		var d = O.dateFromJulian(jd);
		var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
		return mo[d.Mo - 1] + " " + d.D + ", " + d.Y;
	}

	// =======================================================================
	//  "Lock relationship" toggles for the two date sliders
	// =======================================================================
	// Ecliptic longitude (rad) of a geocentric [x,y,z] vector — only the
	// in-plane (x,y) components are used, which is the conventional way a
	// phase/elongation angle is defined (the Moon's own ~5 deg orbital
	// inclination is not part of "moon phase" in ordinary usage).
	function eclipticLon(vec) { return Math.atan2(vec[1], vec[0]); }

	// Wrap an angle (rad) into (-pi, pi].
	function wrapPi(a) {
		a = a % (2 * Math.PI);
		if (a <= -Math.PI) { a += 2 * Math.PI; }
		if (a > Math.PI) { a -= 2 * Math.PI; }
		return a;
	}

	// Moon's phase angle at Julian date jd: ecliptic longitude of the Moon
	// minus that of the Sun, both geocentric. 0 = new moon, +-180 deg = full
	// moon, +90/-90 deg = first/third quarter. This angle is exactly what
	// decides which side of Earth's own heliocentric orbit the Moon currently
	// leads or trails on — see the year-slider "lock Moon phase" toggle.
	function moonSunElongation(jd) {
		return wrapPi(eclipticLon(LE.moonVector(jd)) - eclipticLon(LE.sunVector(jd)));
	}

	var SYNODIC_RATE = 2 * Math.PI / 29.530588853;   // rad/day, mean synodic rate

	// Date nearest `naiveJD` at which the Moon's phase (moonSunElongation)
	// equals `targetElong` — used by the "lock Moon phase" toggle so dragging
	// the year slider snaps to dates that share the same Earth-Moon-Sun
	// geometry, instead of whatever phase a plain day-count lands on. A few
	// corrections at the (nearly constant) mean synodic rate converge
	// quickly, since the real rate only wobbles a few percent around the
	// mean over the Moon's elliptical orbit.
	function solveDateForElongation(naiveJD, targetElong) {
		var jd = naiveJD;
		for (var k = 0; k < 8; k++) {
			var err = wrapPi(moonSunElongation(jd) - targetElong);
			jd -= err / SYNODIC_RATE;
		}
		return jd;
	}

	// Angle (rad) of the Moon's geocentric ORBITAL VELOCITY direction at
	// Julian date jd, projected into the skyhook's own basis (hookBasis —
	// the Moon's equatorial plane) — directly comparable to state.hookPhase
	// (see hookDir), so the two can be locked together at a fixed offset by
	// the "lock skyhook to Moon" toggle.
	function moonVelAngleInHookPlane(jd) {
		var v = LE.moonState(jd).v;             // km/s, geocentric — only direction matters
		var b = hookBasis();
		return Math.atan2(v[0]*b.e2.x + v[1]*b.e2.y + v[2]*b.e2.z,
		                   v[0]*b.e1.x + v[1]*b.e1.y + v[2]*b.e1.z);
	}

	// Recompute state.hookPhase from the locked offset so the skyhook keeps
	// the SAME relationship to the Moon's own orbital motion (e.g. "always
	// retrograde") at every date, instead of staying fixed in absolute
	// ecliptic-longitude space while the Moon moves past it. Also syncs the
	// phase slider's displayed value, since it's disabled (derived, not a
	// free input) while this lock is active — see the msk-lock-month handler.
	function applySkyhookMoonLock() {
		state.hookPhase = wrapPi(moonVelAngleInHookPlane(state.jd) + state.lockedHookOffset);
		var deg = ((state.hookPhase * 180 / Math.PI) % 360 + 360) % 360;
		phaseSlider.value = deg;
		phaseVal.textContent = Math.round(deg) + "°";
	}

	function applyDate() {
		var eff = Math.max(0, Math.min(SPAN_DAYS, state.baseDays + parseFloat(fineSlider.value)));
		state.jd = JD0 + eff;
		var d = O.dateFromJulian(state.jd);
		dateField.value = d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
		jdLabel.textContent = "JD " + state.jd.toFixed(1);
		fineLo.textContent = shortDate(JD0 + Math.max(0, state.baseDays - SIDEREAL_MONTH / 2));
		fineHi.textContent = shortDate(JD0 + Math.min(SPAN_DAYS, state.baseDays + SIDEREAL_MONTH / 2));
	}

	// Sets the coarse (year) slider's day count. When lockMoonPhase is on,
	// the requested day is nudged to the nearest day whose Moon phase
	// matches lockedElongation (the phase captured when the lock was turned
	// on), so the Earth-Moon-Sun geometry — and so which side of Earth's
	// orbit the Moon is on — stays the same as you scrub across years.
	function setBaseDays(days) {
		var target = Math.max(0, Math.min(SPAN_DAYS, Math.round(days)));
		if (state.lockMoonPhase) {
			var solved = solveDateForElongation(JD0 + target, state.lockedElongation);
			target = Math.max(0, Math.min(SPAN_DAYS, Math.round(solved - JD0)));
		}
		state.baseDays = target;
		coarseSlider.value = state.baseDays;
		fineSlider.value = 0;
		applyDate();
	}

	// =======================================================================
	//  Refresh orchestration
	// =======================================================================
	function refreshDate() {
		placeBodies();
		if (state.lockSkyhookToMoon) { applySkyhookMoonLock(); }
		buildMoonOrbit();
		buildHook();
		buildTrajectory();
		computeReadouts();
	}

	function refreshHook() {
		buildHook();
		buildTrajectory();
		computeReadouts();
	}

	// ---- input parsing ----
	function readAltInputs() {
		var com = parseFloat(comInput.value);
		var top = parseFloat(topInput.value);
		var rel = parseFloat(relInput.value);
		var ok = true;
		if (!isFinite(com) || com < 20) { com = 20; ok = false; }
		if (!isFinite(top) || top <= com) { top = com + 10; ok = false; }
		state.comAlt = com * 1e3;
		state.topAlt = top * 1e3;
		// release must sit between CoM and top
		var bad = (!isFinite(rel) || rel < com || rel > top);
		if (bad) { rel = Math.max(com, Math.min(top, isFinite(rel) ? rel : (com + top) / 2)); }
		relInput.classList.toggle("msk-bad", bad);
		state.relAlt = rel * 1e3;
		// keep the release slider's range and handle position in sync
		relSlider.min = com;
		relSlider.max = top;
		relSlider.value = rel;
		return ok;
	}

	// Set the release altitude (km) from the number field, the slider, or the
	// draggable in-view marker, then rebuild the hook, trajectory and readouts.
	// This is the single path all three release-altitude controls funnel
	// through, so they always stay consistent with each other.
	function commitRelAlt(km) {
		relInput.value = Math.round(km);
		relInput.classList.remove("msk-bad");
		readAltInputs();
		refreshHook();
	}

	// The release-altitude slider. A plain native drag would jump the handle
	// straight under the cursor (1 px of mouse = 1 px of travel along the
	// full CoM..top span), which is too coarse for picking a precise release
	// point on a wide-range hook. So dragging is handled by hand: the initial
	// mousedown still jumps to the clicked spot (normal slider feel), but the
	// drag that follows moves the value by the cursor's *relative* motion,
	// scaled 0.1x while Shift is held (checked every move, so toggling Shift
	// mid-drag changes speed immediately) for fine control.
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
			e.preventDefault();   // suppress native 1:1 drag; we drive it below
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

		// Keyboard interaction (arrow keys, Home/End, Page Up/Down) still goes
		// through the native slider, which fires a normal "input" event.
		relSlider.addEventListener("input", function () {
			commitRelAlt(parseFloat(relSlider.value));
		});
	}

	// =======================================================================
	//  Burn-vector editor: an isometric 3-axis draggable-arrow widget
	// =======================================================================
	// A 3-axis burn editor drawn as an isometric set of draggable arrows around a
	// little ship (an elongated pyramid): prograde up-right, radial down-right,
	// normal vertical. Drag along an axis to set km/s; pull through the origin to
	// the far side for negative. values:{pro,rad,nrm} in m/s; onChange(key,mps).
	var SVGNS = "http://www.w3.org/2000/svg";
	function svgEl(tag, attrs) {
		var e = document.createElementNS(SVGNS, tag);
		for (var k in attrs) { e.setAttribute(k, attrs[k]); }
		return e;
	}
	function buildVectorEditor(host, values, onChange) {
		host.innerHTML = "";
		// Sized so the drawing (axes + value labels) sits ~15px from every edge.
		var W = 278, H = 300, OX = 139, OY = 150, SCALE = 7.5, MAXV = 15, LEN = MAXV * SCALE;
		var axes = [
			{ key: "pro", name: "prograde", col: "#6fd49a", dx:  Math.cos(-Math.PI/6), dy: Math.sin(-Math.PI/6) },
			{ key: "rad", name: "radial",   col: "#ffb45a", dx:  Math.cos( Math.PI/6), dy: Math.sin( Math.PI/6) },
			{ key: "nrm", name: "normal",   col: "#8ab4ff", dx: 0, dy: -1 }
		];

		var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "msk-vecwidget" });

		// the ship — a small elongated pyramid (a wedge): a square base "cap" at
		// the back and a long nose pointing up the PROGRADE axis. Drawn first so
		// it sits BEHIND the axes and arrows. Solid look: three grey faces with
		// their edges stroked in the background colour, reading as clean seams.
		(function () {
			var ux = Math.cos(-Math.PI/6), uy = Math.sin(-Math.PI/6);  // prograde dir
			var vx = -uy, vy = ux;                                      // perpendicular
			// local coords (x = along nose, y = across); rotated onto prograde.
			function P(lx, ly) { return [OX + lx*ux + ly*vx, OY + lx*uy + ly*vy]; }
			var A1 = P(-20, -6), A2 = P(-9, -12), A3 = P(-9, 10), A4 = P(-20, 16), E = P(28, -1);
			function poly(pts, fill) {
				return svgEl("polygon", {
					points: pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "),
					fill: fill, stroke: "#0c0f17", "stroke-width": 1.2, "stroke-linejoin": "round" });
			}
			svg.appendChild(poly([A1, A2, A3, A4], "#595d66"));   // base cap (mid grey)
			svg.appendChild(poly([A1, A2, E],      "#7e828c"));   // top face (lit)
			svg.appendChild(poly([A2, A3, E],      "#3b3e46"));   // front face (shadow)
		})();

		// faint full-length guide lines through the origin, with axis letters
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

		// per-axis arrow parts (built once, repositioned in redraw)
		axes.forEach(function (a) {
			a.line = svgEl("line", { stroke: a.col, "stroke-width": 2.5, "stroke-linecap": "round" });
			a.head = svgEl("polygon", { fill: a.col });
			a.val  = svgEl("text", { fill: a.col, "font-size": 11, "font-weight": 600,
				"text-anchor": "middle", "dominant-baseline": "central" });
			svg.appendChild(a.line); svg.appendChild(a.head); svg.appendChild(a.val);
		});
		host.appendChild(svg);

		// numeric entry row beneath the widget
		var nums = {};
		var row = document.createElement("div"); row.className = "msk-vec-nums";
		axes.forEach(function (a) {
			var cell = document.createElement("label"); cell.className = "msk-vec-num";
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

		// --- dragging ---
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
		// Two layered behaviours: pressing on an axis JUMPS the arrow straight to
		// that point (coarse, absolute — the old click-to-set), and then DRAGGING
		// fine-tunes RELATIVELY from there (like the release slider) — movement
		// projected onto the axis, accumulated at 1/10 the old sensitivity (≈10×
		// more hand travel per km/s), and 1/4 of THAT while Shift is held. So: click
		// to place roughly, drag to nudge precisely; lift and re-grab to push past
		// the widget edge or through the origin into a negative component. The
		// numeric fields remain for exact or out-of-range values.
		var dragIdx = -1, lastVB = null;
		var BURN_SENS = 1 / (SCALE * 10);      // km/s per viewBox-unit along the axis
		function setAxisAbsolute(p, a) {       // coarse jump to the clicked position
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
			setAxisAbsolute(p, axes[idx]);     // coarse: jump to where you pressed
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

		host._mskRedraw = redraw;     // available if a future mode needs to refresh it programmatically
		redraw();
	}

	// =======================================================================
	//  Waypoint list (sidebar cards): title, remove, burn-vector editor.
	//  Positioning is free-drag only (drag the gizmo in the 3D view) — no
	//  snap-to/fine-tune controls, unlike this widget's Solar System cousin.
	// =======================================================================
	function buildWaypointList() {
		wpList.innerHTML = "";
		wpEmpty.style.display = state.waypoints.length ? "none" : "block";
		state.waypoints.forEach(function (wp, idx) {
			var card = document.createElement("div"); card.className = "msk-waypoint";
			var head = document.createElement("div"); head.className = "msk-waypoint-head";
			var title = document.createElement("span"); title.className = "msk-wp-title";
			title.textContent = "WP " + (idx + 1);
			var rm = document.createElement("button"); rm.className = "msk-wp-x";
			rm.type = "button";
			rm.textContent = "✕"; rm.title = "remove waypoint";
			rm.addEventListener("click", function () {
				// removing the first drops the second too (its leg no longer exists)
				if (idx === 0) { state.waypoints = []; }
				else { state.waypoints.splice(idx, 1); }
				refreshHook();
			});
			head.appendChild(title); head.appendChild(rm);
			card.appendChild(head);

			var info = document.createElement("div"); info.className = "msk-muted";
			info.id = "msk-wp-info-" + idx;
			card.appendChild(info);

			var vecHost = document.createElement("div");
			card.appendChild(vecHost);
			wp._host = vecHost;          // for positioning this waypoint's readout pane
			buildVectorEditor(vecHost, wp.burn, function (axis, mps) {
				wp.burn[axis] = mps; refreshHook();
			});
			wpList.appendChild(card);
		});
	}

	// =======================================================================
	//  Solar-system context view (heliocentric overlay)
	// =======================================================================
	// A second, self-contained Three.js scene sharing the single renderer: the
	// Sun, the planets and their orbits, drawn exactly as the Solar System
	// Trajectory Plotter draws them (same Shared/orbit.js Keplerian data, AU
	// units), plus the current released trajectory rendered in TRUE heliocentric
	// coordinates. When the path escapes to a heliocentric orbit, the full
	// predicted orbit (from the integrated elements) is drawn too, so it can be
	// reality-checked against the planets. Display only — no editing here.
	// Toggled by the button at the top-left of the 3D view; built lazily on first
	// use. Bodies are placed at the current ephemeris date (this calculator's
	// 2030–2033 span), so the context reflects the date being studied.
	var Helio = {
		AU: 149597870700,                                  // m per AU
		BODIES: ["Mercury", "Venus", "Earth", "Mars", "Ceres", "Vesta",
		         "Psyche", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"],
		PX_BODY: 1.4, PX_SOI: 2.0,
		built: false,
		scene: null, camera: null,
		cam: { radius: 6, theta: 0.6, phi: 1.1, target: new THREE.Vector3(0, 0, 0) },
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

			// starfield backdrop (AU scale)
			(function () {
				var g = new THREE.BufferGeometry(), n = 1200, arr = new Float32Array(n * 3);
				for (var i = 0; i < n; i++) {
					var u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
					arr[i*3] = 800 * s * Math.cos(a); arr[i*3+1] = 800 * s * Math.sin(a); arr[i*3+2] = 800 * u;
				}
				g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
				sc.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x666f86, size: 1.5, sizeAttenuation: false })));
			})();

			// HTML overlay for the floating name labels (hidden until the view is shown)
			this.labelLayer = document.createElement("div");
			this.labelLayer.id = "msk-helio-labels";
			this.labelLayer.style.display = "none";
			holder.appendChild(this.labelLayer);

			// Sun (real radius; collapses to a bright pixel when far)
			var sunRadAU = Number(SUN_SYS.radius) / AU;
			var sunCore = new THREE.Mesh(new THREE.SphereGeometry(sunRadAU, 24, 18),
				new THREE.MeshBasicMaterial({ color: 0xffe066 }));
			var sunPoint = makePoint(0xfff2a0, 3);
			var sunGroup = new THREE.Group();
			sunGroup.add(sunCore); sunGroup.add(sunPoint);
			sc.add(sunGroup);
			this.sunGroup = sunGroup;
			this.scaleList.push({ group: sunGroup, core: sunCore, point: sunPoint, soi: null, radiusAU: sunRadAU, soiAU: 0 });
			this.addLabel("Sun", sunGroup);

			function soiRadiusAU(sys) {
				if (!sys.orbit) { return 0; }
				var m = sys.mass || (sys.GM / 6.6743e-11);
				return O.sphereOfInfluence(sys.orbit.a, m, M_SUN) / AU;
			}

			this.BODIES.forEach(function (name) {
				var sys = systems.get(name);
				var col = new THREE.Color(sys.color || "#bcc3d0");
				var radAU = Number(sys.radius) / AU;
				var core = new THREE.Mesh(new THREE.SphereGeometry(radAU, 16, 12),
					new THREE.MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.3), roughness: 0.85 }));
				var soiAU = soiRadiusAU(sys);
				var soi = new THREE.Mesh(new THREE.SphereGeometry(soiAU, 24, 16),
					new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.10, depthWrite: false }));
				var point = makePoint(col.clone().lerp(new THREE.Color(0xffffff), 0.45).getHex(), 2.5);
				var g = new THREE.Group();
				g.add(core); g.add(soi); g.add(point);
				sc.add(g);
				self.bodyGroups[name] = { group: g, core: core, soi: soi, point: point };
				self.scaleList.push({ group: g, core: core, point: point, soi: soi, radiusAU: radAU, soiAU: soiAU });
				self.addLabel(name, g);
				var line = self.makeOrbitLine(sys.orbit, col, GM_SUN);
				sc.add(line);
				self.orbitLines[name] = line;
			});

			this.built = true;
			this.resize();
		},

		addLabel: function (name, group) {
			var el = document.createElement("span");
			el.className = "msk-label";
			el.textContent = name;
			this.labelLayer.appendChild(el);
			this.labelList.push({ el: el, group: group });
		},

		// One full orbit, drawn as two arcs split at the line of nodes (north bright,
		// south dim + cool-shifted), or a single ring for near-ecliptic orbits.
		makeOrbitLine: function (o, col, GM_SUN) {
			var AU = this.AU, inc = o.inclination || 0, grp = new THREE.Group();
			function arc(nu0, span, N) {
				var pts = [];
				for (var k = 0; k <= N; k++) {
					var nu = nu0 + span * k / N;
					var s = O.stateFromElements(GM_SUN, o.a, o.e, inc, o.longitude || 0, o.argument || 0, nu);
					pts.push(new THREE.Vector3(s.r[0]/AU, s.r[1]/AU, s.r[2]/AU));
				}
				return pts;
			}
			function lineFrom(pts, c, op) {
				return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
					new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op }));
			}
			if (inc < 0.5 * Math.PI / 180) { grp.add(lineFrom(arc(0, 2 * Math.PI, 360), col, 0.32)); return grp; }
			var nuAsc = -(o.argument || 0);
			var southCol = col.clone().lerp(new THREE.Color(0x4a78ff), 0.3);
			grp.add(lineFrom(arc(nuAsc, Math.PI, 180), col, 0.6));
			grp.add(lineFrom(arc(nuAsc + Math.PI, Math.PI, 180), southCol, 0.3));
			return grp;
		},

		// Place each planet at the current ephemeris date.
		placeBodies: function () {
			if (!this.built) { return; }
			var AU = this.AU;
			this.BODIES.forEach(function (name) {
				var s = O.bodyStateAtJD(GM_S, systems.get(name).orbit, state.jd);
				Helio.bodyGroups[name].group.position.set(s.r[0]/AU, s.r[1]/AU, s.r[2]/AU);
			});
		},

		// Draw the released trajectory in true heliocentric coordinates (each leg
		// coloured by its primary, matching the Earth-Moon view), plus — when the
		// path escapes to a heliocentric orbit — the full predicted orbit from the
		// computed elements. That predicted ellipse among the planets is the
		// reality check the view exists for.
		updateTrajectory: function (res) {
			if (!this.built) { return; }
			var AU = this.AU;
			if (this.trajGroup) { this.scene.remove(this.trajGroup); disposeGroup(this.trajGroup); }
			this.wpGizmos = [];
			var grp = new THREE.Group();
			if (!res) { this.trajGroup = grp; this.scene.add(grp); return; }

			res.legs.forEach(function (leg, i) {
				var uptoT = (i < res.wpResults.length) ? state.waypoints[i].t : null;
				var pts = [];
				for (var k = 0; k < leg.samples.length; k++) {
					var smp = leg.samples[k];
					if (uptoT != null && smp.t > uptoT) { break; }
					var jde = leg.jde0 + smp.t / 86400;
					var geo = (leg.kind === "moonEllipse") ? O.vAdd(moonGeoPos(jde), smp.r) : smp.r;
					var eh = earthHelio(jde).r;
					pts.push(new THREE.Vector3((eh[0]+geo[0])/AU, (eh[1]+geo[1])/AU, (eh[2]+geo[2])/AU));
				}
				if (pts.length > 1) {
					grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
						new THREE.LineBasicMaterial({ color: leg.color })));
				}
			});

			// Waypoint gizmos + burn arrows, at true heliocentric positions.
			// The axes are the SAME burn frame the sliders act in (burnFrame on
			// the waypoint's local state) — on a Sun-primary leg that frame is
			// heliocentric, so here, unlike in the Earth-Moon view, the prograde
			// arm lies tangent to the drawn path, matching the Solar System
			// Trajectory Plotter. Arrows use that plotter's fixed physical
			// scale (0.03 AU per km/s). Display-only — placement dragging stays
			// in the Earth-Moon view. Gizmos are tracked in wpGizmos for the
			// constant-on-screen-size pass in updateGizmos().
			var self = this;
			res.wpResults.forEach(function (wr) {
				var rGeo = (wr.space === "moon") ? O.vAdd(moonGeoPos(wr.jde), wr.renderPosM) : wr.renderPosM;
				var rHel = O.vAdd(earthHelio(wr.jde).r, rGeo);
				var pos = new THREE.Vector3(rHel[0]/AU, rHel[1]/AU, rHel[2]/AU);
				var f = O.burnFrame(wr.rLocal, wr.vLocal);
				var g = new THREE.Group();
				g.add(makeAxisLine(f.pro, 0x6fd49a));   // prograde
				g.add(makeAxisLine(f.rad, 0xffb45a));   // radial
				g.add(makeAxisLine(f.nrm, 0x8ab4ff));   // normal
				g.position.copy(pos);
				g.renderOrder = 10;
				grp.add(g);
				self.wpGizmos.push(g);
				[ { vec: wr.eff.dSpeedVec, col: DSPEED_COLOR },
				  { vec: wr.eff.dv,        col: DV_COLOR } ].forEach(function (a) {   // dV last => on top
					var kms = O.vMag(a.vec) / 1000;
					if (kms < 0.02) { return; }
					var dir = new THREE.Vector3(a.vec[0], a.vec[1], a.vec[2]).normalize();
					var len = kms * 0.03;                // AU per km/s, as in the SS plotter
					var arrow = new THREE.ArrowHelper(dir, pos, len, a.col, len * 0.22, len * 0.12);
					[arrow.line, arrow.cone].forEach(function (o) {
						o.material.depthTest = false; o.material.depthWrite = false;
						o.material.transparent = true; o.renderOrder = 12;
					});
					grp.add(arrow);
				});
			});

			// Full predicted heliocentric orbit, from the final leg's elements.
			var fin = res.final;
			if (fin && fin.primary === "Sun" && fin.helioEl) {
				var el = fin.helioEl, pts2 = [];
				if (el.e < 1 && isFinite(el.a)) {
					for (var j = 0; j <= 360; j++) {
						var nu = 2 * Math.PI * j / 360;
						var s = O.stateFromElements(GM_S, el.a, el.e, el.i, el.Omega, el.omega, nu);
						pts2.push(new THREE.Vector3(s.r[0]/AU, s.r[1]/AU, s.r[2]/AU));
					}
				} else if (el.e > 1) {
					var lim = Math.acos(-1 / el.e) * 0.985;      // true-anomaly asymptote
					for (var j2 = -160; j2 <= 160; j2++) {
						var s2 = O.stateFromElements(GM_S, el.a, el.e, el.i, el.Omega, el.omega, lim * j2 / 160);
						if (isFinite(s2.r[0])) { pts2.push(new THREE.Vector3(s2.r[0]/AU, s2.r[1]/AU, s2.r[2]/AU)); }
					}
				}
				if (pts2.length > 1) {
					grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2),
						new THREE.LineBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.5 })));
				}
			}

			grp.visible = trajToggle ? trajToggle.checked : true;
			this.trajGroup = grp;
			this.scene.add(grp);
		},

		updateCamera: function () {
			var c = this.cam, r = c.radius, sp = Math.sin(c.phi), cp = Math.cos(c.phi), cam = this.camera;
			cam.position.set(c.target.x + r*sp*Math.cos(c.theta), c.target.y + r*sp*Math.sin(c.theta), c.target.z + r*cp);
			cam.up.set(0, 0, 1);
			cam.lookAt(c.target);
		},
		screenPxRadius: function (worldR, dist) {
			var h = holder.clientHeight || 1;
			return worldR / dist * ((h / 2) / Math.tan(this.camera.fov * Math.PI / 360));
		},
		updateScales: function () {
			var wantSOI = soiToggle.checked;
			for (var i = 0; i < this.scaleList.length; i++) {
				var b = this.scaleList[i];
				var dist = this.camera.position.distanceTo(b.group.position) || 1e-9;
				var showCore = this.screenPxRadius(b.radiusAU, dist) >= this.PX_BODY;
				b.core.visible = showCore;
				b.point.visible = !showCore;
				if (b.soi) { b.soi.visible = wantSOI && this.screenPxRadius(b.soiAU, dist) >= this.PX_SOI; }
			}
		},
		_lp: new THREE.Vector3(),
		updateLabels: function () {
			var w = holder.clientWidth, h = holder.clientHeight, cam = this.camera, p = this._lp;
			for (var i = 0; i < this.labelList.length; i++) {
				var L = this.labelList[i];
				p.copy(L.group.position).project(cam);
				if (p.z < 1 && p.x > -1.06 && p.x < 1.06 && p.y > -1.06 && p.y < 1.06) {
					L.el.style.display = "block";
					L.el.style.left = ((p.x * 0.5 + 0.5) * w + 7) + "px";
					L.el.style.top  = ((-p.y * 0.5 + 0.5) * h) + "px";
				} else { L.el.style.display = "none"; }
			}
		},
		resize: function () {
			if (!this.built) { return; }
			var w = holder.clientWidth || 600, h = holder.clientHeight || 400;
			this.camera.aspect = w / h;
			this.camera.updateProjectionMatrix();
		},
		// Keep each waypoint gizmo ~42 px long regardless of zoom (the burn
		// arrows keep their fixed physical AU scale, as in the SS plotter).
		updateGizmos: function () {
			if (!this.wpGizmos.length) { return; }
			var h = holder.clientHeight || 1;
			var f = (h / 2) / Math.tan(this.camera.fov * Math.PI / 360);
			for (var i = 0; i < this.wpGizmos.length; i++) {
				var g = this.wpGizmos[i];
				var dist = this.camera.position.distanceTo(g.position) || 1e-9;
				g.scale.setScalar(42 * dist / f);
			}
		},
		render: function () {
			this.updateCamera();
			this.updateScales();
			this.updateGizmos();
			this.updateLabels();
			renderer.render(this.scene, this.camera);
		},

		// Double-click a body (or its label/pixel) to lock the camera onto it.
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

	function init() {
		initScene();

		// overlay that holds the straddling burn readouts (escapes panel clipping)
		readoutLayer = document.createElement("div");
		readoutLayer.id = "msk-burn-readouts";
		if (mainEl) { mainEl.appendChild(readoutLayer); }
		if (panelEl) { panelEl.addEventListener("scroll", positionBurnReadouts); }

		coarseSlider.addEventListener("input", function () {
			setBaseDays(parseInt(coarseSlider.value, 10));
			refreshDate();
		});
		fineSlider.addEventListener("input", function () {
			applyDate();
			refreshDate();
		});
		phaseSlider.addEventListener("input", function () {
			state.hookPhase = parseFloat(phaseSlider.value) * Math.PI / 180;
			phaseVal.textContent = Math.round(parseFloat(phaseSlider.value)) + "°";
			refreshHook();
		});

		// "Lock Moon phase" (year slider): capture the CURRENT Earth-Moon-Sun
		// geometry the instant the toggle is switched on, so it's that
		// relationship — whatever it happens to be — that's preserved
		// afterward, not a hardcoded one. Turning it off just stops
		// snapping; it doesn't move the date.
		if (lockYearToggle) {
			lockYearToggle.addEventListener("change", function () {
				state.lockMoonPhase = lockYearToggle.checked;
				if (state.lockMoonPhase) { state.lockedElongation = moonSunElongation(state.jd); }
			});
		}

		// "Lock skyhook to Moon" (lunar-month slider): same idea, but for the
		// tether's angle relative to the Moon's own orbital-velocity
		// direction. While active, hookPhase becomes a DERIVED quantity (see
		// applySkyhookMoonLock in refreshDate), so the phase slider is
		// disabled to avoid it fighting the lock on the next date change.
		if (lockMonthToggle) {
			lockMonthToggle.addEventListener("change", function () {
				state.lockSkyhookToMoon = lockMonthToggle.checked;
				phaseSlider.disabled = state.lockSkyhookToMoon;
				if (state.lockSkyhookToMoon) {
					state.lockedHookOffset = wrapPi(state.hookPhase - moonVelAngleInHookPlane(state.jd));
					applySkyhookMoonLock();
					refreshHook();
				}
			});
		}

		dateField.addEventListener("change", function () {
			var parts = dateField.value.split("-");
			if (parts.length === 3) {
				var jd = O.julianDate(+parts[0], +parts[1], +parts[2], 0, 0, 0);
				setBaseDays(jd - JD0);
				refreshDate();
			}
		});

		[comInput, topInput].forEach(function (inp) {
			inp.addEventListener("input", function () { readAltInputs(); refreshHook(); });
		});
		relInput.addEventListener("input", function () { readAltInputs(); refreshHook(); });
		bindRelSlider();

		resetBtn.addEventListener("click", function () {
			comInput.value = 275; topInput.value = 6000; relInput.value = 950;
			relInput.classList.remove("msk-bad");
			state.waypoints = [];
			readAltInputs();
			setHud("Reset. Double-click the Moon or Earth to focus.");
			// Leave hookPhase to the active lock (if any) rather than forcing it
			// to 0°, so Reset doesn't fight the "lock skyhook to Moon" toggle.
			if (state.lockSkyhookToMoon) { applySkyhookMoonLock(); }
			else { phaseSlider.value = 0; phaseVal.textContent = "0°"; state.hookPhase = 0; }
			refreshHook();
		});

		soiToggle.addEventListener("change", function () {
			earthSOI.visible = soiToggle.checked;
			moonSOI.visible = soiToggle.checked;
		});
		orbitToggle.addEventListener("change", function () {
			if (moonOrbitGroup) { moonOrbitGroup.visible = orbitToggle.checked; }
		});
		hookToggle.addEventListener("change", function () {
			if (hookGroup) { hookGroup.visible = hookToggle.checked; }
		});
		trajToggle.addEventListener("change", function () {
			if (trajectoryGroup) { trajectoryGroup.visible = trajToggle.checked; }
			if (trajectoryMoonGroup) { trajectoryMoonGroup.visible = trajToggle.checked; }
			if (Helio.trajGroup) { Helio.trajGroup.visible = trajToggle.checked; }
		});

		// Top-left toggle: switch between the Earth-Moon view and the heliocentric
		// solar-system context. The context scene is built lazily on first use.
		var viewToggle = document.getElementById("msk-view-toggle");
		if (viewToggle) {
			viewToggle.addEventListener("click", function () {
				if (state.view === "geo") {
					Helio.init();
					state.view = "helio";
					Helio.placeBodies();
					Helio.updateTrajectory(lastTrajRes);
					labelLayer.style.display = "none";
					Helio.labelLayer.style.display = "";
					viewToggle.textContent = "🌙 Earth–Moon view";
					viewToggle.classList.add("msk-view-toggle-on");
					setHud("Heliocentric solar-system context. drag rotate · wheel zoom · right-drag pan · double-click a planet to focus. The trajectory is drawn in true heliocentric coordinates; the orange ellipse (when the path escapes Earth) is its predicted heliocentric orbit.");
				} else {
					state.view = "geo";
					if (Helio.labelLayer) { Helio.labelLayer.style.display = "none"; }
					labelLayer.style.display = "";
					viewToggle.textContent = "🌐 Solar system view";
					viewToggle.classList.remove("msk-view-toggle-on");
					setHud("Geocentric Earth–Moon view. Double-click the Moon or Earth to focus.");
				}
			});
		}
		if (burnVecToggle) { burnVecToggle.addEventListener("change", function () { refreshHook(); }); }

		// "Create waypoint" checkboxes: 1 opens a burn on the release leg, 2
		// (only once 1 exists) opens a second one on whatever leg 1's burn
		// produces. Default position is close to the Moon — see
		// defaultWaypointTime — then the user drags the gizmo along the
		// trajectory to place it exactly.
		function newWaypoint() { return { t: null, burn: { pro: 0, rad: 0, nrm: 0 } }; }
		if (createWp1) {
			createWp1.addEventListener("change", function () {
				if (createWp1.checked) {
					if (state.waypoints.length === 0) { state.waypoints.push(newWaypoint()); }
				} else {
					state.waypoints = [];       // removing the first drops the second too
				}
				refreshHook();
			});
		}
		if (createWp2) {
			createWp2.addEventListener("change", function () {
				if (createWp2.checked) {
					if (state.waypoints.length === 1) { state.waypoints.push(newWaypoint()); }
				} else if (state.waypoints.length >= 2) {
					state.waypoints.length = 1;
				}
				refreshHook();
			});
		}

		readAltInputs();
		setBaseDays(0);
		refreshDate();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else { init(); }

})();
