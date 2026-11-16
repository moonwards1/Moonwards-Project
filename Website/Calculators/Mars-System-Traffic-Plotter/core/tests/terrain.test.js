// Node tests for core/terrain.js and core/track-profile.js, read against the
// real terrain files. Run from the repo root:
//   node --test Website/Calculators/Mars-System-Traffic-Plotter/core/tests/*.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadTerrain, loadOverview, loadTiles, tilesFor, tileIndex, heightAt,
	bestHeightAt, wrapLon, decodeInt16LE } from "../terrain.js";
import { destination, trackPoints, trackProfile, DEFAULT_SITE, REFERENCE_RADIUS } from "../track-profile.js";

var BASE = fileURLToPath(new URL("../../terrain/", import.meta.url));

// Reads the terrain files from disk in the shape fetch gives.
function diskFetch(path) {
	return readFile(path).then(function (b) {
		return {
			json: function () { return JSON.parse(b.toString("utf8")); },
			arrayBuffer: function () { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
		};
	});
}

function near(x, want, tol, what) {
	assert.ok(Math.abs(x - want) <= tol, (what || "value") + " " + x + " is not within " + tol + " of " + want);
}

async function fullTerrain() {
	var t = await loadTerrain(diskFetch, BASE);
	await loadOverview(t, diskFetch);
	await loadTiles(t, t.manifest.detail.tiles.map(function (_, i) { return i; }), diskFetch);
	return t;
}

test("16-bit little-endian decoding", function () {
	var b = new ArrayBuffer(4), dv = new DataView(b);
	dv.setInt16(0, -5701, true); dv.setInt16(2, 21180, true);
	assert.deepEqual(Array.from(decodeInt16LE(b)), [-5701, 21180]);
});

test("longitudes wrap into (-180, 180]", function () {
	assert.equal(wrapLon(190), -170);
	assert.equal(wrapLon(-180), 180);
	assert.equal(wrapLon(-113.05), -113.05);
});

test("the tiles are the right size and cover the band", async function () {
	var t = await fullTerrain(), d = t.manifest.detail;
	assert.equal(d.tiles.length, 36);
	t.tiles.forEach(function (a) { assert.equal(a.length, d.tileCols * d.rows); });
	assert.equal(t.overview.length, t.manifest.overview.cols * t.manifest.overview.rows);
	assert.equal(tileIndex(t.manifest, -113.05), 6);
	assert.equal(tileIndex(t.manifest, 179.99), 35);
	assert.equal(tileIndex(t.manifest, -180), 0);    // the west edge of the first tile
});

test("a point near a tile edge asks for both tiles", async function () {
	var t = await loadTerrain(diskFetch, BASE);
	assert.deepEqual(tilesFor(t.manifest, [-110.01]), [6, 7]);
	assert.deepEqual(tilesFor(t.manifest, [-115]), [6]);
});

test("heights match known places", async function () {
	var t = await fullTerrain();
	near(heightAt(t, 0, -113.05, "detail"), 14030, 30, "Pavonis Mons on the equator");
	near(heightAt(t, -4.59, 137.44, "detail"), -4500, 100, "Gale crater floor");
	near(heightAt(t, -1.95, -5.53, "detail"), -1400, 100, "Meridiani Planum");
	near(heightAt(t, -4.59, 137.44, "overview"), -4500, 300, "Gale crater floor, overview");
});

test("no height outside the band or on an unloaded tile", async function () {
	var t = await loadTerrain(diskFetch, BASE);
	assert.ok(isNaN(heightAt(t, 0, -113, "detail")));
	await loadOverview(t, diskFetch);
	assert.ok(isNaN(heightAt(t, 18.5, 0, "overview")));
	near(bestHeightAt(t, 0, -113.05), 14030, 600, "falls back to the overview");
});

test("heights run on smoothly across a tile edge and round 180 deg", async function () {
	var t = await fullTerrain();
	var a = heightAt(t, 2, -110.0001, "detail"), b = heightAt(t, 2, -109.9999, "detail");
	near(a, b, 5, "across the -110 edge");
	near(heightAt(t, 5, 179.9999, "detail"), heightAt(t, 5, -179.9999, "detail"), 5, "across 180");
});

test("great-circle steps: east along the equator, and due north", function () {
	var d = 100e3, deg = d / REFERENCE_RADIUS * 180 / Math.PI;
	var e = destination(0, -113, 90, d);
	near(e.lat, 0, 1e-12); near(e.lon, -113 + deg, 1e-9);
	var n = destination(3, 20, 0, d);
	near(n.lat, 3 + deg, 1e-9); near(n.lon, 20, 1e-9);
});

test("track points run from the breech to the muzzle", function () {
	var pts = trackPoints({ lat: 0, lon: -113.05, heading: 90 }, 10e3, 3e3);
	assert.deepEqual(pts.map(function (p) { return p.s; }), [0, 3e3, 6e3, 9e3, 10e3]);
	near(pts[4].lon, -113.05, 1e-9, "last point is the muzzle");
	assert.ok(pts[0].lon < pts[4].lon, "an eastward track starts to the west");
});

test("profile on a plain slope", function () {
	// ground rising 100 m per degree of longitude
	var prof = trackProfile(function (lat, lon) { return 100 * (lon + 200); },
		{ lat: 0, lon: -100, heading: 90 }, { length: 59276, step: 1000 });
	var perMetre = 100 / (REFERENCE_RADIUS * Math.PI / 180);
	near(prof.climb, 100, 0.1, "climb over ~1 degree");
	near(prof.meanGrade, perMetre, 1e-6);
	near(prof.maxGrade, perMetre, 1e-6); near(prof.minGrade, perMetre, 1e-6);
	assert.ok(prof.complete);
	assert.ok(trackProfile(function () { return 0; }, DEFAULT_SITE, { length: 0 }).error);
});

test("the default track climbs the west flank of Pavonis Mons", async function () {
	var t = await fullTerrain();
	var prof = trackProfile(function (lat, lon) { return heightAt(t, lat, lon, "detail"); },
		DEFAULT_SITE, { length: 200e3 });
	assert.ok(prof.complete);
	near(prof.muzzle.h, 14030, 30, "muzzle height");
	near(prof.muzzle.radius, REFERENCE_RADIUS + prof.muzzle.h, 1e-6);
	assert.ok(prof.climb > 5000 && prof.climb < 9000, "climb " + prof.climb);
	assert.ok(prof.maxGrade < 0.25, "no cliff along the flank: " + prof.maxGrade);
});
