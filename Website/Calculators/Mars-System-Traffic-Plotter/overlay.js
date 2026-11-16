/* Mars-System-Traffic-Plotter/overlay — what is drawn over the scene of
 * scene.js: the facilities, and the flight with its ship.
 *
 * Like the scene it computes nothing: a facility's points come from
 * core/facilities.js, the flight from core/flight.js, and both are put
 * through the axes of the current view (core/view-frames.js).
 *
 * A facility is drawn where it is at the scene's instant. The flight's path
 * is drawn as the view sees it: in a turning view each point of the path goes
 * through the view's axes at ITS OWN instant, so the path is the ship's track
 * against whatever the view holds still.
 */
/* global THREE */

import { OrbitalMath } from "../../Shared/math-utils.js";
import { makePoint } from "../../Shared/sim/body-renderer.js";
import { makeShipSprite } from "../../Shared/sim/marker-card.js";
import { viewBasis, toView } from "./core/view-frames.js";
import { skyhookAt, tetherPointState } from "./core/facilities.js";
import { flightStateAt } from "./core/flight.js";
import { U } from "./scene.js";

var O = OrbitalMath;
var DAY = 86400;
export var COLOR = { tether: 0xeaf0ff, top: 0x9fb6ff, foot: 0x8fd0c8, release: 0xff5fd0,
                     orbit: 0x40d27f, escape: 0xff9a3c, entry: 0xff6f61 };
var TRACE_POINTS = 120;

function movingLine(count, colorHex, opacity) {
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
	var line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: colorHex, transparent: true,
		opacity: opacity, depthWrite: false }));
	line.frustumCulled = false;
	return line;
}
function setPoint(attr, k, p) { attr.setXYZ(k, p[0] / U, p[1] / U, p[2] / U); }

export function buildOverlay(scene) {
	// ---- the Phobos skyhook ----
	var hook = new THREE.Group();
	var tether = movingLine(2, COLOR.tether, 0.95);
	var footTrace = movingLine(TRACE_POINTS + 1, COLOR.foot, 0.45);
	var topTrace = movingLine(TRACE_POINTS + 1, COLOR.top, 0.45);
	var foot = makePoint(COLOR.foot, 6), top = makePoint(COLOR.top, 6), release = makePoint(COLOR.release, 10);
	[tether, footTrace, topTrace, foot, top, release].forEach(function (o) { hook.add(o); });
	release.renderOrder = 13;
	scene.add(hook);

	// ---- the flight ----
	var path = null;
	var ship = makeShipSprite();
	ship.visible = false;
	scene.add(ship);
	var shipDir = new THREE.Vector3(1, 0, 0);

	// What the camera can follow and the cursor can pick: id -> { pos, label }.
	var markers = {
		"phobosSkyhook:foot": { pos: foot.position, label: "skyhook foot" },
		"phobosSkyhook:top": { pos: top.position, label: "skyhook top" },
		"phobosSkyhook:release": { pos: release.position, label: "release point" }
	};

	return {
		markers: markers, ship: ship, shipDir: shipDir,

		// The skyhook `fig` (core/facilities.js) as it is at jd; hidden when
		// `shown` is false or its figures are not ok. Returns skyhookAt's result.
		drawSkyhook: function (fig, jd, viewId, shown) {
			hook.visible = !!(shown && fig && fig.ok);
			if (!hook.visible) { return null; }
			var B = viewBasis(viewId, jd), at = skyhookAt(fig, jd);
			function put(obj, s) {
				var p = toView(B, tetherPointState(at, s).r);
				obj.position.set(p[0] / U, p[1] / U, p[2] / U);
				return p;
			}
			var pos = tether.geometry.attributes.position;
			setPoint(pos, 0, put(foot, fig.sFoot)); setPoint(pos, 1, put(top, fig.sTop));
			pos.needsUpdate = true;
			put(release, fig.sRel);
			// Where the foot and the top go over one orbit, centred on this
			// instant, drawn in this instant's axes.
			var fp = footTrace.geometry.attributes.position, tp = topTrace.geometry.attributes.position;
			for (var k = 0; k <= TRACE_POINTS; k++) {
				var atK = skyhookAt(fig, jd + (k / TRACE_POINTS - 0.5) * fig.period / DAY);
				setPoint(fp, k, toView(B, tetherPointState(atK, fig.sFoot).r));
				setPoint(tp, k, toView(B, tetherPointState(atK, fig.sTop).r));
			}
			fp.needsUpdate = true; tp.needsUpdate = true;
			return at;
		},

		// The flight's path, as the view sees it. `flight` is core/flight.js's
		// result; nothing is drawn for one that is not ok, or when not shown.
		drawFlight: function (flight, viewId, shown) {
			if (path) { scene.remove(path); path.geometry.dispose(); path.material.dispose(); path = null; }
			if (!shown || !flight || !flight.ok) { return; }
			var fixed = viewId === "stars" ? viewBasis(viewId, flight.jd) : null;
			var pts = flight.leg.samples.map(function (s) {
				var p = toView(fixed || viewBasis(viewId, flight.jd + s.t / DAY), s.r);
				return new THREE.Vector3(p[0] / U, p[1] / U, p[2] / U);
			});
			path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
				new THREE.LineBasicMaterial({ color: COLOR[flight.summary.outcome], transparent: true,
					opacity: 0.95, depthWrite: false }));
			path.frustumCulled = false;
			scene.add(path);
		},

		// The ship t seconds into the flight, and the way it is heading in the view.
		placeShip: function (flight, t, viewId, shown) {
			ship.visible = !!(shown && flight && flight.ok);
			if (!ship.visible) { return; }
			function at(tt) {
				var s = flightStateAt(flight, tt);
				return toView(viewBasis(viewId, s.jde), s.r);
			}
			var dur = flight.leg.duration, step = Math.max(1, Math.min(30, dur / 200));
			var t0 = Math.max(0, Math.min(dur - step, t)), a = at(t0), b = at(t0 + step), here = at(t);
			ship.position.set(here[0] / U, here[1] / U, here[2] / U);
			var d = O.vUnit(O.vSub(b, a));
			if (O.vMag(d) > 0) { shipDir.set(d[0], d[1], d[2]); }
		}
	};
}
