// The space-economy design the home page edits: which bodies are in play,
// the major transport infrastructure each one has, and which calculator (if
// any) the workbench mounts for a selection. ES module:
//   import { Design } from "./design-model.js";
//
// Pure (no DOM, no storage), so it imports directly in Node for testing.
//
// A design is one plain, JSON-able object:
//   {
//     kind: "moonwards-design",
//     version: 1,
//     name: "…",
//     savedAt: ISO string or null,
//     bodies: [ { body: "Moon", inst: [ { id, fam, v, state? }, … ] }, … ],
//     ships: { classes, use },               // optional; Shared/ships.js createFleet
//     selected: { body, inst, tab }          // optional; restores the view
//   }
// `fam` is an infrastructure family (FAMILIES key), `v` one of its variants.
// `state`, when present, is the installation's calculator settings as that
// calculator's getState() returned them (CalcShell.getState).
// `ships` is the design's ship classes and which one each installation uses
// for each role; it belongs to the design, not to any one calculator.

import { systems } from "../Shared/orbit.js";
import { applies } from "../Shared/body-profiles.js";

export const DESIGN_KIND = "moonwards-design";
export const DESIGN_VERSION = 1;

// Bodies offered in the Body menu, in order out from the Sun (a moon follows
// its planet). A design lists its bodies in the order the user added them.
export const BODY_ORDER = ["Mercury", "Venus", "Earth", "Moon", "Mars", "Vesta", "Ceres", "Pallas", "Psyche", "Hygiea", "Callisto", "Titan"];

// The three families of giant infrastructure, each with its variants.
// `only`: the variant exists only at these bodies.
// `needs`: the variant sits on another family's installation at the same body.
// `once`: a body can have at most one of this variant.
// `group`: the menu lists consecutive variants sharing a group under one
//     non-clickable heading, as indented sub-entries.
// `full`: the variant's complete display name where `label` alone is too short
//     (see instLabel).
// `menu: false` (family): no column menu. Its variants depend on the body, so
// each body's * (or the "+ add" button, for a plain body) is where they're added.
export const FAMILIES = {
	skyhook: { label: "Skyhook", vars: {
		hanging: { label: "Hanging", desc: "Non-rotating tether hanging from orbit, its foot just above the surface." },
		rotating: { label: "Rotating", desc: "Spinning tether that catches and releases at its tips." },
		phobos: { label: "Phobos", desc: "Tethers anchored on Phobos, reaching down toward Mars and up beyond.", only: ["Mars"], once: true },
		deimos: { label: "Deimos", desc: "Tethers anchored on Deimos, reaching down toward Mars and up beyond.", only: ["Mars"], once: true }
	} },
	elevator: { label: "Space Elevator", menu: false, vars: {
		standard: { label: "Standard", desc: "Surface to beyond stationary orbit, with a counterweight.", once: true },
		l1: { label: "Through L1", desc: "From the near side through Earth–Moon L1; Earth's pull holds the far end as its counterweight.", only: ["Moon"], once: true },
		l2: { label: "Through L2", desc: "From the far side through Earth–Moon L2; the Earth–Moon system's rotation holds the far end out as its counterweight.", only: ["Moon"], once: true }
	} },
	driver: { label: "Kinetic Launcher", vars: {
		surface: { label: "Mass driver", group: "On the surface", desc: "Linear track on the ground." },
		spin: { label: "Spin launcher", group: "On the surface", desc: "Rotating arm anchored in the ground." },
		elevator: { label: "On space elevator", full: "Mass driver on space elevator", desc: "Track mounted high on the elevator.", needs: "elevator" },
		tip: { label: "On skyhook", full: "Mass driver on skyhook", desc: "Track high on a skyhook.", needs: "skyhook" }
	} }
};
export const FAMILY_ORDER = ["skyhook", "elevator", "driver"];

// Feasibility marks, keyed "Body|family".
//   "*": special forms exist there — `allow` lists them, and the mark's card
//       offers them. Ordinary variants are blocked unless `open` is true.
//   "x": cannot be built there with this world's technology.
// `head`: the card's heading for an asterisk (default "Possible, in a special form").
export const MARKS = {
	"Moon|elevator": { k: "*", allow: ["l1", "l2"], title: "No standard elevator at the Moon",
		text: "The Moon turns once every 27.3 days, so its stationary orbit would lie about 88,000 km from its centre, farther out than both Earth–Moon Lagrange points: L1 about 58,000 km from the Moon on the Earth side, and L2 about 64,500 km on the far side. A standard elevator has nothing to hang from. The working equivalents pass through one of those points. Through L1 from the near side, Earth's pull on the far end acts as its counterweight; through L2 from the far side, the rotation of the Earth–Moon system does." },
	"Mars|skyhook": { k: "*", open: true, allow: ["phobos", "deimos"], title: "Mars's moons can anchor skyhooks",
		head: "Also possible, anchored on a moon",
		text: "Phobos orbits about 9,400 km from Mars's centre and Deimos about 23,500 km, so either can anchor a skyhook, alongside the ordinary Hanging and Rotating forms. The two tethers share the space around the moons, so each has limits. Phobos's tether can't reach higher than Deimos's orbit, and Deimos's can't reach lower than Phobos's. The ends of the two tethers can't overlap either, or they would eventually hit each other." },
	"Mars|elevator": { k: "x", title: "No space elevator at Mars",
		text: "Phobos orbits below stationary altitude and Deimos just above it, so both cross the cable's line. Phobos would pass the cable about every 11 hours." },
	"Venus|elevator": { k: "x", title: "No space elevator at Venus",
		text: "Venus turns once every 243 days. Its stationary orbit would be about 1.5 million km out, beyond its Hill sphere (about 1 million km), so there is no orbit for a cable to reach." },
	"Mercury|elevator": { k: "x", title: "No space elevator at Mercury",
		text: "Mercury turns once every 58.6 days. Its stationary orbit would be about 243,000 km out, beyond its Hill sphere (about 220,000 km), so there is no orbit for a cable to reach." },
	"Callisto|elevator": { k: "x", title: "No space elevator at Callisto",
		text: "Callisto keeps one face to Jupiter and turns once every 16.7 days. Its stationary orbit would be about 72,000 km from its centre, beyond its Hill sphere (about 50,000 km), so there is no orbit for a cable to reach." },
	"Titan|elevator": { k: "x", title: "No space elevator at Titan",
		text: "Titan keeps one face to Saturn and turns once every 15.9 days. Its stationary orbit would be about 76,000 km from its centre, beyond its Hill sphere (about 52,000 km), so there is no orbit for a cable to reach." }
};

// The hover hint for a mark's button: its title, then what clicking does.
// An asterisk's card offers the variants in `allow`; a × card only explains.
export function markHint(key) {
	var m = MARKS[key];
	if (!m) return "";
	if (m.k === "x") return m.title + ". Click for why.";
	var fam = FAMILIES[key.split("|")[1]];
	var names = m.allow.map(function (v) { return fam.vars[v].label; });
	return m.title + ". Click to choose " + names.join(" or ") + ".";
}

// True when `v` of `fam` is offered only through some asterisk's card, so the
// family's menu and plain "+ add" leave it out.
export function isSpecial(fam, v) {
	return Object.keys(MARKS).some(function (k) {
		return k.split("|")[1] === fam && (MARKS[k].allow || []).indexOf(v) >= 0;
	});
}

// Workbench tabs, in the order a user works through them.
export const TABS = [
	{ id: "arch", label: "Architecture" },
	{ id: "log", label: "Logistics" },
	{ id: "eng", label: "Engineering" },
	{ id: "eco", label: "Economy" }
];

// The calculator an installation has: a key in home.js's CALCULATORS, or null
// when it has none yet (the workbench then shows skeleton cards on every tab).
// One calculator serves all four tabs; its cards say which tab they're on.
export function calcFor(inst) {
	if (!inst) return null;
	if (inst.fam === "skyhook" && inst.v === "hanging") return "hanging-skyhook";
	if (inst.fam === "skyhook" && inst.v === "phobos") return "phobos-skyhook";
	if (inst.fam === "elevator" && inst.v === "standard") return "space-elevator";
	if (inst.fam === "elevator" && inst.v === "l1") return "moon-l1-elevator";
	return null;
}

// The support-ship roles an installation needs (Shared/ships.js SHIP_ROLES),
// each shown as a card on its Logistics tab. A first framework, to be refined
// facility by facility:
//   surface launchers (mass driver, spin launcher) launch shuttles;
//   launchers on an elevator or a skyhook, and elevators and skyhooks
//   themselves, hand freighters on;
//   the Moon's L1 elevator, and a skyhook at a body with an atmosphere or one
//   whose cargo can enter its parent planet's (the Moon's, at Earth), also
//   need capsules.
export function shipRolesFor(inst, body) {
	if (!inst) return [];
	if (inst.fam === "driver") return inst.v === "elevator" || inst.v === "tip" ? ["freighter"] : ["shuttle"];
	if (inst.fam === "elevator") return inst.v === "l1" ? ["freighter", "capsule"] : ["freighter"];
	if (inst.fam === "skyhook") {
		var s = systems.get(body);
		return (s && s.atmosphere) || applies("parentEntry", body) ? ["freighter", "capsule"] : ["freighter"];
	}
	return [];
}

// Short display name for an installation, e.g. "Hanging skyhook".
export function instLabel(inst) {
	if (inst.fam === "elevator" && inst.v !== "standard") return inst.v.toUpperCase() + " elevator";
	var fam = FAMILIES[inst.fam], def = fam.vars[inst.v];
	if (inst.fam === "driver") return def.full || def.label;
	return def.label + " " + fam.label.toLowerCase();
}

export function findBody(design, name) {
	return design.bodies.find(function (b) { return b.body === name; }) || null;
}

// Why `variant` of `fam` can't be added at `body` in `design`, or null if it can.
export function variantBlock(design, body, fam, v) {
	var def = FAMILIES[fam].vars[v];
	if (def.only && def.only.indexOf(body) < 0) return "Only at " + def.only.join(", ") + ".";
	var m = MARKS[body + "|" + fam];
	if (m && !m.open && (m.allow || []).indexOf(v) < 0) return m.k === "x" ? m.title + "." : "Only in a special form here; click the * in the table.";
	var rec = findBody(design, body);
	if (def.once && rec && rec.inst.some(function (i) { return i.fam === fam && i.v === v; })) return "Already added.";
	if (def.needs) {
		var has = rec && rec.inst.some(function (i) { return i.fam === def.needs; });
		if (!has) return "Needs a " + FAMILIES[def.needs].label.toLowerCase() + " at " + body + " first.";
	}
	return null;
}

var seq = 0;
export function newId() {
	seq++;
	return "i" + seq.toString(36) + Math.floor(Math.random() * 46656).toString(36);
}

// The example a first-time visitor opens on.
export function sampleDesign() {
	function I(fam, v) { return { id: newId(), fam: fam, v: v }; }
	return { kind: DESIGN_KIND, version: DESIGN_VERSION, name: "Example design", savedAt: null, bodies: [
		{ body: "Moon", inst: [I("skyhook", "hanging"), I("elevator", "l1"), I("driver", "surface")] },
		{ body: "Earth", inst: [I("skyhook", "hanging")] },
		{ body: "Mars", inst: [I("skyhook", "hanging"), I("skyhook", "phobos"), I("driver", "surface")] },
		{ body: "Ceres", inst: [I("elevator", "standard"), I("driver", "elevator")] },
		{ body: "Psyche", inst: [I("driver", "surface")] }
	] };
}

// Add a body at the end of the list; bodies stay in the order the user added
// them. Returns the new design; the input is not changed.
export function addBody(design, name) {
	if (findBody(design, name) || BODY_ORDER.indexOf(name) < 0) return design;
	return Object.assign({}, design, { bodies: design.bodies.concat([{ body: name, inst: [] }]) });
}

export function removeBody(design, name) {
	return Object.assign({}, design, { bodies: design.bodies.filter(function (b) { return b.body !== name; }) });
}

// Add an installation. Returns { design, inst } or { design, error } when blocked.
export function addInstallation(design, body, fam, v) {
	var why = findBody(design, body) ? variantBlock(design, body, fam, v) : "Add " + body + " first.";
	if (why) return { design: design, error: why };
	var inst = { id: newId(), fam: fam, v: v };
	var bodies = design.bodies.map(function (b) {
		return b.body === body ? { body: b.body, inst: b.inst.concat([inst]) } : b;
	});
	return { design: Object.assign({}, design, { bodies: bodies }), inst: inst };
}

// Remove an installation, and anything at that body that sat on it
// (a mass driver on a space elevator goes with the last elevator).
export function removeInstallation(design, body, id) {
	var bodies = design.bodies.map(function (b) {
		if (b.body !== body) return b;
		var left = b.inst.filter(function (i) { return i.id !== id; });
		left = left.filter(function (i) {
			var needs = FAMILIES[i.fam].vars[i.v].needs;
			return !needs || left.some(function (j) { return j.fam === needs; });
		});
		return { body: b.body, inst: left };
	});
	return Object.assign({}, design, { bodies: bodies });
}

// Read a design from parsed JSON. Throws an Error with a readable message
// when the data isn't a design this version understands. Unknown bodies,
// families and variants are dropped rather than refused.
export function parseDesign(obj) {
	if (!obj || obj.kind !== DESIGN_KIND) throw new Error("This isn't a Moonwards design file.");
	if (obj.version !== DESIGN_VERSION) throw new Error("This design was saved by a different version of the workbench (version " + obj.version + ").");
	if (!Array.isArray(obj.bodies)) throw new Error("The design has no list of bodies.");
	var seen = {};
	var bodies = obj.bodies.filter(function (b) {
		if (!b || BODY_ORDER.indexOf(b.body) < 0 || seen[b.body]) return false;
		seen[b.body] = true;
		return true;
	}).map(function (b) {
		return { body: b.body, inst: (Array.isArray(b.inst) ? b.inst : []).filter(function (i) {
			return i && FAMILIES[i.fam] && FAMILIES[i.fam].vars[i.v];
		}).map(function (i) {
			var out = { id: typeof i.id === "string" ? i.id : newId(), fam: i.fam, v: i.v };
			if (i.state && typeof i.state === "object") out.state = i.state;
			return out;
		}) };
	});
	var s = obj.selected && typeof obj.selected === "object" ? obj.selected : null;
	return {
		kind: DESIGN_KIND, version: DESIGN_VERSION,
		name: typeof obj.name === "string" ? obj.name : "Imported design",
		savedAt: typeof obj.savedAt === "string" ? obj.savedAt : null,
		bodies: bodies,
		ships: obj.ships && typeof obj.ships === "object" ? obj.ships : null,
		selected: s ? { body: s.body, inst: s.inst, tab: s.tab } : null
	};
}

// The JSON text for Save and Export, with the current view stored alongside.
export function serializeDesign(design, selected) {
	var out = {
		kind: DESIGN_KIND, version: DESIGN_VERSION, name: design.name, savedAt: design.savedAt,
		bodies: design.bodies, ships: design.ships || null, selected: selected || null
	};
	return JSON.stringify(out, null, 1);
}
