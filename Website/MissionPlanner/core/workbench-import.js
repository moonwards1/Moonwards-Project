/* MissionPlanner/core/workbench-import — a technology card's settings taken
 * from the design saved on the home page's workbench.
 *
 * The workbench keeps its design in the browser under WORKBENCH_STORE_KEY
 * (Home/home.js's Save design), in the format Home/design-model.js reads and
 * writes. Each installation there carries its calculator's settings as
 * CalcShell.getState() returned them: `state.fields`, keyed
 * "<card id>/<field key>", values as the field shows them (km, as strings).
 * Those keys are the interface this file reads, so a calculator that renames
 * one of these fields breaks the import here, not silently elsewhere.
 *
 * Which installation fills which card, and how:
 *
 *   skyhook (release)   the body's hanging skyhooks, and at Mars the Phobos
 *                       skyhook. comAlt is the centre of mass (for Phobos, the
 *                       moon's own orbit, Shared/body-profiles.js anchorConfig);
 *                       relAlt is the release deck when it is ticked, the top
 *                       otherwise.
 *   skyhook (catch)     the same installations; relAlt (the catch altitude) is
 *                       the top.
 *   l1-elevator,        the Moon's elevator through that point. cwAlt is the
 *   l2-elevator         counterweight's distance from the Moon's centre less
 *                       the Moon's radius; relAlt is the counterweight, where
 *                       the workbench's "Orbit after release" lets go.
 *
 * The release or catch phase is never imported: it aims the mission, and the
 * workbench has no mission to aim.
 *
 * An installation whose settings were never saved (its calculator not opened
 * before Save design) has nothing to import and is skipped.
 *
 * Pure: takes the stored text, returns plain data. Node-tested.
 */

import { parseDesign, instLabel } from "../../Home/design-model.js";
import { anchorConfig } from "../../Shared/body-profiles.js";
import { systems } from "../../Shared/orbit.js";

export var WORKBENCH_STORE_KEY = "mw-design";

// The workbench calculators' field keys this file reads.
var KEY = {
	top: "geo/Top altitude",
	centre: "geo/Centre of mass altitude",
	releaseUsed: "st/Release deck used",
	release: "st/Release deck",
	counterweight: "cw/Counterweight distance"
};

// Which workbench installations can fill a platform's card: [fam, variant]
// pairs, keyed by platform id (modules/platform/platform-spec.js `id`).
var SOURCES = {
	"skyhook": [["skyhook", "hanging"], ["skyhook", "phobos"]],
	"l1-elevator": [["elevator", "l1"]],
	"l2-elevator": [["elevator", "l2"]]
};

// True when the workbench has something that can fill this platform's card.
export function importsFromWorkbench(platformId) { return !!SOURCES[platformId]; }

// The saved design, or null when there is none or it doesn't read.
export function readWorkbenchDesign(text) {
	if (typeof text !== "string" || text === "") { return null; }
	try { return parseDesign(JSON.parse(text)); } catch (e) { return null; }
}

function field(inst, key) {
	var f = inst.state && inst.state.fields;
	if (!f || typeof f[key] !== "string" || f[key].trim() === "") { return NaN; }
	return parseFloat(f[key]);
}

// "at the Moon", "at Mars".
function at(body) { return "at " + (body === "Moon" ? "the Moon" : body); }

function km(x) { return Math.round(x).toLocaleString("en-US") + " km"; }

// One installation's settings as a card's params (SI), or null when they
// don't read. `detail` says in words what will be set.
function paramsFrom(platformId, inst, role) {
	if (platformId === "skyhook") {
		var top = field(inst, KEY.top);
		var centre = inst.v === "phobos" ? anchorConfig("Phobos").centre : field(inst, KEY.centre);
		var deck = field(inst, KEY.release);
		var useDeck = role !== "catch" && inst.state.fields[KEY.releaseUsed] === "1" && deck > 0;
		var rel = useDeck ? deck : top;
		if (!(centre > 0 && rel > 0)) { return null; }
		return {
			params: { comAlt: centre * 1e3, relAlt: rel * 1e3 },
			detail: "centre of mass " + km(centre) + ", " + (role === "catch" ? "catch" : "release") +
				" altitude " + km(rel) + (useDeck ? " (release deck)" : " (top)")
		};
	}
	if (platformId === "l1-elevator" || platformId === "l2-elevator") {
		var dist = field(inst, KEY.counterweight);
		if (!(dist > 0)) { return null; }
		var cwAlt = dist * 1e3 - Number(systems.get("Moon").radius);
		return {
			params: { cwAlt: cwAlt, relAlt: cwAlt },
			detail: "counterweight " + km(dist) + " from the Moon's centre (" + km(cwAlt / 1e3) +
				" up), release at the counterweight"
		};
	}
	return null;
}

// What the workbench offers a card: { configs, why }.
//   configs  [{ instId, label, detail, params }] — one per installation with
//            saved settings, in the design's order. `params` is a partial
//            param set to merge over the stage's.
//   why      when configs is empty, the reason in words, for the greyed button.
// `design` is readWorkbenchDesign's result; `role` is "release" or "catch".
export function workbenchConfigs(design, platformId, role, body) {
	var pairs = SOURCES[platformId];
	if (!pairs) { return { configs: [], why: "The workbench has no calculator for this technology." }; }
	if (!design) { return { configs: [], why: "No design is saved on the home page's workbench." }; }
	var rec = design.bodies.find(function (b) { return b.body === body; });
	var insts = rec ? rec.inst.filter(function (i) {
		return pairs.some(function (p) { return p[0] === i.fam && p[1] === i.v; });
	}) : [];
	if (!insts.length) {
		return { configs: [], why: "The design saved on the workbench has no " +
			(pairs[0][0] === "skyhook" ? "skyhook" : instLabel({ fam: pairs[0][0], v: pairs[0][1] })) +
			" " + at(body) + "." };
	}
	// Number repeated names so two hanging skyhooks at one body read apart.
	var count = {};
	insts.forEach(function (i) { var l = instLabel(i); count[l] = (count[l] || 0) + 1; });
	var seen = {};
	var configs = [];
	insts.forEach(function (i) {
		var l = instLabel(i);
		seen[l] = (seen[l] || 0) + 1;
		var p = i.state ? paramsFrom(platformId, i, role) : null;
		if (!p) { return; }
		configs.push({ instId: i.id, label: count[l] > 1 ? l + " " + seen[l] : l, detail: p.detail, params: p.params });
	});
	return { configs: configs, why: configs.length ? null
		: "The workbench has this " + at(body) + ", but its settings aren't saved: open it there, then Save design." };
}
