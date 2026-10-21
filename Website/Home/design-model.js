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
//     selected: { body, inst, tab }          // optional; restores the view
//   }
// `fam` is an infrastructure family (FAMILIES key), `v` one of its variants.
// `state`, when present, is the installation's calculator settings as that
// calculator's getState() returned them (CalcShell.getState).

export const DESIGN_KIND = "moonwards-design";
export const DESIGN_VERSION = 1;

// Bodies offered in the Body menu, in order out from the Sun (a moon follows
// its planet). A design lists its bodies in the order the user added them.
export const BODY_ORDER = ["Mercury", "Venus", "Earth", "Moon", "Mars", "Vesta", "Ceres", "Psyche"];

// The three families of giant infrastructure, each with its variants.
// `only`: the variant exists only at these bodies.
// `needs`: the variant sits on another family's installation at the same body.
export const FAMILIES = {
	skyhook: { label: "Skyhook", vars: {
		hanging: { label: "Hanging", desc: "Non-rotating tether hanging from orbit, its foot just above the surface." },
		rotating: { label: "Rotating", desc: "Spinning tether that catches and releases at its tips." },
		phobos: { label: "Phobos", desc: "Tethers anchored on Phobos, reaching down toward Mars and up beyond.", only: ["Mars"] }
	} },
	elevator: { label: "Space Elevator", vars: {
		standard: { label: "Standard", desc: "Surface to beyond stationary orbit, with a counterweight." },
		l1: { label: "Through L1", desc: "From the near side through Earth–Moon L1; Earth's pull holds the far end as its counterweight.", only: ["Moon"] }
	} },
	driver: { label: "Mass Driver", vars: {
		surface: { label: "Surface", desc: "Linear track on the ground." },
		elevator: { label: "On space elevator", desc: "Track mounted high on the elevator cable.", needs: "elevator" },
		tip: { label: "Skyhook tip", desc: "Short track at a skyhook's tip.", needs: "skyhook" },
		spin: { label: "Spin launcher", desc: "Rotating arm on the surface." }
	} }
};
export const FAMILY_ORDER = ["skyhook", "elevator", "driver"];

// Feasibility marks, keyed "Body|family".
//   "*": buildable only in a special form — `allow` lists the variants that work.
//   "x": cannot be built there with this world's technology.
export const MARKS = {
	"Moon|elevator": { k: "*", allow: ["l1"], title: "No standard elevator at the Moon",
		text: "The Moon turns once every 27.3 days, so its stationary orbit would lie about 88,000 km from its centre, beyond the Earth–Moon L1 point about 58,000 km out. A standard elevator has nothing to hang from. The working equivalent runs through L1 and uses Earth's pull on the far end as its counterweight. Choose “Through L1” from the Space Elevator menu." },
	"Mars|elevator": { k: "x", title: "No space elevator at Mars",
		text: "Phobos orbits below stationary altitude and Deimos just above it, so both cross the cable's line. Phobos would pass the cable about every 11 hours." },
	"Venus|elevator": { k: "x", title: "No space elevator at Venus",
		text: "Venus turns once every 243 days. Its stationary orbit would be about 1.5 million km out, beyond its Hill sphere (about 1 million km), so there is no orbit for a cable to reach." },
	"Mercury|elevator": { k: "x", title: "No space elevator at Mercury",
		text: "Mercury turns once every 58.6 days. Its stationary orbit would be about 243,000 km out, beyond its Hill sphere (about 220,000 km), so there is no orbit for a cable to reach." }
};

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
	return null;
}

// Short display name for an installation, e.g. "Hanging skyhook".
export function instLabel(inst) {
	if (inst.fam === "elevator" && inst.v === "l1") return "L1 elevator";
	var fam = FAMILIES[inst.fam];
	return fam.vars[inst.v].label + " " + fam.label.toLowerCase();
}

export function findBody(design, name) {
	return design.bodies.find(function (b) { return b.body === name; }) || null;
}

// Why `variant` of `fam` can't be added at `body` in `design`, or null if it can.
export function variantBlock(design, body, fam, v) {
	var def = FAMILIES[fam].vars[v];
	if (def.only && def.only.indexOf(body) < 0) return "Only at " + def.only.join(", ") + ".";
	var m = MARKS[body + "|" + fam];
	if (m && (m.allow || []).indexOf(v) < 0) return m.k === "x" ? m.title + "." : "Not here; see the * note.";
	if (def.needs) {
		var rec = findBody(design, body);
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
		selected: s ? { body: s.body, inst: s.inst, tab: s.tab } : null
	};
}

// The JSON text for Save and Export, with the current view stored alongside.
export function serializeDesign(design, selected) {
	var out = {
		kind: DESIGN_KIND, version: DESIGN_VERSION, name: design.name, savedAt: design.savedAt,
		bodies: design.bodies, selected: selected || null
	};
	return JSON.stringify(out, null, 1);
}
