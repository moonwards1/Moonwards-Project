// Node tests for Shared/lore-markdown.js. Run from the repo root:
//   node --test Website/Shared/tests/lore-markdown.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseLore, renderMarkdown, loreSlug, loreRefs } from "../lore-markdown.js";

var SAMPLE = [
	"<!-- a comment with ## Not an entry {#nope tier=1} -->",
	"# Tethers",
	"## Balance point (BP) {#balance-point tier=1}",
	"The point where the tether's pulls cancel.",
	"",
	"## Hanging skyhook {tier=2 #hanging-skyhook}",
	"",
	"# Places",
	"## L1 station {#l1-station tier=3}",
	"Para one, see [the BP](#balance-point).",
	"",
	"$$",
	"## not a heading",
	"$$",
].join("\n");

test("parses chapters, entries, tiers and stubs", function () {
	var L = parseLore(SAMPLE);
	assert.deepEqual(L.order, ["balance-point", "hanging-skyhook", "l1-station"]);
	assert.deepEqual(L.chapters.map(function (c) { return [c.title, c.ids]; }),
		[["Tethers", ["balance-point", "hanging-skyhook"]], ["Places", ["l1-station"]]]);
	assert.equal(L.entries["balance-point"].tier, 1);
	assert.equal(L.entries["balance-point"].title, "Balance point (BP)");
	assert.equal(L.entries["hanging-skyhook"].pending, true);
	assert.equal(L.entries["l1-station"].tier, 3);
	assert.match(L.entries["l1-station"].popup, /## not a heading/);
	assert.equal(L.entries.nope, undefined);
	assert.deepEqual(L.problems, []);
});

test("lore blocks show on the Lore page only; notitle is read", function () {
	var L = parseLore([
		"## Basics {#basics tier=2 notitle}",
		"::: lore",
		"Page intro.",
		":::",
		"Pop-up text.",
		"",
		"::: lore",
		"Page outro.",
		":::",
		"## Only page {#only-page tier=3}",
		"::: lore",
		"Background.",
		":::"
	].join("\n"));
	var b = L.entries.basics;
	assert.equal(b.notitle, true);
	assert.equal(b.popup, "Pop-up text.");
	assert.equal(b.page, "Page intro.\n\nPop-up text.\n\nPage outro.");
	assert.equal(b.pending, false);
	assert.equal(L.entries["only-page"].pending, true);
	assert.equal(L.entries["only-page"].page, "Background.");
	assert.deepEqual(L.problems, []);
	assert.equal(parseLore("## A {#a tier=1}\n::: lore\nx").problems.length, 1);
});

test("a missing tier is a linked-only note; a duplicate id is reported", function () {
	var L = parseLore("## Linked {#linked}\nx\n## A {#a tier=4}\n## B {#a tier=1}\ny");
	assert.equal(L.entries.linked.tier, null);
	assert.equal(L.problems.length, 2);   // tier 4, and the duplicate
	assert.deepEqual(L.order, ["linked", "a"]);
	assert.equal(L.entries.a.tier, 1);
});

test("display maths on one line, as its own paragraph or inside one", function () {
	var h = renderMarkdown("$$\\tau = F\\,r$$\n\nSo $$E = 2\\pi\\tau$$ holds, and $v$ too.");
	assert.match(h, /^<div class="lore-math lore-math-display" data-tex="\\tau = F\\,r">/);
	assert.match(h, /So <span class="lore-math lore-math-display" data-tex="E = 2\\pi\\tau">/);
	assert.match(h, /<span class="lore-math" data-tex="v">/);
	assert.doesNotMatch(h, /\$/);
});

test("slugs titles", function () {
	assert.equal(loreSlug("Balance point (BP)"), "balance-point-bp");
	assert.equal(loreSlug("  Pátzcuaro—L1  "), "patzcuaro-l1");
});

test("renders blocks and inline marks", function () {
	var h = renderMarkdown("### Sub\nOne **bold** and *it* line\ncontinued.\n\n- a\n- b `x<y`\n\n1. n\n\n> q");
	assert.match(h, /<h3>Sub<\/h3>/);
	assert.match(h, /<p>One <strong>bold<\/strong> and <em>it<\/em> line continued\.<\/p>/);
	assert.match(h, /<ul><li>a<\/li><li>b <code>x&lt;y<\/code><\/li><\/ul>/);
	assert.match(h, /<ol><li>n<\/li><\/ol>/);
	assert.match(h, /<blockquote><p>q<\/p><\/blockquote>/);
});

test("entry links expand; outside links open a new tab", function () {
	var h = renderMarkdown("See [the BP](#balance-point) and [NASA](https://nasa.gov).");
	assert.match(h, /<a class="lore-link" href="#balance-point" data-lore-ref="balance-point">the BP<\/a>/);
	assert.match(h, /<a href="https:\/\/nasa.gov" target="_blank" rel="noopener">NASA<\/a>/);
	assert.deepEqual(loreRefs("[a](#x) [b](#y) [c](#x)"), ["x", "y"]);
});

test("media resolve against the entries file", function () {
	var base = "https://example.org/Website/Lore/entries.md";
	var h = renderMarkdown("![A tether](images/t.png)\n\n![Spin](media/s.mp4)", { base: base });
	assert.match(h, /<figure class="lore-figure"><img src="https:\/\/example.org\/Website\/Lore\/images\/t.png" alt="A tether"/);
	assert.match(h, /<figcaption>A tether<\/figcaption>/);
	assert.match(h, /<video src="https:\/\/example.org\/Website\/Lore\/media\/s.mp4"/);
});

test("maths is kept literal for KaTeX; stray < is escaped", function () {
	var h = renderMarkdown("Speed $v = \\sqrt{GM/r}$ when r < R and *x*\n\n$$\na_b < c\n$$");
	assert.match(h, /<span class="lore-math" data-tex="v = \\sqrt\{GM\/r\}">/);
	assert.match(h, /r &lt; R/);
	assert.match(h, /<div class="lore-math lore-math-display" data-tex="a_b &lt; c">/);
	assert.doesNotMatch(h, /<em>b <\/em>/);
});

test("[:text](Wikipedia URL) is a preview link; other colon links drop the colon", function () {
	var h = renderMarkdown("See [:space elevator](https://en.wikipedia.org/wiki/Space_elevator) and [:the BP](#balance-point).");
	assert.match(h, /<a class="lore-link lore-wiki" href="https:\/\/en\.wikipedia\.org\/wiki\/Space_elevator" data-lore-wiki="1" target="_blank" rel="noopener">space elevator<\/a>/);
	assert.match(h, /data-lore-ref="balance-point">the BP<\/a>/);
	assert.match(renderMarkdown("[plain](https://en.wikipedia.org/wiki/Moon)"), /<a href="https:\/\/en\.wikipedia\.org\/wiki\/Moon" target="_blank" rel="noopener">plain<\/a>/);
});

test("raw HTML lines pass through", function () {
	assert.equal(renderMarkdown('<iframe src="x"></iframe>'), '<iframe src="x"></iframe>');
});

test("the site's entries file parses cleanly", function () {
	var L = parseLore(readFileSync(new URL("../../Lore/entries.md", import.meta.url), "utf8"));
	assert.deepEqual(L.problems, []);
});
