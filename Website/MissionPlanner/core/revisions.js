/* MissionPlanner/core/revisions — a mission's plan history.
 *
 * A mission has exactly one ORIGINAL: the plan as core/freeze.js wrote it when
 * the mission was created from the Ephemeris tab. Every later commit — the
 * mission bar's Update, and eventually the Finished control — appends a STEP.
 * Each entry is a whole serialized World, not a diff, because a World already
 * is the complete description of a mission (clock + ordered stages + params):
 * there is no smaller thing that would let the plan be reconstructed, and no
 * larger one worth keeping.
 *
 * TWO SCOPES, DELIBERATELY DIFFERENT SIZES:
 *
 *   - LOCALLY, the whole run of steps is kept, so the mission report can show
 *     what each Update bought as a column of numbers.
 *   - IN A LINK, only two sets travel: `original`, and the LATEST step if
 *     there is one. Intermediate steps are this user's working record and
 *     nobody else's, and a link has a hard size budget (a Discord message cuts
 *     off at 2,000 characters), so they are dropped at the door by packSets.
 *
 * Marking a mission finished COMPACTS: original + the finished set, the
 * intermediate steps discarded. That is the same shape a link carries, which
 * is the point — a finished mission is one whose local record and its shared
 * record have converged.
 *
 * Pure: plain data in, plain data out, no DOM. Every function returns a NEW
 * history rather than mutating, so a caller can hold an old one safely.
 */

export var PLAN_STATES = ["updated", "finished"];

// A fresh history for a mission just frozen. `worldData` is a serialized World
// (world.serialize()); it is stored as given and never inspected here —
// validity is core/world.js's deserializeWorld's job, and an unloadable
// original is still worth keeping rather than silently dropping.
export function createHistory(worldData) {
	return { original: worldData, steps: [] };
}

function isPlainObject(v) {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

// A step appended for the mission bar's Update. A history that has already
// been marked finished re-opens: editing after finishing is allowed, and the
// steps that follow simply accumulate again after the finished one.
export function recordUpdate(history, worldData) {
	if (!history) { return createHistory(worldData); }
	return {
		original: history.original,
		steps: history.steps.concat([{ state: "updated", world: worldData }])
	};
}

// The Finished commit: the run of intermediate updates collapses, leaving the
// original and the finished plan — "the file cleared of the steps between".
// Not reversible, so the caller confirms first.
export function markFinished(history, worldData) {
	var base = history || createHistory(worldData);
	return {
		original: base.original,
		steps: [{ state: "finished", world: worldData }]
	};
}

// The last commit, or null when the mission has only ever been frozen.
export function latestOf(history) {
	if (!history || !history.steps.length) { return null; }
	return history.steps[history.steps.length - 1];
}

// "original" | "updated" | "finished" — what a report line calls the second
// column, and what the paste side reads to decide whether a tab is spawned.
export function stateOf(history) {
	var last = latestOf(history);
	return last ? last.state : "original";
}

export function isFinished(history) {
	return stateOf(history) === "finished";
}

// The two sets a mission link carries. `latest` is null for a mission that has
// never been updated — the link then holds the original alone, which is
// exactly what a pre-history link held.
export function packSets(history) {
	if (!history || !isPlainObject(history.original)) { return null; }
	var last = latestOf(history);
	return {
		original: history.original,
		latest: last ? { state: last.state, world: last.world } : null
	};
}

// The inverse, for a link or a localStorage entry: anything malformed yields
// null rather than throwing, so a corrupt record costs the history and not the
// mission. A `latest` whose state isn't one this build knows is kept and read
// as "updated" — an unfamiliar label is still a later plan, and refusing it
// would lose the set for no gain.
export function readSets(raw) {
	if (!isPlainObject(raw) || !isPlainObject(raw.original)) { return null; }
	var out = createHistory(raw.original);
	var l = raw.latest;
	if (isPlainObject(l) && isPlainObject(l.world)) {
		out.steps = [{ state: PLAN_STATES.indexOf(l.state) >= 0 ? l.state : "updated", world: l.world }];
	}
	return out;
}

// A stored local history (createHistory's shape, with the full run of steps),
// normalized. Same forgiving contract as readSets.
export function readHistory(raw) {
	if (!isPlainObject(raw) || !isPlainObject(raw.original)) { return null; }
	var out = createHistory(raw.original);
	if (Array.isArray(raw.steps)) {
		out.steps = raw.steps.filter(function (s) {
			return isPlainObject(s) && isPlainObject(s.world);
		}).map(function (s) {
			return { state: PLAN_STATES.indexOf(s.state) >= 0 ? s.state : "updated", world: s.world };
		});
	}
	return out;
}

// Every set in order, labelled for display: the original first, then each
// commit. What the mission report's rows are built from.
export function entriesOf(history) {
	if (!history) { return []; }
	return [{ state: "original", world: history.original }].concat(history.steps);
}

// ---- what a plan STORED, for the mission report's originals column ---------
//
// The report's existing table is FLIGHT figures — what the mission achieves,
// recomputed live. This is the other half: the values a plan actually holds,
// read straight off a serialized World with no physics involved, so the
// original's row costs nothing to produce however long ago it was frozen.
//
// Deliberately only stored values. Anything derived (the required v-infinity,
// the closest approach, the delivered hand-off) belongs to the live flight and
// has no meaning frozen in a saved plan — see core/delivered-flight.js.
//
// `rows` is display-ordered; each { key, label, value, unit }, with `value`
// null where a plan has no such stage. Comparing two summaries is a plain
// key-by-key walk (changesBetween below), so a stage this build doesn't know
// simply doesn't appear rather than breaking the table.

var LEG_MODULES = ["departure-leg", "body-departure-leg"];

function stageByModule(worldData, moduleId) {
	var stages = (worldData && worldData.stages) || [];
	for (var i = 0; i < stages.length; i++) {
		if (stages[i].moduleId === moduleId) { return stages[i]; }
	}
	return null;
}

function departureLegStage(worldData) {
	var stages = (worldData && worldData.stages) || [];
	for (var i = 0; i < stages.length; i++) {
		if (LEG_MODULES.indexOf(stages[i].moduleId) >= 0) { return stages[i]; }
	}
	return null;
}

function magnitude(v) {
	return Array.isArray(v) ? Math.sqrt(v.reduce(function (s, x) { return s + x * x; }, 0)) : null;
}

function burnTotal(list) {
	if (!Array.isArray(list)) { return null; }
	return list.reduce(function (sum, wp) {
		var b = (wp && wp.burn) || {};
		return sum + Math.hypot(b.pro || 0, b.rad || 0, b.nrm || 0);
	}, 0);
}

// The technology stages: everything that is neither the plan, the legs, nor
// the transfer — i.e. the platforms and carriers a mission was built up from,
// in chain order. Named by moduleId, which is what reconstructs the stack.
var STRUCTURAL = ["frozen-plan", "transfer-leg", "arrival-leg", "departure-leg", "body-departure-leg"];

function techStages(worldData) {
	return ((worldData && worldData.stages) || []).filter(function (s) {
		return s && STRUCTURAL.indexOf(s.moduleId) < 0;
	});
}

function techStack(worldData) {
	var names = techStages(worldData).map(function (s) { return s.moduleId; });
	return names.length ? names.join(" → ") : "none";
}

// "releasePhaseDeg" -> "release phase deg". The technology rows are named from
// param keys, because a platform's dials are its own business and this file
// has no business holding a list of them — a module gains a setting and its
// row appears without anything here changing.
function humanKey(k) {
	return k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

// One row per stored dial on every technology stage, in chain order. Only
// primitives: a param holding a list (a tech's own waypoints, say) reports its
// length instead, and anything deeper is left out — a report row has to be one
// comparable value, and a nested object isn't one.
function techRows(worldData) {
	var rows = [];
	// Keyed by module and by which occurrence of that module it is — NOT by
	// position in the chain. A mission can carry two of the same carrier, so
	// the module id alone won't do; but a position would shift every row below
	// an insertion, and a technology added at the top would report every other
	// technology's dials as changed.
	var nth = {};
	techStages(worldData).forEach(function (stage) {
		var n = nth[stage.moduleId] = (nth[stage.moduleId] || 0) + 1;
		var suffix = n > 1 ? " #" + n : "";
		var params = stage.params || {};
		Object.keys(params).sort().forEach(function (k) {
			var v = params[k];
			var unit = "";
			if (Array.isArray(v)) { v = v.length; }
			else if (v !== null && typeof v === "object") { return; }
			else if (typeof v === "boolean") { v = v ? "yes" : "no"; }
			else if (v === undefined) { v = null; }
			rows.push({
				key: "tech:" + stage.moduleId + "#" + n + "." + k,
				label: stage.moduleId + suffix + " · " + humanKey(k),
				value: v,
				unit: unit
			});
		});
	});
	return rows;
}

export function planSummaryOf(worldData) {
	var fp = stageByModule(worldData, "frozen-plan");
	var leg = stageByModule(worldData, "transfer-leg");
	var dep = departureLegStage(worldData);
	var p = (fp && fp.params) || {};
	var lp = (leg && leg.params) || {};
	var dp = (dep && dep.params) || {};
	var arrival = p.arrival || {};
	var departure = p.departure || {};

	return {
		rows: [
			{ key: "origin",      label: "Origin",             value: p.origin || null,           unit: "" },
			{ key: "destination", label: "Destination",        value: arrival.body || null,       unit: "" },
			{ key: "releaseJd",   label: "Release",            value: isFinite(dp.releaseJd) ? dp.releaseJd : null, unit: "jd" },
			{ key: "handoffJd",   label: "Hand-off epoch",     value: isFinite(departure.jd) ? departure.jd : null, unit: "jd" },
			{ key: "handoffV",    label: "Hand-off speed",     value: magnitude(departure.v),     unit: "m/s" },
			{ key: "windowDays",  label: "Hand-off window",    value: isFinite(p.handoffWindowDays) ? p.handoffWindowDays : null, unit: "d" },
			{ key: "arrivalVInf", label: "Arrival v∞ required", value: isFinite(arrival.vInf) ? arrival.vInf : null, unit: "m/s" },
			{ key: "legDays",     label: "Coast horizon",      value: isFinite(lp.legDays) ? lp.legDays : null, unit: "d" },
			{ key: "planWps",     label: "Plan waypoints",     value: Array.isArray(p.waypoints) ? p.waypoints.length : null, unit: "" },
			{ key: "planDv",      label: "Plan waypoint Δv",   value: burnTotal(p.waypoints),     unit: "m/s" },
			{ key: "coastWps",    label: "Coast waypoints",    value: Array.isArray(lp.waypoints) ? lp.waypoints.length : null, unit: "" },
			{ key: "coastDv",     label: "Coast waypoint Δv",  value: burnTotal(lp.waypoints),    unit: "m/s" },
			{ key: "tech",        label: "Technology",         value: techStack(worldData),       unit: "" }
		].concat(techRows(worldData))
	};
}

// Two summaries, merged BY KEY — not by position. The technology rows are
// generated from whatever params a stage happens to carry, so the two sides
// can hold different rows: a dial that only one of them has still has to
// appear, reading null on the side that lacks it. Walking by index would
// silently compare unrelated rows the moment a technology was added.
//
// Numbers compare with a relative tolerance, so a round trip through JSON is
// never reported as an edit.
export function changesBetween(beforeData, afterData) {
	var a = planSummaryOf(beforeData).rows;
	var b = planSummaryOf(afterData).rows;
	var byKey = {};
	b.forEach(function (row) { byKey[row.key] = row; });

	var out = a.map(function (row) {
		var other = byKey[row.key];
		return compareRow(row, row.value, other ? other.value : null);
	});
	// Rows only the AFTER side has — a technology's dials, once it is added.
	var seen = {};
	a.forEach(function (row) { seen[row.key] = true; });
	b.forEach(function (row) {
		if (!seen[row.key]) { out.push(compareRow(row, null, row.value)); }
	});
	return out;
}

function compareRow(row, was, now) {
	var changed;
	if (typeof was === "number" && typeof now === "number") {
		changed = Math.abs(was - now) > 1e-9 * Math.max(1, Math.abs(was), Math.abs(now));
	} else {
		changed = was !== now;
	}
	return { key: row.key, label: row.label, unit: row.unit, was: was, now: now, changed: changed };
}
