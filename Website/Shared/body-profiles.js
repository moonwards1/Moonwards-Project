// What is special about each body, in one place: the figures that set
// body-specific limits, the conditions that switch body-specific cards and
// modules on, and the configurations that exist only at certain bodies.
// Pure (no DOM), so it imports directly in Node. ES module:
//   import { BODY_PROFILES, CONDITIONS, applies, specialsAt, footFloor, ANCHORS, anchorConfig } from "../../Shared/body-profiles.js";
//
// A card or module that belongs only at some bodies names a condition
// (`where: "parentEntry"`); the calculator answers it with applies(where, body)
// through CalcShell.setConditions, and the shell leaves out whatever does not
// apply: no chip, no card. A condition tests the body's physics — its data in
// orbit.js and its profile here — rather than a list of names, so every body
// that meets it gets the card. specialsAt(body) lists what holds at a body.
//
// Profile fields (all optional):
//   footFloor       km above the surface: the lowest a hanging tether's foot may
//                   be. Set near where the air thins to about 10⁻⁸ kg/m³, so drag
//                   costs little reboost propellant and the foot station stays cool;
//                   `floorWhy` is the reason the page gives. Airless bodies have none.
//   entryInterface  km: where an arriving ship meets this body's atmosphere — the
//                   default interface for entry estimates at this body.

import { systems } from "./orbit.js";

export const BODY_PROFILES = {
	Earth: { footFloor: 120, entryInterface: 122,
		floorWhy: "the air there is about 2 × 10⁻⁸ kg/m³; a skyhook this valuable can afford the extra reboost to go that low" },
	Venus: { footFloor: 140,
		floorWhy: "below it the air passes 10⁻⁸ kg/m³, and drag and heating on the foot start to matter" },
	Mars: { footFloor: 115, entryInterface: 125,
		floorWhy: "below it the air passes 10⁻⁸ kg/m³, and drag and heating on the foot start to matter" },
	Titan: { footFloor: 860,
		floorWhy: "Titan's haze reaches far up; below this the air passes 10⁻⁸ kg/m³, and drag and heating on the foot start to matter" }
};

// The parent a body orbits, unless that is the Sun.
function parentOf(name) {
	var s = systems.get(name);
	var p = s && s.orbit && s.orbit.system;
	return p && String(p) !== "Sun" ? p : null;
}

// Conditions a card, module or limit can name. `test(name)` takes a body name.
export const CONDITIONS = {
	parentEntry: { label: "Entry at the parent planet",
		text: "Cargo released from a skyhook here can fall to the planet this body orbits and enter its atmosphere.",
		test: function (name) { var p = parentOf(name); return !!(p && p.atmosphere); } },
	footFloor: { label: "Lowest foot altitude",
		text: "The atmosphere sets how low a hanging tether's foot may go.",
		test: function (name) { return footFloor(name) != null; } }
};

export function applies(where, name) {
	var c = CONDITIONS[where];
	if (!c) throw new Error("Unknown body condition: " + where);
	return c.test(name);
}

// Everything special at a body: [{ id, label, text }] for each condition that holds.
export function specialsAt(name) {
	return Object.keys(CONDITIONS).filter(function (id) { return CONDITIONS[id].test(name); })
		.map(function (id) { return { id: id, label: CONDITIONS[id].label, text: CONDITIONS[id].text }; });
}

export function profileOf(name) { return BODY_PROFILES[name] || {}; }

// The lowest foot altitude at a body, km, or null where there is none.
export function footFloor(name) {
	var f = profileOf(name).footFloor;
	return f == null ? null : f;
}

// The body a body orbits (its name), or null when that is the Sun.
export function parentName(name) {
	var p = parentOf(name);
	return p ? String(p) : null;
}

// ---- configurations anchored on a moon ---------------------------------------
// A hanging skyhook whose centre of mass is a moon. The moon's mass dwarfs the
// tether's, so the moon is the anchor station and its orbit fixes the centre of
// mass; uneven loads only nudge that orbit. The tether rises and falls with the
// moon's eccentric orbit, so the foot's floor is the primary's floor plus that
// swing, and the top must stay clear of `ceiling` (a moon farther out) at the
// near point of that moon's orbit.
//   primary   the body the moon orbits, which the tether hangs toward
//   ceiling   optional: the moon whose orbit the top may not reach
export const ANCHORS = {
	Phobos: { primary: "Mars", ceiling: "Deimos" }
};

// The working figures of an anchor configuration, km and kg:
//   { name, primary, mass, centre (altitude of the moon's orbit), swing (how far
//     the tether rises and falls each orbit), footFloor, topCeiling (or null),
//     ceiling (name or null) }
export function anchorConfig(name) {
	var a = ANCHORS[name];
	if (!a) return null;
	var moon = systems.get(name), primary = systems.get(a.primary);
	var R = Number(primary.radius), o = moon.orbit;
	var swing = Math.max(o.a - o.periapsis, o.apoapsis - o.a);
	var floor = footFloor(a.primary);
	var ceiling = a.ceiling ? systems.get(a.ceiling).orbit.periapsis - swing - R : null;
	return {
		name: name, primary: a.primary, mass: moon.mass,
		centre: (o.a - R) / 1e3, swing: swing / 1e3,
		footFloor: floor == null ? null : Math.ceil(floor + swing / 1e3),
		topCeiling: ceiling == null ? null : Math.floor(ceiling / 1e3),
		ceiling: a.ceiling || null
	};
}
