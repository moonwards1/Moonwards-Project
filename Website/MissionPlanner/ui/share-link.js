/* MissionPlanner/ui/share-link.js — the mission-link envelope (task E2).
 *
 * Pure (no DOM), Node-testable. A "Copy mission link" URL carries a mission
 * in its #mission= fragment. Before E2 the fragment was a bare
 * World.serialize() object, which loses the mission's TITLE (titles live at
 * the shell level, not in the World — the A2 decision), so every import
 * arrived as "Imported mission". The envelope here wraps { title, world }
 * under its own kind stamp; unpackMissionLink still accepts the old bare
 * form, so pre-E2 links keep working.
 *
 * missionFragmentFrom() is the paste-side helper: the user may paste the
 * whole URL, just the "#mission=..." tail, or the bare base64url blob —
 * all three resolve to the fragment string decodeFragment wants.
 * (Base64url alphabet per Shared/exchange.js: A-Z a-z 0-9 - _ .)
 */

export var MISSION_LINK_KIND = "moonwards-mission-link";
export var MISSION_LINK_VERSION = 1;

// The fragment payload for a share link: title (may be null) + serialized
// World. Kind-stamped and versioned like the World itself, so a future
// format change can be refused politely rather than misread.
export function packMissionLink(title, worldData) {
	return {
		kind: MISSION_LINK_KIND,
		version: MISSION_LINK_VERSION,
		title: (typeof title === "string" && title.trim()) ? title.trim() : null,
		world: worldData
	};
}

// Decoded fragment -> { ok: true, title: string|null, world } or
// { ok: false, reason }. Accepts both the E2 envelope and the pre-E2 bare
// serialized-World form (kind "moonwards-world"); world content itself is
// NOT validated here — that stays deserializeWorld's job.
export function unpackMissionLink(decoded) {
	if (!decoded || typeof decoded !== "object") {
		return { ok: false, reason: "not a mission link" };
	}
	if (decoded.kind === "moonwards-world") {           // pre-E2 bare world
		return { ok: true, title: null, world: decoded };
	}
	if (decoded.kind !== MISSION_LINK_KIND) {
		return { ok: false, reason: "unrecognised link kind" };
	}
	if (decoded.version > MISSION_LINK_VERSION) {
		return { ok: false, reason: "saved with link format v" + decoded.version +
			", newer than this page understands (v" + MISSION_LINK_VERSION + ")" };
	}
	if (!decoded.world || typeof decoded.world !== "object") {
		return { ok: false, reason: "the link carries no mission data" };
	}
	var title = (typeof decoded.title === "string" && decoded.title.trim())
		? decoded.title.trim() : null;
	return { ok: true, title: title, world: decoded.world };
}

// Pasted text -> the base64url fragment string, or null if none is found.
// Handles a full URL (or any text containing "#mission=..." / "&mission=..."),
// or the bare fragment blob on its own. The 8-char floor on the bare form
// keeps stray short words from being treated as a fragment (a real one is
// hundreds of characters).
export function missionFragmentFrom(text) {
	if (typeof text !== "string") { return null; }
	var m = /[#&]mission=([A-Za-z0-9_-]+)/.exec(text);
	if (m) { return m[1]; }
	var t = text.trim();
	return /^[A-Za-z0-9_-]{8,}$/.test(t) ? t : null;
}
