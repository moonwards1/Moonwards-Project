// The site's three info tiers, driven by the shared entries in
// Website/Lore/entries.md (parsed by lore-markdown.js).
//
//   tier 1  dotted underline in the text's own colour; a tooltip on hover,
//           focus or tap — what a word means or how a control works
//   tier 2  orange dotted underline; opens a pop-up beside the word, a speech
//           bubble pointing at it, whose links to other entries expand in
//           place (Nutshell-style)
//   tier 3  an orange ⓘ after the word (or alone); opens the same pop-up,
//           for central information
//
// Alerts — problems with the current inputs — are a solid red-orange circle
// with a white "i" beside the field concerned (loreAlertSymbol; placed by
// CalcShell.setAlerts). One flashes slowly for a few seconds when it appears,
// then stays steady; clicking it opens its text in the same pop-up.
//
// Every mark shows the help cursor (arrow and question mark). Pop-ups show
// the entry's text with no heading: the marked word is the context. The Lore page shows the title and any "::: lore" additions.
//
// A page calls initLore() once. Text is marked with loreMark / loreHTML,
// loreMarkPhrase (wraps a phrase inside text already on the page), or by
// hand in HTML:  <span class="lore" data-lore="entry-id" tabindex="0">word</span>
// (a tier-3 mark is usually empty: the ⓘ is drawn for it). The tier comes from
// the entry, so a mark names only the id. Marks may be added at any time —
// styling is by attribute selector and events are delegated from the document.
//
// An id with no entry is drawn with a red dashed underline and logged, so a
// typo shows on the page. Add ?lore=pending to any page's URL to outline the
// marks whose entries have no text yet.

import { parseLore, renderMarkdown } from "./lore-markdown.js";
import { create } from "./ui-components.js";

export const LORE_ENTRIES_URL = new URL("../Lore/entries.md", import.meta.url).href;
export const LORE_PAGE_URL = new URL("../Lore/index.html", import.meta.url).href;
const CSS_URL = new URL("./lore.css", import.meta.url).href;
const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/";
const MAX_DEPTH = 2;   // nested expansions; a deeper link opens the Lore page

var started = false;
var lore = null;        // parsed entries, once loaded
var loading = null;     // Promise of `lore`
var styleEl = null, tipEl = null, tipFor = null, popEl = null, popFor = null, katexP = null;
var warned = {};

// ── Loading ──────────────────────────────────────────────────────────────────

// Promise of the parsed entries ({ entries, order, chapters, problems }).
export function getLore() {
	if (!loading) {
		loading = fetch(LORE_ENTRIES_URL, { cache: "no-cache" })
			.then(function (r) { if (!r.ok) throw new Error(r.status + " " + r.statusText); return r.text(); })
			.then(useLoreText)
			.catch(function (e) {
				console.warn("Lore: could not load " + LORE_ENTRIES_URL + " — " + e.message);
				return useLoreText("");
			});
	}
	return loading;
}

// Use `text` as the entries file (also how a test or preview supplies its own).
export function useLoreText(text) {
	lore = parseLore(text);
	lore.problems.forEach(function (p) { console.warn("Lore: " + p); });
	loading = Promise.resolve(lore);
	if (started) applyStyles();
	return lore;
}

export function loreEntry(id) { return lore && lore.entries[id] || null; }
export function loreEntryUrl(id) { return LORE_PAGE_URL + "#" + encodeURIComponent(id); }

// ── Marking text ─────────────────────────────────────────────────────────────

// A mark element for entry `id` around `text` (omit text for a tier-3 ⓘ),
// appended to `parent` if given.
export function loreMark(id, text, parent) {
	var el = create("span", "lore", text || false, parent);
	el.dataset.lore = id;
	el.tabIndex = 0;
	el.setAttribute("role", "button");
	return el;
}

// Mark the first occurrence of `phrase` (any letter case) in the text under
// `root` — a label, a card title — for entry `id`, leaving the rest of the
// text as it is. Does nothing if `root` already holds a mark for `id`.
// Returns the mark, or null (logged) if the phrase is not there.
export function loreMarkPhrase(root, phrase, id) {
	if (!root) return null;
	var have = root.querySelector('[data-lore="' + CSS.escape(id) + '"]');
	if (have) return have;
	var want = String(phrase).toLowerCase();
	var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: function (n) {
			return n.parentElement.closest("[data-lore], select, option, textarea, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
		}
	});
	for (var node = walk.nextNode(); node; node = walk.nextNode()) {
		var i = node.data.toLowerCase().indexOf(want);
		if (i < 0) continue;
		var hit = node.splitText(i);
		hit.splitText(phrase.length);
		var el = document.createElement("span");
		el.className = "lore";
		el.dataset.lore = id;
		// Inside a button the button takes the focus; elsewhere the mark does.
		if (!hit.parentElement.closest("button")) { el.tabIndex = 0; el.setAttribute("role", "button"); }
		hit.replaceWith(el);
		el.appendChild(hit);
		return el;
	}
	console.warn("Lore: “" + phrase + "” not found for “" + id + "”.");
	return null;
}

// Take the marks out of `root`, keeping their text.
export function loreUnmark(root) {
	if (!root) return;
	root.querySelectorAll("[data-lore]").forEach(function (m) { m.replaceWith(document.createTextNode(m.textContent)); });
	root.normalize();
}

// The same mark as an HTML string, for pages built with innerHTML. `text` is
// inserted as HTML.
export function loreHTML(id, text) {
	return '<span class="lore" data-lore="' + String(id).replace(/"/g, "&quot;") + '" tabindex="0" role="button">' + (text || "") + "</span>";
}

// ── Rendering an entry ───────────────────────────────────────────────────────

// HTML for an entry's pop-up text, or with `onPage` its Lore page text (the
// pending note when there is none yet).
export function loreBodyHTML(entry, onPage) {
	if (!entry) return '<p class="lore-pending-note">No entry with this id.</p>';
	var md = onPage ? entry.page : entry.popup;
	if (!md) return '<p class="lore-pending-note">Note not written yet.</p>';
	return renderMarkdown(md, { base: LORE_ENTRIES_URL });
}

// Typeset any $maths$ inside `root` with KaTeX, loaded from the CDN on first
// use. Without it the TeX source stays visible. Returns a Promise, settled
// once the maths is drawn.
export function typesetLore(root) {
	var els = root.querySelectorAll(".lore-math:not([data-done])");
	if (!els.length) return Promise.resolve();
	if (!katexP) {
		var link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = KATEX + "katex.min.css";
		document.head.appendChild(link);
		katexP = import(KATEX + "katex.mjs").then(function (m) { return m.default || m; })
			.catch(function (e) { console.warn("Lore: KaTeX did not load — " + e.message); return null; });
	}
	return katexP.then(function (katex) {
		if (!katex) return;
		els.forEach(function (el) {
			try {
				katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("lore-math-display"), throwOnError: false });
				el.dataset.done = "1";
			} catch (e) { /* leave the TeX source showing */ }
		});
	});
}

function fill(el, html) { el.innerHTML = html; return typesetLore(el); }

// ── Styles ───────────────────────────────────────────────────────────────────

function sel(ids) {
	return ids.map(function (id) { return '[data-lore="' + CSS.escape(id) + '"]'; }).join(",");
}

// Tier looks are keyed to each entry's id, so marks added later style
// themselves with no DOM scan.
function applyStyles() {
	if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "lore-tiers"; document.head.appendChild(styleEl); }
	var by = { 1: [], 2: [], 3: [] }, pending = [];
	lore.order.forEach(function (id) {
		var e = lore.entries[id];
		by[e.tier].push(id);
		if (e.pending) pending.push(id);
	});
	var css = [];
	// "html.lore-ready" outranks lore.css's red no-entry underline.
	function rule(ids, pre, body) { if (ids.length) css.push("html.lore-ready" + pre + " :is(" + sel(ids) + ")" + body); }
	rule(by[1], "", "{" + TIER1 + "}");
	rule(by[2], "", "{" + TIER2 + "}");
	rule(by[3], "", "{" + TIER3 + "}");
	rule(by[3], "", "::after{" + TIER3_ICON + "}");
	rule(pending, ".lore-show-pending", "{" + PENDING + "}");
	styleEl.textContent = css.join("\n");
	document.documentElement.classList.add("lore-ready");
}
var TIER1 = "cursor:help;text-decoration:underline dotted currentColor 1.5px;text-underline-offset:0.2em;";
var TIER2 = "cursor:help;text-decoration:underline dotted var(--lore-accent) 2.5px;text-underline-offset:0.2em;text-decoration-skip-ink:none;";
var TIER3 = "cursor:help;text-decoration:none;";
var TIER3_ICON = "content:'\\24D8';color:var(--lore-accent);font-weight:700;font-size:1.05em;margin-left:0.15em;";
var PENDING = "outline:1.5px dashed var(--lore-accent);outline-offset:2px;";

// ── Tooltip (tier 1) ─────────────────────────────────────────────────────────

function showTip(el) {
	var e = loreEntry(el.dataset.lore);
	if (!e) return;
	if (!tipEl) {
		tipEl = create("div", "lore-tip", false, document.body);
		tipEl.id = "lore-tip";
		tipEl.setAttribute("role", "tooltip");
	}
	tipFor = el;
	fill(tipEl, loreBodyHTML(e));
	el.setAttribute("aria-describedby", "lore-tip");
	tipEl.classList.add("lore-on");
	var r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
	var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
	var x = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, vw - t.width - 8));
	var y = r.bottom + 8;
	if (y + t.height > vh - 8 && r.top - t.height - 8 > 8) y = r.top - t.height - 8;
	tipEl.style.left = x + "px";
	tipEl.style.top = y + "px";
}
function hideTip() {
	if (tipFor) tipFor.removeAttribute("aria-describedby");
	tipFor = null;
	if (tipEl) tipEl.classList.remove("lore-on");
}

// ── Pop-up (tiers 2 and 3) ───────────────────────────────────────────────────
// A speech bubble beside the marked word, its pointer on the word, placed on
// the side where it fits best. The page stays live behind it: a click
// elsewhere, Esc or the × closes it, and it follows the word as the page
// scrolls (closing if the word scrolls out of view).

var POP_W = 440, POP_GAP = 12, POP_EDGE = 8, POP_MIN_W = 260;

function buildPop() {
	popEl = create("div", "lore-pop", false, document.body);
	popEl.setAttribute("role", "dialog");
	popEl.tabIndex = -1;
	popEl.hidden = true;
	create("div", "lore-pop-arrow", false, popEl);
	var box = create("div", "lore-pop-box", false, popEl);
	var x = create("button", "lore-pop-close", "×", box);
	x.type = "button";
	x.setAttribute("aria-label", "Close");
	x.addEventListener("click", function () { closeLorePop(true); });
	create("div", ["lore-body", "lore-pop-body"], false, box);
	var foot = create("div", "lore-pop-foot", false, box);
	var a = create("a", "lore-pop-more", "Open on the Lore page →", foot);
	a.target = "_blank";
	a.rel = "noopener";
}

// Open entry `id`'s pop-up at `anchor` (the mark); without one it sits mid-window.
export function openLoreDialog(id, anchor) {
	var e = loreEntry(id);
	showPop(anchor, loreBodyHTML(e), e ? e.title : id, loreEntryUrl(id));
}

// The pop-up at `anchor` holding `html`; `more`, if given, is its Lore page link.
function showPop(anchor, html, label, more) {
	if (!popEl) buildPop();
	popFor = anchor || null;
	popEl.setAttribute("aria-label", label);
	popEl.classList.toggle("lore-pop-alert", !more);
	var body = popEl.querySelector(".lore-pop-body");
	var drawn = fill(body, html);
	var foot = popEl.querySelector(".lore-pop-foot");
	foot.hidden = !more;
	if (more) popEl.querySelector(".lore-pop-more").href = more;
	body.scrollTop = 0;
	popEl.hidden = false;
	placePop();
	drawn.then(placePop);
	popEl.focus({ preventScroll: true });
}

export function closeLorePop(refocus) {
	if (!popEl || popEl.hidden) return;
	popEl.hidden = true;
	if (refocus && popFor && popFor.isConnected && popFor.tabIndex >= 0) popFor.focus({ preventScroll: true });
	popFor = null;
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(x, hi)); }

function placePop() {
	if (!popEl || popEl.hidden) return;
	var box = popEl.querySelector(".lore-pop-box"), arrow = popEl.querySelector(".lore-pop-arrow");
	var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
	var W = Math.min(POP_W, vw - 2 * POP_EDGE);
	box.style.maxHeight = "";
	popEl.style.width = W + "px";
	if (!popFor || !popFor.isConnected) {
		box.style.maxHeight = (vh - 2 * POP_EDGE) + "px";
		popEl.dataset.side = "none";
		popEl.style.left = (vw - W) / 2 + "px";
		popEl.style.top = Math.max(POP_EDGE, (vh - box.offsetHeight) / 2) + "px";
		return;
	}
	var r = popFor.getBoundingClientRect();
	if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) { closeLorePop(false); return; }
	var H = box.offsetHeight;   // its natural height at full width
	var room = {
		bottom: vh - r.bottom - POP_GAP - POP_EDGE, top: r.top - POP_GAP - POP_EDGE,
		right: vw - r.right - POP_GAP - POP_EDGE, left: r.left - POP_GAP - POP_EDGE
	};
	// How well each side holds it: above and below by height, beside by width
	// (a side narrower than POP_MIN_W can't be used). Below wins a tie.
	var fit = { bottom: room.bottom / H, top: room.top / H,
		right: room.right >= POP_MIN_W ? room.right / W : 0, left: room.left >= POP_MIN_W ? room.left / W : 0 };
	var side = ["bottom", "top", "right", "left"].reduce(function (best, k) { return fit[k] > fit[best] ? k : best; }, "bottom");
	popEl.dataset.side = side;
	var cx = r.left + r.width / 2, cy = r.top + r.height / 2, left, top, w = W, h;
	if (side === "bottom" || side === "top") {
		box.style.maxHeight = Math.max(80, room[side]) + "px";
		h = box.offsetHeight;
		left = clamp(cx - w / 2, POP_EDGE, vw - w - POP_EDGE);
		top = side === "bottom" ? r.bottom + POP_GAP : r.top - POP_GAP - h;
		arrow.style.left = clamp(cx - left, 18, w - 18) + "px";
		arrow.style.top = "";
	} else {
		w = Math.min(W, room[side]);
		popEl.style.width = w + "px";
		box.style.maxHeight = (vh - 2 * POP_EDGE) + "px";
		h = box.offsetHeight;
		left = side === "right" ? r.right + POP_GAP : r.left - POP_GAP - w;
		top = clamp(cy - h / 2, POP_EDGE, vh - h - POP_EDGE);
		arrow.style.top = clamp(cy - top, 18, h - 18) + "px";
		arrow.style.left = "";
	}
	popEl.style.left = left + "px";
	popEl.style.top = top + "px";
}

// ── Alerts ───────────────────────────────────────────────────────────────────

// A new alert symbol (not yet placed). `passive`: only an indicator, as on a
// tab label — clicks pass through to what holds it.
export function loreAlertSymbol(passive) {
	var el = document.createElement("span");
	el.className = "lore-alert lore-alert-flash";
	el.addEventListener("animationend", function () { el.classList.remove("lore-alert-flash"); });
	if (passive) { el.dataset.passive = ""; el.setAttribute("aria-hidden", "true"); return el; }
	el.tabIndex = 0;
	el.setAttribute("role", "button");
	return el;
}

// The text an alert symbol opens: paragraphs separated by a blank line.
export function setLoreAlertText(el, text) {
	el._loreAlert = text;
	if (!("passive" in el.dataset)) el.setAttribute("aria-label", "Alert: " + text.replace(/\n+/g, " "));
}
export function loreAlertText(el) { return el._loreAlert || ""; }

function alertHTML(text) {
	return text.split(/\n{2,}/).map(function (p) {
		return "<p>" + p.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</p>";
	}).join("");
}

// ── Nested expansion (links between entries) ─────────────────────────────────

function toggleExpansion(link) {
	var id = link.dataset.loreRef;
	if (link._loreExp) {
		link._loreExp.remove();
		link._loreExp = null;
		link.classList.remove("lore-open");
		if (popEl && popEl.contains(link)) placePop();
		return;
	}
	var host = link.closest(".lore-expansion");
	var depth = host ? +host.dataset.depth + 1 : 1;
	if (depth > MAX_DEPTH) { window.open(loreEntryUrl(id), "_blank", "noopener"); return; }
	var e = loreEntry(id);
	var block = link.closest("p, li, blockquote, h3, h4, h5, figcaption, .lore-expansion-body > *") || link.parentElement;
	var box = document.createElement("div");
	box.className = "lore-expansion";
	box.dataset.depth = depth;
	var more = create("a", "lore-expansion-more", "Lore page ↗", box);
	more.href = loreEntryUrl(id);
	more.target = "_blank";
	more.rel = "noopener";
	var body = create("div", ["lore-body", "lore-expansion-body"], false, box);
	var drawn = fill(body, loreBodyHTML(e));
	// After the block, and after any expansions already opened from it.
	var after = block;
	while (after.nextElementSibling && after.nextElementSibling.classList.contains("lore-expansion")) after = after.nextElementSibling;
	after.after(box);
	link._loreExp = box;
	link.classList.add("lore-open");
	if (popEl && popEl.contains(link)) { placePop(); drawn.then(placePop); }
}

// ── Events ───────────────────────────────────────────────────────────────────

function markOf(target) { return target && target.closest ? target.closest("[data-lore]") : null; }

function activate(el, ev) {
	var id = el.dataset.lore, e = loreEntry(id);
	if (!e) { if (!warned[id]) { warned[id] = 1; console.warn("Lore: no entry with id “" + id + "”."); } return; }
	// A tier-1 click still reaches the label or button around the word (ticking
	// a box, focusing a field); a pop-up click goes no further than the card.
	if (e.tier === 1) { showTip(el); return; }
	if (ev) ev.preventDefault();
	hideTip();
	if (popEl && !popEl.hidden && popFor === el) closeLorePop(false);
	else openLoreDialog(id, el);
}

// Start the info tiers on this page. Safe to call more than once.
export function initLore() {
	if (started || typeof document === "undefined") return getLore();
	started = true;
	if (!document.querySelector('link[href="' + CSS_URL + '"]')) {
		var link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = CSS_URL;
		document.head.appendChild(link);
	}
	if (/[?&]lore=pending\b/.test(location.search)) document.documentElement.classList.add("lore-show-pending");

	document.addEventListener("pointerover", function (ev) {
		if (ev.pointerType === "touch") return;
		var el = markOf(ev.target), e = el && loreEntry(el.dataset.lore);
		if (e && e.tier === 1 && tipFor !== el) showTip(el);
	});
	document.addEventListener("pointerout", function (ev) {
		var el = markOf(ev.target);
		if (el && el === tipFor && !el.contains(ev.relatedTarget)) hideTip();
	});
	document.addEventListener("focusin", function (ev) {
		var el = markOf(ev.target), e = el && loreEntry(el.dataset.lore);
		if (e && e.tier === 1) showTip(el);
	});
	document.addEventListener("focusout", function (ev) { if (markOf(ev.target) === tipFor) hideTip(); });
	document.addEventListener("click", function (ev) {
		var al = ev.target.closest && ev.target.closest(".lore-alert:not([data-passive])");
		if (al) {
			ev.preventDefault();
			hideTip();
			if (popEl && !popEl.hidden && popFor === al) closeLorePop(false);
			else showPop(al, alertHTML(loreAlertText(al)), "Alert");
			return;
		}
		var link = ev.target.closest && ev.target.closest("a.lore-link[data-lore-ref]");
		if (link) { ev.preventDefault(); toggleExpansion(link); return; }
		var el = markOf(ev.target);
		if (el) { activate(el, ev); return; }
		if (tipFor) hideTip();
		if (popEl && !popEl.hidden && !popEl.contains(ev.target)) closeLorePop(false);
	});
	document.addEventListener("keydown", function (ev) {
		if (ev.key === "Escape" && popEl && !popEl.hidden) { closeLorePop(true); return; }
		if (ev.key === "Escape" && tipFor) { hideTip(); return; }
		if (ev.key !== "Enter" && ev.key !== " ") return;
		if (ev.target.classList && ev.target.classList.contains("lore-alert") && !("passive" in ev.target.dataset)) {
			ev.preventDefault();
			ev.target.click();
			return;
		}
		var el = markOf(ev.target);
		if (el && el === ev.target) activate(el, ev);
	});
	window.addEventListener("scroll", function (ev) {
		hideTip();
		if (popEl && !popEl.contains(ev.target)) placePop();
	}, { passive: true, capture: true });
	window.addEventListener("resize", placePop);

	if (lore) applyStyles();
	return getLore();
}
