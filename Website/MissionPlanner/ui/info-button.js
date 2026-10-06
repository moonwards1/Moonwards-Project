// The "i" help button that sits beside a component's title on the Ephemeris
// tab: a solid red-orange disc with a white bold italic i (styled by
// planner.css's .mp-info). `topic` names the instructions it will open.

export function createInfoButton(topic) {
	var b = document.createElement("button");
	b.type = "button";
	b.className = "mp-info";
	b.dataset.topic = topic;
	b.setAttribute("aria-label", "How to use: " + topic);
	b.title = "How to use: " + topic;
	b.textContent = "i";
	// A button inside a tab or draggable title bar must not also trigger them.
	b.addEventListener("click", function (e) { e.stopPropagation(); });
	b.addEventListener("mousedown", function (e) { e.stopPropagation(); });
	return b;
}
