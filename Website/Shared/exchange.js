// The calculator-trading mailbox. ES module:
//   import { Exchange } from "../../Shared/exchange.js";
// See Website/ARCHITECTURE.md, "Exchange — trading data with the calculators".
//
// A page that PRODUCES data calls Exchange.send(packet, { target }) from a
// button handler. A page that CONSUMES a type calls Exchange.accept(types,
// cb, target) once at load; `cb` fires immediately for anything already
// pending, and again live while the page stays open.
//
// Store shape (mailbox contents, persisted at localStorage["mw-exchange"]):
//   { "<type>::<target>": { target: "<target>", packet: <envelope> } }
// One slot per (type, target) pair — "one pending packet per type per
// target, newest wins" (Website/ARCHITECTURE.md) — so a later send() to the
// same slot just overwrites it.
//
// The pure parts (slot-store ops, base64url fragment encode/decode) are
// plain-object in/out, so they're exported directly and Node-testable, same
// as math-utils.js. The `Exchange` namespace wraps them with the actual
// localStorage/window/clipboard side effects.

import { PacketTypes } from "./exchange-types.js";

var STORAGE_KEY = "mw-exchange";

// ---- pure: slot key + store ops --------------------------------------------

export function slotKey(type, target) {
	return type + "::" + target;
}

// New store with `packet` filed under (packet.type, target). Overwrites any
// existing slot for that pair (newest wins).
export function putPending(store, packet, target) {
	var next = Object.assign({}, store);
	next[slotKey(packet.type, target)] = { target: target, packet: packet };
	return next;
}

// The packet pending for the exact (type, target) pair, or null.
export function getPending(store, type, target) {
	var slot = store[slotKey(type, target)];
	return slot ? slot.packet : null;
}

// Every pending packet of `type`, across all targets (used when a receiver
// hasn't scoped itself to one target id — see Exchange.accept).
export function getAllPendingByType(store, type) {
	var out = [];
	Object.keys(store).forEach(function (k) {
		var slot = store[k];
		if (slot && slot.packet && slot.packet.type === type) { out.push(slot); }
	});
	return out;
}

// Remove the slot holding a packet with this id (its own send() stamped a
// fresh one — see `makeId`). Returns { store, removed }; a no-op removal
// (id already gone / superseded by a newer send to the same slot) is not an
// error, just leaves the store unchanged.
export function removePendingById(store, id) {
	var next = {};
	var removed = false;
	Object.keys(store).forEach(function (k) {
		var slot = store[k];
		if (slot && slot.packet && slot.packet.id === id) { removed = true; return; }
		next[k] = slot;
	});
	return { store: next, removed: removed };
}

// ---- pure: base64url JSON, for the URL-fragment transport ------------------

export function encodeFragment(packet) {
	var json = JSON.stringify(packet);
	var b64 = (typeof btoa === "function")
		? btoa(unescape(encodeURIComponent(json)))
		: Buffer.from(json, "utf-8").toString("base64");
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeFragment(str) {
	var b64 = str.replace(/-/g, "+").replace(/_/g, "/");
	while (b64.length % 4) { b64 += "="; }
	var json = (typeof atob === "function")
		? decodeURIComponent(escape(atob(b64)))
		: Buffer.from(b64, "base64").toString("utf-8");
	return JSON.parse(json);
}

// ---- pure: the COMPRESSED fragment, for payloads a chat message must carry --
//
// A mission link is pasted into Discord as often as into a browser, and a
// Discord message is cut off at 2,000 characters. Plain base64url of JSON runs
// past that as soon as a link carries more than one plan; deflate brings it
// back well under, because the sets in a mission link are near-copies of each
// other and that is exactly what DEFLATE is good at (measured on the shipped
// Moon->Ceres mission: 1,351 chars plain, 639 deflated; twenty plans, 26,051
// plain, 814 deflated).
//
// COMPRESSED FRAGMENTS ARE MARKED, not sniffed. A plain fragment is base64 of
// JSON, so it always begins "ey" ('{' encodes there and a packet is always an
// object); deflated bytes begin with anything. Rather than rest on that, a
// compressed fragment carries a literal "z" in front. The marker is inside the
// base64url alphabet, so the paste-side cleanup in MissionPlanner/ui/
// share-link.js carries it through untouched.
//
// These are async because CompressionStream is — there is no synchronous
// deflate in either the browser or Node. The sync encodeFragment/decodeFragment
// above are untouched and remain what the calculators' "#pkt=" transport uses.

export var FRAGMENT_Z_PREFIX = "z";

function bytesToBase64url(bytes) {
	var bin = "";
	for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
	var b64 = (typeof btoa === "function") ? btoa(bin) : Buffer.from(bytes).toString("base64");
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(str) {
	var b64 = str.replace(/-/g, "+").replace(/_/g, "/");
	while (b64.length % 4) { b64 += "="; }
	if (typeof atob === "function") {
		var bin = atob(b64);
		var out = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
		return out;
	}
	return new Uint8Array(Buffer.from(b64, "base64"));
}

async function through(stream, bytes) {
	var w = stream.writable.getWriter();
	w.write(bytes);
	w.close();
	var chunks = [], total = 0;
	var r = stream.readable.getReader();
	for (;;) {
		var step = await r.read();
		if (step.done) { break; }
		chunks.push(step.value);
		total += step.value.length;
	}
	var out = new Uint8Array(total), at = 0;
	chunks.forEach(function (c) { out.set(c, at); at += c.length; });
	return out;
}

// Packet -> a compressed fragment string. Falls back to the plain encoding
// where CompressionStream is missing, so an old browser still produces a
// readable (if longer) link rather than nothing.
export async function encodeFragmentZ(packet) {
	if (typeof CompressionStream !== "function") { return encodeFragment(packet); }
	var json = new TextEncoder().encode(JSON.stringify(packet));
	var bytes = await through(new CompressionStream("deflate-raw"), json);
	return FRAGMENT_Z_PREFIX + bytesToBase64url(bytes);
}

// Fragment string -> packet, accepting either form. Rejects by throwing, the
// same way decodeFragment does, so callers keep one try/catch.
export async function decodeFragmentAny(str) {
	if (str.charAt(0) !== FRAGMENT_Z_PREFIX) { return decodeFragment(str); }
	if (typeof DecompressionStream !== "function") {
		throw new Error("this browser cannot read a compressed mission link");
	}
	var bytes = await through(new DecompressionStream("deflate-raw"), base64urlToBytes(str.slice(1)));
	return JSON.parse(new TextDecoder().decode(bytes));
}

// A short, non-cryptographic id stamped on each packet at send() time so
// consume() can identify one specific delivery rather than "whatever is in
// the slot right now" (which could have raced with a newer send).
function makeId() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- stateful mailbox (localStorage + same-document listeners) ------------

var _listeners = [];      // { types, target, cb }
var _storageBound = false;

function readStore() {
	try {
		if (typeof localStorage === "undefined") { return {}; }
		var raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch (e) { return {}; }
}

function writeStore(store) {
	try {
		if (typeof localStorage === "undefined") { return; }
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch (e) { /* storage disabled/full — same-document delivery still worked */ }
}

// Call every registered listener whose types/target match this delivery.
// listener.target === undefined means "any target" (the common case: a page
// that's the sole receiver of a type doesn't need to scope itself).
function notify(packet, target) {
	_listeners.forEach(function (l) {
		if (l.types.indexOf(packet.type) === -1) { return; }
		if (l.target !== undefined && l.target !== target) { return; }
		l.cb(packet);
	});
}

function bindStorageEvent() {
	if (_storageBound || typeof window === "undefined") { return; }
	window.addEventListener("storage", function (ev) {
		if (ev.key !== STORAGE_KEY) { return; }
		// Re-check each listener's pending slot(s) rather than diffing the raw
		// JSON — cheap at this scale and avoids missing a same-tick overwrite.
		var store = readStore();
		_listeners.forEach(function (l) {
			l.types.forEach(function (t) {
				if (l.target !== undefined) {
					var p = getPending(store, t, l.target);
					if (p) { l.cb(p); }
				} else {
					getAllPendingByType(store, t).forEach(function (slot) { l.cb(slot.packet); });
				}
			});
		});
	});
	_storageBound = true;
}

export const Exchange = {

	// Validate, stamp an id, persist to the mailbox, and deliver immediately
	// to any matching same-document listener. `opts.target` scopes delivery
	// to one receiving calculator; omitted, it defaults to "*" (any receiver
	// with no target of its own can still see it via notify()'s
	// l.target === undefined case; a receiver that DID scope itself to a
	// specific target will not see a "*" send — send to that exact target
	// instead).
	send: function (packet, opts) {
		var check = PacketTypes.validate(packet);
		if (!check.ok) { throw new Error("Exchange.send: " + check.reason); }
		var target = (opts && opts.target) || "*";
		var stamped = Object.assign({}, packet, { id: makeId() });
		var store = putPending(readStore(), stamped, target);
		writeStore(store);
		notify(stamped, target);
		return stamped;
	},

	// Register interest in one or more payload types. Fires `cb` once per
	// already-pending packet right away (the page-load case), then again for
	// each new delivery while this page stays open (same-document sends
	// directly; other tabs/pages via the `storage` event).
	//
	// `target` scopes this receiver to packets sent to that exact target id;
	// omit it to receive every pending/incoming packet of a matching type
	// regardless of target (fine for a page that's the only receiver of that
	// type).
	accept: function (types, cb, target) {
		_listeners.push({ types: types, target: target, cb: cb });
		var store = readStore();
		types.forEach(function (t) {
			if (target !== undefined) {
				var p = getPending(store, t, target);
				if (p) { cb(p); }
			} else {
				getAllPendingByType(store, t).forEach(function (slot) { cb(slot.packet); });
			}
		});
		bindStorageEvent();
	},

	// Peek without consuming (e.g. to enable/disable a send button that
	// depends on something already being in the mailbox).
	pending: function (type, target) {
		return getPending(readStore(), type, target);
	},

	// Remove a packet after a successful Apply, by the id it was delivered
	// with (not by (type, target) — a newer send may have already replaced
	// that slot, and this must not delete the newer one).
	consume: function (id) {
		var result = removePendingById(readStore(), id);
		if (result.removed) { writeStore(result.store); }
		return result.removed;
	},

	// An "Open <calculator> with this data" link.
	linkFor: function (packet, url) {
		return url + "#pkt=" + encodeFragment(packet);
	},

	// Read a packet off this page's own URL fragment (`#pkt=...`), if any.
	// Returns null (never throws) for a missing/malformed/unreadable fragment.
	fromLocationFragment: function () {
		if (typeof location === "undefined") { return null; }
		var m = /#pkt=(.+)$/.exec(location.hash || "");
		if (!m) { return null; }
		try {
			var packet = decodeFragment(m[1]);
			return PacketTypes.validate(packet).ok ? packet : null;
		} catch (e) { return null; }
	},

	// Universal fallback #1: copy a packet as JSON text to the clipboard.
	copyToClipboard: function (packet) {
		var json = JSON.stringify(packet);
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			return navigator.clipboard.writeText(json);
		}
		return Promise.reject(new Error("Clipboard API unavailable"));
	},

	// Universal fallback #2: parse a packet pasted as JSON text. Returns the
	// packet or null (never throws) if it isn't a valid envelope.
	fromClipboardText: function (text) {
		try {
			var packet = JSON.parse(text);
			return PacketTypes.validate(packet).ok ? packet : null;
		} catch (e) { return null; }
	}
};
