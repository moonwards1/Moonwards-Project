/* Mars-System-Traffic-Plotter/core/track-profile — the ground under a mass
 * driver's track.
 *
 * A track is given by its muzzle (the release end), the heading it points
 * along at the muzzle, and its length. It runs straight across the ground,
 * which on a sphere is a great circle, so the point a distance d back from
 * the muzzle is reached by heading the opposite way:
 *
 *     lat2 = asin( sin lat1 cos D + cos lat1 sin D cos az )
 *     lon2 = lon1 + atan2( sin az sin D cos lat1,  cos D - sin lat1 sin lat2 )
 *
 *   lat1, lon1  the muzzle
 *   az          heading + 180 deg (azimuth clockwise from north; 90 = east)
 *   D = d / R   the angle d spans at Mars's centre
 *   R           the reference radius, 3,396.19 km (the sphere the MOLA
 *               mosaic is mapped on)
 *
 * The ground is sampled at even steps from the breech (s = 0) to the muzzle
 * (s = length). Between samples the grade is
 *
 *     grade = (h[i+1] - h[i]) / (s[i+1] - s[i])
 *
 *   h  ground height above the areoid, m;  s  distance along the track, m
 *
 * positive when the ground rises toward the muzzle. The muzzle's distance
 * from Mars's centre is R + h. The areoid itself departs from that sphere
 * by a kilometre or two near the equator, so this radius is good to that
 * level, while the heights and grades are exact to the data.
 *
 * Pure: heights come from the function passed in (core/terrain.js gives
 * one), so this knows nothing of tiles or fetching.
 */

export var REFERENCE_RADIUS = 3396190;     // m

// The default site: on the equator where it crosses Pavonis Mons highest.
export var DEFAULT_SITE = { lat: 0, lon: -113.05, heading: 90 };

var DEG = Math.PI / 180;

// The point `dist` metres from (lat, lon) along azimuth `azDeg`, degrees.
export function destination(lat, lon, azDeg, dist, R) {
	var D = dist / (R || REFERENCE_RADIUS), az = azDeg * DEG;
	var p1 = lat * DEG, l1 = lon * DEG;
	var p2 = Math.asin(Math.sin(p1) * Math.cos(D) + Math.cos(p1) * Math.sin(D) * Math.cos(az));
	var l2 = l1 + Math.atan2(Math.sin(az) * Math.sin(D) * Math.cos(p1),
		Math.cos(D) - Math.sin(p1) * Math.sin(p2));
	var lonDeg = l2 / DEG;
	if (!(lonDeg > -180 && lonDeg <= 180)) {
		lonDeg = ((lonDeg + 180) % 360 + 360) % 360 - 180;
		if (lonDeg === -180) lonDeg = 180;
	}
	return { lat: p2 / DEG, lon: lonDeg };
}

// Points along the track from breech to muzzle, `step` metres apart (the
// last step shorter if the length is not a whole number of steps).
//   site: { lat, lon, heading } — the muzzle and its heading, degrees
export function trackPoints(site, length, step) {
	var back = (site.heading == null ? 90 : site.heading) + 180, pts = [];
	var n = Math.ceil(length / step - 1e-9);
	for (var i = 0; i <= n; i++) {
		var s = Math.min(i * step, length), p = destination(site.lat, site.lon, back, length - s);
		pts.push({ s: s, lat: p.lat, lon: p.lon });
	}
	return pts;
}

// The ground along the track.
//   heightFn(lat, lon) → m above the areoid, or NaN where there is no data
//   opts: { length m, step m (default 1,852, the detail grid's spacing) }
// → { points [{ s, lat, lon, h }], breech, muzzle { lat, lon, h, radius },
//     climb (muzzle minus breech, m), meanGrade, maxGrade, minGrade,
//     complete (every point has a height) }
export function trackProfile(heightFn, site, opts) {
	var length = opts.length, step = opts.step || 1852;
	if (!(length > 0)) return { error: "Track length must be positive." };
	var pts = trackPoints(site, length, step), complete = true;
	pts.forEach(function (p) { p.h = heightFn(p.lat, p.lon); if (isNaN(p.h)) complete = false; });
	var breech = pts[0], muzzle = pts[pts.length - 1];
	var maxGrade = -Infinity, minGrade = Infinity;
	for (var i = 0; i + 1 < pts.length; i++) {
		var g = (pts[i + 1].h - pts[i].h) / (pts[i + 1].s - pts[i].s);
		if (g > maxGrade) maxGrade = g;
		if (g < minGrade) minGrade = g;
	}
	var climb = muzzle.h - breech.h;
	return {
		points: pts, complete: complete,
		breech: breech,
		muzzle: { lat: muzzle.lat, lon: muzzle.lon, h: muzzle.h, radius: REFERENCE_RADIUS + muzzle.h },
		climb: climb, meanGrade: climb / length,
		maxGrade: complete ? maxGrade : NaN, minGrade: complete ? minGrade : NaN
	};
}
