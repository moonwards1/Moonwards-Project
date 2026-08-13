/* MissionPlanner/modules/platform/platform-spec — what a technology platform
 * IS, as data.
 *
 * ONE PLATFORM = ONE FOLDER holding the substance (geometry, parameters,
 * kinematics, drawing, calculator packet); TWO THIN ROLE ADAPTERS on top turn
 * that substance into the two stage descriptors the engine registers —
 * departure (a CARRIER that composes into the kinematic chain and produces a
 * release) and arrival (a TERMINAL stage that consumes the delivered
 * ship-state). The adapters are in platform-roles.js; this file is the
 * contract they read and the pure helpers both need.
 *
 * The roles cannot be one descriptor: core/registry.js validates
 * `accepts`/`emits` statically, and mission-view.js identifies tech stages
 * structurally by those packet types. A platform with only one real role ships
 * one adapter — an aerobrake is arrival-only, a surface mass driver is
 * launch-only in practice.
 *
 * WHAT A PLATFORM MODELS, AND WHAT IT DOES NOT. Kinematics and impulse only:
 * its geometry, its motion, the impulse it imparts or absorbs, and the gates
 * that decide whether that is physically available. Mass, taper, materials,
 * power and cost stay in the calculators under Website/Calculators/ and reach
 * a card through the exchange packet (Shared/exchange-types.js), never by
 * being reimplemented here. This ceiling is what keeps each new platform a
 * bounded job and keeps one physics in one place.
 *
 * ---- the spec object ------------------------------------------------------
 *
 *   id       platform id, e.g. "skyhook" — NOT a stage module id (the role
 *            adapters carry those, so a platform's registry ids stay stable
 *            independently of what the platform is called).
 *   label    human name for dropdowns and card titles.
 *
 *   bodies      "*" for any body, or an explicit list of body names.
 *   appliesTo   optional fn(body) -> bool, ANDed with `bodies` — for
 *               constraints a list can't state (an aerobrake needs an
 *               atmosphere; an elevator needs a workable synchronous radius).
 *   ridesOn     departure layering, the design's "rule set" for add-ons:
 *                 []          must be the base of its chain
 *                 "*"         may ride anything, or self-originate
 *                 [ids...]    must ride one of those platforms (a tip spin
 *                             launcher on a skyhook or space elevator)
 *
 *   defaultParams        static param defaults.
 *   defaultsFor(body)    optional per-body defaults (a skyhook's orbit radius
 *                        depends on the body's own satellites), applied over
 *                        defaultParams and under the stage's explicit params.
 *   params               the card's controls, declared (see PARAM SPEC below).
 *   note(params, role)   optional one-line description above the controls.
 *   readouts(computed, role)  optional [[key, value], ...] shown under them,
 *                        plain rows IN the card — separate from the
 *                        straddling impulse/prograde/plane-change box on the
 *                        card's edge (Shared/sim/readout-panes.js), which
 *                        platform-roles.js fills for EVERY release/capture
 *                        platform automatically (see release.element and
 *                        capture.figures below) — no per-platform code needed
 *                        for that one.
 *
 *   geometry(params)     the platform's own figures, pure. Returns
 *                        { ok: true, ... } or { ok: false, diagnostic }. Both
 *                        roles call this — it is the shared substance.
 *
 *   release              the departure half, or null:
 *     gate(geo)            optional fn -> diagnostic | null. What a RELEASE
 *                          demands beyond existing (a skyhook tip below escape
 *                          speed has no interplanetary release to offer). A
 *                          catch has no such requirement, which is exactly why
 *                          this sits here and not in geometry().
 *     element(geo, anchorJd)  the chain element it contributes —
 *                          `rotorElement` or `impulseElement` from
 *                          Shared/kinematic-chain.js. platform-roles.js diffs
 *                          the kinematic chain just before/after this element
 *                          (Shared/kinematic-chain.js's evaluateChain) to fill
 *                          the card's own straddling impulse/prograde/plane-
 *                          change readout box automatically — no platform-side
 *                          work needed (see readouts, below).
 *
 *   capture              the arrival half, or null:
 *     kind                 "rendezvous" — the ship meets moving hardware and
 *                          any speed gap is a trim burn (skyhook, elevator,
 *                          tug); or "pass-through" — the flight itself sheds
 *                          the energy and there is no hardware to meet
 *                          (aerobrake), so it draws onto the trajectory rather
 *                          than building hardware of its own.
 *     figures(geo, approach, data)  the catch, pure — whatever the readouts,
 *                          warnings and event label need. A "rendezvous"
 *                          platform's figures should include `trimDv` (m/s,
 *                          signed — positive means the catch needs MORE speed
 *                          than the hardware already has) so platform-roles.js
 *                          can fill the card's straddling readout box the same
 *                          way the release side does (see readouts, below); a
 *                          "pass-through" platform has no discrete burn to
 *                          report and simply gets no box.
 *     warnings(figures)    optional platform-specific warnings. The generic
 *                          "did the coast actually reach the body" check is
 *                          the adapter's, not the platform's.
 *     eventLabel(figures)  the timeline event's text.
 *
 *   draw(view, snap, ctx)  the hardware, in the role's own frame. `ctx` is
 *                        { role, params, computed, pinJd, failed } — `pinJd`
 *                        is the epoch at which the platform sits at its chosen
 *                        phase (the release anchor, or the committed arrival),
 *                        resolved by the adapter so the substance never has to
 *                        know which end of the mission it is on.
 *
 * ---- PARAM SPEC -----------------------------------------------------------
 *
 *   { name, label, unit, kind, step, scale, decimals, min, max, roles, labelFor }
 *
 *   kind      "number" (a numeric field) or "slider" (a range control that
 *             issues transient sets while dragging and commits on release).
 *   scale     stored SI value = shown value × scale (altitudes are stored in
 *             metres and shown in km, so scale is 1e3). Default 1.
 *   decimals  digits shown. Default 0.
 *   roles     which roles show this control, e.g. ["release"]. Default both.
 *   labelFor  per-role label override, e.g. { catch: "catch altitude" }.
 *
 * Pure (no DOM, no THREE): Node-testable, and imported by ui/tech-options.js
 * for the dropdowns' body filtering.
 *
 * Imports nothing — this file is the bottom of the platform layer.
 */

export var RELEASE = "release";
export var CATCH = "catch";

// A platform spec's core fields. Returns { ok: true } or { ok: false, reason }.
// Authoring-side check: the role adapters call it and throw, the same policy
// core/registry.js uses for descriptors.
export function validatePlatformSpec(spec) {
	if (!spec || typeof spec !== "object") { return { ok: false, reason: "not an object" }; }
	if (typeof spec.id !== "string" || spec.id === "") { return { ok: false, reason: "missing id" }; }
	if (typeof spec.label !== "string" || spec.label === "") { return { ok: false, reason: "missing label" }; }
	if (typeof spec.geometry !== "function") { return { ok: false, reason: "missing geometry()" }; }
	if (!spec.release && !spec.capture) {
		return { ok: false, reason: "has neither a release nor a capture half" };
	}
	if (spec.release && typeof spec.release.element !== "function") {
		return { ok: false, reason: "release half is missing element()" };
	}
	if (spec.capture) {
		if (spec.capture.kind !== "rendezvous" && spec.capture.kind !== "pass-through") {
			return { ok: false, reason: "capture kind must be 'rendezvous' or 'pass-through'" };
		}
		if (typeof spec.capture.figures !== "function") {
			return { ok: false, reason: "capture half is missing figures()" };
		}
	}
	var params = spec.params || [];
	for (var i = 0; i < params.length; i++) {
		if (typeof params[i].name !== "string" || params[i].name === "") {
			return { ok: false, reason: "param " + i + " has no name" };
		}
	}
	return { ok: true };
}

// The full param set for a stage: static defaults, then this body's defaults,
// then the stage's own explicit params on top. Everything reads through this,
// so a stage carrying only { body } still resolves to a live platform.
export function resolvePlatformParams(spec, params) {
	var body = params && params.body;
	var perBody = (body && spec.defaultsFor) ? spec.defaultsFor(body) : null;
	return Object.assign({}, spec.defaultParams || {}, perBody || {}, params || {});
}

// Is this platform offerable at `body`? `bodies` is the coarse filter and
// `appliesTo` the fine one; both must pass.
export function platformAppliesTo(spec, body) {
	if (typeof body !== "string" || body === "") { return false; }
	var list = spec.bodies === undefined ? "*" : spec.bodies;
	if (list !== "*" && list.indexOf(body) === -1) { return false; }
	return spec.appliesTo ? !!spec.appliesTo(body) : true;
}

// May this platform sit on top of `belowId` (a platform id, or null for the
// base of the chain)? The declarative half of the design's add-on rule set —
// the departure dropdown filters its options through this.
export function canRideOn(spec, belowId) {
	var rides = spec.ridesOn === undefined ? "*" : spec.ridesOn;
	if (belowId === null || belowId === undefined) {
		// Self-originating: allowed unless the platform must ride something.
		return rides === "*" || (Array.isArray(rides) && rides.length === 0);
	}
	if (rides === "*") { return true; }
	return Array.isArray(rides) && rides.indexOf(belowId) !== -1;
}

// The controls a given role shows, with that role's label resolved.
export function paramsForRole(spec, role) {
	return (spec.params || []).filter(function (p) {
		return !p.roles || p.roles.indexOf(role) !== -1;
	}).map(function (p) {
		var label = (p.labelFor && p.labelFor[role]) || p.label;
		return Object.assign({}, p, { label: label });
	});
}

// A param's stored SI value as the card shows it, and back again.
export function paramToDisplay(param, stored) {
	var scale = param.scale || 1;
	var decimals = param.decimals || 0;
	return +(stored / scale).toFixed(decimals);
}
export function paramFromDisplay(param, shown) {
	return shown * (param.scale || 1);
}

// Per-(World, stage) cache of the last computed result, for the card readouts
// and the draw hook. Keyed by World first: N missions coexist and their Worlds
// reuse stage ids, so a closed mission's entries go with it.
export function createStageCache() {
	var byWorld = new WeakMap();
	return {
		get: function (world, stageId) {
			var m = byWorld.get(world);
			return (m && m.get(stageId)) || null;
		},
		remember: function (world, stageId, value) {
			if (!world || typeof world !== "object") { return; }
			var m = byWorld.get(world);
			if (!m) { m = new Map(); byWorld.set(world, m); }
			m.set(stageId, value);
		}
	};
}
