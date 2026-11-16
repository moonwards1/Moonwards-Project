/* Mars-System-Traffic-Plotter/core/terrain — heights of the ground from the
 * MOLA equatorial band, 18 deg S to 18 deg N.
 *
 * The band comes at two levels of detail (terrain/terrain.json describes
 * both; tools/make-terrain.py makes them):
 *
 *   "detail"    32 heights per degree (~1.85 km apart at the equator), cut
 *               into 36 tiles of 10 deg of longitude by the whole band. Only
 *               the tiles a track crosses are fetched.
 *   "overview"  8 per degree (~7.4 km), the whole band in one file, each
 *               height the mean of a 4 x 4 block of the detail grid.
 *
 * Heights are whole metres above the MOLA areoid, 16-bit signed integers,
 * rows north to south. A grid value stands for the centre of its pixel:
 *
 *     lat = latNorth - (row + 0.5) / n          lon = lonWest + (col + 0.5) / n
 *
 *   n  heights per degree; lat, lon in degrees, lon east
 *
 * Between centres a height is interpolated from the four nearest values
 * (bilinear). Columns wrap round at 180 deg; a point outside the band, or on
 * a tile not loaded, has no height (NaN).
 *
 * Pure apart from the fetch function passed in, so Node tests can read the
 * files from disk.
 */

// Reads an ArrayBuffer of 16-bit little-endian integers.
export function decodeInt16LE(buf) {
	var dv = new DataView(buf), n = buf.byteLength >> 1, out = new Int16Array(n);
	for (var i = 0; i < n; i++) out[i] = dv.getInt16(2 * i, true);
	return out;
}

// A terrain with nothing loaded yet. `base` is where terrain.json and the
// .bin files are fetched from (with a trailing slash).
export function createTerrain(manifest, base) {
	return { manifest: manifest, base: base || "", tiles: new Map(), overview: null };
}

// fetchFn(url) → a Promise of a Response-like object with json() and
// arrayBuffer(); the browser's fetch, or a disk reader in tests.
export function loadTerrain(fetchFn, base) {
	return fetchFn(base + "terrain.json")
		.then(function (res) { return res.json(); })
		.then(function (manifest) { return createTerrain(manifest, base); });
}

export function loadOverview(terrain, fetchFn) {
	if (terrain.overview) return Promise.resolve(terrain);
	return fetchFn(terrain.base + terrain.manifest.overview.file)
		.then(function (res) { return res.arrayBuffer(); })
		.then(function (buf) { terrain.overview = decodeInt16LE(buf); return terrain; });
}

// The detail tile holding east longitude `lon`, 0 ... 35.
export function tileIndex(manifest, lon) {
	var d = manifest.detail, count = d.tiles.length;
	var i = Math.floor((wrapLon(lon) - manifest.lonWest) / d.tileDegrees);
	return ((i % count) + count) % count;
}

// The tiles needed to give a height at every one of `lons`. A point near a
// tile's edge is interpolated from the next tile too, so one pixel either
// side counts.
export function tilesFor(manifest, lons) {
	var half = 1 / manifest.detail.perDegree, set = new Set();
	lons.forEach(function (lon) {
		set.add(tileIndex(manifest, lon - half));
		set.add(tileIndex(manifest, lon));
		set.add(tileIndex(manifest, lon + half));
	});
	return Array.from(set).sort(function (a, b) { return a - b; });
}

export function loadTiles(terrain, indices, fetchFn) {
	var d = terrain.manifest.detail;
	return Promise.all(indices.filter(function (i) { return !terrain.tiles.has(i); }).map(function (i) {
		return fetchFn(terrain.base + d.tiles[i])
			.then(function (res) { return res.arrayBuffer(); })
			.then(function (buf) { terrain.tiles.set(i, decodeInt16LE(buf)); });
	})).then(function () { return terrain; });
}

// Longitude into (-180, 180].
export function wrapLon(lon) {
	if (lon > -180 && lon <= 180) return lon;
	var x = ((lon + 180) % 360 + 360) % 360 - 180;
	return x === -180 ? 180 : x;
}

// The grid value at (row, col) of a level, or NaN when its tile is not loaded.
function cell(terrain, level, row, col) {
	var m = terrain.manifest;
	if (level === "overview") {
		var ov = terrain.overview;
		return ov ? ov[row * m.overview.cols + col] : NaN;
	}
	var tc = m.detail.tileCols, t = Math.floor(col / tc), tile = terrain.tiles.get(t);
	return tile ? tile[row * tc + (col - t * tc)] : NaN;
}

// Height in metres above the areoid at (lat, lon) degrees, from one level.
export function heightAt(terrain, lat, lon, level) {
	var m = terrain.manifest, lv = level === "overview" ? "overview" : "detail";
	if (!(lat <= m.latNorth && lat >= m.latSouth)) return NaN;
	var n = m[lv].perDegree, rows = m[lv].rows, cols = 360 * n;
	var x = (wrapLon(lon) - m.lonWest) * n - 0.5;
	var y = (m.latNorth - lat) * n - 0.5;
	var c0 = Math.floor(x), fx = x - c0;
	var r0 = Math.floor(y), fy = y - r0;
	var ra = Math.min(Math.max(r0, 0), rows - 1), rb = Math.min(Math.max(r0 + 1, 0), rows - 1);
	var ca = ((c0 % cols) + cols) % cols, cb = (ca + 1) % cols;
	var top = cell(terrain, lv, ra, ca) * (1 - fx) + cell(terrain, lv, ra, cb) * fx;
	var bottom = cell(terrain, lv, rb, ca) * (1 - fx) + cell(terrain, lv, rb, cb) * fx;
	return top * (1 - fy) + bottom * fy;
}

// The finest level that has a height there: detail if its tiles are loaded,
// else the overview.
export function bestHeightAt(terrain, lat, lon) {
	var h = heightAt(terrain, lat, lon, "detail");
	return isNaN(h) ? heightAt(terrain, lat, lon, "overview") : h;
}
