/* Shared/sim/vector-editor.js
 *
 * The isometric SVG burn-vector editor: three draggable prograde / radial /
 * normal arrows (same axis colours as Shared/sim/burn-widget.js's 3D gizmo —
 * prograde #6fd49a green, radial #ffb45a orange, normal #8ab4ff blue), plus
 * a numeric-input row underneath. Values are m/s in and out; the widget
 * displays and edits in km/s (±15 km/s range, shift-drag for fine control).
 *
 * Two SVG layers, independently transformed:
 * - `world`: the isometric reference glyph, the faint axis guide rays, and
 *   the draggable arrows — the whole picture moves and scales together, so
 *   an arrow is always drawn on top of its own axis. Carries a
 *   user-controlled translate+scale (zoom/pan), so a small burn can be
 *   zoomed in until it's as easy to grab as a large one.
 * - `overlay`: just the per-axis letter+value legend. Never transforms, so
 *   the legend stays put (and legible) at any zoom/pan level — it's a fixed
 *   compass reading, not part of the "image" underneath that pans.
 * Zoom is deliberately manual only (wheel, or the +/- buttons) — no
 * auto-fit-on-load, since a view that rescales itself is disorienting mid-
 * drag and surprising on open. A small control row (Zoom −/+, pan arrows)
 * makes the zoom/pan controls discoverable without cluttering the widget.
 * Zoom always grows from the widget's centre (where the axes originate),
 * regardless of where the mouse is — panning is the only thing that ever
 * moves the view off-centre, and only when the user does it (right-drag or
 * the pan-arrow buttons). Left-drag on an arrow tracks the arrowhead 1:1
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
 *   not just a display range. The legend/number row shows the DELTA from
 *   baseline (signed), not the absolute value, formatted via opts.displayDiv
 *   (m/s-per-displayed-unit, e.g. 1 for m/s or 1000 for km/s), opts.decimals
 *   and opts.step. opts.unitLabel, if given, prints that text beside each
 *   number field (e.g. "m/s") and narrows the field to make room — the
 *   default mode leaves the field full-width with no visible unit (the km/s
 *   convention is implied, not printed). Omitting opts (or opts.maxDeltaMps)
 *   reproduces the original absolute-from-zero, drag-clamped/type-unclamped,
 *   km/s-display behavior exactly.
 *
 * Styling comes from the page's own CSS (.sst-vecwidget, .sst-vec-controls,
 * .sst-vec-nums, .sst-vec-num, .sst-vec-num-row, .sst-vec-num-narrow —
 * MissionPlanner/planner.css carries them).
 *
 * renderVectorGlyph(host, values): a STATIC, read-only isometric burn glyph
 * — just the three arrows and their per-axis letter+value legend, drawn once
 * from a plain { pro, rad, nrm } (m/s) snapshot. No ship glyph, no
 * background axis rays, no zoom/pan, no numeric input row, no interaction —
 * for a context display of a burn nobody is dragging (Mission Planner's
 * read-only "plan waypoint" cards). Auto-scaled so the largest-magnitude
 * axis fills the view: unlike buildVectorEditor's fixed ±15 km/s / ±maxDelta
 * range (sized to leave room for dragging to any value), a read-only glyph
 * has no reason to reserve room the burn never uses.
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
	// row and legend text. AXIS_LEN is the fixed on-screen half-length a full
	// ±maxMps swing draws to (same pixels the original ±15 km/s used).
	var capped = !!(opts && isFinite(opts.maxDeltaMps));
	var baseline = (opts && opts.baseline) || { pro: 0, rad: 0, nrm: 0 };
	var maxMps = capped ? opts.maxDeltaMps : 15000;
	var dispDiv = (opts && isFinite(opts.displayDiv)) ? opts.displayDiv : 1000;
	var decimals = (opts && isFinite(opts.decimals)) ? opts.decimals : 2;
	var numStep = (opts && isFinite(opts.step)) ? opts.step : 0.01;
	var unitLabel = (opts && opts.unitLabel) || null;   // shown beside each number field, narrowed to make room
	var HIDE_FRAC = 0.008;   // matches the original 0.12 km/s dead-zone at MAXV=15 km/s
	var hideMps = maxMps * HIDE_FRAC;
	var W = 278, H = 300, OX = 139, OY = 150, AXIS_LEN = 112.5, SCALE = AXIS_LEN / maxMps, LEN = AXIS_LEN;
	var ZMIN = 1, ZMAX = 12, ZSTEP = 1.4, PANSTEP = 40; // never smaller than the default view
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
	// fixed overlay legend, so the legend always reads on top even at high zoom ----
	var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "sst-vecwidget" });
	var overlay = svgEl("g", { "class": "sst-vec-overlay" });
	var world = svgEl("g", { "class": "sst-vec-world" });

	(function () {
		// Three-face ship glyph (yqnn-generated path), scaled so its footprint
		// matches the old glyph's ~48-unit local length, centred on (5,6) — the
		// vertex shared by all three faces — so that vertex lands on the origin.
		var SHIP_SCALE = 3, SHIP_CX = 5, SHIP_CY = 6;
		function P(lx, ly) { return [OX + (lx - SHIP_CX) * SHIP_SCALE, OY + (ly - SHIP_CY) * SHIP_SCALE]; }
		function poly(pts, fill) {
			return svgEl("polygon", {
				points: pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "),
				fill: fill, "fill-opacity": 0.6 });
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
		world.appendChild(svgEl("line", {
			x1: OX - a.dx*LEN, y1: OY - a.dy*LEN, x2: OX + a.dx*LEN, y2: OY + a.dy*LEN,
			stroke: a.rayCol, "stroke-width": 1.5 }));
		var lx = OX + a.dx*(LEN+11), ly = OY + a.dy*(LEN+11);
		var t = svgEl("text", { x: lx, y: ly, fill: a.col, "text-anchor": "middle" });
		var letter = svgEl("tspan", { x: lx, dy: 0, "font-size": 12, "font-weight": 700 });
		letter.textContent = a.name.charAt(0).toUpperCase();
		var val = svgEl("tspan", { x: lx, dy: 13, "font-size": 10, "font-weight": 400, "fill-opacity": 0.85 });
		t.appendChild(letter); t.appendChild(val);
		overlay.appendChild(t);
		a.legendVal = val;
	});

	axes.forEach(function (a) {
		a.line = svgEl("line", { stroke: a.col, "stroke-linecap": "round" });
		a.head = svgEl("polygon", { fill: a.col });
		world.appendChild(a.line); world.appendChild(a.head);
	});

	svg.appendChild(world); svg.appendChild(overlay);
	host.appendChild(svg);

	var nums = {};
	var row = document.createElement("div"); row.className = "sst-vec-nums";
	axes.forEach(function (a) {
		var cell = document.createElement("label"); cell.className = "sst-vec-num";
		var tag = document.createElement("span");
		tag.textContent = a.name.charAt(0).toUpperCase() + a.name.slice(1);
		tag.style.color = a.col;
		var inp = document.createElement("input");
		inp.type = "number"; inp.step = numStep;
		if (unitLabel) { inp.className = "sst-vec-num-narrow"; }
		inp.value = ((values[a.key] - baseline[a.key]) / dispDiv).toFixed(decimals);
		inp.addEventListener("change", function () {
			var v = parseFloat(inp.value); if (!isFinite(v)) { v = 0; }
			var delta = v * dispDiv;
			if (capped) { delta = Math.max(-maxMps, Math.min(maxMps, delta)); }
			values[a.key] = baseline[a.key] + delta;
			redraw(); onChange(a.key, values[a.key]);
		});
		nums[a.key] = inp;
		cell.appendChild(tag);
		if (unitLabel) {
			// Input + unit on one row, narrower than the old full-width field —
			// there's room now that a visible "m/s" replaces the implied-km/s
			// convention the unlabeled fields rely on.
			var inpRow = document.createElement("span"); inpRow.className = "sst-vec-num-row";
			var unit = document.createElement("span"); unit.className = "mp-unit"; unit.textContent = unitLabel;
			inpRow.appendChild(inp); inpRow.appendChild(unit);
			cell.appendChild(inpRow);
		} else {
			cell.appendChild(inp);
		}
		row.appendChild(cell);
	});
	host.appendChild(row);

	function redraw() {
		// Local-space compensation so that after the `world` group's scale(zoom)
		// transform, the RENDERED stroke/arrowhead size ends up as
		// base * zoom^THICK_EXP instead of base * zoom.
		var thickComp = Math.pow(zoom, THICK_EXP - 1);
		var strokeW = BASE_STROKE * thickComp, headLen = BASE_HEAD_LEN * thickComp, headHalf = BASE_HEAD_HALF * thickComp;
		axes.forEach(function (a) {
			var raw = values[a.key] - baseline[a.key];
			var vis = Math.max(-maxMps, Math.min(maxMps, raw));
			var tx = OX + a.dx*vis*SCALE, ty = OY + a.dy*vis*SCALE;
			var show = Math.abs(vis) > hideMps;
			[a.line, a.head].forEach(function (n) { n.style.display = show ? "" : "none"; });
			if (show) {
				a.line.setAttribute("stroke-width", strokeW.toFixed(3));
				var s = vis < 0 ? -1 : 1, hx = s*a.dx, hy = s*a.dy, px = -hy, py = hx;
				// The shaft stops where the arrowhead's base starts, not at the value
				// point itself — the arrowhead sits past the end of the line, tip at
				// the value point, as arrows usually look. Clamp so a value shorter
				// than the arrowhead can't push its base past the origin.
				var baseLen = Math.min(headLen, Math.abs(vis) * SCALE);
				var bx = tx - hx*baseLen, by = ty - hy*baseLen;
				a.line.setAttribute("x1", OX); a.line.setAttribute("y1", OY);
				a.line.setAttribute("x2", bx); a.line.setAttribute("y2", by);
				a.head.setAttribute("points",
					tx + "," + ty + " " + (bx+px*headHalf) + "," + (by+py*headHalf) + " " + (bx-px*headHalf) + "," + (by-py*headHalf));
			}
			// Unclamped raw (not vis): matches the pre-cap widget's behavior of
			// showing the true typed value even past the drawn arrow's clamp. In
			// capped mode this is moot — the stored value is hard-clamped at every
			// mutation site, so raw already can't exceed vis.
			var numStr = (raw / dispDiv).toFixed(decimals);
			// The legend gets an explicit "+" for a positive delta (it's a plain
			// text node); the <input type=number> must not — a leading "+" is not
			// a valid number-input value per the HTML spec, so setting it blanks
			// the field instead of showing it.
			a.legendVal.textContent = (capped && raw > 0) ? "+" + numStr : numStr;
			if (document.activeElement !== nums[a.key]) { nums[a.key].value = numStr; }
		});
	}

	// ---- zoom / pan state on the `world` layer only; `overlay` never transforms.
	// Zoom always anchors on (OX,OY) — the point the axes originate from — so the
	// picture grows in place from the centre; only explicit panning (drag or the
	// pan buttons) ever moves it off-centre. ----
	var zoom = 1, panX = 0, panY = 0;
	function applyTransform() {
		world.setAttribute("transform", "translate(" + panX + "," + panY + ") scale(" + zoom + ")");
	}
	function setZoom(next) {
		next = Math.max(ZMIN, Math.min(ZMAX, next));
		var wx = (OX - panX) / zoom, wy = (OY - panY) / zoom;
		zoom = next;
		panX = OX - wx * zoom;
		panY = OY - wy * zoom;
		applyTransform();
		redraw(); // thickness/arrowhead size depend on zoom too, not just position
	}
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
		setZoom(zoom * factor);
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
		// swallowed by an oversized dead zone.
		var best = -1, bestPerp = 18, rx = px - OX, ry = py - OY, deadZone = 15 / zoom;
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
		var raw = Math.max(-maxMps, Math.min(maxMps, proj / SCALE));
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
		dragIdx = idx; lastWorld = w;
		setAxisAbsolute(w, axes[idx]);
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

	applyTransform();
	host._sstRedraw = redraw;
	redraw();
}

export function renderVectorGlyph(host, values) {
	host.innerHTML = "";
	var W = 170, H = 190, OX = 85, OY = 100;
	var axes = [
		{ key: "pro", name: "prograde", col: "#6fd49a", dx: Math.cos(-Math.PI / 6), dy: Math.sin(-Math.PI / 6) },
		{ key: "rad", name: "radial",   col: "#ffb45a", dx: Math.cos(Math.PI / 6),  dy: Math.sin(Math.PI / 6) },
		{ key: "nrm", name: "normal",   col: "#8ab4ff", dx: 0, dy: -1 }
	];
	// Auto-fit: AXIS_LEN is what the LARGEST-magnitude axis draws to (a
	// negligible burn falls back to maxAbs=1 so SCALE stays finite; nothing
	// draws at that scale anyway, since HIDE_FRAC below hides it).
	var maxAbs = Math.max(1, Math.abs(values.pro || 0), Math.abs(values.rad || 0), Math.abs(values.nrm || 0));
	var AXIS_LEN = 55, SCALE = AXIS_LEN / maxAbs;
	var HIDE_FRAC = 0.008, hideMps = maxAbs * HIDE_FRAC;
	var STROKE = 2.5, HEAD_LEN = 9, HEAD_HALF = 5;
	// MIN_TIP_R keeps a near-zero axis's label a little out from the shared
	// centre point (rather than sitting on top of the other two labels);
	// LABEL_PAD is the gap from an arrow's own tip to its label.
	var MIN_TIP_R = 14, LABEL_PAD = 12;

	var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "sst-vecwidget" });

	axes.forEach(function (a) {
		var v = values[a.key] || 0;
		var mag = Math.abs(v) * SCALE;
		var sgn = v < 0 ? -1 : 1;
		if (Math.abs(v) > hideMps) {
			var tx = OX + a.dx * v * SCALE, ty = OY + a.dy * v * SCALE;
			var hx = sgn * a.dx, hy = sgn * a.dy, px = -hy, py = hx;
			var baseLen = Math.min(HEAD_LEN, mag);
			var bx = tx - hx * baseLen, by = ty - hy * baseLen;
			svg.appendChild(svgEl("line", {
				x1: OX, y1: OY, x2: bx, y2: by,
				stroke: a.col, "stroke-width": STROKE, "stroke-linecap": "round" }));
			svg.appendChild(svgEl("polygon", { fill: a.col, points:
				tx + "," + ty + " " + (bx + px * HEAD_HALF) + "," + (by + py * HEAD_HALF) + " " +
				(bx - px * HEAD_HALF) + "," + (by - py * HEAD_HALF) }));
		}
		// The label sits AT THE ARROW'S OWN TIP — its actual direction
		// (sign included), not a fixed per-axis compass point — so the whole
		// glyph only needs to be as big as the arrows themselves.
		var tipR = Math.max(mag, MIN_TIP_R);
		var lx = OX + a.dx * (tipR + LABEL_PAD) * sgn, ly = OY + a.dy * (tipR + LABEL_PAD) * sgn;
		var t = svgEl("text", { x: lx, y: ly, fill: a.col, "text-anchor": "middle" });
		var letter = svgEl("tspan", { x: lx, dy: 0, "font-size": 12, "font-weight": 700 });
		letter.textContent = a.name.charAt(0).toUpperCase();
		var val = svgEl("tspan", { x: lx, dy: 13, "font-size": 10, "font-weight": 400, "fill-opacity": 0.85 });
		val.textContent = (v / 1000).toFixed(2);
		t.appendChild(letter); t.appendChild(val);
		svg.appendChild(t);
	});

	host.appendChild(svg);
}
