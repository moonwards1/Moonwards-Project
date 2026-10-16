// Calculator template — the standard way to build a Moonwards calculator on the
// calculator shell. A circular orbit around a chosen body, with an optional
// target orbit and the Hohmann transfer to it, and an optional escape card.
//
// Shows each part of the shell once:
//   CalcShell (calc-shell.js)  header chips, three columns, cards, fields, results
//   ZoomView  (zoom-view.js)   the pan-and-zoom drawing, focus targets, markers
//   systems   (orbit.js)       body data;  OrbitalMath (math-utils.js) the maths
//
// The pattern: build the cards once, then `calc()` reads every field, computes,
// writes the results and summaries, and asks the drawing to redraw. Anything in
// the drawing sized in screen pixels is multiplied by `view.u` in `draw()`.
//
// ES module (loaded with <script type="module">); deferred, so the DOM is ready.

import { systems } from "../../Shared/orbit.js";
import { OrbitalMath } from "../../Shared/math-utils.js";
import { CalcShell, ShellColors as C } from "../../Shared/calc-shell.js";
import { ZoomView, svgEl } from "../../Shared/zoom-view.js";

// ---------- page ----------
var shell = new CalcShell(document.getElementById("app"), { title: "Circular Orbit", stageLabel: "Orbit drawing" });

// Modules: an input module that brings its result, and a result-only module.
shell.addModule({ id: "tgt", side: "in", label: "Target orbit", color: C.teal, on: true, brings: ["xfer"],
	tip: "A second circular orbit; brings the Transfer results" });
shell.addModule({ id: "xfer", side: "out", label: "Transfer", color: C.teal, on: true, needs: ["tgt"],
	tip: "Hohmann transfer to the target orbit (needs Target orbit)" });
shell.addModule({ id: "esc", side: "out", label: "Escape", color: C.violet,
	tip: "Escape speed from the orbit" });

// ---------- inputs ----------
var BODIES = ["Moon", "Mercury", "Venus", "Earth", "Mars", "Phobos", "Ceres", "Vesta", "Europa", "Ganymede", "Callisto", "Titan"];
var FILL = { Mars: "#5E3424", Venus: "#5A4A33", Earth: "#2F3E4A", Europa: "#58524B" };

var bodyCard = shell.addCard({ id: "body", side: "in", title: "Body", short: "Body", color: C.umber, focus: "system" });
var bodyIn = shell.selectField(bodyCard, { aria: "Body orbited", value: "Moon",
	options: BODIES.map(function (n) { return { value: n, label: n }; }) });
var bodyNote = shell.note(bodyCard, "");

var orbitCard = shell.addCard({ id: "orbit", side: "in", title: "Orbit", short: "Orbit", color: C.core, focus: "orbit" });
var altIn = shell.numberField(orbitCard, { label: "Altitude", hint: "above the mean surface", unit: "km", value: 100, focus: "orbit" });
shell.note(orbitCard, "Or drag the marker on the drawing.");

var tgtCard = shell.addCard({ id: "tgt", side: "in", title: "Target orbit", short: "Target", color: C.teal, module: "tgt", focus: "target" });
var tgtIn = shell.numberField(tgtCard, { label: "Target altitude", unit: "km", value: 500, focus: "target" });

// ---------- results ----------
var resCard = shell.addCard({ id: "res", side: "out", title: "Orbit", short: "Orbit", color: C.core, focus: "orbit" });
var hero = shell.hero(resCard, [{ label: "Speed", unit: "km/s" }, { label: "Period", unit: "h" }, { label: "Gravity", unit: "m/s²" }]);
var rRadius = shell.line(resCard, { label: "Orbital radius", unit: "km" });
var rPerDay = shell.line(resCard, { label: "Orbits per day" });

var xferCard = shell.addCard({ id: "xfer", side: "out", title: "Transfer", short: "Transfer", color: C.teal, module: "xfer", focus: "transfer" });
var rDv1 = shell.line(xferCard, { label: "First burn", unit: "m/s", sub: "leaving the orbit" });
var rDv2 = shell.line(xferCard, { label: "Second burn", unit: "m/s", sub: "circularising at the target" });
var rDvT = shell.line(xferCard, { label: "Total Δv", unit: "m/s" });
var rTof = shell.line(xferCard, { label: "Transfer time", unit: "h" });

var escCard = shell.addCard({ id: "esc", side: "out", title: "Escape", short: "Escape", color: C.violet, module: "esc", focus: "orbit" });
var rVesc = shell.line(escCard, { label: "Escape speed at the orbit", unit: "m/s" });
var rDvEsc = shell.line(escCard, { label: "Δv to escape from the orbit", unit: "m/s" });

// ---------- drawing ----------
var view = new ZoomView(shell.stage, { unit: "km", initial: "system", hint: "Drag markers · scroll to zoom · drag to pan" });
view.legend([
	{ swatch: '<path d="M1 5h24" stroke="' + C.core.draw + '" stroke-width="1.6"/>', label: "orbit" },
	{ swatch: '<path d="M1 5h24" stroke="' + C.teal.draw + '" stroke-width="1.6" stroke-dasharray="4 3"/>', label: "target orbit and transfer" }
]);

var L = view.layer, NS = { "vector-effect": "non-scaling-stroke" };
var gBody = svgEl("circle", Object.assign({ cx: 0, cy: 0, stroke: "#9C8A77", "stroke-width": 1.5 }, NS), L);
var gTgt = svgEl("circle", Object.assign({ cx: 0, cy: 0, fill: "none", stroke: C.teal.draw, "stroke-width": 1.4, "stroke-dasharray": "6 5" }, NS), L);
var gXfer = svgEl("path", Object.assign({ fill: "none", stroke: C.teal.draw, "stroke-width": 1.6 }, NS), L);
var gOrbit = svgEl("circle", Object.assign({ cx: 0, cy: 0, fill: "none", stroke: C.core.draw, "stroke-width": 1.6 }, NS), L);
// Text carries a dark outline (stroke painted under the fill) so lines never strike through it.
var HALO = { stroke: "#1D1814", "paint-order": "stroke", "stroke-linejoin": "round" };
var labelAttrs = Object.assign({ "font-family": "Instrument Sans, sans-serif", fill: "#EADFCF", "text-anchor": "end" }, HALO);
var tOrbit = svgEl("text", labelAttrs, L), tTgt = svgEl("text", labelAttrs, L);
var tDv1 = svgEl("text", Object.assign({ "font-family": "JetBrains Mono, monospace", fill: C.teal.draw }, HALO), L);
var tDv2 = svgEl("text", Object.assign({ "font-family": "JetBrains Mono, monospace", fill: C.teal.draw }, HALO), L);
var mTgt = svgEl("circle", Object.assign({ cx: 0, fill: C.teal.draw, stroke: "#1D1814", "stroke-width": 2 }, NS), L);
var mOrbit = svgEl("circle", Object.assign({ cx: 0, fill: C.core.draw, stroke: "#1D1814", "stroke-width": 2 }, NS), L);
var miniBody = svgEl("circle", { cx: 0, cy: 0, stroke: "#9C8A77", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }, view.miniLayer);
var miniOrbit = svgEl("circle", { cx: 0, cy: 0, fill: "none", stroke: C.core.draw, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }, view.miniLayer);
var miniTgt = svgEl("circle", { cx: 0, cy: 0, fill: "none", stroke: C.teal.draw, "stroke-width": 1, "vector-effect": "non-scaling-stroke" }, view.miniLayer);

function label(el, name, value) {
	el.innerHTML = "";
	svgEl("tspan", { "font-weight": 700, "letter-spacing": "0.06em" }, el).textContent = name;
	var v = svgEl("tspan", { fill: "#A99A8B", "font-family": "JetBrains Mono, monospace" }, el);
	v.textContent = "  " + value;
}

// ---------- state shared by calc() and draw() ----------
var S = {};
function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }
function kmText(a) { return num(a, a < 100 ? 1 : 0) + " km"; }
function field(input, fallback) { var v = parseFloat(input.value); return isFinite(v) ? v : fallback; }

function calc() {
	var b = systems.get(bodyIn.value);
	var GM = b.GM, R = Number(b.radius);
	var alt = Math.max(0, field(altIn, 100)), tgt = Math.max(0, field(tgtIn, 500));
	var r1 = R + alt * 1e3, r2 = R + tgt * 1e3;
	var v = OrbitalMath.circularVelocity(GM, r1), T = OrbitalMath.orbitalPeriod(GM, r1);
	var g = OrbitalMath.gravity(GM, r1), vEsc = OrbitalMath.escapeVelocity(GM, r1);
	var h = OrbitalMath.hohmann(GM, r1, r2);
	S = { R: R / 1e3, alt: alt, tgt: tgt, r1: r1 / 1e3, r2: r2 / 1e3, h: h, fill: FILL[bodyIn.value] || "#4A4038" };

	bodyNote.textContent = "Radius " + num(R / 1e3, 1) + " km · surface gravity " + num(OrbitalMath.gravity(GM, R), 2) + " m/s²";
	hero[0].set(num(v / 1e3, 3)); hero[1].set(num(T / 3600, 2)); hero[2].set(num(g, 3));
	rRadius.set(num(r1 / 1e3, 1)); rPerDay.set(num(86400 / T, 2));
	rDv1.set(num(h.dv1, 1)); rDv2.set(num(h.dv2, 1)); rDvT.set(num(h.total, 1)); rTof.set(num(h.tof / 3600, 2));
	rVesc.set(num(vEsc, 1)); rDvEsc.set(num(vEsc - v, 1));

	bodyCard.setSummary(bodyIn.value);
	orbitCard.setSummary(kmText(alt));
	tgtCard.setSummary(kmText(tgt));
	resCard.setSummary(num(v / 1e3, 2) + " km/s · " + num(T / 3600, 2) + " h");
	xferCard.setSummary(num(h.total, 0) + " m/s · " + num(h.tof / 3600, 2) + " h");
	escCard.setSummary(num(vEsc - v, 0) + " m/s to escape");
	shell.warn(alt === tgt && shell.isOn("tgt") ? "The target orbit is the same as the orbit: no transfer needed." : "");

	var span = Math.max(S.r1, shell.isOn("tgt") ? S.r2 : 0) * 1.15;
	view.setMinimap([-span, -span, span, span]);
	view.redraw();
}

function draw(vw) {
	if (!S.R) return;
	var u = vw.u, tgtOn = shell.isOn("tgt"), xferOn = shell.isOn("xfer");
	gBody.setAttribute("r", S.R); gBody.setAttribute("fill", S.fill);
	gOrbit.setAttribute("r", S.r1);
	gTgt.setAttribute("r", S.r2); gTgt.style.display = tgtOn ? "" : "none";
	// Hohmann half-ellipse: periapsis at the orbit (top), apoapsis on the far side.
	var a = (S.r1 + S.r2) / 2, bb = Math.sqrt(S.r1 * S.r2);
	gXfer.setAttribute("d", "M0 " + (-S.r1) + "A" + bb + " " + a + " 0 0 1 0 " + S.r2);
	gXfer.style.display = xferOn ? "" : "none";

	mOrbit.setAttribute("cy", -S.r1); mOrbit.setAttribute("r", 7 * u);
	mTgt.setAttribute("cy", -S.r2); mTgt.setAttribute("r", 6 * u); mTgt.style.display = tgtOn ? "" : "none";
	[tOrbit, tTgt, tDv1, tDv2].forEach(function (t) { t.setAttribute("font-size", 12 * u); t.setAttribute("stroke-width", 4 * u); });
	tOrbit.setAttribute("x", -14 * u); tOrbit.setAttribute("y", -S.r1 - 7 * u);
	label(tOrbit, "ORBIT", kmText(S.alt));
	tTgt.setAttribute("x", -14 * u); tTgt.setAttribute("y", -S.r2 - 7 * u);
	label(tTgt, "TARGET", kmText(S.tgt)); tTgt.style.display = tgtOn ? "" : "none";
	tDv1.setAttribute("x", 12 * u); tDv1.setAttribute("y", -S.r1 - 10 * u);
	tDv1.textContent = "Δv₁ " + num(S.h.dv1, 1) + " m/s";
	tDv2.setAttribute("x", 12 * u); tDv2.setAttribute("y", S.r2 + 16 * u);
	tDv2.textContent = "Δv₂ " + num(S.h.dv2, 1) + " m/s";
	tDv1.style.display = tDv2.style.display = xferOn ? "" : "none";

	miniBody.setAttribute("r", S.R); miniBody.setAttribute("fill", S.fill);
	miniOrbit.setAttribute("r", S.r1);
	miniTgt.setAttribute("r", S.r2); miniTgt.style.display = tgtOn ? "" : "none";
}

// ---------- focus targets: world rects [x0, y0, x1, y1] ----------
function around(r) { var d = Math.min(r, Math.max(S.R * 0.35, (r - S.R) * 3)); return [-d, -r - 0.6 * d, d, -r + 0.6 * d]; }
view.addTarget("system", { label: "Whole system", color: "#EADFCF", pad: 1.3, rect: function () { var s = Math.max(S.r1, shell.isOn("tgt") ? S.r2 : 0); return [-s, -s, s, s]; } });
view.addTarget("orbit", { label: "Orbit", color: C.core.draw, rect: function () { return around(S.r1); } });
view.addTarget("target", { label: "Target orbit", color: C.teal.draw, rect: function () { return around(S.r2); } });
view.addTarget("transfer", { label: "Transfer", color: C.teal.draw, pad: 1.3, rect: function () { var s = Math.max(S.r1, S.r2); return [-s, -s, s, s]; } });

// ---------- wiring ----------
function dragAltitude(input, card) {
	return function (p) {
		var a = Math.max(0.1, Math.hypot(p.x, p.y) - S.R);
		input.value = a < 100 ? a.toFixed(1) : Math.round(a);
		calc();
		if (shell.focusId !== card) shell.focusCard(card, false);   // highlight the card, keep the view
	};
}
view.draggable(mOrbit, dragAltitude(altIn, "orbit"));
view.draggable(mTgt, dragAltitude(tgtIn, "tgt"));

shell.onInput(calc);
shell.onModules(calc);
shell.onFocus(function (target) { view.focus(target); });
view.onRender(draw);

calc();   // show results on load
