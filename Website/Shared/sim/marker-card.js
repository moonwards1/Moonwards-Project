/* Shared/sim/marker-card.js
 *
 * The slidable ship "marker" probe on a heliocentric coast, its floating
 * panel-corner card (slider, Free/Track/Target mode selector, readouts), and
 * the destination body's arrival "X" (see Website/ARCHITECTURE.md, "Step 1:
 * scene kit"). Extracted from two call sites — the Solar-System-Trajectory-
 * Plotter (marker slides the whole departure-to-arrival trajectory) and the
 * Mars-Phobos plotter's Helio overlay (marker slides the post-Mars-escape
 * heliocentric chain; ARCHITECTURE.md's own note flags this feature's scope
 * as "maybe needs splitting further" — see below for how that shook out).
 * Moon-Skyhook has none of this (its trajectory never leaves the Earth-Moon
 * system in a way this applies to).
 *
 * What's shared here is the MECHANICAL layer — sprite construction, per-frame
 * screen-facing/orientation, the card's DOM/CSS skeleton, the custom
 * relative-drag slider physics, and a few genuinely pure orbital-mechanics
 * helpers (closest-approach refinement, swept angle, phasing). What's NOT
 * here — and stays local to each calculator — is the STATE MACHINE around
 * Free/Track/Target mode: `setMarkerMode`, `applyTargeting` (the Lambert
 * re-solve), `updateMarker`, `updateDestinationMarker`, `followCrossing`'s
 * caller (though the golden-section search itself IS shared, see below).
 * That orchestration reads and mutates each tool's own trajectory
 * representation, which are structurally different shapes, not just
 * differently-named — Solar-System-Trajectory-Plotter's `computeTrajectory()`
 * returns `res.points`/`res.departure` directly, while Mars-Phobos's returns
 * `res.helioChain.points` (the chain starts at Mars-escape, not departure),
 * and Mars-Phobos's Target mode has a real behavioural difference (it
 * requires >=1 waypoint — there's no user-set "departure burn" to fall back
 * on at an escape point, see the project's marker-port note) rather than a
 * parameter that could be threaded through one shared function. Forcing
 * these into one signature would produce a callback-soup worse than the
 * duplication it removes, so — as with burn-widget.js's dSpeed/dv physics
 * and readout-panes.js's burnReadoutData — it stays put.
 *
 * The destination "X" (ARCHITECTURE.md's flagged ambiguity): its sprite
 * factory (`makeXMarkSprite`) is shared since it's pixel-identical, but
 * deciding WHEN to show it and where — `updateDestinationMarker` — stays
 * local, since that's driven by `state.destination`/proximity-tier data that
 * is itself tool-local (see Shared/sim/approach-markers.js's tier-table
 * note). So the ambiguity resolved the same way the rest of this module did:
 * mechanics shared, decisions local.
 */
/* global THREE */

import { OrbitalMath } from "../math-utils.js";

// ---- sprites --------------------------------------------------------------

// The ship marker: an elongated chevron drawn pointing +x; orient with
// orientMarkerSprite() each frame so the nose points along the direction of
// travel.
export function makeShipSprite() {
	var cv = document.createElement("canvas");
	cv.width = cv.height = 64;
	var ctx = cv.getContext("2d");
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(58, 32);     // nose (+x)
	ctx.lineTo(13, 15);     // back-left
	ctx.lineTo(25, 32);     // concave notch
	ctx.lineTo(13, 49);     // back-right
	ctx.closePath();
	ctx.fillStyle = "#ffffff";
	ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.lineWidth = 4;
	ctx.fill(); ctx.stroke();
	var tex = new THREE.CanvasTexture(cv);
	tex.minFilter = THREE.LinearFilter;
	var sp = new THREE.Sprite(new THREE.SpriteMaterial({
		map: tex, depthTest: false, depthWrite: false, transparent: true }));
	sp.renderOrder = 15;
	sp.scale.setScalar(0.01);
	return sp;
}

// The destination body's arrival position: a camera-facing 'x' (white
// stroke on a dark halo so it reads on any background).
export function makeXMarkSprite() {
	var cv = document.createElement("canvas");
	cv.width = cv.height = 64;
	var ctx = cv.getContext("2d");
	ctx.lineCap = "round";
	function strokeX() {
		ctx.beginPath();
		ctx.moveTo(16, 16); ctx.lineTo(48, 48);
		ctx.moveTo(48, 16); ctx.lineTo(16, 48);
		ctx.stroke();
	}
	ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 13; strokeX();   // halo
	ctx.strokeStyle = "#ffffff";          ctx.lineWidth = 7;  strokeX();   // mark
	var tex = new THREE.CanvasTexture(cv);
	tex.minFilter = THREE.LinearFilter;
	var sp = new THREE.Sprite(new THREE.SpriteMaterial({
		map: tex, depthTest: false, depthWrite: false, transparent: true }));
	sp.renderOrder = 15;
	sp.scale.setScalar(0.01);
	return sp;
}

// Point a screen-facing sprite's texture along its screen-space heading, by
// projecting a nearby point offset along `velDir` (world-space unit vector)
// and reading the angle between the two projections. Used each frame to keep
// the ship chevron's nose pointing along its direction of travel.
export function orientMarkerSprite(camera, sprite, velDir) {
	var dist = camera.position.distanceTo(sprite.position) || 1e-9;
	var a3 = sprite.position.clone().project(camera);
	var b3 = sprite.position.clone().addScaledVector(velDir, dist * 0.01).project(camera);
	sprite.material.rotation = Math.atan2(b3.y - a3.y, b3.x - a3.x);
}

// ---- pure orbital-mechanics helpers ----------------------------------------

// Slider angle (deg, -180..180) -> fraction of the whole path/chain (0..1).
// The clicked point is f0 at 0 deg; -180 maps to the start, +180 to the end
// (each side scaled linearly, so resolution is densest near the click).
export function markerFraction(f0, angleDeg) {
	var a = Math.max(-180, Math.min(180, angleDeg));
	return a <= 0 ? f0 * (a + 180) / 180 : f0 + (1 - f0) * (a / 180);
}

// Heliocentric angle (deg, 0-360) swept around the Sun from a start state
// (r0, v0 -- m, m/s) to a point r (m), measured in the direction of travel.
// The rotation axis is the start angular-momentum direction, so prograde
// motion increases the angle. Solar-System-Trajectory-Plotter calls this
// "swept from origin" (start = departure); Mars-Phobos calls it "swept since
// escape" (start = Mars-escape) -- same maths, different start point, so the
// caller just passes its own r0/v0.
export function sweepAngleFrom(r0, v0, r) {
	var hx = r0[1]*v0[2] - r0[2]*v0[1], hy = r0[2]*v0[0] - r0[0]*v0[2], hz = r0[0]*v0[1] - r0[1]*v0[0];
	var hm = Math.hypot(hx, hy, hz) || 1; hx /= hm; hy /= hm; hz /= hm;
	var cx = r0[1]*r[2] - r0[2]*r[1], cy = r0[2]*r[0] - r0[0]*r[2], cz = r0[0]*r[1] - r0[1]*r[0];
	var ang = Math.atan2(cx*hx + cy*hy + cz*hz, r0[0]*r[0] + r0[1]*r[1] + r0[2]*r[2]) * 180 / Math.PI;
	return ang < 0 ? ang + 360 : ang;
}

// Phasing (days) at meeting point P (m) reached on Julian date arrJd: the
// signed gap between when `orbit`'s body passes through P and when the ship
// arrives. + => the body gets there AFTER the ship (ship early); - => the
// body has already gone by (ship late). Uses the nearest pass (mod one
// period). Takes the absolute arrival JD rather than a time-of-flight offset
// so it doesn't need to know each tool's epoch-origin convention (departure
// date vs. Mars-escape date) -- the caller already resolved that.
export function phasingDays(GM, orbit, P, arrJd) {
	var n = OrbitalMath.meanMotion(GM, orbit.a);
	var Mb = (orbit.meanAnomaly || 0) + n * (arrJd - (orbit.epoch || 2451545.0)) * 86400;
	var i = orbit.inclination || 0, Om = orbit.longitude || 0, w = orbit.argument || 0;
	var cO = Math.cos(Om), sO = Math.sin(Om), ci = Math.cos(i), si = Math.sin(i),
	    cw = Math.cos(w), sw = Math.sin(w);
	var ux = cO*cw - sO*sw*ci, uy = sO*cw + cO*sw*ci, uz = sw*si;
	var vx = -cO*sw - sO*cw*ci, vy = -sO*sw + cO*cw*ci, vz = cw*si;
	var nuP = Math.atan2(P[0]*vx + P[1]*vy + P[2]*vz, P[0]*ux + P[1]*uy + P[2]*uz);
	var Mp = OrbitalMath.meanAnomalyFromTrue(nuP, orbit.e);
	var dM = Mp - Mb;
	dM -= 2 * Math.PI * Math.round(dM / (2 * Math.PI));   // nearest pass, (-pi,pi]
	return (dM / n) / 86400;
}

// Golden-section search for the point of closest approach to `orbit` over
// chain-/path-time [tA, tB], using a caller-supplied sampler
// `sampleFn(t) -> { r } | null` (each tool's own `stateAtGlobalTime`, whose
// segment representation differs -- trajSegs vs. chainSegs -- so it isn't
// shared itself). Returns { r (m), dist (m), t } at the minimum, or null.
export function refineApproach(orbit, sampleFn, tA, tB) {
	var gr = (Math.sqrt(5) - 1) / 2, a = tA, b = tB;
	function f(t) { var s = sampleFn(t); return s ? OrbitalMath.distanceToOrbit(orbit, s.r) : Infinity; }
	var c = b - gr * (b - a), d = a + gr * (b - a), fc = f(c), fd = f(d);
	for (var k = 0; k < 48 && (b - a) > 1; k++) {
		if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); }
		else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
	}
	var tm = (a + b) / 2, s = sampleFn(tm);
	return s ? { r: s.r, dist: OrbitalMath.distanceToOrbit(orbit, s.r), t: tm } : null;
}

// Keep the marker glued to the destination-orbit crossing while it is inside
// an encounter ring; freeze (do nothing) when out of range, so it never
// skips to a far crossing -- it re-engages only when a ring sweeps back over
// its own spot. Mutates `marker.f0`/`marker.angle` in place (a caller-owned
// object, same convention as body-renderer.js's scaleList). Used by Track
// mode and by a released Target mode.
//
// orbit: the destination's orbit, or null/hyperbolic to no-op.
// totalT: path/chain total duration (s). sampleCount: number of trajectory
// samples (sets the search window width). sampleFn: as refineApproach.
// approachFar: the "inside an encounter ring" distance threshold (m).
export function followCrossing(marker, orbit, totalT, sampleCount, sampleFn, approachFar) {
	if (!marker || !orbit || orbit.e >= 1 || !(totalT > 0)) { return; }
	var tCur = markerFraction(marker.f0, marker.angle) * totalT;
	var sCur = sampleFn(tCur);
	if (!sCur || OrbitalMath.distanceToOrbit(orbit, sCur.r) >= approachFar) { return; }  // freeze
	var avgdt = totalT / Math.max(1, sampleCount - 1);
	var win = 6 * avgdt;
	var r = refineApproach(orbit, sampleFn, Math.max(0, tCur - win), Math.min(totalT, tCur + win));
	if (r && r.dist < approachFar) {
		marker.f0 = Math.max(0, Math.min(1, r.t / totalT));
		marker.angle = 0;
	}
}

// ---- formatting -------------------------------------------------------------

export function fmtKm(m) {
	return (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " km";
}
export function fmtTof(sec) {
	var d = sec / 86400;
	return d.toFixed(0) + " d (" + (d / 365.25).toFixed(2) + " yr)";
}
export function fmtDate(jd) {
	var d = OrbitalMath.dateFromJulian(jd);
	return d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
}

// ---- the card's DOM/CSS skeleton and slider physics ------------------------

// Custom RELATIVE drag for a -180..180 range slider, so fineness is
// decoupled from the track's pixel width. A native range maps
// ~(360deg / trackPx) per pixel; this moves at 1/10 of that (~10x more hand
// travel per degree), and 1/4 of THAT while Shift is held. Accumulating
// relatively (rather than from an absolute thumb position) lets you lift and
// re-grab to "ratchet" across the full range, and keeps the precise,
// unsnapped angle in the caller's own state rather than the thumb's
// step-snapped value -- which is why this reads the current angle via
// `getAngle()` instead of `sliderEl.value`.
//
// stepDeg: the keyboard-nudge step (Shift held = stepDeg/4), assigned to
// `sliderEl.step` on keydown/keyup so arrow-key nudges match.
// getAngle(): returns the caller's current precise angle.
// onChange(angleDeg): called after either a keyboard `input` or a drag move.
export function bindRelativeDragSlider(sliderEl, stepDeg, getAngle, onChange) {
	sliderEl.addEventListener("input", function () {
		onChange(parseFloat(sliderEl.value));
	});
	function stepListener(e) { sliderEl.step = e.shiftKey ? stepDeg / 4 : stepDeg; }
	window.addEventListener("keydown", stepListener);
	window.addEventListener("keyup", stepListener);

	var dragging = false, lastX = 0, nativeDegPerPx = 2;
	sliderEl.addEventListener("pointerdown", function (e) {
		e.preventDefault();                       // suppress the native jump-to-click
		dragging = true; lastX = e.clientX;
		nativeDegPerPx = 360 / (sliderEl.clientWidth || 174);
		try { sliderEl.setPointerCapture(e.pointerId); } catch (_) {}
		sliderEl.focus();
	});
	sliderEl.addEventListener("pointermove", function (e) {
		if (!dragging) { return; }
		var dx = e.clientX - lastX; lastX = e.clientX;
		var sens = (nativeDegPerPx / 10) * (e.shiftKey ? 0.25 : 1);
		var a = Math.max(-180, Math.min(180, getAngle() + dx * sens));
		sliderEl.value = a;                        // thumb (snaps to step; cosmetic only)
		onChange(a);
	});
	function endDrag(e) {
		if (!dragging) { return; }
		dragging = false;
		try { sliderEl.releasePointerCapture(e.pointerId); } catch (_) {}
	}
	sliderEl.addEventListener("pointerup", endDrag);
	sliderEl.addEventListener("pointercancel", endDrag);
}

// Build the floating marker card: title bar + remove button, the angle
// slider (wired via bindRelativeDragSlider), a Free/Track/Target mode
// selector, a caller-supplied list of readout rows, and the Target-mode
// Δv-budget input + solved-Δv row. Appended to opts.hostEl.
//
// opts: {
//   classPrefix,                 // "sst" / "mps" -- CSS class + id prefix
//   hostEl,                      // element to append the card to
//   sliderTitle,                 // tooltip text for the angle slider
//   modeTitles: { free, track, target },  // tooltip text per mode button
//   rows: [{ key, label }, ...], // readout rows in display order; a row
//                                // whose key is "rad" gets an extra
//                                // ".km" sub-line appended right after it
//                                // (both tools show "0.xxx AU" + "N,NNN km")
//   getAngle,                    // () -> current precise angle (for the drag binder)
//   onSliderChange(angleDeg), onRemove(), onModeClick(mode),
//   onBudgetChange(dvBudgetSI)   // called with the parsed budget in m/s
// }
//
// Returns { el, slider, modeBtns, vals (row key -> value <span>, plus
// "radKm" if a "rad" row was present), budgetRow, budgetInput, tdvRow, valTdv }.
export function buildMarkerCard(opts) {
	var cls = opts.classPrefix;
	var card = document.createElement("div");
	card.id = cls + "-marker-card";

	var head = document.createElement("div"); head.className = cls + "-marker-head";
	var title = document.createElement("span"); title.className = cls + "-marker-title";
	title.textContent = "Marker";
	var rm = document.createElement("button"); rm.type = "button"; rm.className = cls + "-marker-x";
	rm.textContent = "✕"; rm.title = "remove marker";
	rm.addEventListener("click", function () { opts.onRemove(); });
	head.appendChild(title); head.appendChild(rm);
	card.appendChild(head);

	var slider = document.createElement("input");
	slider.type = "range"; slider.className = cls + "-marker-slider";
	var MARK_STEP = 1 / 3;                 // keyboard step: 3x finer than 1deg/step
	slider.min = -180; slider.max = 180; slider.step = MARK_STEP; slider.value = 0;
	slider.title = opts.sliderTitle;
	bindRelativeDragSlider(slider, MARK_STEP, opts.getAngle, opts.onSliderChange);
	card.appendChild(slider);

	var modeRow = document.createElement("div"); modeRow.className = cls + "-marker-mode";
	var modeBtns = {};
	[["free", "Free"], ["track", "Track"], ["target", "Target"]].forEach(function (m) {
		var b = document.createElement("button");
		b.type = "button"; b.className = cls + "-mode-btn"; b.textContent = m[1];
		b.title = opts.modeTitles[m[0]];
		b.addEventListener("click", function () { opts.onModeClick(m[0]); });
		modeBtns[m[0]] = b; modeRow.appendChild(b);
	});
	card.appendChild(modeRow);

	var vals = {};
	function row(key, label) {
		var r = document.createElement("div"); r.className = cls + "-marker-row";
		var l = document.createElement("span"); l.className = cls + "-marker-label"; l.textContent = label;
		var v = document.createElement("span"); v.className = cls + "-marker-val";
		r.appendChild(l); r.appendChild(v); card.appendChild(r);
		vals[key] = v;
	}
	opts.rows.forEach(function (r) {
		row(r.key, r.label);
		if (r.key === "rad") {
			var km = document.createElement("div"); km.className = cls + "-marker-km";
			card.appendChild(km);
			vals.radKm = km;
		}
	});

	var budgetRow = document.createElement("label"); budgetRow.className = cls + "-marker-budget";
	var blab = document.createElement("span"); blab.textContent = "Δv budget (km/s)";
	var budgetInput = document.createElement("input");
	budgetInput.type = "number"; budgetInput.min = 0; budgetInput.step = 0.5; budgetInput.value = "10";
	budgetInput.addEventListener("change", function () {
		var v = parseFloat(budgetInput.value); if (!isFinite(v) || v < 0) { v = 0; }
		opts.onBudgetChange(v * 1000);
	});
	budgetRow.appendChild(blab); budgetRow.appendChild(budgetInput);
	card.appendChild(budgetRow);

	var tdvRow = document.createElement("div"); tdvRow.className = cls + "-marker-row";
	var tlab = document.createElement("span"); tlab.className = cls + "-marker-label"; tlab.textContent = "target Δv";
	var valTdv = document.createElement("span"); valTdv.className = cls + "-marker-val";
	tdvRow.appendChild(tlab); tdvRow.appendChild(valTdv);
	card.appendChild(tdvRow);

	opts.hostEl.appendChild(card);

	return { el: card, slider: slider, modeBtns: modeBtns, vals: vals,
		budgetRow: budgetRow, budgetInput: budgetInput, tdvRow: tdvRow, valTdv: valTdv };
}

// Set the "active" class on whichever mode button matches `activeMode`.
export function updateMarkerModeButtons(modeBtns, classPrefix, activeMode) {
	Object.keys(modeBtns).forEach(function (k) {
		modeBtns[k].className = classPrefix + "-mode-btn" + (k === activeMode ? " active" : "");
	});
}
