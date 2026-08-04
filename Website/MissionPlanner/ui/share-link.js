/* MissionPlanner/ui/share-link.js — the mission-link envelope.
 *
 * Pure (no DOM), Node-testable. A "Copy mission link" URL carries a mission in
 * its #mission= fragment. The envelope wraps { title, world } under its own
 * kind stamp, because a mission's TITLE lives at the shell level (planner.js's
 * mission list), not in the World — a bare serialized World would lose it and
 * every import would arrive as "Imported mission". unpackMissionLink also
 * accepts a bare serialized World, so older links keep working.
 *
 * The writing side is mission-view.js's share button (packMissionLink +
 * Shared/exchange.js's encodeFragment); the reading sides are planner.js's
 * initialMissions and ephemeris-view.js's "Paste mission link…".
 *
 * missionFragmentFrom() is the paste-side helper: the user may paste the
 * whole URL, just the "#mission=..." tail, or the bare base64url blob —
 * all three resolve to the fragment string decodeFragment wants.
 * (Base64url alphabet per Shared/exchange.js: A-Z a-z 0-9 - _ .)
 *
 * A link that round-trips through Notepad or a messaging app often comes
 * back mangled: long unbroken tokens get reflowed with real newlines at the
 * wrap points, or spliced with invisible zero-width characters so they CAN
 * wrap without a visible break. missionFragmentFrom() undoes that — see its
 * own comment for how the "#mission=" and bare-blob forms are handled
 * differently, so a link still round-trips but ordinary non-link text still
 * gets rejected.
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
// { ok: false, reason }. Accepts both the envelope and a bare serialized-World
// (kind "moonwards-world"); world content itself is NOT validated here — that
// stays core/world.js's deserializeWorld's job.
export function unpackMissionLink(decoded) {
	if (!decoded || typeof decoded !== "object") {
		return { ok: false, reason: "not a mission link" };
	}
	if (decoded.kind === "moonwards-world") {           // a bare world, no envelope
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
//
// Once the "#mission="/"&mission=" marker itself is found, everything after
// it to the end of the pasted text is filtered down to the base64url
// alphabet — the marker is a strong enough signal that the rest is link
// content that it's safe to drop whitespace, invisible reflow characters,
// and stray trailing punctuation (a period, a closing quote) wherever they
// landed. The bare-blob form has no such marker to anchor on, so it only
// drops newlines/tabs/invisible chars (unambiguous wrap artifacts) and
// keeps spaces significant — otherwise ordinary prose like "not a link at
// all" would collapse into something that looks like a fragment.
var INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF]/g;

export function missionFragmentFrom(text) {
	if (typeof text !== "string") { return null; }
	var marker = /[#&]mission=/.exec(text);
	if (marker) {
		var frag = text.slice(marker.index + marker[0].length).replace(/[^A-Za-z0-9_-]/g, "");
		return frag.length >= 8 ? frag : null;
	}
	var t = text.replace(INVISIBLE_CHARS, "").replace(/[\r\n\t]/g, "").trim();
	return /^[A-Za-z0-9_-]{8,}$/.test(t) ? t : null;
}
