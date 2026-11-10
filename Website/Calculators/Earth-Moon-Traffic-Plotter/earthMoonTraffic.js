/* Earth–Moon Traffic Plotter — step 1: release from a skyhook, on the clock.
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
 * Built so far: the two skyhooks, either one as the origin, an open path.
 * Next: arrivals at a facility, Free/Target aiming, the rotating frame,
 * waypoint burns, the L1 elevator and the mass driver.
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { planeBasis } from "../../Shared/kinematic-chain.js";
import { moonGeoVel } from "../../Shared/geo-leg.js";
import { updateCamera, bindCameraControls, raycastPickPoint } from "../../Shared/sim/camera-controller.js";
import { createDateBar } from "../../Shared/sim/date-bar.js";
import { makePoint, updateScales, updateLabels, worldSizeAtPointForPx } from "../../Shared/sim/body-renderer.js";
import { makeShipSprite, orientMarkerSprite } from "../../Shared/sim/marker-card.js";
import { buildEarthMoonFrame, U } from "../../MissionPlanner/scene-frames.js";
import { CLOCK_EPOCH, FACILITIES, skyhookFigures, phaseAt, tetherAxes } from "./core/facilities.js";
import { computeFlight, flightStateAt } from "./core/flight.js";

var O = OrbitalMath;
var DAY = 86400;
var JD0 = CLOCK_EPOCH;                 // 2080-01-01
var SPAN_DAYS = 1827;                  // to 2085-01-01
var START_DAYS = 81;                   // opens on 2080-03-22

var COLOR = { top: 0x9fb6ff, com: 0xffd24a, tether: 0xeaf0ff, release: 0xff5fd0,
              Moon: 0xb060ff, Earth: 0x40d27f, Sun: 0xff9a3c };
var CHEVRON_PX = 24;

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
	flightFrac: 0,                     // flight slider position, 0..1
	from: "moonSkyhook",
	params: {},                        // facility id -> { footAlt, comAlt, topAlt, relAlt } (m)
	open: {},                          // facility id -> card unfolded?
	pov: "system"
};
CARD_ORDER.forEach(function (id) {
	state.params[id] = Object.assign({}, FACILITIES[id].defaults);
	state.open[id] = id === state.from;
});

var flight = null;                     // core/flight.js result for the current release, or { ok: false }
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
// The flight slider is cubic in time: an escape runs for months, and the
// interesting part is the first hours.
function flightSeconds() {
	return flight && flight.ok ? flight.final.duration * Math.pow(state.flightFrac, 3) : 0;
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
var renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
holder.appendChild(renderer.domElement);
holder.appendChild(frame.labelLayer);

var facilityGroups = {};               // facility id -> THREE.Group under its body's node
var releaseMesh = null;                // the origin's draggable release marker
var trajObjects = [];                  // what drawTrajectory added, for removal
var chevron = makeShipSprite(), chevronDir = new THREE.Vector3(1, 0, 0);
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
	var pts = leg.samples.map(function (s) { return toScene(s.r); });
	var line = lineOf(pts, COLOR[leg.primary], 1);
	var start = makePoint(COLOR.release, 5);
	start.position.copy(pts[0]);
	[line, start].forEach(function (o) { o.visible = showTraj.checked; parent.add(o); trajObjects.push(o); });
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
}

// ---- camera ---------------------------------------------------------------------
function setPov(name) {
	var p = POVS[name];
	state.pov = name;
	frame.focusBody = p.focus;
	frame.cam.radius = p.radius;
	frame.place(sceneJd());
	syncPovButtons();
}
function syncPovButtons() {
	Array.prototype.forEach.call($("emt-pov").children, function (btn) {
		btn.setAttribute("aria-pressed", String(btn.dataset.pov === state.pov));
	});
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
	var rect = renderer.domElement.getBoundingClientRect();
	var wp = new THREE.Vector3();
	releaseMesh.getWorldPosition(wp).project(frame.camera);
	if (wp.z > 1) { return false; }
	return Math.hypot((wp.x * 0.5 + 0.5) * rect.width - (e.clientX - rect.left),
		(-wp.y * 0.5 + 0.5) * rect.height - (e.clientY - rect.top)) < 16;
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
	refresh();
}

bindCameraControls(renderer.domElement, function () {
	return {
		cam: frame.cam, camera: frame.camera,
		zoomMin: frame.focusBody === "Earth" ? 8 : 2.2, zoomMax: ZOOM_MAX,
		shiftZoom: true,
		isLocked: function () { return !!frame.focusBody; },
		pickPoint: function (e) {
			return raycastPickPoint(frame.camera, renderer.domElement, e,
				{ meshes: frame.pickMeshes, soiSpheres: frame.pickSoiSpheres });
		},
		onPan: function () { frame.focusBody = null; state.pov = null; syncPovButtons(); },
		captureDrag: function (e) { return e.button === 0 && hitRelease(e) ? "release" : null; },
		onCapturedMove: function (e) { dragRelease(e); }
	};
});

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
	updateCamera(frame.camera, frame.cam);
	updateScales(frame.camera, holder, frame.scaleList, { wantSOI: showSoi.checked });
	updateLabels(frame.camera, holder, frame.labelList);
	if (chevron.visible) {
		chevron.scale.setScalar(worldSizeAtPointForPx(frame.camera, holder, chevron.position, CHEVRON_PX));
		orientMarkerSprite(frame.camera, chevron, chevronDir);
	}
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
	refs.relSlider.type = "range"; refs.relSlider.id = sl.htmlFor; refs.relSlider.step = "0.1";
	refs.relSlider.addEventListener("input", function () {
		state.params[id].relAlt = parseFloat(refs.relSlider.value) * 1e3;
		refresh();
	});
	refs.relAlt = numberField(line, "emt-" + id + "-relAlt", "km", function () {
		state.params[id].relAlt = parseFloat(refs.relAlt.value) * 1e3;
		refresh({ keepInputs: true });
	});
	var rro = rel.appendChild(el("div", "emt-readouts"));
	refs.vRel = readout(rro, "speed on release");
	refs.vInf = readout(rro, "v∞ leaving " + fac.body);
	refs.release = rel;

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
}

// Fold state, role badge and which cards carry the release controls.
function syncCards() {
	CARD_ORDER.forEach(function (id) {
		var c = cards[id], origin = id === state.from;
		c.el.classList.toggle("emt-open", !!state.open[id]);
		c.el.classList.toggle("emt-role-departure", origin);
		c.refs.head.setAttribute("aria-expanded", String(!!state.open[id]));
		c.refs.badge.className = "emt-badge " + (origin ? "emt-badge-departure" : "emt-badge-idle");
		c.refs.badge.textContent = origin ? "DEPARTURE" : "not in this flight";
		c.refs.release.style.display = origin ? "" : "none";
	});
}

// Write a card's values. opts.keepInputs leaves the number fields alone, so a
// half-typed value is not rewritten under the cursor.
function fillCard(id, opts) {
	var c = cards[id].refs, p = state.params[id], fig = figs[id];
	if (!(opts && opts.keepInputs)) {
		["footAlt", "comAlt", "topAlt", "relAlt"].forEach(function (k) {
			c[k].value = +(p[k] / 1e3).toFixed(1);
		});
	}
	c.sub.textContent = "foot " + num(p.footAlt / 1e3) + " km · CoM " + num(p.comAlt / 1e3) + " km · top " + num(p.topAlt / 1e3) + " km";
	c.relSlider.min = p.footAlt / 1e3; c.relSlider.max = p.topAlt / 1e3; c.relSlider.value = p.relAlt / 1e3;
	c.error.textContent = fig.ok ? "" : fig.diagnostic.message;
	c.error.style.display = fig.ok ? "none" : "";
	if (!fig.ok) {
		["vCom", "vTop", "vFoot", "period", "pull", "phase", "vRel", "vInf"].forEach(function (k) { c[k].textContent = "—"; });
		return;
	}
	c.vCom.textContent = num(fig.vCom) + " m/s";
	c.vTop.textContent = num(fig.vTop) + " m/s";
	c.vFoot.textContent = num(fig.vFoot) + " m/s";
	c.period.textContent = num(fig.period / 3600, 2) + " h";
	c.pull.textContent = num(fig.pullTop, 2) + " m/s² · " + num(fig.pullTop / 9.80665, 2) + " g";
	c.phase.textContent = num(phaseAt(fig, sceneJd()) * 180 / Math.PI, 1) + "°";
	c.vRel.textContent = num(fig.vRel) + " m/s";
	c.vInf.textContent = fig.vInfBody > 0 ? num(fig.vInfBody) + " m/s"
		: "bound (escape is " + num(fig.vEscRel) + " m/s)";
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

// ---- refresh -----------------------------------------------------------------------
// Everything downstream of the state. opts.sceneOnly: only the flight clock
// moved, so the flight itself stands and just the scene time changes.
function refresh(opts) {
	opts = opts || {};
	if (!opts.sceneOnly) {
		CARD_ORDER.forEach(function (id) { figs[id] = skyhookFigures(id, state.params[id]); });
		flight = computeFlight({ from: state.from, jd: releaseJd(), params: state.params });
		drawTrajectory();
		fillKeys();
	}
	var jd = sceneJd();
	frame.place(jd);
	CARD_ORDER.forEach(function (id) { drawFacility(id); fillCard(id, opts); });
	placeShip();

	var fig = figs[state.from];
	relVal.textContent = clockTime(releaseJd()) + (fig.ok ? " · one orbit " + num(fig.period / 3600, 2) + " h" : "");
	var t = flightSeconds();
	flightVal.textContent = "T+ " + span(t) + " · " + shortDate(jd) + " " + clockTime(jd).slice(0, 5);
}

// ---- wiring -------------------------------------------------------------------------
var dateBar = createDateBar(state, {
	coarseSlider: $("emt-date-coarse"), fineSlider: $("emt-date-fine"),
	fineLoLabel: $("emt-fine-lo"), fineHiLabel: $("emt-fine-hi"),
	dateField: $("emt-date-field"), jdLabel: $("emt-jd"),
	jd0: JD0, spanDays: SPAN_DAYS, shortDate: shortDate
});

function init() {
	CARD_ORDER.forEach(buildCard);
	STUBS.forEach(buildStub);
	syncCards();

	dateBar.setBaseDays(START_DAYS);
	dateBar.bind(function () { refresh(); });

	relSlider.addEventListener("input", function () { state.relFrac = parseFloat(relSlider.value); refresh(); });
	flightSlider.addEventListener("input", function () {
		state.flightFrac = parseFloat(flightSlider.value);
		refresh({ sceneOnly: true });
	});
	$("emt-from").addEventListener("change", function (e) {
		state.from = e.target.value;
		CARD_ORDER.forEach(function (id) { state.open[id] = id === state.from; });
		state.flightFrac = 0; flightSlider.value = 0;
		syncCards();
		refresh();
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
