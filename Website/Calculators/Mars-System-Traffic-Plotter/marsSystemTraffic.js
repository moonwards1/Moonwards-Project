/* Mars System Traffic Plotter — ES module
 *
 * A to-scale 3-D view of the Mars system on a clock: Mars turning, Phobos and
 * Deimos on their orbits, the Sun, the system's transport facilities and the
 * path of a ship let go by one of them. The facilities are the Phobos skyhook,
 * a hanging skyhook, a space elevator and a surface mass driver.
 *
 * Built so far: the scene and its clock, the three views (fixed to the stars,
 * turning with Mars, turning with Phobos), the POV buttons and click-to-follow;
 * the Phobos skyhook, with a release from any point of its tether flown to its
 * end — down to the air, round an orbit, or out of Mars's sphere of influence.
 * The other facilities are listed in the sidebar and come next.
 *
 * The page computes nothing of its own: where things are comes from
 * Shared/mars-ephemeris.js and core/facilities.js, the flight from
 * core/flight.js, the view's axes from core/view-frames.js, and the scene
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
import { FACILITIES, facilityFigures, skyhookAt, tetherPointState, R_MARS, ENTRY_ALT } from "./core/facilities.js";
import { computeFlight, flightStateAt, groundRelative } from "./core/flight.js";
import { buildMarsScene, R_STATIONARY, SOI_MARS, U } from "./scene.js";
import { buildOverlay } from "./overlay.js";

var O = OrbitalMath;
var DAY = 86400, DEG = 180 / Math.PI;
var START_DAYS = 81;                   // opens on 2080-03-22
// Slider drag speeds while a key is held.
var SLOW_DRAG = { shift: 0.25, ctrl: 0.1 };
var CHEVRON_PX = 24;
var HOOK = "phobosSkyhook";

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
	{ label: "Hanging skyhook", sub: "Tilted orbit; ballast timing to stay clear of other tethers" },
	{ label: "Space elevator", sub: "Layout A (both moons pass between the legs) or B (Phobos only)" },
	{ label: "Mass driver", sub: "Surface track on the equator; Pavonis Mons by default" }
];

var state = {
	jd: CLOCK_EPOCH, baseDays: 0,      // the date bar's own fields (Shared/sim/date-bar.js)
	relFrac: 0,                        // release time, as a fraction of one orbit of the departure facility
	flightFrac: 0,                     // flight slider position, 0..1 of the flight's span
	follow: "Mars",                    // what the camera stays on: a body's name, "ship", "<facility>:<marker>", or null
	pov: "system",
	view: "stars",                     // core/view-frames.js: "stars" | "surface" | "phobos"
	from: HOOK,
	params: {},                        // facility id -> its params (m)
	open: {}                           // facility id -> card unfolded?
};
state.params[HOOK] = Object.assign({}, FACILITIES[HOOK].defaults);
state.open[HOOK] = true;

var figs = {};                         // facility id -> core/facilities.js's facilityFigures result
var flight = null;                     // core/flight.js's result for the current release, or { ok: false }

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
	if (overlay.markers[id]) { return showFac.checked && figs[HOOK].ok ? overlay.markers[id].pos : null; }
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
		+ (state.view === "phobos" ? "Phobos's orbit pole up" : "north up") + " · " + f.caption;
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
function onReleaseMarker(e) {
	var pos = targetPos(HOOK + ":release");
	return !!pos && pxFrom(e, pos) < 12;
}

// Dragging the release marker: it goes to the point of the tether nearest the
// cursor's line of sight.
//
//     x = ( (u . w) - (d . u)(d . w) ) / ( 1 - (d . u)^2 )
//
//     d   unit vector along the line of sight through the cursor
//     u   unit vector along the tether, from Mars's centre (the view's origin)
//     w   the camera's position
//     x   distance from Mars's centre to that point of the tether
function dragRelease(e) {
	var fig = figs[HOOK];
	if (!fig.ok) { return; }
	var rect = renderer.domElement.getBoundingClientRect();
	var d = new THREE.Vector3(((e.clientX - rect.left) / rect.width) * 2 - 1,
		-(((e.clientY - rect.top) / rect.height) * 2 - 1), 0.5)
		.unproject(frame.camera).sub(frame.camera.position).normalize();
	var jd = sceneJd(), at = skyhookAt(fig, jd), uv = toView(viewBasis(state.view, jd), at.u);
	var u = new THREE.Vector3(uv[0], uv[1], uv[2]), w = frame.camera.position;
	var b = d.dot(u), den = 1 - b * b;
	if (den < 1e-6) { return; }
	var x = (u.dot(w) - b * d.dot(w)) / den * U;           // m from Mars's centre
	var alt = fig.a + (x - at.dist) - R_MARS;              // as a mean altitude
	state.params[HOOK].relAlt = Math.max(fig.footAlt, Math.min(fig.topAlt, alt));
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
			if (e.button !== 0 || !onReleaseMarker(e)) { return null; }
			return { x: e.clientX, y: e.clientY, travel: 0 };
		},
		onCapturedMove: function (e, tok) {
			tok.travel += Math.abs(e.clientX - tok.x) + Math.abs(e.clientY - tok.y);
			tok.x = e.clientX; tok.y = e.clientY;
			if (tok.travel >= 3) { dragRelease(e); }
		},
		onCapturedEnd: function (e, tok) {
			if (tok.travel < 3) { setFollow(HOOK + ":release"); }
		},
		onPick: function (e) {
			var id = pickTarget(e);
			if (id) { setFollow(id); }
		}
	};
});
renderer.domElement.addEventListener("mousemove", function (e) {
	if (e.buttons) { return; }
	renderer.domElement.style.cursor = onReleaseMarker(e) ? "grab" : (pickTarget(e) ? "pointer" : "");
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
	return { el: card, head: head, body: card.appendChild(el("div", "mst-card-body")) };
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
// Set a field's text unless the user is typing in it.
function show(input, value) { if (document.activeElement !== input) { input.value = value; } }

// The Phobos skyhook's card.
var hookCard = null;
function buildSkyhookCard() {
	var c = cardShell(FACILITIES[HOOK].label, "Tether built on Phobos, riding its orbit"), r = {};
	c.head.addEventListener("click", function () { state.open[HOOK] = !state.open[HOOK]; syncCards(); });
	function setAlt(key) {
		return function (kmVal) {
			if (isFinite(kmVal)) { state.params[HOOK][key] = kmVal * 1e3; refresh(); }
		};
	}
	var pair = c.body.appendChild(el("div", "mst-fieldpair"));
	r.foot = numberField(pair, "mst-hook-foot", "Foot altitude (km)", setAlt("footAlt"));
	r.top = numberField(pair, "mst-hook-top", "Top altitude (km)", setAlt("topAlt"));
	r.error = c.body.appendChild(el("div", "mst-error"));
	c.body.appendChild(el("div", "mst-muted", "Altitudes are with Phobos at its mean distance. Phobos moves 142 km nearer and farther each orbit, and the whole tether with it."));
	var ro = c.body.appendChild(el("div", "mst-readouts"));
	r.length = readout(ro, "Tether length");
	r.footNow = readout(ro, "Foot now");
	r.topNow = readout(ro, "Top now");
	r.pullFoot = readout(ro, "Weight of 1 kg at the foot");
	r.pullTop = readout(ro, "Weight of 1 kg at the top");

	var rel = c.body.appendChild(el("div", "mst-release"));
	var line = rel.appendChild(el("div", "mst-release-line"));
	var sf = line.appendChild(el("div", "mst-field"));
	var lab = sf.appendChild(el("label", null, "Release point, from foot to top"));
	lab.htmlFor = "mst-hook-rel-slider";
	r.relSlider = sf.appendChild(el("input"));
	r.relSlider.type = "range"; r.relSlider.id = "mst-hook-rel-slider";
	r.relSlider.min = 0; r.relSlider.max = 1; r.relSlider.step = "any";
	function slid() {
		var fig = figs[HOOK];
		if (!fig.ok) { return; }
		state.params[HOOK].relAlt = fig.footAlt + parseFloat(r.relSlider.value) * (fig.topAlt - fig.footAlt);
		refresh({ fromSlider: true });
	}
	r.relSlider.addEventListener("input", slid);
	bindFineDrag(r.relSlider, slid, null, SLOW_DRAG);
	r.rel = numberField(line, "mst-hook-rel", "Altitude (km)", setAlt("relAlt"));
	var rr = rel.appendChild(el("div", "mst-readouts"));
	r.relNow = readout(rr, "At the release");
	r.relEsc = readout(rr, "Escape speed there");
	r.relFate = readout(rr, "A ship let go here");
	hookCard = { el: c.el, refs: r };
}
function fillSkyhookCard(opts) {
	var r = hookCard.refs, fig = figs[HOOK], p = state.params[HOOK];
	show(r.foot, Math.round(p.footAlt / 1e3)); show(r.top, Math.round(p.topAlt / 1e3));
	show(r.rel, Math.round(p.relAlt / 1e3));
	r.error.textContent = fig.ok ? "" : fig.diagnostic.message;
	var code = fig.ok ? "" : fig.diagnostic.code;
	r.foot.classList.toggle("mst-bad", code === "foot-range");
	r.top.classList.toggle("mst-bad", code === "top-range");
	r.rel.classList.toggle("mst-bad", code === "release-off-tether");
	if (!fig.ok) {
		[r.length, r.footNow, r.topNow, r.pullFoot, r.pullTop, r.relNow, r.relEsc, r.relFate].forEach(function (x) { x.textContent = "—"; });
		return;
	}
	if (!(opts && opts.fromSlider)) { r.relSlider.value = (fig.relAlt - fig.footAlt) / (fig.topAlt - fig.footAlt); }
	var at = skyhookAt(fig, sceneJd());
	function now(s) {
		var st = tetherPointState(at, s);
		return km(O.vMag(st.r) - R_MARS) + " · " + speed(O.vMag(st.v));
	}
	r.length.textContent = km(fig.topAlt - fig.footAlt);
	r.footNow.textContent = now(fig.sFoot);
	r.topNow.textContent = now(fig.sTop);
	r.pullFoot.textContent = num(-fig.pullFoot, 2) + " N, toward Mars";
	r.pullTop.textContent = num(fig.pullTop, 2) + " N, away from Mars";
	if (flight && flight.ok) {
		r.relNow.textContent = km(flight.release.altitude) + " · " + speed(O.vMag(flight.release.v));
		r.relEsc.textContent = speed(O.escapeVelocity(fig.GM, flight.release.radius));
		r.relFate.textContent = { entry: "falls to Mars", orbit: "stays in orbit", escape: "leaves Mars" }[flight.summary.outcome];
	}
}
function syncCards() {
	hookCard.el.classList.toggle("mst-open", !!state.open[HOOK]);
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
// flight itself stands. opts.fromSlider: the release-point slider is being
// dragged and keeps its own position.
function refresh(opts) {
	opts = opts || {};
	if (!opts.sceneOnly) {
		figs[HOOK] = facilityFigures(HOOK, state.params[HOOK]);
		flight = computeFlight({ from: state.from, jd: releaseJd(), params: state.params });
		overlay.drawFlight(flight, state.view, showTraj.checked);
	}
	var jd = sceneJd(), t = flightSeconds();
	frame.setShown({ orbits: showOrbits.checked, grid: showGrid.checked });
	frame.place(jd, state.view);
	overlay.drawSkyhook(figs[HOOK], jd, state.view, showFac.checked);
	overlay.placeShip(flight, t, state.view, showTraj.checked);
	fillKeys();
	fillSystemCard(jd);
	fillSkyhookCard(opts);

	var fig = figs[state.from];
	relVal.textContent = clockTime(releaseJd()) + (fig.ok ? " · one orbit " + num(fig.period / 3600, 2) + " h" : "");
	flightVal.textContent = "T+ " + span(t) + " · " + shortDate(jd) + " " + clockTime(jd);
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
