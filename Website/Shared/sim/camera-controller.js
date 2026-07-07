/* Shared/sim/camera-controller.js
 *
 * The custom drag/pan/zoom orbiter shared by every plotter's Three.js view
 * (OrbitControls isn't file://-safe, and the project no longer needs the
 * file:// fallback, but the custom controller stayed since it already grew
 * project-specific features OrbitControls doesn't have: cursor-centred zoom,
 * a focus lock that survives the date changing, and deferred single-click
 * vs. double-click picking).
 *
 * Extracted from three near-duplicate copies (Solar-System-Trajectory-Plotter,
 * Moon-Skyhook-Trajectory-Plotter, Mars-Phobos-Skyhook-Trajectory-Plotter —
 * see Website/ARCHITECTURE.md, "Step 1: scene kit"). The copies had genuine
 * behavioural divergences, not just cosmetic ones:
 *
 * - Cursor-centred zoom: the Solar System plotter projected the cursor onto a
 *   depth-plane through the camera target; the Moon-Skyhook/Mars-Phobos
 *   plotters instead raycast a real hit (falling back to a body's
 *   sphere-of-influence, then to empty-space dolly) — a later, better fix per
 *   an inline comment in the source. That raycast approach is the ONE TRUE
 *   implementation here (see `raycastPickPoint`); the plane-projection math
 *   was not ported.
 * - A body "focus lock" (double-click a body to center + zoom on it) behaves
 *   differently per tool: the Solar System plotter releases the lock on the
 *   very next scroll (scrolling always re-targets under the cursor there);
 *   the dual-view plotters' body-local views instead zoom in place while
 *   locked, releasing only on a pan. Both are supported (`isLocked` vs.
 *   `onFreeZoom`), matching each call site's prior behaviour exactly.
 * - Shift held while scrolling gives ~5x finer zoom in the dual-view
 *   plotters; the Solar System plotter never had this. Opt in via
 *   `shiftZoom: true`.
 * - The dual-view plotters interleave *other* drags (the release-marker,
 *   waypoint gizmos) into the same mousedown/mousemove chain. That isn't
 *   camera code, so it never moved here — `captureDrag`/`onCapturedMove`/
 *   `onCapturedEnd` let a plotter intercept a press before the controller
 *   decides it's a rotate/pan.
 *
 * A dual-view plotter (body-local view + heliocentric "Helio" view) creates
 * two independent `cam` states via `createCam()`, but calls
 * `bindCameraControls()` exactly ONCE, passing a `getView()` function that
 * returns whichever view's config object is currently active (switching on
 * the plotter's own `state.view`). This mirrors how the original code had
 * one set of DOM listeners branching internally on `state.view === "helio"`
 * — binding twice would double-register listeners on the same canvas and
 * both cameras would move at once.
 */
/* global THREE */

// ---- camera state -----------------------------------------------------

// A spherical orbit state around `target`. `updateCamera()` below converts
// it to `camera.position` each frame.
export function createCam(radius, theta, phi, target) {
	return {
		radius: radius,
		theta: theta,
		phi: phi,
		target: target ? target.clone() : new THREE.Vector3(0, 0, 0)
	};
}

export function updateCamera(camera, cam) {
	var r = cam.radius;
	var sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
	camera.position.set(
		cam.target.x + r * sp * Math.cos(cam.theta),
		cam.target.y + r * sp * Math.sin(cam.theta),
		cam.target.z + r * cp);
	camera.up.set(0, 0, 1);
	camera.lookAt(cam.target);
}

// ---- cursor-centred zoom target ----------------------------------------

var _raycaster = null;

// World-space point to zoom toward for the cursor, or null to leave the
// camera target alone (empty-space dolly). Tries a direct mesh hit first
// (aim at a spot on a body); failing that, the nearest sphere-of-influence
// (or other "generous zoom zone") the cursor ray passes through, returning a
// point on that body's near face so zooming in heads smoothly for the body
// rather than converging on a point in empty space.
//
// meshes: THREE.Object3D[] to raycast directly (e.g. each body's core mesh).
// soiSpheres: { center: THREE.Vector3, radius: number, nearFaceRadius: number }[]
//   — center/radius describe the fallback sphere (SOI, or a non-physical
//   "zoom zone" for a body with no real SOI worth using); nearFaceRadius is
//   how far off `center`, toward the camera, the returned point sits (e.g.
//   the body's drawn radius).
export function raycastPickPoint(camera, rendererEl, e, opts) {
	opts = opts || {};
	var rect = rendererEl.getBoundingClientRect();
	var ndc = new THREE.Vector2(
		((e.clientX - rect.left) / rect.width) * 2 - 1,
		-(((e.clientY - rect.top) / rect.height) * 2 - 1));
	var rc = _raycaster || (_raycaster = new THREE.Raycaster());
	rc.setFromCamera(ndc, camera);

	if (opts.meshes && opts.meshes.length) {
		var hits = rc.intersectObjects(opts.meshes, true);
		if (hits.length) { return hits[0].point.clone(); }
	}
	if (opts.soiSpheres && opts.soiSpheres.length) {
		var best = null, bestDist = Infinity;
		for (var i = 0; i < opts.soiSpheres.length; i++) {
			var s = opts.soiSpheres[i];
			if (rc.ray.intersectsSphere(new THREE.Sphere(s.center, s.radius))) {
				var d = camera.position.distanceTo(s.center);
				if (d < bestDist) { bestDist = d; best = s; }
			}
		}
		if (best) {
			var toCam = camera.position.clone().sub(best.center);
			var dd = toCam.length() || 1;
			return best.center.clone().addScaledVector(toCam, (best.nearFaceRadius || 0) / dd);
		}
	}
	return null;
}

// ---- event wiring --------------------------------------------------------

// Binds contextmenu/mousedown/mousemove/mouseup/dblclick/wheel on
// `rendererEl` exactly once. `getView()` is called fresh on every event and
// must return the CURRENT view's config:
//
//   cam, camera            — required; the spherical state + THREE.Camera to drive.
//   zoomMin, zoomMax        — required; cam.radius clamp range.
//   rotateSpeed             — optional, default 0.005 (radians per pixel).
//   panSpeed                — optional, default 0.0018 (world units per pixel, x cam.radius).
//   shiftZoom               — optional bool; when true, holding Shift while
//                              scrolling zooms at `shiftRate` instead of the normal rate.
//   shiftRate               — optional, default 0.0002 (normal rate is fixed at 0.001).
//   pickPoint(e)             — optional; -> THREE.Vector3 | null. Consulted only
//                              when zooming IN (f < 1); the target lerps toward
//                              the hit. Typically `raycastPickPoint` above,
//                              closed over this view's meshes/soiSpheres.
//   isLocked()               — optional; -> bool. When true, wheel does a
//                              radius-only zoom (target untouched, lock persists).
//   lockedZoomTarget()       — optional; -> THREE.Vector3 | null. When
//                              truthy, wheel snaps cam.target to it and does
//                              a radius-only zoom (e.g. "stay centred on the
//                              locked marker while zooming").
//   onFreeZoom()              — optional; called after a normal (not locked,
//                              not lockedZoomTarget) zoom — e.g. to release a
//                              body focus, matching Solar-System-Trajectory-
//                              Plotter's "scrolling always re-targets" rule.
//   onPan()                   — optional; called on every pan-drag tick
//                              (e.g. to release a focus/marker lock).
//   onPick(e)                 — optional; deferred single-click handler,
//                              fired `clickDelayMs` after mouseup if the
//                              press didn't move and wasn't the first half of
//                              a double-click. Omit entirely on views with no
//                              click-to-place behaviour.
//   clickDelayMs               — optional, default 350.
//   onDoubleClick(e)           — optional; dblclick handler (e.g. focus-nearest-body).
//   isPan(e)                   — optional; -> bool, default `e.button === 2 || e.shiftKey`.
//   captureDrag(e)              — optional; -> a truthy token to intercept
//                              this press entirely (e.g. a hit on a
//                              release-marker returns "release", a hit on
//                              waypoint N returns {wp: N}) — the controller
//                              starts no rotate/pan for it and instead calls
//                              onCapturedMove(e, token) on each mousemove and
//                              onCapturedEnd(e, token) on mouseup. Return a
//                              falsy value to fall through to the normal
//                              rotate/pan decision. This is how the dual-view
//                              plotters keep their non-camera drags (which
//                              are NOT part of this module) interleaved with
//                              rotate/pan on the same canvas.
//   onCapturedMove(e, token), onCapturedEnd(e, token) — paired with captureDrag.
export function bindCameraControls(rendererEl, getView) {
	var dragging = null, lx = 0, ly = 0, moved = false, clickTimer = null, capturedToken = null;

	rendererEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });

	rendererEl.addEventListener("mousedown", function (e) {
		var v = getView();
		// A second press cancels a pending single-click pick, so a double-click
		// never also fires the deferred click.
		if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
		if (v.captureDrag) {
			var token = v.captureDrag(e);
			if (token) { capturedToken = token; return; }
		}
		var isPan = v.isPan ? v.isPan(e) : (e.button === 2 || e.shiftKey);
		dragging = isPan ? "pan" : "rotate";
		lx = e.clientX; ly = e.clientY; moved = false;
	});

	window.addEventListener("mousemove", function (e) {
		var v = getView();
		if (capturedToken) { if (v.onCapturedMove) { v.onCapturedMove(e, capturedToken); } return; }
		if (!dragging) { return; }
		var dx = e.clientX - lx, dy = e.clientY - ly;
		lx = e.clientX; ly = e.clientY;
		if (Math.abs(dx) + Math.abs(dy) > 2) { moved = true; }
		var cam = v.cam, camera = v.camera;
		if (dragging === "rotate") {
			var rSpeed = v.rotateSpeed || 0.005;
			cam.theta -= dx * rSpeed;
			cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi - dy * rSpeed));
		} else {
			var panScale = cam.radius * (v.panSpeed || 0.0018);
			var right = new THREE.Vector3().crossVectors(
				new THREE.Vector3().subVectors(cam.target, camera.position), camera.up).normalize();
			cam.target.addScaledVector(right, -dx * panScale);
			cam.target.addScaledVector(camera.up.clone(), dy * panScale);
			if (v.onPan) { v.onPan(); }
		}
	});

	window.addEventListener("mouseup", function (e) {
		var v = getView();
		if (capturedToken) {
			var t = capturedToken;
			capturedToken = null;
			if (v.onCapturedEnd) { v.onCapturedEnd(e, t); }
			return;
		}
		if (dragging === "rotate" && !moved && v.onPick) {
			// defer the pick so a double-click (focus) can cancel it — the next
			// mousedown (or a dblclick) clears this timer, so a double-click
			// never also fires a single-click pick.
			var ev = e;
			if (clickTimer) { clearTimeout(clickTimer); }
			clickTimer = setTimeout(function () { clickTimer = null; v.onPick(ev); }, v.clickDelayMs || 350);
		}
		dragging = null;
	});

	rendererEl.addEventListener("dblclick", function (e) {
		if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
		var v = getView();
		if (v.onDoubleClick) { v.onDoubleClick(e); }
	});

	rendererEl.addEventListener("wheel", function (e) {
		e.preventDefault();
		var v = getView();
		var cam = v.cam;
		var shiftSlow = v.shiftZoom && e.shiftKey;
		var rate = shiftSlow ? (v.shiftRate || 0.0002) : 0.001;
		var f = Math.exp(e.deltaY * rate);

		var lockedPt = v.lockedZoomTarget && v.lockedZoomTarget();
		if (lockedPt) {
			cam.target.copy(lockedPt);
			cam.radius = Math.max(v.zoomMin, Math.min(v.zoomMax, cam.radius * f));
			return;
		}
		if (v.isLocked && v.isLocked()) {
			cam.radius = Math.max(v.zoomMin, Math.min(v.zoomMax, cam.radius * f));
			return;
		}
		if (f < 1 && v.pickPoint) {
			var hit = v.pickPoint(e);
			if (hit) { cam.target.lerp(hit, 1 - f); }
		}
		cam.radius = Math.max(v.zoomMin, Math.min(v.zoomMax, cam.radius * f));
		if (v.onFreeZoom) { v.onFreeZoom(); }
	}, { passive: false });
}
