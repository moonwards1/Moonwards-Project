"""Builds the plotter's terrain files from the MOLA equatorial band.

Input: the band 18 deg S to 18 deg N exported from TerreSculptor as a 32-bit
floating-point TIFF with File Scale "Normal" (11,520 x 1,152 pixels, 32 per
degree, west edge at 180 deg W, north row first). TerreSculptor stores heights
as fractions of the source mosaic's global range, so each value v becomes

    h = H0 + v * (H1 - H0)

    h   height above the MOLA areoid, m
    v   the stored fraction, 0 to 1
    H0  the elevation TerreSculptor maps to 0  (-8,201 m, the floor of Hellas)
    H1  the elevation TerreSculptor maps to 1  (+21,241 m, Olympus Mons)

Output, in ../terrain/:
    detail/lon<W>.bin  36 tiles, each 10 deg of longitude by the full band,
                       320 x 1,152 heights at 32 per degree, W = the tile's
                       west edge in east longitude (-180 ... 170)
    overview.bin       the whole band at 8 per degree, 2,880 x 288, each
                       height the mean of a 4 x 4 block of the detail grid
    terrain.json       the grid description core/terrain.js reads

Every .bin is 16-bit signed integers, little-endian, whole metres, rows
north to south, each row west to east.

Run from the repo root:
    python3 Website/Calculators/Mars-System-Traffic-Plotter/tools/make-terrain.py
(needs numpy and tifffile).
"""
import json
import sys
from pathlib import Path

import numpy as np
import tifffile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SOURCE = REPO / "Mars_MGS_MOLA_DEM_mosaic_11520x1152_equator.tif"
OUT = HERE.parent / "terrain"

H0, H1 = -8201.0, 21241.0
PPD = 32                      # detail pixels per degree
LAT_N, LAT_S = 18.0, -18.0
LON_W = -180.0
TILE_DEG = 10
OVERVIEW_BLOCK = 4            # detail pixels per overview pixel, each way
REFERENCE_RADIUS = 3396190.0  # m, the sphere the MOLA mosaic is mapped on

# Landmarks the output is checked against: (name, lat, east lon, expected m, tolerance m).
# The summits are the highest detail pixel within 2 deg; the landing sites a 3 x 3 mean.
SUMMITS = [("Pavonis Mons", 0.4, -112.8, 14050, 150),
           ("Arsia Mons", -8.3, -120.1, 17760, 150),
           ("Ascraeus Mons", 11.9, -104.1, 18220, 150)]
SITES = [("Gale crater floor (Curiosity)", -4.59, 137.44, -4500, 100),
         ("Meridiani Planum (Opportunity)", -1.95, -5.53, -1400, 100),
         ("Gusev crater (Spirit)", -14.57, 175.47, -1930, 100)]


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    v = tifffile.imread(src).astype(np.float64)
    rows, cols = v.shape
    if (rows, cols) != (round((LAT_N - LAT_S) * PPD), 360 * PPD):
        sys.exit(f"expected 1152 x 11520 pixels, got {rows} x {cols}")
    if v.min() < 0 or v.max() > 1:
        sys.exit(f"values run {v.min()} to {v.max()}: not a File Scale 'Normal' export")

    h = H0 + v * (H1 - H0)
    detail = np.clip(np.rint(h), -32768, 32767).astype("<i2")

    def rc(lat, lon):
        return int(round((LAT_N - lat) * PPD - 0.5)), int(round((lon - LON_W) * PPD - 0.5))

    ok = True
    for name, lat, lon, want, tol in SUMMITS:
        r, c = rc(lat, lon)
        w = 2 * PPD
        got = int(detail[max(r - w, 0):r + w + 1, c - w:c + w + 1].max())
        ok &= abs(got - want) <= tol
        print(f"  {name:32s} {got:7d} m  (about {want})")
    for name, lat, lon, want, tol in SITES:
        r, c = rc(lat, lon)
        got = float(detail[r - 1:r + 2, c - 1:c + 2].mean())
        ok &= abs(got - want) <= tol
        print(f"  {name:32s} {got:7.0f} m  (about {want})")
    if not ok:
        sys.exit("a landmark is off: check the export before using these files")

    (OUT / "detail").mkdir(parents=True, exist_ok=True)
    tile_cols = TILE_DEG * PPD
    tiles = []
    for i in range(360 // TILE_DEG):
        west = int(LON_W + i * TILE_DEG)
        name = f"detail/lon{west}.bin"
        detail[:, i * tile_cols:(i + 1) * tile_cols].tofile(OUT / name)
        tiles.append(name)

    b = OVERVIEW_BLOCK
    ov = h.reshape(rows // b, b, cols // b, b).mean(axis=(1, 3))
    np.clip(np.rint(ov), -32768, 32767).astype("<i2").tofile(OUT / "overview.bin")

    manifest = {
        "source": "MGS MOLA DEM mosaic 463 m (USGS Astrogeology), band 18 S - 18 N, "
                  "averaged to 32 per degree in TerreSculptor",
        "units": "m above the MOLA areoid",
        "format": "int16 little-endian, rows north to south, each row west to east",
        "referenceRadius": REFERENCE_RADIUS,
        "latNorth": LAT_N, "latSouth": LAT_S, "lonWest": LON_W,
        "detail": {"perDegree": PPD, "rows": rows, "tileDegrees": TILE_DEG,
                   "tileCols": tile_cols, "tiles": tiles},
        "overview": {"perDegree": PPD // b, "rows": rows // b, "cols": cols // b,
                     "file": "overview.bin"},
        "range": [int(detail.min()), int(detail.max())],
    }
    (OUT / "terrain.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"wrote {len(tiles)} tiles and the overview to {OUT}; heights {manifest['range']}")


if __name__ == "__main__":
    main()
