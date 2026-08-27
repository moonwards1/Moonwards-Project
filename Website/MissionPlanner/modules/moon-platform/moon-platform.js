/* MissionPlanner/modules/moon-platform — the Moon as the departure stack's
 * top card, for missions that depart from Earth.
 *
 * The Moon itself is the first CARRIER: ~1 km/s of geocentric velocity plus
 * position that every lunar departure rides for free. This module makes that a
 * visible, READ-ONLY card at the top of the departure sidebar and emits the
 * carrier chain's base (Shared/kinematic-chain.js's `emptyChain("Moon")`) for
 * the carrier stages downstream to extend (the skyhook appends its rotor;
 * departure-leg integrates the result).
 * Non-Earth origins have no platform stage at all — their skyhook
 * self-originates; see core/freeze.js's scaffold.
 *
 * READ-ONLY by design: there is no release-date knob here. The release epoch
 * is the plan's frozen anchor (frozen-plan.js's releaseAnchorFor), baked at
 * mission creation from core/departure-estimate.js's flight-time estimate and
 * never re-derived, so this card always shows ONE unchanging state: exactly the
 * Moon the user planned around (and already dated by the Departure info strip
 * above it, mission-view.js's updateDepartureInfo — this card doesn't repeat
 * the date). Moon-position planning happens in the Ephemeris tab; to re-plan
 * around the Moon, copy the mission link there and start a new plan.
 *
 * The card itself is just the phase glyph (Shared/sim/moon-glyph.js, the same
 * one the Ephemeris tab shows) plus two lines of context: geocentric distance,
 * and the Moon's own "inclination of motion" — the angle its TOTAL
 * heliocentric velocity (Earth's own plus the Moon's geocentric velocity)
 * makes with the ecliptic plane right then, same measure the Departure info
 * strip reports for the origin body itself. Every other figure moves into the
 * straddling Δv readout every carrier/waypoint card wears (Shared/sim/
 * readout-panes.js): geocentric speed becomes "impulse", the component along
 * Earth's heliocentric prograde becomes "prograde", and "plane change" reuses
 * the inclination-of-motion figure above — the Moon's motion is already
 * tilted off the ecliptic before any carrier tech adds its own plane change.
 *
 * A missing anchor (no frozen plan and no release date anywhere in
 * the profile) is diagnosed HERE, at the top of the chain, so the one clear
 * message blocks the stack instead of each stage failing its own way.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; `init` builds the
 * card, `draw` only ever pushes the readout entry — the Moon itself is drawn
 * by the frame, so there is no trajectory geometry here.
 *
 * Imports from ../../../Shared/, ../../core/ and ../frozen-plan/ — this
 * folder breaks if moved without them coming along.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { baseState, emptyChain } from "../../../Shared/kinematic-chain.js";
import { buildMoonGlyph } from "../../../Shared/sim/moon-glyph.js";
import { moonElongationDeg, moonProgradeSpeed } from "../../core/departure-estimate.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { releaseAnchorFor } from "../frozen-plan/frozen-plan.js";

var O = OrbitalMath;

export var defaultParams = {};   // read-only: the Moon has no knobs

function isoOf(jd) {
	var d = O.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

// The Moon's contribution at the release anchor — the card's readouts. Pure;
// exported for Node tests.
export function moonFigures(anchorJd) {
	var s = baseState("Moon", anchorJd);                       // geocentric m, m/s
	var earthV = Frames.bodyHelioState("Earth", anchorJd).v;   // heliocentric m/s
	var helioV = O.vAdd(earthV, s.v);                          // the Moon's OWN heliocentric v
	return {
		anchorJd: anchorJd,
		dist: O.vMag(s.r),                                     // m
		speed: O.vMag(s.v),                                    // m/s
		prograde: moonProgradeSpeed(anchorJd, earthV),         // m/s, signed
		inclOfMotion: Math.asin(Math.max(-1, Math.min(1, helioV[2] / O.vMag(helioV)))) * 180 / Math.PI,
		r: s.r, v: s.v
	};
}

// Last computed figures per (World, stage), for the card. Same WeakMap pattern
// as every module here: N missions coexist and their Worlds reuse stage ids, so
// the cache is keyed by World first and a closed mission's entries go with it.
var lastByWorld = new WeakMap();
export function figuresFor(world, stageId) {
	var m = lastByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberFigures(world, stageId, fig) {
	if (!world || typeof world !== "object") { return; }
	var m = lastByWorld.get(world);
	if (!m) { m = new Map(); lastByWorld.set(world, m); }
	m.set(stageId, fig);
}

// The card's content host, for draw()'s readout box to straddle — same
// WeakMap-per-World pattern as every other module's wpHostsFor/legFor.
var hostByWorld = new WeakMap();
function readoutHostFor(world, stageId) {
	var m = hostByWorld.get(world);
	return (m && m.get(stageId)) || null;
}
function rememberReadoutHost(world, stageId, el) {
	if (!world || typeof world !== "object") { return; }
	var m = hostByWorld.get(world);
	if (!m) { m = new Map(); hostByWorld.set(world, m); }
	m.set(stageId, el);
}

export default {
	id: "moon-platform",
	title: "Moon",
	attachesTo: "Moon",
	accepts: [],
	emits: ["carrier-chain"],
	rendersIn: ["body:Earth-Moon"],

	update: function (ctx) {
		var anchorJd = releaseAnchorFor(ctx.world);
		if (anchorJd === null) {
			rememberFigures(ctx.world, ctx.stageId, null);
			return makeDiagnostic("no-release-anchor",
				"This mission has no release anchor — no frozen flight plan (or legacy " +
				"release date) fixes when the carrier chain releases.",
				{ fix: "Start missions from the Ephemeris tab (Start Mission Plan bakes the anchor)." });
		}

		rememberFigures(ctx.world, ctx.stageId, moonFigures(anchorJd));

		var packet = PacketTypes.make("carrier-chain",
			emptyChain("Moon"),
			{ tool: "mission-planner/moon-platform", label: "carrier chain base",
			  iso: isoOf(anchorJd) });
		return { packet: packet };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	// The read-only card: the phase glyph, then geocentric distance and
	// inclination of motion. Everything else lives in the draw()-anchored Δv
	// readout below.
	init: function (ctx) {
		var host = ctx.panelHost;
		host.classList.add("mp-host-inset", "mp-pane-host");
		rememberReadoutHost(ctx.world, ctx.stageId, host);

		var glyphWrap = document.createElement("div"); glyphWrap.className = "mp-moon-card-glyph";
		var glyph = buildMoonGlyph(glyphWrap);
		host.appendChild(glyphWrap);

		var out = document.createElement("div"); out.className = "mp-readouts";
		host.appendChild(out);
		function row(label) {
			var r = document.createElement("div"); r.className = "mp-row";
			var k = document.createElement("span"); k.className = "mp-k"; k.textContent = label;
			var v = document.createElement("span"); v.className = "mp-v";
			r.appendChild(k); r.appendChild(v); out.appendChild(r);
			return v;
		}
		var distVal = row("geocentric distance");
		var inclVal = row("inclination of motion");

		ctx.onResult(function () {
			var fig = figuresFor(ctx.world, ctx.stageId);
			if (!fig) { glyphWrap.style.display = "none"; distVal.textContent = ""; inclVal.textContent = ""; return; }
			glyphWrap.style.display = "";
			glyph.setPhase(moonElongationDeg(fig.anchorJd));
			distVal.textContent = Math.round(fig.dist / 1e3).toLocaleString() + " km";
			inclVal.textContent = (fig.inclOfMotion >= 0 ? "+" : "−") + Math.abs(fig.inclOfMotion).toFixed(1) + "°";
		});
	},

	// The straddling Δv readout (Shared/sim/readout-panes.js) — the same
	// compact impulse/prograde/plane-change box every carrier and waypoint
	// card wears, anchored on this card's whole content area since there's
	// only ever one for the Moon (no per-waypoint indexing needed).
	draw: function (view, snap) {
		view.readoutEntries = [];
		var fig = figuresFor(snap.world, snap.stageId);
		var host = readoutHostFor(snap.world, snap.stageId);
		if (!fig || !host || snap.result.status !== "ok") { return; }
		view.readoutEntries.push({ host: host, data: {
			burnDv: fig.speed / 1000,
			progradeDv: fig.prograde / 1000,
			planeChange: fig.inclOfMotion
		} });
	}
};
