// World — the single source of truth for a mission. ES module:
//   import { createWorld, deserializeWorld } from "./world.js";
// Pure (no DOM, no Three.js), imports directly in Node for unit testing.
//
// See Website/ARCHITECTURE.md, "The three layers" > "World". One plain,
// serializable object holding everything that *defines* the mission:
//
//   - `jd` — the ephemeris date, one clock shared by every view,
//   - the mission profile: an ordered list of stages, each
//     { id, moduleId, params } — `id` is a stable per-stage id ("stg-1",
//     "stg-2", ...) that is never an array index and is never reused, even
//     after deletions; `params` is that stage's module-owned plain data.
//
// Everything else (packets, diagnostics, camera poses, pane layout) is
// derived or workspace state and lives elsewhere. Decisions baked in, per
// the architecture doc:
//
//   - ONE CHOKE POINT. Every mutation goes through `world.set(change)`.
//     Undo/redo and share links can hang off that door later without rework.
//     Continuous gestures pass `{ transient: true }` so a future undo can
//     coalesce them; listeners still fire on every set.
//   - VERSIONED SERIALIZATION. `serialize()` stamps a schema version;
//     `deserializeWorld()` refuses (politely, { ok:false, reason }) versions
//     newer than it understands, like PacketTypes.validate does.
//   - ALWAYS STORABLE. A World may describe a physically infeasible mission
//     — even an unknown moduleId round-trips through save/load untouched.
//     Feasibility is the recompute engine's diagnostic, not a data-layer
//     validity condition.
//
// The `change` record `set()` takes is one of:
//
//   { jd: <number> }                                — move the clock
//   { stage: <id>, params: { ... } }                — merge partial params
//   { addStage: { moduleId, params }, before: <id|null> }  — insert (null /
//                                                     omitted = append);
//                                                     returns the new id
//   { removeStage: <id> }
//   { moveStage: <id>, before: <id|null> }          — reorder (null = end)
//   { swapStage: <id>, moduleId, params }           — swap the module in a
//                                                     stage, id preserved
//
// `set()` throws on a malformed change or unknown stage id — that is an
// authoring error, so failing loud beats a silent no-op. After applying, it
// notifies `onChange` listeners with { change, index, id, transient }, where
// `index` is the earliest chain position the change can affect (0 for jd,
// since the clock feeds every stage) — exactly what the recompute engine
// needs to know where "dirty" starts.
//
// `lock()`/`unlock()` exist for the engine: while locked, `set()` throws
// immediately (before mutating), which is how "modules never mutate World
// from inside update()" is enforced rather than merely documented.

export const WORLD_KIND = "moonwards-world";
export const WORLD_VERSION = 3;

// ---- saved-mission migrations ----------------------------------------------
// Version 2 (task I3, WP-I): the departure system became a CARRIER CHAIN —
// profiles that used to read [lunar-skyhook → …] now read [moon-platform →
// lunar-skyhook → departure-leg → …] (the skyhook stopped emitting a
// ship-state and emits a carrier-chain rotor instead; the new headless
// departure-leg integrates the released flight and emits the hand-off). A v1
// save's profile therefore no longer type-checks stage-to-stage without the
// two new stages, so migration inserts them around each lunar-skyhook:
// moon-platform immediately before, departure-leg immediately after, with
// fresh never-used ids. Everything else — including the skyhook's legacy
// releaseJd param, which the release-anchor lookup keeps honouring as a
// last-resort fallback (frozen-plan.js's releaseAnchorFor) — passes through
// untouched, per the always-storable rule.
//
// This is the one place core code knows module ids by name; it is DATA
// migration (a save-format fact), not registry validation — deserializeWorld
// still never checks moduleIds for existence.
function migrateV1toV2(saved) {
	var out = structuredClone(saved);
	out.version = 2;
	if (!Array.isArray(out.stages)) { return out; }   // malformed; validation below rejects it

	var maxNum = 0;
	out.stages.forEach(function (s) {
		var m = s && typeof s.id === "string" ? /^stg-(\d+)$/.exec(s.id) : null;
		if (m) { maxNum = Math.max(maxNum, parseInt(m[1], 10)); }
	});
	var next = Math.max(maxNum + 1, typeof out.nextStage === "number" ? out.nextStage : 1);

	var stages = [];
	out.stages.forEach(function (s) {
		if (s && s.moduleId === "lunar-skyhook") {
			stages.push({ id: "stg-" + (next++), moduleId: "moon-platform", params: {} });
			stages.push(s);
			stages.push({ id: "stg-" + (next++), moduleId: "departure-leg", params: { waypoints: [] } });
		} else {
			stages.push(s);
		}
	});
	out.stages = stages;
	out.nextStage = next;
	return out;
}

// Version 3 (2026-07-20): the two skyhook modules were unified into ONE generic
// `orbital-skyhook` that carries its `body` explicitly (the body convention),
// and the Moon-specific `lunar-skyhook` was retired. A v2 save's `lunar-skyhook`
// stage becomes an `orbital-skyhook` stage with body "Moon" added; its
// altitudes / release phase / legacy releaseJd pass through untouched. Same
// place-in-the-list, same stage id — a pure module swap, no stages added or
// removed (contrast the v1→v2 reshape above). Data migration, not registry
// validation: an unknown moduleId still round-trips per the always-storable rule.
function migrateV2toV3(saved) {
	var out = structuredClone(saved);
	out.version = 3;
	if (!Array.isArray(out.stages)) { return out; }
	out.stages.forEach(function (s) {
		if (s && s.moduleId === "lunar-skyhook") {
			s.moduleId = "orbital-skyhook";
			if (!s.params || typeof s.params !== "object") { s.params = {}; }
			if (s.params.body === undefined || s.params.body === null) { s.params.body = "Moon"; }
		}
	});
	return out;
}

export function createWorld(opts) {
	var o = opts || {};
	if (typeof o.jd !== "number" || !isFinite(o.jd)) {
		throw new Error("createWorld: opts.jd must be a finite number (the mission needs a clock)");
	}

	var jd = o.jd;
	var stages = [];                 // [{ id, moduleId, params }]
	var nextStage = 1;               // id counter; never rewinds, so ids are never reused
	var listeners = [];
	var lockReason = null;

	// Used by deserializeWorld to rebuild a saved mission without replaying
	// every mutation. Internal — not part of the module-facing API.
	function restore(saved) {
		jd = saved.jd;
		stages = saved.stages;
		nextStage = saved.nextStage;
	}

	function indexOf(id) {
		for (var i = 0; i < stages.length; i++) {
			if (stages[i].id === id) { return i; }
		}
		return -1;
	}

	function mustIndexOf(id, what) {
		var i = indexOf(id);
		if (i === -1) { throw new Error("world.set: " + what + " — no stage '" + id + "'"); }
		return i;
	}

	// Resolve a `before` value to an insertion index (null/undefined = end).
	function insertionIndex(before) {
		if (before === null || before === undefined) { return stages.length; }
		return mustIndexOf(before, "bad 'before'");
	}

	function notify(info) {
		for (var i = 0; i < listeners.length; i++) { listeners[i](info); }
	}

	var world = {

		get jd() { return jd; },

		// Shallow copy of the profile, in chain order. The stage records are
		// the live objects — read them, don't write them; writes go through
		// set().
		stages: function () { return stages.slice(); },

		getStage: function (id) {
			var i = indexOf(id);
			return i === -1 ? null : stages[i];
		},

		indexOf: indexOf,

		// The one choke point. Applies `change`, then notifies listeners.
		// Returns the new stage's id for addStage, undefined otherwise.
		// `opts.transient` marks a mid-gesture set (see header comment).
		set: function (change, setOpts) {
			if (lockReason !== null) {
				throw new Error("world.set: World is locked (" + lockReason + ")" +
					" — modules must not call world.set() from inside update()");
			}
			if (!change || typeof change !== "object") {
				throw new Error("world.set: change must be an object");
			}
			var transient = !!(setOpts && setOpts.transient);
			var index, id, i, j, stage;

			if (change.jd !== undefined) {
				if (typeof change.jd !== "number" || !isFinite(change.jd)) {
					throw new Error("world.set: jd must be a finite number");
				}
				jd = change.jd;
				index = 0; id = null;

			} else if (change.stage !== undefined) {
				i = mustIndexOf(change.stage, "bad 'stage'");
				if (!change.params || typeof change.params !== "object") {
					throw new Error("world.set: { stage } needs a params object");
				}
				Object.assign(stages[i].params, change.params);
				index = i; id = change.stage;

			} else if (change.addStage !== undefined) {
				var add = change.addStage;
				if (!add || typeof add.moduleId !== "string" || add.moduleId === "") {
					throw new Error("world.set: addStage needs a moduleId");
				}
				i = insertionIndex(change.before);
				stage = {
					id: "stg-" + (nextStage++),
					moduleId: add.moduleId,
					params: (add.params && typeof add.params === "object") ? add.params : {}
				};
				stages.splice(i, 0, stage);
				index = i; id = stage.id;

			} else if (change.removeStage !== undefined) {
				i = mustIndexOf(change.removeStage, "bad 'removeStage'");
				stages.splice(i, 1);
				index = i; id = change.removeStage;

			} else if (change.moveStage !== undefined) {
				i = mustIndexOf(change.moveStage, "bad 'moveStage'");
				if (change.before === change.moveStage) {
					index = i; id = change.moveStage;   // "move before itself": no-op,
					                                    // a drag UI can produce this
				} else {
					stage = stages[i];
					stages.splice(i, 1);
					j = insertionIndex(change.before);
					stages.splice(j, 0, stage);
					index = Math.min(i, j);
				}
				id = change.moveStage;

			} else if (change.swapStage !== undefined) {
				i = mustIndexOf(change.swapStage, "bad 'swapStage'");
				if (typeof change.moduleId !== "string" || change.moduleId === "") {
					throw new Error("world.set: swapStage needs a moduleId");
				}
				stages[i].moduleId = change.moduleId;
				stages[i].params = (change.params && typeof change.params === "object") ? change.params : {};
				index = i; id = change.swapStage;

			} else {
				throw new Error("world.set: unrecognised change (expected one of jd / stage / addStage / removeStage / moveStage / swapStage)");
			}

			notify({ change: change, index: index, id: id, transient: transient });
			return change.addStage !== undefined ? id : undefined;
		},

		// Subscribe to changes; returns an unsubscribe function. Listeners
		// fire synchronously, after the mutation is applied, with
		// { change, index, id, transient }.
		onChange: function (cb) {
			listeners.push(cb);
			return function () {
				var i = listeners.indexOf(cb);
				if (i !== -1) { listeners.splice(i, 1); }
			};
		},

		// While locked, set() throws before mutating. The recompute engine
		// locks the World for the duration of a chain recompute.
		lock: function (reason) { lockReason = reason || "locked"; },
		unlock: function () { lockReason = null; },

		// One plain, JSON-able object — save it, share it, diff it.
		serialize: function () {
			return {
				kind: WORLD_KIND,
				version: WORLD_VERSION,
				jd: jd,
				nextStage: nextStage,
				stages: structuredClone(stages)
			};
		},

		_restore: restore
	};

	return world;
}

// Rebuild a World from serialize() output. Returns { ok: true, world } or
// { ok: false, reason } — never throws, so a load banner can show `reason`
// directly rather than the page dying on a malformed or future save.
// Deliberately does NOT check moduleIds against any registry, or the mission
// for feasibility: a saved-but-broken mission must load (see header comment).
export function deserializeWorld(saved) {
	if (!saved || typeof saved !== "object") {
		return { ok: false, reason: "not a saved mission" };
	}
	if (saved.kind !== WORLD_KIND) {
		return { ok: false, reason: "unrecognised kind" };
	}
	if (typeof saved.version !== "number") {
		return { ok: false, reason: "missing version" };
	}
	if (saved.version > WORLD_VERSION) {
		return { ok: false, reason: "saved mission is v" + saved.version +
			", newer than this page understands (v" + WORLD_VERSION + ")" };
	}
	if (saved.version === 1) { saved = migrateV1toV2(saved); }
	if (saved.version === 2) { saved = migrateV2toV3(saved); }
	if (typeof saved.jd !== "number" || !isFinite(saved.jd)) {
		return { ok: false, reason: "missing or bad jd" };
	}
	if (!Array.isArray(saved.stages)) {
		return { ok: false, reason: "missing stages" };
	}

	var stages = [];
	var seen = {};
	var maxNum = 0;
	for (var i = 0; i < saved.stages.length; i++) {
		var s = saved.stages[i];
		if (!s || typeof s !== "object" ||
			typeof s.id !== "string" || s.id === "" ||
			typeof s.moduleId !== "string" || s.moduleId === "") {
			return { ok: false, reason: "stage " + i + " is malformed" };
		}
		if (seen[s.id]) {
			return { ok: false, reason: "duplicate stage id '" + s.id + "'" };
		}
		seen[s.id] = true;
		var m = /^stg-(\d+)$/.exec(s.id);
		if (m) { maxNum = Math.max(maxNum, parseInt(m[1], 10)); }
		stages.push({
			id: s.id,
			moduleId: s.moduleId,
			params: (s.params && typeof s.params === "object") ? structuredClone(s.params) : {}
		});
	}

	var nextStage = (typeof saved.nextStage === "number" && saved.nextStage > maxNum)
		? saved.nextStage
		: maxNum + 1;

	var world = createWorld({ jd: saved.jd });
	world._restore({ jd: saved.jd, stages: stages, nextStage: nextStage });
	return { ok: true, world: world };
}
