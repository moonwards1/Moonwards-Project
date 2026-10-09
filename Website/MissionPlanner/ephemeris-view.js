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
 * the same function the transfer-leg module uses once a plan is adopted. What is
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
 * A SKETCH, NOT A FLIGHT. This tab answers "is this mission viable?" — which
 * departure, on which date, reaches which destination, and roughly what the
 * ship has to supply to do it. It does not model how the departure impulses
 * are actually achieved. Its departure models are deliberately simple (the
 * hand-off at the SOI edge; for a Moon origin, a two-body escape from Earth
 * with the Moon treated as a point), and that is sufficient approximation for
 * viability. Working out how a technology stack actually delivers the
 * hand-off belongs to a mission tab's Departure phase, where the real carrier
 * geometry and waypoint impulses are integrated and the user tunes them
 * against the plan's vector, refining as they go. The trajectory composed
 * there differs from this sketch in its details, noticeably so on a long
 * coast. Neither tab is wrong when they disagree; do not bend this tab's
 * models to chase the mission tab's flight.
 *
 * THE DEPARTURE CARD MEANS TWO DIFFERENT THINGS, one per origin family, and
 * departureState below is where that split lives.
 *
 * FOR EVERY ORIGIN BUT THE MOON the card IS THE HAND-OFF, not a burn. Its
 * prograde/radial/normal vector IS the ship's v-infinity — speed and heading —
 * where it leaves the origin's sphere of influence, measured against the origin
 * body's own heliocentric motion, and THE TAB'S CLOCK IS THAT HAND-OFF'S EPOCH.
 * So the drawn arc starts at the hand-off, at t = 0, and the tab's state is the
 * same thing core/adopt.js commits and modules/adopted-plan holds: a position,
 * a velocity and an epoch at the SOI edge. Nothing is re-derived across that
 * seam, so a plan adopted here and pasted back is exact. A departure
 * technology's job is to DELIVER that hand-off; how much impulse it costs and
 * when it must launch are asked BACKWARDS from it, by
 * core/departure-phase-estimate.js, and those answers never bend the drawn arc.
 *
 * FOR A MOON ORIGIN the card means the same thing but says only the SHIP's
 * half of it. Its three numbers are the v∞ the ship's OWN actions deliver at
 * Earth's SOI — the release plus any burns — on the same EARTH heliocentric
 * axes, so "prograde" means one thing across the tab. The Moon's own motion is
 * not in that number: the ship gets it for free, and core/ephemeris-lunar-departure.js
 * works out what it is still worth once Earth's well has been climbed. The
 * drawn arc uses the TOTAL, card plus that residual, so the same card on a
 * different day of the lunar month is a different trajectory — while the card
 * keeps reading what the ship has to supply.
 *
 * AND AT THIS ORIGIN ALONE THE CLOCK IS NOT THE HAND-OFF'S EPOCH. The clock is
 * the RELEASE at the Moon; the hand-off is where that release crosses Earth's
 * SOI, a couple of days and half a million kilometres later. Both are real and
 * both are kept: core/ephemeris-lunar-departure.js propagates the escape hyperbola to
 * the crossing and returns its position, velocity and epoch, the arc starts
 * there, and buildadoptSpec commits the crossing as the plan's departure while
 * the release travels separately as `releaseJd` and `lunarRelease`.
 *
 * Committing the MOON's position instead is the tempting shortcut — it is a
 * real, known point, and nearer to Earth than the SOI radius every other
 * origin starts from — and it fails silently. It would ask the technology for
 * a v∞ solved ~925,000 km from where any real departure chain hands over, and
 * the compliance boundary cannot see the difference: it compares speed, epoch
 * and aim, never position.
 *
 * WHERE ON THE SOI SPHERE the ship exits, for those other origins, comes from
 * core/ephemeris-release-arc.js: an escape hyperbola from the body's low orbit, released
 * at the equatorial point whose hyperbola leaves closest to the card's heading
 * and traced forward to the SOI edge, so the exit point tracks the card as it
 * is edited. That arc is also drawn, before time 0, in the Origin view: time 0
 * stays the SOI exit and the release sits tExit earlier. A Moon origin's exit
 * point is the Earth-SOI crossing its release reaches. Either way it is this
 * tab's own model, pasted missions included: a mission's departure chain (a
 * skyhook's real geometry, departure waypoints) leaves from a point this tab
 * does not reproduce, and the two tabs are expected to disagree by that much.
 *
 * THE SHIP MARKER is a slidable probe on the drawn path with Free / Target
 * modes, plus the destination-at-arrival "×" (updateDestinationMarker). The
 * temporal-proximity rings and the Start gate follow the
 * trajectory's orbit-approach passes instead (updateApproachGate). The
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
 * (planner.css). Start opens the name dialog, adopts the authored plan through
 * core/adopt.js — that file's header is the adopt CONTRACT — and hands the
 * serialized World to planner.js's onStartMission, which registers it as a new
 * mission tab and switches to it.
 *
 * "PASTE MISSION LINK…" decodes a shared link
 * (ui/share-link.js parses URL/fragment/blob) and loads the plan's
 * origin/burn/waypoints/destination back into THIS tab's own scratchpad state
 * (loadPastedMission), placing the marker at the plan's rendezvous — so
 * a pasted mission is revised here and then adopted into a new tab through the
 * same path as anything authored from scratch. It also opens a mission tab
 * only when the link carries a later commit from a mission that is not
 * already open in this window.
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
	bindAbsoluteDragSlider, fmtKm, fmtTof, fmtDate
} from "../Shared/sim/marker-card.js";
import { confirmDialog } from "./ui/confirm-dialog.js";
import { createInfoButton } from "./ui/info-button.js";
import { makeRingSprite, applyTierToSprite, scaleApproachMark, pickProximityTier } from "../Shared/sim/approach-markers.js";
import {
	buildHelioFrame, ORIGIN_BODIES, DESTINATION_BODIES,
	makeBodyMarkerRing, updateBodyMarkerRing
} from "./scene-frames.js";
import { computeLeg, stateAtElapsed as legStateAtElapsed, defaultParams as legDefaults } from "./modules/transfer-leg/transfer-leg.js";
import { adoptMissionWorld, defaultMissionTitle } from "./core/adopt.js";
import {
	estimateDeparture, estimateArrival, moonElongationDeg, moonProgradeSpeed,
	originSoiRadius, originLowOrbitRadius, asymptoticVInf, edgeVInf, MIN_VINF
} from "./core/departure-phase-estimate.js";
import { releaseArc, releaseArcStateAt } from "./core/ephemeris-release-arc.js";
import {
	lunarReleaseLeg, lunarReleaseLegStateAt, lunarMoonLegSamples
} from "./core/ephemeris-lunar-release-leg.js";
import { flyLunarDeparture, solveLunarCard, RELEASE_ALTITUDE } from "./core/ephemeris-lunar-departure.js";
import { Frames } from "../Shared/frames.js";
import {
	APPROACH_FAR, APPROACH_NEAR, APPROACH_CLOSE, TEMP_FAR, TEMP_NEAR, TEMP_CLOSE,
	checkProximity
} from "./core/proximity.js";
import { deserializeWorld } from "./core/world.js";
import { decodeFragmentAny } from "../Shared/exchange.js";
import { unpackMissionLink, missionFragmentFrom, WINDOW_ID } from "./ui/share-link.js";
import { readSets, latestOf } from "./core/revisions.js";
import { originWindow, destinationWindow } from "./core/ephemeris-pov-window.js";
import { equatorNormal, arrivalMark } from "./modules/arrival-approach.js";
import { createPovScenes, drawPov as drawPovScene, setPovChevron, scalePovOverlays } from "./ephemeris-pov.js";

var O = OrbitalMath;
var SUN = systems.get("Sun");
var GM_SUN = SUN.GM;
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
// than the solver's (core/ephemeris-lunar-departure.js's own reason codes).
var LUNAR_FAILURES = {
	"no-card": "No departure yet — give the ship a speed to leave Earth's SOI with.",
	"card-toward-Earth": "This departure points back at Earth from the Moon.",
	"no-pass-route": "The ship can't escape Earth with this heading: no coasting "
	           + "path from the Moon leaves on it with this release, even "
	           + "swinging past Earth. Try another date in the month or a "
	           + "different speed.",
	"pass-hits-Earth": "The only coasting path to this heading dips into Earth's "
	           + "atmosphere on the way past.",
	"no-coast": "This departure escapes, but its coast out to Earth's SOI cannot "
	           + "be timed.",
	"card-below-escape": "Below 929 m/s the ship's own share does not escape Earth "
	           + "at all, so it cannot be stated separately from the Moon's. Give "
	           + "the ship more to supply."
};

// =======================================================================
//  opts: {
//    renderer, root      — root is planner.html's #mp-eph-view, already in
//                          the DOM
//    onStartMission(worldData, title) — spawn a mission tab from a
//                          adopted serialized World; returns { ok } or
//                          { ok: false, reason } (shown in the dialog)
//    onOpenPastedMission(worldData, title, planSets) — same, for the LATER
//                          plan a pasted link carries when the mission has
//                          been updated since it was adopted
//    hasMissionTab(missionId) — is that mission tab open in this window?
//  }
//  "Paste mission link…" loads a link's plan into this tab's own scratchpad
//  (loadPlanParamsIntoState). A link from a mission still open in this window
//  stops there; otherwise a later commit opens as its own mission tab through
//  onOpenPastedMission — see loadPastedMission.
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
	// real duration only becomes meaningful at adopt, where core/adopt.js
	// decides legDays from the marker's resolved rendezvous.
	var state = {
		origin: "Earth",
		leg: {
			burn: { pro: 0, rad: 0, nrm: 0 },
			waypoints: [],
			legDays: 0,
			destination: legDefaults.destination
		},
		marker: null,          // { f0, angle (deg), mode: "free"|"target", dvBudget, ... }
		markerFocused: false,  // camera pivots on the marker
		destFocused: false,    // camera pivots on the destination "×" (updateDestinationMarker's destSprite)
		pov: null,             // null (the heliocentric view) | "origin" | "dest" — see the POV block below
		povFocus: null         // in a POV, what the camera pivots on: "body" | "chevron" | null (released)
	};

	// ==== origin/destination body rings: which two bodies the leg is FOR,
	// drawn as an equator-aligned ring so they read at a glance among the
	// dozen dots a heliocentric view otherwise shows. Mechanics (the ring
	// geometry, per-body pole orientation, the Moon-collapse fallback) live in
	// scene-frames.js's makeBodyMarkerRing/updateBodyMarkerRing, shared with
	// the Coast phase's own helio frame (mission-view.js); colours and the
	// chevron-relative size stay local, matching this file's own tier tables.
	var ORIGIN_RING_COLOR = 0x5ad1a0;
	var ORIGIN_MOON_RING_COLOR = 0xc9a8ff;
	var DEST_RING_COLOR = 0xffae42;
	var BODY_RING_PX = 13;   // half the ship chevron's own on-screen size
	var originRing = makeBodyMarkerRing();
	var destRing = makeBodyMarkerRing();
	frame.scene.add(originRing);
	frame.scene.add(destRing);

	// WHEN THE DRAWN HELIOCENTRIC ARC STARTS — the hand-off's epoch, which every
	// "t seconds along the leg" reading is measured from. That is the date bar's
	// own value at every origin but the Moon, where the bar states the RELEASE
	// and the arc starts at the Earth-SOI crossing ~2 days later. Set by
	// departureState() on each call, so anything reading it during a refresh
	// sees the epoch the arc was actually drawn from — never assume it is the
	// clock.
	var legStart = null;
	function legStartJd() { return legStart == null ? dateState.jd : legStart; }

	var trajLine = null, endDots = [], wpMarkers = [], burnArrows = [];
	var depBurnHost = null;             // wraps the departure burn's vector editor (readout anchor)
	var wpRows = [];                    // [{ card, degInput, snapBoxes, slider, info, host }]

	// ---- marker state: the drawn leg and its segment chain, so the marker can
	// be located at any global time along the whole path (rebuilt by
	// refresh()). The segments are computeLeg's own — Kepler stretches AND the
	// integrated SOI encounters between them — so the marker rides every bend
	// the drawn line makes rather than a Sun-only conic through it. ----------
	var trajLeg = null;       // computeLeg's result, the marker's position source
	var trajSegs = [];        // trajLeg.segs: { type: "kepler", r0, v0 } | { type: "enc", body, leg }, each with tStart, dur (s)
	var trajTotalT = 0;       // total drawn-leg duration (s)
	var releaseArcNow = null; // core/ephemeris-release-arc.js's escape hyperbola for the current departure, or null (a Moon origin, or nothing escaping)
	var lunarLegNow = null;   // core/ephemeris-lunar-release-leg.js's release-to-Earth-SOI path for a Moon origin, or null
	var trajSampleCount = 0;  // polyline sample count (sets followCrossing's search window)
	var trajSamples = [];     // leg.samples verbatim ({ r (m), t (s) }) — the approach-ring scan's input
	var markerSprite = null, destSprite = null, destSoi = null;
	var tempRings = [];            // temporal rings, one per qualifying orbit-approach pass
	var approachPasses = [];       // orbit-approach passes inside APPROACH_FAR (computeOrbitApproaches)
	var gatePass = null;           // the qualifying pass "Start Mission Plan" adopts: { t, r, v }
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
	// analytic functions via Shared/math-utils.js's
	// sweptTrueAnomaly/timeAtSweptTrueAnomaly, not a table sampled from the
	// drawn polyline — see Notes/decisions.md, 2026-08-28, for why sampling
	// doesn't work here.
	//
	// sweptTrueAnomaly's exactness holds only WITHIN one conic, so a waypoint
	// burn — which hands the ship to a different (a, e, nu0) mid-flight — has
	// to be walked segment by segment: each trajSegs entry's own elements own
	// its own span of degrees, and the running total (not time) is what
	// carries across a burn. Using trajSegs[0]'s elements for the whole
	// flight (as if there were no burn) is exact only up to the first
	// waypoint; past it, on a leg that sweeps multiple laps, it silently
	// answers with degrees/times from the wrong orbit, which is what dragged
	// the marker along the timeline instead of holding it.
	//
	// INSIDE AN SOI THE ANGLE IS MEASURED AROUND THE BODY, not the Sun. A
	// capture loop there is a loop around the planet: its heliocentric angle
	// stops advancing and doubles back, so a Sun-measured domain has several
	// times answering to one degree and the marker jumps between them. Around
	// the body the same loop is an ordinary 360°, still increasing — one time
	// per degree — and it gives the loop a share of the slider proportional to
	// the turning it does, instead of the sliver its heliocentric sweep is. The
	// domain is therefore "degrees turned around whichever body is in charge",
	// accumulated across segments; outside an SOI that is exactly the
	// Sun-centred sweep this has always used.
	function segElements(seg) { return O.elementsFromState(GM_SUN, seg.r0, seg.v0); }

	// Cumulative body-centred degrees along an encounter's own RK4 trail, built
	// once per segment. Steps are summed with the running maximum, so the Sun's
	// pull on the trail near the SOI edge can never hand back a domain that dips
	// — which would break the one-time-per-degree inverse below.
	function encTable(seg) {
		if (seg._degTable) { return seg._degTable; }
		var arr = seg.leg.samples;
		var r0 = arr[0].r, v0 = arr[0].v;
		var cum = [0];
		for (var k = 1; k < arr.length; k++) {
			var a = sweepAngleFrom(r0, v0, arr[k].r);   // 0-360 about the body's own plane
			var prevTurns = Math.floor(cum[k - 1] / 360);
			// Pick the lap that continues the previous step rather than wrapping.
			var best = prevTurns * 360 + a;
			if (best < cum[k - 1]) { best += 360; }
			cum[k] = Math.max(cum[k - 1], best);
		}
		seg._degTable = { t: arr.map(function (s) { return s.t; }), deg: cum };
		return seg._degTable;
	}

	// How the marker slider spaces an SOI stretch. "radial from origin": a third
	// of its body-centred degrees. "time of flight": the slider is linear in
	// time across the whole flight, so the chevron moves at a constant rate of
	// time (weight LINEAR_TIME, spanning 0-360). The waypoint controls pass no
	// weight and use the full body-centred degrees.
	var SOI_SLIDER_WEIGHT = 1 / 3, LINEAR_TIME = -1;
	function markerSoiWeight() {
		return (state.marker && state.marker.holdMode === "tof") ? LINEAR_TIME : SOI_SLIDER_WEIGHT;
	}

	// Whether the marker slider spaces this encounter by duration alone: the
	// origin's own SOI.
	function timeShared(seg, w) {
		return w != null && seg.body === Frames.escapeReferenceFor(state.origin);
	}

	// Degrees swept over part of one segment, dt seconds into it; an encounter's
	// degrees are scaled by w.
	function segDegAt(seg, dt, w) {
		if (seg.type === "enc") {
			w = w == null ? 1 : w;
			if (timeShared(seg, w)) {
				return trajTotalT > 0 ? Math.max(0, Math.min(seg.dur, dt)) / trajTotalT * 360 : 0;
			}
			var tb = encTable(seg);
			var t = Math.max(0, Math.min(tb.t[tb.t.length - 1], dt));
			for (var k = 1; k < tb.t.length; k++) {
				if (tb.t[k] >= t) {
					var span = tb.t[k] - tb.t[k - 1];
					var f = span > 1e-9 ? (t - tb.t[k - 1]) / span : 0;
					return w * (tb.deg[k - 1] + f * (tb.deg[k] - tb.deg[k - 1]));
				}
			}
			return w * tb.deg[tb.deg.length - 1];
		}
		var el = segElements(seg);
		return O.sweptTrueAnomaly(GM_SUN, el.a, el.e, el.nu, dt) * 180 / Math.PI;
	}

	// Swept degrees at global time t, accumulated across whichever segments
	// (waypoint burns, SOI encounters) precede it.
	function degAtTime(t, w) {
		if (!trajSegs.length) { return 0; }
		if (w === LINEAR_TIME) { return trajTotalT > 0 ? Math.max(0, Math.min(1, t / trajTotalT)) * 360 : 0; }
		var offset = 0;
		for (var i = 0; i < trajSegs.length; i++) {
			var seg = trajSegs[i];
			var isLast = i === trajSegs.length - 1;
			if (isLast || t <= seg.tStart + seg.dur) {
				return offset + segDegAt(seg, t - seg.tStart, w);
			}
			offset += segDegAt(seg, seg.dur, w);
		}
		return offset;
	}

	// Inverse of degAtTime: global time at which the accumulated swept angle
	// reaches deg, resolved on whichever segment's own span it falls in.
	function timeAtDeg(deg, w) {
		w = w == null ? 1 : w;
		if (!trajSegs.length) { return 0; }
		if (w === LINEAR_TIME) { return Math.max(0, Math.min(1, deg / 360)) * trajTotalT; }
		var offset = 0;
		for (var i = 0; i < trajSegs.length; i++) {
			var seg = trajSegs[i];
			var isLast = i === trajSegs.length - 1;
			var span = (isLast && seg.type !== "enc") ? Infinity : segDegAt(seg, seg.dur, w);
			if (isLast || deg <= offset + span) {
				if (seg.type === "enc") {
					// The table is non-decreasing, so the crossing is a straight
					// walk with a linear read inside the step it falls in.
					if (timeShared(seg, w)) {
						return seg.tStart + Math.max(0, Math.min(seg.dur, (deg - offset) / 360 * trajTotalT));
					}
					var target = (deg - offset) / w, tb = encTable(seg);
					if (target <= 0) { return seg.tStart; }
					for (var k = 1; k < tb.deg.length; k++) {
						if (tb.deg[k] >= target) {
							var d = tb.deg[k] - tb.deg[k - 1];
							var f = d > 1e-9 ? (target - tb.deg[k - 1]) / d : 0;
							return seg.tStart + tb.t[k - 1] + f * (tb.t[k] - tb.t[k - 1]);
						}
					}
					return seg.tStart + seg.dur;
				}
				var el = segElements(seg);
				return seg.tStart + O.timeAtSweptTrueAnomaly(GM_SUN, el.a, el.e, el.nu, (deg - offset) * Math.PI / 180);
			}
			offset += span;
		}
		return 0;
	}

	// Waypoint slider/field upper bound: the trajectory's own total sweep, but
	// capped at 720° (two full revolutions) — a bound orbit can be drawn for
	// up to 500 years (finalCoastDays), which sweeps far more than 720° and
	// would otherwise make the control's range physically meaningless.
	var WAYPOINT_MAX_DEG = 720;
	function waypointMaxDeg() {
		return trajTotalT > 0 ? Math.min(degAtTime(trajTotalT), WAYPOINT_MAX_DEG) : 360;
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
	// While the date is being scrubbed the marker's slider stays where the
	// user had it. The first date change after the marker was last touched
	// records the thumb's place along its track (datePin); every refresh the
	// date drives puts the thumb back there, whatever the reshaped flight would
	// have moved it to. Anything else — dragging the marker, a refresh that is
	// not the date's, switching view — drops the pin, so the next date drag
	// pins wherever the thumb is by then.
	var datePin = null, inDateChange = false;
	dateBar.bind(function () {
		frame.place(dateState.jd);
		if (!datePin) { datePin = captureDatePin(); }
		inDateChange = true;
		try { refresh(); } finally { inDateChange = false; }
	});

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
	// the departure leg to leave Earth's SOI (core/departure-phase-estimate.js —
	// two-body time from low orbit to the SOI edge). One instance mounts under the origin's
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
	var originLab = document.createElement("label"); originLab.textContent = "origin"; originLab.className = "mp-keylabel";originRow.appendChild(originLab);
	var originSel = document.createElement("select");
	ORIGIN_BODIES.forEach(function (name) {
		var opt = document.createElement("option"); opt.value = name; opt.textContent = name;
		if (name === state.origin) { opt.selected = true; }
		originSel.appendChild(opt);
	});
	originRow.appendChild(originSel); depHost.appendChild(originRow);
	var originInfo = muted(depHost, "");
	var depMoon = buildMoonWidget(depHost, "Moon phase at launch");

	// The destination list narrows with the origin.
	originSel.addEventListener("change", function () {
		state.origin = originSel.value;
		legStart = null;
		rebuildDestinationOptions();
		refresh();
	});

	var destRow = document.createElement("div"); destRow.className = "mp-inrow";
	var destLab = document.createElement("label"); destLab.textContent = "destination"; destLab.className = "mp-keylabel";destRow.appendChild(destLab);
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

	// The impulse editor closes the card: origin and destination first, then
	// the velocity that connects them.
	var depTitle = document.createElement("h3"); depTitle.innerHTML = "<span>Departure impulse</span>";
	depTitle.appendChild(createInfoButton("Departure impulse"));
	depHost.appendChild(depTitle);
	var wpTitle = document.querySelector(".mp-eph-waypoints").parentNode.querySelector("h3");
	if (wpTitle) { wpTitle.appendChild(createInfoButton("Waypoints")); }
	var ephTab = document.getElementById("mp-tab-eph");
	if (ephTab && !ephTab.querySelector(".mp-info")) { ephTab.appendChild(createInfoButton("Ephemeris")); }
	depBurnHost = document.createElement("div"); depHost.appendChild(depBurnHost);
	buildVectorEditor(depBurnHost, state.leg.burn, function (axis, mps) {
		state.leg.burn[axis] = mps; refresh();
	}, { unitLabel: "km/s" });
	var depReadout = muted(depHost, "");

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

			// Position, in degrees swept from the flight's start (0°) — same
			// domain as the marker card's slider (degAtTime/timeAtDeg above).
			// Setting either the field or the slider clears any snap, same as
			// how a resolved snap otherwise owns the position outright.
			function setDeg(v) {
				v = Math.max(0, Math.min(waypointMaxDeg(), v));
				state.leg.waypoints[idx].days = timeAtDeg(v) / DAY;
				state.leg.waypoints[idx].snap = null;
				refresh();
			}
			var degInput = numRow(card, "at", "°",
				Math.min(degAtTime(wp.days * DAY), waypointMaxDeg()).toFixed(1), 0.1, setDeg);

			// full-trajectory position slider: drags the waypoint from the
			// flight's start to the drawn arc's end (capped at WAYPOINT_MAX_DEG),
			// same absolute-drag physics as the marker card's slider
			// (Shared/sim/marker-card.js's bindAbsoluteDragSlider) — 1:1 with the
			// mouse, 1/3 speed with Shift, 1/12 with Ctrl.
			var slider = document.createElement("input");
			slider.type = "range"; slider.className = "mp-wp-slider";
			slider.min = 0; slider.max = waypointMaxDeg(); slider.step = 0.1;
			slider.value = Math.min(degAtTime(wp.days * DAY), waypointMaxDeg());
			slider.title = "drag the waypoint along the trajectory";
			slider.addEventListener("input", function () { setDeg(parseFloat(slider.value)); });
			bindAbsoluteDragSlider(slider, setDeg);
			card.appendChild(slider);

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

			var info = muted(card, "");

			var burnHost = document.createElement("div"); card.appendChild(burnHost);
			buildVectorEditor(burnHost, wp.burn, function (axis, mps) {
				state.leg.waypoints[idx].burn[axis] = mps; refresh();
			}, { unitLabel: "km/s" });

			wpHost.appendChild(card);
			wpRows.push({ card: card, degInput: degInput, snapBoxes: snapBoxes, slider: slider,
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
	// are counted from it, the same zero core/adopt.js commits.
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

	// The waypoint states as FLOWN. resolveWaypoints above walks Sun-only conics
	// to resolve the snaps — which are conic notions (this arc's apsis, its
	// nodes), and have no other definition — but the leg the ship actually flies
	// bends wherever it passes inside a body's SOI, so past such a pass the
	// conic walk is not where the waypoint is. Re-read each entry's pre-burn
	// state off the computed leg, which carries the encounters, so the gizmo,
	// its burn arrows and its readout sit on the drawn line. `days` are
	// untouched: they are the authored parameter computeLeg itself burned at.
	function flyWaypointStates(entries, leg) {
		if (!leg || !leg.ok) { return; }
		entries.forEach(function (e) {
			var s = legStateAtElapsed(leg, (e.days || 0) * DAY);
			if (s) { e.preR = s.r; e.preV = s.v; }
		});
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
		var maxDeg = waypointMaxDeg();
		var deg = Math.min(degAtTime(e.days * DAY), maxDeg);
		if (document.activeElement !== row.degInput) { row.degInput.value = deg.toFixed(1); }
		row.degInput.disabled = !!e.resolvedSnap;

		row.slider.max = maxDeg;
		if (document.activeElement !== row.slider) { row.slider.value = deg; }
		row.slider.disabled = !!e.resolvedSnap;

		var wpDv = Math.hypot(e.burn.pro || 0, e.burn.nrm || 0, e.burn.rad || 0);
		row.info.textContent = "+" + Math.round(e.days) + " d, " + (O.vMag(e.preR) / AU).toFixed(3) +
			" AU from Sun, coast speed " + fmtKmS(O.vMag(e.preV)) + " km/s. Δv = " + fmtKmS(wpDv) + " km/s.";
	}

	// ==== burn readouts + arrows (Shared/sim/burn-widget.js, readout-panes.js) --
	// The three figures a readout box shows, taken from the two velocities
	// themselves rather than from a card: the impulse between them, the
	// heliocentric speed it adds, and how far it tilts the plane, all read at
	// the point it acts. Callers that have the ACTUAL before/after pair hand it
	// over directly, so the box cannot end up describing an orbit other than
	// the one drawn.
	function readoutBetween(r, vBefore, vAfter) {
		var dv = O.vSub(vAfter, vBefore), mag = O.vMag(dv);
		if (mag < 1) { return null; }
		var iBefore = O.elementsFromState(GM_SUN, r, vBefore).i;
		var iAfter = O.elementsFromState(GM_SUN, r, vAfter).i;
		return {
			burnDv: mag / 1000,
			planeChange: (iAfter - iBefore) * 180 / Math.PI,
			progradeDv: (O.vMag(vAfter) - O.vMag(vBefore)) / 1000
		};
	}

	// A waypoint's box, where the burn is stated as card components and the leg
	// applies it at exactly this state — so re-applying it here reproduces the
	// leg's own "after" velocity outright.
	function burnReadoutData(r, vBefore, burn) {
		return readoutBetween(r, vBefore,
			O.applyBurn(r, vBefore, burn.pro || 0, burn.nrm || 0, burn.rad || 0));
	}

	// True when there is no departure to describe: a Moon origin whose card
	// core/ephemeris-lunar-departure.js cannot fly, or a card that does not escape the
	// reference's SOI at all. The second covers the tab's own opening state —
	// with no card there is no trajectory, and drawing one would just be the
	// origin body's own orbit around the Sun wearing a ship's colour.
	function noDeparture(hand) { return !!(hand.lunar && !hand.lunar.ok) || !hand.escapes; }

	// The DEPARTURE's box, at every origin. It reads the hand-off state itself
	// — the position and velocity computeLeg is handed, against the escape
	// reference's own motion — so the box is a description of the drawn arc's
	// first instant rather than a second calculation that can drift from it.
	//
	// At a MOON origin that difference is the whole point: the ship's velocity
	// at the Moon still has Earth's well to climb, so a box built from it
	// states a heliocentric speed and plane the ship never actually flies. What
	// the arc leaves on is card PLUS the Moon's residual, which is what
	// hand.v holds (core/ephemeris-lunar-departure.js solves it).
	//
	// A refused lunar departure has no hand-off: hand.v is the Moon's own
	// motion, whose difference from Earth's is the Moon's orbital velocity and
	// not a departure at all. There is nothing to state, so the box goes away
	// with the trajectory.
	function departureReadout(hand) {
		if (noDeparture(hand)) { return null; }
		return readoutBetween(hand.r, hand.body.v, hand.v);
	}

	// Drawn at the hand-off point, which is where the arc starts: the speed the
	// departure adds to the reference body's own motion, and the vector it adds.
	function addDepartureArrows(hand) {
		if (noDeparture(hand)) { return; }
		var dv = O.vSub(hand.v, hand.body.v);
		if (O.vMag(dv) < 1) { return; }
		var dSpeedVec = O.vScale(O.vUnit(hand.v), O.vMag(hand.v) - O.vMag(hand.body.v));
		var origin = new THREE.Vector3(hand.r[0] / AU, hand.r[1] / AU, hand.r[2] / AU);
		var pair = makeBurnArrowPair(origin, dSpeedVec, dv, DSPEED_COLOR, DV_COLOR);
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
	var HINT_DEFAULT = "Click the trajectory to place a ship marker";
	function setHint(text) { if (markerHint) { markerHint.textContent = text; } }
	function setCardEmpty(empty) { if (mk) { mk.el.classList.toggle("mp-empty", empty); } }

	// Heliocentric state (r,v in m, m/s) at a global time along the path. Time 0
	// is the SOI exit; before it, the escape hyperbola from the release
	// (releaseArcNow) when there is one, null otherwise.
	function stateAtGlobalTime(t) {
		if (!trajSegs.length) { return null; }
		if (t < 0) { return releaseStateAt(t); }
		return legStateAtElapsed(trajLeg, t);
	}

	function releaseStateAt(t) {
		if (releaseArcNow) {
			if (t < -releaseArcNow.tExit) { return null; }
			var rel = releaseArcStateAt(releaseArcNow, releaseArcNow.tExit + t);
			var body = Frames.bodyHelioState(state.origin, legStartJd() + t / DAY);
			return { r: O.vAdd(body.r, rel.r), v: O.vAdd(body.v, rel.v) };
		}
		if (lunarLegNow) {
			if (t < -lunarLegNow.coast) { return null; }
			var geo = lunarReleaseLegStateAt(lunarLegNow, lunarLegNow.coast + t);
			var earth = Frames.bodyHelioState("Earth", legStartJd() + t / DAY);
			return { r: O.vAdd(earth.r, geo.r), v: O.vAdd(earth.v, geo.v) };
		}
		return null;
	}

	// How long before the SOI exit the flight is drawn from: the release arc's
	// flight time, or at a Moon origin the time from the release to Earth's SOI.
	function leadBeforeExit() {
		return releaseArcNow ? releaseArcNow.tExit : lunarLegNow ? lunarLegNow.coast : 0;
	}

	// The earliest time the marker may sit at: the SOI exit, or in the origin
	// view the release before it.
	function markerFloorT() { return state.pov === "origin" ? -leadBeforeExit() : 0; }

	// Heliocentric angle (deg, 0–360) swept around the Sun from the flight's
	// start (the SOI-edge point) to r (m) — Shared/sim/marker-card.js's
	// sweepAngleFrom.
	function sweptFromOrigin(r) {
		if (!trajSegs.length) { return 0; }
		var s = stateAtGlobalTime(0);
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
	// inverse, which is what makes the adopt/paste round trip lossless), and
	// the epoch is the clock's. The position is the body's plus the point
	// where the release arc (core/ephemeris-release-arc.js) reaches the SOI edge, so
	// editing the card moves the exit point with it.
	// A ship with no meaningful v-infinity has no asymptote to sit on and no
	// flight to start, so it departs from the body's own position.
	//
	// A MOON ORIGIN — the card states only the SHIP's share of the v∞, on the
	// same Earth heliocentric axes as every other origin's. The Moon's own
	// motion is added by core/ephemeris-lunar-departure.js, which works out what that
	// motion is still worth once Earth's well has been climbed. There is no
	// offset to choose: the release fixes an escape hyperbola outright and its
	// Earth-SOI crossing is computed rather than constructed.
	//
	// Returns { body, r, v, jd, vInfVec, vInf, offset, lunar, escapes }, where
	// `jd` is the epoch of the returned state. That is the clock at every
	// origin but the Moon, where the clock is the RELEASE and the returned
	// state is the crossing a couple of days later.
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

	// A Moon origin: solve the card, report what the Moon adds to it, and hand
	// back the Earth-SOI crossing that departure reaches. A departure this file
	// does not support — or one whose coast time is undefined, leaving no
	// crossing to state — still returns a state, the Moon's own with no v∞, so
	// the readouts that only need the origin body stay continuous across the
	// boundary. Nothing derived from a FLIGHT is drawn
	// there: refresh() clears the trajectory and the departure box (noDeparture)
	// and the card states the reason.
	//
	// `body` is EARTH either way, supported or not. It is the state the card's
	// numbers are measured against (cardVInf builds its axes from exactly
	// this), which is what `body` means at every other origin too. Handing back
	// the Moon when a departure is refused would switch reference mid-scrub —
	// a discontinuity in everything read off it, worth ~190 m/s in the Moon
	// widget's speed bar right where a departure stops being supported.
	function lunarDepartureState() {
		var jd = dateState.jd;
		var body = Frames.bodyHelioState("Earth", jd);
		var moon = Frames.bodyHelioState("Moon", jd);
		var lunar = flyLunarDeparture({ jd: jd, card: state.leg.burn });
		if (!lunar.ok || !lunar.soiExit) {
			return { body: body, r: moon.r, v: moon.v, jd: jd,
			         vInfVec: [0, 0, 0], vInf: 0, offset: [0, 0, 0],
			         lunar: lunar.ok ? { ok: false, reason: "no-coast" } : lunar,
			         escapes: false, release: null, lunarLeg: null };
		}
		// THE HAND-OFF IS THE SOI CROSSING. The departure ends where the ship
		// leaves Earth's sphere of influence, so that crossing — its position,
		// its velocity and its epoch — is the state this tab commits and the
		// state the drawn coast starts from. core/ephemeris-lunar-departure.js fixes all
		// three by propagating the escape hyperbola the release sets up.
		//
		// The epoch is therefore NOT the clock at this origin, alone among the
		// origins: the clock is the RELEASE, and the crossing is a couple of
		// days later. Both travel with the adopted mission — the crossing as
		// the plan's departure state, the release as `releaseJd` and
		// `lunarRelease` (buildadoptSpec) — so neither has to be recovered
		// from the other.
		//
		// Velocity is stated as the EDGE speed, which is simply what the ship
		// has at the crossing: Earth still holds ~98 m/s of a 4.3 km/s
		// departure out there. That is what a hand-off vector means everywhere
		// in core/, and what the compliance boundary measures a delivered
		// hand-off in.
		var exit = lunar.soiExit;
		var atExit = Frames.bodyHelioState("Earth", jd + exit.dt / DAY);
		return {
			body: atExit,
			r: O.vAdd(atExit.r, exit.r),
			v: O.vAdd(atExit.v, exit.v),
			jd: jd + exit.dt / DAY,
			vInfVec: exit.v.slice(),
			vInf: O.vMag(exit.v),
			offset: exit.r.slice(),
			lunar: lunar,
			escapes: true,
			release: null,
			lunarLeg: lunarReleaseLeg(lunar)
		};
	}

	// The card's own direction, scaled from the EDGE speed it states to the
	// hyperbolic excess left once the reference's well is fully paid — the
	// velocity the drawn arc leaves on. Handing the arc the edge speed instead
	// would let it keep energy the primary is still owed: 147 m/s of a 3 km/s
	// card, 322 m/s of a 1.5 km/s one. Null when the card does not escape at
	// all, which is not a departure to draw.
	function flownVInfVec(vEdgeVec, origin) {
		var edge = O.vMag(vEdgeVec);
		if (!(edge > 1e-6)) { return null; }
		var asym = asymptoticVInf(edge, origin);
		return (asym != null && asym >= MIN_VINF) ? O.vScale(vEdgeVec, asym / edge) : null;
	}

	function simpleDepartureState() {
		var refName = Frames.escapeReferenceFor(state.origin);
		var body = Frames.bodyHelioState(refName, dateState.jd);
		var b = state.leg.burn;
		var v = O.applyBurn(body.r, body.v, b.pro || 0, b.nrm || 0, b.rad || 0);
		var vInfVec = O.vSub(v, body.v), vInf = O.vMag(vInfVec);   // the card, at the SOI edge
		var flown = flownVInfVec(vInfVec, state.origin);
		var R = originSoiRadius(state.origin);
		// An escaping card has a release arc, and the exit point is where that
		// arc reaches the SOI edge. A card that does not escape draws nothing,
		// so its offset only has to be finite.
		var sys = systems.get(refName);
		var arc = (flown && R > 0) ? releaseArc({
			GM: sys.GM, rLow: originLowOrbitRadius(state.origin), rSoi: R, vEdgeVec: vInfVec,
			pole: sys.pole ? O.poleVectorEcliptic(sys.pole.ra, sys.pole.dec) : null }) : null;
		var release = (arc && arc.ok) ? arc : null;
		var offset = release ? release.exit.r.slice()
			: (R > 0 && vInf > 1e-6) ? O.vScale(O.vUnit(vInfVec), R) : [0, 0, 0];
		return { body: body, r: O.vAdd(body.r, offset),
		         v: flown ? O.vAdd(body.v, flown) : body.v.slice(), jd: dateState.jd,
		         vInfVec: vInfVec, vInf: vInf, offset: offset,
		         lunar: null, escapes: !!flown, release: release, lunarLeg: null };
	}

	// How long the departure phase lasts and when it starts. For a Moon origin
	// both are measured off the flight that was just flown — the release epoch
	// IS the clock. Every other origin estimates it backwards from the
	// hand-off, which is all that is knowable there.
	function departureEstimateFor(hand) {
		if (state.origin === "Moon") {
			var days = hand.lunar.ok ? hand.lunar.coastDays : null;
			return (hand.lunar.ok && days != null)
				? { ok: true, seconds: days * DAY, days: days,
				    jdLaunch: hand.lunar.jd, profile: "lunar-coast",
				    vInf: hand.vInf, flight: hand.lunar }
				: { ok: false, reason: hand.lunar.reason || "no-coast" };
		}
		return estimateDeparture({ origin: state.origin, vInfVec: hand.vInfVec,
			jdHandoff: dateState.jd });
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
	// inside an encounter ring; adopt when out of range
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
		// more. Two bounded passes, never an iteration.
		function frameAt() {
			var hand = departureState();
			if (term.isDeparture) {
				return { r1: hand.r, v1: hand.body.v, ref: hand.body, t1g: 0 };
			}
			var rw = resolveWaypoints(hand.r, hand.v, state.leg);
			// The leg last drawn, so a waypoint past a flyby solves from where it
			// actually sits. This runs before this pass's own leg exists; the burn
			// being solved is the only thing that has moved since, and the solve
			// is re-run every refresh.
			flyWaypointStates(rw.entries, trajLeg);
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

		// THE CARD THAT DELIVERS WHAT LAMBERT ASKED FOR. Lambert answers in the
		// frame the ARC flies — for the departure that is a hyperbolic excess,
		// since the arc leaves on the asymptote. A waypoint impulse is a real
		// impulse in deep space and converts not at all; every other origin's
		// departure converts from that asymptote to the edge speed the card
		// states.
		//
		// A MOON ORIGIN has to be INVERTED instead. Lambert states the TOTAL
		// v∞ the arc needs, and the card holds only the ship's share of it, so
		// writing the total in would bill the ship for the Moon's contribution
		// as well — and the next recompute would add the residual on top of
		// that again, overshooting further on every refresh. The card whose
		// own flight delivers this total is solved for in
		// core/ephemeris-lunar-departure.js, and the figure the budget is read against
		// is that card: the ship's bill, which is what the row is labelled.
		//
		// Returns null when no card reaches the ask — the departure is
		// released rather than given a number that is not a departure.
		var isMoon = term.isDeparture && state.origin === "Moon";
		function cardFor(dvVec, fr) {
			if (isMoon) {
				// Lambert's answer is the velocity wanted AT the hand-off, which
				// for a Moon origin is the SOI crossing — so the solve is asked
				// for it THERE ("exit"), not as an asymptote. Rescaling this
				// vector to asymptotic magnitude instead would keep its
				// direction, and the velocity has not finished turning onto the
				// asymptote at the SOI: ~23 m/s of aim error, which a long coast
				// turns into most of a million kilometres.
				//
				// The epoch it solves at is the RELEASE — the clock — never the
				// hand-off's own epoch two days downstream.
				var s = solveLunarCard({ jd: dateState.jd, seedCard: term.burn,
				                         vInfVec: dvVec, at: "exit" });
				if (!s.ok) { return null; }
				return { c: s.card, mag: O.vMag(s.flight.cardVec) };
			}
			var vec = dvVec;
			if (term.isDeparture) {
				var mg = O.vMag(dvVec);
				var e = mg > 1e-6 ? edgeVInf(mg, state.origin) : null;
				if (e != null) { vec = O.vScale(dvVec, e / mg); }
			}
			return { c: O.burnComponents(fr.r, fr.v, vec), mag: O.vMag(vec) };
		}

		var got = cardFor(O.vSub(sol.v1, v1), ref);
		if (!got) { hardFail("no lunar card"); return; }
		var dvMag = got.mag, c = got.c;

		// Second pass: with the vector above in force the derived exit point
		// has moved onto the new heading, so re-solve from where the ship
		// actually leaves. Nothing is committed until after the budget check.
		// A Moon origin takes it too: its exit point is the SOI crossing the
		// release flies to, so a new card moves it just as a new heading moves
		// a derived one.
		if (term.isDeparture) {
			var keep = { pro: term.burn.pro, rad: term.burn.rad, nrm: term.burn.nrm };
			term.burn.pro = c.pro; term.burn.nrm = c.nrm; term.burn.rad = c.rad;
			var f2 = frameAt();
			term.burn.pro = keep.pro; term.burn.rad = keep.rad; term.burn.nrm = keep.nrm;
			if (f2) {
				var sol2 = O.lambert(GM_SUN, f2.r1, target, tof, true);
				if (sol2) {
					var got2 = cardFor(O.vSub(sol2.v1, f2.v1), f2.ref);
					if (got2) { dvMag = got2.mag; c = got2.c; }
				}
			}
		}

		// The row shows the whole plan's Δv: the solved terminal burn plus the
		// departure card and every other waypoint, which stay as authored.
		var totalDv = dvMag;
		var allBurns = [state.leg.burn].concat(state.leg.waypoints.map(function (w) { return w.burn; }));
		for (var bi = 0; bi < allBurns.length; bi++) {
			var ob = allBurns[bi];
			if (ob === term.burn) { continue; }
			totalDv += Math.sqrt((ob.pro || 0) * (ob.pro || 0) + (ob.nrm || 0) * (ob.nrm || 0) + (ob.rad || 0) * (ob.rad || 0));
		}
		m._targetDv = totalDv; m._targetMsg = null;
		if (dvMag > (m.dvBudget || 0)) { restoreBase(); m._encT = null; m._released = true; return; }   // over budget

		term.burn.pro = c.pro; term.burn.nrm = c.nrm; term.burn.rad = c.rad;
		m._encT = t1g + tof; m._released = false;
	}

	// Switch the marker behaviour. Entering Target adopts the current
	// arrival date and snapshots BOTH the terminal burn and the marker's own
	// position (so each can be restored); leaving Target restores that manual
	// burn. The marker keeps its path-fraction across the switch; the held
	// arrival date comes from the trajectory's own closest approach, never from
	// the marker, so toggling does not walk it.
	function setMarkerMode(mode, keepBurn) {
		var m = state.marker;
		if (!m) { return; }
		var term = terminalBurnRef().burn;
		if (m.mode === "target" && mode !== "target" && m._baseBurn && !keepBurn) {
			term.pro = m._baseBurn.pro; term.rad = m._baseBurn.rad; term.nrm = m._baseBurn.nrm;
			m._baseBurn = null;
		}
		if (mode === "target") {
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
			m._scrubbed = false;   // start glued to the solved encounter until dragged
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
		tempRings.forEach(function (m) { frame.scene.remove(m); if (m.material) { m.material.dispose(); } });
		tempRings = [];
		approachPasses = [];
	}
	function rebuildApproachMarks() {
		clearApproachMarks();
		approachPasses = computeOrbitApproaches();
		approachPasses.forEach(function (c) {
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
		// The last sample is a candidate too: a flight aimed at the body itself
		// (Target mode) ends there on impact, so its closest approach to the ring
		// is the leg's final point, with no later sample to confirm a minimum.
		for (var m = 1; m < n; m++) {
			var next = m < n - 1 ? dists[m+1] : Infinity;
			if (dists[m] < CAND && dists[m] < dists[m-1] && dists[m] <= next) {
				var r = mcRefineApproach(orbit, stateAtGlobalTime, trajSamples[m-1].t,
					trajSamples[Math.min(m+1, n-1)].t);
				var tier = r ? pickProximityTier(r.dist, APPROACH_FAR, APPROACH_NEAR, APPROACH_CLOSE) : -1;
				if (tier >= 0) {
					out.push({ pos: new THREE.Vector3(r.r[0] / AU, r.r[1] / AU, r.r[2] / AU),
					           r: r.r, t: r.t, jd: legStartJd() + r.t / DAY,
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
	// its SOI sphere, given the meeting point's TOF (s) — these track wherever
	// the marker is scrubbed to, the manual side of choosing a rendezvous. The
	// temporal ring and the "Start Mission Plan" gate do NOT follow the marker:
	// see updateApproachGate. The card's arrival/phasing/closest-approach/
	// capture rows are likewise fixed to the trajectory — see
	// updateApproachReadouts.
	function updateDestinationMarker(tofSec) {
		var dn = state.leg.destination;
		if (!dn) {
			if (destSprite) { destSprite.visible = false; }
			if (destSoi) { destSoi.visible = false; }
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
	}

	// The temporal rings and the marker card's "Start Mission Plan" gate, driven
	// by the trajectory's orbit-approach passes (computeOrbitApproaches) — fixed
	// properties of the drawn path, so they hold whether or not a marker has
	// been placed or where it sits. A pass is a closest approach to the
	// destination's orbit ring that already clears the SPACE limit; the TIME
	// question is then how far apart the ship and the destination pass through
	// that point (core/proximity.js's checkProximity). Each pass inside the
	// time limit gets a temporal ring on the ship's position there, tiered by
	// that offset; the pass with the smallest offset is the one Start Mission
	// Plan adopts. The button's note always says why, enabled or not.
	function updateApproachGate() {
		var dn = state.leg.destination;
		tempRings.forEach(function (m) { frame.scene.remove(m); if (m.material) { m.material.dispose(); } });
		tempRings = [];
		gatePass = null;

		var reason, enabled = false;
		if (!dn) {
			reason = "Select a destination to enable";
		} else if (!approachPasses.length) {
			reason = "The trajectory never comes within " + (APPROACH_FAR / AU).toFixed(3) + " AU of " +
				dn + "'s orbit.";
		} else {
			var orbit = systems.get(dn).orbit, bestDt = Infinity, best = null;
			approachPasses.forEach(function (c) {
				var prox = checkProximity(GM_SUN, orbit, c.r, c.jd);
				if (prox.dtDays != null && Math.abs(prox.dtDays) < bestDt) { bestDt = Math.abs(prox.dtDays); best = c; }
				if (!prox.ok) { return; }
				var tier = pickProximityTier(Math.abs(prox.dtDays), TEMP_FAR, TEMP_NEAR, TEMP_CLOSE);
				var ring = makeTempRing();
				applyTierToSprite(ring, TEMPORAL_TIERS[tier]);
				ring.position.copy(c.pos);
				frame.scene.add(ring); tempRings.push(ring);
			});
			if (bestDt < TEMP_FAR) {
				var sAt = stateAtGlobalTime(best.t);
				if (sAt) { gatePass = { t: best.t, r: sAt.r, v: sAt.v }; enabled = true; }
				reason = "The trajectory reaches " + dn + " inside both closest-approach limits " +
					"(space and time) — passing within " + bestDt.toFixed(1) + " d of it.";
			} else {
				reason = "The trajectory's nearest pass of " + dn + "'s orbit is timed " + bestDt.toFixed(1) +
					" d off — needs to be within " + TEMP_FAR + " d of " + dn + " passing that point.";
			}
		}

		if (!mk || !mk.startBtn) { return; }
		mk.startBtn.disabled = !enabled;
		mk.startNote.textContent = reason;
	}

	// Build the floating marker card (once), via Shared/sim/marker-card.js's
	// card skeleton, positioned over the 3D pane by planner.css's
	// .mp-eph-marker.
	function buildCard() {
		mk = mcBuildMarkerCard({
			classPrefix: "mp",
			title: "Ship marker",
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
			removeTitle: "Delete trajectory and start fresh",
			holdMode: (state.marker && state.marker.holdMode) || "deg",
			onHoldChange: function (mode) { if (state.marker) { state.marker.holdMode = mode; updateMarker(); } },
			onSliderChange: function (deg) {
				if (!state.marker) { return; }
				// In a POV the slider reads days through its window, not degrees.
				var t = (state.pov && povWin) ? povWin.t0 + deg * DAY : timeAtDeg(deg, markerSoiWeight());
				state.marker.f0 = trajTotalT > 0 ? Math.max(markerFloorT() / trajTotalT, Math.min(1, t / trajTotalT)) : 0;
				state.marker.angle = 0;
				datePin = null;
				// Target mode otherwise glues position to the solved encounter every
				// refresh (see updateMarker) — a drag takes over the DISPLAY only;
				// the held arrival date and the Lambert solve never read f0/angle,
				// so the lock is untouched.
				if (state.marker.mode === "target") { state.marker._scrubbed = true; }
				updateMarker();
			},
			onRemove: function () { resetSetup(); },
			onModeClick: function (mode, e) { setMarkerMode(mode, !!(e && e.shiftKey)); },
			onBudgetChange: function (dvBudget) { if (state.marker) { state.marker.dvBudget = dvBudget; refresh(); } }
		});
		// Head bar is space-between, so a third child lands midway between the
		// title and the Reset button.
		mk.el.querySelector(".mp-marker-title").after(createInfoButton("Ship marker"));
		mk.el.classList.add("mp-card");   // card look; .mp-eph-marker (planner.css) floats it over the pane

		// The no-marker hint, shown only in the .mp-empty state — the card is
		// always present, so it also serves as the "place a marker" prompt.
		markerHint = document.createElement("div");
		markerHint.className = "mp-muted mp-marker-hint";
		markerHint.textContent = HINT_DEFAULT;
		mk.el.appendChild(markerHint);

		// "Start Mission Plan": enabled when the trajectory has an orbit-approach
		// pass inside both closest-approach limits, space and time (see
		// updateApproachGate). Click:
		// name dialog → core/adopt.js → planner.js spawns the tab.
		mk.startBtn = document.createElement("button");
		mk.startBtn.type = "button";
		mk.startBtn.className = "mp-btn mp-big";
		mk.startBtn.textContent = "Start Mission Plan";
		mk.startBtn.title = "adopt this flight plan into a new mission tab.";
		mk.startBtn.disabled = true;
		mk.startBtn.addEventListener("click", function () {
			var f = buildadoptSpec();
			if (!f.ok) { mk.startNote.textContent = f.reason; return; }   // gate should prevent this
			openDialog({
				title: "Name this mission",
				value: f.defaultTitle,
				okLabel: "Create mission tab",
				onOk: function (name) {
					var title = (name || "").trim() || f.defaultTitle;
					return opts.onStartMission(adoptMissionWorld(f.spec), title);
				}
			});
		});
		mk.el.appendChild(mk.startBtn);
		mk.startNote = muted(mk.el, "");

		// "Paste mission link…": a link copied with a mission tab's "Copy mission
		// link" loads its plan back into THIS tab's own scratchpad
		// (loadPastedMission — which plan, and whether a tab opens too, is
		// decided there), so it can be revised before Start Mission Plan is
		// clicked — the same adopt/spawn path as anything authored from
		// scratch. The dialog's input auto-fills from the
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

	// Everything core/adopt.js's spec wants, read off the CURRENT authored
	// state: the origin body's pre-burn helio state at the tab's clock, the
	// resolved waypoint days (snaps made concrete — the same resolveWaypoints
	// pass refresh() draws from), and the marker's rendezvous — its time along
	// the path as the arrival epoch, its velocity against the destination body's
	// as the arrival v∞. adopt re-solves the SOI-edge hand-off itself, from
	// these same numbers, so the mission's coast starts exactly where this tab
	// drew the flight starting. Returns { ok: false, reason } if the gate's
	// preconditions somehow aren't met.
	function buildadoptSpec() {
		var dn = state.leg.destination;
		if (!trajSegs.length || !(trajTotalT > 0) || !gatePass) {
			return { ok: false, reason: "No drawn trajectory reaches the destination." };
		}
		if (!dn) { return { ok: false, reason: "No destination selected." }; }

		var hand = departureState();
		var rw = resolveWaypoints(hand.r, hand.v, state.leg);
		// The rendezvous is the qualifying pass (updateApproachGate), wherever
		// the marker happens to sit.
		var tof = gatePass.t;
		var s = { r: gatePass.r, v: gatePass.v };

		var arrJd = legStartJd() + tof / DAY;
		var b = O.bodyStateAtJD(GM_SUN, systems.get(dn).orbit, arrJd);
		return {
			ok: true,
			defaultTitle: defaultMissionTitle(state.origin, dn, dateState.jd),
			spec: {
				origin: state.origin,
				destination: dn,
				// The hand-off state and its epoch are handed over verbatim —
				// adopt re-derives nothing, so what the planner was shown is
				// exactly what the mission commits. For a Moon origin all three
				// are the Earth-SOI crossing the release flies to, so the epoch
				// is NOT the clock; the clock is the release, and travels
				// separately as releaseJd.
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

	// The inverse of buildadoptSpec/core/adopt.js: reconstructs this tab's
	// scratchpad from a mission World that was previously adopted — the back half
	// of "Paste mission link…", so a shared mission loads here for revision
	// instead of spawning a tab. Reads the adopted-plan and transfer-leg stages'
	// own params (the same two stages core/adopt.js writes); every other stage
	// — the departure and arrival techs and their legs — is ignored, because
	// this tab only ever edits the plan, never a tech's configuration.
	//
	// departure.{r,v,jd} IS the coast's starting state, full stop (the
	// Departure→Coast hand-off is a given heading and speed, not a burn formula
	// — see transfer-leg.js's header and ARCHITECTURE.md's "Phases are chains").
	// Whatever composed to produce it — a skyhook release, a carrier chain,
	// departure waypoints — is upstream's business and opaque from here.
	//
	// So this loads its VELOCITY verbatim: the clock opens at departure.jd,
	// and the velocity decomposes against the origin body's own motion there
	// (O.burnComponents, the exact inverse of the O.applyBurn departureState
	// re-applies). The POSITION is this tab's own — where the release arc
	// from the card's heading reaches the SOI — which is exactly where a plan authored here started, so such
	// a plan round-trips exactly. A plan whose departure chain left from
	// somewhere else on the SOI sphere is drawn from this tab's point instead,
	// and the two tabs disagree by that much.
	// `injectionJd` on older saves is provenance now, and ignored.
	//
	// A MOON ORIGIN reopens from the other end. Its card is a release, not a
	// hand-off, so the plan's own `lunarRelease` — epoch and impulse — is what
	// restores it, and the hand-off is re-flown from there. Decomposing
	// departure.v the way the branch above does would read an Earth-frame
	// velocity as a Moon-frame impulse and draw a different flight entirely.
	//
	// Waypoint snap-to intent doesn't survive a adopt (resolveWaypoints
	// already turned it into a concrete day before core/adopt.js ever saw
	// it), so restored waypoints land unsnapped at their adopted day — still
	// revisable, just not re-snappable to the same feature without
	// re-checking the box. Waypoint burns themselves copy straight across.
	function loadadoptedPlanIntoState(world) {
		var stages = world.stages();
		var fpStage = stages.filter(function (s) { return s.moduleId === "adopted-plan"; })[0];
		var legStage = stages.filter(function (s) { return s.moduleId === "transfer-leg"; })[0];
		if (!fpStage || !legStage) {
			return { ok: false, reason: "That mission has no adopted flight plan to load here." };
		}
		return loadPlanParamsIntoState(fpStage.params || {}, legStage.params || {});
	}

	// The body of the above, over the two stages' params directly — a link's
	// `sketch` (ui/share-link.js) carries exactly these.
	function loadPlanParamsIntoState(p, lp) {
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
		// backwards. A plan whose departure that release does NOT reach gets a
		// re-solved card instead (lunarCardFor). A lunar plan with no release
		// record is reported rather than guessed at.
		var burn;
		if (p.origin === "Moon") {
			if (!p.lunarRelease || !isFinite(p.lunarRelease.jd)) {
				return { ok: false, reason: "That lunar mission's plan carries no release to reopen." };
			}
			var lr = p.lunarRelease.burn || {};
			burn = { pro: lr.pro || 0, rad: lr.rad || 0, nrm: lr.nrm || 0 };
			dateBar.setJd(p.lunarRelease.jd);
			burn = lunarCardFor(p.lunarRelease.jd, burn, p.departure) || burn;
		} else {
			dateBar.setJd(p.departure.jd);
			var natural = O.bodyStateAtJD(GM_SUN, originSys.orbit, p.departure.jd);
			var vInfVec = O.vSub(p.departure.v, natural.v);
			burn = O.vMag(vInfVec) > 1e-6
				? O.burnComponents(natural.r, natural.v, vInfVec)
				: { pro: 0, rad: 0, nrm: 0 };
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
		// adopted waypoint days already count from the coast's start, which is
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

		// Place the marker back at the adopted rendezvous — trajTotalT is now
		// current (the refresh() just above), so the fraction this resolves
		// to is against the freshly-restored trajectory, not a stale one.
		var tof = (lp.legDays || 0) * DAY;
		if (isFinite(tof) && tof > 0 && trajTotalT > 0) {
			placeMarkerAtGlobalTime(Math.min(tof, trajTotalT));
		}
		return { ok: true };
	}

	// A Moon-origin plan whose departure is NOT the crossing its recorded
	// release flies to — a mission's technology delivered it (a skyhook's real
	// geometry, the departure leg's own burns), or Update committed a new one.
	// This tab models the departure only as a nominal release, so it solves the
	// card whose crossing VELOCITY is the plan's. That release crosses Earth's
	// SOI at its own point and time, not the plan's, and the drawn flight
	// differs from the mission's by that much. Null when the recorded release
	// already flies to the plan's departure (it then reopens exactly as it was
	// authored) or when no card reaches it.
	function lunarCardFor(releaseJd, card, departure) {
		var f0 = flyLunarDeparture({ jd: releaseJd, card: card });
		if (f0.ok && f0.soiExit) {
			var jd0 = releaseJd + f0.soiExit.dt / DAY;
			var e0 = Frames.bodyHelioState("Earth", jd0);
			if (O.vMag(O.vSub(O.vAdd(e0.r, f0.soiExit.r), departure.r)) < 1e3 &&
				O.vMag(O.vSub(O.vAdd(e0.v, f0.soiExit.v), departure.v)) < 1e-2 &&
				Math.abs(jd0 - departure.jd) * DAY < 1) { return null; }
		}
		var earth = Frames.bodyHelioState("Earth", departure.jd);
		var sol = solveLunarCard({ jd: releaseJd, vInfVec: O.vSub(departure.v, earth.v),
			seedCard: card, at: "exit" });
		if (!sol.ok) { return null; }
		return { pro: sol.card.pro, rad: sol.card.rad, nrm: sol.card.nrm };
	}

	// A pasted link, unpacked (ui/share-link.js), turned into whatever it
	// describes. This scratchpad is where a plan is authored and revised, so it
	// always receives the plan; what else happens depends on the link:
	//
	//   - a link from a mission tab's Copy Mission carries a `sketch` — the
	//     plan as that tab's report "now" row states it — and loads exactly
	//     that. If the source tab is still open in THIS window, that is all:
	//     the mission already exists here, so no tab is spawned.
	//   - otherwise a link carrying a LATER commit also opens it as its own
	//     mission tab, because a committed plan with a technology stack behind
	//     it is a mission, not a sketch.
	//   - a link without a sketch (older links) loads the plan as originally
	//     adopted, or the bare World when it has no plan sets.
	function loadPastedMission(unp) {
		// A link copied from a mission tab carries a `sketch`: the plan as that
		// tab's report "now" row states it. It wins over the original.
		if (unp.sketch) {
			var lp0 = unp.sketch.plan;
			if (!lp0.origin || !lp0.departure || !lp0.arrival) {
				return { ok: false, reason: "That mission's flight plan is incomplete." };
			}
			var fromSketch = loadPlanParamsIntoState(lp0, unp.sketch.leg);
			if (!fromSketch.ok) { return fromSketch; }
			// The mission is already open here as a tab, so the paste only moves
			// its values into this scratchpad; a mission from elsewhere still
			// arrives as a tab of its own below.
			if (unp.source && unp.source.window === WINDOW_ID && opts.hasMissionTab &&
				opts.hasMissionTab(unp.source.mission)) {
				return { ok: true };
			}
			return openLatestOf(unp);
		}

		var sets = readSets(unp.plan);
		var sketchWorld = sets ? sets.original : unp.world;

		var res = deserializeWorld(sketchWorld);
		if (!res.ok) { return { ok: false, reason: "Couldn't load the mission: " + res.reason + "." }; }
		var loaded = loadadoptedPlanIntoState(res.world);
		if (!loaded.ok) { return loaded; }
		return openLatestOf(unp);
	}

	// The later plan of a link, if it carries one, as a mission tab of its own.
	function openLatestOf(unp) {
		var latest = latestOf(readSets(unp.plan));
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
			setCardEmpty(true);
			frame.place(dateState.jd);
			if (pov) { setPovChevron(pov, null); pov.frame.place(dateState.jd); }
			return;
		}
		if (!state.marker.mode) { state.marker.mode = "free"; }
		if (!markerSprite) { markerSprite = makeShipSprite(); frame.scene.add(markerSprite); }
		if (state.marker.mode === "target" && !state.marker._scrubbed) {
			if (!state.marker._released && state.marker._encT != null && trajTotalT > 0) {
				state.marker.f0 = Math.max(0, Math.min(1, state.marker._encT / trajTotalT));
				state.marker.angle = 0;                          // sit at the solved encounter
			} else { followCrossing(); }                         // released -> falls back to geometric tracking
		}
		// Once dragged (_scrubbed), the chevron/slider are free to inspect the
		// whole path — the held arrival date and Lambert solve (applyTargeting)
		// never read the marker's f0/angle, so the target itself stays locked.

		var f = mcMarkerFraction(state.marker.f0, state.marker.angle);
		// The flight starts at the hand-off, so nothing precedes it — except, in
		// the origin view, the release arc that leads up to it.
		var minF = trajTotalT > 0 ? markerFloorT() / trajTotalT : 0;
		if (f < minF) { state.marker.f0 = minF; state.marker.angle = 0; f = minF; }
		var tof = f * trajTotalT;
		// A POV shows only its window, so the marker stays inside it.
		if (state.pov && povWin && (tof < povWin.t0 || tof > povWin.t1)) {
			tof = Math.max(povWin.t0, Math.min(povWin.t1, tof));
			state.marker.f0 = tof / trajTotalT; state.marker.angle = 0;
		}
		var s = stateAtGlobalTime(tof);
		if (!s) {
			markerSprite.visible = false;
			if (destSprite) { destSprite.visible = false; }
			if (destSoi) { destSoi.visible = false; }
			setCardEmpty(true);
			setHint("No drawn trajectory to probe — fix the leg, then click it to place a marker.");
			frame.place(dateState.jd);
			if (pov) { setPovChevron(pov, null); pov.frame.place(dateState.jd); }
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

		updateDestinationMarker(tof);

		mk.slider.disabled = false;   // free to scrub for inspection in every mode (see _scrubbed above)
		var sw = markerSoiWeight();
		mk.slider.max = trajTotalT > 0 ? degAtTime(trajTotalT, sw) : 360;
		if (document.activeElement !== mk.slider) { mk.slider.value = degAtTime(tof, sw); }

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
		if (state.pov && pov && povWin) { updatePovMarker(tof); }
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

	// The marker card's Reset: the whole authored setup goes — marker, waypoints,
	// departure speeds, destination. The origin and the date bar stay.
	function resetSetup() {
		confirmDialog({
			title: "Are you sure you want to clear this setup?",
			okLabel: "Confirm"
		}).then(function (yes) {
			if (!yes) { return; }
			state.marker = null;
			state.markerFocused = false;
			state.destFocused = false;
			legStart = null;
			// Mutate the burn in place: the vector editor closes over this object.
			state.leg.burn.pro = 0; state.leg.burn.rad = 0; state.leg.burn.nrm = 0;
			state.leg.waypoints = [];
			state.leg.destination = "";
			destSel.value = "";
			setHint(HINT_DEFAULT);
			rebuildWaypointRows();
			refresh();
		});
	}

	// Place (or move) the marker at a global time along the path; that point
	// becomes 0° on the slider and the camera focus. Called from handlePick
	// below whenever a click resolves to a nearest trajectory sample, and by
	// loadadoptedPlanIntoState to restore a pasted mission's rendezvous.
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

	// =======================================================================
	//  POV: the flight seen from one end, in that body's own frame.
	//  The POV buttons in the date bar (Origin / Destination / Solar system),
	//  or a double-click on the origin body or the destination "×", switch the
	//  pane to ephemeris-pov.js's scene for that body. The physics is the same
	//  drawn leg — computeLeg's segments, integrated through any SOI they enter —
	//  re-expressed relative to the body; nothing is recomputed differently.
	//
	//  What changes is what the pane and the marker card cover:
	//   - only the POV window (core/ephemeris-pov-window.js) is drawn, and the card's
	//     slider spans that window in DAYS rather than the whole flight in
	//     swept degrees;
	//   - the card's position rows read against the body — distance, speed,
	//     latitude over its equator — and, at a destination, time to closest
	//     approach;
	//   - the scene is placed at the MARKER's epoch rather than the date bar's,
	//     since the body's surroundings (the Sun direction, the Moon) are what
	//     they are when the ship is there. The heliocentric view's "×" is the
	//     same thing — the destination at the marker's time — which the planet
	//     itself now stands in for.
	//  A click focuses the chevron or a body; it never moves the marker.
	// =======================================================================
	var povScenes = createPovScenes();
	var pov = null;         // the active POV scene (ephemeris-pov.js), null in the helio view
	var povWin = null;      // { t0, t1 } global s — the window the POV shows
	var POV_BODY_PX = 60;   // how wide the body appears on entering a POV

	function viewFrame() { return pov ? pov.frame : frame; }

	// The body a POV is FOR: its camera focus and the name on its buttons. For
	// a Moon origin that is the Moon, drawn in the Earth-centred scene.
	function povBody(kind) { return kind === "origin" ? state.origin : state.leg.destination; }

	// A view can be opened whenever it has a body to look at: the origin always
	// does, the destination once one is chosen. Whether a flight is drawn in it
	// is a separate matter (povHasFlight) — with none, the view shows the body
	// and its surroundings at the date bar's epoch.
	function povAvailable(kind) {
		return kind === "origin" || !!state.leg.destination;
	}

	function povHasFlight(kind) {
		if (!trajLeg || !(trajTotalT > 0)) { return false; }
		return kind === "origin" || !!(state.leg.destination && destApproach);
	}

	// The ship relative to the POV scene's centre body at global time t:
	// { r, v, jd } in m, m/s.
	function povRelState(t) {
		var s = stateAtGlobalTime(t);
		if (!s) { return null; }
		var jd = legStartJd() + t / DAY;
		var loc = Frames.helioToLocal(pov.centre, jd, s.r, s.v);
		return { r: loc.r, v: loc.v, vHelio: s.v, jd: jd };
	}

	function computePovWindow(kind) {
		if (kind === "origin") { return originWindow(trajTotalT, leadBeforeExit()); }
		var dn = state.leg.destination;
		var soiR = soiRadiusAU(systems.get(dn), SUN.mass, 1);   // m
		return destinationWindow(function (t) {
			var s = stateAtGlobalTime(t);
			if (!s) { return Infinity; }
			return O.vMag(O.vSub(s.r, Frames.bodyHelioState(dn, legStartJd() + t / DAY).r));
		}, destApproach.t, soiR, trajTotalT);
	}

	// Body-relative points over [t0, t1], stepped by distance over speed so a
	// close pass is as smooth as the slow approach to it: ~100 steps per
	// e-fold of distance, never coarser than 1/300 of the window.
	function samplePovPath(t0, t1) {
		var pts = [], t = t0, maxStep = (t1 - t0) / 300;
		for (var guard = 0; guard < 20000; guard++) {
			var st = povRelState(t);
			if (st) { pts.push(st.r); }
			if (t >= t1) { break; }
			var dt = maxStep;
			var sp = st ? O.vMag(st.v) : 0;
			if (sp > 0) { dt = Math.min(maxStep, Math.max(10, 0.01 * O.vMag(st.r) / sp)); }
			t = Math.min(t1, t + dt);
		}
		return pts;
	}

	// The destination's arrival mark (modules/arrival-approach.js): where the
	// pass first crosses the equatorial catch disc, else closest approach.
	function povArrivalMark() {
		if (!destApproach) { return null; }
		var path = {
			jd0: legStartJd() + povWin.t0 / DAY,
			jd1: legStartJd() + povWin.t1 / DAY,
			stateAt: function (jd) { return povRelState((jd - legStartJd()) * DAY); }
		};
		return arrivalMark(pov.centre, path, destApproach.jd);
	}

	// Swap the pane to the scene for the current POV's body, if it isn't
	// already showing it. Returns true when the scene changed.
	function attachPovScene() {
		var next = povScenes.get(povBody(state.pov));
		var changed = next !== pov;
		if (changed) {
			viewFrame().labelLayer.remove();
			pov = next;
			paneMainEl.appendChild(pov.frame.labelLayer);
		}
		paneCapEl.textContent = pov.frame.caption + " · " + povBody(state.pov) + " POV";
		return changed;
	}

	// Redraw the active POV from the current leg: its window, its path and
	// markings. `refit` re-aims the camera at the body, close enough that it
	// is POV_BODY_PX across.
	// Drops back to the helio view only if the POV has no body left to look at
	// (its destination was cleared). With no flight it draws the body alone.
	function drawPov(refit) {
		if (!state.pov) { return; }
		if (!povAvailable(state.pov)) { setPov(null); return; }
		if (attachPovScene()) { refit = true; }
		var isDest = state.pov === "dest";
		povWin = povHasFlight(state.pov) ? computePovWindow(state.pov) : null;
		if (!povWin) {
			drawPovScene(pov, { path: null, start: null, mark: null, catchDisc: isDest });
			pov.frame.place(dateState.jd);
			setPovChevron(pov, null);
			if (refit) { refitPov(); }
			return;
		}
		// A Moon origin's first stretch is the hyperbola about the Moon, sampled
		// on its own (it is far tighter than anything the stepping below would
		// resolve at Earth's scale); the stepped path takes over where it ends.
		var moonLeg = (!isDest && lunarLegNow) ? lunarMoonLegSamples(lunarLegNow, 200) : [];
		applyDatePin();
		var path = moonLeg.map(function (s) { return s.r; })
			.concat(samplePovPath(moonLeg.length ? -lunarLegNow.coast + lunarLegNow.tMoon : povWin.t0, povWin.t1));
		// The hand-off dot is the SOI exit (time 0); at an origin with a release
		// arc, the release point is marked as well.
		var exitState = isDest ? null : povRelState(0);
		var start = exitState ? exitState.r : null;
		var releaseR = releaseArcNow ? releaseArcNow.release.r : lunarLegNow ? lunarLegNow.release.r : null;
		drawPovScene(pov, {
			path: path, start: start,
			mark: isDest ? povArrivalMark()
				: (releaseR ? { kind: "release", r: releaseR } : null),
			catchDisc: isDest
		});
		if (refit) { refitPov(); }
	}

	function refitPov() {
		var f = pov.frame;
		// A sphere of radius R at distance d spans R·h / (d·tan(fov/2))
		// pixels on a pane h pixels tall; solved for d.
		var R = systems.get(povBody(state.pov)).radius / 1e6;   // scene units
		var h = paneMainEl.clientHeight || 600;
		var d = R * h / (POV_BODY_PX * Math.tan(f.camera.fov * Math.PI / 360));
		f.cam.radius = Math.max(f.zoomMin, Math.min(f.zoomMax, d));
		state.povFocus = "body";
		f.focusBody = povBody(state.pov);
		var node = f.bodyNode(f.focusBody);
		if (node) { f.cam.target.copy(node.position); }
	}

	// Enter a POV ("origin" | "dest") or return to the helio view (null).
	// Entering puts the marker inside the window — at closest approach for a
	// destination, at the hand-off for an origin — unless it is already there,
	// placing one if there is none.
	function setPov(kind) {
		if (kind && !povAvailable(kind)) { updatePovButtons(); return; }
		datePin = null;
		if (!kind) {
			if (pov) {
				pov.frame.labelLayer.remove();
				paneMainEl.appendChild(frame.labelLayer);
			}
			state.pov = null; pov = null; povWin = null;
			paneCapEl.textContent = frame.caption;
		} else {
			state.pov = kind;
			drawPov(true);
			if (state.pov && povWin) { putMarkerInPovWindow(); }
		}
		updateCardForPov();
		updateMarker();
		updatePovButtons();
	}

	function putMarkerInPovWindow() {
		var want = state.pov === "dest" ? destApproach.t : 0;   // an origin view opens at the SOI exit
		if (!state.marker) {
			state.marker = { f0: want / trajTotalT, angle: 0, mode: "free", dvBudget: 10000, holdMode: "deg" };
			return;
		}
		var now = mcMarkerFraction(state.marker.f0, state.marker.angle) * trajTotalT;
		if (now < povWin.t0 || now > povWin.t1) {
			state.marker.f0 = want / trajTotalT;
			state.marker.angle = 0;
			// A Target lock holds its solved encounter regardless; moving the
			// marker to look at the approach is a scrub, as on the slider.
			if (state.marker.mode === "target") { state.marker._scrubbed = true; }
		}
	}

	// The marker card's words for the frame it is read in. The helio labels
	// are the ones buildCard gave the rows; a POV re-words the position rows
	// and hides the hold radios, which choose what a DATE scrub holds and are
	// not about the window.
	var baseLabels = null, baseSliderTitle = null;
	var POV_SLIDER_TITLE = "drag to slide the marker through this view's stretch of the flight, " +
		"left to right in time.";
	function updateCardForPov() {
		if (!mk) { return; }
		if (!baseLabels) {
			baseLabels = {};
			Object.keys(mk.labels).forEach(function (k) { baseLabels[k] = mk.labels[k].textContent; });
			baseSliderTitle = mk.slider.title;
		}
		Object.keys(baseLabels).forEach(function (k) { mk.labels[k].textContent = baseLabels[k]; });
		mk.vals.deg.parentNode.style.display = "";
		Object.keys(mk.holdRadios).forEach(function (k) { mk.holdRadios[k].style.display = state.pov ? "none" : ""; });
		mk.slider.title = state.pov ? POV_SLIDER_TITLE : baseSliderTitle;
		mk.slider.step = state.pov ? "any" : 0.1;
		mk.slider.min = 0;
		if (!state.pov) { return; }
		var c = pov.centre;
		mk.labels.rad.textContent = "distance from " + c;
		mk.labels.spd.textContent = "speed relative to " + c;
		mk.labels.lat.textContent = "latitude over " + c + "'s equator";
		if (state.pov === "dest") { mk.labels.deg.textContent = "to closest approach"; }
		else {
			mk.vals.deg.parentNode.style.display = "none";
			mk.labels.tof.textContent = "time from SOI exit";
		}
	}

	// "2 d 03 h 12 m" — the POV card's time format, fine enough for a pass
	// that is over in hours.
	function fmtDhm(sec) {
		var s = Math.abs(sec);
		var d = Math.floor(s / DAY), h = Math.floor((s % DAY) / 3600), m = Math.floor((s % 3600) / 60);
		return (d ? d + " d " : "") + String(h).padStart(2, "0") + " h " + String(m).padStart(2, "0") + " m";
	}

	// The POV half of updateMarker: the scene at the marker's epoch, the
	// chevron, the body-relative rows, and the window slider.
	function updatePovMarker(tof) {
		var st = povRelState(tof);
		pov.frame.place(st ? st.jd : legStartJd() + tof / DAY);
		// The nose points along the heliocentric trajectory.
		setPovChevron(pov, st ? st.r : null, st ? st.vHelio : null);
		if (!st) { return; }
		var c = pov.centre, R = systems.get(c).radius;
		var d = O.vMag(st.r);
		mk.vals.rad.textContent = fmtKm(d);
		mk.vals.radKm.textContent = d >= R ? "altitude " + fmtKm(d - R) : "below the surface";
		mk.vals.spd.textContent = (O.vMag(st.v) / 1000).toFixed(2) + " km/s";
		var n = equatorNormal(c);
		var lat = Math.asin(Math.max(-1, Math.min(1, O.vDot(st.r, n) / (d || 1)))) * 180 / Math.PI;
		mk.vals.lat.textContent = (lat >= 0 ? "+" : "−") + Math.abs(lat).toFixed(1) + "°";
		if (state.pov === "dest" && destApproach) {
			var dt = tof - destApproach.t;
			mk.vals.deg.textContent = Math.abs(dt) < 60 ? "at closest approach"
				: (dt < 0 ? "−" : "+") + fmtDhm(dt);
		}
		mk.vals.tof.textContent = (tof < 0 ? "−" : "") + fmtDhm(tof);
		mk.slider.max = (povWin.t1 - povWin.t0) / DAY;
		if (document.activeElement !== mk.slider) { mk.slider.value = (tof - povWin.t0) / DAY; }
		if (state.povFocus === "chevron") { pov.frame.cam.target.copy(pov.chevron.position); }
	}

	// ---- the POV buttons, in the date bar ----------------------------------
	var povBtns = {
		origin: q(".mp-pov-btn[data-pov='origin']"),
		dest: q(".mp-pov-btn[data-pov='dest']"),
		sun: q(".mp-pov-btn[data-pov='sun']")
	};
	povBtns.origin.addEventListener("click", function () { setPov("origin"); });
	povBtns.dest.addEventListener("click", function () { setPov("dest"); });
	povBtns.sun.addEventListener("click", function () { setPov(null); });
	function updatePovButtons() {
		var o = povAvailable("origin"), d = povAvailable("dest");
		povBtns.origin.disabled = !o;
		povBtns.dest.disabled = !d;
		povBtns.origin.title = povHasFlight("origin") ? "View the start of the flight from " + state.origin + "."
			: "View " + state.origin + " (no flight drawn yet).";
		povBtns.dest.title = povHasFlight("dest") ? "View the approach from " + state.leg.destination + "."
			: (state.leg.destination ? "View " + state.leg.destination + " (no flight drawn yet)."
			: "Choose a destination first.");
		povBtns.sun.title = "Back to the whole solar system.";
		povBtns.origin.classList.toggle("active", state.pov === "origin");
		povBtns.dest.classList.toggle("active", state.pov === "dest");
		povBtns.sun.classList.toggle("active", !state.pov);
	}

	// The marker slider's thumb as a fraction (0..1) of its track in the view it
	// is read in: swept degrees along the whole flight, or in a POV the days
	// through that view's window. null with no marker or no flight.
	function captureDatePin() {
		if (!state.marker || !(trajTotalT > 0)) { return null; }
		var tof = mcMarkerFraction(state.marker.f0, state.marker.angle) * trajTotalT;
		if (state.pov) {
			if (!povWin || !(povWin.t1 > povWin.t0)) { return null; }
			return { pov: state.pov, frac: (tof - povWin.t0) / (povWin.t1 - povWin.t0) };
		}
		var sw = markerSoiWeight(), span = degAtTime(trajTotalT, sw);
		return span > 0 ? { pov: null, frac: degAtTime(tof, sw) / span } : null;
	}

	// Put the marker where the pin says, on the flight as it now is. Run once
	// the leg (and, in a POV, its window) is in place.
	function applyDatePin() {
		if (!datePin || !state.marker || !(trajTotalT > 0) || datePin.pov !== state.pov) { return; }
		var frac = Math.max(0, Math.min(1, datePin.frac)), tof;
		if (state.pov) {
			if (!povWin) { return; }
			tof = povWin.t0 + frac * (povWin.t1 - povWin.t0);
		} else {
			var sw = markerSoiWeight();
			tof = timeAtDeg(frac * degAtTime(trajTotalT, sw), sw);
		}
		state.marker.f0 = Math.max(markerFloorT() / trajTotalT, Math.min(1, tof / trajTotalT));
		state.marker.angle = 0;
	}

	// ==== recompute + draw: the one function every input change calls --------
	function refresh() {
		if (!inDateChange) { datePin = null; }
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
		// clamp a "tof" hold past the end already needs. These holds govern
		// edits to the departure or waypoints; a refresh driven by the date bar
		// is overridden by datePin (above), which keeps the thumb where it was.
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
		// No flight to draw: a lunar card this planner cannot fly, or a card
		// that does not escape the origin's SOI at all.
		var noFlight = noDeparture(hand);
		releaseArcNow = noFlight ? null : hand.release;
		lunarLegNow = noFlight ? null : hand.lunarLeg;

		// The origin body itself, where and when the ship leaves it. For a Moon
		// origin that is the MOON at the release epoch — `dep` there is Earth,
		// the frame the card is measured against, not the body being departed.
		var originAt = state.origin === "Moon"
			? Frames.bodyHelioState("Moon", dateState.jd) : dep;
		originInfo.textContent = "Now " + (O.vMag(originAt.r) / AU).toFixed(3) +
			" AU from the Sun, moving " + fmtKmS(O.vMag(originAt.v)) + " km/s";
		if (state.leg.destination) {
			var dnow = O.bodyStateAtJD(GM_SUN, systems.get(state.leg.destination).orbit, dateState.jd);
			destInfo.textContent = "Now " + (O.vMag(dnow.r) / AU).toFixed(3) +
				" AU from the Sun, moving " + fmtKmS(O.vMag(dnow.v)) + " km/s";
		} else {
			destInfo.textContent = "No destination selected.";
		}

		var vDep = hand.v;
		var elDep = O.elementsFromState(GM_SUN, hand.r, vDep);
		var depKind = elDep.e < 1 ? ("ellipse, a = " + (elDep.a / AU).toFixed(2) + " AU")
		                          : ("hyperbola, e = " + elDep.e.toFixed(2));
		// Both figures at Earth's SOI edge, which is what the card states and
		// what a hand-off means: the speed the ship leaves the boundary with,
		// and the excess left of it once the primary's well is fully paid.
		depReadout.textContent = "Leaves the SOI at " + fmtKmS(hand.vInf) + " km/s, "
			+ fmtKmS(O.vMag(O.vSub(vDep, dep.v))) + " km/s of that asymptotic. "
			+ "Resulting arc: " + depKind + ".";
		// For a Moon origin the card is the SHIP's share and the Moon's motion
		// is a bonus on top of it — reach the ship did not have to pay for, and
		// on the wrong phase a penalty instead. Both stated at the boundary.
		if (state.origin === "Moon") {
			var lun = hand.lunar;
			if (lun.ok) {
				var shipEdge = O.vMag(lun.cardVec), gain = hand.vInf - shipEdge;
				// The card's direction IS the heading flown (core/ephemeris-lunar-departure.js,
				// "how the card is read"), so the readout says so — and where the
				// ship falls toward Earth first, how close it swings.
				var route = lun.perigee !== null
					? "Swings past Earth at " + Math.round(lun.perigee / 1e3).toLocaleString()
					  + " km and leaves along the card's heading. "
					: "Leaves along the card's heading. ";
				depReadout.textContent = route
					+ "The release supplies " + fmtKmS(shipEdge) + " km/s at Earth's SOI; the Moon's motion "
					+ (gain >= 0 ? "adds " : "costs ") + fmtKmS(Math.abs(gain))
					+ " km/s, leaving " + fmtKmS(hand.vInf) + " km/s there. "
					+ "Resulting arc: " + depKind + ".";
				if (hand.lunarLeg) {
					depReadout.textContent += " Released from a low lunar orbit "
						+ fmtKm(hand.lunarLeg.moonArc ? hand.lunarLeg.moonArc.rLow - systems.get("Moon").radius.equator : 0)
						+ " up, " + fmtDhm(hand.lunarLeg.coast) + " before the SOI exit.";
				}
			} else {
				depReadout.textContent = LUNAR_FAILURES[lun.reason]
					|| "This departure from the Moon cannot be drawn.";
			}
		} else if (!hand.escapes) {
			var escSpeed = edgeVInf(0, state.origin);
			depReadout.textContent = hand.vInf < MIN_VINF
				? "No departure yet — give the ship a speed to leave " + Frames.escapeReferenceFor(state.origin)
				  + "'s SOI with."
				: "This card does not escape " + Frames.escapeReferenceFor(state.origin) + ": at the SOI edge "
				  + "it still needs " + Math.round(escSpeed) + " m/s to get away, and has "
				  + Math.round(hand.vInf) + ".";
		} else if (hand.release) {
			var relAlt = hand.release.rLow - systems.get(state.origin).radius.equator;
			depReadout.textContent += " Released from a low orbit " + fmtKm(relAlt) + " up, "
				+ fmtDhm(hand.release.tExit) + " before the SOI exit.";
		}

		// The waypoint chain (apsis/node availability, snap resolution)
		// propagates from the hand-off itself — the same state the trajectory
		// draws from — so a waypoint's "snap to apoapsis" option, say, matches
		// what's actually on screen.
		// The rows themselves are synced further down, once the leg exists: their
		// day sliders read the same swept-degree domain the drawn leg defines.
		var rw = resolveWaypoints(hand.r, hand.v, state.leg);

		// legDays carries no mission condition — it's just long enough to draw
		// the leg's own natural end: one full period past the last waypoint
		// (or the departure burn) if bound, a long escape coast if not.
		var legDays = rw.tPrev + finalCoastDays(rw.finalR, rw.finalV);
		state.leg.legDays = legDays;   // last-computed length, e.g. as a new waypoint's default-day bound

		var params = Object.assign({}, state.leg, { waypoints: rw.entries, legDays: legDays });
		var leg = computeLeg(params, { r: hand.r, v: hand.v, jd: hand.jd });

		clearDrawn();

		// Departure arrows + readout box, from the hand-off state the leg is
		// propagated from — the same pair at every origin, including the Moon.
		// They are shown even when the rest of the leg is invalid, since the
		// hand-off itself is always resolvable.
		// "v∞ speed / heading", not "Δv / impulse": the departure's magnitude is the
		// ship's speed relative to the body it is leaving, which no single burn
		// delivered — a skyhook release and the Moon's own motion are both in
		// it at a Moon origin. Waypoint boxes below keep the impulse labels,
		// which are true of them.
		var entries = [{ host: depBurnHost, data: departureReadout(hand),
		                 title: "v∞ speed", magLabel: "heading" }];
		addDepartureArrows(hand);

		// A lunar departure core/ephemeris-lunar-departure.js does not model has no
		// flight, so there is no path to draw: `hand` there is the Moon's own
		// state with no v∞, and propagating it would draw a plausible-looking
		// arc that is just the Moon coasting on around the Sun. The readout
		// above says why instead.
		if (!leg.ok || noFlight) {
			trajLeg = null; trajSegs = []; trajTotalT = 0; trajSampleCount = 0; trajSamples = [];   // marker + rings hide until it recovers
			clearApproachMarks();
		} else {
			// Marker support: the leg's own segment chain (Kepler stretches and
			// integrated SOI encounters), so the marker sits on the drawn line at
			// any global time. An impact ends the flight early.
			trajLeg = leg;
			trajSegs = leg.segs;
			trajTotalT = (leg.end.jd - leg.jd0) * DAY;
			flyWaypointStates(rw.entries, leg);

			// Re-anchor the marker to the SAME absolute time-of-flight it had
			// before this recompute (see the note at the top of refresh()),
			// rather than leaving it at the same fraction of a total that may
			// have just moved. This is the "tof" hold mode outright, and the
			// "deg" hold mode's fallback for when there was no prior swept
			// angle to match. Target mode overrides f0 from its own absolute
			// _encT right after this (updateMarker), so this only has lasting
			// effect on Free/released-Target marker positions.
			if (state.marker && markerAbsTof != null) {
				state.marker.f0 = Math.max(markerFloorT() / trajTotalT, Math.min(1, markerAbsTof / trajTotalT));
				state.marker.angle = 0;
			}
			trajSampleCount = leg.samples.length;
			trajSamples = leg.samples;


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
			applyDatePin();

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
		}

		rw.entries.forEach(function (e) { updateWaypointRowUI(wpRows[e.originalIndex], e, e.originalIndex); });

		// The trajectory's own closest approach to the destination — a
		// property of the drawn path and the destination alone, so it's
		// recomputed here (once per trajectory/destination change) rather
		// than on every marker scrub. null when leg.ok is false: trajSamples
		// was just cleared above.
		destApproach = computeDestinationApproach();
		updateApproachReadouts();
		updateApproachGate();

		readoutBoxes = renderReadoutBoxes(readoutLayer, readoutBoxes, entries,
			{ classPrefix: "mp", dvHex: dvHex, spdHex: spdHex, compact: true });
		positionReadoutBoxes(readoutBoxes, mainEl, panelEl, 15);

		// The POV's window and path come from this same leg, and the marker
		// update below clamps into that window, so it is redrawn first.
		drawPov(false);

		// keep the marker on the (possibly reshaped) path + refresh its card
		updateMarker();
		updatePovButtons();

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
			// the clock's own date — and the days bar is the coast out to
			// Earth's SOI, solved from the departure's own hyperbola rather
			// than assumed. `dep` is Earth at that same epoch, so the speed bar
			// is read against the very axis the card's prograde component is
			// stated on, and stays continuous whether or not the departure is
			// supported (see lunarDepartureState).
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
		if (state.pov) { handlePovPick(e); return; }
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

	// Within a POV a click focuses: the chevron, or a body (never the Sun,
	// which sits AUs off across the scene). Empty space releases the focus.
	// The marker is moved only by its slider here.
	function handlePovPick(e) {
		var f = pov.frame;
		var rect = paneMainEl.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		if (pov.chevron.visible) {
			var cv = pov.chevron.position.clone().project(f.camera);
			if (cv.z <= 1) {
				var cx = (cv.x * 0.5 + 0.5) * rect.width, cy = (-cv.y * 0.5 + 0.5) * rect.height;
				if (Math.hypot(cx - px, cy - py) < 16) {
					state.povFocus = "chevron";
					f.focusBody = null;
					f.cam.target.copy(pov.chevron.position);
					return;
				}
			}
		}
		var name = pickBodyName(f.camera, paneMainEl, e, f.scaleList, PICK_PX);
		if (name && name !== "Sun") {
			state.povFocus = "body";
			f.focusBody = name;
			var node = f.bodyNode(name);
			if (node) { f.cam.target.copy(node.position); }
			return;
		}
		state.povFocus = null;
		f.focusBody = null;
	}

	// Double-click in the helio view: the destination "×" or the destination
	// body opens its POV, the origin body its own. At solar-system zoom the
	// Moon is drawn on top of Earth, so from a Moon origin Earth's dot stands
	// for it (Earth is never a Moon origin's destination).
	function handleDoubleClick(e) {
		if (state.pov) { return; }
		var rect = paneMainEl.getBoundingClientRect();
		var px = e.clientX - rect.left, py = e.clientY - rect.top;
		if (destSprite && destSprite.visible) {
			var xv = destSprite.position.clone().project(frame.camera);
			if (xv.z <= 1) {
				var xx = (xv.x * 0.5 + 0.5) * rect.width, xy = (-xv.y * 0.5 + 0.5) * rect.height;
				if (Math.hypot(xx - px, xy - py) < 16) { setPov("dest"); return; }
			}
		}
		var name = pickBodyName(frame.camera, paneMainEl, e, frame.scaleList, PICK_PX);
		if (!name) { return; }
		if (name === state.leg.destination) { setPov("dest"); }
		else if (name === state.origin || (state.origin === "Moon" && name === "Earth")) { setPov("origin"); }
	}

	// ---- camera controls: bound once for the page's life (like the standalone
	// plotters, the unbind return value is ignored — Shared/sim/camera-controller.js).
	// The config is read fresh on every event, so it follows whichever scene is
	// showing: the helio frame, or the active POV's.
	bindCameraControls(paneMainEl, function () {
		var f = viewFrame();
		return {
			cam: f.cam, camera: f.camera,
			zoomMin: f.zoomMin, zoomMax: f.zoomMax,
			pickPoint: function (e) {
				return raycastPickPoint(f.camera, paneMainEl, e,
					{ meshes: f.pickMeshes, soiSpheres: f.pickSoiSpheres });
			},
			onPan: function () {
				f.focusBody = null;
				if (state.pov) { state.povFocus = null; return; }
				state.markerFocused = false; state.destFocused = false;
			},
			lockedZoomTarget: function () {
				if (state.pov) {
					if (state.povFocus === "chevron" && pov.chevron.visible) { return pov.chevron.position; }
				} else {
					if (state.markerFocused && markerSprite && markerSprite.visible) { return markerSprite.position; }
					if (state.destFocused && destSprite && destSprite.visible) { return destSprite.position; }
				}
				if (f.focusBody) {
					var node = f.bodyNode(f.focusBody);
					if (node) { return node.position; }
				}
				return null;
			},
			onPick: handlePick,
			onDoubleClick: handleDoubleClick
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

		if (state.pov && pov) {
			var pf = pov.frame;
			pf.camera.aspect = w / h;
			pf.camera.updateProjectionMatrix();
			updateCamera(pf.camera, pf.cam);
			brUpdateScales(pf.camera, paneMainEl, pf.scaleList, { wantSOI: pf.wantSOI });
			brUpdateLabels(pf.camera, paneMainEl, pf.labelList);
			scalePovOverlays(pov, paneMainEl);
			positionReadoutBoxes(readoutBoxes, mainEl, panelEl, 15);
			renderer.setViewport(x, y, w, h);
			renderer.setScissor(x, y, w, h);
			renderer.render(pf.scene, pf.camera);
			return;
		}

		frame.camera.aspect = w / h;
		frame.camera.updateProjectionMatrix();
		updateCamera(frame.camera, frame.cam);
		brUpdateScales(frame.camera, paneMainEl, frame.scaleList, { wantSOI: frame.wantSOI });
		brUpdateLabels(frame.camera, paneMainEl, frame.labelList);
		updateBodyMarkerRing(frame, paneMainEl, originRing, state.origin,
			ORIGIN_RING_COLOR, ORIGIN_MOON_RING_COLOR, BODY_RING_PX);
		// Once a marker exists, draw the ring on updateDestinationMarker's own
		// "×" instead of the body's live position — the × already states the
		// destination at the marker's time of flight, so the ring rides along
		// with it rather than pointing somewhere the body no longer is.
		updateBodyMarkerRing(frame, paneMainEl, destRing, state.leg.destination || null,
			DEST_RING_COLOR, ORIGIN_MOON_RING_COLOR, BODY_RING_PX,
			(state.marker && destSprite && destSprite.visible) ? destSprite.position : null);

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
		tempRings.forEach(function (sp) { scaleApproachMark(frame.camera, paneMainEl, sp); });
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
