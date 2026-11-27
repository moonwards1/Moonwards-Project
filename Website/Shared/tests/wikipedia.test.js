// Node tests for Shared/wikipedia.js. Run from the repo root:
//   node --test Website/Shared/tests/wikipedia.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { wikiRef, wikiSummaryUrl, cleanExtract, wikiImage, wikiPreviewHTML } from "../wikipedia.js";

test("article links are recognised, other pages are not", function () {
	var r = wikiRef("https://en.wikipedia.org/wiki/Space_elevator#Physics");
	assert.deepEqual(r, { lang: "en", title: "Space elevator", page: "https://en.wikipedia.org/wiki/Space_elevator" });
	assert.equal(wikiRef("https://fr.m.wikipedia.org/wiki/Baguette_(pain)").lang, "fr");
	assert.equal(wikiRef("https://en.wikipedia.org/wiki/L%C3%A9vy_flight").title, "Lévy flight");
	assert.equal(wikiRef("https://en.wikipedia.org/wiki/File:Moon.gif"), null);
	assert.equal(wikiRef("https://example.com/wiki/Moon"), null);
	assert.equal(wikiRef("#moon"), null);
});

test("summary URL", function () {
	assert.equal(wikiSummaryUrl(wikiRef("https://en.wikipedia.org/wiki/AC/DC")),
		"https://en.wikipedia.org/api/rest_v1/page/summary/AC%2FDC");
});

test("extract keeps plain markup only", function () {
	assert.equal(cleanExtract('<p class="x">A <b onclick="y">bold</b> <a href="z">link</a><script>bad()</script></p>'),
		"<p>A <b>bold</b> link</p>");
});

test("an animated GIF always uses the uploaded file; a large still uses the thumbnail", function () {
	var gif = { originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Orbit.gif", width: 2000, height: 2000 },
		thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Orbit.gif/320px-Orbit.gif", width: 320, height: 320 } };
	assert.equal(wikiImage(gif), gif.originalimage);
	var jpg = { originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Moon.jpg", width: 4000, height: 3000 },
		thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Moon.jpg/320px-Moon.jpg", width: 320, height: 240 } };
	assert.equal(wikiImage(jpg), jpg.thumbnail);
	assert.equal(wikiImage({}), null);
});

test("preview HTML: image linked to its file page, text, credit", function () {
	var ref = wikiRef("https://en.wikipedia.org/wiki/Orbit");
	var h = wikiPreviewHTML({
		titles: { normalized: "Orbit" },
		extract_html: "<p>An <b>orbit</b> is a path.</p>",
		originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Orbit.gif", width: 300, height: 200 },
	}, ref);
	assert.match(h, /href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Orbit\.gif"/);
	assert.match(h, /<img src="https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/a\/ab\/Orbit\.gif"/);
	assert.match(h, /<p>An <b>orbit<\/b> is a path\.<\/p>/);
	assert.match(h, /Wikipedia: Orbit<\/a> · <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/"/);
});
