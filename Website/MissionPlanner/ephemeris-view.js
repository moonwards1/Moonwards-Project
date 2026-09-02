/* Mission Planner — the Ephemeris tab: where a trajectory is authored before
 * any mission exists.
 *
 * This tab is the Solar-System-Trajectory-Plotter's (SST's) authoring
 * experience, hosted inside the planner. It keeps its own plain state object —
 * NOT a mission World — because it is a scratchpad: only "Start Mission Plan"
 * turns a plan sketched here into a World and a new mission tab. `state.leg` is
 * deliberately shaped exactly like modules/transfer-leg's own `params` (burn,
 * waypoints, legDays, destination), so freezing is "hand these fields to a
 * transfer-leg stage" rather than a translation step.
 *
 * PHYSICS IS NOT FORKED: the actual leg — burn application, sample polyline,
 * events, miss distance — goes through transfer-leg.js's exported `computeLeg`,
 * the same function the transfer-leg module uses once a plan is frozen. What is
 * local to this file is everything computeLeg doesn't own: resolving a
 * waypoint's "snap to an orbital feature" request into a concrete day offset
 * (via the snap-to helpers in Shared/math-utils.js), and the view-only glue —
 * the drawn polyline, waypoint gizmos, burn arrows, and readout boxes —
 * mirrored from transfer-leg.js's own `draw()`, since computeLeg's view-side
 * contract (a World+stageId-keyed cache) doesn't fit a viewless scratchpad.
 *
 * NO MISSION CONDITIONS HERE. This tab is for playing with trajectories before
 * any mission exists, so nothing here behaves as though one were committed.
 * Concretely, `legDays` carries no user-set "arrival deadline": every refresh()
 * derives it fresh from `finalCoastDays` (one full orbital period if the
 * resulting arc is bound, a long fixed escape coast if not), so a transfer
 * visibly closes into a loop instead of stopping wherever a duration field
 * happened to be typed. For the same reason there is no "misses the destination
 * by X AU" check — with no defined arrival time, "did you arrive on time" is not
 * yet a coherent question. Judging an encounter is the ship marker's job.
 *
 * THE DEPARTURE CARD MEANS TWO DIFFERENT THINGS, one per origin family, and
 * departureState below is where that split lives.
 *
 * FOR EVERY ORIGIN BUT THE MOON the card IS THE HAND-OFF, not a burn. Its
 * prograde/radial/normal vector IS the ship's v-infinity — speed and heading —
 * where it leaves the origin's sphere of influence, measured against the origin
 * body's own heliocentric motion, and THE TAB'S CLOCK IS THAT HAND-OFF'S EPOCH.
 * So the drawn arc starts at the hand-off, at t = 0, and the tab's state is the
 * same thing core/freeze.js commits and modules/frozen-plan holds: a position,
 * a velocity and an epoch at the SOI edge. Nothing is re-derived across that
 * seam, so a plan frozen here and pasted back is exact. A departure
 * technology's job is to DELIVER that hand-off; how much impulse it costs and
 * when it must launch are asked BACKWARDS from it, by
 * core/departure-estimate.js, and those answers never bend the drawn arc.
 *
 * FOR A MOON ORIGIN the card IS THE RELEASE and the hand-off is flown to. Its
 * three numbers are an impulse in the MOON's own geocentric frame, the clock is
 * when the ship leaves the Moon, and core/lunar-departure.js integrates
 * Earth + Moon + Sun forward from there to Earth's SOI. The crossing's
 * position, velocity and EPOCH all come out of that flight, so the drawn arc
 * starts DAYS AFTER the date on the bar (legStartJd, which every "t along the
 * leg" reading is measured from). It has to work this way round: the Moon's
 * ~1 km/s points a different way every day of the month, and pinning a
 * velocity at Earth's SOI instead pins the one quantity the Moon's phase
 * controls — the trajectory then stops responding to the launch date at all.
 *
 * WHERE ON THE SOI SPHERE the ship exits is `state.handoff` (see departureState
 * below), for those other origins. Authoring from scratch it is DERIVED — one
 * SOI radius along the outbound asymptote, the minimal reading of "this is my
 * heading leaving" — so it tracks the heading as the card is edited. Pasting a
 * mission ADOPTS the plan's own offset verbatim, because that geometry came
 * from a real departure chain (a platform, carriers, departure waypoints) and
 * this tab has no way to re-derive it. An adopted offset is body-relative, so
 * it survives date scrubs; changing the origin drops back to derived, as does
 * the card's reset control. A Moon origin uses neither: its exit point is
 * flown, and a pasted lunar mission reopens from the release the plan stored.
 *
 * THE SHIP MARKER is a slidable probe on the drawn path with Free / Target
 * modes, plus the destination-at-arrival "×" and the
 * temporal-proximity ring (both inside updateDestinationMarker). The
 * mechanical layer — sprites, card skeleton, slider physics, the
 * closest-approach search — is Shared/sim/marker-card.js; the mode state
 * machine stays local, per that file's header. Placement is click-to-place on
 * the drawn path (handlePick). One deliberate difference from the SST: Target
 * mode decomposes its Lambert Δv with O.burnComponents — the same
 * ecliptic-anchored frame O.applyBurn re-applies it in — where the SST used the
 * osculating r×v frame, which re-applies to a slightly different Δv on inclined
 * arcs.
 *
 * "START MISSION PLAN" lives on the marker card, which ALWAYS exists as a
 * floating overlay on the 3D pane: with no marker placed it collapses to a hint
 * line + the (disabled, with its reason) Start button + "Paste mission link…",
 * the marker-specific controls CSS-hidden via the card's .mp-empty class
 * (planner.css). Start opens the name dialog, freezes the authored plan through
 * core/freeze.js — that file's header is the freeze CONTRACT — and hands the
 * serialized World to planner.js's onStartMission, which registers it as a new
 * mission tab and switches to it.
 *
 * "PASTE MISSION LINK…" does NOT spawn a tab. It decodes a shared link
 * (ui/share-link.js parses URL/fragment/blob) and loads the frozen plan's
 * origin/burn/waypoints/destination back into THIS tab's own scratchpad state
 * (loadFrozenPlanIntoState), placing the marker at the original rendezvous — so
 * a pasted mission is revised here and then frozen into a new tab through the
 * same path as anything authored from scratch.
 *
 * THE ORBIT-APPROACH RING SCAN rounds out the proximity markers: hollow rings
 * where the drawn path passes near the SELECTED DESTINATION's orbit
 * (independent of whether the body is actually there then), refreshed
 * alongside the trajectory each recompute. Ring mechanics are shared
 * (Shared/sim/approach-markers.js, the same module the temporal ring uses);
 * the golden-section scan itself is local, over this view's
 * leg.samples/trajSegs.
 *
 * NOT PORTED from the SST: in-scene waypoint dragging.
 *
 * There is exactly one Ephemeris tab for the page's life (unlike mission
 * views, which N-instance via a <template>), so its DOM is addressed by
 * plain class queries already present in planner.html — no cloning needed.
 *
 * ES module; Three.js is the one classic-script exception (global THREE).
 */
/* global THREE */

import { systems } from "../Shared/orbit.js";
import { OrbitalMath } from "../Shared/math-utils.js";
import { updateCamera, bindCameraControls, raycastPickPoint } from "../Shared/sim/camera-controller.js";
import { createDateBar } from "../Shared/sim/date-bar.js";
import {
	updateLabels as brUpdateLabels, updateScales as brUpdateScales, worldSizeAtPointForPx, pickBodyName,
	soiRadiusAU, projectedRadiusPx
} from "../Shared/sim/body-renderer.js";
import { createWaypointGizmo, makeBurnArrowPair } from "../Shared/sim/burn-widget.js";
import { renderReadoutBoxes, positionReadoutBoxes } from "../Shared/sim/readout-panes.js";
import { buildMoonGlyph } from "../Shared/sim/moon-glyph.js";
import { buildVectorEditor } from "../Shared/sim/vector-editor.js";
import {
	makeShipSprite, makeXMarkSprite, orientMarkerSprite,
	markerFraction as mcMarkerFraction, sweepAngleFrom, phasingDays as mcPhasingDays,
	refineApproach as mcRefineApproach, followCrossing as mcFollowCrossing,
	buildMarkerCard as mcBuildMarkerCard, updateMarkerModeButtons as mcUpdateMarkerModeButtons,
	fmtKm, fmtTof, fmtDate
} from "../Shared/sim/marker-card.js";
import { makeRingSprite, applyTierToSprite, scaleApproachMark, pickProximityTier } from "../Shared/sim/approach-markers.js";
import { buildHelioFrame, ORIGIN_BODIES, DESTINATION_BODIES } from "./scene-frames.js";
import { computeLeg, defaultParams as legDefaults } from "./modules/transfer-leg/transfer-leg.js";
import { freezeMissionWorld, defaultMissionTitle } from "./core/freeze.js";
import {
	estimateDeparture, estimateArrival, moonElongationDeg, moonProgradeSpeed,
	originSoiRadius
} from "./core/departure-estimate.js";
import { flyLunarDeparture, releaseVelocity, RELEASE_ALTITUDE } from "./core/lunar-departure.js";
import { moonGeoPos, moonGeoVel } from "../Shared/geo-leg.js";
import { Frames } from "../Shared/frames.js";
import {
	APPROACH_FAR, APPROACH_NEAR, APPROACH_CLOSE, TEMP_FAR, TEMP_NEAR, TEMP_CLOSE,
	checkProximity, proximityReason
} from "./core/proximity.js";
import { deserializeWorld } from "./core/world.js";
import { decodeFragmentAny } from "../Shared/exchange.js";
import { unpackMissionLink, missionFragmentFrom } from "./ui/share-link.js";
import { readSets, latestOf } from "./core/revisions.js";

var O = OrbitalMath;
var SUN = systems.get("Sun");
var GM_SUN = SUN.GM;
var GM_EARTH = systems.get("Earth").GM;
var AU = 149597870700;
var DAY = 86400;
var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
var SPAN_DAYS = 36525;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var MAX_WAYPOINTS = 2;   // matches transfer-leg's own card and the SST's two "create waypoint" checkboxes

// Waypoint gizmo / burn-arrow constant on-screen size: the prograde-speed
// arrow is pinned to this same length, and the dV arrow drawn relative to
// it (see burn-widget.js's makeBurnArrowPair).
var GIZMO_PX = 42;
var DV_COLOR = 0xff5fd0, DSPEED_COLOR = 0xffd24a;
var dvHex = "#ff5fd0", spdHex = "#ffd24a";

// The proximity THRESHOLDS live in core/proximity.js — one definition shared
// with mission-view.js's "adopt delivered" gate, so the standard that lets a
// mission be created is the same one that lets its departure be re-pointed.
// APPROACH_FAR doubles as released Target mode's "inside an encounter ring"
// engagement distance.
//
// The ring TIER TABLES below stay here: they are colours and pixel sizes for
// this view's sprites, not standards.
//
// Orbit-approach ring tiers: distance from the drawn path to a candidate body's
// orbit *ring*, independent of whether the body is there
// then (same table as the SST). Size/thickness DECREASE with proximity (the
// far ring is the big, bold one); worldR (AU, scene units here) is the true
// physical size each tier marks, so the ring grows once the camera is close
// enough for that to read larger than the fixed on-screen size.
var SPACE_TIERS = [
	{ color: 0xb9842a, opacity: 0.42, px: 26, lw: 10, worldR: 0.004  },  // 0: far   — faint, largest, thickest
	{ color: 0xd6a02f, opacity: 0.70, px: 17, lw: 7,  worldR: 0.001  },  // 1: near  — brighter, medium
	{ color: 0xfff1b0, opacity: 1.00, px: 11, lw: 5,  worldR: 0.0002 }   // 2: close — brightest, smallest, thinnest
];
// Temporal-proximity tiers: how close (in days) the destination body is to
// the meeting point at the ship's arrival time (same table as the SST).
var TEMPORAL_TIERS = [
	{ color: 0x3a6fd0, opacity: 0.50, px: 30 },   // 0: <30 d — faint blue
	{ color: 0x5aa9ff, opacity: 0.80, px: 34 },   // 1: <10 d — brighter
	{ color: 0x9fe0ff, opacity: 1.00, px: 40 }    // 2: <3 d  — bright cyan, largest
];

function fmtKmS(mps) { return (mps / 1000).toFixed(2); }
function isoDay(jd) {
	var d = OrbitalMath.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

// Why a lunar release produced no departure, in the planner's terms rather
// than the solver's (core/lunar-departure.js's own reason codes).
var LUNAR_FAILURES = {
	"no-impulse": "No release yet — give the ship a velocity relative to the Moon.",
	"no-escape": "This release stays bound to Earth: it never reaches Earth's SOI.",
	"impact-Moon": "This release falls back onto the Moon.",
	"impact-Earth": "This release falls into Earth."
};

// =======================================================================
//  opts: {
//    renderer, root      — root is planner.html's #mp-eph-view, already in
//                          the DOM
//    onStartMission(worldData, title) — spawn a mission tab from a
//                          frozen serialized World; returns { ok } or
//                          { ok: false, reason } (shown in the dialog)
//    onOpenPastedMission(worldData, title, planSets) — same, for the LATER
//                          plan a pasted link carries when the mission has
//                          been updated since it was frozen
//  }
//  "Paste mission link…" loads a link's ORIGINAL plan into this tab's own
//  scratchpad (loadFrozenPlanIntoState). When the link also carries a later
//  commit, that one opens as its own mission tab through onOpenPastedMission —
//  see loadPastedMission.
//  Returns { show, hide, render, resize }.
// =======================================================================
export function createEphemerisView(opts) {
	var renderer = opts.renderer;
	var root = opts.root;
	var active = false;

	function q(sel) { return root.querySelector(sel); }

	var mainEl = q(".mp-main");
	var sceneEl = q(".mp-scene");
	var paneMainEl = q(".mp-pane-main");
	var paneCapEl = paneMainEl.querySelector(".mp-pane-cap");
	var panelEl = q(".mp-panel");
	var depHost = q(".mp-eph-departure");
	var statusChip = q(".mp-eph-status");
	var wpHost = q(".mp-eph-waypoints");

	var frame = buildHelioFrame();
	paneCapEl.textContent = frame.caption;
	paneMainEl.appendChild(frame.labelLayer);

	// Straddling burn-readout panes (Shared/sim/readout-panes.js) — an
	// overlay so a box can poke past the panel's left edge regardless of
	// which pane its burn widget lives in (mirrors the SST's #sst-burn-readouts).
	var readoutLayer = document.createElement("div");
	readoutLayer.className = "mp-readout-layer";
	mainEl.appendChild(readoutLayer);
	var readoutBoxes = [];
	panelEl.addEventListener("scroll", function () { positionReadoutBoxes(readoutBoxes, mainEl, panelEl); });

	// ---- scratchpad state: NOT a World — origin body + a leg shaped exactly
	// like transfer-leg's own params. legDays carries NO mission condition here:
	// it is recomputed every refresh() from the physics alone (see
	// finalCoastDays), never user-set, so the drawn arc just keeps going —
	// closing into a loop if bound, coasting outward for a long while if not. A
	// real duration only becomes meaningful at freeze, where core/freeze.js
	// decides legDays from the marker's resolved rendezvous.
	var state = {
		origin: "Moon",
		leg: {
			burn: { pro: 0, rad: 0, nrm: 0 },
			waypoints: [],
			legDays: 0,
			destination: legDefaults.destination
		},
		// Where on the origin's SOI sphere the flight starts, as a BODY-RELATIVE
		// offset (see departureState). mode "derived" recomputes it from the
		// current heading every refresh; mode "adopted" holds the vector a
		// pasted mission's departure chain actually produced. A MOON origin
		// uses neither: its exit point is flown, so there is nothing to derive
		// or adopt.
		handoff: { mode: "derived", offset: null },
		marker: null,          // { f0, angle (deg), mode: "free"|"target", dvBudget, ... }
		markerFocused: false,  // camera pivots on the marker
		destFocused: false     // camera pivots on the destination "×" (updateDestinationMarker's destSprite)
	};

	// WHEN THE DRAWN HELIOCENTRIC ARC STARTS. For every origin but the Moon
	// that is the date bar's own value: the card states the hand-off and the
	// clock states its epoch. A MOON origin departs FORWARD — the clock is the
	// release from the Moon, and the arc does not begin until the flight
	// reaches Earth's SOI some days later (core/lunar-departure.js) — so the
	// two dates differ and every "t seconds along the leg" reading is measured
	// from THIS one. Set by departureState() on each call, so anything reading
	// it during a refresh sees the epoch the arc was actually drawn from.
	var legStart = null;
	function legStartJd() { return legStart == null ? dateState.jd : legStart; }

	var trajLine = null, endDots = [], wpMarkers = [], burnArrows = [];
	var depBurnHost = null;             // wraps the departure burn's vector editor (readout anchor)
	var wpRows = [];                    // [{ card, dayInput, snapBoxes, slider, info, host }]

	// ---- marker state: the drawn leg as per-segment start states, so the
	// marker can be located at any global time along the whole path (rebuilt by
	// refresh()). -------------------------------------------------------------
	var trajSegs = [];        // { r0, v0 (m, m/s), dur, tStart (s) }
	var trajTotalT = 0;       // total drawn-leg duration (s)
	var trajSampleCount = 0;  // polyline sample count (sets followCrossing's search window)
	var trajSamples = [];     // leg.samples verbatim ({ r (m), t (s) }) — the approach-ring scan's input
	var markerSprite = null, destSprite = null, destSoi = null, tempRing = null;
	var orbitApproachMarks = [];   // hollow-ring sprites where the path nears a body's orbit
	var markerVelDir = null;  // THREE.Vector3 — ship heading, for the sprite's per-frame orientation
	var mk = null;            // the built marker card's refs (Shared/sim/marker-card.js)

	// The trajectory's actual closest approach to the current destination —
	// the ship's own state where its distance to the body's real (moving)
	// position is smallest, found once per refresh() over the whole drawn
	// path. This is what the card's arrival/phasing/closest-approach/capture
	// rows report: a property of the trajectory itself, not of wherever the
	// marker happens to be scrubbed to (see computeDestinationApproach).
	// null when there's no destination or no valid trajectory.
	var destApproach = null;

	// ==== marker slider domain: swept degrees, not time --------------------
	// The slider shows RADIAL (swept-angle) progress from the flight's start
	// (0°, the SOI edge) to the drawn arc's end, whatever it sweeps (up to
	// ~360° when bound, less for an escape). degAtTime/timeAtDeg are exact,
	// analytic functions of the leg's start state (trajSegs[0]) via
	// Shared/math-utils.js's sweptTrueAnomaly/timeAtSweptTrueAnomaly, not a
	// table sampled from the drawn polyline — see Notes/decisions.md,
	// 2026-08-28, for why sampling doesn't work here.
	function startElements() {
		return trajSegs.length ? O.elementsFromState(GM_SUN, trajSegs[0].r0, trajSegs[0].v0) : null;
	}

	// Swept degrees at global time t.
	function degAtTime(t) {
		var el = startElements();
		return el ? O.sweptTrueAnomaly(GM_SUN, el.a, el.e, el.nu, t) * 180 / Math.PI : 0;
	}

	// Inverse of degAtTime: global time at which the swept angle reaches deg.
	function timeAtDeg(deg) {
		var el = startElements();
		return el ? O.timeAtSweptTrueAnomaly(GM_SUN, el.a, el.e, el.nu, deg * Math.PI / 180) : 0;
	}

	// ==== the clock: same date-bar widget and epoch/span every plotter
	// uses, its own plain state (no World to write jd into). ------------------
	function shortDate(jd) { var d = O.dateFromJulian(jd); return MONTHS[d.Mo - 1] + " " + d.Y; }
	var dateState = { jd: JD0, baseDays: 0 };
	var dateBar = createDateBar(dateState, {
		coarseSlider: q(".mp-date-coarse"),
		fineSlider: q(".mp-date-fine"),
		fineLoLabel: q(".mp-fine-lo"),
		fineHiLabel: q(".mp-fine-hi"),
		dateField: q(".mp-date-field"),
		jdLabel: q(".mp-jd"),
		jd0: JD0,
		spanDays: SPAN_DAYS,
		shortDate: shortDate
	});
	dateBar.bind(function () { frame.place(dateState.jd); refresh(); });

	// ==== small DOM helpers (the same numRow shape each module's own card
	// builds — see modules/transfer-leg's init) --------------------------------
	function numRow(parent, label, unit, value, step, commit) {
		var row = document.createElement("div"); row.className = "mp-inrow";
		var lab = document.createElement("label"); lab.textContent = label; row.appendChild(lab);
		var wrap = document.createElement("span");
		var inp = document.createElement("input");
		inp.type = "number"; inp.step = step; inp.value = value;
		wrap.appendChild(inp);
		if (unit) { var u = document.createElement("span"); u.className = "mp-unit"; u.textContent = unit; wrap.appendChild(u); }
		row.appendChild(wrap); parent.appendChild(row);
		inp.addEventListener("change", function () {
			var v = parseFloat(inp.value);
			if (isFinite(v)) { commit(v); }
		});
		return inp;
	}
	function muted(parent, text) {
		var el = document.createElement("div"); el.className = "mp-muted"; el.textContent = text || "";
		parent.appendChild(el);
		return el;
	}

	// ==== "Moon phase at launch" widget ---------------------------------------
	// An animated phase glyph + two pill bars: the Moon's speed along EARTH'S
	// OWN heliocentric prograde (the waypoint gizmo's prograde axis, so its sign
	// visibly adds to or subtracts from a launch), and the estimated days for
	// the departure leg to leave Earth's SOI (core/departure-estimate.js —
	// wedge-switched dive-in/direct-out). One instance mounts under the origin's
	// info line, a mirrored one under the destination's; each shows only while
	// that body is Earth.
	function buildMoonWidget(parent, title) {
		var box = document.createElement("div"); box.className = "mp-moonwidget";
		box.style.display = "none";
		var head = document.createElement("div"); head.className = "mp-moonwidget-title";
		head.textContent = title; box.appendChild(head);
		var body = document.createElement("div"); body.className = "mp-moonwidget-body";
		box.appendChild(body);

		var glyph = buildMoonGlyph(body);

		var bars = document.createElement("div"); bars.className = "mp-moonbars";
		body.appendChild(bars);
		function bar(label, ticks) {
			var g = document.createElement("div"); g.className = "mp-moonbar-group";
			var lab = document.createElement("div"); lab.className = "mp-moonbar-label";
			lab.textContent = label; g.appendChild(lab);
			var pill = document.createElement("div"); pill.className = "mp-moonbar";
			var fill = document.createElement("div"); fill.className = "mp-moonbar-fill";
			pill.appendChild(fill);
			ticks.forEach(function (t) {
				var s = document.createElement("span"); s.className = "mp-moonbar-tick";
				s.style.left = (t.at * 100) + "%"; s.textContent = t.text;
				pill.appendChild(s);
			});
			g.appendChild(pill); bars.appendChild(g);
			return { fill: fill, pill: pill };
		}
		var relBar = bar("Relative speed, km/s",
			[{ at: 0.10, text: "-1" }, { at: 0.50, text: "0" }, { at: 0.90, text: "1" }]);
		var DAY_SCALE = 7;
		var dayBar = bar(title.indexOf("arrival") >= 0 ? "Days to cross system" : "Days to leave system",
			[1, 2, 3, 4, 5, 6, 7].map(function (n) { return { at: (n - 0.5) / DAY_SCALE, text: String(n) }; }));

		parent.appendChild(box);

		return {
			hide: function () { box.style.display = "none"; },
			// info = { elong (deg), rel (m/s), days (d, or null when there is
			//          no impulse to time), note (days-bar tooltip suffix) }
			show: function (info) {
				box.style.display = "";
				glyph.setPhase(info.elong);
				var v = Math.max(-1, Math.min(1, (info.rel || 0) / 1000));
				var half = Math.abs(v) * 40;                    // ±1 km/s maps to the 10%/90% ticks
				relBar.fill.style.left = (v < 0 ? 50 - half : 50) + "%";
				relBar.fill.style.width = half + "%";
				relBar.pill.title = ((info.rel || 0) / 1000).toFixed(2) +
					" km/s along Earth's own heliocentric prograde";
				if (info.days == null) {
					dayBar.fill.style.width = "0";
					dayBar.pill.title = "No impulse authored yet — nothing to time.";
				} else {
					dayBar.fill.style.width = (Math.max(0, Math.min(1, info.days / DAY_SCALE)) * 100) + "%";
					dayBar.pill.title = info.days.toFixed(2) + " days" +
						(info.days > DAY_SCALE ? " — beyond the bar's " + DAY_SCALE + "-day scale" : "") +
						(info.note ? " (" + info.note + ")" : "");
				}
			}
		};
	}

	// ==== Departure card: origin, burn, destination. No duration field — the
	// drawn arc's length is physics-derived (finalCoastDays). ----------------
	var originRow = document.createElement("div"); originRow.className = "mp-inrow";
	var originLab = document.createElement("label"); originLab.textContent = "origin"; originRow.appendChild(originLab);
	var originSel = document.createElement("select");
	ORIGIN_BODIES.forEach(function (name) {
		var opt = document.createElement("option"); opt.value = name; opt.textContent = name;
		if (name === state.origin) { opt.selected = true; }
		originSel.appendChild(opt);
	});
	originRow.appendChild(originSel); depHost.appendChild(originRow);
	var originInfo = muted(depHost, "");
	// Only meaningful while an exit point is ADOPTED from a pasted mission:
	// drops back to deriving it from the current heading (departureState).
	var handoffResetBtn = document.createElement("button");
	handoffResetBtn.type = "button";
	handoffResetBtn.className = "mp-btn mp-ghost";
	handoffResetBtn.textContent = "re-derive exit point";
	handoffResetBtn.title = "Stop using the pasted mission's own SOI exit point and put it " +
		"back on the current heading, one SOI radius out.";
	handoffResetBtn.style.display = "none";
	handoffResetBtn.addEventListener("click", function () {
		state.handoff = { mode: "derived", offset: null };
		refresh();
	});
	depHost.appendChild(handoffResetBtn);
	var depMoon = buildMoonWidget(depHost, "Moon phase at launch");

	// A different origin means a different SOI entirely, so an adopted exit
	// point no longer describes anything — back to deriving it. The destination
	// list narrows with the origin too.
	originSel.addEventListener("change", function () {
		state.origin = originSel.value;
		state.handoff = { mode: "derived", offset: null };
		legStart = null;
		rebuildDestinationOptions();
		refresh();
	});

	depBurnHost = document.createElement("div"); depHost.appendChild(depBurnHost);
	buildVectorEditor(depBurnHost, state.leg.burn, function (axis, mps) {
		state.leg.burn[axis] = mps; refresh();
	});
	var depReadout = muted(depHost, "");

	var destRow = document.createElement("div"); destRow.className = "mp-inrow";
	var destLab = document.createElement("label"); destLab.textContent = "destination"; destRow.appendChild(destLab);
	var destSel = document.createElement("select");
	// Which bodies this origin may aim at. Never the origin itself; and never
	// Earth from the Moon, because that flight never leaves Earth's sphere of
	// influence and so is not a coast between two heliocentric states at all —
	// it is one cislunar transfer, which this tab does not author.
	function destinationsFor(origin) {
		return DESTINATION_BODIES.filter(function (name) {
			if (name === origin) { return false; }
			if (origin === "Moon" && name === "Earth") { return false; }
			return true;
		});
	}
	function rebuildDestinationOptions() {
		var allowed = destinationsFor(state.origin);
		if (state.leg.destination && allowed.indexOf(state.leg.destination) < 0) {
			state.leg.destination = "";
		}
		destSel.innerHTML = "";
		["(none)"].concat(allowed).forEach(function (name) {
			var opt = document.createElement("option");
			opt.value = name === "(none)" ? "" : name;
			opt.textContent = name;
			if (opt.value === state.leg.destination) { opt.selected = true; }
			destSel.appendChild(opt);
		});
	}
	rebuildDestinationOptions();
	destRow.appendChild(destSel); depHost.appendChild(destRow);
	var destInfo = muted(depHost, "");
	var arrMoon = buildMoonWidget(depHost, "Moon phase at arrival");
	destSel.addEventListener("change", function () { state.leg.destination = destSel.value; refresh(); });

	// ==== Waypoints card: up to MAX_WAYPOINTS, each with snap-to + burn -------
	var wpAddBtn = document.createElement("button");
	wpAddBtn.className = "mp-btn mp-ghost"; wpAddBtn.textContent = "+ add waypoint";
	wpAddBtn.addEventListener("click", function () {
		var wps = state.leg.waypoints;
		var day = wps.length ? Math.min(wps[0].days + 60, state.leg.legDays - 10) : Math.round(state.leg.legDays / 2);
		wps.push({ days: day, burn: { pro: 0, rad: 0, nrm: 0 }, snap: null, snapOffset: 0 });
		rebuildWaypointRows();
		refresh();
	});

	function removeWaypoint(idx) {
		state.leg.waypoints.splice(idx, 1);
		rebuildWaypointRows();
		refresh();
	}

	// Rebuilds the DOM (called when the waypoint COUNT changes); per-recompute
	// label/availability refresh is updateWaypointRowUI, not this.
	function rebuildWaypointRows() {
		wpHost.innerHTML = "";
		wpRows = [];
		state.leg.waypoints.forEach(function (wp, idx) {
			var card = document.createElement("div"); card.className = "mp-card";
			var head = document.createElement("div"); head.className = "mp-wp-head";
			head.textContent = "waypoint " + (idx + 1);
			var rm = document.createElement("button"); rm.className = "mp-btn"; rm.textContent = "remove";
			rm.addEventListener("click", function () { removeWaypoint(idx); });
			head.appendChild(rm); card.appendChild(head);

			var dayInput = numRow(card, "at day", "", wp.days, 5, function (v) {
				state.leg.waypoints[idx].days = v; refresh();
			});

			// snap-to controls: place the waypoint on a chosen orbital feature.
			// Mutually exclusive — checking one clears the others (updateWaypointRowUI
			// re-syncs all three from the single wp.snap field each recompute).
			var snapRow = document.createElement("div"); snapRow.className = "mp-wp-snaps";
			var snapBoxes = {};
			[["apsis", "apoapsis"], ["asc", "ascending node"], ["desc", "descending node"]].forEach(function (d) {
				var lab = document.createElement("label"); lab.className = "mp-wp-snap";
				var cb = document.createElement("input"); cb.type = "checkbox";
				var txt = document.createElement("span"); txt.textContent = d[1];
				cb.addEventListener("change", function () {
					state.leg.waypoints[idx].snap = cb.checked ? d[0] : null;
					refresh();
				});
				snapBoxes[d[0]] = { cb: cb, txt: txt, lab: lab };
				lab.appendChild(cb); lab.appendChild(txt); snapRow.appendChild(lab);
			});
			card.appendChild(snapRow);

			// fine-tune slider: slides the waypoint +/-90deg along the arc,
			// centred on the snapped feature. Active only while a snap is chosen.
			var slider = document.createElement("input");
			slider.type = "range"; slider.className = "mp-wp-slider";
			slider.min = -90; slider.max = 90; slider.step = 1;
			slider.value = Math.round((wp.snapOffset || 0) * 180 / Math.PI);
			slider.disabled = !wp.snap;
			slider.title = "slide ±90° along the arc, around the snapped point";
			slider.addEventListener("input", function () {
				state.leg.waypoints[idx].snapOffset = parseFloat(slider.value) * Math.PI / 180;
				refresh();
			});
			card.appendChild(slider);

			var info = muted(card, "");

			var burnHost = document.createElement("div"); card.appendChild(burnHost);
			buildVectorEditor(burnHost, wp.burn, function (axis, mps) {
				state.leg.waypoints[idx].burn[axis] = mps; refresh();
			});

			wpHost.appendChild(card);
			wpRows.push({ card: card, dayInput: dayInput, snapBoxes: snapBoxes, slider: slider,
			              info: info, host: burnHost });
		});
		wpAddBtn.style.display = state.leg.waypoints.length < MAX_WAYPOINTS ? "" : "none";
		wpHost.appendChild(wpAddBtn);
	}
	rebuildWaypointRows();

	// ==== snap-to resolution: turns each waypoint's {snap, snapOffset} into
	// a concrete `days` (absolute, from leg start) before computeLeg ever
	// sees it — computeLeg's own contract only knows `days`, matching
	// transfer-leg's params exactly. Walks the waypoints in chronological
	// order (their OWN `days`, pre-snap) so each snap resolves against the
	// state at ITS segment's start, same as the SST's computeTrajectory()
	// loop; returns { entries, finalR, finalV, tPrev } — entries in
	// ORIGINAL array order so the caller can zip them back up with wpRows by
	// index, and the trailing state (after the last waypoint's burn, or the
	// hand-off itself if there are none) for finalCoastDays to size the drawn
	// arc's last segment from. r0/v0 IS the hand-off state (departureState) —
	// the coast's own start, with no burn left to apply at that seam. `days`
	// are counted from it, the same zero core/freeze.js commits.
	// -------------------------------------------------------------------------
	function resolveWaypoints(r0, v0, leg) {
		var entries = leg.waypoints.map(function (wp, i) {
			return { originalIndex: i, days: wp.days, burn: wp.burn,
			         snap: wp.snap, snapOffset: wp.snapOffset || 0 };
		});
		entries.sort(function (a, b) { return (a.days || 0) - (b.days || 0); });

		// The first segment's own "which apsis does this lead to" label still
		// reads the departure vector's shape (a prograde hand-off leaves near
		// the arc's periapsis, and so on) — but nothing is APPLIED here: the
		// hand-off velocity already is what it is.
		var segR = r0, segV = v0, segBurn = leg.burn, tPrev = 0;
		entries.forEach(function (e) {
			var ap = O.apsisFromBurn(segBurn);
			var apsisOK = ap.available &&
				!(ap.label === "apoapsis" && O.elementsFromState(GM_SUN, segR, segV).e >= 1);
			e.apsisLabel = ap.label;
			e.apsisAvailable = apsisOK;
			var ni = O.nodeInfo(GM_SUN, segR, segV);
			e.nodeLabel = ni;
			var snap = (e.snap === "apsis" && !apsisOK) ? null : e.snap;
			e.resolvedSnap = snap;
			if (snap) {
				var tauS = O.snapTau(GM_SUN, segR, segV, segBurn, snap, e.snapOffset);
				if (tauS != null) { e.days = tPrev + tauS / DAY; }
			}
			var durS = Math.max(0, (e.days || 0) - tPrev) * DAY;
			var end = O.propagateState(GM_SUN, segR, segV, durS);
			e.preR = end.r; e.preV = end.v;
			segV = O.applyBurn(end.r, end.v, e.burn.pro || 0, e.burn.nrm || 0, e.burn.rad || 0);
			segR = end.r; segBurn = e.burn; tPrev = e.days || tPrev;
		});

		entries.sort(function (a, b) { return a.originalIndex - b.originalIndex; });
		return { entries: entries, finalR: segR, finalV: segV, tPrev: tPrev };
	}

	// How long to draw the leg's FINAL segment (after the last waypoint, or
	// after the departure burn if there are none): one orbital period if bound,
	// capped so a near-parabolic orbit doesn't draw for millennia, else a fixed
	// multi-year escape coast. No mission condition decides this — it's a
	// simplified-conic heuristic, so a bound transfer visibly closes into a loop
	// and an escape trajectory just trails off.
	//
	// The 500-year cap is sized for the farthest body the helio frame draws:
	// HELIO_BODIES includes Pluto (scene-frames.js), and a perfectly elliptical
	// Earth-departure transfer reaching only its vicinity already has a ~75-125
	// year period (a ≈ 18-25 AU via vis-viva). 500 years comfortably covers a
	// full loop out past Pluto's aphelion (~49 AU) from any inner-system origin,
	// so genuinely bound loops close on screen instead of being cut off and
	// looking like escapes; anything tighter cuts them. Returns days.
	function finalCoastDays(r, v) {
		var el = O.elementsFromState(GM_SUN, r, v);
		if (el.e < 1 && el.a > 0) {
			var periodS = 2 * Math.PI * Math.sqrt(Math.pow(el.a, 3) / GM_SUN);
			return Math.min(periodS / DAY, 500 * 365.25);
		}
		return 12 * 365.25;
	}

	// Sync one waypoint row's snap checkboxes/labels/slider/info from its
	// resolved entry, and persist an auto-cleared "apsis went unavailable"
	// back to state (mirrors the SST's own behaviour: the checkbox visibly
	// unchecks itself when a zero burn removes the apsis it was snapped to).
	function updateWaypointRowUI(row, e, idx) {
		if (e.resolvedSnap !== e.snap) { state.leg.waypoints[idx].snap = e.resolvedSnap; }
		// While snapped, persist the resolved day back to state (matching the
		// SST this was ported from, which mutates the waypoint in place) — so
		// unchecking the snap later leaves the day where it last resolved,
		// rather than reverting to a stale typed value from before snapping.
		if (e.resolvedSnap) { state.leg.waypoints[idx].days = e.days; }

		var ab = row.snapBoxes.apsis;
		ab.txt.textContent = e.apsisLabel;
		ab.cb.disabled = !e.apsisAvailable;
		ab.lab.style.opacity = e.apsisAvailable ? "" : "0.4";
		ab.lab.title = e.apsisAvailable ? "" : "needs a prograde or retrograde impulse on this leg";
		row.snapBoxes.asc.txt.textContent = e.nodeLabel.ascLabel;
		row.snapBoxes.desc.txt.textContent = e.nodeLabel.descLabel;
		["apsis", "asc", "desc"].forEach(function (k) {
			row.snapBoxes[k].cb.checked = (e.resolvedSnap === k);
		});
		row.slider.disabled = !e.resolvedSnap;

		if (document.activeElement !== row.dayInput) { row.dayInput.value = Math.round(e.days); }
		row.dayInput.disabled = !!e.resolvedSnap;

		var wpDv = Math.hypot(e.burn.pro || 0, e.burn.nrm || 0, e.burn.rad || 0);
		row.info.textContent = "+" + Math.round(e.days) + " d, " + (O.vMag(e.preR) / AU).toFixed(3) +
			" AU from Sun, coast speed " + fmtKmS(O.vMag(e.preV)) + " km/s. Δv = " + fmtKmS(wpDv) + " km/s.";
	}

	// ==== burn readouts + arrows (Shared/sim/burn-widget.js, readout-panes.js) --
	function burnReadoutData(r, vBefore, burn) {
		var mag = Math.hypot(burn.pro || 0, burn.nrm || 0, burn.rad || 0);
		if (mag < 1) { return null; }
		var vAfter = O.applyBurn(r, vBefore, burn.pro || 0, burn.nrm || 0, burn.rad || 0);
		var iBefore = O.elementsFromState(GM_SUN, r, vBefore).i;
		var iAfter = O.elementsFromState(GM_SUN, r, vAfter).i;
		return {
			burnDv: mag / 1000,
			planeChange: (iAfter - iBefore) * 180 / Math.PI,
			progradeDv: (O.vMag(vAfter) - O.vMag(vBefore)) / 1000
		};
	}

	// The same three figures for a MOON origin's release, which is a geocentric
	// impulse on the Moon's own motion, not a heliocentric excess: the plane
	// change is against the Moon's geocentric orbit plane, and "prograde" is
	// along the Moon's geocentric velocity. Reading them heliocentrically
	// instead would report a plane change against the ecliptic, where the whole
	// 1 km/s of the Moon's motion already sits at 5 degrees.
	function lunarReleaseReadout() {
		var b = state.leg.burn;
		var mag = Math.hypot(b.pro || 0, b.nrm || 0, b.rad || 0);
		if (mag < 1) { return null; }
		var mR = moonGeoPos(dateState.jd), mV = moonGeoVel(dateState.jd);
		var after = releaseVelocity(dateState.jd, b);
		return {
			burnDv: mag / 1000,
			planeChange: (O.elementsFromState(GM_EARTH, mR, after).i
			              - O.elementsFromState(GM_EARTH, mR, mV).i) * 180 / Math.PI,
			progradeDv: (O.vMag(after) - O.vMag(mV)) / 1000
		};
	}

	// Drawn at the Moon's heliocentric position, since that is where the
	// release happens in the scene. The vectors are the geocentric impulse and
	// the speed it adds to the Moon's own motion — directions carry across
	// frames unchanged, which is why the arrow pair can be reused as is.
	function addLunarReleaseArrows(rHelio) {
		var b = state.leg.burn;
		if (Math.hypot(b.pro || 0, b.nrm || 0, b.rad || 0) < 1) { return; }
		var mV = moonGeoVel(dateState.jd);
		var after = releaseVelocity(dateState.jd, b);
		var dSpeedVec = O.vScale(O.vUnit(after), O.vMag(after) - O.vMag(mV));
		var origin = new THREE.Vector3(rHelio[0] / AU, rHelio[1] / AU, rHelio[2] / AU);
		var pair = makeBurnArrowPair(origin, dSpeedVec, O.vSub(after, mV), DSPEED_COLOR, DV_COLOR);
		[pair.spdArrow, pair.dvArrow].forEach(function (a) { if (a) { frame.scene.add(a); burnArrows.push(a); } });
	}

	function addBurnArrowsAt(r, vBefore, burn) {
		var vAfter = O.applyBurn(r, vBefore, burn.pro || 0, burn.nrm || 0, burn.rad || 0);
		var dSpeed = O.vMag(vAfter) - O.vMag(vBefore);
		var dSpeedVec = O.vScale(O.vUnit(vAfter), dSpeed);
		var origin = new THREE.Vector3(r[0] / AU, r[1] / AU, r[2] / AU);
		var pair = makeBurnArrowPair(origin, dSpeedVec, O.vSub(vAfter, vBefore), DSPEED_COLOR, DV_COLOR);
		[pair.spdArrow, pair.dvArrow].forEach(function (a) { if (a) { frame.scene.add(a); burnArrows.push(a); } });
	}
	function dot(rM, colorHex, sizePx) {
		var g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(
			new Float32Array([rM[0] / AU, rM[1] / AU, rM[2] / AU]), 3));
		var p = new THREE.Points(g, new THREE.PointsMaterial({
			color: colorHex, size: sizePx, sizeAttenuation: false, transparent: true, depthTest: false }));
		endDots.push(p);
		return p;
	}

	function clearDrawn() {
		if (trajLine) { frame.scene.remove(trajLine); trajLine.geometry.dispose(); trajLine.material.dispose(); trajLine = null; }
		endDots.forEach(function (p) { frame.scene.remove(p); p.geometry.dispose(); p.material.dispose(); });
		endDots = [];
		wpMarkers.forEach(function (m) { frame.scene.remove(m); });
		wpMarkers = [];
		burnArrows.forEach(function (a) { frame.scene.remove(a); });
		burnArrows = [];
	}

	function setStatus(cls, text) {
		statusChip.className = "mp-chip mp-eph-status" + (cls ? " " + cls : "");
		statusChip.textContent = text;
	}

	// =======================================================================
	//  Ship marker: a slidable probe on the drawn trajectory, with Free / Target
	//  modes, over this view's trajSegs/trajTotalT representation.
	//  Mechanics (sprites, card skeleton, slider physics, the closest-approach
	//  search) come from Shared/sim/marker-card.js; placement is click-to-place
	//  on the drawn path (see handlePick below), with no placement button.
	// =======================================================================
	// The card ALWAYS exists: buildCard() runs at init, and while no marker is
	// placed the card shows only the hint, the gated "Start Mission Plan" button
	// (with its why-note), and "Paste mission link…" — the marker controls are
	// CSS-hidden via .mp-empty.
	var markerHost = q(".mp-eph-marker");
	var markerHint = null;   // assigned by buildCard()
	var HINT_DEFAULT = "Click the drawn trajectory to place a marker: probes radius, speed, " +
		"flight time, and the destination's phasing at any point along it.";
	function setHint(text) { if (markerHint) { markerHint.textContent = text; } }
	function setCardEmpty(empty) { if (mk) { mk.el.classList.toggle("mp-empty", empty); } }

	// Heliocentric state (r,v in m, m/s) at a global time along the path.
	function stateAtGlobalTime(t) {
		if (!trajSegs.length) { return null; }
		var seg = trajSegs[trajSegs.length - 1];
		for (var i = 0; i < trajSegs.length; i++) {
			if (t <= trajSegs[i].tStart + trajSegs[i].dur + 1e-6) { seg = trajSegs[i]; break; }
		}
		var dt = Math.max(0, Math.min(seg.dur, t - seg.tStart));
		return O.propagateState(GM_SUN, seg.r0, seg.v0, dt);
	}

	// Heliocentric angle (deg, 0–360) swept around the Sun from the flight's
	// start (the SOI-edge point) to r (m) — Shared/sim/marker-card.js's
	// sweepAngleFrom.
	function sweptFromOrigin(r) {
		if (!trajSegs.length) { return 0; }
		var s = { r: trajSegs[0].r0, v: trajSegs[0].v0 };
		return sweepAngleFrom(s.r, s.v, r);
	}

	// ==== the hand-off: where and how fast the drawn arc starts ---------------
	// The one place the departure card's numbers become a ship state. TWO
	// DIFFERENT THINGS happen here depending on the origin, because a Moon
	// departure is authored in the opposite direction from every other one.
	//
	// EVERY ORIGIN BUT THE MOON — the card IS the hand-off. It holds
	// v-infinity in the body's own prograde/radial/normal frame, so the
	// hand-off velocity is the body's heliocentric velocity plus that vector
	// (O.applyBurn is exactly that sum, and O.burnComponents its exact
	// inverse, which is what makes the freeze/paste round trip lossless), and
	// the epoch is the clock's. The position is the body's plus an offset onto
	// its SOI sphere:
	//   derived  — one SOI radius along the outbound asymptote (the heading
	//              itself), so editing the card moves the exit point with it;
	//   adopted  — the body-relative offset a pasted mission's departure chain
	//              actually produced, held fixed (see loadFrozenPlanIntoState).
	// A ship with no meaningful v-infinity has no asymptote to sit on and no
	// flight to start, so it departs from the body's own position.
	//
	// A MOON ORIGIN — the card is the RELEASE, and the hand-off is flown to.
	// Its three numbers are an impulse in the MOON's own geocentric frame, the
	// clock is when the ship leaves the Moon, and core/lunar-departure.js
	// integrates Earth + Moon + Sun forward from there to Earth's SOI. The
	// crossing's position, velocity and EPOCH are all outputs, so the drawn arc
	// begins days after the date on the bar. That is the point of the whole
	// arrangement: the Moon's ~1 km/s points a different way every day of the
	// month, and letting it reach the hand-off is what makes the launch date
	// change where the trajectory goes (see core/lunar-departure.js's header).
	// Nothing is derived or adopted for this origin — the exit point is flown.
	//
	// Returns { body, r, v, jd, vInfVec, vInf, offset, adopted, lunar }, where
	// `jd` is the epoch of the returned state — the clock, except for a Moon
	// origin, where it is the flown SOI crossing.
	//
	// `body` is the ESCAPE REFERENCE's state, not always the origin's: for a
	// Moon origin the ship crosses EARTH's sphere of influence, at Earth's
	// distance and carrying Earth's heliocentric velocity, so Earth is what
	// the resulting v∞ is measured against (Shared/frames.js's
	// escapeReferenceFor).
	function departureState() {
		var out = state.origin === "Moon" ? lunarDepartureState() : simpleDepartureState();
		legStart = out.jd;
		return out;
	}

	// A Moon origin: fly the card forward and report where it comes out. A
	// flight that never escapes still returns a state — the Moon's own, with
	// no v∞ — so the tab keeps drawing something and the card reports why.
	function lunarDepartureState() {
		var lunar = flyLunarDeparture({ jd: dateState.jd, burn: state.leg.burn });
		if (!lunar.ok) {
			var m = Frames.bodyHelioState("Moon", dateState.jd);
			return { body: m, r: m.r, v: m.v, jd: dateState.jd,
			         vInfVec: [0, 0, 0], vInf: 0, offset: [0, 0, 0],
			         adopted: false, lunar: lunar };
		}
		var body = Frames.bodyHelioState("Earth", lunar.exit.jd);
		return {
			body: body,
			r: O.vAdd(body.r, lunar.exit.r),
			v: O.vAdd(body.v, lunar.exit.v),
			jd: lunar.exit.jd,
			vInfVec: lunar.exit.v.slice(),      // geocentric at the crossing
			vInf: O.vMag(lunar.exit.v),
			offset: lunar.exit.r.slice(),
			adopted: false,
			lunar: lunar
		};
	}

	function simpleDepartureState() {
		var refName = Frames.escapeReferenceFor(state.origin);
		var body = Frames.bodyHelioState(refName, dateState.jd);
		var b = state.leg.burn;
		var v = O.applyBurn(body.r, body.v, b.pro || 0, b.nrm || 0, b.rad || 0);
		var vInfVec = O.vSub(v, body.v), vInf = O.vMag(vInfVec);
		var adopted = state.handoff.mode === "adopted" && state.handoff.offset;
		var offset;
		if (adopted) {
			offset = state.handoff.offset;
		} else {
			var R = originSoiRadius(state.origin);
			offset = (R > 0 && vInf > 1e-6) ? O.vScale(O.vUnit(vInfVec), R) : [0, 0, 0];
		}
		return { body: body, r: O.vAdd(body.r, offset), v: v, jd: dateState.jd,
		         vInfVec: vInfVec, vInf: vInf, offset: offset, adopted: !!adopted,
		         lunar: null };
	}

	// How long the departure phase lasts and when it starts. For a Moon origin
	// both are measured off the flight that was just flown — the release epoch
	// IS the clock. Every other origin estimates it backwards from the
	// hand-off, which is all that is knowable there.
	function departureEstimateFor(hand) {
		if (state.origin === "Moon") {
			return hand.lunar.ok
				? { ok: true, seconds: hand.lunar.flightDays * DAY, days: hand.lunar.flightDays,
				    jdLaunch: hand.lunar.jdRelease, profile: "lunar-integrated",
				    vInf: hand.vInf, flight: hand.lunar }
				: { ok: false, reason: hand.lunar.reason };
		}
		return estimateDeparture({ origin: state.origin, vInfVec: hand.vInfVec,
			jdHandoff: dateState.jd });
	}

	// The card carries no hand-off prose — the numbers it would have stated are
	// already on the card itself (the vector), the date bar (the epoch) and the
	// Moon widget (the release lead). All that is left to keep in sync is the
	// re-derive control, which only means anything while an exit point is
	// ADOPTED from a pasted mission.
	function updateHandoffControls(hand) {
		handoffResetBtn.style.display = hand.adopted ? "" : "none";
	}

	// The burn Target mode re-solves: the departure burn if there are no
	// waypoints, else the CHRONOLOGICALLY last waypoint's (waypoints here
	// carry absolute days and may sit in the array out of order — the SST's
	// were inherently ordered, per-segment taus).
	function terminalBurnRef() {
		var wps = state.leg.waypoints;
		if (!wps.length) { return { burn: state.leg.burn, isDeparture: true, index: -1 }; }
		var idx = 0;
		for (var i = 1; i < wps.length; i++) {
			if ((wps[i].days || 0) >= (wps[idx].days || 0)) { idx = i; }
		}
		return { burn: wps[idx].burn, isDeparture: false, index: idx };
	}

	// Keep the marker glued to the destination-orbit crossing while it is
	// inside an encounter ring; freeze when out of range
	// (Shared/sim/marker-card.js). Used by released Target.
	function followCrossing() {
		if (!state.marker || !trajSegs.length) { return; }
		var dn = state.leg.destination;
		if (!dn || dn === state.origin) { return; }
		var orbit = systems.get(dn).orbit;
		mcFollowCrossing(state.marker, orbit, trajTotalT, trajSampleCount, stateAtGlobalTime, APPROACH_FAR);
	}

	// Target mode: hold the arrival date fixed and re-solve the TERMINAL
	// impulse via Lambert so the ship still reaches the destination body at
	// that arrival time as the hand-off date scrubs. The terminal impulse is
	// either a waypoint burn or — with no waypoints — the DEPARTURE HAND-OFF
	// itself, in which case what gets re-solved is the v-infinity the
	// departure tech has to deliver. Either way the solved figure is measured
	// against the same reference the card shows it in, so the budget is read
	// in the units the row is labelled with. Over budget it "releases": the
	// vector reverts to its captured baseline and the marker falls back to
	// geometric tracking. Runs at the start of refresh(), before anything is
	// drawn, so the drawn arc reflects the solve. Decomposition is via
	// O.burnComponents — the exact inverse of the O.applyBurn departureState
	// re-applies it with (see header).
	function applyTargeting() {
		var m = state.marker;
		if (!m || m.mode !== "target") { return; }
		var term = terminalBurnRef();
		function restoreBase() {
			if (m._baseBurn) {
				term.burn.pro = m._baseBurn.pro; term.burn.rad = m._baseBurn.rad; term.burn.nrm = m._baseBurn.nrm;
			}
		}
		function hardFail(msg) { restoreBase(); m._encT = null; m._targetDv = null; m._released = true; m._targetMsg = msg; }

		var dn = state.leg.destination;
		if (!dn || dn === state.origin || m.targetArrJd == null) { hardFail("no target"); return; }
		var destOrbit = systems.get(dn).orbit;
		if (!destOrbit || destOrbit.e >= 1) { hardFail("no target"); return; }

		// The point and reference velocity the solve works from. For a waypoint
		// it is that waypoint's pre-burn state, walked down the leg that will
		// actually be DRAWN. For the departure it is the hand-off's own
		// position, referenced to the ORIGIN BODY's velocity — so the solved
		// vector is a v-infinity, decomposed in the frame the card holds.
		//
		// A derived exit point sits on the heading, so re-solving the heading
		// moves it: solve, re-place the exit point on the answer, solve once
		// more. Two bounded passes, never an iteration — and with an adopted
		// exit point the second pass is a no-op, because the geometry is fixed.
		function frameAt() {
			var hand = departureState();
			if (term.isDeparture) {
				return { r1: hand.r, v1: hand.body.v, ref: hand.body, t1g: 0 };
			}
			var rw = resolveWaypoints(hand.r, hand.v, state.leg);
			var e = rw.entries[term.index];
			if (!e || !e.preR) { return null; }
			return { r1: e.preR, v1: e.preV, ref: { r: e.preR, v: e.preV }, t1g: (e.days || 0) * DAY };
		}

		var f = frameAt();
		if (!f) { hardFail("no leg"); return; }
		var r1 = f.r1, v1 = f.v1, t1g = f.t1g, ref = f.ref;

		var tof = (m.targetArrJd - legStartJd()) * DAY - t1g;
		if (!(tof > DAY)) { hardFail("arrival ≤ burn"); return; }
		var target = O.bodyStateAtJD(GM_SUN, destOrbit, m.targetArrJd).r;
		var sol = O.lambert(GM_SUN, r1, target, tof, true);
		if (!sol) { hardFail("no solution"); return; }

		var dv = O.vSub(sol.v1, v1), dvMag = O.vMag(dv);
		var c = O.burnComponents(ref.r, ref.v, dv);

		// Second pass: with the vector above in force the derived exit point
		// has moved onto the new heading, so re-solve from where the ship
		// actually leaves. Nothing is committed until after the budget check.
		if (term.isDeparture && state.handoff.mode !== "adopted") {
			var keep = { pro: term.burn.pro, rad: term.burn.rad, nrm: term.burn.nrm };
			term.burn.pro = c.pro; term.burn.nrm = c.nrm; term.burn.rad = c.rad;
			var f2 = frameAt();
			term.burn.pro = keep.pro; term.burn.rad = keep.rad; term.burn.nrm = keep.nrm;
			if (f2) {
				var sol2 = O.lambert(GM_SUN, f2.r1, target, tof, true);
				if (sol2) {
					dv = O.vSub(sol2.v1, f2.v1); dvMag = O.vMag(dv);
					c = O.burnComponents(f2.ref.r, f2.ref.v, dv);
				}
			}
		}

		m._targetDv = dvMag; m._targetMsg = null;
		if (dvMag > (m.dvBudget || 0)) { restoreBase(); m._encT = null; m._released = true; return; }   // over budget

		term.burn.pro = c.pro; term.burn.nrm = c.nrm; term.burn.rad = c.rad;
		m._encT = t1g + tof; m._released = false;
	}

	// Switch the marker behaviour. Entering Target freezes the current
	// arrival date and snapshots BOTH the terminal burn and the marker's own
	// position (so each can be restored); leaving Target restores that manual
	// burn and puts the marker back where it was. Restoring the position is
	// what keeps repeated Free<->Target toggles stable: the held arrival date
	// is derived from the marker's path-fraction, and the fraction means
	// different absolute times under the solved arc vs the manual arc, so
	// feeding a drifted fraction back in would walk the arrival date — and
	// the required Δv — further each round trip until it released.
	function setMarkerMode(mode, keepBurn) {
		var m = state.marker;
		if (!m) { return; }
		var term = terminalBurnRef().burn;
		if (m.mode === "target" && mode !== "target" && m._baseBurn && !keepBurn) {
			term.pro = m._baseBurn.pro; term.rad = m._baseBurn.rad; term.nrm = m._baseBurn.nrm;
			m._baseBurn = null;
			if (m._savedF0 != null) { m.f0 = m._savedF0; m.angle = m._savedAngle; m._savedF0 = null; }
		}
		if (mode === "target") {
			m._savedF0 = m.f0; m._savedAngle = m.angle;      // restore here on leaving Target
			// The date to hold is the trajectory's OWN closest approach to the
			// destination (destApproach) — the same fixed point the card's
			// arrival / phasing / capture rows report. Taking it from the
			// marker's scrub position instead would ask Lambert to put the ship
			// at the body wherever the chevron happens to sit, so a plan whose
			// proximity is already satisfied could still solve to an absurd Δv
			// and release. Only with no approach at all (no destination, no
			// valid path) does the marker's own time stand in.
			var tof = (destApproach && destApproach.t != null)
				? destApproach.t
				: mcMarkerFraction(m.f0, m.angle) * trajTotalT;
			m.targetArrJd = legStartJd() + tof / DAY;        // hold this arrival date
			m._baseBurn = { pro: term.pro || 0, rad: term.rad || 0, nrm: term.nrm || 0 };
			if (m.dvBudget == null) { m.dvBudget = 10000; }
			m._released = false;
		}
		m.mode = mode;
		updateModeButtons();
		refresh();
	}

	function updateModeButtons() {
		if (mk) { mcUpdateMarkerModeButtons(mk.modeBtns, "mp", state.marker && state.marker.mode); }
	}

	// A temporal-proximity ring around the ship (Shared/sim/approach-markers.js).
	function makeTempRing() { return makeRingSprite({ lineWidth: 7, px: 30, renderOrder: 13 }); }

	// =======================================================================
	//  Orbit-approach rings: where the drawn path passes near the selected
	//  destination's orbit *ring*. Scans the path for local minima of
	//  distance-to-that-orbit, then refines each with a golden-section search
	//  over the true Kepler arc, so the result is not limited by polyline
	//  spacing. The ring-sprite mechanics are shared
	//  (Shared/sim/approach-markers.js); the scan and tier tables stay local,
	//  the same split as the temporal ring above. Unlike the SST's own
	//  trajSamples (THREE.Vector3, pre-scaled to AU), this view's leg.samples
	//  stay in metres throughout, so the scan needs no AU round-trip.
	// =======================================================================
	function makeApproachRing(tier) {
		var st = SPACE_TIERS[tier] || SPACE_TIERS[0];
		return makeRingSprite({ lineWidth: st.lw, color: st.color, opacity: st.opacity,
			px: st.px, worldR: st.worldR, renderOrder: 14 });
	}
	function clearApproachMarks() {
		orbitApproachMarks.forEach(function (m) { frame.scene.remove(m); if (m.material) { m.material.dispose(); } });
		orbitApproachMarks = [];
	}
	function rebuildApproachMarks() {
		clearApproachMarks();
		computeOrbitApproaches().forEach(function (c) {
			var sp = makeApproachRing(c.tier);
			sp.position.copy(c.pos);
			frame.scene.add(sp); orbitApproachMarks.push(sp);
		});
	}
	// A cheap per-sample pre-filter (out-of-plane gap + in-plane radial band)
	// keeps the exact point-to-ellipse solve (O.distancePointEllipse) to the
	// few samples that are actually near, before refining each local minimum.
	function computeOrbitApproaches() {
		var out = [];
		var name = state.leg.destination;
		if (!name || name === state.origin) { return out; }
		if (trajSamples.length < 3 || !trajSegs.length) { return out; }
		var GATE = 0.012 * AU, CAND = 0.006 * AU;
		var orbit = systems.get(name).orbit;
		if (!orbit || orbit.e >= 1) { return out; }
		var a = orbit.a, e = orbit.e;
		var iI = orbit.inclination || 0, Om = orbit.longitude || 0, w = orbit.argument || 0;
		var cO = Math.cos(Om), sO = Math.sin(Om), ci = Math.cos(iI), si = Math.sin(iI),
		    cw = Math.cos(w), sw = Math.sin(w);
		var ux = cO*cw - sO*sw*ci, uy = sO*cw + cO*sw*ci, uz = sw*si;
		var vx = -cO*sw - sO*cw*ci, vy = -sO*sw + cO*cw*ci, vz = cw*si;
		var A = Math.abs(a), B = A * Math.sqrt(Math.max(0, 1 - e * e));
		var ae = a * e, Cx = -ae*ux, Cy = -ae*uy, Cz = -ae*uz;
		var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
		var n = trajSamples.length, dists = new Array(n);
		for (var k = 0; k < n; k++) {
			var p = trajSamples[k].r;
			var wx = p[0] - Cx, wy = p[1] - Cy, wz = p[2] - Cz;
			var z = wx*nx + wy*ny + wz*nz;
			if (Math.abs(z) > GATE) { dists[k] = Infinity; continue; }
			var x = wx*ux + wy*uy + wz*uz, yy = wx*vx + wy*vy + wz*vz;
			var rho = Math.hypot(x, yy);
			if (rho < B - GATE || rho > A + GATE) { dists[k] = Infinity; continue; }
			dists[k] = Math.hypot(O.distancePointEllipse(A, B, x, yy), z);
		}
		for (var m = 1; m < n - 1; m++) {
			if (dists[m] < CAND && dists[m] < dists[m-1] && dists[m] <= dists[m+1]) {
				var r = mcRefineApproach(orbit, stateAtGlobalTime, trajSamples[m-1].t, trajSamples[m+1].t);
				var tier = r ? pickProximityTier(r.dist, APPROACH_FAR, APPROACH_NEAR, APPROACH_CLOSE) : -1;
				if (tier >= 0) {
					out.push({ pos: new THREE.Vector3(r.r[0] / AU, r.r[1] / AU, r.r[2] / AU),
					           dist: r.dist, tier: tier, body: name });
				}
			}
		}
		return out;
	}

	// The trajectory's genuine closest approach to the current destination:
	// scan trajSamples for the global minimum of distance-to-the-BODY'S-OWN
	// position (not its orbit ellipse — the body is moving too, so this tracks
	// actual separation at matching times), then refine with a golden-section
	// search over the true Kepler arc so the result isn't limited by polyline
	// spacing. Unlike computeOrbitApproaches (which can flag several local
	// passes near the destination's orbit ring, for the scene), this is the
	// single global minimum against the destination's actual moving
	// position, used for the card's readouts.
	// Returns { r, v (ship, m/m/s), bodyR, bodyV, t (global s), jd, dist (m) }
	// or null when there's no destination or no valid trajectory.
	function computeDestinationApproach() {
		var dn = state.leg.destination;
		if (!dn || trajSamples.length < 2 || !(trajTotalT > 0)) { return null; }
		var orbit = systems.get(dn).orbit;
		function distAt(t) {
			var s = stateAtGlobalTime(t);
			if (!s) { return null; }
			var b = O.bodyStateAtJD(GM_SUN, orbit, legStartJd() + t / DAY);
			return { s: s, b: b, d: O.vMag(O.vSub(s.r, b.r)) };
		}
		var bestI = -1, bestD = Infinity;
		for (var i = 0; i < trajSamples.length; i++) {
			var t = trajSamples[i].t;
			var b = O.bodyStateAtJD(GM_SUN, orbit, legStartJd() + t / DAY);
			var d = O.vMag(O.vSub(trajSamples[i].r, b.r));
			if (d < bestD) { bestD = d; bestI = i; }
		}
		if (bestI < 0) { return null; }
		var tA = bestI > 0 ? trajSamples[bestI - 1].t : 0;
		var tB = bestI < trajSamples.length - 1 ? trajSamples[bestI + 1].t : trajTotalT;
		var gr = (Math.sqrt(5) - 1) / 2, a = tA, b2 = tB;
		function f(t) { var r = distAt(t); return r ? r.d : Infinity; }
		var c = b2 - gr * (b2 - a), d = a + gr * (b2 - a), fc = f(c), fd = f(d);
		for (var k = 0; k < 48 && (b2 - a) > 1; k++) {
			if (fc < fd) { b2 = d; d = c; fd = fc; c = b2 - gr * (b2 - a); fc = f(c); }
			else { a = c; c = d; fc = fd; d = a + gr * (b2 - a); fd = f(d); }
		}
		var tm = (a + b2) / 2, res = distAt(tm);
		if (!res) { return null; }
		return { r: res.s.r, v: res.s.v, bodyR: res.b.r, bodyV: res.b.v, t: tm,
			jd: legStartJd() + tm / DAY, dist: res.d };
	}

	// Refresh the card's arrival date / phasing / closest approach / capture
	// inclination rows from destApproach (computeDestinationApproach) — the
	// trajectory's own closest pass to the destination, a fixed property of
	// the drawn path that does not move when the marker is scrubbed.
	//
	// closeApproach alone is unconditional (it IS the "how close does this
	// trajectory ever get" answer, worth stating even for a wide miss). The
	// other three stay gated exactly as they were under marker-scrub-driven
	// values: arrival date only once the approach is within the space ring
	// (nearOrbit — the pass is close enough to call an encounter), phasing's
	// tier only once that pass is also timed close enough (timeOk), and
	// capture inclination only once both hold — short of that, "the plane
	// this capture would carry in" isn't describing an actual encounter.
	// "—" across all four when there's no destination or fix at all.
	function updateApproachReadouts() {
		if (!mk) { return; }
		if (!destApproach) {
			mk.vals.arr.textContent = "—"; mk.vals.phase.textContent = "—";
			mk.vals.closeApproach.textContent = "—"; mk.vals.captureIncl.textContent = "—";
			return;
		}
		var destSys = systems.get(state.leg.destination);
		var orbit = destSys.orbit;
		var altitude = destApproach.dist - (destSys.radius || 0);
		mk.vals.closeApproach.textContent = altitude >= 0
			? fmtKm(altitude)
			: "impact (" + fmtKm(-altitude) + " below surface)";

		var distToOrbit = orbit.e < 1 ? O.distanceToOrbit(orbit, destApproach.r) : Infinity;
		var nearOrbit = distToOrbit < APPROACH_FAR;
		mk.vals.arr.textContent = nearOrbit ? fmtDate(destApproach.jd) : "—";

		var timeOk = false;
		if (nearOrbit) {
			var dt = mcPhasingDays(GM_SUN, orbit, destApproach.r, destApproach.jd);
			mk.vals.phase.textContent = (dt >= 0 ? "+" : "−") + Math.abs(dt).toFixed(1) + " d";
			timeOk = pickProximityTier(Math.abs(dt), TEMP_FAR, TEMP_NEAR, TEMP_CLOSE) >= 0;
		} else {
			mk.vals.phase.textContent = "—";
		}

		if (nearOrbit && timeOk) {
			var rRel = O.vSub(destApproach.r, destApproach.bodyR);
			var vRel = O.vSub(destApproach.v, destApproach.bodyV);
			var inclDeg = O.relativeInclination(rRel, vRel, orbit) * 180 / Math.PI;
			mk.vals.captureIncl.textContent = inclDeg.toFixed(1) + "°" + (inclDeg > 90 ? " (retrograde)" : "");
		} else {
			mk.vals.captureIncl.textContent = "—";
		}
	}

	// Position the destination "×" (body at the marker's implied arrival) and
	// the temporal ring, given the meeting point markerR (m) and TOF (s) —
	// these track wherever the marker is scrubbed to, the manual side of
	// choosing a rendezvous. Also drives the "Start Mission Plan" gate:
	// enabled only when the marker sits inside BOTH closest-approach rings —
	// space (nearOrbit, the same APPROACH_FAR threshold as the space-ring
	// tiers) and time (the temporal ring's own tier >= 0). See
	// updateStartMissionButton. The card's arrival/phasing/closest-approach/
	// capture rows are NOT set here — see updateApproachReadouts.
	function updateDestinationMarker(markerR, tofSec) {
		var dn = state.leg.destination;
		if (!dn) {
			if (destSprite) { destSprite.visible = false; }
			if (destSoi) { destSoi.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			updateStartMissionButton({ hasDest: false });
			return;
		}
		var destSys = systems.get(dn);
		var orbit = destSys.orbit;
		var arrJd = legStartJd() + tofSec / DAY;
		var b = O.bodyStateAtJD(GM_SUN, orbit, arrJd);

		if (!destSprite) { destSprite = makeXMarkSprite(); destSprite.renderOrder = 13; frame.scene.add(destSprite); }
		destSprite.visible = true;
		destSprite.material.color.set(destSys.color || "#ffffff");
		destSprite.position.set(b.r[0] / AU, b.r[1] / AU, b.r[2] / AU);

		// A translucent sphere at the destination's true SOI radius, centred on
		// the same arrival point as the "×" — gives the marker's space-ring
		// proximity check (nearOrbit/APPROACH_FAR below) a visual sense of scale
		// against the body's actual capture zone.
		if (!destSoi) {
			destSoi = new THREE.Mesh(
				new THREE.SphereGeometry(1, 24, 16),
				new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
			destSoi.renderOrder = 12;
			frame.scene.add(destSoi);
		}
		destSoi.visible = true;
		destSoi.material.color.set(destSys.color || "#ffffff");
		destSoi.position.copy(destSprite.position);
		destSoi.scale.setScalar(soiRadiusAU(destSys, SUN.mass, AU));

		// The gate itself is core/proximity.js — the same predicate, and the
		// same two thresholds, mission-view.js gates "adopt delivered" on.
		// The ring SPRITES below are this view's own rendering of the tiers.
		var prox = checkProximity(GM_SUN, orbit, markerR, arrJd);
		var tier = prox.timeOk
			? pickProximityTier(Math.abs(prox.dtDays), TEMP_FAR, TEMP_NEAR, TEMP_CLOSE) : -1;
		if (tier >= 0) {
			if (!tempRing) { tempRing = makeTempRing(); frame.scene.add(tempRing); }
			applyTierToSprite(tempRing, TEMPORAL_TIERS[tier]);
			tempRing.visible = true;
			if (markerSprite) { tempRing.position.copy(markerSprite.position); }
		} else if (tempRing) { tempRing.visible = false; }

		updateStartMissionButton({ hasDest: true, prox: prox, destName: dn });
	}

	// Enable/disable the marker card's "Start Mission Plan" button and set its
	// explanatory note — which always says why, whether enabled or not. info:
	// { noMarker } or { hasDest, prox (core/proximity.js's verdict), destName }.
	// The no-marker case exists because the card is always visible, so the gate
	// has to explain itself before anything is placed too.
	function updateStartMissionButton(info) {
		if (!mk || !mk.startBtn) { return; }
		var reason;
		if (info.noMarker) {
			reason = "Place a marker first — click the drawn trajectory, then bring the marker " +
				"inside both closest-approach rings (space and time).";
		} else if (!info.hasDest) {
			reason = "Select a destination to enable — no destination chosen for this leg.";
		} else {
			reason = proximityReason(info.prox, "Marker", info.destName);
		}
		mk.startBtn.disabled = !(info.hasDest && info.prox && info.prox.ok);
		mk.startNote.textContent = reason;
	}

	// Build the floating marker card (once), via Shared/sim/marker-card.js's
	// card skeleton, positioned over the 3D pane by planner.css's
	// .mp-eph-marker.
	function buildCard() {
		mk = mcBuildMarkerCard({
			classPrefix: "mp",
			hostEl: markerHost,
			sliderTitle: "drag to slide the marker along the whole path — left is the flight's start, "
				+ "right is the drawn arc's end, mapped by swept degrees around the Sun.",
			sliderAbsolute: true, sliderMin: 0, sliderMax: 360,
			modes: [["free", "Free"], ["target", "Target"]],   // no Track mode here (WP-4.1)
			modeTitles: {
				free: "slide the marker freely",
				target: "re-solve the terminal burn (Lambert) to hold the encounter as the date scrubs; releases above the Δv budget"
			},
			rows: [
				{ key: "rad", label: "radius" },
				{ key: "spd", label: "prograde velocity" },
				{ key: "lat", label: "ecliptic latitude" },
				{ key: "deg", label: "radial from origin", hold: "deg" },
				{ key: "tof", label: "time of flight", hold: "tof" },
				{ key: "arr", label: "arrival date" },
				{ key: "phase", label: "phasing" },
				{ key: "closeApproach", label: "closest approach" },
				{ key: "captureIncl", label: "capture inclination" }
			],
			removeLabel: "Reset",
			removeTitle: "Delete marker and start fresh",
			holdMode: (state.marker && state.marker.holdMode) || "deg",
			onHoldChange: function (mode) { if (state.marker) { state.marker.holdMode = mode; } },
			onSliderChange: function (deg) {
				if (!state.marker) { return; }
				var t = timeAtDeg(deg);
				state.marker.f0 = trajTotalT > 0 ? Math.max(0, Math.min(1, t / trajTotalT)) : 0;
				state.marker.angle = 0;
				updateMarker();
			},
			onRemove: function () { removeMarker(); },
			onModeClick: function (mode, e) { setMarkerMode(mode, !!(e && e.shiftKey)); },
			onBudgetChange: function (dvBudget) { if (state.marker) { state.marker.dvBudget = dvBudget; refresh(); } }
		});
		mk.el.classList.add("mp-card");   // card look; .mp-eph-marker (planner.css) floats it over the pane

		// The no-marker hint, shown only in the .mp-empty state — the card is
		// always present, so it also serves as the "place a marker" prompt.
		markerHint = document.createElement("div");
		markerHint.className = "mp-muted mp-marker-hint";
		markerHint.textContent = HINT_DEFAULT;
		mk.el.appendChild(markerHint);

		// "Start Mission Plan": enabled only when the marker sits inside both
		// closest-approach rings, space and time (see updateStartMissionButton,
		// fed by updateDestinationMarker's nearOrbit/timing computation). Click:
		// name dialog → core/freeze.js → planner.js spawns the tab.
		mk.startBtn = document.createElement("button");
		mk.startBtn.type = "button";
		mk.startBtn.className = "mp-btn mp-big";
		mk.startBtn.textContent = "Start Mission Plan";
		mk.startBtn.title = "Freeze this flight plan into a new mission tab.";
		mk.startBtn.disabled = true;
		mk.startBtn.addEventListener("click", function () {
			var f = buildFreezeSpec();
			if (!f.ok) { mk.startNote.textContent = f.reason; return; }   // gate should prevent this
			openDialog({
				title: "Name this mission",
				value: f.defaultTitle,
				okLabel: "Create mission tab",
				onOk: function (name) {
					var title = (name || "").trim() || f.defaultTitle;
					return opts.onStartMission(freezeMissionWorld(f.spec), title);
				}
			});
		});
		mk.el.appendChild(mk.startBtn);
		mk.startNote = muted(mk.el, "");

		// "Paste mission link…": a link copied with a mission tab's "Copy mission
		// link" loads its ORIGINAL plan back into THIS tab's own scratchpad
		// (loadPastedMission), so it can be revised before Start Mission Plan is
		// clicked — the same freeze/spawn path as anything authored from
		// scratch. A link that also carries a later commit opens that as a
		// mission tab at the same time. The dialog's input auto-fills from the
		// OS clipboard as soon as it opens (best-effort — silently stays blank
		// if the browser withholds clipboard-read permission).
		mk.pasteBtn = document.createElement("button");
		mk.pasteBtn.type = "button";
		mk.pasteBtn.className = "mp-btn mp-ghost mp-paste-btn";
		mk.pasteBtn.textContent = "Paste mission link…";
		mk.pasteBtn.title = "Load a mission from a copied \"Copy mission link\" URL, to revise it here before starting it.";
		mk.pasteBtn.addEventListener("click", function () {
			openDialog({
				title: "Paste a mission link",
				note: "This replaces whatever is sketched on this tab. There is only one " +
					"Ephemeris scratchpad and no undo for it — if you want to keep what is " +
					"here, open the planner in another browser window or tab and paste there " +
					"instead.",
				value: "",
				placeholder: "https://…#mission=… (or just the fragment)",
				okLabel: "Load into Ephemeris tab",
				onOk: function (text) {
					var frag = missionFragmentFrom(text);
					if (!frag) { return Promise.resolve({ ok: false, reason: "That doesn't look like a mission link." }); }
					return decodeFragmentAny(frag).catch(function () { return null; }).then(function (decoded) {
						var unp = decoded ? unpackMissionLink(decoded) : { ok: false, reason: "the link's mission data is unreadable" };
						if (!unp.ok) { return { ok: false, reason: "Couldn't read the link: " + unp.reason + "." }; }
						return loadPastedMission(unp);
					});
				}
			});
			// Best-effort clipboard autofill — arrives async, so it lands
			// just after the dialog opens rather than blocking it.
			if (navigator.clipboard && navigator.clipboard.readText) {
				navigator.clipboard.readText().then(function (text) {
					if (text) { dlg.setValue(text); }
				}).catch(function () { /* permission withheld or nothing to read — leave blank */ });
			}
		});
		mk.el.appendChild(mk.pasteBtn);
	}

	// Everything core/freeze.js's spec wants, read off the CURRENT authored
	// state: the origin body's pre-burn helio state at the tab's clock, the
	// resolved waypoint days (snaps made concrete — the same resolveWaypoints
	// pass refresh() draws from), and the marker's rendezvous — its time along
	// the path as the arrival epoch, its velocity against the destination body's
	// as the arrival v∞. Freeze re-solves the SOI-edge hand-off itself, from
	// these same numbers, so the mission's coast starts exactly where this tab
	// drew the flight starting. Returns { ok: false, reason } if the gate's
	// preconditions somehow aren't met.
	function buildFreezeSpec() {
		var dn = state.leg.destination;
		if (!state.marker || !trajSegs.length || !(trajTotalT > 0)) {
			return { ok: false, reason: "No marker on a drawn trajectory." };
		}
		if (!dn) { return { ok: false, reason: "No destination selected." }; }

		var hand = departureState();
		var rw = resolveWaypoints(hand.r, hand.v, state.leg);
		var tof = mcMarkerFraction(state.marker.f0, state.marker.angle) * trajTotalT;
		var s = stateAtGlobalTime(tof);
		if (!s) { return { ok: false, reason: "The marker isn't on a valid trajectory." }; }

		var arrJd = legStartJd() + tof / DAY;
		var b = O.bodyStateAtJD(GM_SUN, systems.get(dn).orbit, arrJd);
		return {
			ok: true,
			defaultTitle: defaultMissionTitle(state.origin, dn, dateState.jd),
			spec: {
				origin: state.origin,
				destination: dn,
				// The hand-off state and its epoch are handed over verbatim —
				// freeze re-derives nothing, so what the planner was shown is
				// exactly what the mission commits. For a Moon origin that
				// epoch is the FLOWN SOI crossing, not the clock; the clock is
				// the release, and travels separately as releaseJd.
				jd: hand.jd,
				handoff: { r: hand.r, v: hand.v },
				waypoints: rw.entries.map(function (e) { return { days: e.days, burn: e.burn }; }),
				arrivalJd: arrJd,
				arrivalVInf: O.vMag(O.vSub(s.v, b.v)),
				releaseJd: state.origin === "Moon" ? dateState.jd : undefined,
				// The release itself, so pasting this mission back reopens the
				// same departure rather than trying to recover it from the
				// hand-off — which cannot be done without solving backwards.
				lunarRelease: state.origin === "Moon"
					? { jd: dateState.jd, burn: { pro: state.leg.burn.pro || 0,
					                              rad: state.leg.burn.rad || 0,
					                              nrm: state.leg.burn.nrm || 0 } }
					: undefined
			}
		};
	}

	// The inverse of buildFreezeSpec/core/freeze.js: reconstructs this tab's
	// scratchpad from a mission World that was previously frozen — the back half
	// of "Paste mission link…", so a shared mission loads here for revision
	// instead of spawning a tab. Reads the frozen-plan and transfer-leg stages'
	// own params (the same two stages core/freeze.js writes); every other stage
	// — the departure and arrival techs and their legs — is ignored, because
	// this tab only ever edits the plan, never a tech's configuration.
	//
	// departure.{r,v,jd} IS the coast's starting state, full stop (the
	// Departure→Coast hand-off is a given heading and speed, not a burn formula
	// — see transfer-leg.js's header and ARCHITECTURE.md's "Phases are chains").
	// Whatever composed to produce it — a skyhook release, a carrier chain,
	// departure waypoints — is upstream's business and opaque from here.
	//
	// So this loads it VERBATIM: the clock opens at departure.jd, the velocity
	// decomposes against the origin body's own motion there (O.burnComponents,
	// the exact inverse of the O.applyBurn departureState re-applies), and the
	// POSITION is kept as a body-relative offset the tab then ADOPTS rather
	// than re-deriving — because a real departure chain's exit point on the
	// SOI sphere is not something this tab can reconstruct. Nothing is
	// estimated, netted or back-propagated anywhere in here, which is what
	// makes the round trip exact for any plan, however it was produced.
	// `injectionJd` on older saves is provenance now, and ignored.
	//
	// A MOON ORIGIN reopens from the other end. Its card is a release, not a
	// hand-off, so the plan's own `lunarRelease` — epoch and impulse — is what
	// restores it, and the hand-off is re-flown from there. Decomposing
	// departure.v the way the branch above does would read an Earth-frame
	// velocity as a Moon-frame impulse and draw a different flight entirely.
	//
	// Waypoint snap-to intent doesn't survive a freeze (resolveWaypoints
	// already turned it into a concrete day before core/freeze.js ever saw
	// it), so restored waypoints land unsnapped at their frozen day — still
	// revisable, just not re-snappable to the same feature without
	// re-checking the box. Waypoint burns themselves copy straight across.
	function loadFrozenPlanIntoState(world) {
		var stages = world.stages();
		var fpStage = stages.filter(function (s) { return s.moduleId === "frozen-plan"; })[0];
		var legStage = stages.filter(function (s) { return s.moduleId === "transfer-leg"; })[0];
		if (!fpStage || !legStage) {
			return { ok: false, reason: "That mission has no frozen flight plan to load here." };
		}
		var p = fpStage.params || {};
		var lp = legStage.params || {};
		if (!p.origin || !p.departure || !p.arrival) {
			return { ok: false, reason: "That mission's flight plan is incomplete." };
		}
		var originSys = systems.get(p.origin);
		if (!originSys) { return { ok: false, reason: "Unknown origin body \"" + p.origin + "\"." }; }

		state.origin = p.origin;

		// A MOON origin is authored forward, so what reopens it is the RELEASE
		// the plan was flown from, not the hand-off it arrived at: the clock
		// goes to the release epoch and the card takes its impulse verbatim.
		// The hand-off then comes back out of the same integration that
		// produced it, so the round trip is exact without solving anything
		// backwards. A lunar plan frozen without that record (there is nothing
		// else it could have come from) is reported rather than guessed at.
		var burn;
		if (p.origin === "Moon") {
			if (!p.lunarRelease || !isFinite(p.lunarRelease.jd)) {
				return { ok: false, reason: "That lunar mission's plan carries no release to reopen." };
			}
			var lr = p.lunarRelease.burn || {};
			burn = { pro: lr.pro || 0, rad: lr.rad || 0, nrm: lr.nrm || 0 };
			dateBar.setJd(p.lunarRelease.jd);
			state.handoff = { mode: "derived", offset: null };
		} else {
			dateBar.setJd(p.departure.jd);
			var natural = O.bodyStateAtJD(GM_SUN, originSys.orbit, p.departure.jd);
			var vInfVec = O.vSub(p.departure.v, natural.v);
			burn = O.vMag(vInfVec) > 1e-6
				? O.burnComponents(natural.r, natural.v, vInfVec)
				: { pro: 0, rad: 0, nrm: 0 };
			// Adopt the plan's own exit point on the SOI sphere, as an offset
			// from the origin body so it still means something if the clock is
			// scrubbed.
			state.handoff = { mode: "adopted", offset: O.vSub(p.departure.r, natural.r) };
		}
		frame.place(dateState.jd);

		state.leg.destination = p.arrival.body || "";
		// Mutate the existing burn object's fields rather than replacing it —
		// the Departure card's vector editor (Shared/sim/vector-editor.js) is
		// built once at tab setup and closes over this exact object, so
		// reassigning state.leg.burn wholesale would leave the sidebar fields
		// stuck showing stale (usually zero) values forever.
		state.leg.burn.pro = burn.pro;
		state.leg.burn.rad = burn.rad;
		state.leg.burn.nrm = burn.nrm;
		// Frozen waypoint days already count from the coast's start, which is
		// now this tab's zero too — they copy across untouched.
		state.leg.waypoints = (lp.waypoints || []).map(function (wp) {
			var b = wp.burn || {};
			return { days: wp.days, burn: { pro: b.pro || 0, rad: b.rad || 0, nrm: b.nrm || 0 },
			         snap: null, snapOffset: 0 };
		});
		state.marker = null;

		originSel.value = state.origin;
		destSel.value = state.leg.destination;
		rebuildWaypointRows();
		refresh();

		// Place the marker back at the frozen rendezvous — trajTotalT is now
		// current (the refresh() just above), so the fraction this resolves
		// to is against the freshly-restored trajectory, not a stale one.
		var tof = (lp.legDays || 0) * DAY;
		if (isFinite(tof) && tof > 0 && trajTotalT > 0) {
			placeMarkerAtGlobalTime(Math.min(tof, trajTotalT));
		}
		return { ok: true };
	}

	// A pasted link, unpacked (ui/share-link.js), turned into whatever it
	// describes. A mission link carries up to two plans — the ORIGINAL as it
	// was first frozen, and the LATEST commit if the mission has been updated
	// since — and each has a different destination here:
	//
	//   - the ORIGINAL loads into this scratchpad, because this tab is where a
	//     plan is authored and revised. Starting from where the mission began
	//     is the useful place to pick it up from.
	//   - the LATEST opens as its own mission tab, because a committed plan
	//     with a technology stack behind it is a mission, not a sketch.
	//
	// A link with no plan sets (v1, or a mission never updated) has only one
	// thing to do with, and does exactly what paste has always done: loads it
	// here and spawns nothing.
	function loadPastedMission(unp) {
		var sets = readSets(unp.plan);
		var latest = latestOf(sets);
		var sketchWorld = sets ? sets.original : unp.world;

		var res = deserializeWorld(sketchWorld);
		if (!res.ok) { return { ok: false, reason: "Couldn't load the mission: " + res.reason + "." }; }
		var loaded = loadFrozenPlanIntoState(res.world);
		if (!loaded.ok) { return loaded; }

		if (latest && opts.onOpenPastedMission) {
			var spawned = opts.onOpenPastedMission(latest.world, unp.title, unp.plan);
			// The scratchpad already holds the original; a tab that won't open
			// is worth saying so about, but not worth undoing that for.
			if (spawned && spawned.ok === false) {
				return { ok: false, reason: "Loaded the original plan here, but couldn't open the " +
					"later one as a mission: " + spawned.reason + "." };
			}
		}
		return { ok: true };
	}

	// ---- the one modal dialog, shared by name-your-mission and
	// paste-a-link. onOk(value) returns { ok } or
	// { ok: false, reason } — a failure keeps the dialog open with the
	// reason shown, success closes it. Built once, appended to body so it
	// overlays the whole app. ---------------------------------------------------
	var dlg = (function () {
		var wrap = document.createElement("div"); wrap.className = "mp-dialog-wrap";
		var box = document.createElement("div"); box.className = "mp-dialog";
		var head = document.createElement("h3");
		var note = document.createElement("p"); note.className = "mp-dialog-note";
		var input = document.createElement("input"); input.type = "text";
		var err = document.createElement("div"); err.className = "mp-dialog-err";
		var row = document.createElement("div"); row.className = "mp-dialog-btnrow";
		var cancelBtn = document.createElement("button");
		cancelBtn.type = "button"; cancelBtn.className = "mp-btn"; cancelBtn.textContent = "Cancel";
		var okBtn = document.createElement("button");
		okBtn.type = "button"; okBtn.className = "mp-btn mp-big";
		row.appendChild(cancelBtn); row.appendChild(okBtn);
		box.appendChild(head); box.appendChild(note); box.appendChild(input);
		box.appendChild(err); box.appendChild(row);
		wrap.appendChild(box);
		document.body.appendChild(wrap);

		var onOk = null;
		function close() { wrap.classList.remove("on"); onOk = null; }
		// onOk may return a result or a promise of one — reading a mission link
		// has to inflate it, and there is no synchronous inflate. The dialog
		// stays open and the OK button disables while a promise is in flight,
		// so a slow read can't be double-submitted.
		function submit() {
			if (!onOk) { return; }
			var res = onOk(input.value);
			if (res && typeof res.then === "function") {
				okBtn.disabled = true;
				res.then(function (r) {
					okBtn.disabled = false;
					if (r && r.ok === false) { err.textContent = r.reason || "That didn't work."; return; }
					close();
				}, function () {
					okBtn.disabled = false;
					err.textContent = "That didn't work.";
				});
				return;
			}
			if (res && res.ok === false) { err.textContent = res.reason || "That didn't work."; return; }
			close();
		}
		cancelBtn.addEventListener("click", close);
		okBtn.addEventListener("click", submit);
		wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) { close(); } });
		input.addEventListener("keydown", function (e) {
			if (e.key === "Enter") { submit(); }
			else if (e.key === "Escape") { close(); }
		});

		return {
			open: function (o) {
				head.textContent = o.title;
				note.textContent = o.note || "";
				note.hidden = !o.note;
				input.value = o.value || "";
				input.placeholder = o.placeholder || "";
				okBtn.textContent = o.okLabel || "OK";
				okBtn.disabled = false;
				err.textContent = "";
				onOk = o.onOk;
				wrap.classList.add("on");
				input.focus(); input.select();
			},
			// Programmatic fill for the still-open dialog (the paste button's
			// async clipboard read) — a no-op if the dialog closed in the
			// meantime, so a slow/late clipboard promise can't reopen it or
			// clobber a since-opened different dialog's field.
			setValue: function (text) {
				if (!wrap.classList.contains("on")) { return; }
				input.value = text;
				input.select();
			}
		};
	})();
	function openDialog(o) { dlg.open(o); }

	// Recompute the marker's world position and card readouts from its slider
	// angle and the current trajectory. When unset, the card stays — it is the
	// permanent home of Start/Paste — but collapses to its empty state
	// (.mp-empty hides the marker controls and shows the hint).
	function updateMarker() {
		if (!state.marker) {
			if (markerSprite) { markerSprite.visible = false; }
			if (destSprite) { destSprite.visible = false; }
			if (destSoi) { destSoi.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			setCardEmpty(true);
			updateStartMissionButton({ noMarker: true });
			frame.place(dateState.jd);
			return;
		}
		if (!state.marker.mode) { state.marker.mode = "free"; }
		if (!markerSprite) { markerSprite = makeShipSprite(); frame.scene.add(markerSprite); }
		if (state.marker.mode === "target") {
			if (!state.marker._released && state.marker._encT != null && trajTotalT > 0) {
				state.marker.f0 = Math.max(0, Math.min(1, state.marker._encT / trajTotalT));
				state.marker.angle = 0;                          // sit at the solved encounter
			} else { followCrossing(); }                         // released -> falls back to geometric tracking
		}

		var f = mcMarkerFraction(state.marker.f0, state.marker.angle);
		var minF = 0;   // the flight starts at the hand-off, so nothing precedes it
		if (f < minF) { state.marker.f0 = minF; state.marker.angle = 0; f = minF; }
		var tof = f * trajTotalT;
		var s = stateAtGlobalTime(tof);
		if (!s) {
			markerSprite.visible = false;
			if (destSprite) { destSprite.visible = false; }
			if (destSoi) { destSoi.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			setCardEmpty(true);
			setHint("No drawn trajectory to probe — fix the leg, then click it to place a marker.");
			updateStartMissionButton({ noMarker: true });
			frame.place(dateState.jd);
			return;
		}

		frame.place(dateState.jd);   // the scene always shows the timeline's own date, not the marker's implied one

		markerSprite.visible = true;
		setCardEmpty(false);
		setHint(HINT_DEFAULT);   // restore for the next empty state
		markerSprite.position.set(s.r[0] / AU, s.r[1] / AU, s.r[2] / AU);
		markerVelDir = new THREE.Vector3(s.v[0], s.v[1], s.v[2]).normalize();

		var rmag = O.vMag(s.r);                                   // m
		var lat = Math.asin(Math.max(-1, Math.min(1, s.r[2] / rmag))) * 180 / Math.PI;
		mk.vals.rad.textContent = (rmag / AU).toFixed(3) + " AU";
		mk.vals.radKm.textContent = fmtKm(rmag);
		mk.vals.spd.textContent = (O.vMag(s.v) / 1000).toFixed(2) + " km/s";
		mk.vals.lat.textContent = (lat >= 0 ? "+" : "−") + Math.abs(lat).toFixed(1) + "°";
		mk.vals.deg.textContent = sweptFromOrigin(s.r).toFixed(1) + "°";
		// Flight time runs from the hand-off, which is where the drawn arc
		// starts and what the tab's clock reads.
		mk.vals.tof.textContent = fmtTof(Math.max(0, tof));
		mk.vals.tof.title = "From the hand-off at the origin's SOI edge — the tab's own clock.";

		updateDestinationMarker(s.r, tof);

		mk.slider.disabled = (state.marker.mode !== "free");      // position driven in Target mode
		mk.slider.max = trajTotalT > 0 ? degAtTime(trajTotalT) : 360;
		if (document.activeElement !== mk.slider) { mk.slider.value = degAtTime(tof); }

		// Target-mode controls/readouts (budget input + solved Δv); hidden otherwise
		var isTarget = state.marker.mode === "target";
		mk.budgetRow.style.display = isTarget ? "" : "none";
		mk.tdvRow.style.display = isTarget ? "" : "none";
		if (isTarget) {
			if (document.activeElement !== mk.budgetInput) {
				mk.budgetInput.value = ((state.marker.dvBudget || 0) / 1000).toFixed(1);
			}
			if (state.marker._targetDv != null) {
				mk.valTdv.textContent = (state.marker._targetDv / 1000).toFixed(2) + " km/s"
					+ (state.marker._released ? " — released" : "");
				mk.valTdv.style.color = state.marker._released ? "#ff8a8a" : "#9fe0ff";
			} else {
				mk.valTdv.textContent = state.marker._targetMsg || "—";
				mk.valTdv.style.color = "#ff8a8a";
			}
		}
		updateModeButtons();
		if (state.markerFocused) { frame.cam.target.copy(markerSprite.position); }
		if (state.destFocused && destSprite && destSprite.visible) { frame.cam.target.copy(destSprite.position); }
	}

	// Make the marker the camera's pivot — the view then rotates and zooms
	// about it. Triggered when the marker is placed.
	function focusMarker() {
		if (!state.marker || !markerSprite) { return; }
		state.markerFocused = true;
		state.destFocused = false;
		frame.focusBody = null;
		frame.cam.target.copy(markerSprite.position);
	}

	// Make the destination "×" the camera's pivot, same as focusMarker but for
	// updateDestinationMarker's destSprite. Triggered by clicking it in handlePick.
	function focusDest() {
		if (!destSprite || !destSprite.visible) { return; }
		state.destFocused = true;
		state.markerFocused = false;
		frame.focusBody = null;
		frame.cam.target.copy(destSprite.position);
	}

	function removeMarker() {
		state.marker = null;
		state.markerFocused = false;
		state.destFocused = false;
		setHint("Marker removed — click the drawn trajectory to place a new one.");
		updateMarker();
	}

	// Place (or move) the marker at a global time along the path; that point
	// becomes 0° on the slider and the camera focus. Called from handlePick
	// below whenever a click resolves to a nearest trajectory sample, and by
	// loadFrozenPlanIntoState to restore a pasted mission's rendezvous.
	function placeMarkerAtGlobalTime(t) {
		var f0 = trajTotalT > 0 ? Math.max(0, Math.min(1, t / trajTotalT)) : 0;
		var budget = (state.marker && state.marker.dvBudget != null) ? state.marker.dvBudget : 10000;
		var holdMode = (state.marker && state.marker.holdMode) || "deg";
		// if we were targeting, restore the manual terminal burn before re-placing
		if (state.marker && state.marker.mode === "target" && state.marker._baseBurn) {
			var tb = terminalBurnRef().burn;
			tb.pro = state.marker._baseBurn.pro; tb.rad = state.marker._baseBurn.rad; tb.nrm = state.marker._baseBurn.nrm;
		}
		state.marker = { f0: f0, angle: 0, mode: "free", dvBudget: budget, holdMode: holdMode };
		refresh();                        // redraw (restored burn included) + updateMarker
		focusMarker();
	}

	// Target mode (and leaving it) writes burn values the vector editor never
	// saw — re-sync them from state each refresh by calling the editor's redraw.
	function syncBurnInputs() {
		if (depBurnHost && depBurnHost._sstRedraw) {
			depBurnHost._sstRedraw();
		}
		wpRows.forEach(function (row, i) {
			if (row.host && row.host._sstRedraw) {
				row.host._sstRedraw();
			}
		});
	}

	// ==== recompute + draw: the one function every input change calls --------
	function refresh() {
		// trajTotalT (the drawn leg's total duration) can change from this very
		// recompute — e.g. adding a waypoint pushes the "one period past the
		// last waypoint" tail further out (finalCoastDays) even though nothing
		// upstream of it moved. state.marker.f0 is a FRACTION of trajTotalT, so
		// holding f0 fixed across such a change silently retargets the marker
		// to a different absolute time. Snapshot the marker's current absolute
		// time-of-flight now, under the OLD trajTotalT, and re-derive f0 from
		// it once the new trajTotalT is known (below), so the marker stays put
		// unless the path actually reshaped under it.
		//
		// That absolute-time-of-flight hold is state.marker.holdMode "tof". The
		// other mode, "deg" (the default — the marker card's radio next to
		// "radial from origin"), holds the marker's SWEPT ANGLE fixed instead:
		// snapshot degAtTime(markerAbsTof) now, under the OLD leg's start state,
		// and re-solve timeAtDeg(markerDeg) once the new leg's start state is in
		// place (below) to override the tof-based f0. degAtTime/timeAtDeg are
		// exact for any degree (Notes/decisions.md, 2026-08-28), so this can
		// only land beyond the CURRENT trajTotalT — handled by the same f0
		// clamp a "tof" hold past the end already needs. Swept angle is the
		// more physically stable quantity to hold across a scrub — e.g.
		// dragging the departure date reshapes the whole leg (the origin's own
		// heliocentric position moves, sharply for the Moon), and "the ship is
		// this far around its arc" keeps meaning the same thing where a fixed
		// elapsed time can land somewhere very different once the origin has
		// moved out from under it.
		var prevTotalT = trajTotalT;
		var markerAbsTof = (state.marker && prevTotalT > 0)
			? mcMarkerFraction(state.marker.f0, state.marker.angle) * prevTotalT : null;
		var markerDeg = (state.marker && state.marker.holdMode === "deg" && markerAbsTof != null)
			? degAtTime(markerAbsTof) : null;

		// Target mode re-solves the terminal vector before anything is drawn or
		// read out; the card fields then re-sync to what's in force, and the
		// hand-off is read AFTER that so it reflects the solve.
		applyTargeting();
		syncBurnInputs();

		var hand = departureState();
		var dep = hand.body;
		var depEst = departureEstimateFor(hand);

		originInfo.textContent = "Heliocentric speed " + fmtKmS(O.vMag(dep.v)) +
			" km/s, distance " + (O.vMag(dep.r) / AU).toFixed(3) + " AU from the Sun.";
		if (state.leg.destination) {
			var dnow = O.bodyStateAtJD(GM_SUN, systems.get(state.leg.destination).orbit, dateState.jd);
			destInfo.textContent = "Now at " + (O.vMag(dnow.r) / AU).toFixed(3) + " AU, " +
				fmtKmS(O.vMag(dnow.v)) + " km/s.";
		} else {
			destInfo.textContent = "No destination selected.";
		}

		var vDep = hand.v;
		var elDep = O.elementsFromState(GM_SUN, hand.r, vDep);
		var depKind = elDep.e < 1 ? ("ellipse, a = " + (elDep.a / AU).toFixed(2) + " AU")
		                          : ("hyperbola, e = " + elDep.e.toFixed(2));
		depReadout.textContent = "Resulting arc: " + depKind + ", speed " + fmtKmS(O.vMag(vDep)) +
			" km/s. v∞ = " + fmtKmS(hand.vInf) + " km/s.";
		// A lunar departure's v∞ and its epoch are RESULTS, so say what came
		// out of the flight rather than leaving the card looking like it set
		// them. A flight that never gets out says that instead.
		if (state.origin === "Moon") {
			depReadout.textContent = hand.lunar.ok
				? ("Reaches Earth's SOI after " + hand.lunar.flightDays.toFixed(2) + " d, on " +
				   isoDay(hand.jd) + ", at v∞ " + fmtKmS(hand.vInf) + " km/s. Resulting arc: " +
				   depKind + ".")
				: (LUNAR_FAILURES[hand.lunar.reason] || "This release does not reach Earth's SOI.");
		}

		// The waypoint chain (apsis/node availability, snap resolution)
		// propagates from the hand-off itself — the same state the trajectory
		// draws from — so a waypoint's "snap to apoapsis" option, say, matches
		// what's actually on screen.
		var rw = resolveWaypoints(hand.r, hand.v, state.leg);
		rw.entries.forEach(function (e) { updateWaypointRowUI(wpRows[e.originalIndex], e, e.originalIndex); });

		// legDays carries no mission condition — it's just long enough to draw
		// the leg's own natural end: one full period past the last waypoint
		// (or the departure burn) if bound, a long escape coast if not.
		var legDays = rw.tPrev + finalCoastDays(rw.finalR, rw.finalV);
		state.leg.legDays = legDays;   // last-computed length, e.g. as a new waypoint's default-day bound

		var params = Object.assign({}, state.leg, { waypoints: rw.entries, legDays: legDays });
		var leg = computeLeg(params, { r: hand.r, v: hand.v, jd: hand.jd });

		clearDrawn();

		// Departure arrows + readout box are shown regardless of whether the
		// rest of the leg is valid — they only depend on the origin body and
		// the card vector, both always resolvable. They are drawn AT the point
		// the card acts and referenced to the motion its components are
		// measured against, which is not the same pair for every origin: for
		// most, the card is the excess over the body's own motion at the SOI
		// exit; for the MOON it is an impulse on the MOON's geocentric motion
		// at the release, days earlier and a million kilometres away.
		var entries, mAt;
		if (state.origin === "Moon") {
			mAt = Frames.bodyHelioState("Moon", dateState.jd);
			entries = [{ host: depBurnHost, data: lunarReleaseReadout() }];
			addLunarReleaseArrows(mAt.r);
		} else {
			entries = [{ host: depBurnHost, data: burnReadoutData(hand.r, dep.v, state.leg.burn) }];
			addBurnArrowsAt(hand.r, dep.v, state.leg.burn);
		}

		if (!leg.ok) {
			trajSegs = []; trajTotalT = 0; trajSampleCount = 0; trajSamples = [];   // marker + rings hide until it recovers
			updateHandoffControls(hand);
			clearApproachMarks();
			setStatus("err", leg.diagnostic.message);
		} else {
			// Marker support: per-segment start states over the whole drawn leg,
			// so the marker can be located at any global time.
			trajSegs = [];
			var chrono = rw.entries.slice().sort(function (a, b) { return (a.days || 0) - (b.days || 0); });
			var segR = hand.r, segV = hand.v, tStart = 0;
			chrono.forEach(function (e) {
				var tWp = (e.days || 0) * DAY;
				trajSegs.push({ r0: segR, v0: segV, tStart: tStart, dur: tWp - tStart });
				segR = e.preR;
				segV = O.applyBurn(e.preR, e.preV, e.burn.pro || 0, e.burn.nrm || 0, e.burn.rad || 0);
				tStart = tWp;
			});
			trajSegs.push({ r0: segR, v0: segV, tStart: tStart, dur: legDays * DAY - tStart });
			trajTotalT = legDays * DAY;

			// Re-anchor the marker to the SAME absolute time-of-flight it had
			// before this recompute (see the note at the top of refresh()),
			// rather than leaving it at the same fraction of a total that may
			// have just moved. This is the "tof" hold mode outright, and the
			// "deg" hold mode's fallback for when there was no prior swept
			// angle to match. Target mode overrides f0 from its own absolute
			// _encT right after this (updateMarker), so this only has lasting
			// effect on Free/released-Target marker positions.
			if (state.marker && markerAbsTof != null) {
				state.marker.f0 = Math.max(0, Math.min(1, markerAbsTof / trajTotalT));
				state.marker.angle = 0;
			}
			trajSampleCount = leg.samples.length;
			trajSamples = leg.samples;

			updateHandoffControls(hand);

			// "deg" hold mode: override the tof-based re-anchor above with the
			// time-of-flight where the NEW leg's own conic reaches the SAME
			// swept angle the marker had before this recompute (markerDeg, see
			// the note at the top of refresh()). timeAtDeg is exact for any
			// degree — there's no table range to fall outside of — so this can
			// only land beyond trajTotalT when the leg is genuinely too short
			// to have gotten there yet, which the f0 clamp below handles.
			if (state.marker && markerDeg != null && trajTotalT > 0) {
				state.marker.f0 = Math.max(0, Math.min(1, timeAtDeg(markerDeg) / trajTotalT));
				state.marker.angle = 0;
			}

			var U = AU;
			var pts = leg.samples.map(function (s) {
				return new THREE.Vector3(s.r[0] / U, s.r[1] / U, s.r[2] / U);
			});
			trajLine = new THREE.Line(
				new THREE.BufferGeometry().setFromPoints(pts),
				new THREE.LineBasicMaterial({ color: 0x66f0ff }));
			frame.scene.add(trajLine);

			// Just the flight's own start, at the SOI edge — no "arrival" dot:
			// with no mission duration, leg.end is wherever the loop/escape
			// naturally runs out, not a rendezvous attempt (that judgment is
			// the marker's job, D3).
			var startR = leg.samples.length ? leg.samples[0].r : hand.r;
			if (startR) { frame.scene.add(dot(startR, 0xff5fd0, 6)); }

			rw.entries.forEach(function (e) {
				var giz = createWaypointGizmo(e.preR, e.preV,
					new THREE.Vector3(e.preR[0] / AU, e.preR[1] / AU, e.preR[2] / AU));
				frame.scene.add(giz); wpMarkers.push(giz);
				addBurnArrowsAt(e.preR, e.preV, e.burn);
				entries.push({ host: wpRows[e.originalIndex].host, data: burnReadoutData(e.preR, e.preV, e.burn) });
			});

			rebuildApproachMarks();
			setStatus("ok", "ok");
		}

		// The trajectory's own closest approach to the destination — a
		// property of the drawn path and the destination alone, so it's
		// recomputed here (once per trajectory/destination change) rather
		// than on every marker scrub. null when leg.ok is false: trajSamples
		// was just cleared above.
		destApproach = computeDestinationApproach();
		updateApproachReadouts();

		readoutBoxes = renderReadoutBoxes(readoutLayer, readoutBoxes, entries,
			{ classPrefix: "mp", dvHex: dvHex, spdHex: spdHex, compact: true });
		positionReadoutBoxes(readoutBoxes, mainEl, panelEl, 15);

		// keep the marker on the (possibly reshaped) path + refresh its card
		updateMarker();

		updateMoonWidgets(dep, depEst, hand);
	}

	// Feed the Moon widgets from the CURRENT refresh's numbers. Departing FROM
	// the Moon the launch date is the clock itself, so the glyph reads the
	// phase the ship actually leaves at and the days bar is the flown time out
	// to Earth's SOI. The Moon's free prograde speed is INFORMATION: how much
	// of a departure the Moon is willing to supply, measured along Earth's own
	// heliocentric prograde. Arrival side mirrors it at the marker's rendezvous
	// (the catch date), when the destination is Earth and a rendezvous exists
	// to read. `dep` is the ESCAPE body's own state, which is what that
	// prograde speed is measured against.
	function updateMoonWidgets(dep, est, hand) {
		if (state.origin === "Moon") {
			// Departing FROM the Moon: the phase is where the ship starts —
			// the clock's own date — and the days bar is the flown time out to
			// Earth's SOI, not an assumption.
			var lun = hand && hand.lunar;
			depMoon.show({
				elong: moonElongationDeg(dateState.jd),
				rel: moonProgradeSpeed(dateState.jd, dep.v),
				days: (est && est.ok) ? est.days : null,
				note: (lun && lun.releaseSpeed)
					? "release " + Math.round(lun.releaseSpeed) + " m/s at "
					  + Math.round(RELEASE_ALTITUDE / 1e3) + " km"
					: null
			});
		} else { depMoon.hide(); }

		var showArr = false;
		if (state.leg.destination === "Earth" && state.marker && trajTotalT > 0) {
			var tof = mcMarkerFraction(state.marker.f0, state.marker.angle) * trajTotalT;
			var s = stateAtGlobalTime(tof);
			if (s) {
				var arrJd = legStartJd() + tof / DAY;
				var bE = O.bodyStateAtJD(GM_SUN, systems.get("Earth").orbit, arrJd);
				var arr = estimateArrival(O.vSub(s.v, bE.v), arrJd);
				arrMoon.show({
					elong: moonElongationDeg(arrJd),
					rel: moonProgradeSpeed(arrJd, bE.v),
					days: arr.ok ? arr.days : null,
					note: arr.ok ? "SOI entry to the catch" : null
				});
				showArr = true;
			}
		}
		if (!showArr) { arrMoon.hide(); }
	}

	// =======================================================================
	//  Click picking, main pane, in priority order: (1) the marker's own
	//  sprite refocuses the camera on it without moving it; (2) the destination
	//  "×" (updateDestinationMarker's destSprite) likewise refocuses on it
	//  without moving it; (3) the nearest trajectory sample within range
	//  places/moves the marker there; (4) failing all three, the nearest body
	//  within PICK_PX becomes the orbit/zoom pivot instead — collapsed-to-a-point
	//  bodies (updateScales, the normal case at solar-system zoom) are a
	//  sub-pixel target for an exact hit, so pickBodyName falls back to
	//  nearest-centre-within-range; (5) truly empty space releases whichever
	//  lock is active. Projection is against
	//  `paneMainEl`'s own rect rather than the whole canvas — the same pane the
	//  wheel-zoom `pickPoint` below uses — because this shell scissors panes and
	//  the two rects need not coincide (the Ephemeris tab is single-pane, so
	//  today they do). `onPick` is the shared camera-controller's deferred
	//  single-click hook: it fires after mouseup only if the press didn't move
	//  and wasn't the first half of a double-click, so it never fights camera
	//  rotate-drag.
	// =======================================================================
	var PICK_PX = 10;

	function handlePick(e) {
		var rect = paneMainEl.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;

		// click on the existing marker -> refocus only (don't move it)
		if (state.marker && markerSprite && markerSprite.visible) {
			var mv = markerSprite.position.clone().project(frame.camera);
			if (mv.z <= 1) {
				var mx = (mv.x * 0.5 + 0.5) * rect.width, my = (-mv.y * 0.5 + 0.5) * rect.height;
				if (Math.hypot(mx - px, my - py) < 16) { focusMarker(); return; }
			}
		}

		// click on the destination "×" -> focus/follow it, same as the marker above
		if (destSprite && destSprite.visible) {
			var xv = destSprite.position.clone().project(frame.camera);
			if (xv.z <= 1) {
				var xx = (xv.x * 0.5 + 0.5) * rect.width, xy = (-xv.y * 0.5 + 0.5) * rect.height;
				if (Math.hypot(xx - px, xy - py) < 16) { focusDest(); return; }
			}
		}

		// otherwise place/move the marker at the nearest trajectory sample
		// (trajSamples is in metres, so each candidate is converted to scene
		// units before projecting).
		var best = -1, bestD = 14;        // pixel threshold
		for (var i = 0; i < trajSamples.length; i++) {
			var s = trajSamples[i].r;
			var v = new THREE.Vector3(s[0] / AU, s[1] / AU, s[2] / AU).project(frame.camera);
			if (v.z > 1) { continue; }
			var sx = (v.x * 0.5 + 0.5) * rect.width;
			var sy = (-v.y * 0.5 + 0.5) * rect.height;
			var d = Math.hypot(sx - px, sy - py);
			if (d < bestD) { bestD = d; best = i; }
		}
		if (best >= 0) { placeMarkerAtGlobalTime(trajSamples[best].t); return; }

		// nothing on the path (or no path drawn at all): try a body instead
		var name = pickBodyName(frame.camera, paneMainEl, e, frame.scaleList, PICK_PX);
		if (name) {
			state.markerFocused = false;
			state.destFocused = false;
			frame.focusBody = name;
			var node = frame.bodyNode(name);
			if (node) { frame.cam.target.copy(node.position); }
			return;
		}

		// truly empty space: release whichever lock is active (marker/body stay
		// put — this only stops the camera re-centring on them every tick).
		state.markerFocused = false;
		state.destFocused = false;
		frame.focusBody = null;
	}

	// ---- camera controls: one frame, so the view config never changes. Like
	// the standalone plotters, this view binds once for the page's life and
	// ignores the unbind return value (Shared/sim/camera-controller.js).
	bindCameraControls(paneMainEl, function () {
		return {
			cam: frame.cam, camera: frame.camera,
			zoomMin: frame.zoomMin, zoomMax: frame.zoomMax,
			pickPoint: function (e) {
				return raycastPickPoint(frame.camera, paneMainEl, e,
					{ meshes: frame.pickMeshes, soiSpheres: frame.pickSoiSpheres });
			},
			onPan: function () { frame.focusBody = null; state.markerFocused = false; state.destFocused = false; },
			lockedZoomTarget: function () {
				if (state.markerFocused && markerSprite && markerSprite.visible) { return markerSprite.position; }
				if (state.destFocused && destSprite && destSprite.visible) { return destSprite.position; }
				if (frame.focusBody) {
					var node = frame.bodyNode(frame.focusBody);
					if (node) { return node.position; }
				}
				return null;
			},
			onPick: handlePick
		};
	});

	function render() {
		if (!active) { return; }
		var canvasRect = renderer.domElement.getBoundingClientRect();
		var r = paneMainEl.getBoundingClientRect();
		var w = r.width, h = r.height;
		if (w < 2 || h < 2) { return; }
		var x = r.left - canvasRect.left;
		var y = canvasRect.height - (r.top - canvasRect.top + h);   // GL origin: bottom-left

		frame.camera.aspect = w / h;
		frame.camera.updateProjectionMatrix();
		updateCamera(frame.camera, frame.cam);
		brUpdateScales(frame.camera, paneMainEl, frame.scaleList, { wantSOI: frame.wantSOI });
		brUpdateLabels(frame.camera, paneMainEl, frame.labelList);

		wpMarkers.forEach(function (g) {
			g.scale.setScalar(worldSizeAtPointForPx(frame.camera, paneMainEl, g.position, GIZMO_PX));
		});
		burnArrows.forEach(function (a) {
			a.scale.setScalar(worldSizeAtPointForPx(frame.camera, paneMainEl, a.position, GIZMO_PX));
		});
		if (markerSprite && markerSprite.visible) {
			markerSprite.scale.setScalar(worldSizeAtPointForPx(frame.camera, paneMainEl, markerSprite.position, 26));
			if (markerVelDir) { orientMarkerSprite(frame.camera, markerSprite, markerVelDir); }
		}
		if (destSprite && destSprite.visible) {
			destSprite.scale.setScalar(worldSizeAtPointForPx(frame.camera, paneMainEl, destSprite.position, 22));
		}
		if (destSoi) {
			destSoi.visible = !!(destSprite && destSprite.visible && frame.wantSOI);
			if (destSoi.visible) {
				var soiDist = frame.camera.position.distanceTo(destSoi.position) || 1e-9;
				destSoi.visible = projectedRadiusPx(frame.camera, paneMainEl, destSoi.scale.x, soiDist) >= 2.0;
			}
		}
		if (tempRing && tempRing.visible) { scaleApproachMark(frame.camera, paneMainEl, tempRing); }
		orbitApproachMarks.forEach(function (sp) { scaleApproachMark(frame.camera, paneMainEl, sp); });
		positionReadoutBoxes(readoutBoxes, mainEl, panelEl, 15);

		renderer.setViewport(x, y, w, h);
		renderer.setScissor(x, y, w, h);
		renderer.render(frame.scene, frame.camera);
	}

	function resize() {
		var w = sceneEl.clientWidth || 600, h = sceneEl.clientHeight || 400;
		renderer.setSize(w, h, false);
	}

	function show() {
		root.classList.add("on");
		sceneEl.insertBefore(renderer.domElement, sceneEl.firstChild);
		active = true;
		resize();
	}

	function hide() {
		root.classList.remove("on");
		active = false;
	}

	// ---- go: build the always-present marker card (in its empty state until a
	// marker is placed), place the frame, and compute the first leg before the
	// first show().
	buildCard();
	dateBar.setBaseDays(0);
	frame.place(dateState.jd);
	refresh();

	return { show: show, hide: hide, render: render, resize: resize };
}
