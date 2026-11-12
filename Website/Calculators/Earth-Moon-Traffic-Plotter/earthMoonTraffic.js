/* Earth–Moon Traffic Plotter — flights between the skyhooks, on the clock.
 *
 * A to-scale 3-D view of the Earth–Moon system (the Mission Planner's
 * geocentric frame, MissionPlanner/scene-frames.js) with the system's
 * infrastructure drawn where the clock puts it, and the path of a ship let go
 * from one piece of it. This file is the page: the scene, the date bar, the
 * sidebar cards and the read-outs. The physics is core/flight.js and
 * core/facilities.js (pure, Node-tested) — nothing is computed here that the
 * core could not be asked for.
 *
 * Time. Three sliders set the RELEASE instant: the date bar's coarse (2080 to
 * 2085) and fine (one lunar orbit) pair, then the release time within one
 * orbit of the departure skyhook — the fine control the tether's angle needs,
 * since there is no phase dial. The fourth slider is the flight clock: time
 * since release. The whole scene (Moon, Sun, every tether, the ship) is shown
 * at release + flight time.
 *
 * A flight may have a destination. The path is then judged at its closest
 * pass to that tether (core/arrival.js), and the Flight slider runs from the
 * release to half an hour past the closest pass to the destination's body.
 * In FREE mode the user sets the release by hand; TARGET (core/target.js)
 * adjusts the release time and altitude until the ship meets the tether at
 * the catch altitude, and keeps doing so as the date, the catch altitude or
 * the hardware change. Moving the release by hand returns to Free.
 *
 * POINTING AT THE SCENE. A single click on anything — Earth, the Moon, the
 * ship, a skyhook's markers — makes the camera follow it; a right-drag pan
 * lets go. Dragging the ship moves it along its path with the camera on it,
 * the way a map is dragged: the scene scrolls and the ship stays centred.
 * Double-clicking the path puts the ship there. The Flight slider is plain
 * linear time, for scrubbing while the camera stays on something else.
 *
 * HOLD SKYHOOK PHASE keeps the departure tether's angle to the Earth
 * direction fixed while the date changes: the release time is moved to the
 * next instant the tether points that way, so scrubbing the date sliders shows
 * what the Moon's position alone does to the flight.
 *
 * WAYPOINT BURNS (core/waypoints.js) are small course corrections, up to two,
 * each placed by its time since release and set with the Mission Planner's
 * burn-vector editor. Their card sits between the departure and arrival
 * cards. In the view each reached waypoint carries the prograde / radial /
 * normal gizmo and the burn's arrows, and its marker can be dragged along the
 * path like the ship. Target keeps them as they are and solves around them.
 *
 * Built so far: the two skyhooks, either one as the origin; an open path, or
 * the other skyhook as the destination; waypoint burns.
 * Next: the rotating frame, the L1 elevator, the mass driver.
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { planeBasis } from "../../Shared/kinematic-chain.js";
import { moonGeoPos, moonGeoVel } from "../../Shared/geo-leg.js";
import { updateCamera, bindCameraControls, raycastPickPoint } from "../../Shared/sim/camera-controller.js";
import { createDateBar, bindFineDrag } from "../../Shared/sim/date-bar.js";
import { makePoint, updateScales, updateLabels, worldSizeAtPointForPx, projectedRadiusPx }
	from "../../Shared/sim/body-renderer.js";
import { makeShipSprite, orientMarkerSprite } from "../../Shared/sim/marker-card.js";
import { createWaypointGizmo, makeBurnArrowPair } from "../../Shared/sim/burn-widget.js";
import { buildVectorEditor } from "../../Shared/sim/vector-editor.js";
import { buildEarthMoonFrame, U } from "../../MissionPlanner/scene-frames.js";
import { CLOCK_EPOCH, FACILITIES, DESTINATIONS, routeReleaseAlt, skyhookFigures, phaseAt, tetherAxes,
         relativePhase, nextPhaseMatch } from "./core/facilities.js";
import { computeFlight, flightStateAt, PAST_PASS } from "./core/flight.js";
import { solveCatch } from "./core/target.js";
import { MAX_AXIS_MPS, burnSize } from "./core/waypoints.js";

var O = OrbitalMath;
var DAY = 86400;
var JD0 = CLOCK_EPOCH;                 // 2080-01-01
var SPAN_DAYS = 1827;                  // to 2085-01-01
var START_DAYS = 81;                   // opens on 2080-03-22

var COLOR = { top: 0x9fb6ff, com: 0xffd24a, tether: 0xeaf0ff, release: 0xff5fd0,
              Moon: 0xb060ff, Earth: 0x40d27f, Sun: 0xff9a3c,
              catchPoint: 0x3ddc84 };
// A flight from the Earth skyhook has no way to the Moon skyhook while the Moon
// is further than this from the release plane (m); inside it, the Moon's pull
// can bend the path the rest of the way.
var OFF_PLANE_WARN = 1e7;
var CHEVRON_PX = 24;
var MAX_WAYPOINTS = 2;                 // as the Mission Planner's Ephemeris tab
var GIZMO_PX = 42;                     // on-screen arm length of a waypoint's gizmo, and its longer burn arrow
var BURN_COLOR = { dv: 0xff5fd0, dSpeed: 0xffd24a };   // the Mission Planner's burn arrows
var BURN_ARROW_MIN_KMS = 0.0005;       // draw the arrows of any burn from 0.5 m/s
// Slider drag speeds while a key is held, on every slider of the page.
var SLOW_DRAG = { shift: 0.25, ctrl: 0.1 };

// Camera presets behind the POV buttons: which body the camera stays on and
// how far back it sits (scene units, 1000 km).
var POVS = {
	system:      { focus: "Earth", radius: 2300 },
	moonSurface: { focus: "Moon",  radius: 14 },
	moonL1:      { focus: "Moon",  radius: 160 },
	earthHigh:   { focus: "Earth", radius: 420 },
	earthLow:    { focus: "Earth", radius: 48 }
};
var ZOOM_MAX = 2600;                   // Earth's sphere of influence fills the view

var CARD_ORDER = ["moonSkyhook", "earthSkyhook"];
// Facilities not built yet: shown folded so the sidebar already has its shape.
var STUBS = [
	{ label: "L1 elevator", sub: "Moon surface, through L1, to the counterweight" },
	{ label: "Lunar mass driver", sub: "Surface track: launch mode or catch mode" }
];

// ---- state ------------------------------------------------------------------
var state = {
	jd: JD0, baseDays: 0,              // the date bar's own fields (Shared/sim/date-bar.js)
	relFrac: 0,                        // release time, as a fraction of one departure-skyhook orbit
	flightBy: "frac",                  // what holds the flight clock: the slider's "frac", or a "time" set in the view
	flightFrac: 0,                     // flight slider position, 0..1 (flightBy "frac")
	flightT: 0,                        // seconds since release (flightBy "time": a drag or a double-click)
	follow: "Earth",                   // what the camera stays on: "Earth" | "Moon" | "ship" | "<facility>:<marker>" | null
	from: "moonSkyhook",
	to: null,                          // destination facility id, or null for an open path
	hold: false,                       // "Hold skyhook phase": keep the departure tether's angle to its partner body
	heldAngle: null,                   // that angle (rad, core/facilities.js's relativePhase), or null to capture it
	mode: "free",                      // "free" | "target"
	params: {},                        // facility id -> { footAlt, comAlt, topAlt, relAlt, catchAlt } (m)
	waypoints: [],                     // [{ t (s since release), burn: { pro, rad, nrm } (m/s) }], core/waypoints.js
	open: { waypoints: true },         // facility id (or "waypoints") -> card unfolded?
	pov: "system"
};
CARD_ORDER.forEach(function (id) {
	state.params[id] = Object.assign({}, FACILITIES[id].defaults);
	state.open[id] = id === state.from;
});
// The flight as the core is asked for it, from the release instant jd.
function flightInput(jd) {
	return { from: state.from, to: state.to, jd: jd, params: state.params, waypoints: state.waypoints };
}

var flight = null;                     // core/flight.js result for the current release, or { ok: false }
var targetNote = "";                   // why the last Target solve failed, shown until the next change
var targetTimer = 0;                   // pending re-solve while in Target mode
var figs = {};                         // facility id -> skyhookFigures result

function $(id) { return document.getElementById(id); }
var holder = $("emt-canvas-holder");
var relSlider = $("emt-release-time"), relVal = $("emt-release-time-val");
var flightSlider = $("emt-flight-time"), flightVal = $("emt-flight-time-val");
var keysEl = $("emt-keys"), cardsEl = $("emt-cards");
var showSoi = $("emt-show-soi"), showFac = $("emt-show-facilities"), showTraj = $("emt-show-traj");

// ---- time -------------------------------------------------------------------
function releaseJd() {
	var fig = figs[state.from];
	return state.jd + (fig && fig.ok ? state.relFrac * fig.period / DAY : 0);
}
function arrival() { return flight && flight.ok && flight.arrival && flight.arrival.found ? flight.arrival : null; }
// The flight clock, seconds since release. The slider is linear: from the
// release to PAST_PASS beyond the closest pass to the destination's body when
// there is one (core/flight.js's bodyPass), else over the whole drawn path.
// Held as the slider's fraction, it keeps its place in that span while the release is changed; a
// drag or double-click in the view sets a time outright, and may go on past it.
function flightSpan() {
	if (!flight || !flight.ok) { return 0; }
	var p = flight.bodyPass;
	return p ? Math.min(flight.final.duration, p.t + PAST_PASS) : flight.final.duration;
}
function flightSeconds() {
	if (!flight || !flight.ok) { return 0; }
	if (state.flightBy === "time") { return Math.max(0, Math.min(flight.final.duration, state.flightT)); }
	return flightSpan() * state.flightFrac;
}
function setFlightTime(t) {
	state.flightBy = "time";
	state.flightT = Math.max(0, Math.min(flight && flight.ok ? flight.final.duration : 0, t));
	refresh({ sceneOnly: true });
}
function sceneJd() { return releaseJd() + flightSeconds() / DAY; }

// ---- formatting ---------------------------------------------------------------
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(jd) {
	var d = O.dateFromJulian(jd);
	return MONTHS[d.Mo - 1] + " " + d.D + " " + d.Y;
}
function clockTime(jd) {
	var s = Math.round((((jd + 0.5) % 1) + 1) % 1 * DAY) % DAY;
	function two(n) { return String(n).padStart(2, "0"); }
	return two(Math.floor(s / 3600)) + ":" + two(Math.floor(s % 3600 / 60)) + ":" + two(s % 60);
}
function num(x, d) {
	return x.toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
function span(sec) {
	if (sec < 120) { return num(sec) + " s"; }
	if (sec < 2 * 3600) { return num(sec / 60) + " min"; }
	if (sec < 2 * DAY) { return num(sec / 3600, 1) + " h"; }
	return num(sec / DAY, 1) + " d";
}
function km(m) { return num(m / 1e3) + " km"; }
function toScene(r) { return new THREE.Vector3(r[0] / U, r[1] / U, r[2] / U); }

// ---- scene ----------------------------------------------------------------------
var frame = buildEarthMoonFrame();
frame.zoomMax = ZOOM_MAX;
frame.focusBody = null;                // this page keeps the camera on its own follow target (below)
var renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
holder.appendChild(renderer.domElement);
holder.appendChild(frame.labelLayer);

var facilityGroups = {};               // facility id -> THREE.Group under its body's node
var releaseMesh = null;                // the origin's draggable release marker
var trajObjects = [];                  // what drawTrajectory added, for removal
var wpObjects = [];                    // the waypoints' gizmos and burn arrows, held at GIZMO_PX on screen
var chevron = makeShipSprite(), chevronDir = new THREE.Vector3(1, 0, 0), chevronSpeed = 1;
var markers = {};                      // follow-target id -> { pos (world), label }: the skyhooks' drawn markers
chevron.visible = false;
frame.scene.add(chevron);

function disposeTree(obj) {
	obj.traverse(function (o) {
		if (o.geometry) { o.geometry.dispose(); }
		if (o.material) { o.material.dispose(); }
	});
}

function lineOf(points, colorHex, opacity) {
	return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
		new THREE.LineBasicMaterial({ color: colorHex, transparent: opacity < 1, opacity: opacity }));
}

// One skyhook, as the Moon-Skyhook-Trajectory-Plotter draws it: the circles its
// centre of mass and top trace, the tether from foot to top at its clock angle,
// and — on the flight's origin — a triangle at the release point, pointing the
// way the tether moves.
function drawFacility(id) {
	var node = frame.bodyNode(FACILITIES[id].body);
	if (facilityGroups[id]) { node.remove(facilityGroups[id]); disposeTree(facilityGroups[id]); delete facilityGroups[id]; }
	if (id === state.from) { releaseMesh = null; }
	Object.keys(markers).forEach(function (k) { if (k.indexOf(id + ":") === 0) { delete markers[k]; } });
	var fig = figs[id];
	if (!fig || !fig.ok) { return; }
	var grp = new THREE.Group();
	var b = planeBasis(fig.normal, fig.ref);
	var e1 = toScene(b.e1).multiplyScalar(U), e2 = toScene(b.e2).multiplyScalar(U);   // unit vectors

	function circle(rM, colorHex) {
		var pts = [], N = 160, rU = rM / U;
		for (var k = 0; k <= N; k++) {
			var a = 2 * Math.PI * k / N;
			pts.push(e1.clone().multiplyScalar(rU * Math.cos(a)).add(e2.clone().multiplyScalar(rU * Math.sin(a))));
		}
		return lineOf(pts, colorHex, 0.85);
	}
	grp.add(circle(fig.rTop, COLOR.top));
	grp.add(circle(fig.rCom, COLOR.com));

	var ax = tetherAxes(fig, sceneJd());
	var along = toScene(ax.along).multiplyScalar(U), pro = toScene(ax.prograde).multiplyScalar(U);
	grp.add(lineOf([along.clone().multiplyScalar(fig.rFoot / U), along.clone().multiplyScalar(fig.rTop / U)], COLOR.tether, 1));

	var dotU = 0.02 * fig.rTop / U;
	[[fig.rCom, COLOR.com], [fig.rTop, COLOR.top]].forEach(function (d) {
		var dot = new THREE.Mesh(new THREE.SphereGeometry(dotU, 12, 8), new THREE.MeshBasicMaterial({ color: d[1] }));
		dot.position.copy(along.clone().multiplyScalar(d[0] / U));
		grp.add(dot);
	});

	if (id === state.from) {
		var len = 0.09 * fig.rTop / U, hw = 0.02 * fig.rTop / U;
		var bL = pro.clone().multiplyScalar(-len).add(along.clone().multiplyScalar(hw));
		var bR = pro.clone().multiplyScalar(-len).add(along.clone().multiplyScalar(-hw));
		var geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
			0, 0, 0, bL.x, bL.y, bL.z, bR.x, bR.y, bR.z]), 3));
		releaseMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLOR.release, side: THREE.DoubleSide }));
		releaseMesh.position.copy(along.clone().multiplyScalar(fig.rRel / U));
		releaseMesh.userData = { along: along.clone(), node: node, fig: fig };
		grp.add(releaseMesh);
	}
	if (id === state.to) {
		// The catch point: a small bar across the tether at the catch altitude.
		var half = 0.03 * fig.rTop / U, at = along.clone().multiplyScalar(fig.rCatch / U);
		grp.add(lineOf([at.clone().addScaledVector(pro, -half), at.clone().addScaledVector(pro, half)], COLOR.catchPoint, 1));
	}
	// What a click can follow: each marker this skyhook draws.
	function mark(name, label, r) {
		markers[id + ":" + name] = { pos: node.position.clone().addScaledVector(along, r / U),
		                             label: FACILITIES[id].label + " · " + label };
	}
	if (showFac.checked) {
		mark("com", "centre of mass", fig.rCom); mark("top", "top", fig.rTop);
		if (id === state.from) { mark("release", "release point", fig.rRel); }
		if (id === state.to) { mark("catch", "catch point", fig.rCatch); }
	}
	grp.visible = showFac.checked;
	node.add(grp);
	facilityGroups[id] = grp;
}

// The flight's path. A geocentric leg is drawn where it really goes; a
// Moon-bound ellipse is Moon-relative and rides the Moon's node.
function drawTrajectory() {
	trajObjects.forEach(function (o) { if (o.parent) { o.parent.remove(o); } disposeTree(o); });
	trajObjects = [];
	if (!flight || !flight.ok) { return; }
	var leg = flight.final;
	var parent = leg.kind === "moonEllipse" ? frame.bodyNode("Moon") : frame.scene;
	var a = arrival(), objs = [];
	if (a) {
		// Bright up to the closest pass, faint beyond it.
		var before = [], after = [toScene(a.rGeo)];
		leg.samples.forEach(function (s) { (s.t <= a.t ? before : after).push(toScene(s.r)); });
		before.push(toScene(a.rGeo));
		objs.push(lineOf(before, COLOR[leg.primary], 1));
		if (after.length > 1) { objs.push(lineOf(after, COLOR[leg.primary], 0.3)); }
	} else {
		objs.push(lineOf(leg.samples.map(function (s) { return toScene(s.r); }), COLOR[leg.primary], 1));
	}
	var start = makePoint(COLOR.release, 5);
	start.position.copy(toScene(leg.samples[0].r));
	objs.push(start);
	objs.forEach(function (o) { o.visible = showTraj.checked; parent.add(o); trajObjects.push(o); });
	drawWaypoints();
}

// Each reached waypoint: the prograde / radial / normal gizmo of the frame its
// burn is measured in, and the burn's two arrows — the impulse (pink) and the
// change in speed relative to that body (yellow), the longer one as long as
// the gizmo's arms. A flight with waypoints is always a geocentric leg, so
// they sit in the scene itself.
function drawWaypoints() {
	wpObjects.forEach(function (o) { frame.scene.remove(o); disposeTree(o); });
	wpObjects = [];
	Object.keys(markers).forEach(function (k) { if (k.indexOf("wp:") === 0) { delete markers[k]; } });
	if (!flight || !flight.ok || !showTraj.checked) { return; }
	flight.waypoints.forEach(function (w, i) {
		if (!w.reached) { return; }
		var pos = toScene(w.r), add = [createWaypointGizmo(w.relR, w.relV, pos)];
		var pair = makeBurnArrowPair(pos, O.vScale(O.vUnit(w.relVAfter), w.dSpeed), w.dv,
			BURN_COLOR.dSpeed, BURN_COLOR.dv, BURN_ARROW_MIN_KMS);
		if (pair.spdArrow) { add.push(pair.spdArrow); }
		if (pair.dvArrow) { add.push(pair.dvArrow); }
		add.forEach(function (o) { frame.scene.add(o); wpObjects.push(o); });
		markers["wp:" + i] = { pos: pos, label: "waypoint " + (i + 1), dir: toScene(w.v).normalize(), speed: O.vMag(w.v) };
	});
}

function placeShip() {
	var ok = flight && flight.ok && showTraj.checked;
	chevron.visible = !!ok;
	if (!ok) { return; }
	var s = flightStateAt(flight, flightSeconds());
	chevron.position.copy(toScene(s.r));
	// Nose along the drawn path: Moon-relative motion on a Moon-bound ellipse.
	var v = flight.final.kind === "moonEllipse" ? O.vSub(s.v, moonGeoVel(s.jde)) : s.v;
	chevronDir.set(v[0], v[1], v[2]).normalize();
	chevronSpeed = Math.max(1, O.vMag(v));     // m/s along the path as drawn
}

// ---- camera ---------------------------------------------------------------------
// ---- camera: following, picking, dragging ------------------------------------------
var ORIGIN = new THREE.Vector3(0, 0, 0);
var followEl = $("emt-follow");
var glide = 0;                         // frames left of easing onto a new follow position
var ring = (function () {              // the mark around whatever is followed
	var cv = document.createElement("canvas");
	cv.width = cv.height = 64;
	var ctx = cv.getContext("2d");
	ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
	ctx.beginPath(); ctx.arc(32, 32, 28, 0, 2 * Math.PI); ctx.stroke();
	var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv),
		depthTest: false, depthWrite: false, transparent: true, opacity: 0.75 }));
	sp.renderOrder = 14; sp.visible = false;
	frame.scene.add(sp);
	return sp;
})();

// World position of a follow target, or null when it is not in the scene.
function targetPos(id) {
	if (id === "Earth") { return ORIGIN; }
	if (id === "Moon") { return frame.bodyNode("Moon").position; }
	if (id === "ship") { return chevron.visible ? chevron.position : null; }
	return markers[id] ? markers[id].pos : null;
}
function targetLabel(id) {
	return id === "ship" ? "the ship" : (markers[id] ? markers[id].label : id);
}
function zoomMin() { return state.follow === "Earth" ? 8 : (state.follow === "Moon" ? 2.2 : 0.3); }

// Keep the camera on `id` from now on (null: let go). `pov` names the POV
// button this came from, if any; any other follow clears the buttons.
function setFollow(id, pov) {
	if (id !== state.follow) { glide = 18; }
	state.follow = id;
	state.pov = pov || null;
	frame.cam.radius = Math.max(zoomMin(), frame.cam.radius);
	syncFollow();
}
function syncFollow() {
	followEl.hidden = !state.follow;
	followEl.firstChild.textContent = state.follow ? "Following: " + targetLabel(state.follow) : "";
	Array.prototype.forEach.call($("emt-pov").children, function (btn) {
		btn.setAttribute("aria-pressed", String(btn.dataset.pov === state.pov));
	});
}
function setPov(name) {
	var p = POVS[name];
	frame.cam.radius = p.radius;
	setFollow(p.focus, name);
}
// Per frame: hold the camera's centre on the followed thing, easing onto it
// for a moment after a change. A target that has left the scene is let go.
function applyFollow() {
	ring.visible = false;
	if (!state.follow) { return; }
	var pos = targetPos(state.follow);
	if (!pos) { state.follow = null; state.pov = null; syncFollow(); return; }
	if (glide > 0) { frame.cam.target.lerp(pos, 0.25); glide--; } else { frame.cam.target.copy(pos); }
	if (state.follow !== "Earth" && state.follow !== "Moon") {
		ring.visible = true;
		ring.position.copy(pos);
		ring.scale.setScalar(worldSizeAtPointForPx(frame.camera, holder, pos, 40));
	}
}

// Screen position (CSS px within the view) of a world point; z > 1 is behind the camera.
var _sp = new THREE.Vector3();
function screenOf(pos) {
	var w = holder.clientWidth, h = holder.clientHeight;
	_sp.copy(pos).project(frame.camera);
	return { x: (_sp.x * 0.5 + 0.5) * w, y: (-_sp.y * 0.5 + 0.5) * h, z: _sp.z };
}
function cursorOf(e) {
	var rect = renderer.domElement.getBoundingClientRect();
	return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function pxBetween(pos, c) {
	var s = screenOf(pos);
	return s.z > 1 ? Infinity : Math.hypot(s.x - c.x, s.y - c.y);
}

// What a click at the cursor would follow, or null. The ship comes first,
// then the skyhooks' markers, then the bodies — small things over large — and
// the nearest within each. A body is hit anywhere on its disc.
function pickTarget(e) {
	var c = cursorOf(e);
	if (chevron.visible && pxBetween(chevron.position, c) < 14) { return "ship"; }
	var best = null, bestD = 11;
	Object.keys(markers).forEach(function (id) {
		var d = pxBetween(markers[id].pos, c);
		if (d < bestD) { bestD = d; best = id; }
	});
	if (best) { return best; }
	[["Moon", frame.bodyNode("Moon").position, 1737.1], ["Earth", ORIGIN, 6371]].forEach(function (b) {
		var reach = Math.max(10, projectedRadiusPx(frame.camera, holder, b[2] * 1e3 / U,
			frame.camera.position.distanceTo(b[1]) || 1e-9));
		var d = pxBetween(b[1], c);
		if (d < reach && (best === null || d < bestD)) { bestD = d; best = b[0]; }
	});
	return best;
}

function cursorRay(e) {
	var rect = renderer.domElement.getBoundingClientRect();
	var dir = new THREE.Vector3(((e.clientX - rect.left) / rect.width) * 2 - 1,
		-(((e.clientY - rect.top) / rect.height) * 2 - 1), 0.5)
		.unproject(frame.camera).sub(frame.camera.position).normalize();
	return { o: frame.camera.position.clone(), d: dir };
}
function hitRelease(e) {
	if (!releaseMesh || !showFac.checked) { return false; }
	var wp = new THREE.Vector3();
	releaseMesh.getWorldPosition(wp);
	return pxBetween(wp, cursorOf(e)) < 16;
}
function hitShip(e) { return chevron.visible && pxBetween(chevron.position, cursorOf(e)) < 14; }
// The waypoint whose marker is under the cursor (its index), or -1.
function hitWaypoint(e) {
	var c = cursorOf(e), best = -1, bestD = 14;
	state.waypoints.forEach(function (wp, i) {
		var m = markers["wp:" + i];
		var d = m ? pxBetween(m.pos, c) : Infinity;
		if (d < bestD) { bestD = d; best = i; }
	});
	return best;
}
// Drag the release marker: the point on the tether's line nearest the cursor
// ray sets the release altitude, kept between the foot and the top.
function dragRelease(e) {
	var ud = releaseMesh && releaseMesh.userData;
	if (!ud) { return; }
	var ray = cursorRay(e), A = new THREE.Vector3();
	ud.node.getWorldPosition(A);
	var u = ud.along, w0 = ray.o.clone().sub(A);
	var b = ray.d.dot(u), denom = 1 - b * b;
	if (Math.abs(denom) < 1e-9) { return; }
	var t = (u.dot(w0) - b * ray.d.dot(w0)) / denom;       // scene units along the tether
	var p = state.params[state.from];
	p.relAlt = Math.max(p.footAlt, Math.min(p.topAlt, t * U - ud.fig.R));
	refresh({ userRelease: true });
}
// Drag something along the path: the ship, or a waypoint. The camera is on
// it, so it stays at the centre and the scene scrolls, as a dragged map does:
// each mouse movement, measured along the path's direction on screen,
// advances it by that many pixels' worth of path. Shift and Ctrl slow it as
// on the sliders. Returns the change in flight time, s:
//
//     dt = (dx * tx + dy * ty) * metresPerPixel / speed
//
//     dx, dy           the mouse movement, px
//     tx, ty           unit vector of the path's direction on screen
//     metresPerPixel   at the dragged thing's distance from the camera
//     speed            its speed along the path as drawn, m/s
//
// Where the path points almost straight at the camera it has no direction on
// screen, and left-right movement is used.
function dragAlongPath(e, dx, dy, pos, dir, speed) {
	var perPx = worldSizeAtPointForPx(frame.camera, holder, pos, 1);
	var a = screenOf(pos);
	var b = screenOf(pos.clone().addScaledVector(dir, perPx * 40));
	var tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty);
	if (len < 8) { tx = 1; ty = 0; } else { tx /= len; ty /= len; }
	var slow = e.ctrlKey ? SLOW_DRAG.ctrl : (e.shiftKey ? SLOW_DRAG.shift : 1);
	return (dx * tx + dy * ty) * slow * perPx * U / speed;
}
function dragShip(e, dx, dy) {
	setFlightTime(flightSeconds() + dragAlongPath(e, dx, dy, chevron.position, chevronDir, chevronSpeed));
}
// A waypoint's marker sits on the path before its own burn, so moving it
// along the path leaves the path up to it, and the camera on it, as they are.
function dragWaypoint(e, dx, dy, i) {
	var m = markers["wp:" + i], wp = state.waypoints[i];
	if (!m || !wp) { return; }
	setWaypointTime(i, wp.t + dragAlongPath(e, dx, dy, m.pos, m.dir, Math.max(1, m.speed)));
}
// Flight time (s) of the point of the drawn path under the cursor, within
// 10 px, or null. Where the path passes under the cursor twice, the earlier.
function pathTimeAt(e) {
	if (!flight || !flight.ok || !showTraj.checked) { return null; }
	var c = cursorOf(e), leg = flight.final, a = leg.samples;
	var off = leg.kind === "moonEllipse" ? frame.bodyNode("Moon").position : ORIGIN;
	var v = new THREE.Vector3(), prev = null, bestD = 10, bestT = null;
	for (var k = 0; k < a.length; k++) {
		v.set(a[k].r[0] / U, a[k].r[1] / U, a[k].r[2] / U).add(off);
		var s = screenOf(v), cur = { x: s.x, y: s.y, z: s.z, t: a[k].t };
		if (prev && prev.z <= 1 && cur.z <= 1) {
			var ex = cur.x - prev.x, ey = cur.y - prev.y, L2 = ex * ex + ey * ey;
			var f = L2 > 0 ? Math.max(0, Math.min(1, ((c.x - prev.x) * ex + (c.y - prev.y) * ey) / L2)) : 0;
			var d = Math.hypot(prev.x + f * ex - c.x, prev.y + f * ey - c.y);
			if (d < bestD - 0.5) { bestD = d; bestT = prev.t + f * (cur.t - prev.t); }
		}
		prev = cur;
	}
	return bestT;
}

bindCameraControls(renderer.domElement, function () {
	return {
		cam: frame.cam, camera: frame.camera,
		zoomMin: zoomMin(), zoomMax: ZOOM_MAX,
		shiftZoom: true,
		isLocked: function () { return !!state.follow; },
		pickPoint: function (e) {
			return raycastPickPoint(frame.camera, renderer.domElement, e,
				{ meshes: frame.pickMeshes, soiSpheres: frame.pickSoiSpheres });
		},
		onPan: function () { if (state.follow) { setFollow(null); } },
		// A press on the ship, a waypoint or the release marker is theirs:
		// moved, it drags them; let go where it was pressed, it is a click and
		// follows them. At the very start of a flight the ship and the release
		// marker sit together, and the marker wins; where the ship sits on a
		// waypoint (a new one is put where the ship is), the waypoint wins.
		captureDrag: function (e) {
			if (e.button !== 0) { return null; }
			var onRelease = hitRelease(e), onShip = hitShip(e), onWp = hitWaypoint(e);
			if (!onRelease && !onShip && onWp < 0) { return null; }
			var kind = onRelease && (!onShip || flightSeconds() === 0) ? "release" : (onWp >= 0 ? "wp" : "ship");
			return { kind: kind, wp: onWp, x: e.clientX, y: e.clientY, travel: 0 };
		},
		onCapturedMove: function (e, tok) {
			var dx = e.clientX - tok.x, dy = e.clientY - tok.y;
			tok.x = e.clientX; tok.y = e.clientY;
			tok.travel += Math.abs(dx) + Math.abs(dy);
			if (tok.travel < 3) { return; }
			if (tok.kind === "release") { dragRelease(e); return; }
			if (tok.kind === "wp") {
				if (state.follow !== "wp:" + tok.wp) { setFollow("wp:" + tok.wp); }
				dragWaypoint(e, dx, dy, tok.wp);
				return;
			}
			if (state.follow !== "ship") { setFollow("ship"); }
			dragShip(e, dx, dy);
		},
		onCapturedEnd: function (e, tok) {
			if (tok.travel >= 3) { return; }
			if (tok.kind === "wp") { setFollow("wp:" + tok.wp); openCard("waypoints"); return; }
			setFollow(tok.kind === "ship" ? "ship" : state.from + ":release");
		},
		onPick: function (e) {
			var id = pickTarget(e);
			if (id) { setFollow(id); }
		},
		onDoubleClick: function (e) {
			var t = pathTimeAt(e);
			if (t !== null) { glide = 18; setFlightTime(t); }
		}
	};
});
// The cursor says what a press would do: a hand over anything a click follows,
// a grab over the two things that drag.
renderer.domElement.addEventListener("mousemove", function (e) {
	if (e.buttons) { return; }
	renderer.domElement.style.cursor = (hitShip(e) || hitRelease(e) || hitWaypoint(e) >= 0) ? "grab" : (pickTarget(e) ? "pointer" : "");
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
	if (chevron.visible) {
		chevron.scale.setScalar(worldSizeAtPointForPx(frame.camera, holder, chevron.position, CHEVRON_PX));
		orientMarkerSprite(frame.camera, chevron, chevronDir);
	}
	wpObjects.forEach(function (o) {
		o.scale.setScalar(worldSizeAtPointForPx(frame.camera, holder, o.position, GIZMO_PX));
	});
	renderer.render(frame.scene, frame.camera);
}

// ---- sidebar cards -----------------------------------------------------------------
var CHEVRON_SVG = '<svg class="emt-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2l4 4-4 4"/></svg>';
var cards = {};                        // facility id -> { el, refs }

function el(tag, cls, text) {
	var e = document.createElement(tag);
	if (cls) { e.className = cls; }
	if (text != null) { e.textContent = text; }
	return e;
}
function readout(parent, label) {
	var row = el("div", "emt-ro");
	row.appendChild(el("span", "emt-ro-label", label));
	var val = row.appendChild(el("span", "emt-ro-val", "—"));
	parent.appendChild(row);
	return val;
}
function numberField(parent, id, label, onInput) {
	var f = el("div", "emt-field");
	var lab = f.appendChild(el("label", null, label));
	lab.htmlFor = id;
	var inp = f.appendChild(el("input"));
	inp.type = "number"; inp.id = id; inp.step = "any";
	inp.addEventListener("input", onInput);
	parent.appendChild(f);
	return inp;
}

function buildCard(id) {
	var fac = FACILITIES[id], refs = {};
	var card = el("section", "emt-card");
	var head = card.appendChild(el("button", "emt-card-head"));
	head.type = "button";
	head.innerHTML = CHEVRON_SVG;
	var title = head.appendChild(el("span", "emt-card-title", fac.label));
	refs.sub = title.appendChild(el("span", "emt-card-sub"));
	refs.badge = head.appendChild(el("span", "emt-badge"));
	head.addEventListener("click", function () { state.open[id] = !state.open[id]; syncCards(); });
	refs.head = head;

	var body = card.appendChild(el("div", "emt-card-body"));
	var alts = body.appendChild(el("div", "emt-fieldpair"));
	function altField(key, label) {
		refs[key] = numberField(alts, "emt-" + id + "-" + key, label, function () {
			state.params[id][key] = parseFloat(refs[key].value) * 1e3;
			refresh({ keepInputs: true });
		});
	}
	altField("footAlt", "Foot (km)"); altField("comAlt", "CoM (km)"); altField("topAlt", "Top (km)");
	refs.error = body.appendChild(el("div", "emt-error"));
	var ro = body.appendChild(el("div", "emt-readouts"));
	refs.vCom = readout(ro, "orbital speed (centre of mass)");
	refs.vTop = readout(ro, "tether top speed");
	refs.vFoot = readout(ro, "tether foot speed");
	refs.period = readout(ro, "orbit and rotation period");
	refs.pull = readout(ro, "pull felt at the top");
	refs.phase = readout(ro, "tether angle now, from the clock");

	// The release controls: shown on the flight's origin only.
	var rel = body.appendChild(el("div", "emt-release"));
	var line = rel.appendChild(el("div", "emt-release-line"));
	var sf = line.appendChild(el("div", "emt-field"));
	var sl = sf.appendChild(el("label", null, "Release altitude"));
	sl.htmlFor = "emt-" + id + "-relSlider";
	refs.relSlider = sf.appendChild(el("input"));
	refs.relSlider.type = "range"; refs.relSlider.id = sl.htmlFor; refs.relSlider.step = "any";
	function relAltMoved() {
		state.params[id].relAlt = parseFloat(refs.relSlider.value) * 1e3;
		refresh({ userRelease: true });
	}
	refs.relSlider.addEventListener("input", relAltMoved);
	bindFineDrag(refs.relSlider, relAltMoved, null, SLOW_DRAG);
	refs.relAlt = numberField(line, "emt-" + id + "-relAlt", "km", function () {
		state.params[id].relAlt = parseFloat(refs.relAlt.value) * 1e3;
		refresh({ keepInputs: true, userRelease: true });
	});
	var rro = rel.appendChild(el("div", "emt-readouts"));
	refs.relPhase = readout(rro, "tether angle from the " + (fac.body === "Moon" ? "Earth" : "Moon") + " direction, at release");
	refs.vRel = readout(rro, "speed on release");
	refs.vInf = readout(rro, "v∞ leaving " + fac.body);
	refs.release = rel;

	// The arrival controls and read-outs: shown on the flight's destination only.
	var arr = body.appendChild(el("div", "emt-release emt-arrival"));
	var aline = arr.appendChild(el("div", "emt-release-line"));
	var af = aline.appendChild(el("div", "emt-field"));
	var al = af.appendChild(el("label", null, "Catch altitude"));
	al.htmlFor = "emt-" + id + "-catchSlider";
	refs.catchSlider = af.appendChild(el("input"));
	refs.catchSlider.type = "range"; refs.catchSlider.id = al.htmlFor; refs.catchSlider.step = "any";
	function catchAltMoved() {
		state.params[id].catchAlt = parseFloat(refs.catchSlider.value) * 1e3;
		refresh();
	}
	refs.catchSlider.addEventListener("input", catchAltMoved);
	bindFineDrag(refs.catchSlider, catchAltMoved, null, SLOW_DRAG);
	refs.catchAlt = numberField(aline, "emt-" + id + "-catchAlt", "km", function () {
		state.params[id].catchAlt = parseFloat(refs.catchAlt.value) * 1e3;
		refresh({ keepInputs: true });
	});
	var aro = arr.appendChild(el("div", "emt-readouts"));
	refs.aMiss = readout(aro, "closest pass to the tether");
	refs.aPoint = readout(aro, "nearest point of the tether");
	refs.aWait = readout(aro, "tether timing");
	refs.aPointSpeed = readout(aro, "tether speed there");
	refs.aShipSpeed = readout(aro, "ship speed there");
	refs.aTrim = readout(aro, "trim burn to match");
	refs.aComp = arr.appendChild(el("div", "emt-muted"));
	refs.arrival = arr;

	cardsEl.appendChild(card);
	cards[id] = { el: card, refs: refs };
}

function buildStub(stub) {
	var card = el("section", "emt-card");
	var head = card.appendChild(el("button", "emt-card-head"));
	head.type = "button"; head.disabled = true;
	head.innerHTML = CHEVRON_SVG;
	var title = head.appendChild(el("span", "emt-card-title", stub.label));
	title.appendChild(el("span", "emt-card-sub", stub.sub));
	head.appendChild(el("span", "emt-badge emt-badge-idle", "not built yet"));
	cardsEl.appendChild(card);
	stubEls.push(card);
}
var stubEls = [];

// ---- the waypoint card ------------------------------------------------------------
// One block per waypoint: its time of flight (slider and hours), what the ship
// is doing there, and the burn, in the Mission Planner's vector editor capped
// at ±MAX_AXIS_MPS per axis. The blocks are rebuilt only when a waypoint is
// added or removed; fillWaypointCard writes their values.
var wpCard = null;                     // { el, refs, rows }
function buildWaypointCard() {
	var refs = {};
	var card = el("section", "emt-card emt-card-wp");
	var head = card.appendChild(el("button", "emt-card-head"));
	head.type = "button";
	head.innerHTML = CHEVRON_SVG;
	var title = head.appendChild(el("span", "emt-card-title", "Waypoint burns"));
	refs.sub = title.appendChild(el("span", "emt-card-sub"));
	refs.badge = head.appendChild(el("span", "emt-badge"));
	head.addEventListener("click", function () { state.open.waypoints = !state.open.waypoints; syncCards(); });
	refs.head = head;
	var body = card.appendChild(el("div", "emt-card-body"));
	refs.list = body.appendChild(el("div", "emt-wp-list"));
	refs.add = body.appendChild(el("button", "emt-btn", "+ add waypoint"));
	refs.add.type = "button";
	refs.add.title = "Add a burn where the ship is on the Flight slider";
	refs.add.addEventListener("click", addWaypoint);
	body.appendChild(el("div", "emt-muted",
		"Small course corrections, each at a time since release: up to ±" + MAX_AXIS_MPS + " m/s along each axis. " +
		"Inside the Moon's sphere of influence a burn is measured against the Moon, elsewhere against Earth. " +
		"A new waypoint goes where the ship is on the Flight slider; drag its marker in the view to move it along the path."));
	wpCard = { el: card, refs: refs, rows: [] };
	cardsEl.appendChild(card);
	rebuildWaypointRows();
}

function rebuildWaypointRows() {
	var R = wpCard.refs;
	R.list.textContent = "";
	wpCard.rows = [];
	state.waypoints.forEach(function (wp, i) {
		var row = {}, box = R.list.appendChild(el("div", "emt-wp"));
		var head = box.appendChild(el("div", "emt-wp-head"));
		head.appendChild(el("span", "emt-wp-name", "Waypoint " + (i + 1)));
		var rm = head.appendChild(el("button", "emt-btn emt-btn-small", "remove"));
		rm.type = "button";
		rm.addEventListener("click", function () { removeWaypoint(i); });

		var line = box.appendChild(el("div", "emt-release-line"));
		var sf = line.appendChild(el("div", "emt-field"));
		var lab = sf.appendChild(el("label", null, "Time of flight"));
		lab.htmlFor = "emt-wp" + i + "-slider";
		row.slider = sf.appendChild(el("input"));
		row.slider.type = "range"; row.slider.id = lab.htmlFor; row.slider.min = 0; row.slider.step = "any";
		function moved() { setWaypointTime(i, parseFloat(row.slider.value)); }
		row.slider.addEventListener("input", moved);
		bindFineDrag(row.slider, moved, null, SLOW_DRAG);
		row.hours = numberField(line, "emt-wp" + i + "-hours", "hours", function () {
			var h = parseFloat(row.hours.value);
			if (isFinite(h) && h > 0) { setWaypointTime(i, h * 3600, { keepInputs: true }); }
		});

		row.error = box.appendChild(el("div", "emt-error"));
		var ro = box.appendChild(el("div", "emt-readouts"));
		row.when = readout(ro, "at");
		row.dEarth = readout(ro, "distance from Earth");
		row.dMoon = readout(ro, "distance from the Moon");
		row.frame = readout(ro, "burn measured against");
		row.speed = readout(ro, "speed there, before → after");
		row.dv = readout(ro, "burn");

		var burnHost = box.appendChild(el("div", "emt-wp-burn"));
		// wp.burn is the live object: the editor writes into it as it is dragged or typed.
		buildVectorEditor(burnHost, wp.burn, function () { refresh(); },
			{ maxDeltaMps: MAX_AXIS_MPS, displayDiv: 1, decimals: 1, step: 0.1, unitLabel: "m/s" });
		wpCard.rows.push(row);
	});
	R.add.hidden = state.waypoints.length >= MAX_WAYPOINTS;
}

// A new waypoint goes where the ship is on the Flight slider, or halfway
// along the flight while the slider is at the start; never on top of another.
function addWaypoint() {
	if (state.waypoints.length >= MAX_WAYPOINTS) { return; }
	var fSpan = flightSpan(), t = flightSeconds();
	if (!(t > 60 && t < fSpan)) { t = fSpan > 0 ? fSpan / 2 : 3600; }
	state.waypoints.forEach(function (w) { if (Math.abs(w.t - t) < 60) { t += 3600; } });
	state.waypoints.push({ t: t, burn: { pro: 0, rad: 0, nrm: 0 } });
	rebuildWaypointRows();
	openCard("waypoints");
	refresh();
}
function removeWaypoint(i) {
	state.waypoints.splice(i, 1);
	if (state.follow && state.follow.indexOf("wp:") === 0) { setFollow(null); }
	rebuildWaypointRows();
	refresh();
}
function setWaypointTime(i, t, opts) {
	var wp = state.waypoints[i];
	if (!wp || !isFinite(t)) { return; }
	wp.t = Math.max(1, t);
	refresh(opts);
}
function openCard(id) { state.open[id] = true; syncCards(); }

// The burns' total, m/s, over the waypoints the flight reaches.
function waypointTotal() {
	if (!flight || !flight.ok) { return 0; }
	return flight.waypoints.reduce(function (sum, w) { return sum + (w.reached ? burnSize(w.burn) : 0); }, 0);
}

function fillWaypointCard(opts) {
	var R = wpCard.refs, n = state.waypoints.length, fSpan = flightSpan();
	state.waypoints.forEach(function (wp, i) {
		var row = wpCard.rows[i], w = flight && flight.ok ? flight.waypoints[i] : null;
		row.slider.max = Math.max(fSpan, wp.t);
		row.slider.value = wp.t;
		if (!(opts && opts.keepInputs)) { row.hours.value = +(wp.t / 3600).toFixed(2); }
		var jd = releaseJd() + wp.t / DAY;
		row.when.textContent = "T+ " + span(wp.t) + " · " + shortDate(jd) + " " + clockTime(jd).slice(0, 5);
		var reached = !!(w && w.reached);
		row.error.style.display = reached || !w ? "none" : "";
		row.error.textContent = reached || !w ? ""
			: "The flight ends at T+ " + span(flight.final.duration) + ", before this waypoint, so its burn is not made.";
		if (!reached) {
			["dEarth", "dMoon", "frame", "speed", "dv"].forEach(function (k) { row[k].textContent = "—"; });
			return;
		}
		row.dEarth.textContent = km(O.vMag(w.r));
		row.dMoon.textContent = km(O.vMag(O.vSub(w.r, moonGeoPos(w.jd))));
		row.frame.textContent = w.body === "Moon" ? "the Moon (inside its sphere of influence)" : "Earth";
		row.speed.textContent = num(O.vMag(w.relV)) + " → " + num(O.vMag(w.relVAfter)) + " m/s";
		row.dv.textContent = num(burnSize(w.burn), 1) + " m/s";
	});
	var total = waypointTotal();
	R.sub.textContent = n ? n + (n === 1 ? " waypoint" : " waypoints") + " · " + num(total, 1) + " m/s in all" : "None: the ship coasts from release";
	R.badge.className = "emt-badge " + (n ? "emt-badge-wp" : "emt-badge-idle");
	R.badge.textContent = n ? "IN FLIGHT" : "none";
}

// Fold state, role badge and which cards carry the release controls.
function syncCards() {
	CARD_ORDER.forEach(function (id) {
		var c = cards[id], origin = id === state.from, dest = id === state.to;
		c.el.classList.toggle("emt-open", !!state.open[id]);
		c.el.classList.toggle("emt-role-departure", origin);
		c.el.classList.toggle("emt-role-arrival", dest);
		c.refs.head.setAttribute("aria-expanded", String(!!state.open[id]));
		c.refs.badge.className = "emt-badge " + (origin ? "emt-badge-departure" : (dest ? "emt-badge-arrival" : "emt-badge-idle"));
		c.refs.badge.textContent = origin ? "DEPARTURE" : (dest ? "ARRIVAL" : "not in this flight");
		c.refs.release.style.display = origin ? "" : "none";
		c.refs.arrival.style.display = dest ? "" : "none";
	});
	wpCard.el.classList.toggle("emt-open", !!state.open.waypoints);
	wpCard.refs.head.setAttribute("aria-expanded", String(!!state.open.waypoints));
	orderCards();
}
// The sidebar in flight order: the departure, the waypoints, the arrival, then
// the facilities not in this flight and those not built yet.
function orderCards() {
	var els = [cards[state.from].el, wpCard.el];
	if (state.to) { els.push(cards[state.to].el); }
	CARD_ORDER.forEach(function (id) { if (id !== state.from && id !== state.to) { els.push(cards[id].el); } });
	els.concat(stubEls).forEach(function (e) { cardsEl.appendChild(e); });
}

// Write a card's values. opts.keepInputs leaves the number fields alone, so a
// half-typed value is not rewritten under the cursor.
function fillCard(id, opts) {
	var c = cards[id].refs, p = state.params[id], fig = figs[id];
	if (!(opts && opts.keepInputs)) {
		["footAlt", "comAlt", "topAlt", "relAlt", "catchAlt"].forEach(function (k) {
			c[k].value = +(p[k] / 1e3).toFixed(1);
		});
	}
	c.sub.textContent = "foot " + num(p.footAlt / 1e3) + " km · CoM " + num(p.comAlt / 1e3) + " km · top " + num(p.topAlt / 1e3) + " km";
	c.relSlider.min = p.footAlt / 1e3; c.relSlider.max = p.topAlt / 1e3; c.relSlider.value = p.relAlt / 1e3;
	c.catchSlider.min = p.footAlt / 1e3; c.catchSlider.max = p.topAlt / 1e3; c.catchSlider.value = p.catchAlt / 1e3;
	if (id === state.to) { fillArrival(c); }
	c.error.textContent = fig.ok ? "" : fig.diagnostic.message;
	c.error.style.display = fig.ok ? "none" : "";
	if (!fig.ok) {
		["vCom", "vTop", "vFoot", "period", "pull", "phase", "relPhase", "vRel", "vInf"].forEach(function (k) { c[k].textContent = "—"; });
		return;
	}
	c.vCom.textContent = num(fig.vCom) + " m/s";
	c.vTop.textContent = num(fig.vTop) + " m/s";
	c.vFoot.textContent = num(fig.vFoot) + " m/s";
	c.period.textContent = num(fig.period / 3600, 2) + " h";
	c.pull.textContent = num(fig.pullTop, 2) + " m/s² · " + num(fig.pullTop / 9.80665, 2) + " g";
	c.phase.textContent = num(phaseAt(fig, sceneJd()) * 180 / Math.PI, 1) + "°";
	c.relPhase.textContent = id === state.from
		? num(relativePhase(fig, releaseJd()) * 180 / Math.PI, 1) + "°" + (state.hold ? " (held)" : "") : "—";
	c.vRel.textContent = num(fig.vRel) + " m/s";
	c.vInf.textContent = fig.vInfBody > 0 ? num(fig.vInfBody) + " m/s"
		: "bound (escape is " + num(fig.vEscRel) + " m/s)";
}

function signed(x) { return (x >= 0 ? "+" : "−") + num(Math.abs(x)); }
// Where the ship passes relative to the tether, in words.
function passText(a) {
	if (a.caught) { return "meets the tether"; }
	if (a.reason === "above-top") { return "passes " + km(a.gap) + " above the top"; }
	if (a.reason === "below-foot") { return "passes " + km(-a.gap) + " below the foot"; }
	return "misses the tether";
}
function noArrivalText(arr) {
	return arr.reason === "never-leaves" ? "This path stays in orbit around the Moon"
		: "This path ends before it comes round to the tether's side of " + FACILITIES[state.to].body;
}
function fillArrival(c) {
	var a = arrival();
	if (!a) {
		["aMiss", "aPoint", "aWait", "aPointSpeed", "aShipSpeed", "aTrim"].forEach(function (k) { c[k].textContent = "—"; });
		c.aComp.textContent = flight && flight.ok && flight.arrival ? noArrivalText(flight.arrival) + "." : "";
		return;
	}
	c.aMiss.textContent = a.miss < 1e4 ? num(a.miss) + " m" : km(a.miss);
	c.aPoint.textContent = km(a.altitude) + (a.gap > 0 ? " (the top)" : (a.gap < 0 ? " (the foot)" : ""));
	c.aWait.textContent = Math.abs(a.wait) < 1 ? "on time"
		: "ship is " + span(Math.abs(a.wait)) + (a.wait > 0 ? " early" : " late");
	c.aPointSpeed.textContent = num(a.pointSpeed) + " m/s";
	c.aShipSpeed.textContent = num(a.shipSpeed) + " m/s";
	c.aTrim.textContent = num(a.trim) + " m/s";
	c.aComp.textContent = "Trim, by direction: along the tether's motion " + signed(a.components.pro)
		+ ", outward " + signed(a.components.out) + ", across its plane " + signed(a.components.nrm) + " m/s.";
}

// ---- key figures under the view ------------------------------------------------------
function key(label, value, warn) {
	var k = el("div", "emt-key");
	k.appendChild(el("span", "emt-key-label", label));
	k.appendChild(el("span", "emt-key-val" + (warn ? " emt-warn" : ""), value));
	keysEl.appendChild(k);
}
function fillKeys() {
	keysEl.textContent = "";
	if (!flight || !flight.ok) {
		keysEl.appendChild(el("span", "emt-key-error",
			flight && flight.diagnostic ? flight.diagnostic.message : "No flight."));
		return;
	}
	var s = flight.summary, fig = flight.fig;
	key("Release speed", num(fig.vRel) + " m/s");
	if (state.waypoints.length) { key("Waypoint burns", num(waypointTotal(), 1) + " m/s"); }
	if (state.to) { fillArrivalKeys(s); return; }
	if (s.impact) {
		key("Path", "reaches " + (s.impact === "Moon" ? "the Moon's" : "Earth's") + " surface", true);
		key("After", span(s.duration));
		if (s.impactSpeed) { key("Speed at the surface", num(s.impactSpeed) + " m/s"); }
		return;
	}
	if (s.primary === "Sun") {
		key("Path", "escapes Earth");
		key("v∞ leaving Earth", num(s.vInfEarth) + " m/s");
		key("Perihelion", s.periAU == null ? "—" : s.periAU.toFixed(3) + " AU");
		key("Aphelion", s.apoAU == null ? "— (escape)" : s.apoAU.toFixed(3) + " AU");
	} else {
		key("Path", s.primary === "Moon" ? "orbits the Moon" : "orbits Earth");
		key(s.primary === "Moon" ? "Periapsis" : "Perigee", km(s.periAlt));
		key(s.primary === "Moon" ? "Apoapsis" : "Apogee", s.apoAlt == null ? "—" : km(s.apoAlt));
	}
	if (s.inclRad != null) { key("Inclination to the " + (s.primary === "Moon" ? "skyhook's plane" : "ecliptic"), num(s.inclRad * 180 / Math.PI, 1) + "°"); }
	key("Path drawn for", span(s.duration));
}

// The key figures of a flight with a destination, then the verdict and the
// Free / Target switch.
function fillArrivalKeys(s) {
	var a = arrival();
	if (a) {
		key("Flight time", span(a.t));
		if (flight.toFig.body === "Earth" && s.primary === "Earth" && !s.impact) { key("Perigee", km(s.periAlt)); }
		// A release from Earth's skyhook stays near Earth's equatorial plane, so
		// it can only meet the Moon while the Moon is crossing that plane.
		if (flight.fig.body === "Earth" && flight.offPlane != null) {
			key("Moon from the release plane", km(Math.abs(flight.offPlane)) + (flight.offPlane >= 0 ? " north" : " south"),
				Math.abs(flight.offPlane) > OFF_PLANE_WARN);
		}
		key("Closest pass", a.miss < 1e4 ? num(a.miss) + " m" : km(a.miss), !a.caught);
		key("At tether altitude", km(a.altitude));
		key("Trim burn", num(a.trim) + " m/s");
	} else {
		key("Path", flight.arrival.reason === "never-leaves" ? "stays in orbit around the Moon" : "ends before reaching the tether's side", true);
	}
	var right = el("div", "emt-keys-right");
	var busy = state.mode === "target" && targetTimer;
	right.appendChild(el("span", "emt-chip" + (a && a.caught ? " emt-chip-ok" : ""),
		busy ? "Solving…" : (targetNote || (a ? FACILITIES[state.to].label + ": " + passText(a) : "No arrival"))));
	var group = right.appendChild(el("div", "emt-mode"));
	group.setAttribute("role", "group"); group.setAttribute("aria-label", "Aiming mode");
	[["free", "Free"], ["target", "Target"]].forEach(function (m) {
		var b = group.appendChild(el("button", null, m[1]));
		b.type = "button";
		b.setAttribute("aria-pressed", String(state.mode === m[0]));
		b.title = m[0] === "free" ? "Set the release time and altitude by hand"
			: "Adjust the release time and altitude until the ship meets the tether at the catch altitude";
		b.addEventListener("click", function () { setMode(m[0]); });
	});
	keysEl.appendChild(right);
}

// ---- Target mode -----------------------------------------------------------------------
function setMode(mode) {
	targetNote = "";
	if (mode === "free") { state.mode = "free"; clearTimeout(targetTimer); targetTimer = 0; fillKeys(); return; }
	state.mode = "target";
	scheduleTarget(20);
}
// Solve shortly: after the page has painted "Solving…", and — while a slider
// is being dragged in Target mode — only once it has rested.
function scheduleTarget(delay) {
	clearTimeout(targetTimer);
	targetTimer = setTimeout(runTarget, delay);
	fillKeys();
}
function runTarget() {
	targetTimer = 0;
	if (state.mode !== "target" || !state.to) { return; }
	var res = solveCatch(flightInput(releaseJd()));
	if (res.ok) {
		var fig = figs[state.from];
		state.params[state.from].relAlt = res.relAlt;
		state.relFrac = (res.jd - state.jd) * DAY / fig.period;
		relSlider.value = state.relFrac;
		targetNote = "";
	} else {
		state.mode = "free";
		targetNote = res.message;
	}
	refresh({ fromTarget: true });
}

// "Hold skyhook phase". When the user (or Target) has just set the release,
// that release's angle becomes the one held. On any other change — the date,
// the hardware — the release time is moved to the next instant, at or after
// the date bar's own, at which the tether is at the held angle again.
function applyHold(opts) {
	var fig = figs[state.from];
	if (!state.hold || !fig.ok) { return; }
	if (opts.userRelease || opts.fromTarget || state.heldAngle === null) {
		state.heldAngle = relativePhase(fig, releaseJd());
		return;
	}
	state.relFrac = (nextPhaseMatch(fig, state.jd, state.heldAngle) - state.jd) * DAY / fig.period;
	relSlider.value = state.relFrac;
}

// ---- refresh -----------------------------------------------------------------------
// Everything downstream of the state. opts.sceneOnly: only the flight clock
// moved, so the flight itself stands and just the scene time changes.
function refresh(opts) {
	opts = opts || {};
	if (!opts.sceneOnly) {
		if (!opts.fromTarget) { targetNote = ""; }
		if (opts.userRelease && state.mode === "target") { state.mode = "free"; clearTimeout(targetTimer); targetTimer = 0; }
		CARD_ORDER.forEach(function (id) { figs[id] = skyhookFigures(id, state.params[id]); });
		applyHold(opts);
		flight = computeFlight(flightInput(releaseJd()));
		drawTrajectory();
		// In Target mode any other change (date, catch altitude, hardware) is
		// followed by a fresh solve once the control has rested.
		if (state.mode === "target" && !opts.fromTarget && state.to) { scheduleTarget(350); }
		else { fillKeys(); }
	}
	var jd = sceneJd();
	frame.place(jd);
	CARD_ORDER.forEach(function (id) { drawFacility(id); fillCard(id, opts); });
	fillWaypointCard(opts);
	placeShip();

	var fig = figs[state.from];
	relVal.textContent = clockTime(releaseJd()) + (fig.ok ? " · one orbit " + num(fig.period / 3600, 2) + " h" : "");
	var t = flightSeconds(), fSpan = flightSpan();
	flightSlider.value = fSpan > 0 ? Math.min(1, t / fSpan) : 0;
	flightVal.textContent = "T+ " + span(t) + " · " + shortDate(jd) + " " + clockTime(jd).slice(0, 5);
	$("emt-flight-label").textContent = flight && flight.ok && flight.bodyPass
		? "Flight past " + flight.toFig.body : "Flight";
}

// ---- wiring -------------------------------------------------------------------------
var dateBar = createDateBar(state, {
	coarseSlider: $("emt-date-coarse"), fineSlider: $("emt-date-fine"),
	fineLoLabel: $("emt-fine-lo"), fineHiLabel: $("emt-fine-hi"),
	dateField: $("emt-date-field"), jdLabel: $("emt-jd"),
	jd0: JD0, spanDays: SPAN_DAYS, shortDate: shortDate, slowDrag: SLOW_DRAG
});

function init() {
	CARD_ORDER.forEach(buildCard);
	buildWaypointCard();
	STUBS.forEach(buildStub);
	syncCards();

	dateBar.setBaseDays(START_DAYS);
	dateBar.bind(function () { refresh(); });

	function releaseMoved() { state.relFrac = parseFloat(relSlider.value); refresh({ userRelease: true }); }
	function flightMoved() {
		state.flightBy = "frac";
		state.flightFrac = parseFloat(flightSlider.value);
		refresh({ sceneOnly: true });
	}
	relSlider.addEventListener("input", releaseMoved);
	flightSlider.addEventListener("input", flightMoved);
	bindFineDrag(relSlider, releaseMoved, null, SLOW_DRAG);
	bindFineDrag(flightSlider, flightMoved, null, SLOW_DRAG);
	$("emt-hold-phase").addEventListener("change", function (e) {
		state.hold = e.target.checked;
		state.heldAngle = null;            // captured from the release as it stands
		refresh();
	});
	function routeChanged() {
		CARD_ORDER.forEach(function (id) { state.open[id] = id === state.from || id === state.to; });
		state.flightBy = "frac"; state.flightFrac = 0; flightSlider.value = 0;
		state.mode = "free"; clearTimeout(targetTimer); targetTimer = 0;
		syncCards();
		refresh();
	}
	function fillDestinations() {
		var sel = $("emt-to");
		sel.textContent = "";
		[null].concat(DESTINATIONS[state.from]).forEach(function (id) {
			var o = sel.appendChild(el("option", null, id ? FACILITIES[id].label : "Open path"));
			o.value = id || "";
		});
		sel.value = state.to || "";
	}
	fillDestinations();
	$("emt-from").addEventListener("change", function (e) {
		state.from = e.target.value;
		state.to = null;
		state.heldAngle = null;
		// A burn's time since release means nothing on a flight from somewhere else.
		state.waypoints = [];
		rebuildWaypointRows();
		fillDestinations();
		routeChanged();
	});
	$("emt-to").addEventListener("change", function (e) {
		state.to = e.target.value || null;
		// A flight to a facility starts from the release point meant for it.
		var alt = state.to ? routeReleaseAlt(state.from, state.to, state.params[state.from]) : null;
		if (alt !== null) { state.params[state.from].relAlt = alt; }
		routeChanged();
	});
	$("emt-pov").addEventListener("click", function (e) {
		var btn = e.target.closest("button[data-pov]");
		if (btn) { setPov(btn.dataset.pov); }
	});
	showFac.addEventListener("change", function () { refresh({ sceneOnly: true }); });
	showTraj.addEventListener("change", function () { drawTrajectory(); placeShip(); });

	if (window.ResizeObserver) { new ResizeObserver(resize).observe(holder); }
	window.addEventListener("resize", resize);
	resize();

	refresh();
	setPov("system");
	animate();
}

init();
