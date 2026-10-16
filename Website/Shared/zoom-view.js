// Zoom view — the pan-and-zoom drawing panel of the calculator shell. ES module:
//   import { ZoomView, svgEl } from "../../Shared/zoom-view.js";
//
// Fills an element (the shell's `stage`) with one SVG whose viewBox is the
// view: a centre (cx, cy) and a height h in WORLD units (the calculator picks
// them — km in the template). Wheel zooms about the pointer, dragging the
// background pans, the buttons zoom and fit, the overview map jumps, and
// `focus(name)` glides to a named target.
//
// Lines stay the same width on screen at any zoom: give them
// vector-effect="non-scaling-stroke". Anything else drawn at a fixed screen
// size (markers, text, offsets) is sized in pixels × `view.u` (world units per
// pixel) inside an onRender callback, which runs on every view change.
//
//   var view = new ZoomView(shell.stage, { unit: "km", initial: "orbit" });
//   view.addTarget("orbit", { label: "Orbit", color: "#FF6E40", rect: function () { return [x0, y0, x1, y1]; } });
//   view.onRender(draw);                     // draw(view) — redraw scale-dependent sizes
//   var c = svgEl("circle", { r: 10 }, view.layer);
//   view.draggable(marker, function (p) { … p.x, p.y in world units … });
//   view.setMinimap([x0, y0, x1, y1]);       // then draw the overview into view.miniLayer
//   view.legend([{ swatch: "<svg…>", label: "orbit" }]);

var svgNS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs, parent) {
	var e = document.createElementNS(svgNS, tag);
	if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
	if (parent) parent.appendChild(e);
	return e;
}

// ---- pure helpers -----------------------------------------------------------
// The largest 1, 2 or 5 × 10^n not above x (scale-bar lengths, tick steps).
export function niceNumber(x) {
	if (!(x > 0)) return 0;
	var p = Math.pow(10, Math.floor(Math.log10(x)));
	var m = x / p;
	return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

// The view {cx, cy, h} that shows rect [x0, y0, x1, y1] whole in a pxW × pxH
// panel, with `pad` (1.1 = 10 %) room around it.
export function fitRect(rect, pxW, pxH, pad) {
	var k = pad || 1.1;
	var w = Math.abs(rect[2] - rect[0]) * k, h = Math.abs(rect[3] - rect[1]) * k;
	return { cx: (rect[0] + rect[2]) / 2, cy: (rect[1] + rect[3]) / 2, h: Math.max(h, w * pxH / pxW) };
}

// [x, y, w, h] of the viewBox for a view in a pxW × pxH panel.
export function viewBoxOf(v, pxW, pxH) {
	var w = v.h * pxW / pxH;
	return [v.cx - w / 2, v.cy - v.h / 2, w, v.h];
}

// The view zoomed by factor f (f < 1 zooms in) about panel pixel (px, py),
// so the world point under that pixel stays put.
export function zoomAbout(v, f, px, py, pxW, pxH) {
	var u = v.h / pxH;
	var wx = v.cx + (px - pxW / 2) * u, wy = v.cy + (py - pxH / 2) * u;
	return { cx: wx + (v.cx - wx) * f, cy: wy + (v.cy - wy) * f, h: v.h * f };
}

// ---- DOM ------------------------------------------------------------------
function iconSvg(path) {
	var s = svgEl("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
		"stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
	s.innerHTML = path;
	return s;
}
function div(cls, parent) { var d = document.createElement("div"); d.className = cls; parent.appendChild(d); return d; }

export class ZoomView {
	// opts: { unit: "km", initial: target name, hint: text, minZoom, maxZoom (view heights) }
	constructor(stage, opts) {
		var o = opts || {};
		var self = this;
		this.stage = stage;
		this.unit = o.unit || "";
		this.initial = o.initial || null;
		this.minH = o.minZoom || 1e-6;
		this.maxH = o.maxZoom || 1e12;
		this.targets = {};
		this.renderers = [];
		this.view = null;
		this.pxW = 0; this.pxH = 0;
		this.u = 1;
		this.anim = null;
		this.drag = null;
		this.pan = null;

		this.svg = svgEl("svg", { "class": "cs-zv", role: "img", "aria-label": o.label || "Drawing; scroll to zoom, drag to pan" }, stage);
		this.layer = svgEl("g", null, this.svg);

		// overlays
		var tl = div("cs-ov cs-ov-tl", stage);
		this.pill = document.createElement("span");
		this.pill.className = "cs-pill";
		this.pill.innerHTML = '<span class="cs-pill-sw"></span><span class="cs-pill-k">Focus</span><b></b>';
		tl.appendChild(this.pill);
		this.legendEl = div("cs-legend", tl);

		var tr = div("cs-ov cs-ov-tr", stage);
		var zb = div("cs-zb", tr);
		[["Zoom in", '<path d="M8 3v10M3 8h10"/>', function () { self.zoomBy(1 / 1.8); }],
		 ["Zoom out", '<path d="M3 8h10"/>', function () { self.zoomBy(1.8); }],
		 ["Fit", '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>', function () { if (self.initial) self.focus(self.initial); }]
		].forEach(function (b) {
			var btn = document.createElement("button");
			btn.type = "button"; btn.title = b[0]; btn.setAttribute("aria-label", b[0]);
			btn.appendChild(iconSvg(b[1]));
			btn.onclick = b[2];
			zb.appendChild(btn);
		});

		var bl = div("cs-ov cs-ov-bl", stage);
		var sb = div("cs-sb", bl);
		this.sbText = document.createElement("span"); sb.appendChild(this.sbText);
		this.sbBar = document.createElement("i"); sb.appendChild(this.sbBar);

		var br = div("cs-ov cs-ov-br", stage);
		this.mini = svgEl("svg", { "class": "cs-mini", width: 128, height: 128, role: "img", "aria-label": "Overview; click to move the view" }, br);
		this.mini.style.display = "none";
		this.miniLayer = svgEl("g", null, this.mini);
		this.miniRect = svgEl("rect", { fill: "#FF6E40", "fill-opacity": 0.12, stroke: "#FF6E40", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }, this.mini);
		this.mini.addEventListener("click", function (ev) { self._miniClick(ev); });
		if (o.hint !== false) {
			var hp = document.createElement("span");
			hp.className = "cs-pill cs-hintpill";
			hp.textContent = o.hint || "Scroll to zoom · drag to pan";
			br.appendChild(hp);
		}

		// interaction
		this.svg.addEventListener("wheel", function (ev) {
			ev.preventDefault();
			self._stopAnim();
			var r = self.svg.getBoundingClientRect();
			self.zoomBy(Math.exp(ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top, true);
		}, { passive: false });
		this.svg.addEventListener("pointerdown", function (ev) {
			if (self.drag || !self.view) return;
			self._stopAnim();
			self.pan = { x: ev.clientX, y: ev.clientY, v: self.view };
			self.svg.setPointerCapture(ev.pointerId);
			self.svg.classList.add("cs-panning");
		});
		this.svg.addEventListener("pointermove", function (ev) {
			if (self.drag) self.drag(self.toWorld(ev.clientX, ev.clientY));
			else if (self.pan) {
				var p = self.pan, uu = p.v.h / self.pxH;
				self.setView({ cx: p.v.cx - (ev.clientX - p.x) * uu, cy: p.v.cy - (ev.clientY - p.y) * uu, h: p.v.h });
			}
		});
		var end = function () { self.drag = null; self.pan = null; self.svg.classList.remove("cs-panning"); };
		this.svg.addEventListener("pointerup", end);
		this.svg.addEventListener("pointercancel", end);

		var measure = function () {
			var r = self.svg.getBoundingClientRect();
			if (r.width < 4 || r.height < 4) return;
			var first = !self.view;
			self.pxW = r.width; self.pxH = r.height;
			if (first && self.initial && self.targets[self.initial]) self.focus(self.initial, true);
			else if (self.view) self.setView(self.view);
		};
		if (window.ResizeObserver) new ResizeObserver(measure).observe(this.svg);
		this._measure = measure;
		requestAnimationFrame(measure);
	}

	// ---- targets & focus ----
	// def: { label, color, rect: () => [x0, y0, x1, y1], pad (default 1.2 = 20 % margin) }
	addTarget(name, def) {
		this.targets[name] = def;
		if (!this.view && this.pxW && name === this.initial) this.focus(name, true);
	}

	focus(name, instant) {
		var t = this.targets[name];
		if (!t) return;
		this.pill.querySelector(".cs-pill-sw").style.background = t.color || "#EADFCF";
		this.pill.querySelector("b").textContent = t.label || name;
		if (!this.pxW) { this._measure(); if (!this.pxW) return; }
		var v = fitRect(t.rect(), this.pxW, this.pxH, t.pad || 1.2);
		if (instant || !this.view) this.setView(v); else this.animateTo(v);
	}

	// ---- view ----
	setView(v) {
		var h = Math.min(this.maxH, Math.max(this.minH, v.h));
		this.view = { cx: v.cx, cy: v.cy, h: h };
		if (!this.pxW) return;
		var b = viewBoxOf(this.view, this.pxW, this.pxH);
		this.svg.setAttribute("viewBox", b.join(" "));
		this.u = h / this.pxH;
		this._overlays(b);
		var self = this;
		this.renderers.forEach(function (fn) { fn(self); });
	}

	animateTo(target, dur) {
		var self = this, from = this.view || target;
		this._stopAnim();
		var t0 = performance.now(), d = dur || 520;
		var lh0 = Math.log(from.h), lh1 = Math.log(target.h);
		var step = function (now) {
			var q = Math.min(1, (now - t0) / d);
			q = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
			self.setView({ cx: from.cx + (target.cx - from.cx) * q, cy: from.cy + (target.cy - from.cy) * q, h: Math.exp(lh0 + (lh1 - lh0) * q) });
			self.anim = q < 1 ? requestAnimationFrame(step) : null;
		};
		this.anim = requestAnimationFrame(step);
	}

	zoomBy(f, px, py, instant) {
		if (!this.view) return;
		var x = px == null ? this.pxW / 2 : px, y = py == null ? this.pxH / 2 : py;
		var v = zoomAbout(this.view, f, x, y, this.pxW, this.pxH);
		if (instant) this.setView(v); else this.animateTo(v, 320);
	}

	_stopAnim() { if (this.anim) { cancelAnimationFrame(this.anim); this.anim = null; } }

	toWorld(clientX, clientY) {
		var r = this.svg.getBoundingClientRect();
		return { x: this.view.cx + (clientX - r.left - this.pxW / 2) * this.u, y: this.view.cy + (clientY - r.top - this.pxH / 2) * this.u };
	}

	// ---- drawing hooks ----
	onRender(fn) { this.renderers.push(fn); if (this.view && this.pxW) fn(this); }
	redraw() { if (this.view) this.setView(this.view); }

	// Make an SVG element draggable: onMove(worldPoint) runs while dragging.
	draggable(el, onMove, onStart) {
		var self = this;
		el.classList.add("cs-drag");
		el.addEventListener("pointerdown", function (ev) {
			ev.stopPropagation();
			self._stopAnim();
			self.drag = onMove;
			self.svg.setPointerCapture(ev.pointerId);
			if (onStart) onStart();
		});
	}

	// items: [{ swatch: SVG markup string (26×10), label }]
	legend(items) {
		this.legendEl.innerHTML = "";
		var self = this;
		items.forEach(function (it) {
			var s = document.createElement("span");
			s.className = "cs-lg";
			s.innerHTML = '<svg width="26" height="10" aria-hidden="true">' + it.swatch + "</svg>";
			s.appendChild(document.createTextNode(it.label));
			self.legendEl.appendChild(s);
		});
	}

	// World rect [x0, y0, x1, y1] the overview map shows; draw into miniLayer.
	setMinimap(rect) {
		this.miniBounds = rect;
		var w = rect[2] - rect[0], h = rect[3] - rect[1], s = Math.max(w, h);
		var cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
		this.miniBox = [cx - s / 2, cy - s / 2, s, s];
		this.mini.setAttribute("viewBox", this.miniBox.join(" "));
		this.mini.style.display = "";
		if (this.view) this.redraw();
	}

	_miniClick(ev) {
		if (!this.miniBox || !this.view) return;
		var r = this.mini.getBoundingClientRect();
		var fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
		var b = this.miniBox;
		this.animateTo({ cx: b[0] + fx * b[2], cy: b[1] + fy * b[3], h: this.view.h });
	}

	_overlays(b) {
		var len = niceNumber(110 * this.u);
		this.sbBar.style.width = Math.round(len / this.u) + "px";
		this.sbText.textContent = (len >= 1 ? len.toLocaleString("en-US") : String(+len.toPrecision(3))) + (this.unit ? " " + this.unit : "");
		if (this.miniBox) {
			var min = this.miniBox[2] * 6 / 116;
			var w = Math.max(b[2], min), h = Math.max(b[3], min);
			this.miniRect.setAttribute("x", this.view.cx - w / 2);
			this.miniRect.setAttribute("y", this.view.cy - h / 2);
			this.miniRect.setAttribute("width", w);
			this.miniRect.setAttribute("height", h);
		}
	}
}
