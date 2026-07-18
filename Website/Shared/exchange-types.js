// Packet envelope + payload-type registry for the module/calculator data
// exchange. ES module:
//   import { PacketTypes } from "../../Shared/exchange-types.js";
// Everything hangs off the `PacketTypes` namespace. See Website/ARCHITECTURE.md,
// "Packets — the data contract" and "Exchange — trading data with the
// calculators".
//
// A packet is one plain, JSON-able envelope:
//   {
//     kind: "moonwards-packet",
//     type: "ship-state",       // a key in PacketTypes.registry
//     version: 1,                // per-type schema version
//     source: { tool, label, iso },
//     data: { ... }               // type-specific payload
//   }
//
// This file is pure (no DOM, no storage) so it imports directly in Node for
// unit testing, same as math-utils.js / format-utils.js.
//
// The "body" convention (Kim, 2026-07-17): several calculators already work
// across more than one body from a single page (the Gravity-gradient-skyhooks
// tool has a body selector; Skyhook-Spin-Launcher follows it) rather than
// being one hardcoded tool per body the way the Moon-Skyhook-Trajectory-
// Plotter and Mars-Phobos-Skyhook-Trajectory-Plotter are today. As the
// Mission Planner's departure/arrival tech dropdowns (WP-I tasks I5/I6) and
// the standalone calculators generalize further, ANY packet type describing
// body-specific physical inputs (surface, GM, atmosphere...) MUST carry an
// explicit `body` field (tether-spec, entry-state and launch-spec below
// already do; carrier-chain's `base` is the same idea under a different
// name) — never let a receiver infer the body from which tool/module sent
// it. Symmetrically, a MODULE that only makes sense for one body (e.g.
// lunar-skyhook.js) must check an incoming body/base field against its own
// assumption and fail with a diagnostic on mismatch, rather than silently
// applying its own body's constants to someone else's numbers — see
// lunar-skyhook.js's update() for the pattern.

export const PacketTypes = {

	KIND: "moonwards-packet",

	// ---- payload registry ---------------------------------------------------
	// Each entry: current `version`, `required` field names, `optional` field
	// names. Receivers ignore fields they don't recognise and refuse (with a
	// banner, not silently) a version newer than the one they were built for —
	// see `PacketTypes.validate`.
	registry: {

		// r [m ×3], v [m/s ×3] — heliocentric or body-local per `frame`.
		"ship-state": {
			version: 1,
			required: ["r", "v", "jd", "frame"],
			optional: ["mass", "dvUsed"]
		},

		// A departure carrier chain (Mission Planner WP-I): the kinematic-chain
		// shape Shared/kinematic-chain.js evaluates — base body name plus an
		// ordered list of rotor elements, each { normal, ref, radius, rate,
		// phase0, epoch } (see that module's header for units/conventions).
		// Emitted by the moon-platform module, extended rotor-by-rotor by each
		// carrier stage (lunar-skyhook, a future tip launcher), consumed by
		// departure-leg, which evaluates it at the release anchor.
		"carrier-chain": {
			version: 1,
			required: ["base", "rotors"],
			optional: []
		},

		// Geometry + material of one vertical (gravity-gradient) or spun tether.
		// footAlt/centreAlt/topAlt are altitudes above the body's surface (m);
		// centreAlt is the centre-of-mass point that sets the orbit. material is
		// { sigma, rho } (tensile strength Pa, density kg/m^3) — the raw physical
		// properties, not a safety-margined combination, so a receiver can apply
		// its own safety factor. period/tipSpeed/taperRatio are derived figures
		// (rotation or orbital period, tip speed, hub/tip taper ratio) that both
		// today's producers and consumers recompute themselves from the geometry
        // + material above, so they're optional/informational rather than load-
		// bearing for a receiver's Apply.
		"tether-spec": {
			version: 1,
			required: ["body", "footAlt", "centreAlt", "topAlt", "material"],
			optional: ["period", "tipSpeed", "taperRatio"]
		},

		// A hyperbolic atmosphere-interface condition (entry speed already
		// resolved from the incoming v-infinity down to the entry altitude —
		// see OrbitalMath.visVivaVelocity — not a raw heliocentric state).
		"entry-state": {
			version: 1,
			required: ["body", "entrySpeed", "flightPathAngle", "altitude"],
			optional: []
		},

		// site is { lat, lon } or { altitude }, whichever the producing
		// calculator works in.
		"launch-spec": {
			version: 1,
			required: ["body", "site", "exitSpeed", "exitDirection"],
			optional: []
		},

		// burns is a list of { label, dv } (m/s); vInf is { departure, arrival }
		// (m/s), either end may be null if not hyperbolic there.
		"transfer-summary": {
			version: 1,
			required: ["departureJd", "arrivalJd", "burns", "vInf"],
			optional: []
		}
	},

	// True if `type` is a payload type this file knows about.
	isKnownType: function (type) {
		return Object.prototype.hasOwnProperty.call(this.registry, type);
	},

	// Validate a full envelope against the registry. Returns
	// { ok: true } or { ok: false, reason: "..." } — never throws, so a
	// receive banner can show `reason` directly rather than the page dying on
	// a malformed or future packet.
	validate: function (packet) {
		if (!packet || typeof packet !== "object") {
			return { ok: false, reason: "not a packet" };
		}
		if (packet.kind !== this.KIND) {
			return { ok: false, reason: "unrecognised kind" };
		}
		var entry = this.registry[packet.type];
		if (!entry) {
			return { ok: false, reason: "unknown packet type '" + packet.type + "'" };
		}
		if (typeof packet.version !== "number") {
			return { ok: false, reason: "missing version" };
		}
		if (packet.version > entry.version) {
			return { ok: false, reason: "'" + packet.type + "' v" + packet.version +
				" is newer than this page understands (v" + entry.version + ")" };
		}
		if (!packet.data || typeof packet.data !== "object") {
			return { ok: false, reason: "missing data" };
		}
		for (var i = 0; i < entry.required.length; i++) {
			var key = entry.required[i];
			if (packet.data[key] === undefined) {
				return { ok: false, reason: "'" + packet.type + "' missing required field '" + key + "'" };
			}
		}
		return { ok: true };
	},

	// Build a validated envelope. `source` is provenance shown to the user on
	// import: { tool, label, iso }. Throws if `type` is unknown or `data` is
	// missing a required field — this is the authoring side, so failing loud
	// and early is preferable to shipping a bad packet.
	make: function (type, data, source) {
		var entry = this.registry[type];
		if (!entry) { throw new Error("PacketTypes.make: unknown type '" + type + "'"); }
		var packet = {
			kind: this.KIND,
			type: type,
			version: entry.version,
			source: source || {},
			data: data
		};
		var result = this.validate(packet);
		if (!result.ok) { throw new Error("PacketTypes.make: " + result.reason); }
		return packet;
	}
};
