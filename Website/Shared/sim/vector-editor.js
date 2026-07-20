/* Shared/sim/vector-editor.js
 *
 * The isometric SVG burn-vector editor: three draggable prograde / radial /
 * normal arrows (same axis colours as Shared/sim/burn-widget.js's 3D gizmo —
 * prograde #6fd49a green, radial #ffb45a orange, normal #8ab4ff blue) around
 * a little isometric arrow glyph, plus a numeric-input row underneath. Values
 * are m/s in and out; the widget displays and edits in km/s (±15 km/s range,
 * shift-drag for fine control).
 *
 * Ported from the Solar-System-Trajectory-Plotter and then inlined
 * byte-identically in three MissionPlanner modules (transfer-leg,
 * departure-leg, body-departure-leg) before being extracted here verbatim
 * from body-departure-leg's copy.
 *
 * buildVectorEditor(host, values, onChange):
 * - host: a container element; its content is replaced with the SVG + the
 *   numeric row. The widget stores its redraw on `host._sstRedraw` so a
 *   caller that mutates `values` externally can refresh the arrows.
 * - values: a { pro, rad, nrm } object in m/s — MUTATED IN PLACE as the user
 *   drags or types (callers rely on this; it's the live burn object).
 * - onChange(axisKey, mps): called after each user edit with the axis
 *   ("pro" | "rad" | "nrm") and its new value in m/s.
 *
 * Styling comes from the page's own CSS (.sst-vecwidget, .sst-vec-nums,
 * .sst-vec-num — MissionPlanner/planner.css and the SST's stylesheet both
 * carry them).
 */

var SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
	var e = document.createElementNS(SVGNS, tag);
	for (var k in attrs) { e.setAttribute(k, attrs[k]); }
	return e;
}
export function buildVectorEditor(host, values, onChange) {
	host.innerHTML = "";
	var W = 278, H = 300, OX = 139, OY = 150, SCALE = 7.5, MAXV = 15, LEN = MAXV * SCALE;
	var axes = [
		{ key: "pro", name: "prograde", col: "#6fd49a", dx:  Math.cos(-Math.PI/6), dy: Math.sin(-Math.PI/6) },
		{ key: "rad", name: "radial",   col: "#ffb45a", dx:  Math.cos( Math.PI/6), dy: Math.sin( Math.PI/6) },
		{ key: "nrm", name: "normal",   col: "#8ab4ff", dx: 0, dy: -1 }
	];

	var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "sst-vecwidget" });

	(function () {
		var ux = Math.cos(-Math.PI/6), uy = Math.sin(-Math.PI/6);
		var vx = -uy, vy = ux;
		function P(lx, ly) { return [OX + lx*ux + ly*vx, OY + lx*uy + ly*vy]; }
		var A1 = P(-20, -6), A2 = P(-9, -12), A3 = P(-9, 10), A4 = P(-20, 16), E = P(28, -1);
		function poly(pts, fill) {
			return svgEl("polygon", {
				points: pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "),
				fill: fill, stroke: "#0c0f17", "stroke-width": 1.2, "stroke-linejoin": "round" });
		}
		svg.appendChild(poly([A1, A2, A3, A4], "#595d66"));
		svg.appendChild(poly([A1, A2, E],      "#7e828c"));
		svg.appendChild(poly([A2, A3, E],      "#3b3e46"));
	})();

	axes.forEach(function (a) {
		svg.appendChild(svgEl("line", {
			x1: OX - a.dx*LEN, y1: OY - a.dy*LEN, x2: OX + a.dx*LEN, y2: OY + a.dy*LEN,
			stroke: a.col, "stroke-opacity": 0.22, "stroke-width": 1 }));
		var t = svgEl("text", { x: OX + a.dx*(LEN+11), y: OY + a.dy*(LEN+11),
			fill: a.col, "fill-opacity": 0.7, "font-size": 11,
			"text-anchor": "middle", "dominant-baseline": "central" });
		t.textContent = a.name.charAt(0).toUpperCase();
		svg.appendChild(t);
	});

	axes.forEach(function (a) {
		a.line = svgEl("line", { stroke: a.col, "stroke-width": 2.5, "stroke-linecap": "round" });
		a.head = svgEl("polygon", { fill: a.col });
		a.val  = svgEl("text", { fill: a.col, "font-size": 11, "font-weight": 600,
			"text-anchor": "middle", "dominant-baseline": "central" });
		svg.appendChild(a.line); svg.appendChild(a.head); svg.appendChild(a.val);
	});
	host.appendChild(svg);

	var nums = {};
	var row = document.createElement("div"); row.className = "sst-vec-nums";
	axes.forEach(function (a) {
		var cell = document.createElement("label"); cell.className = "sst-vec-num";
		var tag = document.createElement("span");
		tag.textContent = a.name.charAt(0).toUpperCase() + a.name.slice(1);
		tag.style.color = a.col;
		var inp = document.createElement("input");
		inp.type = "number"; inp.step = 0.01; inp.value = (values[a.key]/1000).toFixed(2);
		inp.addEventListener("change", function () {
			var v = parseFloat(inp.value); if (!isFinite(v)) { v = 0; }
			values[a.key] = v * 1000; redraw(); onChange(a.key, v * 1000);
		});
		nums[a.key] = inp;
		cell.appendChild(tag); cell.appendChild(inp); row.appendChild(cell);
	});
	host.appendChild(row);

	function redraw() {
		axes.forEach(function (a) {
			var v = values[a.key] / 1000;
			var vis = Math.max(-MAXV, Math.min(MAXV, v));
			var tx = OX + a.dx*vis*SCALE, ty = OY + a.dy*vis*SCALE;
			var show = Math.abs(vis) > 0.12;
			[a.line, a.head].forEach(function (n) { n.style.display = show ? "" : "none"; });
			if (show) {
				a.line.setAttribute("x1", OX); a.line.setAttribute("y1", OY);
				a.line.setAttribute("x2", tx); a.line.setAttribute("y2", ty);
				var s = vis < 0 ? -1 : 1, hx = s*a.dx, hy = s*a.dy, px = -hy, py = hx;
				var bx = tx - hx*9, by = ty - hy*9;
				a.head.setAttribute("points",
					tx + "," + ty + " " + (bx+px*5) + "," + (by+py*5) + " " + (bx-px*5) + "," + (by-py*5));
			}
			if (Math.abs(v) > 0.005) {
				a.val.style.display = "";
				a.val.setAttribute("x", tx + (vis<0?-1:1)*a.dx*15);
				a.val.setAttribute("y", ty + (vis<0?-1:1)*a.dy*15);
				a.val.textContent = v.toFixed(2);
			} else { a.val.style.display = "none"; }
			if (document.activeElement !== nums[a.key]) { nums[a.key].value = v.toFixed(2); }
		});
	}

	function toVB(e) {
		var r = svg.getBoundingClientRect();
		return [ (e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H ];
	}
	function pickAxis(px, py) {
		var best = -1, bestPerp = 18, rx = px - OX, ry = py - OY;
		for (var i = 0; i < axes.length; i++) {
			var a = axes[i];
			var proj = rx*a.dx + ry*a.dy, perp = Math.abs(rx*a.dy - ry*a.dx);
			if (Math.abs(proj) > 6 && perp < bestPerp) { bestPerp = perp; best = i; }
		}
		return best;
	}

	var dragIdx = -1, lastVB = null;
	var BURN_SENS = 1 / (SCALE * 10);
	function setAxisAbsolute(p, a) {
		var proj = (p[0] - OX) * a.dx + (p[1] - OY) * a.dy;
		var v = Math.max(-MAXV, Math.min(MAXV, proj / SCALE));
		values[a.key] = v * 1000;
		redraw();
		onChange(a.key, v * 1000);
	}
	svg.addEventListener("pointerdown", function (e) {
		var p = toVB(e), idx = pickAxis(p[0], p[1]);
		if (idx < 0) { return; }
		dragIdx = idx; lastVB = p;
		setAxisAbsolute(p, axes[idx]);
		try { svg.setPointerCapture(e.pointerId); } catch (err) {}
		e.preventDefault();
	});
	svg.addEventListener("pointermove", function (e) {
		if (dragIdx < 0) { return; }
		var p = toVB(e), a = axes[dragIdx];
		var dproj = (p[0] - lastVB[0]) * a.dx + (p[1] - lastVB[1]) * a.dy;
		lastVB = p;
		var sens = BURN_SENS * (e.shiftKey ? 0.25 : 1);
		var v = Math.max(-MAXV, Math.min(MAXV, values[a.key] / 1000 + dproj * sens));
		values[a.key] = v * 1000;
		redraw();
		onChange(a.key, v * 1000);
	});
	function endDrag() { dragIdx = -1; lastVB = null; }
	svg.addEventListener("pointerup", endDrag);
	svg.addEventListener("pointercancel", endDrag);

	host._sstRedraw = redraw;
	redraw();
}
