// The Ephemeris tab's getting-started guide: a short sequence of messages in
// the date bar, beside the POV buttons, each pointing at the control to try
// next and outlining it on the page.
//
// Which message shows is DERIVED from what is on screen every time the tab
// refreshes (guideStep), never advanced by a one-way script, so opening an
// example, pasting a link, zeroing the impulse or pressing Reset all land on
// the right message by themselves. Steps 4 and 5 have no on-screen state to
// read — they ask the reader to try controls — so the guide keeps its own
// "has been used" flags for them, cleared by resetProgress() (the marker
// card's Reset).
//
// The ‹ › arrows browse the messages by hand; the next change to the derived
// step drops that browsing and follows the page again. ✕ closes the guide and
// leaves a small "Tutorial" button in its place; the closed state is
// remembered per browser.

export var GUIDE_MESSAGES = [
	"Pick an origin and a destination from the menus at the top of the sidebar.",
	"Click on the axes of the Departure impulse gizmo to begin making a trajectory. " +
		"Drag the arrows or use the fields underneath.",
	"Click on the trajectory to place a chevron marking the location of the ship. " +
		"The × shows where the destination will be when the ship is in that spot.",
	"Use the date and flight time sliders to find a spot where the ship and the " +
		"destination are close to each other.",
	"Adjust impulse and sliders to get an arrival. You can use the Target button to " +
		"find one once there is a close pass.",
	"Click Start Mission Plan to open this as a mission, or Reset to start a different trip."
];

// The step (1..GUIDE_MESSAGES.length) for what is on screen: the first one
// not yet done. status: { destination (string, "" for none), burnSet (bool),
// marker (bool), slid: { coarse, fine, marker } (bools), targetUsed (bool) }.
export function guideStep(status) {
	if (!status.destination) { return 1; }
	if (!status.burnSet) { return 2; }
	if (!status.marker) { return 3; }
	var s = status.slid || {};
	if (!(s.coarse && s.fine && s.marker)) { return 4; }
	if (!status.targetUsed) { return 5; }
	return 6;
}

// Trajectory highlight for step 3, 0..1 (how far to lighten the line):
// three pulses, then a steady partial glow until the step is done. ms is the
// time since the step was first shown; reduced motion skips the pulses.
export var PULSE_MS = 700, PULSE_COUNT = 3, STEADY_GLOW = 0.35;
export function trajectoryGlow(ms, reducedMotion) {
	if (reducedMotion || ms >= PULSE_MS * PULSE_COUNT) { return STEADY_GLOW; }
	return 0.5 - 0.5 * Math.cos(2 * Math.PI * ms / PULSE_MS);
}

var STORE_KEY = "mp-guide-closed";
function readClosed() {
	try { return window.localStorage.getItem(STORE_KEY) === "1"; } catch (_) { return false; }
}
function writeClosed(closed) {
	try {
		if (closed) { window.localStorage.setItem(STORE_KEY, "1"); }
		else { window.localStorage.removeItem(STORE_KEY); }
	} catch (_) {}
}

// Outline + background flash for a highlighted element (planner.css's
// .mp-attn: a few pulses, then a steady outline). Re-adding restarts it.
export function setAttention(el, on) {
	if (!el) { return; }
	if (!on) { el.classList.remove("mp-attn"); return; }
	el.classList.remove("mp-attn");
	void el.offsetWidth;          // reflow, so the pulse animation starts over
	el.classList.add("mp-attn");
}

// opts: {
//   hostEl                — the date-bar span the guide builds into
//   getStatus()           — { destination, burnSet, marker } from the tab
//   targets(step)         — the elements to outline for that step (array)
//   sliders: { coarse, fine, marker } — the three sliders step 4 asks for
//   targetButton          — the marker card's Target mode button
// }
// Returns { sync, resetProgress, trajectoryGlow }.
export function createEphemerisGuide(opts) {
	var host = opts.hostEl;
	host.classList.add("mp-guide");

	var slid = { coarse: false, fine: false, marker: false };
	var targetUsed = false;
	var closed = readClosed();
	var derived = 0;          // the step the page is on
	var browsed = null;       // a step picked with the arrows, until the page moves on
	var shown = 0;            // the step whose message and outlines are up
	var shownAt = 0;          // performance.now() when `shown` went up
	var outlined = [];
	var reducedMotion = !!(window.matchMedia &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches);

	var text = document.createElement("span"); text.className = "mp-guide-text";
	var ctl = document.createElement("span"); ctl.className = "mp-guide-ctl";
	function ctlBtn(label, title, onClick) {
		var b = document.createElement("button");
		b.type = "button"; b.className = "mp-guide-btn"; b.textContent = label; b.title = title;
		b.addEventListener("click", onClick);
		ctl.appendChild(b);
		return b;
	}
	var prevBtn = ctlBtn("‹", "Previous tip", function () { browse(-1); });
	var count = document.createElement("span"); count.className = "mp-guide-count"; ctl.appendChild(count);
	var nextBtn = ctlBtn("›", "Next tip", function () { browse(1); });
	ctlBtn("✕", "Close the tutorial", function () { setClosed(true); });
	var openBtn = document.createElement("button");
	openBtn.type = "button"; openBtn.className = "mp-guide-btn mp-guide-open";
	openBtn.textContent = "Tutorial"; openBtn.title = "Show the getting-started tips";
	openBtn.addEventListener("click", function () { setClosed(false); });
	host.appendChild(text); host.appendChild(ctl); host.appendChild(openBtn);

	// Any hands-on use counts as having slid it: a drag, a click on the
	// track, the wheel or the arrow keys.
	function watchSlider(el, key) {
		if (!el) { return; }
		function mark() { if (!slid[key]) { slid[key] = true; sync(); } }
		["pointerdown", "input", "wheel", "keydown"].forEach(function (ev) {
			el.addEventListener(ev, mark, { passive: true });
		});
	}
	watchSlider(opts.sliders.coarse, "coarse");
	watchSlider(opts.sliders.fine, "fine");
	watchSlider(opts.sliders.marker, "marker");
	if (opts.targetButton) {
		opts.targetButton.addEventListener("click", function () {
			if (!targetUsed) { targetUsed = true; sync(); }
		});
	}

	function browse(delta) {
		var cur = browsed || derived;
		browsed = Math.max(1, Math.min(GUIDE_MESSAGES.length, cur + delta));
		if (browsed === derived) { browsed = null; }
		show();
	}

	function setClosed(c) {
		closed = c;
		writeClosed(c);
		show();
	}

	function clearOutlines() {
		outlined.forEach(function (el) { setAttention(el, false); });
		outlined = [];
	}

	// Put up the message (and outlines) for the step in view.
	function show() {
		host.classList.toggle("mp-guide-closed", closed);
		var step = closed ? 0 : (browsed || derived);
		if (step === shown) { return; }
		clearOutlines();
		shown = step;
		shownAt = (window.performance ? performance.now() : Date.now());
		if (!step) { return; }
		text.textContent = GUIDE_MESSAGES[step - 1];
		count.textContent = step + "/" + GUIDE_MESSAGES.length;
		prevBtn.disabled = step <= 1;
		nextBtn.disabled = step >= GUIDE_MESSAGES.length;
		outlined = (opts.targets(step) || []).filter(Boolean);
		outlined.forEach(function (el) { setAttention(el, true); });
	}

	// Re-read the page; call after every refresh of the tab.
	function sync() {
		var st = opts.getStatus();
		var d = guideStep({ destination: st.destination, burnSet: st.burnSet, marker: st.marker,
			slid: slid, targetUsed: targetUsed });
		if (d !== derived) { derived = d; browsed = null; }
		show();
	}

	function resetProgress() {
		slid.coarse = slid.fine = slid.marker = false;
		targetUsed = false;
		sync();
	}

	// 0 unless step 3's message is up; see trajectoryGlow above.
	function glow() {
		if (shown !== 3) { return 0; }
		var now = window.performance ? performance.now() : Date.now();
		return trajectoryGlow(now - shownAt, reducedMotion);
	}

	sync();
	return { sync: sync, resetProgress: resetProgress, trajectoryGlow: glow };
}
