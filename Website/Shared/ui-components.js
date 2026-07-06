//reusable UI bits
//
// Shared DOM helpers for the Moonwards calculators. ES module:
//   import { create } from "../../Shared/ui-components.js";
//
// create(tag, classes, text, appendLocation, cssText)
//   tag            - element tag name, e.g. "div", "input", "span"
//   classes        - one of:
//                      false / undefined : no class
//                      "#someId"         : sets element.id = "someId"
//                      "className"       : adds that class ("newTab" also adds target=_blank)
//                      ["a","b", ...]    : adds several classes ("newTab" -> target=_blank)
//   text           - if truthy (or 0) sets element.innerText
//   appendLocation - if it has appendChild, the new element is appended to it
//   cssText        - inline style string
//   returns the created element.

export function create(HTMLtag, classes, text, appendLocation, cssText) {
	var element = document.createElement(HTMLtag);
	if (Array.isArray(classes)) {
		element.classList.add.apply(element.classList, classes);
		if (classes.indexOf("newTab") !== -1) {
			element.setAttribute("target", "_blank");
		}
	} else if (classes) {
		if (classes[0] === "#") {
			element.id = classes.substring(1);
		} else {
			element.classList.add(classes);
			if (classes === "newTab") {
				element.setAttribute("target", "_blank");
			}
		}
	}
	if (text || text === 0) {
		element.innerText = text;
	}
	if (appendLocation && appendLocation.appendChild) {
		appendLocation.appendChild(element);
	}
	if (cssText) {
		element.style.cssText = cssText;
	}
	return element;
}
