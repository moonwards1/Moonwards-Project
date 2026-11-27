// Wikipedia previews inside lore entries. Pure logic, no DOM or network:
// recognises a Wikipedia article link, names the page-summary URL to fetch,
// and turns the summary into HTML for an expansion. lore.js does the fetching.
//
// The summary is what Wikipedia's own hover previews show: the article's
// opening text and its lead image. Only that one image comes with it; a
// picture further down the article is not part of a preview.

var HOST = /^([a-z][a-z0-9-]*)(?:\.m)?\.wikipedia\.org$/i;
var LICENCE = "https://creativecommons.org/licenses/by-sa/4.0/";
var BIG = 900;   // px; a still image wider than this shows as Wikipedia's thumbnail

function esc(s) {
	return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// { lang, title, page } for a Wikipedia article URL, else null. A #section
// on the URL is ignored: a preview always shows the article's opening.
export function wikiRef(href) {
	var u;
	try { u = new URL(href); } catch (e) { return null; }
	var h = HOST.exec(u.hostname);
	var m = /^\/wiki\/(.+)$/.exec(u.pathname);
	if (!h || !m) return null;
	var title;
	try { title = decodeURIComponent(m[1]); } catch (e) { title = m[1]; }
	title = title.replace(/_/g, " ");
	if (/^(Special|File|Category|Help|Talk|User|Wikipedia|Portal|Template):/i.test(title)) return null;
	var lang = h[1].toLowerCase();
	return { lang: lang, title: title, page: "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")) };
}

// The page-summary endpoint for `ref` (the one Wikipedia's hover previews use).
export function wikiSummaryUrl(ref) {
	return "https://" + ref.lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(ref.title.replace(/ /g, "_"));
}

// The summary's extract HTML with only plain text markup kept: every other
// tag is dropped (its text stays) and no attributes survive.
var KEEP = { p: 1, b: 1, i: 1, strong: 1, em: 1, sub: 1, sup: 1, br: 1, span: 1, ul: 1, ol: 1, li: 1 };
export function cleanExtract(html) {
	return String(html || "")
		.replace(/<(script|style|math)\b[\s\S]*?<\/\1>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(\/?)([a-z0-9]+)\b[^>]*>/gi, function (_, close, tag) {
			tag = tag.toLowerCase();
			return KEEP[tag] ? "<" + close + tag + ">" : "";
		})
		.trim();
}

// The image's description page, which carries its own licence.
function filePage(src, lang) {
	var m = /\/wikipedia\/([a-z0-9-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(src);
	if (!m) return null;
	var host = m[1] === "commons" ? "commons.wikimedia.org" : m[1] + ".wikipedia.org";
	return "https://" + host + "/wiki/File:" + m[2];
}

// Which picture to show. An animated GIF always uses the uploaded file: a
// scaled GIF over Wikimedia's size limit (width × height × frames above 100
// megapixels) is a single still frame. Other images use the original unless
// it is large, when Wikipedia's thumbnail is lighter and looks the same here.
export function wikiImage(summary) {
	var o = summary && summary.originalimage, t = summary && summary.thumbnail;
	if (o && o.source && (/\.gif$/i.test(o.source) || !(o.width > BIG) || !t)) return o;
	return t && t.source ? t : null;
}

// HTML for an expansion from a page summary: the lead image (linked to its
// description page), the opening text, and the credit Wikipedia's licence asks for.
export function wikiPreviewHTML(summary, ref) {
	summary = summary || {};
	var out = [];
	var img = wikiImage(summary);
	if (img) {
		var w = +img.width || 0, h = +img.height || 0;
		var size = w && h ? ' width="' + w + '" height="' + h + '" style="aspect-ratio:' + w + "/" + h + ";width:min(100%," + w + 'px)"' : "";
		var tag = '<img src="' + esc(img.source) + '" alt="" loading="lazy"' + size + ">";
		var fp = filePage(img.source, ref.lang);
		if (fp) tag = '<a href="' + esc(fp) + '" target="_blank" rel="noopener" title="Image source and licence">' + tag + "</a>";
		out.push('<figure class="lore-figure lore-wiki-figure">' + tag + "</figure>");
	}
	var text = cleanExtract(summary.extract_html);
	if (!text && summary.extract) text = "<p>" + esc(summary.extract) + "</p>";
	if (text && !/^<p>/.test(text)) text = "<p>" + text + "</p>";
	out.push(text || '<p class="lore-pending-note">Wikipedia has no summary for this article.</p>');
	var page = (summary.content_urls && summary.content_urls.desktop && summary.content_urls.desktop.page) || ref.page;
	out.push('<p class="lore-wiki-credit">From <a href="' + esc(page) + '" target="_blank" rel="noopener">Wikipedia: ' +
		esc((summary.titles && summary.titles.normalized) || String(summary.title || ref.title).replace(/_/g, " ")) + '</a> · <a href="' + LICENCE + '" target="_blank" rel="noopener">CC BY-SA 4.0</a></p>');
	return out.join("\n");
}
