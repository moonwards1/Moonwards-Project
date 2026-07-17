/* MissionPlanner/modules/moon-platform — the Moon as the departure stack's
 * top card (task I3, WP-I).
 *
 * The Moon itself is the first CARRIER: ~1 km/s of geocentric velocity plus
 * position that every lunar departure rides for free — until WP-I this was
 * invisible, buried inside the skyhook's vector sum. This module makes it a
 * visible, READ-ONLY card at the top of the departure sidebar and emits the
 * carrier chain's base ({ base: "Moon", rotors: [] } — the
 * Shared/kinematic-chain.js shape) for the carrier stages downstream to
 * extend.
 *
 * READ-ONLY by design (Kim, 2026-07-15): there is no release-date knob here.
 * The release epoch is the plan's frozen anchor (frozen-plan.js's
 * releaseAnchorFor — WP-I's timing model), baked at mission creation from
 * the Ephemeris tab's planning indicators (task D7) and never re-derived, so
 * this card always shows ONE unchanging state: exactly the Moon the user
 * planned around. Moon-position planning happens in the Ephemeris tab; to
 * re-plan around the Moon, copy the mission link there and start a new plan.
 *
 * The card's readouts are the Moon's own heading/impulse contribution at the
 * release anchor: geocentric distance and speed (the "impulse" every carrier
 * inherits), and the component of that velocity along EARTH'S heliocentric
 * prograde (D7's educational framing — the same prograde axis the waypoint
 * gizmo uses, so the sign visibly adds to or subtracts from a departure).
 *
 * A missing anchor (no frozen plan and no legacy release date anywhere in
 * the profile) is diagnosed HERE, at the top of the chain, so the one clear
 * message blocks the stack instead of each stage failing its own way.
 *
 * update() is pure (no DOM, no THREE) and Node-testable; `init` (the
 * read-only card) is the only view hook — the Moon itself is drawn by the
 * frame, so there is no draw().
 *
 * Imports from ../../../Shared/, ../../core/ and ../frozen-plan/ — this
 * folder breaks if moved without them coming along.
 */

import { OrbitalMath } from "../../../Shared/math-utils.js";
import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { baseState } from "../../../Shared/kinematic-chain.js";
import { moonProgradeSpeed } from "../../core/departure-estimate.js";
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
	return {
		anchorJd: anchorJd,
		dist: O.vMag(s.r),                                     // m
		speed: O.vMag(s.v),                                    // m/s
		prograde: moonProgradeSpeed(anchorJd, earthV),         // m/s, signed
		r: s.r, v: s.v
	};
}

// Last computed figures per (World, stage), for the card (same WeakMap
// pattern as every module: N missions coexist, Worlds reuse stage ids).
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

export default {
	id: "moon-platform",
	title: "Moon (platform)",
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
			{ base: "Moon", rotors: [] },
			{ tool: "mission-planner/moon-platform", label: "carrier chain base",
			  iso: isoOf(anchorJd) });
		return { packet: packet };
	},

	// ---- view layer (shell-called; never runs in Node) --------------------

	// The read-only card: no inputs, just the Moon's facts at the anchor.
	init: function (ctx) {
		var host = ctx.panelHost;

		var note = document.createElement("div");
		note.className = "mp-muted";
		note.textContent = "Read-only — the release date is frozen in the plan; " +
			"plan around the Moon in the Ephemeris tab.";
		host.appendChild(note);

		var out = document.createElement("div"); out.className = "mp-readouts";
		host.appendChild(out);

		ctx.onResult(function () {
			out.innerHTML = "";
			var fig = figuresFor(ctx.world, ctx.stageId);
			if (!fig) { return; }
			[["release date", isoOf(fig.anchorJd)],
			 ["geocentric distance", Math.round(fig.dist / 1e3).toLocaleString() + " km"],
			 ["geocentric speed", Math.round(fig.speed) + " m/s"],
			 ["along Earth prograde", (fig.prograde >= 0 ? "+" : "") + Math.round(fig.prograde) + " m/s"]
			].forEach(function (pair) {
				var r = document.createElement("div"); r.className = "mp-row";
				var k = document.createElement("span"); k.className = "mp-k"; k.textContent = pair[0];
				var v = document.createElement("span"); v.className = "mp-v"; v.textContent = pair[1];
				r.appendChild(k); r.appendChild(v); out.appendChild(r);
			});
		});
	}
};
