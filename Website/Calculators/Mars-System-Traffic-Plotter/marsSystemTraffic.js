/* Mars System Traffic Plotter — ES module
 *
 * A to-scale 3-D view of the Mars system on a clock: Mars turning, Phobos and
 * Deimos on their orbits, the Sun. It is the ground the system's transport
 * facilities — the Phobos skyhook, a hanging skyhook, a space elevator and a
 * surface mass driver — and the flights of cargo between them are built on.
 *
 * Built so far: the scene and its clock, the three views (fixed to the
 * stars, turning with Mars, turning with Phobos), the POV buttons and
 * click-to-follow. The facilities are listed in the sidebar and come next.
 *
 * The page computes nothing of its own: where things are comes from
 * Shared/mars-ephemeris.js, the view's axes from core/view-frames.js, and the
 * scene objects from scene.js.
 */
/* global THREE */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { MarsEphemeris as ME } from "../../Shared/mars-ephemeris.js";
import { updateCamera, bindCameraControls, raycastPickPoint } from "../../Shared/sim/camera-controller.js";
import { createDateBar } from "../../Shared/sim/date-bar.js";
import { updateScales, updateLabels, projectedRadiusPx } from "../../Shared/sim/body-renderer.js";
import { CLOCK_EPOCH, SPAN_DAYS } from "./core/clock.js";
import { VIEW_FRAMES } from "./core/view-frames.js";
import { buildMarsScene, R_MARS, R_STATIONARY, SOI_MARS } from "./scene.js";

var O = OrbitalMath;
var DAY = 86400, DEG = 180 / Math.PI;
var START_DAYS = 81;                   // opens on 2080-03-22
// Slider drag speeds while a key is held.
var SLOW_DRAG = { shift: 0.25, ctrl: 0.1 };

// Camera presets behind the POV buttons: what the camera stays on and how far
// back it sits (scene units, 1,000 km).
var POVS = {
	soi:         { focus: "Mars",   radius: 1500 },
	system:      { focus: "Mars",   radius: 75 },
	phobosOrbit: { focus: "Mars",   radius: 30 },
	low:         { focus: "Mars",   radius: 11 },
	phobos:      { focus: "Phobos", radius: 0.12 }
};
var ZOOM_MAX = 1800;                   // Mars's sphere of influence fills the view
var ZOOM_MIN = { Mars: 4, Phobos: 0.03, Deimos: 0.02 };
var BODIES = ["Phobos", "Deimos", "Mars"];     // small things first: they are picked over large ones

// The facilities still to be built, shown folded so the sidebar already has its shape.
var STUBS = [
	{ label: "Phobos skyhook", sub: "Tether built on Phobos: foot and top altitude" },
	{ label: "Hanging skyhook", sub: "Tilted orbit; ballast timing to stay clear of other tethers" },
	{ label: "Space elevator", sub: "Layout A (both moons pass between the legs) or B (Phobos only)" },
	{ label: "Mass driver", sub: "Surface track on the equator; Pavonis Mons by default" }
];

var state = {
	jd: CLOCK_EPOCH, baseDays: 0,      // the date bar's own fields (Shared/sim/date-bar.js)
	follow: "Mars",                    // what the camera stays on: "Mars" | "Phobos" | "Deimos" | null
	pov: "system",
	view: "stars"                      // core/view-frames.js: "stars" | "surface" | "phobos"
};

function $(id) { return document.getElementById(id); }
var holder = $("mst-canvas-holder");
var keysEl = $("mst-keys");
var showSoi = $("mst-show-soi"), showOrbits = $("mst-show-orbits"), showGrid = $("mst-show-grid");

// ---- formatting -----------------------------------------------------------------
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function two(n) { return String(n).padStart(2, "0"); }
function shortDate(jd) {
	var d = O.dateFromJulian(jd);
	return MONTHS[d.Mo - 1] + " " + d.D + " " + d.Y;
}
function clockTime(jd) {
	var s = Math.round((((jd + 0.5) % 1) + 1) % 1 * DAY) % DAY;
	return two(Math.floor(s / 3600)) + ":" + two(Math.floor(s % 3600 / 60));
}
function num(x, d) {
	return x.toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
function km(m) { return num(m / 1e3) + " km"; }
function hours(sec) {
	var m = Math.round(sec / 60);
	return Math.floor(m / 60) + " h " + two(m % 60) + " min";
}
function latText(rad) {
	var d = rad * DEG;
	return num(Math.abs(d), 2) + "° " + (d >= 0 ? "N" : "S");
}
function lonText(rad) {
	var d = rad * DEG;
	return num(Math.abs(d), 1) + "° " + (d >= 0 ? "E" : "W");
}
var SEASONS = ["northern spring", "northern summer", "northern autumn", "northern winter"];

// ---- scene ------------------------------------------------------------------------
var frame = buildMarsScene();
var renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
holder.appendChild(renderer.domElement);
holder.appendChild(frame.labelLayer);

var followEl = $("mst-follow");
var glide = 0;                         // frames left of easing onto a new follow position

function zoomMin() { return ZOOM_MIN[state.follow] || 0.02; }

// Keep the camera on `name` from now on (null: let go). `pov` names the POV
// button this came from, if any; any other follow clears the buttons.
function setFollow(name, pov) {
	if (name !== state.follow) { glide = 18; }
	state.follow = name;
	state.pov = pov || null;
	frame.cam.radius = Math.max(zoomMin(), frame.cam.radius);
	syncButtons();
}
function setPov(name) {
	var p = POVS[name];
	frame.cam.radius = p.radius;
	setFollow(p.focus, name);
}
function setView(id) {
	state.view = id;
	syncButtons();
	refresh();
}
function pressed(group, attr, value) {
	Array.prototype.forEach.call(group.children, function (btn) {
		btn.setAttribute("aria-pressed", String(btn.dataset[attr] === value));
	});
}
function syncButtons() {
	followEl.hidden = !state.follow;
	followEl.firstChild.textContent = state.follow ? "Following: " + state.follow : "";
	pressed($("mst-pov"), "pov", state.pov);
	pressed($("mst-frames"), "frame", state.view);
	var f = VIEW_FRAMES.filter(function (v) { return v.id === state.view; })[0];
	$("mst-view-caption").textContent = "MARS SYSTEM · Mars-centred, "
		+ (state.view === "phobos" ? "Phobos's orbit pole up" : "north up") + " · " + f.caption;
}
// Per frame: hold the camera's centre on the followed body, easing onto it
// for a moment after a change.
function applyFollow() {
	if (!state.follow) { return; }
	var pos = frame.bodyPosition(state.follow);
	if (glide > 0) { frame.cam.target.lerp(pos, 0.25); glide--; } else { frame.cam.target.copy(pos); }
}

// Which body a click at the cursor is on, or null: anywhere on its disc, or
// within a few pixels of it once it is a dot.
var _sp = new THREE.Vector3();
function pickBody(e) {
	var rect = renderer.domElement.getBoundingClientRect();
	var cx = e.clientX - rect.left, cy = e.clientY - rect.top, best = null, bestD = Infinity;
	BODIES.forEach(function (name) {
		var pos = frame.bodyPosition(name);
		_sp.copy(pos).project(frame.camera);
		if (_sp.z > 1) { return; }
		var d = Math.hypot((_sp.x * 0.5 + 0.5) * rect.width - cx, (-_sp.y * 0.5 + 0.5) * rect.height - cy);
		var reach = Math.max(10, projectedRadiusPx(frame.camera, holder, frame.bodyRadius(name),
			frame.camera.position.distanceTo(pos) || 1e-9));
		if (d < reach && best === null) { best = name; bestD = d; }
	});
	return bestD < Infinity ? best : null;
}

bindCameraControls(renderer.domElement, function () {
	return {
		cam: frame.cam, camera: frame.camera,
		zoomMin: zoomMin(), zoomMax: ZOOM_MAX,
		shiftZoom: true,
		isLocked: function () { return !!state.follow; },
		pickPoint: function (e) {
			return raycastPickPoint(frame.camera, renderer.domElement, e, { meshes: frame.pickMeshes, soiSpheres: [] });
		},
		onPan: function () { if (state.follow) { setFollow(null); } },
		onPick: function (e) {
			var name = pickBody(e);
			if (name) { setFollow(name); }
		}
	};
});
renderer.domElement.addEventListener("mousemove", function (e) {
	if (e.buttons) { return; }
	renderer.domElement.style.cursor = pickBody(e) ? "pointer" : "";
});
followEl.addEventListener("click", function () { setFollow(null); });

function resize() {
	var w = holder.clientWidth || 600, h = holder.clientHeight || 400;
	renderer.setSize(w, h, false);
	renderer.domElement.style.width = w + "px";
	renderer.domElement.style.height = h + "px";
	frame.camera.aspect = w / h;
	frame.camera.updateProjectionMatrix();
}

function animate() {
	requestAnimationFrame(animate);
	applyFollow();
	updateCamera(frame.camera, frame.cam);
	updateScales(frame.camera, holder, frame.scaleList, { wantSOI: showSoi.checked });
	updateLabels(frame.camera, holder, frame.labelList);
	renderer.render(frame.scene, frame.camera);
}

// ---- sidebar and key figures ---------------------------------------------------------
function el(tag, cls, text) {
	var n = document.createElement(tag);
	if (cls) { n.className = cls; }
	if (text != null) { n.textContent = text; }
	return n;
}
function readout(parent, label, value) {
	var row = parent.appendChild(el("div", "mst-ro"));
	row.appendChild(el("span", "mst-ro-label", label));
	return row.appendChild(el("span", "mst-ro-val", value));
}
var CHEVRON_SVG = '<svg class="mst-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2l4 4-4 4"/></svg>';
function buildStub(stub) {
	var card = $("mst-cards").appendChild(el("section", "mst-card mst-card-stub"));
	var head = card.appendChild(el("div", "mst-card-head"));
	head.innerHTML = CHEVRON_SVG;
	var title = head.appendChild(el("span", "mst-card-title", stub.label));
	title.appendChild(el("span", "mst-card-sub", stub.sub));
}

// The figures that do not change with the date.
var deimosTilt = null;
function buildSystemCard() {
	var box = $("mst-system"), ph = ME.moonFigures("Phobos"), de = ME.moonFigures("Deimos");
	readout(box, "Mars's day (one turn against the stars)", hours(ME.SIDEREAL_DAY));
	readout(box, "Areostationary altitude", km(R_STATIONARY - R_MARS));
	readout(box, "Phobos: one orbit", hours(ph.period));
	// How often Phobos comes back over the same ground: it outruns the ground,
	// so the two rates subtract.
	readout(box, "Phobos back over the same ground every", hours(O.synodicPeriod(ph.period, ME.SIDEREAL_DAY)));
	readout(box, "Phobos's orbit: tilt to the equator", "1.08°, round once in " + num(ph.nodePeriod / DAY / 365.25, 2) + " yr");
	readout(box, "Deimos: one orbit", hours(de.period));
	deimosTilt = readout(box, "Deimos's orbit: tilt to the equator now", "");
	readout(box, "Mars's sphere of influence", km(SOI_MARS));
}

function key(label, value) {
	var k = keysEl.appendChild(el("div", "mst-key"));
	k.appendChild(el("span", "mst-key-label", label));
	k.appendChild(el("span", "mst-key-val", value));
}
function fillKeys(jd) {
	keysEl.textContent = "";
	var sea = ME.season(jd), ls = sea.ls * DEG;
	key("Date and time (UTC)", shortDate(jd) + " " + clockTime(jd));
	key("Season", "Ls " + num(ls, 1) + "° · " + SEASONS[Math.floor(ls / 90) % 4]);
	key("Sun overhead at", latText(sea.sunLat));
	["Phobos", "Deimos"].forEach(function (name) {
		var s = ME.moonState(name, jd), g = ME.groundPoint(s.r, jd);
		key(name + " altitude", km(g.radius - R_MARS));
		key(name + " over", latText(g.lat) + ", " + lonText(g.lon));
	});
	var de = ME.moonState("Deimos", jd);
	deimosTilt.textContent = num(Math.acos(Math.max(-1, Math.min(1, O.vDot(de.normal, ME.pole)))) * DEG, 2)
		+ "° (0.9° to 2.7° over 56 yr)";
}

function refresh() {
	frame.setShown({ orbits: showOrbits.checked, grid: showGrid.checked });
	frame.place(state.jd, state.view);
	fillKeys(state.jd);
}

// ---- wiring ---------------------------------------------------------------------------
var dateBar = createDateBar(state, {
	coarseSlider: $("mst-date-coarse"), fineSlider: $("mst-date-fine"),
	fineLoLabel: $("mst-fine-lo"), fineHiLabel: $("mst-fine-hi"),
	dateField: $("mst-date-field"), jdLabel: $("mst-jd"),
	jd0: CLOCK_EPOCH, spanDays: SPAN_DAYS, shortDate: shortDate, slowDrag: SLOW_DRAG, jdDecimals: 3
});

function init() {
	buildSystemCard();
	STUBS.forEach(buildStub);
	VIEW_FRAMES.forEach(function (v) {
		var b = $("mst-frames").appendChild(el("button", null, v.label));
		b.type = "button"; b.dataset.frame = v.id;
		b.title = "Hold the view still against this";
	});

	dateBar.setBaseDays(START_DAYS);
	dateBar.bind(refresh);

	$("mst-pov").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-pov]");
		if (btn) { setPov(btn.dataset.pov); }
	});
	$("mst-frames").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-frame]");
		if (btn) { setView(btn.dataset.frame); }
	});
	[showOrbits, showGrid].forEach(function (box) { box.addEventListener("change", refresh); });

	if (window.ResizeObserver) { new ResizeObserver(resize).observe(holder); }
	window.addEventListener("resize", resize);
	resize();

	refresh();
	setPov("system");
	animate();
}

init();
