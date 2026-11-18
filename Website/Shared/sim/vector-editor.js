/* Shared/sim/vector-editor.js
 *
 * The isometric SVG burn-vector editor: three draggable prograde / radial /
 * normal arrows (same axis colours as Shared/sim/burn-widget.js's 3D gizmo —
 * prograde #6fd49a green, radial #ffb45a orange, normal #8ab4ff blue), plus
 * a numeric-input row underneath. Values are m/s in and out; the widget
 * displays and edits in km/s (±15 km/s range, shift-drag for fine control).
 *
 * Two SVG layers, drawn independently:
 * - `world`: the isometric reference glyph, the faint axis guide rays, and
 *   the draggable arrows — the whole picture moves and scales together, so
 *   an arrow is always drawn on top of its own axis. Zoom/pan is user-
 *   controlled, so a small burn can be zoomed in until it's as easy to grab
 *   as a large one. The layer carries NO transform: every point is mapped
 *   world→screen in JS and written as plain coordinates on each redraw.
 *   A scale() transform on the group would let the browser stretch its
 *   cached bitmap of the layer and only repaint it sharp seconds later,
 *   which reads as a blurry picture after every zoom step.
 * - `overlay`: just the per-axis letter (P / R / N) at each axis's end.
 *   Never transforms, so the letters stay put (and legible) at any zoom/pan
 *   level. The values themselves are read from the number row, not the
 *   picture.
 * Zoom only ever happens when the user asks for it — no auto-fit-on-load,
 * since a view that rescales itself is disorienting mid-drag and surprising
 * on open. The wheel zooms about the point under the cursor. The +/−
 * buttons zoom about the middle of the view. Zooming all the way back out
 * returns the view home (no pan). Clicking an axis's letter, or putting the
 * cursor in that axis's number field, zooms to that axis's arrowhead and
 * centres it — FOCUS ZOOM, the quick way to a precise drag on a long arrow.
 * Panning is right-drag or the pan-arrow buttons. A small control row
 * (Zoom −/+, pan arrows) makes the controls discoverable without cluttering
 * the widget. Left-drag on an arrow tracks the arrowhead 1:1
 * under the cursor at whatever the current zoom happens to be — no separate
 * amplification — so a plain drag always feels like it's moving the picture
 * itself; shift-drag applies its own extra divisor on top for fine control.
 *
 * Ported from the Solar-System-Trajectory-Plotter and then inlined
 * byte-identically in three MissionPlanner modules (transfer-leg,
 * departure-leg, body-departure-leg) before being extracted here verbatim
 * from body-departure-leg's copy. The zoom/pan split-layer rework (2026-08)
 * happened here, in the shared module only — the three standalone
 * calculators (Solar-System-Trajectory-Plotter, Moon-Skyhook, Mars-Phobos)
 * keep their own older inlined copies of this widget.
 *
 * buildVectorEditor(host, values, onChange, opts):
 * - host: a container element; its content is replaced with the controls
 *   row + SVG + the numeric row. The widget stores its redraw on
 *   `host._sstRedraw` so a caller that mutates `values` externally can
 *   refresh the arrows.
 * - values: a { pro, rad, nrm } object in m/s — MUTATED IN PLACE as the user
 *   drags or types (callers rely on this; it's the live burn object). Always
 *   holds the ABSOLUTE burn component, regardless of opts below.
 * - onChange(axisKey, mps): called after each user edit with the axis
 *   ("pro" | "rad" | "nrm") and its new ABSOLUTE value in m/s.
 * - opts (optional) — DELTA-CAP MODE, for editors that adjust an existing
 *   burn within a limited budget rather than dialing one up from rest (the
 *   Coast phase's waypoint cards, transfer-leg.js): each axis's zero point
 *   (ship glyph, drag origin) is relocated to opts.baseline[axis] instead of
 *   literal zero, the full axis length spans ±opts.maxDeltaMps instead of
 *   ±15 km/s, and — unlike the default mode's drag-only clamp — TYPED entry
 *   is hard-clamped too, since the whole point of this mode is a real limit,
 *   not just a display range. The number row shows the DELTA from
 *   baseline (signed), not the absolute value, formatted via opts.displayDiv
 *   (m/s-per-displayed-unit, e.g. 1 for m/s or 1000 for km/s), opts.decimals
 *   and opts.step. opts.unitLabel, if given, is appended to each axis's
 *   field name (e.g. "Prograde m/s") — omitting it names the field for the
 *   axis alone, with no unit stated. Omitting opts (or opts.maxDeltaMps)
 *   reproduces the original absolute-from-zero, drag-clamped/type-unclamped,
 *   km/s-display behavior exactly.
 * - opts.showBaseline (delta-cap mode only) — PLAN-OVERLAY MODE, for
 *   adjusting a burn that was authored elsewhere (the Coast phase's
 *   waypoints, transfer-leg.js): the axes originate at literal zero rather
 *   than at the baseline, and the baseline burn itself is drawn as the solid
 *   per-axis arrows, unmoving. The LIVE burn is a white outline around each
 *   axis's arrow, shaft and head; dragging an outlined arrowhead moves the
 *   outline away from the solid arrow, which keeps showing the baseline.
 *   One scale serves all three axes, sized so the largest |baseline| + cap
 *   reaches the axis end. The number row stays the delta, as in plain
 *   delta-cap mode. Focus zoom here zooms until the axis's ±cap span is
 *   most of the view's width, so the allowed adjustment is comfortably
 *   draggable however large the plan burn is.
 *
 * Styling comes from the page's own CSS (.sst-vecwidget, .sst-vec-controls,
 * .sst-vec-nums, .sst-vec-num, .sst-vec-num-row, .sst-vec-num-narrow —
 * MissionPlanner/planner.css carries them).
 */

var SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
	var e = document.createElementNS(SVGNS, tag);
	for (var k in attrs) { e.setAttribute(k, attrs[k]); }
	return e;
}
export function buildVectorEditor(host, values, onChange, opts) {
	host.innerHTML = "";
	host.style.position = "relative"; // anchors the floated up/down pan buttons
	// Delta-cap mode (see header): a caller opts in by passing maxDeltaMps.
	// All geometry below works in RAW m/s (matching `values` itself) with the
	// baseline subtracted; displayDiv/decimals/step only affect the number
	// row text. AXIS_LEN is the fixed on-screen half-length a full
	// ±maxMps swing draws to (same pixels the original ±15 km/s used).
	var capped = !!(opts && isFinite(opts.maxDeltaMps));
	var baseline = (opts && opts.baseline) || { pro: 0, rad: 0, nrm: 0 };
	var maxMps = capped ? opts.maxDeltaMps : 15000;
	var dispDiv = (opts && isFinite(opts.displayDiv)) ? opts.displayDiv : 1000;
	var decimals = (opts && isFinite(opts.decimals)) ? opts.decimals : 3;
	var numStep = (opts && isFinite(opts.step)) ? opts.step : 0.001;
	var unitLabel = (opts && opts.unitLabel) || null;   // appended to each axis's field name
	var overlayMode = capped && !!opts.showBaseline;     // see header: plan-overlay mode
	var HIDE_FRAC = 0.008;   // matches the original 0.12 km/s dead-zone at MAXV=15 km/s
	// The dead zone never exceeds one number-field step (1 m/s in the km/s
	// editors, 0.1 m/s in the waypoint course-correction editor), so any burn
	// the field can express draws an arrow (tiny ones only become legible by zooming).
	var hideMps = Math.min(maxMps * HIDE_FRAC, numStep * dispDiv);
	// Overlay mode draws absolute values from zero, so the axis has to reach
	// the furthest any axis can be dragged: |baseline| + cap.
	var fitMps = maxMps;
	if (overlayMode) {
		["pro", "rad", "nrm"].forEach(function (k) {
			fitMps = Math.max(fitMps, Math.abs(baseline[k] || 0) + maxMps);
		});
	}
	var W = 278, H = 300, OX = 139, OY = 150, AXIS_LEN = 112.5, SCALE = AXIS_LEN / fitMps, LEN = AXIS_LEN;
	var ZMIN = 1, ZSTEP = 1.4, ZMAX = 12 * Math.pow(ZSTEP, 4), PANSTEP = 40; // never smaller than the default view
	// Line/arrowhead length always grows 1:1 with zoom (it's what you're aiming
	// with), but thickness only grows as zoom^THICK_EXP — a lot slower — so a
	// heavily zoomed-in arrow doesn't turn into a fat wedge that's harder to
	// place precisely than the small one it replaced.
	var THICK_EXP = 1/3, BASE_STROKE = 2.5, BASE_HEAD_LEN = 9, BASE_HEAD_HALF = 5;
	var axes = [
		{ key: "pro", name: "prograde", col: "#6fd49a", rayCol: "#0f3719", dx:  Math.cos(-Math.PI/6), dy: Math.sin(-Math.PI/6) },
		{ key: "rad", name: "radial",   col: "#ffb45a", rayCol: "#562a1d", dx:  Math.cos( Math.PI/6), dy: Math.sin( Math.PI/6) },
		{ key: "nrm", name: "normal",   col: "#8ab4ff", rayCol: "#232d47", dx: 0, dy: -1 }
	];

	// ---- controls row: Zoom label + -/+ buttons, then vertical/horizontal pan steppers ----
	var controls = document.createElement("div"); controls.className = "sst-vec-controls";
	function ctrlBtn(cls, label, title) {
		var b = document.createElement("button");
		b.type = "button"; b.className = "sst-vec-btn " + cls; b.textContent = label;
		if (title) { b.title = title; }
		return b;
	}
	var zoomLabel = document.createElement("span"); zoomLabel.className = "sst-vec-zoomlabel"; zoomLabel.textContent = "Zoom";
	var zoomOut = ctrlBtn("", "−", "Zoom out");
	var zoomIn  = ctrlBtn("", "+", "Zoom in");
	controls.appendChild(zoomLabel); controls.appendChild(zoomOut); controls.appendChild(zoomIn);

	var spacer = document.createElement("span"); spacer.className = "sst-vec-spacer";
	controls.appendChild(spacer);

	// Floated separately (not in the controls row) — see .sst-vec-pangroup-v —
	// so its buttons render at full height instead of being squeezed to fit
	// the row; positioned just below the row, at the card's right edge.
	var vGroup = document.createElement("div"); vGroup.className = "sst-vec-pangroup sst-vec-pangroup-v";
	var panUp = ctrlBtn("", "▲", "Pan up");
	var panDown = ctrlBtn("", "▼", "Pan down");
	vGroup.appendChild(panUp); vGroup.appendChild(panDown);

	var hGroup = document.createElement("div"); hGroup.className = "sst-vec-pangroup sst-vec-pangroup-h";
	var panLeft = ctrlBtn("", "◀", "Pan left");
	var panRight = ctrlBtn("", "▶", "Pan right");
	hGroup.appendChild(panLeft); hGroup.appendChild(panRight);
	controls.appendChild(hGroup);

	host.appendChild(controls);
	host.appendChild(vGroup);

	// ---- SVG: world (zoom/pan) layer — glyph, guide rays, arrows — behind the
	// fixed overlay letters, so they always read on top even at high zoom ----
	var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "sst-vecwidget" });
	var overlay = svgEl("g", { "class": "sst-vec-overlay" });
	var world = svgEl("g", { "class": "sst-vec-world" });

	// World-space geometry for the ship glyph and guide rays; redraw() maps it
	// to screen coordinates (see the `world` note in the header).
	var glyphFaces = [];
	(function () {
		// Three-face ship glyph (yqnn-generated path), scaled so its footprint
		// matches the old glyph's ~48-unit local length, centred on (5,6) — the
		// vertex shared by all three faces — so that vertex lands on the origin.
		var SHIP_SCALE = 3, SHIP_CX = 5, SHIP_CY = 6;
		function P(lx, ly) { return [OX + (lx - SHIP_CX) * SHIP_SCALE, OY + (ly - SHIP_CY) * SHIP_SCALE]; }
		function poly(pts, fill) {
			var el = svgEl("polygon", { fill: fill, "fill-opacity": 0.6 });
			glyphFaces.push({ el: el, pts: pts });
			return el;
		}
		var p0 = P(0, 4), p1 = P(5, 6), p2 = P(16, 0), p3 = P(11, 12), p4 = P(5, 10);
		world.appendChild(poly([p0, p1, p2],     "#595d66")); // Face A — medium gray
		world.appendChild(poly([p1, p3, p4, p0], "#3b3e46")); // Face B (quad) — dark gray
		world.appendChild(poly([p2, p3, p1],     "#7e828c")); // Face C — light gray
	})();

	axes.forEach(function (a) {
		// Solid dark per-axis rays (own darker tint, not the bright impulse-
		// arrow colour) — drawn after the glyph so they read clearly over it,
		// while staying visually distinct from the bright, thick arrows.
		a.ray = svgEl("line", { stroke: a.rayCol });
		world.appendChild(a.ray);
		var lx = OX + a.dx*(LEN+11), ly = OY + a.dy*(LEN+11);
		var t = svgEl("text", { x: lx, y: ly + 4, fill: a.col, "text-anchor": "middle",
			"font-size": 12, "font-weight": 700, "class": "sst-vec-axislabel" });
		t.textContent = a.name.charAt(0).toUpperCase();
		var tip = svgEl("title", {}); tip.textContent = "Zoom to the " + a.name + " arrowhead";
		t.appendChild(tip);
		overlay.appendChild(t);
		a.label = t;
	});

	axes.forEach(function (a) {
		a.line = svgEl("line", { stroke: a.col, "stroke-linecap": "round" });
		a.head = svgEl("polygon", { fill: a.col });
		world.appendChild(a.line); world.appendChild(a.head);
	});
	// Overlay mode: the live burn's white outline, one closed arrow shape per
	// axis, drawn over every solid arrow.
	if (overlayMode) {
		axes.forEach(function (a) {
			a.outline = svgEl("polygon", { fill: "none", stroke: "#ffffff", "stroke-linejoin": "round" });
			world.appendChild(a.outline);
		});
	}

	svg.appendChild(world); svg.appendChild(overlay);
	host.appendChild(svg);

	var nums = {};
	var row = document.createElement("div"); row.className = "sst-vec-nums";
	axes.forEach(function (a) {
		var cell = document.createElement("label"); cell.className = "sst-vec-num";
		var tag = document.createElement("span");
		var label = a.name.charAt(0).toUpperCase() + a.name.slice(1);
		tag.textContent = unitLabel ? (label + " " + unitLabel) : label;
		tag.style.color = a.col;
		var inp = document.createElement("input");
		inp.type = "number"; inp.step = numStep;
		inp.value = ((values[a.key] - baseline[a.key]) / dispDiv).toFixed(decimals);
		// Shift held while a nudge fires (spinner-arrow click or ArrowUp/Down
		// key) swaps the field's step to a tenth of its normal size for that
		// one nudge — the browser reads `step` at the moment it applies
		// stepUp/stepDown, so setting it here on mousedown/keydown (before
		// that happens) is enough; no need to restore it afterward since the
		// next nudge sets it fresh.
		var fineStep = numStep / 10;
		inp.addEventListener("mousedown", function (e) { inp.step = e.shiftKey ? fineStep : numStep; });
		inp.addEventListener("keydown", function (e) {
			if (e.key === "ArrowUp" || e.key === "ArrowDown") { inp.step = e.shiftKey ? fineStep : numStep; }
		});
		inp.addEventListener("change", function () {
			var v = parseFloat(inp.value); if (!isFinite(v)) { v = 0; }
			var delta = v * dispDiv;
			if (capped) { delta = Math.max(-maxMps, Math.min(maxMps, delta)); }
			values[a.key] = baseline[a.key] + delta;
			redraw(); onChange(a.key, values[a.key]);
		});
		nums[a.key] = inp;
		cell.appendChild(tag);
		cell.appendChild(inp);
		row.appendChild(cell);
	});
	host.appendChild(row);

	// World → screen (viewBox units): the zoom/pan mapping, applied to every
	// point at draw time rather than as a transform on the `world` group.
	function sx(x) { return (panX + x * zoom).toFixed(2); }
	// Overlay mode's live-burn outline for one axis: a closed arrow shape
	// (shaft and head as one polygon) padded a little past the solid arrow's
	// own size, so when the two agree the white line traces around the
	// coloured arrow rather than over it. A near-zero value draws a small
	// ring at the origin instead, so there is still something to grab.
	function drawOutline(a, mps, strokeW, headLen, headHalf) {
		var pad = 2 * Math.pow(zoom, THICK_EXP - 1);           // world units ≈ 2 screen px
		a.outline.setAttribute("stroke-width", (1.3 * Math.pow(zoom, THICK_EXP)).toFixed(3));
		var len = Math.abs(mps) * SCALE;
		var s = mps < 0 ? -1 : 1, hx = s*a.dx, hy = s*a.dy, px = -hy, py = hx;
		if (len <= hideMps * SCALE) { len = 0; }
		var baseLen = Math.min(headLen, len), k = len > 0 ? baseLen / headLen : 0.35;
		var sw = strokeW * Math.max(k, 0.3) / 2 + pad, hh = headHalf * k + pad;
		var tipL = len + pad, bL = len - baseLen;
		function P(along, across) {
			return sx(OX + hx*along + px*across) + "," + sy(OY + hy*along + py*across);
		}
		a.outline.setAttribute("points", [
			P(-pad, sw), P(bL, sw), P(bL, hh), P(tipL, 0), P(bL, -hh), P(bL, -sw), P(-pad, -sw)
		].join(" "));
	}
	function sy(y) { return (panY + y * zoom).toFixed(2); }
	function redraw() {
		// Lengths below are in WORLD units (scaled by zoom when mapped to the
		// screen); dividing the size constants by zoom^(1 - THICK_EXP) makes the
		// RENDERED stroke/arrowhead size base * zoom^THICK_EXP instead of base * zoom.
		var thickComp = Math.pow(zoom, THICK_EXP - 1);
		var strokeW = BASE_STROKE * thickComp, headLen = BASE_HEAD_LEN * thickComp, headHalf = BASE_HEAD_HALF * thickComp;
		glyphFaces.forEach(function (f) {
			f.el.setAttribute("points", f.pts.map(function (p) { return sx(p[0]) + "," + sy(p[1]); }).join(" "));
		});
		axes.forEach(function (a) {
			a.ray.setAttribute("x1", sx(OX - a.dx*LEN)); a.ray.setAttribute("y1", sy(OY - a.dy*LEN));
			a.ray.setAttribute("x2", sx(OX + a.dx*LEN)); a.ray.setAttribute("y2", sy(OY + a.dy*LEN));
			a.ray.setAttribute("stroke-width", (1.5 * zoom).toFixed(3)); // grows in full proportion with zoom
		});
		axes.forEach(function (a) {
			var raw = values[a.key] - baseline[a.key];
			var vis = Math.max(-maxMps, Math.min(maxMps, raw));
			// What the solid arrow draws: the delta in plain delta-cap mode,
			// the baseline itself (from zero) in overlay mode.
			var solid = overlayMode ? (baseline[a.key] || 0) : vis;
			var tx = OX + a.dx*solid*SCALE, ty = OY + a.dy*solid*SCALE;
			var show = Math.abs(solid) > hideMps;
			[a.line, a.head].forEach(function (n) { n.style.display = show ? "" : "none"; });
			if (show) {
				var s = solid < 0 ? -1 : 1, hx = s*a.dx, hy = s*a.dy, px = -hy, py = hx;
				// The shaft stops where the arrowhead's base starts, not at the value
				// point itself — the arrowhead sits past the end of the line, tip at
				// the value point, as arrows usually look. A value shorter than the
				// arrowhead shrinks the head (and stroke) in proportion, so a tiny
				// arrow stays a narrow arrow rather than a flat wide wedge.
				var baseLen = Math.min(headLen, Math.abs(solid) * SCALE);
				var k = baseLen / headLen;
				a.line.setAttribute("stroke-width", (strokeW * Math.max(k, 0.3) * zoom).toFixed(3));
				var hh = headHalf * k;
				var bx = tx - hx*baseLen, by = ty - hy*baseLen;
				a.line.setAttribute("x1", sx(OX)); a.line.setAttribute("y1", sy(OY));
				a.line.setAttribute("x2", sx(bx)); a.line.setAttribute("y2", sy(by));
				a.head.setAttribute("points",
					sx(tx) + "," + sy(ty) + " " + sx(bx+px*hh) + "," + sy(by+py*hh) + " " + sx(bx-px*hh) + "," + sy(by-py*hh));
			}
			// Unclamped raw (not vis): matches the pre-cap widget's behavior of
			// showing the true typed value even past the drawn arrow's clamp. In
			// capped mode this is moot — the stored value is hard-clamped at every
			// mutation site, so raw already can't exceed vis.
			// No leading "+" here: it is not a valid number-input value per the
			// HTML spec, and setting one blanks the field instead of showing it.
			var numStr = (raw / dispDiv).toFixed(decimals);
			if (overlayMode) { drawOutline(a, baseline[a.key] + vis, strokeW, headLen, headHalf); }
			if (document.activeElement !== nums[a.key]) { nums[a.key].value = numStr; }
		});
	}

	// ---- zoom / pan state on the `world` layer only; `overlay` never transforms.
	// setZoom keeps the world point under the screen point (ax, ay) fixed —
	// the cursor for the wheel, the view's middle (OX, OY) for the buttons.
	// At the minimum zoom the pan resets, so zooming fully out is always home. ----
	var zoom = 1, panX = 0, panY = 0;
	function applyTransform() { redraw(); }
	function setZoom(next, ax, ay) {
		if (ax == null) { ax = OX; ay = OY; }
		next = Math.max(ZMIN, Math.min(ZMAX, next));
		var wx = (ax - panX) / zoom, wy = (ay - panY) / zoom;
		zoom = next;
		panX = ax - wx * zoom;
		panY = ay - wy * zoom;
		if (zoom <= ZMIN) { panX = 0; panY = 0; }
		applyTransform();
	}
	// Focus zoom (see header): centre the axis's current arrowhead in the view
	// at a zoom where it can be dragged precisely. In overlay mode that is the
	// zoom at which the axis's ±cap span covers FOCUS_SPAN of the view; in the
	// other modes the arrow lives on a span the view already fits, so it only
	// makes sure of a useful magnification. Never zooms OUT.
	var FOCUS_SPAN = 170, FOCUS_MIN_ZOOM = 3;
	function focusAxis(a) {
		var target = overlayMode ? FOCUS_SPAN / (2 * maxMps * SCALE) : FOCUS_MIN_ZOOM;
		zoom = Math.max(ZMIN, Math.min(ZMAX, Math.max(zoom, target)));
		var tipMps = overlayMode
			? values[a.key]
			: Math.max(-maxMps, Math.min(maxMps, values[a.key] - baseline[a.key]));
		var wx = OX + a.dx * tipMps * SCALE, wy = OY + a.dy * tipMps * SCALE;
		panX = OX - wx * zoom;
		panY = OY - wy * zoom;
		applyTransform();
	}
	axes.forEach(function (a) {
		// The letter sits over the SVG, whose own pointerdown would treat the
		// press as an arrow grab or a pan; stop it there.
		a.label.addEventListener("pointerdown", function (e) {
			e.stopPropagation(); e.preventDefault();
			if (e.button === 0) { focusAxis(a); }
		});
		nums[a.key].addEventListener("focus", function () { focusAxis(a); });
	});
	function pan(dx, dy) { panX += dx; panY += dy; applyTransform(); }

	zoomOut.addEventListener("click", function () { setZoom(zoom / ZSTEP); });
	zoomIn.addEventListener("click", function () { setZoom(zoom * ZSTEP); });
	panUp.addEventListener("click", function () { pan(0, PANSTEP); });
	panDown.addEventListener("click", function () { pan(0, -PANSTEP); });
	panLeft.addEventListener("click", function () { pan(PANSTEP, 0); });
	panRight.addEventListener("click", function () { pan(-PANSTEP, 0); });

	svg.addEventListener("contextmenu", function (e) { e.preventDefault(); });
	svg.addEventListener("wheel", function (e) {
		e.preventDefault();
		var factor = Math.pow(1.15, -e.deltaY / 100);
		factor = Math.max(0.5, Math.min(2, factor));
		var p = toVB(e);
		setZoom(zoom * factor, p[0], p[1]);
	}, { passive: false });

	function toVB(e) {
		var r = svg.getBoundingClientRect();
		return [ (e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H ];
	}
	function toWorld(p) { return [ (p[0] - panX) / zoom, (p[1] - panY) / zoom ]; }
	function pickAxis(px, py) {
		// Dead zone is a constant 15 SCREEN px along the axis, not a fixed world
		// distance — so at high zoom, where 15px is a small fraction of a km/s,
		// clicking near the 0 point still repositions the arrow instead of being
		// swallowed by an oversized dead zone. The perpendicular tolerance (how
		// far off the axis line a click can land and still grab it) is likewise
		// a constant SCREEN px, not world units, so it stays a tight few-px hit
		// zone at any zoom instead of ballooning as you zoom in.
		var PERP_TOL = 9 / zoom;
		var best = -1, bestPerp = PERP_TOL, rx = px - OX, ry = py - OY, deadZone = 15 / zoom;
		for (var i = 0; i < axes.length; i++) {
			var a = axes[i];
			var proj = rx*a.dx + ry*a.dy, perp = Math.abs(rx*a.dy - ry*a.dx);
			if (Math.abs(proj) > deadZone && perp < bestPerp) { bestPerp = perp; best = i; }
		}
		return best;
	}

	var dragIdx = -1, lastWorld = null;
	var panDragging = false, lastScreen = null;
	// 1/SCALE matches the drawing scale exactly, so a plain drag tracks the
	// arrowhead 1:1 under the cursor at any zoom level (world coords are
	// already divided by zoom in toWorld) — no separate amplification.
	// Shift still applies its own extra fine-control divisor on top of that.
	var BURN_SENS = 1 / SCALE;
	function setAxisAbsolute(p, a) {
		var proj = (p[0] - OX) * a.dx + (p[1] - OY) * a.dy;
		// In overlay mode the axis is absolute (zero at the origin), so the
		// point under the cursor is a burn value; otherwise it is a delta.
		var raw = Math.max(-maxMps, Math.min(maxMps,
			proj / SCALE - (overlayMode ? (baseline[a.key] || 0) : 0)));
		values[a.key] = baseline[a.key] + raw;
		redraw();
		onChange(a.key, values[a.key]);
	}
	svg.addEventListener("pointerdown", function (e) {
		if (e.button === 2) {
			panDragging = true; lastScreen = toVB(e);
			try { svg.setPointerCapture(e.pointerId); } catch (err) {}
			e.preventDefault();
			return;
		}
		if (e.button !== 0) { return; }
		var w = toWorld(toVB(e)), idx = pickAxis(w[0], w[1]);
		if (idx < 0) { return; }
		// A number field left focused (mid-typing skip in redraw(), above)
		// otherwise never lets go once the user instead drags an arrow — the
		// drag would keep updating values while the stale focused field's
		// display sits frozen. Blur it here so redraw()'s guard drops and the
		// field starts tracking the drag like the other two.
		var focused = document.activeElement;
		if (focused === nums.pro || focused === nums.rad || focused === nums.nrm) { focused.blur(); }
		dragIdx = idx; lastWorld = w;
		// Overlay mode's arrows are long (the whole plan burn) while the
		// reachable span is short, so a press only grabs; the drag moves it.
		if (!overlayMode) { setAxisAbsolute(w, axes[idx]); }
		try { svg.setPointerCapture(e.pointerId); } catch (err) {}
		e.preventDefault();
	});
	svg.addEventListener("pointermove", function (e) {
		if (panDragging) {
			var s = toVB(e);
			panX += s[0] - lastScreen[0]; panY += s[1] - lastScreen[1];
			lastScreen = s;
			applyTransform();
			return;
		}
		if (dragIdx < 0) { return; }
		var w = toWorld(toVB(e)), a = axes[dragIdx];
		var dproj = (w[0] - lastWorld[0]) * a.dx + (w[1] - lastWorld[1]) * a.dy;
		lastWorld = w;
		var sens = BURN_SENS * (e.shiftKey ? 0.25 : 1);
		var raw = Math.max(-maxMps, Math.min(maxMps, (values[a.key] - baseline[a.key]) + dproj * sens));
		values[a.key] = baseline[a.key] + raw;
		redraw();
		onChange(a.key, values[a.key]);
	});
	function endDrag() { dragIdx = -1; lastWorld = null; panDragging = false; lastScreen = null; }
	svg.addEventListener("pointerup", endDrag);
	svg.addEventListener("pointercancel", endDrag);

	host._sstRedraw = redraw;
	redraw();
}
