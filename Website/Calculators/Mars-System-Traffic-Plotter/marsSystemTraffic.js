/* Mars System Traffic Plotter — ES module
 *
 * A to-scale 3-D view of the Mars system on a clock: Mars turning, Phobos and
 * Deimos on their orbits, the Sun, the system's transport facilities and the
 * path of a ship let go by one of them. The facilities are the Phobos skyhook,
 * a hanging skyhook, a space elevator and a surface mass driver.
 *
 * Built so far: the scene and its clock, the three views (held toward the Sun,
 * turning with Mars, turning with Phobos), the POV buttons and click-to-follow;
 * the Phobos skyhook and the hanging skyhook, with a release from any point of
 * either tether flown to its end — down to the air, round an orbit, or out of
 * Mars's sphere of influence; the hanging skyhook's timing against the
 * Phobos tether, with the sidesteps that keep them apart marked on the date
 * sliders; and the space elevator, with the limit it puts on the Phobos
 * skyhook's top and its dodges of Deimos marked on the date sliders. The mass
 * driver is listed in the sidebar and comes next.
 *
 * The page computes nothing of its own: where things are comes from
 * Shared/mars-ephemeris.js and core/facilities.js, the flight from
 * core/flight.js, the timing from core/clearance.js, the elevator from
 * core/elevator.js, the view's axes from core/view-frames.js, and the scene
 * objects from scene.js and overlay.js.
 */
/* global THREE */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { MarsEphemeris as ME } from "../../Shared/mars-ephemeris.js";
import { updateCamera, bindCameraControls, raycastPickPoint } from "../../Shared/sim/camera-controller.js";
import { createDateBar, bindFineDrag } from "../../Shared/sim/date-bar.js";
import { updateScales, updateLabels, projectedRadiusPx, worldSizeAtPointForPx }
	from "../../Shared/sim/body-renderer.js";
import { orientMarkerSprite } from "../../Shared/sim/marker-card.js";
import { CLOCK_EPOCH, SPAN_DAYS } from "./core/clock.js";
import { VIEW_FRAMES, viewBasis, toView } from "./core/view-frames.js";
import { FACILITIES, SKYHOOKS, allFigures, facilityAt, pointState, centreRadius, altitudeOf, moonSkyhookLimits, R_MARS, ENTRY_ALT }
	from "./core/facilities.js";
import { HANGING_DEFAULTS, RATIOS, DAY_RATIOS, resonantComAlt } from "./core/hanging-skyhook.js";
import { DEFAULT_LIMIT, bestStartAngle, closestPass, tetherDistance, elevatorDistance, needsTiming, workOutSidesteps,
         timingGuidance, elevatorGuidance } from "./core/clearance.js";
import { ELEVATOR_DEFAULTS, ELEVATOR_MATERIALS, KEEP_CLEAR, DODGE, TRAFFIC, elevatorAt } from "./core/elevator.js";
import { computeFlight, flightStateAt, groundRelative, SURFACE } from "./core/flight.js";
import { CATCH_SPEED_LIMIT } from "./core/arrival.js";
import { buildMarsScene, R_STATIONARY, SOI_MARS, U } from "./scene.js";
import { buildOverlay } from "./overlay.js";

var O = OrbitalMath;
var DAY = 86400, DEG = 180 / Math.PI, TWO_PI = 2 * Math.PI;
var START_DAYS = 81;                   // opens on 2080-03-22
// Slider drag speeds while a key is held.
var SLOW_DRAG = { shift: 0.25, ctrl: 0.1 };
var CHEVRON_PX = 24;
var PHOBOS = "phobosSkyhook", HANGING = "hangingSkyhook", ELEVATOR = "spaceElevator";

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
	{ label: "Mass driver", sub: "Surface track on the equator; Pavonis Mons by default" }
];

var state = {
	jd: CLOCK_EPOCH, baseDays: 0,      // the date bar's own fields (Shared/sim/date-bar.js)
	relFrac: 0,                        // release time, as a fraction of one orbit of the departure facility
	flightFrac: 0,                     // flight slider position, 0..1 of the flight's span
	follow: "Mars",                    // what the camera stays on: a body's name, "ship", "<facility>:<marker>", or null
	pov: "system",
	view: "sun",                       // core/view-frames.js: "sun" | "surface" | "phobos"
	from: PHOBOS,                      // the skyhook the ship is let go from
	to: SURFACE,                       // where it is bound: SURFACE, or the other skyhook's id
	params: {},                        // facility id -> its params (m)
	included: {},                      // facility id -> in the design?
	limit: DEFAULT_LIMIT,              // the least clearance allowed between the hanging tether and another, m
	open: {}                           // facility id -> card unfolded?
};
state.params[PHOBOS] = Object.assign({}, FACILITIES[PHOBOS].defaults);
state.params[HANGING] = Object.assign({}, HANGING_DEFAULTS);
state.params[ELEVATOR] = Object.assign({}, ELEVATOR_DEFAULTS);
state.included[PHOBOS] = true;
state.included[HANGING] = true;
state.included[ELEVATOR] = true;
state.open[PHOBOS] = true;
state.open[HANGING] = true;
state.open[ELEVATOR] = true;

var FACILITIES_TOP_MAX = moonSkyhookLimits(PHOBOS).topMax;   // the Phobos skyhook's top with no elevator: short of Deimos
var figs = {};                         // facility id -> its figures (core/facilities.js's allFigures)
var flight = null;                     // core/flight.js's result for the current release, or { ok: false }
// The hanging skyhook's timing belongs to one design: `timingKey` names it,
// and `schedule` is core/clearance.js's workOutSidesteps result for it, or
// null until the button is pressed.
var timingKey = null, schedule = null;
var marksFor = {};                     // what the whole-span marks were last drawn for

function $(id) { return document.getElementById(id); }
var holder = $("mst-canvas-holder");
var keysEl = $("mst-key-list"), groundSpeed = $("mst-ground-speed");
var relSlider = $("mst-release-time"), relVal = $("mst-release-time-val");
var flightSlider = $("mst-flight-time"), flightVal = $("mst-flight-time-val");
var showSoi = $("mst-show-soi"), showOrbits = $("mst-show-orbits"), showGrid = $("mst-show-grid");
var showFac = $("mst-show-facilities"), showTraj = $("mst-show-traj");

// ---- time -----------------------------------------------------------------------
function releaseJd() {
	var fig = figs[state.from];
	return state.jd + (fig && fig.ok ? state.relFrac * fig.period / DAY : 0);
}
// The params core/ takes: a facility left out of the design is null.
function designParams() {
	var p = {};
	p[PHOBOS] = state.included[PHOBOS] ? state.params[PHOBOS] : null;
	p[HANGING] = state.included[HANGING] ? state.params[HANGING] : null;
	p[ELEVATOR] = state.included[ELEVATOR] ? state.params[ELEVATOR] : null;
	return p;
}
// Every facility's figures. A change to anything the hanging skyhook's timing
// rests on starts that timing afresh: its place round its orbit at the start
// of the clock is the one that keeps its first passes widest of the Phobos
// tether and the space elevator's, and no sidesteps are worked out.
function computeFigures() {
	figs = allFigures(designParams());
	var h = figs[HANGING], p = figs[PHOBOS], hp = state.params[HANGING], ep = state.params[ELEVATOR];
	if (!(h && h.ok)) { return; }
	var key = [hp.footAlt, hp.comAlt, hp.topAlt, hp.tilt, hp.sunSync, hp.anchorMass, hp.ballastMass, hp.ballastHome,
	           hp.upperBallastMass, hp.upperBallastHome, hp.ballastSpeed, state.limit, p && p.ok ? p.footAlt + "/" + p.topAlt : "none",
	           h.shareElevator ? [ep.lat, ep.lon, ep.material, ep.safety, ep.rCW, ep.cwMass, ep.cargoFlow].join("/") : "none"].join("|");
	if (key !== timingKey) {
		timingKey = key; schedule = null;
		hp.timing = { a0: needsTiming(h, others()) ? bestStartAngle(h, others(), state.limit) : 0, sidesteps: [] };
	}
	h.timing = hp.timing;
}
// The tethers the hanging skyhook is timed against (core/clearance.js).
function others() { return { phobos: figs[PHOBOS] || null, elevator: figs[ELEVATOR] || null }; }
function flightSeconds() { return flight && flight.ok ? flight.leg.duration * state.flightFrac : 0; }
function sceneJd() { return releaseJd() + flightSeconds() / DAY; }

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
// A length for a km field: whole where it is whole, to the metre where not.
function kmField(m) {
	var k = m / 1e3;
	return Math.abs(k - Math.round(k)) < 5e-4 ? String(Math.round(k)) : k.toFixed(3);
}
function pct(x) { return num(Math.abs(x) * 100, Math.abs(x) < 0.001 ? 3 : 2) + "%"; }
function dateTime(jd) { return shortDate(jd) + " " + clockTime(jd); }
function speed(mps) { return num(mps) + " m/s"; }
function hours(sec) {
	var m = Math.round(sec / 60);
	return Math.floor(m / 60) + " h " + two(m % 60) + " min";
}
function span(sec) {
	if (sec < 120) { return num(sec) + " s"; }
	if (sec < 2 * 3600) { return num(sec / 60) + " min"; }
	if (sec < 2 * DAY) { return num(sec / 3600, 1) + " h"; }
	return num(sec / DAY, 1) + " d";
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
var overlay = buildOverlay(frame.scene);
var renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
holder.appendChild(renderer.domElement);
holder.appendChild(frame.labelLayer);

var followEl = $("mst-follow");
var glide = 0;                         // frames left of easing onto a new follow position

// World position of a follow target, or null when it is not in the scene.
function targetPos(id) {
	if (id === "ship") { return overlay.ship.visible ? overlay.ship.position : null; }
	if (overlay.markers[id]) {
		var parts = id.split(":"), fig = figs[parts[0]];
		if (parts[1] === "release" && parts[0] !== state.from) { return null; }   // only the departure has one
		return showFac.checked && fig && fig.ok ? overlay.markers[id].pos : null;
	}
	return frame.bodyPosition(id);
}
function targetLabel(id) {
	return id === "ship" ? "the ship" : (overlay.markers[id] ? overlay.markers[id].label : id);
}
function zoomMin() { return ZOOM_MIN[state.follow] || 0.02; }

// Keep the camera on `id` from now on (null: let go). `pov` names the POV
// button this came from, if any; any other follow clears the buttons.
function setFollow(id, pov) {
	if (id !== state.follow) { glide = 18; }
	state.follow = id;
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
	followEl.firstChild.textContent = state.follow ? "Following: " + targetLabel(state.follow) : "";
	pressed($("mst-pov"), "pov", state.pov);
	pressed($("mst-frames"), "frame", state.view);
	var f = VIEW_FRAMES.filter(function (v) { return v.id === state.view; })[0];
	$("mst-view-caption").textContent = "MARS SYSTEM · Mars-centred, "
		+ (state.view === "phobos" ? "Phobos's orbit pole up" : state.view === "sun" ? "ecliptic north up" : "north up")
		+ " · " + f.caption;
}
// Per frame: hold the camera's centre on the followed thing, easing onto it
// for a moment after a change. A target that has left the scene is let go.
function applyFollow() {
	if (!state.follow) { return; }
	var pos = targetPos(state.follow);
	if (!pos) { state.follow = null; state.pov = null; syncButtons(); return; }
	if (glide > 0) { frame.cam.target.lerp(pos, 0.25); glide--; } else { frame.cam.target.copy(pos); }
}

// Distance in pixels from the cursor to a world point (Infinity behind the camera).
var _sp = new THREE.Vector3();
function pxFrom(e, pos) {
	var rect = renderer.domElement.getBoundingClientRect();
	_sp.copy(pos).project(frame.camera);
	if (_sp.z > 1) { return Infinity; }
	return Math.hypot((_sp.x * 0.5 + 0.5) * rect.width - (e.clientX - rect.left),
		(-_sp.y * 0.5 + 0.5) * rect.height - (e.clientY - rect.top));
}
// What a click at the cursor would follow, or null: the ship, then the
// skyhook's markers, then a body — anywhere on its disc, or within a few
// pixels of it once it is a dot.
function pickTarget(e) {
	if (overlay.ship.visible && pxFrom(e, overlay.ship.position) < 14) { return "ship"; }
	var best = null, bestD = 11;
	Object.keys(overlay.markers).forEach(function (id) {
		var pos = targetPos(id), d = pos ? pxFrom(e, pos) : Infinity;
		if (d < bestD) { bestD = d; best = id; }
	});
	if (best) { return best; }
	for (var i = 0; i < BODIES.length; i++) {
		var p = frame.bodyPosition(BODIES[i]);
		var reach = Math.max(10, projectedRadiusPx(frame.camera, holder, frame.bodyRadius(BODIES[i]),
			frame.camera.position.distanceTo(p) || 1e-9));
		if (pxFrom(e, p) < reach) { return BODIES[i]; }
	}
	return null;
}
// The departure skyhook's id if its release marker is under the cursor, else null.
function releaseMarkerAt(e) {
	var pos = targetPos(state.from + ":release");
	return pos && pxFrom(e, pos) < 12 ? state.from : null;
}

// Dragging the departure's release marker: it goes to the point of the tether
// nearest the cursor's line of sight.
//
//     x = ( (u . w) - (d . u)(d . w) ) / ( 1 - (d . u)^2 )
//
//     d   unit vector along the line of sight through the cursor
//     u   unit vector along the tether, from Mars's centre (the view's origin)
//     w   the camera's position
//     x   distance from Mars's centre to that point of the tether
function dragRelease(e, id) {
	var fig = figs[id];
	if (!(fig && fig.ok)) { return; }
	var rect = renderer.domElement.getBoundingClientRect();
	var d = new THREE.Vector3(((e.clientX - rect.left) / rect.width) * 2 - 1,
		-(((e.clientY - rect.top) / rect.height) * 2 - 1), 0.5)
		.unproject(frame.camera).sub(frame.camera.position).normalize();
	var jd = sceneJd(), at = facilityAt(fig, jd), uv = toView(viewBasis(state.view, jd), at.u);
	var u = new THREE.Vector3(uv[0], uv[1], uv[2]), w = frame.camera.position;
	var b = d.dot(u), den = 1 - b * b;
	if (den < 1e-6) { return; }
	var x = (u.dot(w) - b * d.dot(w)) / den * U;           // m from Mars's centre
	var alt = altitudeOf(fig, x - centreRadius(fig, at));  // as the card gives altitudes
	state.params[id].relAlt = Math.max(fig.footAlt, Math.min(fig.topAlt, alt));
	refresh();
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
		// A press on the release marker is its own: moved, it drags the marker
		// along the tether; let go where it was pressed, it is a click and follows it.
		captureDrag: function (e) {
			var id = e.button === 0 ? releaseMarkerAt(e) : null;
			return id ? { x: e.clientX, y: e.clientY, travel: 0, id: id } : null;
		},
		onCapturedMove: function (e, tok) {
			tok.travel += Math.abs(e.clientX - tok.x) + Math.abs(e.clientY - tok.y);
			tok.x = e.clientX; tok.y = e.clientY;
			if (tok.travel >= 3) { dragRelease(e, tok.id); }
		},
		onCapturedEnd: function (e, tok) {
			if (tok.travel < 3) { setFollow(tok.id + ":release"); }
		},
		onPick: function (e) {
			var id = pickTarget(e);
			if (id) { setFollow(id); }
		}
	};
});
renderer.domElement.addEventListener("mousemove", function (e) {
	if (e.buttons) { return; }
	renderer.domElement.style.cursor = releaseMarkerAt(e) ? "grab" : (pickTarget(e) ? "pointer" : "");
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
	if (overlay.ship.visible) {
		overlay.ship.scale.setScalar(worldSizeAtPointForPx(frame.camera, holder, overlay.ship.position, CHEVRON_PX));
		orientMarkerSprite(frame.camera, overlay.ship, overlay.shipDir);
	}
	renderer.render(frame.scene, frame.camera);
}

// ---- sidebar ---------------------------------------------------------------------------
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
function cardShell(label, sub, stub) {
	var card = $("mst-cards").appendChild(el("section", "mst-card" + (stub ? " mst-card-stub" : "")));
	var head = card.appendChild(el(stub ? "div" : "button", "mst-card-head"));
	if (!stub) { head.type = "button"; }
	head.innerHTML = CHEVRON_SVG;
	var title = head.appendChild(el("span", "mst-card-title", label));
	title.appendChild(el("span", "mst-card-sub", sub));
	var badge = head.appendChild(el("span", "mst-badge"));
	return { el: card, head: head, badge: badge, body: card.appendChild(el("div", "mst-card-body")) };
}
function numberField(parent, id, label, onInput) {
	var f = parent.appendChild(el("div", "mst-field"));
	var lab = f.appendChild(el("label", null, label));
	lab.htmlFor = id;
	var input = f.appendChild(el("input"));
	input.type = "number"; input.id = id; input.step = "any";
	input.addEventListener("input", function () { onInput(parseFloat(input.value)); });
	return input;
}
function checkBox(parent, id, label, onChange) {
	var lab = parent.appendChild(el("label", "mst-check")), box = lab.appendChild(el("input"));
	box.type = "checkbox"; box.id = id;
	lab.appendChild(document.createTextNode(" " + label));
	box.addEventListener("change", function () { onChange(box.checked); });
	return box;
}
// The release point's controls and readouts, the same on either skyhook's
// card and shown on the flight's departure; then the arrival's readouts, shown
// on its destination.
function releaseSection(parent, id, prefix, r) {
	var rel = r.release = parent.appendChild(el("div", "mst-release"));
	var line = rel.appendChild(el("div", "mst-release-line"));
	var sf = line.appendChild(el("div", "mst-field"));
	var lab = sf.appendChild(el("label", null, "Release point, from foot to top"));
	lab.htmlFor = prefix + "-rel-slider";
	r.relSlider = sf.appendChild(el("input"));
	r.relSlider.type = "range"; r.relSlider.id = prefix + "-rel-slider";
	r.relSlider.min = 0; r.relSlider.max = 1; r.relSlider.step = "any";
	function slid() {
		var fig = figs[id];
		if (!(fig && fig.ok)) { return; }
		state.params[id].relAlt = fig.footAlt + parseFloat(r.relSlider.value) * (fig.topAlt - fig.footAlt);
		refresh({ fromSlider: id });
	}
	r.relSlider.addEventListener("input", slid);
	bindFineDrag(r.relSlider, slid, null, SLOW_DRAG);
	r.rel = numberField(line, prefix + "-rel", "Altitude (km)", function (kmVal) {
		if (isFinite(kmVal)) { state.params[id].relAlt = kmVal * 1e3; refresh(); }
	});
	var rr = rel.appendChild(el("div", "mst-readouts"));
	r.relNow = readout(rr, "At the release");
	r.relEsc = readout(rr, "Escape speed there");
	r.relFate = readout(rr, "A ship let go here");
	var arr = r.arrival = parent.appendChild(el("div", "mst-arrival mst-readouts"));
	r.arrPass = readout(arr, "The ship's closest pass");
	r.arrMiss = readout(arr, "It passes the tether by");
	r.arrPoint = readout(arr, "Nearest point of the tether");
	r.arrTrim = readout(arr, "Its motion relative to that point");
	r.arrCatch = readout(arr, "Caught");
}
// Whether, and why not, a ship is caught at its closest pass (core/arrival.js).
function catchText(a) {
	if (a.caught) { return "yes"; }
	if (a.reason === "too-fast") { return "no: faster than the " + num(CATCH_SPEED_LIMIT) + " m/s a catcher absorbs"; }
	if (a.blocked) { return "no: Mars is between them"; }
	return "no: " + (a.reason === "above-top" ? "passes " + km(a.gap) + " above the top"
		: a.reason === "below-foot" ? "passes " + km(-a.gap) + " below the foot" : "passes wide of the tether");
}
function distText(m) { return m < 10e3 ? num(m / 1e3, 2) + " km" : km(m); }
function fillRelease(id, r, opts) {
	var fig = figs[id], dep = state.from === id, dest = state.to === id;
	var card = id === PHOBOS ? hookCard : hangCard;
	r.release.style.display = dep ? "" : "none";
	r.arrival.style.display = dest ? "" : "none";
	card.badge.textContent = dep ? "departure" : (dest ? "arrival" : "");
	card.badge.className = "mst-badge" + (dep ? " mst-badge-departure" : (dest ? " mst-badge-arrival" : ""));
	show(r.rel, kmField(state.params[id].relAlt));
	var a = dest && flight && flight.ok && flight.arrival && flight.arrival.found ? flight.arrival : null;
	r.arrPass.textContent = a ? "T+ " + span(a.t) + " · " + dateTime(a.jd) : "—";
	r.arrMiss.textContent = a ? (a.met ? "meets it" : distText(a.miss)) : "—";
	r.arrPoint.textContent = a ? km(a.altitude) + " up · " + speed(a.pointSpeed) : "—";
	r.arrTrim.textContent = a ? speed(a.trim) : "—";
	r.arrCatch.textContent = a ? catchText(a) : "—";
	if (!(fig && fig.ok)) {
		[r.relNow, r.relEsc, r.relFate].forEach(function (x) { x.textContent = "—"; });
		return;
	}
	if (opts.fromSlider !== id) { r.relSlider.value = (fig.relAlt - fig.footAlt) / (fig.topAlt - fig.footAlt); }
	if (dep && flight && flight.ok) {
		r.relNow.textContent = km(flight.release.altitude) + " · " + speed(O.vMag(flight.release.v));
		r.relEsc.textContent = speed(O.escapeVelocity(fig.GM, flight.release.radius));
		r.relFate.textContent = { entry: "falls to Mars", orbit: "stays in orbit", escape: "leaves Mars" }[flight.summary.outcome];
	}
}
// Set a field's text unless the user is typing in it.
function show(input, value) { if (document.activeElement !== input) { input.value = value; } }

// The Phobos skyhook's card.
var hookCard = null;
function buildSkyhookCard() {
	var c = cardShell(FACILITIES[PHOBOS].label, "Tether built on Phobos, riding its orbit"), r = {};
	c.head.addEventListener("click", function () { state.open[PHOBOS] = !state.open[PHOBOS]; syncCards(); });
	function setAlt(key) {
		return function (kmVal) {
			if (isFinite(kmVal)) { state.params[PHOBOS][key] = kmVal * 1e3; refresh(); }
		};
	}
	var inRow = c.body.appendChild(el("div", "mst-row"));
	r.included = checkBox(inRow, "mst-hook-in", "In the design", function (on) { state.included[PHOBOS] = on; refresh(); });
	var pair = c.body.appendChild(el("div", "mst-fieldpair"));
	r.foot = numberField(pair, "mst-hook-foot", "Foot altitude (km)", setAlt("footAlt"));
	r.top = numberField(pair, "mst-hook-top", "Top altitude (km)", setAlt("topAlt"));
	r.error = c.body.appendChild(el("div", "mst-error"));
	c.body.appendChild(el("div", "mst-muted", "Altitudes are with Phobos at its mean distance. Phobos moves 142 km nearer and farther each orbit, and the whole tether with it."));
	var ro = c.body.appendChild(el("div", "mst-readouts"));
	r.length = readout(ro, "Tether length");
	r.cap = readout(ro, "Highest the top may be set");
	r.footNow = readout(ro, "Foot now");
	r.topNow = readout(ro, "Top now");
	r.pullFoot = readout(ro, "Weight of 1 kg at the foot");
	r.pullTop = readout(ro, "Weight of 1 kg at the top");
	releaseSection(c.body, PHOBOS, "mst-hook", r);
	hookCard = { el: c.el, refs: r, badge: c.badge };
}
// A point of a skyhook as it is now: altitude and speed.
function pointNow(fig, at, s) {
	var st = pointState(fig, at, s);
	return km(O.vMag(st.r) - R_MARS) + " · " + speed(O.vMag(st.v));
}
function fillSkyhookCard(opts) {
	var r = hookCard.refs, fig = figs[PHOBOS], p = state.params[PHOBOS], on = !!state.included[PHOBOS];
	r.included.checked = on;
	hookCard.el.classList.toggle("mst-card-off", !on);
	show(r.foot, kmField(p.footAlt)); show(r.top, kmField(p.topAlt));
	r.error.textContent = !fig || fig.ok ? "" : fig.diagnostic.message;
	var code = !fig || fig.ok ? "" : fig.diagnostic.code;
	r.foot.classList.toggle("mst-bad", code === "foot-range");
	r.top.classList.toggle("mst-bad", code === "top-range");
	r.rel.classList.toggle("mst-bad", code === "release-off-tether");
	fillRelease(PHOBOS, r, opts);
	// With a space elevator in the design, its tether sets the limit; otherwise Deimos does.
	var ev = figs[ELEVATOR], cap = ev && ev.ok && ev.phobosTopCap != null && ev.phobosTopCap < FACILITIES_TOP_MAX ? ev.phobosTopCap : null;
	r.cap.textContent = cap != null ? num(Math.floor(cap / 1e3)) + " km: beyond, too near the space elevator" : km(FACILITIES_TOP_MAX) + ": short of Deimos";
	if (!(fig && fig.ok)) {
		[r.length, r.footNow, r.topNow, r.pullFoot, r.pullTop].forEach(function (x) { x.textContent = "—"; });
		return;
	}
	var at = facilityAt(fig, sceneJd());
	r.length.textContent = km(fig.topAlt - fig.footAlt);
	r.footNow.textContent = pointNow(fig, at, fig.sFoot);
	r.topNow.textContent = pointNow(fig, at, fig.sTop);
	r.pullFoot.textContent = num(-fig.pullFoot, 2) + " N, toward Mars";
	r.pullTop.textContent = num(fig.pullTop, 2) + " N, away from Mars";
}

// ---- the hanging skyhook's card --------------------------------------------------------
var hangCard = null;
function buildHangingCard() {
	var c = cardShell(FACILITIES[HANGING].label, "On its own tilted orbit, timed to stay clear of the Phobos tether and the space elevator's"), r = {};
	var P = state.params[HANGING];
	c.head.addEventListener("click", function () { state.open[HANGING] = !state.open[HANGING]; syncCards(); });
	function set(key, scale) {
		return function (v) { if (isFinite(v)) { P[key] = v * scale; refresh(); } };
	}
	var inRow = c.body.appendChild(el("div", "mst-row"));
	r.included = checkBox(inRow, "mst-hang-in", "In the design", function (on) { state.included[HANGING] = on; refresh(); });

	var trio = c.body.appendChild(el("div", "mst-fieldpair"));
	r.foot = numberField(trio, "mst-hang-foot", "Foot (km)", set("footAlt", 1e3));
	r.com = numberField(trio, "mst-hang-com", "C.o.M. (km)", set("comAlt", 1e3));
	r.top = numberField(trio, "mst-hang-top", "Top (km)", set("topAlt", 1e3));
	var tiltRow = c.body.appendChild(el("div", "mst-fieldpair mst-tilt-line"));
	r.tilt = numberField(tiltRow, "mst-hang-tilt", "Tilt to the equator (°)", set("tilt", 1));
	r.sunSync = checkBox(tiltRow, "mst-hang-sunsync", "Sun-synchronous", function (on) { P.sunSync = on; refresh(); });
	r.error = c.body.appendChild(el("div", "mst-error"));

	var ro = c.body.appendChild(el("div", "mst-readouts"));
	r.period = readout(ro, "One orbit");
	r.footNow = readout(ro, "Foot now");
	r.comNow = readout(ro, "Centre of mass now");
	r.topNow = readout(ro, "Top now");
	r.plane = readout(ro, "Its plane turns once in");
	r.mass = readout(ro, "Mass, tether and all");

	c.body.appendChild(el("div", "mst-subhead", "Timing against the Phobos skyhook"));
	var tm = c.body.appendChild(el("div", "mst-readouts"));
	r.share = readout(tm, "Altitudes the two tethers share");
	r.ratio = readout(tm, "Orbits per turn of Phobos");
	r.gapNow = readout(tm, "Tethers apart now");
	r.closest = readout(tm, "Closest pass, next 5 days");
	c.body.appendChild(el("div", "mst-muted mst-res-head", "Resonant centres of mass on this tether (click to use one). The gap is how far round Mars the Phobos tether stays from every pass:"));
	r.resList = c.body.appendChild(el("div", "mst-res-list"));
	r.guide = c.body.appendChild(el("div", "mst-guide"));

	c.body.appendChild(el("div", "mst-subhead", "Timing against the space elevator"));
	var em = c.body.appendChild(el("div", "mst-readouts"));
	r.evShare = readout(em, "The elevator's tether at these heights");
	r.evRatio = readout(em, "Orbits per Mars day");
	r.evGapNow = readout(em, "Tethers apart now");
	r.evClosest = readout(em, "Closest pass, next 5 days");
	c.body.appendChild(el("div", "mst-muted mst-res-head", "Centres of mass on this tether in step with Mars's day (click to use one). In step, the elevator's tether comes through the orbit's plane at the same places round it every time:"));
	r.dayList = c.body.appendChild(el("div", "mst-res-list"));
	r.evGuide = c.body.appendChild(el("div", "mst-guide"));

	c.body.appendChild(el("div", "mst-subhead", "Ballast and sidesteps"));
	var b1 = c.body.appendChild(el("div", "mst-fieldpair"));
	r.ballast = numberField(b1, "mst-hang-ballast", "Ballast (kt)", set("ballastMass", 1e6));
	r.home = numberField(b1, "mst-hang-home", "Its home (km)", set("ballastHome", 1e3));
	var b2 = c.body.appendChild(el("div", "mst-fieldpair"));
	r.upper = numberField(b2, "mst-hang-upper", "Upper ballast (kt)", set("upperBallastMass", 1e6));
	r.upperHome = numberField(b2, "mst-hang-upper-home", "Its home (km)", set("upperBallastHome", 1e3));
	c.body.appendChild(el("div", "mst-muted", "Ballast speeds the skyhook up by moving away from the centre of mass and slows it by moving toward it. The upper ballast rides above the centre of mass, so bringing it down slows the skyhook."));
	var b3 = c.body.appendChild(el("div", "mst-fieldpair mst-ballast-rest"));
	r.anchor = numberField(b3, "mst-hang-anchor", "Anchor station (kt)", set("anchorMass", 1e6));
	r.bspeed = numberField(b3, "mst-hang-bspeed", "Ballast speed (km/h)", set("ballastSpeed", 1 / 3.6));
	r.limit = numberField(b3, "mst-hang-limit", "Least clearance (km)", function (v) {
		if (isFinite(v) && v > 0) { state.limit = v * 1e3; refresh(); }
	});
	var au = c.body.appendChild(el("div", "mst-readouts"));
	r.faster = readout(au, "The ballast can speed the orbit up by");
	r.slower = readout(au, "and slow it by");
	r.ballastNow = readout(au, "Ballast now");
	var act = c.body.appendChild(el("div", "mst-row mst-work-row"));
	r.work = act.appendChild(el("button", "mst-action", "Work out the sidesteps"));
	r.work.type = "button";
	r.work.addEventListener("click", workOut);
	r.prev = act.appendChild(el("button", "mst-action mst-action-small", "◂ Previous"));
	r.next = act.appendChild(el("button", "mst-action mst-action-small", "Next ▸"));
	r.prev.type = "button"; r.next.type = "button";
	r.prev.title = "Move the date to the sidestep before"; r.next.title = "Move the date to the next sidestep";
	r.prev.addEventListener("click", function () { jumpSidestep(-1); });
	r.next.addEventListener("click", function () { jumpSidestep(1); });
	r.status = c.body.appendChild(el("div", "mst-guide"));
	r.stepBox = c.body.appendChild(el("div", "mst-readouts mst-step"));
	r.stepHead = r.stepBox.appendChild(el("div", "mst-step-head"));
	r.stepAvoids = readout(r.stepBox, "Avoids");
	r.stepSlip = readout(r.stepBox, "Slips the skyhook");
	r.stepMove = readout(r.stepBox, "Ballast moved");
	r.stepTimes = readout(r.stepBox, "Out · held · back");
	r.stepEnergy = readout(r.stepBox, "");
	r.stepPower = readout(r.stepBox, "Peak power on the ballast's drive");
	r.stepOrbit = readout(r.stepBox, "Orbit while the ballast is out");
	r.stepFoot = readout(r.stepBox, "Foot and top meanwhile");
	r.stepBoost = readout(r.stepBox, "Boost needed afterwards");
	r.stepUntil = readout(r.stepBox, "Next close pass put off until");

	releaseSection(c.body, HANGING, "mst-hang", r);
	hangCard = { el: c.el, refs: r, badge: c.badge, resKey: null };
}

// What the skyhook's period means for its timing, in words (core/clearance.js's timingGuidance).
function guidanceText(h) {
	if (!h.share) { return "The two tethers share no altitude, so they cannot meet: no timing is needed."; }
	var g = timingGuidance(h, RATIOS, state.limit), name = g.near.p + ":" + g.near.q;
	if (g.needs === null) {
		return "On the " + name + " resonance: every pass finds the Phobos tether at least " + num(g.near.gap * DEG, 1)
			+ "° round Mars away, so no sidestep is needed while the skyhook keeps this period.";
	}
	var faster = g.needs === "faster";
	var text = "Turning " + pct(g.off) + " too " + (faster ? "slow" : "fast") + " for the " + name + " resonance, the nearest. "
		+ (g.interval > 0
			? "Its passes creep toward the Phobos tether, so it needs a sidestep that " + (faster ? "speeds it up" : "slows it down")
				+ " about every " + span(g.interval) + "."
			: "At this tilt and clearance its passes come too near the Phobos tether however they are timed.");
	// Under a fifth of a percent, a slip of any size takes too long to be of use.
	var can = faster ? g.faster : g.slower;
	if (can < 0.002) {
		text += (can > 1e-5 ? " The ballast can do that by only " + pct(can) + ", too little to be of use. " : " The ballast cannot do that. ")
			+ (faster
				? "Ballast speeds a skyhook up by moving away from the centre of mass: give some a home near the centre of mass."
				: "Ballast slows a skyhook by moving toward the centre of mass: add upper ballast, or give it a home higher up the tether.");
	}
	return text;
}
// The same for the space elevator's tether (core/clearance.js's elevatorGuidance).
function elevatorGuidanceText(h) {
	var ev = figs[ELEVATOR];
	if (!(ev && ev.ok)) { return ""; }
	if (!h.shareElevator) { return "This tether never comes as far from the equator as the space elevator's tether stands at these heights, so they cannot meet: no timing is needed."; }
	var g = elevatorGuidance(h, ev, DAY_RATIOS, state.limit);
	var name = g.near.q === 1 ? g.near.p + " orbits a Mars day" : g.near.p + " orbits in " + g.near.q + " Mars days";
	var text;
	if (g.held) {
		text = "In step with Mars's day, at " + name + ": the elevator's tether comes through this orbit's plane at the same places round it every time, so passes that are clear stay clear while the skyhook keeps this period.";
	} else {
		text = "The elevator's tether comes through this orbit's plane twice a Mars day. Left to chance, about one pass in "
			+ num(Math.max(1, 1 / Math.max(g.chance, 1e-3))) + " comes within the least clearance. Out of step with Mars's day (the nearest is " + name
			+ ", " + pct(g.off) + " away), the skyhook's place at a pass moves " + num(Math.abs(g.creep) * DEG) + "° round its orbit from one day to the next, so a sidestep clears only the next few days.";
	}
	if (h.share) {
		text += " No period is in step with both Phobos and Mars's day. With both tethers at shared heights, one of them needs frequent sidesteps; raising the Phobos skyhook's foot above this tether's top, or leaving one of the three out of the design, removes that.";
	}
	return text;
}
var AGAINST = { phobos: "the Phobos tether", elevator: "the space elevator's tether" };
// The schedule in words.
function scheduleText(h) {
	if (!needsTiming(h, others())) { return ""; }
	if (!schedule) { return "The sidesteps for this design are not worked out yet."; }
	var n = schedule.sidesteps.length, u = schedule.unavoided, end = shortDate(schedule.jdReached), text;
	if (n) {
		var first = schedule.sidesteps[0].jdStart, lastStart = schedule.sidesteps[n - 1].jdStart;
		text = n + (n === 1 ? " sidestep" : " sidesteps") + " to " + end
			+ (n > 1 ? ", one every " + span((lastStart - first) * DAY / (n - 1)) + " on average" : "") + ".";
	} else { text = "No sidestep is needed to " + end + "."; }
	if (u.length) {
		var worst = u.reduce(function (a, b) { return Math.min(a, b.distance); }, Infinity);
		text += " " + u.length + (u.length === 1 ? " spell" : " spells") + " of close passes the ballast cannot avoid, the first on "
			+ shortDate(u[0].jd) + ", the closest " + km(worst) + ": marked in red.";
	} else if (schedule.closest) { text += " Closest pass left: " + km(schedule.closest.distance) + ", to " + AGAINST[schedule.closest.against] + "."; }
	if (!schedule.complete) {
		text += schedule.stopped === "time" ? " Worked out only that far: the working was stopped after " + num(WORK_BUDGET / 1e3) + " seconds."
			: " Worked out only that far: beyond it the count ran out.";
	}
	return text;
}
// The sidestep to show at jd: the one under way, else the next, else the last. -1 if there is none.
function shownSidestep(jd) {
	var list = schedule ? schedule.sidesteps : [];
	for (var i = 0; i < list.length; i++) { if (list[i].jdEnd >= jd) { return i; } }
	return list.length - 1;
}
// Move the date to the start of the sidestep before (-1) or after (+1) the scene's instant.
function jumpSidestep(dir) {
	var list = schedule ? schedule.sidesteps : [], jd = sceneJd(), pick = null;
	list.forEach(function (st) {
		if (dir > 0 ? (st.jdStart > jd + 1e-6 && !pick) : st.jdStart < jd - 1e-6) { pick = st; }
	});
	if (!pick) { return; }
	state.relFrac = 0; state.flightFrac = 0; relSlider.value = 0; flightSlider.value = 0;
	dateBar.setJd(pick.jdStart);
	refresh();
}
var WORK_BUDGET = 25000;               // the longest the sidesteps are worked on, ms
function workOut() {
	var h = figs[HANGING];
	if (!(h && h.ok && needsTiming(h, others()))) { return; }
	hangCard.refs.status.textContent = "Working through the passes…";
	// Let the message show before the page is busy.
	setTimeout(function () {
		schedule = workOutSidesteps(h, others(), { limit: state.limit, budgetMs: WORK_BUDGET });
		state.params[HANGING].timing = { a0: schedule.a0, sidesteps: schedule.sidesteps };
		refresh();
	}, 30);
}
function fillHangingCard(opts) {
	var r = hangCard.refs, P = state.params[HANGING], fig = figs[HANGING], on = !!state.included[HANGING];
	r.included.checked = on;
	hangCard.el.classList.toggle("mst-card-off", !on);
	show(r.foot, kmField(P.footAlt)); show(r.com, kmField(P.comAlt)); show(r.top, kmField(P.topAlt));
	show(r.anchor, num(P.anchorMass / 1e6).replace(/,/g, "")); show(r.ballast, num(P.ballastMass / 1e6).replace(/,/g, ""));
	show(r.upper, num(P.upperBallastMass / 1e6).replace(/,/g, "")); show(r.upperHome, kmField(P.upperBallastHome));
	show(r.home, kmField(P.ballastHome)); show(r.bspeed, String(Math.round(P.ballastSpeed * 3.6 * 10) / 10));
	show(r.limit, kmField(state.limit));
	r.sunSync.checked = !!P.sunSync;
	r.tilt.disabled = !!P.sunSync;
	var ok = !!(fig && fig.ok), code = fig && !fig.ok ? fig.diagnostic.code : "";
	r.error.textContent = fig && !fig.ok ? fig.diagnostic.message : "";
	r.foot.classList.toggle("mst-bad", code === "foot-range");
	r.com.classList.toggle("mst-bad", code === "com-range" || code === "unbalanced");
	r.top.classList.toggle("mst-bad", code === "top-range");
	r.tilt.classList.toggle("mst-bad", code === "tilt-low" || code === "tilt-elevator" || code === "tilt-range" || code === "no-sun-sync");
	r.anchor.classList.toggle("mst-bad", code === "anchor-range" || code === "unbalanced");
	r.home.classList.toggle("mst-bad", code === "ballast-home");
	r.upper.classList.toggle("mst-bad", code === "unbalanced");
	r.upperHome.classList.toggle("mst-bad", code === "upper-ballast-home");
	r.rel.classList.toggle("mst-bad", code === "release-off-tether");
	fillRelease(HANGING, r, opts);
	// A sun-synchronous tilt is the skyhook's own; otherwise the field holds what was typed.
	if (P.sunSync) { r.tilt.value = ok ? (fig.tilt * DEG).toFixed(2) : ""; } else { show(r.tilt, String(P.tilt)); }
	var live = [r.period, r.footNow, r.comNow, r.topNow, r.plane, r.mass, r.share, r.ratio, r.gapNow, r.closest, r.faster, r.slower, r.ballastNow,
	            r.evShare, r.evRatio, r.evGapNow, r.evClosest];
	r.work.disabled = !(ok && needsTiming(fig, others()));
	r.prev.disabled = r.next.disabled = !(ok && schedule && schedule.sidesteps.length);
	if (!ok) {
		live.forEach(function (x) { x.textContent = "—"; });
		r.guide.textContent = ""; r.status.textContent = ""; r.resList.textContent = ""; hangCard.resKey = null;
		r.evGuide.textContent = ""; r.dayList.textContent = ""; hangCard.dayKey = null;
		r.stepBox.hidden = true;
		return;
	}
	var jd = sceneJd(), at = facilityAt(fig, jd), ph = figs[PHOBOS] || { ok: false }, ev = figs[ELEVATOR] || { ok: false };
	r.period.textContent = hours(fig.period);
	r.footNow.textContent = pointNow(fig, at, fig.sFoot);
	r.comNow.textContent = pointNow(fig, at, 0);
	r.topNow.textContent = pointNow(fig, at, fig.sTop);
	var turn = Math.abs(fig.nodeRate) > 1e-12 ? TWO_PI / Math.abs(fig.nodeRate) : Infinity;
	r.plane.textContent = !isFinite(turn) || turn > 500 * 365.25 * DAY ? "does not turn"
		: (turn > 2 * 365.25 * DAY ? num(turn / DAY / 365.25, 1) + " yr" : num(turn / DAY) + " d")
			+ (fig.nodeRate > 0 ? ", eastward" : ", westward") + (fig.sunSync ? ": with the Sun" : "");
	r.mass.textContent = num(fig.total / 1e6) + " kt";
	r.share.textContent = fig.share ? km(fig.share.lo).replace(" km", "") + " to " + km(fig.share.hi) : "none";
	r.ratio.textContent = num(fig.ratio, 4);
	r.gapNow.textContent = ph.ok ? km(tetherDistance(fig, ph, fig.timing, jd)) : "—";
	var near = ph.ok && fig.share ? closestPass(fig, { phobos: ph }, fig.timing, jd, jd + 5, state.limit) : null;
	r.closest.textContent = near ? km(near.distance) + (near.distance < state.limit ? " · too close" : "") : "—";
	r.closest.classList.toggle("mst-warn", !!near && near.distance < state.limit);

	// The resonances on this tether, rebuilt only when they change.
	var resKey = fig.resonances.map(function (x) { return x.p + ":" + x.q + "@" + Math.round(x.comAlt); }).join(",") + "|" + Math.round(fig.comAlt);
	if (resKey !== hangCard.resKey) {
		hangCard.resKey = resKey;
		r.resList.textContent = "";
		fig.resonances.forEach(function (x) {
			var b = r.resList.appendChild(el("button", "mst-res", x.p + ":" + x.q + " · " + num(x.comAlt / 1e3) + " km · gap " + num(x.gap * DEG, 1) + "°"));
			b.type = "button";
			b.setAttribute("aria-pressed", String(Math.abs(fig.ratio / x.ratio - 1) < 2e-6));
			b.addEventListener("click", function () {
				var alt = resonantComAlt(state.params[HANGING], figs[PHOBOS] || null, x.ratio, { elevator: figs[ELEVATOR] || null });
				if (alt != null) { state.params[HANGING].comAlt = alt; refresh(); }
			});
		});
		if (!fig.resonances.length) { r.resList.appendChild(el("span", "mst-muted", "none between this foot and top")); }
	}
	r.guide.textContent = ph.ok ? guidanceText(fig) : "The Phobos skyhook is not in the design.";

	// The space elevator's tether: where it stands at these heights, and the timing against it.
	var meets = ev.ok && !!fig.shareElevator, sh = fig.shareElevator;
	r.evShare.textContent = !ev.ok ? "not in the design" : meets
		? num(sh.latLo * DEG, 1) + "° to " + num(sh.latHi * DEG, 1) + "° " + (ev.side > 0 ? "N" : "S") : "out of this tether's reach";
	r.evRatio.textContent = num(fig.dayRatio, 4);
	r.evGapNow.textContent = meets ? km(elevatorDistance(fig, ev, fig.timing, jd)) : "—";
	var evNear = meets ? closestPass(fig, { elevator: ev }, fig.timing, jd, jd + 5, state.limit) : null;
	r.evClosest.textContent = evNear ? km(evNear.distance) + (evNear.distance < state.limit ? " · too close" : "") : "—";
	r.evClosest.classList.toggle("mst-warn", !!evNear && evNear.distance < state.limit);
	var dayKey = fig.dayResonances.map(function (x) { return x.p + "/" + x.q + "@" + Math.round(x.comAlt); }).join(",") + "|" + Math.round(fig.comAlt);
	if (dayKey !== hangCard.dayKey) {
		hangCard.dayKey = dayKey;
		r.dayList.textContent = "";
		fig.dayResonances.forEach(function (x) {
			var b = r.dayList.appendChild(el("button", "mst-res", (x.q === 1 ? x.p + " a day" : x.p + " in " + x.q + " days") + " · " + num(x.comAlt / 1e3) + " km"));
			b.type = "button";
			b.setAttribute("aria-pressed", String(Math.abs(fig.dayRatio / x.ratio - 1) < 2e-6));
			b.addEventListener("click", function () {
				var alt = resonantComAlt(state.params[HANGING], figs[PHOBOS] || null, x.ratio, { elevator: figs[ELEVATOR] || null, mars: true });
				if (alt != null) { state.params[HANGING].comAlt = alt; refresh(); }
			});
		});
		if (!fig.dayResonances.length) { r.dayList.appendChild(el("span", "mst-muted", "none between this foot and top")); }
	}
	r.evGuide.textContent = elevatorGuidanceText(fig);

	var g = timingGuidance(fig, RATIOS, state.limit);
	r.faster.textContent = g.faster > 1e-5 ? pct(g.faster) : "cannot";
	r.slower.textContent = g.slower > 1e-5 ? pct(g.slower) : "cannot";
	var slip = at.slip;
	r.ballastNow.textContent = slip.active && slip.travel > 0
		? (slip.step.resp.which === "upper" ? "upper " : "") + km(slip.travel) + " from home · orbit " + km(Math.abs(slip.shift)) + (slip.shift < 0 ? " lower" : " higher")
		: (slip.active ? "at home, setting out" : "at home");
	r.status.textContent = scheduleText(fig);

	var i = shownSidestep(jd);
	r.stepBox.hidden = i < 0;
	if (i < 0) { return; }
	var st = schedule.sidesteps[i], homeAlt = st.resp.rHome - R_MARS, toAlt = st.rTo - R_MARS;
	r.stepHead.textContent = "Sidestep " + (i + 1) + " of " + schedule.sidesteps.length + " · ballast leaves home "
		+ dateTime(st.jdStart) + (jd >= st.jdStart && jd <= st.jdEnd ? " · under way" : "");
	r.stepAvoids.textContent = AGAINST[st.avoids.against] + ", " + km(st.avoids.distance) + " away on " + shortDate(st.avoids.jd);
	r.stepSlip.textContent = num(Math.abs(st.psi) * DEG) + "° " + (st.psi > 0 ? "ahead" : "back") + " round its orbit";
	r.stepMove.textContent = (st.resp.which === "upper" ? "upper, " : "") + num(st.resp.mass / 1e6) + " kt, " + num(homeAlt / 1e3) + " → " + num(toAlt / 1e3) + " km";
	r.stepTimes.textContent = span(st.tMove) + " · " + span(st.tHold) + " · " + span(st.tMove);
	// The drive's work going out comes back, sign reversed, on the way home.
	var gwh = Math.abs(st.work) / 3.6e12;
	r.stepEnergy.previousSibling.textContent = st.work >= 0 ? "Energy to take the ballast out (returned coming home)"
		: "Energy to bring the ballast home (gained going out)";
	r.stepEnergy.textContent = num(gwh, gwh < 10 ? 1 : 0) + " GWh";
	r.stepPower.textContent = num(st.peakPower / 1e9, 1) + " GW";
	r.stepOrbit.textContent = km(Math.abs(st.shift)) + (st.shift < 0 ? " lower, " : " higher, ") + pct(st.rate) + (st.rate > 0 ? " faster" : " slower");
	r.stepFoot.textContent = km(fig.footAlt + st.shift) + " · " + km(fig.topAlt + st.shift);
	r.stepBoost.textContent = "none: the orbit returns with the ballast";
	r.stepUntil.textContent = st.clearUntil ? shortDate(st.clearUntil) : "past " + shortDate(schedule.jdReached);
}

// ---- marks on the date sliders ------------------------------------------------------------
// What is timed between two days of the clock, as bars in a strip under a
// slider. Upper row: the hanging skyhook's sidesteps, and the close passes
// the ballast cannot avoid. Lower row: the space elevator's spells of dodging
// Deimos, from the first load timing to the swing at rest again, with a tick
// at each crossing dodged.
function drawMarks(strip, loDay, hiDay) {
	strip.textContent = "";
	function bar(jdA, jdB, cls, title) {
		var a = jdA - CLOCK_EPOCH, b = jdB - CLOCK_EPOCH;
		if (b < loDay || a > hiDay) { return; }
		var m = strip.appendChild(el("div", "mst-mark " + cls));
		m.style.left = (Math.max(0, a - loDay) / (hiDay - loDay) * 100) + "%";
		m.style.width = ((Math.min(hiDay, b) - Math.max(loDay, a)) / (hiDay - loDay) * 100) + "%";
		m.title = title;
	}
	if (schedule && state.included[HANGING]) {
		schedule.sidesteps.forEach(function (st) { bar(st.jdStart, st.jdEnd, "mst-mark-step", "Sidestep, avoiding " + AGAINST[st.avoids.against] + ": " + dateTime(st.jdStart)); });
		schedule.unavoided.forEach(function (u) { bar(u.jd, u.jdLast, "mst-mark-close", "Close passes of " + AGAINST[u.against] + " the ballast cannot avoid"); });
	}
	var ev = figs[ELEVATOR];
	if (ev && ev.ok && ev.dodges) {
		ev.dodges.spells.forEach(function (sp) {
			bar(sp.jdStart, sp.jdEnd, "mst-mark-dodge", "Deimos dodge: load timing from " + dateTime(sp.jdStart));
			sp.passes.forEach(function (ps) { bar(ps.jd, ps.jd, "mst-mark-cross", "Deimos crosses the tether's line: " + dateTime(ps.jd)); });
		});
	}
}
function syncCards() {
	hookCard.el.classList.toggle("mst-open", !!state.open[PHOBOS]);
	hangCard.el.classList.toggle("mst-open", !!state.open[HANGING]);
	elevCard.el.classList.toggle("mst-open", !!state.open[ELEVATOR]);
}

// ---- the space elevator's card ------------------------------------------------------------
var elevCard = null;
function northSouth(m, zero) { return Math.abs(m) < 500 ? (zero || "on the tether") : km(Math.abs(m)) + (m > 0 ? " north" : " south"); }
function tonnes(kg) { return kg >= 1e6 ? num(kg / 1e6, kg < 1e7 ? 1 : 0) + " kt" : num(kg / 1e3) + " t"; }
function meganewtons(n) { return num(n / 1e6, 1) + " MN"; }
function buildElevatorCard() {
	var c = cardShell(FACILITIES[ELEVATOR].label, "One tether from an anchor off the equator, passing above Phobos and dodging Deimos"), r = {};
	var P = state.params[ELEVATOR];
	c.head.addEventListener("click", function () { state.open[ELEVATOR] = !state.open[ELEVATOR]; syncCards(); });
	function set(key, scale) {
		return function (v) { if (isFinite(v)) { P[key] = v * scale; refresh(); } };
	}
	var inRow = c.body.appendChild(el("div", "mst-row"));
	r.included = checkBox(inRow, "mst-elev-in", "In the design", function (on) { state.included[ELEVATOR] = on; refresh(); });

	var a1 = c.body.appendChild(el("div", "mst-fieldpair"));
	r.lat = numberField(a1, "mst-elev-lat", "Anchor latitude (° N)", set("lat", 1));
	r.lon = numberField(a1, "mst-elev-lon", "Longitude (° E)", set("lon", 1));
	var a2 = c.body.appendChild(el("div", "mst-fieldpair"));
	var mf = a2.appendChild(el("div", "mst-field mst-field-wide")), ml = mf.appendChild(el("label", null, "Cable"));
	ml.htmlFor = "mst-elev-material";
	r.material = mf.appendChild(el("select"));
	r.material.id = "mst-elev-material";
	Object.keys(ELEVATOR_MATERIALS).forEach(function (k) { r.material.appendChild(el("option", null, ELEVATOR_MATERIALS[k].label)).value = k; });
	// A change of cable keeps the safety factor where the new cable allows it.
	r.material.addEventListener("change", function () {
		var range = ELEVATOR_MATERIALS[r.material.value].safety;
		P.material = r.material.value;
		if (isFinite(P.safety)) { P.safety = Math.max(range[0], Math.min(range[1], P.safety)); }
		refresh();
	});
	r.safety = numberField(a2, "mst-elev-safety", "Safety factor", set("safety", 1));
	r.safety.step = "0.1";
	r.safetyLabel = r.safety.previousSibling;
	var a3 = c.body.appendChild(el("div", "mst-fieldpair"));
	r.rcw = numberField(a3, "mst-elev-rcw", "Counterweight at (km)", set("rCW", 1e3));
	r.mass = numberField(a3, "mst-elev-mass", "Its mass (kt)", function (v) { P.cwMass = isFinite(v) && v > 0 ? v * 1e6 : null; refresh(); });
	var a4 = c.body.appendChild(el("div", "mst-fieldpair mst-tilt-line"));
	r.flowIn = numberField(a4, "mst-elev-flow", "Cargo flow up (kg/s)", set("cargoFlow", 1));
	r.flowIn.min = 0;
	r.flowYear = a4.appendChild(el("div", "mst-field mst-muted mst-flow-year"));
	r.error = c.body.appendChild(el("div", "mst-error"));
	c.body.appendChild(el("div", "mst-muted", "The anchor starts at the summit of Olympus Mons; the ground's own height is left out. The counterweight's distance is from Mars's centre. Leave its mass empty for the one that holds the cable and its track up three times over."));

	var ro = c.body.appendChild(el("div", "mst-readouts"));
	r.length = readout(ro, "Tether length");
	r.peak = readout(ro, "Peak tension");
	r.hold = readout(ro, "Tension at the anchor · at the counterweight");
	r.cable = readout(ro, "Cable · its track");
	r.cw = readout(ro, "Counterweight");
	r.depart = readout(ro, "Leaves the anchor at");
	r.cwOff = readout(ro, "Counterweight off the equatorial plane");
	r.release = readout(ro, "A ship let go at the counterweight");

	c.body.appendChild(el("div", "mst-subhead", "With the cargo aboard"));
	var lr = c.body.appendChild(el("div", "mst-readouts"));
	r.leanAnchor = readout(lr, "Lean where it leaves the anchor");
	r.leanElev = readout(lr, "Leaves the anchor at, loaded");
	r.leanPhobos = readout(lr, "West of the anchor's meridian, at Phobos's distance");
	r.leanDeimos = readout(lr, "At Deimos's distance");
	r.leanCW = readout(lr, "At the counterweight");
	r.leanSide = readout(lr, "Sideways pull on the anchor");
	r.leanHold = readout(lr, "Tension at the anchor with the cargo aboard");
	r.leanCargo = readout(lr, "Cargo on the tether at once");
	r.leanPeak = readout(lr, "Peak tension, loaded");
	r.leanLimit = readout(lr, "Most flow this tether carries");
	r.leanNote = c.body.appendChild(el("div", "mst-guide"));
	c.body.appendChild(el("div", "mst-muted", "Cargo climbing the tether is brought up to the speed of the ground beneath it, and the tether does that by pushing it east; the cargo pushes the tether west in return. The tether stands nearly as a turn of the whole of it about Mars's axis, west of its anchor's meridian, held by the sideways part of the tension at the anchor. The cargo's weight also bows the bottom of the tether down toward the ground; by the most flow the two together have brought it down nearly to the ground. Worked out in full in three dimensions, the counterweight held at its distance. Everything below is with the cargo aboard: the drawing, Phobos's clearance, Deimos's crossings and the hanging skyhook's passes. Climbers at "
		+ num(TRAFFIC.vFull) + " m/s; the flow is net, up less down."));

	c.body.appendChild(el("div", "mst-subhead", "Keeping clear of Phobos"));
	var pr = c.body.appendChild(el("div", "mst-readouts"));
	r.zPhobos = readout(pr, "Off the plane at Phobos's distance");
	r.phClear = readout(pr, "Passes Phobos's reach by");
	r.cap = readout(pr, "A tether rising from Phobos may reach");
	c.body.appendChild(el("div", "mst-muted", "Phobos's orbit is tilted 1.08° to the equator, so a tether built on it sweeps farther from the equatorial plane the farther out it reaches. Its top is held short of where it would come within "
		+ num(KEEP_CLEAR / 1e3) + " km of this tether; the red marker on the Phobos tether's line shows that limit."));

	c.body.appendChild(el("div", "mst-subhead", "Dodging Deimos"));
	var dr = c.body.appendChild(el("div", "mst-readouts"));
	r.zDeimos = readout(dr, "Off the plane at Deimos's distance");
	r.count = readout(dr, "Crossings to " + shortDate(CLOCK_EPOCH + SPAN_DAYS) + " · dodged");
	r.swing = readout(dr, "The dodge swing");
	r.now = readout(dr, "The swing now");
	r.closest = readout(dr, "Nearest Deimos comes, with the dodges");
	var act = c.body.appendChild(el("div", "mst-row mst-work-row"));
	r.prev = act.appendChild(el("button", "mst-action mst-action-small", "◂ Previous dodge"));
	r.next = act.appendChild(el("button", "mst-action mst-action-small", "Next dodge ▸"));
	r.prev.type = "button"; r.next.type = "button";
	r.prev.title = "Move the date to the crossing dodged before"; r.next.title = "Move the date to the next crossing dodged";
	r.prev.addEventListener("click", function () { jumpDodge(-1); });
	r.next.addEventListener("click", function () { jumpDodge(1); });
	r.status = c.body.appendChild(el("div", "mst-guide"));
	r.stepBox = c.body.appendChild(el("div", "mst-readouts mst-step"));
	r.stepHead = r.stepBox.appendChild(el("div", "mst-step-head"));
	r.stepMiss = readout(r.stepBox, "Left alone, Deimos would pass");
	r.stepSwing = readout(r.stepBox, "The tether stands, as it crosses");
	r.stepActual = readout(r.stepBox, "So Deimos passes the tether by");
	r.stepStart = readout(r.stepBox, "Climber load timing starts");
	r.stepEnd = readout(r.stepBox, "The swing is at rest again");

	c.body.appendChild(el("div", "mst-subhead", "Pumping the swing with climbers"));
	var tr = c.body.appendChild(el("div", "mst-readouts"));
	r.stretch = readout(tr, "Stretch, above the anchor");
	r.load = readout(tr, "Cargo held on it, half of each swing");
	r.build = readout(tr, "Build-up");
	r.flow = readout(tr, "Cargo flow that keeps it there");
	r.energy = readout(tr, "Energy in the full swing");
	c.body.appendChild(el("div", "mst-muted", "Cargo on the slanted stretch (blue on the tether) pulls partly across it. Climbers are slowed there to "
		+ num(TRAFFIC.vSlow) + " m/s for half of each swing and pass at " + num(TRAFFIC.vFull)
		+ " m/s for the other half, which pumps the swing the way shifting weight pumps a playground swing; reversed, the same timing brings it to rest. The climbers' motors supply the energy and no propellant is used."));
	elevCard = { el: c.el, refs: r, badge: c.badge };
}
// The hazard crossings inside the clock's span, in order.
function dodgedCrossings(ev) {
	if (!(ev && ev.ok && ev.dodges)) { return []; }
	return ev.dodges.passes.filter(function (ps) { return ps.hazard && ps.jd >= CLOCK_EPOCH && ps.jd <= CLOCK_EPOCH + SPAN_DAYS; });
}
// Move the date to the crossing dodged before (-1) or after (+1) the scene's instant.
function jumpDodge(dir) {
	var list = dodgedCrossings(figs[ELEVATOR]), jd = sceneJd(), pick = null;
	list.forEach(function (ps) {
		if (dir > 0 ? (ps.jd > jd + 1e-6 && !pick) : ps.jd < jd - 1e-6) { pick = ps; }
	});
	if (!pick) { return; }
	state.relFrac = 0; state.flightFrac = 0; relSlider.value = 0; flightSlider.value = 0;
	dateBar.setJd(pick.jd);
	refresh();
}
function fillElevatorCard() {
	var r = elevCard.refs, P = state.params[ELEVATOR], fig = figs[ELEVATOR], on = !!state.included[ELEVATOR];
	var ok = !!(fig && fig.ok), code = fig && !fig.ok ? fig.diagnostic.code : "";
	var range = (ELEVATOR_MATERIALS[P.material] || ELEVATOR_MATERIALS.ecnt).safety;
	r.included.checked = on;
	elevCard.el.classList.toggle("mst-card-off", !on);
	show(r.lat, String(P.lat)); show(r.lon, String(P.lon)); show(r.safety, String(P.safety));
	show(r.rcw, kmField(P.rCW)); show(r.mass, P.cwMass == null ? "" : String(Math.round(P.cwMass / 1e3) / 1e3));
	show(r.flowIn, String(P.cargoFlow));
	r.flowYear.textContent = isFinite(P.cargoFlow) ? num(P.cargoFlow * 365.25 * DAY / 1e6, P.cargoFlow < 10 ? 1 : 0) + " kt a year · " + num(P.cargoFlow * 86.4, 0) + " t a day" : "";
	r.mass.placeholder = ok && P.cwMass == null ? num(fig.cwMass / 1e6, 1).replace(/,/g, "") : "";
	r.material.value = P.material;
	r.safety.min = range[0]; r.safety.max = range[1];
	r.safetyLabel.textContent = "Safety factor (" + range[0] + " to " + range[1] + ")";
	r.error.textContent = fig && !fig.ok ? fig.diagnostic.message : "";
	r.lat.classList.toggle("mst-bad", code === "lat-range" || code === "phobos");
	r.lon.classList.toggle("mst-bad", code === "lon-range");
	r.safety.classList.toggle("mst-bad", code === "safety-range" || code === "phobos");
	r.rcw.classList.toggle("mst-bad", code === "cw-range" || code === "no-landing");
	r.mass.classList.toggle("mst-bad", code === "mass-range");
	r.flowIn.classList.toggle("mst-bad", code === "flow-range" || code === "flow-limit");
	var all = [r.length, r.peak, r.hold, r.cable, r.cw, r.depart, r.cwOff, r.release, r.zPhobos, r.phClear, r.cap,
	           r.leanAnchor, r.leanElev, r.leanPhobos, r.leanDeimos, r.leanCW, r.leanSide, r.leanHold, r.leanCargo, r.leanPeak, r.leanLimit,
	           r.zDeimos, r.count, r.swing, r.now, r.closest, r.stretch, r.load, r.build, r.flow, r.energy];
	var list = dodgedCrossings(fig);
	r.prev.disabled = r.next.disabled = !list.length;
	if (!ok) {
		all.forEach(function (x) { x.textContent = "—"; });
		r.status.textContent = ""; r.stepBox.hidden = true; r.leanNote.textContent = "";
		return;
	}
	var L = fig.lean;
	function westText(w) { return w ? num(w.angle * DEG, w.angle * DEG < 10 ? 2 : 1) + "° · " + km(w.distance) : "—"; }
	r.leanAnchor.textContent = num(L.angle * DEG, 1) + "° west of the meridian";
	r.leanPhobos.textContent = westText(L.atPhobos);
	r.leanDeimos.textContent = L.atDeimos ? westText(L.atDeimos) : "ends short of Deimos";
	r.leanCW.textContent = westText(L.atCW);
	r.leanSide.textContent = meganewtons(L.side);
	r.leanHold.textContent = meganewtons(L.T0) + (L.flow > 0 ? " (" + meganewtons(fig.T0) + " empty)" : "");
	r.leanCargo.textContent = tonnes(L.cargo);
	r.leanElev.textContent = num(L.elevation * DEG, 1) + "° above level (" + num(fig.departure * DEG, 1) + "° empty)";
	r.leanPeak.textContent = meganewtons(L.Tpeak) + " · " + num(L.Tpeak / fig.Tpeak * 100, 1) + "% of its working stress";
	r.leanLimit.textContent = "about " + num(Math.floor(L.most)) + " kg/s · " + num(L.most * 365.25 * DAY / 1e9, 2) + " Mt a year · "
		+ (L.mostBy === "phobos" ? "then too near Phobos" : "then down to " + num(L.mostElevation * DEG, 1) + "° at the anchor");
	var low = L.elevation < L.floor;
	r.leanNote.textContent = low ? "The cargo draws the bottom of the tether down below the " + num(L.floor * DEG) + "° above level the empty tether is sized to leave its anchor at. A heavier counterweight or a stronger cable holds it up." : "";
	r.leanElev.classList.toggle("mst-warn", low);
	var jd = sceneJd(), away = fig.side > 0 ? " north" : " south";
	r.length.textContent = km(fig.length);
	r.peak.textContent = meganewtons(fig.Tpeak) + ", " + km(fig.rPeak - R_MARS) + " up";
	r.hold.textContent = meganewtons(fig.T0) + " · " + meganewtons(fig.Tcw);
	r.cable.textContent = tonnes(fig.cableMass) + " · " + tonnes(fig.trackMass);
	r.cw.textContent = tonnes(fig.cwMass) + " · holds " + num(fig.mult, 2) + "×"
		+ (fig.raised === "departure" ? " · raised so the tether leaves the ground 10° up" : fig.raised === "multiple" ? " · raised to hold 1.5×" : "");
	r.depart.textContent = num(fig.departure * DEG, 1) + "° above level";
	r.cwOff.textContent = km(fig.zCW) + away;
	r.release.textContent = fig.release.bound ? "orbits Mars out to " + km(fig.release.rApo - R_MARS)
		: "leaves Mars with " + num(fig.release.vInf / 1e3, 2) + " km/s";
	r.zPhobos.textContent = km(fig.zPhobos) + away;
	r.phClear.textContent = km(fig.phobosClear);
	r.cap.textContent = fig.phobosTopCap != null && fig.phobosTopCap < FACILITIES_TOP_MAX
		? num(Math.floor(fig.phobosTopCap / 1e3)) + " km altitude" : "as far as Deimos allows";

	if (!fig.dodges) {
		[r.count, r.swing, r.now, r.closest, r.stretch, r.load, r.build, r.flow, r.energy].forEach(function (x) { x.textContent = "—"; });
		r.zDeimos.textContent = "ends short of Deimos";
		r.status.textContent = "The tether ends inside Deimos's orbit, so Deimos never meets it and nothing needs dodging.";
		r.stepBox.hidden = true;
		return;
	}
	var d = fig.dodges, sw = elevatorAt(fig, jd).swing, pm = fig.pumping;
	var inSpan = d.passes.filter(function (ps) { return ps.jd >= CLOCK_EPOCH && ps.jd <= CLOCK_EPOCH + SPAN_DAYS; });
	r.zDeimos.textContent = km(fig.zDeimos) + away;
	r.count.textContent = num(inSpan.length) + " · " + num(list.length);
	r.swing.textContent = km(DODGE.swing) + " there · " + km(fig.swing.atPhobos) + " at Phobos's distance · every " + num(fig.swing.period / 3600, 1) + " h";
	r.now.textContent = sw.size < 500 ? "at rest"
		: (sw.size > 0.98 * DODGE.swing ? "full" : sw.trend > 0 ? "building up" : sw.trend < 0 ? "dying down" : "held") + " · " + km(sw.size) + " · tether " + northSouth(sw.d, "at its rest line");
	var worst = inSpan.reduce(function (a, ps) { return !a || Math.abs(ps.actual) < Math.abs(a.actual) ? ps : a; }, null);
	r.closest.textContent = worst ? km(Math.abs(worst.actual)) + " · " + shortDate(worst.jd) : "—";
	r.closest.classList.toggle("mst-warn", !!worst && Math.abs(worst.actual) < DODGE.band / 2 - 1);
	r.status.textContent = list.length
		? "A crossing is dodged when Deimos would pass within " + num(DODGE.band / 2e3) + " km of the tether: " + list.length + " of its " + inSpan.length
			+ " crossings to " + shortDate(CLOCK_EPOCH + SPAN_DAYS) + ", marked in blue under the date sliders."
		: "No crossing in the date span brings Deimos within " + num(DODGE.band / 2e3) + " km of the tether.";

	r.stretch.textContent = num(TRAFFIC.from / 1e3) + " to " + km(TRAFFIC.to) + " · " + km(pm.length) + " of tether";
	r.load.textContent = tonnes(pm.dmOnOff);
	r.build.textContent = TRAFFIC.cycles + " swings · " + span(TRAFFIC.cycles * fig.swing.period);
	r.flow.textContent = num(pm.flowSlow * 3.6) + " t/h slowed · " + num(pm.flowFull * 3.6) + " t/h at full speed";
	r.energy.textContent = num(fig.swing.energy / 1e9, 1) + " GJ";

	// The crossing dodged at or after the date shown, else the last one.
	var i = -1;
	for (var k = 0; k < list.length; k++) { if (list[k].jd >= jd - 1e-6) { i = k; break; } }
	if (i < 0) { i = list.length - 1; }
	r.stepBox.hidden = i < 0;
	if (i < 0) { return; }
	var ps = list[i], spell = d.spells.filter(function (sp) { return sp.passes.indexOf(ps) >= 0; })[0];
	r.stepHead.textContent = "Dodge " + (i + 1) + " of " + list.length + " · Deimos crosses " + dateTime(ps.jd)
		+ (jd >= spell.jdStart && jd <= spell.jdEnd ? " · swing under way" : "");
	r.stepMiss.textContent = northSouth(ps.miss) + (Math.abs(ps.miss) < 500 ? "" : " of the tether");
	r.stepSwing.textContent = northSouth(ps.swing, "at its rest line") + (Math.abs(ps.swing) < 500 ? "" : " of its rest line");
	r.stepActual.textContent = km(Math.abs(ps.actual));
	r.stepStart.textContent = dateTime(spell.jdStart);
	r.stepEnd.textContent = dateTime(spell.jdEnd) + (spell.passes.length > 1 ? " · " + spell.passes.length + " crossings in this spell" : "");
}

// The System card: the figures that do not change with the date, then those that do.
var sysRefs = {};
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
	readout(box, "Mars's sphere of influence", km(SOI_MARS));
	box.appendChild(el("div", "mst-subhead", "At the time shown"));
	sysRefs.season = readout(box, "Season");
	sysRefs.sun = readout(box, "Sun overhead at");
	["Phobos", "Deimos"].forEach(function (name) {
		sysRefs[name + "Alt"] = readout(box, name + " altitude");
		sysRefs[name + "Over"] = readout(box, name + " over");
	});
	sysRefs.deimosTilt = readout(box, "Deimos's orbit: tilt to the equator");
}
function fillSystemCard(jd) {
	var sea = ME.season(jd), ls = sea.ls * DEG;
	sysRefs.season.textContent = "Ls " + num(ls, 1) + "° · " + SEASONS[Math.floor(ls / 90) % 4];
	sysRefs.sun.textContent = latText(sea.sunLat);
	["Phobos", "Deimos"].forEach(function (name) {
		var s = ME.moonState(name, jd), g = ME.groundPoint(s.r, jd);
		sysRefs[name + "Alt"].textContent = km(g.radius - R_MARS);
		sysRefs[name + "Over"].textContent = latText(g.lat) + ", " + lonText(g.lon);
	});
	var de = ME.moonState("Deimos", jd);
	sysRefs.deimosTilt.textContent = num(Math.acos(Math.max(-1, Math.min(1, O.vDot(de.normal, ME.pole)))) * DEG, 2)
		+ "° (0.9° to 2.7° over 56 yr)";
}

// ---- key figures under the view --------------------------------------------------------
function key(label, value) {
	var k = keysEl.appendChild(el("div", "mst-key"));
	k.appendChild(el("span", "mst-key-label", label));
	k.appendChild(el("span", "mst-key-val", value));
}
// The ship's altitude and speed are read at the Flight slider's instant. Its
// speed, and an entry's speed and angle, are against the stars, or as the
// ground sees them when the box beside the figures is ticked.
function fillKeys() {
	keysEl.textContent = "";
	if (!flight || !flight.ok) {
		keysEl.appendChild(el("div", "mst-key-error", flight ? flight.diagnostic.message : ""));
		return;
	}
	var s = flight.summary, tilt = num(s.tilt * DEG, 2) + "°", ground = groundSpeed.checked;
	var now = flightStateAt(flight, flightSeconds());
	key("Ship altitude", km(O.vMag(now.r) - R_MARS));
	key("Ship speed", speed(O.vMag(ground ? groundRelative(now.r, now.v, now.jde) : now.v)));
	// Bound for the other skyhook: how the ship's closest pass to that tether goes.
	if (flight.toFig) {
		var a = flight.arrival, name = FACILITIES[flight.to].label;
		key("Closest pass to the " + name + " after", span(a.t));
		key("Passes the tether by", a.met ? "meets it" : distText(a.miss));
		key("At", km(a.altitude) + " up the tether");
		key("Relative motion", speed(a.trim));
		key("Caught", a.caught ? "yes" : "no");
		return;
	}
	if (s.outcome === "entry") {
		key("Reaches the air (" + num(ENTRY_ALT / 1e3) + " km) after", span(s.duration));
		key("Speed there", speed(ground ? s.entryAirSpeed : s.entrySpeed));
		key("Descending at", num((ground ? s.entryAirAngle : s.entryAngle) * DEG, 1) + "° below level");
	} else if (s.outcome === "orbit") {
		key("Orbit of Mars", km(s.periAlt) + " × " + km(s.apoAlt));
		key("Period", s.period < 2 * DAY ? hours(s.period) : span(s.period));
		key("Tilt to the equator", tilt);
	} else {
		key("Leaves Mars with", speed(s.vInf));
		key("At the sphere of influence after", span(s.duration));
		key("Lowest point", km(s.periAlt));
		key("Tilt to the equator", tilt);
	}
}

// ---- refresh ----------------------------------------------------------------------------
// opts.sceneOnly: only the scene's instant changed (the Flight slider), so the
// flight itself stands. opts.fromSlider: the id of the skyhook whose
// release-point slider is being dragged; that slider keeps its own position.
function refresh(opts) {
	opts = opts || {};
	if (!opts.sceneOnly) {
		computeFigures();
		if (!figs[state.from]) { state.from = SKYHOOKS.filter(function (id) { return !!figs[id]; })[0] || state.from; }
		if (state.to !== SURFACE && (!figs[state.to] || state.to === state.from)) { state.to = SURFACE; }
		syncFlightCard();
		flight = figs[state.from] ? computeFlight({ from: state.from, to: state.to, jd: releaseJd(), params: designParams() })
			: { ok: false, diagnostic: { code: "no-skyhook", message: "No skyhook is in the design, so there is nothing to let a ship go from.", values: {} } };
		overlay.drawFlight(flight, state.view, showTraj.checked);
	}
	var jd = sceneJd(), t = flightSeconds();
	frame.setShown({ orbits: showOrbits.checked, grid: showGrid.checked });
	frame.place(jd, state.view);
	SKYHOOKS.forEach(function (id) { overlay.drawSkyhook(id, figs[id], jd, state.view, showFac.checked, id === state.from); });
	overlay.drawElevator(figs[ELEVATOR], jd, state.view, showFac.checked);
	// The whole-span marks stand until the sidesteps or the elevator's dodges change.
	var dodges = figs[ELEVATOR] && figs[ELEVATOR].ok ? figs[ELEVATOR].dodges : null;
	if (marksFor.schedule !== schedule || marksFor.dodges !== dodges || marksFor.hanging !== !!state.included[HANGING]) {
		marksFor = { schedule: schedule, dodges: dodges, hanging: !!state.included[HANGING] };
		drawMarks($("mst-marks-coarse"), 0, SPAN_DAYS);
	}
	fillFlightNote();
	overlay.placeShip(flight, t, state.view, showTraj.checked);
	fillKeys();
	fillSystemCard(jd);
	fillSkyhookCard(opts);
	fillHangingCard(opts);
	fillElevatorCard();
	var half = parseFloat($("mst-date-fine").max);
	drawMarks($("mst-marks-fine"), state.baseDays - half, state.baseDays + half);

	var fig = figs[state.from];
	relVal.textContent = clockTime(releaseJd()) + (fig && fig.ok ? " · one orbit " + num(fig.period / 3600, 2) + " h" : "");
	flightVal.textContent = "T+ " + span(t) + " · " + shortDate(jd) + " " + clockTime(jd);
}
// The Flight card's lists: From holds the skyhooks in the design, To the
// surface and every skyhook that is not the departure.
var fromSelect = $("mst-from"), toSelect = $("mst-to"), showPass = $("mst-show-pass");
function fillList(select, items, value) {
	var key = items.map(function (x) { return x[0]; }).join(",");
	if (select.dataset.key !== key) {
		select.dataset.key = key;
		select.textContent = "";
		items.forEach(function (x) { select.appendChild(el("option", null, x[1])).value = x[0]; });
	}
	select.value = value;
}
function syncFlightCard() {
	var have = SKYHOOKS.filter(function (id) { return !!figs[id]; });
	fillList(fromSelect, have.map(function (id) { return [id, FACILITIES[id].label]; }), state.from);
	fillList(toSelect, [[SURFACE, "The surface"]].concat(have.filter(function (id) { return id !== state.from; })
		.map(function (id) { return [id, FACILITIES[id].label]; })), state.to);
}
// The flight in a sentence, under the lists.
function fillFlightNote() {
	var note = $("mst-flight-note"), a = flight && flight.ok ? flight.arrival : null;
	showPass.disabled = !(a && a.found);
	showPass.style.display = state.to === SURFACE ? "none" : "";
	if (!flight || !flight.ok) { note.textContent = flight ? flight.diagnostic.message : ""; return; }
	var s = flight.summary;
	if (state.to === SURFACE) {
		note.textContent = s.outcome === "entry"
			? "Reaches the air after " + span(s.duration) + ", at " + speed(s.entryAirSpeed) + " against the air and " + num(s.entryAirAngle * DEG, 1) + "° below level."
			: "Let go here, the ship does not come down: it " + (s.outcome === "orbit" ? "stays in orbit, no lower than " + km(s.periAlt) : "leaves Mars")
				+ ". Lower the release point, or change the release time.";
		return;
	}
	var name = FACILITIES[state.to].label;
	note.textContent = a.caught ? "Caught by the " + name + " after " + span(a.t) + ", " + km(a.altitude) + " up its tether, at " + speed(a.trim) + " relative to it."
		: "Closest pass to the " + name + " after " + span(a.t) + ": " + (a.met ? "it meets the tether " : distText(a.miss) + " from the tether, ")
			+ km(a.altitude) + " up" + (a.blocked ? ", with Mars between them" : "") + ", at " + speed(a.trim) + " relative to it. Not caught. Move the release time, the release point or the date to bring them together.";
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
	buildSkyhookCard();
	buildHangingCard();
	buildElevatorCard();
	// The Phobos skyhook starts with its top as high as the elevator allows, where that is under its own default.
	var cap = allFigures(designParams())[ELEVATOR].phobosTopCap;
	if (cap != null && cap < state.params[PHOBOS].topAlt) { state.params[PHOBOS].topAlt = Math.floor(cap / 100e3) * 100e3; }
	// The hanging skyhook starts on its 3:1 resonance with Phobos, to the metre.
	var start = allFigures(designParams());
	var onResonance = resonantComAlt(state.params[HANGING], start[PHOBOS] || null, 3, { elevator: start[ELEVATOR] || null });
	if (onResonance != null) { state.params[HANGING].comAlt = onResonance; }
	STUBS.forEach(function (s) { cardShell(s.label, s.sub, true); });
	syncCards();
	VIEW_FRAMES.forEach(function (v) {
		var b = $("mst-frames").appendChild(el("button", null, v.label));
		b.type = "button"; b.dataset.frame = v.id;
		b.title = "Hold the view still against this";
	});

	dateBar.setBaseDays(START_DAYS);
	dateBar.bind(function () { refresh(); });

	function releaseMoved() { state.relFrac = parseFloat(relSlider.value); refresh(); }
	function flightMoved() { state.flightFrac = parseFloat(flightSlider.value); refresh({ sceneOnly: true }); }
	// Choosing the destination as the departure swaps the two.
	fromSelect.addEventListener("change", function () {
		var was = state.from;
		state.from = fromSelect.value;
		if (state.to === state.from) { state.to = was; }
		refresh();
	});
	toSelect.addEventListener("change", function () { state.to = toSelect.value; refresh(); });
	showPass.addEventListener("click", function () {
		var a = flight && flight.ok ? flight.arrival : null;
		if (!(a && a.found)) { return; }
		state.flightFrac = a.t / flight.leg.duration; flightSlider.value = state.flightFrac;
		refresh({ sceneOnly: true });
	});
	relSlider.addEventListener("input", releaseMoved);
	flightSlider.addEventListener("input", flightMoved);
	bindFineDrag(relSlider, releaseMoved, null, SLOW_DRAG);
	bindFineDrag(flightSlider, flightMoved, null, SLOW_DRAG);

	$("mst-pov").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-pov]");
		if (btn) { setPov(btn.dataset.pov); }
	});
	$("mst-frames").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-frame]");
		if (btn) { setView(btn.dataset.frame); }
	});
	groundSpeed.addEventListener("change", fillKeys);
	[showOrbits, showGrid, showFac, showTraj].forEach(function (box) {
		box.addEventListener("change", function () { refresh(); });
	});

	if (window.ResizeObserver) { new ResizeObserver(resize).observe(holder); }
	window.addEventListener("resize", resize);
	resize();

	refresh();
	setPov("system");
	animate();
}

init();
