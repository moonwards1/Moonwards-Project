/* Shared/sim/moon-glyph.js
 *
 * The Moon-phase SVG glyph — a lit crescent/gibbous/half/full shape swept
 * from a Moon-Sun elongation angle (core/departure-estimate.js's
 * moonElongationDeg). Shared between MissionPlanner's Ephemeris tab (the
 * "Moon phase at launch/arrival" widget) and the Departure sidebar's Moon
 * card. Styled by the mp-moonglyph* classes in planner.css; this file only
 * builds the SVG and updates its lit path.
 */

var NS = "http://www.w3.org/2000/svg";

// The lit shape: bounded by the outer limb on the lit side and the
// terminator — a half-ellipse whose semi-axis is R|cos e| — so the glyph
// sweeps full -> gibbous -> half -> crescent -> new continuously. Waxing
// (sin e > 0) lights the right side. SVG sweep flags: on the bottom->top
// return leg, 0 bulges right, 1 bulges left.
function glyphPath(elongDeg) {
	var R = 17, cx = 20, top = 3, bot = 37;
	var e = ((elongDeg % 360) + 360) % 360;
	if (e < 1 || e > 359) { return ""; }               // new moon — nothing lit
	var c = Math.cos(e * Math.PI / 180);
	var rx = Math.max(0.4, R * Math.abs(c));           // 0 collapses the arc; keep a hairline
	var right = Math.sin(e * Math.PI / 180) >= 0;
	var limbSweep = right ? 1 : 0;
	var termSweep = right ? (c > 0 ? 0 : 1) : (c > 0 ? 1 : 0);
	return "M " + cx + " " + top +
		" A " + R + " " + R + " 0 0 " + limbSweep + " " + cx + " " + bot +
		" A " + rx.toFixed(2) + " " + R + " 0 0 " + termSweep + " " + cx + " " + top + " Z";
}

// Builds the <svg> glyph and appends it to `parent`. Returns
// { svg, setPhase(elongDeg) }.
export function buildMoonGlyph(parent) {
	var svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 40 40");
	svg.setAttribute("class", "mp-moonglyph");
	var shadow = document.createElementNS(NS, "circle");
	shadow.setAttribute("cx", "20"); shadow.setAttribute("cy", "20"); shadow.setAttribute("r", "17");
	shadow.setAttribute("class", "mp-moonglyph-shadow");
	var lit = document.createElementNS(NS, "path");
	lit.setAttribute("class", "mp-moonglyph-lit");
	var rim = document.createElementNS(NS, "circle");
	rim.setAttribute("cx", "20"); rim.setAttribute("cy", "20"); rim.setAttribute("r", "17");
	rim.setAttribute("class", "mp-moonglyph-rim");
	svg.appendChild(shadow); svg.appendChild(lit); svg.appendChild(rim);
	parent.appendChild(svg);
	return {
		svg: svg,
		setPhase: function (elongDeg) { lit.setAttribute("d", glyphPath(elongDeg)); }
	};
}
