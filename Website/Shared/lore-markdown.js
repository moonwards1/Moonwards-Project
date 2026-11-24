// Lore entries: the shared text behind the site's three info tiers and the
// Lore page. Pure logic, no DOM — parses Website/Lore/entries.md into entries
// and renders an entry's Markdown body to an HTML string.
//
// File format (written by hand; see the comment at the top of entries.md):
//   # Chapter title                      groups entries on the Lore page
//   ## Entry title {#entry-id tier=2}    starts an entry; tier is 1, 2 or 3;
//                                        the title heads it on the Lore page
//                                        only (`notitle` hides it there too)
//   body text in Markdown                the pop-up text; empty = a stub
//   ::: lore                             a block shown only on the Lore page,
//   …                                    before, after or between the
//   :::                                  pop-up text
//
// Body Markdown: paragraphs, ### / #### subheadings, - and 1. lists,
// > quotes, **bold**, *italic*, `code`, [text](url), [text](#entry-id) for a
// nested expansion of another entry, ![caption](image-or-video), $tex$ and
// $$ display maths $$, and raw HTML lines (a line that starts with "<").
// HTML comments are dropped everywhere.

// ── Parsing the file ─────────────────────────────────────────────────────────

var ENTRY_HEAD = /^##\s+(.*?)\s*(?:\{([^}]*)\})?\s*$/;
var CHAPTER_HEAD = /^#\s+(.*?)\s*$/;

// A lower-case, hyphenated id from a title: "Balance point (BP)" → "balance-point-bp".
export function loreSlug(text) {
	return String(text).toLowerCase()
		.normalize("NFKD").replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readAttrs(attrText) {
	var out = { id: null, tier: null, notitle: false };
	String(attrText || "").split(/\s+/).forEach(function (tok) {
		if (!tok) return;
		if (tok[0] === "#") out.id = tok.slice(1);
		if (tok === "notitle") out.notitle = true;
		var m = /^tier\s*=\s*(\d)$/.exec(tok);
		if (m) out.tier = +m[1];
	});
	return out;
}

// parseLore(text) → {
//   entries:  { id → { id, title, notitle, tier, chapter,
//                      popup,      the pop-up text (Markdown), lore blocks dropped
//                      page,       the Lore page text, lore blocks included
//                      pending } } (true while the pop-up text is empty)
//   order:    [id, …] in file order,
//   chapters: [{ title, ids: [id, …] }, …]   (title "" for entries before any chapter),
//   problems: [string, …]                    (duplicate ids, bad tiers)
// }
export function parseLore(text) {
	var src = String(text || "").replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
	var lines = src.split("\n");
	var entries = {}, order = [], chapters = [], problems = [];
	var chapter = null, cur = null, inFence = false;

	function close() {
		if (!cur) return;
		var parts = splitLoreBlocks(cur.lines);
		cur.popup = parts.popup;
		cur.page = parts.page;
		cur.pending = cur.popup === "";
		if (parts.open) problems.push("“" + cur.title + "” has a “::: lore” block with no closing “:::”.");
		delete cur.lines;
		cur = null;
	}
	function chapterNamed(title) {
		var c = { title: title, ids: [] };
		chapters.push(c);
		return c;
	}

	lines.forEach(function (line) {
		if (/^\s*\$\$\s*$/.test(line)) inFence = !inFence;   // no headings inside display maths
		var m = !inFence && ENTRY_HEAD.exec(line);
		if (m) {
			close();
			var a = readAttrs(m[2]);
			var id = a.id || loreSlug(m[1]);
			var tier = a.tier;
			if (tier == null) { tier = 2; problems.push("“" + m[1] + "” has no tier; using tier 2."); }
			else if (tier < 1 || tier > 3) { problems.push("“" + m[1] + "” has tier " + tier + "; tiers are 1, 2 or 3."); tier = 2; }
			if (entries[id]) { problems.push("Two entries use the id “" + id + "”; the later one wins."); }
			else order.push(id);
			if (!chapter) chapter = chapterNamed("");
			if (chapter.ids.indexOf(id) < 0) chapter.ids.push(id);
			cur = { id: id, title: m[1], notitle: a.notitle, tier: tier, chapter: chapter.title, lines: [] };
			entries[id] = cur;
			return;
		}
		m = !inFence && CHAPTER_HEAD.exec(line);
		if (m) { close(); chapter = chapterNamed(m[1]); return; }
		if (cur) cur.lines.push(line);
	});
	close();
	return { entries: entries, order: order, chapters: chapters.filter(function (c) { return c.ids.length || c.title; }), problems: problems };
}

// An entry's lines split into its pop-up text (outside "::: lore" blocks) and
// its Lore page text (everything, the block markers removed).
function splitLoreBlocks(lines) {
	var popup = [], page = [], inLore = false;
	lines.forEach(function (line) {
		if (!inLore && /^\s*:::\s*lore\s*$/i.test(line)) { inLore = true; page.push(""); return; }
		if (inLore && /^\s*:::\s*$/.test(line)) { inLore = false; page.push(""); return; }
		page.push(line);
		if (!inLore) popup.push(line);
	});
	function trim(a) { return a.join("\n").replace(/^\s+|\s+$/g, "").replace(/\n{3,}/g, "\n\n"); }
	return { popup: trim(popup), page: trim(page), open: inLore };
}

// ── Rendering a body ─────────────────────────────────────────────────────────

function escAttr(s) {
	return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escText(s) {
	return String(s).replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;")
		.replace(/<(?![a-zA-Z\/!])/g, "&lt;");
}

var VIDEO = /\.(mp4|webm|ogv|mov)(\?.*)?$/i;

// Resolve a relative media/link path against `base` (the URL of entries.md),
// so an entry renders the same on any page that shows it.
function resolve(url, base) {
	if (!base || /^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url)) return url;
	try { return new URL(url, base).href; } catch (e) { return url; }
}

function media(src, caption, base) {
	var u = escAttr(resolve(src, base));
	var cap = caption ? escText(caption) : "";
	var el = VIDEO.test(src)
		? '<video src="' + u + '" controls preload="metadata"></video>'
		: '<img src="' + u + '" alt="' + escAttr(caption || "") + '" loading="lazy">';
	return '<figure class="lore-figure">' + el + (cap ? "<figcaption>" + inline(cap, base, true) + "</figcaption>" : "") + "</figure>";
}

// Inline Markdown → HTML. Code spans and maths are set aside first so their
// contents stay literal.
function inline(text, base, already) {
	var keep = [];
	function stash(html) { keep.push(html); return "\u0000" + (keep.length - 1) + "\u0000"; }
	var s = String(text);
	s = s.replace(/`([^`]+)`/g, function (_, c) { return stash("<code>" + escAttr(c) + "</code>"); });
	s = s.replace(/\$([^$\n]+?)\$/g, function (_, t) {
		return stash('<span class="lore-math" data-tex="' + escAttr(t) + '">' + escAttr(t) + "</span>");
	});
	if (!already) s = escText(s);
	s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (_, alt, src) {
		return stash('<img class="lore-inline-img" src="' + escAttr(resolve(src, base)) + '" alt="' + escAttr(alt) + '">');
	});
	s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
		if (href[0] === "#" && href.length > 1) {
			var id = href.slice(1);
			return stash('<a class="lore-link" href="#' + escAttr(id) + '" data-lore-ref="' + escAttr(id) + '">' + label + "</a>");
		}
		return stash('<a href="' + escAttr(resolve(href, base)) + '" target="_blank" rel="noopener">' + label + "</a>");
	});
	s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>");
	s = s.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1<em>$2</em>");
	s = s.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1<em>$2</em>");
	return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return keep[+i]; });
}

// renderMarkdown(md, { base }) → HTML string.
export function renderMarkdown(md, opts) {
	var base = opts && opts.base;
	var lines = String(md || "").replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n");
	var out = [], para = [], list = null, quote = [];

	function flushPara() {
		if (!para.length) return;
		var text = para.join(" ").trim();
		para = [];
		var m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(text);
		if (m) { out.push(media(m[2], m[3] || m[1], base)); return; }
		out.push("<p>" + inline(text, base) + "</p>");
	}
	function flushList() {
		if (!list) return;
		out.push("<" + list.tag + ">" + list.items.map(function (it) { return "<li>" + inline(it, base) + "</li>"; }).join("") + "</" + list.tag + ">");
		list = null;
	}
	function flushQuote() {
		if (!quote.length) return;
		out.push("<blockquote>" + renderMarkdown(quote.join("\n"), opts) + "</blockquote>");
		quote = [];
	}
	function flushAll() { flushPara(); flushList(); flushQuote(); }

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		if (/^\s*\$\$\s*$/.test(line)) {
			flushAll();
			var tex = [];
			for (i++; i < lines.length && !/^\s*\$\$\s*$/.test(lines[i]); i++) tex.push(lines[i]);
			var t = tex.join("\n").trim();
			out.push('<div class="lore-math lore-math-display" data-tex="' + escAttr(t) + '">' + escAttr(t) + "</div>");
			continue;
		}
		if (/^\s*$/.test(line)) { flushAll(); continue; }
		var m;
		if ((m = /^(#{3,6})\s+(.*)$/.exec(line))) {
			flushAll();
			var lvl = Math.min(m[1].length, 5);
			out.push("<h" + lvl + ">" + inline(m[2], base) + "</h" + lvl + ">");
			continue;
		}
		if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); quote.push(m[1]); continue; }
		flushQuote();
		if ((m = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line))) {
			flushPara();
			var tag = /\d/.test(m[1]) ? "ol" : "ul";
			if (list && list.tag !== tag) flushList();
			if (!list) list = { tag: tag, items: [] };
			list.items.push(m[2]);
			continue;
		}
		if (list && /^\s+\S/.test(line)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
		flushList();
		if (/^\s*<[a-zA-Z\/!]/.test(line) && !para.length) { out.push(line); continue; }
		para.push(line.trim());
	}
	flushAll();
	return out.join("\n");
}

// The ids of other entries an entry's body links to, in order, without repeats.
export function loreRefs(md) {
	var ids = [], re = /\]\(#([^)\s]+)\)/g, m;
	while ((m = re.exec(String(md || "")))) if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
	return ids;
}
