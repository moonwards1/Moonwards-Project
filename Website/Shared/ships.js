// Ship classes: the support ships that close the gap between what a facility
// delivers and what a route needs. ES module, pure (no DOM), Node-tested:
//   import { SHIP_ROLES, PROPELLANTS, createFleet, shipDv, shieldMass, shipTitle, versionName } from "../Shared/ships.js";
//
// Ships are not a means of transport in their own right. Each installation
// says which roles it needs (Home/design-model.js shipRolesFor), and its
// Logistics tab shows one card per role (Shared/ship-card.js).
//
// A ship CLASS is hardware only: propellant, Isp, dry mass, payload,
// propellant capacity, heat shield (carried or not). It belongs to the whole design, so one
// class serves every installation assigned to it and an edit reaches all of
// them. What a given route asks of the ship stays with the installation.
//
// Each role has one STANDARD class, the first of the role: every installation
// uses it unless given its own copy. Capsules and shuttles never leave their
// host system, so a copy of one is a local version, specialized for one
// installation's service. A freighter copy is another version of the design,
// and any installation can switch among the versions; a role has at most
// MAX_VERSIONS freighter designs, the standard included. Freighter versions
// stay in the design while unused; a local version nothing uses is dropped.
//
// Masses are tonnes, Isp seconds, Δv m/s.

import { Const } from "./constants.js";

export const SHIP_ROLES = {
	shuttle: { label: "Shuttle", desc: "Frequent short round trips; small burns to circularize, dock and land." },
	freighter: { label: "Freighter", desc: "Carries cargo between bodies after a facility's release." },
	capsule: { label: "Capsule", desc: "Enters an atmosphere; always carries a heat shield." }
};
export const ROLE_ORDER = ["shuttle", "freighter", "capsule"];

export const MAX_VERSIONS = 3;

// Roles whose ships stay in their host system: their copies are local versions.
export function isLocalRole(role) { return role === "shuttle" || role === "capsule"; }

// A freighter version's name, by what sets it apart: payload capacity in
// kilotonnes, and HS if it carries a heat shield ("0.5 kt HS"). `bare`
// leaves out the unit, for the compact version buttons ("0.5 HS").
export function versionName(c, bare) {
	var kt = (c.payload / 1000).toLocaleString("en-US", { maximumSignificantDigits: 3 });
	return kt + (bare ? "" : " kt") + (c.shield ? " HS" : "");
}

// A class's card title: the role, and a freighter version's name after it.
export function shipTitle(c, standard) {
	var label = SHIP_ROLES[c.role].label;
	return standard || isLocalRole(c.role) ? label : label + " " + versionName(c);
}

// Chemical propellants only. `isp` is a typical vacuum figure, used as the
// starting value when the propellant is chosen; the Isp field can be edited.
// `rough`: the figure is a placeholder pending a sourced value.
export const PROPELLANTS = [
	{ key: "mg-lox", label: "Magnesium / LOX", isp: 260, rough: true },
	{ key: "al-lox", label: "Aluminium / LOX", isp: 285, rough: true },
	{ key: "s-lox", label: "Sulfur / LOX", isp: 230, rough: true },
	{ key: "lh2-lox", label: "Hydrogen / LOX", isp: 450 },
	{ key: "ch4-lox", label: "Methane / LOX", isp: 370 },
	{ key: "rp1-lox", label: "Kerosene / LOX", isp: 350 },
	{ key: "nto-mmh", label: "NTO / MMH (storable)", isp: 320 }
];
export const DEFAULT_PROPELLANT = "mg-lox";

export function propellant(key) {
	return PROPELLANTS.find(function (p) { return p.key === key; }) || null;
}

// Starting figures for a new class of each role; the propellant, where
// given, replaces DEFAULT_PROPELLANT.
var START = {
	shuttle: { dry: 20, payload: 30, tank: 40 },
	freighter: { dry: 4000, payload: 50000, tank: 20000, propellant: "ch4-lox", shield: true },
	capsule: { dry: 8, payload: 4, tank: 3 }
};

// A carried heat shield's mass, as a fraction of the loaded ship: dry mass,
// payload and full tanks, the shield itself not counted. The shield is
// separate from the dry mass and adds to it.
export const SHIELD_FRACTION = 0.04;
export function shieldMass(c) {
	return c.shield ? SHIELD_FRACTION * (c.dry + c.payload + c.tank) : 0;
}

// Δv the class can make with full tanks, loaded and empty:
//   Δv = Isp · g₀ · ln(m₀ / m_f),  m₀ = dry + shield + payload + tank,  m_f = m₀ − tank.
export function shipDv(c) {
	var g = c.isp * Const.g0, hull = c.dry + shieldMass(c);
	return {
		loaded: g * Math.log((hull + c.payload + c.tank) / (hull + c.payload)),
		empty: g * Math.log((hull + c.tank) / hull)
	};
}

function num(x, fallback, min) {
	var v = typeof x === "number" ? x : parseFloat(x);
	return isFinite(v) && v >= min ? v : fallback;
}

// A clean copy of a saved class, or null if it isn't one.
function cleanClass(c) {
	if (!c || typeof c.id !== "string" || !SHIP_ROLES[c.role]) return null;
	var s = START[c.role], p = propellant(c.propellant) ? c.propellant : DEFAULT_PROPELLANT;
	return {
		id: c.id, role: c.role,
		name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : SHIP_ROLES[c.role].label,
		propellant: p,
		isp: num(c.isp, propellant(p).isp, 1),
		dry: num(c.dry, s.dry, 0.001),
		payload: num(c.payload, s.payload, 0),
		tank: num(c.tank, s.tank, 0),
		shield: c.role === "capsule" ? true : !!c.shield
	};
}

// The design's ship classes and which one each installation uses for each
// role. data: { classes: [...], use: { "<installation id>/<role>": class id } },
// as toJSON() returns it; missing or damaged parts are dropped.
//
// Every installation's role is assigned (sync), so usedBy() is complete even
// for installations whose calculator hasn't been opened yet. A role with no
// class gets one the first time it's needed. subscribe(fn) runs fn after any
// change, so every mounted card and calculator can follow it.
export function createFleet(data) {
	var d = data && typeof data === "object" ? data : {};
	var classes = (Array.isArray(d.classes) ? d.classes : []).map(cleanClass).filter(Boolean);
	var use = {};
	var listeners = [];
	var seq = 0;
	if (d.use && typeof d.use === "object") {
		Object.keys(d.use).forEach(function (k) { if (classes.some(function (c) { return c.id === d.use[k]; })) use[k] = d.use[k]; });
	}

	function newId() {
		var id;
		do { seq++; id = "s" + seq.toString(36); } while (classes.some(function (c) { return c.id === id; }));
		return id;
	}
	function emit() { listeners.forEach(function (fn) { fn(); }); }
	function get(id) { return classes.find(function (c) { return c.id === id; }) || null; }
	function ofRole(role) { return classes.filter(function (c) { return c.role === role; }); }
	function add(role, from) {
		var c = cleanClass(Object.assign({}, from || { role: role, propellant: DEFAULT_PROPELLANT }, START[role] && !from ? START[role] : {}, { id: newId(), role: role }));
		classes.push(c);
		return c;
	}
	// Drop local versions that no installation uses.
	function prune() {
		classes = classes.filter(function (c) {
			return !isLocalRole(c.role) || ofRole(c.role)[0] === c || Object.keys(use).some(function (k) { return use[k] === c.id; });
		});
	}
	function assign(instId, id) {
		var c = get(id);
		if (!c) return;
		var key = instId + "/" + c.role;
		if (use[key] === c.id) return;
		use[key] = c.id;
		prune();
		emit();
	}
	function assigned(instId, role) {
		var c = get(use[instId + "/" + role]);
		if (c) return c;
		c = ofRole(role)[0] || add(role);
		use[instId + "/" + role] = c.id;
		return c;
	}

	return {
		list: ofRole,
		get: get,
		// The class an installation uses for a role (assigned on first ask).
		classFor: function (instId, role) { return assigned(instId, role); },
		// The role's standard class, and whether a class is one.
		standard: function (role) { return ofRole(role)[0] || add(role); },
		isStandard: function (c) { return !!c && ofRole(c.role)[0] === c; },
		// Change fields of a class: every installation using it follows.
		update: function (id, patch) {
			var c = get(id);
			if (!c) return;
			var next = cleanClass(Object.assign({}, c, patch, { id: c.id, role: c.role }));
			Object.keys(next).forEach(function (k) { c[k] = next[k]; });
			emit();
		},
		// A copy of a class, assigned to this installation only. A freighter
		// copy is refused once the role has MAX_VERSIONS designs.
		copy: function (id, instId) {
			var c = get(id);
			if (!c) return null;
			if (!isLocalRole(c.role) && ofRole(c.role).length >= MAX_VERSIONS) return null;
			var n = ofRole(c.role).length + 1;
			var copy = add(c.role, Object.assign({}, c, { name: SHIP_ROLES[c.role].label + " " + n }));
			use[instId + "/" + c.role] = copy.id;
			emit();
			return copy;
		},
		// Put an installation on another class of the same role. A local
		// version it leaves is dropped once nothing uses it.
		assign: assign,
		// Remove a version (never the standard) from the design; installations
		// using it go back to the standard.
		remove: function (id) {
			var c = get(id);
			if (!c || ofRole(c.role)[0] === c) return;
			var std = ofRole(c.role)[0];
			Object.keys(use).forEach(function (k) { if (use[k] === c.id) use[k] = std.id; });
			classes.splice(classes.indexOf(c), 1);
			emit();
		},
		// Put an installation back on the role's standard class.
		revert: function (instId, role) { assign(instId, (ofRole(role)[0] || add(role)).id); },
		// Installation ids using a class.
		usedBy: function (id) {
			return Object.keys(use).filter(function (k) { return use[k] === id; }).map(function (k) { return k.slice(0, k.lastIndexOf("/")); });
		},
		// Match the assignments to the design: `needs` maps each installation id
		// to the roles it needs. Roles no longer needed are dropped; new ones are
		// assigned. Local versions nothing uses are dropped.
		sync: function (needs) {
			var before = JSON.stringify(use), count = classes.length;
			Object.keys(use).forEach(function (k) {
				var i = k.lastIndexOf("/"), roles = needs[k.slice(0, i)];
				if (!roles || roles.indexOf(k.slice(i + 1)) < 0) delete use[k];
			});
			Object.keys(needs).forEach(function (instId) { needs[instId].forEach(function (r) { assigned(instId, r); }); });
			prune();
			if (JSON.stringify(use) !== before || classes.length !== count) emit();
		},
		subscribe: function (fn) {
			listeners.push(fn);
			return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
		},
		toJSON: function () {
			return { classes: classes.map(function (c) { return Object.assign({}, c); }), use: Object.assign({}, use) };
		}
	};
}
