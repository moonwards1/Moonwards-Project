// The module registry — where mission-hardware and transfer-leg modules are
// registered so the shell (and the recompute engine) can find them. ES
// module:
//   import { createRegistry, validateDescriptor } from "./registry.js";
// Pure (no DOM), imports directly in Node for unit testing.
//
// See Website/ARCHITECTURE.md, "Module interface". A descriptor is the
// object a module's script default-exports:
//
//   {
//     id: "ceres-elevator",
//     title: "Ceres space elevator",
//     attachesTo: "Ceres",         // body name, or null for transfer legs
//     accepts: ["ship-state"],     // upstream packet types it can consume
//     emits:   ["ship-state"],     // packet types it produces downstream
//     rendersIn: [...],            // view-layer concern; ignored here
//     update(ctx, input) { ... },  // the one hook the headless core calls
//     init / viewAdded / viewRemoved / activate / deactivate / dispose
//                                  // view-layer hooks; optional, ignored here
//   }
//
// The headless core only requires what the recompute chain needs: `id`,
// `title`, `accepts`, `emits` (validated against the PacketTypes registry,
// so a typo'd packet type fails at registration, not mid-mission), and
// `update`. Everything view-facing is optional and unexamined, so the same
// registry serves Node tests and the browser shell.
//
// Registration failures throw — this is the authoring side, same policy as
// PacketTypes.make. A profile *referencing* a module that was never
// registered is a different matter: that is user data, always storable, and
// surfaces as an "unknown-module" diagnostic at recompute time instead
// (see recompute.js).

import { PacketTypes } from "../../Shared/exchange-types.js";

// Check a descriptor's core fields. Returns { ok: true } or
// { ok: false, reason }. `register()` throws with the reason; this is
// exported separately so a dev tool or test can probe without try/catch.
export function validateDescriptor(desc) {
	if (!desc || typeof desc !== "object") {
		return { ok: false, reason: "not an object" };
	}
	if (typeof desc.id !== "string" || desc.id === "") {
		return { ok: false, reason: "missing id" };
	}
	if (typeof desc.title !== "string" || desc.title === "") {
		return { ok: false, reason: "missing title" };
	}
	if (typeof desc.update !== "function") {
		return { ok: false, reason: "missing update()" };
	}
	var lists = ["accepts", "emits"];
	for (var li = 0; li < lists.length; li++) {
		var name = lists[li];
		var list = desc[name];
		if (!Array.isArray(list)) {
			return { ok: false, reason: "missing " + name + " (use [] for none)" };
		}
		for (var i = 0; i < list.length; i++) {
			if (!PacketTypes.isKnownType(list[i])) {
				return { ok: false, reason: name + " has unknown packet type '" + list[i] + "'" };
			}
		}
	}
	return { ok: true };
}

export function createRegistry() {
	var modules = {};   // id -> descriptor

	return {

		// Register a module descriptor. Throws on a malformed descriptor or
		// duplicate id (authoring errors — fail loud and early).
		register: function (desc) {
			var result = validateDescriptor(desc);
			if (!result.ok) {
				throw new Error("registry.register: " + result.reason);
			}
			if (Object.prototype.hasOwnProperty.call(modules, desc.id)) {
				throw new Error("registry.register: duplicate module id '" + desc.id + "'");
			}
			modules[desc.id] = desc;
			return desc;
		},

		has: function (id) {
			return Object.prototype.hasOwnProperty.call(modules, id);
		},

		// The descriptor, or null if that id was never registered (the
		// recompute engine turns null into an "unknown-module" diagnostic —
		// see header comment).
		get: function (id) {
			return Object.prototype.hasOwnProperty.call(modules, id) ? modules[id] : null;
		},

		// All registered descriptors, in registration order.
		list: function () {
			return Object.keys(modules).map(function (id) { return modules[id]; });
		}
	};
}
