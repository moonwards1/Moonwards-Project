/* Shared/sim/save-panel.js — the Saved flights card of the traffic plotters.
 *
 * The page hands over two functions: snapshot(), the current flight as plain
 * data (its inputs, never its results), and apply(flight, version), which
 * sets the page up from one and returns { ok } or { ok: false, reason }. This
 * module does the rest, with Shared/flight-save.js's envelope:
 *
 *   - SAVE puts the current flight in the page's own list under a name;
 *     saving under a name already in the list replaces that entry. LOAD and
 *     DELETE work on the entry chosen in the list (Delete asks for a second
 *     click instead of opening a browser dialog).
 *   - COPY LINK puts a link to the current flight on the clipboard, carried
 *     in the "#flight=" fragment, compressed so it fits a chat message.
 *     Opening the link, or pasting it into the card's field, sets the flight
 *     up and adds it to the list.
 *   - EXPORT writes the whole list to a .json file (the current flight alone
 *     when the list is empty); IMPORT reads such a file and adds its flights.
 *     An imported flight whose name is taken gets a numbered name; one
 *     identical to an entry already in the list is skipped.
 *   - The current flight is kept on leaving the page and set up again on the
 *     next visit, unless a link is being opened. START FRESH drops it and
 *     reloads the page with its starting flight.
 *
 * The card's classes are fsv-*; each page styles them in its own stylesheet.
 */

import { packFlight, packCollection, unpackFlights, putEntry, removeEntry, findEntry, uniqueName,
         readList, fileNameFor, fragmentFromText } from "../flight-save.js";
import { encodeFragmentZ, decodeFragmentAny } from "../exchange.js";

var LINK_PARAM = "flight";
var CHAT_LIMIT = 2000;                 // characters in a Discord message

function el(tag, cls, text) {
	var e = document.createElement(tag);
	if (cls) { e.className = cls; }
	if (text != null) { e.textContent = text; }
	return e;
}
function button(parent, label, title) {
	var b = parent.appendChild(el("button", "fsv-btn", label));
	b.type = "button";
	if (title) { b.title = title; }
	return b;
}
function sameFlight(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// opts: { app, version, storageKey, filePrefix, snapshot(), apply(flight, version), describe(flight) }
export function createSavePanel(host, opts) {
	var listKey = opts.storageKey + ":saved", currentKey = opts.storageKey + ":current";
	var list = readList(storageGet(listKey));
	var keepCurrent = true;
	var deleteArmed = null;

	function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function storageSet(k, v) {
		try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
	}
	function storeList() {
		if (!storageSet(listKey, JSON.stringify(list))) { say("This browser would not keep the list (storage is full or blocked)."); }
	}

	// ---- the card ----
	var row1 = host.appendChild(el("div", "fsv-row"));
	var nameIn = row1.appendChild(el("input", "fsv-name"));
	nameIn.type = "text"; nameIn.spellcheck = false; nameIn.autocomplete = "off";
	nameIn.setAttribute("aria-label", "Name of the flight");
	nameIn.addEventListener("focus", placeholderName);
	var saveBtn = button(row1, "Save", "Save the flight as it stands under this name. A name already in the list is replaced.");

	var row2 = host.appendChild(el("div", "fsv-row"));
	var sel = row2.appendChild(el("select", "fsv-list"));
	sel.setAttribute("aria-label", "Saved flights");
	var loadBtn = button(row2, "Load", "Set the page up with the chosen flight.");
	var delBtn = button(row2, "Delete", "Remove the chosen flight from the list.");

	var row3 = host.appendChild(el("div", "fsv-row"));
	var linkBtn = button(row3, "Copy link", "Copy a link to the flight as it stands, to share or keep. It opens this page with the flight set up.");
	var exportBtn = button(row3, "Export", "Download every saved flight as one file (the flight as it stands, when nothing is saved yet).");
	var importBtn = button(row3, "Import", "Add the flights in a file exported from this page to the list.");
	var fileIn = row3.appendChild(el("input"));
	fileIn.type = "file"; fileIn.accept = ".json,application/json"; fileIn.hidden = true;
	var freshBtn = button(row3, "Start fresh", "Forget the flight on screen and reload the page with its starting flight. Saved flights stay.");

	var row4 = host.appendChild(el("div", "fsv-row"));
	var pasteIn = row4.appendChild(el("input", "fsv-paste"));
	pasteIn.type = "text"; pasteIn.spellcheck = false; pasteIn.autocomplete = "off";
	pasteIn.placeholder = "Paste a flight link";
	pasteIn.setAttribute("aria-label", "Paste a flight link");
	var openBtn = button(row4, "Open", "Set up the flight in the pasted link and add it to the list.");

	var status = host.appendChild(el("div", "fsv-status"));
	status.setAttribute("aria-live", "polite");
	function say(text) { status.textContent = text || ""; }

	function fillList(chosen) {
		sel.textContent = "";
		var head = sel.appendChild(el("option", null, list.length ? "Saved flights (" + list.length + ")" : "No saved flights"));
		head.value = "";
		list.forEach(function (e) {
			var o = sel.appendChild(el("option", null, e.name));
			o.value = e.name;
		});
		sel.value = chosen && findEntry(list, chosen) ? findEntry(list, chosen).name : "";
		loadBtn.disabled = delBtn.disabled = !sel.value;
		disarmDelete();
	}
	function placeholderName() {
		try { nameIn.placeholder = opts.describe(opts.snapshot()); } catch (e) { nameIn.placeholder = "Name this flight"; }
	}

	function applyEntry(entry, how) {
		var r;
		try { r = opts.apply(entry.flight, entry.version); }
		catch (e) { console.error(e); r = { ok: false, reason: "The page could not set it up (" + e.message + ")." }; }
		if (r && r.ok) {
			nameIn.value = entry.name;
			placeholderName();
			say(how + " “" + entry.name + "”.");
			return true;
		}
		say("Could not open “" + entry.name + "”: " + (r && r.reason ? r.reason : "the page refused it."));
		return false;
	}

	// Entries from a file or a link -> into the list. Returns the entries as named in the list.
	function addEntries(entries) {
		var added = [], same = 0;
		entries.forEach(function (e) {
			var match = list.filter(function (x) { return sameFlight(x.flight, e.flight); })[0];
			if (match) { same++; added.push(match); return; }
			var entry = { name: uniqueName(list, e.name), savedAt: e.savedAt || new Date().toISOString(),
			              version: e.version, flight: e.flight };
			list = putEntry(list, entry);
			added.push(entry);
		});
		storeList();
		return { entries: added, same: same };
	}

	// ---- actions ----
	saveBtn.addEventListener("click", function () {
		var flight = opts.snapshot();
		var name = nameIn.value.trim() || opts.describe(flight);
		var had = !!findEntry(list, name);
		list = putEntry(list, { name: name, savedAt: new Date().toISOString(), version: opts.version, flight: flight });
		storeList();
		nameIn.value = findEntry(list, name).name;
		fillList(name);
		say((had ? "Saved over “" : "Saved “") + name + "”.");
	});
	sel.addEventListener("change", function () {
		loadBtn.disabled = delBtn.disabled = !sel.value;
		disarmDelete();
		if (sel.value) { nameIn.value = sel.value; }
	});
	loadBtn.addEventListener("click", function () {
		var e = findEntry(list, sel.value);
		if (e) { applyEntry(e, "Loaded"); }
	});
	function disarmDelete() {
		clearTimeout(deleteArmed); deleteArmed = null;
		delBtn.textContent = "Delete";
		delBtn.classList.remove("fsv-armed");
	}
	delBtn.addEventListener("click", function () {
		var e = findEntry(list, sel.value);
		if (!e) { return; }
		if (!deleteArmed) {
			delBtn.textContent = "Delete it?";
			delBtn.classList.add("fsv-armed");
			deleteArmed = setTimeout(disarmDelete, 4000);
			return;
		}
		list = removeEntry(list, e.name);
		storeList();
		fillList(null);
		say("Deleted “" + e.name + "”.");
	});

	linkBtn.addEventListener("click", async function () {
		var flight = opts.snapshot();
		var name = nameIn.value.trim() || opts.describe(flight);
		var frag = await encodeFragmentZ(packFlight(opts.app, opts.version, name, flight, new Date().toISOString()));
		var url = location.href.split("#")[0] + "#" + LINK_PARAM + "=" + frag;
		var size = url.length.toLocaleString("en-US") + " characters" +
			(url.length > CHAT_LIMIT ? ", longer than a Discord message holds (2,000)" : "");
		try {
			await navigator.clipboard.writeText(url);
			say("Link copied (" + size + ").");
		} catch (e) {
			pasteIn.value = url;
			pasteIn.select();
			say("The browser would not copy it: the link is in the field below, selected (" + size + ").");
		}
	});

	exportBtn.addEventListener("click", function () {
		var data, fname;
		if (list.length) {
			data = packCollection(opts.app, opts.version, list);
			fname = fileNameFor(opts.filePrefix + "-flights", "");
		} else {
			var flight = opts.snapshot();
			var name = nameIn.value.trim() || opts.describe(flight);
			data = packFlight(opts.app, opts.version, name, flight, new Date().toISOString());
			fname = fileNameFor(opts.filePrefix + "-flight", name);
		}
		var blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
		var a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = fname;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
		say(list.length ? "Exported " + list.length + (list.length === 1 ? " flight" : " flights") + " to " + fname + "."
			: "Nothing saved yet: exported the flight on screen to " + fname + ".");
	});

	importBtn.addEventListener("click", function () { fileIn.value = ""; fileIn.click(); });
	fileIn.addEventListener("change", function () {
		var f = fileIn.files && fileIn.files[0];
		if (!f) { return; }
		f.text().then(function (text) {
			var decoded;
			try { decoded = JSON.parse(text); } catch (e) { say("That file is not a flight file."); return; }
			var r = unpackFlights(decoded, opts.app, opts.version);
			if (!r.ok) { say(r.reason); return; }
			var res = addEntries(r.entries);
			fillList(res.entries[0].name);
			var n = res.entries.length - res.same;
			var msg = "Imported " + n + (n === 1 ? " flight" : " flights") +
				(res.same ? "; " + res.same + " already in the list" : "") +
				(r.skipped.length ? "; " + r.skipped.length + " could not be read (" + r.skipped[0] + ")" : "") + ".";
			if (res.entries.length === 1 && applyEntry(res.entries[0], "Imported and loaded")) { return; }
			say(msg);
		}, function () { say("The file could not be read."); });
	});

	// A link (pasted, or in the address) -> set up and added to the list.
	async function openLink(text, how) {
		var frag = fragmentFromText(text, LINK_PARAM);
		if (!frag) { say("That does not look like a flight link."); return false; }
		var decoded;
		try { decoded = await decodeFragmentAny(frag); }
		catch (e) { say("The link is damaged: part of it may have been cut off when it was copied."); return false; }
		var r = unpackFlights(decoded, opts.app, opts.version);
		if (!r.ok) { say(r.reason); return false; }
		var res = addEntries(r.entries.slice(0, 1));
		fillList(res.entries[0].name);
		return applyEntry(res.entries[0], how);
	}
	openBtn.addEventListener("click", function () {
		openLink(pasteIn.value, "Opened").then(function (ok) { if (ok) { pasteIn.value = ""; } });
	});
	pasteIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { openBtn.click(); } });

	freshBtn.addEventListener("click", function () {
		keepCurrent = false;
		try { localStorage.removeItem(currentKey); } catch (e) { /* storage blocked: nothing kept anyway */ }
		location.replace(location.href.split("#")[0]);
	});

	// ---- the flight on screen, kept between visits ----
	function keep() {
		if (!keepCurrent) { return; }
		try {
			storageSet(currentKey, JSON.stringify({ version: opts.version, name: nameIn.value.trim(), flight: opts.snapshot() }));
		} catch (e) { /* a page mid-way through an error: keep the last one */ }
	}
	window.addEventListener("pagehide", keep);
	document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { keep(); } });

	function linkInAddress() { return /[#&]flight=/.test(location.hash || ""); }
	function dropLinkFromAddress() {
		try { history.replaceState(null, "", location.href.split("#")[0]); } catch (e) { /* file:// or sandboxed */ }
	}
	window.addEventListener("hashchange", function () {
		if (!linkInAddress()) { return; }
		openLink(location.hash, "Opened").then(dropLinkFromAddress);
	});

	fillList(null);
	placeholderName();

	return {
		// Call once the page is set up: opens a flight link in the address, or
		// else picks up the flight kept from the last visit. Resolves to
		// "link", "kept" or null.
		restore: async function () {
			if (linkInAddress()) {
				var ok = await openLink(location.hash, "Opened the linked flight");
				dropLinkFromAddress();
				return ok ? "link" : null;
			}
			var kept;
			try { kept = JSON.parse(storageGet(currentKey)); } catch (e) { kept = null; }
			if (!kept || !kept.flight) { return null; }
			var entry = { name: kept.name || "", version: kept.version || opts.version, flight: kept.flight };
			var r;
			try { r = opts.apply(entry.flight, entry.version); }
			catch (e) { console.error(e); r = { ok: false, reason: e.message }; }
			if (r && r.ok) {
				nameIn.value = entry.name;
				placeholderName();
				say("Picked up the flight from your last visit. Start fresh resets the page.");
				return "kept";
			}
			say("The flight from your last visit could not be set up again (" + (r && r.reason) + "); the page has its starting flight.");
			return null;
		}
	};
}
