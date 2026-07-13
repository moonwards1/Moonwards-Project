/* Mission Planner — the Ephemeris tab (task D1: shell; task D2: destination
 * select, departure setup, trajectory drawing, waypoints).
 *
 * The Ephemeris tab is the Solar-System-Trajectory-Plotter's authoring
 * experience, ported inside the planner (MissionPlannerTasks.md, WP-D). It
 * keeps its own plain state object — NOT a mission World — because it's a
 * scratchpad: only "Start Mission Plan" (task E2) turns a plan sketched here
 * into a World and a new mission tab. `state.leg` is deliberately shaped
 * exactly like modules/transfer-leg's own `params` (burn, waypoints,
 * legDays, destination), so that freeze is "hand these fields to a
 * transfer-leg stage" rather than a translation step.
 *
 * Physics: the actual leg — burn application, sample polyline, events, miss
 * distance — goes through transfer-leg.js's exported `computeLeg`, the same
 * function the transfer-leg module uses once a plan is frozen (per the
 * task's own "don't fork the physics"). What's local to this file is
 * everything computeLeg doesn't own: resolving a waypoint's "snap to an
 * orbital feature" request into a concrete day offset (via the snap-to
 * helpers promoted to Shared/math-utils.js), and the view-only glue — the
 * drawn polyline, waypoint gizmos, burn arrows, and readout boxes — mirrored
 * from transfer-leg.js's own `draw()` and the SST's view code, since
 * `computeLeg`'s contract (a World+stageId-keyed cache) doesn't fit a
 * viewless scratchpad.
 *
 * No mission conditions here (2026-07-12, Kim): this tab is where a user
 * plays with trajectories before any mission exists, so nothing here should
 * behave like one is already committed. Concretely, `legDays` carries no
 * user-set "arrival deadline" — every refresh() derives it fresh from
 * `finalCoastDays` (one full orbital period if the resulting arc is bound,
 * a long fixed escape coast if not), so a transfer visibly closes into a
 * loop instead of stopping wherever a duration field happened to be typed.
 * The same reasoning drops the "misses the destination by X AU" check that
 * used to ride on that duration — with no defined arrival time, "did you
 * arrive on time" isn't a coherent question yet (that judgment is the
 * marker's job once D3 lands, sliding along the whole drawn loop).
 *
 * The ship marker (task D3) is the SST's marker orchestration ported onto
 * this file's own trajectory representation: a slidable probe on the drawn
 * path with Free / Track / Target modes, the destination-at-arrival "×",
 * and the temporal-proximity ring (which lives inside
 * updateDestinationMarker and so came across with it). The mechanical layer
 * (sprites, card skeleton, slider physics, the closest-approach search) is
 * Shared/sim/marker-card.js; the mode state machine stays local by design —
 * see that file's header comment. Placement is click-to-place on the drawn
 * path (task D5, see handlePick) — the SST has no placement button either.
 * One deliberate difference from the SST: Target mode decomposes its
 * Lambert Δv with O.burnComponents — the same ecliptic-anchored frame
 * O.applyBurn re-applies it in — where the SST used the osculating r×v
 * frame, which re-applies to a slightly different Δv on inclined arcs.
 *
 * The orbit-approach ring scan (task D4) rounds out the proximity markers:
 * hollow rings where the drawn path passes near a candidate body's orbit
 * (independent of whether the body is actually there then), refreshed
 * alongside the trajectory each recompute. Ring mechanics are shared
 * (Shared/sim/approach-markers.js, same module the temporal ring above
 * uses); the scan itself is the SST's own golden-section search, ported
 * almost verbatim onto this view's leg.samples/trajSegs.
 *
 * Deliberately NOT ported here (later WP-D/E tasks): in-scene waypoint
 * dragging (G1), and the isometric 3-axis vector-editor widget SST uses for
 * burns (kept as a documented future upgrade over plain numeric fields,
 * matching how the tasks doc frames it for F5/G1 — the numeric fields
 * already match transfer-leg's own card).
 *
 * There's exactly one Ephemeris tab for the page's life (unlike mission
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
	updateLabels as brUpdateLabels, updateScales as brUpdateScales, worldSizeAtPointForPx
} from "../Shared/sim/body-renderer.js";
import { createWaypointGizmo, makeBurnArrow } from "../Shared/sim/burn-widget.js";
import { renderReadoutBoxes, positionReadoutBoxes } from "../Shared/sim/readout-panes.js";
import {
	makeShipSprite, makeXMarkSprite, orientMarkerSprite,
	markerFraction as mcMarkerFraction, sweepAngleFrom, phasingDays as mcPhasingDays,
	refineApproach as mcRefineApproach, followCrossing as mcFollowCrossing,
	buildMarkerCard as mcBuildMarkerCard, updateMarkerModeButtons as mcUpdateMarkerModeButtons,
	fmtKm, fmtTof, fmtDate
} from "../Shared/sim/marker-card.js";
import { makeRingSprite, applyTierToSprite, scaleApproachMark, pickProximityTier } from "../Shared/sim/approach-markers.js";
import { buildHelioFrame, HELIO_BODIES } from "./scene-frames.js";
import { computeLeg, defaultParams as legDefaults } from "./modules/transfer-leg/transfer-leg.js";

var O = OrbitalMath;
var SUN = systems.get("Sun");
var GM_SUN = SUN.GM;
var AU = 149597870700;
var DAY = 86400;
var JD0 = O.julianDate(2030, 1, 1, 0, 0, 0);
var SPAN_DAYS = 36525;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var MAX_WAYPOINTS = 2;   // matches transfer-leg's own card and the SST's two "create waypoint" checkboxes

// Burn-vector arrows: a fixed physical scale (AU drawn per km/s), same as
// the SST, so the dV arrow and the prograde-speed-change arrow stay
// directly comparable in length.
var BURN_VEC_SCALE = 0.03;
var DV_COLOR = 0xff5fd0, DSPEED_COLOR = 0xffd24a;
var dvHex = "#ff5fd0", spdHex = "#ffd24a";

// Marker proximity thresholds (task D3). APPROACH_FAR doubles as Track
// mode's "inside an encounter ring" engagement distance, and as the space
// ring's own farthest tier (task D4, just below).
var APPROACH_FAR = 0.004 * AU;   // m
// Orbit-approach ring tiers (task D4): distance from the drawn path to a
// candidate body's orbit *ring*, independent of whether the body is there
// then (same table as the SST). Size/thickness DECREASE with proximity (the
// far ring is the big, bold one); worldR (AU, scene units here) is the true
// physical size each tier marks, so the ring grows once the camera is close
// enough for that to read larger than the fixed on-screen size.
var APPROACH_NEAR = 0.001 * AU, APPROACH_CLOSE = 0.0002 * AU;   // m
var SPACE_TIERS = [
	{ color: 0xb9842a, opacity: 0.42, px: 26, lw: 10, worldR: 0.004  },  // 0: far   — faint, largest, thickest
	{ color: 0xd6a02f, opacity: 0.70, px: 17, lw: 7,  worldR: 0.001  },  // 1: near  — brighter, medium
	{ color: 0xfff1b0, opacity: 1.00, px: 11, lw: 5,  worldR: 0.0002 }   // 2: close — brightest, smallest, thinnest
];
// Temporal-proximity tiers: how close (in days) the destination body is to
// the meeting point at the ship's arrival time (same table as the SST).
var TEMP_FAR = 30, TEMP_NEAR = 10, TEMP_CLOSE = 3;   // days
var TEMPORAL_TIERS = [
	{ color: 0x3a6fd0, opacity: 0.50, px: 30 },   // 0: <30 d — faint blue
	{ color: 0x5aa9ff, opacity: 0.80, px: 34 },   // 1: <10 d — brighter
	{ color: 0x9fe0ff, opacity: 1.00, px: 40 }    // 2: <3 d  — bright cyan, largest
];

function fmtKmS(mps) { return (mps / 1000).toFixed(2); }

// =======================================================================
//  opts: { renderer, root } — root is planner.html's #mp-eph-view, already
//  in the DOM. Returns { show, hide, render, resize }.
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

	// ---- scratchpad state (task D2): NOT a World — origin body + a leg
	// shaped exactly like transfer-leg's own params. legDays carries NO
	// mission condition here — it's recomputed every refresh() from the
	// physics alone (see finalCoastDays), never user-set, so the drawn arc
	// just keeps going: closes into a loop if bound, coasts outward for a
	// long while if not. A real duration only becomes meaningful once a
	// plan is actually frozen (E2), at which point IT decides legDays from
	// the marker's resolved rendezvous, not this scratchpad.
	var state = {
		origin: "Earth",
		leg: {
			burn: { pro: 0, rad: 0, nrm: 0 },
			waypoints: [],
			legDays: 0,
			destination: legDefaults.destination
		},
		marker: null,          // { f0, angle (deg), mode: "free"|"track"|"target", dvBudget, ... }
		markerFocused: false   // camera pivots on the marker
	};

	var trajLine = null, endDots = [], wpMarkers = [], burnArrows = [];
	var depBurnHost = null;             // wraps the departure burn's 3 fields (readout anchor)
	var depBurnInputs = {};             // axis -> its number input (Target mode re-syncs them)
	var wpRows = [];                    // [{ card, dayInput, snapBoxes, slider, info, host, burnInputs }]

	// ---- marker state (task D3): the drawn leg as per-segment start states,
	// so the marker can be located at any global time along the whole path
	// (rebuilt by refresh(); SST's trajSegs). ---------------------------------
	var trajSegs = [];        // { r0, v0 (m, m/s), dur, tStart (s) }
	var trajTotalT = 0;       // total drawn-leg duration (s)
	var trajSampleCount = 0;  // polyline sample count (sets followCrossing's search window)
	var trajSamples = [];     // leg.samples verbatim ({ r (m), t (s) }) — the approach-ring scan's input (task D4)
	var markerSprite = null, destSprite = null, tempRing = null;
	var orbitApproachMarks = [];   // hollow-ring sprites where the path nears a body's orbit (task D4)
	var markerVelDir = null;  // THREE.Vector3 — ship heading, for the sprite's per-frame orientation
	var mk = null;            // the built marker card's refs (Shared/sim/marker-card.js)

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

	// ==== small DOM helpers (mirrors modules/transfer-leg.js's own numRow —
	// each card in this project builds its own; see lunar-skyhook.js too) -----
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

	// ==== Departure card: origin, burn, destination (no duration field — the
	// drawn arc's length is physics-derived, see finalCoastDays) --------------
	var originRow = document.createElement("div"); originRow.className = "mp-inrow";
	var originLab = document.createElement("label"); originLab.textContent = "origin"; originRow.appendChild(originLab);
	var originSel = document.createElement("select");
	HELIO_BODIES.forEach(function (name) {
		var opt = document.createElement("option"); opt.value = name; opt.textContent = name;
		if (name === state.origin) { opt.selected = true; }
		originSel.appendChild(opt);
	});
	originRow.appendChild(originSel); depHost.appendChild(originRow);
	var originInfo = muted(depHost, "");
	originSel.addEventListener("change", function () { state.origin = originSel.value; refresh(); });

	depBurnHost = document.createElement("div"); depHost.appendChild(depBurnHost);
	["pro", "rad", "nrm"].forEach(function (axis) {
		depBurnInputs[axis] = numRow(depBurnHost, "burn " + axis, "km/s", state.leg.burn[axis] / 1000, 0.1, function (v) {
			state.leg.burn[axis] = v * 1000; refresh();
		});
	});
	var depReadout = muted(depHost, "");

	var destRow = document.createElement("div"); destRow.className = "mp-inrow";
	var destLab = document.createElement("label"); destLab.textContent = "destination"; destRow.appendChild(destLab);
	var destSel = document.createElement("select");
	["(none)"].concat(HELIO_BODIES).forEach(function (name) {
		var opt = document.createElement("option");
		opt.value = name === "(none)" ? "" : name;
		opt.textContent = name;
		if (opt.value === state.leg.destination) { opt.selected = true; }
		destSel.appendChild(opt);
	});
	destRow.appendChild(destSel); depHost.appendChild(destRow);
	var destInfo = muted(depHost, "");
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
			var burnInputs = {};
			["pro", "rad", "nrm"].forEach(function (axis) {
				burnInputs[axis] = numRow(burnHost, axis, "km/s", (wp.burn[axis] || 0) / 1000, 0.05, function (v) {
					state.leg.waypoints[idx].burn[axis] = v * 1000; refresh();
				});
			});

			wpHost.appendChild(card);
			wpRows.push({ card: card, dayInput: dayInput, snapBoxes: snapBoxes, slider: slider,
			              info: info, host: burnHost, burnInputs: burnInputs });
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
	// index, and the trailing state (after the last waypoint's burn, or just
	// the departure burn if there are none) for finalCoastDays to size the
	// drawn arc's last segment from. r0/v0 is the ORIGIN's state before the
	// departure burn — the walk itself starts from just after it, same as
	// the SST's segStartR/segStartV. -------------------------------------------
	function resolveWaypoints(r0, v0, leg) {
		var entries = leg.waypoints.map(function (wp, i) {
			return { originalIndex: i, days: wp.days, burn: wp.burn,
			         snap: wp.snap, snapOffset: wp.snapOffset || 0 };
		});
		entries.sort(function (a, b) { return (a.days || 0) - (b.days || 0); });

		var vAfterDep = O.applyBurn(r0, v0, leg.burn.pro || 0, leg.burn.nrm || 0, leg.burn.rad || 0);
		var segR = r0, segV = vAfterDep, segBurn = leg.burn, tPrev = 0;
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
	// after the departure burn if there are none): one orbital period if
	// bound (capped, so a near-parabolic orbit doesn't draw for millennia),
	// else a fixed multi-year escape coast. No mission condition decides
	// this — it's the same simplified-conic heuristic the SST used, so a
	// bound transfer visibly closes into a loop and an escape trajectory
	// just trails off. The cap was originally 60 years (the SST's own
	// value); with Pluto now in HELIO_BODIES (scene-frames.js), a perfectly
	// elliptical Earth-departure transfer reaching only its vicinity already
	// has a ~75-125 year period (a ~ 18-25 AU via vis-viva), so 60 years cut
	// genuinely bound loops off before they closed — looking identical to
	// an escape trajectory even though e < 1. Raised to 500 years, which
	// comfortably covers a full loop out past Pluto's aphelion (~49 AU)
	// from any inner-system origin, while still bounding truly
	// near-parabolic inputs from drawing for millennia. Returns days.
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
		ab.lab.title = e.apsisAvailable ? "" : "needs a prograde or retrograde burn on this leg";
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

	function arrowAt(rM, vec, colorHex) {
		var origin = new THREE.Vector3(rM[0] / AU, rM[1] / AU, rM[2] / AU);
		return makeBurnArrow(origin, vec, colorHex, BURN_VEC_SCALE);
	}
	function addBurnArrowsAt(r, vBefore, burn) {
		var vAfter = O.applyBurn(r, vBefore, burn.pro || 0, burn.nrm || 0, burn.rad || 0);
		var dSpeed = O.vMag(vAfter) - O.vMag(vBefore);
		var dSpeedVec = O.vScale(O.vUnit(vAfter), dSpeed);
		var spdArrow = arrowAt(r, dSpeedVec, DSPEED_COLOR);
		var dvArrow = arrowAt(r, O.vSub(vAfter, vBefore), DV_COLOR);
		[spdArrow, dvArrow].forEach(function (a) { if (a) { frame.scene.add(a); burnArrows.push(a); } });
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
	//  Ship marker (task D3): a slidable probe on the drawn trajectory, with
	//  Free / Track / Target modes — the SST's marker orchestration, ported
	//  onto this view's trajSegs/trajTotalT representation. Mechanics
	//  (sprites, card skeleton, slider physics, the closest-approach search)
	//  come from Shared/sim/marker-card.js; placement is click-to-place on
	//  the drawn path (task D5, see handlePick below) — the SST has no
	//  placement button either, just this hint card.
	// =======================================================================
	var markerHost = q(".mp-eph-marker");
	var placeCard = document.createElement("div"); placeCard.className = "mp-card";
	var markerHint = muted(placeCard,
		"Click the drawn trajectory to place a marker: probes radius, speed, flight time, and the destination's phasing at any point along it.");
	markerHost.appendChild(placeCard);
	function setHint(text) { markerHint.textContent = text; }

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

	// Heliocentric angle (deg, 0–360) swept around the Sun from the departure
	// point to r (m) — Shared/sim/marker-card.js's sweepAngleFrom.
	function sweptFromOrigin(r) {
		if (!trajSegs.length) { return 0; }
		return sweepAngleFrom(trajSegs[0].r0, trajSegs[0].v0, r);
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
	// (Shared/sim/marker-card.js). Used by Track mode and released Target.
	function followCrossing() {
		if (!state.marker || !trajSegs.length) { return; }
		var dn = state.leg.destination;
		if (!dn || dn === state.origin) { return; }
		var orbit = systems.get(dn).orbit;
		mcFollowCrossing(state.marker, orbit, trajTotalT, trajSampleCount, stateAtGlobalTime, APPROACH_FAR);
	}

	// Target mode: hold the arrival date fixed and re-solve the TERMINAL burn
	// via Lambert so the ship still reaches the destination body at that
	// arrival time as the departure date scrubs. If the required Δv exceeds
	// the budget it "releases": the burn reverts to its captured baseline and
	// the marker falls back to geometric tracking. Runs at the start of
	// refresh(), before the trajectory is drawn, so the drawn arc reflects
	// the solved burn. The Δv decomposes via O.burnComponents — the same
	// ecliptic-anchored frame O.applyBurn re-applies it in (see header).
	function applyTargeting(dep) {
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

		// Frozen upstream burns: the terminal point's pre-burn state depends
		// only on the burns before it, never on the terminal burn itself.
		var r1, v1, t1g;
		if (term.isDeparture) { r1 = dep.r; v1 = dep.v; t1g = 0; }
		else {
			var rw = resolveWaypoints(dep.r, dep.v, state.leg);
			var e = rw.entries[term.index];
			if (!e || !e.preR) { hardFail("no leg"); return; }
			r1 = e.preR; v1 = e.preV; t1g = (e.days || 0) * DAY;
		}

		var tof = (m.targetArrJd - dateState.jd) * DAY - t1g;
		if (!(tof > DAY)) { hardFail("arrival ≤ burn"); return; }
		var target = O.bodyStateAtJD(GM_SUN, destOrbit, m.targetArrJd).r;
		var sol = O.lambert(GM_SUN, r1, target, tof, true);
		if (!sol) { hardFail("no solution"); return; }

		var dv = O.vSub(sol.v1, v1), dvMag = O.vMag(dv);
		m._targetDv = dvMag; m._targetMsg = null;
		if (dvMag > (m.dvBudget || 0)) { restoreBase(); m._encT = null; m._released = true; return; }   // over budget

		var c = O.burnComponents(r1, v1, dv);
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
	function setMarkerMode(mode) {
		var m = state.marker;
		if (!m) { return; }
		var term = terminalBurnRef().burn;
		if (m.mode === "target" && mode !== "target" && m._baseBurn) {
			term.pro = m._baseBurn.pro; term.rad = m._baseBurn.rad; term.nrm = m._baseBurn.nrm;
			m._baseBurn = null;
			if (m._savedF0 != null) { m.f0 = m._savedF0; m.angle = m._savedAngle; m._savedF0 = null; }
		}
		if (mode === "target") {
			m._savedF0 = m.f0; m._savedAngle = m.angle;      // restore here on leaving Target
			var tof = mcMarkerFraction(m.f0, m.angle) * trajTotalT;
			m.targetArrJd = dateState.jd + tof / DAY;        // hold this arrival date
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
	//  Orbit-approach rings (task D4): where the drawn path passes near a
	//  candidate body's orbit *ring*, ported from the SST almost verbatim (its
	//  own comment: "Scan the path for local minima of distance-to-each-orbit,
	//  then refine each" via a golden-section search over the true Kepler
	//  arc, not limited by polyline spacing). The ring-sprite mechanics are
	//  shared (Shared/sim/approach-markers.js); the scan and tier tables stay
	//  local, same split as the temporal ring above. Unlike the SST's
	//  trajSamples (THREE.Vector3, pre-scaled to AU), this view's leg.samples
	//  stay in metres throughout, so the scan skips the SST's AU round-trip.
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
		if (trajSamples.length < 3 || !trajSegs.length) { return out; }
		var GATE = 0.012 * AU, CAND = 0.006 * AU;
		HELIO_BODIES.forEach(function (name) {
			if (name === state.origin) { return; }
			var orbit = systems.get(name).orbit;
			if (!orbit || orbit.e >= 1) { return; }
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
		});
		return out;
	}

	// Position the destination "×" (body at arrival), the temporal ring and
	// the phasing readout, given the meeting point markerR (m) and TOF (s).
	function updateDestinationMarker(markerR, tofSec) {
		var dn = state.leg.destination;
		if (!dn) {
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			if (mk) { mk.vals.phase.textContent = "—"; }
			return;
		}
		var orbit = systems.get(dn).orbit;
		var arrJd = dateState.jd + tofSec / DAY;
		var b = O.bodyStateAtJD(GM_SUN, orbit, arrJd);
		if (!destSprite) { destSprite = makeXMarkSprite(); destSprite.renderOrder = 13; frame.scene.add(destSprite); }
		destSprite.visible = true;
		destSprite.material.color.set(systems.get(dn).color || "#ffffff");
		destSprite.position.set(b.r[0] / AU, b.r[1] / AU, b.r[2] / AU);

		var nearOrbit = orbit.e < 1 && O.distanceToOrbit(orbit, markerR) < APPROACH_FAR;
		if (nearOrbit) {
			var dt = mcPhasingDays(GM_SUN, orbit, markerR, arrJd);
			mk.vals.phase.textContent = (dt >= 0 ? "+" : "−") + Math.abs(dt).toFixed(1) + " d";
			var tier = pickProximityTier(Math.abs(dt), TEMP_FAR, TEMP_NEAR, TEMP_CLOSE);
			if (tier >= 0) {
				if (!tempRing) { tempRing = makeTempRing(); frame.scene.add(tempRing); }
				applyTierToSprite(tempRing, TEMPORAL_TIERS[tier]);
				tempRing.visible = true;
				if (markerSprite) { tempRing.position.copy(markerSprite.position); }
			} else if (tempRing) { tempRing.visible = false; }
		} else {
			mk.vals.phase.textContent = "—";
			if (tempRing) { tempRing.visible = false; }
		}
	}

	// Build the sidebar marker card (once), via Shared/sim/marker-card.js —
	// the SST's card skeleton, restyled as a normal sidebar card rather than
	// a floating overlay (mockup mock-a-phases.html:184–209 puts it there).
	function buildCard() {
		mk = mcBuildMarkerCard({
			classPrefix: "mp",
			hostEl: markerHost,
			sliderTitle: "drag to slide the marker along the whole path (0° = where it was placed); "
				+ "~10× more mouse travel than the track for fine control, ×4 finer again with Shift. "
				+ "Arrow keys nudge by ⅓° (¹⁄₁₂° with Shift) when focused.",
			modeTitles: {
				free: "slide the marker freely",
				track: "follow the destination orbit crossing while within an encounter ring (burns fixed)",
				target: "re-solve the terminal burn (Lambert) to hold the encounter as the date scrubs; releases above the Δv budget"
			},
			rows: [
				{ key: "rad", label: "radius" },
				{ key: "spd", label: "prograde velocity" },
				{ key: "lat", label: "ecliptic latitude" },
				{ key: "deg", label: "radial from origin" },
				{ key: "tof", label: "time of flight" },
				{ key: "arr", label: "arrival date" },
				{ key: "phase", label: "phasing" }
			],
			getAngle: function () { return state.marker ? state.marker.angle : 0; },
			onSliderChange: function (a) { if (state.marker) { state.marker.angle = a; updateMarker(); } },
			onRemove: function () { removeMarker(); },
			onModeClick: function (mode) { setMarkerMode(mode); },
			onBudgetChange: function (dvBudget) { if (state.marker) { state.marker.dvBudget = dvBudget; refresh(); } }
		});
		mk.el.classList.add("mp-card");   // sidebar card, not the SST's floating overlay
	}

	// Recompute the marker's world position and card readouts from its slider
	// angle and the current trajectory. Hides the visuals (and offers the
	// place button again) when unset.
	function updateMarker() {
		placeCard.style.display = state.marker ? "none" : "";
		if (!state.marker) {
			if (markerSprite) { markerSprite.visible = false; }
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			if (mk) { mk.el.style.display = "none"; }
			return;
		}
		if (!state.marker.mode) { state.marker.mode = "free"; }
		if (!markerSprite) { markerSprite = makeShipSprite(); frame.scene.add(markerSprite); }
		if (!mk) { buildCard(); }
		if (state.marker.mode === "track") { followCrossing(); }
		else if (state.marker.mode === "target") {
			if (!state.marker._released && state.marker._encT != null && trajTotalT > 0) {
				state.marker.f0 = Math.max(0, Math.min(1, state.marker._encT / trajTotalT));
				state.marker.angle = 0;                          // sit at the solved encounter
			} else { followCrossing(); }                         // released -> behave like Track
		}

		var f = mcMarkerFraction(state.marker.f0, state.marker.angle);
		var tof = f * trajTotalT;
		var s = stateAtGlobalTime(tof);
		if (!s) {
			markerSprite.visible = false; mk.el.style.display = "none";
			if (destSprite) { destSprite.visible = false; }
			if (tempRing) { tempRing.visible = false; }
			return;
		}

		markerSprite.visible = true;
		markerSprite.position.set(s.r[0] / AU, s.r[1] / AU, s.r[2] / AU);
		markerVelDir = new THREE.Vector3(s.v[0], s.v[1], s.v[2]).normalize();

		var rmag = O.vMag(s.r);                                   // m
		var lat = Math.asin(Math.max(-1, Math.min(1, s.r[2] / rmag))) * 180 / Math.PI;
		mk.el.style.display = "";
		mk.vals.rad.textContent = (rmag / AU).toFixed(3) + " AU";
		mk.vals.radKm.textContent = fmtKm(rmag);
		mk.vals.spd.textContent = (O.vMag(s.v) / 1000).toFixed(2) + " km/s";
		mk.vals.lat.textContent = (lat >= 0 ? "+" : "−") + Math.abs(lat).toFixed(1) + "°";
		mk.vals.deg.textContent = sweptFromOrigin(s.r).toFixed(1) + "°";
		mk.vals.tof.textContent = fmtTof(tof);
		mk.vals.arr.textContent = fmtDate(dateState.jd + tof / DAY);

		updateDestinationMarker(s.r, tof);

		mk.slider.disabled = (state.marker.mode !== "free");      // position driven in Track/Target
		if (document.activeElement !== mk.slider) { mk.slider.value = state.marker.angle; }

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
	}

	// Make the marker the camera's pivot — the view then rotates and zooms
	// about it. Triggered when the marker is placed.
	function focusMarker() {
		if (!state.marker || !markerSprite) { return; }
		state.markerFocused = true;
		frame.focusBody = null;
		frame.cam.target.copy(markerSprite.position);
	}

	function removeMarker() {
		state.marker = null;
		state.markerFocused = false;
		setHint("Marker removed — click the drawn trajectory to place a new one.");
		updateMarker();
	}

	// Place (or move) the marker at a global time along the path; that point
	// becomes 0° on the slider and the camera focus. Called from handlePick
	// (task D5, below) whenever a click resolves to a nearest trajectory
	// sample.
	function placeMarkerAtGlobalTime(t) {
		var f0 = trajTotalT > 0 ? Math.max(0, Math.min(1, t / trajTotalT)) : 0;
		var budget = (state.marker && state.marker.dvBudget != null) ? state.marker.dvBudget : 10000;
		// if we were targeting, restore the manual terminal burn before re-placing
		if (state.marker && state.marker.mode === "target" && state.marker._baseBurn) {
			var tb = terminalBurnRef().burn;
			tb.pro = state.marker._baseBurn.pro; tb.rad = state.marker._baseBurn.rad; tb.nrm = state.marker._baseBurn.nrm;
		}
		state.marker = { f0: f0, angle: 0, mode: "free", dvBudget: budget };
		refresh();                        // redraw (restored burn included) + updateMarker
		focusMarker();
	}

	// Target mode (and leaving it) writes burn values the input fields' own
	// handlers never saw — re-sync them from state each refresh. Display-only
	// rounding; state keeps the solver's full precision.
	function syncBurnInputs() {
		["pro", "rad", "nrm"].forEach(function (axis) {
			var inp = depBurnInputs[axis];
			if (inp && document.activeElement !== inp) {
				inp.value = parseFloat(((state.leg.burn[axis] || 0) / 1000).toFixed(3));
			}
		});
		wpRows.forEach(function (row, i) {
			var wp = state.leg.waypoints[i];
			if (!wp) { return; }
			["pro", "rad", "nrm"].forEach(function (axis) {
				var inp = row.burnInputs[axis];
				if (inp && document.activeElement !== inp) {
					inp.value = parseFloat(((wp.burn[axis] || 0) / 1000).toFixed(3));
				}
			});
		});
	}

	// ==== recompute + draw: the one function every input change calls --------
	function refresh() {
		var originSys = systems.get(state.origin);
		var dep = O.bodyStateAtJD(GM_SUN, originSys.orbit, dateState.jd);

		// Target mode re-solves the terminal burn before anything is drawn or
		// read out (task D3); the burn fields then re-sync to what's in force.
		applyTargeting(dep);
		syncBurnInputs();

		originInfo.textContent = "Heliocentric speed " + fmtKmS(O.vMag(dep.v)) +
			" km/s, distance " + (O.vMag(dep.r) / AU).toFixed(3) + " AU from the Sun.";
		if (state.leg.destination) {
			var dnow = O.bodyStateAtJD(GM_SUN, systems.get(state.leg.destination).orbit, dateState.jd);
			destInfo.textContent = "Now at " + (O.vMag(dnow.r) / AU).toFixed(3) + " AU, " +
				fmtKmS(O.vMag(dnow.v)) + " km/s.";
		} else {
			destInfo.textContent = "No destination selected.";
		}

		var vDep = O.applyBurn(dep.r, dep.v, state.leg.burn.pro || 0, state.leg.burn.nrm || 0, state.leg.burn.rad || 0);
		var elDep = O.elementsFromState(GM_SUN, dep.r, vDep);
		var depKind = elDep.e < 1 ? ("ellipse, a = " + (elDep.a / AU).toFixed(2) + " AU")
		                          : ("hyperbola, e = " + elDep.e.toFixed(2));
		var depDv = Math.hypot(state.leg.burn.pro || 0, state.leg.burn.nrm || 0, state.leg.burn.rad || 0);
		depReadout.textContent = "Resulting arc: " + depKind + ", speed " + fmtKmS(O.vMag(vDep)) +
			" km/s. Δv = " + fmtKmS(depDv) + " km/s.";

		var rw = resolveWaypoints(dep.r, dep.v, state.leg);
		rw.entries.forEach(function (e) { updateWaypointRowUI(wpRows[e.originalIndex], e, e.originalIndex); });

		// legDays carries no mission condition — it's just long enough to draw
		// the leg's own natural end: one full period past the last waypoint
		// (or the departure burn) if bound, a long escape coast if not.
		var legDays = rw.tPrev + finalCoastDays(rw.finalR, rw.finalV);
		state.leg.legDays = legDays;   // last-computed length, e.g. as a new waypoint's default-day bound

		var params = Object.assign({}, state.leg, { waypoints: rw.entries, legDays: legDays });
		var leg = computeLeg(params, { r: dep.r, v: dep.v, jd: dateState.jd });

		clearDrawn();

		// Departure burn arrows + readout box are shown regardless of whether
		// the rest of the leg is valid — they only depend on the origin body
		// and the departure burn, both always resolvable.
		var entries = [{ host: depBurnHost, data: burnReadoutData(dep.r, dep.v, state.leg.burn) }];
		addBurnArrowsAt(dep.r, dep.v, state.leg.burn);

		if (!leg.ok) {
			trajSegs = []; trajTotalT = 0; trajSampleCount = 0; trajSamples = [];   // marker + rings hide until it recovers
			clearApproachMarks();
			setStatus("err", leg.diagnostic.message);
		} else {
			// Marker support (task D3): per-segment start states over the whole
			// drawn leg, so the marker can be located at any global time.
			trajSegs = [];
			var chrono = rw.entries.slice().sort(function (a, b) { return (a.days || 0) - (b.days || 0); });
			var segR = dep.r, segV = vDep, tStart = 0;
			chrono.forEach(function (e) {
				var tWp = (e.days || 0) * DAY;
				trajSegs.push({ r0: segR, v0: segV, tStart: tStart, dur: tWp - tStart });
				segR = e.preR;
				segV = O.applyBurn(e.preR, e.preV, e.burn.pro || 0, e.burn.nrm || 0, e.burn.rad || 0);
				tStart = tWp;
			});
			trajSegs.push({ r0: segR, v0: segV, tStart: tStart, dur: legDays * DAY - tStart });
			trajTotalT = legDays * DAY;
			trajSampleCount = leg.samples.length;
			trajSamples = leg.samples;

			var U = AU;
			var pts = leg.samples.map(function (s) { return new THREE.Vector3(s.r[0] / U, s.r[1] / U, s.r[2] / U); });
			trajLine = new THREE.Line(
				new THREE.BufferGeometry().setFromPoints(pts),
				new THREE.LineBasicMaterial({ color: 0x66f0ff }));
			frame.scene.add(trajLine);

			// Just the leg's own start — no "arrival" dot: with no mission
			// duration, leg.end is wherever the loop/escape naturally runs out,
			// not a rendezvous attempt (that judgment is the marker's job, D3).
			if (leg.samples.length) { frame.scene.add(dot(leg.samples[0].r, 0xff5fd0, 6)); }

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

		readoutBoxes = renderReadoutBoxes(readoutLayer, readoutBoxes, entries,
			{ classPrefix: "mp", dvHex: dvHex, spdHex: spdHex });
		positionReadoutBoxes(readoutBoxes, mainEl, panelEl);

		// keep the marker on the (possibly reshaped) path + refresh its card
		updateMarker();
	}

	// =======================================================================
	//  Click-to-place-marker picking (task D5): a plain click places/moves
	//  the marker at the nearest trajectory sample in screen space; clicking
	//  the marker's own sprite just refocuses the camera on it — the SST's
	//  handlePick (SST:1037-1078) ported almost verbatim onto this view's
	//  trajSamples. One real adaptation: the SST projects against its own
	//  full-canvas `renderer.domElement` rect, since it never scissors a
	//  pane; this shell CAN (a mission view's floating panes share one
	//  canvas), so this reads `paneMainEl`'s own rect instead — the same
	//  pane the existing wheel-zoom `pickPoint` below already uses for
	//  exactly that reason. The Ephemeris tab happens to be single-pane
	//  (task D1), so the two rects coincide today, but this stays correct if
	//  that ever changes. `onPick` is the shared camera-controller's
	//  deferred single-click hook (fires after mouseup only if the press
	//  didn't move and wasn't the first half of a double-click), so it never
	//  fights camera rotate-drag.
	// =======================================================================
	function handlePick(e) {
		if (!trajSamples.length) { return; }
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

		// otherwise place/move the marker at the nearest trajectory sample
		// (trajSamples is in metres, unlike the SST's pre-scaled AU Vector3s
		// — same D4 distinction, so each candidate is converted before projecting)
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
		if (best < 0) {
			// clicked empty space: release the focus lock (marker stays put)
			// so the camera stops re-centring on it every zoom/update tick.
			state.markerFocused = false;
			return;
		}
		placeMarkerAtGlobalTime(trajSamples[best].t);
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
			onPan: function () { frame.focusBody = null; state.markerFocused = false; },
			lockedZoomTarget: function () {
				return (state.markerFocused && markerSprite && markerSprite.visible)
					? markerSprite.position : null;
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
			g.scale.setScalar(worldSizeAtPointForPx(frame.camera, paneMainEl, g.position, 42));
		});
		if (markerSprite && markerSprite.visible) {
			markerSprite.scale.setScalar(worldSizeAtPointForPx(frame.camera, paneMainEl, markerSprite.position, 26));
			if (markerVelDir) { orientMarkerSprite(frame.camera, markerSprite, markerVelDir); }
		}
		if (destSprite && destSprite.visible) {
			destSprite.scale.setScalar(worldSizeAtPointForPx(frame.camera, paneMainEl, destSprite.position, 22));
		}
		if (tempRing && tempRing.visible) { scaleApproachMark(frame.camera, paneMainEl, tempRing); }
		orbitApproachMarks.forEach(function (sp) { scaleApproachMark(frame.camera, paneMainEl, sp); });
		positionReadoutBoxes(readoutBoxes, mainEl, panelEl);

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

	// ---- go: place the frame and compute the first leg before the first show().
	dateBar.setBaseDays(0);
	frame.place(dateState.jd);
	refresh();

	return { show: show, hide: hide, render: render, resize: resize };
}
