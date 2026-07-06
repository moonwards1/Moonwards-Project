//shared animation helpers
//
// Shared SVG reveal/zoom helpers for the Moonwards calculators. ES module:
//   import { SkyAnim } from "../../Shared/animation.js";
// These wrap the small SMIL pattern the calculators use to fade their results
// in and tween the viewBox when inputs change.

var svgNS = "http://www.w3.org/2000/svg";

function makeAnimate(attributeName) {
	var a = document.createElementNS(svgNS, "animate");
	a.setAttributeNS(null, "attributeName", attributeName);
	a.setAttributeNS(null, "begin", "indefinite");
	a.setAttributeNS(null, "fill", "freeze");
	return a;
}

export const SkyAnim = {

	// Fade an element's opacity in. `values` is the SMIL values string
	// (e.g. "0;0;1" to hold then fade), `dur` is seconds.  The <animate> is
	// appended to the target and started immediately.
	fadeIn: function (target, values, dur) {
		var a = makeAnimate("opacity");
		a.setAttributeNS(null, "values", values || "0;1");
		a.setAttributeNS(null, "dur", dur || 1.5);
		target.appendChild(a);
		a.beginElement();
		return a;
	},

	// Tween an SVG element's viewBox from one rectangle string to another.
	tweenViewBox: function (svgRoot, fromViewBox, toViewBox, dur) {
		var a = makeAnimate("viewBox");
		a.setAttributeNS(null, "from", fromViewBox);
		a.setAttributeNS(null, "to", toViewBox);
		a.setAttributeNS(null, "dur", dur || 0.5);
		svgRoot.appendChild(a);
		a.beginElement();
		return a;
	}
};
