/* Shared/flight-save.js — saved flights of the traffic plotters.
 *
 * A flight is saved as an ENVELOPE: { kind, app, version, name, savedAt,
 * flight }. `app` names the plotter that wrote it ("earth-moon-traffic",
 * "mars-system-traffic"), `version` that plotter's own flight format, and
 * `flight` is whatever the plotter's snapshot holds: its inputs, never its
 * results, which are worked out again on load. The same envelope travels
 * three ways: in the page's own list (localStorage), in a link (the
 * "#flight=" fragment, compressed with Shared/exchange.js's encodeFragmentZ),
 * and in a file. A file may also hold a COLLECTION: { kind, app, version,
 * flights: [envelope, …] }.
 *
 * A reader refuses a flight from another plotter, and one written in a newer
 * format than it understands, with a sentence the page can show; it never
 * guesses at what such a flight meant.
 *
 * Pure (no DOM, no storage): Node-tested in Shared/tests/flight-save.test.js.
 * Shared/sim/save-panel.js is the page side.
 */

export var FLIGHT_KIND = "moonwards-traffic-flight";
export var FLIGHTS_KIND = "moonwards-traffic-flights";

var APP_NAMES = {
	"earth-moon-traffic": "the Earth–Moon Traffic Plotter",
	"mars-system-traffic": "the Mars System Traffic Plotter"
};
function appName(app) { return APP_NAMES[app] || "another page"; }

function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

function cleanName(name) {
	return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

// One flight, ready to be stored, linked or written to a file.
export function packFlight(app, version, name, flight, savedAt) {
	return { kind: FLIGHT_KIND, app: app, version: version, name: cleanName(name) || "Untitled flight",
	         savedAt: savedAt || null, flight: flight };
}

// Several flights in one file.
export function packCollection(app, version, entries) {
	return { kind: FLIGHTS_KIND, app: app, version: version,
	         flights: entries.map(function (e) { return packFlight(app, e.version || version, e.name, e.flight, e.savedAt); }) };
}

// One envelope -> { ok: true, entry: { name, savedAt, version, flight } } or { ok: false, reason }.
function readOne(env, app, version) {
	if (!isPlainObject(env) || env.kind !== FLIGHT_KIND) { return { ok: false, reason: "That is not a saved flight." }; }
	if (env.app !== app) { return { ok: false, reason: "That flight was saved in " + appName(env.app) + ", not here." }; }
	if (!(typeof env.version === "number") || env.version > version) {
		return { ok: false, reason: "That flight was saved by a newer version of this page (format " + env.version +
			"; this page reads up to " + version + "). Reload the page to get the latest version." };
	}
	if (!isPlainObject(env.flight)) { return { ok: false, reason: "The saved flight is empty." }; }
	return { ok: true, entry: { name: cleanName(env.name) || "Untitled flight", savedAt: env.savedAt || null,
	                            version: env.version, flight: env.flight } };
}

// Anything decoded from a link or a file -> { ok: true, entries: [...], skipped: [reasons] }
// or { ok: false, reason }. A collection keeps the flights it can read and
// reports the ones it cannot.
export function unpackFlights(decoded, app, version) {
	if (isPlainObject(decoded) && decoded.kind === FLIGHTS_KIND) {
		if (decoded.app !== app) { return { ok: false, reason: "Those flights were saved in " + appName(decoded.app) + ", not here." }; }
		var entries = [], skipped = [];
		(Array.isArray(decoded.flights) ? decoded.flights : []).forEach(function (env) {
			var r = readOne(env, app, version);
			if (r.ok) { entries.push(r.entry); } else { skipped.push(r.reason); }
		});
		if (!entries.length) { return { ok: false, reason: skipped[0] || "The file holds no flights." }; }
		return { ok: true, entries: entries, skipped: skipped };
	}
	var one = readOne(decoded, app, version);
	return one.ok ? { ok: true, entries: [one.entry], skipped: [] } : one;
}

// ---- the page's own list: [{ name, savedAt, version, flight }], newest first ----

function sameName(a, b) { return cleanName(a).toLowerCase() === cleanName(b).toLowerCase(); }

export function findEntry(list, name) {
	for (var i = 0; i < list.length; i++) { if (sameName(list[i].name, name)) { return list[i]; } }
	return null;
}

// A new list with `entry` at the front, replacing any entry of the same name.
export function putEntry(list, entry) {
	return [entry].concat(list.filter(function (e) { return !sameName(e.name, entry.name); }));
}

export function removeEntry(list, name) {
	return list.filter(function (e) { return !sameName(e.name, name); });
}

// `name`, or "name (2)", "name (3)", … — the first not already in the list.
export function uniqueName(list, name) {
	var base = cleanName(name) || "Untitled flight";
	if (!findEntry(list, base)) { return base; }
	for (var n = 2; ; n++) {
		var tryName = base + " (" + n + ")";
		if (!findEntry(list, tryName)) { return tryName; }
	}
}

// Stored list text -> a list (anything unreadable is dropped, never thrown).
export function readList(text) {
	try {
		var v = JSON.parse(text);
		return Array.isArray(v) ? v.filter(function (e) { return isPlainObject(e) && isPlainObject(e.flight) && typeof e.name === "string"; }) : [];
	} catch (e) { return []; }
}

// A file name for a download: the words of `name`, safe on every system.
export function fileNameFor(base, name) {
	var words = cleanName(name).replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "").replace(/\s+/g, "-").replace(/→/g, "to").slice(0, 80);
	return base + (words ? "-" + words : "") + ".json";
}

// ---- pasted links ------------------------------------------------------------

// Pasted text -> the base64url fragment after "#<param>=" / "&<param>=", or the
// bare fragment blob on its own; null if none is found. Once the marker is
// found, everything after it is filtered down to the base64url alphabet, so
// line breaks, invisible wrap characters and stray trailing punctuation from a
// chat message drop out. A bare blob has no marker to anchor on, so only
// newlines, tabs and invisible characters are dropped there, and spaces stay
// significant: ordinary prose is not mistaken for a fragment. The 8-character
// floor keeps short words out (a real fragment is hundreds of characters).
var INVISIBLE_CHARS = /[​-‍﻿]/g;

export function fragmentFromText(text, param) {
	if (typeof text !== "string") { return null; }
	var marker = new RegExp("[#&]" + param + "=").exec(text);
	if (marker) {
		var frag = text.slice(marker.index + marker[0].length).replace(/[^A-Za-z0-9_-]/g, "");
		return frag.length >= 8 ? frag : null;
	}
	var t = text.replace(INVISIBLE_CHARS, "").replace(/[\r\n\t]/g, "").trim();
	return /^[A-Za-z0-9_-]{8,}$/.test(t) ? t : null;
}
