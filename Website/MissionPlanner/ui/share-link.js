/* MissionPlanner/ui/share-link.js — the mission-link envelope.
 *
 * Pure (no DOM), Node-testable. A "Copy mission link" URL carries a mission in
 * its #mission= fragment. The envelope wraps { title, world, plan } under its
 * own kind stamp, because a mission's TITLE lives at the shell level
 * (planner.js's mission list), not in the World — a bare serialized World would
 * lose it and every import would arrive as "Imported mission".
 * unpackMissionLink also accepts a v1 envelope and a bare serialized World, so
 * older links keep working.
 *
 * `plan` is the two-set history from core/revisions.js: the mission as
 * originally frozen, plus its latest commit when it has one. Two sets is the
 * whole budget — a user's intermediate updates are their own working record,
 * and a link has to fit in a chat message.
 *
 * The writing side is mission-view.js's share button (packMissionLink +
 * Shared/exchange.js's encodeFragmentZ — links are compressed, which is what
 * keeps two sets inside a Discord message); the reading sides are planner.js's
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
export var MISSION_LINK_VERSION = 2;

// The fragment payload for a share link: title (may be null), the World the
// receiving TAB should open with, and — at v2 — the two-set `plan`
// core/revisions.js's packSets produced: the mission as originally frozen, and
// the latest commit if there is one. Kind-stamped and versioned like the World
// itself, so a future format change can be refused politely rather than
// misread.
//
// `world` and `plan` are not redundant. `world` is what opens in a tab;
// `plan.original` is what the Ephemeris tab reconstructs so the plan can be
// revised from where it started. A link with no `plan` (v1, or a mission whose
// history was lost) still opens a tab — the receiving side falls back to the
// old single-World behaviour rather than refusing.
export function packMissionLink(title, worldData, planSets) {
	var out = {
		kind: MISSION_LINK_KIND,
		version: MISSION_LINK_VERSION,
		title: (typeof title === "string" && title.trim()) ? title.trim() : null,
		world: worldData
	};
	if (planSets && planSets.original) { out.plan = planSets; }
	return out;
}

// Decoded fragment -> { ok: true, title: string|null, world, plan: object|null }
// or { ok: false, reason }. Accepts the v2 envelope, the v1 envelope (no
// `plan`), and a bare serialized-World (kind "moonwards-world"). World content
// itself is NOT validated here — that stays core/world.js's deserializeWorld's
// job, and the plan sets stay core/revisions.js's readSets'.
export function unpackMissionLink(decoded) {
	if (!decoded || typeof decoded !== "object") {
		return { ok: false, reason: "not a mission link" };
	}
	if (decoded.kind === "moonwards-world") {           // a bare world, no envelope
		return { ok: true, title: null, world: decoded, plan: null };
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
	var plan = (decoded.plan && typeof decoded.plan === "object") ? decoded.plan : null;
	return { ok: true, title: title, world: decoded.world, plan: plan };
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
