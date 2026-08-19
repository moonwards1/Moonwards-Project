/* MissionPlanner/modules/platform/platform-roles — the two thin role adapters
 * that turn a platform spec (platform-spec.js) into stage descriptors.
 *
 *   makeCarrier(spec, { id, title })   the DEPARTURE role. Rides an upstream
 *     carrier chain when there is one, appends its own element, emits the
 *     extended chain. Renders in the mission's origin frame, parented at its
 *     own `body`.
 *   makeTerminal(spec, { id, title })  the ARRIVAL role. Consumes the delivered
 *     ship-state, evaluates what the platform does to it, emits nothing.
 *     Renders in the mission's destination frame.
 *
 * Everything the two roles do APART from the platform's own physics lives
 * here, once: the body checks, the chain plumbing and its mismatch guard, the
 * release-anchor lookup, finding the arrival leg's measured pass, the
 * intercept check, the declared-parameter card, and the epoch a platform's
 * drawn phase is pinned to. What a platform supplies is the substance —
 * geometry, the release gate and chain element, the capture figures, the
 * drawing. A platform whose physics genuinely differ overrides one of those
 * functions in its own folder rather than reaching in here.
 *
 * `update` is pure (no DOM, no THREE) in both roles, so a platform stays
 * Node-testable through its adapters; `init` and `draw` are the browser
 * shell's.
 *
 * Imports from ../../../Shared/, ../../core/ and sibling modules — this folder
 * breaks if moved without them coming along.
 */

import { PacketTypes } from "../../../Shared/exchange-types.js";
import { Frames } from "../../../Shared/frames.js";
import { emptyChain, appendElement, applyElement, evaluateChain } from "../../../Shared/kinematic-chain.js";
import { stateDeltaEffect } from "../../../Shared/geo-leg.js";
import { makeDiagnostic } from "../../core/diagnostics.js";
import { releaseAnchorFor, arrivalCommitmentFor } from "../frozen-plan/frozen-plan.js";
import { approachAt, approachFromPass, interceptWarning } from "../arrival-approach.js";
import { passFor as arrivalPassFor } from "../arrival-leg/arrival-leg.js";
import { RELEASE, CATCH, validatePlatformSpec, resolvePlatformParams,
         paramsForRole, paramToDisplay, paramFromDisplay,
         createStageCache } from "./platform-spec.js";

function assertSpec(spec) {
	var v = validatePlatformSpec(spec);
	if (!v.ok) { throw new Error("platform-roles: " + (spec && spec.id) + " " + v.reason); }
}

function speedKmS(v) { return Math.hypot(v[0], v[1], v[2]) / 1000; }

// The straddling readout box's data for a carrier element (Shared/sim/
// readout-panes.js). Pure; exported for the Node tests.
//
// The three rows answer three different questions, and only the middle one
// needs the chain the element rides:
//
//   impulse Δv    the element's OWN contribution, isolated against a bare zero
//                 state. Composition is a plain vector sum, so this magnitude
//                 is the same whatever the element is mounted on — a rotor's
//                 tip speed, a driver's kick — and it is the one row that
//                 stays a property of the hardware alone.
//   prograde Δv   the speed the payload is left AT once this element's
//                 contribution is added onto its mount's state — an absolute
//                 speed, not a change. A magnitude difference would be
//                 actively misleading here — a 0.5 km/s kick aimed 90° off a
//                 6 km/s mount raises the speed by only 21 m/s, and reporting
//                 that number would hide the entire kick. The speed it
//                 started from is the MOUNT's, and the mount has a box of its
//                 own reporting exactly that figure, so this box states one
//                 number and the stack reads as a running total up the chain.
//                 How far the element TURNED the heading is the release
//                 arrows' job, not this box's.
//   plane change  the element's own inclination against an implicit ecliptic
//                 reference (Shared/geo-leg.js's stateDeltaEffect), NOT a diff
//                 against the mount's orbit. A skyhook's rotor is confined to
//                 the ecliptic by construction (skyhook.js's rotorFor), so
//                 this reads a true 0° today; it becomes a live number when a
//                 platform can be given a plane of its own.
export function carrierReadout(geo, element, upstream, anchorJd) {
	var own = applyElement({ r: [0, 0, 0], v: [0, 0, 0] }, element, anchorJd);
	var eff = stateDeltaEffect(geo.GM, [0, 0, 0], [0, 0, 0], own.r, own.v);
	var mount = evaluateChain(upstream, anchorJd);
	eff.speedAfter = speedKmS(applyElement(mount, element, anchorJd).v);
	eff.progradeDv = eff.speedAfter - speedKmS(mount.v);
	return eff;
}

function noBodyDiagnostic(spec, role) {
	var isRelease = role === RELEASE;
	return makeDiagnostic("no-body",
		"This " + spec.label.toLowerCase() + " has no " + (isRelease ? "origin" : "destination") +
		" body set.",
		{ fix: "Set the " + (isRelease ? "departure body (the mission's origin)"
		                                : "arrival body (the mission's destination)") + "." });
}

// ---- the departure role ----------------------------------------------------

export function makeCarrier(spec, opts) {
	assertSpec(spec);
	if (!spec.release) { throw new Error("platform-roles: " + spec.id + " has no release half"); }
	var cache = createStageCache();
	// The straddling readout box (Shared/sim/readout-panes.js) every platform
	// gets for free — see readoutCache's fill below and drawPlatform/
	// buildPlatformCard, which read it back generically for any platform.
	var readoutCache = createStageCache();
	var hostCache = createStageCache();

	// A platform that must ride something takes a required input; one that may
	// self-originate takes an optional one; one that must be the base takes none.
	var rides = spec.ridesOn === undefined ? "*" : spec.ridesOn;
	var isBaseOnly = Array.isArray(rides) && rides.length === 0;

	var desc = {
		id: opts.id,
		title: opts.title || spec.label,
		// The body it is at (its own `body` param), resolved per stage by the
		// shell: a satellite's moving node in its primary's frame, or a planet at
		// its own frame's centre.
		attachesTo: function (stage) { return (stage && stage.params && stage.params.body) || null; },
		accepts: isBaseOnly ? [] : ["carrier-chain"],
		emits: ["carrier-chain"],
		rendersIn: ["body:origin"],   // aliased to the mission's origin frame by
		                               // mission-view.js's resolveFrameId

		update: function (ctx, input) {
			var params = resolvePlatformParams(spec, ctx.params);
			// Cleared up front and only re-filled on the success path at the
			// bottom, so a stage that starts failing never keeps showing a
			// readout box computed from its last-good chain.
			readoutCache.remember(ctx.world, ctx.stageId, null);
			if (!params.body) {
				cache.remember(ctx.world, ctx.stageId, null);
				return noBodyDiagnostic(spec, RELEASE);
			}

			// Riding an upstream chain: its base must name THIS platform's body,
			// or the platform's physics would silently apply the wrong body's
			// numbers (the body convention's mismatch guard —
			// Shared/exchange-types.js's header).
			if (input && input.data && input.data.base !== params.body) {
				cache.remember(ctx.world, ctx.stageId, null);
				return makeDiagnostic("wrong-body",
					"This " + spec.label.toLowerCase() + " is at " + params.body +
					", but the chain it rides starts at " + input.data.base + ".",
					{ values: { body: params.body, base: input.data.base },
					  fix: "Remove this technology, or start the chain from a " +
					       params.body + " platform." });
			}

			var geo = spec.geometry(params);
			cache.remember(ctx.world, ctx.stageId, geo);
			if (!geo.ok) { return geo.diagnostic; }
			var gated = spec.release.gate ? spec.release.gate(geo) : null;
			if (gated) { return gated; }

			// The release epoch is the plan's read-only anchor. An upstream base
			// platform diagnoses a missing one too; a self-originating platform is
			// the top of the chain and carries the same check.
			var anchorJd = releaseAnchorFor(ctx.world);
			if (anchorJd === null) {
				return makeDiagnostic("no-release-anchor",
					"This mission has no release anchor — no frozen flight plan (or legacy " +
					"release date) fixes when the carrier chain releases.",
					{ fix: "Start missions from the Ephemeris tab (Start Mission Plan bakes the anchor)." });
			}

			// Extend the chain it rides, or start a fresh one. The chain's base is
			// this platform's own body either way.
			var upstream = (input && input.data) ? input.data : emptyChain(params.body);
			var element = spec.release.element(geo, anchorJd);
			var chain = appendElement(upstream, element);

			// The straddling readout box's data — see carrierReadout's own
			// header for what its three rows mean and why the prograde one is
			// measured against the mount rather than against nothing.
			readoutCache.remember(ctx.world, ctx.stageId,
				carrierReadout(geo, element, upstream, anchorJd));

			return { packet: PacketTypes.make("carrier-chain", chain,
				{ tool: "mission-planner/" + opts.id,
				  label: params.body + " " + spec.label.toLowerCase() + " carrier chain" }) };
		},

		// ---- view layer (shell-called; never runs in Node) ------------------

		init: function (ctx) { buildPlatformCard(spec, ctx, RELEASE, cache, hostCache); },

		draw: function (view, snap) {
			drawPlatform(spec, view, snap, RELEASE, cache, releaseAnchorFor(snap.world), readoutCache, hostCache);
		}
	};
	if (!isBaseOnly && rides === "*") { desc.inputOptional = true; }
	return desc;
}

// ---- the arrival role ------------------------------------------------------

// The arrival leg's own measured pass, reached sideways the way every
// cross-stage trajectory read in this app works (the packet carries one
// instant; a pass needs the flight). null in a bare Node call, or with no
// arrival leg ahead of this stage — computeCapture then falls back.
function arrivalPassOf(world) {
	if (!world || typeof world.stages !== "function") { return null; }
	var stages = world.stages();
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId === "arrival-leg") { return arrivalPassFor(world, stages[i].id); }
	}
	return null;
}

// What the platform does to the delivered approach, pure. `data` is a
// helio-frame ship-state payload; `pass` (optional) the arrival leg's own
// measured pass — the approach this platform actually has to absorb, at
// closest approach and with any arrival waypoints already in it. Without one
// it falls back to measuring at the delivered instant, which sits at the
// arrival leg's END, roughly a day PAST the pass and therefore neither the
// closest nor the fastest point.
//
// Returns { ok: true, body, geo, approach, jd, warnings, ...figures } or
// { ok: false, diagnostic }. The platform's own figures are spread at the top
// level so a card, a draw hook or a test reads them directly.
export function computeCapture(spec, params, data, pass) {
	var p = resolvePlatformParams(spec, params);
	if (!p.body) { return { ok: false, diagnostic: noBodyDiagnostic(spec, CATCH) }; }

	var approach = (pass ? approachFromPass(p.body, pass) : null) || approachAt(p.body, data);
	if (!approach) {
		return { ok: false, diagnostic: makeDiagnostic("bad-params",
			"The arrival body '" + p.body + "' is not a body with a heliocentric orbit.",
			{ values: { body: p.body } }) };
	}
	var geo = spec.geometry(p);
	if (!geo.ok) { return geo; }

	var figures = spec.capture.figures(geo, approach, data) || {};
	var warnings = [];
	var missW = interceptWarning(approach);
	if (missW) { warnings.push(missW); }
	if (spec.capture.warnings) {
		(spec.capture.warnings(figures, approach, geo) || []).forEach(function (w) {
			if (w) { warnings.push(w); }
		});
	}

	return Object.assign({ ok: true, body: p.body, geo: geo, approach: approach,
	                       jd: data.jd, warnings: warnings, figures: figures }, figures);
}

// The straddling readout box's data for a capture role: a "rendezvous"
// platform's trimDv (m/s, signed — see platform-spec.js's capture.figures
// doc) IS the whole burn, and it is by definition along the hardware's own
// velocity direction (a speed-matching trim, not a targeted 3-axis burn), so
// there is no separate plane to change. A platform whose figures carry no
// trimDv (a "pass-through" one, or one that hasn't adopted the convention
// yet) simply gets no box — same graceful-absence rule as a negligible
// waypoint burn.
//
// trimDv is what the SHIP must shed (vCatch − vRel, positive when it arrives
// faster than the hardware it is matching), so as a prograde change it is
// that value negated. The prograde row itself takes the same absolute-speed
// form a carrier element's does: the tip speed the ship leaves matched to.
// The speed it CAME IN at belongs to the trajectory that brought it there,
// and is reported there rather than restated here.
export function captureReadout(figures, geo) {
	if (!figures || typeof figures.trimDv !== "number" || !isFinite(figures.trimDv)) { return null; }
	var out = { burnDv: Math.abs(figures.trimDv) / 1000, planeChange: 0,
	            progradeDv: -figures.trimDv / 1000 };
	if (geo && isFinite(geo.vRel)) { out.speedAfter = geo.vRel / 1000; }
	return out;
}

export function makeTerminal(spec, opts) {
	assertSpec(spec);
	if (!spec.capture) { throw new Error("platform-roles: " + spec.id + " has no capture half"); }
	var cache = createStageCache();
	var readoutCache = createStageCache();
	var hostCache = createStageCache();

	return {
		id: opts.id,
		title: opts.title || spec.label,
		attachesTo: null,             // rendered body-centric (the destination is the frame origin)
		accepts: ["ship-state"],
		emits: [],                    // terminal: the mission ends here
		rendersIn: ["body:destination"],   // aliased to the mission's destination frame
		                                    // by mission-view.js's resolveFrameId

		update: function (ctx, input) {
			var data = input.data.frame === "helio" ? input.data : Frames.convert(input.data, "helio");
			var cap = computeCapture(spec, ctx.params, data, arrivalPassOf(ctx.world));
			cache.remember(ctx.world, ctx.stageId, cap);
			readoutCache.remember(ctx.world, ctx.stageId,
				cap.ok ? captureReadout(cap.figures, cap.geo) : null);
			if (!cap.ok) { return cap.diagnostic; }

			return {
				packet: null,
				warnings: cap.warnings,
				events: [{ jd: cap.jd, flight: false, label: spec.capture.eventLabel(cap) }]
			};
		},

		// ---- view layer (shell-called; never runs in Node) ------------------

		init: function (ctx) { buildPlatformCard(spec, ctx, CATCH, cache, hostCache); },

		draw: function (view, snap) {
			var commit = arrivalCommitmentFor(snap.world);
			var cached = cache.get(snap.world, snap.stageId);
			var pinJd = commit ? commit.jd : (cached && cached.ok ? cached.jd : null);
			drawPlatform(spec, view, snap, CATCH, cache, pinJd, readoutCache, hostCache);
		}
	};
}

// ---- the shared card and draw plumbing ------------------------------------

// The declared-parameter card: the platform's note, one control per param that
// applies to this role, and its readouts. A platform adds a control by adding
// a line to its `params` list. `hostCache` remembers the card's own content
// host so drawPlatform can anchor the straddling readout box on it — every
// platform's card gets the same anchor, no per-platform DOM needed.
function buildPlatformCard(spec, ctx, role, cache, hostCache) {
	var host = ctx.panelHost;
	host.classList.add("mp-pane-host");
	hostCache.remember(ctx.world, ctx.stageId, host);

	function fullParams() {
		var stage = ctx.world.getStage(ctx.stageId);
		return resolvePlatformParams(spec, stage ? stage.params : {});
	}
	function setParam(name, value, setOpts) {
		var patch = {}; patch[name] = value;
		ctx.world.set({ stage: ctx.stageId, params: patch }, setOpts);
	}
	// mp-tech-row (planner.css) indents the label ~20px off the card's left
	// edge — every param row on every technology card, present and future,
	// straddled by the card's own readout box (drawPlatform, below), which
	// pokes in from that edge and would otherwise sit right over the label.
	function row(labelText) {
		var el = document.createElement("div"); el.className = "mp-inrow mp-tech-row";
		var lab = document.createElement("label"); lab.textContent = labelText;
		el.appendChild(lab);
		return el;
	}
	function unitSpan(text) {
		var u = document.createElement("span"); u.className = "mp-unit"; u.textContent = text;
		return u;
	}

	if (spec.note) {
		var note = document.createElement("div"); note.className = "mp-muted mp-tech-note";
		note.textContent = spec.note(fullParams(), role);
		host.appendChild(note);
	}

	paramsForRole(spec, role).forEach(function (p) {
		var el = row(p.label);
		var wrap = document.createElement("span");

		if (p.kind === "slider") {
			wrap.className = "mp-phase-wrap";
			var slider = document.createElement("input");
			slider.type = "range";
			slider.min = p.min; slider.max = p.max; slider.step = p.step;
			slider.value = paramToDisplay(p, fullParams()[p.name]);
			wrap.appendChild(slider);
			var readout = unitSpan(paramToDisplay(p, fullParams()[p.name]) + (p.unit || ""));
			wrap.appendChild(readout);
			// Dragging issues transient sets (live redraft, coalescible by a future
			// undo); releasing the handle commits.
			slider.addEventListener("input", function () {
				var v = parseFloat(slider.value);
				if (!isFinite(v)) { return; }
				readout.textContent = v + (p.unit || "");
				setParam(p.name, paramFromDisplay(p, v), { transient: true });
			});
			slider.addEventListener("change", function () {
				var v = parseFloat(slider.value);
				if (isFinite(v)) { setParam(p.name, paramFromDisplay(p, v)); }
			});
		} else {
			var inp = document.createElement("input");
			inp.type = "number"; inp.step = p.step;
			inp.value = paramToDisplay(p, fullParams()[p.name]);
			wrap.appendChild(inp);
			wrap.appendChild(unitSpan(p.unit || ""));
			inp.addEventListener("change", function () {
				var v = parseFloat(inp.value);
				if (isFinite(v)) { setParam(p.name, paramFromDisplay(p, v)); }
			});
		}

		el.appendChild(wrap);
		host.appendChild(el);
	});

	if (spec.readouts) {
		var out = document.createElement("div"); out.className = "mp-readouts";
		host.appendChild(out);
		ctx.onResult(function () {
			out.innerHTML = "";
			var rows = spec.readouts(cache.get(ctx.world, ctx.stageId), role) || [];
			rows.forEach(function (pair) {
				var r = document.createElement("div"); r.className = "mp-row";
				var k = document.createElement("span"); k.className = "mp-k"; k.textContent = pair[0];
				var v = document.createElement("span"); v.className = "mp-v"; v.textContent = pair[1];
				r.appendChild(k); r.appendChild(v); out.appendChild(r);
			});
		});
	}
}

// The platform's own draw, given everything role-dependent already resolved:
// which role it is in, and the epoch its chosen phase is pinned to. Fills
// view.readoutEntries (the shell's convention — mission-view.js's
// refreshReadouts, same as every leg module's own draw()) BEFORE the
// spec.draw() early-return, so the straddling box shows even for a platform
// with no hardware of its own left to draw.
function drawPlatform(spec, view, snap, role, cache, pinJd, readoutCache, hostCache) {
	view.readoutEntries = [];
	var data = readoutCache.get(snap.world, snap.stageId);
	var host = hostCache.get(snap.world, snap.stageId);
	if (data && host) { view.readoutEntries.push({ host: host, data: data }); }

	if (!spec.draw) { return; }
	spec.draw(view, snap, {
		role: role,
		params: resolvePlatformParams(spec, snap.params),
		computed: cache.get(snap.world, snap.stageId),
		pinJd: pinJd,
		failed: !!(snap.result && snap.result.status === "diagnostic")
	});
}
