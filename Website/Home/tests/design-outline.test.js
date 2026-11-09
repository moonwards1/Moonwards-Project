// Node tests for the design outline. Run from the repo root:
//   node --test Website/Home/tests/
//
// The rows themselves are read from the page (Shared/card-outline.js) and
// checked in a browser; this covers the document built from them.

import test from "node:test";
import assert from "node:assert/strict";

import { designOutline } from "../design-outline.js";

var design = { name: "Test design", bodies: [
	{ body: "Moon", inst: [{ id: "a", fam: "skyhook", v: "hanging" }, { id: "b", fam: "driver", v: "surface" }] },
	{ body: "Psyche", inst: [] }
] };
var outlines = {
	a: { warning: "Foot below the surface", cards: [
		{ tab: "log", side: "in", title: "Freighter", tag: "standard", rows: [{ label: "Payload", value: "5 kt", note: "", depth: 0 }] },
		{ tab: "arch", side: "out", title: "Tether", tag: "", rows: [
			{ label: "By section", value: "", note: "", depth: 0, head: true },
			{ label: "Top | deck", value: "12 MN", note: "peak", depth: 1 }] },
		{ tab: "arch", side: "in", title: "Anchor", tag: "", rows: [] }
	] },
	b: null
};

test("the summary table lists each body's installations by family", function () {
	var md = designOutline(design, outlines, { date: "2026-11-09" });
	assert.match(md, /^# Test design — outline/);
	assert.match(md, /on 2026-11-09\./);
	assert.match(md, /\| Body \| Skyhook \| Space Elevator \| Kinetic Launcher \|/);
	assert.match(md, /\| Moon \| Hanging \| — \| Mass driver \|/);
	assert.match(md, /\| Psyche \| — \| — \| — \|/);
});

test("tabs run in working order, inputs before results", function () {
	var md = designOutline(design, outlines, {});
	var at = function (s) { return md.indexOf(s); };
	assert.ok(at("## Moon · Hanging skyhook") < at("### Architecture"));
	assert.ok(at("### Architecture") < at("##### Anchor"));
	assert.ok(at("##### Anchor") < at("##### Tether"));
	assert.ok(at("##### Tether") < at("### Logistics"));
	assert.ok(md.indexOf("#### Inputs", at("### Architecture")) < at("#### Results"));
	assert.match(md, /> ⚠ Foot below the surface/);
});

test("card rows become a table; folds nest and pipes are escaped", function () {
	var md = designOutline(design, outlines, {});
	assert.match(md, /##### Freighter \(standard\)\n\n\| Item \| Value \|\n\|---\|---\|\n\| Payload \| 5 kt \|/);
	assert.match(md, /\| Item \| Value \| Note \|/);
	assert.match(md, /\| \*\*By section\*\* \|  \|  \|/);
	assert.match(md, /\| › Top \\\| deck \| 12 MN \| peak \|/);
	assert.match(md, /##### Anchor\n\n_Nothing to show yet\._/);
});

test("an installation whose calculator didn't load says so", function () {
	var md = designOutline(design, outlines, {});
	assert.match(md, /## Moon · Mass driver\n\n_The calculator for this installation didn't load/);
});
